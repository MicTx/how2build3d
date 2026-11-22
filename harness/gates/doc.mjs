/**
 * harness/check-doc.mjs — 交付文档门禁。
 *
 * 依据 harness/docs.manifest.json 校验交付文档；开发仓库同时加载 .maintainer/docs.manifest.json：
 *   - 存在且体量 ≥ minBytes（UTF-8 字节）
 *   - 必备小节：requiredHeadings 中的每个字符串须出现在某个标题行（#..######）中
 *   - 引用密度：`[src:Lx-Ly]` 数量 ≥ minCitations（合法性由 citations.mjs 负责）
 *   - cardRule（可选）：`### T-xx` 卡片数量 ≥ minCards，且每卡块内 ≥1 条引用
 *
 * CLI:
 *   node harness/check-doc.mjs <file.md>        校验单个文件
 *   node harness/check-doc.mjs --group <name>   校验清单中的组
 *   node harness/check-doc.mjs --all            校验清单全部文件
 *   node harness/check-doc.mjs --all-tracked    校验 git 跟踪的全部 .md（排除 .spec/ 与 sources/）
 *                                               无 git 元数据时回退文件系统遍历（排除忽略目录）
 *                                               未登记的 tracked .md 默认判红；--allow-unknown 放行并打印清单
 *   node harness/check-doc.mjs --self-test      内置自检（合成样例，不依赖交付文档）
 */

import {
  readFileSync,
  existsSync,
  realpathSync,
  readdirSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MANIFEST_PATH = path.join(ROOT, "harness/docs.manifest.json");
const INTERNAL_MANIFEST_PATH = path.join(ROOT, ".maintainer/docs.manifest.json");
const CITATION_RE = /\[src:(pretty:)?L(\d+)(?:-L(\d+))?\]/g;
const TRACKED_EXCLUDES = [".spec/", "sources/"];
/** fallback 枚举时整棵跳过的非交付目录（任意层级）。 */
const FALLBACK_SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "build",
  "evidence",
  "dist",
  "coverage",
  ".zcode",
  ".spec",
  "sources",
]);

function loadManifest() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  if (existsSync(INTERNAL_MANIFEST_PATH)) {
    const { files } = JSON.parse(readFileSync(INTERNAL_MANIFEST_PATH, "utf8"));
    manifest.files = { ...files, ...manifest.files };
  }
  return manifest;
}

/** 过滤 tracked .md：排除 .spec/ 与 sources/（二者不是交付文档面），排序去重。 */
export function filterTracked(files, excludes = TRACKED_EXCLUDES) {
  const selected = files
    .map((line) => String(line).trim())
    .filter(Boolean)
    .map((file) => file.split(path.sep).join("/").replace(/^\.\//, ""))
    .filter((file) => !excludes.some((prefix) => file.startsWith(prefix)));
  return [...new Set(selected)].sort();
}

export function unregisteredFiles(files, manifest) {
  return files.filter((file) => !manifest.files[file]);
}

/**
 * 无 git 元数据时枚举交付 .md。整棵跳过 FALLBACK_SKIP_DIRS 中的目录（任意层级），
 * 结果仍交给 filterTracked 处理，以保留 --all-tracked 的既有过滤语义。
 */
export function enumerateMarkdownFiles(root = ROOT) {
  const files = [];
  function walk(dir, relDir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && FALLBACK_SKIP_DIRS.has(entry.name)) continue;
      const relative = relDir ? `${relDir}/${entry.name}` : entry.name;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute, relative);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(relative);
    }
  }
  walk(root, "");
  return filterTracked(files);
}

/** git 列表可用则用它；任何失败都回退文件系统遍历，并提示 stderr。 */
export function trackedMarkdown() {
  try {
    const out = execFileSync("git", ["ls-files", "--", "*.md"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return filterTracked(out.split("\n"));
  } catch (error) {
    const reason = String((error && error.stderr) || "").trim().split("\n").pop()
      || (error && error.message ? error.message : String(error));
    const skipped = [...FALLBACK_SKIP_DIRS].map((dir) => `${dir}/`).join(", ");
    console.error(`check-doc: git ls-files 失败（${reason}）；回退文件系统遍历（排除 ${skipped} 等目录）`);
    return enumerateMarkdownFiles(ROOT);
  }
}

function headingLines(text) {
  return text.split("\n").filter((line) => /^\s*#{1,6}\s+/.test(line));
}

function countCitations(text) {
  return [...text.matchAll(CITATION_RE)].length;
}

function splitCards(text, prefix) {
  const linesArr = text.split("\n");
  const cards = [];
  let current = null;
  for (const line of linesArr) {
    if (line.startsWith(prefix)) {
      if (current) cards.push(current.join("\n"));
      current = [line];
    } else if (current && /^###\s+/.test(line)) {
      cards.push(current.join("\n"));
      current = null;
    } else if (current) {
      current.push(line);
    }
  }
  if (current) cards.push(current.join("\n"));
  return cards;
}

export function validateDoc(text, rule, label) {
  const problems = [];
  if (typeof text !== "string" || !text.trim()) {
    return [{ rule: "EXISTS", detail: `${label}: 文档缺失或为空` }];
  }
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes < (rule.minBytes ?? 0)) {
    problems.push({ rule: "SIZE", detail: `${label}: ${bytes}B < minBytes ${rule.minBytes}` });
  }
  const headings = headingLines(text).join("\n");
  for (const h of rule.requiredHeadings || []) {
    if (!headings.includes(h)) {
      problems.push({ rule: "HEADING", detail: `${label}: 缺必备小节「${h}」` });
    }
  }
  const cites = countCitations(text);
  if (cites < (rule.minCitations ?? 0)) {
    problems.push({ rule: "CITES", detail: `${label}: ${cites} 条引用 < minCitations ${rule.minCitations}` });
  }
  if (rule.cardRule) {
    const cards = splitCards(text, rule.cardRule.prefix);
    if (cards.length < rule.cardRule.minCards) {
      problems.push({ rule: "CARDS", detail: `${label}: ${cards.length} 张卡 < minCards ${rule.cardRule.minCards}` });
    }
    if (rule.cardRule.citationPerCard) {
      const missing = cards
        .map((card, i) => ({ card, i }))
        .filter(({ card }) => countCitations(card) === 0)
        .map(({ i }) => i + 1);
      if (missing.length) {
        problems.push({ rule: "CARD-CITES", detail: `${label}: 卡片缺引用 #${missing.join(",#")}` });
      }
    }
  }
  return problems;
}

function checkPath(file, manifest) {
  const rule = manifest.files[file] || manifest.defaults;
  const inManifest = Boolean(manifest.files[file]);
  const abs = path.isAbsolute(file) ? file : path.join(ROOT, file);
  if (!existsSync(abs)) {
    return { file, inManifest, problems: [{ rule: "EXISTS", detail: `${file}: 文件不存在` }] };
  }
  const text = readFileSync(abs, "utf8");
  return { file, inManifest, problems: validateDoc(text, rule, file) };
}

function fallbackEnumerationSelfTest() {
  const problems = [];
  const fixture = mkdtempSync(path.join(tmpdir(), "h2b-doc-fallback-"));
  try {
    const good = [
      "README.md",
      "AGENTS.md",
      ".maintainer/receipt.md",
      "references/00-workflow.md",
      "references/nested/01-note.md",
      "deep/node_modules-shadow/keep.md",
    ];
    const bad = [
      ".git/objects/info.md",
      "node_modules/pkg/README.md",
      "references/nested/node_modules/pkg/README.md",
      "build/scene/index.md",
      "evidence/frames/notes.md",
      "dist/bundle.md",
      "coverage/report.md",
      ".zcode/session.md",
      ".spec/specs/a.md",
      "sources/vendor/b.md",
      "references/not-doc.txt",
    ];
    for (const rel of [...good, ...bad]) {
      mkdirSync(path.join(fixture, path.dirname(rel)), { recursive: true });
      writeFileSync(path.join(fixture, rel), `# ${rel}\n`);
    }
    const actual = enumerateMarkdownFiles(fixture);
    const expected = [...good].sort();
    if (actual.join(",") !== expected.join(",")) {
      problems.push({ rule: "FALLBACK-ENUM", detail: `fallback 枚举异常：${actual.join(",")}` });
    }
    for (const rel of bad) {
      if (actual.includes(rel)) problems.push({ rule: "FALLBACK-NEGATIVE", detail: `排除目录/非 .md 被枚举：${rel}` });
    }
    if (filterTracked([...good, ...good, "", "  "]).length !== good.length) {
      problems.push({ rule: "FALLBACK-DEDUP", detail: "fallback 结果未排序去重" });
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
  return problems;
}

function selfTest() {
  const problems = [];
  const good = `# 样例\n\n## 体积预算\n\n正文足够长。${"内容".repeat(400)}\n\n引用 [src:L4207-L4210]。\n`;
  const bad = "# 空\n";
  const rule = { minBytes: 100, minCitations: 1, requiredHeadings: ["体积预算"] };
  problems.push(...validateDoc(good, rule, "self/good").map((p) => ({ expect: "PASS", ...p })));
  const badResults = validateDoc(bad, rule, "self/bad");
  if (!badResults.some((p) => p.rule === "SIZE")) problems.push({ expect: "FAIL-SIZE", detail: "self/bad 未命中 SIZE" });
  if (!badResults.some((p) => p.rule === "HEADING")) problems.push({ expect: "FAIL-HEADING", detail: "self/bad 未命中 HEADING" });
  if (!badResults.some((p) => p.rule === "CITES")) problems.push({ expect: "FAIL-CITES", detail: "self/bad 未命中 CITES" });
  const cardText = `### T-01 卡一\n\n引用 [src:L4207-L4208]。\n\n### T-02 卡二\n\n无引用正文。\n`;
  const cardResults = validateDoc(cardText, { cardRule: { prefix: "### T-", minCards: 2, citationPerCard: true } }, "self/cards");
  if (!cardResults.some((p) => p.rule === "CARD-CITES")) {
    problems.push({ expect: "FAIL-CARD-CITES", detail: "卡片缺引用未命中" });
  }
  const manifest = loadManifest();
  if (!manifest.files || !manifest.groups) problems.push({ rule: "MANIFEST", detail: "manifest 结构缺失 files/groups" });
  // --all-tracked 的过滤与未登记判定（不依赖 git，纯样例）
  const filtered = filterTracked([".spec/specs/a.md", "sources/vendor/b.md", "README.md", "references/00-workflow.md"]);
  if (filtered.join(",") !== "README.md,references/00-workflow.md") {
    problems.push({ rule: "TRACKED-FILTER", detail: `filterTracked 结果异常：${filtered.join(",")}` });
  }
  const unknown = unregisteredFiles(["README.md", "not-registered.md"], manifest);
  if (!unknown.includes("not-registered.md") || unknown.includes("README.md")) {
    problems.push({ rule: "TRACKED-UNREGISTERED", detail: `未登记判定异常：${unknown.join(",")}` });
  }
  problems.push(...fallbackEnumerationSelfTest());
  if (problems.length) {
    console.log("SELF-TEST FAILED:");
    for (const p of problems) console.log(`  - ${JSON.stringify(p)}`);
    return 1;
  }
  console.log(`SELF-TEST OK: manifest files=${Object.keys(manifest.files).length} groups=${Object.keys(manifest.groups).length}`);
  return 0;
}

export async function main(argv) {
  const args = argv.slice();
  if (args.includes("--self-test")) return selfTest();
  const manifest = loadManifest();
  const allowUnknown = args.includes("--allow-unknown");
  const trackedMode = args.includes("--all-tracked");
  let files = [];
  let skippedUnknown = 0;
  const groupIdx = args.indexOf("--group");
  if (groupIdx >= 0) {
    const name = args[groupIdx + 1];
    if (!name || !manifest.groups[name]) {
      console.error(`unknown group: ${name}; known: ${Object.keys(manifest.groups).join(", ")}`);
      return 2;
    }
    files = manifest.groups[name];
  } else if (trackedMode) {
    files = trackedMarkdown();
    const unknown = unregisteredFiles(files, manifest);
    if (unknown.length) {
      console.log(`check-doc: ${unknown.length} 个 tracked .md 未登记（--all-tracked）：`);
      for (const file of unknown) console.log(`  UNREGISTERED\t${file}`);
      if (!allowUnknown) {
        console.error("check-doc: 未登记文件默认判红；确认无遗漏后用 --allow-unknown 放行");
        return 1;
      }
      console.log(`check-doc: --allow-unknown 放行 ${unknown.length} 个未登记文件（跳过 manifest 规则校验）`);
    }
  } else if (args.includes("--all")) {
    files = Object.keys(manifest.files);
  } else {
    files = args.filter((a) => !a.startsWith("--"));
    if (!files.length) {
      console.error("usage: node harness/check-doc.mjs <file.md> | --group <name> | --all | --all-tracked [--allow-unknown] | --self-test");
      return 2;
    }
    for (const f of files) {
      if (!manifest.files[f] && !allowUnknown) {
        console.error(`check-doc: ${f} 不在 docs.manifest.json 中（门禁要求先登记再交付）`);
        return 1;
      }
    }
  }
  let failed = 0;
  for (const f of files) {
    if (trackedMode && !manifest.files[f] && allowUnknown) {
      skippedUnknown += 1;
      console.log(`SKIP\t${f}  (unregistered, --allow-unknown)`);
      continue;
    }
    const { problems, inManifest } = checkPath(f, manifest);
    const status = problems.length ? "FAIL" : "OK";
    if (problems.length) failed += 1;
    console.log(`${status}\t${f}${inManifest ? "" : "  (defaults, not in manifest)"}`);
    for (const p of problems) console.log(`      ${p.rule}: ${p.detail}`);
  }
  console.log(`\ncheck-doc: ${files.length} files, ${failed} failed${skippedUnknown ? `, ${skippedUnknown} skipped (unregistered)` : ""}`);
  return failed ? 1 : 0;
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error("check-doc.mjs crashed:", err && err.message ? err.message : err);
      process.exit(1);
    }
  );
}
