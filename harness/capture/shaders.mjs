/**
 * harness/capture-shaders.mjs — 运行时着色器全量捕获。
 *
 * 原理：在页面脚本执行前替换 WebGL2/WebGL 的 shaderSource，浏览器实际编译
 * 的每一段 GLSL（含 three 组装、#version 前缀、onBeforeCompile 注入后的
 * 最终形态）都会流经这里。静态源码里压缩的注入逻辑，在运行时是完整明文。
 *
 * 输出（可再生证据）：
 *   evidence/shaders/shader-<i>-<frag|vert>.glsl   每段完整源码
 *   evidence/shaders/manifest.json                 索引与统计
 *
 * CLI: node harness/capture-shaders.mjs --assert | --json
 *   --wait-ms <n>   bench 启动后等待（默认 9000，让材质全部编译）
 */

import { launchFixture } from "../boot.mjs";
import { mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../evidence/shaders");

const INIT_HOOK = `
window.__h2bShaders = [];
(function () {
  const P2 = WebGL2RenderingContext.prototype;
  const P1 = WebGLRenderingContext.prototype;
  for (const P of [P1, P2]) {
    if (!P) continue;
    const ss = P.shaderSource;
    if (!ss) continue;
    P.shaderSource = function (shader, src) {
      try {
        if (shader && !shader.__h2bSeen) {
          shader.__h2bSeen = 1;
          const text = String(src);
          window.__h2bShaders.push({
            len: text.length,
            version: (text.match(/^#version\\s+\\S+/) || [null])[0],
            isFragment: /\\bgl_FragColor\\b|\\bout\\s+highp\\s+vec4|\\blayout\\(location\\s*=\\s*0\\)\\s+out/.test(text),
            saltline: /SALTLINE_|uSunDir|uFlash|vBlink|aPar\\b/.test(text),
            head: text.slice(0, 120),
            text,
          });
        }
      } catch (e) { /* hook 不允许影响游戏 */ }
      return ss.apply(this, arguments);
    };
  }
})();
`;

export async function capture({ waitMs = 9000, viewport = [640, 360], seed = 4207 } = {}) {
  const { FIXTURE_URL } = await import("../boot.mjs");
  const session = await launchFixture({
    viewport,
    waitMs,
    url: `${FIXTURE_URL}?bench&seed=${seed}`,
    initScript: INIT_HOOK,
  });
  try {
    const shaders = await session.page.evaluate(() => {
      const list = (window.__h2bShaders || []).map((s) => ({ len: s.len, version: s.version, isFragment: s.isFragment, saltline: s.saltline, head: s.head, text: s.text }));
      const errors = (window.__errors || []).map((e) => String(e).slice(0, 300));
      return { list, errors };
    });
    return shaders;
  } finally {
    await session.close();
  }
}

export async function main(argv) {
  const assert = argv.includes("--assert");
  const json = argv.includes("--json");
  const waitMs = (() => {
    const i = argv.indexOf("--wait-ms");
    return i >= 0 ? Number(argv[i + 1]) : 9000;
  })();
  const { list, errors } = await capture({ waitMs });
  mkdirSync(OUT_DIR, { recursive: true });
  const manifest = {
    fixture: "sources/jimao-3a-game/index.html?bench",
    total: list.length,
    fragments: list.filter((s) => s.isFragment).length,
    vertices: list.filter((s) => !s.isFragment).length,
    saltlineCustom: list.filter((s) => s.saltline).length,
    totalGlslBytes: list.reduce((n, s) => n + s.len, 0),
    errorCount: errors.length,
    entries: list.map((s, i) => ({
      file: `shader-${String(i).padStart(3, "0")}-${s.isFragment ? "frag" : "vert"}.glsl`,
      len: s.len,
      version: s.version,
      isFragment: s.isFragment,
      saltline: s.saltline,
      head: s.head,
    })),
    errors,
    capturedAt: new Date().toISOString(),
  };
  list.forEach((s, i) => {
    writeFileSync(path.join(OUT_DIR, manifest.entries[i].file), s.text);
  });
  writeFileSync(path.join(OUT_DIR, "manifest.json"), `${JSON.stringify({ ...manifest, entries: manifest.entries.map(({ head, ...rest }) => ({ ...rest, headPreview: head.slice(0, 60) })) }, null, 1)}\n`);
  const ok = manifest.total >= 60 && manifest.saltlineCustom >= 8 && manifest.errorCount === 0;
  if (json) {
    console.log(JSON.stringify({ ...manifest, entries: undefined }, null, 1));
  } else {
    console.log(
      `captured: ${manifest.total} shaders (${manifest.fragments} frag / ${manifest.vertices} vert), saltline-custom=${manifest.saltlineCustom}, glsl=${manifest.totalGlslBytes}B, errors=${manifest.errorCount}`
    );
    for (const e of manifest.entries.filter((x) => x.saltline).slice(0, 12)) {
      console.log(`  [saltline] ${e.file} len=${e.len}`);
    }
  }
  if (assert && !ok) {
    console.error("capture-shaders.mjs --assert FAILED");
    return 1;
  }
  return 0;
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error("capture-shaders.mjs crashed:", err && err.message ? err.message : err);
      process.exit(1);
    }
  );
}
