#!/usr/bin/env node
/**
 * harness/gates/browser-evidence.mjs — 7 个浏览器门禁的实测证据链。
 *
 * CLI: node harness/gates/browser-evidence.mjs --scene examples/parity --assert
 *
 * 契约：
 *  - 步骤表唯一来源：import { FULL_STEPS } from "../verify.mjs"，断言 length===7；
 *    本文件禁止自建步骤表（防回潮检查：文件内不得出现该 const 声明字面量）。
 *  - --scene 必须出现在至少一个 FULL_STEPS 的 args 中，否则 fail-closed。
 *  - 先跑 `node examples/parity/build.mjs --assert` 前置构建（记入 evidence.preflight），
 *    再按 FULL_STEPS 顺序执行 7 步；逐步记录 command/exit/durationSec/sha256。
 *  - 退出码：0=绿；任一步非 0 → status=fail、exit 1；环境阻塞 → status=n/a、
 *    stdout 打 environment-blocked、exit 3（不启动 Chrome 步骤）。
 *  - 证据：evidence/browser-gates.json（gitignored 运行产物，复现 = 重跑命令）。
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { FULL_STEPS } from "../verify.mjs";
import { EXIT_ENVIRONMENT_BLOCKED, sampleEnvironment } from "../boot.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EVIDENCE = path.join(ROOT, "evidence/browser-gates.json");
const EXPECTED_STEPS = 7;

function run(args, { capture = false } = {}) {
  const started = Date.now();
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  return {
    command: `node ${args.join(" ")}`,
    exit: result.status ?? 1,
    durationSec: Number(((Date.now() - started) / 1000).toFixed(1)),
    stdout: capture ? String(result.stdout || "") : "",
    stderr: capture ? String(result.stderr || "") : "",
  };
}

function digest(...parts) {
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

export async function main(argv = process.argv.slice(2)) {
  try {
    if (!Array.isArray(FULL_STEPS) || FULL_STEPS.length !== EXPECTED_STEPS) {
      console.error(`browser-evidence: FULL_STEPS length ${FULL_STEPS.length} != ${EXPECTED_STEPS}`);
      return 1;
    }
    const sceneIndex = argv.indexOf("--scene");
    const scene = sceneIndex >= 0 ? argv[sceneIndex + 1] : "examples/parity";
    const wantAssert = argv.includes("--assert");
    if (!FULL_STEPS.some(({ args }) => args.includes("--scene") && args[args.indexOf("--scene") + 1] === scene)) {
      console.error(`browser-evidence: ${scene} not referenced by any FULL_STEPS arg (fail-closed)`);
      return 1;
    }
    // 宿主环境：阻塞时直接 n/a + exit 3（boot.mjs 契约）
    const environment = sampleEnvironment();
    if (environment.blocked) {
      const evidence = {
        schema: "how2build3d/browser-gates@1",
        scene,
        status: "n/a",
        reason: `environment-blocked: ${environment.reason || "host steal/swap over threshold"}`,
        environment,
        steps: [],
        at: new Date().toISOString(),
      };
      mkdirSync(path.dirname(EVIDENCE), { recursive: true });
      writeFileSync(EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`);
      console.log(evidence.reason);
      console.log("environment-blocked");
      return EXIT_ENVIRONMENT_BLOCKED;
    }
    // preflight：构建场景（不混入 7 步计数）
    const preflight = run(["examples/parity/build.mjs", "--assert"], { capture: true });
    const steps = [];
    for (const step of preflight.exit === 0 ? FULL_STEPS : []) {
      const executed = run(step.args, { capture: true });
      steps.push({
        label: step.label,
        command: executed.command,
        exit: executed.exit,
        durationSec: executed.durationSec,
        sha256: digest(executed.stdout, executed.stderr),
      });
      console.log(`[browser-evidence] ${step.label} → exit ${executed.exit}（${executed.durationSec}s）`);
      if (executed.exit === EXIT_ENVIRONMENT_BLOCKED || (executed.exit !== 0 && !wantAssert)) break;
    }
    const failed = [preflight, ...steps].filter((s) => s.exit !== 0);
    const blocked = failed.length > 0 && failed.every(s => s.exit === EXIT_ENVIRONMENT_BLOCKED);
    const evidence = {
      schema: "how2build3d/browser-gates@1",
      scene,
      status: blocked ? "n/a" : failed.length ? "fail" : "pass",
      preflight: { command: preflight.command, exit: preflight.exit, durationSec: preflight.durationSec },
      environment,
      steps,
      at: new Date().toISOString(),
    };
    mkdirSync(path.dirname(EVIDENCE), { recursive: true });
    writeFileSync(EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`browser-evidence: ${steps.length}/${EXPECTED_STEPS} steps, ${failed.length} failed → ${evidence.status} (${path.relative(ROOT, EVIDENCE)})`);
    if (blocked) console.log("environment-blocked");
    return blocked ? EXIT_ENVIRONMENT_BLOCKED : failed.length ? 1 : 0;
  } catch (error) {
    console.error(`browser-evidence: ${error.message}`);
    return 1;
  }
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) process.exit(await main());
