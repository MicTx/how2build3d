/**
 * harness/gates/entry-guards.mjs — 示例入口直连守卫门禁。
 *
 * 四个示例入口（starter/quality/parity/gameplay 的 build.mjs）的 main 直连守卫
 * 曾用 `fileURLToPath(import.meta.url) === process.argv[1]`：经符号链接执行
 * `node <link> --assert` 时 argv[1] 是链接路径、import.meta.url 是真实路径，
 * 守卫永假 → 静默空转（exit 0、零字节输出，main 未执行）。守卫统一为
 * `realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)` 后，
 * 直连与符号链接两种执行方式都能进入 main（与 examples/scaffold-probe/build.mjs
 * 先行采用的形态同源）。
 *
 * CLI:
 *   node harness/gates/entry-guards.mjs --self-test
 */

import { readFileSync, realpathSync, mkdtempSync, symlinkSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 四个示例入口（相对仓库根）。 */
export const ENTRIES = Object.freeze([
  "examples/starter/build.mjs",
  "examples/quality/build.mjs",
  "examples/parity/build.mjs",
  "examples/gameplay/build.mjs",
]);

/** 守卫的 canonical 形态。 */
export const GUARD =
  "const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);";

/* ---- 第一段：静态检查（守卫行 + node:fs 导入）---- */
export function checkGuards(root = ROOT, entries = ENTRIES) {
  const problems = [];
  for (const rel of entries) {
    const src = readFileSync(path.join(root, rel), "utf8");
    const guardCount = src.split(GUARD).length - 1;
    if (guardCount !== 1) {
      problems.push(`${rel}: realpathSync 守卫行应恰好 1 处，实际 ${guardCount}`);
    }
    if (!/^import \{[^}]*\brealpathSync\b[^}]*\} from "node:fs";$/m.test(src)) {
      problems.push(`${rel}: 未从 node:fs 导入 realpathSync`);
    }
  }
  return { ok: problems.length === 0, problems };
}

/* ---- 第二段：符号链接冒烟（真实构建，写入仅限 .gitignore 的 build/）---- */
export function smokeSymlinks(root = ROOT, entries = ENTRIES) {
  const problems = [];
  const tmp = mkdtempSync(path.join(tmpdir(), "entry-guards-"));
  try {
    for (const rel of entries) {
      const link = path.join(tmp, rel.split("/").join("-"));
      symlinkSync(path.join(root, rel), link);
      const r = spawnSync(process.execPath, [link, "--assert"], { cwd: root, encoding: "utf8" });
      if (r.status !== 0) {
        problems.push(`${rel}: 符号链接 --assert exit=${r.status}（构建失败：${String(r.stderr).trim().split("\n").pop() || "无 stderr"}）`);
        continue;
      }
      if (!String(r.stdout).includes("build:")) {
        problems.push(`${rel}: 符号链接 --assert exit 0 但 stdout 无 build: 行（守卫未放行，main 未执行）`);
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return { ok: problems.length === 0, problems };
}

export function selfTest() {
  const failures = [];
  const guard = checkGuards();
  for (const problem of guard.problems) failures.push(`静态: ${problem}`);
  const smoke = smokeSymlinks();
  for (const problem of smoke.problems) failures.push(`冒烟: ${problem}`);

  if (failures.length) {
    console.error("entry-guards gate --self-test FAILED:");
    for (const failure of failures) console.error(`  - ${failure}`);
    return 1;
  }
  console.log(
    "entry-guards gate --self-test OK: 4 入口守卫均为 realpathSync 形态，"
    + "且经 os.tmpdir() 符号链接执行 --assert 全部 exit 0 并打印 build: 行"
  );
  return 0;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export async function main(argv) {
  if (argv.includes("--self-test")) {
    if (argv.length > 1) {
      console.error("entry-guards gate: --self-test 不接受其它参数");
      return 2;
    }
    return selfTest();
  }
  console.error("用法: node harness/gates/entry-guards.mjs --self-test");
  return 2;
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error("entry-guards.mjs crashed:", err && err.message ? err.message : err);
      process.exit(1);
    }
  );
}
