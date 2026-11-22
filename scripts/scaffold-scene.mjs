#!/usr/bin/env node
/**
 * scripts/scaffold-scene.mjs — 生成一个「能跑、但对账红灯」的新场景骨架。
 *
 * 设计意图：模型不该从空白文件起步，也不该从「不知道缺什么」起步。骨架自带：
 *   1. 可构建可渲染的最小场景（build --assert / render/scene --assert 即绿）；
 *   2. 九展厅注册表 + __setShot + __G / __stats / __PARITY__ 检视契约；
 *   3. 元素对账的缺口清单（scene.elements.json 全族 TODO、inspect.manifest.json 全 n/a 空理由），
 *      由 complete.mjs 逐条判红，模型照红点补；
 *   4. R0.md 场景申报骨架（五节结构齐全、内容全 TODO），由 harness/gates/r0.mjs --scene 逐条判红。
 *
 * CLI:
 *   node scripts/scaffold-scene.mjs --name myScene [--tier visual|game|full] [--dir examples]
 *   node scripts/scaffold-scene.mjs --name myScene --check        # 只校验参数与目标目录
 *   node scripts/scaffold-scene.mjs --self-test                   # 模板自检（离线，不写盘）
 *   --force        覆盖已存在目录；--no-verify 跳过生成后的自测
 *
 * 生成后自动自测：
 *   node <dir>/<name>/build.mjs --assert
 *   node harness/render/scene.mjs --scene <dir>/<name> --assert
 */

import { existsSync, lstatSync, mkdirSync, mkdtempSync, writeFileSync, realpathSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

// 清单模板的键清单来自单一真源；scaffold 只负责形状与 TODO 文案。
import { GALLERIES, ELEMENT_IDS, SYSTEMS } from "../harness/constants.mjs";
// R0 模板的「红色起点」由场景门禁的 canonical 校验证明，不在这里另写一份判定。
import { ELEMENT_CLASSES, checkR0Scene, validateSceneR0 } from "../harness/gates/r0.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NAME_RE = /^[a-z][a-z0-9-]*$/;
const TIERS = ["visual", "game", "full"];

function parseArgs(argv) {
  const out = { name: null, tier: "full", dir: "examples", force: false, check: false, verify: true };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (["--name", "--tier", "--dir"].includes(a) && (!argv[i + 1] || argv[i + 1].startsWith("--"))) {
      console.error(`scaffold: missing value for ${a}`);
      process.exit(2);
    }
    if (a === "--name") { i += 1; out.name = argv[i]; }
    else if (a === "--tier") { i += 1; out.tier = argv[i]; }
    else if (a === "--dir") { i += 1; out.dir = argv[i]; }
    else if (a === "--force") out.force = true;
    else if (a === "--check") out.check = true;
    else if (a === "--no-verify") out.verify = false;
    else { console.error(`unknown arg: ${a}`); process.exit(2); }
  }
  return out;
}

// ---------------------------------------------------------------- 文件模板

function buildScript(name, tier, sceneRel) {
  const game = tier !== "visual";
  const assetLines = [
    '  slTextures: readAsset("assets/sl-textures.mjs"),',
    '  slSurface: readAsset("assets/sl-surface.mjs"),',
    '  postChain: readAsset("assets/post-chain.glsl"),',
    '  postAA: readAsset("assets/post-aa.glsl"),',
    '  shafts: readAsset("assets/shafts.glsl"),',
    '  skyDeck: readAsset("assets/sky-deck.glsl"),',
    '  pcss: readAsset("assets/pcss-shadow.glsl"),',
    '  ssrWet: readAsset("assets/ssr-wet.glsl"),',
    game ? '  physicsKit: readAsset("assets/physics-kit.mjs"),' : null,
    game ? '  levelKit: readAsset("assets/level-kit.mjs"),' : null,
    game ? '  combatKit: readAsset("assets/combat-kit.mjs"),' : null,
    '  inspectDeck: readAsset("assets/inspect-deck.mjs"),',
  ].filter(Boolean).join("\n");

  const modules = [
    "world.mjs",
    "mats.mjs",
    "ground.mjs",
    "content.mjs",
    ...(game ? ["layout.mjs", "bots.mjs", "game.mjs"] : []),
    "inspect.mjs",
    "scene.mjs",
  ];

  const markers = [
    '"createInspectDeck"', '"__PARITY__"', '"__setShot"',
    '"SL_MATERIALS"', '"VOL_STEPS"', '"SL_SURFACE"',
    ...(game ? ['"createPhysicsKit"', '"createCombatKit"', '"moveCapsule"'] : []),
  ];

  return `/**
 * ${name}/build.mjs — three.cjs + 资产 + src/*.mjs 拼成单文件 HTML。
 * 输出：build/${name}/index.html（gitignored，可再生；符合 harness/render/scene.mjs 的输出契约）。
 *
 * 装配顺序与模块边界见 references/12-full-scene-assembly.md。
 * CLI: node ${sceneRel}/build.mjs --assert
 */

import { readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ${JSON.stringify(path.relative(sceneRel, "."))});
const THREE_CJS = path.join(ROOT, "harness/node_modules/three/build/three.cjs");
const SCENE_DIR = ${JSON.stringify(sceneRel)};
const OUT = path.join(ROOT, "build/${name}/index.html");

const readAsset = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const ASSETS = {
${assetLines}
};
const toScript = (esm) => esm.replace(/^export (const|function) /gm, "$1 ");

const MODULES = ${JSON.stringify(modules)};
const CSS = "html,body{margin:0;height:100%;background:#0b0d0f;overflow:hidden;font-family:ui-monospace,'PingFang SC',monospace;}"
  + "#view{display:block;width:100vw;height:100vh;}"
  + "#hud{position:fixed;left:16px;bottom:16px;color:#e8e4da;font-size:12px;letter-spacing:.08em;text-shadow:0 1px 4px #000;white-space:pre;}"
  + "#hud b{color:#ffb347;}";

export function build() {
  const three = readFileSync(THREE_CJS, "utf8");
  const src = MODULES
    .map((m) => readFileSync(path.join(ROOT, SCENE_DIR, "src", m), "utf8"))
    .join("\\n\\n");
  const kitNames = Object.keys(ASSETS).filter((k) => /Kit$/.test(k));
  const kitScript = kitNames.map((k) => toScript(ASSETS[k])).join("\\n");
  const glslNames = Object.keys(ASSETS).filter((k) => !/Kit$/.test(k) && k !== "inspectDeck" && k !== "slTextures" && k !== "slSurface");
  const glslScript = glslNames
    .map((k) => "var GLSL_" + k.replace(/([A-Z])/g, "_$1").toUpperCase() + " = " + JSON.stringify(ASSETS[k]) + ";")
    .join("\\n");
  const factoryScript = [ASSETS.slTextures, ASSETS.slSurface].filter(Boolean).map(toScript).join("\\n");
  const deckScript = toScript(ASSETS.inspectDeck) + "\\nglobalThis.InspectDeck = { INSPECT_GALLERIES, readInspectMode, createInspectDeck };";
  const kitGlobal = kitNames.length
    ? "globalThis.PhysicsKit = typeof createPhysicsKit === \\"function\\" ? { createPhysicsKit } : undefined;"
      + "\\nglobalThis.LevelKit = typeof createLevelKit === \\"function\\" ? { createLevelKit, validateLayout } : undefined;"
      + "\\nglobalThis.CombatKit = typeof createCombatKit === \\"function\\" ? { createCombatKit, COMBAT_TUNE_DEFAULTS } : undefined;"
    : "";

  const html = [
    "<!doctype html>",
    '<html lang="zh-CN"><head><meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
    "<title>${name}</title>",
    "<style>" + CSS + "</style></head>",
    "<body>",
    '<canvas id="view" tabindex="0"></canvas>',
    '<div id="hud">booting…</div>',
    "<script>",
    "/* three.js r180 (MIT) inlined: build-time only, zero runtime requests */",
    "var THREE = (function(){ var exports = {}; var module = { exports: exports };",
    three,
    "return exports; })();",
    "</script>",
    "<script>",
    "/* ===== 资产（原样内联）===== */",
    factoryScript,
    glslScript,
    kitScript,
    kitGlobal,
    deckScript,
    "</script>",
    "<script>",
    "/* ===== 场景模块（按 MODULES 顺序，顺序即依赖）===== */",
    src,
    "H2B.bootScene();",
    "</script>",
    "</body></html>",
  ].join("\\n");

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, html);
  return { path: OUT, bytes: Buffer.byteLength(html, "utf8"), threeBytes: Buffer.byteLength(three, "utf8") };
}

export async function main(argv) {
  const result = build();
  console.log("build: " + result.bytes + "B single-file HTML (three r180: " + result.threeBytes + "B inlined) -> " + path.relative(ROOT, result.path));
  if (argv.includes("--assert")) {
    const html = readFileSync(result.path, "utf8");
    const markers = [${markers.join(", ")}];
    const missing = markers.filter((m) => !html.includes(m));
    const ok = result.bytes > 1000000 && missing.length === 0
      && !html.includes("<script src=") && !html.includes('<link rel="stylesheet');
    if (!ok) {
      console.error("${name}/build.mjs --assert FAILED: missing markers: " + missing.join(", "));
      return 1;
    }
    console.log("${name}/build.mjs --assert OK: markers present: " + markers.length);
  }
  return 0;
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => {
    console.error("${name}/build.mjs crashed:", err && err.message ? err.message : err);
    process.exit(1);
  });
}
`;
}

const WORLD_MJS = `/**
 * world.mjs — 世界常量。单位：米。改数值，不改结构（references/12 世界常量模板）。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.WORLD = {
  units: "meters",
  seed: 4207,
  bounds: { minX: -40, maxX: 40, minZ: -40, maxZ: 40 },
  groundY: 0,
  seaY: -1.2,
  sun: { dir: [0.916, 0.225, 0.331], color: 0xffd9a8, intensity: 3.2 },
  fog: { color: 0x232c36, density: 0.006 },
  camera: { fov: 74, near: 0.08, far: 900 },
  weaponCamera: { fov: 54, near: 0.01, far: 10 },
  quality: {
    low:    { name: "low",    scale: 0.70, shadow: 1024, tex: 512,  volSteps: 12, planar: 0.0 },
    medium: { name: "medium", scale: 0.85, shadow: 2048, tex: 1024, volSteps: 16, planar: 0.5 },
    high:   { name: "high",   scale: 1.00, shadow: 4096, tex: 2048, volSteps: 24, planar: 1.0 },
  },
};

H2B.seededRng = function seededRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
`;

const MATS_MJS = `/**
 * mats.mjs — 材质层接线：SL 纹理工厂 + SL 表面材质工厂。
 * TODO(S4)：接 PCSS chunk 手术（assets/pcss-shadow.glsl → GLSL_PCSS），标定 SL_FRUSTUM/SL_DEPTH。
 * TODO(S4)：单调材质超过 3 个即说明目录没用起来——改走 surface.get(name)。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.createMats = function createMats(THREE, renderer, scene, opts = {}) {
  const texFactory = createTextureFactory(THREE, renderer, { tex: opts.tex || 512 });
  const surface = createSurfaceMaterialFactory(THREE, texFactory, { wet: 1 });
  return {
    texFactory,
    surface,
    catalog: surface.names,
    prewarm(names) { surface.prewarm(names); },
    update() { surface.update(); },
  };
};
`;

const GROUND_MJS = `/**
 * ground.mjs — 地面：先做一层 SL 表面（湿痕/ORM/macro），再按需要加积水与反射。
 * TODO(S6)：接 assets/ssr-wet.glsl（GLSL_SSR_WET）做水洼权重与反射混合。
 * TODO：planar 反射前置 pass 未接（见 examples/quality/src/ground.mjs）。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.createGround = function createGround(THREE, scene, mats, world) {
  const size = world.bounds.maxX - world.bounds.minX;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size, 1, 1).rotateX(-Math.PI / 2),
    mats.surface.get("asphalt", { triplanar: true })
  );
  mesh.receiveShadow = true;
  mesh.name = "h2b-ground";
  scene.add(mesh);
  return { mesh, layers: 1, puddles: 0 };
};
`;

const CONTENT_MJS = `/**
 * content.mjs — 内容层：道具与剪影。先用 InstancedMesh 摆重复单元，再逐件加细节。
 * TODO(S3)：换成 assets/props-kit.mjs 的道具目录（35 类 + 17 builder），并走手写布局。
 * TODO(S3)：合并后重算法线；draw call 不随实例数线性增长。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.buildContent = function buildContent(THREE, scene, mats, world, rng) {
  const group = new THREE.Group();
  group.name = "h2b-content";
  scene.add(group);

  const geo = new THREE.BoxGeometry(6.06, 2.59, 2.44);
  const mat = mats.surface.get("paint_red", { triplanar: true });
  const count = 24;
  const inst = new THREE.InstancedMesh(geo, mat, count);
  inst.name = "h2b-containers";
  inst.castShadow = true;
  inst.receiveShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i += 1) {
    const row = i % 6;
    const col = Math.floor(i / 6);
    p.set(-15 + row * 6.4, 1.3, -12 + col * 8);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (row % 2) * 0.06);
    m.compose(p, q, s);
    inst.setMatrixAt(i, m);
  }
  inst.instanceMatrix.needsUpdate = true;
  group.add(inst);

  const marks = 0;
  return {
    group,
    stats: { propKinds: 1, placedProps: count, decalTypes: marks },
  };
};
`;

const LAYOUT_MJS = `/**
 * layout.mjs — 手写布局：目录 + 放置表。布局不随机（references/03 道具解剖）。
 * TODO(S7)：替换成真实分区与点位（zones/spawns/covers/objectives），
 *           validateLayout 会对账每个道具的零件数。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.CATALOG = {
  crate: { size: [1.2, 1.2, 1.2], material: "crate", parts: 6, surface: "wood" },
  barrier: { size: [2.4, 1.0, 0.4], material: "barrier", parts: 8, surface: "metal" },
  container: { size: [6.06, 2.59, 2.44], material: "container", parts: 24, surface: "metal" },
};

H2B.LAYOUT = {
  items: [
    { prop: "container", at: [-8, 0, -6], rot: [0, 0, 0], parts: 24, tag: "cover-north" },
    { prop: "container", at: [9, 0, 4], rot: [0, Math.PI / 2, 0], parts: 24, tag: "cover-east" },
    { prop: "crate", at: [-2, 0, 3] },
    { prop: "crate", at: [-2, 1.2, 3] },
    { prop: "barrier", at: [5, 0, 6], rot: [0, 1.2, 0] },
  ],
  meta: {
    playerStart: { pos: { x: 0, y: 0, z: 14 }, yaw: Math.PI },
    enemySpawns: [
      { pos: { x: -6, y: 0, z: -12 } },
      { pos: { x: 6, y: 0, z: -14 } },
    ],
    extraction: { pos: { x: 0, y: 0, z: 16 }, radius: 2 },
  },
};
`;

const BOTS_MJS = `/**
 * bots.mjs — 敌人：先接 combat-kit 的状态机与令牌，再把外观换成 enemy-kit 的骨骼。
 * TODO(S7)：替换成 assets/enemy-kit.mjs 的 rig（骨骼表 + 2 骨 IK + 步态）；
 *           感知/令牌不要重写，用 kit.createAgent / kit.updatePerception。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.createBots = function createBots(THREE, { scene, kit, spawns, player, rng }) {
  const bots = [];
  for (let i = 0; i < spawns.length; i += 1) {
    const spawn = spawns[i];
    const mesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.34, 1.0, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0x9aa4ae, roughness: 0.7 })
    );
    mesh.position.set(spawn.pos.x, 0.9, spawn.pos.z);
    mesh.castShadow = true;
    scene.add(mesh);
    const agent = kit.createAgent({ id: "bot-" + i, type: "hound", pos: { ...spawn.pos }, hp: 60 });
    bots.push({ mesh, agent, alive: true, type: "hound", pos: { ...spawn.pos } });
  }
  return bots;
};

H2B.stepBots = function stepBots({ kit, physics, nav, player, rng, frozen }, bots, dt) {
  if (frozen) return;
  for (const bot of bots) {
    if (!bot.alive) continue;
    // combat-kit 的 updatePerception 是「单 agent + 目标」，不是数组
    kit.updatePerception(bot.agent, player, dt);
    bot.pos.x = bot.agent.pos.x;
    bot.pos.z = bot.agent.pos.z;
    bot.mesh.position.set(bot.pos.x, 0.9, bot.pos.z);
  }
};
`;

const GAME_MJS = `/**
 * game.mjs — 玩法装配：physics-kit + level-kit + combat-kit + bots。
 * 三个 kit 的职责边界见 references/10-gameplay-chain.md；不要在这里重写 AI/令牌。
 * TODO(S7)：把 layout 换成真实四区；把 bots 换成 assets/enemy-kit.mjs 的骨骼 rig；
 *           接玩家控制器（assets/player-kit.mjs）与武器（assets/weapon-kit.mjs）。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.initGameplay = function initGameplay({ THREE, scene, world, rng, player }) {
  const physics = PhysicsKit.createPhysicsKit({
    bounds: world.bounds,
    region: { x: world.bounds.maxX - world.bounds.minX, z: world.bounds.maxZ - world.bounds.minZ },
    groundSurfaceAt: () => "concrete",
    rng,
  });
  const materials = {
    crate: new THREE.MeshStandardMaterial({ color: 0xc09055, roughness: 0.85 }),
    barrier: new THREE.MeshStandardMaterial({ color: 0xd8dce0, roughness: 0.45, metalness: 0.6 }),
    container: new THREE.MeshStandardMaterial({ color: 0xb04a38, roughness: 0.7, metalness: 0.25 }),
  };
  const level = LevelKit.createLevelKit(THREE, { catalog: H2B.CATALOG, layout: H2B.LAYOUT, physics, materials });
  scene.add(level.group);
  physics.build();

  const events = { log: [], on() {}, emit(type, payload) { this.log.push({ type, payload }); if (this.log.length > 200) this.log.shift(); } };
  const kit = CombatKit.createCombatKit({ physics, events, rng });
  const bots = H2B.createBots(THREE, { scene, kit, spawns: level.enemySpawns, player, rng });

  return {
    physics, level, kit, bots, events,
    update(dt) {
      H2B.stepBots({ kit, physics, nav: physics.nav, player, rng, frozen: false }, bots, dt);
    },
    counts() {
      return {
        enemyTypes: new Set(bots.map((b) => b.type)).size,
        enemySpawns: (level.enemySpawns || []).length,
        coverPoints: (level.coverPoints || []).length,
        zones: (level.zones || []).length,
        objectives: (level.objectives || []).length,
      };
    },
  };
};
`;

const INSPECT_MJS = `/**
 * inspect.mjs — 九展厅注册表：每个可感知子系统一个可进入、可拍照的展台。
 * 现在九厅都指向同一个小场景的机位；补内容时把对应 setup 换成真实展台。
 * 协议见 references/08-self-inspection.md；框架见 assets/inspect-deck.mjs。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.createInspectGalleries = function createInspectGalleries(ctx) {
  const { THREE, scene, content, ground } = ctx;
  const focus = new THREE.Box3().setFromObject(content.group).getCenter(new THREE.Vector3());
  const gallery = (cam, target) => ({ cam, target });
  return {
    mats: gallery([focus.x + 6, 3, focus.z + 10], [focus.x, 2, focus.z]),
    props: gallery([focus.x, 4.5, focus.z + 16], [focus.x, 2, focus.z]),
    enemies: gallery([focus.x + 8, 3.2, focus.z - 4], [focus.x, 1.4, focus.z - 12]),
    weapon: gallery([0, 1.7, 16], [0, 1.5, 10]),
    fx: gallery([0, 2.2, 14], [0, 1.2, 6]),
    render: gallery([-18, 4.2, -18], [focus.x, 3, focus.z]),
    ground: gallery([0, 1.6, 12], [0, 0.2, 4]),
    backdrop: gallery([0, 9, 34], [0, 5, 0]),
    level: gallery([0, 42, 44], [0, 0, 0]),
  };
};
`;

const SCENE_MJS = `/**
 * scene.mjs — boot：渲染器 / 相机 / 灯光 / 检查协议。装配顺序见 references/12。
 * 顺序：world → mats → ground → content → (layout/bots) → inspect → 协议 → loop
 * TODO(S9)：把 HUD 从一行文字换成 assets/hud-kit.mjs；把 __PARITY__ 计数换成实测值。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.bootScene = function bootScene() {
  const world = H2B.WORLD;
  const params = new URLSearchParams(location.search);
  const seed = Number(params.get("seed") || world.seed);
  const bench = params.has("bench");
  const quality = world.quality[params.get("q") || "low"] || world.quality.low;

  window.__errors = window.__errors || [];
  window.addEventListener("error", (e) => window.__errors.push(String(e.message)));

  const canvas = document.getElementById("view");
  const hud = document.getElementById("hud");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(world.fog.color);
  scene.fog = new THREE.FogExp2(world.fog.color, world.fog.density);

  const camera = new THREE.PerspectiveCamera(
    world.camera.fov,
    window.innerWidth / window.innerHeight,
    world.camera.near,
    world.camera.far
  );
  camera.position.set(0, 8, 34);
  camera.lookAt(0, 2, 0);

  const hemi = new THREE.HemisphereLight(0x8fa3b8, 0x2a2620, 0.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(world.sun.color, world.sun.intensity);
  sun.position.set(world.sun.dir[0] * 40, world.sun.dir[1] * 40, world.sun.dir[2] * 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality.shadow, quality.shadow);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  scene.add(sun);

  const rng = H2B.seededRng(seed);
  const mats = H2B.createMats(THREE, renderer, scene, { tex: quality.tex });
  mats.prewarm(["asphalt", "paint_red", "steel_dark", "concrete"]);
  const ground = H2B.createGround(THREE, scene, mats, world);
  const content = H2B.buildContent(THREE, scene, mats, world, rng);

  /* ---- 玩法装配（仅 game / full 档存在 game.mjs 时）---- */
  const player = { pos: { x: 0, y: 0, z: 14 }, vel: { x: 0, y: 0, z: 0 }, alive: true };
  const game = typeof H2B.initGameplay === "function"
    ? H2B.initGameplay({ THREE, scene, world, rng, player })
    : null;
  const gameCounts = game && typeof game.counts === "function" ? game.counts() : {};

  /* ---- 九展厅 ---- */
  const inspectMode = InspectDeck.readInspectMode(location.search);
  const deck = InspectDeck.createInspectDeck({
    galleries: H2B.createInspectGalleries({ THREE, scene, content, ground, renderer, camera }),
  });
  const showcase = deck.boot({ camera, render: renderer, scene }, inspectMode);
  if (inspectMode.show && !showcase) console.warn("[inspect] unknown gallery: " + inspectMode.show);

  /* ---- 检视协议 ---- */
  const time = { t: 0, frame: 0 };
  let fpsShown = 0, fpsAcc = 0, fpsFrames = 0, lastNow = performance.now();
  window.__G = {
    seed, params: Object.fromEntries(params), time, quality,
    showcase: showcase ? showcase.name : null,
    renderer, scene, camera, world,
  };
  window.__stats = () => {
    const info = renderer.info;
    return {
      calls: info.render.calls, tris: info.render.triangles, geos: info.memory.geometries,
      tex: info.memory.textures, programs: info.programs ? info.programs.length : 0,
      frame: time.frame, fps: fpsShown, quality: quality.name,
    };
  };
  window.debugCut = () => window.__stats();

  /* ---- 元素对账：先全 0，模型按 complete.mjs 的红点逐条填实测值 ---- */
  window.__PARITY__ = {
    version: 1,
    counts: {
      propKinds: content.stats.propKinds,
      placedProps: content.stats.placedProps,
      decalTypes: content.stats.decalTypes,
      placedDecals: 0,
      materialCount: mats.catalog.length,
      textureSets: typeof SL_TEX_SETS !== "undefined" ? Object.keys(SL_TEX_SETS).length : 0,
      skyPasses: 0,
      seaSurfaces: 0,
      groundLayers: ground.layers,
      puddlePatches: ground.puddles,
      rainStreaks: 0,
      thunderEvents: 0,
      postPasses: 1,
      bloomLevels: 0,
      shadowMaps: sun.castShadow ? 1 : 0,
      shadowTaps: 0,
      enemyTypes: 0,
      enemySpawns: 0,
      enemyRigs: 0,
      weaponMeshes: 0,
      weaponChannels: 0,
      fxKinds: 0,
      fxPools: 0,
      soundSpecs: 0,
      musicParts: 0,
      audioBuses: 0,
      hudComponents: 0,
      hudTokens: 0,
      zones: 0,
      coverPoints: 0,
      objectives: 0,
      objectivesWired: 0,
      waves: 0,
      galleriesUsed: Object.keys(deck.galleries).length,
      ...gameCounts,
    },
    source: { scene: "TODO", measuredAt: new Date().toISOString() },
  };

  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  function loop(now) {
    requestAnimationFrame(loop);
    let dt = (now - lastNow) / 1000;
    lastNow = now;
    if (dt < 0) dt = 0;
    if (dt > 0.1) dt = 0.1;
    fpsAcc += dt; fpsFrames += 1;
    if (fpsAcc >= 0.5) { fpsShown = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }
    time.t += bench ? 1 / 60 : dt;
    time.frame += 1;
    mats.update();
    if (game) game.update(bench ? 1 / 60 : dt);
    if (showcase && typeof showcase.update === "function") showcase.update(time.t);
    renderer.info.reset();
    renderer.render(scene, camera);
    hud.textContent = "h2b " + document.title + " · " + fpsShown + " fps · "
      + renderer.info.render.calls + " draws · " + (renderer.info.render.triangles / 1000).toFixed(0) + "k tris · q=" + quality.name;
  }
  requestAnimationFrame(loop);
};
`;

function readme(name, tier, sceneRel) {
  return `# ${sceneRel} — TODO：一句话场景意图

## 场景意图

TODO：一句话写清「这是什么地方、什么时刻、什么天气」，再写三条美术决定
（至少一条是观感决定：材质分层 / 光照分层 / 后处理目标）。
R0 参考研究见 \`references/05-reference-research.md\`；观感配方见 \`references/07-perceptual-quality.md\`。
场景申报骨架见本目录 \`R0.md\`：五节填实前 \`node harness/gates/r0.mjs --scene <场景目录>\` 逐条判红。

## 参数表

| 参数 | 值 | 说明 |
| --- | --- | --- |
| seed | 4207 | 进 URL，确定性重建 |
| tier | ${tier} | 元素对账档位（visual / game / full） |
| 机位 | 主相机 fov 74 / 武器相机 54 | \`references/01\` 的玩家口径 |
| 输出 | \`build/${name}/index.html\` | 单文件，three r180 内联，零运行时请求 |
| 世界尺度 | 80×80 m（bounds 见 \`src/world.mjs\`） | 改数值前先读 \`references/12\` |

## 方法论

1. **预算先于内容**（铁律 #1）：先写死 draw call / 三角形 / 像素三张上限，再往里塞元素。
2. **资产先于重写**（铁律 #2）：先查 \`assets/index.md\`，能消费就不重写。
3. **元素对账**（\`references/11\`）：逐族 \`used\`/\`n/a\`，used 必须给实测计数；\`complete.mjs\` 判红。
4. **自检闭环**（\`references/08\`）：每完成一块 → 进展厅 → 拍照 → 看 → 改。

## 验收

\`\`\`bash
node "${sceneRel}/build.mjs" --assert
node harness/render/scene.mjs --scene "${sceneRel}" --assert
node harness/gates/inspect.mjs  --scene "${sceneRel}"   # 九厅三张证据
node harness/gates/complete.mjs --scene "${sceneRel}"   # 元素对账
node harness/gates/perf.mjs     --scene "${sceneRel}" --floors --assert
\`\`\`
`;
}

/**
 * R0 场景申报骨架：五节结构齐全（来源 / 覆盖矩阵 / 16 类要素决策 / GAP / 参考对拍），
 * 内容全是 TODO 占位——这就是「红色起点」。
 * `node harness/gates/r0.mjs --scene <sceneRel>` 会逐条判红；判定口径与 16 类清单见
 * references/05-reference-research.md，要素类名取自 r0.mjs 的 canonical 表（不另写一份）。
 */
export function r0Markdown(name, sceneRel = `examples/${name}`) {
  const matrixHeader = ["视角 / 条件", ...GALLERIES].join(" | ");
  const matrixRule = ["---", ...GALLERIES.map(() => "---")].join(" | ");
  const matrixRow = (axis) => `| ${axis} | ${GALLERIES.map(() => "待补").join(" | ")} |`;
  const elementRows = Array.from(
    { length: ELEMENT_CLASSES.length },
    (_, i) => `| ${i + 1} | ${ELEMENT_CLASSES[i]} | TODO | TODO | TODO |`
  );
  return `# R0 · ${name}（场景申报骨架）

> 本文件由 \`scripts/scaffold-scene.mjs\` 生成：**TODO 是红色起点**。
> \`node harness/gates/r0.mjs --scene ${sceneRel}\` 会逐条判红，照着红点把五节填实：
> 来源 ≥3、覆盖矩阵每格「已满足/待补」、16 类逐类决策、GAP 参数去向、参考对拍 ≥3 条 delta。
> 判定口径与 16 类要素清单见 \`references/05-reference-research.md\`。

## 来源（多参考，≥3）

| # | 渠道 | 来源 | 观察 |
| --- | --- | --- | --- |
| S1 | TODO：渠道（方法论 / 资产 / 原作 / 许可） | TODO：文件或链接 | TODO：拿到的硬数据或观察 |
| S2 | TODO：渠道 | TODO：文件或链接 | TODO：观察 |
| S3 | TODO：渠道 | TODO：文件或链接 | TODO：观察 |

## 覆盖矩阵（俯视 / 平视 / 夜景 / 湿天 × 九展厅）

展厅列取 \`inspect.manifest.json\` 里真正 used 的展厅；每格只允许「已满足」或「待补」，
「待补」是合法状态（缺参考图的方向），空格会被判红。

| ${matrixHeader} |
| ${matrixRule} |
${matrixRow("俯视")}
${matrixRow("平视")}
${matrixRow("夜景")}
${matrixRow("湿天")}

## 16 类要素决策（1..16 逐类：决策 / 是否入景 / 参数去向）

「明确不做」也算决策；参数去向必须落到真实文件与字段，不能写「待定」。

| # | 要素类 | 决策 | 是否入景 | 参数去向 |
| --- | --- | --- | --- | --- |
${elementRows.join("\n")}

## GAP

| 要素 | 参考值 | 当前值 | GAP | 修正动作 | 参数去向 |
| --- | --- | --- | --- | --- | --- |
| TODO：要素类 | TODO：参考里的数值或做法 | TODO：当前实现 | TODO：差在哪 | TODO：改哪个文件/参数 | TODO：落到真实字段 |

## 参考对拍（≥3 条 delta）

| # | 对拍组 | 参考观察 | delta | 去向 |
| --- | --- | --- | --- | --- |
| D1 | TODO | TODO | TODO | TODO |
| D2 | TODO | TODO | TODO | TODO |
| D3 | TODO | TODO | TODO | TODO |
`;
}

/** 导出为纯函数：consistency.mjs 直接调用输出判等，无需生成临时场景或 grep 源码。 */
export function inspectManifest() {
  const galleries = {};
  for (const id of GALLERIES) {
    galleries[id] = { state: "n/a", reason: "" };
  }
  return `${JSON.stringify({
    $comment: "九展厅清单。把真正做出来的展厅改成 used；n/a 必须写理由（complete.mjs 会拒绝空理由/占位文本）。",
    version: 1,
    galleries,
  }, null, 2)}\n`;
}

export function elementsManifest(name, tier, sceneRel = `examples/${name}`) {
  const elements = {};
  for (const id of ELEMENT_IDS) elements[id] = { state: "n/a", reason: "", evidence: "" };
  return `${JSON.stringify({
    $comment: "元素对账申报：逐族 used / n-a。空理由与空证据会被 complete.mjs 判红——这就是 TODO 清单。",
    version: 1,
    scene: sceneRel,
    tier,
    elements,
  }, null, 2)}\n`;
}

/**
 * 八系统消费清单模板。不用 TODO 占位：N/A 必须写清「骨架为什么还没接入 + 接入后怎么改」，
 * 否则 assets 门禁虽然接受 N/A，读的人却不知道下一步接什么。
 * sl-surface / sl-textures 是骨架真正在消费的（mats.mjs 调 createSurfaceMaterialFactory /
 * createTextureFactory，build.mjs 用 readAsset 原样读入资产），所以从 used 起步；其余六个 pass
 * 只被 build.mjs 内联、场景尚未接线，写具体 N/A 理由，接入后改 used 并保留 marker/readAsset 证据。
 */
const SYSTEM_NA_REASONS = {
  "post-chain": "骨架未接入后处理链（scene.mjs 直接 renderer.render，没有 pass 链）",
  "post-aa": "骨架未接入 AA pass（antialias:false 之后没有 FXAA pass）",
  "pcss-shadow": "骨架未接入 PCSS（shadowMap 仍是 PCFSoftShadowMap）",
  "ssr-wet": "骨架未接入湿地反射（ground.mjs 只有一层 SL 表面，puddles: 0）",
  shafts: "骨架未接入体积光（VOL_STEPS 未进入灯光/后处理参数）",
  "sky-deck": "骨架未接入天空（scene.background 仍是纯色 + FogExp2）",
};

export function consumptionManifest() {
  const declared = {};
  for (const id of SYSTEMS) {
    declared[id] = id === "sl-surface" || id === "sl-textures"
      ? "used"
      : `N/A: ${SYSTEM_NA_REASONS[id]}；接入后改 used 并保留 marker/readAsset 证据`;
  }
  return `${JSON.stringify({
    $comment: "资产消费清单：八系统逐项 used / \"N/A: 理由\"。harness/gates/assets.mjs 读取 systems 字段；声明 used 仍须 marker 命中或原样引用资产文件作为证据。",
    version: 1,
    systems: declared,
  }, null, 2)}\n`;
}

// ---------------------------------------------------------------- self-test

/**
 * 离线自检（不依赖 examples，不写仓库）：
 *   1. 模板 R0.md 是「五节结构齐全、内容全 TODO」的红色起点——用 r0.mjs 的 canonical
 *      场景校验证明，并把它写成真实 R0.md 走一遍场景定位（与 CLI 同一条路径）；
 *   2. 模板 consumption 八系统齐全、无 TODO/TBD，N/A 都带具体理由；
 *   3. 未知参数退出 2；
 *   4. --check 只打印 would write、不落盘。
 */
function selfTest() {
  const failures = [];
  const expect = (condition, label) => {
    if (!condition) failures.push(label);
  };
  const script = fileURLToPath(import.meta.url);

  // 1) R0 模板：结构齐全，红色只来自 TODO 占位
  const r0 = r0Markdown("self-test-scene", "examples/self-test-scene");
  const r0Report = validateSceneR0(r0);
  expect(r0.includes("TODO"), "R0 模板没有 TODO 占位（TODO 模板负例不成立）");
  expect(r0Report.problems.length > 0, `R0 模板未被 r0 场景校验判红（problems=${JSON.stringify(r0Report.problems)}）`);
  expect(
    r0Report.problems.every((problem) => /^(PLACEHOLDER|GAP):/.test(problem)),
    `R0 模板的红色应只来自 TODO 占位，实际: ${JSON.stringify(r0Report.problems.slice(0, 5))}`
  );
  expect(
    r0Report.stats.sources === 3
      && r0Report.stats.elements === 16
      && r0Report.stats.gaps === 1
      && r0Report.stats.deltas === 3,
    `R0 模板五节结构不完整（sources/elements/gaps/deltas = ${JSON.stringify(r0Report.stats)}）`
  );

  // 1b) 场景定位：模板写成 <scene>/R0.md 后，r0.mjs 的 CLI 路径同样判红
  const tmp = mkdtempSync(path.join(tmpdir(), "h2b-scaffold-selftest-"));
  try {
    writeFileSync(path.join(tmp, "R0.md"), r0);
    const sceneReport = checkR0Scene(tmp, { root: tmp });
    expect(!sceneReport.ok, "模板 R0.md 写成场景产物后未被 r0 场景定位 + 校验判红");
    expect(sceneReport.artifact === "R0.md", `模板 R0.md 未被场景定位器选中（${sceneReport.artifact}）`);
    expect(
      sceneReport.problems.length === r0Report.problems.length,
      `场景定位路径的 problems 与文档校验不一致（${sceneReport.problems.length} vs ${r0Report.problems.length}）`
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // 2) consumption 模板：八系统齐全、无 TODO、N/A 带具体理由
  const consumption = consumptionManifest();
  expect(!/TODO|TBD/.test(consumption), "consumption 模板仍含 TODO/TBD 占位");
  let parsed = null;
  try {
    parsed = JSON.parse(consumption);
  } catch (error) {
    failures.push(`consumption 模板不是合法 JSON: ${error.message}`);
  }
  if (parsed && parsed.systems) {
    const keys = Object.keys(parsed.systems);
    expect(
      keys.length === SYSTEMS.length && SYSTEMS.every((id) => keys.includes(id)),
      `consumption 模板 systems 键集 != constants.SYSTEMS（${keys.join(", ")}）`
    );
    for (const id of SYSTEMS) {
      const value = parsed.systems[id];
      const ok = value === "used" || (typeof value === "string" && /^N\/A: \S.{8,}/.test(value));
      expect(ok, `consumption 模板 ${id} 既不是 used 也不是带具体理由的 N/A（${JSON.stringify(value)}）`);
    }
  } else if (parsed) {
    failures.push("consumption 模板缺 systems 字段");
  }

  // 3) 未知参数退出 2
  const unknown = spawnSync(process.execPath, [script, "--bogus"], { cwd: ROOT, encoding: "utf8" });
  expect(unknown.status === 2, `未知参数未退出 2（实际 ${unknown.status}）`);

  // 4) --check 不写盘（目标目录不存在时只打印 would write）
  const probeName = `scaffold-selftest-${process.pid}-${Date.now()}`;
  const probeDir = path.join(ROOT, "build", probeName);
  try {
    const check = spawnSync(
      process.execPath,
      [script, "--name", probeName, "--tier", "full", "--dir", "build", "--check"],
      { cwd: ROOT, encoding: "utf8" }
    );
    expect(check.status === 0, `--check 退出 ${check.status}（stderr: ${(check.stderr || "").trim()}）`);
    expect(
      (check.stdout || "").includes(path.join("build", probeName, "R0.md")),
      `--check 的 would write 清单里没有 R0.md: ${(check.stdout || "").trim()}`
    );
    expect(!existsSync(probeDir), `--check 落盘了 ${path.relative(ROOT, probeDir)}`);
  } finally {
    if (existsSync(probeDir)) rmSync(probeDir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error("scaffold --self-test FAILED:");
    for (const failure of failures) console.error(`  - ${failure}`);
    return 1;
  }
  console.log(
    "scaffold --self-test OK: R0 模板（五节结构齐 / TODO 判红 + 场景定位）"
    + " + consumption 模板（八系统 / 无 TODO）"
    + " + 未知参数退出 2 + --check 不写盘"
  );
  return 0;
}

// ---------------------------------------------------------------- main

function main(argv) {
  if (argv.includes("--self-test")) {
    if (argv.length > 1) {
      console.error("scaffold: --self-test 不接受其它参数");
      return 2;
    }
    return selfTest();
  }
  const args = parseArgs(argv);
  if (!args.name || !NAME_RE.test(args.name)) {
    console.error("scaffold: --name 必须是小写 kebab-case（示例：night-yard）");
    return 2;
  }
  if (!TIERS.includes(args.tier)) {
    console.error(`scaffold: --tier 必须是 ${TIERS.join(" / ")}`);
    return 2;
  }
  if (path.isAbsolute(args.dir) || args.dir.split(/[\\/]/).some(part => part && part !== "." && !/^[\p{L}\p{N}_-][\p{L}\p{N} ._-]*$/u.test(part))) {
    console.error("scaffold: --dir must be a relative directory inside the project");
    return 2;
  }
  const sceneRel = path.join(args.dir, args.name);
  const sceneDir = path.join(ROOT, sceneRel);
  const files = {
    "build.mjs": buildScript(args.name, args.tier, sceneRel),
    "README.md": readme(args.name, args.tier, sceneRel),
    "R0.md": r0Markdown(args.name, sceneRel),
    "inspect.manifest.json": inspectManifest(),
    "scene.elements.json": elementsManifest(args.name, args.tier, sceneRel),
    "assets.consumption.json": consumptionManifest(),
    "src/world.mjs": WORLD_MJS,
    "src/mats.mjs": MATS_MJS,
    "src/ground.mjs": GROUND_MJS,
    "src/content.mjs": CONTENT_MJS,
    ...(args.tier !== "visual" ? { "src/layout.mjs": LAYOUT_MJS, "src/bots.mjs": BOTS_MJS, "src/game.mjs": GAME_MJS } : {}),
    "src/inspect.mjs": INSPECT_MJS,
    "src/scene.mjs": SCENE_MJS,
  };

  console.log(`scaffold: ${sceneRel} (tier=${args.tier}, ${Object.keys(files).length} files)`);
  for (const rel of Object.keys(files)) {
    const parts = path.join(sceneRel, rel).split(path.sep);
    let current = ROOT;
    for (const [index, part] of parts.entries()) {
      current = path.join(current, part);
      const entry = lstatSync(current, { throwIfNoEntry: false });
      if (!entry) break;
      if (index === parts.length - 1 ? !entry.isFile() : !entry.isDirectory()) {
        console.error(`scaffold: refusing unexpected file type: ${current}`);
        return 1;
      }
    }
  }
  if (args.check) {
    if (existsSync(sceneDir) && !args.force) {
      console.error(`scaffold: ${sceneRel} 已存在（用 --force 覆盖）`);
      return 1;
    }
    for (const rel of Object.keys(files)) console.log(`  would write ${path.join(sceneRel, rel)}`);
    return 0;
  }
  if (existsSync(sceneDir) && !args.force) {
    console.error(`scaffold: ${sceneRel} 已存在（用 --force 覆盖）`);
    return 1;
  }
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(sceneDir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    console.log(`  wrote ${path.relative(ROOT, abs)}`);
  }

  if (args.verify) {
    const run = (file, fileArgs) => {
      console.log(`\nverify: node ${file} ${fileArgs.join(" ")}`);
      execFileSync(process.execPath, [path.join(ROOT, file), ...fileArgs], { cwd: ROOT, stdio: "inherit" });
    };
    run(path.join(sceneRel, "build.mjs"), ["--assert"]);
    run("harness/render/scene.mjs", ["--scene", sceneRel, "--assert"]);
  }

  console.log(`\nscaffold: 骨架已就绪。下一步（照红点补，不要重写结构）：`);
  console.log(`  1. node harness/gates/r0.mjs --scene ${sceneRel}                          # R0 申报红点`);
  console.log(`  2. node harness/gates/complete.mjs --scene ${sceneRel} --structure-only   # 元素对账缺口`);
  console.log(`  3. 按 references/12 的装配顺序逐段补；每补一块 → inspect 拍照 → 改`);
  console.log(`  4. node harness/gates/inspect.mjs --scene ${sceneRel} && node harness/gates/complete.mjs --scene ${sceneRel}`);
  return 0;
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error("scaffold-scene crashed:", error && error.message ? error.message : error);
    process.exit(1);
  }
}
