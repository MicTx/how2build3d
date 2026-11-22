/**
 * harness/render-scene.mjs — 通用场景端到端渲染验收器（render-starter 的参数化版）。
 *
 * 流程：`node <scene>/build.mjs --assert` 构建单文件 → headless Chrome 加载
 * `build/<scene-name>/index.html` → 校验 WebGL2 / __G / __errors / rAF 心跳 /
 * draw call 上界 → 截图存证 → 断言。
 *
 * CLI:
 *   node harness/render/scene.mjs --scene <your-scene-dir>             # fail-closed：不达标 exit 1
 *   node harness/render/scene.mjs --scene <your-scene-dir> --no-assert # 只看报告，不达标也 exit 0
 *   node harness/render/scene.mjs --self-test
 *   --seed <n>       场景 seed（默认 4207，经 URL 参数传给页面）
 *   --wait-ms <n>    渲染等待（默认 3500）
 *   --max-draws <n>  draw call 预算上界（默认 240）
 *   --assert         显式声明断言（默认已开启，仅为兼容旧命令保留）
 */

import { launchFixture, snapshot } from "../boot.mjs";
import { execFileSync } from "node:child_process";
import { statSync, mkdirSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function parseArgs(argv) {
  const out = { scene: null, seed: 4207, waitMs: 3500, maxDraws: 240, assert: true, selfTest: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--assert") out.assert = true;
    else if (a === "--no-assert") out.assert = false;
    else if (a === "--self-test") out.selfTest = true;
    else if (a === "--scene") { i += 1; out.scene = argv[i]; }
    else if (a === "--seed") { i += 1; out.seed = Number(argv[i]); }
    else if (a === "--wait-ms") { i += 1; out.waitMs = Number(argv[i]); }
    else if (a === "--max-draws") { i += 1; out.maxDraws = Number(argv[i]); }
  }
  return out;
}

export async function renderScene({ scene, seed = 4207, waitMs = 3500, maxDraws = 240 } = {}) {
  const sceneDir = path.join(ROOT, scene);
  const sceneName = path.basename(sceneDir);
  const buildScript = path.join(sceneDir, "build.mjs");
  const html = path.join(ROOT, "build", sceneName, "index.html");
  if (!existsSync(buildScript)) throw new Error(`missing build.mjs in ${scene}`);
  execFileSync(process.execPath, [buildScript, "--assert"], { cwd: ROOT, stdio: "inherit" });
  if (!existsSync(html)) throw new Error(`build did not produce ${path.relative(ROOT, html)}`);

  const session = await launchFixture({
    url: `${pathToFileURL(html).href}?bench&seed=${seed}`,
    waitMs,
    viewport: [800, 450],
  });
  try {
    const snap = await snapshot(session.page, { heartbeatMs: 600 });
    const ctx = await session.page.evaluate(() => {
      const g = window.__G;
      return g ? {
        params: g.params,
        seed: g.seed,
        frame: g.time ? g.time.frame : null,
        quality: g.quality ? g.quality.name : null,
        stats: window.__stats ? window.__stats() : null,
        markers: g.markers || null,
      } : null;
    });
    const shotDir = path.join(ROOT, "evidence/frames");
    mkdirSync(shotDir, { recursive: true });
    const shot = path.join(shotDir, `${sceneName}.png`);
    await session.page.screenshot({ path: shot });
    const shotBytes = statSync(shot).size;
    // C8: README 必须与场景一同交付，且含四段必备内容
    const readmePath = path.join(sceneDir, "README.md");
    const readme = existsSync(readmePath) ? readFileSync(readmePath, "utf8") : "";
    const readmeCheck = {
      exists: Boolean(readme),
      sections: ["场景意图", "参数表", "方法论", "验收"].filter((k) => readme.includes(k)),
    };
    readmeCheck.ok = readmeCheck.exists && readmeCheck.sections.length === 4;
    return {
      scene, html: path.relative(ROOT, html), screenshot: path.relative(ROOT, shot), screenshotBytes: shotBytes,
      snap, ctx, readmeCheck, ok: Boolean(
        snap.canvas && snap.glVersion && snap.errorCount === 0 && snap.heartbeat.ticks >= 2 &&
        ctx && ctx.seed === seed && ctx.frame > 0 && ctx.stats && ctx.stats.calls > 0 &&
        ctx.stats.calls <= maxDraws && shotBytes > 8000 && readmeCheck.ok
      ),
    };
  } finally {
    await session.close();
  }
}

function selfTest() {
  const problems = [];
  if (typeof launchFixture !== "function") problems.push("launchFixture 不可用");
  if (typeof snapshot !== "function") problems.push("snapshot 不可用");
  // render-starter 已验证过的 fixture 路径做一次静态自检
  const starter = path.join(ROOT, "examples/starter/build.mjs");
  if (!existsSync(starter)) problems.push("examples/starter/build.mjs 缺失（用于回归对照）");
  if (problems.length) {
    console.error("render-scene --self-test FAILED:", problems.join("; "));
    return 1;
  }
  console.log("render-scene --self-test OK");
  return 0;
}

export async function main(argv) {
  const args = parseArgs(argv);
  if (args.selfTest) return selfTest();
  if (!args.scene) {
    console.error("usage: node harness/render/scene.mjs --scene <dir> [--no-assert] [--seed n] [--max-draws n] | --self-test");
    return 2;
  }
  const report = await renderScene(args);
  console.log(JSON.stringify(report, null, 1));
  if (args.assert && !report.ok) {
    console.error("render-scene.mjs FAILED (fail-closed 默认；--no-assert 仅看报告): see report above");
    return 1;
  }
  return 0;
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error("render-scene.mjs crashed:", err && err.message ? err.message : err);
      process.exit(err.exitCode ?? 1);
    }
  );
}
