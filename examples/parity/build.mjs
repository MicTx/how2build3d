/**
 * parity/build.mjs — three r180 + 八 GLSL 系统 + sea + 十一件 kit + src/*.mjs
 * 拼成单文件 HTML（零运行时请求）。输出 build/parity/index.html（gitignored，可再生）。
 * 装配顺序与模块边界见 references/12-full-scene-assembly.md。
 * CLI: node examples/parity/build.mjs --assert
 */
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const THREE_CJS = path.join(ROOT, "harness/node_modules/three/build/three.cjs");
const SCENE_DIR = "examples/parity";
const OUT = path.join(ROOT, "build/parity/index.html");

const readAsset = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const GLSL = {
  postChain: readAsset("assets/post-chain.glsl"),
  postAA: readAsset("assets/post-aa.glsl"),
  shafts: readAsset("assets/shafts.glsl"),
  skyDeck: readAsset("assets/sky-deck.glsl"),
  pcss: readAsset("assets/pcss-shadow.glsl"),
  ssrWet: readAsset("assets/ssr-wet.glsl"),
  sea: readAsset("assets/sea.glsl"),
};

/* 十一件 kit + SL 双层：全部 IIFE 命名空间化（kit 间 createRng/TAU/PI 等顶层同名会撞，IIFE 隔离）。 */
const KITS = {
  PhysicsKit: "assets/physics-kit.mjs",
  LevelKit: "assets/level-kit.mjs",
  CombatKit: "assets/combat-kit.mjs",
  PropsKit: "assets/props-kit.mjs",
  FxKit: "assets/fx-kit.mjs",
  AudioKit: "assets/audio-kit.mjs",
  WeaponKit: "assets/weapon-kit.mjs",
  EnemyKit: "assets/enemy-kit.mjs",
  PlayerKit: "assets/player-kit.mjs",
  HudKit: "assets/hud-kit.mjs",
  WeatherKit: "assets/weather-kit.mjs",
  SlSurface: "assets/sl-surface.mjs",
  SlTextures: "assets/sl-textures.mjs",
  InspectDeck: "assets/inspect-deck.mjs",
};

/** 剥 export 前缀 + IIFE 包装 + 导出名自检（正则取自源码，防漏报）。 */
function wrapKit(name, esm) {
  const names = [...esm.matchAll(/^export (?:const|function|let|class) ([A-Za-z0-9_$]+)/gm)].map((m) => m[1]);
  if (!names.length) throw new Error(`build: kit ${name} has no exports`);
  const body = esm.replace(/^export /gm, "");
  return `globalThis.${name} = (function () {\n${body}\nreturn { ${names.join(", ")} };\n})();\n`;
}

/**
 * 内联清单（harness/gates/assets.mjs 的 corpus 只扫 build/*.html 顶层，子目录产物读不到）；
 * 本清单在构建期从 assets/ 源码提取每个内联资产的导出名（含 SYSTEMS/KITS marker 常量），
 * 落进场景目录作为「原样内联」的证据——逐名提取自资产真源，非手填。
 */
function writeInlineManifest() {
  const entries = {};
  for (const [ns, rel] of Object.entries(KITS)) {
    const esm = readAsset(rel);
    entries[ns] = {
      asset: rel,
      exports: [...esm.matchAll(/^export (?:const|function|let|class) ([A-Za-z0-9_$]+)/gm)].map((m) => m[1]),
    };
  }
  const GLSL_FILES = { postChain: "post-chain", postAA: "post-aa", shafts: "shafts", skyDeck: "sky-deck", pcss: "pcss-shadow", ssrWet: "ssr-wet", sea: "sea" };
  for (const [key, glsl] of Object.entries(GLSL)) {
    entries["GLSL_" + key] = {
      asset: "assets/" + GLSL_FILES[key] + ".glsl",
      markers: [...new Set([...glsl.matchAll(/SALTLINE_[A-Z_]+|saltline-sea-1|SEA_[A-Z_]+|VOL_STEPS/g)].map((m) => m[0]))],
    };
  }
  const out = path.join(ROOT, SCENE_DIR, "inline-manifest.json");
  writeFileSync(out, JSON.stringify({ version: 1, generatedBy: "examples/parity/build.mjs", inline: entries }, null, 1) + "\n");
  return out;
}

const MODULES = [
  "world.mjs", "noise.mjs", "mats.mjs", "sky.mjs", "sea.mjs", "ground.mjs",
  "layout.mjs", "props.mjs", "post.mjs", "pipeline.mjs",
  "game.mjs", "audio.mjs", "hud.mjs", "inspect.mjs", "scene.mjs",
];

const CSS = "html,body{margin:0;height:100%;background:#0b0d0f;overflow:hidden;font-family:ui-monospace,'PingFang SC',monospace;}"
  + "#view{display:block;width:100vw;height:100vh;}"
  + "#hud{position:fixed;left:16px;bottom:16px;color:#e8e4da;font-size:12px;letter-spacing:.08em;text-shadow:0 1px 4px #000;white-space:pre;}"
  + "#hud b{color:#ffb347;}";

export function build() {
  writeInlineManifest();
  const three = readFileSync(THREE_CJS, "utf8");
  const src = MODULES.map((m) => readFileSync(path.join(ROOT, SCENE_DIR, "src", m), "utf8")).join("\n\n");
  const kitScript = Object.entries(KITS).map(([ns, rel]) => wrapKit(ns, readAsset(rel))).join("\n");
  const GLSL_NAMES = {
    postChain: "GLSL_POST_CHAIN", postAA: "GLSL_POST_AA", shafts: "GLSL_SHAFTS",
    skyDeck: "GLSL_SKY_DECK", pcss: "GLSL_PCSS", ssrWet: "GLSL_SSR_WET", sea: "GLSL_SEA",
  };
  const glslScript = Object.entries(GLSL)
    .map(([k, v]) => `const ${GLSL_NAMES[k]} = ${JSON.stringify(v)};`)
    .join("\n")
    // 湿地反射块按 assets/ssr-wet.glsl 的 BEGIN/END 标记切出（GLSL_SSR_WET 的真实引用），
    // 场景层只消费 H2B.ssrWetRR，不保留内嵌副本。
    + `

const GLSL_SSR_WET_RR = (() => {
  const begin = "// ==== BEGIN SSR_WET_RR (SSR_WET_RR_BEGIN)";
  const end = "// ==== END SSR_WET_RR (SSR_WET_RR_END)";
  const i = GLSL_SSR_WET.indexOf(begin);
  const j = GLSL_SSR_WET.indexOf(end);
  if (i < 0 || j <= i) throw new Error("assets/ssr-wet.glsl: SSR_WET_RR markers missing");
  return GLSL_SSR_WET.slice(i, j + end.length);
})();
globalThis.H2B = globalThis.H2B || {};
globalThis.H2B.ssrWetRR = GLSL_SSR_WET_RR;`;

  const html = [
    "<!doctype html>",
    '<html lang="zh-CN"><head><meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
    "<title>parity — 盐线堆场（元素对账宿主场景）</title>",
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
    "/* ===== 资产层（GLSL 原样字符串 + 十四 kit 命名空间内联）===== */",
    glslScript,
    kitScript,
    "</script>",
    "<script>",
    "/* ===== 场景模块（MODULES 顺序即依赖）===== */",
    src,
    "H2B.bootScene();",
    "</script>",
    "</body></html>",
  ].join("\n");

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, html);
  return { path: OUT, bytes: Buffer.byteLength(html, "utf8"), threeBytes: Buffer.byteLength(three, "utf8") };
}

/** marker 权威来源 = harness/gates/assets.mjs 的 SYSTEMS/OPTIONAL_SYSTEMS/KITS 三段（构建期解析）。 */
function collectAssetMarkers() {
  const gates = readFileSync(path.join(ROOT, "harness/gates/assets.mjs"), "utf8");
  const section = (name) => gates.split("const " + name + " =")[1].split("};")[0];
  const found = [];
  for (const sec of ["SYSTEMS", "OPTIONAL_SYSTEMS", "KITS"]) {
    for (const m of section(sec).matchAll(/"([A-Za-z0-9_\-\.]+)"/g)) found.push(m[1]);
  }
  const protocol = [
    "createPhysicsKit", "createLevelKit", "validateLayout", "createCombatKit", "moveCapsule",
    "createInspectDeck", "__INSPECT_DECK__", "__setShot", "__PARITY__",
    "SL_SURFACE", "SL_MATERIALS", "SL_TEX", "createTextureFactory",
    "GLSL_SSR_WET", "GLSL_SSR_WET_RR", "H2B.ssrWetRR",
  ];
  const drop = /(-kit(\.mjs)?|\.glsl|\.mjs)$|^sl-(surface|textures)$|^post-(chain|aa)$|^sky-deck$|^ssr-wet$|^sea$|^shafts$|^pcss-shadow$/;
  return [...new Set([...found, ...protocol])].filter((m) => !drop.test(m));
}

export async function main(argv) {
  const result = build();
  console.log("build: " + result.bytes + "B single-file HTML (three r180: " + result.threeBytes + "B inlined) -> " + path.relative(ROOT, result.path));
  if (argv.includes("--assert")) {
    const html = readFileSync(result.path, "utf8");
    const markers = collectAssetMarkers();
    const missing = markers.filter((m) => !html.includes(m));
    const ok = result.bytes > 1000000 && missing.length === 0
      && !html.includes("<script src=") && !html.includes('<link rel="stylesheet');
    if (!ok) {
      console.error("parity/build.mjs --assert FAILED: missing markers: " + missing.join(", "));
      return 1;
    }
    console.log("parity/build.mjs --assert OK: markers present: " + markers.length);
  }
  return 0;
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => {
    console.error("parity/build.mjs crashed:", err && err.message ? err.message : err);
    process.exit(1);
  });
}
