/**
 * harness/diff-chunks.mjs — 与上游 three@0.180.0 ShaderChunk 逐块 diff。
 *
 * 目的：把"作者到底改了什么"从猜想变成可测量的数字。
 * 方法：
 *   1. 取 harness/node_modules/three/src/renderers/shaders/ShaderChunk/*.glsl.js
 *      的模板字符串作为上游基线（与夹具内嵌的 r180 同版本）。
 *   2. 取 capture-shaders.mjs 落盘的运行时最终 GLSL。
 *   3. 归一化（去注释、压空白）后做区间覆盖匹配：被上游块完整覆盖的部分是
 *      "库存"，覆盖不到的区间就是作者手写的 GLSL。
 * 输出（可再生证据）：
 *   evidence/shaders/chunk-diff.json
 * CLI: node harness/diff-chunks.mjs --assert | --json
 */

import { readFileSync, readdirSync, writeFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHADERS_DIR = path.join(ROOT, "evidence/shaders");
const CHUNKS_DIR = path.join(ROOT, "harness/node_modules/three/src/renderers/shaders/ShaderChunk");
const OUT = path.join(SHADERS_DIR, "chunk-diff.json");

function normalize(glsl) {
  return glsl
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loadStockChunks() {
  const chunks = [];
  for (const name of readdirSync(CHUNKS_DIR)) {
    if (!name.endsWith(".glsl.js")) continue;
    const raw = readFileSync(path.join(CHUNKS_DIR, name), "utf8");
    // npm 包格式：export default /* glsl */`...`;
    const m = raw.match(/export default \/\* glsl \*\/`([\s\S]*?)`;?\s*$/);
    if (!m) continue;
    chunks.push({ name: name.replace(/\.glsl\.js$/, ""), raw: m[1], norm: normalize(m[1]) });
  }
  return chunks;
}

function loadRuntimeShaders() {
  const files = readdirSync(SHADERS_DIR).filter((f) => f.endsWith(".glsl")).sort();
  return files.map((f) => ({ file: f, raw: readFileSync(path.join(SHADERS_DIR, f), "utf8") }));
}

/** 返回 runtime 归一化文本中被 chunks 覆盖的区间与剩余作者区间 */
function coverage(runtimeNorm, chunks) {
  const covered = [];
  const usedChunks = new Set();
  for (const c of chunks) {
    if (c.norm.length < 120) continue; // 过短的块到处命中，无判别力
    let from = 0;
    for (;;) {
      const idx = runtimeNorm.indexOf(c.norm, from);
      if (idx < 0) break;
      covered.push([idx, idx + c.norm.length, c.name]);
      usedChunks.add(c.name);
      from = idx + c.norm.length;
    }
  }
  covered.sort((a, b) => a[0] - b[0]);
  // 合并重叠区间后求补集
  const merged = [];
  for (const [s, e] of covered) {
    if (merged.length && s <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
    } else merged.push([s, e]);
  }
  const authorSegments = [];
  let cursor = 0;
  for (const [s, e] of merged) {
    if (s > cursor) authorSegments.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < runtimeNorm.length) authorSegments.push([cursor, runtimeNorm.length]);
  return { usedChunks: [...usedChunks], authorSegments };
}

export async function main(argv) {
  const assert = argv.includes("--assert");
  const json = argv.includes("--json");
  const chunks = loadStockChunks();
  const shaders = loadRuntimeShaders();
  const perShader = [];
  const chunkUsage = new Map();
  let totalAuthorChars = 0;
  let totalChars = 0;
  for (const s of shaders) {
    const norm = normalize(s.raw);
    const { usedChunks, authorSegments } = coverage(norm, chunks);
    const authorChars = authorSegments.reduce((n, [a, b]) => n + (b - a), 0);
    totalAuthorChars += authorChars;
    totalChars += norm.length;
    for (const c of usedChunks) chunkUsage.set(c, (chunkUsage.get(c) || 0) + 1);
    perShader.push({
      file: s.file,
      normalizedChars: norm.length,
      authorChars,
      authorPct: norm.length ? Number(((authorChars / norm.length) * 100).toFixed(1)) : 0,
      stockChunksUsed: usedChunks.length,
      usedChunks,
      authorSegmentCount: authorSegments.length,
      authorPreview: authorSegments
        .filter(([a, b]) => b - a > 120)
        .slice(0, 3)
        .map(([a, b]) => norm.slice(a, Math.min(b, a + 160))),
    });
  }
  const chunkTable = [...chunkUsage.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, usedInShaders: count }));
  const report = {
    baseline: "three@0.180.0 npm 包 src/renderers/shaders/ShaderChunk",
    stockChunks: chunks.length,
    runtimeShaders: shaders.length,
    normalizedTotalChars: totalChars,
    authorChars: totalAuthorChars,
    authorPct: Number(((totalAuthorChars / totalChars) * 100).toFixed(1)),
    chunkTable,
    topChunks: chunkTable.slice(0, 24),
    perShader: perShader.filter((p) => p.normalizedChars > 2000),
    diffedAt: new Date().toISOString(),
  };
  writeFileSync(OUT, `${JSON.stringify(report, null, 1)}\n`);
  if (json) {
    console.log(JSON.stringify({ ...report, perShader: report.perShader.slice(0, 8) }, null, 1));
  } else {
    console.log(
      `diff: ${shaders.length} runtime shaders vs ${chunks.length} stock chunks (three@0.180.0)`
    );
    console.log(`author-authored GLSL share: ${report.authorPct}% (${totalAuthorChars}/${totalChars} normalized chars)`);
    console.log("top stock chunks by usage:");
    for (const c of report.topChunks.slice(0, 10)) console.log(`  ${c.name}: ${c.usedInShaders} shaders`);
    console.log("most author-authored big shaders:");
    for (const p of [...report.perShader].sort((a, b) => b.authorChars - a.authorChars).slice(0, 6)) {
      console.log(`  ${p.file}: author ${p.authorPct}% of ${p.normalizedChars} chars, ${p.stockChunksUsed} stock chunks`);
    }
  }
  if (assert) {
    const ok = chunks.length >= 90 && shaders.length >= 60 && report.authorPct > 5 && report.chunkTable.length >= 40;
    if (!ok) {
      console.error("diff-chunks.mjs --assert FAILED");
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
      console.error("diff-chunks.mjs crashed:", err && err.message ? err.message : err);
      process.exit(1);
    }
  );
}
