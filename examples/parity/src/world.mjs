/**
 * world.mjs — 世界常量（references/12 世界常量模板：改数值/加字段，不改结构）。
 * 单位：米；四区 bounds 手写；机位走玩家口径（主 74°/武器 54°）；
 * 全场景唯一随机源是 H2B.seededRng（mulberry32）——Math.random 出现即红（references/06 #5）。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.WORLD = {
  units: "meters",
  seed: 4207,
  bounds: { minX: -40, maxX: 40, minZ: -40, maxZ: 40 }, // 四区：闸口/堆场/仓库/码头
  groundY: 0,
  seaY: -1.6,                                            // sea.glsl 配方的海平面
  sun: {
    dir: [0.916, 0.225, 0.331],                          // 上游标定 [src:L30035-L30041]
    color: 0xffd9a8,
    col: [1.0, 0.72, 0.42],                              // 线性 HDR（shaft/post/天气共用）
    intensity: 9.0,
  },
  fog: { color: 0x232c36, colorLin: [0.42, 0.47, 0.52], density: 0.0028 },
  zenith: [0.055, 0.085, 0.13],                          // sky-deck 四色
  horizon: [0.95, 0.55, 0.28],
  horizonAway: [0.16, 0.22, 0.3],
  shafts: { sigma: 0.0034, maxDist: 170, farHaze: 1.6, sunScale: 0.85, ambient: 0.2 },
  sea: { quayX: 30, hazeA: 1, hazeB: 1 },
  camera: { fov: 74, near: 0.08, far: 900 },             // 玩家主相机口径
  weaponCamera: { fov: 54, near: 0.01, far: 10 },        // 独立 layer + depthRange 切片
  quality: {
    low:    { name: "low", scale: 0.4, msaa: 0, shadow: 512, tex: 512, volSteps: 12, planar: 0.0, bloom: false, shadowPass: false, rain: 0.55 },
    medium: { name: "medium", scale: 0.85, msaa: 0, shadow: 2048, tex: 1024, volSteps: 16, planar: 0.5, bloom: true, rain: 0.8 },
    high:   { name: "high",   scale: 1.0,  msaa: 0, shadow: 4096, tex: 2048, volSteps: 24, planar: 1.0, bloom: true, rain: 1.0 },
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

/** 事件总线：on/off/emit；kit 事件（weapon:fire / impact / player:step…）全走这里分派。 */
H2B.createEventBus = function createEventBus() {
  const map = new Map();
  return {
    on(type, fn) {
      if (!map.has(type)) map.set(type, []);
      const list = map.get(type);
      list.push(fn);
      return () => this.off(type, fn);
    },
    off(type, fn) {
      const list = map.get(type);
      if (!list) return;
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    emit(type, payload) {
      const list = map.get(type);
      if (!list) return;
      for (let i = 0; i < list.length; i += 1) list[i](payload);
    },
  };
};
