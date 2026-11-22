/**
 * harness/extract-assets.mjs — 视觉资产提取器（补蒸馏缺失的「资产层」）。
 *
 * 原理：capture-shaders.mjs 落盘的最终 GLSL 是浏览器实际编译的明文，其中
 * 上游招牌系统的实现是完整可搬运的。本脚本把关键系统移植为
 * skill/how2build3d/assets/*.glsl，每个资产带出处头（捕获文件 + 原始行号 +
 * 系统标记），供 scenes/ 直接引用。
 *
 * 资产清单：
 *   post-chain.glsl     ← shader-035-frag 全文   （AgX 拟合/暗角/色差/抖动/锐化，原 L4349-L4750）
 *   post-aa.glsl        ← shader-037-frag 全文   （Kawase AA + 亮度加权颗粒，原 L4728-L4740）
 *   shafts.glsl         ← shader-021-frag 全文   （体积光柱积分 pass，原 L4425-L4450）
 *   sky-deck.glsl       ← shader-003-frag 全文   （云甲板天空：ridged/烧穿/大气透视，原 L4207-L4295）
 *   pcss-shadow.glsl    ← shader-011 切片 L1242-L1343（PCSS：Vogel 盘 + blocker search，原 L4296-L4348）
 *   ssr-wet.glsl        ← shader-111 切片 L206-L235 + L1900-L1991（湿地 SSR：uRefl LOD 混合 + 水洼权重，原 L5661/L5728）
 *
 * CLI: node harness/extract-assets.mjs --assert
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CAP = path.join(ROOT, "evidence/shaders");
const OUT = path.join(ROOT, "skill/how2build3d/assets");

const SLICE = [
  {
    out: "post-chain.glsl",
    src: "shader-035-frag.glsl",
    range: null, // 全文
    startMarker: "varying vec2 vUv",
    system: "SALTLINE_POST · 后处理主 pass",
    origin: "sources/jimao-3a-game/index.html L4349-L4750（BAZAAR 无关，Saltline 原 L4612-L4625 uniform 组）",
    tokens: ["slAgx", "uVignette", "uCA"],
  },
  {
    out: "post-aa.glsl",
    src: "shader-037-frag.glsl",
    range: null,
    startMarker: "varying vec2 vUv",
    system: "Kawase AA + 亮度加权颗粒 + 抖动",
    origin: "sources/jimao-3a-game/index.html L4728-L4740",
    tokens: ["uGrain", "hash12"],
  },
  {
    out: "shafts.glsl",
    src: "shader-021-frag.glsl",
    range: null,
    startMarker: "// SALTLINE_POST vol",
    system: "体积光柱积分 pass（tDepthHalf + tShadow，volSteps 步进）",
    origin: "sources/jimao-3a-game/index.html L4425-L4450（art direction 注释）",
    tokens: ["uSunDir", "tDepthHalf"],
  },
  {
    out: "sky-deck.glsl",
    src: "shader-003-frag.glsl",
    range: null,
    startMarker: "// SALTLINE_SKY",
    system: "SALTLINE_SKY 云甲板天空（ridged 云底/太阳烧穿/大气透视）",
    origin: "sources/jimao-3a-game/index.html L4207-L4295",
    tokens: ["fbm", "uSunDir"],
  },
  {
    out: "pcss-shadow.glsl",
    src: "shader-011-frag.glsl",
    range: [1242, 1343],
    system: "PCSS 软阴影（slIGN + slVogel + blocker search + receiver-plane bias）",
    origin: "sources/jimao-3a-game/index.html L4296-L4348",
    tokens: ["slVogel", "getShadow", "SL_FRUSTUM"],
  },
  {
    out: "ssr-wet.glsl",
    src: "shader-111-frag.glsl",
    range: [[206, 235], [1900, 1991]],
    system: "湿地屏幕空间反射（uRefl + 水洼/湿沥青 LOD 混合 + gBicubic）",
    origin: "sources/jimao-3a-game/index.html L5661（saltline-apron-3）/ L5728（saltline-sea-1）",
    tokens: ["uRefl", "gPuddle", "gBicubic"],
  },
];

const BUILTIN_DEFINES = new Set(["varying", "attribute", "texture2D", "textureCube", "texture2DProj",
  "texture2DLodEXT", "textureCubeLodEXT", "texture2DProjLodEXT", "gl_FragColor", "gl_FragDepthEXT",
  "SHADER_NAME", "CUSTOM_PROGRAM", "VOL_STEPS"]);

function sliceFile(srcName, range, startMarker) {
  const lines = readFileSync(path.join(CAP, srcName), "utf8").split("\n");
  let rescuedDefines = [];
  if (startMarker) {
    const idx = lines.findIndex((l) => l.includes(startMarker));
    if (idx < 0) throw new Error(`startMarker ${startMarker} not found in ${srcName}`);
    // 抢救头部里"上游材质自己的 #define"（非 three 内建的），这是调参常量
    for (const l of lines.slice(0, idx)) {
      const m = l.match(/^\s*#define\s+([A-Za-z_][A-Za-z0-9_]*)\s+(.+?)\s*$/);
      if (m && !BUILTIN_DEFINES.has(m[1]) && !m[1].startsWith("SALTLINE")) {
        rescuedDefines.push(`#define ${m[1]} ${m[2]}`);
      }
    }
    lines.splice(0, idx);
  }
  if (!range) return rescuedDefines.length ? rescuedDefines.join("\n") + "\n" + lines.join("\n") : lines.join("\n");
  if (typeof range[0] === "number") return lines.slice(range[0] - 1, range[1]).join("\n");
  return range.map(([a, b]) => lines.slice(a - 1, b).join("\n")).join("\n\n// ---- (cont.) ----\n\n");
}

export function extract() {
  mkdirSync(OUT, { recursive: true });
  const results = [];
  for (const spec of SLICE) {
    const body = sliceFile(spec.src, spec.range, spec.startMarker);
    const header = `// ============================================================
// how2build3d asset: ${spec.out}
// system : ${spec.system}
// source : capture ${spec.src}${spec.range ? ` lines ${JSON.stringify(spec.range)}` : spec.startMarker ? ` from "${spec.startMarker}"` : " (full file)"}
// origin : ${spec.origin}
// note   : 原样移植（保参数与数学），uniform 命名保持上游；接入时按场景重绑定。
// ============================================================
`;
    writeFileSync(path.join(OUT, spec.out), header + body + "\n");
    const text = header + body;
    const missing = spec.tokens.filter((tk) => !text.includes(tk));
    results.push({ out: spec.out, bytes: Buffer.byteLength(text, "utf8"), lines: text.split("\n").length, missing });
  }
  return results;
}

export async function main(argv) {
  const assert = argv.includes("--assert");
  const results = extract();
  for (const r of results) {
    const status = r.missing.length ? "FAIL" : "OK";
    console.log(`${status}\t${r.out}\t${r.bytes}B\t${r.lines} lines${r.missing.length ? `\tmissing: ${r.missing.join(",")}` : ""}`);
  }
  if (assert) {
    const failed = results.filter((r) => r.missing.length || r.bytes < 800);
    if (failed.length || results.length < 5) {
      console.error(`extract-assets.mjs --assert FAILED (${failed.length} bad, ${results.length} assets)`);
      return 1;
    }
    return 0;
  }
  return 0;
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error("extract-assets.mjs crashed:", err && err.message ? err.message : err);
      process.exit(1);
    }
  );
}
