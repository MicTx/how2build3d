/**
 * enemy-kit.mjs — 敌人：骨骼表→SkinnedMesh / 2 骨 IK + 步态相位表（脚掌落点 9cm 阈值）/
 * 四旋翼飞行（banking/避墙）/ 命中区头 ×2.2 / 残骸池。
 *
 * 出处（上游捕获明文 evidence/frames/app.pretty.js，光栅源 sources/jimao-3a-game/index.html）：
 *   - SkinnedMesh 装配（根骨骼挂 mesh、Skeleton、bind、包围球外扩）：[src:pretty:L55641-L55662]
 *   - 2 骨 IK 解算 q_（外展 + hip/knee 余弦定理，reach 夹紧）：[src:pretty:L55682-L55697]
 *   - 猎犬骨骼表 $v（stand/L1/L2/l0/hipX/footX/footZ/side/fore/footR）：[src:pretty:L55739-L55754]
 *   - 猎犬骨架 Z_（root/body/neck/head/turret/gun/antenna/beacon + 四腿 abd/thigh/shin）：[src:pretty:L55756-L55773]
 *   - 隼机体表 xm（4 旋翼位 / gimbal / gun / muzzle / lamp）：[src:pretty:L56005-L56018]
 *   - 隼规格 Zv（hp45 / boltSpeed70 / burst3 / alt 4-8 / maxSpeed8 / explode 3m 30）：[src:pretty:L56169-L56190]
 *   - 隼 rig 装配（group.rotation.order="YXZ"、bones、lens）：[src:pretty:L56206-L56216]
 *   - 隼命中（y×2.3 椭球 r0.5，part="body"）：[src:pretty:L56346-L56371]
 *   - 隼死亡 v()（断桨 spin ±(5..8)、vel.y+1.5、enemy:killed）：[src:pretty:L56374-L56395]
 *   - 隼坠落 g()（重力 9.5 / 拖曳 0.4 / dieT>5‖y<-3‖撞点 → 爆炸 + retire）：[src:pretty:L56396-L56453]
 *   - 隼巡逻/交战目标（orbitA 0.28/0.5、engage 轨道半径 13..23、flipT 3..8）：[src:pretty:L56434-L56472]
 *   - 隼避墙触须（3 相轮转：墙 26·Y+上 9·Y、地 (2.4-d)·10、顶 1.3 余量、avoid exp(-6dt)）：[src:pretty:L56473-L56497]
 *   - 隼加速度钳 11 + 逐轴去穿 + 贴地钳 +1.1：[src:pretty:L56498-L56520]
 *   - 隼 banking（本体系加速度 ×0.04 夹 ±0.42、lerp 1-exp(-7dt)）+ 旋翼 41·thr·dt：[src:pretty:L56521-L56538]
 *   - 猎犬规格 Kv（hp140 / run4.5 / turn2.5 / lunge 3m 15 / replan .6 / smokeBelow .4）：[src:pretty:L56634-L56650]
 *   - IK 解复用 bm{abd,hip,knee,reach} + 步态对角相位表 wm=[[0,3],[1,2]] + 弹簧 xa：[src:pretty:L56674-L56679]
 *   - 猎犬命中区（头球 r0.155 → part="weak"，双胶囊 r0.27/0.25 part="body"）：[src:pretty:L56861-L56870]
 *   - 脚掌落点（footWorld：side*footX/footZ 按 yaw 旋转）：[src:pretty:L56880-L56883]
 *   - 猎犬开火（enemyShot + tracer/muzzleFlash + enemy:fire + 弹簧后坐）：[src:pretty:L57200-L57212]
 *   - 步态 H（移动 0.09 / 静止 0.035 阈值、对组惩罚 ×1.25、smoothstep 摆动、enemy:step）：[src:pretty:L57214-L57259]
 *   - 躯干姿态 O（足高→pitch/roll/高度弹簧 160/17·130/15·110/13、逐腿 IK、headPos）：[src:pretty:L57260-L57319]
 *   - 猎犬死亡 q()（侧倒 dieRoll、addWreck）：[src:pretty:L57321-L57347]
 *   - 猎犬尸体 wreck 标记：[src:pretty:L57390-L57390]
 *   - 射线-球 sM / 射线-胶囊 nM（线段最近点再走球测试）：[src:pretty:L57400-L57412] [src:pretty:L57417-L57425]
 *   - 敌人总配置 Ui（pool gull 10 / hound 8、maxWrecks 5、maxBolts 32；感知参数在 combat-kit）：[src:pretty:L57426-L57444]
 *   - 残骸池 addWreck（超 5 逐出最旧）：[src:pretty:L57601-L57605]
 *   - spawn（池中取空闲 → _activate → enemy:spawn）：[src:pretty:L57738-L57751]
 *   - 受击 knockback（隼 roll/pitch ±0.5/0.4；犬 sP.v 2.4·Δ·weak1.6）：[src:pretty:L56280-L56289] [src:pretty:L56790-L56790]
 *
 * 合同（与 combat-kit / props-kit 同风格）：
 *   - 纯 JS、零引擎依赖；THREE 作为**参数注入**（createEnemyKit(THREE, opts)，不顶层 import）；
 *     无 THREE 时 rig 不落网格，但步态/IK/飞行/命中区/残骸/刷兵全路径仍可 node 自测。
 *   - 感知与攻击令牌**只对接 assets/combat-kit.mjs 既有 createAgent/updatePerception/releaseToken/
 *     alert/fireBolt/enemyShot/playerShot**，不重写感知/令牌；命中 ×2.2 由 combat-kit.playerShot
 *     对 part==="weak" 施加（combat-kit.mjs:196-197），本 kit 只负责把头球报成 "weak"。
 *   - 确定性：rng 注入（opts.rng），默认由 seed*2654435761 + mulberry32 派生（同 props-kit）；
 *     kit 内零 Math.random。
 *   - 热循环零分配：update/raycast/IK/步态全部写 kit 预分配 scratch 与敌人自有字段；
 *     事件载荷逐敌预分配（消费者不得保留引用，需留存请自行拷贝）。
 *   - 数量规格（harness/element-manifest.json enemies 族 floor）：enemyTypes ≥1（本 kit 交付 2 类）、
 *     enemySpawns ≥6（setSpawnPoints 注册，stats 实测）、enemyRigs ≥1（每实例一块 SkinnedMesh）。
 *
 * 用法：
 *   import { createEnemyKit } from "./enemy-kit.mjs";
 *   import { createCombatKit } from "./combat-kit.mjs";
 *   const combat = createCombatKit({ physics, events });
 *   const enemies = createEnemyKit(THREE, { combat, physics, events, seed: 7, mats, fx });
 *   enemies.setSpawnPoints([ { pos:{x:2,y:0,z:8}, kind:"ground" }, … ]);   // ≥6 点
 *   const e = enemies.spawn("hound", { x: 0, y: 0, z: 4 });
 *   // 每帧（与 combat.autoBattle 的 tick 同一循环）：
 *   enemies.update(dt, player);   // player = { pos, alive }
 *   combat.updateBolts(dt);       // 隼弹道由 combat-kit 弹道池推进
 *   const hit = enemies.raycast(origin, dir, 300);   // part==="weak" 头 ×2.2
 *   combat.playerShot(origin, dir, { enemyRaycast: () => hit });       // → ×2.2 结算
 *   enemies.stats();              // enemyTypes/enemySpawns/enemyRigs/…（manifest 对账指标）
 */

/* ============================== 1. 常量与规格表 ============================== */

/**
 * 类型规格：gull（四旋翼）= 上游 Zv，hound（四足）= 上游 Kv；pool/maxWrecks = 上游 Ui。
 * 感知/令牌参数（sightRange 45 等）归 combat-kit.TUNE，本表不重复。
 * [src:pretty:L56169-L56190] [src:pretty:L56634-L56650] [src:pretty:L57426-L57444]
 */
export const ENEMY_TUNE_DEFAULTS = {
  poolGulls: 10,
  poolHounds: 8,
  maxWrecks: 5,
  maxBolts: 32,
  gull: {
    hp: 45, boltDamage: 7, boltSpeed: 70, burst: 3, burstGap: 0.12,
    telegraph: 0.55, cooldown: [1.9, 3.3], rangeMin: 12, rangeMax: 25,
    altMin: 4, altMax: 8, maxSpeed: 8, patrolSpeed: 3, accel: 11,
    spreadFar: 0.065, spreadNear: 0.018, fireRange: 42,
    explodeRadius: 3, explodeDamage: 30,
  },
  hound: {
    hp: 140, shotDamage: 5, burst: 4, burstGap: 0.11,
    telegraph: 0.5, cooldown: [1.8, 3], runSpeed: 4.5, stalkSpeed: 2,
    patrolSpeed: 1.5, accel: 7, turnRate: 2.5, rangeMin: 8, rangeMax: 18,
    spreadFar: 0.12, spreadNear: 0.045, lungeRange: 3, lungeDamage: 15,
    lungeCooldown: 3.5, lungeSpeed: 9.5, replan: 0.6, smokeBelow: 0.4,
  },
};

/**
 * 猎犬骨骼尺寸表（上游 $v）。IK 与步态全部由本表驱动。
 * [src:pretty:L55739-L55754]
 */
export const HOUND_RIG = Object.freeze({
  stand: 0.72,
  L1: 0.4,
  L2: 0.42,
  l0: 0.075,
  hipX: 0.165,
  hipY: -0.01,
  hipZ: 0.4,
  footX: 0.275,
  footZ: Object.freeze([0.37, 0.37, -0.42, -0.42]),
  legs: Object.freeze(["FL", "FR", "RL", "RR"]),
  side: Object.freeze([1, -1, 1, -1]),
  fore: Object.freeze([1, 1, -1, -1]),
  muzzle: Object.freeze([0, 0, 0.43]),
  eye: Object.freeze([0, 0, 0.14]),
  footR: 0.046,
});

/** 隼机体安装点（上游 xm）。[src:pretty:L56005-L56018] */
export const GULL_HULL = Object.freeze({
  rotors: Object.freeze([
    Object.freeze([0.33, 0.035, 0.3]),
    Object.freeze([-0.33, 0.035, 0.3]),
    Object.freeze([0.33, 0.035, -0.3]),
    Object.freeze([-0.33, 0.035, -0.3]),
  ]),
  gimbal: Object.freeze([0, -0.095, 0.275]),
  ball: Object.freeze([0, -0.072, 0]),
  gun: Object.freeze([0, -0.085, -0.1]),
  muzzle: Object.freeze([0, -0.032, 0.27]),
  lamp: Object.freeze([0, -0.066, 0.025]),
});

/**
 * 步态相位表：对角步 wm=[[0,3],[1,2]]；脚掌落点阈值（移动 0.09m / 静止 0.035m）；
 * 摆动时长随速度 0.27→0.14s；抬脚高度 0.065+min(0.09, speed*0.02)。
 * [src:pretty:L56674-L56679] [src:pretty:L57233-L57235]
 */
export const GAIT = Object.freeze({
  pairs: Object.freeze([Object.freeze([0, 3]), Object.freeze([1, 2])]),
  stepThreshold: 0.09,       // 移动中迈步阈值（9cm）
  idleThreshold: 0.035,      // 静止 0.25s 后的姿态微调阈值
  idleGrace: 0.25,
  swingDurMax: 0.27,
  swingDurMin: 0.14,
  swingDurK: 0.026,          // dur = clamp(0.27 − speedEff*0.026, 0.14, 0.27)
  pairRepeatPenalty: 1.25,   // 连续同侧对惩罚
  liftBase: 0.065,
  liftMax: 0.09,
  liftK: 0.02,
  stepKick: 0.12,            // 落脚 sY.v 冲量 = 0.12 + speed*0.03
  stepKickK: 0.03,
});

/** 躯干弹簧（k/c，xa 积分）与命中区尺寸。[src:pretty:L57274-L57282] [src:pretty:L56861-L56870] [src:pretty:L56346-L56371] */
export const HIT_ZONES = Object.freeze({
  houndHeadR: 0.155,         // 头球 → part "weak"（×2.2 在 combat-kit.playerShot）
  houndBodyR: 0.27,
  houndBodyR2: 0.25,
  gullEllipsoidR: 0.5,
  gullYStretch: 2.3,
});

/* ============================== 2. 纯数学（零分配） ============================== */

const PI = Math.PI;
const TAU = PI * 2;

/** 角度差归一（上游 K_/Mm）。[src:pretty:L56199-L56202] [src:pretty:L56669-L56672] */
export function angleDelta(target, current) {
  let t = (target - current) % TAU;
  if (t > PI) t -= TAU;
  else if (t < -PI) t += TAU;
  return t;
}

/** clamp（上游 uo）。[src:pretty:L56673-L56673] */
export function clampf(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 弹簧阻尼一步（上游 xa：v += ((目标−x)*k − v*c)*dt; x += v*dt）。[src:pretty:L56678-L56679] */
export function springStep(s, target, k, c, dt) {
  s.v += ((target - s.x) * k - s.v * c) * dt;
  s.x += s.v * dt;
  return s.x;
}

/**
 * 2 骨 IK（外展 + 平面双连杆，写 out{abd,hip,knee,reach}；上游 q_ 逐行移植）。
 * [src:pretty:L55682-L55697]
 */
export function solveIK(out, x, y, z, side, l0, L1, L2) {
  const d2 = x * x + y * y;
  const c = Math.sqrt(Math.max(d2 - l0 * l0, 1e-6));
  let abd = Math.atan2(y, x) - Math.atan2(-c, side * l0);
  abd = abd > PI ? abd - TAU : abd < -PI ? abd + TAU : abd;
  out.abd = abd;
  let u = Math.hypot(c, z);
  const uMax = (L1 + L2) * 0.995;
  const uMin = Math.abs(L1 - L2) + 0.03;
  out.reach = u / (L1 + L2);
  if (u > uMax) u = uMax;
  else if (u < uMin) u = uMin;
  const pitch = Math.atan2(z, c);
  const dCos = (L1 * L1 + u * u - L2 * L2) / (2 * L1 * u);
  const kCos = (L1 * L1 + L2 * L2 - u * u) / (2 * L1 * L2);
  const g = Math.acos(dCos < -1 ? -1 : dCos > 1 ? 1 : dCos);
  const kv = Math.acos(kCos < -1 ? -1 : kCos > 1 ? 1 : kCos);
  out.hip = g - pitch;
  out.knee = -(PI - kv);
  return out;
}

/**
 * 射线-球（上游 sM：t<0 / 超距 / 不比当前最近近 → 否决；写 hit{dist,point,normal}）。
 * [src:pretty:L57400-L57412]
 */
function raySphereT(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxDist, hit) {
  const rx = ox - cx, ry = oy - cy, rz = oz - cz;
  const b = rx * dx + ry * dy + rz * dz;
  const cc = rx * rx + ry * ry + rz * rz - r * r;
  const h = b * b - cc;
  if (h < 0) return false;
  const t = -b - Math.sqrt(h);
  if (t < 0 || t > maxDist || t >= hit.dist) return false;
  hit.dist = t;
  hit.px = ox + dx * t; hit.py = oy + dy * t; hit.pz = oz + dz * t;
  let nx = hit.px - cx, ny = hit.py - cy, nz = hit.pz - cz;
  const il = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1e-6);
  hit.nx = nx * il; hit.ny = ny * il; hit.nz = nz * il;
  return true;
}

/**
 * 射线-胶囊（上游 nM：线段上对射线出发点最近点，退化为该点球测试）。
 * [src:pretty:L57417-L57425]
 */
function rayCapsuleT(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, r, maxDist, hit) {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const wx = ox - ax, wy = oy - ay, wz = oz - az;
  const a = ux * ux + uy * uy + uz * uz;
  const l = ux * dx + uy * dy + uz * dz;
  const c = ux * wx + uy * wy + uz * wz;
  const u = dx * wx + dy * wy + dz * wz;
  const h = a - l * l;
  let f = h > 1e-8 ? (c - l * u) / h : 0;
  f = f < 0 ? 0 : f > 1 ? 1 : f;
  return raySphereT(ox, oy, oz, dx, dy, dz, ax + ux * f, ay + uy * f, az + uz * f, r, maxDist, hit);
}

/* ============================== 3. 确定性 rng ============================== */

/** 上游确定性 rng（$a）：seed*2654435761 后 mulberry32（与 props-kit 同源）。[src:pretty:L35154-L35161] */
export function createRng(seed) {
  let s = (Math.floor(seed) | 0) * 2654435761;
  s = (s + 1831565813) | 0;
  return function rng() {
    s = (s + 1831565813) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ============================== 4. 骨骼表（纯数据，无需 THREE） ============================== */

/**
 * 骨骼表：name/parent/pos[x,y,z]。hound = 上游 Z_ 骨架（8 躯干骨 + 4×3 腿骨）；
 * gull = 上游 xm 安装位推导的 7 骨（body/rotor0-3/gimbal/gun）。
 * [src:pretty:L55756-L55773] [src:pretty:L56005-L56018]
 */
export const SKELETONS = Object.freeze({
  hound: (() => {
    const r = HOUND_RIG;
    const bones = [
      { name: "root", parent: null, pos: [0, 0, 0] },
      { name: "body", parent: "root", pos: [0, r.stand, 0] },
      { name: "neck", parent: "body", pos: [0, 0.06, 0.49] },
      { name: "head", parent: "neck", pos: [0, 0.13, 0.12] },
      { name: "turret", parent: "body", pos: [0, 0.152, -0.03] },
      { name: "gun", parent: "turret", pos: [0, 0.095, 0.02] },
      { name: "antenna", parent: "body", pos: [-0.105, 0.15, -0.46] },
      { name: "beacon", parent: "body", pos: [0.105, 0.2, -0.455] },
    ];
    for (let n = 0; n < 4; n++) {
      const leg = r.legs[n], side = r.side[n], fore = r.fore[n];
      bones.push({ name: "abd" + leg, parent: "body", pos: [side * r.hipX, r.hipY, fore * r.hipZ] });
      bones.push({ name: "thigh" + leg, parent: "abd" + leg, pos: [side * r.l0, 0, 0] });
      bones.push({ name: "shin" + leg, parent: "thigh" + leg, pos: [0, -r.L1, 0] });
    }
    return Object.freeze(bones);
  })(),
  gull: (() => {
    const h = GULL_HULL;
    const bones = [
      { name: "root", parent: null, pos: [0, 0, 0] },
      { name: "body", parent: "root", pos: [0, 0, 0] },
    ];
    for (let n = 0; n < 4; n++) {
      bones.push({ name: "rotor" + n, parent: "body", pos: [h.rotors[n][0], h.rotors[n][1], h.rotors[n][2]] });
    }
    bones.push({ name: "gimbal", parent: "body", pos: [h.gimbal[0], h.gimbal[1], h.gimbal[2]] });
    bones.push({ name: "gun", parent: "gimbal", pos: [h.gun[0], h.gun[1], h.gun[2]] });
    return Object.freeze(bones);
  })(),
});

/**
 * 零件表（纯数据描述，build 时才落成几何）：kind box/cyl/disc，s=尺寸，pos 骨骼局部，rot 可选欧拉。
 * 材质槽沿用上游 build(["shell","metal","glow","lens"]) 顺序。[src:pretty:L56004-L56004] [src:pretty:L56203-L56203]
 * 猎犬外壳件尺寸取上游 Z_ 主体段；腿件由 HOUND_RIG 尺寸驱动（IK 与外观一致）。
 */
const PARTS = {
  hound: [
    { bone: "body", slot: "metal", kind: "box", s: [0.27, 0.2, 0.98], pos: [0, -0.01, 0] },
    { bone: "body", slot: "shell", kind: "box", s: [0.35, 0.05, 0.3], pos: [0, 0.125, 0.33] },
    { bone: "body", slot: "shell", kind: "box", s: [0.35, 0.05, 0.36], pos: [0, 0.125, -0.012] },
    { bone: "body", slot: "shell", kind: "box", s: [0.1, 0.052, 0.36], pos: [0, 0.126, -0.012] },
    { bone: "body", slot: "metal", kind: "box", s: [0.31, 0.03, 0.25], pos: [0, 0.112, -0.335] },
    { bone: "body", slot: "shell", kind: "box", s: [0.032, 0.15, 0.31], pos: [0.15, 0.022, -0.075] },
    { bone: "body", slot: "shell", kind: "box", s: [0.032, 0.15, 0.31], pos: [-0.15, 0.022, -0.075] },
    { bone: "body", slot: "shell", kind: "box", s: [0.034, 0.042, 0.46], pos: [0.151, -0.078, 0] },
    { bone: "body", slot: "shell", kind: "box", s: [0.034, 0.042, 0.46], pos: [-0.151, -0.078, 0] },
    { bone: "body", slot: "metal", kind: "box", s: [0.3, 0.012, 0.02], pos: [0, 0.186, -0.24] },
    { bone: "body", slot: "metal", kind: "box", s: [0.3, 0.012, 0.02], pos: [0, 0.186, -0.43] },
    { bone: "head", slot: "shell", kind: "box", s: [0.16, 0.13, 0.22], pos: [0, 0.02, 0.04] },
    { bone: "head", slot: "glow", kind: "box", s: [0.08, 0.05, 0.02], pos: [0, 0.03, 0.155] },
    { bone: "turret", slot: "metal", kind: "box", s: [0.18, 0.1, 0.18], pos: [0, 0.02, 0] },
    { bone: "gun", slot: "metal", kind: "cyl", s: [0.03, 0.42], pos: [0, 0.01, 0.22], rot: [PI / 2, 0, 0] },
    { bone: "antenna", slot: "metal", kind: "cyl", s: [0.006, 0.3], pos: [0, 0.15, 0] },
    { bone: "beacon", slot: "glow", kind: "box", s: [0.04, 0.05, 0.04], pos: [0, 0.02, 0] },
    // 四腿：thigh/shin 圆柱 + 脚掌盘，尺寸由骨骼表驱动
    { bone: "thighFL", slot: "metal", kind: "cyl", s: [0.03, 1], pos: [0, 0, 0] },
    { bone: "thighFR", slot: "metal", kind: "cyl", s: [0.03, 1], pos: [0, 0, 0] },
    { bone: "thighRL", slot: "metal", kind: "cyl", s: [0.03, 1], pos: [0, 0, 0] },
    { bone: "thighRR", slot: "metal", kind: "cyl", s: [0.03, 1], pos: [0, 0, 0] },
    { bone: "shinFL", slot: "metal", kind: "cyl", s: [0.024, 1], pos: [0, 0, 0] },
    { bone: "shinFR", slot: "metal", kind: "cyl", s: [0.024, 1], pos: [0, 0, 0] },
    { bone: "shinRL", slot: "metal", kind: "cyl", s: [0.024, 1], pos: [0, 0, 0] },
    { bone: "shinRR", slot: "metal", kind: "cyl", s: [0.024, 1], pos: [0, 0, 0] },
    { bone: "shinFL", slot: "shell", kind: "disc", s: [1, 0.03], pos: [0, 0, 0] },
    { bone: "shinFR", slot: "shell", kind: "disc", s: [1, 0.03], pos: [0, 0, 0] },
    { bone: "shinRL", slot: "shell", kind: "disc", s: [1, 0.03], pos: [0, 0, 0] },
    { bone: "shinRR", slot: "shell", kind: "disc", s: [1, 0.03], pos: [0, 0, 0] },
  ],
  gull: [
    { bone: "body", slot: "shell", kind: "box", s: [0.34, 0.2, 0.62], pos: [0, 0, 0] },
    { bone: "body", slot: "metal", kind: "box", s: [0.72, 0.025, 0.03], pos: [0, 0.035, 0.3] },
    { bone: "body", slot: "metal", kind: "box", s: [0.72, 0.025, 0.03], pos: [0, 0.035, -0.3] },
    { bone: "body", slot: "metal", kind: "box", s: [0.03, 0.025, 0.66], pos: [0.33, 0.035, 0] },
    { bone: "body", slot: "metal", kind: "box", s: [0.03, 0.025, 0.66], pos: [-0.33, 0.035, 0] },
    { bone: "rotor0", slot: "metal", kind: "disc", s: [0.17, 0.012], pos: [0, 0, 0] },
    { bone: "rotor1", slot: "metal", kind: "disc", s: [0.17, 0.012], pos: [0, 0, 0] },
    { bone: "rotor2", slot: "metal", kind: "disc", s: [0.17, 0.012], pos: [0, 0, 0] },
    { bone: "rotor3", slot: "metal", kind: "disc", s: [0.17, 0.012], pos: [0, 0, 0] },
    { bone: "gimbal", slot: "metal", kind: "box", s: [0.1, 0.1, 0.1], pos: [0, 0.02, 0] },
    { bone: "gun", slot: "metal", kind: "cyl", s: [0.028, 0.24], pos: [0, 0.01, 0.08], rot: [PI / 2, 0, 0] },
    { bone: "body", slot: "glow", kind: "box", s: [0.06, 0.04, 0.06], pos: [0, -0.066, 0.025] },
  ],
};

/** 材质槽 → build 顺序（上游 build(["shell","metal","glow","lens"])）。 */
const SLOTS = Object.freeze(["shell", "metal", "glow", "lens"]);

const DEFAULT_SLOT_MATERIAL = Object.freeze({
  shell: Object.freeze({ color: 0x9aa3ad, roughness: 0.62, metalness: 0.25 }),
  metal: Object.freeze({ color: 0x565d66, roughness: 0.45, metalness: 0.8 }),
  glow: Object.freeze({ color: 0x111311, roughness: 0.4, metalness: 0.1, emissive: 0x39ff88, emissiveIntensity: 1.4 }),
  lens: Object.freeze({ color: 0x86d8ff, roughness: 0.2, metalness: 0.1, emissive: 0x86d8ff, emissiveIntensity: 1.8 }),
});

/* ============================== 5. 网格装配（需要 THREE 注入） ============================== */

/**
 * 骨骼表 → Bone 层级 + 单一 SkinnedMesh（零件几何合并 + skinIndex/skinWeight + Skeleton + bind）。
 * 上游装配语义：根骨骼挂到 mesh、new Skeleton(bones)、mesh.bind(skeleton)、包围球外扩。
 * [src:pretty:L55641-L55662]
 */
function buildRig(THREE, type, mats) {
  if (!THREE) throw new Error("enemy-kit: buildRig requires THREE (inject as first factory argument)");
  const table = SKELETONS[type];
  const bones = [];
  const byName = Object.create(null);
  const idxByName = Object.create(null);
  for (let i = 0; i < table.length; i++) {
    const def = table[i];
    const bone = new THREE.Bone();
    bone.name = def.name;
    bone.position.set(def.pos[0], def.pos[1], def.pos[2]);
    if (def.parent) {
      const p = byName[def.parent];
      if (!p) throw new Error("enemy-kit: bone '" + def.name + "' parent '" + def.parent + "' missing");
      p.add(bone);
    }
    bones.push(bone);
    byName[def.name] = bone;
    idxByName[def.name] = i;
  }

  /* 零件几何：先算总量再一次性填充（装配路径，允许一次性分配） */
  const parts = PARTS[type];
  const geoList = [];
  let total = 0, totalIdx = 0;
  for (const part of parts) {
    let g;
    if (part.kind === "box") {
      g = new THREE.BoxGeometry(part.s[0], part.s[1], part.s[2]);
    } else if (part.kind === "cyl") {
      let len = part.s[1];
      if (len === 1) len = part.bone.startsWith("thigh") ? HOUND_RIG.L1 : HOUND_RIG.L2 - 0.08; // 腿件随骨骼表
      g = new THREE.CylinderGeometry(part.s[0], part.s[0] * 0.85, len, 10);
      g.translate(0, -len / 2 - 0.01, 0);
    } else { // disc
      let r = part.s[0];
      if (r === 1) r = HOUND_RIG.footR; // 脚掌盘随骨骼表
      g = new THREE.CylinderGeometry(r, r, part.s[1], 12);
    }
    if (part.rot) g.rotateX(part.rot[0]);
    g.translate(part.pos[0], part.pos[1] + (part.kind === "disc" && part.s[0] === 1 ? -HOUND_RIG.L2 + HOUND_RIG.footR * 0.9 : 0), part.pos[2]);
    const n = g.attributes.position.count;
    const skinIndex = new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4);
    const skinWeight = new THREE.Float32BufferAttribute(new Float32Array(n * 4), 4);
    const bi = idxByName[part.bone];
    for (let i = 0; i < n; i++) {
      skinIndex.setXYZ(i, bi, 0, 0, 0);
      skinWeight.setXYZW(i, 1, 0, 0, 0);
    }
    g.setAttribute("skinIndex", skinIndex);
    g.setAttribute("skinWeight", skinWeight);
    geoList.push({ g, n, idx: g.index.count, matSlot: SLOTS.indexOf(part.slot) });
    total += n; totalIdx += g.index.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(total * 3), 3));
  merged.setAttribute("normal", new THREE.Float32BufferAttribute(new Float32Array(total * 3), 3));
  merged.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(total * 2), 2));
  merged.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(total * 4), 4));
  merged.setAttribute("skinWeight", new THREE.Float32BufferAttribute(new Float32Array(total * 4), 4));
  merged.setIndex(new THREE.Uint16BufferAttribute(new Uint16Array(totalIdx), 1));
  let vOff = 0, iOff = 0;
  for (const item of geoList) {
    const src = item.g;
    for (let name of ["position", "normal", "uv", "skinIndex", "skinWeight"]) {
      const a = src.getAttribute(name), b = merged.getAttribute(name);
      for (let i = 0; i < item.n; i++) {
        for (let k = 0; k < a.itemSize; k++) b.array[(vOff + i) * a.itemSize + k] = a.array[i * a.itemSize + k];
      }
    }
    const idx = src.index.array;
    for (let i = 0; i < item.idx; i++) merged.index.array[iOff + i] = idx[i] + vOff;
    merged.addGroup(iOff, item.idx, item.matSlot);
    vOff += item.n; iOff += item.idx;
    src.dispose();
  }
  merged.computeBoundingSphere();
  if (merged.boundingSphere) merged.boundingSphere.radius *= 2; // 蒙皮形变余量（上游同义 L55655-L55657）

  const materials = SLOTS.map((slot) => {
    if (mats && typeof mats.get === "function") return mats.get(slot);
    const d = DEFAULT_SLOT_MATERIAL[slot];
    return new THREE.MeshStandardMaterial({
      color: d.color, roughness: d.roughness, metalness: d.metalness,
      emissive: d.emissive !== undefined ? d.emissive : 0x000000,
      emissiveIntensity: d.emissiveIntensity !== undefined ? d.emissiveIntensity : 1,
    });
  });
  const mesh = new THREE.SkinnedMesh(merged, materials);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false; // 蒙皮变形，交给包围球外扩的保守界（上游显式大球）
  for (const b of bones) if (!b.parent) mesh.add(b); // 根骨骼挂 mesh（上游 L55649-L55651）
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton); // [src:pretty:L55653-L55654]

  const group = new THREE.Group();
  group.rotation.order = "YXZ"; // 上游隼装配同序 [src:pretty:L56206-L56206]
  group.add(mesh);
  return { group, mesh, bones: byName, skeleton };
}

/* ============================== 6. 敌人 kit 工厂 ============================== */

/**
 * createEnemyKit(THREE, opts)
 *   - THREE   可选；只有 rig 落网格需要。null 时行为/IK/命中区/残骸/刷兵全可 node 自测。
 *   - opts.combat  必填：assets/combat-kit.mjs 实例（createAgent/updatePerception/releaseToken/
 *                  alert/fireBolt/enemyShot 只对接，不重写）。
 *   - opts.physics 必填：raycast(origin,dir,max) + groundHeight(x,z,hint)（physics-kit 兼容即可）。
 *   - opts.events  可选：默认取 combat.events，缺省 noop。
 *   - opts.rng/seed：rng 注入；默认 seed 确定性派生；kit 内零 Math.random。
 *   - opts.tune：合并 ENEMY_TUNE_DEFAULTS。
 *   - opts.mats：sl-surface 材质工厂（mats.get(slot)）；缺省用内置 MeshStandardMaterial（需 THREE）。
 *   - opts.fx：fx-kit（tracer/muzzleFlash/explosion/smoke，全部守卫调用，缺省跳过）。
 */
export function createEnemyKit(THREE = null, opts = {}) {
  const combat = opts.combat;
  const physics = opts.physics;
  if (!combat || typeof combat.createAgent !== "function" || typeof combat.updatePerception !== "function") {
    throw new Error("enemy-kit requires opts.combat (combat-kit instance with createAgent/updatePerception)");
  }
  if (!physics || typeof physics.raycast !== "function" || typeof physics.groundHeight !== "function") {
    throw new Error("enemy-kit requires opts.physics (raycast + groundHeight, physics-kit compatible)");
  }
  const TUNE = { ...ENEMY_TUNE_DEFAULTS, ...opts.tune };
  const events = opts.events || (combat.events && typeof combat.events.emit === "function" ? combat.events : { on() {}, emit() {} });
  const rng = opts.rng || createRng(opts.seed === undefined ? 0 : opts.seed);
  const fx = opts.fx && typeof opts.fx.tracer === "function" ? opts.fx : null;
  const mats = opts.mats || null;

  const statsBag = {
    spawnsTotal: 0, kills: 0, steps: 0, boltsFired: 0, shotsFired: 0,
    lunges: 0, rays: 0, wreckEvictions: 0, wallAvoids: 0, gaitSwings: 0,
  };

  /* ---- 热路径 scratch（kit 实例级预分配；update/raycast 内零 new） ---- */
  const SCR = {
    hit: { dist: 0, enemy: null, part: "", px: 0, py: 0, pz: 0, nx: 0, ny: 0, nz: 0, point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } },
    aim: { x: 0, y: 0, z: 0 },
    dir: { x: 0, y: 0, z: 1 },
    dirFwd: { x: 0, y: 0, z: 1 },
    dirDown: { x: 0, y: -1, z: 0 },
    dirUp: { x: 0, y: 1, z: 0 },
    dirAxis: { x: 0, y: 0, z: 0 },
    ik: { abd: 0, hip: 0, knee: 0, reach: 0 },
    foot: { x: 0, y: 0, z: 0 },
    out: null, // 射线结果（raycast 返回 SCR.hit 的规范化视图）
    muzzle: { x: 0, y: 0, z: 0 },
    dmgPoint: { x: 0, y: 0, z: 0 },
  };

  /* ---- 池：gull×poolGulls / hound×poolHounds（上游 Ui）[src:pretty:L57440-L57441] ---- */
  const TYPES = ["gull", "hound"];
  const pools = { gull: [], hound: [] };
  const active = [];
  const wrecks = [];
  let idSeq = 0;
  let simT = 0;

  function makeEnemy(type, rig) {
    const e = {
      id: 0, type, active: false, alive: false, wreck: false, hp: 0,
      pos: { x: 0, y: 0, z: 0 },
      vel: type === "gull" ? { x: 0, y: 0, z: 0 } : null,
      yaw: 0, pitch: 0, roll: 0,
      home: { x: 0, y: 0, z: 0 },
      lastKnownX: 0, lastKnownY: 0, lastKnownZ: 0,
      phase: 0, ceil: 1e9, ceilT: 0, flipT: 0,
      avoid: type === "gull" ? { x: 0, y: 0, z: 0 } : null,
      orbitA: 0, orbitDir: 1, orbitR: 16, alt: 6, patrolR: 10, hoverY: 0, hoverFixed: false,
      feeler: 0, thr: 1, lostRotor: -1, dieT: 0, spin: 0, smokeT: 0, sink: 0,
      atk: "idle", atkT: 0, cool: 1, shots: 0, lungeT: 0, lunging: 0,
      speed: 0, prevSpeed: 0, yawRate: 0, crouch: 0,
      sY: { x: 0, v: 0 }, sP: { x: 0, v: 0 }, sR: { x: 0, v: 0 }, sL: { x: 0, v: 0 },
      sA: { x: 0, v: 0 }, sA2: { x: 0, v: 0 },
      sw: -1, swT: 0, swDur: GAIT.swingDurMax, lift: 0, lastPair: -1, idleT: 0,
      tyaw: 0, tpitch: 0, hyaw: 0, hpitch: 0,
      goalX: 0, goalZ: 0, hasGoal: false, planT: 0, stuckT: 0, wp: 0,
      patrolLine: null, dieRoll: 0, diePitch: 0, vy: 0,
      feet: null, headPos: { x: 0, y: 0, z: 0 },
      rig, group: rig ? rig.group : null,
      agent: null,
      eye: { x: 0, y: 0, z: 0 },       // agent.customEye 复用对象
      fwd: { x: 0, z: 1 },             // agent.fwd 复用对象
      _evHit: { enemy: null, point: { x: 0, y: 0, z: 0 }, part: "body" },
      _evFire: { enemy: null, pos: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: 0 }, type },
      _evKilled: { enemy: null, pos: { x: 0, y: 0, z: 0 }, type, part: "body" },
      _evStep: { enemy: null, pos: { x: 0, y: 0, z: 0 }, type, speed: 0 },
      _evSpawn: { enemy: null },
      _evExplode: { pos: { x: 0, y: 0, z: 0 }, radius: TUNE.gull.explodeRadius, damage: TUNE.gull.explodeDamage, type },
      _evDamaged: { damage: 0, from: { x: 0, y: 0, z: 0 } },
      damage(amount, point, dir, part) { return applyDamage(e, amount, point, dir, part); },
    };
    if (type === "hound") {
      e.feet = [];
      for (let i = 0; i < 4; i++) {
        e.feet.push({
          px: 0, py: 0, pz: 0,                       // 当前落点
          fx: 0, fy: 0, fz: 0,                       // 摆动起点 from
          tx: 0, ty: 0, tz: 0,                       // 摆动目标 to
        });
      }
    }
    return e;
  }

  for (let i = 0; i < TUNE.poolGulls; i++) pools.gull.push(makeEnemy("gull", THREE ? buildRig(THREE, "gull", mats) : null));
  for (let i = 0; i < TUNE.poolHounds; i++) pools.hound.push(makeEnemy("hound", THREE ? buildRig(THREE, "hound", mats) : null));

  /* ---- 感知适配：agent 只建一次，pos/eye/fwd 全部别名复用 ---- */
  function bindAgent(e) {
    const a = combat.createAgent({ pos: e.pos, eye: e.eye, fwd: e.fwd, passive: false });
    a.customEye = e.eye; // losCheck 优先用 customEye（combat-kit.mjs:74）
    e.agent = a;
    return a;
  }
  for (const type of TYPES) for (const e of pools[type]) bindAgent(e);

  /** 感知前置：把敌人状态同步进 combat agent（零分配，别名更新）。 */
  function syncAgent(e) {
    const a = e.agent;
    if (e.type === "gull") {
      e.eye.x = e.pos.x; e.eye.y = e.pos.y - 0.17; e.eye.z = e.pos.z;
    } else {
      // 犬眼位：头部附近（无 rig 时解析近似，有 rig 时用 headPos）
      const hx = e.rig ? e.headPos.x : e.pos.x + Math.sin(e.yaw) * HOUND_RIG.eye[2];
      const hy = e.rig ? e.headPos.y : e.pos.y + HOUND_RIG.stand + 0.35;
      const hz = e.rig ? e.headPos.z : e.pos.z + Math.cos(e.yaw) * HOUND_RIG.eye[2];
      e.eye.x = hx; e.eye.y = hy; e.eye.z = hz;
    }
    e.fwd.x = Math.sin(e.yaw); e.fwd.z = Math.cos(e.yaw);
    return a;
  }

  /* ---- 激活 / 停用（上游 _activate/_deactivate 语义）[src:pretty:L56290-L56307] [src:pretty:L56840-L56855] ---- */
  function activate(e, pos, o = {}) {
    e.id = ++idSeq;
    e.active = true;
    e.alive = true;
    e.wreck = false;
    e.hp = TUNE[e.type].hp;
    e.pos.x = pos.x; e.pos.y = pos.y; e.pos.z = pos.z;
    e.yaw = o.yaw || 0; e.pitch = 0; e.roll = 0;
    e.phase = rng() * 6.283;
    e.dieT = 0; e.spin = 0; e.sink = 0; e.lostRotor = -1;
    e.atk = "idle"; e.atkT = 0; e.cool = 0.6 + rng() * 0.8; e.shots = 0;
    e.lungeT = 0; e.lunging = 0;
    e.sw = -1; e.swT = 0; e.lastPair = -1; e.idleT = 0;
    e.sY.x = 0; e.sY.v = 0; e.sP.x = 0; e.sP.v = 0; e.sR.x = 0; e.sR.v = 0;
    e.sL.x = 0; e.sL.v = 0; e.sA.x = 0; e.sA.v = 0; e.sA2.x = 0; e.sA2.v = 0;
    e.tyaw = 0; e.tpitch = 0; e.hyaw = 0; e.hpitch = 0;
    e.speed = 0; e.prevSpeed = 0; e.yawRate = 0; e.crouch = 0;
    e.stuckT = 0; e.planT = 0; e.wp = 0; e.hasGoal = false;
    e.patrolLine = o.patrolLine || null;
    e.smokeT = 0;
    if (e.type === "gull") {
      e.vel.x = 0; e.vel.y = 0; e.vel.z = 0;
      e.avoid.x = 0; e.avoid.y = 0; e.avoid.z = 0;
      e.orbitA = rng() * TAU;
      e.orbitDir = rng() < 0.5 ? -1 : 1;
      e.orbitR = o.orbitRadius !== undefined ? o.orbitRadius : 16;
      e.alt = o.hoverY !== undefined ? o.hoverY : clampf(pos.y || TUNE.gull.altMax, TUNE.gull.altMin, TUNE.gull.altMax);
      e.hoverY = e.alt;
      e.hoverFixed = o.hover != null;
      e.patrolR = o.patrolRadius !== undefined ? o.patrolRadius : 10;
      e.ceil = 1e9; e.ceilT = 0; e.flipT = 0; e.thr = 1; e.feeler = 0;
      e.home.x = o.home ? o.home.x : pos.x; e.home.y = o.home ? o.home.y : pos.y; e.home.z = o.home ? o.home.z : pos.z;
      if (e.rig) { e.group.position.set(e.pos.x, e.pos.y, e.pos.z); e.group.rotation.set(0, e.yaw, 0); e.group.visible = true; }
    } else {
      e.home.x = o.home ? o.home.x : pos.x; e.home.z = o.home ? o.home.z : pos.z;
      e.pos.y = physics.groundHeight(e.pos.x, e.pos.z, e.pos.y + 0.5);
      for (let i = 0; i < 4; i++) {
        footWorld(SCR.foot, i, e.pos.x, e.pos.z, e.yaw);
        const f = e.feet[i];
        f.px = SCR.foot.x; f.py = physics.groundHeight(SCR.foot.x, SCR.foot.z, e.pos.y + 0.6); f.pz = SCR.foot.z;
        f.fx = f.px; f.fy = f.py; f.fz = f.pz; f.tx = f.px; f.ty = f.py; f.tz = f.pz;
      }
      if (e.rig) { e.group.position.set(e.pos.x, e.pos.y, e.pos.z); e.group.rotation.set(0, e.yaw, 0); e.group.visible = true; }
    }
    const a = e.agent;
    a.passive = !!o.passive;
    a.mode = o.state === "alert" ? "investigate" : "patrol";
    a.modeT = o.state === "alert" ? 9 + rng() * 4 : 0;
    a.seeT = 0; a.noSeeT = 0; a.exposure = 0;
    a.lastKnown.x = e.lastKnownX = e.pos.x;
    a.lastKnown.y = e.lastKnownY = e.pos.y;
    a.lastKnown.z = e.lastKnownZ = e.pos.z;
    syncAgent(e);
    e._evSpawn.enemy = e;
    events.emit("enemy:spawn", e._evSpawn);
    statsBag.spawnsTotal += 1;
    return e;
  }

  function deactivate(e) {
    e.active = false; e.alive = false; e.wreck = false;
    if (e.rig) e.group.visible = false;
    if (e.agent) combat.releaseToken(e.agent);
    const arr = active;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] === e) { arr[i] = arr[arr.length - 1]; arr.pop(); break; }
    }
    const w = wrecks;
    for (let i = 0; i < w.length; i++) {
      if (w[i] === e) { w[i] = w[w.length - 1]; w.pop(); break; }
    }
  }

  /* ---- spawn（池中取空闲 → activate → enemy:spawn）[src:pretty:L57738-L57751] ---- */
  function spawn(type, pos, o = {}) {
    const pool = pools[type];
    if (!pool) return null;
    let e = null;
    for (let i = 0; i < pool.length; i++) if (!pool[i].active) { e = pool[i]; break; }
    if (!e) return null;
    activate(e, pos, o);
    active.push(e);
    return e;
  }

  /* ---- 脚掌落点：side*footX / footZ 按 yaw 旋转 [src:pretty:L56880-L56883] ---- */
  function footWorld(out, leg, px, pz, yaw) {
    const n = HOUND_RIG.side[leg] * HOUND_RIG.footX;
    const q = HOUND_RIG.footZ[leg];
    const c = Math.cos(yaw), s = Math.sin(yaw);
    out.x = px + n * c + q * s;
    out.z = pz - n * s + q * c;
    return out;
  }

  /* ========================= 隼（四旋翼） ========================= */

  /** 隼存活更新：目标点 → 舵量 → 触须避墙 → 积分 → banking → 旋翼 → 开火。
   *  移植上游 x()。[src:pretty:L56434-L56538] */
  function gullAlive(e, dt, player) {
    const a = syncAgent(e);
    const mode = combat.updatePerception(a, player, dt);
    const engaged = mode === "engage" && player;
    const wounded = e.hp < TUNE.gull.hp * 0.5;
    let maxSpd = TUNE.gull.patrolSpeed, tx = 0, tz = 0, ty = 0;

    if (engaged) {
      maxSpd = TUNE.gull.maxSpeed;
      const attacking = e.atk !== "idle";
      e.flipT -= dt;
      if (e.flipT <= 0) {
        e.flipT = 3 + rng() * 5;
        if (rng() < 0.6) e.orbitDir = -e.orbitDir;
        e.orbitR = clampf(e.orbitR + (rng() - 0.5) * 6, TUNE.gull.rangeMin + 1, TUNE.gull.rangeMax - 2);
      }
      if (e.agent.noSeeT > 1.5) {
        tx = e.agent.lastKnown.x; tz = e.agent.lastKnown.z;
        ty = e.agent.lastKnown.y + e.alt + 1;
        e.orbitA = Math.atan2(e.pos.z - tz, e.pos.x - tx);
      } else {
        e.orbitA += ((e.orbitDir * (attacking ? 0.9 : 3.6)) / e.orbitR) * dt;
        tx = player.pos.x + Math.cos(e.orbitA) * e.orbitR;
        tz = player.pos.z + Math.sin(e.orbitA) * e.orbitR;
        ty = player.pos.y + e.alt;
      }
    } else if (mode === "investigate" || mode === "search") {
      maxSpd = 5.5;
      e.orbitA += 0.5 * dt;
      tx = e.agent.lastKnown.x + Math.cos(e.orbitA) * 4.5;
      tz = e.agent.lastKnown.z + Math.sin(e.orbitA) * 4.5;
      ty = e.agent.lastKnown.y + Math.min(e.alt, 5.5);
    } else {
      e.orbitA += 0.28 * dt * e.orbitDir;
      tx = e.home.x + Math.cos(e.orbitA) * e.patrolR;
      tz = e.home.z + Math.sin(e.orbitA) * e.patrolR;
      ty = e.hoverFixed ? e.alt : e.home.y;
    }
    if (ty > e.ceil) ty = e.ceil;
    if (!e.hoverFixed && ty < 2.2) ty = 2.2;

    /* 舵量（PD）+ 触须避墙 [src:pretty:L56465-L56497] */
    const ax = (tx - e.pos.x) * 2.2 - e.vel.x * 2.4;
    const ay = (ty - e.pos.y) * 5 - e.vel.y * 3.6;
    const az = (tz - e.pos.z) * 2.2 - e.vel.z * 2.4;
    e.feeler = (e.feeler + 1) % 3;
    const flat = Math.hypot(e.vel.x, e.vel.z);
    if (e.feeler === 0 && flat > 0.6) {
      SCR.dirFwd.x = e.vel.x / flat; SCR.dirFwd.y = 0; SCR.dirFwd.z = e.vel.z / flat;
      const probe = 2.2 + flat * 0.5;
      const wall = physics.raycast(e.pos, SCR.dirFwd, probe);
      if (wall) {
        const Y = 1 - wall.dist / probe;
        e.avoid.x += wall.normal.x * 26 * Y;
        e.avoid.y += 9 * Y;
        e.avoid.z += wall.normal.z * 26 * Y;
        statsBag.wallAvoids += 1;
        if (Y > 0.5) { e.orbitDir = -e.orbitDir; e.flipT = 2.5; } // 近距强弹：反转巡逻方向
      }
    } else if (e.feeler === 1) {
      const ground = physics.raycast(e.pos, SCR.dirDown, 2.4);
      if (ground && !e.hoverFixed) e.avoid.y += (2.4 - ground.dist) * 10;
    } else if (e.feeler === 2) {
      e.ceilT -= dt * 3;
      if (e.ceilT <= 0) {
        e.ceilT = 0.35;
        const ceil = physics.raycast(e.pos, SCR.dirUp, 4);
        e.ceil = ceil ? e.pos.y + ceil.dist - 1.3 : 1e9;
      }
    }
    let cx = ax + e.avoid.x, cy = ay + e.avoid.y, cz = az + e.avoid.z;
    const decay = Math.exp(-6 * dt);
    e.avoid.x *= decay; e.avoid.y *= decay; e.avoid.z *= decay;
    if (wounded && !e.hoverFixed) { // 受损游走 [src:pretty:L56495-L56497]
      cx += Math.sin(simT * 7.3 + e.phase) * 5;
      cz += Math.cos(simT * 6.1 + e.phase) * 5;
      cy += Math.sin(simT * 9.7) * 3;
    }
    const mag = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (mag > TUNE.gull.accel) { const s = TUNE.gull.accel / mag; cx *= s; cy *= s; cz *= s; }
    e.vel.x += cx * dt; e.vel.y += cy * dt; e.vel.z += cz * dt;
    let spd = Math.sqrt(e.vel.x * e.vel.x + e.vel.y * e.vel.y + e.vel.z * e.vel.z);
    if (spd > maxSpd) { const s = maxSpd / spd; e.vel.x *= s; e.vel.y *= s; e.vel.z *= s; spd = maxSpd; }

    /* 逐轴去穿（三向短射线，反弹 + 推出）[src:pretty:L56501-L56512] */
    for (let p = 0; p < 3; p++) {
      const v = p === 0 ? e.vel.x : p === 1 ? e.vel.y : e.vel.z;
      if (Math.abs(v) < 0.02) continue;
      const sgn = v > 0 ? 1 : -1;
      const margin = p === 1 ? 0.35 : 0.62;
      SCR.dirAxis.x = p === 0 ? sgn : 0; SCR.dirAxis.y = p === 1 ? sgn : 0; SCR.dirAxis.z = p === 2 ? sgn : 0;
      const hit = physics.raycast(e.pos, SCR.dirAxis, Math.abs(v) * dt + margin);
      if (hit) {
        const nv = -v * 0.25;
        if (p === 0) e.vel.x = nv; else if (p === 1) e.vel.y = nv; else e.vel.z = nv;
        const push = sgn * 8;
        if (p === 0) e.avoid.x -= push; else if (p === 1) e.avoid.y -= push; else e.avoid.z -= push;
        if (hit.dist < margin) {
          const corr = sgn * (margin - hit.dist);
          if (p === 0) e.pos.x -= corr; else if (p === 1) e.pos.y -= corr; else e.pos.z -= corr;
        }
      }
    }
    e.pos.x += e.vel.x * dt; e.pos.y += e.vel.y * dt; e.pos.z += e.vel.z * dt;
    if (!e.hoverFixed) { // 贴地钳 [src:pretty:L56514-L56519]
      const floor = physics.groundHeight(e.pos.x, e.pos.z, e.pos.y + 0.5) + 1.1;
      if (e.pos.y < floor) { e.pos.y = floor; if (e.vel.y < 0) e.vel.y = 0; }
    }

    /* 偏航 + banking [src:pretty:L56521-L56538] */
    let wantYaw = e.yaw;
    if ((engaged || mode === "search" || mode === "investigate") && player) {
      const px = engaged && e.agent.noSeeT < 1.5 ? player.pos.x : e.agent.lastKnown.x;
      const pz = engaged && e.agent.noSeeT < 1.5 ? player.pos.z : e.agent.lastKnown.z;
      wantYaw = Math.atan2(px - e.pos.x, pz - e.pos.z);
    } else if (flat > 0.4) {
      wantYaw = Math.atan2(e.vel.x, e.vel.z);
    }
    e.yaw += clampf(angleDelta(wantYaw, e.yaw), -3.2 * dt, 3.2 * dt);
    const cyaw = Math.cos(e.yaw), syaw = Math.sin(e.yaw);
    const localF = cx * syaw + cz * cyaw;  // 本体系前向舵量
    const localS = cx * cyaw - cz * syaw;  // 本体系侧向舵量
    let pitchT = clampf(localF * 0.04, -0.42, 0.42);
    let rollT = clampf(-localS * 0.04, -0.42, 0.42);
    if (wounded && !e.hoverFixed) {
      pitchT += Math.sin(simT * 11 + e.phase) * 0.1;
      rollT += Math.cos(simT * 8.7 + e.phase * 2) * 0.13;
    }
    const q = 1 - Math.exp(-7 * dt);
    e.pitch += (pitchT - e.pitch) * q;
    e.roll += (rollT - e.roll) * q;
    e.thr += (1 + clampf(ay * 0.03, -0.25, 0.4) + flat * 0.02 - e.thr) * q;

    if (e.rig) {
      e.group.position.set(e.pos.x, e.pos.y, e.pos.z);
      e.group.rotation.set(e.pitch, e.yaw, e.roll);
      const body = e.rig.bones.body;
      body.position.y = Math.sin(simT * 2.1 + e.phase) * 0.045 + Math.sin(simT * 3.7 + e.phase * 1.7) * 0.018;
      for (let i = 0; i < 4; i++) e.rig.bones["rotor" + i].rotation.y += (i % 3 === 0 ? 1 : -1) * 41 * e.thr * dt;
    }

    /* 开火：telegraph → burst → cooldown（弹道走 combat.fireBolt 池）*/
    const dist = player ? Math.hypot(player.pos.x - e.pos.x, (player.pos.y + 1 - e.pos.y) * 0.6, player.pos.z - e.pos.z) : 1e9;
    if (engaged && dist <= TUNE.gull.fireRange && e.agent.noSeeT < 0.6) {
      if (e.atk === "idle" && e.cool <= 0) { e.atk = "telegraph"; e.atkT = TUNE.gull.telegraph; e.shots = 0; }
      if (e.atk === "telegraph") {
        e.atkT -= dt;
        if (e.atkT <= 0) e.atk = "burst";
      }
      if (e.atk === "burst") {
        e.atkT -= dt;
        if (e.atkT <= 0) {
          gullFire(e, player, dist);
          e.shots += 1;
          e.atkT = TUNE.gull.burstGap;
          if (e.shots >= TUNE.gull.burst) { e.atk = "idle"; e.cool = TUNE.gull.cooldown[0] + rng() * (TUNE.gull.cooldown[1] - TUNE.gull.cooldown[0]); }
        }
      }
    } else if (e.atk !== "idle") {
      e.atk = "idle"; e.cool = Math.max(e.cool, 0.4);
    }
    if (e.cool > 0) e.cool -= dt;
  }

  /** 隼单发：方向 = 目标眼位 + 距离插值散布，出膛走 combat.fireBolt（maxBolts 池在 combat-kit）。 */
  function gullFire(e, player, dist) {
    muzzleWorld(e, SCR.muzzle);
    const spread = TUNE.gull.spreadNear + (TUNE.gull.spreadFar - TUNE.gull.spreadNear) * clampf(dist / TUNE.gull.rangeMax, 0, 1);
    SCR.aim.x = player.pos.x - SCR.muzzle.x;
    SCR.aim.y = player.pos.y + 1 - SCR.muzzle.y;
    SCR.aim.z = player.pos.z - SCR.muzzle.z;
    const len = Math.sqrt(SCR.aim.x * SCR.aim.x + SCR.aim.y * SCR.aim.y + SCR.aim.z * SCR.aim.z) || 1e-4;
    SCR.aim.x /= len; SCR.aim.y /= len; SCR.aim.z /= len;
    SCR.aim.x += (rng() - 0.5) * 2 * spread; SCR.aim.y += (rng() - 0.5) * 2 * spread; SCR.aim.z += (rng() - 0.5) * 2 * spread;
    const nl = Math.sqrt(SCR.aim.x * SCR.aim.x + SCR.aim.y * SCR.aim.y + SCR.aim.z * SCR.aim.z) || 1e-4;
    SCR.dir.x = SCR.aim.x / nl; SCR.dir.y = SCR.aim.y / nl; SCR.dir.z = SCR.aim.z / nl;
    combat.fireBolt(SCR.muzzle, SCR.dir, { speed: TUNE.gull.boltSpeed, life: 1.3 });
    if (fx) fx.muzzleFlash(SCR.muzzle, SCR.dir, { scale: 0.8 });
    statsBag.boltsFired += 1;
  }

  /** 枪口世界位（有 rig 读 gun 骨矩阵；无 rig 解析近似 gun+muzzle 偏移）。 */
  function muzzleWorld(e, out) {
    if (e.rig) {
      e.group.updateMatrixWorld(true);
      const el = e.rig.bones.gun.matrixWorld.elements;
      out.x = el[12]; out.y = el[13]; out.z = el[14];
    } else {
      out.x = e.pos.x + Math.sin(e.yaw) * GULL_HULL.muzzle[2];
      out.y = e.pos.y + GULL_HULL.muzzle[1];
      out.z = e.pos.z + Math.cos(e.yaw) * GULL_HULL.muzzle[2];
    }
    return out;
  }

  /** 隼死亡：断桨自旋坠落。[src:pretty:L56374-L56395] */
  function gullDie(e, dir) {
    e.alive = false;
    if (e.agent) combat.releaseToken(e.agent);
    e.dieT = 0;
    e.lostRotor = Math.floor(rng() * 4);
    e.spin = (rng() < 0.5 ? -1 : 1) * (5 + rng() * 3);
    e.vel.y += 1.5;
    if (dir) { e.vel.x += dir.x * 2.5; e.vel.z += dir.z * 2.5; }
    statsBag.kills += 1;
    e._evKilled.enemy = e;
    e._evKilled.pos.x = e.pos.x; e._evKilled.pos.y = e.pos.y; e._evKilled.pos.z = e.pos.z;
    events.emit("enemy:killed", e._evKilled);
  }

  /** 隼坠落：重力 9.5 / 拖曳 0.4 / 终止（dieT>5‖y<-3‖撞点）→ 爆炸 + 入残骸池。
   *  [src:pretty:L56396-L56453]；上游隼终止走 retire，此处统一入残骸池（见文件头注）。 */
  function gullDead(e, dt, player) {
    e.dieT += dt;
    e.vel.y -= 9.5 * dt;
    e.vel.x *= 1 - 0.4 * dt;
    e.vel.z *= 1 - 0.4 * dt;
    e.spin += Math.sign(e.spin) * 7 * dt;
    e.yaw += e.spin * dt;
    e.roll += e.spin * 0.35 * dt;
    e.pitch += 0.9 * dt;
    const spd = Math.sqrt(e.vel.x * e.vel.x + e.vel.y * e.vel.y + e.vel.z * e.vel.z);
    let done = e.dieT > 5 || e.pos.y < -3;
    if (!done && spd > 0.01) {
      SCR.dir.x = e.vel.x / spd; SCR.dir.y = e.vel.y / spd; SCR.dir.z = e.vel.z / spd;
      const hit = physics.raycast(e.pos, SCR.dir, spd * dt + 0.3);
      if (hit) { e.pos.x = hit.point.x; e.pos.y = hit.point.y; e.pos.z = hit.point.z; done = true; }
    }
    if (!done) { e.pos.x += e.vel.x * dt; e.pos.y += e.vel.y * dt; e.pos.z += e.vel.z * dt; }
    if (e.rig) {
      e.group.position.set(e.pos.x, e.pos.y, e.pos.z);
      e.group.rotation.set(e.pitch, e.yaw, e.roll);
      for (let i = 0; i < 4; i++) {
        if (i === e.lostRotor) continue;
        e.rig.bones["rotor" + i].rotation.y += (i % 3 === 0 ? 1 : -1) * 30 * Math.max(0.2, 1 - e.dieT * 0.5) * dt;
      }
    }
    if (done) {
      e.pos.y = Math.max(e.pos.y, physics.groundHeight(e.pos.x, e.pos.z, e.pos.y + 0.5));
      e.pitch = 0; e.roll = Math.sign(e.spin) * 0.3;
      e.vel.x = 0; e.vel.y = 0; e.vel.z = 0; e.spin = 0;
      if (fx && typeof fx.explosion === "function") fx.explosion(e.pos, 1.2);
      if (combat && typeof combat.explode === "function") combat.explode(e.pos, TUNE.gull.explodeRadius, TUNE.gull.explodeDamage, "enemy");
      e._evExplode.pos.x = e.pos.x; e._evExplode.pos.y = e.pos.y; e._evExplode.pos.z = e.pos.z;
      events.emit("enemy:explode", e._evExplode);
      if (player && player.alive !== false) {
        const d = Math.hypot(player.pos.x - e.pos.x, player.pos.y - e.pos.y, player.pos.z - e.pos.z);
        if (d < TUNE.gull.explodeRadius) {
          e._evDamaged.damage = TUNE.gull.explodeDamage;
          e._evDamaged.from.x = e.pos.x; e._evDamaged.from.y = e.pos.y; e._evDamaged.from.z = e.pos.z;
          events.emit("player:damaged", e._evDamaged);
        }
      }
      e.wreck = true;
      addWreck(e);
    }
  }

  /* ========================= 猎犬（四足） ========================= */

  /** 猎犬存活更新：目标 → 转向/速度 → 步态 → 躯干姿态/IK → 开火/扑击。
   *  生存分支对应上游 S()。[src:pretty:L56969-L56969] */
  function houndAlive(e, dt, player) {
    const a = syncAgent(e);
    const mode = combat.updatePerception(a, player, dt);
    const spec = TUNE.hound;
    const engaged = mode === "engage" && player;

    /* 目标点 [src:pretty:L56890-L56896] */
    let goalX = e.pos.x, goalZ = e.pos.z, want = spec.patrolSpeed;
    if (engaged) {
      goalX = player.pos.x; goalZ = player.pos.z;
      const dx = goalX - e.pos.x, dz = goalZ - e.pos.z;
      const dist = Math.hypot(dx, dz);
      want = dist > spec.rangeMax ? spec.runSpeed : dist > spec.rangeMin ? spec.stalkSpeed : -spec.stalkSpeed * 0.4;
    } else if (mode === "investigate" || mode === "search") {
      goalX = a.lastKnown.x; goalZ = a.lastKnown.z;
      want = spec.stalkSpeed;
    } else if (e.patrolLine && e.patrolLine.length) {
      const wp = e.patrolLine[e.wp % e.patrolLine.length];
      goalX = wp.x; goalZ = wp.z;
      if (Math.hypot(goalX - e.pos.x, goalZ - e.pos.z) < 0.5) e.wp += 1;
      want = spec.patrolSpeed;
    } else {
      goalX = e.home.x; goalZ = e.home.z;
      if (Math.hypot(goalX - e.pos.x, goalZ - e.pos.z) < 0.6) want = 0;
    }
    e.goalX = goalX; e.goalZ = goalZ; e.hasGoal = true;

    /* 转向（turnRate 2.5 rad/s）+ 速度逼近（accel 7）*/
    const dx = goalX - e.pos.x, dz = goalZ - e.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.05 && Math.abs(want) > 0.01) {
      const dYaw = angleDelta(Math.atan2(dx, dz), e.yaw);
      const turn = clampf(dYaw, -spec.turnRate * dt, spec.turnRate * dt);
      e.yaw += turn;
      e.yawRate = dt > 0 ? turn / dt : 0;
    } else {
      e.yawRate += (0 - e.yawRate) * Math.min(1, 8 * dt);
    }
    e.prevSpeed = e.speed;
    const sStep = clampf(want - e.speed, -spec.accel * dt, spec.accel * dt);
    e.speed += sStep;

    /* 扑击 [src:pretty:L56644-L56648] */
    if (e.lungeT > 0) e.lungeT -= dt;
    if (engaged && dist < spec.lungeRange && e.lungeT <= 0) {
      e.lungeT = spec.lungeCooldown;
      e.lunging = 0.45;
      statsBag.lunges += 1;
      e._evDamaged.damage = spec.lungeDamage;
      e._evDamaged.from.x = e.pos.x; e._evDamaged.from.y = e.pos.y; e._evDamaged.from.z = e.pos.z;
      events.emit("player:damaged", e._evDamaged);
    }
    let lungeBoost = 0;
    if (e.lunging > 0) { e.lunging -= dt; lungeBoost = spec.lungeSpeed * Math.max(0, e.lunging) / 0.45; }

    /* 位移（贴地）*/
    if (e.speed !== 0 || lungeBoost > 0) {
      const move = (e.speed + lungeBoost) * dt;
      e.pos.x += Math.sin(e.yaw) * move;
      e.pos.z += Math.cos(e.yaw) * move;
    }
    e.pos.y = physics.groundHeight(e.pos.x, e.pos.z, e.pos.y + 0.5);

    /* 炮塔/头部瞄准（指数逼近，零分配适配上游 tyaw/hyaw 语义）*/
    if (engaged) {
      const wantTyaw = clampf(angleDelta(Math.atan2(dx, dz), e.yaw), -1.2, 1.2);
      const dy = player.pos.y + 1 - (e.pos.y + HOUND_RIG.stand);
      const wantTpitch = clampf(-Math.atan2(dy, Math.max(dist, 0.5)), -0.5, 0.5);
      e.tyaw += (wantTyaw - e.tyaw) * Math.min(1, 6 * dt);
      e.tpitch += (wantTpitch - e.tpitch) * Math.min(1, 6 * dt);
    } else {
      e.tyaw *= Math.max(0, 1 - 4 * dt);
      e.tpitch *= Math.max(0, 1 - 4 * dt);
    }
    e.hyaw = e.tyaw * 0.5;
    e.hpitch = e.tpitch;

    gait(e, dt);
    houndPose(e, dt);

    /* 开火：telegraph → burst（hitscan 走 combat.enemyShot）[src:pretty:L57200-L57212] */
    if (engaged && dist >= spec.rangeMin - 2 && dist <= spec.rangeMax && e.agent.noSeeT < 0.5) {
      if (e.atk === "idle" && e.cool <= 0) { e.atk = "telegraph"; e.atkT = spec.telegraph; e.shots = 0; }
      if (e.atk === "telegraph") {
        e.atkT -= dt;
        if (e.atkT <= 0) e.atk = "burst";
      }
      if (e.atk === "burst") {
        e.atkT -= dt;
        if (e.atkT <= 0) {
          houndFire(e, player, dist);
          e.shots += 1;
          e.atkT = spec.burstGap;
          if (e.shots >= spec.burst) { e.atk = "idle"; e.cool = spec.cooldown[0] + rng() * (spec.cooldown[1] - spec.cooldown[0]); }
        }
      }
    } else if (e.atk !== "idle") {
      e.atk = "idle"; e.cool = Math.max(e.cool, 0.4);
    }
    if (e.cool > 0) e.cool -= dt;
  }

  /** 猎犬单发 hitscan：combat.enemyShot 结算 + fx tracer/muzzleFlash + enemy:fire。
   *  [src:pretty:L57200-L57212] */
  function houndFire(e, player, dist) {
    muzzleWorldHound(e, SCR.muzzle);
    const spread = TUNE.hound.spreadNear + (TUNE.hound.spreadFar - TUNE.hound.spreadNear) * clampf(dist / TUNE.hound.rangeMax, 0, 1);
    SCR.aim.x = player.pos.x - SCR.muzzle.x;
    SCR.aim.y = player.pos.y + 1 - SCR.muzzle.y;
    SCR.aim.z = player.pos.z - SCR.muzzle.z;
    const len = Math.sqrt(SCR.aim.x * SCR.aim.x + SCR.aim.y * SCR.aim.y + SCR.aim.z * SCR.aim.z) || 1e-4;
    SCR.aim.x /= len; SCR.aim.y /= len; SCR.aim.z /= len;
    SCR.aim.x += (rng() - 0.5) * 2 * spread; SCR.aim.y += (rng() - 0.5) * 2 * spread; SCR.aim.z += (rng() - 0.5) * 2 * spread;
    const nl = Math.sqrt(SCR.aim.x * SCR.aim.x + SCR.aim.y * SCR.aim.y + SCR.aim.z * SCR.aim.z) || 1e-4;
    SCR.dir.x = SCR.aim.x / nl; SCR.dir.y = SCR.aim.y / nl; SCR.dir.z = SCR.aim.z / nl;
    const hitWall = physics.raycast(SCR.muzzle, SCR.dir, 200);
    const shot = combat.enemyShot(SCR.muzzle, SCR.dir, { damage: TUNE.hound.shotDamage, range: 200, player });
    const endDist = shot ? (shot.hit ? dist : (hitWall ? hitWall.dist : 90)) : hitWall ? hitWall.dist : 90;
    if (fx) {
      SCR.dirAxis.x = SCR.muzzle.x + SCR.dir.x * endDist;
      SCR.dirAxis.y = SCR.muzzle.y + SCR.dir.y * endDist;
      SCR.dirAxis.z = SCR.muzzle.z + SCR.dir.z * endDist;
      fx.tracer(SCR.muzzle, SCR.dirAxis, { speed: 260, width: 0.035 });
      fx.muzzleFlash(SCR.muzzle, SCR.dir, { scale: 0.9 });
    }
    const ev = e._evFire;
    ev.enemy = e;
    ev.pos.x = SCR.muzzle.x; ev.pos.y = SCR.muzzle.y; ev.pos.z = SCR.muzzle.z;
    ev.dir.x = SCR.dir.x; ev.dir.y = SCR.dir.y; ev.dir.z = SCR.dir.z;
    ev.type = "hound";
    events.emit("enemy:fire", ev);
    e.sP.v += 1.1; // 开火后坐弹簧 [src:pretty:L57211-L57211]
    e.sY.v -= 0.25;
    statsBag.shotsFired += 1;
  }

  /** 猎犬枪口世界位（gun 骨矩阵或解析近似 muzzle 偏移 [0,0,0.43]）。 */
  function muzzleWorldHound(e, out) {
    if (e.rig) {
      e.group.updateMatrixWorld(true);
      const el = e.rig.bones.gun.matrixWorld.elements;
      out.x = el[12]; out.y = el[13]; out.z = el[14];
    } else {
      const c = Math.cos(e.yaw), s = Math.sin(e.yaw);
      out.x = e.pos.x + HOUND_RIG.muzzle[2] * s;
      out.y = e.pos.y + HOUND_RIG.stand + 0.247;
      out.z = e.pos.z + HOUND_RIG.muzzle[2] * c;
    }
    return out;
  }

  /**
   * 步态相位表（上游 H()）：对角对 [[0,3],[1,2]] 轮流摆动；
   * 选"落后最多"的对（连续同对惩罚 ×1.25）；移动阈值 0.09m、静止 0.035m；
   * 落点向速度前方预测 1.5×，smoothstep 插值 + sin 抬脚。
   * [src:pretty:L57214-L57259]
   */
  function gait(e, dt) {
    const dx = Math.sin(e.yaw) * e.speed;
    const dz = Math.cos(e.yaw) * e.speed;
    const moving = e.speed > 0.15 || Math.abs(e.yawRate) > 0.25;
    if (e.sw < 0) {
      e.idleT = moving ? 0 : e.idleT + dt;
      const speedEff = e.speed + Math.abs(e.yawRate) * 0.5;
      const dur = clampf(GAIT.swingDurMax - speedEff * GAIT.swingDurK, GAIT.swingDurMin, GAIT.swingDurMax);
      let bestPair = -1, bestDist = 0;
      for (let f = 0; f < 2; f++) {
        let worst = 0;
        const pair = GAIT.pairs[f];
        for (let k = 0; k < pair.length; k++) {
          const leg = pair[k];
          footWorld(SCR.foot, leg, e.pos.x + dx * dur, e.pos.z + dz * dur, e.yaw + e.yawRate * dur);
          const fo = e.feet[leg];
          const d = Math.hypot(SCR.foot.x - fo.px, SCR.foot.z - fo.pz);
          if (d > worst) worst = d;
        }
        if (f !== e.lastPair) worst *= GAIT.pairRepeatPenalty;
        if (worst > bestDist) { bestDist = worst; bestPair = f; }
      }
      const threshold = moving ? GAIT.stepThreshold : (e.idleT > GAIT.idleGrace ? GAIT.idleThreshold : 1e9);
      if (bestPair >= 0 && bestDist > threshold) {
        e.sw = bestPair; e.swT = 0; e.swDur = dur;
        e.lift = GAIT.liftBase + Math.min(GAIT.liftMax, speedEff * GAIT.liftK);
        statsBag.gaitSwings += 1;
        const pair = GAIT.pairs[bestPair];
        for (let k = 0; k < pair.length; k++) {
          const leg = pair[k];
          const fo = e.feet[leg];
          fo.fx = fo.px; fo.fy = fo.py; fo.fz = fo.pz;
          footWorld(SCR.foot, leg, e.pos.x + dx * dur * 1.5, e.pos.z + dz * dur * 1.5, e.yaw + e.yawRate * dur * 1.5);
          fo.tx = SCR.foot.x; fo.tz = SCR.foot.z;
          fo.ty = physics.groundHeight(SCR.foot.x, SCR.foot.z, e.pos.y + 0.6);
        }
      }
    } else {
      e.swT += dt / (e.swDur || 0.14);
      const t = e.swT >= 1 ? 1 : e.swT;
      const s = t * t * (3 - 2 * t); // smoothstep
      const pair = GAIT.pairs[e.sw];
      for (let k = 0; k < pair.length; k++) {
        const fo = e.feet[pair[k]];
        fo.px = fo.fx + (fo.tx - fo.fx) * s;
        fo.pz = fo.fz + (fo.tz - fo.fz) * s;
        fo.py = fo.fy + (fo.ty - fo.fy) * s + Math.sin(PI * t) * e.lift;
      }
      if (e.swT >= 1) {
        const lead = e.feet[pair[0]];
        e._evStep.enemy = e;
        e._evStep.pos.x = lead.px; e._evStep.pos.y = lead.py; e._evStep.pos.z = lead.pz;
        e._evStep.type = "hound";
        e._evStep.speed = e.speed;
        events.emit("enemy:step", e._evStep);
        e.sY.v -= GAIT.stepKick + e.speed * GAIT.stepKickK;
        statsBag.steps += 1;
        e.lastPair = e.sw;
        e.sw = -1;
      }
    }
  }

  /**
   * 躯干姿态（上游 O()）：足高均值 → pitch/roll/高度弹簧；idle 呼吸；
   * 逐腿把世界落点变换到躯干局部（yaw/pitch/roll 复合旋转）→ 2 骨 IK → 关节旋转；
   * 末尾 updateMatrixWorld 后从 head 骨矩阵读 headPos（命中区用）。
   * [src:pretty:L57260-L57319]
   */
  function houndPose(e, dt) {
    const D = Math.cos(e.yaw), C = Math.sin(e.yaw);
    const f = e.feet;
    const front = (f[0].py + f[1].py) * 0.5;
    const back = (f[2].py + f[3].py) * 0.5;
    const left = (f[0].py + f[2].py) * 0.5;
    const right = (f[1].py + f[3].py) * 0.5;
    const heightK = (front + back) * 0.5 - e.pos.y;
    const accel = dt > 0 ? (e.speed - e.prevSpeed) / dt : 0;
    const pitchT = Math.atan2(back - front, 0.8) * 0.6 + clampf(accel * 0.006, -0.07, 0.07);
    const rollT = Math.atan2(left - right, 0.55) * 0.6 + clampf(e.yawRate * e.speed * 0.02, -0.12, 0.12);
    const heightT = heightK * 0.45 - Math.min(0.05, e.speed * 0.011);
    if (e.alive) {
      springStep(e.sY, heightT, 160, 17, dt);
      springStep(e.sP, pitchT, 130, 15, dt);
      springStep(e.sR, rollT, 130, 15, dt);
      springStep(e.sL, 0, 110, 13, dt);
    }
    const bob = e.alive ? Math.sin(simT * 1.7 + e.phase) * 0.004 : 0;
    const bodyX = e.sL.x;
    const bodyY = HOUND_RIG.stand + e.sY.x - e.crouch + bob;
    const bodyPitch = e.alive ? e.sP.x : e.diePitch;
    const bodyRoll = e.alive ? e.sR.x : e.dieRoll;
    if (e.rig) {
      e.group.position.set(e.pos.x, e.pos.y, e.pos.z);
      e.group.rotation.y = e.yaw;
      const B = e.rig.bones;
      B.body.position.set(bodyX, bodyY, 0);
      B.body.rotation.set(bodyPitch, 0, bodyRoll);
      B.turret.rotation.y = e.tyaw;
      B.gun.rotation.x = e.tpitch - bodyPitch * 0.5;
      B.head.rotation.set(e.hpitch, e.hyaw, 0);
      const antT = clampf(-accel * 0.03 - bodyPitch, -0.6, 0.6);
      const ant2T = clampf(e.yawRate * 0.12 - bodyRoll, -0.6, 0.6);
      springStep(e.sA, antT, 60, 5, dt);
      springStep(e.sA2, ant2T, 60, 5, dt);
      B.antenna.rotation.set(e.sA.x, 0, e.sA2.x);
      const cp = Math.cos(bodyPitch), sp = Math.sin(bodyPitch);
      const cr = Math.cos(bodyRoll), sr = Math.sin(bodyRoll);
      const ik = SCR.ik;
      for (let L = 0; L < 4; L++) {
        const ft = f[L];
        const J = ft.px - e.pos.x;
        const oe = ft.py + HOUND_RIG.footR * 0.6 - e.pos.y;
        const fe = ft.pz - e.pos.z;
        const le = J * D - fe * C - bodyX;
        const R = oe - bodyY;
        const I = J * C + fe * D;
        const se = R * cp + I * sp;
        const ae = -R * sp + I * cp;
        const k = le * cr + se * sr;
        const ce = -le * sr + se * cr;
        solveIK(ik, k - HOUND_RIG.side[L] * HOUND_RIG.hipX, ce - HOUND_RIG.hipY, ae - HOUND_RIG.fore[L] * HOUND_RIG.hipZ, HOUND_RIG.side[L], HOUND_RIG.l0, HOUND_RIG.L1, HOUND_RIG.L2 - HOUND_RIG.footR * 0.6);
        const leg = HOUND_RIG.legs[L];
        B["abd" + leg].rotation.z = ik.abd;
        B["thigh" + leg].rotation.x = ik.hip;
        B["shin" + leg].rotation.x = ik.knee;
      }
      e.group.updateMatrixWorld(true);
      const el = B.head.matrixWorld.elements;
      e.headPos.x = el[12]; e.headPos.y = el[13]; e.headPos.z = el[14];
    } else {
      // 无 rig（node 自测）：headPos 解析近似
      e.headPos.x = e.pos.x + Math.sin(e.yaw) * 0.61;
      e.headPos.y = e.pos.y + HOUND_RIG.stand + 0.25;
      e.headPos.z = e.pos.z + Math.cos(e.yaw) * 0.61;
    }
  }

  /** 猎犬死亡：侧倒 + 入残骸池。[src:pretty:L57321-L57347] */
  function houndDie(e, dir) {
    e.alive = false;
    if (e.agent) combat.releaseToken(e.agent);
    e.dieT = 0;
    e.dieRoll = (rng() < 0.5 ? -1 : 1) * (0.25 + rng() * 0.3);
    e.diePitch = (rng() - 0.5) * 0.25;
    e.sR.v += e.dieRoll * 3;
    e.speed = 0; e.yawRate = 0;
    statsBag.kills += 1;
    e._evKilled.enemy = e;
    e._evKilled.pos.x = e.pos.x; e._evKilled.pos.y = e.pos.y; e._evKilled.pos.z = e.pos.z;
    events.emit("enemy:killed", e._evKilled);
    addWreck(e); // [src:pretty:L57346-L57346]
  }

  /** 猎犬尸体：倒地姿态收敛，1.2s 后 wreck 静止（上游 wreck 标记语义 [src:pretty:L57390-L57390]）。 */
  function houndDead(e, dt) {
    e.dieT += dt;
    e.sR.x += (e.dieRoll - e.sR.x) * Math.min(1, 5 * dt);
    e.sP.x += (e.diePitch - e.sP.x) * Math.min(1, 5 * dt);
    e.sY.x += (-0.08 - e.sY.x) * Math.min(1, 2 * dt);
    if (!e.wreck && e.dieT > 1.2) { e.wreck = true; }
    if (e.rig) houndPose(e, dt);
  }

  /* ---- 受击：血量/事件/knockback/provoke → 死亡分支。
   *   隼 knockback [src:pretty:L56280-L56289]；犬 knockback [src:pretty:L56790-L56790]。 ---- */
  function applyDamage(e, amount, point, dir, part) {
    if (!e.alive) return false;
    e.hp -= amount;
    const ev = e._evHit;
    ev.enemy = e;
    if (point) { ev.point.x = point.x; ev.point.y = point.y; ev.point.z = point.z; }
    ev.part = part || "body";
    events.emit("enemy:hit", ev);
    if (e.type === "gull") {
      if (dir) {
        const kb = Math.min(3, amount * 0.09);
        e.vel.x += dir.x * kb; e.vel.y += dir.y * kb; e.vel.z += dir.z * kb;
      }
      e.roll += (rng() - 0.5) * 0.5;
      e.pitch += (rng() - 0.5) * 0.4;
    } else {
      e.sP.v += 2.4 * (amount / 28) * (part === "weak" ? 1.6 : 1);
      e.sY.v -= 0.25;
    }
    if (combat && typeof combat.alert === "function") combat.alert(e.pos, 20); // 打了呼叫支援
    if (e.hp <= 0) {
      if (e.type === "gull") gullDie(e, dir); else houndDie(e, dir);
      return true;
    }
    return false;
  }

  /* ---- 命中区（enemyRaycast）：隼 y×2.3 椭球 body；犬头球 weak（×2.2 由 combat-kit 施加）+ 双胶囊 body。
   *   [src:pretty:L56346-L56371] [src:pretty:L56861-L56870] ---- */
  function raycast(origin, dir, maxDist, out) {
    statsBag.rays += 1;
    const hit = out || SCR.hit;
    if (out) {
      out.dist = maxDist; out.enemy = null; out.part = "";
      if (!out.point) out.point = { x: 0, y: 0, z: 0 };
      if (!out.normal) out.normal = { x: 0, y: 1, z: 0 };
    } else {
      hit.dist = maxDist; hit.enemy = null; hit.part = "";
    }
    const ox = origin.x, oy = origin.y, oz = origin.z;
    const dx = dir.x, dy = dir.y, dz = dir.z;
    for (let i = 0; i < active.length; i++) {
      const e = active[i];
      if (!e.alive) continue;
      if (e.type === "gull") {
        const ex = ox - e.pos.x;
        const ey = (oy - e.pos.y + 0.03) * HIT_ZONES.gullYStretch;
        const ez = oz - e.pos.z;
        const ddx = dx, ddy = dy * HIT_ZONES.gullYStretch, ddz = dz;
        const q = ddx * ddx + ddy * ddy + ddz * ddz;
        const U = ex * ddx + ey * ddy + ez * ddz;
        const T = ex * ex + ey * ey + ez * ez - HIT_ZONES.gullEllipsoidR * HIT_ZONES.gullEllipsoidR;
        const D = U * U - q * T;
        if (D < 0) continue;
        const t = (-U - Math.sqrt(D)) / q;
        if (t < 0 || t > hit.dist) continue;
        hit.dist = t; hit.enemy = e; hit.part = "body";
        hit.px = ox + dx * t; hit.py = oy + dy * t; hit.pz = oz + dz * t;
        let nx = hit.px - e.pos.x, ny = (hit.py - e.pos.y) * HIT_ZONES.gullYStretch, nz = hit.pz - e.pos.z;
        const il = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1e-6);
        hit.nx = nx * il; hit.ny = ny * il; hit.nz = nz * il;
      } else {
        // 头球 → "weak"（combat-kit.playerShot 对 weak ×2.2）
        if (raySphereT(ox, oy, oz, dx, dy, dz, e.headPos.x, e.headPos.y, e.headPos.z, HIT_ZONES.houndHeadR, hit.dist, hit)) {
          hit.enemy = e; hit.part = "weak";
        }
        const K = e.pos.y + HOUND_RIG.stand + e.sY.x - e.crouch;
        const cy = Math.cos(e.yaw), sy = Math.sin(e.yaw);
        const ax = e.pos.x - sy * 0.45, az = e.pos.z - cy * 0.45;
        const bx = e.pos.x + sy * 0.47, bz = e.pos.z + cy * 0.47;
        if (rayCapsuleT(ox, oy, oz, dx, dy, dz, ax, K + 0.03, az, bx, K + 0.03, bz, HIT_ZONES.houndBodyR, hit.dist, hit)) {
          hit.enemy = e; hit.part = "body";
        }
        const y2 = e.pos.y + (K - e.pos.y) * 0.45;
        if (rayCapsuleT(ox, oy, oz, dx, dy, dz, ax, y2, az, bx, y2, bz, HIT_ZONES.houndBodyR2, hit.dist, hit)) {
          hit.enemy = e; hit.part = "body";
        }
      }
    }
    if (!hit.enemy) return null;
    hit.point.x = hit.px; hit.point.y = hit.py; hit.point.z = hit.pz;
    hit.normal.x = hit.nx; hit.normal.y = hit.ny; hit.normal.z = hit.nz;
    return hit;
  }

  /* ---- 残骸池（上游 addWreck：超 maxWrecks 逐出最旧）[src:pretty:L57601-L57605] ---- */
  function addWreck(e) {
    for (let i = 0; i < wrecks.length; i++) if (wrecks[i] === e) return;
    wrecks.push(e);
    while (wrecks.length > TUNE.maxWrecks) {
      const old = wrecks.shift();
      statsBag.wreckEvictions += 1;
      deactivate(old);
    }
  }

  /* ---- 刷兵点：纯数据注册表 + 按点生成（kind "ground"→hound / "air"→gull） ---- */
  let spawnPoints = [];
  function setSpawnPoints(list) {
    spawnPoints = [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      spawnPoints.push({ pos: { x: p.pos.x, y: p.pos.y || 0, z: p.pos.z }, kind: p.kind || "ground", tag: p.tag || null });
    }
    return spawnPoints.length;
  }
  function spawnAt(index, o = {}) {
    const p = spawnPoints[index];
    if (!p) return null;
    const type = o.type || (p.kind === "air" ? "gull" : "hound");
    return spawn(type, p.pos, o);
  }
  /** 波次：从空闲点确定性抽取 count 个（rng 注入），ground/air 按 kind 分派。 */
  function spawnWave(count, o = {}) {
    const order = [];
    for (let i = 0; i < spawnPoints.length; i++) order.push(i);
    for (let i = order.length - 1; i > 0; i--) { // Fisher-Yates（注入 rng）
      const j = Math.floor(rng() * (i + 1));
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }
    let n = 0;
    for (let i = 0; i < order.length && n < count; i++) {
      if (spawnAt(order[i], o)) n += 1;
    }
    return n;
  }

  /* ---- 主循环（热路径：逐敌分派，零分配）---- */
  function update(dt, player) {
    if (dt <= 0) return;
    simT += dt;
    for (let i = active.length - 1; i >= 0; i--) {
      const e = active[i];
      if (e.type === "gull") {
        if (e.alive) gullAlive(e, dt, player);
        else if (!e.wreck) gullDead(e, dt, player);
      } else {
        if (e.alive) houndAlive(e, dt, player);
        else if (!e.wreck) houndDead(e, dt);
      }
    }
  }

  /* ---- stats：manifest enemies 族指标 + 运行实测计数 ---- */
  function stats() {
    let rigs = 0, gullActive = 0, houndActive = 0;
    for (const e of pools.gull) if (e.rig) rigs += 1;
    for (const e of pools.hound) if (e.rig) rigs += 1;
    for (let i = 0; i < active.length; i++) {
      if (active[i].type === "gull") gullActive += 1; else houndActive += 1;
    }
    return {
      enemyTypes: TYPES.length,            // 类型 ≥1 floor
      enemySpawns: spawnPoints.length,     // 刷兵点 ≥6 floor（setSpawnPoints 实测）
      enemyRigs: rigs,                     // 可动画 rig ≥1 floor（SkinnedMesh 实测）
      active: active.length,
      gullActive,
      houndActive,
      poolGulls: pools.gull.length,
      poolHounds: pools.hound.length,
      wrecks: wrecks.length,
      maxWrecks: TUNE.maxWrecks,
      spawnsTotal: statsBag.spawnsTotal,
      kills: statsBag.kills,
      steps: statsBag.steps,
      gaitSwings: statsBag.gaitSwings,
      boltsFired: statsBag.boltsFired,
      shotsFired: statsBag.shotsFired,
      lunges: statsBag.lunges,
      rays: statsBag.rays,
      wallAvoids: statsBag.wallAvoids,
      wreckEvictions: statsBag.wreckEvictions,
    };
  }

  /** writeStats(out)：把 stats 写入调用方预分配对象（热循环外亦可零分配采样）。 */
  function writeStats(out) {
    const s = stats();
    for (const k in s) out[k] = s[k];
    return out;
  }

  /** 自检：骨骼表完整性 + IK 数学边界 + 步态表覆盖 + 命中区完备 +（有 THREE）rig 结构。 */
  function selfCheck() {
    const problems = [];
    for (const type of TYPES) {
      const table = SKELETONS[type];
      const names = Object.create(null);
      for (const b of table) {
        if (names[b.name]) problems.push(type + ": duplicate bone " + b.name);
        names[b.name] = true;
      }
      for (const b of table) {
        if (b.parent && !names[b.parent]) problems.push(type + ": bone " + b.name + " dangling parent " + b.parent);
      }
    }
    const ik = { abd: 0, hip: 0, knee: 0, reach: 0 };
    solveIK(ik, 0.2, -0.2, 0.1, 1, HOUND_RIG.l0, HOUND_RIG.L1, HOUND_RIG.L2);
    if (!Number.isFinite(ik.abd + ik.hip + ik.knee)) problems.push("IK: non-finite angles at nominal reach");
    if (!(ik.reach > 0 && ik.reach <= 1.01)) problems.push("IK: bad reach " + ik.reach);
    solveIK(ik, 2, 2, 2, 1, HOUND_RIG.l0, HOUND_RIG.L1, HOUND_RIG.L2); // 不可达 → 必须夹紧
    if (!Number.isFinite(ik.hip + ik.knee)) problems.push("IK: non-finite angles beyond reach (clamp failed)");
    const seen = new Set();
    for (const pair of GAIT.pairs) for (const leg of pair) seen.add(leg);
    if (seen.size !== 4) problems.push("GAIT: pairs do not cover 4 legs exactly once");
    if (GAIT.stepThreshold !== 0.09) problems.push("GAIT: stepThreshold must be 0.09");
    if (HIT_ZONES.houndHeadR !== 0.155) problems.push("HIT: hound head radius must be 0.155");
    if (TYPES.length < 1) problems.push("enemyTypes floor violated");
    if (THREE) {
      const probe = pools.hound[0];
      if (!probe.rig || !probe.rig.mesh.isSkinnedMesh) problems.push("rig: hound mesh is not SkinnedMesh");
      else if (probe.rig.skeleton.bones.length !== SKELETONS.hound.length) problems.push("rig: skeleton bone count mismatch");
    }
    return {
      ok: problems.length === 0,
      problems,
      enemyTypes: TYPES.length,
      enemyRigs: stats().enemyRigs,
      bonesHound: SKELETONS.hound.length,
      bonesGull: SKELETONS.gull.length,
      gaitPairs: GAIT.pairs.length,
      spawnPoints: spawnPoints.length,
    };
  }

  return {
    TUNE,
    HOUND_RIG,
    GULL_HULL,
    GAIT,
    HIT_ZONES,
    SKELETONS,
    pools,
    active,
    wrecks,
    spawn,
    spawnAt,
    spawnWave,
    setSpawnPoints,
    update,
    raycast,
    addWreck,
    deactivate,
    stats,
    writeStats,
    selfCheck,
  };
}

/* ============================== 模块级自检 ============================== */

/**
 * 模块级自检（node 可跑，无 THREE）：常量/骨骼/IK/步态/命中区合同 +
 * 用 stub combat/physics 实例化 kit，跑 spawn/update/stats 与实例 selfCheck。
 * 保留实例方法 `selfCheck()`（同一套断言，供已装配场景调用）；本函数是模块入口别名。
 * 返回 { ok, problems, ...counts }。
 */
export function selfTest({ seed = 7 } = {}) {
  const problems = [];
  const combat = {
    events: { on() {}, emit() {} },
    createAgent({ pos }) {
      return { pos, lastKnown: { x: 0, y: 0, z: 0 }, noSeeT: 0 };
    },
    updatePerception() { return "idle"; },
    releaseToken() {},
    fireBolt() {},
    enemyShot() { return null; },
    alert() {},
    explode() {},
  };
  const physics = {
    raycast() { return null; },
    groundHeight() { return 0; },
  };

  let kit = null;
  try {
    kit = createEnemyKit(null, { combat, physics, seed });
  } catch (e) {
    problems.push("createEnemyKit(stub) threw: " + e.message);
  }
  if (!kit) return { ok: false, problems, enemyTypes: 0, enemySpawns: 0, enemyRigs: 0, bonesHound: 0, bonesGull: 0 };

  const check = kit.selfCheck();
  for (const p of check.problems) problems.push("selfCheck: " + p);
  if (check.enemyTypes < 1) problems.push("enemyTypes floor violated");

  kit.setSpawnPoints([0, 1, 2, 3, 4, 5].map((i) => ({ pos: { x: i, y: 0, z: 0 }, kind: "ground" })));
  const gul = kit.spawn("gull", { x: 0, y: 5, z: 0 });
  const hound = kit.spawn("hound", { x: 2, y: 0, z: 0 });
  if (!gul || !hound) problems.push("spawn failed for gull/hound");
  const player = { pos: { x: 4, y: 0, z: 0 }, alive: true };
  for (let i = 0; i < 10; i += 1) kit.update(1 / 60, player);
  const st = kit.stats();
  if (st.enemyTypes !== 2) problems.push("enemyTypes != 2: " + st.enemyTypes);
  if (st.enemySpawns < 6) problems.push("enemySpawns < 6: " + st.enemySpawns);
  if (st.active !== 2) problems.push("active != 2 after two spawns: " + st.active);
  if (!(gul.alive && hound.alive)) problems.push("spawned enemy died during idle update");
  if (!(gul.hp > 0 && hound.hp > 0)) problems.push("spawned enemy has no hp");
  if (typeof kit.selfCheck !== "function") problems.push("instance selfCheck missing");

  return {
    ok: problems.length === 0,
    problems,
    enemyTypes: st.enemyTypes,
    enemySpawns: st.enemySpawns,
    enemyRigs: st.enemyRigs,
    active: st.active,
    bonesHound: check.bonesHound,
    bonesGull: check.bonesGull,
    gaitPairs: check.gaitPairs,
  };
}
