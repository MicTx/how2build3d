/**
 * harness/profile-report.mjs — 运行时性能画像采集与报告断言。
 *
 * 采集：复用 capture-frames（draw call / program / 帧时）与 boot（启动健康），
 * 补充 renderer.info 的 geos/tex/tris 与 quality 档信息，汇总成
 * evidence/frames/profile.json（可再生证据）。
 *
 * CLI: node harness/profile-report.mjs --assert
 */

import { captureFrames } from "../capture/frames.mjs";
import { readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "evidence/frames/profile.json");

export async function main(argv) {
  const assert = argv.includes("--assert");
  const summary = await captureFrames({ frames: 24, waitMs: 6000, viewport: [640, 360] });
  const profile = {
    fixture: summary.fixture,
    renderer: summary.rendererStatsSample,
    quality: summary.quality,
    frame: {
      frames: summary.frames,
      avgFrameMs: summary.avgFrameMs,
      p50FrameMs: summary.p50FrameMs,
      p99FrameMs: summary.p99FrameMs,
      avgDrawsPerFrame: summary.avgDrawsPerFrame,
      p50DrawsPerFrame: summary.p50DrawsPerFrame,
      maxDrawsPerFrame: summary.maxDrawsPerFrame,
      programs: summary.programs,
    },
    errorCount: summary.errorCount,
    note:
      "SwiftShader 软渲染的绝对帧时只用于结构分析（pass 数量级），不代表真机 GPU 性能；draw call / program / 几何量与硬件无关。",
    capturedAt: new Date().toISOString(),
  };
  writeFileSync(OUT, `${JSON.stringify(profile, null, 1)}\n`);
  // 同时确保 shaders manifest 存在（profile 引用它）
  const shaderManifest = path.join(ROOT, "evidence/shaders/manifest.json");
  let shaderCount = null;
  if (existsSync(shaderManifest)) shaderCount = JSON.parse(readFileSync(shaderManifest, "utf8")).total;
  profile.shaders = shaderCount;
  writeFileSync(OUT, `${JSON.stringify(profile, null, 1)}\n`);
  console.log(JSON.stringify(profile, null, 1));
  if (assert) {
    const ok =
      profile.renderer &&
      profile.renderer.calls > 100 &&
      profile.renderer.tris > 500000 &&
      profile.frame.programs > 100 &&
      profile.errorCount === 0;
    if (!ok) {
      console.error("profile-report.mjs --assert FAILED");
      return 1;
    }
    return 0;
  }
  return 0;
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error("profile-report.mjs crashed:", err && err.message ? err.message : err);
      process.exit(1);
    }
  );
}
