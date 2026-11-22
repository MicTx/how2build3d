/**
 * harness/prettify.mjs — 用 prettier 展开压缩后的 script 主体。
 *
 * 目的：压缩产物不可读（`function Ev(i,e,{lit:t,...})`），展开后便于按行切
 * 片分析 app 区域的结构与 GLSL 模板字符串位置。展开**不恢复原始命名**（见
 * spec.md 假设 A5），只恢复排版与缩进。
 *
 * 输出（可再生证据）：evidence/frames/app.pretty.js
 * CLI: node harness/prettify.mjs --assert
 */

import { readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { format } from "prettier";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURE = path.join(ROOT, "sources/jimao-3a-game/index.html");
const OUT = path.join(ROOT, "evidence/frames/app.pretty.js");

export function extractScript(raw) {
  const open = raw.indexOf("<script");
  const openEnd = raw.indexOf(">", open) + 1;
  const close = raw.lastIndexOf("</script>");
  return { js: raw.slice(openEnd, close), openLine: raw.slice(0, openEnd).split("\n").length };
}

export async function main(argv) {
  const assert = argv.includes("--assert");
  const raw = readFileSync(FIXTURE, "utf8");
  const { js } = extractScript(raw);
  const formatted = await format(js, {
    parser: "babel",
    printWidth: 120,
    tabWidth: 2,
    semi: true,
    singleQuote: false,
  });
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, formatted);
  const lines = formatted.split("\n").length;
  const bytes = Buffer.byteLength(formatted, "utf8");
  console.log(`prettify: ${bytes}B, ${lines} lines -> ${path.relative(ROOT, OUT)}`);
  if (assert) {
    if (lines < 15000 || bytes < 2_000_000) {
      console.error("prettify.mjs --assert FAILED: output unexpectedly small");
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
      console.error("prettify.mjs crashed:", err && err.message ? err.message : err);
      process.exit(1);
    }
  );
}
