/**
 * harness/eval/run.mjs — Skill 两臂评测 runner（spec 2026-11-19_skill-eval-disclosure / task-eval-runner）。
 *
 * 职责（Decisions 2026-11-19 + Parked P1）：
 *   1. 预注册解析：只读取 `harness/eval/README.md` 内唯一的 fenced json 块
 *      （schema=how2build3d/skill-eval-prereg@1）；块数不对、JSON 不合法或字段缺失一律判红；
 *   2. `--dry-run [--assert] [--out <plan.json>]`：生成 两臂 × prompts × samplesPerArm 的计划
 *      （schema=how2build3d/skill-eval-plan@1、status=not-run、全 null 指标骨架），
 *      绝不写 `evidence/eval/report.json`（落 report 即伪造证据）；
 *   3. `--execute` 拒绝门：缺 `--agent-cmd` / `--budget-usd` 时 exit 2 并打印 Parked P1 指引；
 *      实际两臂执行、盲评与 report 生成需 user 授权（Parked P1），本 runner 一律不执行。
 *
 * CLI:
 *   node harness/eval/run.mjs --self-test
 *   node harness/eval/run.mjs --dry-run [--assert] [--out <plan.json>]
 *   node harness/eval/run.mjs --execute [--agent-cmd <cmd>] [--budget-usd <usd>]
 *
 * 退出码：0 绿；1 预注册/计划判红；2 用法错误或授权拒绝门。
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PREREG_PATH = path.join(ROOT, "harness", "eval", "README.md");
const PREREG_REL = "harness/eval/README.md";
const DEFAULT_REPORT_REL = "evidence/eval/report.json";

export const PREREG_SCHEMA = "how2build3d/skill-eval-prereg@1";
export const PLAN_SCHEMA = "how2build3d/skill-eval-plan@1";
export const PLAN_STATUS = "not-run";
const CANONICAL_ARMS = ["with-skill", "without-skill"];
const CANONICAL_METRICS = ["gatePassCount", "referenceParityDelta", "blindScore"];
const CANONICAL_REQUIRES = ["--agent-cmd", "--budget-usd"];

const PARKED_P1_GUIDE = [
  "Parked P1（spec 包 2026-11-19_skill-eval-disclosure）：实际两臂执行（agent 实跑、盲评主持）与",
  `evidence/eval/report.json 的生成需要 user 提供 agent 命令、预算与盲评样本；未授权前只允许`,
  "node harness/eval/run.mjs --dry-run --assert --out <plan.json>（计划 status=not-run）。",
  "本 runner 不执行任何 agent 命令；授权前落 report 即伪造证据。",
].join("\n");

// ---------------------------------------------------------------------------
// 预注册解析：只认 fenced json 块，README 明言它是本文件唯一的围栏代码块
// ---------------------------------------------------------------------------

const JSON_FENCE_RE = /^```json[^\S\n]*\n([\s\S]*?)\n```[^\S\n]*$/gm;

export function parsePreregBlock(text) {
  const problems = [];
  const blocks = [...String(text).matchAll(JSON_FENCE_RE)].map((m) => m[1]);
  if (blocks.length !== 1) {
    problems.push(`预注册 fenced json 块必须恰好 1 个（实际 ${blocks.length} 个）`);
    return { prereg: null, problems };
  }
  let prereg;
  try {
    prereg = JSON.parse(blocks[0]);
  } catch (err) {
    problems.push(`预注册块不是合法 JSON: ${err && err.message ? err.message : err}`);
    return { prereg: null, problems };
  }
  if (prereg === null || typeof prereg !== "object" || Array.isArray(prereg)) {
    problems.push("预注册块必须是 JSON object");
    return { prereg: null, problems };
  }

  if (prereg.schema !== PREREG_SCHEMA) {
    problems.push(`schema 必须为 ${PREREG_SCHEMA}（实际 ${JSON.stringify(prereg.schema)}）`);
  }
  if (typeof prereg.registeredAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(prereg.registeredAt)) {
    problems.push(`registeredAt 缺失或非 YYYY-MM-DD 日期（实际 ${JSON.stringify(prereg.registeredAt)}）`);
  }

  const armsOk =
    Array.isArray(prereg.arms) &&
    prereg.arms.length === CANONICAL_ARMS.length &&
    CANONICAL_ARMS.every((a) => prereg.arms.includes(a));
  if (!armsOk) problems.push(`arms 必须恰为 ${CANONICAL_ARMS.join(" / ")}（实际 ${JSON.stringify(prereg.arms)}）`);

  if (!Array.isArray(prereg.prompts) || prereg.prompts.length === 0) {
    problems.push("prompts 必须为非空数组");
  } else {
    const ids = new Set();
    for (const p of prereg.prompts) {
      if (!p || typeof p !== "object" || Array.isArray(p)) {
        problems.push("prompts 项必须是 object");
        continue;
      }
      for (const field of ["id", "taskType", "tier", "text"]) {
        if (typeof p[field] !== "string" || !p[field].trim()) {
          problems.push(`prompt ${p.id || "?"} 缺字段 ${field} 或为空`);
        }
      }
      if (typeof p.id === "string" && p.id.trim()) {
        if (ids.has(p.id)) problems.push(`prompt id 重复: ${p.id}`);
        ids.add(p.id);
      }
    }
  }

  const metrics = prereg.metrics;
  const metricsOk =
    Array.isArray(metrics) &&
    metrics.length > 0 &&
    metrics.every((m) => typeof m === "string" && m.trim()) &&
    new Set(metrics).size === metrics.length;
  if (!metricsOk) problems.push("metrics 必须为非空、去重的字符串数组");
  else {
    const missingMetric = CANONICAL_METRICS.filter((m) => !metrics.includes(m));
    if (missingMetric.length) problems.push(`metrics 缺预注册钉死的指标: ${missingMetric.join(", ")}`);
  }

  if (!Number.isInteger(prereg.samplesPerArm) || prereg.samplesPerArm < 1) {
    problems.push(`samplesPerArm 必须为 ≥1 的整数（实际 ${JSON.stringify(prereg.samplesPerArm)}）`);
  }
  if (typeof prereg.blindReview !== "string" || !prereg.blindReview.trim()) {
    problems.push("blindReview 缺失或为空");
  }
  if (typeof prereg.judgement !== "string" || !prereg.judgement.trim()) {
    problems.push("judgement 缺失或为空");
  }

  const ex = prereg.execution;
  if (!ex || typeof ex !== "object" || Array.isArray(ex)) {
    problems.push("execution 缺失或不是 object");
  } else {
    if (ex.status !== "parked") problems.push(`execution.status 必须为 parked（实际 ${JSON.stringify(ex.status)}）`);
    const requires = Array.isArray(ex.requires) ? ex.requires : [];
    const missingReq = CANONICAL_REQUIRES.filter((f) => !requires.includes(f));
    if (missingReq.length) problems.push(`execution.requires 缺授权参数: ${missingReq.join(", ")}`);
    if (typeof ex.report !== "string" || !ex.report.trim()) {
      problems.push("execution.report 缺失或为空");
    } else if (path.isAbsolute(ex.report) || ex.report.split("/").includes("..")) {
      problems.push(`execution.report 必须是仓库内相对路径（实际 ${ex.report}）`);
    }
  }

  return { prereg: problems.length ? null : prereg, problems };
}

// ---------------------------------------------------------------------------
// 计划生成：两臂 × prompts × samplesPerArm，指标骨架全 null（status=not-run）
// ---------------------------------------------------------------------------

export function buildPlan(prereg, { source = PREREG_REL, generatedAt = new Date().toISOString() } = {}) {
  const metricSkeleton = () => Object.fromEntries(prereg.metrics.map((m) => [m, null]));
  const arms = prereg.arms.map((arm) => ({
    name: arm,
    metrics: null, // 聚合指标未复算，全 null 骨架
    samples: prereg.prompts.flatMap((p) =>
      Array.from({ length: prereg.samplesPerArm }, (_, i) => ({
        promptId: p.id,
        taskType: p.taskType,
        tier: p.tier,
        seed: i + 1, // 样本间只换随机种子（预注册「样本量与盲评」）
        metrics: metricSkeleton(),
      }))
    ),
  }));
  return {
    schema: PLAN_SCHEMA,
    status: PLAN_STATUS,
    generatedAt,
    prereg: { source, schema: prereg.schema, registeredAt: prereg.registeredAt },
    prompts: prereg.prompts.map((p) => ({ ...p })),
    metrics: [...prereg.metrics],
    samplesPerArm: prereg.samplesPerArm,
    arms,
    totalRuns: arms.length * prereg.prompts.length * prereg.samplesPerArm,
    gateMatrix: `${PREREG_REL} 门禁矩阵（gatePassCount 按任务类型查该表）`,
    execution: { ...prereg.execution },
  };
}

/** 对已生成的计划做独立断言（--assert 与 self-test 共用）。 */
export function assertPlan(plan, prereg) {
  const problems = [];
  const expect = (cond, msg) => {
    if (!cond) problems.push(msg);
  };
  expect(plan.schema === PLAN_SCHEMA, `计划 schema 必须为 ${PLAN_SCHEMA}（实际 ${JSON.stringify(plan.schema)}）`);
  expect(plan.status === PLAN_STATUS, `计划 status 必须为 ${PLAN_STATUS}（实际 ${JSON.stringify(plan.status)}）`);
  expect(Array.isArray(plan.arms) && plan.arms.length === 2, `计划必须恰两臂（实际 ${Array.isArray(plan.arms) ? plan.arms.length : "非数组"}）`);
  if (!Array.isArray(plan.arms) || plan.arms.length !== 2) return problems;

  const samplesExpected = prereg.prompts.length * prereg.samplesPerArm;
  for (const arm of plan.arms) {
    expect(prereg.arms.includes(arm.name), `未知臂名: ${JSON.stringify(arm.name)}`);
    expect(arm.metrics == null, `臂 ${arm.name} 的聚合指标必须为 null（未执行不得有值）`);
    expect(Array.isArray(arm.samples) && arm.samples.length === samplesExpected, `臂 ${arm.name} 样本数必须为 prompts×samplesPerArm=${samplesExpected}`);
    const seedsByPrompt = new Map();
    for (const s of Array.isArray(arm.samples) ? arm.samples : []) {
      const prompt = prereg.prompts.find((p) => p.id === s.promptId);
      expect(Boolean(prompt), `臂 ${arm.name} 样本引用未知 promptId: ${JSON.stringify(s.promptId)}`);
      const metricEntries = Object.entries(s.metrics || {});
      expect(metricEntries.length === prereg.metrics.length, `臂 ${arm.name}/${s.promptId}#seed${s.seed} 指标骨架与预注册 metrics 不一致`);
      for (const [name, value] of metricEntries) {
        expect(prereg.metrics.includes(name) && value === null, `臂 ${arm.name}/${s.promptId}#seed${s.seed} 指标 ${name} 必须为 null（实际 ${JSON.stringify(value)}）`);
      }
      const seeds = seedsByPrompt.get(s.promptId) || new Set();
      expect(!seeds.has(s.seed), `臂 ${arm.name}/${s.promptId} seed 重复: ${s.seed}`);
      seeds.add(s.seed);
      seedsByPrompt.set(s.promptId, seeds);
    }
  }
  expect(JSON.stringify(plan.prompts) === JSON.stringify(prereg.prompts), "计划 prompts 与预注册逐字不一致（冻结文本被改动）");
  expect(JSON.stringify(plan.metrics) === JSON.stringify(prereg.metrics), "计划 metrics 与预注册不一致");
  expect(plan.totalRuns === plan.arms.length * samplesExpected, `totalRuns 必须为 ${plan.arms.length * samplesExpected}（实际 ${JSON.stringify(plan.totalRuns)}）`);
  return problems;
}

// ---------------------------------------------------------------------------
// dry-run：只写计划，绝不写 report
// ---------------------------------------------------------------------------

function runDryRun({ readmePath = PREREG_PATH, reportRel = DEFAULT_REPORT_REL, outPath, assert, sourceRel = PREREG_REL, log = console.log }) {
  if (!existsSync(readmePath)) {
    console.error(`eval runner: 找不到预注册文件 ${readmePath}`);
    return 1;
  }
  const { prereg, problems } = parsePreregBlock(readFileSync(readmePath, "utf8"));
  if (problems.length) {
    console.error(`eval runner: 预注册解析 FAILED（${sourceRel}）:`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    return 1;
  }
  const reportPath = path.resolve(ROOT, prereg.execution.report || reportRel);
  const reportExisted = existsSync(reportPath);

  const plan = buildPlan(prereg, { source: sourceRel });
  if (assert) {
    const planProblems = assertPlan(plan, prereg);
    if (planProblems.length) {
      console.error(`eval runner: 计划断言 FAILED:`);
      for (const p of planProblems) console.error(`  ✗ ${p}`);
      return 1;
    }
  }
  if (outPath) {
    mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(plan, null, 2)}\n`);
  } else {
    log(JSON.stringify(plan, null, 2));
  }
  if (!reportExisted && existsSync(reportPath)) {
    console.error(`eval runner: dry-run 不得写 ${path.relative(ROOT, reportPath)}`);
    return 1;
  }
  log(
    `eval runner: dry-run 计划${outPath ? ` → ${outPath}` : "（stdout）"}`
    + ` (schema=${PLAN_SCHEMA}, status=${PLAN_STATUS},`
    + ` ${plan.arms.length} 臂 × ${prereg.prompts.length} 提示 × ${prereg.samplesPerArm} 样本 = ${plan.totalRuns} 次运行,`
    + ` 指标骨架全 null; ${path.relative(ROOT, reportPath)} 未生成)`
  );
  return 0;
}

// ---------------------------------------------------------------------------
// --execute 拒绝门：实际执行是 Parked P1，永远 exit 2、绝不落 report
// ---------------------------------------------------------------------------

function executeGate(flags) {
  const missing = CANONICAL_REQUIRES.filter((f) => !flags[f]);
  if (missing.length) {
    console.error(`eval runner: --execute 缺授权参数: ${missing.join(", ")}`);
  } else {
    console.error("eval runner: --agent-cmd / --budget-usd 已提供，但实际两臂执行仍未解锁：");
  }
  console.error(PARKED_P1_GUIDE);
  return 2;
}

// ---------------------------------------------------------------------------
// self-test：临时夹具覆盖 计划生成 / 缺字段负样例 / dry-run 不落 report
// ---------------------------------------------------------------------------

function fixturePrereg(overrides = {}) {
  return {
    schema: PREREG_SCHEMA,
    registeredAt: "2026-11-20",
    arms: ["with-skill", "without-skill"],
    prompts: [
      { id: "P1", taskType: "质感复刻", tier: "visual", text: "夹具提示一（合成，不指向真实场景）。" },
      { id: "P2", taskType: "元素对拍", tier: "full", text: "夹具提示二（合成，不指向真实场景）。" },
    ],
    metrics: ["gatePassCount", "referenceParityDelta", "blindScore"],
    samplesPerArm: 2,
    blindReview: "夹具盲评方式（合成）。",
    judgement: "夹具判读门槛（合成）。",
    execution: {
      status: "parked",
      requires: ["--agent-cmd", "--budget-usd"],
      report: "evidence/eval/report.json",
      note: "夹具（合成）。",
    },
    ...overrides,
  };
}

function fixtureReadme(prereg, { duplicateBlock = false, omitBlock = false } = {}) {
  if (omitBlock) return "# 夹具（无预注册块）\n";
  const block = "```json\n" + JSON.stringify(prereg, null, 2) + "\n```";
  return `# 夹具预注册（合成，不依赖交付文档）\n\n${block}${duplicateBlock ? `\n\n${block}` : ""}\n`;
}

function selfTest() {
  const failures = [];
  const expect = (condition, label) => {
    if (!condition) failures.push(label);
  };
  const tmp = mkdtempSync(path.join(tmpdir(), "h2b-eval-selftest-"));
  try {
    // 1) 计划生成：正例解析 + 形状断言
    const readmePath = path.join(tmp, "README.md");
    writeFileSync(readmePath, fixtureReadme(fixturePrereg()));
    const { prereg, problems } = parsePreregBlock(readFileSync(readmePath, "utf8"));
    expect(problems.length === 0, `正例被拒: ${JSON.stringify(problems)}`);
    const plan = buildPlan(prereg, { source: readmePath, generatedAt: "2026-11-20T00:00:00.000Z" });
    expect(plan.schema === PLAN_SCHEMA && plan.status === PLAN_STATUS, `计划 schema/status 异常: ${plan.schema}/${plan.status}`);
    expect(plan.arms.length === 2, `计划臂数异常: ${plan.arms.length}`);
    expect(plan.arms.every((a) => a.metrics == null), "臂级聚合指标必须为 null");
    for (const arm of plan.arms) {
      expect(arm.samples.length === prereg.prompts.length * prereg.samplesPerArm, `臂 ${arm.name} 样本数异常: ${arm.samples.length}`);
      expect(arm.samples.every((s) => Object.values(s.metrics).every((v) => v === null)), `臂 ${arm.name} 指标骨架必须全 null`);
      expect(
        arm.samples.every((s) => Number.isInteger(s.seed) && s.seed >= 1 && s.seed <= prereg.samplesPerArm),
        `臂 ${arm.name} seed 越界`
      );
    }
    expect(plan.totalRuns === 2 * 2 * 2, `totalRuns 异常: ${plan.totalRuns}`);
    expect(assertPlan(plan, prereg).length === 0, `正例计划未过断言: ${JSON.stringify(assertPlan(plan, prereg))}`);

    // 2) 缺字段负样例：每类都必须判红
    const negatives = [
      ["缺 arms", fixturePrereg({ arms: undefined })],
      ["缺 prompts", fixturePrereg({ prompts: undefined })],
      ["缺 metrics", fixturePrereg({ metrics: undefined })],
      ["缺 samplesPerArm", fixturePrereg({ samplesPerArm: undefined })],
      ["缺 blindReview", fixturePrereg({ blindReview: undefined })],
      ["execution.requires 缺 --budget-usd", fixturePrereg({ execution: { status: "parked", requires: ["--agent-cmd"], report: "evidence/eval/report.json" } })],
      ["schema 错误", fixturePrereg({ schema: "how2build3d/skill-eval-prereg@2" })],
      ["arms 少一臂", fixturePrereg({ arms: ["with-skill"] })],
      ["prompt 缺 text", fixturePrereg({ prompts: [{ id: "P1", taskType: "质感复刻", tier: "visual", text: "" }] })],
    ];
    for (const [label, preregFixture] of negatives) {
      const result = parsePreregBlock(fixtureReadme(preregFixture));
      expect(result.problems.length > 0, `负样例未判红: ${label}`);
    }
    expect(parsePreregBlock(fixtureReadme(fixturePrereg(), { omitBlock: true })).problems.length > 0, "负样例未判红: 零个 fenced json 块");
    expect(parsePreregBlock(fixtureReadme(fixturePrereg(), { duplicateBlock: true })).problems.length > 0, "负样例未判红: 两个 fenced json 块");
    expect(parsePreregBlock("# x\n\n```json\n{bad json\n```\n").problems.length > 0, "负样例未判红: JSON 不合法");

    // 3) dry-run 不落 report：tmp 内同相对布局，计划写入、report 不出现
    const outPath = path.join(tmp, "plan.json");
    const reportPath = path.join(tmp, "evidence", "eval", "report.json");
    const rc = runDryRun({ readmePath, reportRel: "evidence/eval/report.json", outPath, assert: true, sourceRel: "README.md", log: () => {} });
    expect(rc === 0, `夹具 dry-run 未过: rc=${rc}`);
    expect(!existsSync(reportPath), "dry-run 落了 evidence/eval/report.json（伪造证据）");
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    expect(written.schema === PLAN_SCHEMA && written.status === PLAN_STATUS, `落盘计划 schema/status 异常: ${written.schema}/${written.status}`);
    expect(written.arms.length === 2 && written.arms.every((a) => a.metrics == null), "落盘计划臂/指标骨架异常");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error("eval runner --self-test FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    return 1;
  }
  console.log(
    "eval runner --self-test OK: 计划生成（两臂×prompts×samplesPerArm、指标骨架全 null、status=not-run）"
    + " + 12 类缺字段/形状负样例判红"
    + " + dry-run 不落 evidence/eval/report.json"
  );
  return 0;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = "usage: node harness/eval/run.mjs --self-test | --dry-run [--assert] [--out <plan.json>] | --execute [--agent-cmd <cmd>] [--budget-usd <usd>]";

export async function main(argv) {
  if (argv.includes("--self-test")) {
    if (argv.length > 1) {
      console.error("eval runner: --self-test 不接受其它参数");
      return 2;
    }
    return selfTest();
  }
  const hasDryRun = argv.includes("--dry-run");
  const hasExecute = argv.includes("--execute");
  if (hasDryRun === hasExecute) {
    // 两者同给或同缺都算用法错误
    console.error(USAGE);
    return 2;
  }
  const valueFlags = new Set(["--out", "--agent-cmd", "--budget-usd"]);
  const known = new Set(["--dry-run", "--execute", "--assert", ...valueFlags]);
  const flags = { "--dry-run": hasDryRun, "--execute": hasExecute };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!known.has(arg)) {
      console.error(`eval runner: unknown flag: ${arg}`);
      console.error(USAGE);
      return 2;
    }
    if (valueFlags.has(arg)) {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        console.error(`eval runner: ${arg} 需要一个值`);
        return 2;
      }
      flags[arg] = value;
      i += 1;
    } else if (!(arg in flags)) {
      flags[arg] = true;
    }
  }
  if (hasDryRun) return runDryRun({ outPath: flags["--out"], assert: Boolean(flags["--assert"]) });
  return executeGate(flags);
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error("eval runner crashed:", err && err.message ? err.message : err);
      process.exit(1);
    }
  );
}
