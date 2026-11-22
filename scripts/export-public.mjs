#!/usr/bin/env node
/**
 * scripts/export-public.mjs — 白名单公开快照导出（零新增依赖，只用 Node 标准库与本地 git CLI）
 *
 * 设计约束：
 *  - 只从 `git ls-tree -r HEAD` 枚举**已提交**文件，绝不遍历工作区；未跟踪的 secret
 *    与 .maintainer 收据不可能进入 staging。
 *  - 白名单 include 与强制排除断言双保险；命中排除即判红并逐条打印命中路径。
 *  - 默认只读：--dry-run --assert 不写仓库、不联网、不启动 Chrome。
 *  - --self-test 在 os.tmpdir() 建临时 git 夹具，正向样例必须绿、每个负面样例
 *    （secret 文件与各排除目录）必须判红并给出命中路径，结束后清理。
 *  - --publish 是显式参数入口；缺 --authorized-by / --out / LICENSE /
 *    THIRD_PARTY_NOTICES 或 README 引用的必需图片时失败退出。
 *
 * CLI:
 *   node scripts/export-public.mjs --dry-run --assert
 *   node scripts/export-public.mjs --self-test
 *   node scripts/export-public.mjs --publish --out <dir> --authorized-by <记录>
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";

export const REQUIRED_FILES = Object.freeze([
  "README.md", "README.en.md", "LICENSE", "THIRD_PARTY_NOTICES",
  "CHANGELOG", "PROVENANCE.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "SECURITY.md",
  "media/quality.png", "media/saltline-reference.jpg", "media/material-gallery.jpg", "media/gameplay.jpg", "media/parity.jpg", "media/distillation-flow.svg",
  ".github/ISSUE_TEMPLATE/config.yml", ".github/ISSUE_TEMPLATE/10_bug.yml",
  ".github/ISSUE_TEMPLATE/20_feature.yml", ".github/PULL_REQUEST_TEMPLATE.md", ".github/release.yml",
]);

/** 白名单：只导出这些文件/目录；不存在的项在清单里标记 missing。 */
export const INCLUDES = Object.freeze([
  "SKILL.md",
  ...REQUIRED_FILES,
  ".gitignore",
  "references/**",
  "snippets/**",
  "assets/**",
  "examples/**",
  "harness/**",
  "scripts/**",
  ".distill/**",
]);

/** 强制排除：命中 staging 内任一路径即判红。 */
export const DIR_EXCLUDES = Object.freeze([
  "sources/",
  "evidence/**",
  ".spec/",
  ".zcode/",
  ".maintainer/",
  ".agents/", ".claude/", ".codex/", ".pi/", ".cursor/", ".paseo/",
  "skill/",
  "node_modules/",
  "build/",
  "dist/",
  "coverage/",
  ".git/**",
]);
export const FILE_EXCLUDES = Object.freeze([
  ".env*",
  "*.pem",
  "*.key",
  "id_rsa*",
  "*token*",
  "*.log",
  "*.sqlite*",
]);
export const EXCLUDES = Object.freeze([...DIR_EXCLUDES, ...FILE_EXCLUDES]);

function globToRegExp(glob) {
  let source = "";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        source += ".*";
        i += 1;
      } else {
        source += "[^/]*";
      }
    } else if (ch === "?") {
      source += "[^/]";
    } else {
      source += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

const FILE_RULES = FILE_EXCLUDES.map((rule) => ({ rule, re: globToRegExp(rule) }));
const DIR_RULES = DIR_EXCLUDES.map((rule) => ({ rule, name: rule.replace(/\/(\*\*)?$/, "") }));

/** 返回某路径命中的全部排除规则（目录规则按路径段匹配，文件规则按 basename 匹配）。 */
export function exclusionHits(filePath) {
  const hits = [];
  const segments = filePath.split("/");
  const basename = segments[segments.length - 1];
  for (const { rule, name } of DIR_RULES) {
    if (segments.includes(name)) hits.push(rule);
  }
  for (const { rule, re } of FILE_RULES) {
    if (re.test(basename)) hits.push(rule);
  }
  return hits;
}

/** include 是否与某个路径匹配；`dir/**` 按前缀匹配。 */
export function includeMatches(include, filePath) {
  if (include.endsWith("/**")) return filePath.startsWith(include.slice(0, -2));
  return include === filePath;
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim() || result.error?.message || "unknown"}`);
  }
  return result.stdout;
}

/** 从 git ls-tree 枚举已提交文件（绝不遍历工作区）。 */
export function committedEntries(root, commit = "HEAD") {
  const raw = git(root, ["ls-tree", "-r", "-z", commit]);
  return raw
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf("\t");
      const meta = line.slice(0, tab).split(" ");
      return { mode: meta[0], type: meta[1], sha: meta[2], path: line.slice(tab + 1) };
    });
}

/** 由已提交条目构造 staging 清单（供 dry-run / publish / self-test 共用）。 */
export function manifestFromEntries(entries, { commit = "" } = {}) {
  const paths = entries.map((entry) => entry.path);
  const selected = entries.filter((entry) => INCLUDES.some((include) => includeMatches(include, entry.path)));
  const missing = INCLUDES.filter((include) => !paths.some((filePath) => includeMatches(include, filePath)));
  const hits = selected
    .map((entry) => ({ path: entry.path, rules: [...exclusionHits(entry.path),
      ...(entry.type === "blob" && ["100644", "100755"].includes(entry.mode) ? [] : ["not a regular file"])] }))
    .filter((item) => item.rules.length > 0);
  const canonical = selected.map((entry) => `${entry.mode} ${entry.type} ${entry.sha} ${entry.path}`).join("\n");
  const treeSha256 = createHash("sha256").update(canonical).digest("hex");
  const blockedFiles = REQUIRED_FILES.filter((name) => !paths.includes(name)).map(name => `missing ${name}`);
  return {
    commit,
    files: selected.map((entry) => entry.path),
    executables: selected.filter(entry => entry.mode === "100755").map(entry => entry.path),
    missing,
    hits,
    treeSha256,
    publishBlocked: blockedFiles.length > 0 ? blockedFiles : [],
  };
}

export function buildManifest(root) {
  const commit = git(root, ["rev-parse", "HEAD"]).trim();
  return manifestFromEntries(committedEntries(root, commit), { commit });
}

export function renderManifest(manifest) {
  const lines = [
    `public snapshot staging: ${manifest.files.length} files`,
    `commit: ${manifest.commit || "(none)"}`,
    `tree sha256: ${manifest.treeSha256}`,
    ...manifest.missing.map((item) => `missing: ${item}`),
  ];
  if (manifest.publishBlocked.length) {
    lines.push(`PUBLISH BLOCKED: ${manifest.publishBlocked.join("; ")}`);
  }
  if (manifest.hits.length) {
    lines.push(`EXCLUSION HIT: ${manifest.hits.length} file(s)`);
    for (const hit of manifest.hits) lines.push(`  - ${hit.path} -> ${hit.rules.join(", ")}`);
  } else {
    lines.push("exclusion assertions: 0 hits");
  }
  return lines.join("\n");
}

export function assertManifest(manifest) {
  const output = renderManifest(manifest);
  console.log(output);
  if (manifest.hits.length) {
    console.error(`export-public: ${manifest.hits.length} exclusion hit(s); staging is not publishable`);
    return 1;
  }
  return manifest.publishBlocked.length ? 1 : 0;
}

function parseArgs(argv) {
  const args = { flags: new Set(), root: process.cwd() };
  const valued = new Map([
    ["--out", "out"],
    ["--authorized-by", "authorizedBy"],
    ["--root", "root"],
  ]);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (valued.has(token)) {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`missing value for ${token}`);
      args[valued.get(token)] = value;
      i += 1;
    } else if (["--dry-run", "--assert", "--publish", "--self-test"].includes(token)) {
      args.flags.add(token);
    } else {
      throw new Error(`unexpected argument: ${token}`);
    }
  }
  const modes = ["--dry-run", "--publish", "--self-test"].filter(flag => args.flags.has(flag));
  if (modes.length !== 1 || (args.flags.has("--assert") && !args.flags.has("--dry-run")) ||
      ((args.out || args.authorizedBy) && !args.flags.has("--publish"))) throw new Error("incompatible export options");
  return args;
}

function writeTempRepo(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "h2b-export-selftest-"));
  for (const filePath of files) {
    const full = path.join(dir, filePath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, `fixture: ${filePath}\n`);
  }
  git(dir, ["init", "-q"]);
  git(dir, ["add", "-f", "-A"]);
  git(dir, ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-q", "-m", "fixture"]);
  return dir;
}

const POSITIVE_FILES = [
  "SKILL.md",
  ...REQUIRED_FILES,
  ".gitignore",
  "references/00-workflow.md",
  "snippets/sea.glsl.mjs",
  "assets/fixture.mjs",
  "examples/quality/src/scene.mjs",
  "harness/verify.mjs",
  "scripts/export-public.mjs",
  ".distill/00-index.md",
];

const NEGATIVE_SAMPLES = [
  ["assets/secret-token.txt", "*token*"],
  ["scripts/.env.production", ".env*"],
  ["assets/id_rsa", "id_rsa*"],
  ["assets/key.pem", "*.pem"],
  ["references/private.key", "*.key"],
  ["scripts/app.log", "*.log"],
  ["assets/data.sqlite3", "*.sqlite*"],
  ["examples/sources/raw.html", "sources/"],
  ["examples/evidence/shot.png", "evidence/**"],
  ["examples/.spec/hidden.md", ".spec/"],
  ["examples/.zcode/hidden.md", ".zcode/"],
  ["examples/.maintainer/receipt.json", ".maintainer/"],
  ["examples/skill/hidden.md", "skill/"],
  ["examples/node_modules/x.js", "node_modules/"],
  ["examples/build/x.js", "build/"],
  ["examples/dist/x.js", "dist/"],
  ["examples/coverage/x.js", "coverage/"],
  ["examples/.git/config", ".git/**"],
];

/** 正面夹具走完整 git 管道；负面样例逐个用同一清单构造器判红。 */
export function selfTest() {
  const dirs = [];
  const failures = [];
  try {
    const positiveRoot = writeTempRepo(POSITIVE_FILES);
    dirs.push(positiveRoot);
    const positive = buildManifest(positiveRoot);
    if (positive.hits.length) failures.push(`positive fixture hit exclusions: ${JSON.stringify(positive.hits)}`);
    if (positive.publishBlocked.length) failures.push(`positive fixture missing notices: ${positive.publishBlocked}`);
    if (positive.files.length !== POSITIVE_FILES.length) {
      failures.push(`positive fixture staged ${positive.files.length} of ${POSITIVE_FILES.length}`);
    }

    for (const [sample, rule] of NEGATIVE_SAMPLES) {
      const entries = [...POSITIVE_FILES, sample].map((filePath) => ({
        mode: "100644",
        type: "blob",
        sha: "0".repeat(40),
        path: filePath,
      }));
      const manifest = manifestFromEntries(entries, { commit: "fixture" });
      const hit = manifest.hits.find((item) => item.path === sample);
      if (!hit) failures.push(`negative sample not judged red: ${sample}`);
      else if (!hit.rules.includes(rule)) failures.push(`${sample} hit ${hit.rules.join(",")} but expected ${rule}`);
    }

    const noNotices = manifestFromEntries(
      POSITIVE_FILES.filter((filePath) => !["LICENSE", "THIRD_PARTY_NOTICES"].includes(filePath)).map((filePath) => ({
        mode: "100644",
        type: "blob",
        sha: "0".repeat(40),
        path: filePath,
      })),
      { commit: "fixture" },
    );
    if (noNotices.hits.length || noNotices.publishBlocked.length !== 2) {
      failures.push("missing-notice case did not stay dry-run green with PUBLISH BLOCKED");
    }
    if (!renderManifest(noNotices).includes("PUBLISH BLOCKED")) failures.push("PUBLISH BLOCKED not rendered");
  } finally {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length) {
    for (const failure of failures) console.error(`self-test FAIL: ${failure}`);
    return 1;
  }
  console.log(`self-test OK: positive 1/1, negative ${NEGATIVE_SAMPLES.length}/${NEGATIVE_SAMPLES.length}, publish-blocked 1/1`);
  return 0;
}

/** 显式参数入口：本包范围外，不执行发布；参数齐全时才写 staging 与收据。 */
export function publish(root, { out, authorizedBy }) {
  const manifest = buildManifest(root);
  const output = renderManifest(manifest);
  console.log(output);
  if (manifest.hits.length) {
    console.error("publish refused: exclusion hits in staging");
    return 1;
  }
  if (manifest.publishBlocked.length) return 1;
  if (!out || !authorizedBy?.trim()) {
    console.error("publish refused: --out and --authorized-by are required");
    return 1;
  }
  const requested = path.resolve(root, out);
  const staging = path.join(realpathSync(path.dirname(requested)), path.basename(requested));
  const under = (base, target) => target === base || target.startsWith(base + path.sep);
  if (!under(realpathSync(tmpdir()), staging) || under(realpathSync(root), staging)) throw new Error("use a new staging directory under the system temporary directory, outside the repository");
  const receiptDir = path.join(root, ".maintainer");
  const prior = lstatSync(receiptDir, { throwIfNoEntry: false });
  if (prior && !prior.isDirectory()) throw new Error("invalid receipt directory");
  mkdirSync(staging, { mode: 0o700 });
  try {
    for (const filePath of manifest.files) {
      const blob = spawnSync("git", ["show", `${manifest.commit}:${filePath}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
      if (blob.status !== 0) throw new Error(`failed reading blob: ${filePath}`);
      const destination = path.join(staging, filePath);
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, blob.stdout, { flag: "wx" });
      if (manifest.executables.includes(filePath)) chmodSync(destination, 0o755);
    }
    const receipt = {
      schema: "how2build3d/public-snapshot@1",
      authorizedBy,
      scope: "whitelist-only; forced exclusions asserted 0 hits",
      stagingPath: staging,
      gate: { dryRunAssert: "pass", exclusionHits: 0, publishBlocked: manifest.publishBlocked },
      treeSha256: manifest.treeSha256,
      commit: manifest.commit,
      files: manifest.files.length,
      generatedAt: new Date().toISOString(),
    };
    mkdirSync(receiptDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const receiptPath = path.join(receiptDir, `public-snapshot-${stamp}.json`);
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
    console.log(`publish staged ${manifest.files.length} files -> ${staging}`);
    console.log(`receipt: ${receiptPath}`);
    return 0;
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

export function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    if (args.flags.has("--self-test")) return selfTest();
    if (args.flags.has("--publish")) return publish(args.root, { out: args.out, authorizedBy: args.authorizedBy });
    if (args.flags.has("--dry-run") && args.flags.has("--assert")) return assertManifest(buildManifest(args.root));
    if (args.flags.has("--dry-run")) {
      console.log(renderManifest(buildManifest(args.root)));
      return 0;
    }
    console.error("usage: node scripts/export-public.mjs --dry-run --assert | --self-test | --publish --out <dir> --authorized-by <记录>");
    return 2;
  } catch (error) {
    console.error(`export-public: ${error.message}`);
    return 1;
  }
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) process.exit(main());
