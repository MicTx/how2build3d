/**
 * starter/build.mjs — 把 three.cjs 与 src/*.mjs 拼成**一个 HTML 文件**。
 *
 * 这就是本指南蒸馏出的核心交付形态：源码是模块，交付是单文件，零外链。
 * 输出：build/index.html（gitignored，可再生）。
 *
 * CLI: node examples/starter/build.mjs --assert
 */

import { readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const THREE_CJS = path.join(ROOT, "harness/node_modules/three/build/three.cjs");
const OUT = path.join(ROOT, "build/index.html");
const SRC_ORDER = ["noise.mjs", "materials.mjs", "assemble.mjs", "scene.mjs"];

const CSS = `
:root { color-scheme: dark; --bone:#e8e4da; --signal:#ffb347; }
html,body { margin:0; height:100%; background:#0b0d0f; overflow:hidden;
  font-family: ui-monospace, 'PingFang SC', monospace; }
#view { display:block; width:100vw; height:100vh; }
#hud { position:fixed; left:16px; bottom:16px; color:var(--bone);
  font-size:12px; letter-spacing:.08em; text-shadow:0 1px 4px #000; }
#hud::before { content:''; display:inline-block; width:6px; height:6px;
  margin-right:8px; background:var(--signal); border-radius:50%; }
`;

export function build() {
  const three = readFileSync(THREE_CJS, "utf8");
  const src = SRC_ORDER.map((name) =>
    readFileSync(path.join(ROOT, "examples/starter/src", name), "utf8")
  ).join("\n\n");
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>how2build3d starter</title>
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
/* starter modules (order matters: namespace -> materials -> assemble -> scene) */
${src}
H2B.bootStarter();
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
    const ok =
      result.bytes > 1_000_000 &&
      html.includes("H2B.bootStarter()") &&
      html.includes("h2b-wet-ground-1") &&
      html.includes("SALTLINE") === false &&
      !html.includes("<script src=") &&
      !html.includes("<link rel=\"stylesheet\"");
    if (!ok) {
      console.error("starter/build.mjs --assert FAILED: single-file invariants broken");
      return 1;
    }
  }
  return 0;
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error("starter/build.mjs crashed:", err && err.message ? err.message : err);
      process.exit(1);
    }
  );
}
