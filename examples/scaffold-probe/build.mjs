/**
 * scaffold-probe/build.mjs — three.cjs + 资产 + src/*.mjs 拼成单文件 HTML。
 * 输出：build/scaffold-probe/index.html（gitignored，可再生；符合 harness/render/scene.mjs 的输出契约）。
 *
 * 装配顺序与模块边界见 references/12-full-scene-assembly.md。
 * CLI: node examples/scaffold-probe/build.mjs --assert
 */

import { readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const THREE_CJS = path.join(ROOT, "harness/node_modules/three/build/three.cjs");
const SCENE_DIR = "examples/scaffold-probe";
const OUT = path.join(ROOT, "build/scaffold-probe/index.html");

const readAsset = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const ASSETS = {
  slTextures: readAsset("assets/sl-textures.mjs"),
  slSurface: readAsset("assets/sl-surface.mjs"),
  postChain: readAsset("assets/post-chain.glsl"),
  postAA: readAsset("assets/post-aa.glsl"),
  shafts: readAsset("assets/shafts.glsl"),
  skyDeck: readAsset("assets/sky-deck.glsl"),
  pcss: readAsset("assets/pcss-shadow.glsl"),
  ssrWet: readAsset("assets/ssr-wet.glsl"),
  physicsKit: readAsset("assets/physics-kit.mjs"),
  levelKit: readAsset("assets/level-kit.mjs"),
  combatKit: readAsset("assets/combat-kit.mjs"),
  inspectDeck: readAsset("assets/inspect-deck.mjs"),
};
const toScript = (esm) => esm.replace(/^export (const|function) /gm, "$1 ");

const MODULES = ["world.mjs","mats.mjs","ground.mjs","content.mjs","layout.mjs","bots.mjs","game.mjs","inspect.mjs","scene.mjs"];
const CSS = "html,body{margin:0;height:100%;background:#0b0d0f;overflow:hidden;font-family:ui-monospace,'PingFang SC',monospace;}"
  + "#view{display:block;width:100vw;height:100vh;}"
  + "#hud{position:fixed;left:16px;bottom:16px;color:#e8e4da;font-size:12px;letter-spacing:.08em;text-shadow:0 1px 4px #000;white-space:pre;}"
  + "#hud b{color:#ffb347;}";

export function build() {
  const three = readFileSync(THREE_CJS, "utf8");
  const src = MODULES
    .map((m) => readFileSync(path.join(ROOT, SCENE_DIR, "src", m), "utf8"))
    .join("\n\n");
  const kitNames = Object.keys(ASSETS).filter((k) => /Kit$/.test(k));
  const kitScript = kitNames.map((k) => toScript(ASSETS[k])).join("\n");
  const glslNames = Object.keys(ASSETS).filter((k) => !/Kit$/.test(k) && k !== "inspectDeck" && k !== "slTextures" && k !== "slSurface");
  const glslScript = glslNames
    .map((k) => "var GLSL_" + k.replace(/([A-Z])/g, "_$1").toUpperCase() + " = " + JSON.stringify(ASSETS[k]) + ";")
    .join("\n");
  const factoryScript = [ASSETS.slTextures, ASSETS.slSurface].filter(Boolean).map(toScript).join("\n");
  const deckScript = toScript(ASSETS.inspectDeck) + "\nglobalThis.InspectDeck = { INSPECT_GALLERIES, readInspectMode, createInspectDeck };";
  const kitGlobal = kitNames.length
    ? "globalThis.PhysicsKit = typeof createPhysicsKit === \"function\" ? { createPhysicsKit } : undefined;"
      + "\nglobalThis.LevelKit = typeof createLevelKit === \"function\" ? { createLevelKit, validateLayout } : undefined;"
      + "\nglobalThis.CombatKit = typeof createCombatKit === \"function\" ? { createCombatKit, COMBAT_TUNE_DEFAULTS } : undefined;"
    : "";

  const html = [
    "<!doctype html>",
    '<html lang="zh-CN"><head><meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
    "<title>scaffold-probe</title>",
    "<style>" + CSS + "</style></head>",
    "<body>",
    '<canvas id="view" tabindex="0"></canvas>',
    '<div id="hud">booting…</div>',
    "<script>",
    "/* three.js r180 (MIT) inlined: build-time only, zero runtime requests */",
    "var THREE = (function(){ var exports = {}; var module = { exports: exports };",
    three,
    "return exports; })();",
    "</script>",
    "<script>",
    "/* ===== 资产（原样内联）===== */",
    factoryScript,
    glslScript,
    kitScript,
    kitGlobal,
    deckScript,
    "</script>",
    "<script>",
    "/* ===== 场景模块（按 MODULES 顺序，顺序即依赖）===== */",
    src,
    "H2B.bootScene();",
    "</script>",
    "</body></html>",
  ].join("\n");

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, html);
  return { path: OUT, bytes: Buffer.byteLength(html, "utf8"), threeBytes: Buffer.byteLength(three, "utf8") };
}

export async function main(argv) {
  const result = build();
  console.log("build: " + result.bytes + "B single-file HTML (three r180: " + result.threeBytes + "B inlined) -> " + path.relative(ROOT, result.path));
  if (argv.includes("--assert")) {
    const html = readFileSync(result.path, "utf8");
    const markers = ["createInspectDeck", "__PARITY__", "__setShot", "SL_MATERIALS", "VOL_STEPS", "SL_SURFACE", "createPhysicsKit", "createCombatKit", "moveCapsule"];
    const missing = markers.filter((m) => !html.includes(m));
    const ok = result.bytes > 1000000 && missing.length === 0
      && !html.includes("<script src=") && !html.includes('<link rel="stylesheet');
    if (!ok) {
      console.error("scaffold-probe/build.mjs --assert FAILED: missing markers: " + missing.join(", "));
      return 1;
    }
    console.log("scaffold-probe/build.mjs --assert OK: markers present: " + markers.length);
  }
  return 0;
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => {
    console.error("scaffold-probe/build.mjs crashed:", err && err.message ? err.message : err);
    process.exit(1);
  });
}
