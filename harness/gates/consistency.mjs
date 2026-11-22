#!/usr/bin/env node
/**
 * harness/gates/consistency.mjs — 常量单一真源一致性门禁。
 *
 * 本任务只交付 `--self-test`：
 *   1. constants 四组导出的形状：GALLERIES 9 / SYSTEMS 8 / KITS 8 / ELEMENT_IDS 18，
 *      全部为非空、互不重复的字符串；
 *   2. inspect.mjs 的 GALLERIES 必须原样 re-export constants 的同一数组（同引用 + 同序）；
 *   3. assets.mjs 的 SYSTEMS/KITS 键集与 constants 相等（模块加载时也会断言一次）；
 *   4. assets/inspect-deck.mjs 的浏览器镜像 INSPECT_GALLERIES 与 constants.GALLERIES 同序；
 *   5. scripts/scaffold-scene.mjs 的 inspectManifest / elementsManifest / consumptionManifest
 *      三份模板经 JSON 解析后键集与 constants 相等；
 *   6. 负例（全部在内存构造，不改仓库文件）：常量形状被篡改、deck 镜像漂移、
 *      assets 键集少/多键、scaffold 模板少/多键或乱序、模板 JSON 损坏，均须判红。
 *
 * `--all`（结构/锚点/键集）直接读取这些输入并交叉判等，不拿拷贝常量或散文顶替：
 *   1. harness/element-manifest.json：galleries 顺序 == GALLERIES；elements 恰 18 条且 id 顺序
 *      == ELEMENT_IDS；每个 element.gallery ∈ GALLERIES（`inspect` 是 `special: inspect-manifest`
 *      的无展厅行，complete.mjs 以 gallery=null 跳过展厅证据，见 complete.mjs:207/312）；
 *   2. 18 个 element.doc（references/11-element-parity.md#<id>）：文件存在、fragment == 族 id、
 *      且命中该文件 `## <fragment>` 二级标题；锚点总数必须为 18；
 *   3. assets/inspect-deck.mjs：动态 import 后 INSPECT_GALLERIES 与 createInspectDeck({}).list()
 *      的展厅 id 顺序 == GALLERIES（浏览器镜像）；
 *   4. scripts/scaffold-scene.mjs：三份模板导出经 JSON 解析后 galleries/elements/systems 键集
 *      分别 == GALLERIES / ELEMENT_IDS / SYSTEMS；
 *   5. references/08-self-inspection.md「九展厅清单」小节表格恰 9 行，展厅名集合 == GALLERIES；
 *   6. 每个 examples/<scene>/inspect.manifest.json 的 galleries 键集 == GALLERIES（顺序可不同）。
 *
 * `--counts`（upstream/ours 计数口径）：
 *   1. 运行时只读 import：Object.keys(SL_MATERIALS).length === 48、HUD_COMPONENTS.length === 10；
 *   2. references/11：上游 51 种材质 / 11 个 HUD 组件保留，我方 48 / 10 写在摘要与
 *      materials/hud 小节（无引用句），不得把我方写成 51/11；
 *   3. references/12：materials 行产出列「我方 48 条」，上游出处列保留「材质 51 种」；
 *      hud 行写「我方 10 组件（上游 11）」；
 *   4. examples/parity 的 README / scene.elements.json / src/mats.mjs：我方材质写 48，不再写 51；
 *   5. 我方数字只出现在无引用句或非引用单元格（避免 citations R5 把新数字锚到上游区间）。
 *
 * CLI: node harness/gates/consistency.mjs --self-test
 *      node harness/gates/consistency.mjs --all
 *      node harness/gates/consistency.mjs --counts
 */

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GALLERIES, SYSTEMS, KITS, ELEMENT_IDS } from "../constants.mjs";

/** constants 四组导出的约定形状（长度）。 */
export const EXPECTED_SHAPES = Object.freeze({ GALLERIES: 9, SYSTEMS: 8, KITS: 8, ELEMENT_IDS: 18 });

/** 计数真值：运行时导出是唯一真源（资产只读，不在本门禁里改行为）。 */
export const EXPECTED_COUNTS = Object.freeze({ SL_MATERIALS: 48, HUD_COMPONENTS: 10 });

/**
 * 负例类别（中英双写，--self-test 日志可直接分辨漂移类型）。
 * 任务卡点名的五类各有独立类别，缺任何一类 self-test 判红。
 */
const FIXTURE_CATEGORY = Object.freeze({
  constantsShape: "常量形状 (constants-shape)",
  missingAnchor: "缺锚点 (missing-doc-anchor)",
  galleryMismatch: "画廊不一致 (gallery-mismatch)",
  deckMirror: "deck 镜像漂移 (deck-mirror)",
  templateDrift: "模板漂移 (template-drift)",
  countDrift: "计数漂移 (count-drift)",
  templateJson: "模板 JSON (template-json)",
  systemKeys: "系统键集 (system-keys)",
  kitKeys: "kit 键集 (kit-keys)",
  provenance: "源码出处 (provenance)",
});

/** 任务卡点名的五类负例：缺一即 self-test 判红。 */
const REQUIRED_FIXTURE_CATEGORIES = Object.freeze([
  FIXTURE_CATEGORY.missingAnchor,
  FIXTURE_CATEGORY.galleryMismatch,
  FIXTURE_CATEGORY.deckMirror,
  FIXTURE_CATEGORY.templateDrift,
  FIXTURE_CATEGORY.countDrift,
]);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** --counts 的文档输入。 */
const COUNTS_INPUTS = Object.freeze({
  "references/11-element-parity.md": path.join(ROOT, "references/11-element-parity.md"),
  "references/12-full-scene-assembly.md": path.join(ROOT, "references/12-full-scene-assembly.md"),
  "examples/parity/README.md": path.join(ROOT, "examples/parity/README.md"),
  "examples/parity/scene.elements.json": path.join(ROOT, "examples/parity/scene.elements.json"),
  "examples/parity/src/mats.mjs": path.join(ROOT, "examples/parity/src/mats.mjs"),
});

/** 运行时计数只读 import 的资产。 */
const COUNTS_ASSET_URLS = Object.freeze({
  surface: new URL("../../assets/sl-surface.mjs", import.meta.url),
  hud: new URL("../../assets/hud-kit.mjs", import.meta.url),
});
const ELEMENT_MANIFEST_FILE = path.join(ROOT, "harness/element-manifest.json");
const SELF_INSPECTION_FILE = path.join(ROOT, "references/08-self-inspection.md");
const EXAMPLES_DIR = path.join(ROOT, "examples");

const CONSUMER_URLS = Object.freeze({
  inspect: new URL("./inspect.mjs", import.meta.url),
  assets: new URL("./assets.mjs", import.meta.url),
  deck: new URL("../../assets/inspect-deck.mjs", import.meta.url),
  scaffold: new URL("../../scripts/scaffold-scene.mjs", import.meta.url),
});

/** 消费者到 constants 的 import specifier（源码出处检查用）。 */
const CONSTANTS_IMPORTS = Object.freeze({
  "harness/gates/inspect.mjs": { url: CONSUMER_URLS.inspect, specifier: "../constants.mjs" },
  "harness/gates/assets.mjs": { url: CONSUMER_URLS.assets, specifier: "../constants.mjs" },
  "scripts/scaffold-scene.mjs": { url: CONSUMER_URLS.scaffold, specifier: "../harness/constants.mjs" },
});

function formatList(items) {
  return items.map((item) => JSON.stringify(item)).join(", ");
}

// ---------------------------------------------------------------- 纯判等函数
// 真实检查与负例夹具共用同一套函数：夹具只替换输入数据，不改判等逻辑。

/** constants 四组导出的形状检查：数组、长度、非空字符串、无重复。 */
export function checkConstantsShape(candidate = {}) {
  const problems = [];
  for (const [name, size] of Object.entries(EXPECTED_SHAPES)) {
    const value = candidate[name];
    if (!Array.isArray(value)) {
      problems.push(`constants.${name}: 必须是数组（实际 ${typeof value}）`);
      continue;
    }
    if (value.length !== size) problems.push(`constants.${name}: 长度 ${value.length} != ${size}`);
    const bad = value.filter((item) => typeof item !== "string" || item.trim() === "");
    if (bad.length) problems.push(`constants.${name}: 存在非字符串/空项 ${formatList(bad)}`);
    const seen = new Set();
    const duplicates = [];
    for (const item of value) {
      if (seen.has(item)) duplicates.push(item);
      seen.add(item);
    }
    if (duplicates.length) problems.push(`constants.${name}: 重复键 ${formatList([...new Set(duplicates)])}`);
  }
  return problems;
}

/** 有序判等：长度 + 逐位比较，失败信息带下标与两侧值。 */
export function diffOrdered(label, actual, expected) {
  if (!Array.isArray(actual)) return [`${label}: 必须是数组（实际 ${typeof actual}）`];
  const problems = [];
  if (actual.length !== expected.length) problems.push(`${label}: 长度 ${actual.length} != ${expected.length}`);
  const max = Math.max(actual.length, expected.length);
  for (let i = 0; i < max; i += 1) {
    if (actual[i] !== expected[i]) {
      problems.push(`${label}[${i}]: ${JSON.stringify(actual[i])} != ${JSON.stringify(expected[i])}`);
    }
  }
  return problems;
}

/** 键集判等（顺序无关）：分别报告缺失键与多余键。 */
export function diffKeySets(label, actualKeys, expectedKeys) {
  if (!Array.isArray(actualKeys)) return [`${label}: 键清单必须是数组（实际 ${typeof actualKeys}）`];
  const actual = new Set(actualKeys);
  const missing = expectedKeys.filter((key) => !actual.has(key));
  const extra = actualKeys.filter((key) => !expectedKeys.includes(key));
  const problems = [];
  if (missing.length) problems.push(`${label}: 缺少键 ${formatList(missing)}`);
  if (extra.length) problems.push(`${label}: 多余键 ${formatList(extra)}`);
  return problems;
}

/** 解析模板 JSON；失败时给出定位信息而不是抛栈。 */
function parseTemplate(label, text) {
  if (typeof text !== "string") return { problems: [`${label}: 模板必须是 JSON 字符串（实际 ${typeof text}）`] };
  try {
    return { data: JSON.parse(text) };
  } catch (error) {
    return { problems: [`${label}: JSON 解析失败（${error.message}）`] };
  }
}

function templateKeys(text, label, field) {
  const { data, problems } = parseTemplate(label, text);
  if (problems) return problems;
  const value = data && data[field];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [`${label}: 缺少 ${field} 对象`];
  }
  return null; // 交给调用方按键序比较
}

/** scaffold.inspectManifest() → galleries 键序 == constants.GALLERIES。 */
export function checkInspectManifestTemplate(text, expected = GALLERIES) {
  const invalid = templateKeys(text, "scaffold.inspectManifest()", "galleries");
  if (invalid) return invalid;
  return diffOrdered("scaffold.inspectManifest().galleries 键序", Object.keys(JSON.parse(text).galleries), expected);
}

/** scaffold.elementsManifest(name,tier) → elements 键序 == constants.ELEMENT_IDS。 */
export function checkElementsManifestTemplate(text, expected = ELEMENT_IDS) {
  const invalid = templateKeys(text, "scaffold.elementsManifest()", "elements");
  if (invalid) return invalid;
  return diffOrdered("scaffold.elementsManifest().elements 键序", Object.keys(JSON.parse(text).elements), expected);
}

/** scaffold.consumptionManifest() → systems 键序 == constants.SYSTEMS。 */
export function checkConsumptionManifestTemplate(text, expected = SYSTEMS) {
  const invalid = templateKeys(text, "scaffold.consumptionManifest()", "systems");
  if (invalid) return invalid;
  return diffOrdered("scaffold.consumptionManifest().systems 键序", Object.keys(JSON.parse(text).systems), expected);
}

/** 源码出处：消费者必须从 constants 模块 import（模块加载后归零成字面量副本也算漂移）。 */
export function usesImport(source, specifier) {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\bfrom\\s*["']${escaped}["']`).test(source);
}

function checkSourceImport(label, url, specifier) {
  try {
    const source = readFileSync(fileURLToPath(url), "utf8");
    return usesImport(source, specifier) ? [] : [`${label}: 未找到 \`from "${specifier}"\`（未引用单一真源）`];
  } catch (error) {
    return [`${label}: 读取失败（${error.message}）`];
  }
}

// ---------------------------------------------------------------- --all 判等函数
// 输入一律取自真实文件/模块；判等函数保持纯函数，便于负例直接传篡改后的数据。

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** element-manifest.json → galleries 必须与 constants.GALLERIES 同集合同顺序。 */
export function checkManifestGalleries(manifest, expected = GALLERIES) {
  const label = "harness/element-manifest.json: galleries";
  if (!manifest || typeof manifest !== "object") return [`${label}: manifest 必须是对象（实际 ${typeof manifest}）`];
  return diffOrdered(label, manifest.galleries, expected);
}

/** element-manifest.json → elements 恰 18 条，id 顺序等于 constants.ELEMENT_IDS。 */
export function checkManifestElementIds(manifest, expected = ELEMENT_IDS) {
  const label = "harness/element-manifest.json: elements[].id";
  if (!manifest || !Array.isArray(manifest.elements)) return [`${label}: elements 必须是数组（实际 ${typeof (manifest && manifest.elements)}）`];
  const ids = manifest.elements.map((element) => (element && typeof element === "object" ? element.id : undefined));
  return diffOrdered(label, ids, expected);
}

/**
 * element-manifest.json → 每个 element.gallery ∈ constants.GALLERIES。
 * `gallery: null` 只允许出现在声明了 `special` 的行（complete.mjs:207/312 的 inspect-manifest
 * 无展厅行），否则同样是漂移。
 */
export function checkManifestElementGalleries(manifest, expected = GALLERIES) {
  const label = "harness/element-manifest.json: elements[].gallery";
  if (!manifest || !Array.isArray(manifest.elements)) return [`${label}: elements 必须是数组（实际 ${typeof (manifest && manifest.elements)}）`];
  const allowed = new Set(expected);
  const problems = [];
  manifest.elements.forEach((element, index) => {
    const id = element && typeof element === "object" ? element.id : undefined;
    const rowLabel = `${label}[${index}]${id ? ` (id=${id})` : ""}`;
    if (!element || typeof element !== "object") {
      problems.push(`${rowLabel}: 条目必须是对象（实际 ${typeof element}）`);
      return;
    }
    if (element.gallery === null && typeof element.special === "string" && element.special.trim()) return;
    if (typeof element.gallery !== "string" || !allowed.has(element.gallery)) {
      problems.push(`${rowLabel}: ${JSON.stringify(element.gallery)} 不在 GALLERIES（${formatList(expected)}）`);
    }
  });
  return problems;
}

/**
 * element.doc 锚点：`<file>#<fragment>`。
 *   - 文件存在；
 *   - fragment 等于族 id（18 个锚点与 18 族一一对应，不允许两族共用一节）；
 *   - 目标文件存在 `## <fragment>` 二级标题。
 * 锚点总数（成功命中的）必须为 constants.ELEMENT_IDS.length（18）。
 */
export function checkElementDocs(manifest, { root = ROOT, readText = (file) => readFileSync(file, "utf8") } = {}) {
  const label = "harness/element-manifest.json: elements[].doc";
  if (!manifest || !Array.isArray(manifest.elements)) return [`${label}: elements 必须是数组（实际 ${typeof (manifest && manifest.elements)}）`];
  const problems = [];
  let anchors = 0;
  for (const element of manifest.elements) {
    const id = element && typeof element === "object" ? element.id : undefined;
    const rowLabel = `${label}${id ? ` (id=${id})` : ""}`;
    if (!element || typeof element.doc !== "string" || element.doc.trim() === "") {
      problems.push(`${rowLabel}: 缺少 doc 锚点`);
      continue;
    }
    const doc = element.doc.trim();
    const hash = doc.indexOf("#");
    if (hash <= 0 || hash === doc.length - 1) {
      problems.push(`${rowLabel}: ${JSON.stringify(doc)} 不是 <文件>#<标题> 形式`);
      continue;
    }
    const fileRel = doc.slice(0, hash);
    const fragment = doc.slice(hash + 1);
    if (fragment !== id) {
      problems.push(`${rowLabel}: 锚点 fragment ${JSON.stringify(fragment)} 与族 id ${JSON.stringify(id)} 不一致`);
    }
    const file = path.resolve(root, fileRel);
    if (!existsSync(file) || !statSync(file).isFile()) {
      problems.push(`${rowLabel}: 文件 ${fileRel} 不存在`);
      continue;
    }
    let text;
    try {
      text = readText(file);
    } catch (error) {
      problems.push(`${rowLabel}: 读取 ${fileRel} 失败（${error.message}）`);
      continue;
    }
    if (!new RegExp(`^##\\s+${escapeRegExp(fragment)}\\s*$`, "m").test(text)) {
      problems.push(`${rowLabel}: ${fileRel} 缺少二级标题「## ${fragment}」`);
      continue;
    }
    anchors += 1;
  }
  if (anchors !== ELEMENT_IDS.length) {
    problems.push(`${label}: 命中锚点 ${anchors} 个 != ${ELEMENT_IDS.length}`);
  }
  return problems;
}

/** deck 浏览器镜像：INSPECT_GALLERIES 与 createInspectDeck({}).list() 的九厅顺序 == GALLERIES。 */
export function checkDeckRegistry(deckModule, expected = GALLERIES) {
  const label = "assets/inspect-deck.mjs";
  if (!deckModule || typeof deckModule !== "object") return [`${label}: 模块无导出`];
  const problems = [];
  if (!Array.isArray(deckModule.INSPECT_GALLERIES)) {
    problems.push(`${label}: INSPECT_GALLERIES 必须是数组（实际 ${typeof deckModule.INSPECT_GALLERIES}）`);
  } else {
    problems.push(...diffOrdered(`${label}: INSPECT_GALLERIES`, deckModule.INSPECT_GALLERIES, expected));
  }
  if (typeof deckModule.createInspectDeck !== "function") {
    problems.push(`${label}: 缺少 createInspectDeck 导出`);
    return problems;
  }
  let listed;
  try {
    listed = deckModule.createInspectDeck({}).list();
  } catch (error) {
    problems.push(`${label}: createInspectDeck({}).list() 抛错（${error.message}）`);
    return problems;
  }
  if (!Array.isArray(listed)) {
    problems.push(`${label}: createInspectDeck({}).list() 必须返回数组（实际 ${typeof listed}）`);
    return problems;
  }
  problems.push(...diffOrdered(`${label}: createInspectDeck({}).list() 展厅 id`, listed.map((item) => item && item.id), expected));
  return problems;
}

/** scaffold 三份模板：JSON 解析后 galleries/elements/systems 键集 == GALLERIES/ELEMENT_IDS/SYSTEMS。 */
export function checkScaffoldManifests(scaffold, { sampleName = "consistency-all", sampleTier = "full" } = {}) {
  const label = "scripts/scaffold-scene.mjs";
  if (!scaffold || typeof scaffold !== "object") return [`${label}: 模块无导出`];
  const required = ["inspectManifest", "elementsManifest", "consumptionManifest"];
  const missing = required.filter((name) => typeof scaffold[name] !== "function");
  if (missing.length) return [`${label}: 缺少导出纯函数 ${missing.join(", ")}`];
  const templates = [
    { label: `${label}: inspectManifest().galleries`, field: "galleries", expected: GALLERIES, text: () => scaffold.inspectManifest() },
    { label: `${label}: elementsManifest().elements`, field: "elements", expected: ELEMENT_IDS, text: () => scaffold.elementsManifest(sampleName, sampleTier) },
    { label: `${label}: consumptionManifest().systems`, field: "systems", expected: SYSTEMS, text: () => scaffold.consumptionManifest() },
  ];
  const problems = [];
  for (const template of templates) {
    let text;
    try {
      text = template.text();
    } catch (error) {
      problems.push(`${template.label}: 调用抛错（${error.message}）`);
      continue;
    }
    const { data, problems: parseProblems } = parseTemplate(template.label, text);
    if (parseProblems) {
      problems.push(...parseProblems);
      continue;
    }
    const value = data && data[template.field];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      problems.push(`${template.label}: 缺少 ${template.field} 对象`);
      continue;
    }
    problems.push(...diffKeySets(template.label, Object.keys(value), template.expected));
  }
  return problems;
}

/**
 * references/08「九展厅清单」小节里的表格：数据行恰 9 行，行首展厅名集合 == GALLERIES。
 * 只读该二级标题到下一个二级标题之间的表格，避免把文档其它表格算进来。
 */
export function checkGalleryTable(markdown, { label = "references/08-self-inspection.md", heading = "九展厅清单", expected = GALLERIES } = {}) {
  if (typeof markdown !== "string") return [`${label}: 内容必须是字符串（实际 ${typeof markdown}）`];
  const lines = markdown.split(/\r?\n/);
  const headingRe = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`);
  const start = lines.findIndex((line) => headingRe.test(line.trim()));
  if (start < 0) return [`${label}: 缺少「## ${heading}」小节`];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i].trim())) {
      end = i;
      break;
    }
  }
  const names = [];
  for (let i = start + 1; i < end; i += 1) {
    const line = lines[i].trim();
    if (!line.startsWith("|")) continue;
    const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
    if (cells.length < 2) continue;
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue; // 表头分隔行
    if (cells[0] === "展厅" || cells[0].replace(/`/g, "") === "展厅") continue; // 表头
    names.push(cells[0].replace(/`/g, "").trim());
  }
  const problems = [];
  if (names.length !== expected.length) {
    problems.push(`${label}: 「${heading}」表格数据行 ${names.length} != ${expected.length}`);
  }
  problems.push(...diffKeySets(`${label}: 「${heading}」展厅名集合`, names, expected));
  const duplicates = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
  if (duplicates.length) problems.push(`${label}: 「${heading}」展厅名重复 ${formatList(duplicates)}`);
  return problems;
}

/** 单个场景 inspect.manifest.json：galleries 键集 == GALLERIES（顺序可不同）。 */
export function checkExampleManifest(label, data, expected = GALLERIES) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [`${label}: manifest 必须是对象（实际 ${typeof data}）`];
  const galleries = data.galleries;
  if (!galleries || typeof galleries !== "object" || Array.isArray(galleries)) {
    return [`${label}: 缺少 galleries 对象（实际 ${typeof galleries}）`];
  }
  return diffKeySets(`${label}: galleries 键集`, Object.keys(galleries), expected);
}

/** 扫描 examples/<scene>/inspect.manifest.json；返回 { problems, scanned }。 */
export function checkExampleManifests(dir = EXAMPLES_DIR, { readdir = readdirSync, exists = existsSync, read = readFileSync } = {}) {
  let entries;
  try {
    entries = readdir(dir, { withFileTypes: true });
  } catch (error) {
    return { problems: [`examples/: 目录不可读（${error.message}）`], scanned: 0 };
  }
  const scenes = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const problems = [];
  let scanned = 0;
  for (const name of scenes) {
    const file = path.join(dir, name, "inspect.manifest.json");
    if (!exists(file)) continue;
    const label = `examples/${name}/inspect.manifest.json`;
    scanned += 1;
    let data;
    try {
      data = JSON.parse(read(file, "utf8"));
    } catch (error) {
      problems.push(`${label}: 读取/JSON 解析失败（${error.message}）`);
      continue;
    }
    problems.push(...checkExampleManifest(label, data));
  }
  if (scanned === 0) problems.push("examples/*/inspect.manifest.json: 未找到任何场景清单");
  return { problems, scanned };
}

// ---------------------------------------------------------------- --counts 判等
// 计数只认运行时导出与文档里的 upstream/ours 短语。判等函数保持纯函数，
// 负例（后续任务）可直接传入篡改后的计数/文本，不改仓库文件。

/** 运行时计数：SL_MATERIALS 键数 48、HUD_COMPONENTS 项数 10。 */
export function checkRuntimeCounts({ materials, hudComponents } = {}, expected = EXPECTED_COUNTS) {
  const problems = [];
  if (materials === undefined) {
    problems.push("assets/sl-surface.mjs: 未提供 SL_MATERIALS");
  } else {
    const count = materials && typeof materials === "object" ? Object.keys(materials).length : null;
    if (count !== expected.SL_MATERIALS) {
      problems.push(`assets/sl-surface.mjs: SL_MATERIALS ${count === null ? "不是对象" : `${count} 键`} != ${expected.SL_MATERIALS}`);
    }
  }
  if (hudComponents === undefined) {
    problems.push("assets/hud-kit.mjs: 未提供 HUD_COMPONENTS");
  } else {
    const count = Array.isArray(hudComponents) ? hudComponents.length : null;
    if (count !== expected.HUD_COMPONENTS) {
      problems.push(`assets/hud-kit.mjs: HUD_COMPONENTS ${count === null ? "不是数组" : `${count} 项`} != ${expected.HUD_COMPONENTS}`);
    }
  }
  return problems;
}

/** 取 `## <heading>` 到下一个二级标题之间的正文；缺标题返回 null。 */
function sectionBody(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const headingRe = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`);
  const start = lines.findIndex((line) => headingRe.test(line.trim()));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i].trim())) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
}

/**
 * references/11：上游 51 种材质 / 11 个 HUD 组件保留作溯源，我方 48 / 10 写在
 * 摘要与 materials/hud 小节；任何「我方 51/11」都是把上游数误计给我方。
 */
export function checkReferences11Counts(markdown) {
  const label = "references/11-element-parity.md";
  if (typeof markdown !== "string") return [`${label}: 内容必须是字符串（实际 ${typeof markdown}）`];
  const problems = [];
  for (const [name, re] of [
    ["上游 51", /上游\s*51/],
    ["我方 48", /我方\s*48/],
    ["上游 11", /上游\s*11/],
    ["我方 10", /我方\s*10/],
  ]) {
    if (!re.test(markdown)) problems.push(`${label}: 缺少「${name}」计数口径`);
  }
  const materials = sectionBody(markdown, "materials");
  if (materials === null) {
    problems.push(`${label}: 缺少「## materials」小节`);
  } else {
    if (!/我方\s*48/.test(materials)) problems.push(`${label} §materials: 缺少我方 48 个条目（SL_MATERIALS）`);
    if (!/51\s*种/.test(materials)) problems.push(`${label} §materials: 上游「51 种」计数缺失`);
    if (!/\[src:/.test(materials)) problems.push(`${label} §materials: 上游引用句的 [src:...] 缺失`);
  }
  const hud = sectionBody(markdown, "hud");
  if (hud === null) {
    problems.push(`${label}: 缺少「## hud」小节`);
  } else {
    if (!/我方\s*10\s*个?组件/.test(hud)) problems.push(`${label} §hud: 缺少我方 10 个组件（HUD_COMPONENTS）`);
    if (!/上游\s*11/.test(hud)) problems.push(`${label} §hud: 缺少上游 11 个组件的对照口径`);
  }
  markdown.split(/\r?\n/).forEach((line, index) => {
    if (/我方\s*(?:51|11)(?:\s*(?:种|条|个|组件))?/.test(line)) {
      problems.push(`${label}:${index + 1}: 把我方写成 51/11（${line.trim().slice(0, 80)}）`);
    }
  });
  return problems;
}

/**
 * references/12：materials 行产出列「我方 48 条」+ 上游出处列「材质 51 种」；
 * hud 行「我方 10 组件（上游 11）」；「11 组件」若保留必须与「上游」同行。
 */
export function checkReferences12Counts(markdown) {
  const label = "references/12-full-scene-assembly.md";
  if (typeof markdown !== "string") return [`${label}: 内容必须是字符串（实际 ${typeof markdown}）`];
  const problems = [];
  for (const [name, re] of [["我方 48", /我方\s*48/], ["我方 10", /我方\s*10/]]) {
    if (!re.test(markdown)) problems.push(`${label}: 缺少「${name}」计数口径`);
  }
  const lines = markdown.split(/\r?\n/);
  const materialsRow = lines.find((line) => /^\|\s*2\s*\|\s*materials\s*\|/.test(line));
  if (!materialsRow) {
    problems.push(`${label}: 缺少「| 2 | materials |」行`);
  } else {
    if (!/我方\s*48\s*条/.test(materialsRow)) problems.push(`${label} materials 行: 产出列缺少「我方 48 条」`);
    if (!/材质\s*(?:51|五十一)\s*种/.test(materialsRow)) problems.push(`${label} materials 行: 上游出处列缺少「材质 51 种」`);
  }
  const hudRow = lines.find((line) => /^\|\s*12\s*\|\s*hud\s*\|/.test(line));
  if (!hudRow) {
    problems.push(`${label}: 缺少「| 12 | hud |」行`);
  } else {
    if (!/我方\s*10\s*组件/.test(hudRow)) problems.push(`${label} hud 行: 缺少「我方 10 组件」`);
    if (!/上游\s*11/.test(hudRow)) problems.push(`${label} hud 行: 缺少「上游 11」对照`);
  }
  lines.forEach((line, index) => {
    if (/我方\s*(?:51|11)/.test(line)) {
      problems.push(`${label}:${index + 1}: 把我方写成 51/11（${line.trim().slice(0, 80)}）`);
    }
    if (/\b11\s*组件/.test(line) && !/上游/.test(line)) {
      problems.push(`${label}:${index + 1}: 「11 组件」未与「上游」同行（${line.trim().slice(0, 80)}）`);
    }
  });
  return problems;
}

/** examples/parity 三处描述的是我方目录：必须出现 48，且不得再写 51。 */
export function checkParityCounts({ readme, elements, mats } = {}) {
  const problems = [];
  const files = [
    ["examples/parity/README.md", readme],
    ["examples/parity/scene.elements.json", elements],
    ["examples/parity/src/mats.mjs", mats],
  ];
  for (const [label, text] of files) {
    if (typeof text !== "string") {
      problems.push(`${label}: 内容必须是字符串（实际 ${typeof text}）`);
      continue;
    }
    if (!/\b48\b/.test(text)) problems.push(`${label}: 缺少我方材质计数 48`);
    if (/\b51\b/.test(text)) problems.push(`${label}: 仍把我方材质写成 51`);
  }
  return problems;
}

// ---------------------------------------------------------------- 负例夹具（内存）
// 夹具输入一律取自仓库真实文件/模板，只在内存里复制、删除或改写；不写回仓库。
// 若源文件不可读或待篡改的文本不存在，夹具无法成立，记入 setupProblems 让 self-test 判红，
// 而不是让「没有问题的夹具」假装通过。

function readFixtureText(label, file, setup) {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    setup(label, `夹具输入不可读（${error.message}）`);
    return null;
  }
}

function mutateFixtureText(label, source, pattern, replacement, setup) {
  if (typeof source !== "string") return null;
  const text = source.replace(pattern, replacement);
  if (text === source) {
    setup(label, `源文本不匹配 ${pattern}，无法构造负例`);
    return null;
  }
  return text;
}

/**
 * 每个负例都走上面同一套判等函数，断言返回非空 problems。
 * 五类必测负例：缺锚点、画廊不一致、deck 镜像漂移、模板漂移、计数漂移；
 * 另外保留常量形状 / assets 键集 / 模板 JSON / 源码出处。
 *
 * @param {object} [options]
 * @param {{inspect?: string, elements?: string, consumption?: string}|null} [options.templates]
 *        真实的 scaffold 三份模板输出（由 self-test 动态 import 后传入）；缺省时记 setupProblem。
 * @param {string} [options.root] 仓库根，负例输入文件的定位基准。
 * @returns {{cases: Array<{category: string, name: string, rejected: boolean, problems: string[]}>, setupProblems: string[]}}
 */
export function negativeFixtures({ templates = null, root = ROOT } = {}) {
  const cases = [];
  const setupProblems = [];
  const push = (category, name, problems) => cases.push({ category, name, rejected: problems.length > 0, problems });
  const setup = (label, problem) => setupProblems.push(`${label}: ${problem}`);

  // ---- 常量形状被篡改
  push(FIXTURE_CATEGORY.constantsShape, "constants.GALLERIES 少一厅", checkConstantsShape({
    GALLERIES: GALLERIES.slice(0, -1), SYSTEMS, KITS, ELEMENT_IDS,
  }));
  push(FIXTURE_CATEGORY.constantsShape, "constants.ELEMENT_IDS 多一项且重复", checkConstantsShape({
    GALLERIES, SYSTEMS, KITS, ELEMENT_IDS: [...ELEMENT_IDS, ELEMENT_IDS[0]],
  }));
  push(FIXTURE_CATEGORY.constantsShape, "constants.SYSTEMS 混入非字符串", checkConstantsShape({
    GALLERIES, SYSTEMS: [...SYSTEMS.slice(0, -1), 7], KITS, ELEMENT_IDS,
  }));

  // ---- 真实输入（--all / --counts 的同一批文件）
  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync(path.join(root, "harness/element-manifest.json"), "utf8"));
  } catch (error) {
    setup("harness/element-manifest.json", `夹具输入不可读/解析失败（${error.message}）`);
  }
  const reference11 = readFixtureText("references/11-element-parity.md", path.join(root, "references/11-element-parity.md"), setup);
  const reference12 = readFixtureText("references/12-full-scene-assembly.md", path.join(root, "references/12-full-scene-assembly.md"), setup);
  const parityInputs = {
    readme: readFixtureText("examples/parity/README.md", path.join(root, "examples/parity/README.md"), setup),
    elements: readFixtureText("examples/parity/scene.elements.json", path.join(root, "examples/parity/scene.elements.json"), setup),
    mats: readFixtureText("examples/parity/src/mats.mjs", path.join(root, "examples/parity/src/mats.mjs"), setup),
  };

  // ---- 缺锚点：从真实 manifest 删 element.doc、从真实 references/11 删标题
  if (manifest) {
    const cloneManifest = () => JSON.parse(JSON.stringify(manifest));

    const noDoc = cloneManifest();
    delete noDoc.elements[0].doc;
    push(FIXTURE_CATEGORY.missingAnchor, `element.doc 被删除（${noDoc.elements[0].id}）`,
      checkElementDocs(noDoc, { root, readText: () => reference11 }));

    const wrongFragment = cloneManifest();
    wrongFragment.elements[0].doc = `${wrongFragment.elements[0].doc.split("#")[0]}#props-missing`;
    push(FIXTURE_CATEGORY.missingAnchor, "element.doc 的 fragment 指向不存在的标题",
      checkElementDocs(wrongFragment, { root, readText: () => reference11 }));

    if (reference11 !== null) {
      const noHeading = mutateFixtureText("references/11-element-parity.md", reference11,
        /^##[ \t]+materials[ \t]*$/m, "### materials", setup);
      if (noHeading !== null) {
        push(FIXTURE_CATEGORY.missingAnchor, "references/11 的「## materials」标题被删（manifest 未变）",
          checkElementDocs(manifest, { root, readText: () => noHeading }));
      }
    }
  }

  // ---- 画廊不一致：真实 manifest.galleries 少/多键、element.gallery 越界、场景清单少/多键
  if (manifest) {
    push(FIXTURE_CATEGORY.galleryMismatch, "element-manifest galleries 少一键",
      checkManifestGalleries({ ...manifest, galleries: manifest.galleries.slice(0, -1) }));
    push(FIXTURE_CATEGORY.galleryMismatch, "element-manifest galleries 多一键",
      checkManifestGalleries({ ...manifest, galleries: [...manifest.galleries, "roofline"] }));

    const driftedGallery = JSON.parse(JSON.stringify(manifest));
    const row = driftedGallery.elements.find((element) => typeof element.gallery === "string");
    if (row) {
      const original = row.gallery;
      row.gallery = "roofline";
      push(FIXTURE_CATEGORY.galleryMismatch, `element.gallery 越界（${row.id}: ${original} → roofline）`,
        checkManifestElementGalleries(driftedGallery));
    } else {
      setup("harness/element-manifest.json", "没有可篡改的 element.gallery，无法构造越界负例");
    }
  }
  const galleryObject = (ids) => Object.fromEntries(ids.map((id) => [id, { state: "n/a", reason: "" }]));
  push(FIXTURE_CATEGORY.galleryMismatch, "examples 场景清单 galleries 少一厅",
    checkExampleManifest("fixture/inspect.manifest.json", { galleries: galleryObject(GALLERIES.slice(0, -1)) }));
  push(FIXTURE_CATEGORY.galleryMismatch, "examples 场景清单 galleries 多一厅",
    checkExampleManifest("fixture/inspect.manifest.json", { galleries: galleryObject([...GALLERIES, "roofline"]) }));

  // ---- deck 浏览器镜像漂移：INSPECT_GALLERIES 或 list() 任一不一致即判红
  const deckModule = (mirror, listed) => ({
    INSPECT_GALLERIES: mirror,
    createInspectDeck: () => ({ list: () => listed.map((id) => ({ id })) }),
  });
  const driftedMirror = [...GALLERIES];
  driftedMirror[driftedMirror.length - 1] = "roofline";
  push(FIXTURE_CATEGORY.deckMirror, "INSPECT_GALLERIES 尾项漂移（list 正常）",
    checkDeckRegistry(deckModule(driftedMirror, GALLERIES)));
  push(FIXTURE_CATEGORY.deckMirror, "createInspectDeck().list() 少一厅（镜像正常）",
    checkDeckRegistry(deckModule([...GALLERIES], GALLERIES.slice(0, -1))));
  push(FIXTURE_CATEGORY.deckMirror, "INSPECT_GALLERIES 少一厅",
    checkDeckRegistry(deckModule(GALLERIES.slice(0, -1), GALLERIES)));

  // ---- 模板漂移：直接篡改 scaffold 的真实模板输出（JSON 解析后删/加键）
  const mutateTemplate = (label, text, mutator) => {
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      setup(label, `模板输出不是合法 JSON（${error.message}）`);
      return null;
    }
    const copy = JSON.parse(JSON.stringify(data));
    mutator(copy);
    return JSON.stringify(copy);
  };
  if (templates && typeof templates.inspect === "string" && typeof templates.elements === "string" && typeof templates.consumption === "string") {
    const templateCases = [
      { label: "scaffold.inspectManifest()", text: templates.inspect, field: "galleries", expected: GALLERIES, check: checkInspectManifestTemplate, kind: "厅" },
      { label: "scaffold.elementsManifest()", text: templates.elements, field: "elements", expected: ELEMENT_IDS, check: checkElementsManifestTemplate, kind: "族" },
      { label: "scaffold.consumptionManifest()", text: templates.consumption, field: "systems", expected: SYSTEMS, check: checkConsumptionManifestTemplate, kind: "系统" },
    ];
    for (const item of templateCases) {
      const missingKey = item.expected[item.expected.length - 1];
      const missing = mutateTemplate(item.label, item.text, (data) => {
        delete data[item.field][missingKey];
      });
      if (missing !== null) {
        push(FIXTURE_CATEGORY.templateDrift, `${item.label} 删去一${item.kind}（${missingKey}）`, item.check(missing));
      }
      const extra = mutateTemplate(item.label, item.text, (data) => {
        data[item.field].roofline = { state: "n/a", reason: "fixture" };
      });
      if (extra !== null) {
        push(FIXTURE_CATEGORY.templateDrift, `${item.label} 多出一${item.kind}（roofline）`, item.check(extra));
      }
    }
  } else {
    setup("scaffold 三份模板", "未提供真实模板输出，无法构造模板漂移负例");
  }

  // ---- 模板 JSON 损坏 / 缺字段
  push(FIXTURE_CATEGORY.templateJson, "inspect 模板 JSON 损坏", checkInspectManifestTemplate("{not json"));
  push(FIXTURE_CATEGORY.templateJson, "consumption 模板缺 systems 字段", checkConsumptionManifestTemplate(JSON.stringify({ version: 1 })));

  // ---- 计数漂移：运行时把上游 51/11 当成我方真值
  const materialsWith = (count) => Object.fromEntries(Array.from({ length: count }, (_, index) => [`mat-${index}`, {}]));
  const hudWith = (count) => Array.from({ length: count }, (_, index) => ({ id: `hud-${index}` }));
  push(FIXTURE_CATEGORY.countDrift, "运行时 SL_MATERIALS 51 键（上游数计给我方）",
    checkRuntimeCounts({ materials: materialsWith(EXPECTED_COUNTS.SL_MATERIALS + 3), hudComponents: hudWith(EXPECTED_COUNTS.HUD_COMPONENTS) }));
  push(FIXTURE_CATEGORY.countDrift, "运行时 HUD_COMPONENTS 11 项（上游数计给我方）",
    checkRuntimeCounts({ materials: materialsWith(EXPECTED_COUNTS.SL_MATERIALS), hudComponents: hudWith(EXPECTED_COUNTS.HUD_COMPONENTS + 1) }));

  // 文档：把真实 references/11/12 的「我方 48/10」改写成上游 51/11
  if (reference11 !== null) {
    const oursMaterials51 = mutateFixtureText("references/11-element-parity.md", reference11, /我方\s*48/, "我方 51", setup);
    if (oursMaterials51 !== null) {
      push(FIXTURE_CATEGORY.countDrift, "references/11 我方 48 被写成我方 51", checkReferences11Counts(oursMaterials51));
    }
    const oursHud11 = mutateFixtureText("references/11-element-parity.md", reference11, /我方\s*10/, "我方 11 个组件", setup);
    if (oursHud11 !== null) {
      push(FIXTURE_CATEGORY.countDrift, "references/11 我方 10 被写成我方 11", checkReferences11Counts(oursHud11));
    }
  }
  if (reference12 !== null) {
    const oursMaterials51 = mutateFixtureText("references/12-full-scene-assembly.md", reference12, /我方\s*48/, "我方 51", setup);
    if (oursMaterials51 !== null) {
      push(FIXTURE_CATEGORY.countDrift, "references/12 我方 48 被写成我方 51", checkReferences12Counts(oursMaterials51));
    }
    const oursHud11 = mutateFixtureText("references/12-full-scene-assembly.md", reference12, /我方\s*10\s*组件/, "我方 11 组件", setup);
    if (oursHud11 !== null) {
      push(FIXTURE_CATEGORY.countDrift, "references/12 hud 行我方 10 组件被写成我方 11", checkReferences12Counts(oursHud11));
    }
  }
  if (typeof parityInputs.readme === "string" && typeof parityInputs.elements === "string" && typeof parityInputs.mats === "string") {
    const parityDrift = (label, file, pattern) => {
      const text = mutateFixtureText(label, parityInputs[file], pattern, "51", setup);
      if (text === null) return;
      const candidate = { ...parityInputs, [file]: text };
      push(FIXTURE_CATEGORY.countDrift, `${label} 我方 48 被写成 51`, checkParityCounts(candidate));
    };
    parityDrift("examples/parity/README.md", "readme", /\b48\b/);
    parityDrift("examples/parity/scene.elements.json", "elements", /\b48\b/);
    parityDrift("examples/parity/src/mats.mjs", "mats", /\b48\b/);
  } else {
    setup("examples/parity 三处", "parity 文件不齐，无法构造计数漂移负例");
  }

  // ---- 源码出处检查本身也要能判红（避免「有 import 检查但永远绿」）
  push(FIXTURE_CATEGORY.provenance, "fixture 源码未 import constants",
    usesImport("export const GALLERIES = [];", "../constants.mjs") ? [] : ["fixture: 未 import constants"]);

  return { cases, setupProblems };
}

// ---------------------------------------------------------------- self-test

async function selfTest() {
  const checks = [];
  const add = (category, name, problems) => checks.push({ category, name, ok: problems.length === 0, problems });

  add("constants-shape", "constants 四组导出形状", checkConstantsShape({ GALLERIES, SYSTEMS, KITS, ELEMENT_IDS }));

  // 动态 import 消费者：加载失败也作为一条可读的判红，不抛栈中断。
  const modules = {};
  for (const [name, url] of Object.entries(CONSUMER_URLS)) {
    try {
      modules[name] = await import(url.href);
    } catch (error) {
      modules[name] = null;
      add("consumer-load", `消费者可加载：${name}`, [`${url.pathname} import 失败（${error.message}）`]);
    }
  }

  if (modules.inspect) {
    const problems = [];
    if (modules.inspect.GALLERIES !== GALLERIES) {
      problems.push("inspect.GALLERIES 不是 constants.GALLERIES 的同一引用（疑似重新声明了字面量）");
    }
    problems.push(...diffOrdered("inspect.GALLERIES", modules.inspect.GALLERIES, GALLERIES));
    add("consumer-drift", "inspect.mjs 引用 constants.GALLERIES", problems);
  }

  if (modules.assets) {
    add("consumer-drift", "assets.mjs SYSTEMS 键集 == constants.SYSTEMS",
      diffKeySets("assets.mjs SYSTEMS keys", Object.keys(modules.assets.SYSTEMS || {}), SYSTEMS));
    add("consumer-drift", "assets.mjs KITS 键集 == constants.KITS",
      diffKeySets("assets.mjs KITS keys", Object.keys(modules.assets.KITS || {}), KITS));
  }

  if (modules.deck) {
    add("consumer-drift", "inspect-deck.mjs INSPECT_GALLERIES 镜像",
      diffOrdered("INSPECT_GALLERIES", modules.deck.INSPECT_GALLERIES, GALLERIES));
  }

  if (modules.scaffold) {
    const { inspectManifest, elementsManifest, consumptionManifest } = modules.scaffold;
    const missing = ["inspectManifest", "elementsManifest", "consumptionManifest"]
      .filter((fn) => typeof modules.scaffold[fn] !== "function");
    add("consumer-drift", "scaffold.mjs 导出三份纯函数",
      missing.length ? [`缺少导出：${missing.join(", ")}`] : []);
    if (!missing.length) {
      add("consumer-drift", "scaffold.inspectManifest() 键集 == GALLERIES",
        checkInspectManifestTemplate(inspectManifest()));
      add("consumer-drift", "scaffold.elementsManifest() 键集 == ELEMENT_IDS",
        checkElementsManifestTemplate(elementsManifest("consistency-selftest", "full")));
      add("consumer-drift", "scaffold.consumptionManifest() 键集 == SYSTEMS",
        checkConsumptionManifestTemplate(consumptionManifest()));
    }
  }

  for (const [label, { url, specifier }] of Object.entries(CONSTANTS_IMPORTS)) {
    add("provenance", `${label} import 自 ${specifier}`, checkSourceImport(label, url, specifier));
  }

  // 夹具输入必须来自真实文件：真实 manifest.galleries / element.doc 当前为绿，
  // 后面的「删除」负例才是在证明门禁读文件而不是拿常量拷贝顶替。
  let fixtureManifest = null;
  try {
    fixtureManifest = JSON.parse(readFileSync(ELEMENT_MANIFEST_FILE, "utf8"));
  } catch (error) {
    add("fixture-inputs", "harness/element-manifest.json 可读取（负例输入）", [`harness/element-manifest.json: 读取失败（${error.message}）`]);
  }
  if (fixtureManifest) {
    add("fixture-inputs", "真实 manifest.galleries 当前为绿（负例输入）", checkManifestGalleries(fixtureManifest));
    add("fixture-inputs", "真实 manifest.elements 当前为绿（负例输入）", checkManifestElementIds(fixtureManifest));
    add("fixture-inputs", "真实 element.doc 锚点当前为绿（负例输入）", checkElementDocs(fixtureManifest));
  }

  let templates = null;
  if (modules.scaffold && ["inspectManifest", "elementsManifest", "consumptionManifest"]
    .every((name) => typeof modules.scaffold[name] === "function")) {
    try {
      templates = {
        inspect: modules.scaffold.inspectManifest(),
        elements: modules.scaffold.elementsManifest("consistency-selftest", "full"),
        consumption: modules.scaffold.consumptionManifest(),
      };
    } catch (error) {
      add("fixture-inputs", "scaffold 模板可生成（负例输入）", [`scaffold 模板生成抛错（${error.message}）`]);
    }
  }

  const { cases: negatives, setupProblems } = negativeFixtures({ templates });
  const categoryCounts = new Map();
  for (const item of negatives) {
    categoryCounts.set(item.category, (categoryCounts.get(item.category) || 0) + 1);
  }
  const missingCategories = REQUIRED_FIXTURE_CATEGORIES.filter((category) => !categoryCounts.has(category));

  const checkProblems = checks.flatMap((check) => check.problems.map((problem) => `${check.name}: ${problem}`));
  const missedNegatives = negatives
    .filter((item) => !item.rejected)
    .map((item) => `${item.category} / ${item.name}: 负例未被拒绝（判等函数漏检）`);
  const problems = [
    ...checkProblems,
    ...missedNegatives,
    ...missingCategories.map((category) => `缺少负例类别：${category}`),
    ...setupProblems.map((problem) => `负例夹具无法构造：${problem}`),
  ];
  const ok = problems.length === 0;

  console.log(JSON.stringify({
    mode: "self-test",
    ok,
    checks,
    negativeCategories: Object.fromEntries(categoryCounts),
    negatives,
    setupProblems,
    problems,
  }, null, 1));
  for (const problem of problems) console.error(`consistency --self-test: ${problem}`);
  console.log(`consistency gate --self-test: ${checks.length} checks, ${negatives.length} negative fixtures — ${ok ? "OK" : "FAILED"}`);
  console.log(`negative fixtures by category: ${[...categoryCounts.entries()].map(([category, count]) => `${category}=${count}`).join(", ")}`);
  for (const item of negatives) {
    console.log(`  [${item.rejected ? "rejected" : "MISSED"}] ${item.category}: ${item.name}`);
  }
  return ok ? 0 : 1;
}

// ---------------------------------------------------------------- --all

async function importConsumer(url, label, add) {
  try {
    return await import(url.href);
  } catch (error) {
    add(`${label} 可加载`, [`${label}: import 失败（${error.message}）`]);
    return null;
  }
}

async function all() {
  const checks = [];
  const add = (name, problems) => checks.push({ name, ok: problems.length === 0, problems });

  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync(ELEMENT_MANIFEST_FILE, "utf8"));
  } catch (error) {
    add("harness/element-manifest.json 可读取", [`harness/element-manifest.json: 读取/JSON 解析失败（${error.message}）`]);
  }
  if (manifest) {
    add("element-manifest galleries 顺序 == constants.GALLERIES", checkManifestGalleries(manifest));
    add("element-manifest elements 18 族与顺序 == constants.ELEMENT_IDS", checkManifestElementIds(manifest));
    add("element-manifest element.gallery ∈ constants.GALLERIES", checkManifestElementGalleries(manifest));
    add("18 个 element.doc 锚点命中 references/11 二级标题", checkElementDocs(manifest));
  }

  const deck = await importConsumer(CONSUMER_URLS.deck, "assets/inspect-deck.mjs", add);
  if (deck) add("inspect-deck 注册表 == constants.GALLERIES", checkDeckRegistry(deck));

  const scaffold = await importConsumer(CONSUMER_URLS.scaffold, "scripts/scaffold-scene.mjs", add);
  if (scaffold) add("scaffold 三份模板键集 == constants", checkScaffoldManifests(scaffold));

  const tableLabel = "references/08-self-inspection.md 九展厅清单表 == constants.GALLERIES";
  try {
    add(tableLabel, checkGalleryTable(readFileSync(SELF_INSPECTION_FILE, "utf8")));
  } catch (error) {
    add(tableLabel, [`references/08-self-inspection.md: 读取失败（${error.message}）`]);
  }

  const examples = checkExampleManifests(EXAMPLES_DIR);
  add(`examples/*/inspect.manifest.json galleries 键集（${examples.scanned} 个场景）`, examples.problems);

  const problems = checks.flatMap((check) => check.problems);
  const ok = checks.length > 0 && checks.every((check) => check.ok);
  console.log(JSON.stringify({ mode: "all", ok, checks, problems }, null, 1));
  for (const problem of problems) console.error(`consistency --all: ${problem}`);
  console.log(`consistency gate --all: ${checks.length} checks — ${ok ? "OK" : "FAILED"}`);
  return ok ? 0 : 1;
}

// ---------------------------------------------------------------- --counts

async function counts() {
  const checks = [];
  const add = (name, problems) => checks.push({ name, ok: problems.length === 0, problems });

  let runtime = null;
  try {
    const [surface, hud] = await Promise.all([
      import(COUNTS_ASSET_URLS.surface.href),
      import(COUNTS_ASSET_URLS.hud.href),
    ]);
    runtime = { materials: surface.SL_MATERIALS, hudComponents: hud.HUD_COMPONENTS };
  } catch (error) {
    add("运行时资产可加载（只读 import）", [`assets/sl-surface.mjs / assets/hud-kit.mjs import 失败（${error.message}）`]);
  }
  if (runtime) add("运行时计数 SL_MATERIALS 48 / HUD_COMPONENTS 10", checkRuntimeCounts(runtime));

  const read = (label) => {
    try {
      return readFileSync(COUNTS_INPUTS[label], "utf8");
    } catch (error) {
      add(`${label} 可读取`, [`${label}: 读取失败（${error.message}）`]);
      return null;
    }
  };

  const reference11 = read("references/11-element-parity.md");
  if (reference11 !== null) add("references/11 上游 51/11 + 我方 48/10", checkReferences11Counts(reference11));

  const reference12 = read("references/12-full-scene-assembly.md");
  if (reference12 !== null) add("references/12 上游 51/11 + 我方 48/10", checkReferences12Counts(reference12));

  add("examples/parity 三处我方材质 48", checkParityCounts({
    readme: read("examples/parity/README.md"),
    elements: read("examples/parity/scene.elements.json"),
    mats: read("examples/parity/src/mats.mjs"),
  }));

  const problems = checks.flatMap((check) => check.problems);
  const ok = checks.length > 0 && checks.every((check) => check.ok);
  console.log(JSON.stringify({ mode: "counts", ok, checks, problems }, null, 1));
  for (const problem of problems) console.error(`consistency --counts: ${problem}`);
  console.log(`consistency gate --counts: ${checks.length} checks — ${ok ? "OK" : "FAILED"}`);
  return ok ? 0 : 1;
}

export async function main(argv) {
  if (argv.includes("--self-test")) return selfTest();
  if (argv.includes("--all")) return all();
  if (argv.includes("--counts")) return counts();
  console.error("usage: node harness/gates/consistency.mjs --self-test | --all | --counts");
  return 2;
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
  });
}
