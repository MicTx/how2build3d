/**
 * harness/slice-bundle.mjs — 分界判定与体积预算。
 *
 * 夹具是「单 HTML = 元信息 + CSS + DOM + 一个 <script>」结构，script 内部为
 * esbuild 打包产物：上游 three r180（压缩）在前，app 代码在后（GLSL 以模板
 * 字符串原文保留）。本脚本：
 *   1. 切出 HTML 元信息 / CSS / DOM / JS 四层，分别计字节数
 *   2. 以 app 专属 marker（SALTLINE_* 着色器、tNoise、saltline- 缓存键、__G）
 *      判定 three/app 分界（近似，标注不确定性）
 *   3. 资产自足性审计：证明无外部图片/音频/模型/网络请求
 *   4. 统计 onBeforeCompile / customProgramCacheKey / 注释密度
 *
 * 输出：stdout JSON + evidence/frames/bundle.json（可再生证据）
 * CLI: node harness/slice-bundle.mjs --assert
 */

import { readFileSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURE = path.join(ROOT, "sources/jimao-3a-game/index.html");
const OUT_DIR = path.join(ROOT, "evidence/frames");

// app 专属 marker：这些 token 不可能出现在上游 three.js r180 里
const APP_MARKERS = [
  "SALTLINE_SKY",
  "SALTLINE_SHADOW",
  "SALTLINE_POST",
  "saltline-blink",
  "saltline-gulls",
  "saltline-apron-",
  "saltline-sea-",
  "pac9-detail-",
  "uniform sampler2D tNoise",
  "window.__G=",
];

function analyze() {
  const raw = readFileSync(FIXTURE, "utf8");
  const totalBytes = Buffer.byteLength(raw, "utf8");
  const totalLines = raw.split("\n").length;

  // ---- 四层切分 ----
  const styleStart = raw.indexOf("<style>");
  const styleEnd = raw.indexOf("</style>") + "</style>".length;
  const cssBytes = styleEnd - styleStart - "<style>".length - "</style>".length;
  const cssText = raw.slice(styleStart + "<style>".length, raw.indexOf("</style>"));

  const scriptOpen = raw.indexOf("<script");
  const scriptOpenEnd = raw.indexOf(">", scriptOpen) + 1;
  const scriptClose = raw.lastIndexOf("</script>");
  const jsText = raw.slice(scriptOpenEnd, scriptClose);
  const jsBytes = Buffer.byteLength(jsText, "utf8");

  const headEnd = raw.indexOf("</head>") + "</head>".length;
  const metaBytes = headEnd;
  const bodyStart = raw.indexOf("<body");
  const domText = raw.slice(raw.indexOf(">", bodyStart) + 1, scriptOpen);
  const domBytes = Buffer.byteLength(domText, "utf8");
  const tailBytes = totalBytes - scriptClose - "</script>".length;

  const jsLines = jsText.split("\n");
  const jsStartLine = raw.slice(0, scriptOpenEnd).split("\n").length; // 1-based 行号

  // ---- three/app 分界（字符级，精确） ----
  // three 侧最后一个类是 WebGLRenderer（outputColorSpace setter 结束于
  // `unpackColorSpace()}};`），app 侧第一条语句是场景常量
  // `var oi={min:new W(-40,0,-30),...}`。esbuild 把模块拼在同一物理行上，
  // 行号只能给 ±1 行的粗界，字符偏移才是精确分界。
  const CHAR_BOUNDARY_MARK = "var oi={min:new W(";
  const charBoundaryInRaw = raw.indexOf(CHAR_BOUNDARY_MARK);
  const charBoundaryInJs = charBoundaryInRaw < 0 ? -1 : charBoundaryInRaw - scriptOpenEnd;
  const threeChars = charBoundaryInJs > 0 ? charBoundaryInJs : jsBytes;
  const appChars = charBoundaryInJs > 0 ? jsBytes - charBoundaryInJs : 0;
  const charBoundaryLine = charBoundaryInRaw > 0 ? raw.slice(0, charBoundaryInRaw).split("\n").length : -1;

  // ---- three/app 分界（marker 法，行级粗界，保留用于交叉核对） ----
  const markerHits = [];
  for (const marker of APP_MARKERS) {
    let idx = jsText.indexOf(marker);
    if (idx < 0) continue;
    const lineInJs = jsText.slice(0, idx).split("\n").length;
    markerHits.push({ marker, line: jsStartLine + lineInJs - 1, jsLine: lineInJs });
  }
  markerHits.sort((a, b) => a.jsLine - b.jsLine);
  const appStartJsLine = markerHits.length ? markerHits[0].jsLine : jsLines.length;
  // 分界行可能横跨超长压缩行：three 侧含 app 尾部或反之，标为 ±1 行不确定
  const threeLines = Math.max(0, appStartJsLine - 1);
  const appLines = jsLines.length - threeLines;

  // ---- three 特征 ----
  const threeSignals = {
    acesFilmic: jsText.includes("ACESFilmicToneMapping"),
    pmrem: /PMREMGenerator|CubemapFromEquirect/.test(jsText),
    webglRenderer: /customProgramCacheKey|WebGLRenderer/.test(jsText),
    exportTable: /Object\.defineProperty/.test(jsText.slice(0, 2000)),
  };

  // ---- app 特征 ----
  const appSignals = {
    onBeforeCompile: (jsText.match(/onBeforeCompile/g) || []).length,
    customProgramCacheKeys: [...jsText.matchAll(/customProgramCacheKey=\(\)=>"([^"]+)"/g)].map((m) => m[1]),
    saltlineShaderSections: [...jsText.matchAll(/\/\/ (SALTLINE_[A-Z_]+)/g)].map((m) => m[1]),
    chineseUiStrings: (jsText.match(/[\u4e00-\u9fa5][\u4e00-\u9fa5，。！？：]{3,}/g) || []).length,
    jsCommentLines: jsLines.filter((l) => /^\s*\/\//.test(l)).length,
    glslTemplateHeads: (jsText.match(/`(#ifdef|#if |void main|uniform |varying |precision )/g) || []).length,
  };

  // ---- 资产自足性审计 ----
  // fetch 调用按区域分类：上游 three 的 FileLoader/ImageBitmapLoader 自带 fetch，
  // 但 app 从不触发它们；判据是调用点行号是否位于 three/app 分界之前。
  const fetchSites = [];
  {
    let idx = jsText.indexOf("fetch(");
    while (idx >= 0) {
      const lineInJs = jsText.slice(0, idx).split("\n").length;
      fetchSites.push(lineInJs);
      idx = jsText.indexOf("fetch(", idx + 1);
    }
  }
  const appFetchSites = fetchSites.filter((l) => l >= appStartJsLine);
  const assetProbe = {
    externalImages: (raw.match(/<img\s/g) || []).length,
    fetchSitesTotal: fetchSites.length,
    fetchSitesInThreeRegion: fetchSites.length - appFetchSites.length,
    fetchSitesInAppRegion: appFetchSites.length,
    xhr: (jsText.match(/XMLHttpRequest/g) || []).length,
    audioFiles: (raw.match(/\.(mp3|ogg|wav|flac|m4a)['"]/g) || []).length,
    imageFiles: (raw.match(/\.(png|jpe?g|webp|gif|ktx2?|basis)['"]/g) || []).length,
    modelFiles: (raw.match(/\.(glb|gltf|fbx|obj)['"]/g) || []).length,
    scriptSrc: (raw.match(/<script[^>]+src=/g) || []).length,
    linkStylesheet: (raw.match(/<link[^>]+stylesheet/g) || []).length,
    canvasCount: (raw.match(/<canvas/g) || []).length,
  };
  const assetFree = !assetProbe.externalImages && !assetProbe.xhr &&
    !assetProbe.audioFiles && !assetProbe.imageFiles && !assetProbe.modelFiles &&
    !assetProbe.scriptSrc && !assetProbe.linkStylesheet && !assetProbe.fetchSitesInAppRegion;

  const budget = {
    totalBytes,
    totalLines,
    layers: {
      metaHead: { bytes: metaBytes, note: "<!doctype>..<\/head>（含内嵌 CSS）" },
      css: { bytes: cssBytes, lines: cssText.split("\n").length },
      dom: { bytes: domBytes, lines: domText.split("\n").length },
      script: { bytes: jsBytes, lines: jsLines.length },
      tail: { bytes: tailBytes },
    },
    jsRegions: {
      three: { chars: threeChars, sharePct: Number(((threeChars / jsBytes) * 100).toFixed(1)), approxLines: threeLines, boundaryCharInJs: charBoundaryInJs, boundaryLine: charBoundaryLine, note: "字符级精确；行号仅 ±1 行粗界（esbuild 同行拼接）" },
      app: { chars: appChars, sharePct: Number(((appChars / jsBytes) * 100).toFixed(1)), approxLines: appLines, note: "含全部 GLSL 模板字符串与玩法逻辑" },
    },
    markerHits,
    threeSignals,
    appSignals,
    assetProbe,
    assetFree,
  };
  return budget;
}

export function analyzeBundle() {
  return analyze();
}

export async function main(argv) {
  const assert = argv.includes("--assert");
  const json = argv.includes("--json");
  const budget = analyze();
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, "bundle.json"), `${JSON.stringify(budget, null, 1)}\n`);
  const checks = [
    { name: "layers-script-bytes", ok: budget.layers.script.bytes > 1_300_000, detail: `script=${budget.layers.script.bytes}B` },
    { name: "layers-css-bytes", ok: budget.layers.css.bytes > 8_000, detail: `css=${budget.layers.css.bytes}B` },
    { name: "three-region-chars", ok: budget.jsRegions.three.chars > 600_000, detail: `three=${budget.jsRegions.three.chars}B (${budget.jsRegions.three.sharePct}%)` },
    { name: "boundary-char-precise", ok: budget.jsRegions.three.boundaryCharInJs > 0, detail: `char-in-js=${budget.jsRegions.three.boundaryCharInJs}` },
    { name: "app-region-lines", ok: budget.jsRegions.app.approxLines > 1200, detail: `app≈${budget.jsRegions.app.approxLines} 行` },
    { name: "saltline-markers", ok: budget.appSignals.saltlineShaderSections.length >= 3, detail: budget.appSignals.saltlineShaderSections.join(",") },
    { name: "onBeforeCompile", ok: budget.appSignals.onBeforeCompile >= 8, detail: `${budget.appSignals.onBeforeCompile} 处` },
    { name: "asset-free-app", ok: budget.assetFree, detail: JSON.stringify(budget.assetProbe) },
  ];
  const failed = checks.filter((c) => !c.ok);
  if (json) console.log(JSON.stringify({ budget, checks }, null, 1));
  else {
    for (const c of checks) console.log(`${c.ok ? "OK  " : "FAIL"} ${c.name}: ${c.detail}`);
    console.log(`\nbudget: total=${budget.totalBytes}B / ${budget.totalLines} lines; css=${budget.layers.css.bytes}B; js=${budget.layers.script.bytes}B`);
    console.log(`boundary: char-in-js=${budget.jsRegions.three.boundaryCharInJs} (line≈${budget.jsRegions.three.boundaryLine}); three=${budget.jsRegions.three.chars}B (${budget.jsRegions.three.sharePct}%) / app=${budget.jsRegions.app.chars}B (${budget.jsRegions.app.sharePct}%)`);
  }
  if (assert && failed.length) {
    console.error(`slice-bundle.mjs --assert FAILED: ${failed.map((c) => c.name).join(", ")}`);
    return 1;
  }
  return 0;
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error("slice-bundle.mjs crashed:", err && err.message ? err.message : err);
      process.exit(1);
    }
  );
}
