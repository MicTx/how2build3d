/**
 * weapon-kit.mjs — 第一人称武器：手写 2D 型材挤出视图模型 + 9 通道弹簧阻尼 + 后坐分离 + 换弹状态机。
 *
 * 出处（upstream sources/jimao-3a-game/index.html，6215 行；行号按 prettify 产物的 [src:pretty] 规则）：
 *   - 视图模型：49 段导轨槽（`qo` 逐段挤在 -.094 + i*.01，深 .0048）、4 个材质槽
 *     （pac9_anodised / pac9_phosphate / pac9_polymer / pac9_matte）、muzzle [0,0,-.531] /
 *     eject [.023,.004,-.028] 锚点、瞄准窗 6 点多边形（sightY .069 / lensF .0285）、
 *     弹匣位 [0,-.02,-.0665]、boltTravel .062、squeeze .86： [src:pretty:L54827-L54870]
 *   - 手感：9 通道弹簧（kZ 520/30、kP 380/26、kY 300/22、kR 300/20、swY/swP 110/15、
 *     jY/jP 140/13、bump 600/30）、子步进半隐式欧拉（>12ms 拆 ≤8ms 子步）、
 *     hip/ADS/sprint/reload 四组锚点、ADS fov 52 / 枪相机 54° / 世界 74°、
 *     后坐分离 recoilKeep .35 / apply 34 / recover 6.5 / hold .09、
 *     换弹时间线 战术 2.1s / 空仓 2.72s（magout .47 / magin 1.345 / tap 1.5 / bolt 2.14）： [src:pretty:L55096-L55120]
 *
 * 设计约定（与 assets/combat-kit.mjs、assets/fx-kit.mjs、assets/sl-surface.mjs 一致）：
 *   1. three 作为第 1 个参数注入，**不顶层 import**；无 three 时工厂照常工作（型材表/弹簧/
 *      状态机/瞄准/锚点变换全在纯 CPU 上跑，只是不建 mesh），node 可直接 selfTest()。
 *   2. rng 注入（默认定种 mulberry32，**kit 内零 Math.random**）；每次射击的散布锥、后坐抖动、
 *      jerk 走向都取同一路 rng，逐次可复现。
 *   3. 热循环零分配：`update(dt, input)` 只写预分配的 spring/pose/cam 字段，不 new 对象、
 *      不拼字符串；只读调用方传入的 input。离散事件（fire/dry/reload 相位）才建小负载对象。
 *   4. 后坐分离是**相机与弹道同源**：瞄准角只吃 35%（recoilKeep），其余 65% 进视觉偏移
 *      （±.3/±.2 夹紧，hold 后按 6.5 衰减）；弹道方向由「瞄准角 + 视觉偏移 + 抖动」的相机
 *      姿态算，所以准星永远指向弹着方向，不会出现「准星和画面对不上」。
 *   5. 2D 型材是参数化近似，不是上游逐零件复刻：滑套（上下机匣剖面）、49 段导轨槽、导轨基座、
 *      护木（八边形剖面）、瞄具壳体 + 瞄准窗（带孔洞）、枪管/消焰器、枪机、拉机柄、枪托、
 *      握把、扳机护圈、抛壳口盖板、弹匣、镜片 = 15 个零件描述（63 个实心体）。
 *
 * stats() 口径（对账门禁 harness/element-manifest.json → weapon）：
 *   - weaponMeshes：three 路径 = 真实 mesh 数（按材质槽合并成 4 + 镜片 = 5，draw call 预算 5）；
 *     CPU 路径 = 型材实心体数（63，等价网格槽位），`meshMode` 字段标明走的是哪条路。
 *   - weaponChannels：弹簧通道数（9）。
 *   - 另有 railSlots(49) / materialSlots(4) / weaponParts(15) / weaponSolids(63) / tris。
 *
 * 用法：
 *   const weapon = createWeaponKit(THREE, { rng, events, camera, materials, tune });
 *   camera.add(weapon.root);
 *   // 每帧
 *   weapon.update(dt, { fire, ads, reload, sprint, crouch, moveX, moveY, speed, onGround, vy, lookDx, lookDy });
 *   weapon.root.position.set(weapon.pose.x, weapon.pose.y, weapon.pose.z);
 *   weapon.root.rotation.set(weapon.pose.rx, weapon.pose.ry, weapon.pose.rz, "YXZ");
 *   weapon.applyCamera(camera);                     // 相机 fov + 后坐/抖动姿态
 *   weapon.muzzleWorld(v, camera);                  // 交给 fx-kit.tracer / muzzleFlash
 *   weapon.shellTransform(s, camera, playerVel);    // 交给 fx-kit.shell
 */

const TAU = Math.PI * 2;

/* ============================== 常量（上游同名口径） ============================== */

/** PAC-9 视图模型锚点与几何常数（upstream `mi` 表）。 */
export const WEAPON_ANCHORS = Object.freeze({
  name: "PAC-9", // 上游 几猫九式突击步枪
  muzzle: Object.freeze([0, 0, -0.531]),
  eject: Object.freeze([0.023, 0.004, -0.028]),
  sightY: 0.069,
  lensF: 0.0285,
  window: Object.freeze([
    Object.freeze([-0.016, 0.057]),
    Object.freeze([0.016, 0.057]),
    Object.freeze([0.016, 0.0772]),
    Object.freeze([0.0122, 0.081]),
    Object.freeze([-0.0122, 0.081]),
    Object.freeze([-0.016, 0.0772]),
  ]),
  magPos: Object.freeze([0, -0.02, -0.0665]),
  boltTravel: 0.062,
  railTop: 0.0435,
  grip: Object.freeze([0, -0.1, 0.073]),
  handguard: Object.freeze([0, 0, -0.255]),
  handguardR: 0.021,
  handlePos: Object.freeze([-0.026, 0.007, -0.078]),
  squeeze: 0.86,
  boreY: 0.006,
});

/** 9 通道弹簧：k（刚度）/ c（阻尼），[src:pretty:L55096-L55120]。 */
export const WEAPON_SPRINGS = Object.freeze({
  kZ: Object.freeze([520, 30]),
  kP: Object.freeze([380, 26]),
  kY: Object.freeze([300, 22]),
  kR: Object.freeze([300, 20]),
  swY: Object.freeze([110, 15]),
  swP: Object.freeze([110, 15]),
  jY: Object.freeze([140, 13]),
  jP: Object.freeze([140, 13]),
  bump: Object.freeze([600, 30]),
});

/** 通道顺序即地板口径（floor: weaponChannels >= 9）。 */
export const WEAPON_SPRING_CHANNELS = Object.freeze([
  "kZ", "kP", "kY", "kR", "swY", "swP", "jY", "jP", "bump",
]);

/** hip / ADS / sprint / reload 四组锚点：p = 相机空间位置，r = YXZ 欧拉角。 */
export const WEAPON_POSES = Object.freeze({
  hip: Object.freeze({
    p: Object.freeze([0.118, -0.122, -0.275]),
    r: Object.freeze([0.034, 0.085, -0.03]),
  }),
  ads: Object.freeze({
    p: Object.freeze([0, -0.069, -0.135]),
    r: Object.freeze([0, 0, 0]),
  }),
  sprint: Object.freeze({
    p: Object.freeze([-0.035, 0.004, 0.03]),
    r: Object.freeze([-0.04, 0.62, 0.26]),
  }),
  reload: Object.freeze({
    p: Object.freeze([-0.03, 0.1, -0.02]),
    r: Object.freeze([0.46, 0.22, -0.8]),
  }),
});

/** 换弹时间线（秒），空仓档更长并多一段拉机柄。 */
export const WEAPON_RELOAD_TIMELINE = Object.freeze({
  tactical: 2.1,
  empty: 2.72,
  magOut: 0.47,
  magIn: 1.345,
  tap: 1.5,
  rackStart: 1.62,
  boltOut: 2.02,
  boltIn: 2.14,
  boltEnd: 2.19,
  magDrop: 0.085,
  magDropTime: 0.18,
});

/** 手感调参默认值（上游 Mt 的武器相关项 + 散布/热/爆发参数）。 */
export const WEAPON_TUNE_DEFAULTS = Object.freeze({
  name: "PAC-9",
  magSize: 30,
  reserve: 150,
  rpm: 720,
  damage: 26,
  range: 300,
  // 相机
  viewFov: 54, // 枪相机（viewCamera）54°
  worldFov: 74, // 世界相机 74°（Pi.fov）
  adsFov: 52, // 上游 Mt.fovAds
  fovSprint: 6,
  adsTime: 0.18,
  sprintBlend: 9,
  // 后坐
  recoilKeep: 0.35,
  recoilApply: 34,
  recoilRecover: 6.5,
  recoilHold: 0.09,
  pitchLimit: 1.5,
  recoilClampX: 0.3,
  recoilClampY: 0.2,
  shotPitch: 0.0068,
  shotShake: 0.12,
  shakeDecay: 1.7,
  shakePitch: 0.03,
  shakeYaw: 0.03,
  shakeRoll: 0.045,
  // 散布
  spreadHip: 0.0125,
  spreadAds: 0.0012,
  spreadMove: 0.013,
  spreadMoveAds: 0.004,
  spreadBloom: 0.0065,
  spreadBloomAds: 0.0022,
  spreadAir: 0.022,
  spreadCrouch: 0.002,
  spreadRate: 18,
  // 热 / 爆发
  bloomPerShot: 0.17,
  bloomDecay: 1.5,
  heatPerShot: 0.05,
  heatMax: 1.3,
  heatDecay: 0.2,
  autoReload: 0.32,
  idleInspect: 24,
});

/** 4 个枪身材质槽（镜片单独一片）。 */
export const WEAPON_MATERIAL_SLOTS = Object.freeze({
  ano: Object.freeze({ name: "pac9_anodised", color: Object.freeze([0.0085, 0.009, 0.0105]), roughness: 0.4, metalness: 0.45 }),
  gun: Object.freeze({ name: "pac9_phosphate", color: Object.freeze([0.016, 0.016, 0.0165]), roughness: 0.5, metalness: 0.7 }),
  poly: Object.freeze({ name: "pac9_polymer", color: Object.freeze([0.0125, 0.0128, 0.0135]), roughness: 0.62, metalness: 0 }),
  plain: Object.freeze({ name: "pac9_matte", color: Object.freeze([1, 1, 1]), roughness: 0.92, metalness: 0 }),
  lens: Object.freeze({ name: "pac9_lens", color: Object.freeze([0.35, 0.55, 0.62]), roughness: 0.08, metalness: 0, lens: true }),
});

/* ---------------- 2D 型材（参数化近似，非逐零件复刻） ---------------- */

function circleProfile(radius, segments, cx = 0, cy = 0) {
  const pts = [];
  for (let i = 0; i < segments; i += 1) {
    const a = (i / segments) * TAU;
    pts.push(Object.freeze([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]));
  }
  return Object.freeze(pts);
}

function octagonProfile(radius, cx = 0, cy = 0, phase = Math.PI / 8) {
  const pts = [];
  for (let i = 0; i < 8; i += 1) {
    const a = phase + (i / 8) * TAU;
    pts.push(Object.freeze([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]));
  }
  return Object.freeze(pts);
}

function freezeProfile(pts) {
  return Object.freeze(pts.map((p) => Object.freeze(p)));
}

/**
 * 剖面表。`axis:"x"` 的剖面坐标是 (z, y)（挤出后 shape.x → -z，与上游 `xr` 一致）；
 * `axis:"z"` 的剖面坐标是 (x, y)（与上游 `qo` 一致）。
 */
export const WEAPON_PROFILES = Object.freeze({
  // 滑套 / 上下机匣剖面（上游 g）
  slide: freezeProfile([[-0.1, -0.02], [0.1, -0.02], [0.1, 0.027], [0.093, 0.034], [-0.088, 0.034], [-0.1, 0.024]]),
  // 导轨基座（上游 qo 的长条）与单段导轨槽（上游 x）
  railBase: freezeProfile([[-0.0078, 0.0335], [0.0078, 0.0335], [0.0106, 0.0402], [-0.0106, 0.0402]]),
  railGroove: freezeProfile([[-0.0102, 0.0398], [0.0102, 0.0398], [0.0106, 0.0408], [0.0084, 0.0435], [-0.0084, 0.0435], [-0.0106, 0.0408]]),
  // 护木：八边形剖面（上游 8 片旋转拼成的护木，这里退化成八棱柱）
  handguard: octagonProfile(0.021),
  // 瞄具壳体 + 瞄准窗（窗口同时也是镜片外形与壳体孔洞）
  opticHousing: freezeProfile([[-0.0192, 0.0525], [0.0192, 0.0525], [0.0192, 0.0788], [0.0138, 0.0842], [-0.0138, 0.0842], [-0.0192, 0.0788]]),
  opticWindow: WEAPON_ANCHORS.window,
  // 弹匣 / 枪托 / 握把（上游 y / stock / grip）
  magazine: freezeProfile([[-0.1, -0.021], [0.099, -0.021], [0.101, -0.03], [0.098, -0.088], [0.036, -0.082], [0.031, -0.058], [-0.03, -0.058], [-0.04, -0.066], [-0.078, -0.055], [-0.1, -0.044]]),
  stock: freezeProfile([[-0.146, 0.024], [-0.3, 0.024], [-0.331, 0.014], [-0.334, -0.086], [-0.318, -0.101], [-0.29, -0.096], [-0.232, -0.04], [-0.146, -0.024]]),
  grip: freezeProfile([[-0.019, -0.024], [0.019, -0.024], [0.021, -0.018], [0.021, 0.018], [0.016, 0.024], [-0.016, 0.024], [-0.021, 0.018], [-0.021, 0.006], [-0.036, 0.004], [-0.04, -0.002], [-0.04, -0.014], [-0.034, -0.02], [-0.021, -0.02]]),
  // 枪管 / 消焰器 / 枪机（圆剖面，参数化）
  barrel: circleProfile(0.0105, 12),
  muzzleDevice: circleProfile(0.0116, 12),
  bolt: circleProfile(0.006, 10),
  chargingHandle: freezeProfile([[-0.005, -0.008], [0.005, -0.008], [0.005, 0.008], [-0.005, 0.008]]),
  // 抛壳口盖板（plain 槽：哑光件，也是「4 个材质槽」里的第 4 槽）
  ejectionPort: freezeProfile([[0, 0.004], [0.036, 0.004], [0.036, 0.016], [0, 0.016]]),
  // 扳机护圈：外轮廓 + 孔
  triggerGuard: freezeProfile([[0.03, -0.03], [0.062, -0.03], [0.062, -0.075], [0.03, -0.075]]),
  triggerGuardHole: freezeProfile([[0.035, -0.035], [0.057, -0.035], [0.057, -0.07], [0.035, -0.07]]),
});

/**
 * 零件表：slot 是材质槽，profile 指向 WEAPON_PROFILES，axis 决定挤出朝向，
 * `at` 是零件中心（相机空间米），repeat 是导轨槽这类重复段。
 */
export const WEAPON_PARTS = Object.freeze([
  { name: "slide", slot: "ano", profile: "slide", axis: "x", depth: 0.041, bevel: 0.0014, at: [0, 0, 0] },
  { name: "railBase", slot: "ano", profile: "railBase", axis: "z", depth: 0.493, bevel: 0.0005, at: [0, 0, 0.1505] },
  {
    name: "railGrooves", slot: "ano", profile: "railGroove", axis: "z", depth: 0.0048, bevel: 0.0008,
    at: [0, 0, 0], repeat: { count: 49, from: -0.094, step: 0.01 },
  },
  { name: "handguard", slot: "ano", profile: "handguard", axis: "z", depth: 0.297, bevel: 0.0009, at: [0, 0.006, -0.2495] },
  { name: "opticHousing", slot: "ano", profile: "opticHousing", hole: "opticWindow", axis: "z", depth: 0.026, bevel: 0.0008, at: [0, 0, 0.021] },
  { name: "triggerGuard", slot: "ano", profile: "triggerGuard", hole: "triggerGuardHole", axis: "x", depth: 0.012, bevel: 0.0006, at: [0, 0, 0] },
  { name: "barrel", slot: "gun", profile: "barrel", axis: "z", depth: 0.0985, bevel: 0.0008, at: [0, 0.006, -0.4478] },
  { name: "muzzleDevice", slot: "gun", profile: "muzzleDevice", axis: "z", depth: 0.034, bevel: 0.0006, at: [0, 0.006, -0.514] },
  { name: "bolt", slot: "gun", profile: "bolt", axis: "z", depth: 0.1, bevel: 0.0006, at: [0, 0.006, -0.02] },
  { name: "chargingHandle", slot: "gun", profile: "chargingHandle", axis: "x", depth: 0.024, bevel: 0.0006, at: [-0.023, 0.007, -0.078] },
  { name: "ejectionPort", slot: "plain", profile: "ejectionPort", axis: "x", depth: 0.0015, bevel: 0.0004, at: [0.021, 0, 0] },
  { name: "stock", slot: "poly", profile: "stock", axis: "x", depth: 0.038, bevel: 0.0014, at: [0, 0, 0] },
  { name: "grip", slot: "poly", profile: "grip", axis: "x", depth: 0.034, bevel: 0.0014, at: [0, 0.007, -0.078] },
  { name: "magazine", slot: "poly", profile: "magazine", axis: "x", depth: 0.038, bevel: 0.0014, at: [0, -0.02, -0.0665] },
  { name: "lens", slot: "lens", profile: "opticWindow", axis: "z", depth: 0.0004, bevel: 0, at: [0, 0, 0.0342] },
]);

const PART_SOLIDS = WEAPON_PARTS.reduce((n, p) => n + (p.repeat ? p.repeat.count : 1), 0);
const RAIL_SLOTS = WEAPON_PARTS.reduce((n, p) => n + (p.repeat ? p.repeat.count : 0), 0);
const BODY_SLOTS = new Set(WEAPON_PARTS.filter((p) => p.slot !== "lens").map((p) => p.slot)).size;
const SLOT_ORDER = Object.freeze(["ano", "gun", "poly", "plain", "lens"]);

/* ============================== 小工具 ============================== */

const EMPTY_INPUT = Object.freeze({});
const EMPTY_EVENTS = Object.freeze({ on() {}, emit() {} });

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const smootherstep = (t) => {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
};
const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);

/** 定种 PRNG（mulberry32）：kit 内零 Math.random。 */
export function createRng(seed = 0x9ac9) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 弹簧子步进（上游 `ma`）：>12ms 的帧拆成 ≤8ms 子步，半隐式欧拉。 */
function stepSpring(spring, target, dt) {
  if (!(dt > 0)) return spring.x;
  const n = dt > 0.012 ? Math.ceil(dt / 0.008) : 1;
  const h = dt / n;
  for (let i = 0; i < n; i += 1) {
    spring.v += ((target - spring.x) * spring.k - spring.v * spring.c) * h;
    spring.x += spring.v * h;
  }
  return spring.x;
}

/** 四元数旋转向量（out 可以与入参同一对象）。 */
function quatRotate(out, vx, vy, vz, q) {
  const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  out.x = vx + qw * tx + (qy * tz - qz * ty);
  out.y = vy + qw * ty + (qz * tx - qx * tz);
  out.z = vz + qw * tz + (qx * ty - qy * tx);
  return out;
}

/** YXZ 欧拉旋转（与 THREE.Euler(..., "YXZ") 一致，R = Ry * Rx * Rz）。 */
function rotYXZ(out, vx, vy, vz, rx, ry, rz) {
  const cz = Math.cos(rz), sz = Math.sin(rz);
  const x1 = vx * cz - vy * sz;
  const y1 = vx * sz + vy * cz;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const y2 = y1 * cx - vz * sx;
  const z2 = y1 * sx + vz * cx;
  const cy = Math.cos(ry), sy = Math.sin(ry);
  out.x = x1 * cy + z2 * sy;
  out.y = y2;
  out.z = -x1 * sy + z2 * cy;
  return out;
}

/* ============================== 工厂 ============================== */

export function createWeaponKit(THREE, options = {}) {
  if (THREE && typeof THREE.BufferGeometry !== "function") {
    options = THREE;
    THREE = null;
  }
  const opts = options || {};
  const rng = typeof opts.rng === "function"
    ? opts.rng
    : createRng(opts.seed === undefined ? 0x9ac9 : opts.seed);
  const events = opts.events || EMPTY_EVENTS;
  const tune = { ...WEAPON_TUNE_DEFAULTS, ...(opts.tune || {}) };
  let camera = opts.camera || null;
  const materials = opts.materials || null;

  const hipP = WEAPON_POSES.hip.p;
  const hipR = WEAPON_POSES.hip.r;
  const adsP = [0, -WEAPON_ANCHORS.sightY, WEAPON_POSES.ads.p[2]];
  const adsR = WEAPON_POSES.ads.r;
  const sprintP = WEAPON_POSES.sprint.p;
  const sprintR = WEAPON_POSES.sprint.r;
  const reloadP = WEAPON_POSES.reload.p;
  const reloadR = WEAPON_POSES.reload.r;

  /* ---- 弹簧通道 ---- */
  const channels = WEAPON_SPRING_CHANNELS.map((name) => ({
    name,
    k: WEAPON_SPRINGS[name][0],
    c: WEAPON_SPRINGS[name][1],
    x: 0,
    v: 0,
  }));
  const ch = {};
  for (const c of channels) ch[c.name] = c;

  /* ---- 状态（全部预分配；update 内不 new） ---- */
  const S = {
    t: 0,
    ammo: tune.magSize,
    reserve: tune.reserve,
    magSize: tune.magSize,
    cooldown: 0,
    prevFire: false,
    prevReload: false,
    dryDone: false,
    autoReload: -1,
    burst: 0,
    lastShot: -9,
    bloom: 0,
    heat: 0,
    smoke: 0,
    smokeTick: 0,
    adsLin: 0,
    adsE: 0,
    sprintT: 0,
    reloadW: 0,
    rackW: 0,
    boltT: 9,
    boltLocked: false,
    boltOffset: 0,
    reloadBolt: 0,
    flashT: 0,
    flashDur: 0.05,
    recPhase: 0,
    wasGround: true,
    lastVy: 0,
    bobPhase: 0,
    bobAmt: 0,
    spreadS: tune.spreadHip,
    idleT: 0,
    inspecting: false,
    inspectT: 0,
    finger: 0,
    shake: 0,
    visPitch: 0,
    visYaw: 0,
    camPitchOff: 0,
    camYawOff: 0,
    hold: 0,
    crouch: false,
    state: "idle",
    shotSeq: 0,
    fovS: tune.worldFov,
    flashScale: 0,
    visible: true,
  };

  /** 换弹状态机（单个复用对象；active 为 false 时其余字段无意义）。 */
  const reload = {
    active: false,
    t: 0,
    T: 0,
    empty: false,
    magOut: false,
    magIn: false,
    tap: false,
    bolt: false,
    fresh: false,
    done: false,
  };

  const aim = { pitch: 0, yaw: 0 };
  const pose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
  const cam = { pitch: 0, yaw: 0, roll: 0, fov: tune.worldFov, ads: 0, shake: 0 };
  const mag = { x: 0, y: 0, z: 0, rx: 0, visible: true };

  /** 最近一次射击的实测快照（供 fx/测试消费，预分配）。 */
  const shotInfo = {
    fired: false,
    ammo: 0,
    spread: 0,
    pitch: 0,
    yaw: 0,
    aimPitchDelta: 0,
    visualPitchDelta: 0,
    origin: { x: 0, y: 0, z: 0 },
    dir: { x: 0, y: 0, z: -1 },
    muzzle: { x: 0, y: 0, z: 0 },
  };
  const shell = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  const scratch = { x: 0, y: 0, z: 0 };

  /* ---- 视图模型（three 才建；无 three 时型材表仍可量） ---- */
  let root = null;
  let tris = 0;
  let meshCount = 0;
  let buildError = null;

  function materialFor(slot) {
    const style = WEAPON_MATERIAL_SLOTS[slot];
    if (materials) {
      let m = null;
      if (typeof materials.get === "function") m = materials.get(style.name);
      else if (typeof materials === "function") m = materials(style.name);
      else if (materials[slot]) m = materials[slot];
      else if (materials[style.name]) m = materials[style.name];
      if (m) return m;
    }
    if (!THREE) return null;
    const params = {
      roughness: style.roughness,
      metalness: style.metalness,
      color: new THREE.Color().setRGB(style.color[0], style.color[1], style.color[2]),
    };
    if (style.lens) {
      params.transparent = true;
      params.opacity = 0.38;
      params.depthWrite = false;
    }
    const mat = new THREE.MeshStandardMaterial(params);
    mat.name = style.name;
    return mat;
  }

  function extrudeProfile(points, holePoints, depth, bevel) {
    const shape = new THREE.Shape();
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) shape.lineTo(points[i][0], points[i][1]);
    shape.closePath();
    if (holePoints) {
      const hole = new THREE.Path();
      hole.moveTo(holePoints[0][0], holePoints[0][1]);
      for (let i = 1; i < holePoints.length; i += 1) hole.lineTo(holePoints[i][0], holePoints[i][1]);
      hole.closePath();
      shape.holes.push(hole);
    }
    const b = Math.max(0, bevel);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(1e-4, depth - 2 * b),
      bevelEnabled: b > 0,
      bevelThickness: b,
      bevelSize: b,
      bevelOffset: -b,
      bevelSegments: 1,
      steps: 1,
      curveSegments: 6,
    });
    // 上游 __() 同样把挤出体推回 bevelOffset 处，保证总长 = depth
    if (b > 0) geo.translate(0, 0, b);
    return geo;
  }

  function orientPart(geo, part, index) {
    const at = part.at;
    let px = at[0], py = at[1], pz = at[2];
    if (part.repeat) pz = part.repeat.from + index * part.repeat.step + part.depth * 0.5;
    if (part.axis === "x") {
      geo.rotateY(Math.PI / 2);
      geo.translate(px - part.depth * 0.5, py, pz);
    } else {
      geo.translate(px, py, pz - part.depth * 0.5);
    }
  }

  function mergeGeometries(list) {
    let count = 0;
    const parts = [];
    for (let i = 0; i < list.length; i += 1) {
      const g = list[i].index ? list[i].toNonIndexed() : list[i];
      parts.push(g);
      count += g.attributes.position.count;
    }
    const pos = new Float32Array(count * 3);
    const nrm = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    let o3 = 0;
    let o2 = 0;
    for (const g of parts) {
      const a = g.attributes.position;
      pos.set(a.array, o3);
      nrm.set(g.attributes.normal.array, o3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, o2);
      o3 += a.count * 3;
      o2 += a.count * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.computeBoundingSphere();
    for (const g of parts) g.dispose();
    return geo;
  }

  function buildViewmodel() {
    if (!THREE || typeof THREE.ExtrudeGeometry !== "function" || typeof THREE.Shape !== "function") return null;
    const group = new THREE.Group();
    group.name = "viewmodel-pac9";
    const buckets = {};
    for (const slot of SLOT_ORDER) buckets[slot] = [];
    for (const part of WEAPON_PARTS) {
      const profile = WEAPON_PROFILES[part.profile];
      const hole = part.hole ? WEAPON_PROFILES[part.hole] : null;
      const n = part.repeat ? part.repeat.count : 1;
      for (let i = 0; i < n; i += 1) {
        const geo = extrudeProfile(profile, hole, part.depth, part.bevel);
        orientPart(geo, part, i);
        buckets[part.slot].push(geo);
      }
    }
    let builtTris = 0;
    for (const slot of SLOT_ORDER) {
      const list = buckets[slot];
      if (!list.length) continue;
      const geo = mergeGeometries(list);
      builtTris += geo.attributes.position.count / 3;
      const mesh = new THREE.Mesh(geo, materialFor(slot));
      mesh.name = `pac9_${slot}`;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      group.add(mesh);
      meshCount += 1;
    }
    group.userData.parts = WEAPON_PARTS.length;
    group.userData.railSlots = RAIL_SLOTS;
    group.userData.tris = Math.round(builtTris);
    tris = Math.round(builtTris);
    return group;
  }

  try {
    root = buildViewmodel();
  } catch (err) {
    // 建不出 mesh 不影响手感内核；把原因记进 stats，别静默
    root = null;
    buildError = err && err.message ? err.message : String(err);
  }

  /* ---- 事件负载（只在离散时刻创建） ---- */
  function emitReload(phase, emptyStatus) {
    events.emit("weapon:reload", { phase, empty: emptyStatus, ammo: S.ammo, reserve: S.reserve });
  }

  /* ---- 后坐分离 ---- */
  function addRecoil(p, y) {
    const keep = tune.recoilKeep;
    const before = aim.pitch;
    aim.pitch = clamp(aim.pitch + p * keep, -tune.pitchLimit, tune.pitchLimit);
    aim.yaw += y * keep;
    const visBefore = S.visPitch;
    S.visPitch = clamp(S.visPitch + p * (1 - keep), -tune.recoilClampX, tune.recoilClampX);
    S.visYaw = clamp(S.visYaw + y * (1 - keep), -tune.recoilClampY, tune.recoilClampY);
    S.hold = tune.recoilHold;
    shotInfo.aimPitchDelta = aim.pitch - before;
    shotInfo.visualPitchDelta = S.visPitch - visBefore;
  }

  /* ---- 单发 ---- */
  function shot() {
    if (S.ammo <= 0 || reload.active) return false;
    S.ammo -= 1;
    S.burst += 1;
    S.lastShot = S.t;
    S.heat = Math.min(tune.heatMax, S.heat + tune.heatPerShot);
    S.shotSeq += 1;

    const bt = lerp(1, 0.55, S.adsE) * (S.crouch ? 0.85 : 1);
    const pn = S.burst <= 9 ? 1 : 0.38;
    const yawKick = (S.burst < 4
      ? (rng() - 0.5) * 0.0022
      : Math.sin(S.burst * 0.57 + S.recPhase) * 0.0042 + (rng() - 0.5) * 0.002) * bt;
    const pitchKick = tune.shotPitch * pn * bt * (0.85 + rng() * 0.3);

    ch.kZ.v += 1.5 * lerp(1, 0.6, S.adsE);
    ch.kP.v += 1.5 * bt;
    ch.kY.v += (rng() - 0.5) * bt;
    ch.kR.v += (rng() - 0.5) * 1.8 * bt;

    shotInfo.fired = true;
    shotInfo.ammo = S.ammo;
    shotInfo.spread = S.spreadS;
    shotInfo.pitch = pitchKick;
    shotInfo.yaw = yawKick;
    addRecoil(pitchKick, yawKick);

    S.bloom = Math.min(1, S.bloom + tune.bloomPerShot);
    S.flashDur = 0.036 + rng() * 0.02;
    S.flashT = S.flashDur;
    S.flashScale = (0.8 + rng() * 0.5) * lerp(1, 0.62, S.adsE);
    S.shake = Math.min(1, S.shake + tune.shotShake * bt);
    S.recPhase += 0.77;

    if (S.ammo <= 0) {
      S.boltLocked = true;
    }

    if (camera) {
      muzzleWorld(shotInfo.muzzle, camera);
      shotDir(shotInfo.dir);
      const cp = camera.position;
      if (cp) { shotInfo.origin.x = cp.x; shotInfo.origin.y = cp.y; shotInfo.origin.z = cp.z; }
    }

    events.emit("weapon:fire", {
      origin: { x: shotInfo.origin.x, y: shotInfo.origin.y, z: shotInfo.origin.z },
      dir: { x: shotInfo.dir.x, y: shotInfo.dir.y, z: shotInfo.dir.z },
      muzzle: { x: shotInfo.muzzle.x, y: shotInfo.muzzle.y, z: shotInfo.muzzle.z },
      ads: S.adsE,
      ammo: S.ammo,
      spread: S.spreadS,
    });
    return true;
  }

  /** 绕过输入的强制一发（展厅/离线测试用；遵守弹药与换弹状态）。 */
  function pullTrigger() {
    shotInfo.fired = false;
    const fired = shot();
    return fired ? shotInfo : null;
  }

  /* ---- 换弹状态机 ---- */
  function startReload() {
    if (reload.active || S.ammo >= tune.magSize || S.reserve <= 0) return false;
    const empty = S.ammo <= 0;
    reload.active = true;
    reload.t = 0;
    reload.T = empty ? WEAPON_RELOAD_TIMELINE.empty : WEAPON_RELOAD_TIMELINE.tactical;
    reload.empty = empty;
    reload.magOut = false;
    reload.magIn = false;
    reload.tap = false;
    reload.bolt = false;
    reload.fresh = false;
    reload.done = false;
    S.autoReload = -1;
    emitReload("start", empty);
    return true;
  }

  function updateReload(dt) {
    S.reloadBolt = 0;
    if (!reload.active) {
      mag.y = 0;
      mag.z = 0;
      mag.rx = 0;
      return;
    }
    const T = WEAPON_RELOAD_TIMELINE;
    reload.t += dt;
    const t = reload.t;
    const empty = reload.empty;

    if (!reload.magOut && t >= T.magOut) {
      reload.magOut = true;
      ch.bump.v -= 0.25;
      emitReload("magout", empty);
    }
    if (t > 0.86 && !reload.fresh) {
      reload.fresh = true;
    }
    if (!reload.magIn && t >= T.magIn) {
      reload.magIn = true;
      ch.bump.v += 0.55;
      const moved = Math.min(tune.magSize - S.ammo, S.reserve);
      S.ammo += moved;
      S.reserve -= moved;
      if (!empty) S.boltLocked = false;
      emitReload("magin", empty);
    }
    if (!reload.tap && t >= T.tap) {
      reload.tap = true;
      ch.bump.v += 0.4;
      emitReload("tap", empty);
    }
    if (empty) {
      if (t >= T.boltOut && t < T.boltIn) {
        S.reloadBolt = smootherstep((t - T.boltOut) / (T.boltIn - T.boltOut));
      } else if (t >= T.boltIn && t < T.boltEnd) {
        S.reloadBolt = 1;
      } else if (t >= T.boltEnd) {
        S.reloadBolt = Math.max(0, 1 - (t - T.boltEnd) / 0.035);
      }
      if (!reload.bolt && t >= T.boltIn) {
        reload.bolt = true;
        S.boltLocked = false;
        ch.bump.v += 0.3;
        ch.kZ.v -= 0.5;
        emitReload("bolt", empty);
      }
    }

    // 入套/出套权重（上游 reloadW / rackW 的同一组斜坡）
    S.reloadW = Math.min(smoothstep(0, 0.3, t), 1 - smoothstep(0, 0.4, t - (reload.T - 0.46)));
    S.rackW = empty
      ? smoothstep(0, 0.3, t - T.rackStart) * (1 - smoothstep(0, 0.4, t - (reload.T - 0.46)))
      : 0;

    // 弹匣掉落/回插（参数化近似，替代上游手部关键帧）
    let out = 0;
    if (t >= T.magOut) out = smoothstep(0, T.magDropTime, t - T.magOut);
    if (t >= T.magIn) out *= 1 - smoothstep(0, T.magDropTime, t - T.magIn);
    mag.y = -T.magDrop * out;
    mag.z = -0.02 * out;
    mag.rx = 0.5 * out;
    mag.visible = true;

    if (!reload.done && t >= reload.T) {
      reload.done = true;
      reload.active = false;
      S.reloadW = 0;
      S.rackW = 0;
      mag.y = 0;
      mag.z = 0;
      mag.rx = 0;
      S.reloadBolt = 0;
      emitReload("done", empty);
    }
  }

  /* ---- 散布 ---- */
  function updateSpread(dt, speed, grounded) {
    const moveT = clamp01(speed / 6);
    let target = lerp(tune.spreadHip, tune.spreadAds, S.adsE)
      + moveT * lerp(tune.spreadMove, tune.spreadMoveAds, S.adsE)
      + S.bloom * lerp(tune.spreadBloom, tune.spreadBloomAds, S.adsE)
      - (S.crouch ? tune.spreadCrouch * (1 - S.adsE) : 0);
    if (!grounded) target += tune.spreadAir;
    S.spreadS = damp(S.spreadS, Math.max(0.0002, target), tune.spreadRate, dt);
  }

  /* ---- 主更新 ---- */
  function update(dt, input) {
    const inp = input || EMPTY_INPUT;
    if (!(dt > 0)) dt = 0;
    shotInfo.fired = false;
    if (inp.alive === false) {
      S.prevFire = false;
      return S.state;
    }
    S.t += dt;
    const fireHeld = !!inp.fire && S.visible;
    if (!fireHeld) S.dryDone = false;
    S.prevFire = fireHeld;
    const lookDx = +inp.lookDx || 0;
    const lookDy = +inp.lookDy || 0;
    const speed = +inp.speed || 0;
    const grounded = inp.onGround !== false;
    const vy = +inp.vy || 0;
    const moveX = +inp.moveX || 0;
    const moveY = +inp.moveY || 0;
    S.crouch = !!inp.crouch;
    const adsWanted = !!inp.ads;

    const reloadPressed = !!inp.reload && !S.prevReload;
    S.prevReload = !!inp.reload;
    if (reloadPressed) startReload();
    if (S.autoReload >= 0) {
      S.autoReload -= dt;
      if (S.autoReload < 0) startReload();
    }

    // 冲刺权重（9/s 指数逼近）
    const sprintWant = !!inp.sprint && !fireHeld && !adsWanted && !reload.active;
    S.sprintT = damp(S.sprintT, sprintWant ? 1 : 0, tune.sprintBlend, dt);

    updateReload(dt);
    updateSpread(dt, speed, grounded);

    // 开火
    S.cooldown -= dt;
    const canFire = !reload.active && S.sprintT < 0.45;
    if (fireHeld && canFire) {
      if (S.ammo > 0) {
        let guard = 0;
        while (S.cooldown <= 0 && S.ammo > 0 && guard < 3) {
          shot();
          S.cooldown += 60 / tune.rpm;
          guard += 1;
        }
      } else if (!S.dryDone) {
        S.dryDone = true;
        ch.bump.v -= 0.08;
        if (S.reserve > 0) S.autoReload = tune.autoReload;
        events.emit("weapon:dry", { ammo: 0, reserve: S.reserve });
      }
    }
    if (S.cooldown < 0) S.cooldown = Math.max(S.cooldown, -0.001);

    // 爆发/热/烟
    if (S.t - S.lastShot > 0.24) {
      if (S.burst > 0) S.recPhase = rng() * TAU;
      S.burst = 0;
    }
    S.bloom = Math.max(0, S.bloom - dt * tune.bloomDecay);
    S.heat = Math.max(0, S.heat - dt * tune.heatDecay);
    if (S.smoke > 0) {
      S.smoke = Math.max(0, S.smoke - dt);
      S.smokeTick -= dt;
      if (S.smokeTick <= 0) {
        S.smokeTick = 0.085;
        events.emit("weapon:smoke", null);
      }
    } else if (S.t - S.lastShot > 0.11 && S.heat > 0.4) {
      S.smoke = Math.min(1.6, S.heat * 1.3);
    }

    // ADS
    const adsTarget = adsWanted && !reload.active && S.sprintT < 0.35;
    S.adsLin = clamp01(S.adsLin + (adsTarget ? dt : -dt) / tune.adsTime);
    S.adsE = smootherstep(S.adsLin);

    // 后坐视觉偏移：hold 内保持，之后按 6.5 衰减；相机偏移按 34 追随
    if (S.hold > 0) S.hold = Math.max(0, S.hold - dt);
    else {
      S.visPitch = damp(S.visPitch, 0, tune.recoilRecover, dt);
      S.visYaw = damp(S.visYaw, 0, tune.recoilRecover, dt);
    }
    S.camPitchOff = damp(S.camPitchOff, S.visPitch, tune.recoilApply, dt);
    S.camYawOff = damp(S.camYawOff, S.visYaw, tune.recoilApply, dt);

    // 待机检视（24s 不动 → 3.5s 检视动作；只影响 pose 权重）
    const busy = fireHeld || adsWanted || reload.active || speed > 0.2
      || Math.abs(lookDx) + Math.abs(lookDy) > 0.002 || S.sprintT > 0.1;
    if (busy) {
      S.idleT = 0;
      if (S.inspecting) S.inspectT = Math.max(S.inspectT, 2.9);
    } else {
      S.idleT += dt;
    }
    if (!S.inspecting && S.idleT > tune.idleInspect) {
      S.inspecting = true;
      S.inspectT = 0;
    }
    let insA = 0, insB = 0, insW = 0;
    if (S.inspecting) {
      S.inspectT += dt;
      const it = S.inspectT;
      insA = smootherstep(it / 0.5) * (1 - smootherstep((it - 1.4) / 0.5));
      insB = smootherstep((it - 1.5) / 0.5) * (1 - smootherstep((it - 2.8) / 0.5));
      insW = smootherstep(it / 0.5) * (1 - smootherstep((it - 2.9) / 0.5));
      if (it > 3.5) {
        S.inspecting = false;
        S.inspectT = 0;
        S.idleT = 0;
      }
    }

    // 枪机 / 手指
    S.boltT += dt;
    const boltWindow = 0.072;
    let bolt = S.boltT < boltWindow ? Math.sin((Math.PI * S.boltT) / boltWindow) : 0;
    if (S.boltLocked && S.boltT > boltWindow * 0.5) bolt = Math.max(bolt, 0.86);
    S.boltOffset = WEAPON_ANCHORS.boltTravel * Math.max(bolt * 0.95, S.reloadBolt);
    S.finger = damp(S.finger, (fireHeld && canFire) || S.flashT > 0 ? 1 : 0, 30, dt);
    S.flashT = Math.max(0, S.flashT - dt);

    // 状态字符串
    S.state = reload.active ? "reloading"
      : S.inspecting ? "inspect"
        : S.sprintT > 0.5 ? "sprinting"
          : S.t - S.lastShot < 0.14 ? "firing" : "idle";

    /* ---- 弹簧激励 ---- */
    const te = lerp(1, 0.3, S.adsE);
    const pe = lerp(1, 0.4, S.adsE);
    ch.swY.v += clamp(lookDx, -0.2, 0.2) * 3.2 * pe;
    ch.swP.v += clamp(lookDy, -0.2, 0.2) * 2.6 * pe;
    stepSpring(ch.swY, 0, dt);
    stepSpring(ch.swP, 0, dt);
    ch.swY.x = clamp(ch.swY.x, -0.09, 0.09);
    ch.swP.x = clamp(ch.swP.x, -0.07, 0.07);

    if (S.wasGround && !grounded && vy > 1) {
      ch.jY.v -= 0.22;
      ch.jP.v += 0.7;
    }
    if (!S.wasGround && grounded) {
      const land = clamp(-S.lastVy * 0.06, 0, 0.6);
      ch.jY.v -= land;
      ch.jP.v -= land * 3.2;
      ch.kR.v += (rng() - 0.5) * land * 2;
    }
    S.wasGround = grounded;
    if (!grounded) S.lastVy = vy;

    stepSpring(ch.jY, grounded ? 0 : clamp(-vy * 0.0045, -0.02, 0.024), dt);
    stepSpring(ch.jP, grounded ? 0 : clamp(vy * 0.012, -0.06, 0.06), dt);
    stepSpring(ch.kZ, 0, dt);
    stepSpring(ch.kP, 0, dt);
    stepSpring(ch.kY, 0, dt);
    stepSpring(ch.kR, 0, dt);
    stepSpring(ch.bump, 0, dt);

    /* ---- 摇晃 / 步伐 ---- */
    S.shake = Math.max(0, S.shake - tune.shakeDecay * dt);
    const sh = S.shake * S.shake;
    const phase = S.t;
    const shakePitch = sh * tune.shakePitch * (Math.sin(phase * 43.1) + 0.6 * Math.sin(phase * 71.7 + 1.3));
    const shakeYaw = sh * tune.shakeYaw * (Math.sin(phase * 37.3 + 2.1) + 0.6 * Math.sin(phase * 83.9));
    const shakeRoll = sh * tune.shakeRoll * (Math.sin(phase * 29.7 + 0.7) + 0.5 * Math.sin(phase * 61.3 + 4));

    S.bobAmt = damp(S.bobAmt, grounded ? clamp01(speed / 3.6) : 0, 8, dt);
    if (speed > 0.3 && grounded) S.bobPhase += dt * (5.2 + speed * 1.55);
    const bobPhase = S.bobPhase;
    const yr = S.bobAmt * lerp(1, 0.12, S.adsE) * (1 + S.sprintT * 1.4);
    const bobX = Math.sin(bobPhase) * 0.006 * yr;
    const bobY = (Math.sin(2 * bobPhase) * 0.0042
      - Math.pow(0.5 + 0.5 * Math.cos(2 * bobPhase + 0.6), 4) * 0.0048) * yr;

    /* ---- 视图模型位姿（相机空间） ---- */
    const Le = 1 - S.adsE;
    const ke = S.adsE;
    const Ue = S.sprintT;
    const ct = S.reloadW;
    const De = S.rackW;
    pose.x = lerp(hipP[0], adsP[0], ke) + sprintP[0] * Ue + reloadP[0] * ct + bobX
      + Math.sin(S.t * 0.85 + 1) * 0.0012 * te - ch.swY.x * 0.06 - moveX * 0.004 * Le - 0.035 * insW;
    pose.y = lerp(hipP[1], adsP[1], ke) + sprintP[1] * Ue + reloadP[1] * ct + bobY
      + Math.sin(S.t * 1.7) * 0.0016 * te + ch.swP.x * 0.05 + ch.jY.x + ch.bump.x * 0.6 + 0.045 * insW;
    pose.z = lerp(hipP[2], adsP[2], ke) + sprintP[2] * Ue + reloadP[2] * ct
      + ch.kZ.x * 0.55 + moveY * 0.004 * Le * (1 - Ue);
    pose.rx = hipR[0] * Le + sprintR[0] * Ue + reloadR[0] * ct - 0.16 * De
      + Math.sin(S.t * 1.7 + 0.8) * 0.0035 * te + Math.sin(2 * bobPhase + 0.5) * 0.008 * yr
      + ch.swP.x + ch.jP.x + ch.kP.x + ch.bump.x * 1.5 + 0.3 * insW;
    pose.ry = hipR[1] * Le + sprintR[1] * Ue + reloadR[1] * ct
      + Math.sin(S.t * 0.6) * 0.002 * te + Math.sin(bobPhase) * 0.01 * yr
      + ch.swY.x + ch.kY.x + 0.18 * insW + 0.25 * insB;
    pose.rz = hipR[2] * Le + sprintR[2] * Ue + reloadR[2] * ct + 0.62 * De
      + Math.sin(bobPhase) * 0.014 * yr + ch.swY.x * 0.7 - moveX * 0.035 * Le
      + ch.kR.x - 0.75 * insA + 0.55 * insB + Math.sin(S.t * 0.5) * 0.004 * te;

    /* ---- 相机（瞄准 + 视觉后坐 + 抖动） ---- */
    cam.pitch = aim.pitch + S.camPitchOff + shakePitch;
    cam.yaw = aim.yaw + S.camYawOff + shakeYaw;
    cam.roll = shakeRoll; // 相机滚转只吃抖动；模型滚转留在 pose.rz
    cam.ads = S.adsE;
    cam.shake = S.shake;

    const fovTarget = lerp(tune.worldFov + (S.sprintT > 0.5 ? tune.fovSprint : 0), tune.adsFov, S.adsE);
    const fovRate = S.adsE > 0.02 && S.adsE < 0.98 ? 30 : 7;
    S.fovS = damp(S.fovS, fovTarget, fovRate, dt);
    cam.fov = S.fovS;

    return S.state;
  }

  /* ---- 锚点变换 ---- */
  function viewToCamera(out, anchor) {
    rotYXZ(out, anchor[0], anchor[1], anchor[2], pose.rx, pose.ry, pose.rz);
    out.x += pose.x;
    out.y += pose.y;
    out.z += pose.z;
    return out;
  }

  /** 相机空间 → 世界（上游 Pe：按 fov 比缩放 x/y，再套相机四元数 + 位置）。 */
  function toWorld(out, camObj) {
    const fov = camObj && camObj.fov ? camObj.fov : tune.viewFov;
    const ratio = Math.tan((fov * Math.PI) / 360) / Math.tan((tune.viewFov * Math.PI) / 360);
    out.x *= ratio;
    out.y *= ratio;
    if (!camObj) return false;
    if (camObj.quaternion) quatRotate(out, out.x, out.y, out.z, camObj.quaternion);
    const p = camObj.position;
    if (p) {
      out.x += p.x;
      out.y += p.y;
      out.z += p.z;
    }
    return true;
  }

  /** 枪口世界坐标（写进调用方给的对象；零分配）。 */
  function muzzleWorld(out, camObj = camera) {
    viewToCamera(out, WEAPON_ANCHORS.muzzle);
    return toWorld(out, camObj);
  }

  /** 抛壳口世界坐标。 */
  function ejectWorld(out, camObj = camera) {
    viewToCamera(out, WEAPON_ANCHORS.eject);
    return toWorld(out, camObj);
  }

  /**
   * 弹道方向：由相机姿态（瞄准 + 视觉后坐 + 抖动）加散布锥算出。
   * 准星在屏幕中心，弹道永远顺着它——这就是「后坐不直接改瞄准角」的落地方式。
   */
  function shotDir(out, spread = S.spreadS) {
    const a = rng() * TAU;
    const r = Math.tan(spread) * Math.sqrt(rng());
    rotYXZ(out, Math.cos(a) * r, Math.sin(a) * r, -1, cam.pitch, cam.yaw, cam.roll);
    const len = Math.hypot(out.x, out.y, out.z) || 1;
    out.x /= len;
    out.y /= len;
    out.z /= len;
    return out;
  }

  /**
   * 抛壳：位置 + 初速（相机坐标系 → 世界，再叠玩家速度），供 fx-kit.shell。
   * velocity 的随机量取注入 rng；out 由调用方预分配。
   */
  function shellTransform(out = shell, camObj = camera, playerVel = null) {
    ejectWorld(scratch, camObj);
    out.x = scratch.x;
    out.y = scratch.y;
    out.z = scratch.z;
    const vx = 2 + rng() * 1.2;
    const vy = 1.2 + rng() * 0.8;
    const vz = 0.5 - rng() * 0.6;
    scratch.x = vx;
    scratch.y = vy;
    scratch.z = vz;
    if (camObj && camObj.quaternion) quatRotate(scratch, vx, vy, vz, camObj.quaternion);
    out.vx = scratch.x + (playerVel && playerVel.x ? playerVel.x : 0);
    out.vy = scratch.y + (playerVel && playerVel.y ? playerVel.y : 0);
    out.vz = scratch.z + (playerVel && playerVel.z ? playerVel.z : 0);
    return out;
  }

  /** 把 fov + 相机姿态写回外部相机（上游武器更新同款；fov 可关）。 */
  function applyCamera(camObj, { applyFov = true } = {}) {
    if (!camObj) return false;
    if (applyFov) {
      camObj.fov = cam.fov;
      if (typeof camObj.updateProjectionMatrix === "function") camObj.updateProjectionMatrix();
    }
    if (camObj.rotation && typeof camObj.rotation.set === "function") {
      camObj.rotation.set(cam.pitch, cam.yaw, cam.roll, "YXZ");
    }
    return true;
  }

  function setCamera(camObj) {
    camera = camObj || null;
    return camera;
  }

  function setVisible(v) {
    S.visible = !!v;
    if (root) root.visible = S.visible;
  }

  function setAmmo(ammo, reserve = S.reserve) {
    S.ammo = clamp(Math.round(ammo), 0, tune.magSize);
    S.reserve = Math.max(0, Math.round(reserve));
    S.boltLocked = S.ammo <= 0;
    return S.ammo;
  }

  function reset() {
    S.t = 0;
    S.ammo = tune.magSize;
    S.reserve = tune.reserve;
    S.cooldown = 0;
    S.prevFire = false;
    S.prevReload = false;
    S.dryDone = false;
    S.autoReload = -1;
    S.burst = 0;
    S.lastShot = -9;
    S.bloom = 0;
    S.heat = 0;
    S.smoke = 0;
    S.smokeTick = 0;
    S.adsLin = 0;
    S.adsE = 0;
    S.sprintT = 0;
    S.reloadW = 0;
    S.rackW = 0;
    S.boltT = 9;
    S.boltLocked = false;
    S.boltOffset = 0;
    S.reloadBolt = 0;
    S.flashT = 0;
    S.recPhase = 0;
    S.wasGround = true;
    S.lastVy = 0;
    S.spreadS = tune.spreadHip;
    S.idleT = 0;
    S.inspecting = false;
    S.inspectT = 0;
    S.finger = 0;
    S.shake = 0;
    S.visPitch = 0;
    S.visYaw = 0;
    S.camPitchOff = 0;
    S.camYawOff = 0;
    S.hold = 0;
    S.state = "idle";
    S.fovS = tune.worldFov;
    S.visible = true;
    for (const c of channels) { c.x = 0; c.v = 0; }
    aim.pitch = 0;
    aim.yaw = 0;
    reload.active = false;
    reload.t = 0;
    reload.T = 0;
    reload.empty = false;
    reload.magOut = false;
    reload.magIn = false;
    reload.tap = false;
    reload.bolt = false;
    reload.fresh = false;
    reload.done = false;
    mag.x = 0; mag.y = 0; mag.z = 0; mag.rx = 0; mag.visible = true;
    pose.x = 0; pose.y = 0; pose.z = 0; pose.rx = 0; pose.ry = 0; pose.rz = 0;
    cam.pitch = 0; cam.yaw = 0; cam.roll = 0; cam.fov = tune.worldFov;
    if (root) root.visible = true;
    return S;
  }

  /* ---- 对账口径 ---- */
  function stats() {
    return {
      // 对账门禁口径（harness/element-manifest.json → weapon）
      weaponMeshes: root ? meshCount : PART_SOLIDS,
      weaponChannels: channels.length,
      // 其他实测项
      meshMode: root ? "three" : "cpu-profile",
      meshBuildError: buildError,
      weaponParts: WEAPON_PARTS.length,
      weaponSolids: PART_SOLIDS,
      railSlots: RAIL_SLOTS,
      materialSlots: BODY_SLOTS,
      drawCalls: root ? meshCount : 0,
      tris,
      name: tune.name,
      state: S.state,
      ammo: S.ammo,
      reserve: S.reserve,
      magSize: tune.magSize,
      ads: S.adsE,
      spread: S.spreadS,
      recoilKeep: tune.recoilKeep,
      viewFov: tune.viewFov,
      adsFov: tune.adsFov,
      worldFov: tune.worldFov,
      cameraFov: cam.fov,
      aimPitch: aim.pitch,
      aimYaw: aim.yaw,
      visualPitch: S.visPitch,
      visualYaw: S.visYaw,
      camPitch: cam.pitch,
      camYaw: cam.yaw,
      hold: S.hold,
      reloadW: S.reloadW,
      rackW: S.rackW,
      magY: mag.y,
      boltOffset: S.boltOffset,
      flashT: S.flashT,
      flashDur: S.flashDur,
      flashScale: S.flashScale,
      shake: S.shake,
      sprint: S.sprintT,
      reloadPhase: reload.active
        ? (reload.bolt ? "bolt" : reload.tap ? "tap" : reload.magIn ? "magin" : reload.magOut ? "magout" : "raised")
        : "idle",
      channels: channels.map((c) => ({ name: c.name, k: c.k, c: c.c })),
      pose: { x: pose.x, y: pose.y, z: pose.z, rx: pose.rx, ry: pose.ry, rz: pose.rz },
    };
  }

  /* ---- 离线自证 ---- */
  function selfTest() {
    const checks = [];
    const ok = (name, pass, detail) => checks.push({ name, ok: !!pass, detail });

    ok("channels=9", channels.length === 9 && WEAPON_SPRING_CHANNELS.every((n) => !!ch[n]), WEAPON_SPRING_CHANNELS.join(","));
    ok("spring-kc", channels.every((c) => c.k === WEAPON_SPRINGS[c.name][0] && c.c === WEAPON_SPRINGS[c.name][1]), "kZ 520/30 · kP 380/26 · bump 600/30");
    ok("rail-slots=49", RAIL_SLOTS === 49, String(RAIL_SLOTS));
    ok("material-slots=4", BODY_SLOTS === 4, String(BODY_SLOTS));
    ok("parts>=8", WEAPON_PARTS.length >= 8, `${WEAPON_PARTS.length} 零件 / ${PART_SOLIDS} 实心体`);
    ok("meshes>=1", (root ? meshCount : PART_SOLIDS) >= 1, root ? `${meshCount} mesh` : `${PART_SOLIDS} 型材体（CPU）`);
    ok("anchors", WEAPON_ANCHORS.muzzle[2] < 0 && WEAPON_ANCHORS.sightY > 0, "muzzle 前向 / sightY 上移");
    ok("poses", WEAPON_POSES.hip.p[0] > 0 && WEAPON_POSES.ads.p[0] === 0, "hip 偏右 / ADS 居中");

    // 弹簧：给 kZ 一个冲量，0.6s 后应基本回零
    const k1 = createWeaponKit(null, { rng: createRng(0x51), tune });
    k1.channels[0].v += 1;
    for (let i = 0; i < 36; i += 1) k1.update(1 / 60, {});
    const settle = Math.abs(k1.channels[0].x);
    ok("spring-settles", settle < 0.02, `|kZ.x|=${settle.toFixed(4)}`);

    // 换弹：打空 → 空仓重装（2.72s）→ 30 / 120（150 里搬 30 发）
    const k2 = createWeaponKit(null, { rng: createRng(0x52), tune });
    k2.setAmmo(1, 150);
    k2.update(1 / 60, { fire: true });
    k2.update(1 / 60, { fire: true });
    ok("dry-fire", k2.stats().ammo === 0, `ammo=${k2.stats().ammo}`);
    for (let i = 0; i < 240; i += 1) k2.update(1 / 60, {});
    const st2 = k2.stats();
    ok("empty-reload", st2.ammo === 30 && st2.reserve === 120 && st2.state === "idle",
      `ammo=${st2.ammo} reserve=${st2.reserve} state=${st2.state}`);

    // 后坐分离：同一发的视觉增量 / 瞄准增量 = (1-keep)/keep
    const k3 = createWeaponKit(null, { rng: createRng(0x53), tune });
    k3.update(1 / 60, {});
    const shot = k3.pullTrigger();
    const ratio = shot ? shot.visualPitchDelta / (shot.aimPitchDelta || 1e-9) : 0;
    const expect = (1 - tune.recoilKeep) / tune.recoilKeep;
    ok("recoil-split", shot && Math.abs(ratio - expect) < 1e-9, `ratio=${ratio.toFixed(4)} expect=${expect.toFixed(4)}`);

    // 锚点：identity 相机（fov 54）时 muzzle 应在相机前方、z<0
    const k4 = createWeaponKit(null, { rng: createRng(0x54), tune });
    const ident = { fov: 54, quaternion: { x: 0, y: 0, z: 0, w: 1 }, position: { x: 0, y: 0, z: 0 } };
    k4.update(1 / 60, {});
    const m = { x: 0, y: 0, z: 0 };
    k4.muzzleWorld(m, ident);
    const wide = { fov: 74, quaternion: ident.quaternion, position: ident.position };
    const mw = { x: 0, y: 0, z: 0 };
    k4.muzzleWorld(mw, wide);
    const scale = mw.x / (m.x || 1e-9);
    const scaleExpect = Math.tan((74 * Math.PI) / 360) / Math.tan((54 * Math.PI) / 360);
    ok("muzzle-transform", m.z < 0 && Math.abs(scale - scaleExpect) < 1e-9,
      `mz=${m.z.toFixed(3)} fovScale=${scale.toFixed(4)}`);

    // 抛壳：位置 + 速度有限，速度朝向相机系 +x/+y 为主
    const sh = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    k4.shellTransform(sh, ident, { x: 0.5, y: 0, z: 0 });
    ok("shell-transform", Number.isFinite(sh.vx) && sh.vx > 0.5 && sh.vy > 0, `v=(${sh.vx.toFixed(2)},${sh.vy.toFixed(2)},${sh.vz.toFixed(2)})`);

    // 确定性：同 seed 同输入 → 同一结果
    const run = (seed) => {
      const k = createWeaponKit(null, { rng: createRng(seed), tune });
      for (let i = 0; i < 90; i += 1) {
        k.update(1 / 60, { fire: i > 10, ads: i > 40, lookDx: 0.05, lookDy: -0.02, speed: 2, onGround: true });
      }
      const s = k.stats();
      return `${s.ammo}|${s.pose.x.toFixed(6)}|${s.aimPitch.toFixed(6)}|${s.spread.toFixed(6)}`;
    };
    const a1 = run(0x99);
    const a2 = run(0x99);
    ok("deterministic", a1 === a2, a1);

    return {
      ok: checks.every((c) => c.ok),
      checks,
      stats: stats(),
    };
  }

  const api = {
    // 视图模型 / 锚点
    root,
    pose,
    mag,
    setCamera,
    applyCamera,
    muzzleWorld,
    ejectWorld,
    shellTransform,
    shotDir,
    // 手感
    update,
    addRecoil,
    pullTrigger,
    // 状态
    aim,
    cam,
    channels,
    internal: S,
    get state() { return S.state; },
    get ammo() { return S.ammo; },
    get reserve() { return S.reserve; },
    get ads() { return S.adsE; },
    reload,
    tune,
    // 生命周期
    reset,
    setAmmo,
    setVisible,
    stats,
    selfTest,
    // 最近一发快照（预分配，事件/测试直接读）
    lastShot: shotInfo,
    shell,
    anchors: WEAPON_ANCHORS,
    parts: WEAPON_PARTS,
    profiles: WEAPON_PROFILES,
    materialSlots: WEAPON_MATERIAL_SLOTS,
  };

  return api;
}

/* ============================== 模块级自检 ============================== */

/**
 * 模块级自检（node 可跑，无 THREE / 无 DOM）：构造 CPU 路径实例并跑实例 selfTest。
 * 返回 { ok, checks, failed }，与 props/fx/audio/hud/enemy 的模块级入口同形。
 */
export function selfTest() {
  const result = createWeaponKit(null, {}).selfTest();
  return {
    ok: !!result.ok,
    checks: result.checks,
    failed: result.checks.filter((c) => !c.ok).map((c) => c.name),
  };
}
