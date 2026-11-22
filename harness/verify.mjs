/**
 * harness/verify.mjs — 全量验证入口（失败即停，逐步打印 exit code）。
 *
 * 两个模式：
 *   --static（默认）  无 Chrome 的静态链：prettify → 文档/引用门禁（--all、--all-tracked
 *                     与 --self-test）→ Skill/创物门禁 → 各 gate --self-test →
 *                     四个示例 build --assert → 资产门禁（quality/parity/gameplay）→
 *                     complete --structure-only --no-evidence（parity；跳过未入库截图，
 *                     并打印 EVIDENCE NOT CHECKED）→ parity 漂移门禁（入库报告夹具）→
 *                     scaffold --check。可在无浏览器环境的 CI 中运行。
 *   --full            先跑完整静态链，再追加 Chrome 门禁：parity 现场实测、九展厅自检
 *                     （quality/parity）、render/scene 与 render/starter 渲染验收、
 *                     visual 感知下限，最后跑含截图证据的 complete（parity）。
 *                     需要系统 Chrome（playwright-core 的 channel: "chrome"）。
 *
 * 设计约束：
 *   - 静态链不得启动 Chrome：parity 用 --report harness/baselines/parity-report.json
 *     做基线比对；--scene 现场实测只出现在 --full。
 *   - 截图证据（evidence/inspect/*.png）是 Chrome 运行产物、不入库；静态链用
 *     complete --no-evidence 只验结构，证据完整性由 --full 的 inspect + complete 负责。
 *   - 任一子进程非 0 立即停止，不吞掉后续失败。
 *   - CI（.gitea/workflows/verify.yml）跑 --static；Chrome 链按 nightly/手动触发。
 *
 * CLI:
 *   node harness/verify.mjs --static
 *   node harness/verify.mjs --full
 *   node harness/verify.mjs --help
 */
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 静态链：全部步骤禁止依赖 Chrome。顺序有依赖（先 build，再做资产/对账/漂移比对）。 */
const STATIC_STEPS = [
  { label: "prettify（beautify 证据）", args: ["harness/capture/prettify.mjs", "--assert"] },
  { label: "文档门禁", args: ["harness/gates/doc.mjs", "--all"] },
  { label: "文档门禁（tracked 全量）", args: ["harness/gates/doc.mjs", "--all-tracked"] },
  { label: "文档门禁自测", args: ["harness/gates/doc.mjs", "--self-test"] },
  { label: "引用门禁", args: ["harness/gates/citations.mjs", "--all", "--strict"] },
  { label: "引用门禁自测", args: ["harness/gates/citations.mjs", "--self-test"] },
  { label: "Skill 门禁", args: ["harness/gates/skill.mjs", "."] },
  { label: "创物篇门禁", args: ["harness/gates/creation.mjs"] },
  { label: "资产门禁自测", args: ["harness/gates/assets.mjs", "--self-test"] },
  { label: "元素对账自测", args: ["harness/gates/complete.mjs", "--self-test"] },
  { label: "漂移门禁自测", args: ["harness/gates/parity.mjs", "--self-test"] },
  { label: "性能门禁自测", args: ["harness/gates/perf.mjs", "--self-test"] },
  { label: "展厅门禁自测", args: ["harness/gates/inspect.mjs", "--self-test"] },
  { label: "构建 starter", args: ["examples/starter/build.mjs", "--assert"] },
  { label: "构建 quality", args: ["examples/quality/build.mjs", "--assert"] },
  { label: "构建 parity", args: ["examples/parity/build.mjs", "--assert"] },
  { label: "构建 gameplay", args: ["examples/gameplay/build.mjs", "--assert"] },
  { label: "资产门禁 quality", args: ["harness/gates/assets.mjs", "--scene", "examples/quality"] },
  { label: "资产门禁 parity", args: ["harness/gates/assets.mjs", "--scene", "examples/parity"] },
  { label: "资产门禁 gameplay", args: ["harness/gates/assets.mjs", "--scene", "examples/gameplay"] },
  { label: "元素对账 parity（structure-only，跳过未入库截图）", args: ["harness/gates/complete.mjs", "--scene", "examples/parity", "--structure-only", "--no-evidence"] },
  { label: "漂移门禁 parity（静态报告夹具）", args: ["harness/gates/parity.mjs", "--report", "harness/baselines/parity-report.json"] },
  { label: "scaffold --check", args: ["scripts/scaffold-scene.mjs", "--name", "verify-probe", "--tier", "full", "--check"] },
  { label: "安装、嵌套生成与离线导出回归", args: ["--test", "harness/tests/delivery.test.mjs"] },
  { label: "scaffold 模板自测", args: ["scripts/scaffold-scene.mjs", "--self-test"] },
  { label: "公开导出排除规则自测", args: ["scripts/export-public.mjs", "--self-test"] },
];

/** Chrome 链：--full 才追加。顺序有依赖（inspect 产出截图，最后的 complete 读它）。 */
const FULL_STEPS = [
  { label: "漂移门禁 parity（现场实测）", args: ["harness/gates/parity.mjs", "--scene", "examples/parity"] },
  { label: "九展厅自检 quality", args: ["harness/gates/inspect.mjs", "--scene", "examples/quality"] },
  { label: "九展厅自检 parity", args: ["harness/gates/inspect.mjs", "--scene", "examples/parity"] },
  { label: "渲染验收 parity", args: ["harness/render/scene.mjs", "--scene", "examples/parity", "--assert", "--max-draws", "900"] },
  { label: "渲染验收 starter", args: ["harness/render/starter.mjs", "--assert"] },
  { label: "视觉感知下限 parity", args: ["harness/gates/visual.mjs", "--image", "evidence/frames/parity.png", "--floors"] },
  { label: "元素对账 parity（含截图证据）", args: ["harness/gates/complete.mjs", "--scene", "examples/parity"] },
];
// 单一来源导出：browser-evidence 门禁 import { FULL_STEPS } 并断言 length===7，禁止复制步骤表。
export { STATIC_STEPS, FULL_STEPS };


const USAGE = `usage:
  node harness/verify.mjs --static   # 无 Chrome 静态链（默认）
  node harness/verify.mjs --full     # 静态链 + Chrome 门禁（需系统 Chrome）
  node harness/verify.mjs --help`;

function runStep(step, index, total) {
  console.log(`\n=== [${index}/${total}] ${step.label} ===`);
  console.log(`$ node ${step.args.join(" ")}`);
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, step.args, { cwd: ROOT, stdio: "inherit", env: process.env });
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  if (result.error) {
    console.error(`verify: ${step.label} 无法启动：${result.error.message}`);
    return 1;
  }
  const code = result.status ?? (result.signal ? 128 : 1);
  if (code === 3) {
    // exit 3 = environment-blocked：宿主噪声，不是产品红（boot.mjs 契约）。
    console.log(`environment-blocked: ${step.label}（宿主 steal/swap 超阈值；非产品失败）`);
  }
  console.log(`=== [${index}/${total}] ${step.label} → exit ${code}（${elapsed}s）===`);
  return code;
}

export async function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  let mode = "static";
  let explicit = false;
  for (const a of argv) {
    if (a === "--static") {
      if (explicit && mode === "full") {
        console.error("verify: --static 与 --full 不能同时使用");
        return 2;
      }
      mode = "static";
      explicit = true;
    } else if (a === "--full") {
      if (explicit && mode === "static") {
        console.error("verify: --static 与 --full 不能同时使用");
        return 2;
      }
      mode = "full";
      explicit = true;
    } else {
      console.error(`verify: unknown arg ${a}`);
      console.log(USAGE);
      return 2;
    }
  }

  const steps = mode === "full" ? [...STATIC_STEPS, ...FULL_STEPS] : STATIC_STEPS;
  const suffix = mode === "full" ? "（含 Chrome 门禁，需系统 Chrome）" : "（无 Chrome）";
  console.log(`verify: mode=${mode} steps=${steps.length}${suffix}`);
  if (mode === "static") {
    console.log("verify: EVIDENCE NOT CHECKED（static 链用 complete --no-evidence；截图证据需 --full 的 inspect + 末尾 complete 验证）");
  }
  for (let i = 0; i < steps.length; i += 1) {
    const code = runStep(steps[i], i + 1, steps.length);
    if (code !== 0) {
      console.error(`\nverify FAILED (${mode}): 「${steps[i].label}」exit ${code}；已停止，后续 ${steps.length - i - 1} 步未运行`);
      return code;
    }
  }
  console.log(`\nverify OK (${mode}): ${steps.length} 步全部 exit 0`);
  return 0;
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error("verify.mjs crashed:", err && err.message ? err.message : err);
      process.exit(1);
    }
  );
}
