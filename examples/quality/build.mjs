/**
 * quality/build.mjs — 渲染链八系统质感基线：把 three.cjs + assets/ 的 SL 材质/纹理与六条 GLSL pass + src/*.mjs 拼成单文件 HTML。
 *
 * 与 starter 的区别：本示例**消费 skill 的资产层**（assets/*.glsl 原样内联、assets/sl-*.mjs
 * 去除 export 前缀后内联；ssr-wet 按 BEGIN/END 标记切出 RR 反射块注入），这就是"方法论 + 资产
 * 才构成完整蒸馏"的运行态证明。
 * 输出：build/quality/index.html（gitignored，可再生；符合 render/scene.mjs 的场景输出契约）。
 *
 * CLI: node examples/quality/build.mjs --assert
 */

import { readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const THREE_CJS = path.join(ROOT, "harness/node_modules/three/build/three.cjs");
const OUT = path.join(ROOT, "build/quality/index.html");

// ---- 消费资产层（原样读取，不改内容）----
const readAsset = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const ASSETS = {
  slSurface: readAsset("assets/sl-surface.mjs"),
  slTextures: readAsset("assets/sl-textures.mjs"),
  inspectDeck: readAsset("assets/inspect-deck.mjs"),
  postChain: readAsset("assets/post-chain.glsl"),
  postAA: readAsset("assets/post-aa.glsl"),
  shafts: readAsset("assets/shafts.glsl"),
  skyDeck: readAsset("assets/sky-deck.glsl"),
  pcss: readAsset("assets/pcss-shadow.glsl"),
  ssrWet: readAsset("assets/ssr-wet.glsl"),
};
// ESM→IIFE：本仓库资产只使用 `export const/function` 两种形态，剥离前缀即可拼接。
const toScript = (esm) => esm.replace(/^export (const|function) /gm, "$1 ");

const CSS = `
:root { color-scheme: dark; --bone:#e8e4da; --signal:#ffb347; }
html,body { margin:0; height:100%; background:#0b0d0f; overflow:hidden;
  font-family: ui-monospace, 'PingFang SC', monospace; }
#view { display:block; width:100vw; height:100vh; }
#hud { position:fixed; left:16px; bottom:16px; color:var(--bone);
  font-size:12px; letter-spacing:.08em; text-shadow:0 1px 4px #000; white-space:pre; }
#hud b { color:var(--signal); }
`;

export function build() {
  const three = readFileSync(THREE_CJS, "utf8");
  const src = ["noise.mjs", "sky.mjs", "mats.mjs", "ground.mjs", "content.mjs", "post.mjs", "pipeline.mjs", "inspect.mjs", "scene.mjs"]
    .map((name) => readFileSync(path.join(ROOT, "examples/quality/src", name), "utf8"))
    .join("\n\n");
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>how2build3d quality — 雨后黄昏堆场</title>
<style>${CSS}</style></head>
<body>
<canvas id="view" tabindex="0"></canvas>
<div id="hud">booting…</div>
<script>
/* three.js r180 (MIT) inlined: build-time only, zero runtime requests */
var THREE = (function(){ var exports = {}; var module = { exports: exports };
${three}
return exports; })();
</script>
<script>
/* ===== skill 资产层（原样内联）===== */
const GLSL_POST_CHAIN = ${JSON.stringify(ASSETS.postChain)};
const GLSL_POST_AA = ${JSON.stringify(ASSETS.postAA)};
const GLSL_SHAFTS = ${JSON.stringify(ASSETS.shafts)};
const GLSL_SKY_DECK = ${JSON.stringify(ASSETS.skyDeck)};
const GLSL_PCSS = ${JSON.stringify(ASSETS.pcss)};
const GLSL_SSR_WET = ${JSON.stringify(ASSETS.ssrWet)};
// 湿地反射块按 assets/ssr-wet.glsl 的 BEGIN/END 标记切出，场景不保留内嵌副本。
// GLSL_SSR_WET 必须被实际引用（切块），否则视为假消费。
const GLSL_SSR_WET_RR = (() => {
  const begin = "// ==== BEGIN SSR_WET_RR (SSR_WET_RR_BEGIN)";
  const end = "// ==== END SSR_WET_RR (SSR_WET_RR_END)";
  const i = GLSL_SSR_WET.indexOf(begin);
  const j = GLSL_SSR_WET.indexOf(end);
  if (i < 0 || j <= i) throw new Error("assets/ssr-wet.glsl: SSR_WET_RR markers missing");
  return GLSL_SSR_WET.slice(i, j + end.length);
})();
globalThis.H2B = globalThis.H2B || {};
globalThis.H2B.ssrWetRR = GLSL_SSR_WET_RR;
${toScript(ASSETS.slSurface)}
${toScript(ASSETS.slTextures)}
globalThis.SLSurface = { SL_SURFACE, SL_MATERIALS, SL_MATERIAL_FALLBACK, injectSLSurface, createSurfaceMaterialFactory };
globalThis.SLTextures = { SL_TEX, SL_GENERATORS, SL_TEX_SETS, createTextureFactory };
${toScript(ASSETS.inspectDeck)}
globalThis.InspectDeck = { INSPECT_GALLERIES, readInspectMode, createInspectDeck };
</script>
<script>
/* ===== 示例场景模块 ===== */
${src}
H2B.bootQuality();
</script>
</body></html>
`;
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, html);
  return { path: OUT, bytes: Buffer.byteLength(html, "utf8"), threeBytes: Buffer.byteLength(three, "utf8") };
}

export async function main(argv) {
  const result = build();
  console.log(`build: ${result.bytes}B single-file HTML (three r180: ${result.threeBytes}B inlined) -> ${path.relative(ROOT, result.path)}`);
  if (argv.includes("--assert")) {
    const html = readFileSync(result.path, "utf8");
    // 资产消费断言：八系统 + SL 材质层 + PCSS 注入都必须在产物里；
    // ssr-wet 另断言「资产文件名 → 切块标记 → 注入块」三段真实引用。
    const markers = [
      "SALTLINE_POST", "SALTLINE_SKY", "SALTLINE_SHADOW", "SALTLINE_POST vol",
      "slAgx", "SL_SURFACE", "SL_MATERIALS", "injectSLSurface", "createTextureFactory",
      "uSlWet", "uRefl", "VOL_STEPS",
      "GLSL_SSR_WET", "GLSL_SSR_WET_RR", "SSR_WET_RR_BEGIN", "H2B.ssrWetRR",
      "INSPECT_GALLERIES", "createInspectDeck", "__INSPECT_DECK__",
    ];
    const missing = markers.filter((m) => !html.includes(m));
    const ok = result.bytes > 1_000_000 && missing.length === 0
      && !html.includes("<script src=") && !html.includes('<link rel="stylesheet');
    if (!ok) {
      console.error("quality/build.mjs --assert FAILED: missing markers:", missing);
      return 1;
    }
    console.log("quality/build.mjs --assert OK: asset markers present:", markers.length);
  }
  return 0;
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error("quality/build.mjs crashed:", err && err.message ? err.message : err);
      process.exit(1);
    }
  );
}
