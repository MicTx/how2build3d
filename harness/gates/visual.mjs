/**
 * harness/gates/visual.mjs — 视觉感知下限门禁。
 *
 * 对一张验收截图做统计检查（不追求「好看」，只拦截「黑屏/白屏/死灰/单色」）：
 *   - 非黑非白占比 > 0.55
 *   - 亮度中位数 ∈ [0.06, 0.92]
 *   - RMS 对比度 > 0.075
 *   - 色彩多样性：12 个色相桶里 ≥2 个非空桶（黄昏/夜景等单色系场景合法；纯单桶=单色故障）
 *
 * --floors 追加「密度下限」（面向全资产场景的验收档，默认不启用、行为不变）：
 *   - 色相桶 ≥3（比默认档多一桶：全资产场景不该只靠单一色系撑画面）
 *   - 暗部占比（luma<0.15）∈ [0.02, 0.45]：>上限=暗部淹没画面；<下限=没有可读的
 *     暗部层次。下限 0.02 而非 0.05 是实测标定：parity 验收帧（evidence/frames/
 *     parity.png 与当前构建重渲）暗部占比仅 0.023–0.026（320/640/960 宽同口径），
 *     0.05 会把合法的雾天黄昏场景判红；黑屏（≈1.0）/死灰（≈0）仍在带外被拦。
 *   - 边缘密度 ∈ [0.02, 0.85]：内部像素中心差分梯度（|dx|+|dy|>0.08 计为边缘），
 *     实测健康场景 0.15–0.21（parity/quality/gameplay），平板/渐变/黑屏 ≈0，雪花屏 >0.85。
 *
 * 用 playwright-core 载入本地 PNG → canvas getImageData（复用 harness 依赖，零新库）。
 *
 * CLI: node harness/gates/visual.mjs --image evidence/frames/quality.png [--floors] [--json]
 */
import { chromium } from "playwright-core";
import { readFileSync , realpathSync} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CHROME_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox", "--no-sandbox", "--allow-file-access-from-files"];

export async function analyzeImage(imagePath) {
  const browser = await chromium.launch({ headless: true, channel: "chrome", args: CHROME_ARGS });
  try {
    const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
    const dataUrl = "data:image/png;base64," + readFileSync(path.resolve(ROOT, imagePath)).toString("base64");
    await page.goto("about:blank");
    const stats = await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const W = 320, H = Math.max(1, Math.round((img.height / img.width) * W));
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, W, H);
      const d = ctx.getImageData(0, 0, W, H).data;
      const n = W * H;
      let sum = 0, sum2 = 0, black = 0, white = 0, dark = 0;
      const hueBuckets = new Array(12).fill(0);
      const luma = new Float32Array(n);
      for (let i = 0, p = 0; i < d.length; i += 4, p += 1) {
        const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        luma[p] = l;
        sum += l; sum2 += l * l;
        if (l < 0.02) black += 1;
        if (l > 0.98) white += 1;
        if (l < 0.15) dark += 1;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), delta = mx - mn;
        if (delta > 0.04) {
          let h = 0;
          if (mx === r) h = ((g - b) / delta) % 6;
          else if (mx === g) h = (b - r) / delta + 2;
          else h = (r - g) / delta + 4;
          h = ((h * 60) + 360) % 360;
          hueBuckets[Math.floor(h / 30) % 12] += 1;
        }
      }
      // 边缘密度：内部像素中心差分梯度（固定 W=320 口径，分辨率无关）
      let edges = 0;
      for (let y = 1; y < H - 1; y += 1) {
        for (let x = 1; x < W - 1; x += 1) {
          const p = y * W + x;
          if (Math.abs(luma[p + 1] - luma[p - 1]) + Math.abs(luma[p + W] - luma[p - W]) > 0.08) edges += 1;
        }
      }
      const mean = sum / n;
      const variance = Math.max(0, sum2 / n - mean * mean);
      return {
        mean, rms: Math.sqrt(variance),
        blackRatio: black / n, whiteRatio: white / n,
        darkRatio: dark / n, edgeRatio: edges / n,
        hueBuckets: hueBuckets.map((c) => +(c / n).toFixed(3)),
        hueDiversity: hueBuckets.filter((c) => c / n > 0.01).length,
      };
    }, dataUrl);
    return stats;
  } finally {
    await browser.close();
  }
}

/** --floors 密度下限：色相桶 / 暗部占比区间 / 边缘密度区间（阈值标定依据见文件头注释）。 */
export function floorProblems(
  stats,
  { minHue = 3, darkMin = 0.02, darkMax = 0.45, edgeMin = 0.02, edgeMax = 0.85 } = {}
) {
  const problems = [];
  const hue = stats.hueDiversity;
  if (typeof hue !== "number" || !Number.isFinite(hue) || hue < minHue) {
    problems.push(`floors: 色相多样性 ${hue} < ${minHue}（全资产场景 ≥3 个非空色相桶）`);
  }
  const dark = stats.darkRatio;
  if (typeof dark !== "number" || !Number.isFinite(dark)) {
    problems.push("floors: darkRatio（luma<0.15 暗部占比）缺失");
  } else if (dark > darkMax) {
    problems.push(`floors: 暗部占比 ${dark.toFixed(3)} > ${darkMax}（暗部淹没画面）`);
  } else if (dark < darkMin) {
    problems.push(`floors: 暗部占比 ${dark.toFixed(3)} < ${darkMin}（没有可读的暗部层次）`);
  }
  const edge = stats.edgeRatio;
  if (typeof edge !== "number" || !Number.isFinite(edge)) {
    problems.push("floors: edgeRatio（边缘密度）缺失");
  } else if (edge < edgeMin) {
    problems.push(`floors: 边缘密度 ${edge.toFixed(3)} < ${edgeMin}（画面没有细节/轮廓，平板或死灰）`);
  } else if (edge > edgeMax) {
    problems.push(`floors: 边缘密度 ${edge.toFixed(3)} > ${edgeMax}（高频噪声/雪花屏嫌疑）`);
  }
  return problems;
}

export async function main(argv) {
  const idx = argv.indexOf("--image");
  const image = idx >= 0 ? argv[idx + 1] : "evidence/frames/quality.png";
  const floors = argv.includes("--floors");
  const stats = await analyzeImage(image);
  const problems = [];
  const visible = 1 - stats.blackRatio - stats.whiteRatio;
  if (visible < 0.55) problems.push(`非黑非白占比 ${visible.toFixed(2)} < 0.55（黑 ${stats.blackRatio.toFixed(2)} / 白 ${stats.whiteRatio.toFixed(2)}）`);
  if (stats.mean < 0.06 || stats.mean > 0.92) problems.push(`亮度均值 ${stats.mean.toFixed(2)} 出界 [0.06, 0.92]`);
  if (stats.rms < 0.075) problems.push(`RMS 对比度 ${stats.rms.toFixed(3)} < 0.075（画面发灰）`);
  if (stats.hueDiversity < 2) problems.push(`色相多样性 ${stats.hueDiversity} < 2（纯单色）`);
  if (floors) problems.push(...floorProblems(stats));
  const out = { image, stats, problems, floors };
  console.log(JSON.stringify(out, null, 1));
  if (problems.length) {
    console.error(`check-visual FAILED: ${problems.length} problem(s)`);
    return 1;
  }
  return 0;
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
