#!/usr/bin/env node
/**
 * harness/gates/degrade.mjs — 启动前置 / 全链路降级 / 零外链与零资产的独立门禁。
 *
 * CLI:
 *   node harness/gates/degrade.mjs --scene examples/starter --assert
 *   node harness/gates/degrade.mjs --force-fail post --assert   (post|chunk|asset)
 *   node harness/gates/degrade.mjs --self-test
 *   node harness/gates/degrade.mjs --zero-assets --external-links --assert
 *
 * 证据：evidence/degrade.json（ready 记录 + 三条注入模式记录，gitignored）。
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HTML = path.join(ROOT, "build/index.html");
const EVIDENCE = path.join(ROOT, "evidence/degrade.json");
const FALLBACKS = Object.freeze({ post: "forward", chunk: "stock", asset: "flat" });

const LINK_RULES = Object.freeze([
  { kind: "fetch", re: /\bfetch\s*\(\s*["'`](?:https?:)?\/\//i },
  { kind: "script", re: /<script[^>]+\bsrc\s*=/i },
  { kind: "img", re: /<img[^>]+\bsrc\s*=\s*["'`](?:https?:)?\/\//i },
  { kind: "audio", re: /<audio[^>]+\bsrc\s*=\s*["'`](?:https?:)?\/\//i },
  { kind: "model", re: /["'`][^"'`]*\.(?:glb|gltf|fbx|obj)(?:\?[^"'`]*)?["'`]/i },
  { kind: "link", re: /<link[^>]+\bhref\s*=\s*["'`](?:https?:)?\/\//i },
]);

/** 外链扫描只针对交付 HTML 的应用段（排除内联的 three.cjs，避免库内字符串误报）。 */
export function scanExternalLinks(html) {
  const marker = html.indexOf("/* starter modules");
  const app = (html.slice(0, html.indexOf("<script>") > 0 ? html.indexOf("<script>") : 0) +
    (marker >= 0 ? html.slice(marker) : html));
  return LINK_RULES.filter((rule) => rule.re.test(app)).map((rule) => rule.kind);
}

function run(args, opts = {}) {
  const result = spawnSync(args[0], args.slice(1), { cwd: ROOT, encoding: "utf8", ...opts });
  return { code: result.status, out: result.stdout || "", err: result.stderr || "" };
}

function buildStarter() {
  const result = run(["node", "examples/starter/build.mjs", "--assert"]);
  if (result.code !== 0) throw new Error(`starter build failed: ${result.err || result.out}`);
  if (!existsSync(HTML)) throw new Error("build/index.html missing");
  return HTML;
}

function loadEvidence() {
  if (!existsSync(EVIDENCE)) return { schema: "how2build3d/degrade@1", ready: null, modes: [], zeroAssets: null };
  try {
    return JSON.parse(readFileSync(EVIDENCE, "utf8"));
  } catch {
    return { schema: "how2build3d/degrade@1", ready: null, modes: [], zeroAssets: null };
  }
}

function saveEvidence(data) {
  mkdirSync(path.dirname(EVIDENCE), { recursive: true });
  writeFileSync(EVIDENCE, `${JSON.stringify(data, null, 2)}\n`);
}

async function withPage(query, body, html = HTML) {
  const { launchFixture, snapshot } = await import("../boot.mjs");
  const url = `${pathToFileURL(html).href}${query ? `?${query}` : ""}`;
  const session = await launchFixture({ url, waitMs: 2500, viewport: [800, 450] });
  try {
    const beat = await snapshot(session.page, { heartbeatMs: 500 });
    const runtime = await session.page.evaluate(() => ({
      ready: window.__READY__ || null,
      degrade: window.__DEGRADE__ || null,
      errors: (window.__errors || []).slice(-8),
      calls: window.__stats ? window.__stats().calls : 0,
      frame: window.__G ? window.__G.time.frame : 0,
    }));
    return await body(runtime, beat, session.page);
  } finally {
    await session.close();
  }
}

async function checkReady() {
  buildStarter();
  return withPage("seed=4207", (runtime, beat) => {
    const r = runtime.ready || {};
    const problems = [];
    if (!r.ready) problems.push("__READY__.ready never set");
    if (!(r.at > 0)) problems.push("__READY__.at missing");
    if (!(r.firstFrameAt >= r.at)) problems.push("first frame happened before ready");
    if (!(r.maxBatchMs <= 16)) problems.push(`maxBatchMs ${r.maxBatchMs} > 16`);
    if (!Array.isArray(r.batches) || r.batches.length < 3) problems.push("startup batches not recorded");
    if (runtime.errors.length) problems.push(`page errors: ${runtime.errors.join(" | ")}`);
    if (!(runtime.calls > 0)) problems.push("no draw calls");
    if (beat && beat.heartbeat && beat.heartbeat.ticks < 2) problems.push("heartbeat stalled");
    const evidence = loadEvidence();
    evidence.ready = {
      status: problems.length ? "fail" : "pass",
      ready: r,
      calls: runtime.calls,
      frame: runtime.frame,
      errors: runtime.errors,
      heartbeat: beat.heartbeat || null,
      at: new Date().toISOString(),
    };
    saveEvidence(evidence);
    if (problems.length) {
      for (const p of problems) console.error(`degrade ready: ${p}`);
      return 1;
    }
    console.log(`degrade ready OK: batches=${r.batches.length} maxBatchMs=${r.maxBatchMs} firstFrameAt>=at, calls=${runtime.calls}`);
    return 0;
  });
}

async function checkForceFail(mode) {
  if (!FALLBACKS[mode]) {
    console.error(`unknown force-fail mode: ${mode}`);
    return 2;
  }
  buildStarter();
  return withPage(`seed=4207&__FORCE_FAIL__=${mode}`, (runtime, beat) => {
    const problems = [];
    const d = runtime.degrade || {};
    if (d.injected !== mode) problems.push(`__DEGRADE__.injected=${d.injected}, expected ${mode}`);
    if (d.fallback !== FALLBACKS[mode]) problems.push(`fallback ${d.fallback}, expected ${FALLBACKS[mode]}`);
    if (runtime.errors.length) problems.push(`page errors: ${runtime.errors.join(" | ")}`);
    if (!(runtime.calls > 0)) problems.push("rendering did not continue after injection");
    if (beat && beat.heartbeat && beat.heartbeat.ticks < 2) problems.push("heartbeat stalled after injection");
    const evidence = loadEvidence();
    evidence.modes = (evidence.modes || []).filter((row) => row.mode !== mode);
    evidence.modes.push({
      mode,
      status: problems.length ? "fail" : "pass",
      injected: d.injected,
      fallback: d.fallback,
      calls: runtime.calls,
      errors: runtime.errors,
      at: new Date().toISOString(),
    });
    evidence.modes.sort((a, b) => ["post", "chunk", "asset"].indexOf(a.mode) - ["post", "chunk", "asset"].indexOf(b.mode));
    saveEvidence(evidence);
    if (problems.length) {
      for (const p of problems) console.error(`degrade ${mode}: ${p}`);
      return 1;
    }
    console.log(`degrade ${mode} OK: fallback=${d.fallback}, calls=${runtime.calls}, errors=0`);
    return 0;
  });
}

export function selfTest() {
  const negatives = [
    ["fetch", `<script>fetch("https://cdn.example/a.json")</script>`],
    ["script", `<script src="https://cdn.example/a.js"></script>`],
    ["img", `<img src="https://cdn.example/a.png">`],
    ["audio", `<audio src="https://cdn.example/a.mp3"></audio>`],
    ["model", `<script>load("https://cdn.example/a.glb")</script>`],
    ["link", `<link rel="stylesheet" href="https://cdn.example/a.css">`],
  ];
  const failures = [];
  const clean = `<html><head><style>body{}</style></head><body><canvas id="view"></canvas><script>/* starter modules */ var x=1;</script></body></html>`;
  const cleanHits = scanExternalLinks(clean);
  if (cleanHits.length) failures.push(`clean sample judged red: ${cleanHits.join(",")}`);
  for (const [kind, sample] of negatives) {
    const hits = scanExternalLinks(`<html><body><script>/* starter modules */</script>${sample}</body></html>`);
    if (!hits.includes(kind)) failures.push(`negative ${kind} not detected (hits: ${hits.join(",")})`);
  }
  // 注入映射表完整性（负例：未知模式必须拒绝）
  if (FALLBACKS.nope !== undefined) failures.push("unknown mode accepted");
  if (failures.length) {
    for (const f of failures) console.error(`self-test FAIL: ${f}`);
    return 1;
  }
  console.log(`degrade self-test OK: clean 0 hits, negatives ${negatives.length}/${negatives.length} judged red`);
  return 0;
}

async function checkZeroAssets() {
  buildStarter();
  const html = readFileSync(HTML, "utf8");
  const hits = scanExternalLinks(html);
  if (hits.length) {
    console.error(`external links in build artifact: ${hits.join(", ")}`);
    return 1;
  }
  const isolated = mkdtempSync(path.join(tmpdir(), "h2b-standalone-"));
  try {
    const entry = path.join(isolated, "index.html");
    writeFileSync(entry, html);
    const code = await withPage("seed=4207", (runtime, beat) => {
      const problems = [];
      if (runtime.errors.length) problems.push(`page errors: ${runtime.errors.join(" | ")}`);
      if (!(runtime.calls > 0)) problems.push("no draw calls with assets/ moved away");
      if (beat && beat.heartbeat && beat.heartbeat.ticks < 2) problems.push("heartbeat stalled");
      if (problems.length) {
        for (const p of problems) console.error(`zero-assets: ${p}`);
        return 1;
      }
      console.log(`zero-assets OK: zero external links, calls=${runtime.calls} from isolated HTML`);
      return 0;
    }, entry);
    const evidence = loadEvidence();
    evidence.zeroAssets = {
      status: code === 0 ? "pass" : "fail",
      externalLinkKinds: hits,
      calls: code === 0 ? "observed" : null,
      at: new Date().toISOString(),
    };
    saveEvidence(evidence);
    return code;
  } finally {
    rmSync(isolated, { recursive: true, force: true });
  }
}

export async function main(argv = process.argv.slice(2)) {
  try {
    if (argv.includes("--self-test")) return selfTest();
    if (argv.includes("--force-fail")) {
      const i = argv.indexOf("--force-fail");
      return await checkForceFail(argv[i + 1]);
    }
    if (argv.includes("--zero-assets") || argv.includes("--external-links")) return await checkZeroAssets();
    if (argv.includes("--scene")) {
      if (argv[argv.indexOf("--scene") + 1] !== "examples/starter") throw new Error("only examples/starter is supported");
      return await checkReady();
    }
    console.error("usage: node harness/gates/degrade.mjs --scene examples/starter --assert | --force-fail <mode> --assert | --self-test | --zero-assets --external-links --assert");
    return 2;
  } catch (error) {
    console.error(`degrade: ${error.message}`);
    return error.exitCode ?? 1;
  }
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) process.exit(await main());
