/**
 * layout.mjs — 手写布局（装配顺序 #4）：目录 + 放置表 + 九件套 meta。
 * 布局不随机（references/03 道具解剖）：四区（闸口/堆场/仓库/码头）bounds、
 * 刷兵点、掩体点、目标位全部手写坐标；validateLayout 构建期对账。
 * draw-call 预算先于内容（references/06 铁律 #1）：本表按 300 draw 上限排布。
 */
globalThis.H2B = globalThis.H2B || {};

/* ---- 结构目录（level-kit 消费：墙体/屋顶/码头墙/闸门柱，九件套之外的承重结构）---- */
H2B.STRUCT_CATALOG = {
  wh_wall_n:   { size: [21, 6.0, 0.4], material: "concrete_dirty", surface: "concrete", parts: 2 },
  wh_wall_s:   { size: [21, 6.0, 0.4], material: "concrete_dirty", surface: "concrete", parts: 2 },
  wh_wall_w:   { size: [22, 6.0, 0.4], material: "concrete_dirty", surface: "concrete", parts: 2 },
  wh_wall_e_a: { size: [0.4, 6.0, 9.0], material: "concrete_dirty", surface: "concrete", parts: 2 },
  wh_wall_e_b: { size: [0.4, 6.0, 9.0], material: "concrete_dirty", surface: "concrete", parts: 2 },
  wh_roof:     { size: [21.4, 0.4, 22.4], material: "corrugated_roof", surface: "metal", parts: 4 },
  quay_wall:   { size: [1.2, 2.2, 70], material: "concrete", surface: "concrete", parts: 4 },
  gate_post_l: { size: [0.5, 4.6, 0.5], material: "steel_galv", surface: "metal", parts: 3 },
  gate_post_r: { size: [0.5, 4.6, 0.5], material: "steel_galv", surface: "metal", parts: 3 },
};

H2B.STRUCT_LAYOUT = {
  items: [
    { prop: "wh_wall_n",   at: [28, 0, -37],     tag: "wh-wall-n" },
    { prop: "wh_wall_s",   at: [28, 0, -13],     tag: "wh-wall-s" },
    { prop: "wh_wall_w",   at: [17.3, 0, -25], rot: [0, Math.PI / 2, 0], tag: "wh-wall-w" },
    { prop: "wh_wall_e_a", at: [38.7, 0, -32],   tag: "wh-wall-e-a" },
    { prop: "wh_wall_e_b", at: [38.7, 0, -18],   tag: "wh-wall-e-b" },
    { prop: "wh_roof",     at: [28, 6.0, -25],   tag: "wh-roof" },
    { prop: "quay_wall",   at: [30.6, 0, 0],     tag: "quay-wall" },
    { prop: "gate_post_l", at: [-4.6, 0, 35.5],  tag: "gate-post-l" },
    { prop: "gate_post_r", at: [4.6, 0, 35.5],   tag: "gate-post-r" },
  ],
  meta: {
    playerStart: { pos: { x: 0, y: 0, z: 33 }, yaw: 0 },  // 朝 -z 面向堆场
    extraction: { pos: { x: 34, y: 0, z: 9 }, radius: 3 },
    objectives: [
      { id: "relay-yard",  label: "切断中继 A（堆场）", pos: { x: 10, y: 0, z: 2 },   radius: 2.5 },
      { id: "relay-shed",  label: "切断中继 B（仓库）", pos: { x: 26, y: 0, z: -24 }, radius: 2.5 },
      { id: "relay-quay",  label: "切断中继 C（码头）", pos: { x: 33, y: 0, z: 14 },  radius: 2.5 },
    ],
    enemySpawns: [
      { pos: { x: -12, y: 0, z: -14 }, kind: "ground" },
      { pos: { x: 2, y: 0, z: -18 },   kind: "ground" },
      { pos: { x: -24, y: 0, z: 2 },   kind: "ground" },
      { pos: { x: 14, y: 0, z: 12 },   kind: "ground" },
      { pos: { x: 22, y: 0, z: -20 },  kind: "ground" },
      { pos: { x: -6, y: 0, z: 6 },    kind: "ground" },
      { pos: { x: -16, y: 0, z: -6 },  kind: "air" },
      { pos: { x: 8, y: 0, z: -10 },   kind: "air" },
      { pos: { x: 18, y: 0, z: 6 },    kind: "air" },
      { pos: { x: -28, y: 0, z: -18 }, kind: "air" },
      { pos: { x: 12, y: 0, z: 22 },   kind: "air" },
      { pos: { x: 28, y: 0, z: 2 },    kind: "air" },
    ],
    zones: [
      { id: "gate",  label: "闸口", bounds: { minX: -12, maxX: 16, minZ: 26, maxZ: 40 } },
      { id: "yard",  label: "堆场", bounds: { minX: -40, maxX: 16, minZ: -22, maxZ: 26 } },
      { id: "shed",  label: "仓库", bounds: { minX: 16, maxX: 40, minZ: -40, maxZ: -12 } },
      { id: "quay",  label: "码头", bounds: { minX: 28, maxX: 40, minZ: -12, maxZ: 26 } },
    ],
    coverPoints: [
      { pos: { x: -10.5, y: 0, z: -4 },  tag: "yard-stack-a" },
      { pos: { x: -17.5, y: 0, z: -6.8 }, tag: "yard-stack-a2" },
      { pos: { x: -13.5, y: 2.59, z: -6.2 }, tag: "yard-stack-top" },
      { pos: { x: -22, y: 0, z: 12.5 },  tag: "yard-drums" },
      { pos: { x: -25.5, y: 0, z: 7 },   tag: "yard-crates" },
      { pos: { x: 6, y: 0, z: 18.5 },    tag: "yard-tote" },
      { pos: { x: -2, y: 0, z: 25.5 },   tag: "gate-jersey" },
      { pos: { x: 5, y: 0, z: 29 },      tag: "gate-sign" },
      { pos: { x: 19.5, y: 0, z: -18.5 }, tag: "shed-genny" },
      { pos: { x: 24, y: 0, z: -22.5 },  tag: "shed-relay" },
      { pos: { x: 33, y: 0, z: -25 },    tag: "shed-catwalk" },
      { pos: { x: 31.5, y: 0, z: 8 },    tag: "quay-bollards" },
      { pos: { x: 31.5, y: 0, z: 20 },   tag: "quay-bollards-2" },
      { pos: { x: 33.5, y: 0, z: 14.5 }, tag: "quay-relay" },
      { pos: { x: -33, y: 0, z: -10.5 }, tag: "yard-reel" },
      { pos: { x: -36.5, y: 0, z: 17 },  tag: "yard-dumpster" },
      { pos: { x: -38.5, y: 0, z: 1.5 }, tag: "yard-fence" },
      { pos: { x: 10, y: 0, z: 3.5 },    tag: "yard-relay" },
    ],
    interiorBoxes: [
      { min: { x: 17.6, y: 0, z: -36.6 }, max: { x: 38.4, y: 5.7, z: -13.4 }, tag: "warehouse" },
    ],
    skylights: [
      { x: 24, z: -30, w: 4, d: 5 },
      { x: 30, z: -22, w: 4, d: 5 },
      { x: 34, z: -31, w: 3, d: 4 },
    ],
    cinematicPath: [
      { x: 0, y: 1.7, z: 30 }, { x: -8, y: 1.7, z: 22 }, { x: -18, y: 1.7, z: 14 },
      { x: -26, y: 1.7, z: 6 }, { x: -28, y: 1.7, z: -6 }, { x: -18, y: 1.7, z: -14 },
      { x: -6, y: 1.7, z: -20 }, { x: 8, y: 1.7, z: -16 }, { x: 14, y: 1.7, z: -6 },
      { x: 16, y: 1.7, z: 6 }, { x: 12, y: 1.7, z: 16 }, { x: 4, y: 1.7, z: 26 },
    ],
    groundSurfaceAt(x, z) {
      if (x > 17 && x < 39 && z > -37 && z < -13) return "concrete_indoor";
      if (x > 30) return "concrete";
      return "asphalt";
    },
  },
};

/* ---- 道具放置表（props-kit 消费）：hero builder 点缀 + 2-mesh 道具铺量 ---- */
H2B.PROPS_LAYOUT = {
  items: [
    /* 堆场：集装箱英雄件（21 段型材 builder，四区视觉锚） */
    { prop: "container20", at: [-14, 0, -6], rot: [0, 0.08, 0], seed: 11, color: "red", tag: "stack-a-low" },
    { prop: "crate_wood", at: [-11.6, 0, -3.6], rot: [0, 0.5, 0], tag: "stack-a-side" },
    { prop: "pallet", at: [-10.2, 0, -3.2], tag: "stack-a-front" },
    /* 目标中继（三台 relay_node = objectives 实体） */
    { prop: "ibc_tote", at: [10, 0, 2], rot: [0, 0.6, 0], tag: "relay-yard" },
    { prop: "ibc_tote", at: [26, 0, -24], rot: [0, -0.4, 0], tag: "relay-shed" },
    { prop: "ibc_tote", at: [33, 0, 14], rot: [0, 2.2, 0], tag: "relay-quay" },
    /* 闸口 */
    { prop: "jersey_barrier", at: [-2, 0, 26], rot: [0, 0.1, 0], tag: "gate-jersey" },
    { prop: "bollard_post", at: [1.8, 0, 29.5], rot: [0, 0, 0], tag: "gate-bollard" },
    /* 堆场铺量（2-mesh 道具） */
    { prop: "pallet", at: [-8, 0, 10], tag: "p1" },
    { prop: "pallet", at: [-8.2, 0, 11.15], rot: [0, 0.2, 0], tag: "p2" },
    { prop: "pallet", at: [7, 0, 20], rot: [0, -0.35, 0], tag: "p3" },
    { prop: "pallet", at: [24, 0, -18], rot: [0, 0.9, 0], tag: "p4" },
    { prop: "pallet", at: [-15, 0, 18], tag: "p5" },
    { prop: "pallet", at: [-29, 0, -13], rot: [0, 0.5, 0], tag: "p6" },
    { prop: "barrel", at: [-20, 0, 14], tag: "b1" },
    { prop: "barrel", at: [-20.75, 0, 14.6], tag: "b2" },
    { prop: "barrel", at: [13, 0, 16], tag: "b3" },
    { prop: "barrel", at: [13.65, 0, 16.55], tag: "b4" },
    { prop: "barrel", at: [-30, 0, -16], tag: "b5" },
    { prop: "barrel", at: [-30.7, 0, -15.4], tag: "b6" },
    { prop: "barrel", at: [-31.3, 0, -16.5], tag: "b7" },
    { prop: "barrel", at: [-20.4, 0, 13.3], tag: "b8" },
    { prop: "crate_wood", at: [-24, 0, 8], tag: "c1" },
    { prop: "crate_wood", at: [-24.9, 0, 8.4], rot: [0, 0.4, 0], tag: "c2" },
    { prop: "crate_wood", at: [-24.45, 0, 9.2], rot: [0, -0.2, 0], tag: "c3" },
    { prop: "crate_wood", at: [6, 0, 24], rot: [0, 0.7, 0], tag: "c4" },
    { prop: "crate_wood", at: [-25.5, 0, 7.6], tag: "c5" },
    { prop: "crate_wood", at: [-25.2, 0, 8.8], rot: [0, 0.15, 0], tag: "c6" },
    { prop: "crate_stack", at: [8, 0, 22], tag: "cs1" },
    { prop: "crate_stack", at: [-24.6, 0, 7.4], rot: [0, -0.5, 0], tag: "cs2" },
    { prop: "ibc_tote", at: [5, 0, 17], rot: [0, 0.3, 0], tag: "ibc1" },
    { prop: "ibc_tote", at: [-6.2, 0, 12.4], tag: "ibc2" },
    { prop: "traffic_cone", at: [0, 0, 22], tag: "cone1" },
    { prop: "traffic_cone", at: [2.1, 0, 23.2], tag: "cone2" },
    { prop: "traffic_cone", at: [-3.2, 0, 23.4], tag: "cone3" },
    { prop: "traffic_cone", at: [18, 0, -11], tag: "cone4" },
    { prop: "traffic_cone", at: [33, 0, 4], tag: "cone5" },
    { prop: "traffic_cone", at: [31.8, 0, 5.1], tag: "cone6" },
    { prop: "traffic_cone", at: [34.2, 0, 4.4], tag: "cone7" },
    { prop: "traffic_cone", at: [-4.4, 0, 30.5], tag: "cone8" },
    { prop: "traffic_cone", at: [-5.5, 0, 29.2], rot: [0, 0.8, 0], tag: "cone9" },
    { prop: "traffic_cone", at: [4.2, 0, 30.6], rot: [0, -0.6, 0], tag: "cone10" },
    { prop: "barrel", at: [-19.2, 0, 13.2], rot: [0, 0.4, 0], tag: "b9" },
    { prop: "tire_stack", at: [-27, 0, 12], tag: "tire1" },
    { prop: "tire_stack", at: [-27.8, 0, 12.6], rot: [0, 0.6, 0], tag: "tire2" },
    { prop: "tarp_cargo", at: [-9, 0, -12], rot: [0, 0.8, 0], tag: "tarp1" },
    { prop: "tarp_cargo", at: [-10.6, 0, -11.2], rot: [0, -0.5, 0], tag: "tarp2" },
    { prop: "cardboard_boxes", at: [-26, 0, -2], tag: "card1" },
    { prop: "cardboard_boxes", at: [-26.9, 0, -2.6], tag: "card2" },
    { prop: "cardboard_boxes", at: [17.9, 0, -14.8], tag: "card3" },
    { prop: "gas_cylinders", at: [-32, 0, 6], rot: [0, 1.1, 0], tag: "gas1" },
    { prop: "cable_reel", at: [-33, 0, -10], rot: [0, 0.4, 0], tag: "reel1" },
    { prop: "dumpster", at: [-36, 0, 18], rot: [0, 0.2, 0], tag: "dump1" },
    { prop: "generator", at: [20, 0, -17], rot: [0, -0.9, 0], tag: "genny1" },
    { prop: "jerry_can", at: [21, 0, -16.4], tag: "jerry1" },
    { prop: "jerry_can", at: [21.45, 0, -16.1], rot: [0, 1.2, 0], tag: "jerry2" },
    { prop: "jerry_can", at: [-31.4, 0, 5.5], rot: [0, 0.3, 0], tag: "jerry3" },
    { prop: "sandbags", at: [-1.5, 0, 27.3], rot: [0, 0.05, 0], tag: "bags1" },
    { prop: "sandbags", at: [0.9, 0, 27.6], rot: [0, -0.12, 0], tag: "bags2" },
    { prop: "toolbox_cart", at: [22, 0, -13], rot: [0, 0.5, 0], tag: "cart1" },
  ],
};
