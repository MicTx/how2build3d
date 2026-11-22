/**
 * harness/boot.mjs — 夹具启动器（所有证据采集脚本的公共底座）。
 *
 * 启动 sources/jimao-3a-game/index.html（Saltline 单文件 3D 游戏）：
 *   - 系统 Chrome headless + ANGLE/SwiftShader（无需下载浏览器）
 *   - WebGL2 上下文校验
 *   - window.__errors 运行时错误通道采样
 *   - requestAnimationFrame 心跳校验（证明游戏主循环在跑）
 *
 * 宿主环境采样（launchFixture 启动 Chrome 前执行；阻塞时打印 environment-blocked 并 exit 3）：
 *   - Linux：/proc/stat steal 差值（500ms 窗口）+ /proc/meminfo swap used
 *   - macOS：sysctl vm.swapusage 的 swap used%；stealPct 报 0（无 steal 计数器，stealSource 标明）
 *   - 阈值：H2B_STEAL_MAX_PCT（默认 5）/ H2B_SWAP_MAX_PCT（默认 50）可覆盖；
 *     采样缺失 supported=false 且不误判阻塞
 *
 * CLI:
 *   node harness/boot.mjs --probe          打印 JSON（含 environment），恒 exit 0
 *   node harness/boot.mjs --assert-ok      校验通过 exit 0，红 1，环境阻塞 3
 *   --wait-ms <n>                          加载后等待毫秒数（默认 8000）
 *   --viewport <w>x<h>                     视口尺寸（默认 960x540）
 *   --url <file|http>                      覆盖目标 URL
 */

import { chromium } from "playwright-core";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { realpathSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

/** 退出码契约：0=绿、1=红、3=environment-blocked（宿主 steal/swap 超阈值）。 */
export const EXIT_ENVIRONMENT_BLOCKED = 3;

const DEFAULT_STEAL_MAX_PCT = 5;
const DEFAULT_SWAP_MAX_PCT = 50;
// macOS 把 inactive 页换出到 swap 是内存管理常态（物理内存充足时 swap 也常驻高位），
// swap 阈值放宽到 95，只拦真正的交换风暴；Linux 虚拟机语义保持 50。
const DEFAULT_SWAP_MAX_PCT_DARWIN = 95;

function envMax(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * 跨平台宿主环境采样。
 * Linux：/proc/stat（500ms 窗口 steal 差值）+ /proc/meminfo swap used。
 * macOS：sysctl vm.swapusage（swap used%）；steal 无直接等价物，stealPct 记 null。
 * 采样缺失时 supported=false 且 blocked 保持 false（不因采样缺失误判阻塞）。
 */
export function sampleEnvironment({ windowMs = 500 } = {}) {
  const stealMax = envMax("H2B_STEAL_MAX_PCT", DEFAULT_STEAL_MAX_PCT);
  const swapMax = envMax(
    "H2B_SWAP_MAX_PCT",
    process.platform === "darwin" ? DEFAULT_SWAP_MAX_PCT_DARWIN : DEFAULT_SWAP_MAX_PCT
  );
  const out = { supported: false, platform: process.platform, stealPct: null, swapUsedPct: null, blocked: false, thresholds: { stealMaxPct: stealMax, swapMaxPct: swapMax }, reason: "" };
  try {
    if (process.platform === "linux") {
      const readStat = () => {
        const parts = readFileSync("/proc/stat", "utf8").split("\n")[0].split(/\s+/).map(Number);
        // user nice system idle iowait irq softirq steal ...
        const total = parts.slice(1, 9).reduce((a, b) => a + b, 0);
        return { total, steal: parts[8] || 0 };
      };
      const a = readStat();
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, windowMs);
      const b = readStat();
      const dTotal = b.total - a.total;
      out.stealPct = dTotal > 0 ? Number((100 * (b.steal - a.steal) / dTotal).toFixed(2)) : 0;
      const mem = readFileSync("/proc/meminfo", "utf8");
      const total = Number(/SwapTotal:\s*(\d+)/.exec(mem)?.[1] || 0);
      const free = Number(/SwapFree:\s*(\d+)/.exec(mem)?.[1] || 0);
      out.swapUsedPct = total > 0 ? Number((100 * (total - free) / total).toFixed(2)) : 0;
      out.supported = true;
    } else if (process.platform === "darwin") {
      const vm = execFileSync("sysctl", ["-n", "vm.swapusage"], { encoding: "utf8" });
      const total = Number(/total\s*=\s*([\d.]+)M/.exec(vm)?.[1] || 0);
      const used = Number(/used\s*=\s*([\d.]+)M/.exec(vm)?.[1] || 0);
      // macOS 无 steal 计数器（kern.cp_time 不存在；裸机无虚拟机窃取概念）：
      // stealPct 报 0 并用 stealSource 标明「无源」，不参与阈值判定语义。
      out.stealPct = 0;
      out.stealSource = "none (bare-metal macOS has no steal counter)";
      out.swapUsedPct = total > 0 ? Number((100 * used / total).toFixed(2)) : 0;
      out.supported = total > 0;
      if (!out.supported) out.reason = "vm.swapusage unreadable";
    } else {
      out.reason = `no sampler for ${process.platform}`;
    }
  } catch (error) {
    out.reason = String(error.message || error);
  }
  const stealBlocked = typeof out.stealPct === "number" && out.stealPct > stealMax;
  const swapBlocked = typeof out.swapUsedPct === "number" && out.swapUsedPct > swapMax;
  out.blocked = Boolean(stealBlocked || swapBlocked);
  if (out.blocked) {
    const causes = [];
    if (stealBlocked) causes.push(`steal ${out.stealPct}% > ${stealMax}%`);
    if (swapBlocked) causes.push(`swap used ${out.swapUsedPct}% > ${swapMax}%`);
    out.reason = causes.join("; ");
  }
  return out;
}

export const FIXTURE_PATH = fileURLToPath(
  new URL("../sources/jimao-3a-game/index.html", import.meta.url)
);
export const FIXTURE_URL = pathToFileURL(FIXTURE_PATH).href;

const CHROME_ARGS = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--disable-dev-shm-usage",
  "--hide-scrollbars",
];

/**
 * 启动夹具页面。`initScript` 在任何页面脚本执行前注入（用于钩 WebGL）。
 * 返回 { browser, page, close } —— 调用方负责 close()。
 */
export async function launchFixture({
  viewport = [960, 540],
  waitMs = 8000,
  url = FIXTURE_URL,
  initScript = null,
  slowMo = 0,
} = {}) {
  const environment = sampleEnvironment();
  if (environment.blocked) {
    console.log("environment-blocked: " + environment.reason);
    const blocked = new Error("environment-blocked: " + environment.reason);
    blocked.exitCode = EXIT_ENVIRONMENT_BLOCKED;
    throw blocked;
  }
  const browser = await chromium.launch({
    headless: true,
    channel: "chrome",
    slowMo,
    args: CHROME_ARGS,
  });
  try {
    const context = await browser.newContext({ viewport: { width: viewport[0], height: viewport[1] }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    if (initScript) await page.addInitScript(initScript);
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    if (waitMs > 0) await page.waitForTimeout(waitMs);
    return { browser, context, page, close: () => browser.close() };
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}

/**
 * 采集一次"健康快照"：canvas、WebGL 版本、GPU 串、运行时错误、rAF 心跳。
 */
export async function snapshot(page, { heartbeatMs = 700 } = {}) {
  const base = await page.evaluate(() => {
    const canvas = document.querySelector("#view") || document.querySelector("canvas");
    let gl = null;
    let glVersion = null;
    let gpu = null;
    if (canvas) {
      gl =
        canvas.getContext("webgl2") ||
        canvas.getContext("webgl") ||
        canvas.getContext("experimental-webgl");
      if (gl) {
        glVersion = String(gl.getParameter(gl.VERSION) || "");
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        if (dbg) gpu = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "");
      }
    }
    return {
      title: document.title,
      canvas: canvas ? { width: canvas.width, height: canvas.height } : null,
      glVersion,
      gpu,
      errors: (window.__errors || []).map((e) => String(e).slice(0, 300)),
      errorCount: (window.__errors || []).length,
      bootClass: document.querySelector("#boot") ? document.querySelector("#boot").className : null,
    };
  });
  // rAF 心跳：两个时间戳必须推进，证明主循环活着
  const beat = await page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const t0 = performance.now();
        let last = t0;
        let ticks = 0;
        const step = () => {
          ticks += 1;
          const now = performance.now();
          if (now - t0 >= ms) {
            resolve({ ticks, elapsed: now - t0 });
            return;
          }
          last = now;
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    heartbeatMs
  );
  return { ...base, heartbeat: beat };
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--probe" || a === "--assert-ok") out[a.slice(2)] = true;
    else if (a === "--wait-ms") {
      i += 1;
      out.waitMs = Number(argv[i]);
    } else if (a === "--viewport") {
      i += 1;
      out.viewport = String(argv[i]).split("x").map(Number);
    } else if (a === "--url") {
      i += 1;
      out.url = argv[i];
    } else out._.push(a);
  }
  return out;
}

export async function main(argv) {
  const args = parseArgs(argv);
  const environment = sampleEnvironment();
  if (environment.blocked) {
    const blockedReport = {
      ok: false,
      boot: "skipped-environment-blocked",
      environment,
    };
    if (args.probe) {
      console.log(JSON.stringify(blockedReport, null, 1));
      return 0; // --probe 恒 exit 0：报告阻塞但不判红
    }
    console.log("environment-blocked: " + environment.reason);
    return EXIT_ENVIRONMENT_BLOCKED;
  }
  const session = await launchFixture({
    viewport: args.viewport || [960, 540],
    waitMs: args.waitMs ?? 8000,
    url: args.url,
  });
  try {
    const snap = await snapshot(session.page);
    const report = {
      ok: Boolean(
        snap.canvas &&
          snap.canvas.width > 0 &&
          snap.glVersion &&
          snap.errorCount === 0 &&
          snap.heartbeat.ticks >= 2
      ),
      environment,
      ...snap,
    };
    if (args.probe) {
      console.log(JSON.stringify(report, null, 1));
      return 0;
    }
    if (args["assert-ok"]) {
      console.log(JSON.stringify(report, null, 1));
      if (!report.ok) {
        console.error("boot.mjs --assert-ok FAILED: fixture did not boot cleanly");
        return 1;
      }
      return 0;
    }
    console.log("usage: node harness/boot.mjs --probe | --assert-ok [--wait-ms n] [--viewport WxH]");
    return 2;
  } finally {
    await session.close();
  }
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      if (err && err.exitCode === EXIT_ENVIRONMENT_BLOCKED) process.exit(EXIT_ENVIRONMENT_BLOCKED);
      console.error("boot.mjs crashed:", err && err.message ? err.message : err);
      process.exit(1);
    }
  );
}
