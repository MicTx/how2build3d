#!/usr/bin/env node
/**
 * harness/gates/ssr-wet.mjs — ssr-wet 湿地反射 shader 的浏览器编译/链接证据。
 *
 * CLI: node harness/gates/ssr-wet.mjs --scene examples/quality --assert
 *
 * 契约：
 *  - 先跑 `node examples/quality/build.mjs --assert` 前置构建。
 *  - 用 launchFixture 的 initScript 钩 WebGLShader/WebGLProgram：
 *    shaderSource 记录源码，getShaderParameter(COMPILE_STATUS) 与
 *    getProgramParameter(LINK_STATUS) 记录结果。
 *  - 通过标准：捕获到含 SSR_WET_RR_BEGIN（且含 uRefl）的片元 shader 编译成功，
 *    且至少一个引用该 shader 的程序链接成功（30s 上限）；页面断言 WebGL2、
 *    __errors 0、心跳 ≥2。
 *  - 不以静态 marker / 括号平衡顶替（assets 门禁已覆盖静态面）。
 *  - 退出码：0=绿；1=红（未捕获或编译失败）；3=environment-blocked（不启动 Chrome）。
 *  - 证据：evidence/ssr-wet.json（gitignored 运行产物）。
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { launchFixture, snapshot, sampleEnvironment, EXIT_ENVIRONMENT_BLOCKED } from "../boot.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HTML = path.join(ROOT, "build/quality/index.html");
const EVIDENCE = path.join(ROOT, "evidence/ssr-wet.json");
const MARKER = "SSR_WET_RR_BEGIN";
const UNIFORM = "uRefl";

const INIT_HOOK = `
(() => {
  const sources = [];
  const shaders = [];
  const programs = [];
  const shaderIndex = new WeakMap();
  const patch = (proto) => {
    if (!proto) return;
    const origShaderSource = proto.shaderSource;
    proto.shaderSource = function (shader, source) {
      const text = String(source || "");
      const idx = sources.length;
      sources.push(text);
      shaders.push(shader);
      try { shaderIndex.set(shader, idx); } catch (_) {}
      return origShaderSource.call(this, shader, source);
    };
    const originalLink = proto.linkProgram;
    proto.linkProgram = function (program) {
      const result = originalLink.call(this, program);
      const indices = this.getAttachedShaders(program).map(shader => shaderIndex.get(shader));
      programs.push({ indices, ok: this.getProgramParameter(program, this.LINK_STATUS) });
      return result;
    };
  };
  patch(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype);
  patch(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype);
  window.__H2B_SHADER_HOOK__ = { sources, shaders, programs };
})();
`;

function buildScene() {
  const result = spawnSync(process.execPath, ["examples/quality/build.mjs", "--assert"], { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`quality build failed: ${(result.stderr || result.stdout || "").trim().split("\n").slice(-3).join(" | ")}`);
}

export async function main(argv = process.argv.slice(2)) {
  let evidence = {
    schema: "how2build3d/ssr-wet@1",
    scene: "examples/quality",
    status: "fail",
    at: new Date().toISOString(),
  };
  try {
    if (argv.includes("--scene") && argv[argv.indexOf("--scene") + 1] !== evidence.scene) throw new Error(`only ${evidence.scene} is supported`);
    const environment = sampleEnvironment();
    if (environment.blocked) {
      evidence = { ...evidence, status: "n/a", reason: `environment-blocked: ${environment.reason || "host steal/swap over threshold"}`, environment };
      mkdirSync(path.dirname(EVIDENCE), { recursive: true });
      writeFileSync(EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`);
      console.log(evidence.reason);
      console.log("environment-blocked");
      return EXIT_ENVIRONMENT_BLOCKED;
    }
    buildScene();
    const build = { command: "node examples/quality/build.mjs --assert", exit: 0 };
    const session = await launchFixture({
      url: pathToFileURL(HTML).href,
      waitMs: 3000,
      viewport: [800, 450],
      initScript: INIT_HOOK,
    });
    try {
      const beat = await snapshot(session.page, { heartbeatMs: 700 });
      const runtime = await session.page.evaluate(
        ({ marker, uniform }) => {
          const hook = window.__H2B_SHADER_HOOK__ || { sources: [], shaders: [], programs: [] };
          const canvas = document.querySelector("#view") || document.querySelector("canvas");
          const gl = canvas ? (canvas.getContext("webgl2") || canvas.getContext("webgl")) : null;
          const glVersion = gl ? String(gl.getParameter(gl.VERSION) || "") : "";
          // 主动查询匹配 shader 的真实 COMPILE_STATUS（three.js 只在出错时查；
          // 链接成功隐含编译成功，但 C3 要求两个状态都被显式观测）。
          const matchedIdx = hook.sources
            .map((s, i) => (s.includes(marker) && s.includes(uniform) ? i : -1))
            .filter((i) => i >= 0);
          const compileResults = matchedIdx.map((i) => {
            const shader = hook.shaders[i];
            if (!shader || !gl) return false;
            const value = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
            return Boolean(value);
          });
          return {
            glVersion,
            errors: (window.__errors || []).slice(-6),
            sources: hook.sources,
            linkOk: hook.programs.filter(program => program.ok && matchedIdx.some((index, offset) => compileResults[offset] && program.indices.includes(index))).length,
            compileResults,
            markerPresent: matchedIdx.length > 0,
          };
        },
        { marker: MARKER, uniform: UNIFORM }
      );
      const matchingShaders = runtime.sources
        .map((source, index) => ({ index, source }))
        .filter(({ source }) => source.includes(MARKER) && source.includes(UNIFORM));
      const compiled = runtime.compileResults.filter(Boolean);
      const linked = runtime.linkOk;
      const problems = [];
      if (!runtime.glVersion.includes("WebGL 2")) problems.push(`WebGL2 unavailable: ${runtime.glVersion || "(none)"}`);
      if (runtime.errors.length) problems.push(`page errors: ${runtime.errors.join(" | ")}`);
      if (!matchingShaders.length) problems.push(`no shader containing ${MARKER} + ${UNIFORM} captured`);
      if (!compiled.length) problems.push("no successful shader compilation recorded");
      if (linked < 1) problems.push("no successful program link recorded");
      if (beat.heartbeat && beat.heartbeat.ticks < 2) problems.push("heartbeat stalled");
      const matchedSha = matchingShaders.length
        ? createHash("sha256").update(matchingShaders[0].source).digest("hex")
        : null;
      evidence = {
        ...evidence,
        status: problems.length ? "fail" : "pass",
        build,
        environment,
        browser: { glVersion: runtime.glVersion, gpu: beat.gpu || null, version: beat.gpu || "(renderer)" },
        shaders: {
          captured: runtime.sources.length,
          matched: matchingShaders.length,
          compileOk: compiled.length,
          linkOk: linked,
        },
        matchedSha256: matchedSha,
        errors: runtime.errors,
        problems,
      };
      mkdirSync(path.dirname(EVIDENCE), { recursive: true });
      writeFileSync(EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`);
      if (problems.length) {
        for (const p of problems) console.error(`ssr-wet: ${p}`);
        return 1;
      }
      console.log(`ssr-wet OK: ${matchingShaders.length} shader(s) with ${MARKER}+${UNIFORM}, compile&link verified, sha256=${matchedSha.slice(0, 16)}…`);
      return 0;
    } finally {
      await session.close();
    }
  } catch (error) {
    if (error && error.exitCode === EXIT_ENVIRONMENT_BLOCKED) {
      evidence = { ...evidence, status: "n/a", reason: `environment-blocked: ${error.message}` };
      mkdirSync(path.dirname(EVIDENCE), { recursive: true });
      writeFileSync(EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`);
      console.log(evidence.reason);
      console.log("environment-blocked");
      return EXIT_ENVIRONMENT_BLOCKED;
    }
    console.error(`ssr-wet: ${error.message}`);
    return 1;
  }
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) process.exit(await main());
