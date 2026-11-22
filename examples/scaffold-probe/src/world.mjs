/**
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
