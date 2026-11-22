/**
 * harness/gates/creation.mjs — 创物篇覆盖门禁。
 *
 * 回答一个问题：`.distill/creation/` 创物层是否仍然完整、可达、已注册？
 *   - 族对应：harness/element-manifest.json 的 18 族 id 逐序映射到
 *     `.distill/creation/<NN>-<id>.md`（NN = 清单序号，零填充两位），
 *     缺一个族文件即红——映射常量即合同，不放进配置。
 *   - 四段结构：每族文件必须含「构建法则 / 完整链路 / 思维链 / 迁移法则」
 *     四个二级标题（与 doc 门禁的有意冗余，让本门禁单跑也有完整结论）。
 *   - 索引完备：00-index.md 必须列全 18 族文件与 19-legacy-systems.md。
 *   - 导航可达：README.md → `.distill/creation/00-index.md`；
 *     `.distill/00-index.md` → `./creation/00-index.md`。
 *   - 注册一致：harness/docs.manifest.json 必须登记全部 20 个路径。
 *
 * 本门禁不复制 doc/citations 的职责（体量、引用密度、行号合法性）——
 * 那两处是权威；这里只判跨文件结构对应。
 *
 * CLI:
 *   node harness/gates/creation.mjs                # 检查仓库，报告落盘 evidence/creation/report.json
 *   node harness/gates/creation.mjs --json         # 打印 JSON 报告
 *   node harness/gates/creation.mjs --self-test    # 临时沙盒正负样例，不触碰仓库文件
 *
 * 退出码：全部合法 → 0；任一结构问题 → 1
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// 合同常量：族序 ↔ 文件名映射。element-manifest 顺序即创物篇编号顺序；
// 重排族序属 plan-amend 级变更，改这里必须同步改 spec 包。
const FAMILY_HEADINGS = ["## 构建法则", "## 完整链路", "## 思维链", "## 迁移法则"];
const LEGACY_FILE = "19-legacy-systems.md";
const INDEX_FILE = "00-index.md";
const FAMILY_FILES = 18;

function familyFileName(id, index) {
  return `${String(index + 1).padStart(2, "0")}-${id}.md`;
}

/** 对给定根目录跑全部结构检查，返回报告对象（纯函数，self-test 复用）。 */
export function audit(root) {
  const creationDir = path.join(root, ".distill/creation");
  const problems = [];

  // 1. 族 ↔ 文件映射 + 四段结构
  let familyIds = [];
  const manifestPath = path.join(root, "harness/element-manifest.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    familyIds = (manifest.elements ?? []).map((entry) => entry.id);
  } else {
    problems.push(`缺失 harness/element-manifest.json`);
  }
  const families = familyIds.map((id, index) => {
    const file = familyFileName(id, index);
    const full = path.join(creationDir, file);
    if (!existsSync(full)) {
      problems.push(`族 ${id} 缺文件 .distill/creation/${file}`);
      return { id, file, exists: false, headings: [] };
    }
    const text = readFileSync(full, "utf8");
    const headings = FAMILY_HEADINGS.filter((heading) => text.includes(heading));
    if (headings.length < FAMILY_HEADINGS.length) {
      const missing = FAMILY_HEADINGS.filter((heading) => !text.includes(heading));
      problems.push(`.distill/creation/${file} 缺标题：${missing.join("、")}`);
    }
    return { id, file, exists: true, headings };
  });

  // 2. 19-legacy-systems.md
  const legacyOk = existsSync(path.join(creationDir, LEGACY_FILE));
  if (!legacyOk) problems.push(`缺 .distill/creation/${LEGACY_FILE}`);

  // 3. 00-index 列全
  const indexPath = path.join(creationDir, INDEX_FILE);
  let indexOk = false;
  if (!existsSync(indexPath)) {
    problems.push(`缺 .distill/creation/${INDEX_FILE}`);
  } else {
    const indexText = readFileSync(indexPath, "utf8");
    const expected = [...families.map((family) => family.file), LEGACY_FILE];
    const missing = expected.filter((file) => !indexText.includes(file));
    indexOk = missing.length === 0;
    if (!indexOk) problems.push(`${INDEX_FILE} 未列全：${missing.join("、")}`);
  }

  // 4. 双导航
  const nav = {};
  const readmePath = path.join(root, "README.md");
  nav.readme = existsSync(readmePath) && readFileSync(readmePath, "utf8").includes("](.distill/creation/00-index.md)");
  const distillIndexPath = path.join(root, ".distill/00-index.md");
  nav.distillIndex = existsSync(distillIndexPath) && readFileSync(distillIndexPath, "utf8").includes("](./creation/00-index.md)");
  if (!nav.readme) problems.push("README.md 缺创物篇导航链接 ](.distill/creation/00-index.md)");
  if (!nav.distillIndex) problems.push(".distill/00-index.md 缺创物篇导航链接 ](./creation/00-index.md)");

  // 5. docs.manifest 注册
  const docsManifestPath = path.join(root, "harness/docs.manifest.json");
  const registered = { total: 0, missing: [] };
  if (!existsSync(docsManifestPath)) {
    problems.push("缺失 harness/docs.manifest.json");
  } else {
    const docs = JSON.parse(readFileSync(docsManifestPath, "utf8"));
    const keys = Object.keys(docs.files ?? {});
    const expected = [`.distill/creation/${INDEX_FILE}`, ...families.map((family) => `.distill/creation/${family.file}`), `.distill/creation/${LEGACY_FILE}`];
    registered.total = expected.length;
    registered.missing = expected.filter((file) => !keys.includes(file));
    if (registered.missing.length) problems.push(`docs.manifest.json 未登记：${registered.missing.join("、")}`);
  }

  const ok = problems.length === 0;
  return {
    generatedAt: new Date().toISOString(),
    ok,
    root,
    families,
    legacy: { file: LEGACY_FILE, exists: legacyOk },
    index: { file: INDEX_FILE, ok: indexOk },
    nav,
    docsManifest: registered,
    problems,
  };
}

function selfTest() {
  const results = [];
  const sandbox = mkdtempSync(path.join(os.tmpdir(), "creation-gate-"));
  try {
    // 样例仓库骨架：2 族 + legacy + index + 双导航 + 注册
    const put = (rel, text) => {
      const full = path.join(sandbox, rel);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, text);
    };
    const fourHeadings = `${FAMILY_HEADINGS.join("\n\n")}\n`;
    put("harness/element-manifest.json", JSON.stringify({ elements: [{ id: "props" }, { id: "sky" }] }));
    put(".distill/creation/01-props.md", fourHeadings);
    put(".distill/creation/02-sky.md", fourHeadings);
    put(".distill/creation/00-index.md", "01-props.md 02-sky.md 19-legacy-systems.md\n");
    put(".distill/creation/19-legacy-systems.md", fourHeadings);
    put("README.md", "见 ](.distill/creation/00-index.md)。\n");
    put(".distill/00-index.md", "见 ](./creation/00-index.md)。\n");
    put(
      "harness/docs.manifest.json",
      JSON.stringify({ files: { ".distill/creation/00-index.md": {}, ".distill/creation/01-props.md": {}, ".distill/creation/02-sky.md": {}, ".distill/creation/19-legacy-systems.md": {} } })
    );

    const good = audit(sandbox);
    results.push({ name: "正样例全绿", pass: good.ok === true && good.problems.length === 0 });

    rmSync(path.join(sandbox, ".distill/creation/02-sky.md"));
    const missingFile = audit(sandbox);
    results.push({ name: "缺族文件判红", pass: missingFile.ok === false && missingFile.problems.some((p) => p.includes("02-sky.md")) });

    put(".distill/creation/02-sky.md", "## 构建法则\n");
    const missingHeading = audit(sandbox);
    results.push({ name: "缺四段标题判红", pass: missingHeading.ok === false && missingHeading.problems.some((p) => p.includes("缺标题")) });

    put(".distill/creation/02-sky.md", fourHeadings);
    rmSync(path.join(sandbox, "README.md"));
    const missingNav = audit(sandbox);
    results.push({ name: "缺导航判红", pass: missingNav.ok === false && missingNav.nav.readme === false });

    put("README.md", "见 ](.distill/creation/00-index.md)。\n");
    put("harness/docs.manifest.json", JSON.stringify({ files: {} }));
    const missingRegistration = audit(sandbox);
    results.push({ name: "缺注册判红", pass: missingRegistration.ok === false && missingRegistration.docsManifest.missing.length === 4 });

    const legacyOnly = audit(sandbox).problems.some((p) => p.includes("未登记"));
    results.push({ name: "注册缺失计数正确", pass: legacyOnly });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
  const failed = results.filter((entry) => !entry.pass);
  for (const entry of results) console.log(`${entry.pass ? "OK  " : "FAIL"} ${entry.name}`);
  console.log(failed.length === 0 ? `self-test: ${results.length} 样例全过` : `self-test: ${failed.length} 样例失败`);
  return failed.length === 0;
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  if (process.argv.includes("--self-test")) {
    process.exit(selfTest() ? 0 : 1);
  }
  const report = audit(ROOT);
  if (report.families.length !== FAMILY_FILES) {
    report.ok = false;
    report.problems.push(`element-manifest 族数 ${report.families.length} ≠ ${FAMILY_FILES}`);
  }
  const outDir = path.join(ROOT, "evidence/creation");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 1)}\n`);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 1));
  } else {
    for (const family of report.families) {
      console.log(`${family.exists && family.headings.length === FAMILY_HEADINGS.length ? "OK  " : "RED "} ${family.file} headings=${family.headings.length}/4`);
    }
    console.log(`${report.legacy.exists ? "OK  " : "RED "} ${report.legacy.file}`);
    console.log(`${report.index.ok ? "OK  " : "RED "} 00-index 列全`);
    console.log(`${report.nav.readme ? "OK  " : "RED "} README 导航  ${report.nav.distillIndex ? "OK  " : "RED "} distill 导航`);
    console.log(`${report.docsManifest.missing.length === 0 ? "OK  " : "RED "} docs.manifest 注册 ${report.docsManifest.total - report.docsManifest.missing.length}/${report.docsManifest.total}`);
    for (const problem of report.problems) console.log(`PROBLEM ${problem}`);
    console.log(`check-creation: ${report.ok ? "OK" : `${report.problems.length} problems`} (report → evidence/creation/report.json)`);
  }
  process.exit(report.ok ? 0 : 1);
}
