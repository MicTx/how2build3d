/**
 * harness/gates/kit-selftest.mjs — 八元素 kit 自检门禁。
 *
 * 为什么存在：`assets/*-kit.mjs` 通配式扫描会把 physics/level/combat 三个玩法 kit 一起
 * 拉进来，而它们按设计没有模块级 selfTest()（spec Fork F1 选 b：不补 CPU selfTest），
 * 11-kit 式扫描因此把三 kit 判红。本门禁改用**显式八 kit 清单**，只跑真正带模块级
 * selfTest() 的八个元素 kit；玩法 kit 的验收面见输出尾注与 assets/index.md 第五节。
 *
 * CLI:
 *   node harness/gates/kit-selftest.mjs --all    逐个动态 import 八 kit 并调用模块级
 *                                                selfTest()，任一 ok !== true → exit 1
 *
 * 静态范围对账（--all 的一部分）：显式清单必须与「assets/ 下导出模块级 selfTest 的
 * -kit.mjs」完全一致——清单里挂了没有 selfTest 的 kit（多扫）、或某个导出 selfTest 的
 * kit 不在清单里（漏扫）都判红，防止清单悄悄漂移回 11-kit 式扫描。
 *
 * physics/level/combat 不在本门禁内，替代验收面：
 *   - node harness/gates/gameplay.mjs --self-test                     （令牌池/状态机/听觉传播/布局对账/确定性）
 *   - node harness/gates/gameplay.mjs --scene examples/parity --require-audio（自动战斗 + 音频证据）
 *   - node examples/gameplay/build.mjs --assert                       （宿主场景构建）
 */

import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 显式八元素 kit 清单。不要改回 `assets/*-kit.mjs` 通配——那会扫到玩法 kit 并判红。 */
const KITS = ["props", "fx", "audio", "weapon", "enemy", "player", "hud", "weather"];

/** 玩法链路 kit（第四节）：无模块级 selfTest 是设计决定，验收走 gameplay 门禁与宿主构建。 */
const GAMEPLAY_KITS = ["physics", "level", "combat"];

const SELF_TEST_EXPORT_RE = /^[ \t]*export function selfTest\s*\(/m;

/**
 * 静态范围对账：返回问题列表（空 = 通过）。
 * - 清单中的 kit 必须真的导出模块级 selfTest（否则 --all 动态跑会红，先静态给出可读原因）；
 * - 玩法 kit 不得混进清单；
 * - 导出 selfTest 的 -kit.mjs 不得落在清单外（新 kit 要登记，玩法 kit 不许补 selfTest 后悄悄漏网）。
 */
export function scopeProblems() {
  const problems = [];
  const files = readdirSync(path.join(ROOT, "assets"))
    .filter((f) => f.endsWith("-kit.mjs"))
    .sort();
  const have = files
    .filter((f) => SELF_TEST_EXPORT_RE.test(readFileSync(path.join(ROOT, "assets", f), "utf8")))
    .map((f) => f.slice(0, -"-kit.mjs".length));
  for (const name of KITS) {
    if (GAMEPLAY_KITS.includes(name)) problems.push(`gameplay kit must not be in the eight-kit list: ${name}`);
    if (!have.includes(name)) problems.push(`assets/${name}-kit.mjs listed but exports no module-level selfTest`);
  }
  for (const name of have) {
    if (!KITS.includes(name)) {
      problems.push(
        `assets/${name}-kit.mjs exports module-level selfTest but is outside the explicit list ` +
          `(register the kit, or for gameplay kits ${GAMEPLAY_KITS.join("/")} keep acceptance on the gameplay gate — see header)`
      );
    }
  }
  return problems;
}

/** selfTest 结果的失败明细：兼容 problems[] 与 checks[{name,ok,detail}] 两种返回形态。 */
function failureDetails(result) {
  const lines = [];
  if (!result) return lines;
  if (Array.isArray(result.problems)) for (const p of result.problems) lines.push(String(p));
  if (Array.isArray(result.checks)) {
    for (const c of result.checks) if (c && c.ok === false) lines.push(`${c.name}${c.detail ? `: ${c.detail}` : ""}`);
  }
  return lines;
}

/** 结果对象里前几个数值字段，作 OK 行的运行时口径（不手填，按实际导出取）。 */
function statLine(result) {
  if (!result) return "";
  return Object.entries(result)
    .filter(([, v]) => typeof v === "number")
    .slice(0, 6)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
}

export async function main(argv = []) {
  if (!argv.includes("--all")) {
    console.error("usage: node harness/gates/kit-selftest.mjs --all   (eight element kits, explicit list)");
    return 2;
  }

  const scope = scopeProblems();
  for (const p of scope) console.error(`FAIL\t${p}`);

  let failed = 0;
  for (const name of KITS) {
    const rel = `assets/${name}-kit.mjs`;
    let result;
    try {
      const mod = await import(pathToFileURL(path.join(ROOT, rel)).href);
      if (typeof mod.selfTest !== "function") throw new Error("no module-level selfTest export");
      result = mod.selfTest();
    } catch (error) {
      failed += 1;
      console.log(`FAIL\t${rel}\t${error && error.message ? error.message : error}`);
      continue;
    }
    if (result && result.ok === true) {
      const stats = statLine(result);
      console.log(`OK\t${rel}\tselfTest ok${stats ? `  (${stats})` : ""}`);
    } else {
      failed += 1;
      console.log(`FAIL\t${rel}\tselfTest ok=${result ? String(result.ok) : "undefined"}`);
      for (const line of failureDetails(result)) console.log(`      ${line}`);
    }
  }

  console.log(
    `\nkit-selftest: ${KITS.length - failed}/${KITS.length} element kits ok ` +
      `(explicit list: ${KITS.join("/")}; no assets/*-kit.mjs glob)`
  );
  console.log(
    `kit-selftest: gameplay kits ${GAMEPLAY_KITS.join("/")} are out of scope (no module-level selfTest by design) — ` +
      `acceptance: node harness/gates/gameplay.mjs --self-test | ` +
      `node harness/gates/gameplay.mjs --scene examples/parity --require-audio | ` +
      `node examples/gameplay/build.mjs --assert`
  );
  if (scope.length) console.error(`kit-selftest: ${scope.length} scope problem(s)`);
  return failed || scope.length ? 1 : 0;
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error("kit-selftest.mjs crashed:", error && error.message ? error.message : error);
      process.exit(1);
    }
  );
}
