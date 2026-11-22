#!/usr/bin/env node
/**
 * harness/gates/determinism.mjs — 同 seed 两次独立浏览器渲染的像素确定性门禁。
 *
 * CLI: node harness/gates/determinism.mjs --scene examples/starter --assert
 *
 * 两次独立 launchFixture，URL 均带 `?bench&seed=4207&frame=64&hold`：
 * 固定 1/60 定步长 + 定格帧，消除墙钟 dt；截图取 canvas 元素（排除 HUD 文本）。
 * 证据 evidence/determinism.json 记录两次 PNG sha256、像素 diff 与帧号。
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, realpathSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HTML = path.join(ROOT, "build/index.html");
const EVIDENCE = path.join(ROOT, "evidence/determinism.json");
const FRAME = 64;

function buildStarter() {
  const result = spawnSync("node", ["examples/starter/build.mjs", "--assert"], { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`starter build failed: ${result.stderr || result.stdout}`);
  if (!existsSync(HTML)) throw new Error("build/index.html missing");
}

/** 一次独立浏览器会话：等定格帧，取 canvas 原始像素与 PNG 截图。 */
async function renderOnce(runId) {
  const { launchFixture } = await import("../boot.mjs");
  const url = `${pathToFileURL(HTML).href}?bench&seed=4207&frame=${FRAME}&hold`;
  const session = await launchFixture({ url, waitMs: 2500, viewport: [800, 450] });
  try {
    await session.page.waitForFunction(
      (target) => Boolean(window.__READY__ && window.__READY__.ready && window.__G && window.__G.time.frame >= target),
      FRAME,
      { timeout: 20000 },
    );
    const state = await session.page.evaluate(() => ({
      frame: window.__G.time.frame,
      errors: (window.__errors || []).slice(-8),
      calls: window.__stats ? window.__stats().calls : 0,
      ready: window.__READY__,
    }));
    const png = await session.page.locator("#view").screenshot({ type: "png" });
    // 用 canvas 自身再取一次像素摘要（PNG 字节相同 + 像素缓冲相同 = 逐像素一致）。
    const pixels = await session.page.evaluate(() => {
      const c = document.getElementById("view");
      const gl = c.getContext("webgl2") || c.getContext("webgl");
      if (!gl) return null;
      const buf = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let acc = 2166136261;
      for (let i = 0; i < buf.length; i += 1) acc = Math.imul(acc ^ buf[i], 16777619) >>> 0;
      return { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight, fnv1a: acc.toString(16) };
    });
    return {
      runId,
      png,
      sha256: createHash("sha256").update(png).digest("hex"),
      pixels,
      state,
    };
  } finally {
    await session.close();
  }
}

export async function main(argv = process.argv.slice(2)) {
  try {
    if (argv.includes("--scene") && argv[argv.indexOf("--scene") + 1] !== "examples/starter") throw new Error("only examples/starter is supported");
    buildStarter();
    const first = await renderOnce("run-1");
    const second = await renderOnce("run-2");
    const samePng = first.sha256 === second.sha256;
    const samePixels = Boolean(first.pixels && second.pixels &&
      first.pixels.fnv1a === second.pixels.fnv1a &&
      first.pixels.width === second.pixels.width &&
      first.pixels.height === second.pixels.height);
    const diffPixels = samePixels ? 0 : 1;
    const problems = [];
    if (first.state.errors.length || second.state.errors.length) {
      problems.push(`page errors: ${[...first.state.errors, ...second.state.errors].join(" | ")}`);
    }
    if (!samePng) problems.push(`PNG sha256 differ: ${first.sha256} vs ${second.sha256}`);
    if (!samePixels) problems.push("readPixels buffer hash differ");
    if (first.state.frame !== FRAME || second.state.frame !== FRAME) {
      problems.push(`frame mismatch: ${first.state.frame} / ${second.state.frame}`);
    }
    if (!(first.state.calls > 0 && second.state.calls > 0)) problems.push("no draw calls");
    const evidence = {
      schema: "how2build3d/determinism@1",
      scene: "examples/starter",
      seed: 4207,
      frame: FRAME,
      runs: [
        { id: first.runId, sha256: first.sha256, frame: first.state.frame, pixels: first.pixels, calls: first.state.calls },
        { id: second.runId, sha256: second.sha256, frame: second.state.frame, pixels: second.pixels, calls: second.state.calls },
      ],
      diffPixels,
      status: problems.length ? "fail" : "pass",
      at: new Date().toISOString(),
    };
    mkdirSync(path.dirname(EVIDENCE), { recursive: true });
    writeFileSync(EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`);
    if (problems.length) {
      for (const p of problems) console.error(`determinism: ${p}`);
      return 1;
    }
    console.log(`determinism OK: sha256=${first.sha256.slice(0, 16)}… frame=${FRAME} diffPixels=0 (2 independent browser sessions)`);
    return 0;
  } catch (error) {
    console.error(`determinism: ${error.message}`);
    return error.exitCode ?? 1;
  }
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) process.exit(await main());
