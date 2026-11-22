/**
 * harness/render-starter.mjs — starter 端到端渲染验收。
 *
 * 步骤：build.mjs 产出单文件 → headless Chrome 加载 → 校验 WebGL2 / __G /
 * __errors / rAF 心跳 → 截图存证 → 断言截图非空、程序数量合理。
 *
 * 输出（可再生证据）：evidence/frames/starter.png
 * CLI: node harness/render-starter.mjs --assert
 */

import { launchFixture, snapshot } from "../boot.mjs";
import { execFileSync } from "node:child_process";
import { statSync, mkdirSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BUILD_SCRIPT = path.join(ROOT, "examples/starter/build.mjs");
const HTML = path.join(ROOT, "build/index.html");
const SHOT_DIR = path.join(ROOT, "evidence/frames");
const SHOT = path.join(SHOT_DIR, "starter.png");

export async function main(argv) {
  const assert = argv.includes("--assert");
  // 1. 构建（每次验收都用当前源码重建，避免陈旧产物）
  execFileSync(process.execPath, [BUILD_SCRIPT, "--assert"], { cwd: ROOT, stdio: "inherit" });

  // 2. 真实渲染
  const session = await launchFixture({
    url: pathToFileURL(HTML).href,
    waitMs: 3500,
    viewport: [800, 450],
  });
  try {
    const snap = await snapshot(session.page, { heartbeatMs: 600 });
    const ctx = await session.page.evaluate(() => {
      const g = window.__G;
      return g ? {
        seed: g.seed,
        quality: g.quality,
        frame: g.time.frame,
        stats: window.__stats ? window.__stats() : null,
        objects: g.scene ? g.scene.children.length : 0,
      } : null;
    });
    // 3. 截图存证
    mkdirSync(SHOT_DIR, { recursive: true });
    await session.page.screenshot({ path: SHOT });
    const shotBytes = statSync(SHOT).size;
    const report = {
      builtHtml: path.relative(ROOT, HTML),
      canvas: snap.canvas,
      glVersion: snap.glVersion,
      gpu: snap.gpu,
      heartbeat: snap.heartbeat,
      errors: snap.errors,
      errorCount: snap.errorCount,
      ctx,
      screenshot: path.relative(ROOT, SHOT),
      screenshotBytes: shotBytes,
    };
    console.log(JSON.stringify(report, null, 1));
    if (assert) {
      const ok =
        snap.canvas &&
        snap.glVersion &&
        snap.errorCount === 0 &&
        snap.heartbeat.ticks >= 2 &&
        ctx &&
        ctx.frame > 0 &&
        ctx.stats &&
        ctx.stats.calls > 0 &&
        shotBytes > 8000;
      if (!ok) {
        console.error("render-starter.mjs --assert FAILED: see report above");
        return 1;
      }
    }
    return 0;
  } finally {
    await session.close();
  }
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error("render-starter.mjs crashed:", err && err.message ? err.message : err);
      process.exit(err.exitCode ?? 1);
    }
  );
}
