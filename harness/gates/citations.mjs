/**
 * harness/gates/citations.mjs — 「百分百蒸馏」引用校验器。
 *
 * 引用语法：`[src:L起-L止]` 或 `[src:L行]`（1-based 闭区间），
 * 指向 sources/jimao-3a-game/index.html；`[src:pretty:L…]` 指向
 * evidence/frames/app.pretty.js（由 capture/prettify.mjs 从同一 HTML 生成）。
 *
 * 校验规则：
 *   R1 行号在 1..totalLines 内
 *   R2 起 ≤ 止
 *   R3 被引区间内首行非空（空行/纯空白视为无效证据）
 *   R4 区间长度 ≤ 400 行（引用是证据，不是搬运正文）
 *   R5 语义锚定：取引用所在句（同一行内以 。；;！？!? 分句；表格行取引用所在
 *      单元格），抽取：
 *      - 数字（≥2 位，含千分位；L4207/01-anatomy/2026-11-16 这类行号与章节记法除外）
 *      - 反引号里的符号标识符（整个反引号片段就是一个符号；纯小写普通词、
 *        路径/文件名、three.js 库区类名不算；**只锚定在上游 app 区真实出现过的符号**——
 *        伪造/拼错、从未在上游出现的标识符不会被发现，这是 R5 的显式可检边界）
 *      - key:value / key=value 字面量（key 须是上游对象字面量字段；把源码里的
 *        !0/!1、空格归一化后比较；**只在反引号代码片段内检查**，正文里的 pri:9 不锚定）
 *      归一化后必须出现在该句全部有效引用区间的并集里；缺失判红。
 *      R5 不承诺「所有标识符/key:value 缺失都判红」；伪造符号与正文 key:value 属已知边界，
 *      --self-test 把该边界固化为断言，防止文档把它误读成已证明。
 *   R6 字符跨度：单条引用的被引区间字符数 > 20K 判红，要求换更窄区间
 *      （raw 的巨行应改用 pretty 的窄区间；2026-11-20 已全部清零）
 *   R7 claims 登记：harness/claims.json 记录 upstream/ours 两套数字与
 *      断言点（file+regex+expect），数字漂移即判红。
 *
 * 严格债务已清零（2026-11-20）：claims.json#citationDebt 整段删除；R5 失配
 * 改为「被引区间可证明的表述」或 pretty 窄区间，R6 巨行换成 pretty 窄区间。
 * `--strict` 作为兼容开关保留，行为与默认一致；`--rule R1..R7` 可按规则分组验收。
 *
 * CLI:
 *   node harness/gates/citations.mjs <file.md...>     校验指定文件
 *   node harness/gates/citations.mjs --all            校验 manifest 全部文件 + 三个产物目录下所有 .md
 *   node harness/gates/citations.mjs --sample 50      全量校验 + 抽 50 条输出人读语义报告，
 *                                                     并落 evidence/frames/citation-semantic.json
 *   node harness/gates/citations.mjs --range L4207-L4296   打印引用区间内容（作者自检用）
 *   node harness/gates/citations.mjs --self-test      注入已知错误，验证 R5/R6/R7 判红
 *   node harness/gates/citations.mjs --json           打印 JSON 结果
 *   node harness/gates/citations.mjs --strict         严格模式（兼容开关；债务已清零）
 *   node harness/gates/citations.mjs --strict --rule R5 <files>  只按 R5 分组验收
 *
 * 退出码：全部合法 → 0；任一悬空/非法/语义失配 → 1；用法错误 → 2
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURE = path.join(ROOT, "sources/jimao-3a-game/index.html");
const MANIFEST = path.join(ROOT, "harness/docs.manifest.json");
const CLAIMS = path.join(ROOT, "harness/claims.json");
const AUDIT_DIR = path.join(ROOT, "evidence/frames");

const CITATION_RE = /\[src:(pretty:)?L(\d+)(?:-L(\d+))?\]/g;
const MAX_RANGE_LINES = 400;
const MAX_RANGE_CHARS = 20000; // R6：单条引用被引区间的字符数上限
const SAMPLE_REPORT_NAME = "citation-semantic.json";

let fixtureLines = null;
function lines() {
  if (!fixtureLines) {
    fixtureLines = readFileSync(FIXTURE, "utf8").split("\n");
  }
  return fixtureLines;
}
const PRETTY = path.join(ROOT, "evidence/frames/app.pretty.js");
const PRETTY_HINT = "美化证据缺失（可再生，不入库）：先 `npm install --prefix harness`，再 `node harness/capture/prettify.mjs`";
let prettyLines = null;
function pretty() {
  if (!prettyLines) {
    prettyLines = readFileSync(PRETTY, "utf8").split("\n");
  }
  return prettyLines;
}

export function fixtureLineCount() {
  return lines().length;
}

function loadJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function loadDebt() {
  const claims = loadJson(CLAIMS, {});
  const debt = claims.citationDebt || {};
  return { r5: debt.r5 || {}, r6: debt.r6 || {} };
}

/** 登记锚点：把伪造/拼错标识符与正文 key:value 从显式豁免升级为可登记的强断言。
 *  登记项即使不在上游 app 区也参与 R5 锚定；未登记项保持 R5 的旧可检边界。 */
const EMPTY_ANCHORS = Object.freeze({ identifiers: new Set(), keyValues: new Set() });
function loadAnchors() {
  const anchors = loadJson(CLAIMS, {}).anchors || {};
  return {
    identifiers: new Set(Array.isArray(anchors.identifiers) ? anchors.identifiers : []),
    keyValues: new Set(Array.isArray(anchors.keyValues) ? anchors.keyValues : []),
  };
}

/** --rule 过滤：全规则照常计算，输出只保留所选规则 + R1–R4/PRETTY 结构诊断。
 *  结构诊断不可被过滤，否则无法求值的引用会被 --rule R5 静默假绿。 */
const STRUCTURAL_RULES = new Set(["R1", "R2", "R3", "R4", "PRETTY", "R5-STALE", "R6-STALE"]);
export function filterByRule(problems, rule) {
  if (!rule) return problems;
  return problems.filter((p) => STRUCTURAL_RULES.has(p.rule) || p.rule === rule);
}

/* ------------------------------------------------------------------ */
/* R5 语义锚定                                                         */
/* ------------------------------------------------------------------ */

const FILE_EXT_RE = /\.(mjs|js|json|md|html|css|glsl|png|jpe?g|webp|svg)$/;
const KEY_VALUE_RE = /([A-Za-z_$][A-Za-z0-9_$.]*)\s*[:=]\s*(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?[a-z%]*|true|false|null)\b/g;

let appBlob = null;
let appObjectKeys = null;
// 与 harness/capture/bundle.mjs 相同的 three/app 字符级分界：three r180 在前，
// 上游 app 代码从场景常量 `var oi={min:new W(` 起。R5 只锚定 app 侧符号——
// 文档里出现的 three.js 可读类名（PositionalAudio / MeshStandardMaterial…）
// 是库 API 的翻译，不是「被引行声称的 app 行为」。
const APP_BOUNDARY_MARK = "var oi={min:new W(";
function appRegionText() {
  if (appBlob === null) {
    const raw = lines().join("\n");
    const idx = raw.indexOf(APP_BOUNDARY_MARK);
    appBlob = idx >= 0 ? raw.slice(idx) : raw;
  }
  return appBlob;
}
function objectLiteralKeys() {
  if (!appObjectKeys) {
    appObjectKeys = new Set();
    for (const m of appRegionText().matchAll(/["']?([A-Za-z_$][A-Za-z0-9_$]*)["']?\s*:/g)) appObjectKeys.add(m[1]);
  }
  return appObjectKeys;
}

/**
 * 只把「看起来像代码符号」的反引号 token 纳入锚定：含 _ $ . / 驼峰 / 常量 / 字母数字混排。
 * 同时要求该符号在上游源码里确实出现过——我方资产 API 名与 three.js 可读类名
 * 不该由上游行号证明（它们由 assets/kit 单测与构建断言负责）。
 * **显式边界**：伪造/拼错的标识符从未在上游出现，因此不会被 R5 锚定或判红；
 * selfTest 把这一点固化为断言，避免文档宣称「所有标识符缺失都判红」。
 */
function isSymbolToken(token) {
  if (token.length < 3) return false;
  if (FILE_EXT_RE.test(token)) return false;
  if (token.includes("/")) return false;
  if (!/[_$.]/.test(token) && !/[a-z][A-Z]/.test(token) && !/^[A-Z][A-Z0-9]+$/.test(token) && !/[A-Za-z]\d|\d[A-Za-z]/.test(token)) {
    return false;
  }
  return appRegionText().includes(token);
}

function normalizeNumbers(text) {
  return text.replace(/(\d),(?=\d{3}\b)/g, "$1");
}

/** 源码侧归一化：去掉冒号/等号后的空格，把压缩器的 !0/!1 还原成 true/false，
 *  并把 x.0 收敛成 x（文档常写整数，源码保留浮点）。 */
function normalizeCode(text) {
  return normalizeNumbers(text)
    .replace(/:\s+/g, ":")
    .replace(/\s*=\s*/g, ":")
    .replace(/!1\b/g, "false")
    .replace(/!0\b/g, "true")
    .replace(/(\d)\.0(?![.\d])/g, "$1");
}

function numberBoundaryRe(value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w.])${escaped}(?![\\w.])`);
}

/** 抽取一句里的可锚定 token。anchors 登记的标识符/key:value 绕过 app 区与对象字面量门槛。 */
function extractTokens(sentence, anchors = EMPTY_ANCHORS) {
  const text = sentence.replace(CITATION_RE, " ");
  const numbers = [];
  // 章节号/文件名前缀（01-anatomy）、日期（2026-11-16）不是内容断言
  const numericText = text
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b\d{2}-[A-Za-z][\w-]*/g, " ");
  for (const m of numericText.matchAll(/(?<![\w.\-/])(\d{1,3}(?:,\d{3})+|\d{2,}(?:\.\d+)?)(?![\w.%])/g)) {
    const before = numericText.slice(0, m.index);
    const after = numericText.slice(m.index + m[0].length);
    // 「L50400-L50850 行」这类行号导航不是内容断言
    if (/^\s*[-–]\s*\d+\s*行/.test(after) || /\d+\s*[-–]\s*$/.test(before) || /^\s*行/.test(after)) continue;
    if (/^0\d/.test(m[1])) continue; // 01/02… 是章节编号，不是数值断言
    numbers.push(normalizeNumbers(m[1]));
  }
  const identifiers = [];
  for (const m of text.matchAll(/`([^`]+)`/g)) {
    // 只把「整个反引号片段就是一个标识符」的当锚：`getShadow()`、`SL_FRUSTUM` 算；
    // `t.rgb*t.rgb`、`new Qe(`、`uSlWet/uSlWetP/...` 是代码表达式/列表面，不逐词锚定。
    const span = m[1].trim().replace(/\(\)$/, "");
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z0-9_$]+)*$/.test(span)) continue;
    if (isSymbolToken(span) || anchors.identifiers.has(span)) identifiers.push(span);
  }
  const keyValues = [];
  const seenKv = new Set();
  // key:value 只在反引号代码片段里检查：正文里的「cap: min(...)」「gl_Position = vec4」
  // 是说明性代码，不是字段断言。anchors.keyValues 登记过的 key:value 例外：即使不在
  // 上游对象字面量里，也必须被 R5 锚定（登记即强断言）。
  for (const span of text.matchAll(/`([^`]+)`/g)) {
    for (const m of span[1].matchAll(KEY_VALUE_RE)) {
      const key = m[1];
      const value = m[2];
      if (/^https?$/i.test(key)) continue; // URL 不是 key:value 断言
      if (value === "//" || value.startsWith("//")) continue;
      const registered = anchors.keyValues.has(`${key}:${value}`);
      if (!objectLiteralKeys().has(key) && !registered) continue;
      const id = `${key}:${value}`;
      if (seenKv.has(id)) continue;
      seenKv.add(id);
      keyValues.push({ key, value });
    }
  }
  // 正文（反引号外）的 key:value 仅在登记表中出现时才锚定。
  for (const m of text.replace(/`[^`]*`/g, " ").matchAll(KEY_VALUE_RE)) {
    const id = `${m[1]}:${m[2]}`;
    if (!anchors.keyValues.has(id) || seenKv.has(id)) continue;
    seenKv.add(id);
    keyValues.push({ key: m[1], value: m[2] });
  }
  return { numbers, identifiers, keyValues };
}

function rangeTextOf(refs) {
  const chunks = [];
  for (const r of refs) {
    const table = r.pretty ? pretty() : lines();
    for (let i = r.start; i <= r.end; i += 1) chunks.push(table[i - 1] || "");
  }
  return chunks.join("\n");
}

function sentenceBounds(line, index) {
  // 引用常常挂在句号之后（「……。[src:…]」）：若终止符到引用之间只有空白，
  // 把引用算作上一句的证据，而不是产生一个空句子。
  let start = 0;
  for (const m of line.slice(0, index).matchAll(/[。；;！？!?]/g)) {
    if (/\S/.test(line.slice(m.index + 1, index))) start = m.index + 1;
  }
  let end = line.length;
  const rest = /[。；;！？!?]/.exec(line.slice(index));
  if (rest) end = index + rest.index + 1;
  return { start, end };
}

function r5ProblemsForSentence(file, lineNo, sentence, refs, opts) {
  const problems = [];
  const tokens = extractTokens(sentence, opts.anchors || EMPTY_ANCHORS);
  const rangeText = rangeTextOf(refs);
  const codeText = normalizeCode(rangeText);
  const debt = opts.debt.r5[file] || [];
  const isDebt = (rule, token) => {
    const key = `${rule}:${token}`;
    const hit = !opts.strict && debt.includes(key);
    if (hit && opts.debtUsed) opts.debtUsed.add(key);
    return hit;
  };
  const label = refs.map((r) => r.label).join(" ");

  for (const value of tokens.numbers) {
    if (numberBoundaryRe(value).test(codeText)) continue;
    if (isDebt("num", value)) continue;
    problems.push({
      rule: "R5",
      line: lineNo,
      detail: `${label} 语义失配：句子里的数字 ${value} 不在被引区间；句：${sentence.trim().slice(0, 160)}`,
    });
  }
  for (const token of tokens.identifiers) {
    if (codeText.includes(token)) continue;
    if (isDebt("id", token)) continue;
    problems.push({
      rule: "R5",
      line: lineNo,
      detail: `${label} 语义失配：标识符 \`${token}\` 不在被引区间；句：${sentence.trim().slice(0, 160)}`,
    });
  }
  for (const { key, value } of tokens.keyValues) {
    const forms = [`${key}:${value}`, `${key}:${value.toLowerCase()}`];
    if (forms.some((form) => codeText.includes(form))) continue;
    if (isDebt("kv", `${key}:${value}`)) continue;
    problems.push({
      rule: "R5",
      line: lineNo,
      detail: `${label} 语义失配：${key}:${value} 不在被引区间；句：${sentence.trim().slice(0, 160)}`,
    });
  }
  return problems;
}

/* ------------------------------------------------------------------ */
/* 单文件校验                                                          */
/* ------------------------------------------------------------------ */

/**
 * @param {string} file 展示用文件名
 * @param {string} text 文件内容
 * @param {{strict?:boolean, debt?:{r5:Object,r6:Object}}} [options]
 */
export function checkText(file, text, options = {}) {
  const opts = { strict: false, debt: loadDebt(), anchors: loadAnchors(), ...options };
  const problems = [];
  const refs = [];
  const lineStarts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (index) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const valid = [];
  const invalidKeys = new Set();
  /** 按「行内句子/表格单元格」收集有效引用，供 R5 做句级并集锚定。 */
  const sentences = new Map();
  for (const m of text.matchAll(CITATION_RE)) {
    const usingPretty = m[1] === "pretty:";
    const label = m[0];
    const lineNo = lineOf(m.index);
    const lineStart = lineStarts[lineNo - 1];
    const lineEnd = text.indexOf("\n", lineStart) === -1 ? text.length : text.indexOf("\n", lineStart);
    const lineText = text.slice(lineStart, lineEnd);
    const idxInLine = m.index - lineStart;
    // 表格行：引用只对它所在的单元格负责（同一行其他单元格常是「我方落点/门禁」，
    // 不该被上游行号证明）。普通行按句切分。
    let sentence;
    let sentenceKey;
    if (/^\s*\|/.test(lineText)) {
      const cellStart = lineText.lastIndexOf("|", idxInLine) + 1;
      const cellEndRel = lineText.indexOf("|", idxInLine);
      const cellEnd = cellEndRel === -1 ? lineText.length : cellEndRel;
      sentence = lineText.slice(cellStart, cellEnd);
      sentenceKey = `${lineNo}:${cellStart}:${cellEnd}`;
    } else {
      const bounds = sentenceBounds(lineText, idxInLine);
      sentence = lineText.slice(bounds.start, bounds.end);
      sentenceKey = `${lineNo}:${bounds.start}:${bounds.end}`;
    }
    if (usingPretty && !existsSync(PRETTY)) {
      invalidKeys.add(sentenceKey);
      problems.push({ rule: "PRETTY", line: lineNo, detail: `${label} 无法校验：${PRETTY_HINT}` });
      continue;
    }
    const table = usingPretty ? pretty() : lines();
    const start = Number(m[2]);
    const end = m[3] ? Number(m[3]) : start;
    const range = end - start + 1;
    if (start < 1 || start > table.length) {
      invalidKeys.add(sentenceKey);
      problems.push({ rule: "R1", line: lineNo, detail: `${label} 起始行 ${start} 超界 (1..${table.length})` });
      continue;
    }
    if (end < start) {
      invalidKeys.add(sentenceKey);
      problems.push({ rule: "R2", line: lineNo, detail: `${label} 起止倒置` });
      continue;
    }
    if (end > table.length) {
      invalidKeys.add(sentenceKey);
      problems.push({ rule: "R1", line: lineNo, detail: `${label} 结束行 ${end} 超界 (1..${table.length})` });
      continue;
    }
    if (range > MAX_RANGE_LINES) {
      invalidKeys.add(sentenceKey);
      problems.push({ rule: "R4", line: lineNo, detail: `${label} 区间 ${range} 行过长（引用是证据不是正文）` });
      continue;
    }
    let blank = 0;
    for (let i = start; i <= end; i += 1) if (!table[i - 1].trim()) blank += 1;
    if (blank === range || !table[start - 1].trim()) {
      invalidKeys.add(sentenceKey);
      problems.push({ rule: "R3", line: lineNo, detail: `${label} 区间为空证据（首行或全部为空白行）` });
      continue;
    }
    const record = { file, line: lineNo, label, pretty: usingPretty, start, end, range, sentence, sentenceKey };
    refs.push(record);
    valid.push(record);
    if (!sentences.has(sentenceKey)) sentences.set(sentenceKey, { sentence, refs: [], lineNo });
    sentences.get(sentenceKey).refs.push(record);
  }

  // R5：句级锚定；句中有任何一条无效引用时不重复报语义错（R1-R4 已报）
  const debtUsed = new Set();
  for (const [key, { sentence, refs: sRefs, lineNo }] of sentences) {
    if (invalidKeys.has(key)) continue;
    problems.push(...r5ProblemsForSentence(file, lineNo, sentence, sRefs, { ...opts, debtUsed }));
  }

  // R6：字符跨度（聚合到 文件+标签，避免同一巨行刷屏）
  const overlong = new Map();
  for (const r of valid) {
    const table = r.pretty ? pretty() : lines();
    let chars = 0;
    for (let i = r.start; i <= r.end; i += 1) chars += (table[i - 1] || "").length + 1;
    r.chars = chars;
    if (chars > MAX_RANGE_CHARS) {
      const key = `${file}\t${r.label}`;
      if (!overlong.has(key)) overlong.set(key, { file, label: r.label, chars, count: 0, lines: [] });
      const entry = overlong.get(key);
      entry.count += 1;
      if (entry.lines.length < 3) entry.lines.push(r.line);
    }
  }
  const r6Debt = opts.debt.r6[file] || {};
  for (const entry of overlong.values()) {
    const allowed = Number(r6Debt[entry.label] || 0);
    if (!opts.strict && entry.count <= allowed) continue;
    problems.push({
      rule: "R6",
      line: entry.lines[0],
      detail: `${entry.label} 被引区间 ${entry.chars} 字符 > ${MAX_RANGE_CHARS}（${entry.count} 处）；请换更窄区间（raw 巨行用 pretty）`,
    });
  }
  const stale = [];
  if (!opts.strict) {
    for (const token of opts.debt.r5[file] || []) {
      if (!debtUsed.has(token)) {
        stale.push({
          rule: "R5-STALE",
          detail: `${file} 的 R5 债务 ${token} 已失效（本文件不再出现该失配）`,
        });
      }
    }
    for (const [label, allowed] of Object.entries(r6Debt)) {
      const entry = [...overlong.values()].find((e) => e.label === label);
      if (!entry || entry.count < allowed) {
        stale.push({
          rule: "R6-STALE",
          detail: `${file} 的债务条目 ${label}×${allowed} 已失效（现存 ${entry ? entry.count : 0} 处）`,
        });
      }
    }
  }

  return { file, refs, problems, stale };
}

/** 校验单个文件；返回 { file, refs, problems } */
export function checkFile(file, options = {}) {
  const abs = path.isAbsolute(file) ? file : path.join(ROOT, file);
  let text = "";
  try {
    text = readFileSync(abs, "utf8");
  } catch (err) {
    return { file, refs: [], problems: [{ rule: "READ", detail: `cannot read: ${err.message}` }] };
  }
  return checkText(file, text, options);
}

/* ------------------------------------------------------------------ */
/* R7 claims 登记                                                      */
/* ------------------------------------------------------------------ */

export function checkClaims(claimsDoc = loadJson(CLAIMS, {})) {
  const problems = [];
  const claims = Array.isArray(claimsDoc.claims) ? claimsDoc.claims : [];
  if (!claims.length) {
    problems.push({ rule: "R7", detail: `harness/claims.json 未登记任何 upstream/ours 数字` });
    return { problems, checked: 0, registered: 0 };
  }
  let checked = 0;
  for (const claim of claims) {
    if (!claim.id || !claim.upstream || !claim.ours) {
      problems.push({ rule: "R7", detail: `claims 条目缺 id/upstream/ours：${JSON.stringify(claim).slice(0, 120)}` });
      continue;
    }
    for (const check of claim.checks || []) {
      const abs = path.join(ROOT, check.file);
      if (!existsSync(abs)) {
        problems.push({ rule: "R7", detail: `${claim.id}: 断言文件不存在 ${check.file}` });
        continue;
      }
      const text = readFileSync(abs, "utf8");
      const re = new RegExp(check.regex, "g");
      const found = [...text.matchAll(re)];
      checked += 1;
      if (!found.length) {
        problems.push({
          rule: "R7",
          detail: `${check.file}：未找到登记断言 ${claim.id} /${check.regex}/（登记值 ${check.expect}）`,
        });
        continue;
      }
      for (const m of found) {
        const value = Number(m[1]);
        if (value !== check.expect) {
          problems.push({
            rule: "R7",
            detail: `${check.file}: ${claim.id} 断言「${m[0].trim().slice(0, 80)}」= ${value}，登记值 ${check.expect}`,
          });
        }
      }
    }
  }
  return { problems, checked, registered: claims.length };
}

/* ------------------------------------------------------------------ */
/* 文件集合 / 报告                                                     */
/* ------------------------------------------------------------------ */

function mdFilesUnder(dir) {
  const base = path.join(ROOT, dir);
  const out = [];
  if (!existsSync(base)) return out;
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = path.join(d, name);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (name.endsWith(".md")) out.push(path.relative(ROOT, p));
    }
  };
  walk(base);
  return out;
}

function manifestFiles() {
  const manifest = loadJson(MANIFEST, { files: {} });
  return Object.keys(manifest.files || {});
}

function allFiles() {
  return [...new Set([...manifestFiles(), ...mdFilesUnder(".distill"), ...mdFilesUnder("references"), ...mdFilesUnder("assets")])].sort();
}

function printRange(a, b) {
  const ls = lines();
  for (let i = a; i <= b && i <= ls.length; i += 1) {
    console.log(`${String(i).padStart(6)}\t${ls[i - 1]}`);
  }
}

function sampleRefs(refs, n) {
  if (!refs.length || n <= 0) return [];
  const count = Math.min(n, refs.length);
  const picked = [];
  for (let i = 0; i < count; i += 1) {
    const idx = Math.floor((i * refs.length) / count);
    picked.push(refs[idx]);
  }
  return picked;
}

function writeEvidence(name, payload) {
  try {
    mkdirSync(AUDIT_DIR, { recursive: true });
    writeFileSync(path.join(AUDIT_DIR, name), `${JSON.stringify(payload, null, 1)}\n`);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* 自测：注入已知错误必须判红                                          */
/* ------------------------------------------------------------------ */

function selfTest() {
  const failures = [];
  const debt = { r5: {}, r6: {} };
  // self-test 不读真实 claims.json#anchors，避免登记项污染「未登记边界」断言。
  const opts = { strict: false, debt, anchors: EMPTY_ANCHORS };
  const good = "爆炸参考距离 12 米，总线 pri:9。 [src:pretty:L50465-L50521]";
  const goodResult = checkText("self/good.md", good, opts);
  if (goodResult.problems.length) {
    failures.push(`GOOD 样例误报：${JSON.stringify(goodResult.problems.slice(0, 3))}`);
  }
  const known = [
    ["38/57", "表里共 38 种声音。 [src:pretty:L50465-L50521]", "38"],
    ["58/57", "上游共 58 条规格。 [src:pretty:L50465-L50521]", "58"],
    ["4207", "种子来自启动参数（默认 4207）。 [src:L4206-L4206]", "4207"],
  ];
  for (const [name, text, token] of known) {
    const result = checkText(`self/${name}.md`, text, opts);
    const hit = result.problems.some((p) => p.rule === "R5" && p.detail.includes(token));
    if (!hit) failures.push(`${name}: R5 未判红（期望命中 ${token}）`);
  }
  // R5 标识符路径：真实上游符号缺失必须判红（防止自测只覆盖数字）
  const realId = checkText("self/id-real.md", "使用 `SALTLINE_POST` 标记。 [src:pretty:L50465-L50521]", opts);
  if (!realId.problems.some((p) => p.rule === "R5" && p.detail.includes("SALTLINE_POST"))) {
    failures.push("R5: 真实上游标识符缺失未判红");
  }
  // 显式降级的可检边界（见文件头与 citation-audit.md）：
  //  - 伪造/拼错的标识符从未在上游 app 区出现，isSymbolToken 会跳过；
  //  - 正文（反引号外）的 key:value 不锚定。
  // 这里把边界固化为断言，防止文档再宣称「所有标识符/key:value 缺失都判红」。
  const fabricated = checkText("self/id-fabricated.md", "使用 `SALTLINE_POSTX` 标记。 [src:pretty:L31177-L31260]", opts);
  if (fabricated.problems.some((p) => p.rule === "R5")) {
    failures.push("R5 边界漂移：伪造标识符不应被当作上游符号锚定");
  }
  const proseKv = checkText("self/kv-prose.md", "优先级 pri:9。 [src:pretty:L50465-L50521]", opts);
  if (proseKv.problems.some((p) => p.rule === "R5")) {
    failures.push("R5 边界漂移：正文 key:value 不应被锚定");
  }
  // 登记锚定（anchors）：登记项即使不在上游 app 区/对象字面量也必须判红；
  // 未登记项保持上述旧边界。登记过的伪造标识符与正文 key:value 是负样例。
  const anchoredId = checkText("self/id-anchored.md", "使用 `SALTLINE_POSTX` 标记。 [src:pretty:L31177-L31260]", {
    ...opts,
    anchors: { identifiers: new Set(["SALTLINE_POSTX"]), keyValues: new Set() },
  });
  if (!anchoredId.problems.some((p) => p.rule === "R5" && p.detail.includes("SALTLINE_POSTX"))) {
    failures.push("R5 登记锚定：伪造标识符已登记却未判红");
  }
  const anchoredKv = checkText("self/kv-anchored.md", "优先级 zzFakePri:9。 [src:pretty:L50465-L50521]", {
    ...opts,
    anchors: { identifiers: new Set(), keyValues: new Set(["zzFakePri:9"]) },
  });
  if (!anchoredKv.problems.some((p) => p.rule === "R5" && p.detail.includes("zzFakePri:9"))) {
    failures.push("R5 登记锚定：正文 key:value 已登记却未判红");
  }
  // --rule 过滤：R5/R6 互不串报，结构诊断始终保留（防止静默假绿）。
  const mixed = [
    { rule: "R5", detail: "r5" }, { rule: "R6", detail: "r6" },
    { rule: "PRETTY", detail: "structure" }, { rule: "R1", detail: "structure" },
  ];
  const onlyR5 = filterByRule(mixed, "R5").map((x) => x.rule);
  const onlyR6 = filterByRule(mixed, "R6").map((x) => x.rule);
  if (onlyR5.includes("R6") || !onlyR5.includes("R5") || !onlyR5.includes("PRETTY") || !onlyR5.includes("R1")) {
    failures.push(`--rule R5 过滤异常：${onlyR5.join(",")}`);
  }
  if (onlyR6.includes("R5") || !onlyR6.includes("R6") || !onlyR6.includes("R1")) {
    failures.push(`--rule R6 过滤异常：${onlyR6.join(",")}`);
  }
  const overlong = checkText("self/r6.md", "引擎主体。 [src:L5939-L5939]", opts);
  if (!overlong.problems.some((p) => p.rule === "R6")) failures.push("R6: 巨行引用未判红");
  const claims = {
    claims: [
      {
        id: "self.audio",
        upstream: { value: 57 },
        ours: { value: 58 },
        checks: [{ file: "sources/jimao-3a-game/index.html", regex: "SALTLINE_SKY", expect: 57 }],
      },
    ],
  };
  // 用真实文件做一次「断言找不到」的负样例，不改动文件
  const claimResult = checkClaims(
    { claims: [{ ...claims.claims[0], checks: [{ file: "sources/jimao-3a-game/index.html", regex: "SELF_TEST_NO_SUCH_TOKEN", expect: 57 }] }] }
  );
  if (!claimResult.problems.some((p) => p.rule === "R7")) failures.push("R7: 缺失登记断言未判红");
  const claimMismatch = checkClaims(
    { claims: [{ ...claims.claims[0], checks: [{ file: "sources/jimao-3a-game/index.html", regex: "(<title>[^<]*)", expect: 999 }] }] }
  );
  if (!claimMismatch.problems.some((p) => p.rule === "R7")) failures.push("R7: 登记值漂移未判红");
  // 债务只豁免已登记的 token，不能把新错误一起吞掉
  const debtSample = checkText("self/debt.md", "表里共 38 种声音。 [src:pretty:L50465-L50521]", {
    strict: false,
    debt: { r5: { "self/debt.md": ["num:38"] }, r6: {} },
  });
  if (debtSample.problems.some((p) => p.rule === "R5")) failures.push("债务豁免未生效（已登记 token 仍判红）");
  const debtOther = checkText("self/debt.md", "表里共 39 种声音。 [src:pretty:L50465-L50521]", {
    strict: false,
    debt: { r5: { "self/debt.md": ["num:38"] }, r6: {} },
  });
  if (!debtOther.problems.some((p) => p.rule === "R5")) failures.push("债务把未登记的 39 也放过了（放宽成空检查）");

  if (failures.length) {
    console.log("citations --self-test FAILED:");
    for (const f of failures) console.log(`  - ${f}`);
    return 1;
  }
  console.log("citations --self-test OK: R5 注入 38/57、58/57、4207 与真实标识符 SALTLINE_POST 均判红；登记锚定标识符/正文 key:value 判红，未登记项不锚定（显式边界）；--rule R5/R6 互不串报且结构诊断保留；R6 巨行判红；R7 缺断言与漂移均判红；正样例通过");
  return 0;
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

export async function main(argv) {
  const args = argv.slice();
  if (args.includes("--self-test")) return selfTest();
  const flags = { json: false, all: false, strict: false, rule: null };
  const files = [];
  let range = null;
  let sample = null;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--json") flags.json = true;
    else if (a === "--all") flags.all = true;
    else if (a === "--strict") flags.strict = true;
    else if (a === "--rule") {
      i += 1;
      const value = args[i];
      if (!/^R[1-7]$/.test(value || "")) {
        console.error("bad --rule R1..R7 (exactly one value)");
        return 2;
      }
      flags.rule = value;
    }
    else if (a === "--sample") {
      i += 1;
      sample = Number(args[i]);
      if (!Number.isInteger(sample) || sample <= 0) {
        console.error("bad --sample N, use --sample 50");
        return 2;
      }
    } else if (a === "--range") {
      i += 1;
      range = args[i];
    } else files.push(a);
  }
  if (range) {
    const m = /^L(\d+)(?:-L(\d+))?$/.exec(range);
    if (!m) {
      console.error("bad range, use --range L4207-L4296");
      return 2;
    }
    printRange(Number(m[1]), m[2] ? Number(m[2]) : Number(m[1]));
    return 0;
  }
  if (flags.all || sample !== null) files.push(...allFiles());
  if (!files.length) {
    console.error("usage: node harness/gates/citations.mjs [--all|--sample N|--json|--strict|--rule R1..R7|--self-test] file.md...");
    return 2;
  }
  const uniqueFiles = [...new Set(files)].sort();
  const debt = flags.strict ? { r5: {}, r6: {} } : loadDebt();
  const results = uniqueFiles.map((f) => checkFile(f, { strict: flags.strict, debt }));
  const problems = results.flatMap((r) => r.problems.map((p) => ({ file: r.file, ...p })));
  const staleDebt = results.flatMap((r) => (r.stale || []).map((s) => ({ file: r.file, ...s })));
  const claimsResult = checkClaims();
  problems.push(...claimsResult.problems.map((p) => ({ file: "harness/claims.json", ...p })));
  const shownProblems = filterByRule(problems, flags.rule);
  const totalRefs = results.reduce((n, r) => n + r.refs.length, 0);
  const report = {
    filesChecked: results.length,
    totalRefs,
    problemCount: shownProblems.length,
    problems: shownProblems,
    rule: flags.rule,
    rulesEvaluated: problems.length,
    staleDebt,
    rules: ["R1", "R2", "R3", "R4", "R5", "R6", "R7"],
    disabledRules: [],
    claims: { registered: claimsResult.registered, checks: claimsResult.checked },
    fixtureLines: lines().length,
    auditedAt: new Date().toISOString(),
  };
  writeEvidence("citation-audit.json", report);

  if (sample !== null) {
    const refs = results.flatMap((r) => r.refs.map((ref) => ({ ...ref, file: r.file })));
    const picked = sampleRefs(refs, sample);
    const sampleReport = {
      generatedAt: report.auditedAt,
      command: `node harness/gates/citations.mjs --sample ${sample}`,
      filesChecked: report.filesChecked,
      totalRefs,
      problemCount: problems.length,
      fixtureLines: report.fixtureLines,
      rules: report.rules,
      claims: report.claims,
      staleDebt,
      sampleSize: picked.length,
      samples: picked.map((ref) => {
        const tokens = extractTokens(ref.sentence);
        const refsInSentence = refs.filter((x) => x.file === ref.file && x.line === ref.line && x.sentence === ref.sentence);
        const rangeText = normalizeCode(rangeTextOf(refsInSentence));
        return {
          file: ref.file,
          line: ref.line,
          label: ref.label,
          chars: ref.chars,
          overlong: ref.chars > MAX_RANGE_CHARS,
          sentence: ref.sentence.trim().slice(0, 240),
          tokens,
          anchors: {
            numbers: tokens.numbers.map((v) => ({ value: v, present: numberBoundaryRe(v).test(rangeText) })),
            identifiers: tokens.identifiers.map((v) => ({ value: v, present: rangeText.includes(v) })),
            keyValues: tokens.keyValues.map(({ key, value }) => ({
              value: `${key}:${value}`,
              present: rangeText.includes(`${key}:${value}`),
            })),
          },
        };
      }),
      problems,
    };
    const written = writeEvidence(SAMPLE_REPORT_NAME, sampleReport);
    if (!flags.json) {
      console.log(`citations --sample ${sample}: ${picked.length} refs sampled from ${totalRefs} refs / ${report.filesChecked} files`);
      for (const s of sampleReport.samples) {
        const anchored = s.anchors.numbers.length + s.anchors.identifiers.length + s.anchors.keyValues.length;
        const missing = [
          ...s.anchors.numbers.filter((x) => !x.present).map((x) => x.value),
          ...s.anchors.identifiers.filter((x) => !x.present).map((x) => x.value),
          ...s.anchors.keyValues.filter((x) => !x.present).map((x) => x.value),
        ];
        console.log(
          `${missing.length ? "WARN" : "OK"}\t${s.file}:${s.line}\t${s.label}\tchars=${s.chars}${s.overlong ? "(R6)" : ""}\tanchors=${anchored - missing.length}/${anchored}${
            missing.length ? `\tmissing=${missing.join(",")}` : ""
          }`
        );
        if (s.sentence) console.log(`      ${s.sentence}`);
      }
      console.log(`sample report → ${path.relative(ROOT, path.join(AUDIT_DIR, SAMPLE_REPORT_NAME))}${written ? "" : "（落盘失败）"}`);
      if (staleDebt.length) console.log(`stale debt: ${staleDebt.length} 条（不阻断）`);
      console.log(
        `\ncitations: ${totalRefs} refs in ${report.filesChecked} files, ${shownProblems.length} problems${flags.rule ? ` (--rule ${flags.rule}; ${problems.length} evaluated)` : ""} (fixture has ${lines().length} lines)`
      );
    } else {
      console.log(JSON.stringify(sampleReport, null, 1));
    }
    return problems.length ? 1 : 0;
  }

  if (flags.json) {
    console.log(JSON.stringify(report, null, 1));
  } else {
    for (const r of results) {
      const shown = filterByRule(r.problems, flags.rule);
      const status = shown.length ? "FAIL" : "OK";
      console.log(`${status}\t${r.file}\trefs=${r.refs.length}\tproblems=${shown.length}`);
      for (const p of shown) console.log(`      ${p.rule}: ${p.detail}`);
    }
    for (const p of filterByRule(claimsResult.problems, flags.rule)) console.log(`FAIL\tharness/claims.json\n      ${p.rule}: ${p.detail}`);
    if (staleDebt.length) console.log(`stale debt: ${staleDebt.length} 条（不阻断；建议清理 claims.json#citationDebt）`);
    console.log(
      `\ncitations: ${totalRefs} refs in ${report.filesChecked} files, ${shownProblems.length} problems${flags.rule ? ` (--rule ${flags.rule}; ${problems.length} evaluated)` : ""} (fixture has ${lines().length} lines)`
    );
  }
  return shownProblems.length ? 1 : 0;
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error("citations.mjs crashed:", err && err.message ? err.message : err);
      process.exit(1);
    }
  );
}
