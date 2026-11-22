/**
 * gameplay/src/layout.mjs — 手写布局：目录 + 放置表（布局不随机，references/03 道具解剖）。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.CATALOG = {
  crate: { size: [1.2, 1.2, 1.2], material: "crate", parts: 6, surface: "wood" },
  barrier: { size: [2.4, 1.0, 0.4], material: "barrier", parts: 8, surface: "metal" },
  container: { size: [6.06, 2.59, 2.44], material: "container", parts: 24, surface: "metal" },
  tower: { size: [1.5, 6, 1.5], material: "tower", parts: 30, surface: "concrete" },
};

H2B.LAYOUT = {
  items: [
    { prop: "container", at: [-8, 0, -6], rot: [0, 0, 0], parts: 24, tag: "cover-north" },
    { prop: "container", at: [9, 0, 4], rot: [0, Math.PI / 2, 0], parts: 24, tag: "cover-east" },
    { prop: "crate", at: [-2, 0, 3] },
    { prop: "crate", at: [-2, 1.2, 3] },
    { prop: "crate", at: [-3.3, 0, 3.4] },
    { prop: "crate", at: [4, 0, -9] },
    { prop: "barrier", at: [5, 0, 6], rot: [0, 1.2, 0] },
    { prop: "barrier", at: [-5, 0, 6], rot: [0, -1.2, 0] },
    { prop: "tower", at: [14, 0, -12] },
  ],
  meta: {
    playerStart: { pos: { x: 0, y: 0, z: 14 }, yaw: Math.PI },
    enemySpawns: [
      { pos: { x: -6, y: 0, z: -12 } },
      { pos: { x: 6, y: 0, z: -14 } },
      { pos: { x: 0, y: 0, z: -18 } },
    ],
    extraction: { pos: { x: 0, y: 0, z: 16 }, radius: 2 },
  },
};
