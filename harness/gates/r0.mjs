/**
 * harness/gates/r0.mjs — R0 场景级门禁（参考研究与要素规划的可执行验收面）。
 *
 * R0 此前只是文档纪律：references/05-reference-research.md 规定「来源 ≥3、覆盖矩阵、
 * 16 类要素决策、GAP 参数去向、参考对拍 ≥3 delta」，但没有任何机器验收面。本门禁把
 * 这五条变成场景产物的结构校验，并导出 canonical 校验函数供 skill / complete / scaffold
 * 复用——方法论文档（references/05）与场景申报（<scene>/R0.md）用同一套判定，避免两处漂移。
 *
 * 场景产物定位（依次）：
 *   1) <scene>/R0.md                        （scene 模式：全量校验）
 *   2) <scene>/evidence/references/manifest.md（同一套 scene 校验；文件须承载同样的五节）
 *   两者都没有 → 判红。
 *
 * 场景校验（mode="scene"）：
 *   - 来源（多参考）：≥3 行，每行 ≥2 个非空字段（渠道 / 来源 / 观察）
 *   - 覆盖矩阵：每格只能是「已满足」或「待补」，空格与其它值判红；视角列至少覆盖
 *     俯视/平视/夜景/湿天 中的两类
 *   - 16 类要素：1..16 逐行，要素类名与 canonical 16 类一致（可带后缀说明），
 *     决策 / 是否入景 / 参数去向非空且不是占位文本；「明确不做」算决策
 *   - GAP 表：必须带「参数去向」列，每条 GAP 的参数去向非空且不是占位文本
 *   - 参考对拍：≥3 条 delta（delta 表行或 - D1 列表项）
 *
 * 方法论文档校验（mode="reference"，供 skill.mjs 复用）：
 *   同上五节的结构存在性：多参考表 ≥3 行、覆盖矩阵配额表、16 类表（决策内容列）、
 *   GAP 模板表（参数去向列）、参考对拍小节（delta 表或「≥3 条 delta」合同句）。
 *   不重复 doc.mjs 的七小节检查——输入不同（方法论文档 vs 具体场景申报）。
 *
 * CLI:
 *   node harness/gates/r0.mjs --self-test
 *   node harness/gates/r0.mjs --scene examples/quality
 *   node harness/gates/r0.mjs --scene <dir>          # 场景目录，R0.md 或 evidence/references/manifest.md
 */

import { existsSync, readFileSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** canonical 16 类（与 references/05-reference-research.md 的要素清单同源）。 */
export const ELEMENT_CLASSES = Object.freeze([
  "地形与水文",
  "建筑主体",
  "标志物",
  "立面系统",
  "材质与色彩",
  "街具与摊位",
  "人流与交通",
  "植被",
  "光照与天气",
  "天际线与远景",
  "文化符号",
  "声音",
  "光照情绪",
  "反射与湿润",
  "后处理风格",
  "材质磨损层级",
]);

/** 覆盖矩阵的视角/条件轴（references/05 的配额矩阵 + 场景矩阵共用的四个方向）。 */
export const COVERAGE_AXES = Object.freeze(["俯视", "平视", "夜景", "湿天"]);
export const MIN_SOURCES = 3;
export const MIN_DELTAS = 3;
export const R0_PRIMARY = "R0.md";
export const R0_FALLBACK = "evidence/references/manifest.md";

// 决策/参数去向里的占位文本：「待补」在覆盖矩阵里是合法状态，但在「参数去向」里不是去向。
const PLACEHOLDER_RE = /(TODO|TBD|待定|待补)/i;

// ---------------------------------------------------------------------------
// Markdown 表格 / 小节解析
// ---------------------------------------------------------------------------

function splitRow(line) {
  let s = String(line).trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((cell) => cell.trim());
}

function isSeparatorRow(line) {
  if (!/^\s*\|/.test(String(line))) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

/** 解析所有 markdown 表格（含代码围栏里的模板表——GAP 模板就在围栏里）。 */
export function parseMarkdownTables(text) {
  const lines = String(text).split("\n");
  const tables = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*\|/.test(lines[i]) || i + 1 >= lines.length) continue;
    if (!isSeparatorRow(lines[i + 1])) continue;
    const header = splitRow(lines[i]);
    const rows = [];
    let j = i + 2;
    for (; j < lines.length && /^\s*\|/.test(lines[j]); j += 1) {
      rows.push({ cells: splitRow(lines[j]), line: j + 1 });
    }
    tables.push({ header, rows, line: i + 1 });
    i = j - 1;
  }
  return tables;
}

/** 找到标题匹配 titleRe 的第一节（含到下一个同级/更高级标题之前）。 */
export function findSection(text, titleRe) {
  const lines = String(text).split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^(#{1,6})\s+(.*)$/);
    if (!m || !titleRe.test(m[2])) continue;
    const level = m[1].length;
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j += 1) {
      const h = lines[j].match(/^(#{1,6})\s+/);
      if (h && h[1].length <= level) break;
      body.push(lines[j]);
    }
    return { title: m[2].trim(), level, body: body.join("\n"), line: i + 1 };
  }
  return null;
}

function nonEmptyCount(cells) {
  return cells.filter((cell) => String(cell).trim() !== "").length;
}

function isPlaceholder(value) {
  const v = String(value ?? "").trim();
  return v === "" || PLACEHOLDER_RE.test(v);
}

// ---------------------------------------------------------------------------
// canonical 校验：来源 / 覆盖矩阵 / 16 类 / GAP / 对拍
// ---------------------------------------------------------------------------

/** 来源（多参考渠道）：≥min 行，每行至少两个非空字段（渠道/来源/观察）。 */
function collectSources(text, { min = MIN_SOURCES } = {}) {
  const section = findSection(text, /(来源|多参考)/);
  let rows = [];
  if (section) {
    rows = parseMarkdownTables(section.body).flatMap((table) => table.rows);
  } else {
    const table = parseMarkdownTables(text).find((t) => t.header.some((cell) => /来源|渠道/.test(cell)));
    rows = table ? table.rows : [];
  }
  const problems = [];
  if (!rows.length) {
    problems.push(`SOURCES: 缺「来源/多参考」小节或来源表（场景须记录 ≥${min} 个独立来源）`);
    return { problems, count: 0 };
  }
  if (rows.length < min) {
    problems.push(`SOURCES: 来源行 ${rows.length} < ${min}（每源独立一行）`);
  }
  rows.forEach((row, index) => {
    if (nonEmptyCount(row.cells) < 2) {
      problems.push(`SOURCES: 第 ${row.line} 行（第 ${index + 1} 个来源）少于 2 个非空字段（渠道/来源/观察）`);
    }
  });
  return { problems, count: rows.length };
}

/** 覆盖矩阵：scene 模式逐格 已满足/待补；reference 模式只要配额表结构。 */
function collectMatrix(text, { mode = "scene" } = {}) {
  const stats = { rows: 0, cells: 0 };
  const section = findSection(text, /覆盖矩阵/);
  if (!section) return { problems: ["MATRIX: 缺「覆盖矩阵」小节"], stats };
  const tables = parseMarkdownTables(section.body);
  if (!tables.length) return { problems: ["MATRIX: 「覆盖矩阵」小节没有表格"], stats };
  const table = tables[0];
  const problems = [];
  stats.rows = table.rows.length;
  if (table.rows.length < 2) problems.push("MATRIX: 矩阵数据行 < 2");
  if (table.header.length < 3) problems.push("MATRIX: 矩阵列 < 3（至少 1 个视角列 + 2 个展厅列）");
  if (mode === "reference") {
    if (table.rows.length < 3) problems.push("MATRIX: 参考模式的覆盖矩阵配额表 < 3 行");
    return { problems, stats };
  }
  const axes = COVERAGE_AXES.filter((axis) => table.rows.some((row) => String(row.cells[0] || "").includes(axis)));
  if (axes.length < 2) {
    problems.push(`MATRIX: 视角列须覆盖「俯视/平视/夜景/湿天」至少两类（当前 ${axes.join("、") || "无"}）`);
  }
  for (const row of table.rows) {
    const axis = String(row.cells[0] || "").trim() || "?";
    if (row.cells.length < table.header.length) {
      problems.push(`MATRIX: 第 ${row.line} 行（${axis}）列数 ${row.cells.length} < 表头 ${table.header.length}（缺格）`);
    }
    for (let c = 1; c < table.header.length; c += 1) {
      stats.cells += 1;
      const value = String(row.cells[c] ?? "").trim();
      if (!value) {
        problems.push(`MATRIX: 第 ${row.line} 行（${axis}）第 ${c + 1} 列为空（每格须填 已满足/待补）`);
      } else if (!/^(已满足|待补)$/.test(value)) {
        problems.push(`MATRIX: 第 ${row.line} 行（${axis}）第 ${c + 1} 列 =「${value}」（只允许 已满足/待补）`);
      }
    }
  }
  return { problems, stats };
}

function numberedRowCount(table) {
  return table.rows.filter((row) => /^\d+$/.test(String(row.cells[0] || "").trim())).length;
}

/** 找到 16 类要素表：带 ≥8 个数字编号行的表格里，编号行最多的那张。 */
function findElementTable(text) {
  const tables = parseMarkdownTables(text)
    .filter((table) => numberedRowCount(table) >= 8)
    .sort((a, b) => numberedRowCount(b) - numberedRowCount(a));
  return tables[0] || null;
}

/** 16 类要素：1..16 逐行；scene 模式还要求 决策/是否入景/参数去向 三列。 */
function collectElements(text, { mode = "scene" } = {}) {
  const table = findElementTable(text);
  if (!table) {
    return { problems: ["ELEMENTS: 缺 16 类要素决策表（1..16 编号逐行）"], count: 0 };
  }
  const problems = [];
  const header = table.header;
  const classIdx = Math.max(0, header.findIndex((cell) => cell.includes("要素类")));
  const decisionIdx = header.findIndex((cell) => cell.includes("决策"));
  const inSceneIdx = header.findIndex((cell) => cell.includes("是否入景"));
  const destinationIdx = header.findIndex((cell) => cell.includes("参数去向"));
  if (decisionIdx < 0) problems.push("ELEMENTS: 表头缺「决策」列");
  if (mode === "scene") {
    if (inSceneIdx < 0) problems.push("ELEMENTS: 表头缺「是否入景」列");
    if (destinationIdx < 0) problems.push("ELEMENTS: 表头缺「参数去向」列");
  }
  const numbered = [];
  const seen = new Set();
  for (const row of table.rows) {
    const raw = String(row.cells[0] || "").trim();
    if (!/^\d+$/.test(raw)) continue;
    const n = Number(raw);
    numbered.push({ n, row });
    if (n < 1 || n > ELEMENT_CLASSES.length) {
      problems.push(`ELEMENTS: 第 ${row.line} 行编号 ${n} 越界（应是 1..${ELEMENT_CLASSES.length}）`);
    }
    if (seen.has(n)) problems.push(`ELEMENTS: 第 ${row.line} 行编号 ${n} 重复`);
    seen.add(n);
  }
  for (let n = 1; n <= ELEMENT_CLASSES.length; n += 1) {
    if (!seen.has(n)) problems.push(`ELEMENTS: 缺第 ${n} 类「${ELEMENT_CLASSES[n - 1]}」（16 类须逐类决策）`);
  }
  for (const { n, row } of numbered) {
    if (n < 1 || n > ELEMENT_CLASSES.length) continue;
    const name = ELEMENT_CLASSES[n - 1];
    const classCell = String(row.cells[classIdx] || "").trim();
    if (!classCell.includes(name)) {
      problems.push(`ELEMENTS: 第 ${n} 行要素类应为「${name}」（当前「${classCell || "空"}」）`);
    }
    const checks = [{ idx: decisionIdx, label: "决策" }];
    if (mode === "scene") {
      checks.push({ idx: inSceneIdx, label: "是否入景" }, { idx: destinationIdx, label: "参数去向" });
    }
    for (const { idx, label } of checks) {
      if (idx < 0) continue;
      const value = String(row.cells[idx] ?? "").trim();
      if (isPlaceholder(value)) {
        problems.push(`PLACEHOLDER: 第 ${n} 类「${name}」${label}为空或占位文本（${value || "空"}）`);
      }
    }
  }
  return { problems, count: numbered.filter(({ n }) => n >= 1 && n <= ELEMENT_CLASSES.length).length };
}

/** GAP 表：必须有「参数去向」列，每条数据行的参数去向非空且非占位。 */
function collectGaps(text) {
  const section = findSection(text, /GAP/i);
  if (!section) return { problems: ["GAP: 缺 GAP 小节"], count: 0 };
  const table = parseMarkdownTables(section.body).find((t) => t.header.some((cell) => cell.includes("参数去向")));
  if (!table) return { problems: ["GAP: 缺带「参数去向」列的 GAP 表"], count: 0 };
  const idx = table.header.findIndex((cell) => cell.includes("参数去向"));
  const problems = [];
  if (!table.rows.length) problems.push("GAP: GAP 表没有数据行");
  table.rows.forEach((row, index) => {
    const value = String(row.cells[idx] ?? "").trim();
    if (!value) {
      problems.push(`GAP: 第 ${row.line} 行（第 ${index + 1} 条 GAP）「参数去向」为空`);
    } else if (PLACEHOLDER_RE.test(value)) {
      problems.push(`GAP: 第 ${row.line} 行「参数去向」仍是占位文本（${value}）`);
    }
  });
  return { problems, count: table.rows.length };
}

function countDeltaRecords(body) {
  let tableCount = 0;
  for (const table of parseMarkdownTables(body)) {
    const hasDeltaHeader = table.header.some((cell) => /delta|差异/i.test(cell));
    for (const row of table.rows) {
      const first = String(row.cells[0] || "").trim();
      if (hasDeltaHeader || (/^D\d+$/i.test(first) && nonEmptyCount(row.cells) >= 2)) tableCount += 1;
    }
  }
  if (tableCount > 0) return tableCount;
  return body
    .split("\n")
    .filter((line) => /^\s*[-*]\s+D\d+\b/i.test(line))
    .length;
}

/** 参考对拍：scene 模式 ≥MIN_DELTAS 条 delta；reference 模式接受「≥3 条 delta」合同句。 */
function collectParity(text, { mode = "scene", min = MIN_DELTAS } = {}) {
  const section = findSection(text, /对拍/);
  if (!section) return { problems: ["PARITY: 缺「参考对拍」小节"], count: 0 };
  const count = countDeltaRecords(section.body);
  if (mode === "reference" && /(≥|>=|不少于|至少)\s*3\s*条/.test(section.body)) {
    return { problems: [], count: Math.max(count, min) };
  }
  if (count < min) {
    return { problems: [`PARITY: 参考对拍 delta ${count} < ${min} 条`], count };
  }
  return { problems: [], count };
}

// ---------------------------------------------------------------------------
// 组合校验
// ---------------------------------------------------------------------------

function emptyStats() {
  return { sources: 0, matrix: { rows: 0, cells: 0 }, elements: 0, gaps: 0, deltas: 0 };
}

/**
 * 文档级 canonical 校验。
 * @param {string} text R0 文档正文
 * @param {{mode?: "scene"|"reference"}} [opts] scene=场景申报，reference=方法论文档（references/05）
 * @returns {{mode: string, problems: string[], stats: object}}
 */
export function validateR0Document(text, { mode = "scene" } = {}) {
  if (mode !== "scene" && mode !== "reference") {
    return { mode, problems: [`R0: 未知校验模式「${mode}」（scene / reference）`], stats: emptyStats() };
  }
  if (typeof text !== "string" || !text.trim()) {
    return { mode, problems: ["R0: 文档为空"], stats: emptyStats() };
  }
  const sources = collectSources(text);
  const matrix = collectMatrix(text, { mode });
  const elements = collectElements(text, { mode });
  const gaps = collectGaps(text);
  const parity = collectParity(text, { mode });
  const problems = [
    ...sources.problems,
    ...matrix.problems,
    ...elements.problems,
    ...gaps.problems,
    ...parity.problems,
  ];
  return {
    mode,
    problems,
    stats: {
      sources: sources.count,
      matrix: matrix.stats,
      elements: elements.count,
      gaps: gaps.count,
      deltas: parity.count,
    },
  };
}

/** 场景申报（<scene>/R0.md）的 canonical 校验。 */
export function validateSceneR0(text) {
  return validateR0Document(text, { mode: "scene" });
}

/** 方法论文档（references/05-reference-research.md）的 canonical 校验，供 skill.mjs 复用。 */
export function validateReferenceR0(text) {
  return validateR0Document(text, { mode: "reference" });
}

// 单项校验器（供 complete / scaffold / skill 按需组合）。
export function validateSources(text, opts = {}) {
  return collectSources(text, opts).problems;
}
export function validateCoverageMatrix(text, opts = {}) {
  return collectMatrix(text, opts).problems;
}
export function validateElementDecisions(text, opts = {}) {
  return collectElements(text, opts).problems;
}
export function validateGaps(text) {
  return collectGaps(text).problems;
}
export function validateParity(text, opts = {}) {
  return collectParity(text, opts).problems;
}

// ---------------------------------------------------------------------------
// 场景产物定位与整场景校验
// ---------------------------------------------------------------------------

/** 定位场景 R0 产物：优先 R0.md，退化到 evidence/references/manifest.md。 */
export function locateR0Artifact(sceneDir) {
  const primary = path.join(sceneDir, R0_PRIMARY);
  if (existsSync(primary) && statSync(primary).isFile()) {
    return { path: primary, kind: R0_PRIMARY };
  }
  const fallback = path.join(sceneDir, R0_FALLBACK);
  if (existsSync(fallback) && statSync(fallback).isFile()) {
    return { path: fallback, kind: R0_FALLBACK };
  }
  return null;
}

/**
 * 整场景校验。
 * @param {string} sceneRel 场景目录（相对 ROOT 或绝对路径）
 * @param {{root?: string}} [opts]
 */
export function checkR0Scene(sceneRel, { root = ROOT } = {}) {
  const sceneDir = path.isAbsolute(sceneRel) ? sceneRel : path.join(root, sceneRel);
  if (!existsSync(sceneDir) || !statSync(sceneDir).isDirectory()) {
    return {
      scene: sceneRel,
      artifact: null,
      artifactKind: null,
      ok: false,
      problems: [`R0: 场景目录不存在（${sceneRel}）`],
      stats: emptyStats(),
    };
  }
  const artifact = locateR0Artifact(sceneDir);
  if (!artifact) {
    return {
      scene: sceneRel,
      artifact: null,
      artifactKind: null,
      ok: false,
      problems: [`R0: 缺场景 R0 产物（${R0_PRIMARY} 或 ${R0_FALLBACK}）`],
      stats: emptyStats(),
    };
  }
  const text = readFileSync(artifact.path, "utf8");
  const result = validateR0Document(text, { mode: "scene" });
  return {
    scene: sceneRel,
    artifact: path.relative(root, artifact.path),
    artifactKind: artifact.kind,
    ok: result.problems.length === 0,
    problems: result.problems,
    stats: result.stats,
  };
}

// ---------------------------------------------------------------------------
// self-test：七类负例 + 一个正例（合成样例，不依赖交付文档）
// ---------------------------------------------------------------------------

const SAMPLE_SOURCES = [
  ["S1", "方法论", "references/05-reference-research.md", "16 类 + 覆盖矩阵 + GAP + 对拍"],
  ["S2", "渲染链资产", "assets/index.md", "八系统消费契约"],
  ["S3", "原作", "sources/jimao-3a-game/index.html", "黄昏逆光/湿地反射/漆面磨损"],
];

function makeSceneSample({
  sourceRows = 3,
  matrixBlank = false,
  elementRows = 16,
  decisionFor = (n) => (n === 8 ? "明确不做（工业堆场全硬地，无植被）" : "按参考入景，权重中"),
  gapDestination = "`quality.planar` / `uReflLod`",
  deltaRows = 4,
} = {}) {
  const lines = ["# 自检样例 R0（合成，不指向真实场景）", ""];
  lines.push("## 来源", "", "| # | 渠道 | 来源 | 观察 |", "| --- | --- | --- | --- |");
  for (let i = 0; i < sourceRows; i += 1) {
    const source = SAMPLE_SOURCES[i % SAMPLE_SOURCES.length];
    const tag = sourceRows <= SAMPLE_SOURCES.length ? source[0] : `S${i + 1}`;
    lines.push(`| ${tag} | ${source[1]} | ${source[2]} | ${source[3]} |`);
  }
  lines.push("", "## 覆盖矩阵", "", "| 视角 | mats | props | ground |", "| --- | --- | --- | --- |");
  const matrix = [
    ["俯视", "待补", "待补", "已满足"],
    ["平视", "已满足", "已满足", "已满足"],
    ["夜景", "待补", "待补", "待补"],
    ["湿天", "待补", "待补", "已满足"],
  ];
  for (const row of matrix) {
    const cells = [...row];
    if (matrixBlank && row[0] === "夜景") cells[2] = "";
    lines.push(`| ${cells.join(" | ")} |`);
  }
  lines.push("", "## 16 类要素决策", "", "| # | 要素类 | 决策 | 是否入景 | 参数去向 |", "| --- | --- | --- | --- | --- |");
  for (let n = 1; n <= elementRows; n += 1) {
    const name = ELEMENT_CLASSES[n - 1];
    const inScene = n === 8 ? "否（明确不做）" : "入景";
    lines.push(`| ${n} | ${name} | ${decisionFor(n)} | ${inScene} | src/field${n}.mjs |`);
  }
  lines.push("", "## GAP", "", "| 要素 | 参考值 | 当前值 | GAP | 修正动作 | 参数去向 |", "| --- | --- | --- | --- | --- | --- |");
  lines.push(`| 湿地反射 | 锐镜面 + 纵向拉伸 | 仅 SSR_RR | 反射锐度不足 | 开平面反射 | ${gapDestination} |`);
  lines.push("", "## 参考对拍", "", "| # | 对拍组 | 参考观察 | delta | 去向 |", "| --- | --- | --- | --- | --- |");
  for (let i = 0; i < deltaRows; i += 1) {
    lines.push(`| D${i + 1} | 参考${i + 1} | 观察${i + 1} | 差异${i + 1} | G${i + 1} |`);
  }
  return `${lines.join("\n")}\n`;
}

function selfTest() {
  const failures = [];
  const expect = (condition, label) => {
    if (!condition) failures.push(label);
  };
  const expectRule = (text, rule, label) => {
    const result = validateSceneR0(text);
    expect(
      result.problems.some((problem) => problem.startsWith(`${rule}:`)),
      `${label}: 期望 ${rule} 判红，实际 problems=${JSON.stringify(result.problems)}`
    );
  };

  // 正例
  const positive = validateSceneR0(makeSceneSample());
  expect(
    positive.problems.length === 0,
    `正例被拒: ${JSON.stringify(positive.problems)}`
  );
  expect(
    positive.stats.sources === 3 && positive.stats.elements === 16 && positive.stats.gaps === 1 && positive.stats.deltas === 4,
    `正例统计异常: ${JSON.stringify(positive.stats)}`
  );
  // 「明确不做」必须算决策（第 8 类），不能被占位/空判红
  expect(
    !positive.problems.some((problem) => problem.includes("第 8 类")),
    "「明确不做」被误判为占位"
  );

  // 七类负例
  expectRule(makeSceneSample({ sourceRows: 2 }), "SOURCES", "来源 <3");
  expectRule(makeSceneSample({ matrixBlank: true }), "MATRIX", "覆盖矩阵空格");
  expectRule(makeSceneSample({ elementRows: 12 }), "ELEMENTS", "12 类（<16）");
  expectRule(
    makeSceneSample({ decisionFor: (n) => (n === 5 ? "TODO" : "按参考入景，权重中") }),
    "PLACEHOLDER",
    "决策 TODO"
  );
  expectRule(makeSceneSample({ gapDestination: "" }), "GAP", "GAP 缺参数去向");
  expectRule(makeSceneSample({ deltaRows: 2 }), "PARITY", "对拍 <3 delta");

  // 缺 R0（定位器）+ 主产物 / 退化产物的正例
  const tmp = mkdtempSync(path.join(tmpdir(), "h2b-r0-selftest-"));
  try {
    const missing = checkR0Scene(tmp, { root: tmp });
    expect(!missing.ok, "缺 R0 场景产物未判红");
    expect(
      missing.problems.some((problem) => problem.includes("缺场景 R0 产物")),
      `缺 R0 问题文案异常: ${JSON.stringify(missing.problems)}`
    );

    writeFileSync(path.join(tmp, R0_PRIMARY), makeSceneSample());
    const primary = checkR0Scene(tmp, { root: tmp });
    expect(primary.ok, `R0.md 正例未通过: ${JSON.stringify(primary.problems)}`);
    expect(primary.artifact === R0_PRIMARY, `R0.md 定位异常: ${primary.artifact}`);

    rmSync(path.join(tmp, R0_PRIMARY));
    mkdirSync(path.join(tmp, path.dirname(R0_FALLBACK)), { recursive: true });
    writeFileSync(path.join(tmp, R0_FALLBACK), makeSceneSample());
    const fallback = checkR0Scene(tmp, { root: tmp });
    expect(fallback.ok, `manifest.md 退化未通过: ${JSON.stringify(fallback.problems)}`);
    expect(
      fallback.artifact === path.join("evidence", "references", "manifest.md"),
      `manifest.md 退化定位异常: ${fallback.artifact}`
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error("r0 gate --self-test FAILED:");
    for (const failure of failures) console.error(`  - ${failure}`);
    return 1;
  }
  console.log(
    "r0 gate --self-test OK: 7 类负例（缺 R0 / 来源<3 / 矩阵空格 / 12 类<16 / TODO / GAP 缺参数去向 / 对拍<3 delta）"
    + " + 1 正例（含「明确不做」决策）+ 产物定位（R0.md 优先 / manifest.md 退化）"
  );
  return 0;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export async function main(argv) {
  if (argv.includes("--self-test")) {
    if (argv.length > 1) {
      console.error("r0 gate: --self-test 不接受其它参数");
      return 2;
    }
    return selfTest();
  }
  const known = new Set(["--scene"]);
  const unknown = argv.filter((arg) => arg.startsWith("--") && !known.has(arg));
  if (unknown.length) {
    console.error(`r0 gate: unknown flag(s): ${unknown.join(", ")}`);
    return 2;
  }
  const idx = argv.indexOf("--scene");
  if (idx < 0 || !argv[idx + 1] || argv[idx + 1].startsWith("--")) {
    console.error("usage: node harness/gates/r0.mjs --self-test | --scene <dir>");
    return 2;
  }
  const report = checkR0Scene(argv[idx + 1]);
  console.log(JSON.stringify(report, null, 1));
  if (!report.ok) {
    console.error(`r0 gate FAILED: ${report.scene} (${report.problems.length} problem(s))`);
    for (const problem of report.problems.slice(0, 12)) console.error(`  ✗ ${problem}`);
    return 1;
  }
  const { stats } = report;
  console.log(
    `r0 gate: ${report.scene} OK (${report.artifact}; sources=${stats.sources}`
    + ` elements=${stats.elements}/16 gaps=${stats.gaps} deltas=${stats.deltas})`
  );
  return 0;
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error("r0.mjs crashed:", err && err.message ? err.message : err);
      process.exit(1);
    }
  );
}
