import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { REQUIRED_FILES } from "../../scripts/export-public.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const exporter = path.join(root, "scripts/export-public.mjs");

function temporary(context) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "h2b delivery-")));
  context.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(file, contents) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

function run(command, args, { cwd = root, env = process.env, status = 0 } = {}) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8" });
  assert.equal(result.status, status, [command, ...args, result.error, result.stdout, result.stderr].join(" "));
  return result.stdout + result.stderr;
}

test("fresh install, same-version source drift, reinstall and foreign target ownership", context => {
  const base = temporary(context);
  const source = path.join(base, "src");
  const installer = path.join(source, "scripts/install-skill.sh");
  for (const name of ["scripts/install-skill.sh", "harness/package.json", "SKILL.md", "references/00-workflow.md", "snippets/sky.glsl.mjs", ".distill/creation/00-index.md"]) {
    write(path.join(source, name), readFileSync(path.join(root, name)));
  }
  const library = path.join(base, "library");
  const dsh = path.join(base, "dsh");
  const dest = path.join(library, "how2build3d");
  const live = path.join(dsh, "how2build3d");
  const env = { ...process.env, HOW2BUILD3D_SKILL_LIBRARY: library, HOW2BUILD3D_DSH_SKILLS: dsh };
  const install = (args = [], status = 0) => run("bash", [installer, ...args], { env, status });
  install(); install(["--check"]);
  write(path.join(dest, "harness/node_modules/three/index.js"), "local dependency");
  install(["--check"]);
  write(path.join(source, "references/00-workflow.md"), "same version, new reference\n");
  install(["--check"], 1); install(); install(["--check"]);
  assert.equal(realpathSync(live), source);
  install(["--uninstall"]);
  assert.ok(!existsSync(dest) && !existsSync(live));
  write(path.join(dest, "custom.txt"), "keep");
  install([], 1);
  assert.equal(readFileSync(path.join(dest, "custom.txt"), "utf8"), "keep");
  const foreign = path.join(base, "foreign");
  mkdirSync(foreign);
  rmSync(dest, { recursive: true }); symlinkSync(foreign, dest); symlinkSync(foreign, live);
  install([], 1); install(["--uninstall"]);
  assert.equal(realpathSync(dest), foreign); assert.equal(realpathSync(live), foreign);
});

test("nested scaffold and real build work from a relocated project", context => {
  const base = temporary(context);
  const script = path.join(base, "scripts/scaffold-scene.mjs");
  mkdirSync(path.dirname(script)); copyFileSync(path.join(root, "scripts/scaffold-scene.mjs"), script);
  for (const name of ["harness", "assets"]) symlinkSync(path.join(root, name), path.join(base, name));
  const parent = "nested/scene fixtures";
  const scene = `${parent}/audit-test`;
  const generate = (extra, status = 0) => run(process.execPath, [script, "--name", "audit-test", "--dir", parent, ...extra], { cwd: base, status });
  generate(["--check"]); assert.ok(!existsSync(path.join(base, scene)));
  generate(["--no-verify"]);
  run(process.execPath, [path.join(base, scene, "build.mjs"), "--assert"], { cwd: base });
  assert.ok(statSync(path.join(base, "build/audit-test/index.html")).size > 1_000_000);
  assert.equal(JSON.parse(readFileSync(path.join(base, scene, "scene.elements.json"))).scene, scene);
  assert.ok(readFileSync(path.join(base, scene, "README.md"), "utf8").includes(`"${scene}/build.mjs"`));
  generate(["--check"], 1);
  run(process.execPath, [script, "--name", "audit-test", "--dir", "../outside", "--check"], { status: 2 });
  const world = path.join(base, scene, "src/world.mjs");
  const sentinel = path.join(base, "untouched"); write(sentinel, "keep"); unlinkSync(world); symlinkSync(sentinel, world);
  generate(["--force", "--no-verify"], 1);
  assert.equal(readFileSync(sentinel, "utf8"), "keep");
});

test("local export uses committed bytes, requires clean staging and rejects unsafe entries", context => {
  const base = temporary(context);
  const repo = path.join(base, "repo");
  mkdirSync(repo);
  const git = (...args) => run("git", args, { cwd: repo });
  git("init", "-q");
  const commit = () => { git("add", "."); git("-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture"); };
  for (const name of [...REQUIRED_FILES, "scripts/run.sh", ".github/workflows/private.yml"]) write(path.join(repo, name), name);
  chmodSync(path.join(repo, "scripts/run.sh"), 0o755); commit();
  const cli = path.join(base, "linked export.mjs"); symlinkSync(exporter, cli);
  const call = (args, status = 0) => run(process.execPath, [cli, ...args], { cwd: repo, status });
  const out = path.join(base, "stage");
  const stage = ["--publish", "--out", out, "--authorized-by", "synthetic fixture"];
  write(path.join(repo, "README.md"), "uncommitted");
  call(["--dry-run", ...stage], 1); assert.ok(!existsSync(out));
  assert.match(call(["--dry-run", "--assert"]), /0 hits/);
  call(stage);
  assert.ok(!existsSync(path.join(out, ".github/workflows/private.yml")));
  assert.ok(existsSync(path.join(out, ".github/PULL_REQUEST_TEMPLATE.md")));
  assert.ok(existsSync(path.join(out, "media/distillation-flow.svg")));
  assert.ok(existsSync(path.join(out, "media/saltline-reference.jpg")));
  assert.equal(readFileSync(path.join(out, "README.md"), "utf8"), "README.md");
  assert.equal(statSync(path.join(out, "scripts/run.sh")).mode & 0o111, 0o111);
  write(path.join(out, "previous"), "keep"); call(stage, 1);
  assert.equal(readFileSync(path.join(out, "previous"), "utf8"), "keep");
  write(path.join(repo, "assets/sl-surface.mjs"), "synthetic fixture"); commit();
  assert.match(call(["--dry-run", "--assert"]), /0 hits/);
  const authorizedOut = path.join(base, "authorized-stage");
  call(["--publish", "--out", authorizedOut, "--authorized-by", "fixture"]);
  assert.equal(readFileSync(path.join(authorizedOut, "assets/sl-surface.mjs"), "utf8"), "synthetic fixture");
  symlinkSync("../README.md", path.join(repo, "assets/link")); commit();
  assert.match(call(["--dry-run", "--assert"], 1), /not a regular file/);
});

test("failed browser preflight records failure without running Chrome steps", context => {
  const base = temporary(context);
  for (const name of ["harness/gates/browser-evidence.mjs", "harness/verify.mjs", "harness/boot.mjs"]) {
    write(path.join(base, name), readFileSync(path.join(root, name)));
  }
  symlinkSync(path.join(root, "harness/node_modules"), path.join(base, "harness/node_modules"));
  write(path.join(base, "examples/parity/build.mjs"), "process.exit(17);\n");
  const script = path.join(base, "harness/gates/browser-evidence.mjs");
  const env = { ...process.env, H2B_STEAL_MAX_PCT: "100", H2B_SWAP_MAX_PCT: "100" };
  run(process.execPath, [script, "--scene", "examples/parity", "--assert"], { cwd: base, env, status: 1 });
  const evidence = JSON.parse(readFileSync(path.join(base, "evidence/browser-gates.json")));
  assert.equal(evidence.status, "fail");
  assert.equal(evidence.preflight.exit, 17);
  assert.deepEqual(evidence.steps, []);
});
