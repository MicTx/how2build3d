/**
 * harness/gates/perf.mjs — 结构化性能预算门禁。
 *
 * 默认现场调用 captureFrames() 采集 fixture profile；也可以用 --profile 指向
 * 已有的 profile JSON（例如 evidence/frames/profile.json）。门禁读取
 * harness/perf.budget.json，检查 draw calls、triangles、programs、geometries、
 * textures 与 draw-call 分位数；帧时只保留宽松上限，SwiftShader 不作为真机 FPS。
 *
 * CLI:
 *   node harness/gates/perf.mjs                    # fail-closed：超预算 exit 1
 *   node harness/gates/perf.mjs --no-assert        # 只看报告，预算失败也 exit 0
 *   node harness/gates/perf.mjs --profile evidence/frames/profile.json
 *   node harness/gates/perf.mjs --scene examples/quality
 *   node harness/gates/perf.mjs --scene examples/quality --floors
 *   node harness/gates/perf.mjs --self-test
 *   --budget <path>  覆盖预算文件（--scene 时默认取 <scene>/perf.budget.json，缺失回落全局）
 *   --floors         启用密度下限（floors 段）；上限防空壳、下限防空转
 *   --json           打印完整 JSON（默认也打印）
 *   --assert         显式声明断言（默认已开启，仅为兼容旧命令保留）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync , realpathSync} from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BUDGET_PATH = path.join(ROOT, "harness/perf.budget.json");
const OUT_DIR = path.join(ROOT, "evidence/frames");
const OUT = path.join(OUT_DIR, "perf-gate.json");

function parseArgs(argv) {
  const out = { assert: true, selfTest: false, profile: null, budget: null, json: false, scene: null, floors: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--assert") out.assert = true;
    else if (a === "--no-assert") out.assert = false;
    else if (a === "--self-test") out.selfTest = true;
    else if (a === "--json") out.json = true;
    else if (a === "--floors") out.floors = true;
    else if (a === "--profile") { i += 1; out.profile = argv[i]; }
    else if (a === "--budget") { i += 1; out.budget = argv[i]; }
    else if (a === "--scene") { i += 1; out.scene = argv[i]; }
  }
  return out;
}

function loadJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function profileFromSummary(summary) {
  return {
    source: summary.fixture,
    renderer: summary.rendererStatsSample,
    quality: summary.quality,
    frame: {
      frames: summary.frames,
      p50DrawsPerFrame: summary.p50DrawsPerFrame,
      maxDrawsPerFrame: summary.maxDrawsPerFrame,
      programs: summary.programs,
      p50FrameMs: summary.p50FrameMs,
      p99FrameMs: summary.p99FrameMs,
    },
    errorCount: summary.errorCount,
    errors: summary.errors,
    capturedAt: summary.capturedAt,
  };
}

export function evaluate(profile, budget, { floors = false } = {}) {
  const limits = budget.limits || {};
  const checks = [];
  const add = (name, actual, op, limit) => {
    const pass = finite(actual) && (op === ">=" ? actual >= limit : actual <= limit);
    checks.push({ name, actual: finite(actual) ? actual : null, op, limit, pass: Boolean(pass) });
  };
  add("errorCount", profile.errorCount, "<=", 0);
  add("frames", profile.frame?.frames, ">=", limits.minFrames ?? 0);
  add("renderer.calls.min", profile.renderer?.calls, ">=", limits.minDrawCalls ?? 1);
  add("renderer.calls.max", profile.renderer?.calls, "<=", limits.maxDrawCalls ?? 500);
  add("renderer.triangles.max", profile.renderer?.tris, "<=", limits.maxTriangles ?? 4000000);
  add("renderer.programs.max", profile.renderer?.programs, "<=", limits.maxPrograms ?? 400);
  add("renderer.geometries.max", profile.renderer?.geos, "<=", limits.maxGeometries ?? 300);
  add("renderer.textures.max", profile.renderer?.tex, "<=", limits.maxTextures ?? 250);
  add("frame.programs.max", profile.frame?.programs, "<=", limits.maxPrograms ?? 400);
  add("frame.p50DrawsPerFrame.min", profile.frame?.p50DrawsPerFrame, ">=", limits.minP50DrawCalls ?? 1);
  add("frame.p50DrawsPerFrame.max", profile.frame?.p50DrawsPerFrame, "<=", limits.maxP50DrawCalls ?? 450);
  add("frame.maxDrawsPerFrame.max", profile.frame?.maxDrawsPerFrame, "<=", limits.maxDrawCallsPerFrame ?? 1000);
  add("frame.p50FrameMs.max", profile.frame?.p50FrameMs, "<=", limits.maxP50FrameMs ?? 6000);
  if (floors) {
    const f = budget.floors || {};
    // 缺省值是「任何像样场景都不该低于」的保守下限；场景可用自己的 perf.budget.json 抬高。
    add("floors.p50DrawsPerFrame.min", profile.frame?.p50DrawsPerFrame, ">=", f.minP50DrawCalls ?? 40);
    add("floors.renderer.triangles.min", profile.renderer?.tris, ">=", f.minTriangles ?? 30000);
    add("floors.renderer.programs.min", profile.renderer?.programs, ">=", f.minPrograms ?? 4);
  }
  return {
    ok: checks.every((c) => c.pass),
    floors,
    checks,
    metrics: {
      errorCount: profile.errorCount,
      renderer: profile.renderer,
      frame: profile.frame,
      quality: profile.quality,
    },
  };
}

function selfTest() {
  const budget = {
    limits: {
      minFrames: 8,
      minDrawCalls: 1,
      minP50DrawCalls: 1,
      maxDrawCalls: 500,
      maxTriangles: 4000000,
      maxPrograms: 400,
      maxGeometries: 300,
      maxTextures: 250,
      maxP50DrawCalls: 450,
      maxDrawCallsPerFrame: 1000,
      maxP50FrameMs: 6000,
    },
  };
  const good = {
    errorCount: 0,
    renderer: { calls: 415, tris: 2721193, programs: 106, geos: 181, tex: 136 },
    frame: { frames: 12, programs: 266, p50DrawsPerFrame: 320, maxDrawsPerFrame: 735, p50FrameMs: 1759 },
    quality: { name: "medium" },
  };
  const bad = { ...good, renderer: { ...good.renderer, calls: 900 } };
  if (!evaluate(good, budget).ok) {
    console.error("perf --self-test FAILED: expected good profile to pass");
    return 1;
  }
  if (evaluate(bad, budget).ok) {
    console.error("perf --self-test FAILED: expected over-budget profile to fail");
    return 1;
  }
  // floors：上限全绿但内容空壳必须判红
  const floorBudget = { ...budget, floors: { minP50DrawCalls: 40, minTriangles: 30000, minPrograms: 4 } };
  const sparse = {
    errorCount: 0,
    renderer: { calls: 6, tris: 1200, programs: 2, geos: 4, tex: 2 },
    frame: { frames: 12, programs: 2, p50DrawsPerFrame: 6, maxDrawsPerFrame: 8, p50FrameMs: 900 },
  };
  if (!evaluate(sparse, budget).ok) {
    console.error("perf --self-test FAILED: sparse profile should pass with floors disabled (legacy compatibility)");
    return 1;
  }
  if (evaluate(sparse, floorBudget, { floors: true }).ok) {
    console.error("perf --self-test FAILED: sparse profile must fail with --floors");
    return 1;
  }
  if (!evaluate(good, floorBudget, { floors: true }).ok) {
    console.error("perf --self-test FAILED: dense profile must pass with --floors");
    return 1;
  }
  console.log("perf --self-test OK");
  return 0;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.selfTest) return selfTest();

  // 预算解析顺序：--budget > <scene>/perf.budget.json > harness/perf.budget.json
  let budgetPath = BUDGET_PATH;
  if (args.budget) budgetPath = path.resolve(ROOT, args.budget);
  else if (args.scene) {
    const sceneBudget = path.join(ROOT, args.scene, "perf.budget.json");
    if (existsSync(sceneBudget)) budgetPath = sceneBudget;
  }
  if (!existsSync(budgetPath)) {
    console.error(`perf: missing budget ${budgetPath}`);
    return 1;
  }
  const budget = loadJson(budgetPath);
  let profile;
  if (args.profile) {
    const profilePath = path.resolve(ROOT, args.profile);
    if (!existsSync(profilePath)) {
      console.error(`perf: missing profile ${profilePath}`);
      return 1;
    }
    profile = loadJson(profilePath);
  } else if (args.scene) {
    const sceneName = path.basename(path.resolve(ROOT, args.scene));
    const html = path.join(ROOT, "build", sceneName, "index.html");
    if (!existsSync(html)) {
      console.error(`perf: missing ${path.relative(ROOT, html)} — run node ${args.scene}/build.mjs first`);
      return 1;
    }
    const { captureProfileAt } = await import("../capture/frames.mjs");
    const capture = budget.capture || {};
    const summary = await captureProfileAt({
      url: `${pathToFileURL(html).href}?bench&seed=${capture.seed ?? 4207}`,
      frames: capture.frames ?? 12,
      waitMs: capture.waitMs ?? 4000,
      viewport: capture.viewport ?? [800, 450],
    });
    profile = profileFromSummary(summary);
  } else {
    // Lazy import: --self-test and --profile should not require browser deps.
    const { captureFrames } = await import("../capture/frames.mjs");
    const capture = budget.capture || {};
    const summary = await captureFrames({
      frames: capture.frames ?? 12,
      waitMs: capture.waitMs ?? 4000,
      viewport: capture.viewport ?? [640, 360],
      seed: capture.seed ?? 4207,
    });
    profile = profileFromSummary(summary);
  }

  const result = evaluate(profile, budget, { floors: args.floors });
  const report = {
    generatedAt: new Date().toISOString(),
    budget: path.relative(ROOT, budgetPath),
    profileSource: args.profile || (args.scene ? `scene ${args.scene}` : "captureFrames()"),
    floors: args.floors,
    ok: result.ok,
    checks: result.checks,
    metrics: result.metrics,
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 1)}\n`);
  console.log(JSON.stringify(report, null, 1));
  if (args.assert && !result.ok) {
    const failed = result.checks.filter((c) => !c.pass).map((c) => `${c.name}${c.op}${c.limit} (actual ${c.actual})`);
    console.error(`perf.mjs FAILED (fail-closed 默认；--no-assert 仅看报告): ${failed.join("; ")}`);
    return 1;
  }
  return 0;
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error("perf.mjs crashed:", err && err.message ? err.message : err);
      process.exit(1);
    }
  );
}
