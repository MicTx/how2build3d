/**
 * harness/gates/webgpu.mjs — WebGPU/WebGL 兼容占位门禁（references/06 兼容矩阵的最小可执行子集）。
 *
 * 占位范围（本轮明确不做 WebGPU 渲染路径，见 Spec 2026-11-15_webgpu-compat-gate）：
 *   1. 运行时能力探测（info 级，不判红绿）：navigator.gpu 存在性、requestAdapter 是否成功、adapter 描述
 *      ——环境能力矩阵留档 evidence/webgpu/<scene>.json，为未来「同场景双后端验收」打底；
 *   2. 回退契约（判红绿，静态、确定性）：构建产物必须
 *      a) 显式请求 webgl2 上下文（WebGL2 优先）；
 *      b) 带错误捕获（window.__errors）；
 *      c) 零 navigator.gpu 硬依赖（本轮场景全部是 WebGL2 渲染路径，出现 navigator.gpu 即违背
 *         「失败时回退 WebGL2」的交付约束；未来接 WebGPU 渲染路径时放宽为双路径探测契约，见 spec 2.4）。
 *
 * CLI:
 *   node harness/gates/webgpu.mjs --self-test
 *   node harness/gates/webgpu.mjs --scene examples/parity [--json]
 *
 * 场景需先构建：node <scene>/build.mjs（读取 build/<name>/index.html，缺失时报错并提示构建命令）。
 * 能力探测失败（无 navigator.gpu / adapter 超时）不影响退出码——那是环境矩阵的一行，不是场景的错。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync , realpathSync} from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

import { launchFixture } from "../boot.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, "evidence/webgpu");

function parseArgs(argv) {
  const out = { scenes: [], selfTest: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--self-test") out.selfTest = true;
    else if (a === "--json") out.json = true;
    else if (a === "--scene") { i += 1; out.scenes.push(argv[i]); }
    else { console.error(`unknown arg: ${a}`); process.exit(2); }
  }
  return out;
}

/** 回退契约（静态、确定性）。三项全过才绿；条款理由见文件头注释。 */
export function checkFallbackContract(html) {
  const text = String(html || "");
  const checks = [
    {
      name: "webgl2-context",
      // 直接调用 getContext('webgl2') 或 three.js 的变量形态（const contextName = 'webgl2'）都算；
      // 构建产物内嵌 three 源码，不压缩，字面量 'webgl2' 只在 WebGL2 渲染路径存在。
      pass: /["'`]webgl2["'`]/.test(text),
      detail: "构建产物必须显式请求 webgl2 上下文（WebGL2 优先）",
    },
    {
      name: "error-capture",
      pass: /__errors/.test(text),
      detail: "必须带 window.__errors 错误捕获（启动失败可诊断）",
    },
    {
      name: "no-webgpu-hard-dep",
      pass: !/navigator\.gpu/.test(text),
      detail: "零 navigator.gpu 引用（本轮 WebGL2 渲染路径；未来双路径时放宽此条）",
    },
  ];
  return { checks, ok: checks.every((c) => c.pass) };
}

/** 运行时能力探测：结果只进环境矩阵，不参与判定。 */
async function probeCapability(url) {
  let session;
  try {
    session = await launchFixture({ viewport: [320, 180], waitMs: 2500, url });
  } catch (e) {
    return { gpuPresent: false, adapterResolved: false, adapterInfo: "", error: `launch failed: ${String(e).slice(0, 160)}` };
  }
  try {
    return await session.page.evaluate(async () => {
      const out = { gpuPresent: false, adapterResolved: false, adapterInfo: "", error: "" };
      try {
        out.gpuPresent = typeof navigator !== "undefined" && "gpu" in navigator;
        if (out.gpuPresent) {
          const adapter = await Promise.race([
            navigator.gpu.requestAdapter(),
            new Promise((_, rej) => setTimeout(() => rej(new Error("adapter request timeout")), 8000)),
          ]);
          out.adapterResolved = Boolean(adapter);
          const info = adapter && adapter.info ? adapter.info : null;
          if (info) out.adapterInfo = String(info.description || info.vendor || info.architecture || "").slice(0, 160);
        }
      } catch (e) {
        out.error = String(e).slice(0, 200);
      }
      return out;
    });
  } catch (e) {
    return { gpuPresent: false, adapterResolved: false, adapterInfo: "", error: `evaluate failed: ${String(e).slice(0, 160)}` };
  } finally {
    await session.close();
  }
}

function selfTest() {
  const direct = "<script>const gl=c.getContext('webgl2');window.__errors=[];</script>";
  const threeStyle = "<script>const contextName = 'webgl2';window.__errors=[];</script>";
  const noCtx = "<script>window.__errors=[];</script>";
  const gpuDep = "<script>if(!navigator.gpu)throw new Error('webgpu required');const gl=c.getContext('webgl2');window.__errors=[];</script>";
  const problems = [];
  if (!checkFallbackContract(direct).ok) problems.push("positive sample (direct) should pass");
  if (!checkFallbackContract(threeStyle).ok) problems.push("positive sample (three variable form) should pass");
  if (checkFallbackContract(noCtx).ok) problems.push("missing webgl2 should fail");
  if (checkFallbackContract(gpuDep).ok) problems.push("navigator.gpu hard dependency should fail");
  if (problems.length) {
    console.error("webgpu --self-test FAILED:", problems.join("; "));
    return 1;
  }
  console.log("webgpu --self-test OK");
  return 0;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.selfTest) return selfTest();
  if (!args.scenes.length) {
    console.error("usage: node harness/gates/webgpu.mjs --scene <dir> [--json] | --self-test");
    return 2;
  }
  mkdirSync(OUT_DIR, { recursive: true });
  let allOk = true;
  for (const scene of args.scenes) {
    const sceneName = path.basename(scene);
    const htmlPath = path.join(ROOT, "build", sceneName, "index.html");
    if (!existsSync(htmlPath)) {
      console.error(`webgpu: missing ${path.relative(ROOT, htmlPath)} — run node ${scene}/build.mjs first`);
      return 1;
    }
    const html = readFileSync(htmlPath, "utf8");
    const contract = checkFallbackContract(html);
    const capability = await probeCapability(pathToFileURL(htmlPath).href + "?seed=4207");
    const report = {
      generatedAt: new Date().toISOString(),
      scene,
      html: path.relative(ROOT, htmlPath),
      contract,
      capability,
      ok: contract.ok,
    };
    const outFile = path.join(OUT_DIR, `${sceneName}.json`);
    writeFileSync(outFile, JSON.stringify(report, null, 1) + "\n");
    if (args.json) console.log(JSON.stringify(report, null, 1));
    const flag = report.ok ? "OK" : "FAIL";
    console.log(
      `${flag}\t${scene}\tcontract=${contract.checks.map((c) => `${c.name}:${c.pass ? "pass" : "FAIL"}`).join(" ")}\t` +
      `gpu=${capability.gpuPresent ? "present" : "absent"} adapter=${capability.adapterResolved ? "resolved" : "unresolved"}\t` +
      `→ ${path.relative(ROOT, outFile)}`,
    );
    if (contract.checks.some((c) => !c.pass)) {
      for (const c of contract.checks) if (!c.pass) console.error(`webgpu: ${scene} ${c.name} FAIL — ${c.detail}`);
      allOk = false;
    }
  }
  return allOk ? 0 : 1;
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main(process.argv.slice(2)).then((code) => process.exit(code)).catch((e) => {
    console.error("webgpu gate crashed:", String(e).slice(0, 400));
    process.exit(1);
  });
}
