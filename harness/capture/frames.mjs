/**
 * harness/capture-frames.mjs — 帧级证据采集器（bench 模式）。
 *
 * 夹具自带检视协议（蒸馏发现）：
 *   - `?bench&seed=4207` → 静音 + 跳过开场 + 确定性 RNG（fixture 源码 QC()）
 *   - `window.__G`       → 引擎上下文 {THREE, params, events, rng, time, quality, ...}
 *   - `__G.render.stats()` → 渲染器自报统计
 *
 * 本脚本在页面脚本执行前钩住 WebGL 计数 draw call / program，随后按 rAF 边界
 * 采样帧耗时与每帧 draw 分布，并同步读取渲染器自报统计。
 *
 * 输出（可再生证据，gitignored）：evidence/frames/summary.json
 *
 * CLI:
 *   node harness/capture-frames.mjs --assert   校验通过 exit 0
 *   node harness/capture-frames.mjs --json     打印 summary 后 exit 0
 *   --frames <n>   采样帧数（默认 24；SwiftShader 软渲染下控制 verify 时长）
 *   --seed <n>     夹具 RNG 种子（默认 4207，与夹具默认一致）
 */

import { launchFixture } from "../boot.mjs";
import { mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FRAMES_DIR = fileURLToPath(new URL("../../evidence/frames/", import.meta.url));

const INIT_HOOK = `
window.__h2b = { draws: 0, programs: 0, shaderCompiles: 0 };
(function () {
  const P2 = WebGL2RenderingContext.prototype;
  const P1 = WebGLRenderingContext.prototype;
  for (const P of [P1, P2]) {
    if (!P) continue;
    const de = P.drawElements;
    if (de) P.drawElements = function () { window.__h2b.draws++; return de.apply(this, arguments); };
    const da = P.drawArrays;
    if (da) P.drawArrays = function () { window.__h2b.draws++; return da.apply(this, arguments); };
    const cp = P.createProgram;
    if (cp) P.createProgram = function () { window.__h2b.programs++; return cp.apply(this, arguments); };
    const lp = P.linkProgram;
    if (lp) P.linkProgram = function () { window.__h2b.programs++; return lp.apply(this, arguments); };
    const ss = P.shaderSource;
    if (ss) P.shaderSource = function () { window.__h2b.shaderCompiles++; return ss.apply(this, arguments); };
  }
})();
`;

/** 任意页面（夹具或本仓库构建的场景）的帧级采样。夹具与场景共用 window.__G / __stats 协议。 */
export { INIT_HOOK };

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export async function captureProfileAt({ url, frames = 24, waitMs = 6000, viewport = [640, 360] } = {}) {
  const session = await launchFixture({ viewport, waitMs, url, initScript: INIT_HOOK });
  try {
    const sample = await session.page.evaluate(
      (n) =>
        new Promise((resolve, reject) => {
          try {
            const perFrameDraws = [];
            const frameMs = [];
            const rendererStats = [];
            let prev = performance.now();
            let step = 0;
            const tick = () => {
              const now = performance.now();
              frameMs.push(now - prev);
              perFrameDraws.push(window.__h2b.draws);
              window.__h2b.draws = 0;
              try {
                const g = window.__G;
                // 夹具协议：__G.render.stats()；本仓库场景协议：扁平 window.__stats()（references/12 检查钩子契约）
                const s = g && g.render && g.render.stats ? g.render.stats()
                  : (typeof window.__stats === "function" ? window.__stats() : null);
                rendererStats.push(s || null);
              } catch (e) {
                rendererStats.push({ error: String(e).slice(0, 120) });
              }
              prev = now;
              step += 1;
              if (step >= n) {
                resolve({ frameMs, perFrameDraws, programs: window.__h2b.programs, rendererStats });
                return;
              }
              requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          } catch (err) {
            reject(err);
          }
        }),
      frames
    );
    const errors = await session.page.evaluate(() => (window.__errors || []).map((e) => String(e).slice(0, 300)));
    const quality = await session.page.evaluate(() => {
      const g = window.__G;
      return g && g.quality ? { ...g.quality } : null;
    });
    const game = await session.page.evaluate(() => {
      const g = window.__G;
      return g && g.game ? { state: g.game.state } : null;
    });
    const ms = [...sample.frameMs].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    const draws = [...sample.perFrameDraws].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    const lastStat = [...sample.rendererStats].reverse().find((s) => s && !s.error) || null;
    return {
      fixture: url,
      mode: "bench (noaudio=1, autostart=1, seeded rng)",
      viewport,
      frames: ms.length,
      programs: sample.programs,
      shaderCompiles: (await session.page.evaluate(() => window.__h2b.shaderCompiles)) ?? null,
      avgFrameMs: ms.length ? Number((ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(2)) : null,
      p50FrameMs: ms.length ? Number(percentile(ms, 50).toFixed(2)) : null,
      p99FrameMs: ms.length ? Number(percentile(ms, 99).toFixed(2)) : null,
      avgDrawsPerFrame: draws.length
        ? Number((sample.perFrameDraws.filter(Number.isFinite).reduce((a, b) => a + b, 0) / draws.length).toFixed(2))
        : null,
      p50DrawsPerFrame: percentile(draws, 50),
      // 首帧是暖机（阴影贴图全量渲染 + 程序编译），不计入稳态 max；实测 quality 场景 [1481,71,71,...]。
      maxDrawsPerFrame: (() => {
        const steady = sample.perFrameDraws.filter(Number.isFinite).slice(1);
        return steady.length ? Math.max(...steady) : (draws[0] ?? 0);
      })(),
      quality,
      gameState: game,
      rendererStatsSample: lastStat,
      errorCount: errors.length,
      errors: errors.slice(0, 8),
      capturedAt: new Date().toISOString(),
    };
  } finally {
    await session.close();
  }
}

export async function captureFrames({ frames = 24, waitMs = 6000, viewport = [640, 360], seed = 4207 } = {}) {
  return captureProfileAt({
    url: `${FIXTURE_URL_BENCH}&seed=${seed}`,
    frames,
    waitMs,
    viewport,
  });
}


// 与夹具同源的 file URL；bench 参数由夹具 QC() 解析（noaudio=1, autostart=1）
const { FIXTURE_URL } = await import("../boot.mjs");
const FIXTURE_URL_BENCH = `${FIXTURE_URL}?bench`;

function parseArgs(argv) {
  const out = { frames: 24, waitMs: 6000, seed: 4207 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--assert" || a === "--json") out[a.slice(2)] = true;
    else if (a === "--frames") {
      i += 1;
      out.frames = Number(argv[i]);
    } else if (a === "--wait-ms") {
      i += 1;
      out.waitMs = Number(argv[i]);
    } else if (a === "--seed") {
      i += 1;
      out.seed = Number(argv[i]);
    } else if (a === "--viewport") {
      i += 1;
      out.viewport = String(argv[i]).split("x").map(Number);
    }
  }
  return out;
}

export async function main(argv) {
  const args = parseArgs(argv);
  const summary = await captureFrames({ frames: args.frames, waitMs: args.waitMs, viewport: args.viewport, seed: args.seed });
  mkdirSync(FRAMES_DIR, { recursive: true });
  writeFileSync(`${FRAMES_DIR}summary.json`, `${JSON.stringify(summary, null, 1)}\n`);
  const ok =
    summary.frames >= 12 &&
    (summary.avgDrawsPerFrame || 0) > 0 &&
    (summary.programs || 0) > 0 &&
    summary.errorCount === 0;
  console.log(JSON.stringify(summary, null, 1));
  if (args.assert && !ok) {
    console.error("capture-frames.mjs --assert FAILED: see summary above");
    return 1;
  }
  return 0;
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error("capture-frames.mjs crashed:", err && err.message ? err.message : err);
      process.exit(1);
    }
  );
}
