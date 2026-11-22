/**
 * harness/gates/inspect.mjs — 九展厅自检门禁。
 *
 * 两道检查：
 *   1. 静态：场景的 inspect.manifest.json 必须九键齐全，且每键是 used 或 n/a（带理由）。
 *   2. 动态：对每个 used 展厅真实加载 `?show=<gallery>&shot&bench`，断言
 *      `__G.showcase` 对齐、`__INSPECT_DECK__` 存在、渲染 0 错误、截图过感知下限，
 *      并每厅留三张证据截图（默认机位 + `__setShot` fov 45 / 74 两个变体）：
 *        evidence/inspect/<scene>-<gallery>.png / -2.png / -3.png
 *      `references/08` 的「每厅 ≥3 张编号截图」由此落实；complete.mjs 会数这三张。
 *
 * CLI:
 *   node harness/gates/inspect.mjs --self-test
 *   node harness/gates/inspect.mjs --scene examples/quality
 *   node harness/gates/inspect.mjs --scene examples/quality --min-used 3
 *   node harness/gates/inspect.mjs --scene <dir> --manifest-only   # 只校验清单 + 覆盖阈值，不开浏览器
 *   node harness/gates/inspect.mjs --scene examples/quality --dump-session <file>
 *                          # 仅 live 模式：把规范化会话写盘（schema=how2build3d/inspect-session@1；
 *                          # scene/seed/generatedAt/minUsed/results）。前置：系统 Chrome
 *                          # （/usr/bin/google-chrome）+ 可写 build/、evidence/
 *   node harness/gates/inspect.mjs --replay <file> [--min-used n]
 *                          # 离线重放：不启动 Chrome，对记录的 results 复跑同一断言函数
 *                          # （assertEvidence 证据截图元数据 + validateCoverage 九厅覆盖），
 *                          # 并合并录制时的 live-only 判定；可重复 exit 0/1，篡改判红
 *
 * 覆盖阈值（fail-closed）：used 展厅数低于 --min-used（默认 3）判红；
 * 全 n/a 清单即使每条理由齐全也判红。--manifest-only 供无 Chrome 的静态链/
 * 负样例夹具使用（只读 <scene>/inspect.manifest.json）。
 *
 * 背景与协议见 references/08-self-inspection.md；框架见 assets/inspect-deck.mjs。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, mkdtempSync, rmSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";

import { launchFixture, snapshot } from "../boot.mjs";
import { analyzeImage } from "./visual.mjs";
// 九展厅清单的单一真源是 harness/constants.mjs；这里 import 后原样 re-export，
// 保持 `harness/gates/complete.mjs:37` 的 `import { GALLERIES }` 不变（V6）。
import { GALLERIES } from "../constants.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export { GALLERIES };
const STATES = new Set(["used", "n/a"]);

/** 校验场景清单：九键齐全、state 合法、n/a 必须有理由。 */
export function validateManifest(manifest) {
  const problems = [];
  if (!manifest || typeof manifest !== "object") return ["manifest must be an object"];
  const galleries = manifest.galleries;
  if (!galleries || typeof galleries !== "object") return ["manifest.galleries must be an object"];
  for (const id of GALLERIES) {
    const entry = galleries[id];
    if (!entry || typeof entry !== "object") {
      problems.push(`missing gallery: ${id}`);
      continue;
    }
    if (!STATES.has(entry.state)) problems.push(`${id}: state must be "used" or "n/a"`);
    if (entry.state === "n/a" && (!entry.reason || !String(entry.reason).trim())) {
      problems.push(`${id}: n/a requires a reason`);
    }
  }
  const extra = Object.keys(galleries).filter((key) => !GALLERIES.includes(key));
  if (extra.length) problems.push(`unknown gallery keys: ${extra.join(", ")}`);
  return problems;
}

/** 默认 used 展厅下限：examples/gameplay 当前 3 used/6 n-a，阈值不得高于 3。 */
export const DEFAULT_MIN_USED = 3;

/** 覆盖阈值：used 展厅数低于 minUsed（含全 n/a）判红。 */
export function validateCoverage(results, { minUsed = DEFAULT_MIN_USED } = {}) {
  const used = results.filter((item) => item.state === "used").length;
  const na = results.length - used;
  const problems = [];
  if (used < minUsed) {
    problems.push(`used galleries ${used} < minUsed ${minUsed}（全 n/a 或展厅覆盖过低）`);
  }
  return { used, na, minUsed, problems };
}

/* ---- 规范化会话（dump/replay）---- */

/** 会话 schema：dump/replay 的稳定契约（2026-11-19_skill-eval-disclosure）。 */
export const SESSION_SCHEMA = "how2build3d/inspect-session@1";
/** live 采集固定 seed（进 URL 也进 session）：重放审计需要知道这局是怎么采的。 */
export const LIVE_SEED = 4207;

/**
 * 证据截图元数据断言（live 与 --replay 共用同一函数）：默认机位 ≥8000B、
 * 三张编号截图齐全（默认 + 两个 __setShot 变体）、变体不过小、机位互异。
 */
export function assertEvidence(item) {
  const problems = [];
  const bytes = item.bytes != null ? item.bytes : 0;
  const shots = Array.isArray(item.shots) ? item.shots : [];
  if (bytes < 8000) problems.push(`screenshot too small: ${bytes}B`);
  const tinyVariants = shots.slice(1).filter((s) => s.bytes < 8000);
  if (shots.length < 3) problems.push(`证据截图只有 ${shots.length} 张（需 ≥3）：场景未提供 __setShot`);
  else if (tinyVariants.length) problems.push(`变体截图过小：${tinyVariants.map((s) => s.file).join(", ")}`);
  if (new Set(shots.map((s) => s.bytes)).size < shots.length) problems.push("三张证据截图字节数相同，疑似没有换机位");
  return problems;
}

/** 由 live 采集结果构造规范化会话；只记录可审计事实与 live-only 判定，元数据断言由 replay 复算。 */
export function buildSession({ scene, seed = LIVE_SEED, minUsed = DEFAULT_MIN_USED, results }) {
  return {
    schema: SESSION_SCHEMA,
    gate: "inspect",
    scene,
    seed,
    generatedAt: new Date().toISOString(),
    minUsed,
    results: results.map((item) => {
      const rest = { ...item };
      delete rest.problems; // 全量判定不进 session：元数据断言由 replay 复算
      return rest;
    }),
  };
}

export function writeSession(file, session) {
  writeFileSync(file, `${JSON.stringify(session, null, 1)}\n`);
}

/**
 * 离线重放：不启动 Chrome。对每个 used 展厅复跑 assertEvidence（同一断言函数）、
 * 合并录制时无法离线复算的 liveProblems（__G.showcase/__INSPECT_DECK__/渲染错误/感知统计），
 * 再按九厅覆盖阈值 validateCoverage 收口；schema 不符或结构破坏判红（fail-closed）。
 * minUsed 缺省用会话里记录的阈值（保证同文件重放可重复 exit 0/1），显式传入则覆盖。
 */
export function replaySession(session, { minUsed = null } = {}) {
  const threshold = Number.isInteger(minUsed) && minUsed >= 0
    ? minUsed
    : (Number.isInteger(session && session.minUsed) ? session.minUsed : DEFAULT_MIN_USED);
  if (!session || typeof session !== "object" || Array.isArray(session)) {
    return { ok: false, replay: true, schema: SESSION_SCHEMA, scene: null, minUsed: threshold, used: 0, na: 0, results: [], problems: ["session must be an object"] };
  }
  const problems = [];
  if (session.schema !== SESSION_SCHEMA) {
    problems.push(`session.schema ${JSON.stringify(session.schema)} != ${SESSION_SCHEMA}`);
  }
  let results = [];
  if (Array.isArray(session.results)) results = session.results;
  else problems.push("session.results must be an array");

  const replayed = results.map((item) => {
    if (!item || item.state !== "used") return { ...item, problems: [] };
    const live = Array.isArray(item.liveProblems) ? item.liveProblems : [];
    const itemProblems = [...live, ...assertEvidence(item)];
    for (const problem of itemProblems) problems.push(`${item.id}: ${problem}`);
    return { ...item, problems: itemProblems };
  });

  let coverage = { used: 0, na: 0, minUsed: threshold, problems: [] };
  if (results.length === GALLERIES.length) {
    coverage = validateCoverage(replayed, { minUsed: threshold });
    problems.push(...coverage.problems);
  }
  return {
    ok: problems.length === 0,
    replay: true,
    schema: session.schema != null ? session.schema : null,
    scene: session.scene != null ? session.scene : null,
    seed: session.seed != null ? session.seed : null,
    minUsed: threshold,
    used: coverage.used,
    na: coverage.na,
    results: replayed,
    problems,
  };
}

/** 读盘 + 重放；读不出/解析失败同样判红（可重复 exit 1），绝不启动 Chrome。 */
export function replaySessionFile(file, options = {}) {
  let session;
  try {
    session = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return { ok: false, replay: true, file, problems: [`cannot read/parse session file: ${error.message}`] };
  }
  return { ...replaySession(session, options), file };
}

function positiveFixture() {
  const galleries = {};
  for (const id of GALLERIES) galleries[id] = { state: "used" };
  galleries.enemies = { state: "n/a", reason: "本场景无战斗系统" };
  return { galleries };
}

async function inspectScene(sceneRel) {
  const sceneDir = path.resolve(ROOT, sceneRel);
  const sceneName = path.basename(sceneDir);
  const buildScript = path.join(sceneDir, "build.mjs");
  const manifestPath = path.join(sceneDir, "inspect.manifest.json");
  if (!existsSync(buildScript)) throw new Error(`missing build.mjs in ${sceneRel}`);
  if (!existsSync(manifestPath)) throw new Error(`missing ${path.relative(ROOT, manifestPath)}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const problems = validateManifest(manifest);
  if (problems.length) return { ok: false, scene: sceneRel, problems, results: [] };

  execFileSync(process.execPath, [buildScript, "--assert"], { cwd: ROOT, stdio: "inherit" });
  const html = path.join(ROOT, "build", sceneName, "index.html");
  if (!existsSync(html)) throw new Error(`build did not produce ${path.relative(ROOT, html)}`);

  const outDir = path.join(ROOT, "evidence/inspect");
  mkdirSync(outDir, { recursive: true });
  const results = [];
  const allProblems = [];

  for (const id of GALLERIES) {
    const entry = manifest.galleries[id];
    if (entry.state !== "used") {
      results.push({ id, state: "n/a", reason: entry.reason || "" });
      continue;
    }
    const session = await launchFixture({
      url: `${pathToFileURL(html).href}?show=${id}&shot&bench&seed=${LIVE_SEED}`,
      waitMs: 2200,
      viewport: [800, 450],
    });
    try {
      const ctx = await session.page.evaluate(() => ({
        showcase: window.__G ? window.__G.showcase : null,
        deck: window.__INSPECT_DECK__ || null,
        errors: (window.__errors || []).slice(-5),
      }));
      const snap = await snapshot(session.page, { heartbeatMs: 500 });
      const shotPath = path.join(outDir, `${sceneName}-${id}.png`);
      await session.page.screenshot({ path: shotPath });
      const bytes = statSync(shotPath).size;
      const shots = [{ file: path.relative(ROOT, shotPath), bytes, variant: "default" }];
      // 每厅三张证据：默认机位 + 两个 __setShot 变体（窄角看细节、广角看层次）
      for (const { fov, suffix } of [{ fov: 45, suffix: "-2" }, { fov: 74, suffix: "-3" }]) {
        const variantPath = path.join(outDir, `${sceneName}-${id}${suffix}.png`);
        const applied = await session.page.evaluate((value) => {
          if (typeof window.__setShot !== "function") return false;
          window.__setShot({ fov: value });
          return true;
        }, fov);
        if (!applied) break;
        await session.page.evaluate(() => new Promise((resolve) => {
          let n = 0;
          const tick = () => (++n >= 3 ? resolve(true) : requestAnimationFrame(tick));
          requestAnimationFrame(tick);
        }));
        await session.page.screenshot({ path: variantPath });
        shots.push({ file: path.relative(ROOT, variantPath), bytes: statSync(variantPath).size, variant: `fov:${fov}` });
      }
      // live-only 判定（重放无法离线复算，录制进 session 的 liveProblems）：
      // __G.showcase 对齐 / __INSPECT_DECK__ 在册 / 渲染 0 错误 / 感知统计达标。
      const liveProblems = [];
      if (ctx.showcase !== id) liveProblems.push(`__G.showcase=${JSON.stringify(ctx.showcase)} != ${id}`);
      if (!ctx.deck || !Array.isArray(ctx.deck.galleries) || !ctx.deck.galleries.includes(id)) {
        liveProblems.push("__INSPECT_DECK__ missing or does not list this gallery");
      }
      if (snap.errorCount !== 0) liveProblems.push(`render errors: ${snap.errorCount} ${JSON.stringify(snap.errors)}`);
      if (bytes >= 8000) {
        const stats = await analyzeImage(path.relative(ROOT, shotPath));
        const visible = 1 - stats.blackRatio - stats.whiteRatio;
        if (visible < 0.55) liveProblems.push(`visible ratio ${visible.toFixed(2)} < 0.55`);
        if (stats.mean < 0.06 || stats.mean > 0.92) liveProblems.push(`mean luma ${stats.mean.toFixed(2)} out of [0.06,0.92]`);
        if (stats.rms < 0.075) liveProblems.push(`contrast rms ${stats.rms.toFixed(3)} < 0.075`);
        if (stats.hueDiversity < 2) liveProblems.push(`hue diversity ${stats.hueDiversity} < 2`);
      }
      // 证据截图元数据断言走 assertEvidence（与 --replay 同一断言函数）。
      const itemProblems = [...liveProblems, ...assertEvidence({ bytes, shots })];
      results.push({ id, state: "used", shot: path.relative(ROOT, shotPath), bytes, shots, problems: itemProblems, liveProblems });
      for (const problem of itemProblems) allProblems.push(`${id}: ${problem}`);
    } finally {
      await session.close();
    }
  }

  return { ok: allProblems.length === 0, scene: sceneRel, seed: LIVE_SEED, results, problems: allProblems };
}

function selfTest() {
  const problems = [];
  const good = validateManifest(positiveFixture());
  if (good.length) problems.push(...good.map((p) => `positive fixture: ${p}`));
  const missing = { galleries: { ...positiveFixture().galleries } };
  delete missing.galleries.level;
  if (!validateManifest(missing).some((p) => p.includes("level"))) problems.push("negative fixture (missing gallery) was not rejected");
  const noReason = { galleries: { ...positiveFixture().galleries, enemies: { state: "n/a" } } };
  if (!validateManifest(noReason).some((p) => p.includes("reason"))) problems.push("negative fixture (n/a without reason) was not rejected");
  const badState = { galleries: { ...positiveFixture().galleries, fx: { state: "stub" } } };
  if (!validateManifest(badState).some((p) => p.includes("state"))) problems.push("negative fixture (bad state) was not rejected");
  // 覆盖阈值：全 n/a 清单 schema 合法但必须判红；used 低于阈值同样判红
  const allNa = { galleries: {} };
  for (const id of GALLERIES) allNa.galleries[id] = { state: "n/a", reason: "自测夹具：本场景不适用" };
  if (validateManifest(allNa).length) problems.push("all-n/a fixture should be schema-valid");
  const allNaCoverage = validateCoverage(GALLERIES.map((id) => ({ id, state: "n/a" })));
  if (!allNaCoverage.problems.length) problems.push("negative fixture (all n/a) was not rejected by used threshold");
  if (validateCoverage(GALLERIES.map((id) => ({ id, state: "n/a" })), { minUsed: 0 }).problems.length) {
    problems.push("min-used 0 should allow an all-n/a manifest (threshold not honored)");
  }
  const twoUsed = GALLERIES.map((id, i) => ({ id, state: i < 2 ? "used" : "n/a" }));
  if (!validateCoverage(twoUsed).problems.length) problems.push("negative fixture (2 used < minUsed 3) was not rejected");
  const eightUsed = GALLERIES.map((id, i) => ({ id, state: i === GALLERIES.length - 1 ? "n/a" : "used" }));
  if (validateCoverage(eightUsed).problems.length) problems.push("positive fixture (8 used) was rejected by used threshold");

  // 会话 dump→replay round-trip（临时目录夹具，不触碰仓库文件）：
  // 正样例离线重放绿；篡改证据截图元数据 / 九厅覆盖数 / schema 判红。
  const sessionDir = mkdtempSync(path.join(tmpdir(), "how2build3d-inspect-session-"));
  try {
    const file = path.join(sessionDir, "session.json");
    const evidence = (id, bytes = 12000) => ({
      id, state: "used", shot: `evidence/inspect/quality-${id}.png`, bytes,
      shots: [
        { file: `evidence/inspect/quality-${id}.png`, bytes, variant: "default" },
        { file: `evidence/inspect/quality-${id}-2.png`, bytes: bytes + 1000, variant: "fov:45" },
        { file: `evidence/inspect/quality-${id}-3.png`, bytes: bytes + 2000, variant: "fov:74" },
      ],
      liveProblems: [],
    });
    const fixtureResults = () => GALLERIES.map((id) => (id === "enemies"
      ? { id, state: "n/a", reason: "自测夹具：无战斗系统" }
      : evidence(id)));
    writeSession(file, buildSession({ scene: "examples/quality", results: fixtureResults() }));
    const good = replaySessionFile(file);
    if (!good.ok) problems.push(`session round-trip: valid dump replayed red: ${JSON.stringify(good.problems)}`);
    else if (good.used !== GALLERIES.length - 1) problems.push(`session round-trip: replay used=${good.used} != ${GALLERIES.length - 1}`);
    const flatShots = JSON.parse(readFileSync(file, "utf8"));
    const firstUsed = flatShots.results.find((r) => r.state === "used");
    for (const s of firstUsed.shots) s.bytes = 11111; // 三张证据字节数全同（没换机位）
    writeSession(file, flatShots);
    const flat = replaySessionFile(file);
    if (flat.ok || !flat.problems.some((p) => p.includes("字节数相同"))) {
      problems.push("session round-trip: tampered evidence metadata was not rejected");
    }
    const lowCoverage = JSON.parse(readFileSync(file, "utf8"));
    let keptUsed = 0;
    lowCoverage.results = lowCoverage.results.map((r) => {
      if (r.state !== "used") return r;
      keptUsed += 1;
      return keptUsed <= 2 ? r : { ...r, state: "n/a", reason: "篡改样例：压低覆盖" };
    });
    writeSession(file, lowCoverage);
    const cov = replaySessionFile(file);
    if (cov.ok || !cov.problems.some((p) => p.includes("used galleries"))) {
      problems.push("session round-trip: tampered nine-gallery coverage was not rejected");
    }
    const wrongSchema = JSON.parse(readFileSync(file, "utf8"));
    wrongSchema.schema = "how2build3d/inspect-session@0";
    writeSession(file, wrongSchema);
    const schemaBad = replaySessionFile(file);
    if (schemaBad.ok || !schemaBad.problems.some((p) => p.includes("schema"))) {
      problems.push("session round-trip: wrong-schema sample was not rejected");
    }
  } finally {
    rmSync(sessionDir, { recursive: true, force: true });
  }
  return problems;
}

export async function main(argv) {
  const has = (name) => argv.includes(name);
  const value = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const hasDump = has("--dump-session");
  const hasReplay = has("--replay");

  if (has("--self-test")) {
    if (hasDump || hasReplay) {
      console.error("inspect: --dump-session/--replay 不与 --self-test 同用；--dump-session 只在 --scene live 模式下写盘");
      return 2;
    }
    const problems = selfTest();
    console.log(JSON.stringify({ selfTest: true, ok: problems.length === 0, problems }, null, 1));
    if (problems.length) {
      console.error(`inspect gate --self-test FAILED: ${problems.length} problem(s)`);
      return 1;
    }
    console.log("inspect gate --self-test OK: nine-gallery manifest rules + used threshold + session dump/replay round-trip hold");
    return 0;
  }

  if (hasReplay) {
    if (hasDump) {
      console.error("inspect: --replay 与 --dump-session 互斥（重放不采集新数据）");
      return 2;
    }
    if (has("--manifest-only")) {
      console.error("inspect: --replay 不与 --manifest-only 同用（重放走会话文件，不读场景清单）");
      return 2;
    }
    const replayFile = value("--replay");
    if (!replayFile) {
      console.error("inspect: --replay 需要 <session.json> 参数");
      return 2;
    }
    const minIdx = argv.indexOf("--min-used");
    const explicitMin = minIdx >= 0 ? Number(argv[minIdx + 1]) : null;
    if (minIdx >= 0 && (!Number.isInteger(explicitMin) || explicitMin < 0)) {
      console.error("inspect: --min-used 必须是非负整数");
      return 2;
    }
    const result = replaySessionFile(replayFile, explicitMin != null ? { minUsed: explicitMin } : {});
    console.log(JSON.stringify(result, null, 1));
    console.log(`inspect gate (replay ${replayFile}): ${result.used} used / ${result.na} n/a (min-used ${result.minUsed}) — ${result.ok ? "OK" : "FAILED"}（离线重放，未启动 Chrome）`);
    return result.ok ? 0 : 1;
  }

  const minIdx = argv.indexOf("--min-used");
  const minUsed = minIdx >= 0 ? Number(argv[minIdx + 1]) : DEFAULT_MIN_USED;
  if (!Number.isInteger(minUsed) || minUsed < 0) {
    console.error("inspect: --min-used 必须是非负整数");
    return 2;
  }
  const dumpFile = value("--dump-session");
  if (hasDump && !dumpFile) {
    console.error("inspect: --dump-session 需要 <file> 参数（仅在 --scene live 模式下写盘）");
    return 2;
  }
  if (hasDump && has("--manifest-only")) {
    console.error("inspect: --dump-session 只在 --scene live 模式下写盘，不与 --manifest-only 同用");
    return 2;
  }
  const idx = argv.indexOf("--scene");
  const scene = idx >= 0 ? argv[idx + 1] : "examples/quality";

  if (has("--manifest-only")) {
    const manifestPath = path.join(path.resolve(ROOT, scene), "inspect.manifest.json");
    if (!existsSync(manifestPath)) {
      console.error(`inspect: missing ${path.relative(ROOT, manifestPath)}`);
      return 1;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const manifestProblems = validateManifest(manifest);
    const coverage = manifestProblems.length
      ? { used: 0, na: 0, minUsed, problems: [] }
      : validateCoverage(GALLERIES.map((id) => ({ id, state: manifest.galleries[id].state })), { minUsed });
    const result = {
      ok: manifestProblems.length === 0 && coverage.problems.length === 0,
      scene,
      mode: "manifest-only",
      minUsed,
      used: coverage.used,
      na: coverage.na,
      problems: [...manifestProblems, ...coverage.problems],
    };
    console.log(JSON.stringify(result, null, 1));
    console.log(`inspect gate (manifest-only): ${coverage.used} used / ${coverage.na} n/a (min-used ${minUsed}) — ${result.ok ? "OK" : "FAILED"}`);
    return result.ok ? 0 : 1;
  }

  const result = await inspectScene(scene);
  if (result.results.length === GALLERIES.length) {
    const coverage = validateCoverage(result.results, { minUsed });
    result.problems.push(...coverage.problems);
    if (coverage.problems.length) result.ok = false;
  }
  result.minUsed = minUsed;
  if (dumpFile) {
    writeSession(dumpFile, buildSession({ scene, minUsed, results: result.results }));
    result.session = { schema: SESSION_SCHEMA, file: dumpFile };
  }
  console.log(JSON.stringify(result, null, 1));
  const used = result.results.filter((item) => item.state === "used").length;
  const na = result.results.filter((item) => item.state === "n/a").length;
  console.log(`inspect gate: ${used} used / ${na} n/a (min-used ${minUsed}) — ${result.ok ? "OK" : "FAILED"}`);
  if (!result.ok) return 1;
  return 0;
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) main(process.argv.slice(2)).then((code) => process.exit(code), (error) => { console.error(error); process.exit(error.exitCode ?? 1); });
