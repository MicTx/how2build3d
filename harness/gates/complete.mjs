/**
 * harness/gates/complete.mjs — 元素对账门禁（同水准合同）。
 *
 * 回答一个问题：这个场景「该有的元素」是不是真的都有，而且量够？
 *   - 上游有什么、下限多少：harness/element-manifest.json
 *   - 本场景声称有什么：<scene>/scene.elements.json（每族 used / n-a + 理由 + 替代证据）
 *   - 实际做了多少：运行时 window.__PARITY__.counts（几何/材质/规格表/布点的实测计数）
 *
 * 三类判红：
 *   1. 结构：清单缺族、state 非法、n-a 无理由或替代证据不存在、tier 广度不足
 *      （tier=full ≥15 族 used，visual ≥5，game ≥3——靠堆 n-a 过不了）。
 *   2. 下限：仅 tier=full 强制（或 --enforce-floors）。used 族的每个 floor 指标
 *      缺失或低于 min 即红；required:false 的只警告。
 *   3. 证据：used 族对应的展厅必须在 inspect.manifest.json 里 used、被 deck 注册、
 *      且 evidence/inspect/<scene>-<gallery>[-2|-3].png 三张截图齐全。
 *   4. 资产交叉校验（P1）：elements[].asset 必须与 assets 门禁的消费结论一致——
 *      used 元素在 assets 门禁里不得是 missing/n-a；n-a 元素不得被资产门禁判成 used。
 *   5. R0 场景门禁（--require-r0 显式开关）：调用 gates/r0.mjs 的场景校验
 *      （R0.md 或 evidence/references/manifest.md 的 来源/覆盖矩阵/16 类/GAP/对拍），
 *      problems 并入本报告；默认关闭，不改变 parity/gameplay 的既有结论。
 *
 * CLI（严格解析：未知 flag 一律退出 2，不再静默忽略）:
 *   node harness/gates/complete.mjs --self-test
 *   node harness/gates/complete.mjs --scene examples/parity
 *   node harness/gates/complete.mjs --scene <dir> --structure-only      # 不 build、不开浏览器
 *   node harness/gates/complete.mjs --scene <dir> --structure-only --no-evidence
 *                                                                        # 干净 checkout/CI：跳过截图存在性检查
 *   node harness/gates/complete.mjs --scene <dir> --structure-only --no-evidence --require-r0
 *                                                                        # 叠加 R0 场景门禁（quality 已备样例）
 *   node harness/gates/complete.mjs --scene <dir> --enforce-floors      # 对 visual/game 档也套下限
 *   node harness/gates/complete.mjs --scene <dir> --json
 *
 * 配套：references/11-element-parity.md（逐族解释）、references/12-full-scene-assembly.md（装配顺序）。
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, mkdtempSync, rmSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";

import { launchFixture, snapshot } from "../boot.mjs";
import { GALLERIES, validateManifest } from "./inspect.mjs";
import { checkScene, gateKeyForAsset, sceneReferencesAsset } from "./assets.mjs";
import { checkR0Scene } from "./r0.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ELEMENT_MANIFEST = path.join(ROOT, "harness/element-manifest.json");
const STATES = new Set(["used", "n/a"]);
const EVIDENCE_SHOTS = 3;

const USAGE = "usage: node harness/gates/complete.mjs --scene <dir> [--structure-only [--no-evidence]] [--require-r0] [--enforce-floors] [--json] | --self-test";

/** 已知 CLI flag（严格解析：白名单之外的 --xxx 一律拒绝，防「门禁空转」——
 *  此前 --require-r0 被静默忽略、exit 0，属于假绿（spec 2026-11-19 A3/Decision）。 */
const KNOWN_FLAGS = new Set(["--self-test", "--scene", "--structure-only", "--no-evidence", "--require-r0", "--enforce-floors", "--json"]);

/** 严格参数解析：未知 flag / --scene 缺参 返回 { error }；正常返回 { opts }。 */
export function parseArgs(argv) {
  const unknown = argv.filter((arg) => arg.startsWith("--") && !KNOWN_FLAGS.has(arg));
  if (unknown.length) return { error: `unknown flag(s): ${unknown.join(", ")}（已知：${[...KNOWN_FLAGS].join(" ")}）` };
  const idx = argv.indexOf("--scene");
  let scene = null;
  if (idx >= 0) {
    const value = argv[idx + 1];
    if (!value || value.startsWith("--")) return { error: "--scene 需要一个场景目录参数" };
    scene = value;
  }
  const opts = {
    selfTest: argv.includes("--self-test"),
    scene,
    structureOnly: argv.includes("--structure-only"),
    requireEvidence: !argv.includes("--no-evidence"),
    requireR0: argv.includes("--require-r0"),
    enforceFloors: argv.includes("--enforce-floors"),
    json: argv.includes("--json"),
  };
  if (!opts.selfTest && !opts.scene) return { error: `missing --scene <dir>\n${USAGE}` };
  return { opts };
}

function loadJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** 结构校验：清单齐全、state 合法、n-a 有理由与替代证据、tier 与广度达标。
 *  `requireEvidence:false` 只用于无 Chrome 的干净 checkout（verify --static）：
 *  n/a 仍须声明 evidence 路径，但不检查文件是否存在——截图是运行产物，不入库。 */
export function validateDeclaration(manifest, declaration, { root = ROOT, requireEvidence = true } = {}) {
  const problems = [];
  const warnings = [];
  const elements = declaration && declaration.elements;
  if (!elements || typeof elements !== "object") {
    return { problems: ["scene.elements.json: elements must be an object"], warnings };
  }
  const tiers = manifest.tiers || {};
  const tier = declaration.tier || "full";
  const tierRule = tiers[tier];
  if (!tierRule) {
    problems.push(`scene.elements.json: tier 必须是 ${Object.keys(tiers).filter((k) => !k.startsWith("$")).join(" / ")} 之一（当前 ${JSON.stringify(tier)}）`);
  } else {
    const usedCount = Object.values(elements).filter((e) => e && e.state === "used").length;
    if (usedCount < (tierRule.minUsed ?? 1)) {
      problems.push(`tier=${tier} 要求至少 ${tierRule.minUsed} 个族 used，当前只有 ${usedCount} 个——靠堆 n-a 过不了`);
    }
  }
  const known = new Set(manifest.elements.map((e) => e.id));
  for (const id of Object.keys(elements)) {
    if (!known.has(id)) problems.push(`scene.elements.json: 未知元素族 "${id}"（清单里没有）`);
  }
  for (const element of manifest.elements) {
    const entry = elements[element.id];
    if (!entry || typeof entry !== "object") {
      problems.push(`missing element: ${element.id}（${element.name}）`);
      continue;
    }
    if (!STATES.has(entry.state)) {
      problems.push(`${element.id}: state 必须是 "used" 或 "n/a"（当前 ${JSON.stringify(entry.state)}）`);
      continue;
    }
    if (entry.state === "n/a") {
      if (!entry.reason || !String(entry.reason).trim()) {
        problems.push(`${element.id}: n/a 必须写 reason（为什么不适用）`);
      } else if (/^(todo|tbd|待补|待定)/i.test(String(entry.reason).trim())) {
        problems.push(`${element.id}: n/a 的 reason 仍是占位文本（${entry.reason}）`);
      }
      if (!entry.evidence || !String(entry.evidence).trim()) {
        problems.push(`${element.id}: n/a 必须给 evidence（替代展厅的截图路径）`);
      } else if (requireEvidence) {
        const evidencePath = path.isAbsolute(entry.evidence) ? entry.evidence : path.join(root, entry.evidence);
        if (!existsSync(evidencePath)) {
          problems.push(`${element.id}: n/a 的 evidence 不存在（${entry.evidence}）`);
        } else if (statSync(evidencePath).size < 4000) {
          warnings.push(`${element.id}: n/a 的 evidence 过小（${statSync(evidencePath).size}B）`);
        }
        if (!/^evidence\//.test(String(entry.evidence))) {
          warnings.push(`${element.id}: evidence 建议放在 evidence/ 下（当前 ${entry.evidence}）`);
        }
      }
    }
  }
  return { problems, warnings };
}

/** 单族下限判定。counts 是 window.__PARITY__.counts 的扁平表。 */
export function evaluateFloors(element, counts) {
  const checks = [];
  const problems = [];
  const warnings = [];
  for (const floor of element.floors || []) {
    const raw = counts ? counts[floor.metric] : undefined;
    const actual = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    const required = floor.required !== false;
    const pass = actual != null && actual >= floor.min;
    checks.push({ metric: floor.metric, label: floor.label, min: floor.min, actual, required, pass });
    if (pass) continue;
    const detail = `${element.id}.${floor.metric}（${floor.label}）= ${actual == null ? "未上报" : actual} < ${floor.min}`;
    if (required) problems.push(detail);
    else warnings.push(`${detail}（可选指标）`);
  }
  return { checks, problems, warnings };
}

function sceneName(sceneRel) {
  return path.basename(path.resolve(ROOT, sceneRel));
}

function evidenceShotsFor(scene, gallery) {
  const base = path.join(ROOT, "evidence/inspect");
  const files = [`${scene}-${gallery}.png`, `${scene}-${gallery}-2.png`, `${scene}-${gallery}-3.png`];
  return files.map((name) => {
    const abs = path.join(base, name);
    return { file: path.relative(ROOT, abs), exists: existsSync(abs), bytes: existsSync(abs) ? statSync(abs).size : 0 };
  });
}

/**
 * 与资产门禁交叉校验（P1）：元素清单的 `elements[].asset` 是唯一真源。
 *  - used 元素：资产门禁必须给出 used 结论（八系统/八 kit）；链路资产（level/combat/inspect-deck）
 *    不在两张表里，退化为「同一语料里是否原样引用资产文件」。
 *  - n/a 元素：资产门禁若检测到该资产被消费，就是申报与代码矛盾，判红。
 * 资产门禁自身的其它问题（缺 consumption、八系统未消费）只记 warning，不在这里二次判红——
 * 那是 assets 门禁的职责，避免两套门禁互相放大。
 */
function crossCheckAssets(sceneRel, declaration, manifest) {
  const problems = [];
  const warnings = [];
  let gate = null;
  try {
    gate = checkScene(sceneRel);
  } catch (e) {
    warnings.push(`资产门禁无法运行：${e.message}`);
    return { problems, warnings };
  }
  if (gate.problems.length) {
    warnings.push(`资产门禁本场景另有 ${gate.problems.length} 个问题（缺 consumption/系统等）；元素交叉校验只比对各资产消费结论`);
  }
  const stateOf = (key) => gate.detail.systems[key] ?? gate.detail.kits[key];
  for (const element of manifest.elements) {
    const entry = declaration?.elements?.[element.id];
    if (!entry) continue;
    const key = gateKeyForAsset(element.asset);
    const state = key ? stateOf(key) : null;
    const usedByGate = key ? typeof state === "string" && state.startsWith("used") : sceneReferencesAsset(sceneRel, element.asset);
    if (entry.state === "used" && !usedByGate) {
      problems.push(`${element.id}: 声明 used，但资产门禁结论 ${key ? `${key}=${state || "unknown"}` : `${element.asset} 未被本场景引用`}——元素清单与资产消费不一致`);
    } else if (entry.state === "n/a" && usedByGate) {
      problems.push(`${element.id}: 声明 n/a，但资产门禁检测到 ${key ? `${key}=${state}` : `${element.asset} 被本场景引用`}——申报与代码矛盾`);
    }
  }
  return { problems, warnings };
}

/** 结构 + 证据（不 build、不开浏览器）：脚手架与 CI 的快速检查。
 *  `requireEvidence:false`（CLI `--no-evidence`）跳过截图文件存在性检查，
 *  供干净 checkout / 无 Chrome CI 使用；全量模式仍检查截图。
 *  `requireR0:true`（CLI `--require-r0`）叠加 R0 场景门禁（gates/r0.mjs 的
 *  场景校验），problems 并入本报告；默认关闭以保持既有结论不变。 */
export function auditStructure(sceneRel, { requireEvidence = true, requireR0 = false } = {}) {
  const manifest = loadJson(ELEMENT_MANIFEST);
  const sceneDir = path.isAbsolute(sceneRel) ? sceneRel : path.join(ROOT, sceneRel);
  const declPath = path.join(sceneDir, "scene.elements.json");
  const inspectPath = path.join(sceneDir, "inspect.manifest.json");
  const problems = [];
  const warnings = [];
  const r0 = requireR0 ? checkR0Scene(sceneDir) : null;
  const r0Problems = r0 && !r0.ok ? r0.problems : [];
  if (!existsSync(declPath)) {
    return {
      ok: false,
      problems: [`missing ${path.relative(ROOT, declPath)}`, ...r0Problems],
      warnings,
      results: [],
      ...(r0 ? { r0 } : {}),
    };
  }
  const declaration = loadJson(declPath);
  const v = validateDeclaration(manifest, declaration, { requireEvidence });
  problems.push(...v.problems);
  warnings.push(...v.warnings);
  const cross = crossCheckAssets(sceneRel, declaration, manifest);
  problems.push(...cross.problems);
  warnings.push(...cross.warnings);

  const scene = sceneName(sceneRel);
  let inspectManifest = null;
  if (!existsSync(inspectPath)) problems.push(`missing ${path.relative(ROOT, inspectPath)}`);
  else {
    inspectManifest = loadJson(inspectPath);
    for (const p of validateManifest(inspectManifest)) problems.push(`inspect.manifest.json: ${p}`);
  }

  const results = [];
  for (const element of manifest.elements) {
    const entry = declaration.elements?.[element.id] || {};
    const row = { id: element.id, name: element.name, state: entry.state, gallery: element.gallery, problems: [], warnings: [] };
    if (entry.state === "used" && element.gallery) {
      const galleryState = inspectManifest?.galleries?.[element.gallery]?.state;
      if (galleryState !== "used") {
        row.problems.push(`展厅 ${element.gallery} 在 inspect.manifest.json 里不是 used（当前 ${galleryState}）——元素 used 却没有可拍的展台`);
      }
      if (requireEvidence) {
        const shots = evidenceShotsFor(scene, element.gallery);
        const missing = shots.filter((s) => !s.exists || s.bytes < 8000);
        row.evidence = shots;
        if (missing.length) {
          row.problems.push(`展厅 ${element.gallery} 的截图证据缺 ${missing.length}/${EVIDENCE_SHOTS} 张（跑 inspect 门禁生成）`);
        }
      }
    }
    if (element.special === "inspect-manifest" && inspectManifest) {
      const usedCount = GALLERIES.filter((id) => inspectManifest.galleries?.[id]?.state === "used").length;
      row.galleriesUsed = usedCount;
    }
    row.problems.forEach((p) => problems.push(`${element.id}: ${p}`));
    row.warnings.forEach((w) => warnings.push(`${element.id}: ${w}`));
    results.push(row);
  }
  problems.push(...r0Problems);
  return { ok: problems.length === 0, scene: sceneRel, problems, warnings, results, declaration, ...(r0 ? { r0 } : {}) };
}

async function auditScene(sceneRel, { enforceFloors: forceFloors = false, requireR0 = false } = {}) {
  const structural = auditStructure(sceneRel, { requireR0 });
  const sceneDir = path.join(ROOT, sceneRel);
  const buildScript = path.join(sceneDir, "build.mjs");
  if (!existsSync(buildScript)) {
    return { ...structural, ok: false, problems: [...structural.problems, `missing build.mjs in ${sceneRel}`] };
  }
  execFileSync(process.execPath, [buildScript, "--assert"], { cwd: ROOT, stdio: "inherit" });
  const html = path.join(ROOT, "build", sceneName(sceneRel), "index.html");
  if (!existsSync(html)) {
    return { ...structural, ok: false, problems: [...structural.problems, `build did not produce ${path.relative(ROOT, html)}`] };
  }

  const session = await launchFixture({
    url: `${pathToFileURL(html).href}?bench&seed=4207`,
    waitMs: 3000,
    viewport: [800, 450],
  });
  let runtime = null;
  try {
    await snapshot(session.page, { heartbeatMs: 500 });
    runtime = await session.page.evaluate(() => ({
      parity: window.__PARITY__ || null,
      deck: window.__INSPECT_DECK__ || null,
      stats: window.__stats ? window.__stats() : null,
      errors: (window.__errors || []).slice(-5),
    }));
  } finally {
    await session.close();
  }

  const manifest = loadJson(ELEMENT_MANIFEST);
  const counts = runtime?.parity?.counts || null;
  const tier = structural.declaration.tier || "full";
  const enforceFloors = forceFloors || Boolean(manifest.tiers?.[tier]?.enforceFloors);
  const problems = [...structural.problems];
  const warnings = [...structural.warnings];
  if (enforceFloors && !counts) problems.push("window.__PARITY__.counts 缺失——同水准下限无法核对（见 references/12 的检视钩子契约）");
  if (!counts) warnings.push("未上报 window.__PARITY__：跳过全部数量下限（仅 full 档强制）");
  if (runtime?.errors?.length) problems.push(`render errors: ${runtime.errors.length}`);

  const results = structural.results.map((row) => {
    const element = manifest.elements.find((e) => e.id === row.id);
    const entry = structural.declaration.elements?.[row.id] || {};
    if (entry.state !== "used") return row;
    if (!enforceFloors) return row;
    const floorResult = evaluateFloors(element, counts);
    floorResult.problems.forEach((p) => problems.push(p));
    floorResult.warnings.forEach((w) => warnings.push(w));
    if (element.gallery && runtime?.deck && Array.isArray(runtime.deck.galleries) && !runtime.deck.galleries.includes(element.gallery)) {
      problems.push(`${row.id}: 展厅 ${element.gallery} 未在 __INSPECT_DECK__ 注册`);
    }
    return { ...row, floors: floorResult.checks };
  });

  const report = {
    generatedAt: new Date().toISOString(),
    scene: sceneRel,
    ok: problems.length === 0,
    counts,
    stats: runtime?.stats || null,
    problems,
    warnings,
    results,
    ...(structural.r0 ? { r0: structural.r0 } : {}),
  };
  const outDir = path.join(ROOT, "evidence/parity");
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${sceneName(sceneRel)}.json`);
  writeFileSync(outFile, `${JSON.stringify(report, null, 1)}\n`);
  return { ...report, evidence: path.relative(ROOT, outFile) };
}

function selfTest() {
  const problems = [];
  const manifest = {
    tiers: { visual: { minUsed: 5 }, game: { minUsed: 3 }, full: { minUsed: 15, enforceFloors: true } },
    elements: [
      { id: "props", name: "道具", gallery: "props", floors: [{ metric: "propKinds", min: 12, label: "种类" }, { metric: "placedProps", min: 60, label: "实例" }] },
      { id: "audio", name: "音频", gallery: "fx", floors: [{ metric: "soundSpecs", min: 16, label: "规格" }, { metric: "musicParts", min: 1, label: "声部", required: false }] },
      { id: "inspect", name: "展厅", gallery: null, special: "inspect-manifest", floors: [] },
    ],
  };
  const good = {
    tier: "game",
    elements: { props: { state: "used" }, audio: { state: "used" }, inspect: { state: "used" } },
  };
  if (validateDeclaration(manifest, good).problems.length) problems.push("positive declaration rejected");
  const badMissing = { tier: "game", elements: { props: { state: "used" } } };
  if (!validateDeclaration(manifest, badMissing).problems.some((p) => p.includes("audio"))) problems.push("missing element not rejected");
  const badState = { tier: "game", elements: { ...good.elements, props: { state: "partial" } } };
  if (!validateDeclaration(manifest, badState).problems.some((p) => p.includes("state"))) problems.push("bad state not rejected");
  const naNoReason = { tier: "game", elements: { ...good.elements, props: { state: "n/a" } } };
  if (!validateDeclaration(manifest, naNoReason).problems.some((p) => p.includes("reason"))) problems.push("n/a without reason not rejected");
  const naNoEvidence = { tier: "game", elements: { ...good.elements, props: { state: "n/a", reason: "本场景无道具" } } };
  if (!validateDeclaration(manifest, naNoEvidence).problems.some((p) => p.includes("evidence"))) problems.push("n/a without evidence not rejected");
  const placeholder = { tier: "game", elements: { ...good.elements, props: { state: "n/a", reason: "TODO", evidence: "evidence/inspect/x.png" } } };
  if (!validateDeclaration(manifest, placeholder).problems.some((p) => p.includes("占位"))) problems.push("placeholder reason not rejected");
  const badTier = { tier: "epic", elements: good.elements };
  if (!validateDeclaration(manifest, badTier).problems.some((p) => p.includes("tier"))) problems.push("unknown tier not rejected");
  const narrowFull = { tier: "full", elements: good.elements };
  if (!validateDeclaration(manifest, narrowFull).problems.some((p) => p.includes("至少"))) problems.push("full tier breadth floor not enforced");

  const props = manifest.elements[0];
  if (evaluateFloors(props, { propKinds: 20, placedProps: 90 }).problems.length) problems.push("dense counts should pass floors");
  if (!evaluateFloors(props, { propKinds: 4, placedProps: 90 }).problems.length) problems.push("sparse counts must fail floors");
  if (!evaluateFloors(props, null).problems.length) problems.push("missing counts must fail floors");
  const audio = manifest.elements[1];
  const audioResult = evaluateFloors(audio, { soundSpecs: 40, musicParts: 0 });
  if (audioResult.problems.length) problems.push("optional floor must not fail");
  if (!audioResult.warnings.length) problems.push("optional floor miss should warn");

  // --require-r0：合成场景（全 n/a 申报、无 R0 产物）在 requireR0 下必须判红；
  // 默认模式不跑 R0 门禁，既有结论不变（spec F2/Decision：显式开关，仅 quality 先接入）。
  const tmpScene = mkdtempSync(path.join(tmpdir(), "h2b-complete-r0-"));
  try {
    const realManifest = loadJson(ELEMENT_MANIFEST);
    const naDecl = {
      tier: "game",
      elements: Object.fromEntries(
        realManifest.elements.map((e) => [e.id, { state: "n/a", reason: "自检合成场景，不适用", evidence: "evidence/inspect/selftest.png" }])
      ),
    };
    writeFileSync(path.join(tmpScene, "scene.elements.json"), `${JSON.stringify(naDecl, null, 1)}\n`);
    const plain = auditStructure(tmpScene, { requireEvidence: false });
    if (plain.problems.some((p) => p.includes("R0"))) problems.push("R0 gate must not run without --require-r0");
    const withR0 = auditStructure(tmpScene, { requireEvidence: false, requireR0: true });
    if (withR0.ok || !withR0.problems.some((p) => p.includes("R0"))) {
      problems.push("missing R0 artifact not rejected under --require-r0");
    }
  } finally {
    rmSync(tmpScene, { recursive: true, force: true });
  }

  // 严格参数解析：未知 flag 被拒绝（此前被静默忽略并 exit 0，属假绿）
  if (!parseArgs(["--scene", "examples/quality", "--structure-only", "--no-evidence", "--bogus"]).error) {
    problems.push("unknown flag not rejected");
  }
  const okParse = parseArgs(["--scene", "examples/quality", "--structure-only", "--no-evidence", "--require-r0"]);
  if (okParse.error || !okParse.opts.requireR0) problems.push("--require-r0 not parsed (composable with --structure-only/--no-evidence)");
  const selfParse = parseArgs(["--self-test"]);
  if (selfParse.error || !selfParse.opts.selfTest) problems.push("--self-test not parsed");

  if (problems.length) {
    console.error(`complete gate --self-test FAILED: ${problems.join("; ")}`);
    return 1;
  }
  console.log("complete gate --self-test OK: 结构/理由/证据/下限/可选指标 正负样例 + --require-r0 缺 R0 判红 + 未知 flag 拒绝 全部成立");
  return 0;
}

export async function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    console.error(`complete gate: ${parsed.error}`);
    if (!parsed.error.includes("usage")) console.error(USAGE);
    return 2;
  }
  const { opts } = parsed;
  if (opts.selfTest) return selfTest();
  const scene = opts.scene;
  if (opts.structureOnly && !opts.requireEvidence) {
    console.error("complete gate: EVIDENCE NOT CHECKED（--no-evidence：截图证据未校验；需 inspect 生成后用完整模式复核）");
  }
  if (opts.requireR0) {
    console.error("complete gate: R0 SCENE GATE ENABLED（--require-r0：场景 R0 产物缺失或不合格即红）");
  }
  const report = opts.structureOnly
    ? auditStructure(scene, { requireEvidence: opts.requireEvidence, requireR0: opts.requireR0 })
    : await auditScene(scene, { enforceFloors: opts.enforceFloors, requireR0: opts.requireR0 });
  console.log(JSON.stringify(report, null, 1));
  const used = (report.results || []).filter((r) => r.state === "used").length;
  const na = (report.results || []).filter((r) => r.state === "n/a").length;
  console.log(`complete gate: ${used} used / ${na} n-a — ${report.ok ? "OK" : "FAILED"}`);
  if (!report.ok) {
    for (const problem of report.problems.slice(0, 12)) console.error(`  ✗ ${problem}`);
    return 1;
  }
  return 0;
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) main(process.argv.slice(2)).then((code) => process.exit(code), (error) => { console.error(error); process.exit(error.exitCode ?? 1); });
