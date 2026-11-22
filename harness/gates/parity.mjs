/**
 * harness/gates/parity.mjs — 元素对账漂移门禁（baseline ±15%）。
 *
 * 回答一个问题：场景的「元素规模」相对验收基线有没有悄悄缩水/膨胀？
 * 对入库基线 harness/baselines/parity.json 比对五项核心计数（±15% 容差，双向判红）：
 *   - draw call（renderer.info.render.calls）
 *   - tris（renderer.info.render.triangles）
 *   - 材质数（__PARITY__.counts.materialCount）
 *   - 道具种类（__PARITY__.counts.propKinds）
 *   - 音效数（__PARITY__.counts.soundSpecs）
 *
 * 数据来源（三选一）：
 *   --scene <dir>   现场启动 build/<name>/index.html 实测（seed 进 URL 同确定性，
 *                   采集口径与 complete.mjs 一致：?bench&seed=4207、800x450；需系统 Chrome）
 *   --report <file> 读取既有对账报告 JSON（complete.mjs 产出的 evidence/parity/<scene>.json；
 *                   静态链用入库夹具 harness/baselines/parity-report.json）
 *   --record        把当前来源写成基线（默认写 harness/baselines/parity.json）
 *
 * 基线保护：
 *   - 默认读取 harness/baselines/parity.json；旧路径 evidence/parity/baseline.json
 *     仅在默认路径缺失时作**只读回退**（不写回）。
 *   - --record 在基线已存在时 exit 1 并打印旧/新摘要，必须显式 --force 才覆盖。
 *   - --record 未给 --scene/--report 时，退回入库报告夹具 harness/baselines/parity-report.json
 *     （无 Chrome 也能重录出同一组指标；日志会注明来源）。
 *
 * CLI:
 *   node harness/gates/parity.mjs --self-test
 *   node harness/gates/parity.mjs --scene examples/parity            # 实测比对 ±15%（Chrome）
 *   node harness/gates/parity.mjs --report harness/baselines/parity-report.json   # 静态比对
 *   node harness/gates/parity.mjs --scene examples/parity --record --force        # 重录基线
 *   --baseline <path>  覆盖基线路径（默认 harness/baselines/parity.json）
 *
 * 结构参照 perf.mjs：evaluate() 纯函数可单测，selfTest() 带正负样例零依赖。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync , realpathSync} from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASELINE = path.join(ROOT, "harness/baselines/parity.json");
const LEGACY_BASELINE = path.join(ROOT, "evidence/parity/baseline.json");
const DEFAULT_REPORT = path.join(ROOT, "harness/baselines/parity-report.json");
const TOLERANCE = 0.15;

/** 五项受控指标：pick() 从 { stats, counts } 快照（运行时钩子或 complete.mjs 报告同构）提取。 */
export const PARITY_METRICS = [
  { key: "drawCalls", label: "draw call", pick: (s) => s?.stats?.calls },
  { key: "tris", label: "三角形数", pick: (s) => s?.stats?.tris },
  { key: "materials", label: "材质数", pick: (s) => s?.counts?.materialCount },
  { key: "propKinds", label: "道具种类", pick: (s) => s?.counts?.propKinds },
  { key: "soundSpecs", label: "音效数", pick: (s) => s?.counts?.soundSpecs },
];

/** 快照 → 受控指标表（缺失项记 null，由 evaluate 判红）。 */
export function metricsFromSnapshot(snapshot) {
  const metrics = {};
  for (const m of PARITY_METRICS) {
    const raw = snapshot ? m.pick(snapshot) : undefined;
    metrics[m.key] = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  }
  return metrics;
}

/**
 * 漂移判定：|actual - baseline| / baseline ≤ tolerance（±15%）。
 * 特例：baseline=0 时要求 actual=0；任一侧缺失/非有限数值即红。
 */
export function evaluate(current, baseline, { tolerance = TOLERANCE } = {}) {
  const checks = [];
  for (const m of PARITY_METRICS) {
    const base = baseline ? baseline[m.key] : undefined;
    const actual = current ? current[m.key] : undefined;
    const baseOk = typeof base === "number" && Number.isFinite(base);
    const actualOk = typeof actual === "number" && Number.isFinite(actual);
    let pass = false;
    let drift = null;
    if (baseOk && actualOk) {
      if (base === 0) {
        pass = actual === 0;
      } else {
        drift = Math.abs(actual - base) / base;
        // 容差含边界；1e-9 吸收 |x*0.85-x|/x 一类浮点毛刺（真实越界 ≥1e-4 量级）
        pass = drift <= tolerance + 1e-9;
      }
    }
    checks.push({
      name: m.key,
      label: m.label,
      baseline: baseOk ? base : null,
      actual: actualOk ? actual : null,
      drift: drift == null ? null : +drift.toFixed(4),
      tolerance,
      pass,
    });
  }
  return { ok: checks.every((c) => c.pass), tolerance, checks, metrics: current ?? null };
}

function selfTest() {
  const problems = [];
  const base = { drawCalls: 188, tris: 43670, materials: 48, propKinds: 19, soundSpecs: 58 };

  // ---- 正样例 ----
  if (!evaluate({ ...base }, base).ok) problems.push("identical metrics must pass");
  if (!evaluate({ ...base, drawCalls: Math.round(base.drawCalls * 1.1) }, base).ok) problems.push("+10% drawCalls drift must pass");
  if (!evaluate({ ...base, soundSpecs: Math.round(base.soundSpecs * 0.9) }, base).ok) problems.push("-10% soundSpecs drift must pass");
  const atLimit = { ...base, materials: base.materials * 1.15 };
  if (!evaluate(atLimit, base).ok) problems.push("+15% boundary must pass（容差含边界）");
  const atLimitDown = { ...base, propKinds: base.propKinds * 0.85 };
  if (!evaluate(atLimitDown, base).ok) problems.push("-15% boundary must pass（容差含边界）");
  const zeroBase = { ...base, propKinds: 0 };
  if (!evaluate({ ...base, propKinds: 0 }, zeroBase).ok) problems.push("0 vs 0 baseline must pass");
  // 浮点边界之外的真实越界必须判红（+16% / -16%）
  if (evaluate({ ...base, tris: base.tris * 1.16 }, base).ok) problems.push("+16% tris must fail");
  if (evaluate({ ...base, tris: base.tris * 0.84 }, base).ok) problems.push("-16% tris must fail");

  // ---- 负样例 ----
  if (evaluate({ ...base, drawCalls: Math.round(base.drawCalls * 1.5) }, base).ok) problems.push("+50% drawCalls must fail");
  if (evaluate({ ...base, soundSpecs: Math.round(base.soundSpecs * 0.7) }, base).ok) problems.push("-30% soundSpecs must fail");
  if (evaluate({ ...base, materials: base.materials * 1.15 + 1 }, base).ok) problems.push("beyond +15% must fail");
  if (evaluate({ ...base, propKinds: base.propKinds * 0.85 - 0.01 }, base).ok) problems.push("just beyond -15% must fail");
  const missingSound = { drawCalls: base.drawCalls, tris: base.tris, materials: base.materials, propKinds: base.propKinds };
  if (evaluate(missingSound, base).ok) problems.push("missing actual metric must fail");
  if (evaluate(base, {}).ok) problems.push("empty baseline must fail");
  if (evaluate(base, null).ok) problems.push("null baseline must fail");
  if (evaluate(null, base).ok) problems.push("null current must fail");
  if (evaluate(base, zeroBase).ok) problems.push("nonzero actual vs zero baseline must fail");

  // ---- 映射：运行时/报告快照 → 指标表 ----
  const snap = {
    stats: { calls: 188, tris: 43670, geos: 95, tex: 99, programs: 23 },
    counts: { materialCount: 48, propKinds: 19, soundSpecs: 58, placedProps: 60 },
  };
  const m = metricsFromSnapshot(snap);
  if (m.drawCalls !== 188 || m.tris !== 43670 || m.materials !== 48 || m.propKinds !== 19 || m.soundSpecs !== 58) {
    problems.push("metricsFromSnapshot mapping wrong");
  }
  const empty = metricsFromSnapshot(null);
  if (Object.values(empty).some((v) => v !== null)) problems.push("metricsFromSnapshot(null) must yield all-null metrics");

  if (problems.length) {
    console.error(`parity --self-test FAILED: ${[...new Set(problems)].join("; ")}`);
    return 1;
  }
  console.log("parity --self-test OK: 一致/±10%/±15%边界/零基线 正样例 与 膨胀/缩水/越界/缺失 负样例全部成立");
  return 0;
}

function parseArgs(argv) {
  const out = { selfTest: false, record: false, force: false, scene: null, report: null, baseline: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--self-test") out.selfTest = true;
    else if (a === "--record") out.record = true;
    else if (a === "--force") out.force = true;
    else if (a === "--scene") { i += 1; out.scene = argv[i]; }
    else if (a === "--report") { i += 1; out.report = argv[i]; }
    else if (a === "--baseline") { i += 1; out.baseline = argv[i]; }
  }
  return out;
}

function loadJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** 默认基线：新路径优先；旧路径仅作只读回退。 */
function resolveBaseline(explicit) {
  if (explicit) return { path: path.resolve(ROOT, explicit), legacy: false };
  if (existsSync(BASELINE)) return { path: BASELINE, legacy: false };
  if (existsSync(LEGACY_BASELINE)) return { path: LEGACY_BASELINE, legacy: true };
  return { path: BASELINE, legacy: false };
}

/** --record 的写入目标：默认永远是入库新路径，不回写 evidence/。 */
function recordTarget(explicit) {
  return explicit ? path.resolve(ROOT, explicit) : BASELINE;
}

function summarizeMetrics(metrics) {
  return PARITY_METRICS.map((m) => `${m.key}=${metrics?.[m.key] ?? "null"}`).join(" ");
}

function summarizeBaseline(data) {
  const metrics = data?.metrics || data;
  return `${summarizeMetrics(metrics)} @ ${data?.generatedAt || "?"}（${data?.source || "?"}）`;
}

/** 采集现场实测快照：口径与 complete.mjs 的 auditScene 一致（?bench&seed=4207、800x450）。 */
async function captureScene(sceneRel) {
  const sceneName = path.basename(path.resolve(ROOT, sceneRel));
  const html = path.join(ROOT, "build", sceneName, "index.html");
  if (!existsSync(html)) {
    console.error(`parity: missing ${path.relative(ROOT, html)} — run node ${sceneRel}/build.mjs first`);
    process.exitCode = 1;
    return null;
  }
  const { launchFixture, snapshot } = await import("../boot.mjs");
  const session = await launchFixture({
    url: `${pathToFileURL(html).href}?bench&seed=4207`,
    waitMs: 3000,
    viewport: [800, 450],
  });
  try {
    await snapshot(session.page, { heartbeatMs: 500 });
    const runtime = await session.page.evaluate(() => ({
      parity: window.__PARITY__ || null,
      stats: window.__stats ? window.__stats() : null,
      errors: (window.__errors || []).slice(-5),
    }));
    if (runtime.errors.length) {
      console.error(`parity: scene runtime errors: ${runtime.errors.join(" | ")}`);
      process.exitCode = 1;
      return null;
    }
    if (!runtime.parity?.counts || !runtime.stats) {
      console.error("parity: window.__PARITY__.counts / window.__stats() 缺失——检视钩子未接入（见 references/12 的检视钩子契约）");
      process.exitCode = 1;
      return null;
    }
    return { counts: runtime.parity.counts, stats: runtime.stats };
  } finally {
    await session.close();
  }
}

/** 读取 report 或现场采集；返回 { snapshot, source } 或 null（错误已打印）。 */
async function readSource(args) {
  if (args.report) {
    const reportPath = path.resolve(ROOT, args.report);
    if (!existsSync(reportPath)) {
      console.error(`parity: missing report ${reportPath}`);
      process.exitCode = 1;
      return null;
    }
    return { snapshot: loadJson(reportPath), source: path.relative(ROOT, reportPath) };
  }
  const snapshot = await captureScene(args.scene);
  if (!snapshot) return null;
  return { snapshot, source: `scene ${args.scene} (live)` };
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.selfTest) return selfTest();

  if (args.record) {
    const target = recordTarget(args.baseline);
    const existed = existsSync(target);

    // 保护：已有基线默认拒绝覆盖（不看数据源，避免先跑 Chrome 再失败）。
    if (existed && !args.force) {
      console.error(`parity: baseline 已存在 → ${path.relative(ROOT, target)}`);
      console.error(`parity: old → ${summarizeBaseline(loadJson(target))}`);
      if (args.report) {
        const reportPath = path.resolve(ROOT, args.report);
        if (existsSync(reportPath)) {
          console.error(`parity: new → ${summarizeMetrics(metricsFromSnapshot(loadJson(reportPath)))}（${path.relative(ROOT, reportPath)}）`);
        } else {
          console.error(`parity: new → 未采集（report 不存在：${args.report}）`);
        }
      } else if (args.scene) {
        console.error("parity: new → 未采集（拒绝覆盖，未启动 Chrome；确需重录请加 --force）");
      } else {
        console.error("parity: new → 未采集（未提供 --scene/--report）");
      }
      console.error("parity: 拒绝覆盖既有 baseline；确需重录请加 --force");
      return 1;
    }

    let collected = null;
    if (args.scene || args.report) {
      collected = await readSource(args);
      if (!collected) return process.exitCode ?? 1;
    } else if (existsSync(DEFAULT_REPORT)) {
      collected = {
        snapshot: loadJson(DEFAULT_REPORT),
        source: `${path.relative(ROOT, DEFAULT_REPORT)} (recorded fixture)`,
      };
      console.log(`parity: 未提供 --scene/--report，使用入库报告夹具 ${path.relative(ROOT, DEFAULT_REPORT)} 重录`);
    } else {
      console.error("usage: node harness/gates/parity.mjs --record 需要 --scene <dir> 或 --report <file>（或先入库 harness/baselines/parity-report.json）");
      return 2;
    }

    const metrics = metricsFromSnapshot(collected.snapshot);
    const baseline = {
      generatedAt: new Date().toISOString(),
      scene: args.scene || (existsSync(target) ? loadJson(target).scene : null),
      source: collected.source,
      tolerance: TOLERANCE,
      metrics,
    };
    if (existed) console.log(`parity: old → ${summarizeBaseline(loadJson(target))}`);
    console.log(`parity: new → ${summarizeMetrics(metrics)}（${collected.source}）`);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(baseline, null, 1)}\n`);
    console.log(`parity: baseline ${existed ? "overwritten（--force 覆盖既有基线）" : "recorded（首跑建基线）"} → ${path.relative(ROOT, target)}`);
    console.log(JSON.stringify(baseline, null, 1));
    return 0;
  }

  if (!args.scene && !args.report) {
    console.error("usage: node harness/gates/parity.mjs --scene <dir> [--record [--force]] | --report <file> | --self-test");
    return 2;
  }

  const collected = await readSource(args);
  if (!collected) return process.exitCode ?? 1;
  const metrics = metricsFromSnapshot(collected.snapshot);

  const resolved = resolveBaseline(args.baseline);
  const baselinePath = resolved.path;
  if (!existsSync(baselinePath)) {
    console.error(`parity: missing baseline ${path.relative(ROOT, baselinePath)} — 首跑加 --record 建基线`);
    return 1;
  }
  if (resolved.legacy) {
    console.error(`parity: 使用旧路径基线 ${path.relative(ROOT, baselinePath)}（只读回退）；建议迁移到 ${path.relative(ROOT, BASELINE)}`);
  }
  const baseline = loadJson(baselinePath);
  const result = evaluate(metrics, baseline.metrics || baseline, { tolerance: baseline.tolerance ?? TOLERANCE });
  const report = {
    generatedAt: new Date().toISOString(),
    source: collected.source,
    baseline: path.relative(ROOT, baselinePath),
    ok: result.ok,
    tolerance: result.tolerance,
    checks: result.checks,
    metrics,
  };
  console.log(JSON.stringify(report, null, 1));
  if (!result.ok) {
    const failed = result.checks
      .filter((c) => !c.pass)
      .map((c) => `${c.name}（${c.label}）: baseline ${c.baseline} → actual ${c.actual}${c.drift == null ? "" : `（漂移 ${(c.drift * 100).toFixed(1)}% > ±${(result.tolerance * 100).toFixed(0)}%）`}`);
    console.error(`parity gate FAILED: ${failed.join("; ")}`);
    return 1;
  }
  console.log(`parity gate OK: ${result.checks.length} 项指标均在 ±${(result.tolerance * 100).toFixed(0)}% 内`);
  return 0;
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error("parity.mjs crashed:", err && err.message ? err.message : err);
      process.exit(err.exitCode ?? 1);
    }
  );
}
