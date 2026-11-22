/**
 * props-kit.mjs — 道具目录 / 17 个参数化 builder / 22 种 Canvas 贴花 / 碰撞盒输出。
 *
 * 出处（上游捕获明文 evidence/frames/app.pretty.js，光栅源 sources/jimao-3a-game/index.html）：
 *   - 道具尺寸表 PROP_SIZES（36 行 w/h/d/material/family）：[src:pretty:L35068-L35104]
 *   - builder 注册 _i(name, fn) + 通用盒回落 + userData.colliders：[src:pretty:L35107-L35133]
 *   - 展厅排布（max 26m 一行、1m 间距、相机）：[src:pretty:L35135-L35153]
 *   - 确定性 rng（seed*2654435761 洗牌）：[src:pretty:L35154-L35161]
 *   - 集装箱 3 变体 builder（doors/wear/color/flip、开口后分墙碰撞盒）：[src:pretty:L35890-L35925]
 *   - jersey_barrier 新泽西护栏型材：[src:pretty:L35927-L36003]
 *   - light_mast 锥形八棱杆/爬梯/横担 4 灯：[src:pretty:L36019-L36103]
 *   - fence_panel 立柱/链网/张紧线：[src:pretty:L36105-L36153]
 *   - guard_booth 玻璃岗亭/空调/踏板：[src:pretty:L36155-L36308]
 *   - gate_arm 道闸柜/9 段白红杆/立柱：[src:pretty:L36310-L36362]
 *   - bollard_mooring 双柱系缆桩：[src:pretty:L36364-L36410]
 *   - bollard_post 反光柱：[src:pretty:L36411-L36448]
 *   - sign_post 标志牌（6 种面 + 5 条钢印文案）：[src:pretty:L36450-L36493]
 *   - floodlight_stand 三脚泛光灯：[src:pretty:L36495-L36573]
 *   - stairs_metal 12 级钢梯：[src:pretty:L36575-L36642]
 *   - catwalk 格栅猫道（rails 参数）：[src:pretty:L36643-L36670]
 *   - shelf_rack 货架 + 种子货品：[src:pretty:L36738-L36833]
 *   - reefer_unit 冷机（风扇/冷凝器/铭牌）：[src:pretty:L36834-L36992]
 *   - relay_node 中继节点（双门/天线/钢印）：[src:pretty:L36998-L37352]
 *   - builder 注册表 17 项：[src:pretty:L37358-L37372]
 *   - 22 种贴花表（尺寸/bleed/rough/metal/text）：[src:pretty:L33225-L33620] [src:pretty:L33621-L33962]
 *   - 贴花调色板 Ut 与 rgba()：[src:pretty:L33036-L33043]
 *   - 数字 0-9 图集（640×128，0.5 宽高比）：[src:pretty:L33935-L33962]
 *   - 钢印/文本贴花 label(text,{color,font,distress})：[src:pretty:L35521-L35536]
 *
 * 合同（与 combat-kit / level-kit 同风格）：
 *   - 纯 JS、零引擎依赖、rng 注入、kit 内零 Math.random；默认 rng 由 seed 确定性派生。
 *   - `PROP_SIZES` 一行 = [w,h,d,material,family]；`has/buildModel/partsOf/collidersOf` 是引擎无关路径。
 *   - `createPropsKit(THREE, opts)`：THREE 作为**参数注入**（不顶层 import）；无 THREE 时 build() 明确报错，
 *     但目录/builder 零件表/碰撞盒/贴花表仍可 node 自测。
 *   - 零件是纯数据描述（box/cyl/tube/plane/decal/label/number），build() 才落成网格；
 *     同尺寸同材质的重复件走 InstancedMesh（集装箱瓦楞、猫道格栅、货架板）。
 *   - 碰撞盒沿用上游语义：局部坐标、y=0 落地、`surface` 表面族、`bulletOnly` 只挡弹道不挡行走。
 *   - 热循环零分配：builder/build 是一次性装配路径；逐帧只允许 `writeStats(out)`（写入调用方预分配对象）。
 *
 * 用法：
 *   const props = createPropsKit(THREE, { materials: mats /* sl-surface 工厂 *\/, decals });
 *   const g = props.build("container40hc", { seed: 7, doors: 0.6, color: "green" });
 *   scene.add(g);                                  // g.userData.size / .colliders / .lamps
 *   props.applyPhysics(physics, g, { tag: "c40a" });
 *   const c = props.decals.canvas("hazard_voltage"); // 22 种 Canvas 贴花
 *   props.stats();                                  // 目录计数 + 运行时实测计数
 *
 * 注：上游 PROP_SIZES 实际登记 36 行（manifest 记 35 类；多出的一行是 bollard_post 的同族占位），
 *     本 kit 按原文 36 行全量收录（≥ floor 的 12 类）。
 */

/* ============================== 1. 目录常量 ============================== */

/** 道具尺寸表：[w, h, d, material, family]；键名与上游建造成本表一一对应。 */
export const PROP_SIZES = Object.freeze({
  container20: Object.freeze([6.06, 2.59, 2.44, "paint_red", "metal"]),
  container40: Object.freeze([12.19, 2.59, 2.44, "paint_blue", "metal"]),
  container40hc: Object.freeze([12.19, 2.9, 2.44, "paint_green", "metal"]),
  jersey_barrier: Object.freeze([3, 0.81, 0.6, "concrete", "concrete"]),
  light_mast: Object.freeze([0.5, 14, 0.5, "steel_galv", "metal"]),
  fence_panel: Object.freeze([3, 2.4, 0.08, "chainlink", "metal"]),
  guard_booth: Object.freeze([2.6, 2.7, 2.2, "paint_white", "metal"]),
  gate_arm: Object.freeze([5, 1.1, 0.3, "hazard_stripes", "metal"]),
  bollard_mooring: Object.freeze([0.7, 0.6, 0.7, "steel_dark", "metal"]),
  bollard_post: Object.freeze([0.17, 1, 0.17, "paint_yellow", "metal"]),
  relay_node: Object.freeze([1.2, 2.4, 0.8, "paint_grey", "metal"]),
  shelf_rack: Object.freeze([2.7, 4.2, 1.1, "paint_orange", "metal"]),
  stairs_metal: Object.freeze([3, 2.6, 1, "diamond_plate", "metal"]),
  catwalk: Object.freeze([3, 1.1, 1.2, "diamond_plate", "metal"]),
  reefer_unit: Object.freeze([0.5, 2.3, 2.3, "paint_white", "metal"]),
  barrel: Object.freeze([0.6, 0.9, 0.6, "paint_blue", "metal"]),
  pallet: Object.freeze([1.2, 0.144, 1, "wood_pallet", "wood"]),
  pallet_stack: Object.freeze([1.2, 1.15, 1, "wood_pallet", "wood"]),
  crate_wood: Object.freeze([1.1, 1, 0.9, "wood_pallet", "wood"]),
  crate_stack: Object.freeze([1.2, 1.9, 1, "wood_pallet", "wood"]),
  ibc_tote: Object.freeze([1.2, 1.16, 1, "plastic_grey", "metal"]),
  forklift: Object.freeze([3.4, 2.2, 1.25, "paint_yellow", "metal"]),
  cable_reel: Object.freeze([1.3, 1.3, 0.8, "wood_dark", "wood"]),
  tire_stack: Object.freeze([0.8, 1, 0.8, "tire", "rubber"]),
  dumpster: Object.freeze([1.9, 1.35, 1.1, "paint_green", "metal"]),
  generator: Object.freeze([2.2, 1.4, 1, "paint_yellow", "metal"]),
  jerry_can: Object.freeze([0.35, 0.47, 0.17, "paint_green", "metal"]),
  traffic_cone: Object.freeze([0.36, 0.7, 0.36, "plastic_red", "rubber"]),
  gas_cylinders: Object.freeze([0.9, 1.6, 0.5, "steel_dark", "metal"]),
  tarp_cargo: Object.freeze([2.4, 1.5, 1.4, "tarp", "dirt"]),
  sandbags: Object.freeze([2, 0.9, 0.6, "tarp", "dirt"]),
  toolbox_cart: Object.freeze([0.9, 0.95, 0.5, "plastic_red", "metal"]),
  floodlight_stand: Object.freeze([1, 2.2, 1, "paint_yellow", "metal"]),
  cardboard_boxes: Object.freeze([1, 0.8, 0.8, "cardboard", "wood"]),
  pipe_stack: Object.freeze([6, 0.9, 1.2, "steel_rust", "metal"]),
  sign_post: Object.freeze([0.6, 2.4, 0.08, "paint_white", "metal"]),
});

/** 17 个参数化 builder（3 个集装箱变体 + 14 个零件）。 */
export const BUILDER_NAMES = Object.freeze([
  "container20",
  "container40",
  "container40hc",
  "jersey_barrier",
  "light_mast",
  "fence_panel",
  "guard_booth",
  "gate_arm",
  "bollard_mooring",
  "bollard_post",
  "sign_post",
  "floodlight_stand",
  "stairs_metal",
  "catwalk",
  "shelf_rack",
  "reefer_unit",
  "relay_node",
]);

/** 上游集装箱可换漆色（jg）与默认色（container20 red / 40 blue / 40hc green）。[src:pretty:L35557-L35563] */
export const PROP_PAINT_COLORS = Object.freeze(["red", "blue", "green", "yellow", "orange", "white", "grey", "teal"]);
const CONTAINER_DEFAULT_COLOR = Object.freeze({ container20: "red", container40: "blue", container40hc: "green" });

/** 标志牌 6 种面（Jg）与 5 条钢印文案（E3）。[src:pretty:L36448-L36449] */
export const SIGN_DECALS = Object.freeze([
  "hazard_general",
  "no_entry",
  "hazard_voltage",
  "berth4",
  "arrow",
  "hazard_flammable",
]);
export const SIGN_TEXTS = Object.freeze([
  "仅限授权人员",
  "禁止行人通行",
  "请穿反光衣并佩戴安全帽",
  "自动作业车辆",
  "请勿靠近",
]);

/** 贴花调色板（上游 Ut）。[src:pretty:L33036-L33043] */
export const DECAL_PALETTE = Object.freeze({
  white: Object.freeze([226, 223, 213]),
  black: Object.freeze([24, 24, 26]),
  yellow: Object.freeze([222, 172, 30]),
  red: Object.freeze([168, 36, 28]),
  navy: Object.freeze([24, 38, 58]),
  orange: Object.freeze([206, 100, 30]),
});

/**
 * 22 种贴花规格：[w, h, { bleed, rough?, metal?, text? }]。
 * bleed 为渗出底色（贴花边缘的"印刷底色"），rough/metal 供消费侧做贴花材质；
 * text=true 表示该面版含排版文字（需要 CJK/工字字体资源）。[src:pretty:L33225-L33620] [src:pretty:L33621-L33962]
 */
export const DECAL_SPECS = Object.freeze({
  hazard_flammable: Object.freeze([256, 256, Object.freeze({ bleed: "red", text: true })]),
  hazard_voltage: Object.freeze([256, 256, Object.freeze({ bleed: "yellow" })]),
  hazard_general: Object.freeze([256, 256, Object.freeze({ bleed: "yellow" })]),
  arrow: Object.freeze([384, 192, Object.freeze({ bleed: "white" })]),
  no_entry: Object.freeze([256, 256, Object.freeze({ bleed: "red" })]),
  logo_a: Object.freeze([640, 192, Object.freeze({ bleed: "white", text: true })]),
  logo_b: Object.freeze([640, 192, Object.freeze({ bleed: "white", text: true })]),
  logo_c: Object.freeze([640, 192, Object.freeze({ bleed: "navy", text: true })]),
  logo_d: Object.freeze([640, 192, Object.freeze({ bleed: "white", text: true })]),
  berth4: Object.freeze([640, 224, Object.freeze({ bleed: "yellow", text: true })]),
  caution_stripes: Object.freeze([512, 128, Object.freeze({ bleed: "black" })]),
  grime_streak: Object.freeze([128, 256, Object.freeze({ bleed: Object.freeze([26, 23, 19]), rough: 0.85 })]),
  rust_run: Object.freeze([128, 256, Object.freeze({ bleed: Object.freeze([118, 52, 18]), rough: 0.9 })]),
  oil_stain: Object.freeze([256, 256, Object.freeze({ bleed: Object.freeze([10, 10, 11]), rough: 0.12 })]),
  leak_stain: Object.freeze([192, 256, Object.freeze({ bleed: Object.freeze([160, 154, 132]), rough: 0.8 })]),
  bullet_metal: Object.freeze([128, 128, Object.freeze({ bleed: Object.freeze([96, 52, 40]), rough: 0.4, metal: 0.8 })]),
  bullet_concrete: Object.freeze([128, 128, Object.freeze({ bleed: Object.freeze([168, 164, 154]), rough: 0.95 })]),
  scorch: Object.freeze([256, 256, Object.freeze({ bleed: Object.freeze([8, 7, 6]), rough: 0.95 })]),
  crack: Object.freeze([256, 256, Object.freeze({ bleed: Object.freeze([20, 19, 18]), rough: 0.95 })]),
  graffiti_tag: Object.freeze([384, 256, Object.freeze({ bleed: Object.freeze([206, 214, 208]), rough: 0.6 })]),
  csc_plate: Object.freeze([288, 200, Object.freeze({ bleed: Object.freeze([150, 152, 150]), rough: 0.45, metal: 0.75, text: true })]),
  numbers_0_9: Object.freeze([640, 128, Object.freeze({ bleed: "white", text: true })]),
});

export const DECAL_TYPES = Object.freeze(Object.keys(DECAL_SPECS));

/** material → 消费侧缺省外观（未注入材质工厂时的回退；注入 materials 后优先级更高）。 */
export const MATERIAL_PRESETS = Object.freeze({
  paint_red: Object.freeze({ color: 0xa8241c, rough: 0.42, metal: 0.08 }),
  paint_blue: Object.freeze({ color: 0x1f3f6b, rough: 0.44, metal: 0.08 }),
  paint_green: Object.freeze({ color: 0x2e5940, rough: 0.44, metal: 0.08 }),
  paint_yellow: Object.freeze({ color: 0xdeac1e, rough: 0.4, metal: 0.08 }),
  paint_orange: Object.freeze({ color: 0xce641e, rough: 0.42, metal: 0.08 }),
  paint_white: Object.freeze({ color: 0xe2dfd5, rough: 0.4, metal: 0.06 }),
  paint_grey: Object.freeze({ color: 0x6f767c, rough: 0.46, metal: 0.1 }),
  paint_teal: Object.freeze({ color: 0x2a6668, rough: 0.44, metal: 0.08 }),
  concrete: Object.freeze({ color: 0x8d8c86, rough: 0.92, metal: 0.0 }),
  steel_galv: Object.freeze({ color: 0x9ba0a3, rough: 0.42, metal: 0.85 }),
  steel_dark: Object.freeze({ color: 0x3c4043, rough: 0.52, metal: 0.8 }),
  steel_rust: Object.freeze({ color: 0x8a4a24, rough: 0.86, metal: 0.35 }),
  aluminium: Object.freeze({ color: 0xc3c7c9, rough: 0.35, metal: 0.9 }),
  brass: Object.freeze({ color: 0xb08d3c, rough: 0.34, metal: 0.95 }),
  chainlink: Object.freeze({ color: 0x8c9295, rough: 0.5, metal: 0.85 }),
  hazard_stripes: Object.freeze({ color: 0xd8b02a, rough: 0.5, metal: 0.15 }),
  diamond_plate: Object.freeze({ color: 0x7b8083, rough: 0.55, metal: 0.8 }),
  wood_pallet: Object.freeze({ color: 0x9a7748, rough: 0.88, metal: 0.0 }),
  wood_dark: Object.freeze({ color: 0x5c4527, rough: 0.9, metal: 0.0 }),
  cardboard: Object.freeze({ color: 0xa98553, rough: 0.95, metal: 0.0 }),
  plastic_grey: Object.freeze({ color: 0x7d8388, rough: 0.5, metal: 0.05 }),
  plastic_red: Object.freeze({ color: 0xa8362b, rough: 0.48, metal: 0.05 }),
  plastic_blue: Object.freeze({ color: 0x2b4f86, rough: 0.48, metal: 0.05 }),
  polymer_black: Object.freeze({ color: 0x24262a, rough: 0.62, metal: 0.04 }),
  polymer_tan: Object.freeze({ color: 0xb3a389, rough: 0.7, metal: 0.02 }),
  rubber: Object.freeze({ color: 0x1e2022, rough: 0.86, metal: 0.0 }),
  tarp: Object.freeze({ color: 0x4f5a4a, rough: 0.78, metal: 0.0 }),
  tire: Object.freeze({ color: 0x1a1b1d, rough: 0.9, metal: 0.0 }),
  glass: Object.freeze({ color: 0x9fb7b4, rough: 0.12, metal: 0.0, opacity: 0.32 }),
  glass_dirty: Object.freeze({ color: 0x8d9c96, rough: 0.34, metal: 0.0, opacity: 0.45 }),
  lamp_warm: Object.freeze({ color: 0xffe3bd, rough: 0.3, metal: 0.0, emissive: 0xffe3bd }),
  lamp_cool: Object.freeze({ color: 0xfff1dc, rough: 0.3, metal: 0.0, emissive: 0xfff1dc }),
  lamp_red: Object.freeze({ color: 0xff5a1e, rough: 0.3, metal: 0.0, emissive: 0xff5a1e }),
  lamp_amber: Object.freeze({ color: 0xffd9a0, rough: 0.3, metal: 0.0, emissive: 0xffd9a0 }),
});

/* ============================== 2. rng 与数学 ============================== */

/** 上游确定性洗牌 rng（$a）：seed*2654435761 后 mulberry32。[src:pretty:L35154-L35161] */
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

const PI = Math.PI;
const TAU = PI * 2;
const HALF_PI = PI / 2;

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function clamp(v, a, b) {
  const n = Number(v);
  if (!Number.isFinite(n)) return a;
  return n < a ? a : n > b ? b : n;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function nameHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rngFor(name, seed, salt) {
  return createRng((nameHash(name) ^ Math.imul((Math.floor(seed) | 0) + 1, 2654435761) ^ (salt || 0)) >>> 0);
}

/* ============================== 3. 零件描述子 ============================== */
/* 纯数据，无 three 依赖；build() 才把描述子落成几何。 */

const K_BOX = "box";
const K_CYL = "cyl";
const K_TUBE = "tube";
const K_PLANE = "plane";
const K_DECAL = "decal";
const K_LABEL = "label";
const K_NUMBER = "number";

/** 几何签名：同签名才能共享 BufferGeometry / 走 InstancedMesh（r1/h/rad/pts 都在键内）。 */
function partGeoKey(part) {
  if (part.k === K_BOX) return "box|" + part.s.join(",");
  if (part.k === K_PLANE) return "plane|" + part.s.join(",") + "|" + (part.ds ? 1 : 0);
  if (part.k === K_CYL) return "cyl|" + part.r0 + "," + part.r1 + "," + part.h + "," + part.seg + "," + (part.open ? 1 : 0);
  if (part.k === K_TUBE) {
    let pts = "";
    for (let i = 0; i < part.pts.length; i += 1) pts += part.pts[i].join(",") + ";";
    return "tube|" + part.rad + "," + part.seg + "," + part.tension + "|" + pts;
  }
  return part.k;
}

function box(s, p, m, o) {
  const part = { k: K_BOX, s, p, m, rot: (o && o.rot) || null, r: (o && o.r) || 0, tag: (o && o.tag) || "body" };
  if (o && o.em !== undefined) { part.em = o.em; if (o.emc !== undefined) part.emc = o.emc; }
  return part;
}

function cyl(r0, r1, h, p, m, o) {
  const part = {
    k: K_CYL,
    r0,
    r1,
    h,
    p,
    m,
    seg: (o && o.seg) || 12,
    open: !!(o && o.open),
    rot: (o && o.rot) || null,
    tag: (o && o.tag) || "body",
  };
  if (o && o.em !== undefined) { part.em = o.em; if (o.emc !== undefined) part.emc = o.emc; }
  return part;
}

function tube(pts, rad, m, o) {
  return {
    k: K_TUBE,
    pts,
    rad,
    m,
    // o：摆放偏移（曲线点仍为局部坐标），让同形管件共享几何并走 InstancedMesh
    p: (o && o.o) || [0, 0, 0],
    rot: null,
    seg: (o && o.seg) || 6,
    tension: o && o.tension !== undefined ? o.tension : 0.4,
    cap: !!(o && o.cap),
    tag: (o && o.tag) || "body",
  };
}

function plane(s, p, m, o) {
  return { k: K_PLANE, s, p, m, rot: (o && o.rot) || null, ds: !!(o && o.ds), tag: (o && o.tag) || "body" };
}

function decal(d, size, p, rot, o) {
  return { k: K_DECAL, d, size, p, rot: rot || null, tag: "decal" };
}

function label(text, size, p, rot, o) {
  return {
    k: K_LABEL,
    text: String(text),
    size,
    p,
    rot: rot || null,
    color: (o && o.color) || "white",
    font: (o && o.font) || "sans",
    distress: o && o.distress !== undefined ? o.distress : 0.15,
  };
}

function number(v, size, p, rot) {
  return { k: K_NUMBER, v: Math.abs(Math.floor(v)), size, p, rot: rot || null };
}

/* ============================== 4. 17 个参数化 builder ============================== */

/* ---- 4.1 集装箱 3 变体 ---- */

function buildContainer(name, opts) {
  const S = PROP_SIZES[name];
  const W = S[0];
  const H = S[1];
  const D = S[2];
  const hw = W / 2;
  const hd = D / 2;
  const seed = opts.seed === undefined ? 0 : Math.abs(Math.floor(opts.seed));
  const rng = rngFor(name, seed, 0x51ed);
  const doors = clamp01(opts.doors || 0);
  const wear = opts.wear === undefined ? 0.5 : clamp01(opts.wear);
  const color = PROP_PAINT_COLORS.indexOf(opts.color) >= 0
    ? opts.color
    : (opts.seed === undefined ? CONTAINER_DEFAULT_COLOR[name] : PROP_PAINT_COLORS[(seed * 7 + 3) % PROP_PAINT_COLORS.length]);
  const body = "paint_" + color;
  const parts = [];
  const yMid = (H + 0.02) / 2;

  // 地板（木）与顶板
  parts.push(box([W - 0.1, 0.04, D - 0.1], [0, 0.06, 0], "wood_pallet", { tag: "floor" }));
  parts.push(box([W, 0.035, D], [0, H - 0.018, 0], body, { tag: "roof" }));

  // 两侧长墙 + 竖向瓦楞（上游 6/7 道；这里按长向 0.62m 节距）
  for (let side = -1; side <= 1; side += 2) {
    parts.push(box([W - 0.02, H - 0.12, 0.03], [0, yMid, side * (hd - 0.015)], body, { tag: "wall" }));
    const n = Math.max(4, Math.round((W - 0.3) / 0.62));
    for (let i = 0; i < n; i += 1) {
      const x = -hw + 0.2 + (i * (W - 0.4)) / (n - 1);
      parts.push(box([0.05, H - 0.2, 0.026], [x, yMid, side * (hd - 0.028)], body, { tag: "rib" }));
    }
  }

  // 上下侧梁与角柱
  for (let side = -1; side <= 1; side += 2) {
    parts.push(box([W, 0.14, 0.06], [0, 0.09, side * (hd - 0.03)], "steel_dark", { tag: "rail" }));
    parts.push(box([W, 0.12, 0.06], [0, H - 0.08, side * (hd - 0.03)], "steel_dark", { tag: "rail" }));
  }
  for (let sx = -1; sx <= 1; sx += 2) {
    for (let sz = -1; sz <= 1; sz += 2) {
      parts.push(box([0.13, H - 0.1, 0.13], [sx * (hw - 0.065), yMid, sz * (hd - 0.065)], "steel_dark", { tag: "post" }));
      parts.push(box([0.18, 0.13, 0.16], [sx * (hw - 0.09), 0.065, sz * (hd - 0.08)], "steel_dark", { tag: "casting" }));
      parts.push(box([0.18, 0.13, 0.16], [sx * (hw - 0.09), H - 0.065, sz * (hd - 0.08)], "steel_dark", { tag: "casting" }));
    }
  }

  // 门端（+x）：两片门叶，doors∈[0,1] 映射 0..1.48rad，绕 y 轴向 ±z 外摆
  const swing = doors * 1.48;
  const leafPart = (s, dx, dy, dz, size, m, extra) => {
    const th = -s * swing;
    const ox = dx;
    const oz = -s * (hd / 2 - 0.02) + dz;
    const cos = Math.cos(th);
    const sin = Math.sin(th);
    const px = hw + ox * cos + oz * sin;
    const pz = s * (hd - 0.02) - ox * sin + oz * cos;
    const part = box(size, [px, yMid + 0.01 + dy, pz], m, { rot: [0, th, 0], tag: "door" });
    if (extra && extra.em !== undefined) part.em = extra.em;
    return part;
  };
  for (let s = -1; s <= 1; s += 2) {
    parts.push(leafPart(s, 0, 0, 0, [0.035, H - 0.09, hd - 0.03], body));
    for (let i = 0; i < 4; i += 1) {
      const dz = -hd / 2 + 0.28 + (i * (hd - 0.56)) / 3;
      parts.push(leafPart(s, 0.028, 0, dz, [0.022, H - 0.2, 0.05], body));
    }
    for (let k = -1; k <= 1; k += 2) {
      const th = -s * swing;
      const oz = -s * (hd / 2 - 0.02) + k * (hd * 0.33);
      parts.push(cyl(0.013, 0.013, H - 0.14, [
        hw + 0.052 * Math.cos(th) + oz * Math.sin(th),
        yMid + 0.01,
        s * (hd - 0.02) - 0.052 * Math.sin(th) + oz * Math.cos(th),
      ], "steel_dark", { seg: 6, rot: [0, th, 0], tag: "lockbar" }));
    }
    parts.push(leafPart(s, 0.05, -0.42, -s * 0.55, [0.04, 0.05, 0.22], "steel_dark"));
    parts.push(leafPart(s, 0.06, -0.5, -s * 0.55, [0.03, 0.16, 0.03], "steel_dark"));
  }

  // 盲端（-x）：板 + 6 道瓦楞
  parts.push(box([0.03, H - 0.1, D - 0.04], [-hw, yMid, 0], body, { tag: "endwall" }));
  for (let i = 0; i < 6; i += 1) {
    const z = -hd + 0.22 + (i * (D - 0.44)) / 5;
    parts.push(box([0.026, H - 0.18, 0.06], [-hw - 0.016, yMid, z], body, { tag: "rib" }));
  }

  // 钢印/编号/logo：上游每只箱子门上加 CSC 铭牌与箱号
  parts.push(decal("csc_plate", 0.34, [-hw - 0.03, H * 0.62, 0], [0, -HALF_PI, 0]));
  parts.push(number(seed % 100000, 0.26, [-hw - 0.032, H * 0.34, 0.72], [0, -HALF_PI, 0]));
  parts.push(decal("logo_a", 0.92, [-hw - 0.03, H * 0.36, -0.78], [0, -HALF_PI, 0]));
  if (wear > 0.3) parts.push(decal("rust_run", 0.46, [-hw - 0.032, H * 0.2, -0.2 - rng() * 0.6], [0, -HALF_PI, 0]));
  if (wear > 0.66) parts.push(decal("grime_streak", 0.4, [-hw - 0.032, H * 0.12, 0.4 + rng() * 0.5], [0, -HALF_PI, 0]));
  if (name === "container40hc") {
    parts.push(decal("caution_stripes", 0.86, [hw + 0.03, 0.46, 0], [0, HALF_PI, 0]));
  } else if (wear > 0.5) {
    parts.push(decal("hazard_flammable", 0.2, [hw + 0.03, H * 0.5, -0.7], [0, HALF_PI, 0]));
  }

  // 碰撞盒：关门为整箱；开门拆成地板/顶板/两侧墙/盲端（开口端不挡）
  let colliders;
  if (doors <= 0) {
    colliders = [{ min: [-hw, 0, -hd], max: [hw, H, hd], surface: "metal" }];
  } else {
    colliders = [
      { min: [-hw, 0, -hd], max: [hw, 0.09, hd], surface: "wood" },
      { min: [-hw, H - 0.09, -hd], max: [hw, H, hd], surface: "metal" },
      { min: [-hw, 0, -hd], max: [hw, H, -hd + 0.07], surface: "metal" },
      { min: [-hw, 0, hd - 0.07], max: [hw, H, hd], surface: "metal" },
      { min: [-hw, 0, -hd], max: [-hw + 0.07, H, hd], surface: "metal" },
    ];
  }

  return {
    name,
    size: [W, H, D],
    parts,
    colliders,
    lamps: [],
    meta: { doors, wear, color },
  };
}

/* ---- 4.2 新泽西护栏 ---- */
function buildJerseyBarrier(opts) {
  const S = PROP_SIZES.jersey_barrier;
  const W = S[0];
  const H = S[1];
  const D = S[2];
  const rng = rngFor("jersey_barrier", opts.seed || 0, 11);
  const parts = [];
  // 型材（上游 12 点半宽）：0.3@0-0.076 → 0.127@0.33 → 0.1@0.57 → 0.077@0.79 → 0.06@0.81
  parts.push(box([D, 0.076, D * 0.5], [0, 0.038, 0], "concrete", { tag: "foot" }));
  parts.push(box([0.3, 0.254, D * 0.62], [0, 0.203, 0], "concrete", { tag: "slope" }));
  parts.push(box([0.222, 0.24, D * 0.44], [0, 0.45, 0], "concrete", { tag: "waist" }));
  parts.push(box([0.17, 0.22, D * 0.33], [0, 0.7, 0], "concrete", { tag: "head" }));
  parts.push(box([0.12, 0.02, D * 0.24], [0, 0.8, 0], "concrete", { tag: "cap" }));
  // 端头封板
  for (let s = -1; s <= 1; s += 2) {
    parts.push(box([0.02, 0.81, D], [s * (W / 2 - 0.01), 0.405, 0], "concrete", { tag: "end" }));
  }
  // 7 道竖向肋（上游随机 7 块），上下两段贴合型材宽度
  for (let i = 0; i < 7; i += 1) {
    const x = -1.25 + i * (2.5 / 6);
    parts.push(box([0.034, 0.34, D * 0.94], [x, 0.17, 0], "concrete", { tag: "rib" }));
    parts.push(box([0.028, 0.47, D * 0.36], [x, 0.575, 0], "concrete", { tag: "rib" }));
  }
  // 反光/涂装：顶帽亮条 + 随机污渍
  parts.push(box([0.1, 0.006, D * 0.22], [0, 0.812, 0], "paint_white", { tag: "trim" }));
  if (rng() > 0.4) parts.push(decal("grime_streak", 0.5, [0.2 + rng() * 1.1, 0.16, D / 2 + 0.002]));
  return {
    name: "jersey_barrier",
    size: [W, H, D],
    parts,
    colliders: [
      { min: [-W / 2, 0, -D / 2], max: [W / 2, 0.33, D / 2], surface: "concrete" },
      { min: [-W / 2, 0.33, -0.13], max: [W / 2, 0.81, 0.13], surface: "concrete" },
    ],
    lamps: [],
    meta: {},
  };
}

/* ---- 4.3 灯塔 ---- */
function buildLightMast(opts) {
  const S = PROP_SIZES.light_mast;
  const H = S[1];
  const on = opts.on !== false;
  const rng = rngFor("light_mast", opts.seed || 0, 3);
  const parts = [];
  const poleR = (y) => 0.168 + ((0.07 - 0.168) * (y - 0.35)) / (13.3 - 0.35);

  parts.push(box([0.8, 0.32, 0.8], [0, 0.16, 0], "concrete", { r: 0.03, tag: "plinth" }));
  parts.push(box([0.5, 0.03, 0.5], [0, 0.335, 0], "steel_galv", { tag: "baseplate" }));
  for (let i = 0; i < 8; i += 1) {
    const a = (i + 0.5) * (PI / 4);
    parts.push(cyl(0.014, 0.014, 0.1, [Math.cos(a) * 0.215, 0.38, Math.sin(a) * 0.215], "steel_galv", { seg: 6 }));
    parts.push(cyl(0.027, 0.027, 0.024, [Math.cos(a) * 0.215, 0.362, Math.sin(a) * 0.215], "steel_galv", { seg: 6 }));
  }
  // 三段锥形八棱杆（0.35→4.75→9.15→13.3）
  const segs = [[0.35, 4.75, 0], [4.75, 9.15, 0.007], [9.15, 13.3, 0.014]];
  for (const [y0, y1, seam] of segs) {
    parts.push(cyl(poleR(y0) + seam, poleR(y1) + seam, y1 - y0, [0, (y0 + y1) / 2, 0], "steel_galv", {
      seg: 8,
      open: true,
      rot: [0, PI / 8, 0],
      tag: "pole",
    }));
  }
  parts.push(cyl(0.2, 0.2, 0.02, [0, 0.36, 0], "steel_galv", { seg: 8, rot: [0, PI / 8, 0] }));
  parts.push(cyl(0.09, 0.09, 0.03, [0, 13.3, 0], "steel_galv", { seg: 8, rot: [0, PI / 8, 0] }));
  parts.push(cyl(poleR(3) + 0.012, poleR(3) + 0.012, 0.05, [0, 3, 0], "steel_galv", { seg: 8, rot: [0, PI / 8, 0] }));

  // 检修门 + 电压贴花 + 电缆
  const hatchZ = poleR(1.05) * 0.924 + 0.005;
  parts.push(box([0.13, 0.52, 0.012], [0, 1.05, hatchZ], "steel_galv", { tag: "hatch" }));
  parts.push(box([0.03, 0.045, 0.012], [0.04, 1.05, hatchZ + 0.013], "steel_dark", { tag: "handle" }));
  parts.push(decal("hazard_voltage", 0.09, [-0.01, 1.2, hatchZ + 0.0125]));
  parts.push(tube([[-0.3, 0.3, 0.28], [-0.3, 0.52, 0.28], [-0.24, 0.72, 0.2], [-0.1, 0.8, 0.1]], 0.024, "steel_dark", { seg: 6 }));
  parts.push(cyl(0.034, 0.034, 0.03, [-0.3, 0.335, 0.28], "steel_dark", { seg: 8 }));

  // 爬梯横档：3.45..12.9，0.38 节距，交替左右（等长 → 一条 InstancedMesh）
  let d = 0;
  for (let y = 3.45; y < 12.9; y += 0.38, d += 1) {
    const side = d % 2 ? 1 : -1;
    const zc = side * (poleR(y) * 0.9 + 0.075);
    parts.push(cyl(0.009, 0.009, 0.24, [0, y, zc], "steel_galv", { seg: 5, rot: [HALF_PI, 0, 0] }));
  }

  // 顶部横担 + 4 灯头
  const armY = H + 0.12;
  parts.push(box([0.1, 0.1, 1.9], [0, armY, 0], "steel_galv", { tag: "crossarm" }));
  for (let s = -1; s <= 1; s += 2) {
    parts.push(box([0.5, 0.07, 0.07], [0, armY + 0.085, s * 0.55], "steel_galv", { tag: "arm" }));
    parts.push(tube([[0, 13.0, s * 0.08], [0, armY - 0.03, s * 0.28], [0, armY - 0.03, s * 0.7]], 0.04, "steel_galv", { seg: 5 }));
  }
  for (let sz = -1; sz <= 1; sz += 2) {
    for (let sy = -1; sy <= 1; sy += 2) {
      const hx = sy * 0.34;
      const hz = sz * 0.55;
      parts.push(box([0.34, 0.18, 0.5], [hx, armY - 0.22, hz], "steel_dark", { tag: "lamphead" }));
      parts.push(box([0.29, 0.016, 0.44], [hx, armY - 0.32, hz], "lamp_warm", {
        em: on ? 8 : 0.02,
        emc: 0xffe3bd,
        tag: "lens",
      }));
    }
  }
  parts.push(box([0.16, 0.2, 0.12], [0, 13.05, -0.14], "steel_dark", { tag: "junction" }));
  parts.push(cyl(0.012, 0.012, 0.7, [0, armY + 0.42, 0], "steel_galv", { seg: 5 }));

  return {
    name: "light_mast",
    size: S.slice(0, 3),
    parts,
    colliders: [
      { min: [-0.4, 0, -0.4], max: [0.4, 0.32, 0.4], surface: "concrete" },
      { min: [-0.17, 0.32, -0.17], max: [0.17, 14, 0.17], surface: "metal" },
    ],
    lamps: [
      { pos: [0.34, armY - 0.22, 0.55], dir: [0.81, -0.58, 0], color: 0xffe3bd, on },
      { pos: [0.34, armY - 0.22, -0.55], dir: [0.81, -0.58, 0], color: 0xffe3bd, on },
      { pos: [-0.34, armY - 0.22, 0.55], dir: [-0.81, -0.58, 0], color: 0xffe3bd, on },
      { pos: [-0.34, armY - 0.22, -0.55], dir: [-0.81, -0.58, 0], color: 0xffe3bd, on },
    ],
    meta: { on, rng: rng() },
  };
}

/* ---- 4.4 围栏 ---- */
function buildFencePanel(opts) {
  const S = PROP_SIZES.fence_panel;
  const W = S[0];
  const H = S[1];
  const seed = opts.seed || 0;
  const rng = rngFor("fence_panel", seed, 5);
  const posts = opts.posts === "left" || opts.posts === "right" || opts.posts === "none" ? opts.posts : "both";
  const lean = opts.lean === 1 ? 1 : -1;
  const parts = [];
  const postX = posts === "both" ? [-1.5, 1.5] : posts === "left" ? [-1.5] : posts === "right" ? [1.5] : [];
  for (const x of postX) {
    parts.push(box([0.32, 0.09, 0.32], [x, 0.035, 0], "concrete", { r: 0.02, tag: "foot" }));
    parts.push(box([0.06, H, 0.06], [x, H / 2, 0], "steel_galv", { tag: "post" }));
    parts.push(cyl(0.04, 0.04, 0.02, [x, H + 0.01, 0], "steel_galv", { seg: 8 }));
  }
  parts.push(plane([W - 0.06, H - 0.06], [0, H / 2 - 0.02, 0], "chainlink", { ds: true, rot: [0, 0, lean * 0.01] }));
  parts.push(tube([[-1.5, H - 0.04, 0], [1.5, H - 0.04, 0]], 0.021, "steel_galv", { seg: 6, cap: true }));
  parts.push(tube([[-1.5, 0.06, 0], [1.5, 0.06, 0]], 0.006, "steel_galv", { seg: 4, cap: true }));
  // 张紧线束（上游 @2.0m 的随机折线）：同形 → 共享几何 + 摆放偏移
  for (let i = 0; i < 8; i += 1) {
    const x = -1.42 + i * 0.355 + rng() * 0.06;
    parts.push(tube([[0, 0.12, 0], [0.01, 2.3, 0]], 0.0032, "steel_galv", { seg: 4, o: [x, 0, 0] }));
  }
  for (let i = 0; i < 3; i += 1) {
    parts.push(box([0.012, 0.012, 0.03], [-1.2 + i * 0.6, 2.32, 0.02], "steel_galv", { tag: "clip" }));
  }
  if (rng() > 0.55) parts.push(decal("rust_run", 0.3, [-1.5, 0.9, 0.032], null, null));
  return {
    name: "fence_panel",
    size: S.slice(0, 3),
    parts,
    colliders: [{ min: [-1.5, 0, -0.04], max: [1.5, 2.4, 0.04], surface: "metal" }],
    lamps: [],
    meta: { posts, lean },
  };
}

/* ---- 4.5 岗亭 ---- */
function buildGuardBooth(opts) {
  const S = PROP_SIZES.guard_booth;
  const W = S[0]; // 2.6
  const D = S[2]; // 2.2（上游 r）
  const HGT = S[1]; // 2.7
  const seed = opts.seed || 0;
  const rng = rngFor("guard_booth", seed, 7);
  const color = ["white", "grey", "teal"].indexOf(opts.color) >= 0 ? opts.color : "white";
  const paint = "paint_" + color;
  const parts = [];
  const hw = W / 2;
  const hd = D / 2;

  parts.push(box([W + 0.14, 0.08, D + 0.14], [0, 0.04, 0], "concrete", { r: 0.02, tag: "slab" }));
  parts.push(box([W, 0.06, D], [0, 0.11, 0], paint, { tag: "deck" }));
  for (let sx = -1; sx <= 1; sx += 2) {
    for (let sz = -1; sz <= 1; sz += 2) {
      parts.push(box([0.08, 2.42, 0.08], [sx * (hw - 0.05), 0.14 + 1.21, sz * (hd - 0.05)], "steel_dark", { tag: "frame" }));
    }
  }
  // 下部裙板 4 面
  for (let sx = -1; sx <= 1; sx += 2) {
    parts.push(box([0.04, 0.82, D - 0.1], [sx * (hw - 0.04), 0.57, 0], paint, { tag: "panel" }));
  }
  for (let sz = -1; sz <= 1; sz += 2) {
    parts.push(box([W - 0.1, 0.82, 0.04], [0, 0.57, sz * (hd - 0.04)], paint, { tag: "panel" }));
  }
  // 玻璃带 1.0..2.3：4 面玻璃 + 竖梃
  for (let sx = -1; sx <= 1; sx += 2) {
    parts.push(plane([D - 0.12, 1.28], [sx * (hw - 0.045), 1.65, 0], "glass", { ds: true, rot: [0, HALF_PI, 0], tag: "glass" }));
    for (let i = 0; i < 3; i += 1) {
      parts.push(box([0.05, 1.34, 0.05], [sx * (hw - 0.04), 1.66, -hd + 0.32 + i * ((D - 0.64) / 2)], "steel_dark", { tag: "mullion" }));
    }
  }
  for (let sz = -1; sz <= 1; sz += 2) {
    parts.push(plane([W - 0.12, 1.28], [0, 1.65, sz * (hd - 0.03)], "glass", { ds: true, tag: "glass" }));
    for (let i = 0; i < 3; i += 1) {
      parts.push(box([0.05, 1.34, 0.05], [-hw + 0.32 + i * ((W - 0.64) / 2), 1.66, sz * (hd - 0.04)], "steel_dark", { tag: "mullion" }));
    }
  }
  parts.push(box([W + 0.2, 0.1, D + 0.2], [0, HGT - 0.11, 0], "steel_dark", { tag: "roof" }));
  parts.push(box([W + 0.26, 0.03, D + 0.26], [0, HGT - 0.05, 0], "steel_galv", { tag: "drip" }));
  // 门（+z 面）与踏板
  parts.push(box([0.92, 2.02, 0.05], [0.4, 1.15, hd - 0.02], paint, { tag: "door" }));
  parts.push(box([0.06, 2.04, 0.07], [-0.08, 1.15, hd - 0.01], "steel_dark", { tag: "jamb" }));
  parts.push(cyl(0.018, 0.018, 0.12, [0.78, 1.02, hd + 0.02], "steel_galv", { seg: 6, rot: [HALF_PI, 0, 0], tag: "handle" }));
  parts.push(box([0.7, 0.12, 0.35], [0.4, 0.06, hd + 0.2], "diamond_plate", { r: 0.01, tag: "step" }));
  // 侧挂空调 + 内搁板
  parts.push(box([0.34, 0.42, 0.6], [-hw - 0.17, 2.1, -0.3], "paint_grey", { r: 0.02, tag: "ac" }));
  parts.push(box([0.4, 0.02, 0.66], [-hw - 0.17, 2.32, -0.3], "steel_dark", { tag: "ac-cap" }));
  parts.push(box([1.2, 0.05, 0.4], [0.2, 1.12, -hd + 0.3], "wood_dark", { tag: "shelf" }));
  // 顶灯
  parts.push(box([0.24, 0.07, 0.24], [0, HGT - 0.2, 0], "steel_dark", { tag: "lampbase" }));
  parts.push(box([0.19, 0.02, 0.19], [0, HGT - 0.245, 0], "lamp_amber", { em: 1.6, emc: 0xffd9a6, tag: "lens" }));

  // 标识（上游：berth4 / no_entry / grime / rust / 钢印"门禁控制"）
  parts.push(decal("berth4", 0.34, [-hw - 0.03, 0.56, 0.3], [0, -HALF_PI, 0]));
  parts.push(decal("no_entry", 0.2, [0.4, 1.62, hd + 0.026]));
  parts.push(decal("grime_streak", 0.7, [-0.06, 0.5, -hd - 0.002], [0, PI, 0]));
  parts.push(decal("rust_run", 0.6, [-hw - 0.002, 0.5, 0.55], [0, -HALF_PI, 0]));
  parts.push(label("门禁控制", 0.12, [-0.45, 1.55, hd + 0.026], null, { color: "black", font: "stencil", distress: 0.2 }));

  return {
    name: "guard_booth",
    size: [W, HGT, D],
    parts,
    colliders: [{ min: [-hw, 0, -hd], max: [hw, 2.54, hd], surface: "metal" }],
    lamps: [{ pos: [0, HGT - 0.3, 0], dir: [0, -1, 0], color: 0xffd9a6, on: true }],
    meta: { color, rng: rng() },
  };
}

/* ---- 4.6 道闸 ---- */
function buildGateArm(opts) {
  const S = PROP_SIZES.gate_arm;
  const open = clamp01(opts.open || 0);
  const parts = [];
  const u = -2.5 + 0.19; // 机柜中心 x
  const pivotY = 0.92;
  const a = open * 1.48;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const boom = (dx, dy, dz, size, m, extra) => {
    const p = [u + dx * cos - dy * sin, pivotY + dx * sin + dy * cos, dz];
    const part = box(size, p, m, { rot: [0, 0, a], tag: "boom" });
    if (extra && extra.em !== undefined) part.em = extra.em;
    if (extra && extra.emc !== undefined) part.emc = extra.emc;
    return part;
  };

  parts.push(box([0.5, 0.06, 0.46], [u, 0.03, 0], "concrete", { r: 0.015, tag: "pad" }));
  parts.push(box([0.36, 1, 0.3], [u, 0.56, 0], "paint_orange", { r: 0.02, tag: "cabinet" }));
  parts.push(box([0.4, 0.04, 0.34], [u, 1.075, 0], "steel_dark", { r: 0.012, tag: "cap" }));
  parts.push(box([0.3, 0.6, 0.012], [u, 0.5, 0.151], "paint_orange", { r: 0.004, tag: "door" }));
  parts.push(cyl(0.012, 0.012, 0.016, [u + 0.1, 0.5, 0.16], "steel_galv", { seg: 6, rot: [HALF_PI, 0, 0], tag: "hinge" }));
  parts.push(decal("hazard_general", 0.14, [u, 0.9, 0.153]));
  parts.push(decal("caution_stripes", 0.08, [u, 0.12, 0.153]));
  parts.push(cyl(0.03, 0.03, 0.05, [u, 1.12, 0], "steel_dark", { seg: 8, tag: "beaconbase" }));
  parts.push(cyl(0.026, 0.026, 0.045, [u, 1.165, 0], "lamp_red", { seg: 8, em: 2.2, emc: 0xff5a1e, tag: "beacon" }));
  // 枢轴（水平轴，绕 z）
  parts.push(cyl(0.075, 0.075, 0.36, [u, pivotY, 0], "steel_dark", { seg: 10, rot: [HALF_PI, 0, 0], tag: "pivot" }));
  for (let sy = -1; sy <= 1; sy += 2) {
    parts.push(box([0.62, 0.11, 0.012], [u + 0.05, pivotY, sy * 0.175], "steel_dark", { r: 0.004, tag: "bracket" }));
  }
  parts.push(box([0.3, 0.16, 0.3], [u - 0.33, pivotY - 0.02, 0], "steel_dark", { r: 0.02, tag: "counterweight" }));
  // 9 段白红相间闸杆（长 4.62）
  const boomLen = 4.62;
  const segLen = boomLen / 9;
  for (let i = 0; i < 9; i += 1) {
    parts.push(boom(0.12 + segLen * (i + 0.5), 0, 0, [segLen + 0.001, 0.1 - i * 0.003, 0.05], i % 2 ? "paint_white" : "paint_red", null));
  }
  parts.push(boom(0.12 + boomLen + 0.012, 0, 0, [0.03, 0.11, 0.06], "steel_dark", null));
  parts.push(boom(0.12 + boomLen - 0.5, 0.058, 0, [0.05, 0.03, 0.054], "lamp_amber", { em: 1.5, emc: 0xffd9a6 }));
  // 远端支承柱
  const g = 2.5 - 0.1;
  parts.push(box([0.3, 0.05, 0.3], [g, 0.025, 0], "concrete", { r: 0.012, tag: "postpad" }));
  parts.push(cyl(0.04, 0.04, 0.8, [g, 0.45, 0], "paint_yellow", { seg: 8, tag: "support" }));
  parts.push(box([0.14, 0.02, 0.16], [g, 0.855, 0], "paint_yellow", { r: 0.005, tag: "saddle" }));
  for (let sy = -1; sy <= 1; sy += 2) {
    parts.push(box([0.14, 0.14, 0.014], [g, 0.93, sy * 0.073], "paint_yellow", { r: 0.004, tag: "saddle" }));
  }
  parts.push(cyl(0.07, 0.07, 0.01, [g, 0.055, 0], "steel_galv", { seg: 8, tag: "flange" }));

  const colliders = [
    { min: [u - 0.2, 0, -0.17], max: [u + 0.2, 1.1, 0.17], surface: "metal" },
    { min: [g - 0.07, 0, -0.08], max: [g + 0.07, 1, 0.08], surface: "metal" },
  ];
  if (open < 0.5) colliders.push({ min: [u, pivotY - 0.07, -0.04], max: [g, pivotY + 0.07, 0.04], surface: "metal" });

  return {
    name: "gate_arm",
    size: S.slice(0, 3),
    parts,
    colliders,
    lamps: [{ pos: [u, 1.165, 0], dir: [0, 1, 0], color: 0xff5a1e, on: true }],
    meta: { open },
  };
}

/* ---- 4.7 系缆桩 ---- */
function buildBollardMooring(opts) {
  const S = PROP_SIZES.bollard_mooring;
  const parts = [];
  parts.push(cyl(0.34, 0.35, 0.045, [0, 0.0225, 0], "steel_dark", { seg: 20, tag: "base" }));
  parts.push(cyl(0.37, 0.37, 0.006, [0, 0.003, 0], "steel_rust", { seg: 20, tag: "flange" }));
  for (let i = 0; i < 6; i += 1) {
    const a = (i * PI) / 3 + 0.3;
    parts.push(cyl(0.026, 0.026, 0.03, [Math.cos(a) * 0.285, 0.058, Math.sin(a) * 0.285], "steel_rust", { seg: 6 }));
    parts.push(cyl(0.013, 0.013, 0.022, [Math.cos(a) * 0.285, 0.08, Math.sin(a) * 0.285], "steel_rust", { seg: 6 }));
  }
  for (let sx = -1; sx <= 1; sx += 2) {
    parts.push(box([0.16, 0.42, 0.22], [sx * 0.18, 0.35, 0], "steel_dark", { r: 0.03, tag: "web" }));
  }
  // 水平双柱：横筒 + 两端法兰 + 椭圆端头
  parts.push(cyl(0.11, 0.11, 0.5, [0, 0.485, 0], "steel_dark", { seg: 16, rot: [0, 0, HALF_PI], tag: "barrel" }));
  for (let sx = -1; sx <= 1; sx += 2) {
    parts.push(cyl(0.125, 0.125, 0.03, [sx * 0.235, 0.485, 0], "steel_dark", { seg: 14, rot: [0, 0, HALF_PI], tag: "cap" }));
    parts.push(cyl(0.105, 0.108, 0.06, [sx * 0.278, 0.485, 0], "steel_rust", { seg: 12, rot: [0, 0, HALF_PI], tag: "end" }));
  }
  parts.push(decal("rust_run", 0.4, [0.19, 0.12, 0.11], [0, 0.4, 0]));
  return {
    name: "bollard_mooring",
    size: S.slice(0, 3),
    parts,
    colliders: [{ min: [-0.3, 0, -0.22], max: [0.3, 0.6, 0.22], surface: "metal" }],
    lamps: [],
    meta: {},
  };
}

/* ---- 4.8 反光柱 ---- */
function buildBollardPost(opts) {
  const S = PROP_SIZES.bollard_post;
  const parts = [];
  parts.push(box([0.17, 0.012, 0.17], [0, 0.006, 0], "steel_galv", { r: 0.004, tag: "plate" }));
  for (let sx = -1; sx <= 1; sx += 2) {
    for (let sz = -1; sz <= 1; sz += 2) {
      parts.push(cyl(0.011, 0.011, 0.012, [sx * 0.066, 0.017, sz * 0.066], "steel_galv", { seg: 6 }));
    }
  }
  parts.push(cyl(0.086, 0.086, 0.02, [0, 0.022, 0], "steel_galv", { seg: 14, open: true, tag: "collar" }));
  parts.push(cyl(0.083, 0.083, 0.588, [0, 0.306, 0], "paint_yellow", { seg: 14, open: true, tag: "post" }));
  parts.push(cyl(0.086, 0.086, 0.09, [0, 0.645, 0], "paint_white", { seg: 14, open: true, tag: "reflector" }));
  parts.push(cyl(0.082, 0.082, 0.12, [0, 0.72, 0], "paint_yellow", { seg: 14, open: true, tag: "post" }));
  parts.push(cyl(0.086, 0.086, 0.09, [0, 0.825, 0], "paint_white", { seg: 14, open: true, tag: "reflector" }));
  parts.push(cyl(0.08, 0.08, 0.085, [0, 0.9125, 0], "paint_yellow", { seg: 14, open: true, tag: "post" }));
  parts.push(cyl(0.089, 0.089, 0.02, [0, 0.965, 0], "steel_galv", { seg: 14, tag: "cap" }));
  return {
    name: "bollard_post",
    size: S.slice(0, 3),
    parts,
    colliders: [{ min: [-0.085, 0, -0.085], max: [0.085, 1, 0.085], surface: "metal" }],
    lamps: [],
    meta: {},
  };
}

/* ---- 4.9 标志牌 ---- */
function buildSignPost(opts) {
  const S = PROP_SIZES.sign_post;
  const seed = opts.seed === undefined ? 0 : Math.abs(Math.floor(opts.seed));
  const sign = SIGN_DECALS.indexOf(opts.sign) >= 0 ? opts.sign : SIGN_DECALS[seed % SIGN_DECALS.length];
  const text = SIGN_TEXTS[seed % SIGN_TEXTS.length];
  const danger = sign === "hazard_flammable" || sign === "hazard_voltage" || sign === "hazard_general";
  const parts = [];
  parts.push(box([0.3, 0.07, 0.3], [0, 0.035, 0], "concrete", { r: 0.015, tag: "foot" }));
  parts.push(box([0.05, 2.38, 0.05], [0, 1.2, 0], "steel_galv", { tag: "post" }));
  parts.push(box([0.058, 0.012, 0.058], [0, 2.395, 0], "steel_galv", { tag: "cap" }));
  parts.push(box([0.13, 0.012, 0.13], [0, 0.07, 0], "steel_galv", { tag: "flange" }));
  parts.push(box([0.6, 0.6, 0.004], [0, 2.02, 0.031], "aluminium", { tag: "plate" }));
  parts.push(box([0.58, 0.58, 0.002], [0, 2.02, 0.034], danger ? "paint_yellow" : "paint_white", { tag: "face" }));
  parts.push(decal(sign, 0.5, [0, 2.02, 0.0362]));
  parts.push(label(text, 0.42, [0, 1.64, 0.0362], null, { color: "black", font: "sans", distress: 0.25 }));
  for (let sx = -1; sx <= 1; sx += 2) {
    parts.push(cyl(0.008, 0.008, 0.004, [sx * 0.25, 2.02, 0.0365], "steel_galv", { seg: 6, rot: [HALF_PI, 0, 0] }));
  }
  for (let sx = -1; sx <= 1; sx += 2) {
    parts.push(box([0.03, 0.56, 0.03], [sx * 0.24, 2.02, 0.014], "steel_galv", { tag: "brace" }));
  }
  return {
    name: "sign_post",
    size: S.slice(0, 3),
    parts,
    colliders: [
      { min: [-0.03, 0, -0.03], max: [0.03, 2.4, 0.03], surface: "metal" },
      { min: [-0.3, 1.44, 0.02], max: [0.3, 2.33, 0.04], surface: "metal", bulletOnly: true },
    ],
    lamps: [],
    meta: { sign, text },
  };
}

/* ---- 4.10 泛光灯 ---- */
function buildFloodlightStand(opts) {
  const S = PROP_SIZES.floodlight_stand;
  const on = opts.on !== false;
  const parts = [];
  const mastY = 2.03;
  // 三脚架
  for (let i = 0; i < 3; i += 1) {
    const a = (i * TAU) / 3 + 0.4;
    const fx = Math.cos(a) * 0.55;
    const fz = Math.sin(a) * 0.55;
    parts.push(tube([[0, 0.78, 0], [fx * 0.55, 0.4, fz * 0.55], [fx, 0.02, fz]], 0.018, "aluminium", { seg: 6 }));
    parts.push(box([0.06, 0.03, 0.06], [fx, 0.015, fz], "rubber", { r: 0.01, tag: "foot" }));
  }
  parts.push(box([0.09, 0.05, 0.06], [0.1, 0.026, 0.1], "steel_galv", { tag: "foot" }));
  // 立杆（两段铝管）
  parts.push(cyl(0.021, 0.021, 1.1, [0, 0.75, 0], "aluminium", { seg: 8, open: true, tag: "mast" }));
  parts.push(cyl(0.016, 0.016, 0.9, [0, 1.6, 0], "aluminium", { seg: 8, open: true, tag: "mast" }));
  parts.push(cyl(0.03, 0.03, 0.06, [0, 1.3, 0], "steel_dark", { seg: 8, tag: "collar" }));
  parts.push(cyl(0.032, 0.032, 0.07, [0, 0.82, 0], "steel_dark", { seg: 8, tag: "collar" }));
  parts.push(cyl(0.03, 0.03, 0.05, [0, 0.36, 0], "steel_dark", { seg: 8, tag: "collar" }));
  // 摇柄
  parts.push(cyl(0.008, 0.008, 0.14, [0.11, 1.3, 0], "steel_dark", { seg: 8, rot: [0, 0, HALF_PI], tag: "crank" }));
  parts.push(cyl(0.02, 0.02, 0.02, [0.18, 1.3, 0], "rubber", { seg: 8, rot: [0, 0, HALF_PI], tag: "crank" }));
  // 灯头（yoke + 4 灯）
  parts.push(box([0.08, 0.06, 0.12], [0, mastY - 0.06, 0], "steel_dark", { tag: "yoke" }));
  parts.push(box([0.3, 0.04, 0.34], [0.14, mastY, 0], "steel_dark", { tag: "yoke" }));
  for (let sx = -1; sx <= 1; sx += 2) {
    for (let sz = -1; sz <= 1; sz += 2) {
      parts.push(box([0.13, 0.16, 0.13], [0.14 + sx * 0.09, mastY + 0.02, sz * 0.1], "paint_yellow", { r: 0.01, tag: "housing" }));
      parts.push(box([0.09, 0.012, 0.09], [0.2 + sx * 0.07, mastY + 0.02, sz * 0.1], "lamp_cool", {
        em: on ? 10 : 0.02,
        emc: 0xfff1dc,
        tag: "lens",
      }));
    }
  }
  // 电缆
  parts.push(tube([[0.02, 0.55, 0.02], [0.05, 1.1, 0.09], [0.08, 1.62, 0.05], [0.11, 1.95, 0.02]], 0.011, "polymer_black", { seg: 5 }));
  parts.push(box([0.09, 0.05, 0.06], [0.03, 0.026, 0.06], "steel_galv", { tag: "junction" }));
  return {
    name: "floodlight_stand",
    size: S.slice(0, 3),
    parts,
    colliders: [{ min: [-0.12, 0, -0.12], max: [0.12, 2.2, 0.12], surface: "metal" }],
    lamps: [{ pos: [0.14, 2.03, 0], dir: [0.976, -0.218, 0], color: 0xfff1dc, on }],
    meta: { on },
  };
}

/* ---- 4.11 钢梯 ---- */
function buildStairsMetal(opts) {
  const S = PROP_SIZES.stairs_metal;
  const steps = 12;
  const rise = 0.2;
  const run = 0.2;
  const x0 = -1.5;
  const parts = [];
  const colliders = [];
  for (let g = 0; g < steps; g += 1) {
    const x = x0 + g * run;
    const y = (g + 1) * rise;
    parts.push(box([0.25, 0.03, 0.9], [x + 0.125, y - 0.015, 0], "diamond_plate", { r: 0.005, tag: "tread" }));
    parts.push(box([0.03, 0.17, 0.9], [x + 0.015, y - 0.11, 0], "steel_dark", { tag: "riser" }));
    colliders.push({ min: [x, y - rise, -0.45], max: [x + run + 0.2, y, 0.45], surface: "metal" });
  }
  // 斜梁（45°）
  for (let sz = -1; sz <= 1; sz += 2) {
    parts.push(box([4.1, 0.08, 0.03], [0.55, 1.15, sz * 0.46], "steel_dark", { rot: [0, 0, PI / 4], tag: "stringer" }));
  }
  // 扶手：立柱 + 上下横杆 + 球头
  for (let sz = -1; sz <= 1; sz += 2) {
    for (let i = 0; i < 4; i += 1) {
      const x = x0 + 0.1 + i * 0.9;
      const y = 0.2 + i * 0.9 * 0.5;
      parts.push(box([0.045, 1.0, 0.045], [x, y + 0.5, sz * 0.45], "paint_yellow", { tag: "railpost" }));
    }
    parts.push(tube([[-1.45, 1.74, 0], [0.85, 2.84, 0]], 0.021, "paint_yellow", { seg: 7, cap: true, o: [0, 0, sz * 0.45] }));
    parts.push(tube([[-1.45, 1.24, 0], [0.85, 2.34, 0]], 0.016, "paint_yellow", { seg: 6, cap: true, o: [0, 0, sz * 0.45] }));
    for (let i = 0; i < 3; i += 1) {
      parts.push(cyl(0.026, 0.026, 0.026, [x0 + 0.1 + i * 1.4, 0.2 + i * 0.7 + 1.0, sz * 0.45], "paint_yellow", { seg: 7, rot: [HALF_PI, 0, 0], tag: "finial" }));
    }
  }
  parts.push(decal("caution_stripes", 0.6, [x0 + 0.1, 0.12, 0.452]));
  return {
    name: "stairs_metal",
    size: S.slice(0, 3),
    parts,
    colliders,
    lamps: [],
    meta: { steps, rise, run },
  };
}

/* ---- 4.12 猫道 ---- */
function buildCatwalk(opts) {
  const S = PROP_SIZES.catwalk;
  const base = 0.05;
  const rails = opts.rails === "left" || opts.rails === "right" || opts.rails === "none" ? opts.rails : "both";
  const sides = rails === "both" ? [-1, 1] : rails === "left" ? [-1] : rails === "right" ? [1] : [];
  const parts = [];
  const colliders = [];

  // 格栅：30 根纵向条 + 12 根横向条（同尺寸 → InstancedMesh）
  for (let z = -0.51; z <= 0.511; z += 0.034) {
    parts.push(box([2.98, 0.03, 0.004], [0, base + 0.0, z], "steel_galv", { tag: "grating" }));
  }
  for (let x = -1.45; x <= 1.451; x += 0.1) {
    parts.push(box([0.006, 0.006, 1.04], [x, base - 0.004, 0], "steel_galv", { tag: "grating" }));
  }
  parts.push(box([2.99, 0.032, 0.005], [0, base - 0.016, 0.525], "steel_galv", { tag: "edge" }));
  parts.push(box([2.99, 0.032, 0.005], [0, base - 0.016, -0.525], "steel_galv", { tag: "edge" }));
  parts.push(box([0.005, 0.032, 1.05], [1.493, base - 0.016, 0], "steel_galv", { tag: "edge" }));
  parts.push(box([0.005, 0.032, 1.05], [-1.493, base - 0.016, 0], "steel_galv", { tag: "edge" }));
  // 侧槽钢 + 横梁
  for (let s = -1; s <= 1; s += 2) {
    parts.push(box([3, 0.18, 0.06], [0, base - 0.09, s * 0.565], "steel_dark", { r: 0.008, tag: "channel" }));
  }
  for (const x of [-1.45, -0.5, 0.5, 1.45]) {
    parts.push(box([0.05, 0.1, 1.08], [x, base - 0.085, 0], "steel_dark", { r: 0.006, tag: "beam" }));
  }
  colliders.push({ min: [-1.5, base - 0.08, -0.6], max: [1.5, base, 0.6], surface: "metal" });

  // 栏杆（rails 参数）
  for (const s of sides) {
    const h = s * 0.565;
    parts.push(box([3, 0.1, 0.008], [0, base + 0.05, s * 0.535], "paint_yellow", { tag: "kickplate" }));
    for (const x of [-1.42, 0, 1.42]) {
      parts.push(box([0.045, 1.07, 0.045], [x, base + 0.52, h], "paint_yellow", { r: 0.006, tag: "railpost" }));
      parts.push(box([0.09, 0.012, 0.09], [x, base + 0.006, h], "steel_dark", { tag: "railbase" }));
    }
    parts.push(tube([[-1.5, base + 1.05, 0], [1.5, base + 1.05, 0]], 0.021, "paint_yellow", { seg: 7, cap: true, o: [0, 0, h] }));
    parts.push(tube([[-1.5, base + 0.55, 0], [1.5, base + 0.55, 0]], 0.016, "paint_yellow", { seg: 6, cap: true, o: [0, 0, h] }));
    colliders.push({ min: [-1.5, base, h - 0.035], max: [1.5, base + 1.05, h + 0.035], surface: "metal" });
  }
  parts.push(decal("caution_stripes", 0.8, [0, base + 0.02, 0.567], [0, PI / 2, 0]));
  return {
    name: "catwalk",
    size: S.slice(0, 3),
    parts,
    colliders,
    lamps: [],
    meta: { rails },
  };
}

/* ---- 4.13 货架 ---- */
function buildShelfRack(opts) {
  const S = PROP_SIZES.shelf_rack;
  const seed = opts.seed === undefined ? 0 : Math.abs(Math.floor(opts.seed));
  const rng = rngFor("shelf_rack", seed, 21);
  const parts = [];
  const H = S[1];
  const levels = [0.2, 1.55, 2.9];
  // 4 立柱 + 顶部横撑
  for (let sx = -1; sx <= 1; sx += 2) {
    for (let sz = -1; sz <= 1; sz += 2) {
      parts.push(box([0.08, H, 0.08], [sx * 1.31, H / 2, sz * 0.51], "paint_blue", { r: 0.012, tag: "upright" }));
    }
  }
  parts.push(box([2.62, 0.06, 0.06], [0, H - 0.03, 0.51], "paint_blue", { tag: "tie" }));
  parts.push(box([2.62, 0.06, 0.06], [0, H - 0.03, -0.51], "paint_blue", { tag: "tie" }));
  // 斜撑
  for (let sz = -1; sz <= 1; sz += 2) {
    parts.push(tube([[-1.31, 0.3, 0], [1.31, 1.4, 0]], 0.02, "paint_orange", { seg: 6, o: [0, 0, sz * 0.51] }));
  }
  // 三层梁 + 5 块木垫板（每层）
  for (const y of levels) {
    parts.push(box([2.62, 0.09, 0.05], [0, y, 0.51], "paint_orange", { tag: "beam" }));
    parts.push(box([2.62, 0.09, 0.05], [0, y, -0.51], "paint_orange", { tag: "beam" }));
    for (let o = -2; o <= 2; o += 1) {
      parts.push(box([0.14 + (o === 0 ? 0.02 : 0), 0.022, 1], [o * 0.2525, y + 0.133, 0], "wood_pallet", { tag: "deck" }));
    }
  }
  // 种子货品：每层两列，cartons / wrapped / drums / pallets / none
  const kinds = ["cartons", "wrapped", "drums", "cartons", "wrapped", "pallets", "none"];
  for (let li = 0; li < levels.length; li += 1) {
    const y = levels[li] + 0.146;
    for (let sx = -1; sx <= 1; sx += 2) {
      const kind = kinds[Math.floor(rng() * kinds.length)];
      const cx = sx * 0.615 + (rng() - 0.5) * 0.03;
      const jitter = (rng() - 0.5) * 0.05;
      if (kind === "cartons") {
        for (let i = 0; i < 3; i += 1) {
          parts.push(box([0.34, 0.3, 0.34], [cx + (i - 1) * 0.02, y + 0.15, jitter + (i - 1) * 0.0], "cardboard", { r: 0.004, rot: [0, jitter, 0], tag: "goods" }));
        }
        parts.push(box([0.36, 0.02, 0.36], [cx, y + 0.3, jitter], "polymer_tan", { tag: "tape" }));
      } else if (kind === "wrapped") {
        parts.push(box([0.55, 0.62, 0.5], [cx, y + 0.31, jitter], "glass_dirty", { r: 0.02, rot: [0, jitter, 0], tag: "goods" }));
        parts.push(box([0.57, 0.04, 0.52], [cx, y + 0.63, jitter], "polymer_tan", { tag: "wrap" }));
      } else if (kind === "drums") {
        for (let i = 0; i < 2; i += 1) {
          parts.push(cyl(0.27, 0.27, 0.85, [cx, y + 0.43, jitter + (i - 0.5) * 0.5], i ? "paint_red" : "plastic_blue", { seg: 14, tag: "goods" }));
          parts.push(cyl(0.28, 0.28, 0.03, [cx, y + 0.86, jitter + (i - 0.5) * 0.5], "steel_dark", { seg: 14, tag: "drumtop" }));
        }
      } else if (kind === "pallets") {
        parts.push(box([1.2, 0.144, 1], [cx, y + 0.072, jitter], "wood_pallet", { tag: "goods" }));
        parts.push(box([1.0, 0.4, 0.9], [cx, y + 0.34, jitter], "cardboard", { tag: "goods" }));
      }
    }
  }
  parts.push(decal("numbers_0_9", 0.3, [0.9, 0.35, 0.515]));
  parts.push(decal("hazard_general", 0.16, [-1.2, 1.7, 0.515]));
  return {
    name: "shelf_rack",
    size: S.slice(0, 3),
    parts,
    colliders: [{ min: [-1.35, 0, -0.55], max: [1.35, 4.2, 0.55], surface: "metal" }],
    lamps: [],
    meta: { seed, levels: levels.length },
  };
}

/* ---- 4.14 冷机 ---- */
function buildReeferUnit(opts) {
  const S = PROP_SIZES.reefer_unit;
  const W = S[0];
  const H = S[1];
  const D = S[2];
  const seed = opts.seed === undefined ? 0 : Math.abs(Math.floor(opts.seed));
  const rng = rngFor("reefer_unit", seed, 23);
  const parts = [];
  const xf = W / 2;
  parts.push(box([W, H, D], [0, H / 2, 0], "paint_white", { r: 0.02, tag: "casing" }));
  parts.push(box([W + 0.02, 0.06, D + 0.02], [0, H - 0.03, 0], "steel_galv", { tag: "lid" }));
  // 压缩机格栅
  parts.push(box([0.02, 1.2, 1.8], [xf - 0.01, 0.95, 0], "steel_dark", { tag: "grille" }));
  for (let i = 0; i < 8; i += 1) {
    parts.push(box([0.03, 0.055, 1.72], [xf + 0.004, 0.42 + i * 0.14, 0], "steel_galv", { tag: "fin" }));
  }
  // 冷凝器风扇（轴向沿 x）
  parts.push(cyl(0.42, 0.42, 0.06, [xf + 0.03, 1.55, 0], "steel_dark", { seg: 18, rot: [0, 0, HALF_PI], tag: "cowl" }));
  parts.push(cyl(0.09, 0.09, 0.06, [xf + 0.05, 1.55, 0], "steel_galv", { seg: 12, rot: [0, 0, HALF_PI], tag: "hub" }));
  for (let i = 0; i < 4; i += 1) {
    const a = (i * PI) / 2 + 0.2;
    parts.push(box([0.02, 0.32, 0.1], [xf + 0.05, 1.55 + Math.sin(a) * 0.16, Math.cos(a) * 0.16], "aluminium", { rot: [a, 0, 0], tag: "blade" }));
  }
  parts.push(cyl(0.44, 0.44, 0.008, [xf + 0.06, 1.55, 0], "steel_galv", { seg: 18, rot: [0, 0, HALF_PI], tag: "guard" }));
  // 控制面板 + 指示灯
  parts.push(box([0.03, 0.4, 0.35], [xf, 0.4, 0.62], "steel_dark", { tag: "panel" }));
  parts.push(box([0.02, 0.05, 0.05], [xf + 0.012, 0.52, 0.66], "lamp_amber", { em: 2, emc: 0xffd9a0, tag: "led" }));
  parts.push(box([0.02, 0.05, 0.05], [xf + 0.012, 0.52, 0.58], "lamp_red", { em: 1.4, emc: 0xff5a1e, tag: "led" }));
  // 安装托架与电缆
  for (let sz = -1; sz <= 1; sz += 2) {
    parts.push(box([0.18, 0.06, 0.1], [-0.1, H - 0.2, sz * (D / 2 - 0.3)], "steel_galv", { tag: "bracket" }));
  }
  parts.push(tube([[0.1, 0.1, 0.9], [0.1, 0.14, 1.06], [0.1, 0.12, 1.2]], 0.016, "polymer_black", { seg: 6 }));
  parts.push(box([0.07, 0.07, 0.12], [0.1, 0.14, 1.1], "steel_galv", { r: 0.015, tag: "cablebox" }));
  // 铭牌/编号/污渍
  parts.push(decal("grime_streak", 0.8, [-0.2512, 0.5, -1.1], [0, HALF_PI, 0]));
  parts.push(label("CARRIER", 0.18, [xf + 0.006, 1.95, 0], [0, HALF_PI, 0], { color: "black", font: "sans", distress: 0.12 }));
  parts.push(number(seed % 10000, 0.16, [xf + 0.006, 1.78, 0.35], [0, HALF_PI, 0]));
  parts.push(decal("logo_c", 0.55, [xf + 0.006, 0.78, -0.6], [0, HALF_PI, 0]));
  return {
    name: "reefer_unit",
    size: [W, H, D],
    parts,
    colliders: [{ min: [-0.25, 0, -1.15], max: [0.25, 2.3, 1.15], surface: "metal" }],
    lamps: [{ pos: [xf + 0.1, 0.5, 0.6], dir: [1, 0, 0], color: 0xffd9a0, on: true }],
    meta: { seed, rng: rng() },
  };
}

/* ---- 4.15 中继节点 ---- */
function buildRelayNode(opts) {
  const S = PROP_SIZES.relay_node;
  const seed = opts.seed === undefined ? 0 : Math.abs(Math.floor(opts.seed));
  const id = opts.id || opts.label || "ABC"[seed % 3];
  const parts = [];
  parts.push(box([1.36, 0.16, 0.96], [0, 0.08, 0], "concrete", { r: 0.02, tag: "base" }));
  parts.push(box([1.14, 1.51, 0.65], [0, 0.915, 0], "paint_grey", { r: 0.014, tag: "cabinet" }));
  parts.push(box([1.2, 0.06, 0.7], [0, 1.7, 0], "steel_dark", { r: 0.01, tag: "roof" }));
  // 双门（+z）
  for (let sx = -1; sx <= 1; sx += 2) {
    parts.push(box([0.55, 1.4, 0.04], [sx * 0.282, 0.94, 0.33], "paint_grey", { r: 0.006, tag: "door" }));
    for (let i = 0; i < 4; i += 1) {
      parts.push(box([0.42, 0.03, 0.014], [sx * 0.282, 0.62 + i * 0.2, 0.352], "steel_dark", { tag: "louver" }));
    }
    parts.push(box([0.03, 0.2, 0.02], [sx * 0.07, 0.98, 0.356], "steel_galv", { tag: "handle" }));
    parts.push(cyl(0.012, 0.012, 0.09, [sx * 0.54, 0.94, 0.35], "steel_galv", { seg: 6, tag: "hinge" }));
  }
  parts.push(box([1.02, 0.03, 0.012], [0, 0.62, 0.352], "steel_dark", { tag: "divider" }));
  // 天线（behind, bullet only）
  parts.push(cyl(0.03, 0.03, 0.8, [-0.3, 2.06, -0.14], "steel_galv", { seg: 8, tag: "mast" }));
  parts.push(cyl(0.018, 0.018, 0.26, [-0.3, 2.56, -0.14], "steel_dark", { seg: 6, tag: "antenna" }));
  parts.push(box([0.09, 0.05, 0.06], [-0.3, 2.68, -0.14], "lamp_amber", { em: 2, emc: 0xffd9a0, tag: "beacon" }));
  for (let i = 0; i < 3; i += 1) {
    parts.push(tube([[0, 0.4, -0.33], [0, 0.14, -0.4], [0, 0.02, -0.5]], 0.022, "polymer_black", { seg: 6, o: [-0.5 + i * 0.2, 0, 0] }));
  }
  // 钢印/贴花
  parts.push(label("中继 " + id, 0.34, [0, 1.42, 0.358], null, { color: "yellow", font: "stencil", distress: 0.15 }));
  parts.push(label("港区主控上行链路", 0.3, [0, 1.28, 0.358], null, { color: "white", font: "sans", distress: 0.15 }));
  parts.push(decal("hazard_voltage", 0.13, [0.13, 1.52, 0.358]));
  parts.push(decal("hazard_general", 0.13, [0.282, 0.93, 0.374]));
  parts.push(label("检修前请断电", 0.24, [0.282, 1.02, 0.374], null, { color: "white", font: "sans", distress: 0.15 }));
  parts.push(label("接线图 SLT-R4", 0.2, [0, 0.78, -0.3305], [0, PI, 0], { color: "white", font: "sans", distress: 0.1 }));
  return {
    name: "relay_node",
    size: S.slice(0, 3),
    parts,
    colliders: [
      { min: [-0.68, 0, -0.48], max: [0.68, 0.16, 0.48], surface: "concrete" },
      { min: [-0.57, 0.16, -0.32], max: [0.57, 1.67, 0.33], surface: "metal" },
      { min: [-0.42, 1.67, -0.26], max: [-0.18, 2.5, -0.02], surface: "metal", bulletOnly: true },
    ],
    lamps: [{ pos: [-0.3, 2.68, -0.14], dir: [0, 1, 0], color: 0xffd9a0, on: true }],
    meta: { id },
  };
}

/** 17 个 builder 的注册表（与上游 _i() 一一对应）。 */
export const PROP_BUILDERS = Object.freeze({
  container20: (opts) => buildContainer("container20", opts),
  container40: (opts) => buildContainer("container40", opts),
  container40hc: (opts) => buildContainer("container40hc", opts),
  jersey_barrier: buildJerseyBarrier,
  light_mast: buildLightMast,
  fence_panel: buildFencePanel,
  guard_booth: buildGuardBooth,
  gate_arm: buildGateArm,
  bollard_mooring: buildBollardMooring,
  bollard_post: buildBollardPost,
  sign_post: buildSignPost,
  floodlight_stand: buildFloodlightStand,
  stairs_metal: buildStairsMetal,
  catwalk: buildCatwalk,
  shelf_rack: buildShelfRack,
  reefer_unit: buildReeferUnit,
  relay_node: buildRelayNode,
});

export const PROP_FAMILIES = Object.freeze(
  Object.keys(PROP_SIZES).reduce((acc, k) => {
    const f = PROP_SIZES[k][4];
    if (acc.indexOf(f) < 0) acc.push(f);
    return acc;
  }, []),
);

/* ============================== 5. 引擎无关 API ============================== */

export function propSize(name) {
  const row = PROP_SIZES[name];
  return row ? row : null;
}

export function propMaterial(name) {
  const row = PROP_SIZES[name];
  return row ? row[3] : null;
}

export function propFamily(name) {
  const row = PROP_SIZES[name];
  return row ? row[4] : null;
}

export function isBuilder(name) {
  return Object.prototype.hasOwnProperty.call(PROP_BUILDERS, name);
}

/** 未知道具回落到带碰撞盒的通用盒（上游行为）。 */
function fallbackModel(name, opts) {
  const row = PROP_SIZES[name] || [1, 1, 1, "concrete", "concrete"];
  const w = row[0];
  const h = row[1];
  const d = row[2];
  const y = (opts && opts.rotationY) || 0;
  return {
    name,
    size: [w, h, d],
    parts: [
      box([w, h, d], [0, h / 2, 0], row[3], { rot: y ? [0, y, 0] : null, tag: "body" }),
      box([w * 1.02, 0.03, d * 1.02], [0, 0.015, 0], row[3], { tag: "trim" }),
    ],
    colliders: [{ min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2], surface: row[4] }],
    lamps: [],
    meta: { fallback: true },
    fallback: true,
  };
}

/**
 * 生成道具的零件/碰撞盒描述（纯数据，无需 THREE）。
 * 返回 { name, size, parts, colliders, lamps, meta, fallback? }。
 */
export function buildModel(name, opts = {}) {
  if (!PROP_SIZES[name] && !isBuilder(name)) {
    return fallbackModel(name, opts);
  }
  const fn = PROP_BUILDERS[name];
  if (!fn) return fallbackModel(name, opts);
  const o = opts || {};
  const model = fn(o);
  model.size = PROP_SIZES[name] ? PROP_SIZES[name].slice(0, 3) : model.size;
  return model;
}

/** 碰撞盒（局部坐标，y=0 落地）；缺失 builder 时给通用盒。 */
export function propColliders(name, opts = {}) {
  return buildModel(name, opts).colliders;
}

/** 世界坐标 AABB：把局部碰撞盒按摆放位姿（at/rotY）展开（旋转按 AABB 近似，与 level-kit 一致）。 */
export function worldColliders(name, opts, placement = {}) {
  const at = placement.at || [0, 0, 0];
  const yaw = placement.rotY || 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const out = [];
  for (const c of propColliders(name, opts)) {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < 4; i += 1) {
      const lx = i & 1 ? c.max[0] : c.min[0];
      const lz = i & 2 ? c.max[2] : c.min[2];
      const wx = lx * cos + lz * sin;
      const wz = -lx * sin + lz * cos;
      if (wx < x0) x0 = wx;
      if (wx > x1) x1 = wx;
      if (wz < z0) z0 = wz;
      if (wz > z1) z1 = wz;
    }
    const box2 = {
      min: [x0 + at[0], c.min[1] + at[1], z0 + at[2]],
      max: [x1 + at[0], c.max[1] + at[1], z1 + at[2]],
      surface: c.surface,
    };
    if (c.bulletOnly) box2.bulletOnly = true;
    out.push(box2);
  }
  return out;
}

/** 展厅排布（上游 showcase）：一行 ≤26m、1m 间距；返回纯数据，由消费侧落成网格。 */
export function showcase(names) {
  const list = names && names.length ? names : Object.keys(PROP_SIZES);
  const placements = [];
  let cx = 0;
  let cz = 0;
  let rowDepth = 0;
  let maxX = 0;
  for (const name of list) {
    const size = PROP_SIZES[name] ? PROP_SIZES[name].slice(0, 3) : [1, 1, 1];
    if (cx + size[0] > 26) {
      cx = 0;
      cz += rowDepth + 1.5;
      rowDepth = 0;
    }
    placements.push({ prop: name, at: [cx + size[0] / 2, 0, cz], size });
    cx += size[0] + 1;
    rowDepth = Math.max(rowDepth, size[2]);
    maxX = Math.max(maxX, cx);
  }
  const r = Math.min(maxX, 26) / 2;
  return {
    placements,
    cam: [r - 4, 2.2, cz + rowDepth + 6],
    target: [r, 1, cz / 2],
  };
}

/* ============================== 6. 22 种 Canvas 贴花 ============================== */

const TAU2 = TAU;

function rgba(c, a = 1) {
  return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
}

function palOf(pal, key, a) {
  const c = pal[key] || pal.white;
  return rgba(c, a);
}

function blob(ctx, x, y, r, c0, c1) {
  if (typeof ctx.createRadialGradient !== "function") return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, r));
  g.addColorStop(0, c0);
  g.addColorStop(1, c1);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(1, r), 0, TAU2);
  ctx.fill();
}

function diamond(ctx, cx, cy, r, fill, edge, edgeW) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(PI / 4);
  ctx.fillStyle = fill;
  ctx.fillRect(-r, -r, r * 2, r * 2);
  if (edge) {
    ctx.strokeStyle = edge;
    ctx.lineWidth = edgeW || 4;
    ctx.strokeRect(-r + (edgeW || 4) * 0.7, -r + (edgeW || 4) * 0.7, r * 2 - (edgeW || 4) * 1.4, r * 2 - (edgeW || 4) * 1.4);
  }
  ctx.restore();
}

/** 工字钢印/无衬线排版（对应上游 qa/l 与 mats.label）。[src:pretty:L35521-L35536] */
function stampText(ctx, text, x, y, size, color, opts = {}) {
  const sans = opts.font === "sans";
  const family = sans
    ? '"PingFang SC","Noto Sans CJK SC","Helvetica Neue",Arial,sans-serif'
    : '"PingFang SC","Courier New",monospace';
  const weight = opts.weight || (sans ? 600 : 700);
  const align = opts.align || "left";
  ctx.save();
  ctx.font = weight + " " + size + "px " + family;
  if (typeof ctx.textAlign === "string") ctx.textAlign = align;
  if (typeof ctx.textBaseline === "string") ctx.textBaseline = "alphabetic";
  ctx.fillStyle = color;
  let w = 0;
  if (typeof ctx.measureText === "function") {
    const m = ctx.measureText(text);
    w = m && m.width ? m.width : 0;
  }
  let scale = 1;
  if (opts.maxW && w > 0 && w > opts.maxW) scale = opts.maxW / w;
  ctx.translate(x, y);
  if (scale !== 1) ctx.scale(scale, 1);
  if (typeof ctx.fillText === "function") ctx.fillText(text, 0, 0);
  // 钢印断桥：挖 2-4 条竖缝，让字像喷涂漏字板
  if (opts.stencil && typeof ctx.fillRect === "function") {
    const ww = w * scale || size * text.length * 0.6;
    const left = align === "center" ? -ww / 2 : align === "right" ? -ww : 0;
    ctx.globalCompositeOperation = "destination-out";
    const n = opts.gaps || 3;
    for (let i = 0; i < n; i += 1) {
      const gx = left + ((i + 0.6) * ww) / (n + 0.2);
      ctx.fillRect(gx, -size * 0.86, Math.max(1, size * 0.055), size * 1.02);
    }
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.restore();
}

/** 做旧飞白（上游 Ks）。 */
function distress(ctx, W, H, rng, amount) {
  const n = Math.floor(28 + amount * 70);
  ctx.save();
  for (let i = 0; i < n; i += 1) {
    const x = rng() * W;
    const y = rng() * H;
    const r = 0.6 + rng() * (1.6 + amount * 4);
    ctx.fillStyle = "rgba(0,0,0," + (0.05 + rng() * 0.16) + ")";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU2);
    ctx.fill();
  }
  ctx.restore();
}

function hazardDiamond(ctx, W, H, rng, pal, fill, mark) {
  diamond(ctx, W / 2, H / 2, W * 0.335, fill, palOf(pal, "white", 0.95), 5);
  mark(ctx, W, H);
  distress(ctx, W, H, rng, 0.28);
}

/** 22 个 Canvas painter：name → (ctx, W, H, rng, pal)。 */
const DECAL_PAINTERS = {
  hazard_flammable(ctx, W, H, rng, pal) {
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(PI / 4);
    ctx.fillStyle = palOf(pal, "red");
    ctx.fillRect(-86, -86, 172, 172);
    ctx.strokeStyle = palOf(pal, "white");
    ctx.lineWidth = 5;
    ctx.strokeRect(-76, -76, 152, 152);
    ctx.restore();
    ctx.save();
    ctx.translate(W / 2, H / 2 - 8);
    ctx.fillStyle = palOf(pal, "white");
    ctx.beginPath();
    ctx.moveTo(2, -64);
    ctx.bezierCurveTo(34, -28, 40, 6, 24, 28);
    ctx.bezierCurveTo(12, 44, -12, 44, -24, 28);
    ctx.bezierCurveTo(-40, 6, -20, -12, -15, -34);
    ctx.bezierCurveTo(-6, -28, 0, -44, 2, -64);
    ctx.fill();
    ctx.fillStyle = palOf(pal, "red");
    ctx.beginPath();
    ctx.moveTo(1, -10);
    ctx.bezierCurveTo(15, 6, 15, 24, 0, 31);
    ctx.bezierCurveTo(-15, 24, -13, 8, 1, -10);
    ctx.fill();
    ctx.fillStyle = palOf(pal, "white");
    ctx.fillRect(-34, 50, 68, 6);
    ctx.restore();
    stampText(ctx, "3", W / 2, H * 0.9, 34, palOf(pal, "white"), { align: "center", weight: 900, stencil: true });
    distress(ctx, W, H, rng, 0.3);
  },

  hazard_voltage(ctx, W, H, rng, pal) {
    hazardDiamond(ctx, W, H, rng, pal, palOf(pal, "yellow"), (c) => {
      const pts = [[12, -58], [-24, 4], [-3, 4], [-16, 50], [26, -14], [5, -14], [22, -58]];
      c.save();
      c.translate(W / 2, H * 0.56);
      c.fillStyle = palOf(pal, "black");
      c.beginPath();
      for (let i = 0; i < pts.length; i += 1) (i ? c.lineTo(pts[i][0], pts[i][1]) : c.moveTo(pts[i][0], pts[i][1]));
      c.closePath();
      c.fill();
      c.restore();
    });
  },

  hazard_general(ctx, W, H, rng, pal) {
    hazardDiamond(ctx, W, H, rng, pal, palOf(pal, "yellow"), (c) => {
      c.fillStyle = palOf(pal, "black");
      c.beginPath();
      c.moveTo(W / 2 - 13, H * 0.34);
      c.lineTo(W / 2 + 13, H * 0.34);
      c.lineTo(W / 2 + 7, H * 0.62);
      c.lineTo(W / 2 - 7, H * 0.62);
      c.closePath();
      c.fill();
      c.beginPath();
      c.arc(W / 2, H * 0.715, 11, 0, TAU2);
      c.fill();
    });
  },

  arrow(ctx, W, H, rng, pal) {
    const pts = [[20, 68], [226, 68], [226, 22], [364, 96], [226, 170], [226, 124], [20, 124]];
    ctx.fillStyle = palOf(pal, "white");
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 1) (i ? ctx.lineTo(pts[i][0], pts[i][1]) : ctx.moveTo(pts[i][0], pts[i][1]));
    ctx.closePath();
    ctx.fill();
    // 上游箭杆上的两处断桥
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillRect(118, 0, 9, H);
    ctx.fillRect(232, 0, 7, H);
    ctx.globalCompositeOperation = "source-over";
    distress(ctx, W, H, rng, 0.2);
  },

  no_entry(ctx, W, H, rng, pal) {
    ctx.fillStyle = palOf(pal, "white");
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 112, 0, TAU2);
    ctx.fill();
    ctx.fillStyle = palOf(pal, "red");
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 102, 0, TAU2);
    ctx.fill();
    ctx.fillStyle = palOf(pal, "white");
    ctx.fillRect(52, 106, 152, 44);
    distress(ctx, W, H, rng, 0.3);
  },

  logo_a(ctx, W, H, rng, pal) {
    const m = H * 0.26;
    ctx.save();
    ctx.translate(m * 1.5, H / 2);
    ctx.strokeStyle = palOf(pal, "white");
    ctx.lineWidth = m * 0.13;
    ctx.beginPath();
    ctx.arc(0, 0, m * 0.92, 0.25 * PI, 1.75 * PI);
    ctx.stroke();
    ctx.fillStyle = palOf(pal, "white");
    ctx.beginPath();
    ctx.moveTo(0, -m * 1.08);
    ctx.lineTo(m * 0.26, 0);
    ctx.lineTo(0, m * 0.62);
    ctx.lineTo(-m * 0.26, 0);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(m * 0.5, 0);
    ctx.lineTo(m * 1.12, -m * 0.1);
    ctx.lineTo(m * 1.12, m * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    stampText(ctx, "几猫北航", m * 3.6, H * 0.5, 58, palOf(pal, "white"), { font: "sans", weight: 600 });
    stampText(ctx, "北极 · 大西洋 · 支线运输", m * 3.6, H * 0.72, 24, palOf(pal, "white", 0.9), { font: "sans" });
    distress(ctx, W, H, rng, 0.3);
  },

  logo_b(ctx, W, H, rng, pal) {
    const m = H * 0.26;
    ctx.save();
    ctx.translate(m * 1.4, H / 2);
    ctx.strokeStyle = palOf(pal, "white");
    ctx.lineWidth = m * 0.16;
    ctx.beginPath();
    ctx.arc(0, 0, m * 0.85, 0, TAU2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-m * 0.9, m * 0.1);
    ctx.bezierCurveTo(-m * 0.3, -m * 0.55, m * 0.3, m * 0.55, m * 0.9, -m * 0.1);
    ctx.stroke();
    ctx.restore();
    stampText(ctx, "几猫远洋", m * 3.4, H * 0.5, 56, palOf(pal, "white"), { font: "sans", weight: 600 });
    stampText(ctx, "集装箱运输", m * 3.4, H * 0.72, 26, palOf(pal, "white", 0.9), { font: "sans" });
    distress(ctx, W, H, rng, 0.28);
  },

  logo_c(ctx, W, H, rng, pal) {
    ctx.fillStyle = palOf(pal, "navy");
    ctx.fillRect(0, 0, W, H);
    const m = H * 0.24;
    ctx.save();
    ctx.translate(m * 1.6, H / 2);
    ctx.strokeStyle = palOf(pal, "white");
    ctx.lineWidth = m * 0.12;
    ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const a = (i * PI) / 3 - HALF_PI;
      const px = Math.cos(a) * m * 0.95;
      const py = Math.sin(a) * m * 0.95;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = palOf(pal, "white");
    ctx.beginPath();
    ctx.arc(0, 0, m * 0.38, 0, TAU2);
    ctx.fill();
    ctx.restore();
    stampText(ctx, "几猫太平洋", m * 3.5, H * 0.5, 56, palOf(pal, "white"), { font: "sans", weight: 600 });
    stampText(ctx, "远洋 · 冷链 · 散货", m * 3.5, H * 0.72, 26, palOf(pal, "white", 0.85), { font: "sans" });
    distress(ctx, W, H, rng, 0.25);
  },

  logo_d(ctx, W, H, rng, pal) {
    const m = H * 0.26;
    ctx.save();
    ctx.translate(m * 1.4, H / 2);
    ctx.strokeStyle = palOf(pal, "white");
    ctx.lineWidth = m * 0.14;
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.moveTo(-m * 0.95, -m * 0.5 + i * m * 0.42);
      ctx.quadraticCurveTo(-m * 0.2, -m * 0.85 + i * m * 0.42, m * 0.95, -m * 0.5 + i * m * 0.42);
      ctx.stroke();
    }
    ctx.restore();
    stampText(ctx, "几猫联运", m * 3.4, H * 0.5, 56, palOf(pal, "white"), { font: "sans", weight: 600 });
    stampText(ctx, "多式联运", m * 3.4, H * 0.72, 26, palOf(pal, "white", 0.9), { font: "sans" });
    distress(ctx, W, H, rng, 0.28);
  },

  berth4(ctx, W, H, rng, pal) {
    const y = palOf(pal, "yellow");
    ctx.strokeStyle = y;
    ctx.lineWidth = 12;
    ctx.strokeRect(14, 14, W - 28, H - 28);
    ctx.save();
    ctx.translate(W * 0.32, H * 0.82);
    stampText(ctx, "4", 0, 0, H * 1.05, y, { align: "center", weight: 900, stencil: true });
    ctx.restore();
    stampText(ctx, "BERTH", W * 0.55, H * 0.36, 34, y, { font: "sans", weight: 700 });
    stampText(ctx, "SLT · 04", W * 0.55, H * 0.56, 26, palOf(pal, "yellow", 0.85), { font: "sans" });
    for (let i = 0; i < 4; i += 1) {
      ctx.fillStyle = y;
      ctx.beginPath();
      ctx.arc(30 + (i % 2) * (W - 60), 30 + Math.floor(i / 2) * (H - 60), 7, 0, TAU2);
      ctx.fill();
    }
    distress(ctx, W, H, rng, 0.25);
  },

  caution_stripes(ctx, W, H, rng, pal) {
    ctx.fillStyle = palOf(pal, "black");
    ctx.fillRect(0, 8, W, H - 16);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 8, W, H - 16);
    ctx.clip();
    ctx.fillStyle = palOf(pal, "yellow");
    const pitch = 64;
    for (let x = -H; x < W + H; x += pitch) {
      ctx.beginPath();
      ctx.moveTo(x, H);
      ctx.lineTo(x + H, 0);
      ctx.lineTo(x + H + 32, 0);
      ctx.lineTo(x + 32, H);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    distress(ctx, W, H, rng, 0.2);
  },

  grime_streak(ctx, W, H, rng, pal) {
    for (let i = 0; i < 46; i += 1) {
      const x = W * (0.12 + 0.76 * (rng() * 0.5 + rng() * 0.5));
      const len = H * (0.1 + rng() * 0.7);
      blob(ctx, x, rng() * 20, W * (0.05 + rng() * 0.16), "rgba(26,23,19," + (0.28 + rng() * 0.4) + ")", "rgba(26,23,19,0)");
      ctx.fillStyle = "rgba(26,23,19," + (0.1 + rng() * 0.2) + ")";
      ctx.fillRect(x, 0, 1 + rng() * 3, len);
    }
    for (let i = 0; i < 24; i += 1) {
      ctx.fillStyle = "rgba(20,18,15," + (0.2 + rng() * 0.3) + ")";
      ctx.beginPath();
      ctx.arc(rng() * W, rng() * H, 0.6 + rng() * 2.4, 0, TAU2);
      ctx.fill();
    }
  },

  rust_run(ctx, W, H, rng, pal) {
    for (let i = 0; i < 40; i += 1) {
      const x = W * (0.2 + 0.6 * (rng() * 0.5 + rng() * 0.5));
      const y = 6 + rng() * 16;
      const len = H * (0.15 + rng() * 0.72);
      const g = ctx.createLinearGradient(x, y, x, y + len);
      g.addColorStop(0, "rgba(118,52,18," + (0.5 + rng() * 0.4) + ")");
      g.addColorStop(0.7, "rgba(96,44,16," + (0.25 + rng() * 0.3) + ")");
      g.addColorStop(1, "rgba(96,44,16,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x, y, 2 + rng() * 8, len);
      for (let k = 0; k < 4; k += 1) {
        ctx.fillStyle = "rgba(" + (rng() < 0.5 ? "70,30,14" : "104,44,16") + "," + (0.4 + rng() * 0.4) + ")";
        ctx.beginPath();
        ctx.arc(x + (rng() - 0.5) * 14, y + rng() * len, 1 + rng() * 3, 0, TAU2);
        ctx.fill();
      }
    }
  },

  oil_stain(ctx, W, H, rng, pal) {
    for (let i = 0; i < 26; i += 1) {
      const a = rng() * TAU2;
      const rad = Math.pow(rng(), 1.5) * W * 0.26;
      const x = W / 2 + Math.cos(a) * rad;
      const y = H / 2 + Math.sin(a) * rad * 0.8;
      const rr = W * (0.06 + rng() * 0.16);
      blob(ctx, x, y, rr, "rgba(10,10,11," + (0.35 + rng() * 0.3) + ")", "rgba(12,11,10,0)");
    }
    for (let i = 0; i < 30; i += 1) {
      const a = rng() * TAU2;
      const rad = W * (0.25 + rng() * 0.2);
      ctx.fillStyle = "rgba(10,10,11," + (0.3 + rng() * 0.4) + ")";
      ctx.beginPath();
      ctx.arc(W / 2 + Math.cos(a) * rad, H / 2 + Math.sin(a) * rad, 1 + rng() * 4, 0, TAU2);
      ctx.fill();
    }
  },

  leak_stain(ctx, W, H, rng, pal) {
    // 上游：径向 0 透明 → 0.8 浓 → 1 透明（渗漏环）
    for (let i = 0; i < 18; i += 1) {
      const x = W * (0.3 + rng() * 0.4);
      const y = H * (0.12 + rng() * 0.2) + (i / 18) * H * 0.6;
      const rr = Math.max(1, W * (0.1 + rng() * 0.2));
      if (typeof ctx.createRadialGradient === "function") {
        const g = ctx.createRadialGradient(x, y, rr * 0.5, x, y, rr);
        g.addColorStop(0, "rgba(150,146,130,0)");
        g.addColorStop(0.8, "rgba(168,162,140," + (0.18 + rng() * 0.2) + ")");
        g.addColorStop(1, "rgba(168,162,140,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, rr, 0, TAU2);
        ctx.fill();
      }
    }
    for (let i = 0; i < 22; i += 1) {
      ctx.fillStyle = "rgba(168,162,140," + (0.15 + rng() * 0.25) + ")";
      ctx.beginPath();
      ctx.arc(rng() * W, rng() * H, 0.8 + rng() * 3, 0, TAU2);
      ctx.fill();
    }
  },

  bullet_metal(ctx, W, H, rng, pal) {
    blob(ctx, 64, 64, 56, "rgba(40,22,16,0.6)", "rgba(40,22,16,0)");
    ctx.strokeStyle = "rgba(168,128,96,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(64, 64, 30, 0, TAU2);
    ctx.stroke();
    ctx.fillStyle = "rgba(14,10,9,0.9)";
    ctx.beginPath();
    ctx.arc(64, 64, 11, 0, TAU2);
    ctx.fill();
    ctx.fillStyle = "rgba(226,223,213,0.55)";
    for (let i = 0; i < 9; i += 1) {
      const a = rng() * TAU2;
      const r = 6 + rng() * 20;
      ctx.beginPath();
      ctx.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 0.7 + rng() * 1.6, 0, TAU2);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(26,20,18,0.55)";
    for (let i = 0; i < 6; i += 1) {
      const a = rng() * TAU2;
      ctx.beginPath();
      ctx.moveTo(64 + Math.cos(a) * 12, 64 + Math.sin(a) * 12);
      ctx.lineTo(64 + Math.cos(a) * 38, 64 + Math.sin(a) * 38);
      ctx.stroke();
    }
    distress(ctx, W, H, rng, 0.2);
  },

  bullet_concrete(ctx, W, H, rng, pal) {
    blob(ctx, 64, 64, 60, "rgba(176,172,162,0.5)", "rgba(176,172,162,0)");
    ctx.fillStyle = "rgba(96,92,86,0.5)";
    ctx.beginPath();
    ctx.arc(64, 64, 16, 0, TAU2);
    ctx.fill();
    ctx.fillStyle = "rgba(38,36,34,0.8)";
    ctx.beginPath();
    ctx.arc(64, 64, 8, 0, TAU2);
    ctx.fill();
    for (let i = 0; i < 26; i += 1) {
      const a = rng() * TAU2;
      const r = 10 + rng() * 52;
      ctx.fillStyle = "rgba(168,164,154," + (0.2 + rng() * 0.4) + ")";
      ctx.beginPath();
      ctx.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 0.6 + rng() * 2.4, 0, TAU2);
      ctx.fill();
    }
    distress(ctx, W, H, rng, 0.25);
  },

  scorch(ctx, W, H, rng, pal) {
    for (let i = 0; i < 40; i += 1) {
      const a = rng() * TAU2;
      const rad = Math.pow(rng(), 0.7) * W * 0.34;
      const x = W / 2 + Math.cos(a) * rad;
      const y = H / 2 + Math.sin(a) * rad;
      const rr = W * (0.04 + rng() * 0.12);
      blob(ctx, x, y, rr, "rgba(8,7,6," + (0.3 + rng() * 0.4) + ")", "rgba(8,7,6,0)");
    }
    blob(ctx, W / 2, H / 2, W * 0.16, "rgba(8,7,6,0.9)", "rgba(12,10,9,0.2)");
    for (let i = 0; i < 16; i += 1) {
      const a = rng() * TAU2;
      const rad = W * (0.12 + rng() * 0.24);
      ctx.fillStyle = "rgba(190,96,34," + (0.15 + rng() * 0.3) + ")";
      ctx.beginPath();
      ctx.arc(W / 2 + Math.cos(a) * rad, H / 2 + Math.sin(a) * rad, 0.8 + rng() * 1.8, 0, TAU2);
      ctx.fill();
    }
  },

  crack(ctx, W, H, rng, pal) {
    ctx.strokeStyle = "rgba(20,19,18,0.72)";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const branch = (x, y, ang, len, w, depth) => {
      const x2 = x + Math.cos(ang) * len;
      const y2 = y + Math.sin(ang) * len;
      const mx = (x + x2) / 2 + (rng() - 0.5) * len * 0.35;
      const my = (y + y2) / 2 + (rng() - 0.5) * len * 0.35;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(mx, my, x2, y2);
      ctx.stroke();
      if (depth > 0) {
        branch(x2, y2, ang + (rng() - 0.5) * 1.1, len * (0.4 + rng() * 0.35), Math.max(0.5, w * 0.62), depth - 1);
        branch(mx, my, ang + (rng() - 0.5) * 1.8, len * (0.25 + rng() * 0.3), Math.max(0.4, w * 0.5), depth - 1);
      }
    };
    for (let i = 0; i < 3; i += 1) {
      const a = (i * TAU2) / 3 + rng();
      branch(W / 2 + Math.cos(a) * W * 0.06, H / 2 + Math.sin(a) * H * 0.06, a, W * (0.2 + rng() * 0.1), 3.2, 3);
    }
    for (let i = 0; i < 20; i += 1) {
      ctx.fillStyle = "rgba(20,19,18," + (0.15 + rng() * 0.3) + ")";
      ctx.beginPath();
      ctx.arc(rng() * W, rng() * H, 0.5 + rng() * 1.8, 0, TAU2);
      ctx.fill();
    }
  },

  graffiti_tag(ctx, W, H, rng, pal) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const colors = ["rgba(206,214,208,0.9)", "rgba(222,172,30,0.85)", "rgba(168,36,28,0.8)"];
    for (let i = 0; i < 8; i += 1) {
      ctx.strokeStyle = colors[i % colors.length];
      ctx.lineWidth = 6 + rng() * 14;
      const y = H * (0.25 + rng() * 0.5);
      ctx.beginPath();
      ctx.moveTo(W * 0.08, y);
      let x = W * 0.08;
      let yy = y;
      while (x < W * 0.9) {
        const nx = x + W * (0.08 + rng() * 0.12);
        const ny = H * (0.15 + rng() * 0.7);
        ctx.quadraticCurveTo((x + nx) / 2 + (rng() - 0.5) * 40, yy + (rng() - 0.5) * 90, nx, ny);
        x = nx;
        yy = ny;
      }
      ctx.stroke();
      // 喷漆流挂
      if (rng() > 0.4) {
        ctx.lineWidth = 2 + rng() * 2.5;
        ctx.beginPath();
        ctx.moveTo(x, yy);
        ctx.lineTo(x + (rng() - 0.5) * 6, yy + H * (0.05 + rng() * 0.2));
        ctx.stroke();
      }
    }
    distress(ctx, W, H, rng, 0.25);
  },

  csc_plate(ctx, W, H, rng, pal) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "rgb(150,152,150)");
    g.addColorStop(0.5, "rgb(178,180,178)");
    g.addColorStop(1, "rgb(128,130,128)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(60,62,60,0.8)";
    ctx.lineWidth = 4;
    ctx.strokeRect(8, 8, W - 16, H - 16);
    ctx.fillStyle = "rgba(40,42,40,0.85)";
    stampText(ctx, "SLTU 204 033 9", 24, 42, 18, "rgba(32,34,32,0.92)", { font: "sans", weight: 700 });
    stampText(ctx, "22G1 · 45G1", 24, 70, 15, "rgba(32,34,32,0.85)", { font: "sans" });
    stampText(ctx, "MAX GROSS 30,480 KG", 24, 104, 12, "rgba(32,34,32,0.8)", { font: "sans" });
    stampText(ctx, "TARE     2,230 KG", 24, 122, 12, "rgba(32,34,32,0.8)", { font: "sans" });
    stampText(ctx, "NET      28,250 KG", 24, 140, 12, "rgba(32,34,32,0.8)", { font: "sans" });
    stampText(ctx, "CU CAP   33.2 M3", 24, 158, 12, "rgba(32,34,32,0.8)", { font: "sans" });
    stampText(ctx, "CSC · 1996", W - 24, 180, 11, "rgba(32,34,32,0.7)", { font: "sans", align: "right" });
    for (let i = 0; i < 4; i += 1) {
      ctx.fillStyle = "rgba(70,72,70,0.9)";
      ctx.beginPath();
      ctx.arc(20 + (i % 2) * (W - 40), 20 + Math.floor(i / 2) * (H - 40), 5, 0, TAU2);
      ctx.fill();
    }
    distress(ctx, W, H, rng, 0.35);
  },

  numbers_0_9(ctx, W, H, rng, pal) {
    for (let i = 0; i < 10; i += 1) {
      stampText(ctx, String(i), i * 64 + 32, H * 0.86, H * 0.92, palOf(pal, "white"), { align: "center", weight: 900, stencil: true, gaps: 2 });
    }
    distress(ctx, W, H, rng, 0.25);
  },
};

/** 贴花规格查询（无 ctx）：[w, h, {bleed, rough, metal, text}]。 */
export function decalSpec(name) {
  return DECAL_SPECS[name] || null;
}

export function decalAspect(name) {
  const s = DECAL_SPECS[name];
  return s ? s[0] / s[1] : 1;
}

/* ---------------- 6.1 无 canvas 环境的记录型 2D 上下文（自测 / SSR 降级） ---------------- */

function createStubGradient() {
  return {
    stops: 0,
    addColorStop() {
      this.stops += 1;
    },
  };
}

function createStubCanvas(width, height) {
  const canvas = { width: width || 1, height: height || 1, ops: 0, _ctx: null };
  const ctx = {
    canvas,
    ops: 0,
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    font: "10px sans-serif",
    globalCompositeOperation: "source-over",
    save() { ctx.ops += 1; },
    restore() { ctx.ops += 1; },
    translate() { ctx.ops += 1; },
    rotate() { ctx.ops += 1; },
    scale() { ctx.ops += 1; },
    beginPath() { ctx.ops += 1; },
    closePath() { ctx.ops += 1; },
    moveTo() { ctx.ops += 1; },
    lineTo() { ctx.ops += 1; },
    quadraticCurveTo() { ctx.ops += 1; },
    bezierCurveTo() { ctx.ops += 1; },
    arc() { ctx.ops += 1; },
    rect() { ctx.ops += 1; },
    clip() { ctx.ops += 1; },
    fill() { ctx.ops += 1; },
    stroke() { ctx.ops += 1; },
    fillRect() { ctx.ops += 1; },
    strokeRect() { ctx.ops += 1; },
    fillText() { ctx.ops += 1; },
    strokeText() { ctx.ops += 1; },
    drawImage() { ctx.ops += 1; },
    setTransform() { ctx.ops += 1; },
    createRadialGradient() { ctx.ops += 1; return createStubGradient(); },
    createLinearGradient() { ctx.ops += 1; return createStubGradient(); },
    measureText(text) { ctx.ops += 1; return { width: String(text).length * 10 }; },
  };
  canvas._ctx = ctx;
  canvas.getContext = () => ctx;
  return canvas;
}

/**
 * Canvas 贴花工厂。createCanvas 注入（浏览器里可传 document.createElement 的包装）；
 * 未注入时退回 1×1 记录型画布（`live=false`，供 node 自测与无 DOM 环境校验绘制程序）。
 */
export function createDecalFactory({ createCanvas = null, doc = null, maxSize = 1024, cache = true } = {}) {
  let make = createCanvas;
  let live = typeof make === "function";
  if (!make && doc && typeof doc.createElement === "function") {
    make = (w, h) => {
      const c = doc.createElement("canvas");
      c.width = w;
      c.height = h;
      return c;
    };
    live = true;
  }
  if (!make && typeof globalThis !== "undefined" && globalThis.document && typeof globalThis.document.createElement === "function") {
    const gd = globalThis.document;
    make = (w, h) => {
      const c = gd.createElement("canvas");
      c.width = w;
      c.height = h;
      return c;
    };
    live = true;
  }
  const stub = (w, h) => createStubCanvas(w, h);
  const maker = make || stub;

  const counters = { canvases: 0, paints: 0, labels: 0, numbers: 0, cacheHits: 0, failed: 0 };
  const cacheMap = new Map();
  const textures = [];
  let probe = null;

  function getCtx(canvas) {
    const ctx = canvas.getContext ? canvas.getContext("2d") : null;
    if (!ctx) throw new Error("props-kit: canvas.getContext('2d') returned null");
    return ctx;
  }

  function newCanvas(w, h) {
    const cw = Math.max(1, Math.min(maxSize, Math.round(w)));
    const ch = Math.max(1, Math.min(maxSize, Math.round(h)));
    const c = maker(cw, ch);
    if (c.width !== cw) c.width = cw;
    if (c.height !== ch) c.height = ch;
    counters.canvases += 1;
    return c;
  }

  function paint(name, seed = 0) {
    const spec = DECAL_SPECS[name];
    if (!spec) throw new Error("props-kit: unknown decal " + JSON.stringify(name));
    const key = "d:" + name + "|" + (seed | 0);
    if (cache && cacheMap.has(key)) {
      counters.cacheHits += 1;
      return cacheMap.get(key);
    }
    const W = spec[0];
    const H = spec[1];
    const canvas = newCanvas(W, H);
    const ctx = getCtx(canvas);
    const rng = createRng((nameHash(name) ^ Math.imul((seed | 0) + 1, 2654435761)) >>> 0);
    try {
      DECAL_PAINTERS[name](ctx, W, H, rng, DECAL_PALETTE);
      counters.paints += 1;
    } catch (e) {
      counters.failed += 1;
      throw e;
    }
    const out = { canvas, width: W, height: H };
    if (cache) cacheMap.set(key, out);
    textures.push(out);
    return out;
  }

  function number(v, seed = 0) {
    const digits = paint("numbers_0_9", seed);
    const cell = digits.width / 10;
    const out = newCanvas(cell, digits.height);
    const ctx = getCtx(out);
    const src = digits.canvas;
    const d = Math.abs(Math.floor(v)) % 10;
    if (typeof ctx.drawImage === "function") {
      ctx.drawImage(src, d * cell, 0, cell, digits.height, 0, 0, cell, digits.height);
    }
    counters.numbers += 1;
    return { canvas: out, width: cell, height: digits.height, aspect: cell / digits.height };
  }

  function measure(text, size, opts) {
    if (!probe) probe = newCanvas(8, 8);
    const ctx = getCtx(probe);
    const sans = opts.font === "sans";
    const family = sans ? '"PingFang SC","Noto Sans CJK SC","Helvetica Neue",Arial,sans-serif' : '"PingFang SC","Courier New",monospace';
    if (typeof ctx.font === "string") ctx.font = (opts.weight || (sans ? 600 : 700)) + " " + size + "px " + family;
    let w = 0;
    if (typeof ctx.measureText === "function") {
      const m = ctx.measureText(text);
      w = m && m.width ? m.width : 0;
    }
    return w || String(text).length * size * 0.62;
  }

  /**
   * 文本钢印贴花：对应上游 mats.label(text, {color, font, distress}) → {material, aspect}。
   * 返回 {canvas, width, height, aspect}。
   */
  function label(text, opts = {}) {
    const str = String(text === undefined ? "" : text);
    const color = DECAL_PALETTE[opts.color] ? opts.color : "white";
    const font = opts.font === "stencil" ? "stencil" : "sans";
    const distressV = opts.distress === undefined ? 0.15 : clamp01(opts.distress);
    const size = opts.size || 64;
    const key = "l:" + str + "|" + color + "|" + font + "|" + distressV + "|" + size;
    if (cache && cacheMap.has(key)) {
      counters.cacheHits += 1;
      return cacheMap.get(key);
    }
    const pad = Math.max(4, size * 0.12);
    const tw = measure(str || " ", size, { font, weight: opts.weight });
    const W = tw + pad * 2;
    const H = size * 1.55;
    const canvas = newCanvas(W, H);
    const ctx = getCtx(canvas);
    stampText(ctx, str || " ", pad, size * 1.12, size, palOf(DECAL_PALETTE, color), {
      font,
      stencil: font === "stencil",
      weight: opts.weight,
      maxW: W - pad * 2,
    });
    if (distressV > 0) distress(ctx, W, H, createRng((nameHash(str) ^ 0x5bd1e995) >>> 0), distressV);
    counters.labels += 1;
    const out = { canvas, width: W, height: H, aspect: W / H };
    if (cache) cacheMap.set(key, out);
    textures.push(out);
    return out;
  }

  return {
    live,
    types: () => DECAL_TYPES,
    names: () => DECAL_TYPES,
    has: (n) => !!DECAL_SPECS[n],
    spec: (n) => DECAL_SPECS[n] || null,
    aspect: (n) => decalAspect(n),
    /** 画一张贴花 → {canvas, width, height}。 */
    canvas: (n, o) => paint(n, (o && o.seed) || 0),
    /** 画单个数位（0-9）→ 0.5 宽高比的小画布。 */
    number: (v, o) => number(v, (o && o.seed) || 0),
    /** 文本钢印 → {canvas, aspect}。 */
    label,
    /** 已生成画布（含 label/number）；消费侧建 CanvasTexture 后可用它统一 dispose。 */
    textures: () => textures,
    clear() {
      cacheMap.clear();
      textures.length = 0;
    },
    stats: () => ({ ...counters, live, cached: cacheMap.size }),
  };
}

/* ============================== 7. 网格装配（需要 THREE 注入） ============================== */

const DEFAULT_INSTANCE_THRESHOLD = 4;

function materialKey(part) {
  return part.m + (part.em !== undefined ? "|em:" + part.em : "");
}

/**
 * createPropsKit(THREE, opts)
 *   - THREE：可选；只有 build()/落网格需要。零件表、碰撞盒、贴花表不需要。
 *   - materials：注入材质（sl-surface 工厂，含 get(name) 或 map[name]）；未注入则用 MATERIAL_PRESETS 回退。
 *   - decals：贴花工厂（默认 createDecalFactory(doc/createCanvas) 自动建；非 live 时只记录贴花槽位）。
 *   - rng：注入顶层 rng（未使用 Math.random；默认按 seed 确定性派生）。
 *   - instanceThreshold：同尺寸同材质重复件达到该数即走 InstancedMesh。
 */
export function createPropsKit(THREE = null, options = {}) {
  const opts = options || {};
  const materials = opts.materials || null;
  const materialCache = new Map();
  const geometryCache = new Map();
  const decalMatCache = new Map();
  const counts = {
    builtProps: 0,
    builtParts: 0,
    builtMeshes: 0,
    builtInstanced: 0,
    builtColliders: 0,
    decalSlots: 0,
    decalMeshes: 0,
    fallbacks: 0,
  };

  const decals = opts.decals || createDecalFactory({
    createCanvas: opts.createCanvas || null,
    doc: opts.doc || null,
    maxSize: opts.decalMaxSize || 1024,
  });
  const instanceThreshold = opts.instanceThreshold === undefined
    ? DEFAULT_INSTANCE_THRESHOLD
    : Math.max(1, Math.floor(opts.instanceThreshold));
  const rootRng = typeof opts.rng === "function" ? opts.rng : null;

  function resolveMaterial(name) {
    if (materials) {
      const m = typeof materials.get === "function" ? materials.get(name) : materials[name];
      if (m) return m;
    }
    let mat = materialCache.get(name);
    if (!mat) {
      const preset = MATERIAL_PRESETS[name] || MATERIAL_PRESETS.concrete;
      if (!THREE) return null;
      mat = new THREE.MeshStandardMaterial({
        color: preset.color,
        roughness: preset.rough,
        metalness: preset.metal,
        transparent: preset.opacity !== undefined,
        opacity: preset.opacity === undefined ? 1 : preset.opacity,
      });
      materialCache.set(name, mat);
    }
    return mat;
  }

  function resolveEmissive(name, intensity, color) {
    const key = name + "|em:" + intensity;
    let mat = materialCache.get(key);
    if (!mat) {
      const base = resolveMaterial(name);
      if (!base) return null;
      if (!THREE || !base.clone) return base;
      mat = base.clone();
      if ("emissive" in mat) {
        const preset = MATERIAL_PRESETS[name] || {};
        mat.emissive = new THREE.Color(color !== undefined ? color : (preset.emissive === undefined ? 0xffffff : preset.emissive));
        mat.emissiveIntensity = intensity;
        mat.toneMapped = true;
      }
      materialCache.set(key, mat);
    }
    return mat;
  }

  function materialFor(part) {
    if (part.em !== undefined) return resolveEmissive(part.m, part.em, part.emc);
    return resolveMaterial(part.m);
  }

  function geometryFor(part) {
    const key = partGeoKey(part);
    let geo = geometryCache.get(key);
    if (geo) return geo;
    if (part.k === K_BOX) {
      geo = new THREE.BoxGeometry(part.s[0], part.s[1], part.s[2]);
    } else if (part.k === K_CYL) {
      geo = new THREE.CylinderGeometry(part.r1, part.r0, part.h, part.seg, 1, !!part.open);
    } else if (part.k === K_PLANE) {
      geo = new THREE.PlaneGeometry(part.s[0], part.s[1]);
    } else if (part.k === K_TUBE) {
      const v = [];
      for (const p of part.pts) v.push(new THREE.Vector3(p[0], p[1], p[2]));
      const curve = new THREE.CatmullRomCurve3(v, false, "catmullrom", part.tension);
      geo = new THREE.TubeGeometry(curve, Math.max(8, v.length * 6), part.rad, part.seg, false);
    } else {
      return null;
    }
    geometryCache.set(key, geo);
    return geo;
  }

  function decalMaterialFor(part, seed) {
    if (!THREE || !decals || !decals.live) return null;
    const key = part.k === K_DECAL
      ? "d|" + part.d + "|" + seed
      : part.k === K_LABEL
        ? "l|" + part.text + "|" + part.color + "|" + part.font + "|" + part.distress + "|" + seed
        : "n|" + part.v + "|" + seed;
    const cached = decalMatCache.get(key);
    if (cached) return cached;
    let canvas;
    let aspect;
    if (part.k === K_DECAL) {
      const spec = DECAL_SPECS[part.d];
      if (!spec) return null;
      canvas = decals.canvas(part.d, { seed }).canvas;
      aspect = spec[0] / spec[1];
    } else if (part.k === K_LABEL) {
      const r = decals.label(part.text, { color: part.color, font: part.font, distress: part.distress, seed });
      canvas = r.canvas;
      aspect = r.aspect;
    } else if (part.k === K_NUMBER) {
      const r = decals.number(part.v, { seed });
      canvas = r.canvas;
      aspect = r.aspect;
    } else {
      return null;
    }
    const tex = new THREE.CanvasTexture(canvas);
    if (THREE.SRGBColorSpace !== undefined && "colorSpace" in tex) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
    });
    mat.name = "decal_" + (part.d || (part.k === K_LABEL ? "label" : "number"));
    const made = { mat, aspect, tex };
    decalMatCache.set(key, made);
    return made;
  }

  /**
   * 落网格。返回 THREE.Group，挂 userData：
   *   { prop, size, colliders, meta, lamps, parts, decals, stats:{meshes, instanced} }
   */
  function build(name, buildOpts = {}) {
    if (!THREE) throw new Error("props-kit: build() requires THREE — createPropsKit(THREE, opts) 时注入；纯数据请用 partsOf()/collidersOf()");
    const o = buildOpts || {};
    const seed = o.seed === undefined ? 0 : Math.abs(Math.floor(o.seed));
    const model = buildModel(name, o);
    const group = new THREE.Group();
    group.name = name;
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const vec = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const place = (mesh, part) => {
      vec.set(part.p[0], part.p[1], part.p[2]);
      if (part.rot) euler.set(part.rot[0], part.rot[1], part.rot[2]);
      else euler.set(0, 0, 0);
      quat.setFromEuler(euler);
      mesh.position.copy(vec);
      mesh.quaternion.copy(quat);
    };

    const buckets = new Map();
    let decalList = null;
    for (const part of model.parts) {
      if (part.k === K_DECAL || part.k === K_LABEL || part.k === K_NUMBER) {
        if (!decalList) decalList = [];
        decalList.push(part);
        continue;
      }
      const key = partGeoKey(part) + "|" + materialKey(part);
      let list = buckets.get(key);
      if (!list) {
        list = [];
        buckets.set(key, list);
      }
      list.push(part);
    }

    let meshes = 0;
    let instanced = 0;
    for (const list of buckets.values()) {
      const first = list[0];
      const geo = geometryFor(first);
      if (!geo) continue;
      const mat = materialFor(first);
      if (!mat) continue;
      if (list.length >= instanceThreshold && THREE.InstancedMesh) {
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        im.name = name + ":" + first.m;
        for (let i = 0; i < list.length; i += 1) {
          const part = list[i];
          vec.set(part.p[0], part.p[1], part.p[2]);
          euler.set(part.rot ? part.rot[0] : 0, part.rot ? part.rot[1] : 0, part.rot ? part.rot[2] : 0);
          quat.setFromEuler(euler);
          matrix.compose(vec, quat, one);
          im.setMatrixAt(i, matrix);
        }
        im.instanceMatrix.needsUpdate = true;
        im.castShadow = true;
        im.receiveShadow = true;
        group.add(im);
        meshes += 1;
        instanced += 1;
      } else {
        for (const part of list) {
          const mesh = new THREE.Mesh(geo, mat);
          place(mesh, part);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.name = name + ":" + part.tag;
          group.add(mesh);
          meshes += 1;
        }
      }
    }

    // 贴花/钢印/编号：有 live 画布时落成带 CanvasTexture 的 plane，否则只记录槽位
    if (decalList) {
      for (const part of decalList) {
        const made = decalMaterialFor(part, seed);
        if (!made) continue;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(part.size, part.size / made.aspect), made.mat);
        place(mesh, part);
        mesh.name = name + ":" + (part.d || part.k);
        group.add(mesh);
        meshes += 1;
        counts.decalMeshes += 1;
      }
      counts.decalSlots += decalList.length;
    }

    group.userData = {
      prop: name,
      size: model.size,
      colliders: model.colliders,
      meta: model.meta,
      buildOptions: o,
      lamps: model.lamps || [],
      parts: model.parts.length,
      decals: decalList || [],
      stats: { meshes, instanced },
    };

    counts.builtProps += 1;
    counts.builtParts += model.parts.length;
    counts.builtMeshes += meshes;
    counts.builtInstanced += instanced;
    counts.builtColliders += model.colliders.length;
    if (model.fallback) counts.fallbacks += 1;
    return group;
  }

  /**
   * 把道具碰撞盒注册进 physics（physics-kit 的 addBox(min,max,{surface,tag,bulletOnly})）。
   * 传 group 时直接用 group.userData.colliders（与 build 时的 doors/open 参数一致），不重算。
   */
  function applyPhysics(physics, nameOrGroup, placement = {}) {
    if (!physics || typeof physics.addBox !== "function") return 0;
    const isGroup = !!(nameOrGroup && nameOrGroup.userData && nameOrGroup.userData.prop);
    let local;
    let name;
    let at;
    let rotY;
    if (isGroup) {
      name = nameOrGroup.userData.prop;
      local = nameOrGroup.userData.colliders;
      at = [nameOrGroup.position.x, nameOrGroup.position.y, nameOrGroup.position.z];
      rotY = nameOrGroup.rotation.y;
    } else {
      name = nameOrGroup;
      at = placement.at || [0, 0, 0];
      rotY = placement.rotY || 0;
      local = propColliders(name, placement.buildOptions || {});
    }
    const cos = Math.cos(rotY);
    const sin = Math.sin(rotY);
    let n = 0;
    for (const c of local) {
      let x0 = Infinity;
      let x1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      for (let i = 0; i < 4; i += 1) {
        const lx = i & 1 ? c.max[0] : c.min[0];
        const lz = i & 2 ? c.max[2] : c.min[2];
        const wx = lx * cos + lz * sin;
        const wz = -lx * sin + lz * cos;
        if (wx < x0) x0 = wx;
        if (wx > x1) x1 = wx;
        if (wz < z0) z0 = wz;
        if (wz > z1) z1 = wz;
      }
      physics.addBox(
        { x: x0 + at[0], y: c.min[1] + at[1], z: z0 + at[2] },
        { x: x1 + at[0], y: c.max[1] + at[1], z: z1 + at[2] },
        {
          surface: c.surface,
          tag: placement.tag || name,
          bulletOnly: !!c.bulletOnly,
        },
      );
      n += 1;
    }
    return n;
  }

  /** 逐帧可用的零分配统计读取（写入调用方预分配对象）；返回同一对象。 */
  function writeStats(out) {
    const s = out || {};
    s.propKinds = PROP_SIZES ? Object.keys(PROP_SIZES).length : 0;
    s.propFamilies = PROP_FAMILIES.length;
    s.builderCount = BUILDER_NAMES.length;
    s.decalTypes = DECAL_TYPES.length;
    s.builtProps = counts.builtProps;
    s.builtParts = counts.builtParts;
    s.builtMeshes = counts.builtMeshes;
    s.builtInstanced = counts.builtInstanced;
    s.builtColliders = counts.builtColliders;
    s.decalSlots = counts.decalSlots;
    s.decalMeshes = counts.decalMeshes;
    s.fallbacks = counts.fallbacks;
    return s;
  }

  return {
    THREE,
    PROP_SIZES,
    BUILDERS: PROP_BUILDERS,
    DECAL_SPECS,
    DECAL_TYPES,
    decals,
    names: () => Object.keys(PROP_SIZES),
    builders: () => BUILDER_NAMES,
    has: (n) => !!PROP_SIZES[n],
    isBuilder,
    size: propSize,
    material: propMaterial,
    family: propFamily,
    /** 纯数据零件表（无 THREE 也可用）。 */
    partsOf: buildModel,
    parts: (n, o) => buildModel(n, o).parts,
    model: buildModel,
    collidersOf: propColliders,
    colliders: propColliders,
    worldColliders,
    build,
    applyPhysics,
    showcase,
    stats: () => writeStats({}),
    writeStats,
    /** 计数器清零（重新装配场景前调用）。 */
    reset() {
      counts.builtProps = 0;
      counts.builtParts = 0;
      counts.builtMeshes = 0;
      counts.builtInstanced = 0;
      counts.builtColliders = 0;
      counts.decalSlots = 0;
      counts.decalMeshes = 0;
      counts.fallbacks = 0;
    },
    rng: rootRng,
  };
}

/* ============================== 8. 自检 ============================== */

/**
 * 自检（node 可跑，无 THREE / 无 DOM）：
 *   - 目录：36 行尺寸、17 个 builder、22 种贴花；
 *   - 每个 builder：尺寸与目录一致、零件 ≥4、碰撞盒 ≥1、全部数值有限、两次构建逐字节一致；
 *   - 22 个贴花 painter 在记录型 2D 上下文上不抛错、产生绘制调用；label/number 可生成。
 * 返回 { ok, problems, ...counts }。
 */
export function selfTest() {
  const problems = [];
  const kinds = Object.keys(PROP_SIZES);
  if (kinds.length < 12) problems.push("propKinds below floor: " + kinds.length);
  if (BUILDER_NAMES.length !== 17) problems.push("builder count != 17: " + BUILDER_NAMES.length);
  if (DECAL_TYPES.length !== 22) problems.push("decal types != 22: " + DECAL_TYPES.length);

  for (const name of kinds) {
    const row = PROP_SIZES[name];
    if (row.length !== 5) problems.push(name + ": size row must be [w,h,d,material,family]");
    for (let i = 0; i < 3; i += 1) {
      if (!(typeof row[i] === "number" && Number.isFinite(row[i]) && row[i] > 0)) problems.push(name + ": bad dim " + i);
    }
    if (typeof row[3] !== "string" || !row[3]) problems.push(name + ": bad material");
    if (typeof row[4] !== "string" || !row[4]) problems.push(name + ": bad family");
  }

  let partTotal = 0;
  let colliderTotal = 0;
  for (const name of BUILDER_NAMES) {
    const a = buildModel(name, { seed: 7 });
    const b = buildModel(name, { seed: 7 });
    if (!a || !Array.isArray(a.parts) || !Array.isArray(a.colliders)) {
      problems.push(name + ": builder returned malformed model");
      continue;
    }
    if (a.parts.length < 4) problems.push(name + ": parts < 4 (" + a.parts.length + ")");
    if (a.colliders.length < 1) problems.push(name + ": colliders < 1");
    if (!a.size || a.size.length !== 3) problems.push(name + ": bad size");
    const expected = PROP_SIZES[name];
    if (expected && (a.size[0] !== expected[0] || a.size[1] !== expected[1] || a.size[2] !== expected[2])) {
      problems.push(name + ": size mismatch with PROP_SIZES");
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(name + ": non-deterministic for same seed");
    partTotal += a.parts.length;
    colliderTotal += a.colliders.length;
    for (const part of a.parts) {
      for (const v of part.p) if (!Number.isFinite(v)) problems.push(name + ": non-finite position in " + part.k);
      if (part.rot) for (const v of part.rot) if (!Number.isFinite(v)) problems.push(name + ": non-finite rotation in " + part.k);
      if (part.s) for (const v of part.s) if (!Number.isFinite(v)) problems.push(name + ": non-finite size in " + part.k);
    }
    for (const c of a.colliders) {
      for (let i = 0; i < 3; i += 1) {
        if (!Number.isFinite(c.min[i]) || !Number.isFinite(c.max[i])) problems.push(name + ": non-finite collider");
        else if (c.max[i] <= c.min[i]) problems.push(name + ": inverted collider axis " + i);
      }
    }
  }

  // 未知道具回落
  const fb = buildModel("__not_a_prop__", {});
  if (!fb.fallback || fb.colliders.length !== 1) problems.push("unknown prop did not fall back to a collider box");

  // 贴花：22 个 painter + label + number
  const factory = createDecalFactory();
  let painted = 0;
  for (const name of DECAL_TYPES) {
    if (!DECAL_PAINTERS[name]) {
      problems.push("decal missing painter: " + name);
      continue;
    }
    const spec = DECAL_SPECS[name];
    if (!spec || !(spec[0] > 0) || !(spec[1] > 0)) problems.push("decal bad spec: " + name);
    try {
      const r = factory.canvas(name, { seed: 3 });
      const ctx = r.canvas.getContext("2d");
      if (!ctx || !(ctx.ops > 2)) problems.push("decal painted no ops: " + name);
      painted += 1;
    } catch (e) {
      problems.push("decal threw: " + name + " → " + e.message);
    }
  }
  try {
    const l = factory.label("中继 A1", { color: "yellow", font: "stencil", distress: 0.2 });
    if (!(l.aspect > 0) || !(l.width > 0)) problems.push("label() returned bad canvas");
    const n = factory.number(7);
    if (!(n.aspect > 0)) problems.push("number() returned bad canvas");
  } catch (e) {
    problems.push("label/number threw: " + e.message);
  }

  return {
    ok: problems.length === 0,
    problems,
    propKinds: kinds.length,
    propFamilies: PROP_FAMILIES.length,
    builders: BUILDER_NAMES.length,
    decalTypes: DECAL_TYPES.length,
    decalsPainted: painted,
    partsChecked: partTotal,
    collidersChecked: colliderTotal,
  };
}
