/**
 * harness/gates/gameplay.mjs — 玩法链路门禁。
 *
 *   --self-test            无浏览器：令牌池/状态机/听觉传播/布局对账/确定性 的正负样例
 *   --scene <dir>          动态：build → ?bench&auto=10 自动战斗 → 断言
 *                            1) 同时开火敌人数 ≤ maxTokens
 *                            2) 听觉：脚本开火触发 alert（hearRadius 内）
 *                            3) 同 seed 两局事件计数 hash 一致（确定性）
 *   --require-audio        额外要求音频证据：peak>0.002、bands≥3、soundSpecs≥8
 *                          （默认不要求，静音样板仍可过；可玩交付必须带）
 *                          并把战斗截图写到 evidence/inspect/<scene>-battle.png
 *   --dump-session <file>  仅 --scene live 模式：把规范化会话写盘（schema=how2build3d/
 *                          gameplay-session@1；scene/seed/generatedAt/assert/runs/shot），
 *                          供离线重放与审计。live 模式前置：系统 Chrome（/usr/bin/google-chrome）
 *                          + 可写 build/、evidence/。
 *   --replay <file>        离线重放：不启动 Chrome，对记录的 runs 复跑同一断言函数
 *                          assertReports（令牌/听觉/确定性），可重复 exit 0/1；
 *                          schema 不符或数据被篡改判红（fail-closed）
 *
 * 框架见 assets/{physics,level,combat}-kit.mjs；协议见 references/10-gameplay-chain.md。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, mkdtempSync, rmSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";

import { launchFixture, snapshot } from "../boot.mjs";
import { createCombatKit } from "../../assets/combat-kit.mjs";
import { validateLayout } from "../../assets/level-kit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/* ---- 确定性 rng（mulberry32）---- */
function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function stubPhysics() {
  return { raycast: () => null, lineOfSight: () => true };
}

function stubEvents() {
  const log = [];
  return { log, on() {}, emit(type, payload) { log.push({ type, payload }); } };
}

/* ---- 规范化会话（dump/replay）---- */

/** 会话 schema：dump/replay 的稳定契约（2026-11-19_skill-eval-disclosure）。 */
export const SESSION_SCHEMA = "how2build3d/gameplay-session@1";
/** live 采集固定 seed（进 URL 也进 session）：重放审计需要知道这局是怎么采的。 */
export const LIVE_SEED = 4207;

/**
 * runs 断言（live 与 --replay 共用同一函数）：令牌上限 / 听觉链 / 开火 / 音频限幅 /
 * 同 seed 确定性。replay 不启动 Chrome，靠复跑本函数复算同一份判定。
 */
export function assertReports(reports, { requireAudio = false } = {}) {
  const problems = [];
  if (!Array.isArray(reports)) return ["runs must be an array"];
  if (reports.length !== 2) problems.push(`expected two deterministic runs, got ${reports.length}`);
  for (let run = 0; run < reports.length; run += 1) {
    const report = reports[run];
    if (!report) { problems.push(`run ${run}: __BATTLE_REPORT missing`); continue; }
    if (!(report.maxConcurrentAttackers <= report.maxTokens)) {
      problems.push(`run ${run}: maxConcurrentAttackers ${report.maxConcurrentAttackers} > maxTokens ${report.maxTokens}`);
    }
    if (!(report.alerts >= 1)) problems.push(`run ${run}: no alert observed (hearing chain broken)`);
    if (!(report.fires >= 1)) problems.push(`run ${run}: no bolt fired`);
    if (report.peak != null && (!Number.isFinite(report.peak) || report.peak > 0.97)) problems.push(`run ${run}: invalid or excessive audio peak ${report.peak}`);
    if (report.clipCount != null && report.clipCount > 0) problems.push(`run ${run}: audio clipped ${report.clipCount} samples`);
    // 静音场景过去可以「因为没音频」通过全套门禁；--require-audio 堵住这条捷径。
    if (requireAudio) {
      if (report.peak == null) problems.push(`run ${run}: --require-audio 但未上报音频峰值（接入 assets/audio-kit.mjs）`);
      else if (!(report.peak > 0.002)) problems.push(`run ${run}: 音频峰值 ${report.peak} ≈ 静音`);
      const bandCount = Array.isArray(report.bands) ? report.bands.length : report.bands;
      if (!Number.isInteger(bandCount) || bandCount < 3) {
        problems.push(`run ${run}: --require-audio 但未上报频谱（bands ≥3）`);
      }
      if (!(report.soundSpecs >= 8)) problems.push(`run ${run}: 音效规格 ${report.soundSpecs} < 8（规格表未接入）`);
    }
  }
  if (reports[0] && reports[1]) {
    const key = (r) => JSON.stringify({ alerts: r.alerts, fires: r.fires, shots: r.shots, impacts: r.impacts, hash: r.hash });
    if (key(reports[0]) !== key(reports[1])) {
      problems.push(`determinism: run0 ${key(reports[0])} != run1 ${key(reports[1])}`);
    }
  }
  return problems;
}

/** 由 live 采集结果构造规范化会话：schema/gate/scene/seed/generatedAt/assert/runs/shot。 */
export function buildSession({ scene, seed = LIVE_SEED, requireAudio = false, reports, shot = null }) {
  return {
    schema: SESSION_SCHEMA,
    gate: "gameplay",
    scene,
    seed,
    generatedAt: new Date().toISOString(),
    assert: { requireAudio: !!requireAudio },
    runs: reports,
    shot,
  };
}

export function writeSession(file, session) {
  writeFileSync(file, `${JSON.stringify(session, null, 1)}\n`);
}

/** 离线重放：对记录的 runs 复跑 assertReports；schema 不符/结构破坏判红（fail-closed）。 */
export function replaySession(session) {
  if (!session || typeof session !== "object" || Array.isArray(session)) {
    return { ok: false, replay: true, schema: SESSION_SCHEMA, scene: null, seed: null, runs: [], problems: ["session must be an object"] };
  }
  const problems = [];
  if (session.schema !== SESSION_SCHEMA) {
    problems.push(`session.schema ${JSON.stringify(session.schema)} != ${SESSION_SCHEMA}`);
  }
  let runs = [];
  if (Array.isArray(session.runs)) runs = session.runs;
  else problems.push("session.runs must be an array");
  problems.push(...assertReports(runs, { requireAudio: !!(session.assert && session.assert.requireAudio) }));
  return {
    ok: problems.length === 0,
    replay: true,
    schema: session.schema != null ? session.schema : null,
    scene: session.scene != null ? session.scene : null,
    seed: session.seed != null ? session.seed : null,
    runs,
    problems,
  };
}

/** 读盘 + 重放；读不出/解析失败同样判红（可重复 exit 1），绝不启动 Chrome。 */
export function replaySessionFile(file) {
  let session;
  try {
    session = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return { ok: false, replay: true, file, problems: [`cannot read/parse session file: ${error.message}`] };
  }
  return { ...replaySession(session), file };
}

function selfTest() {
  const problems = [];
  const events = stubEvents();
  const kit = createCombatKit({ physics: stubPhysics(), events, rng: mulberry32(4207) });

  // 1. 令牌池：上限内可取、溢出判空、释放后可再取
  const a = kit.tokens.acquire();
  const b = kit.tokens.acquire();
  const c = kit.tokens.acquire();
  if (!a || !b) problems.push("token acquire failed within limit");
  if (c) problems.push("token overflow was allowed");
  kit.tokens.release(a);
  if (!kit.tokens.acquire()) problems.push("token re-acquire after release failed");
  kit.tokens.release(b);

  // 2. 状态机：视野内累计 seeT → engage；目标消失 + loseSight → search
  const agent = kit.createAgent({ pos: { x: 0, y: 0, z: 0 }, fwd: { x: 0, z: 1 } });
  const target = { pos: { x: 0, y: 1, z: 10 }, alive: true };
  for (let i = 0; i < 30; i += 1) kit.updatePerception(agent, target, 0.05);
  if (agent.mode !== "engage") problems.push(`perception did not engage (mode=${agent.mode})`);
  const gone = { pos: { x: 0, y: 1, z: 10 }, alive: false };
  for (let i = 0; i < 120; i += 1) kit.updatePerception(agent, gone, 0.05);
  if (agent.mode !== "search") problems.push(`lost target did not search (mode=${agent.mode})`);

  // 3. 听觉传播：hearRadius 内 alert，外不受影响
  const near = kit.createAgent({ pos: { x: 5, y: 0, z: 0 } });
  const far = kit.createAgent({ pos: { x: 500, y: 0, z: 0 } });
  kit.alert({ x: 0, y: 0, z: 0 });
  if (near.mode !== "investigate") problems.push("near agent did not hear the shot");
  if (far.mode !== "patrol") problems.push("far agent wrongly alerted");

  // 4. 布局对账：未知道具名 / 零件数不符 / 重复放置 判红
  const catalog = { crate: { size: [1, 1, 1], material: "steel", parts: 6 } };
  try { validateLayout(catalog, [{ prop: "crate", at: [0, 0, 0] }]); } catch (error) { problems.push(`valid layout rejected: ${error.message}`); }
  for (const bad of [
    [{ prop: "nope", at: [0, 0, 0] }],
    [{ prop: "crate", at: [0, 0, 0], parts: 7 }],
    [{ prop: "crate", at: [0, 0, 0] }, { prop: "crate", at: [0, 0, 0] }],
  ]) {
    let threw = false;
    try { validateLayout(catalog, bad); } catch { threw = true; }
    if (!threw) problems.push("bad layout was not rejected");
  }

  // 5. 确定性：同 seed 两局 autoBattle 事件计数一致
  function runBattle() {
    const battleEvents = stubEvents();
    const battleKit = createCombatKit({ physics: stubPhysics(), events: battleEvents, rng: mulberry32(9001) });
    const agentA = battleKit.createAgent({ pos: { x: 0, y: 0, z: 0 } });
    const agentB = battleKit.createAgent({ pos: { x: 3, y: 0, z: 3 } });
    const report = battleKit.autoBattle(1, {
      tick(dt) {
        battleKit.mission.update(dt);
        battleKit.updatePerception(agentA, { pos: { x: 0, y: 1, z: 10 }, alive: true }, dt);
        if (Math.round((battleKit.stats.fires * 100) / 3) % 2 === 0) battleKit.fireBolt({ x: 0, y: 1, z: 1 }, { x: 0, y: 0, z: 1 });
        battleKit.updateBolts(dt);
        void agentB;
      },
    });
    return { alerts: report.alerts, fires: report.fires, impacts: report.impacts };
  }
  const runA = runBattle();
  const runB = runBattle();
  if (JSON.stringify(runA) !== JSON.stringify(runB)) problems.push(`battle not deterministic: ${JSON.stringify(runA)} vs ${JSON.stringify(runB)}`);

  // 6. 会话 dump→replay round-trip（临时目录夹具，不触碰仓库文件）：
  //    正样例离线重放绿；篡改确定性 / 换 schema 判红。
  const sessionDir = mkdtempSync(path.join(tmpdir(), "how2build3d-gameplay-session-"));
  try {
    const file = path.join(sessionDir, "session.json");
    const runFixture = () => ({
      maxTokens: 3, maxConcurrentAttackers: 2, alerts: 4, fires: 9, shots: 9, impacts: 7,
      peak: 0.42, clipCount: 0, hash: "9f8c31",
    });
    if (!assertReports([]).length || !assertReports([runFixture()]).length) problems.push("incomplete deterministic replay accepted");
    for (const bands of [0, 2, "3", {}]) {
      const report = { ...runFixture(), bands, soundSpecs: 8 };
      if (!assertReports([report, report], { requireAudio: true }).length) problems.push(`invalid audio bands accepted: ${bands}`);
    }
    writeSession(file, buildSession({
      scene: "examples/gameplay",
      reports: [runFixture(), runFixture()],
      shot: { path: "evidence/inspect/gameplay-battle.png", bytes: 12345 },
    }));
    const good = replaySessionFile(file);
    if (!good.ok) problems.push(`session round-trip: valid dump replayed red: ${JSON.stringify(good.problems)}`);
    const tampered = JSON.parse(readFileSync(file, "utf8"));
    tampered.runs[1].alerts += 1; // 破坏同 seed 确定性
    writeSession(file, tampered);
    const det = replaySessionFile(file);
    if (det.ok || !det.problems.some((p) => p.includes("determinism"))) {
      problems.push("session round-trip: tampered determinism sample was not rejected");
    }
    const wrongSchema = JSON.parse(readFileSync(file, "utf8"));
    wrongSchema.schema = "how2build3d/gameplay-session@0";
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

async function inspectScene(sceneRel, { requireAudio = false } = {}) {
  const sceneDir = path.join(ROOT, sceneRel);
  const sceneName = path.basename(sceneDir);
  const buildScript = path.join(sceneDir, "build.mjs");
  if (!existsSync(buildScript)) throw new Error(`missing build.mjs in ${sceneRel}`);
  execFileSync(process.execPath, [buildScript, "--assert"], { cwd: ROOT, stdio: "inherit" });
  const html = path.join(ROOT, "build", sceneName, "index.html");
  if (!existsSync(html)) throw new Error(`build did not produce ${path.relative(ROOT, html)}`);

  const url = `${pathToFileURL(html).href}?bench&auto=10&seed=${LIVE_SEED}`;
  const reports = [];
  const outDir = path.join(ROOT, "evidence/inspect");
  mkdirSync(outDir, { recursive: true });
  let shotRel = null;
  for (let run = 0; run < 2; run += 1) {
    const session = await launchFixture({ url: `${url}&run=${run}`, waitMs: 2600, viewport: [800, 450] });
    try {
      const report = await session.page.evaluate(() => window.__BATTLE_REPORT || null);
      reports.push(report);
      if (run === 0) {
        const shotPath = path.join(outDir, `${sceneName}-battle.png`);
        await session.page.screenshot({ path: shotPath });
        const bytes = statSync(shotPath).size;
        shotRel = { path: path.relative(ROOT, shotPath), bytes };
      }
    } finally {
      await session.close();
    }
  }

  const problems = assertReports(reports, { requireAudio });
  return { ok: problems.length === 0, scene: sceneRel, seed: LIVE_SEED, reports, shot: shotRel, problems };
}

export async function main(argv) {
  const has = (name) => argv.includes(name);
  const value = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const hasDump = has("--dump-session");
  const hasReplay = has("--replay");

  if (has("--self-test")) {
    if (hasDump || hasReplay) {
      console.error("gameplay: --dump-session/--replay 不与 --self-test 同用；--dump-session 只在 --scene live 模式下写盘");
      return 2;
    }
    const problems = selfTest();
    console.log(JSON.stringify({ selfTest: true, ok: problems.length === 0, problems }, null, 1));
    if (problems.length) {
      console.error(`gameplay gate --self-test FAILED: ${problems.length} problem(s)`);
      return 1;
    }
    console.log("gameplay gate --self-test OK: tokens/perception/hearing/layout/determinism + session dump/replay round-trip hold");
    return 0;
  }

  if (hasReplay) {
    if (hasDump) {
      console.error("gameplay: --replay 与 --dump-session 互斥（重放不采集新数据）");
      return 2;
    }
    const replayFile = value("--replay");
    if (!replayFile) {
      console.error("gameplay: --replay 需要 <session.json> 参数");
      return 2;
    }
    const result = replaySessionFile(replayFile);
    console.log(JSON.stringify(result, null, 1));
    console.log(`gameplay gate (replay ${replayFile}): ${result.ok ? "OK" : "FAILED"}（离线重放，未启动 Chrome）`);
    return result.ok ? 0 : 1;
  }

  const dumpFile = value("--dump-session");
  if (hasDump && !dumpFile) {
    console.error("gameplay: --dump-session 需要 <file> 参数（仅在 --scene live 模式下写盘）");
    return 2;
  }

  const idx = argv.indexOf("--scene");
  const scene = idx >= 0 ? argv[idx + 1] : "examples/gameplay";
  const requireAudio = has("--require-audio");
  const result = await inspectScene(scene, { requireAudio });
  if (dumpFile) {
    writeSession(dumpFile, buildSession({ scene, seed: LIVE_SEED, requireAudio, reports: result.reports, shot: result.shot }));
    result.session = { schema: SESSION_SCHEMA, file: dumpFile };
  }
  console.log(JSON.stringify(result, null, 1));
  console.log(`gameplay gate: ${result.ok ? "OK" : "FAILED"}`);
  return result.ok ? 0 : 1;
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) main(process.argv.slice(2)).then((code) => process.exit(code), (error) => { console.error(error); process.exit(1); });
