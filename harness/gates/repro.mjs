#!/usr/bin/env node
/**
 * harness/gates/repro.mjs — 可复现性门禁：parity 基线实测重录 与 inline-manifest 幂等。
 *
 * CLI:
 *   node harness/gates/repro.mjs --parity-baseline --assert
 *   node harness/gates/repro.mjs --inline-manifest --assert
 *
 * --parity-baseline：实测重录链（需系统 Chrome）
 *   build --assert → inspect（九展厅截图）→ complete（对账报告）→ parity --record --force
 *   → 实测报告同步为静态夹具 parity-report.json → baselines/README sha256 同步
 *   → parity --report 静态比对 ±15% 必须 exit 0；两基线 generatedAt 必须晚于 2026-11-14。
 *
 * --inline-manifest：生成物 snapshot 入库 + 构建幂等
 *   git show HEAD 的 committed snapshot 与重建结果 byte/hash 对比（git diff 仅辅助），
 *   并断言 baselines/README 写明该政策。
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASELINES = path.join(ROOT, "harness/baselines");
const PARITY_JSON = path.join(BASELINES, "parity.json");
const PARITY_REPORT = path.join(BASELINES, "parity-report.json");
const README = path.join(BASELINES, "README.md");
const INLINE_MANIFEST = path.join(ROOT, "examples/parity/inline-manifest.json");
const STALE_BEFORE = "2026-11-14";

function run(cmd, args, { ok = true } = {}) {
  const result = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  const tail = (result.stdout || "").trim().split("\n").slice(-3).join(" | ");
  if (result.status !== 0) {
    throw new Error(`step failed (${cmd} ${args.join(" ")}): ${(result.stderr || result.stdout || "").trim().split("\n").slice(-4).join(" | ")}`);
  }
  if (ok && tail) console.log(`  · ${tail}`);
  return result.stdout || "";
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function generatedAt(file) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  return String(data.generatedAt || "");
}

function syncReadmeHashes() {
  let text = readFileSync(README, "utf8");
  for (const [name, file] of [["parity.json", PARITY_JSON], ["parity-report.json", PARITY_REPORT]]) {
    const digest = sha256(file);
    const row = new RegExp("(\\| `" + name + "`[^|]*\\|[^|]*\\|[^|]*\\|)[^|]*(\\|)");
    if (!row.test(text)) throw new Error(`baselines/README.md has no table row for ${name}`);
    text = text.replace(row, `$1 \`${digest}\` $2`);
  }
  writeFileSync(README, text);
}

export function parityBaseline() {
  run("node", ["examples/parity/build.mjs", "--assert"]);
  console.log("repro parity-baseline: step 1/6 build ok");
  run("node", ["harness/gates/inspect.mjs", "--scene", "examples/parity"]);
  console.log("repro parity-baseline: step 2/6 inspect ok");
  run("node", ["harness/gates/complete.mjs", "--scene", "examples/parity"]);
  console.log("repro parity-baseline: step 3/6 complete ok");
  run("node", ["harness/gates/parity.mjs", "--scene", "examples/parity", "--record", "--force"]);
  console.log("repro parity-baseline: step 4/6 re-record ok");
  const freshReport = path.join(ROOT, "evidence/parity/parity.json");
  if (!existsSync(freshReport)) throw new Error("evidence/parity/parity.json missing after complete");
  const reportBytes = readFileSync(freshReport);
  const reportHash = createHash("sha256").update(reportBytes).digest("hex");
  writeFileSync(PARITY_REPORT, reportBytes);
  console.log("repro parity-baseline: step 5/6 report synced to static fixture");
  const stamps = { "parity.json": generatedAt(PARITY_JSON), "parity-report.json": generatedAt(PARITY_REPORT) };
  for (const [name, stamp] of Object.entries(stamps)) {
    if (!stamp || !(stamp > STALE_BEFORE)) {
      throw new Error(`${name} generatedAt=${stamp || "(missing)"} not later than ${STALE_BEFORE}`);
    }
  }
  syncReadmeHashes();
  console.log("repro parity-baseline: README sha256 synced");
  run("node", ["harness/gates/parity.mjs", "--report", "harness/baselines/parity-report.json"]);
  console.log("repro parity-baseline: step 6/6 static ±15% compare ok");
  console.log(`repro parity-baseline OK: parity.json@${stamps["parity.json"]} report@${stamps["parity-report.json"]} (report sha256 ${reportHash.slice(0, 12)}…)`);
  return 0;
}

export function inlineManifest() {
  const committed = spawnSync("git", ["show", "HEAD:examples/parity/inline-manifest.json"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (committed.status !== 0) throw new Error("git show HEAD:inline-manifest.json failed (not committed yet?)");
  const committedBytes = Buffer.from(committed.stdout, "utf8");
  const committedHash = createHash("sha256").update(committedBytes).digest("hex");
  run("node", ["examples/parity/build.mjs", "--assert"]);
  if (!existsSync(INLINE_MANIFEST)) throw new Error("inline-manifest.json not produced by build");
  const rebuiltBytes = readFileSync(INLINE_MANIFEST);
  const rebuiltHash = createHash("sha256").update(rebuiltBytes).digest("hex");
  const byteIdentical = committedBytes.equals(rebuiltBytes);
  const readme = readFileSync(README, "utf8");
  const policyOk = readme.includes("snapshot 入库") && readme.includes("构建幂等");
  const problems = [];
  if (!byteIdentical) problems.push(`rebuilt bytes differ from committed snapshot (${committedHash} vs ${rebuiltHash})`);
  if (!policyOk) problems.push("baselines/README.md lacks the snapshot 入库 + 构建幂等 policy");
  if (problems.length) {
    for (const p of problems) console.error(`repro inline-manifest: ${p}`);
    return 1;
  }
  console.log(`repro inline-manifest OK: sha256=${rebuiltHash.slice(0, 16)}… byte-identical with committed snapshot; policy documented`);
  return 0;
}

export function main(argv = process.argv.slice(2)) {
  try {
    if (argv.includes("--parity-baseline")) return parityBaseline();
    if (argv.includes("--inline-manifest")) return inlineManifest();
    console.error("usage: node harness/gates/repro.mjs --parity-baseline --assert | --inline-manifest --assert");
    return 2;
  } catch (error) {
    console.error(`repro: ${error.message}`);
    return 1;
  }
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) process.exit(main());
