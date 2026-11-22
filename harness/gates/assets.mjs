/**
 * harness/gates/assets.mjs — 资产消费门禁。
 *
 * 校验一个场景是否消费了 skill 的资产层。两种通过方式：
 *  1) 场景源码/本场景构建产物中出现资产 marker（默认质量基线要求全部命中）；
 *  2) 场景根有 `assets.consumption.json`，逐系统声明 used / "N/A: <理由>"。
 *     声明本身不是证据：声明 used 的系统仍要 marker 命中，或场景源码**真实读入**整个
 *     资产文件（`readAsset("assets/<file>")` / `readFileSync(...)` / `import(...)`，
 *     见 `SYSTEM_ASSETS`——按文件读入即等价于全套符号内联；注释/散文里提到文件名不算）。
 *
 * 证据语料（P1 收紧）：只收**本场景目录的 .mjs/.js** 与 **build/<scene>/*.html**，
 * 且在判定前剥掉 JS/HTML 注释（注释里的 marker、工厂名与资产名一律不算证据）。
 * 不再收集 .md/.json（README/申报文件里提一嘴资产名不算消费），也不再扫 ROOT/build 下
 * 其它场景的产物（隔壁场景的 marker 不能给本场景背书）。
 *
 * 三类系统，语义不同：
 *  - `SYSTEMS`（八系统，必需）：渲染链基线，质量场景必须全部消费；判据 = marker 全中，
 *    或源码**真实读入**该资产文件（`SYSTEM_ASSETS`，按文件原样读入 GLSL 的场景不会出现
 *    shader 内部符号）。
 *  - `OPTIONAL_SYSTEMS`（可选 pass）：同为 GLSL pass 资产但不在渲染链基线上
 *    （sea 只有海景场景消费），判据同八系统，没消费记 `missing(optional)` 不判红。
 *  - `KITS`（元素 kit，按场景可选）：props-kit / fx-kit / audio-kit / weapon-kit /
 *    enemy-kit / player-kit / hud-kit / weather-kit 这类能力只属于用到它的场景——观感样板
 *    申报 props/decals/fx/audio 为 n/a 是合法的（见 examples/quality/scene.elements.json）。
 *    判据：场景出现工厂调用（`factory`）就必须整套 marker 命中（防「贴个名字就自称消费」的
 *    半接线）；完全不出现则记 `missing(optional)`，不判红；manifest 显式声明 used 的仍要求 marker 全中。
 *    未声明时允许第二证据：工厂被调用 + 场景**真实读入**整份 kit 资产文件（`assets/<kit>.mjs`，
 *    构建期内联的 kit 在源码里不出现内部常量，但整套资产确实被读入）——只读文件不调工厂不算，
 *    注释里提到资产名也不算。
 *    场景 `scene.elements.json` 把对应元素族写 n/a 的，记 `n/a(declared:族)` 不算消费——但若代码里
 *    真的调了工厂，就是申报与代码矛盾，判红。
 *
 * `assets.consumption.json` 必填场景（按场景目录名）：quality / parity / gameplay。缺文件即判红。
 *
 * 负向断言（防「重写资产层」反模式）：如果场景自建 post 后处理但既不消费 post-chain
 * 也不声明 N/A，则失败。
 *
 * CLI:
 *   node harness/gates/assets.mjs --scene examples/quality
 *   node harness/gates/assets.mjs --scene examples/starter --allow-missing   （骨架豁免）
 *   node harness/gates/assets.mjs --self-test     （六个负样例 + 两个正样例，全在临时目录）
 */
import { readFileSync, existsSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";

// 键清单的单一真源；本文件只保留 markers / asset 等检测语义字段。
import { SYSTEMS as CONSTANT_SYSTEMS, KITS as CONSTANT_KITS } from "../constants.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SYSTEMS = {
  "sl-surface": ["SL_SURFACE", "SL_MATERIALS", "injectSLSurface", "uSlWet"],
  "sl-textures": ["SL_TEX", "SL_GENERATORS", "createTextureFactory"],
  "post-chain": ["SALTLINE_POST", "slAgx"],
  "post-aa": ["uFxaa", "hash12"],
  "pcss-shadow": ["SALTLINE_SHADOW", "slVogel"],
  // SSR_WET_RR_BEGIN 是 assets/ssr-wet.glsl 的反射块切块标记：场景必须按标记从资产切块注入，
  // 不能在内嵌副本里重写数学（examples/{quality,parity}/build.mjs 做切块）。
  "ssr-wet": ["gBicubic", "uRefl", "gPuddle", "SSR_WET_RR_BEGIN"],
  shafts: ["SALTLINE_POST vol", "VOL_STEPS", "uSunRad"],
  "sky-deck": ["SALTLINE_SKY", "fbm5", "uSunCol"],
};

/**
 * 资产文件名作为第二证据：按文件原样读入资产的场景（`readAsset("assets/post-aa.glsl")`，
 * 见 examples/quality/build.mjs:20）源码里不会出现 shader 内部符号（`hash12`/`slVogel`
 * 只活在 .glsl 里），只查符号是假红。引用资产文件 = 原样消费，不算重写。
 */
const SYSTEM_ASSETS = {
  "sl-surface": "sl-surface.mjs",
  "sl-textures": "sl-textures.mjs",
  "post-chain": "post-chain.glsl",
  "post-aa": "post-aa.glsl",
  "pcss-shadow": "pcss-shadow.glsl",
  "ssr-wet": "ssr-wet.glsl",
  shafts: "shafts.glsl",
  "sky-deck": "sky-deck.glsl",
};

/**
 * 可选 GLSL pass。与八系统同为 pass 资产，但不属于渲染链基线——只有海景场景才消费，
 * 缺了不判红；判据同八系统（marker 全中或引用资产文件）。场景在 `scene.elements.json` 里把
 * 对应族写 n/a 时直接记 `n/a(declared:…)`（压过「散文里提到资产名」的伪证据）。
 */
const OPTIONAL_SYSTEMS = {
  sea: {
    markers: ["saltline-sea-1", "SEA_GLITTER", "SEA_NORMAL", "uSunDirW"],
    asset: "sea.glsl",
  },
};

/**
 * 元素 kit（八件）。marker 取 kit 内真实导出名（见 assets/index.md 第五节）：
 * `factory` 是接线证据——场景一旦调用工厂，就必须整套 marker 命中。
 * 场景源码引用（非本次语料）不足以证明半接线，必须靠 marker 或本场景构建产物。
 */
const KITS = {
  "props-kit": {
    factory: "createPropsKit",
    markers: ["createPropsKit", "PROP_SIZES", "DECAL_SPECS", "BUILDER_NAMES"],
    asset: "props-kit.mjs",
  },
  "fx-kit": {
    factory: "createFxKit",
    markers: ["createFxKit", "FX_POOL_SPEC", "FX_KINDS", "FX_ATLAS"],
    asset: "fx-kit.mjs",
  },
  "audio-kit": {
    factory: "createAudioKit",
    markers: ["createAudioKit", "AUDIO_SPECS", "AUDIO_BUSES", "AUDIO_BUDGET"],
    asset: "audio-kit.mjs",
  },
  "weapon-kit": {
    factory: "createWeaponKit",
    markers: ["createWeaponKit", "WEAPON_ANCHORS", "WEAPON_SPRINGS", "WEAPON_PARTS"],
    asset: "weapon-kit.mjs",
  },
  "enemy-kit": {
    factory: "createEnemyKit",
    markers: ["createEnemyKit", "ENEMY_TUNE_DEFAULTS", "HIT_ZONES", "SKELETONS"],
    asset: "enemy-kit.mjs",
  },
  "player-kit": {
    factory: "createPlayerKit",
    markers: ["createPlayerKit", "PLAYER_TUNE_DEFAULTS", "KEY_ACTIONS", "INPUT_MODES"],
    asset: "player-kit.mjs",
  },
  "hud-kit": {
    factory: "createHudKit",
    markers: ["createHudKit", "HUD_TOKENS", "HUD_COMPONENTS", "HUD_CSS"],
    asset: "hud-kit.mjs",
  },
  "weather-kit": {
    factory: "createWeatherKit",
    markers: ["createWeatherKit", "WEATHER_POOL_SPEC", "WEATHER_TUNE_DEFAULTS", "WEATHER_DRAW_CALLS"],
    asset: "weather-kit.mjs",
  },
};

/**
 * 键集合同：SYSTEMS/KITS 的键清单由 harness/constants.mjs 供给，markers/factory/asset
 * 等检测字段仍留在本文件。模块加载即断言，任何一侧增删键都会立刻失败，检测逻辑不变。
 */
function assertConstantKeys(label, registry, expected) {
  const actual = Object.keys(registry);
  const missing = expected.filter((key) => !Object.prototype.hasOwnProperty.call(registry, key));
  const extra = actual.filter((key) => !expected.includes(key));
  if (missing.length || extra.length) {
    throw new Error(
      `assets.mjs ${label} 键集与 harness/constants.mjs 不一致（missing: ${missing.join(", ") || "-"}；extra: ${extra.join(", ") || "-"}）`,
    );
  }
}

assertConstantKeys("SYSTEMS", SYSTEMS, CONSTANT_SYSTEMS);
assertConstantKeys("KITS", KITS, CONSTANT_KITS);

// 供 consistency.mjs 判等；对象内容仍只在本文件维护。
export { SYSTEMS, KITS };

/**
 * 元素族映射：把 kit / 可选 pass 对到 `scene.elements.json` 的族名（references/11 的 18 族合同）。
 * `player-kit` 没有独立族（装配表第 7 层列为「—」），故不在此表。
 */
const ELEMENT_OF = {
  sea: "sea",
  "props-kit": "props",
  "fx-kit": "fx",
  "audio-kit": "audio",
  "weapon-kit": "weapon",
  "enemy-kit": "enemies",
  "hud-kit": "hud",
  "weather-kit": "weather",
};

/** 资产文件 → 门禁键（complete.mjs 用元素清单的 `asset` 字段交叉校验）。 */
export const ASSET_GATE_KEYS = Object.freeze(Object.fromEntries([
  ...Object.entries(SYSTEM_ASSETS).map(([key, file]) => ["assets/" + file, key]),
  ...Object.entries(OPTIONAL_SYSTEMS).map(([key, spec]) => ["assets/" + spec.asset, key]),
  ...Object.entries(KITS).map(([key, spec]) => ["assets/" + spec.asset, key]),
]));

export function gateKeyForAsset(assetRel) {
  return ASSET_GATE_KEYS[assetRel] || null;
}

/** 必填 assets.consumption.json 的场景（目录名；quality/parity/gameplay 是对外宣称的消费样本）。 */
const REQUIRED_CONSUMPTION = new Set(["quality", "parity", "gameplay"]);

/**
 * 可选声明：场景 `scene.elements.json` 把该族写 n/a 即视为「本场景不要求这个能力」。
 * 这压过「散文里提到资产名」的伪证据——examples/quality 的 sea 理由是「堆场内景没有海面」，
 * 名字出现在申报文件里但场景并没有海面。
 */
function declaredNA(elementsDecl, name) {
  const fam = ELEMENT_OF[name];
  const d = fam && elementsDecl ? elementsDecl[fam] : null;
  return d && d.state === "n/a" ? `n/a(declared:${fam})` : null;
}

/**
 * 证据语料：本场景目录的 .mjs/.js + 本场景构建产物 build/<scene>/*.html。
 * 刻意排除 .md / .json（申报与散文不是消费）和 ROOT/build 下其它场景的产物。
 */
function collectSource(dir) {
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      if (f === "node_modules" || f === ".git" || f === "build") continue;
      const p = path.join(d, f);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(mjs|js)$/.test(f)) files.push(p);
    }
  };
  walk(dir);
  const sceneBuild = path.join(ROOT, "build", path.basename(dir));
  if (existsSync(sceneBuild)) {
    for (const f of readdirSync(sceneBuild)) {
      if (f.endsWith(".html")) files.push(path.join(sceneBuild, f));
    }
  }
  return files;
}

/**
 * 去掉 JS/HTML 注释：声明 used 的第二证据必须是**代码里的真实读入**，
 * 不能靠 README/注释里提一句资产文件名（P1 验收明确「declared used 仍须 marker 命中」）。
 * 简单状态机保留字符串/模板字面量内容，去掉 //、块注释与 <!-- -->。
 */
function stripComments(text) {
  let out = "";
  let state = "code";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (state === "code") {
      if (ch === "/" && next === "/") { state = "line"; i += 2; continue; }
      if (ch === "/" && next === "*") { state = "block"; i += 2; continue; }
      if (ch === "<" && text.startsWith("<!--", i)) { state = "html"; i += 4; continue; }
      out += ch;
      if (ch === "'") state = "single";
      else if (ch === '"') state = "double";
      else if (ch === "`") state = "template";
      i += 1;
      continue;
    }
    if (state === "line") {
      if (ch === "\n") { out += "\n"; state = "code"; }
      i += 1;
      continue;
    }
    if (state === "block") {
      if (ch === "*" && next === "/") { state = "code"; i += 2; }
      else { if (ch === "\n") out += "\n"; i += 1; }
      continue;
    }
    if (state === "html") {
      if (ch === "-" && text.startsWith("-->", i)) { state = "code"; i += 3; }
      else { if (ch === "\n") out += "\n"; i += 1; }
      continue;
    }
    // 字符串/模板字面量：保留内容（其中的资产路径才是有效代码证据）
    out += ch;
    if (ch === "\\" && i + 1 < text.length) { out += text[i + 1]; i += 2; continue; }
    if ((state === "single" && ch === "'") || (state === "double" && ch === '"') || (state === "template" && ch === "`")) state = "code";
    i += 1;
  }
  return out;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 真实读入证据：资产路径必须是代码里的带引号字面量，且处于读入调用中：
 *  - 直接：readAsset("assets/x") / readFileSync(..., "assets/x", ...) / import("assets/x")；
 *  - 间接：路径作为对象映射值（parity 的 KITS），且存在 readAsset(变量) 的读入调用。
 * 注释里出现资产名不再算证据（见 stripComments）。
 */
function hasReadEvidence(code, asset) {
  if (!asset) return false;
  const esc = escapeRegExp(asset);
  // 允许带路径前缀的字面量：assets/sl-surface.mjs、../assets/sl-surface.mjs 都算；
  // 也允许调用方只传入文件名（SYSTEM_ASSETS / KITS 的口径）。
  const quoted = new RegExp(`["'\`](?:[^"'\`]*\\/)?${esc}["'\`]`);
  if (!quoted.test(code)) return false;
  const direct = new RegExp(
    `(?:readAsset|readFileSync)\\s*\\([^)]*["'\`](?:[^"'\`]*\\/)?${esc}["'\`]|import\\s*\\(\\s*["'\`][^"'\`]*${esc}["'\`]\\s*\\)`,
  );
  if (direct.test(code)) return true;
  const indirectRead = /(?:readAsset|readFileSync)\s*\(\s*[A-Za-z_$][A-Za-z0-9_$]*\s*\)/.test(code);
  const asValue = new RegExp(`:\\s*["'\`](?:[^"'\`]*\\/)?${esc}["'\`]`).test(code);
  return indirectRead && asValue;
}

/** marker 优先；缺失时只接受代码里的真实读入证据（注释/散文不算）。 */
function evidenceFor(code, markers, asset) {
  const missing = markers.filter((m) => !code.includes(m));
  if (missing.length === 0) return { state: "used", missing };
  if (hasReadEvidence(code, asset)) return { state: `used(asset:${asset})`, missing };
  return { state: null, missing };
}

/**
 * 元素清单（complete.mjs）用的交叉校验：该场景的证据语料里是否**真实读入**某资产文件。
 * 与主门禁共用同一套 collectSource 规则（场景 .mjs/.js + build/<scene>/*.html），
 * 覆盖八系统/八 kit 之外的链路资产（level-kit / combat-kit / inspect-deck 等）。
 */
export function sceneReferencesAsset(sceneDir, assetRel) {
  if (!assetRel) return false;
  const dir = path.resolve(ROOT, sceneDir);
  let raw = "";
  for (const f of collectSource(dir)) raw += "\n" + readFileSync(f, "utf8");
  return hasReadEvidence(stripComments(raw), assetRel);
}

export function checkScene(sceneDir, { allowMissing = false } = {}) {
  const dir = path.resolve(ROOT, sceneDir);
  const sceneName = path.basename(dir);
  const problems = [];
  const detail = { scene: sceneDir, systems: {}, kits: {}, mode: "markers" };

  const consumptionPath = path.join(dir, "assets.consumption.json");
  const consumptionRequired = REQUIRED_CONSUMPTION.has(sceneName);
  let declared = null;
  if (existsSync(consumptionPath)) {
    detail.mode = "manifest";
    try {
      declared = JSON.parse(readFileSync(consumptionPath, "utf8")).systems || {};
    } catch (e) {
      problems.push(`assets.consumption.json 解析失败: ${e.message}`);
    }
  } else if (consumptionRequired) {
    problems.push(`缺 assets.consumption.json：${sceneDir} 是必填消费清单场景（quality/parity/gameplay 必须逐系统声明 used / N/A 与理由）`);
  }

  // 场景自己的元素申报（references/11 的 scene.elements.json）：n/a 的族不算消费。
  let elementsDecl = null;
  const elementsPath = path.join(dir, "scene.elements.json");
  if (existsSync(elementsPath)) {
    try {
      elementsDecl = JSON.parse(readFileSync(elementsPath, "utf8")).elements || null;
    } catch (e) {
      problems.push(`scene.elements.json 解析失败: ${e.message}`);
    }
  }

  let raw = "";
  for (const f of collectSource(dir)) raw += "\n" + readFileSync(f, "utf8");
  // marker/factory/读入证据都只看代码：注释里的名字不构成消费或接线证据。
  const corpus = stripComments(raw);

  for (const [name, markers] of Object.entries(SYSTEMS)) {
    if (declared) {
      const v = declared[name];
      if (v === undefined) problems.push(`manifest 缺系统声明: ${name}`);
      else if (v === "used") {
        // 声明本身不是证据：仍须 marker 命中（或原样引用资产文件）。
        const ev = evidenceFor(corpus, markers, SYSTEM_ASSETS[name]);
        if (!ev.state) {
          problems.push(`系统 ${name} 在 manifest 声明 used 但无消费证据（缺 marker: ${ev.missing.join(", ")}，且未引用 assets/${SYSTEM_ASSETS[name]}）`);
        } else {
          detail.systems[name] = ev.state;
        }
      } else if (typeof v === "string" && v.startsWith("N/A")) detail.systems[name] = v;
      else problems.push(`系统 ${name} 声明非法: ${JSON.stringify(v)}（应为 used 或 "N/A: 理由"）`);
      continue;
    }
    const ev = evidenceFor(corpus, markers, SYSTEM_ASSETS[name]);
    if (ev.state) detail.systems[name] = ev.state;
    else if (allowMissing) detail.systems[name] = "missing(allowed)";
    else problems.push(`系统 ${name} 未被消费（缺 marker: ${ev.missing.join(", ")}）——先查 assets/index.md，重写资产层是反模式`);
  }

  // 可选 GLSL pass：同八系统的判据，但缺席不判红（不做渲染链基线的场景不需要海面）。
  for (const [name, spec] of Object.entries(OPTIONAL_SYSTEMS)) {
    const decl = declared ? declared[name] : undefined;
    if (typeof decl === "string" && decl === "used") {
      const ev = evidenceFor(corpus, spec.markers, spec.asset);
      if (!ev.state) problems.push(`可选系统 ${name} 在 manifest 声明 used 但无消费证据（缺 marker: ${ev.missing.join(", ")}，且未引用 assets/${spec.asset}）`);
      else detail.systems[name] = ev.state;
      continue;
    }
    if (typeof decl === "string" && decl.startsWith("N/A")) {
      detail.systems[name] = decl;
      continue;
    }
    const na = declaredNA(elementsDecl, name);
    if (na) {
      detail.systems[name] = na;
      continue;
    }
    const ev = evidenceFor(corpus, spec.markers, spec.asset);
    if (ev.state) detail.systems[name] = ev.state;
    else detail.systems[name] = allowMissing ? "missing(allowed)" : "missing(optional)";
  }

  // 元素 kit：可选（不要求的场景记 missing(optional)）；但场景调用了工厂就必须整套接线。
  for (const [name, spec] of Object.entries(KITS)) {
    const decl = declared ? declared[name] : undefined;
    if (typeof decl === "string" && decl.startsWith("N/A")) {
      detail.kits[name] = decl;
      continue;
    }
    const na = declaredNA(elementsDecl, name);
    if (na) {
      // 申报 n/a 却真的调了工厂 = 申报与代码矛盾，仍要红。
      if (corpus.includes(spec.factory)) {
        problems.push(`kit ${name}（assets/${spec.asset}）在 scene.elements.json 申报 n/a（${ELEMENT_OF[name]} 族）却调用了 ${spec.factory}——申报与代码矛盾`);
      } else {
        detail.kits[name] = na;
      }
      continue;
    }
    const ev = evidenceFor(corpus, spec.markers, spec.asset);
    const factorySeen = corpus.includes(spec.factory);
    // marker 全中，或（未声明 used 时）工厂被调用 + 整份 kit 资产被原样引用。
    if (ev.state === "used" || (ev.state && factorySeen && decl !== "used")) {
      detail.kits[name] = ev.state;
      continue;
    }
    if (decl === "used") {
      problems.push(`kit ${name} 在 assets.consumption.json 声明 used 但缺 marker: ${ev.missing.join(", ")}`);
    } else if (factorySeen) {
      problems.push(`kit ${name}（assets/${spec.asset}）半接线（源码调用 ${spec.factory}，缺 marker: ${ev.missing.join(", ")}）——要么整套消费，要么别引用`);
    } else {
      detail.kits[name] = allowMissing ? "missing(allowed)" : "missing(optional)";
    }
  }

  // 负向：自建后处理但没有消费 post-chain / 声明 N/A
  const hasOwnPost = corpus.includes("ShaderMaterial") && /post|bloom/i.test(corpus);
  const postDeclared = declared ? !!declared["post-chain"] : detail.systems["post-chain"] === "used";
  if (hasOwnPost && !postDeclared && !allowMissing) {
    problems.push("检测到自建后处理但未消费 post-chain（观感断崖第一因）");
  }

  return { detail, problems };
}

/* ============================== 自检 ============================== */

function runCase(name, dir, expect) {
  const { detail, problems } = checkScene(dir);
  const red = problems.length > 0;
  const hit = typeof expect === "string" ? problems.some((p) => p.includes(expect)) : true;
  return {
    name,
    expected: expect === true ? "green" : `red + "${expect}"`,
    ok: expect === true ? !red : red && hit,
    problems: problems.slice(0, 3),
    mode: detail.mode,
  };
}

/**
 * 负样例必须全红：
 *  1) 空目录（没有任何消费证据）；
 *  2) 仅 README（把全部 marker 写进 .md——旧语料会把它们当消费，新规必须忽略）；
 *  3) 仅申报（assets.consumption.json 全 used，但没有任何源码/产物证据）；
 *  4) 半接线（系统齐全、调用 createPropsKit 但缺整套 kit marker）；
 *  5) 仅申报 + 资产名注释（注释不是真实读入证据）；
 *  6) 半接线 + 资产名注释（注释不能补齐 marker）。
 * 正样例证明 marker 与真实 readAsset 两条路径都能绿，门禁不是「永远红」。
 */
export function selfTest() {
  const tmp = mkdtempSync(path.join(tmpdir(), "h2b-assets-selftest-"));
  const cases = [];
  const mk = (name) => {
    const d = path.join(tmp, name);
    mkdirSync(d, { recursive: true });
    return d;
  };
  const allSystemMarkers = Object.values(SYSTEMS).flat();
  const allKitMarkers = Object.values(KITS).flatMap((spec) => spec.markers);
  try {
    const empty = mk("fixture-empty");
    cases.push(runCase("空目录", empty, "未被消费"));

    const readmeOnly = mk("fixture-readme-only");
    writeFileSync(path.join(readmeOnly, "README.md"), [
      "# 只有散文",
      ...allSystemMarkers,
      ...allKitMarkers,
      ...Object.values(SYSTEM_ASSETS),
      ...Object.values(KITS).map((spec) => spec.asset),
    ].join("\n"));
    cases.push(runCase("仅 README（.md 语料不计消费）", readmeOnly, "未被消费"));

    const declaredOnly = mk("fixture-declared-only");
    writeFileSync(path.join(declaredOnly, "assets.consumption.json"), JSON.stringify({
      version: 1,
      systems: Object.fromEntries(Object.keys(SYSTEMS).map((k) => [k, "used"])),
    }, null, 1));
    cases.push(runCase("仅申报（声明不等于消费）", declaredOnly, "声明 used 但无消费证据"));

    const halfWired = mk("fixture-half-wired");
    writeFileSync(path.join(halfWired, "assets.consumption.json"), JSON.stringify({
      version: 1,
      systems: Object.fromEntries(Object.keys(SYSTEMS).map((k) => [k, "used"])),
    }, null, 1));
    writeFileSync(path.join(halfWired, "scene.mjs"), ["// fixture: 系统全套接线，但 props kit 只露一个名字", ...allSystemMarkers, "createPropsKit();"].join("\n"));
    cases.push(runCase("半接线（工厂在、kit marker 不全）", halfWired, "半接线"));

    const declaredComment = mk("fixture-declared-comment");
    writeFileSync(path.join(declaredComment, "assets.consumption.json"), JSON.stringify({
      version: 1,
      systems: Object.fromEntries(Object.keys(SYSTEMS).map((k) => [k, "used"])),
    }, null, 1));
    writeFileSync(path.join(declaredComment, "scene.mjs"), "// 假证据：注释里提一句 assets/ssr-wet.glsl 不算读入\n");
    cases.push(runCase("仅申报 + 资产名注释（注释不是读入证据）", declaredComment, "声明 used 但无消费证据"));

    const halfWiredComment = mk("fixture-half-wired-comment");
    writeFileSync(path.join(halfWiredComment, "assets.consumption.json"), JSON.stringify({
      version: 1,
      systems: Object.fromEntries(Object.keys(SYSTEMS).map((k) => [k, "used"])),
    }, null, 1));
    writeFileSync(path.join(halfWiredComment, "scene.mjs"), [
      `// 假接线：${allKitMarkers.join(" ")} assets/props-kit.mjs`,
      ...allSystemMarkers,
      "createPropsKit();",
    ].join("\n"));
    cases.push(runCase("半接线 + 资产名注释（注释不能补齐 marker）", halfWiredComment, "半接线"));

    const positive = mk("fixture-positive");
    writeFileSync(path.join(positive, "scene.mjs"), ["// fixture: 全 marker", ...allSystemMarkers, ...allKitMarkers].join("\n"));
    cases.push(runCase("正样例（全套 marker）", positive, true));

    const realRead = mk("fixture-real-read");
    writeFileSync(path.join(realRead, "assets.consumption.json"), JSON.stringify({
      version: 1,
      systems: Object.fromEntries(Object.keys(SYSTEMS).map((k) => [k, "used"])),
    }, null, 1));
    writeFileSync(path.join(realRead, "scene.mjs"), Object.values(SYSTEM_ASSETS).map((a) => `readAsset("assets/${a}");`).join("\n"));
    cases.push(runCase("正样例（真实 readAsset 读入，无 marker）", realRead, true));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  const failed = cases.filter((c) => !c.ok);
  console.log(JSON.stringify({ selfTest: true, ok: failed.length === 0, cases, problems: failed.map((c) => c.name) }, null, 1));
  if (failed.length) {
    console.error(`assets gate --self-test FAILED: ${failed.map((c) => c.name).join(" / ")}`);
    return 1;
  }
  console.log("assets gate --self-test OK: 空目录/仅 README/仅申报/仅申报+资产名注释/半接线/半接线+资产名注释 六个负样例全部判红，正样例（marker 与真实 readAsset 两条路径）为绿");
  return 0;
}

function main(argv) {
  if (argv.includes("--self-test")) return selfTest();
  const idx = argv.indexOf("--scene");
  const scene = idx >= 0 ? argv[idx + 1] : "examples/quality";
  if (!scene) {
    console.error("usage: node harness/gates/assets.mjs --scene <dir> [--allow-missing] | --self-test");
    return 2;
  }
  const allowMissing = argv.includes("--allow-missing");
  const { detail, problems } = checkScene(scene, { allowMissing });
  console.log(JSON.stringify({ ...detail, problems }, null, 1));
  if (problems.length) {
    console.error(`check-assets FAILED: ${problems.length} problem(s)`);
    return 1;
  }
  return 0;
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) process.exit(main(process.argv.slice(2)));
