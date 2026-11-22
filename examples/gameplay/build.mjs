/**
 * gameplay/build.mjs — 玩法链路训练场：three.cjs + 三 kit 资产 + src/*.mjs 拼成单文件 HTML。
 * 输出：build/gameplay/index.html（gitignored，可再生；符合 render/scene.mjs 的场景输出契约）。
 *
 * CLI: node examples/gameplay/build.mjs --assert
 */

import { readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const THREE_CJS = path.join(ROOT, "harness/node_modules/three/build/three.cjs");
const OUT = path.join(ROOT, "build/gameplay/index.html");

const readAsset = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const ASSETS = {
  physicsKit: readAsset("assets/physics-kit.mjs"),
  levelKit: readAsset("assets/level-kit.mjs"),
  combatKit: readAsset("assets/combat-kit.mjs"),
  inspectDeck: readAsset("assets/inspect-deck.mjs"),
};
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
  const src = ["layout.mjs", "bots.mjs", "battle.mjs", "scene.mjs"]
    .map((name) => readFileSync(path.join(ROOT, "examples/gameplay/src", name), "utf8"))
    .join("\n\n");
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>how2build3d gameplay — 令牌射击场</title>
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
/* ===== 玩法链路 kit 资产（原样内联）===== */
${toScript(ASSETS.physicsKit)}
${toScript(ASSETS.levelKit)}
${toScript(ASSETS.combatKit)}
${toScript(ASSETS.inspectDeck)}
globalThis.PhysicsKit = { createPhysicsKit };
globalThis.LevelKit = { createLevelKit, validateLayout };
globalThis.CombatKit = { createCombatKit, COMBAT_TUNE_DEFAULTS };
globalThis.InspectDeck = { INSPECT_GALLERIES, readInspectMode, createInspectDeck };
</script>
<script>
/* ===== 示例场景模块 ===== */
${src}
H2B.bootGameplay();
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
    const markers = [
      "createPhysicsKit", "createLevelKit", "createCombatKit", "autoBattle",
      "INSPECT_GALLERIES", "createInspectDeck", "__INSPECT_DECK__",
      "moveCapsule", "validateLayout", "tokenGap",
    ];
    const missing = markers.filter((m) => !html.includes(m));
    const ok = result.bytes > 1_000_000 && missing.length === 0
      && !html.includes("<script src=") && !html.includes('<link rel="stylesheet');
    if (!ok) {
      console.error("gameplay/build.mjs --assert FAILED: missing markers:", missing);
      return 1;
    }
    console.log("gameplay/build.mjs --assert OK: kit markers present:", markers.length);
  }
  return 0;
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error("gameplay/build.mjs crashed:", err && err.message ? err.message : err);
      process.exit(1);
    }
  );
}
