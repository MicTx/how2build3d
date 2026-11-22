/**
 * fx-kit.mjs — FX 池：lit + additive 两套 GPU billboard 池 + tracer/debris/shell/decal 四个环形池
 * + 24 个环境发射器（steam/embers/fire/drip）。只写这一层；不改任何其它资产。
 *
 * 出处（upstream sources/jimao-3a-game/index.html，6215 行；行号按 prettify 产物的 [src:pretty] 规则）：
 *   - 双 billboard 池容量 lit 1400 / add 3040（3200-160）、tracer 48、debris 256、shell 60、decal 160，
 *     根组只挂 5 个 mesh（decal/debris/shell/lit/add）、`stats(): {lit, add, tracers, debris, drawCalls:5}`：
 *     [src:pretty:L48488-L48510]
 *   - 11 种效果 API（muzzleFlash/tracer/impact/sparks/smoke/dust/explosion/shell/splash/debris/decal）
 *     与 addEmitter 的发射器台账：[src:pretty:L48488-L48510]
 *   - 水面溅射/滴水的调参复用雨系统的水面响应（splash 的环 + 雾滴 + 二次环）：[src:pretty:L45423-L45485]
 *
 * 设计约定（与 assets/combat-kit.mjs、assets/level-kit.mjs、assets/sl-surface.mjs 一致）：
 *   1. three 作为第 1 个参数注入，**不顶层 import**；`createFxKit()` 可完全无 three 运行（纯 CPU 模拟，
 *      node 可直接自测：池、粒子、发射器、贴花全部照常推进，只是不建 mesh）。
 *   2. rng 注入；kit 内零 Math.random（铁律 #5）。绘制图集用独立定种 PRNG（seed 默认 9173），
 *      与调用方的 rng 隔离，保证图集逐次构建一致。
 *   3. 热循环（update/emit 内部）零分配：全部 SoA Float32Array/Uint8Array + 预分配临时量；
 *      每帧只做数值写入与一次属性上传，不 new 任何对象。
 *   4. 颜色是线性 HDR（火焰 5~40 量级），交给后处理链（post-chain 的 AgX）统一 tonemap；
 *      粒子材质不做内置 tonemapping，避免二次映射。
 *
 * draw call 预算（实测 = root.children.length）：decal + debris + shell + lit + add = 5。
 */
export const FX_POOL_SPEC = Object.freeze({
  lit: 1400,
  add: 3040,
  addReserve: 160,
  tracers: 48,
  debris: 256,
  shells: 60,
  decals: 160,
  emitters: 24,
});

export const FX_DRAW_CALLS = 5;

export const FX_ATLAS = Object.freeze({
  lit: Object.freeze({ cols: 4, rows: 2, size: 128 }), // 8 格翻页：0-5 烟团 / 6 落滴条纹 / 7 紧致闪光
  add: Object.freeze({ cols: 4, rows: 2, size: 128 }), // 8 格：0 辉光 / 1 条纹 / 2-3 火花 / 4 环 / 5 火舌 / 6 点 / 7 枪口锥
  decal: Object.freeze({ cols: 4, rows: 2, size: 256 }), // 金属×2 / 混凝土×2 / 木 / 烧灼 / 烟熏 / 玻璃
});

/** 11 种效果 API（floor: fxKinds >= 5）。 */
export const FX_KINDS = Object.freeze([
  "muzzleFlash", "tracer", "impact", "sparks", "smoke", "dust",
  "explosion", "shell", "splash", "debris", "decal",
]);

/** addEmitter 的四种家族（需求卡写 steam|fire|drip；上游另有 embers）。 */
export const FX_EMITTER_KINDS = Object.freeze(["steam", "embers", "fire", "drip"]);

/** 贴花图集格：[src:pretty:L48488-L48510] 的 da 表。 */
export const FX_SURFACE_DECAL = Object.freeze({
  bullet_metal: [0, 1],
  bullet_concrete: [2, 3],
  bullet_wood: [4],
  scorch: [5],
  soot: [6],
  bullet_glass: [7],
});

/** 贴花缺省半径（米）：上游 ZR 表。 */
export const FX_DECAL_SIZE = Object.freeze({
  bullet_metal: 0.25,
  bullet_concrete: 0.34,
  bullet_wood: 0.24,
  scorch: 2.4,
  soot: 0.3,
  bullet_glass: 0.3,
});

const TAU = Math.PI * 2;
const EMPTY = {};
const FLAG_BOUNCE = 1;
const FLAG_DIE = 2;
const FLAG_STOP = 4;
const DOWN = { x: 0, y: -1, z: 0 };

/* ---- 确定性小工具（无 Math.random；图集与噪声只用这几只） ---- */
function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function sstep(a, b, x) {
  const t = clamp01((x - a) / (b - a || 1e-6));
  return t * t * (3 - 2 * t);
}
function mulberry32(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}
function vnoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(x, y, oct) {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i += 1) {
    v += amp * vnoise(x * f, y * f);
    f *= 2.03;
    amp *= 0.5;
  }
  return v;
}

/* ---- 程序化图集（与 three 无关：只产出 Uint8Array，按需再包 DataTexture） ---- */

function genLitAtlas(size, seed) {
  const cols = FX_ATLAS.lit.cols;
  const rows = FX_ATLAS.lit.rows;
  const w = size * cols;
  const h = size * rows;
  const data = new Uint8Array(w * h * 4);
  for (let cell = 0; cell < cols * rows; cell += 1) {
    const cx = cell % cols;
    const cy = (cell / cols) | 0;
    const f = cell * 13.37 + 3.1;
    const p = cell * 7.77 + 1.3;
    for (let y = 0; y < size; y += 1) {
      const gy = ((y + 0.5) / size) * 2 - 1;
      for (let x = 0; x < size; x += 1) {
        const gx = ((x + 0.5) / size) * 2 - 1;
        const edge = 1 - sstep(0.78, 0.98, Math.max(Math.abs(gx), Math.abs(gy)));
        let alpha = 0;
        let lum = 0;
        if (cell === 6) {
          const vv = gy * 0.5 + 0.5;
          const width = 0.16 + 0.5 * vv * vv;
          const wob = (fbm(gx * 2 + f, vv * 2 + p, 3) - 0.5) * 0.25;
          const core = 1 - sstep(width * 0.3, width, Math.abs(gx + wob * vv));
          const tail = fbm(gx * 9 + f, vv * 2.2 + p, 4);
          const cut = 1 - sstep(0.55, 0.95, vv - (vnoise(gx * 6 + f, 3.3) - 0.5) * 0.35);
          const tip = sstep(0, 0.12, vv);
          alpha = core * cut * tip * sstep(0.22, 0.7, tail + 0.25 * (1 - vv));
          lum = core * cut;
        } else if (cell === 7) {
          const R = 0.3;
          const wob = (fbm(gx * 1.4 + f, gy * 1.4 + p, 3) - 0.5) * R;
          const wob2 = (fbm(gx * 1.4 + p + 5.2, gy * 1.4 + f + 1.7, 3) - 0.5) * R;
          const z = gx + wob;
          const q = gy + wob2;
          const d = Math.sqrt(z * z + q * q);
          const n2 = (fbm(z * 2.2 + f, q * 2.2 + p, 3) - 0.5) * 0.6;
          const body = 1 - sstep(0, 0.7, d + n2);
          const fine = fbm(z * 4.2 + f * 2, q * 4.2 + p * 2, 5);
          alpha = sstep(0.02, 0.7, body * (0.8 + 0.7 * fine));
          lum = body;
        } else {
          const R = 0.6;
          const wob = (fbm(gx * 1.4 + f, gy * 1.4 + p, 3) - 0.5) * R;
          const wob2 = (fbm(gx * 1.4 + p + 5.2, gy * 1.4 + f + 1.7, 3) - 0.5) * R;
          const z = gx + wob;
          const q = gy + wob2;
          const d = Math.sqrt(z * z + q * q);
          const n2 = (fbm(z * 2.2 + f, q * 2.2 + p, 3) - 0.5) * 0.6;
          const body = 1 - sstep(0, 0.8, d + n2);
          const fine = fbm(z * 4.2 + f * 2, q * 4.2 + p * 2, 5);
          alpha = sstep(0.06, 0.95, body * (0.25 + 1.5 * fine));
          lum = body;
        }
        const A = Math.max(0, Math.min(255, alpha * edge * 255));
        const L = Math.max(0, Math.min(255, lum * edge * 255));
        const idx = ((cy * size + y) * w + cx * size + x) * 4;
        data[idx] = L;
        data[idx + 1] = L;
        data[idx + 2] = L;
        data[idx + 3] = A;
      }
    }
  }
  return { data, cols, rows, size, width: w, height: h };
}

function genAddAtlas(size, seed) {
  const cols = FX_ATLAS.add.cols;
  const rows = FX_ATLAS.add.rows;
  const w = size * cols;
  const h = size * rows;
  const data = new Uint8Array(w * h * 4);
  const rnd = mulberry32(seed);
  const bursts = [0, 1].map(() => {
    const n = 7 + Math.floor(rnd() * 4);
    const lines = [];
    for (let i = 0; i < n; i += 1) {
      lines.push({
        a: (i / n + (rnd() - 0.5) * 0.12) * TAU,
        l: 0.35 + rnd() * 0.6,
        w: 0.018 + rnd() * 0.05,
        g: 0.5 + rnd() * 0.5,
      });
    }
    return lines;
  });
  for (let cell = 0; cell < cols * rows; cell += 1) {
    const cx = cell % cols;
    const cy = (cell / cols) | 0;
    for (let y = 0; y < size; y += 1) {
      const gy = ((y + 0.5) / size) * 2 - 1;
      for (let x = 0; x < size; x += 1) {
        const gx = ((x + 0.5) / size) * 2 - 1;
        const d = Math.sqrt(gx * gx + gy * gy);
        const vig = 1 - sstep(0.86, 0.99, Math.max(Math.abs(gx), Math.abs(gy)));
        let val = 0;
        if (cell === 0) {
          const b = Math.max(0, 1 - d);
          val = b * b * b * 0.75 + Math.exp(-d * d * 22) * 0.5;
        } else if (cell === 1) {
          const horiz = Math.pow(Math.max(0, 1 - gx * gx), 1.5);
          val = Math.exp(-(gy * gy) / (0.42 * 0.42)) * horiz;
        } else if (cell === 2 || cell === 3) {
          const lines = bursts[cell - 2];
          const ang = Math.atan2(gy, gx);
          for (let i = 0; i < lines.length; i += 1) {
            const s = lines[i];
            let da = Math.abs(ang - s.a) % TAU;
            if (da > Math.PI) da = TAU - da;
            const m = Math.sin(Math.min(da, 1.5)) * d;
            if (da < 1.5) {
              val += s.g * Math.exp(-(m * m) / (s.w * s.w * (0.4 + d))) * Math.pow(Math.max(0, 1 - d / s.l), 1.4);
            }
          }
          val = val * (0.7 + 0.6 * fbm(gx * 5 + cell * 9, gy * 5, 3)) + Math.exp(-d * d * 70) * 1.2;
          val += Math.max(0, 1 - d * 2.2) * 0.06;
        } else if (cell === 4) {
          const ang = Math.atan2(gy, gx);
          const ring = 0.78 + (vnoise(Math.cos(ang) * 2 + 5, Math.sin(ang) * 2 + 5) - 0.5) * 0.04;
          val = Math.exp(-((d - ring) * (d - ring)) / (0.03 * 0.03)) * (0.6 + 0.4 * vnoise(Math.cos(ang) * 5 + 9, Math.sin(ang) * 5 + 9));
          val += 0.05 * sstep(0.2, 0.78, d) * (1 - sstep(0.78, 0.8, d));
        } else if (cell === 5) {
          const wob = (fbm(gx * 1.6 + 3.3, gy * 1.6 + 8.1, 3) - 0.5) * 0.5;
          const wob2 = (fbm(gx * 1.6 + 7.7, gy * 1.6 + 2.2, 3) - 0.5) * 0.5;
          const z = gx + wob;
          const q = gy + wob2;
          const rr = Math.sqrt(z * z + q * q);
          const body = 1 - sstep(0, 0.84, rr);
          const fine = fbm(z * 4 + 1.1, q * 4 + 6.6, 5);
          val = sstep(0.04, 0.9, body * (0.3 + 1.4 * fine)) * (0.45 + 0.75 * body);
        } else if (cell === 6) {
          val = 1 - sstep(0.3, 0.62, d);
        } else {
          const bx = gx * 0.5 + 0.5;
          const width = 0.22 + 0.3 * bx;
          let a = Math.exp(-(gy * gy) / (width * width)) * Math.pow(bx, 1.8);
          const flare = (gx - 0.8) / 0.16;
          if (gx > 0.8) a *= Math.max(0, 1 - flare * flare);
          val = a * 1.15;
        }
        val *= vig;
        const L = Math.max(0, Math.min(255, val * 255));
        const idx = ((cy * size + y) * w + cx * size + x) * 4;
        data[idx] = L;
        data[idx + 1] = L;
        data[idx + 2] = L;
        data[idx + 3] = 255;
      }
    }
  }
  return { data, cols, rows, size, width: w, height: h };
}

function genDecalAtlas(size, seed) {
  const cols = FX_ATLAS.decal.cols;
  const rows = FX_ATLAS.decal.rows;
  const w = size * cols;
  const h = size * rows;
  const data = new Uint8Array(w * h * 4);
  const rnd = mulberry32(seed);
  // 每格固定几张划痕/碎片的种子参数，像素循环内不再取随机流（逐次构建一致）。
  const chips = [];
  for (let cell = 0; cell < cols * rows; cell += 1) {
    const list = [];
    const n = 3 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i += 1) {
      list.push({ a: rnd() * TAU, r0: 0.1 + rnd() * 0.25, r1: 0.4 + rnd() * 0.45, w: 0.5 + rnd() * 1.4 });
    }
    chips.push(list);
  }
  for (let cell = 0; cell < cols * rows; cell += 1) {
    const cx = cell % cols;
    const cy = (cell / cols) | 0;
    for (let y = 0; y < size; y += 1) {
      const gy = ((y + 0.5) / size) * 2 - 1;
      for (let x = 0; x < size; x += 1) {
        const gx = ((x + 0.5) / size) * 2 - 1;
        const d = Math.sqrt(gx * gx + gy * gy);
        const ang = Math.atan2(gy, gx);
        const n = fbm(gx * 4.5 + cell * 3.1, gy * 4.5 + 7.7, 4);
        const n2 = vnoise(gx * 11 + cell * 5, gy * 11 + 2.3);
        let a = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        if (cell === 0 || cell === 1) {
          const core = Math.max(0, 1 - d / 0.13);
          const rim = Math.exp(-((d - 0.24) * (d - 0.24)) / 0.004);
          const spokes = Math.pow(Math.abs(Math.sin(ang * 5 + n * 2)), 8) * Math.exp(-d * 2.4);
          a = clamp01(core * 1.3 + rim * (0.35 + n * 0.3) + spokes * 0.45);
          r = 22 + core * 20 + rim * 150 + spelled(n);
          g = 21 + core * 18 + rim * 142 + spelled(n);
          b = 20 + core * 16 + rim * 132 + spelled(n);
        } else if (cell === 2 || cell === 3) {
          const dust = Math.exp(-d * d * 3.2) * (0.28 + 0.55 * n);
          const hole = Math.max(0, 1 - d / 0.11);
          a = clamp01(dust + hole * 0.85 + n2 * 0.08 * (1 - d));
          r = 176 - hole * 120 + n * 34;
          g = 171 - hole * 118 + n * 32;
          b = 160 - hole * 110 + n * 30;
        } else if (cell === 4) {
          const fib = Math.pow(Math.abs(Math.sin(gy * 26 + n * 3.2 + gx * 4)), 3);
          a = clamp01((1 - sstep(0.2, 0.62, d + (n - 0.5) * 0.2)) * (0.45 + 0.55 * fib) + n2 * 0.06);
          r = 118 + fib * 26;
          g = 82 + fib * 20;
          b = 52 + fib * 14;
        } else if (cell === 5) {
          const rad = 0.52 + (n - 0.5) * 0.28;
          a = clamp01((1 - sstep(rad - 0.16, rad + 0.05, d)) * (0.55 + n * 0.6));
          r = 18 + n * 18;
          g = 16 + n * 16;
          b = 14 + n * 14;
        } else if (cell === 6) {
          a = clamp01(Math.exp(-d * d * 2.6) * (0.5 + n * 0.5));
          r = 50 + n * 18;
          g = 48 + n * 16;
          b = 46 + n * 15;
        } else {
          const star = Math.pow(Math.abs(Math.cos(ang * 3 + n * 1.5)), 6) * Math.exp(-d * 1.8);
          const ring = Math.exp(-((d - 0.2) * (d - 0.2)) / 0.003);
          a = clamp01(star * 0.8 + ring * 0.5 + n2 * 0.1 * (1 - d));
          r = 186 + star * 50;
          g = 202 + star * 40;
          b = 218 + star * 30;
        }
        // 金属/混凝土/木：加上几道由种子参数决定的划痕
        if (cell < 5) {
          const list = chips[cell];
          for (let i = 0; i < list.length; i += 1) {
            const s = list[i];
            let da = Math.abs(ang - s.a) % TAU;
            if (da > Math.PI) da = TAU - da;
            const band = Math.exp(-(da * da) / (0.0025 * s.w));
            const reach = sstep(s.r0, s.r0 + 0.04, d) * (1 - sstep(s.r1, s.r1 + 0.05, d));
            const k = band * reach * 0.5;
            if (k > 0.02) {
              a = clamp01(a + k * 0.4);
              r += k * 60;
              g += k * 58;
              b += k * 54;
            }
          }
        }
        const A = Math.max(0, Math.min(255, a * 255));
        const idx = ((cy * size + y) * w + cx * size + x) * 4;
        data[idx] = Math.max(0, Math.min(255, r));
        data[idx + 1] = Math.max(0, Math.min(255, g));
        data[idx + 2] = Math.max(0, Math.min(255, b));
        data[idx + 3] = A;
      }
    }
  }
  return { data, cols, rows, size, width: w, height: h };
}

function spelled(n) {
  // 一个小的、确定性的颗粒扰动（避免在像素循环里再开随机流）
  return (n * 24) | 0;
}

function atlasRect(cols, rows, cell) {
  const cx = cell % cols;
  const cy = (cell / cols) | 0;
  const uw = 1 / cols;
  const vh = 1 / rows;
  return [cx * uw, cy * vh, (cx + 1) * uw, (cy + 1) * vh];
}

// 贴花图集 8 格的 uv 矩形（模块级预计算：decal 每次调用不再新建数组）
const DECAL_UV = [];
for (let i = 0; i < FX_ATLAS.decal.cols * FX_ATLAS.decal.rows; i += 1) {
  DECAL_UV.push(atlasRect(FX_ATLAS.decal.cols, FX_ATLAS.decal.rows, i));
}

/* ---- 两套 billboard 池（lit / additive） ---- */

const FX_VERT = `
uniform vec2 uAtlas;
uniform float uPx;
attribute vec4 aPos;
attribute vec4 aAxis;
attribute vec4 aCol;
attribute vec4 aMisc;
varying vec2 vUv;
varying vec4 vCol;
varying vec3 vOff;
varying vec3 vT;
varying vec3 vB;
varying vec3 vInfo;
varying float vSoftD;
varying vec3 vToCam;

void main() {
  vec2 c = position.xy;
  vec3 center = aPos.xyz;
  float size = max(aPos.w, 1e-4);
  vec3 toCam = cameraPosition - center;
  float dist = length(toCam);
  vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float ang = aAxis.w;
  float cs = cos(ang);
  float sn = sin(ang);
  vec2 rc = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs);
  float mode = aMisc.y;
  vec3 off;
  vec3 tdir;
  vec3 bdir;
  float comp = 1.0;
  if (mode < 0.5) {
    off = (camR * rc.x + camU * rc.y) * size;
    tdir = camR * cs + camU * sn;
    bdir = camU * cs - camR * sn;
  } else if (mode < 1.5) {
    float len = length(aAxis.xyz);
    vec3 d = aAxis.xyz / max(len, 1e-5);
    vec3 side = cross(d, toCam / max(dist, 1e-4));
    float sl = length(side);
    side = sl > 1e-3 ? side / sl : camR;
    float w = max(size, dist * uPx * 1.4);
    comp = size / w;
    off = d * (c.x * max(len, w)) + side * (c.y * w);
    tdir = d;
    bdir = side;
  } else {
    vec3 nrm = normalize(aAxis.xyz + vec3(0.0, 1e-4, 0.0));
    vec3 t = normalize(abs(nrm.y) > 0.9 ? cross(nrm, vec3(1.0, 0.0, 0.0)) : cross(vec3(0.0, 1.0, 0.0), nrm));
    vec3 b = cross(nrm, t);
    off = (t * rc.x + b * rc.y) * size;
    tdir = t * cs + b * sn;
    bdir = b * cs - t * sn;
  }
  vec4 mv = viewMatrix * vec4(center + off, 1.0);
  gl_Position = projectionMatrix * mv;
  float f = floor(aMisc.x + 0.5);
  float col = mod(f, uAtlas.x);
  float row = floor(f / uAtlas.x);
  vUv = (vec2(col, row) + c + 0.5) / uAtlas;
  vCol = vec4(aCol.rgb * comp, aCol.a);
  vOff = off / max(size, 1e-4);
  vToCam = toCam;
  vInfo = vec3(mv.z, aMisc.z, aMisc.w);
  vSoftD = clamp(size * 0.4, 0.04, 0.7);
}
`;

const FX_SOFT_FN = `
float fxSoftFade() {
  float s = 1.0;
  if (uSoft > 0.5) {
    float d = texture2D(uDepth, gl_FragCoord.xy / uRes).x;
    float zs = (uNearFar.x * uNearFar.y) / ((uNearFar.y - uNearFar.x) * d - uNearFar.y);
    s = clamp((vInfo.x - zs) / vSoftD, 0.0, 1.0);
  }
  return s;
}
`;

const FX_LIT_FRAG = `
uniform sampler2D uTex;
uniform sampler2D uDepth;
uniform vec2 uRes;
uniform vec2 uNearFar;
uniform float uSoft;
uniform vec3 uSun;
uniform vec3 uSunDir;
uniform vec3 uAmbLo;
uniform vec3 uAmbHi;
varying vec2 vUv;
varying vec4 vCol;
varying vec3 vOff;
varying vec3 vT;
varying vec3 vB;
varying vec3 vInfo;
varying float vSoftD;
varying vec3 vToCam;
${FX_SOFT_FN}
void main() {
  vec4 tex = texture2D(uTex, vUv);
  float hot = step(1.5, vInfo.z);
  float er = vInfo.y * 0.45;
  float a = smoothstep(er, er + (hot > 0.5 ? 0.38 : 0.6), tex.a) * vCol.a;
  a *= fxSoftFade() * smoothstep(0.2, 0.9, -vInfo.x);
  if (a < 0.004) discard;
  vec3 V = normalize(vToCam);
  vec3 q = vOff * 2.0;
  float r2 = min(dot(q, q), 1.0);
  vec3 N = normalize(q + V * (sqrt(1.0 - r2) * 0.9 + 0.05));
  float wrap = clamp((dot(N, uSunDir) + 0.45) / 1.45, 0.0, 1.0);
  float back = pow(clamp(dot(-V, uSunDir), 0.0, 1.0), 5.0);
  float thin = 1.0 - tex.b * smoothstep(0.0, 0.5, a);
  vec3 sun = uSun * (wrap * wrap * 0.85 + back * (0.15 + 1.3 * thin));
  vec3 amb = mix(uAmbLo, uAmbHi, N.y * 0.5 + 0.5) * (1.0 - 0.35 * tex.b);
  vec3 col = vCol.rgb * (amb + sun);
  if (hot > 0.5) col = vCol.rgb * 1.6;
  gl_FragColor = vec4(col * a, a);
}
`;

const FX_ADD_FRAG = `
uniform sampler2D uTex;
uniform sampler2D uDepth;
uniform vec2 uRes;
uniform vec2 uNearFar;
uniform float uSoft;
varying vec2 vUv;
varying vec4 vCol;
varying vec3 vInfo;
varying float vSoftD;
${FX_SOFT_FN}
void main() {
  float k = texture2D(uTex, vUv).r * vCol.a * fxSoftFade();
  if (k < 0.002) discard;
  gl_FragColor = vec4(vCol.rgb * k, 1.0);
}
`;

function createBillboard(THREE, cap, lit, atlas, sun, sunDir, ambLo, ambHi) {
  const f = () => new Float32Array(cap * 4);
  const target = {
    cap,
    lit,
    n: 0,
    pos: f(),
    axis: f(),
    col: f(),
    misc: f(),
    mesh: null,
    geometry: null,
    material: null,
    uniforms: null,
    attrs: null,
    begin() {
      target.n = 0;
    },
    push(x, y, z, size, ax, ay, az, rot, r, g, b, a, frame, mode, erode, hot) {
      const k = target.n;
      if (k >= cap) return false;
      const o = k * 4;
      target.pos[o] = x;
      target.pos[o + 1] = y;
      target.pos[o + 2] = z;
      target.pos[o + 3] = size;
      target.axis[o] = ax;
      target.axis[o + 1] = ay;
      target.axis[o + 2] = az;
      target.axis[o + 3] = rot;
      target.col[o] = r;
      target.col[o + 1] = g;
      target.col[o + 2] = b;
      target.col[o + 3] = a;
      target.misc[o] = frame;
      target.misc[o + 1] = mode;
      target.misc[o + 2] = erode;
      target.misc[o + 3] = hot;
      target.n = k + 1;
      return true;
    },
    end() {
      const n = target.n;
      if (!target.mesh) return;
      target.geometry.instanceCount = n;
      target.mesh.visible = n > 0;
      if (n > 0) {
        const attrs = target.attrs;
        for (let i = 0; i < 4; i += 1) {
          const attr = attrs[i];
          if (attr.clearUpdateRanges) attr.clearUpdateRanges();
          if (attr.addUpdateRange) attr.addUpdateRange(0, n * 4);
          attr.needsUpdate = true;
        }
      }
    },
    setDepthTexture(tex, opts) {
      if (!target.uniforms) return;
      const u = target.uniforms;
      u.uDepth.value = tex || null;
      u.uSoft.value = tex ? 1 : 0;
      if (tex && opts) {
        if (opts.width) u.uRes.value.set(opts.width, opts.height || opts.width);
        if (opts.near !== undefined) u.uNearFar.value.set(opts.near, opts.far === undefined ? 900 : opts.far);
      }
    },
    clear() {
      target.n = 0;
      if (!target.mesh) return;
      target.geometry.instanceCount = 0;
      target.mesh.visible = false;
    },
  };
  if (!THREE) return target;

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const attrs = [
    new THREE.InstancedBufferAttribute(target.pos, 4),
    new THREE.InstancedBufferAttribute(target.axis, 4),
    new THREE.InstancedBufferAttribute(target.col, 4),
    new THREE.InstancedBufferAttribute(target.misc, 4),
  ];
  const names = ["aPos", "aAxis", "aCol", "aMisc"];
  for (let i = 0; i < 4; i += 1) {
    if (THREE.DynamicDrawUsage && attrs[i].setUsage) attrs[i].setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(names[i], attrs[i]);
  }
  geo.instanceCount = 0;
  target.geometry = geo;
  target.attrs = attrs;

  const uniforms = {
    uTex: { value: atlas.texture },
    uAtlas: { value: new THREE.Vector2(atlas.cols, atlas.rows) },
    uPx: { value: 0.001 },
    uDepth: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uNearFar: { value: new THREE.Vector2(0.08, 900) },
    uSoft: { value: 0 },
  };
  if (lit) {
    uniforms.uSun = { value: new THREE.Color(sun) };
    uniforms.uSunDir = { value: new THREE.Vector3(sunDir.x, sunDir.y, sunDir.z) };
    uniforms.uAmbLo = { value: new THREE.Color(ambLo) };
    uniforms.uAmbHi = { value: new THREE.Color(ambHi) };
  }
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: FX_VERT,
    fragmentShader: lit ? FX_LIT_FRAG : FX_ADD_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: lit ? THREE.OneMinusSrcAlphaFactor : THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  material.name = lit ? "fx_lit" : "fx_add";
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = lit ? 10 : 20;
  mesh.name = material.name;
  const v2 = new THREE.Vector2();
  mesh.onBeforeRender = (renderer) => {
    const rt = renderer.getRenderTarget();
    let hpx = 1;
    if (rt) hpx = rt.height;
    else {
      renderer.getDrawingBufferSize(v2);
      hpx = v2.y;
    }
    const p = renderer.getProjectionMatrix ? renderer.getProjectionMatrix().elements : null;
    if (p) uniforms.uPx.value = 2 / (Math.max(p[5], 0.001) * Math.max(hpx, 1));
  };
  target.mesh = mesh;
  target.material = material;
  target.uniforms = uniforms;
  return target;
}

/* ---- 粒子池（SoA + free list；合并/排序/写实例缓冲都在一次遍历里） ---- */

function createParticlePool(cap, sorted, rnd) {
  const f = () => new Float32Array(cap);
  const pool = {
    cap,
    sorted,
    n: 0,
    freeTop: cap,
    px: f(), py: f(), pz: f(),
    vx: f(), vy: f(), vz: f(),
    age: f(), life: f(), s0: f(), s1: f(), sk: f(),
    rot: f(), rotv: f(),
    r: f(), g: f(), b: f(), a: f(),
    drag: f(), grav: f(), wind: f(), turb: f(), seed: f(),
    fin: f(), fout: f(), stretch: f(), shade: f(), key: f(), gy: f(),
    nx: f(), ny: f(), nz: f(),
    frame: new Uint8Array(cap),
    mode: new Uint8Array(cap),
    flags: new Uint8Array(cap),
    ramp: new Uint8Array(cap),
    order: new Uint16Array(cap),
    free: new Uint16Array(cap),
    emit(x, y, z, vx, vy, vz, life, s0, s1) {
      if (pool.freeTop === 0) return -1;
      const i = pool.free[--pool.freeTop];
      pool.order[pool.n++] = i;
      pool.px[i] = x; pool.py[i] = y; pool.pz[i] = z;
      pool.vx[i] = vx; pool.vy[i] = vy; pool.vz[i] = vz;
      pool.age[i] = -1;
      pool.life[i] = life > 0 ? life : 0.001;
      pool.s0[i] = s0; pool.s1[i] = s1;
      pool.sk[i] = 2;
      pool.rot[i] = 0; pool.rotv[i] = 0;
      pool.r[i] = 1; pool.g[i] = 1; pool.b[i] = 1; pool.a[i] = 1;
      pool.drag[i] = 0; pool.grav[i] = 0; pool.wind[i] = 0; pool.turb[i] = 0;
      pool.seed[i] = rnd() * 100;
      pool.fin[i] = 0; pool.fout[i] = 0.5; pool.stretch[i] = 0.02; pool.shade[i] = 1;
      pool.key[i] = 0; pool.gy[i] = 0;
      pool.nx[i] = 0; pool.ny[i] = 1; pool.nz[i] = 0;
      pool.frame[i] = 0; pool.mode[i] = 0; pool.flags[i] = 0; pool.ramp[i] = 0;
      return i;
    },
    update(dt, target, camX, camY, camZ, wx, wy, wz, time) {
      const {
        px, py, pz, vx, vy, vz, age, life, s0, s1, sk, rot, rotv,
        r, g, b, a, drag, grav, wind, turb, seed, fin, fout, stretch,
        shade, key, gy, nx, ny, nz, frame, mode, flags, ramp, order,
      } = pool;
      let write = 0;
      const count = pool.n;
      for (let k = 0; k < count; k += 1) {
        const i = order[k];
        if (age[i] < 0) {
          age[i] = 0;
        } else {
          age[i] += dt;
          if (age[i] >= life[i]) {
            pool.free[pool.freeTop++] = i;
            continue;
          }
          const m = 1 - Math.exp(-drag[i] * dt);
          const w = wind[i];
          vx[i] += (wx * w - vx[i]) * m;
          vy[i] += (wy * w - vy[i]) * m;
          vz[i] += (wz * w - vz[i]) * m;
          vy[i] -= grav[i] * dt;
          const tb = turb[i];
          if (tb > 0) {
            const sd = seed[i];
            vx[i] += Math.sin(py[i] * 2.3 + sd + time * 1.7) * tb * dt;
            vz[i] += Math.cos(px[i] * 1.9 + sd * 1.3 + time * 1.3) * tb * dt;
            vy[i] += Math.sin(pz[i] * 2.1 + sd * 0.7 + time * 2.1) * tb * 0.4 * dt;
          }
          px[i] += vx[i] * dt;
          py[i] += vy[i] * dt;
          pz[i] += vz[i] * dt;
          rot[i] += rotv[i] * dt;
          const fl = flags[i];
          const floor = gy[i] + 0.012;
          if (fl && py[i] < floor) {
            if (fl & FLAG_DIE) {
              pool.free[pool.freeTop++] = i;
              continue;
            }
            if (fl & FLAG_BOUNCE) {
              py[i] = floor;
              if (vy[i] < 0) vy[i] = -vy[i] * (0.25 + ((seed[i] * 7) % 1) * 0.3);
              vx[i] *= 0.65;
              vz[i] *= 0.65;
            } else if (fl & FLAG_STOP) {
              py[i] = floor;
              vx[i] = 0;
              vy[i] = 0;
              vz[i] = 0;
            }
          }
        }
        if (pool.sorted) {
          const dx = px[i] - camX;
          const dy = py[i] - camY;
          const dz = pz[i] - camZ;
          key[i] = dx * dx + dy * dy + dz * dz;
        }
        order[write++] = i;
      }
      pool.n = write;

      if (pool.sorted && write > 1) {
        // 插入排序（与上游一致：近→远，粒子数有限）
        for (let k = 1; k < write; k += 1) {
          const idx = order[k];
          const kv = key[idx];
          let j = k - 1;
          while (j >= 0 && key[order[j]] < kv) {
            order[j + 1] = order[j];
            j -= 1;
          }
          order[j + 1] = idx;
        }
      }

      for (let k = 0; k < write; k += 1) {
        const i = order[k];
        const t = age[i] / life[i];
        const inv = 1 - t;
        const ease = 1 - Math.pow(inv, sk[i]);
        const size = s0[i] + (s1[i] - s0[i]) * ease;
        let alpha = a[i];
        const finv = fin[i];
        const foutv = fout[i];
        if (finv > 0 && t < finv) alpha *= t / finv;
        if (t > foutv) {
          const q = 1 - (t - foutv) / (1 - foutv || 1e-6);
          alpha *= q * q * (3 - 2 * q);
        }
        let cr = r[i];
        let cg = g[i];
        let cb = b[i];
        const rp = ramp[i];
        if (rp === 1) {
          cr *= Math.pow(inv, 0.5);
          cg *= Math.pow(inv, 1.4);
          cb *= Math.pow(inv, 3);
        } else if (rp === 2) {
          const q = 1 - Math.pow(t, 1.6);
          const k2 = q * Math.sqrt(q);
          cr *= k2;
          cg *= (0.22 + 0.78 * Math.pow(q, 1.3)) * k2;
          cb *= (0.04 + 0.96 * Math.pow(q, 3.5)) * k2;
        } else if (rp === 3) {
          const q = 0.55 + 0.45 * Math.sin(time * 17 + seed[i] * 9);
          cr *= q;
          cg *= q * (0.6 + 0.4 * inv);
          cb *= q * inv;
        }
        const md = mode[i];
        let ax = 0;
        let ay = 0;
        let az = 0;
        if (md === 1) {
          const st = stretch[i];
          ax = vx[i] * st;
          ay = vy[i] * st;
          az = vz[i] * st;
        } else if (md === 2) {
          ax = nx[i];
          ay = ny[i];
          az = nz[i];
        }
        target.push(px[i], py[i], pz[i], size, ax, ay, az, rot[i], cr, cg, cb, alpha, frame[i], md, t, shade[i]);
      }
    },
    clear() {
      pool.n = 0;
      pool.freeTop = pool.cap;
      for (let i = 0; i < pool.cap; i += 1) pool.free[i] = pool.cap - 1 - i;
    },
  };
  for (let i = 0; i < cap; i += 1) pool.free[i] = cap - 1 - i;
  return pool;
}

/* ---- tracer（48 根状态，渲染进 additive 池：仍是 1 个 draw call） ---- */

function createTracers(cap, rnd) {
  const f = () => new Float32Array(cap);
  const tr = {
    cap,
    n: 0,
    fx: f(), fy: f(), fz: f(),
    dx: f(), dy: f(), dz: f(),
    dist: f(), speed: f(), trav: f(), len: f(), width: f(),
    r: f(), g: f(), b: f(),
    frames: new Uint8Array(cap),
    add(from, to, r, g, b, speed, width) {
      let slot = tr.n;
      if (slot >= cap) slot = 0;
      else tr.n += 1;
      const cx = to.x - from.x;
      const cy = to.y - from.y;
      const cz = to.z - from.z;
      const d = Math.sqrt(cx * cx + cy * cy + cz * cz);
      if (d < 0.001) {
        if (slot === tr.n - 1) tr.n -= 1;
        return -1;
      }
      tr.fx[slot] = from.x; tr.fy[slot] = from.y; tr.fz[slot] = from.z;
      tr.dx[slot] = cx / d; tr.dy[slot] = cy / d; tr.dz[slot] = cz / d;
      tr.dist[slot] = d;
      tr.speed[slot] = speed;
      tr.trav[slot] = 0;
      tr.len[slot] = Math.min(Math.max(speed * 0.022, 2), 7);
      tr.width[slot] = width;
      tr.r[slot] = r; tr.g[slot] = g; tr.b[slot] = b;
      tr.frames[slot] = 0;
      return slot;
    },
    update(dt, target, frameIndex) {
      let n = tr.n;
      for (let i = 0; i < n; i += 1) {
        const speed = tr.speed[i];
        const dist = tr.dist[i];
        const len = tr.len[i];
        if (tr.frames[i] === 0) tr.trav[i] = Math.min(dist, speed * Math.max(dt, 0.008) * (0.35 + rnd() * 0.4));
        else tr.trav[i] += speed * dt;
        let head = Math.min(tr.trav[i], dist);
        let tail = Math.max(0, tr.trav[i] - len);
        if (tail >= dist) {
          if (tr.frames[i] >= 2) {
            n -= 1;
            if (i !== n) {
              tr.fx[i] = tr.fx[n]; tr.fy[i] = tr.fy[n]; tr.fz[i] = tr.fz[n];
              tr.dx[i] = tr.dx[n]; tr.dy[i] = tr.dy[n]; tr.dz[i] = tr.dz[n];
              tr.dist[i] = tr.dist[n]; tr.speed[i] = tr.speed[n];
              tr.trav[i] = tr.trav[n]; tr.len[i] = tr.len[n]; tr.width[i] = tr.width[n];
              tr.r[i] = tr.r[n]; tr.g[i] = tr.g[n]; tr.b[i] = tr.b[n];
              tr.frames[i] = tr.frames[n];
            }
            i -= 1;
            continue;
          }
          tail = Math.max(0, dist - len * 0.5);
          head = dist;
        }
        tr.frames[i] = Math.min(250, tr.frames[i] + 1);
        const mid = (head + tail) * 0.5;
        const seg = head - tail;
        target.push(
          tr.fx[i] + tr.dx[i] * mid,
          tr.fy[i] + tr.dy[i] * mid,
          tr.fz[i] + tr.dz[i] * mid,
          tr.width[i],
          tr.dx[i] * seg, tr.dy[i] * seg, tr.dz[i] * seg,
          0,
          tr.r[i], tr.g[i], tr.b[i], 1,
          frameIndex, 1, 0, 0
        );
      }
      tr.n = n;
    },
    clear() {
      tr.n = 0;
    },
  };
  return tr;
}

/* ---- debris（256 块，1 个 InstancedMesh） ---- */

function createDebris(THREE, cap, material, rockGeo, floorProbe, rnd) {
  const f = () => new Float32Array(cap);
  const pool = {
    cap,
    next: 0,
    live: 0,
    px: f(), py: f(), pz: f(),
    vx: f(), vy: f(), vz: f(),
    ax: f(), ay: f(), az: f(),
    ang: f(), spin: f(),
    sx: f(), sy: f(), sz: f(),
    age: f(), life: f(), floor: f(),
    state: new Uint8Array(cap),
    mesh: null,
    add(x, y, z, vx, vy, vz, sx, sy, sz, r, g, b, life, floorY) {
      const i = pool.next;
      pool.next = (i + 1) % cap;
      pool.px[i] = x; pool.py[i] = y; pool.pz[i] = z;
      pool.vx[i] = vx; pool.vy[i] = vy; pool.vz[i] = vz;
      let nx = rnd() - 0.5;
      let ny = rnd() - 0.5;
      let nz = rnd() - 0.5;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      pool.ax[i] = nx / nl; pool.ay[i] = ny / nl; pool.az[i] = nz / nl;
      pool.ang[i] = rnd() * TAU;
      pool.spin[i] = (rnd() - 0.5) * 50;
      pool.sx[i] = sx; pool.sy[i] = sy; pool.sz[i] = sz;
      pool.age[i] = 0;
      pool.life[i] = life;
      pool.floor[i] = floorY;
      pool.state[i] = 1;
      if (pool.mesh) {
        const c = pool.mesh.instanceColor.array;
        c[i * 3] = r; c[i * 3 + 1] = g; c[i * 3 + 2] = b;
        pool.mesh.instanceColor.needsUpdate = true;
      }
      return i;
    },
    update(dt, m4, axis3, q4, v3, s3) {
      const st = pool.state;
      let live = 0;
      let dirty = false;
      const arr = pool.mesh ? pool.mesh.instanceMatrix.array : null;
      for (let i = 0; i < cap; i += 1) {
        if (!st[i]) continue;
        pool.age[i] += dt;
        const remain = pool.life[i] - pool.age[i];
        if (remain <= 0) {
          st[i] = 0;
          if (arr) {
            m4.makeScale(0, 0, 0);
            m4.toArray(arr, i * 16);
          }
          dirty = true;
          continue;
        }
        live += 1;
        if (st[i] === 2 && remain > 0.5) continue;
        if (st[i] === 1) {
          pool.vy[i] -= 9.81 * dt;
          pool.px[i] += pool.vx[i] * dt;
          pool.py[i] += pool.vy[i] * dt;
          pool.pz[i] += pool.vz[i] * dt;
          pool.ang[i] += pool.spin[i] * dt;
          const floor = pool.floor[i] + Math.min(pool.sx[i], pool.sy[i], pool.sz[i]) * 0.5;
          if (pool.py[i] < floor && pool.vy[i] < 0) {
            pool.py[i] = floor;
            if (pool.vy[i] > -1.2) {
              st[i] = 2;
              pool.vx[i] = 0; pool.vy[i] = 0; pool.vz[i] = 0;
            } else {
              pool.vy[i] = -pool.vy[i] * 0.32;
              pool.vx[i] *= 0.55;
              pool.vz[i] *= 0.55;
              pool.spin[i] *= 0.5;
            }
          }
        }
        const fade = remain < 0.5 ? remain / 0.5 : 1;
        if (arr) {
          axis3.set(pool.ax[i], pool.ay[i], pool.az[i]);
          q4.setFromAxisAngle(axis3, pool.ang[i]);
          v3.set(pool.px[i], pool.py[i], pool.pz[i]);
          s3.set(pool.sx[i] * fade, pool.sy[i] * fade, pool.sz[i] * fade);
          m4.compose(v3, q4, s3);
          m4.toArray(arr, i * 16);
          dirty = true;
        }
      }
      pool.live = live;
      if (pool.mesh) {
        pool.mesh.visible = live > 0;
        if (dirty) pool.mesh.instanceMatrix.needsUpdate = true;
      }
    },
    clear() {
      pool.state.fill(0);
      pool.live = 0;
      if (pool.mesh) {
        const arr = pool.mesh.instanceMatrix.array;
        // 缩放归零：直接写 16 分量单位阵的 scale=0 形式
        for (let i = 0; i < cap; i += 1) {
          const o = i * 16;
          arr[o] = 0; arr[o + 1] = 0; arr[o + 2] = 0; arr[o + 3] = 0;
          arr[o + 4] = 0; arr[o + 5] = 0; arr[o + 6] = 0; arr[o + 7] = 0;
          arr[o + 8] = 0; arr[o + 9] = 0; arr[o + 10] = 0; arr[o + 11] = 0;
          arr[o + 12] = 0; arr[o + 13] = 0; arr[o + 14] = 0; arr[o + 15] = 1;
        }
        pool.mesh.instanceMatrix.needsUpdate = true;
        pool.mesh.visible = false;
      }
    },
  };
  if (THREE && material && rockGeo) {
    const mesh = new THREE.InstancedMesh(rockGeo, material, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.name = "fx_debris";
    mesh.visible = false;
    const arr = mesh.instanceMatrix.array;
    for (let i = 0; i < cap; i += 1) {
      const o = i * 16;
      arr[o] = 0; arr[o + 5] = 0; arr[o + 10] = 0; arr[o + 15] = 1;
    }
    pool.mesh = mesh;
  }
  return pool;
}

/* ---- shell（60 枚黄铜弹壳，1 个 InstancedMesh） ---- */

function createShells(THREE, cap, material, geo, floorProbe, rnd) {
  const f = () => new Float32Array(cap);
  const pool = {
    cap,
    next: 0,
    live: 0,
    px: f(), py: f(), pz: f(),
    vx: f(), vy: f(), vz: f(),
    qx: f(), qy: f(), qz: f(), qw: f().fill(1),
    wx: f(), wy: f(), wz: f(),
    age: f(), rest: f(), floor: f(),
    state: new Uint8Array(cap),
    bounces: new Uint8Array(cap),
    surface: new Array(cap).fill("concrete"),
    mesh: null,
    evt: { pos: { x: 0, y: 0, z: 0 }, surface: "concrete" },
    add(x, y, z, vx, vy, vz) {
      const i = pool.next;
      pool.next = (i + 1) % cap;
      pool.px[i] = x; pool.py[i] = y; pool.pz[i] = z;
      pool.vx[i] = vx; pool.vy[i] = vy; pool.vz[i] = vz;
      const ex = rnd() * TAU;
      const ey = rnd() * TAU;
      const ez = rnd() * TAU;
      // 欧拉 XYZ → 四元数（只需要一个随机初始姿态）
      const c1 = Math.cos(ex / 2), c2 = Math.cos(ey / 2), c3 = Math.cos(ez / 2);
      const s1 = Math.sin(ex / 2), s2 = Math.sin(ey / 2), s3 = Math.sin(ez / 2);
      pool.qx[i] = s1 * c2 * c3 + c1 * s2 * s3;
      pool.qy[i] = c1 * s2 * c3 - s1 * c2 * s3;
      pool.qz[i] = c1 * c2 * s3 + s1 * s2 * c3;
      pool.qw[i] = c1 * c2 * c3 - s1 * s2 * s3;
      pool.wx[i] = (rnd() - 0.5) * 40;
      pool.wy[i] = (rnd() - 0.5) * 20;
      pool.wz[i] = (rnd() - 0.5) * 40;
      pool.age[i] = 0;
      pool.rest[i] = 0;
      pool.state[i] = 1;
      pool.bounces[i] = 0;
      const hit = floorProbe ? floorProbe(x, y, z) : null;
      pool.floor[i] = hit ? hit.y : -50;
      pool.surface[i] = (hit && hit.surface) || "concrete";
      return i;
    },
    update(dt, m4, q4, v3, s3, onBounce) {
      const st = pool.state;
      let live = 0;
      let dirty = false;
      const arr = pool.mesh ? pool.mesh.instanceMatrix.array : null;
      for (let i = 0; i < cap; i += 1) {
        if (!st[i]) continue;
        live += 1;
        pool.age[i] += dt;
        let scale = 1;
        if (st[i] === 1) {
          pool.vy[i] -= 9.81 * dt;
          pool.px[i] += pool.vx[i] * dt;
          pool.py[i] += pool.vy[i] * dt;
          pool.pz[i] += pool.vz[i] * dt;
          // 四元数积分（半隐式）
          const wx = pool.wx[i], wy = pool.wy[i], wz = pool.wz[i];
          const qx = pool.qx[i], qy = pool.qy[i], qz = pool.qz[i], qw = pool.qw[i];
          const h = 0.5 * dt;
          let nx = qx + h * (wx * qw + wy * qz - wz * qy);
          let ny = qy + h * (wy * qw + wz * qx - wx * qz);
          let nz = qz + h * (wz * qw + wx * qy - wy * qx);
          let nw = qw - h * (wx * qx + wy * qy + wz * qz);
          const inv = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw) || 1);
          pool.qx[i] = nx * inv; pool.qy[i] = ny * inv; pool.qz[i] = nz * inv; pool.qw[i] = nw * inv;
          const floor = pool.floor[i] + 0.0065;
          if (pool.py[i] < floor && pool.vy[i] < 0) {
            pool.py[i] = floor;
            const bounces = pool.bounces[i]++;
            if (onBounce && bounces < 2) {
              const evt = pool.evt;
              evt.pos.x = pool.px[i]; evt.pos.y = pool.py[i]; evt.pos.z = pool.pz[i];
              evt.surface = pool.surface[i];
              onBounce(evt);
            }
            if (pool.vy[i] > -0.9 || bounces >= 4) {
              st[i] = 2;
              pool.vx[i] = 0; pool.vy[i] = 0; pool.vz[i] = 0;
              // 躺平：绕 X 轴 90° 再绕 Y 轴随机
              const yaw = rnd() * TAU;
              const cy2 = Math.cos(yaw / 2), sy2 = Math.sin(yaw / 2);
              const cp = Math.SQRT1_2, sp = Math.SQRT1_2;
              pool.qx[i] = sy2 * sp;
              pool.qy[i] = cp * sy2;
              pool.qz[i] = -sy2 * cp;
              pool.qw[i] = cy2 * cp;
            } else {
              pool.vy[i] = -pool.vy[i] * (0.32 + rnd() * 0.16);
              pool.vx[i] = pool.vx[i] * 0.6 + (rnd() - 0.5) * 0.6;
              pool.vz[i] = pool.vz[i] * 0.6 + (rnd() - 0.5) * 0.6;
              pool.wx[i] = (rnd() - 0.5) * 50;
              pool.wy[i] = (rnd() - 0.5) * 30;
              pool.wz[i] = (rnd() - 0.5) * 50;
              if (bounces === 0) {
                const hit = floorProbe ? floorProbe(pool.px[i], pool.py[i], pool.pz[i]) : null;
                if (hit) pool.floor[i] = hit.y;
              }
            }
          }
          if (pool.age[i] > 8) st[i] = 2;
        } else {
          pool.rest[i] += dt;
          if (pool.rest[i] < 4 && pool.rest[i] > dt * 1.5) continue;
          if (pool.rest[i] >= 4.7) {
            st[i] = 0;
            if (arr) {
              m4.makeScale(0, 0, 0);
              m4.toArray(arr, i * 16);
            }
            dirty = true;
            continue;
          }
          if (pool.rest[i] >= 4) scale = 1 - (pool.rest[i] - 4) / 0.7;
        }
        if (arr) {
          q4.set(pool.qx[i], pool.qy[i], pool.qz[i], pool.qw[i]);
          v3.set(pool.px[i], pool.py[i], pool.pz[i]);
          s3.set(scale, scale, scale);
          m4.compose(v3, q4, s3);
          m4.toArray(arr, i * 16);
          dirty = true;
        }
      }
      pool.live = live;
      if (pool.mesh) {
        pool.mesh.visible = live > 0;
        if (dirty) pool.mesh.instanceMatrix.needsUpdate = true;
      }
    },
    clear() {
      pool.state.fill(0);
      pool.live = 0;
      if (pool.mesh) {
        const arr = pool.mesh.instanceMatrix.array;
        for (let i = 0; i < cap; i += 1) {
          const o = i * 16;
          arr[o] = 0; arr[o + 5] = 0; arr[o + 10] = 0; arr[o + 15] = 1;
        }
        pool.mesh.instanceMatrix.needsUpdate = true;
        pool.mesh.visible = false;
      }
    },
  };
  if (THREE && material && geo) {
    const mesh = new THREE.InstancedMesh(geo, material, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.name = "fx_shells";
    mesh.visible = false;
    const arr = mesh.instanceMatrix.array;
    for (let i = 0; i < cap; i += 1) {
      const o = i * 16;
      arr[o] = 0; arr[o + 5] = 0; arr[o + 10] = 0; arr[o + 15] = 1;
    }
    pool.mesh = mesh;
  }
  return pool;
}

/* ---- decal（160 张，1 个动态 BufferGeometry） ---- */

function createDecals(THREE, cap, atlas, material, rnd) {
  const pool = {
    cap,
    next: 0,
    count: 0,
    pos: new Float32Array(cap * 12),
    nor: new Float32Array(cap * 12),
    uv: new Float32Array(cap * 8),
    col: new Float32Array(cap * 16),
    baseA: new Float32Array(cap),
    mesh: null,
    geometry: null,
    attrs: null,
    estimates: null,
    add(point, normal, surface, scale, tint, alpha) {
      const cells = FX_SURFACE_DECAL[surface] || FX_SURFACE_DECAL.bullet_concrete;
      const cell = cells[(rnd() * cells.length) | 0];
      const rect = DECAL_UV[cell];
      const size = (scale || FX_DECAL_SIZE[surface] || 0.25) * (0.85 + rnd() * 0.3) * 0.5;
      const i = pool.next;
      pool.next = (i + 1) % cap;
      if (pool.count < cap) pool.count += 1;

      let nx = normal.x;
      let ny = normal.y;
      let nz = normal.z;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;

      let vx, vy, vz;
      if (Math.abs(ny) > 0.9) {
        vx = 1; vy = 0; vz = 0;
      } else {
        vx = -nz; vy = 0; vz = nx;
      }
      const dot = vx * nx + vy * ny + vz * nz;
      vx -= nx * dot; vy -= ny * dot; vz -= nz * dot;
      const vl = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
      vx /= vl; vy /= vl; vz /= vl;
      // b = n × v
      const bx = ny * vz - nz * vy;
      const by = nz * vx - nx * vz;
      const bz = nx * vy - ny * vx;
      const ang = surface === "bullet_wood" ? (rnd() - 0.5) * 0.3 : rnd() * TAU;
      const cs = Math.cos(ang);
      const sn = Math.sin(ang);
      const sx = (vx * cs + bx * sn) * size;
      const sy = (vy * cs + by * sn) * size;
      const sz = (vz * cs + bz * sn) * size;
      const tx = (bx * cs - vx * sn) * size;
      const ty = (by * cs - vy * sn) * size;
      const tz = (bz * cs - vz * sn) * size;
      const lift = 0.004 + (i % 7) * 0.0003;
      const ox = point.x + nx * lift;
      const oy = point.y + ny * lift;
      const oz = point.z + nz * lift;

      const P = pool.pos;
      const N = pool.nor;
      const U = pool.uv;
      const C = pool.col;
      const po = i * 12;
      P[po] = ox - sx - tx; P[po + 1] = oy - sy - ty; P[po + 2] = oz - sz - tz;
      P[po + 3] = ox + sx - tx; P[po + 4] = oy + sy - ty; P[po + 5] = oz + sz - tz;
      P[po + 6] = ox + sx + tx; P[po + 7] = oy + sy + ty; P[po + 8] = oz + sz + tz;
      P[po + 9] = ox - sx + tx; P[po + 10] = oy - sy + ty; P[po + 11] = oz - sz + tz;
      for (let k = 0; k < 4; k += 1) {
        N[po + k * 3] = nx;
        N[po + k * 3 + 1] = ny;
        N[po + k * 3 + 2] = nz;
      }
      const uo = i * 8;
      U[uo] = rect[0]; U[uo + 1] = rect[1];
      U[uo + 2] = rect[2]; U[uo + 3] = rect[1];
      U[uo + 4] = rect[2]; U[uo + 5] = rect[3];
      U[uo + 6] = rect[0]; U[uo + 7] = rect[3];
      const co = i * 16;
      pool.baseA[i] = alpha;
      for (let k = 0; k < 4; k += 1) {
        C[co + k * 4] = tint;
        C[co + k * 4 + 1] = tint;
        C[co + k * 4 + 2] = tint;
        C[co + k * 4 + 3] = alpha;
      }
      // 环形写满时，给最老的 14 张做渐隐，让新贴花不突兀地顶掉旧贴花。
      if (pool.count >= cap) {
        for (let k = 0; k < 14; k += 1) {
          const idx = (pool.next + k) % cap;
          const a = pool.baseA[idx] * ((k + 1) / 15);
          const o2 = idx * 16;
          C[o2 + 3] = a; C[o2 + 7] = a; C[o2 + 11] = a; C[o2 + 15] = a;
        }
      }
      if (pool.mesh) {
        const attrs = pool.attrs;
        attrs[0].needsUpdate = true;
        attrs[1].needsUpdate = true;
        attrs[2].needsUpdate = true;
        attrs[3].needsUpdate = true;
        pool.mesh.visible = true;
        pool.geometry.setDrawRange(0, pool.count * 6);
      }
      return i;
    },
    clear() {
      pool.pos.fill(0);
      pool.nor.fill(0);
      pool.uv.fill(0);
      pool.col.fill(0);
      pool.count = 0;
      pool.next = 0;
      if (pool.mesh) {
        const attrs = pool.attrs;
        attrs[0].needsUpdate = true;
        attrs[1].needsUpdate = true;
        attrs[2].needsUpdate = true;
        attrs[3].needsUpdate = true;
        pool.mesh.visible = false;
      }
    },
  };
  if (THREE && material) {
    const geo = new THREE.BufferGeometry();
    const posA = new THREE.BufferAttribute(pool.pos, 3);
    const norA = new THREE.BufferAttribute(pool.nor, 3);
    const uvA = new THREE.BufferAttribute(pool.uv, 2);
    const colA = new THREE.BufferAttribute(pool.col, 4);
    if (THREE.DynamicDrawUsage) {
      if (posA.setUsage) posA.setUsage(THREE.DynamicDrawUsage);
      if (norA.setUsage) norA.setUsage(THREE.DynamicDrawUsage);
      if (uvA.setUsage) uvA.setUsage(THREE.DynamicDrawUsage);
      if (colA.setUsage) colA.setUsage(THREE.DynamicDrawUsage);
    }
    geo.setAttribute("position", posA);
    geo.setAttribute("normal", norA);
    geo.setAttribute("uv", uvA);
    geo.setAttribute("color", colA);
    const idx = new Uint16Array(cap * 6);
    for (let i = 0; i < cap; i += 1) {
      const b = i * 4;
      const o = i * 6;
      idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2;
      idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3;
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = -5;
    mesh.matrixAutoUpdate = false;
    mesh.name = "fx_decals";
    mesh.visible = false;
    pool.mesh = mesh;
    pool.geometry = geo;
    pool.attrs = [posA, norA, uvA, colA];
  }
  return pool;
}

/* ---- 工厂 ---- */

/**
 * 创建 FX kit。
 * @param {Object|null} THREE three 命名空间（可省略；省略时只做 CPU 模拟）
 * @param {Object} [options]
 * @param {Function} [options.rng] 注入随机源（默认 Math.random，kit 内部不直接调用）
 * @param {Object} [options.physics] physics-kit 兼容对象（raycast/lineOfSight），用于日照遮挡与地面高度
 * @param {Object} [options.ground] 地面查询（isPuddle(x,z)），impact 时把混凝土降级成水面
 * @param {Object} [options.events] {emit()}；弹壳落地会 emit("shell:bounce", evt)
 * @param {Object} [options.lightPool] {flash(pos,hex,intensity,distance,decay), acquire(), release()}
 * @param {Object} [options.wind] 风速向量 {x,y,z}
 * @param {Object} [options.sunDir] 太阳方向 {x,y,z}
 * @param {Object|number} [options.sun] 日光颜色（THREE.Color 可接受的值）
 * @param {Object|number} [options.ambLo]
 * @param {Object|number} [options.ambHi]
 * @param {Object} [options.camera] 相机（排序 lit 池用，也可 setCamera 后设）
 * @param {number} [options.seed] 图集种子
 * @param {boolean} [options.atlas] 无 three 时也强制生成图集（默认 false）
 * @param {number} [options.groundY] 无 physics 时的地面高度（默认 0）
 */
export function createFxKit(THREE, options = {}) {
  if (THREE && typeof THREE.BufferGeometry !== "function") {
    options = THREE;
    THREE = null;
  }
  const opts = options || {};
  const rng = typeof opts.rng === "function" ? opts.rng : Math.random;
  const rnd = () => rng();
  const physics = opts.physics || null;
  const ground = opts.ground || null;
  const events = opts.events || EMPTY;
  const lightPool = opts.lightPool || null;
  const wind = opts.wind || { x: 1.2, y: 0, z: 0.6 };
  const sunDir = opts.sunDir || { x: -0.55, y: 0.72, z: 0.42 };
  const sunHex = opts.sun === undefined ? 0xffe6c8 : opts.sun;
  const ambLoHex = opts.ambLo === undefined ? 0x2a2f3a : opts.ambLo;
  const ambHiHex = opts.ambHi === undefined ? 0x8fa8c8 : opts.ambHi;
  const seed = opts.seed === undefined ? 9173 : opts.seed;
  const groundY = opts.groundY === undefined ? 0 : opts.groundY;
  let camera = opts.camera || null;

  const litCap = FX_POOL_SPEC.lit;
  const addCap = FX_POOL_SPEC.add;

  const lit = createParticlePool(litCap, true, rnd);
  const add = createParticlePool(addCap, false, rnd);
  const tracers = createTracers(FX_POOL_SPEC.tracers, rnd);

  /* ---- 图集（只有需要渲染时才建 DataTexture；CPU 数据总在） ---- */
  function makeTexture(atlas, srgb) {
    if (!THREE) return null;
    const tex = new THREE.DataTexture(atlas.data, atlas.width, atlas.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    if (srgb && THREE.SRGBColorSpace && "colorSpace" in tex) tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }
  const litAtlasData = THREE || opts.atlas === true ? genLitAtlas(FX_ATLAS.lit.size, seed) : null;
  const addAtlasData = THREE || opts.atlas === true ? genAddAtlas(FX_ATLAS.add.size, seed + 1) : null;
  const decalAtlasData = THREE || opts.atlas === true ? genDecalAtlas(FX_ATLAS.decal.size, seed + 2) : null;
  const litTex = litAtlasData ? makeTexture(litAtlasData, false) : null;
  const addTex = addAtlasData ? makeTexture(addAtlasData, false) : null;
  const decalTex = decalAtlasData ? makeTexture(decalAtlasData, true) : null;
  const decalRect = (cell) => atlasRect(FX_ATLAS.decal.cols, FX_ATLAS.decal.rows, cell);

  const litAtlas = { cols: FX_ATLAS.lit.cols, rows: FX_ATLAS.lit.rows, texture: litTex, rect: decalRect };
  const addAtlas = { cols: FX_ATLAS.add.cols, rows: FX_ATLAS.add.rows, texture: addTex, rect: decalRect };

  const litTarget = createBillboard(THREE, litCap, true, litAtlas, sunHex, sunDir, ambLoHex, ambHiHex);
  const addTarget = createBillboard(THREE, addCap, false, addAtlas, sunHex, sunDir, ambLoHex, ambHiHex);
  const billboards = [litTarget, addTarget];

  /* ---- 共享材质与几何 ---- */
  let debrisMaterial = null;
  let rockGeo = null;
  let shellMaterial = null;
  let shellGeo = null;
  let decalMaterial = null;
  if (THREE) {
    if (THREE.MeshStandardMaterial) {
      debrisMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.05 });
      debrisMaterial.name = "fx_debris";
      shellMaterial = new THREE.MeshStandardMaterial({ color: 0xb08c4c, roughness: 0.3, metalness: 1 });
      shellMaterial.name = "fx_shells";
      decalMaterial = new THREE.MeshStandardMaterial({
        map: decalTex,
        transparent: true,
        vertexColors: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        roughness: 0.9,
        metalness: 0.05,
      });
      decalMaterial.name = "fx_decals";
    }
    // 碎片：低模碎石（把 icosahedron 顶点用定种 rng 打乱一次）
    if (THREE.IcosahedronGeometry) {
      rockGeo = new THREE.IcosahedronGeometry(0.5, 0);
      const pos = rockGeo.attributes.position;
      const jitter = mulberry32(seed + 7);
      for (let i = 0; i < pos.count; i += 1) {
        const k = 0.75 + jitter() * 0.5;
        pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * (0.6 + jitter() * 0.8), pos.getZ(i) * k);
      }
      pos.needsUpdate = true;
      rockGeo.computeVertexNormals();
    }
    // 弹壳：上游 11 段回转型材（9×19mm 级别），轴心居中
    if (THREE.LatheGeometry && THREE.Vector2) {
      const profile = [
        [0, 0], [0.006076, 0], [0.0062, 0.0012], [0.005084, 0.0022], [0.005084, 0.0034],
        [0.006014, 0.0046], [0.00589, 0.0364], [0.004092, 0.0416], [0.003968, 0.052],
        [0.003224, 0.052], [0.0031, 0.04472],
      ];
      const pts = profile.map((p) => new THREE.Vector2(p[0], p[1] - 0.026));
      shellGeo = new THREE.LatheGeometry(pts, 10);
    }
  }

  const probe = (x, y, z) => {
    if (physics && typeof physics.raycast === "function") {
      try {
        _probeOrigin.x = x;
        _probeOrigin.y = y + 0.25;
        _probeOrigin.z = z;
        const hit = physics.raycast(_probeOrigin, DOWN, 6);
        if (hit && hit.point) return { y: hit.point.y, surface: hit.surface || "concrete" };
      } catch (e) {
        // 无物理时回落
      }
    }
    return { y: groundY, surface: "concrete" };
  };

  const debris = createDebris(THREE, FX_POOL_SPEC.debris, debrisMaterial, rockGeo, probe, rnd);
  const shells = createShells(THREE, FX_POOL_SPEC.shells, shellMaterial, shellGeo, probe, rnd);
  const decals = createDecals(THREE, FX_POOL_SPEC.decals, { rect: decalRect }, decalMaterial, rnd);

  let root = null;
  if (THREE) {
    root = new THREE.Group();
    root.name = "fx";
    // 与上游一致的挂载顺序：decal / debris / shell / lit / add → 5 个 draw call
    if (decals.mesh) root.add(decals.mesh);
    if (debris.mesh) root.add(debris.mesh);
    if (shells.mesh) root.add(shells.mesh);
    root.add(litTarget.mesh);
    root.add(addTarget.mesh);
  }

  /* ---- 预分配临时量（update 内零分配） ---- */
  const _m4 = THREE ? new THREE.Matrix4() : null;
  const _q4 = THREE ? new THREE.Quaternion() : null;
  const _v3 = THREE ? new THREE.Vector3() : null;
  const _s3 = THREE ? new THREE.Vector3() : null;
  const _axis3 = THREE ? new THREE.Vector3() : null;
  const _probeOrigin = { x: 0, y: 0, z: 0 };
  const _rayOrg = { x: 0, y: 0, z: 0 };
  const _sA = { x: 0, y: 0, z: 0 };
  const _sB = { x: 0, y: 0, z: 0 };
  const _sC = { x: 0, y: 0, z: 0 };
  const _sD = { x: 0, y: 0, z: 0 };

  let time = 0;
  let activeEmitters = 0;

  // 预先绑定：update 内不再创建闭包（热循环零分配）
  const _onShellBounce = (evt) => {
    if (typeof events.emit === "function") events.emit("shell:bounce", evt);
  };

  /* ---- 光照/地面探测小工具 ---- */
  function sunExposure(p) {
    if (!physics || typeof physics.raycast !== "function") return 1;
    try {
      _rayOrg.x = p.x + sunDir.x * 0.08;
      _rayOrg.y = p.y + 0.03;
      _rayOrg.z = p.z + sunDir.z * 0.08;
      const hit = physics.raycast(_rayOrg, sunDir, 90);
      return hit ? 0.2 : 1;
    } catch (e) {
      return 1;
    }
  }

  function isWater(p) {
    if (!ground || typeof ground.isPuddle !== "function") return false;
    try {
      return !!ground.isPuddle(p.x, p.z);
    } catch (e) {
      return false;
    }
  }

  function flashLight(p, hex, intensity, distance, decay) {
    if (!lightPool || typeof lightPool.flash !== "function") return;
    try {
      lightPool.flash(p, hex, intensity, distance, decay);
    } catch (e) {
      // 光照池是可选的
    }
  }

  function acquireLight() {
    if (!lightPool || typeof lightPool.acquire !== "function") return null;
    try {
      return lightPool.acquire();
    } catch (e) {
      return null;
    }
  }

  function releaseLight(handle) {
    if (!handle) return;
    try {
      if (typeof handle.release === "function") handle.release();
      else if (lightPool && typeof lightPool.release === "function") lightPool.release(handle);
    } catch (e) {
      // ignore
    }
  }

  /* ---- 发射原语（全部写进两个池；不分配） ---- */
  function emitLit(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, alpha, shade, dragK, rise, windK, frame) {
    const i = lit.emit(x, y, z, vx, vy, vz, life, s0, s1);
    if (i < 0) return -1;
    lit.r[i] = r; lit.g[i] = g; lit.b[i] = b; lit.a[i] = alpha;
    lit.shade[i] = shade;
    lit.drag[i] = dragK;
    lit.grav[i] = -rise;
    lit.wind[i] = windK;
    lit.turb[i] = 0.5;
    lit.rot[i] = rnd() * TAU;
    lit.rotv[i] = (rnd() - 0.5) * 1.2;
    lit.frame[i] = frame < 0 ? ((rnd() * 6) | 0) : frame;
    lit.fin[i] = 0.06;
    lit.fout[i] = 0.3;
    lit.sk[i] = 2.5;
    return i;
  }

  function emitGlow(x, y, z, life, s0, s1, r, g, b, frame) {
    const i = add.emit(x, y, z, 0, 0, 0, life, s0, s1);
    if (i < 0) return -1;
    add.frame[i] = frame;
    add.r[i] = r; add.g[i] = g; add.b[i] = b;
    add.fout[i] = 0.2;
    add.rot[i] = rnd() * TAU;
    add.sk[i] = 1.5;
    return i;
  }

  function emitSpark(x, y, z, vx, vy, vz, life, size, r, g, b, flags) {
    const i = add.emit(x, y, z, vx, vy, vz, life, size, size * 0.5);
    if (i < 0) return -1;
    add.mode[i] = 1;
    add.frame[i] = 1;
    add.stretch[i] = 0.03;
    add.grav[i] = 9.81;
    add.drag[i] = 0.9;
    add.ramp[i] = 1;
    add.r[i] = r * 0.6; add.g[i] = g * 0.6; add.b[i] = b * 0.6;
    add.fout[i] = 0.55;
    add.flags[i] = flags;
    add.sk[i] = 1;
    return i;
  }

  function emitRing(x, y, z, life, s0, s1, r, g, b, nx, ny, nz) {
    const i = add.emit(x, y, z, 0, 0, 0, life, s0, s1);
    if (i < 0) return -1;
    add.mode[i] = 2;
    add.frame[i] = 4;
    add.nx[i] = nx; add.ny[i] = ny; add.nz[i] = nz;
    add.r[i] = r; add.g[i] = g; add.b[i] = b;
    add.fout[i] = 0.15;
    add.fin[i] = 0.08;
    add.sk[i] = 2.2;
    add.rot[i] = rnd() * TAU;
    return i;
  }

  function randAround(nx, ny, nz, spread, out) {
    let a = rnd() * 2 - 1;
    let b = rnd() * 2 - 1;
    let c = rnd() * 2 - 1;
    const r = Math.sqrt(a * a + b * b + c * c) || 1;
    const s = spread * Math.cbrt(rnd()) / r;
    a = nx + a * s;
    b = ny + b * s;
    c = nz + c * s;
    const l = Math.sqrt(a * a + b * b + c * c) || 1e-4;
    out.x = a / l;
    out.y = b / l;
    out.z = c / l;
    return out;
  }

  function burst(point, dir, count, vmin, vmax, lifeMin, lifeMax, sMin, sMax, r, g, b, flags) {
    for (let i = 0; i < count; i += 1) {
      randAround(dir.x, dir.y, dir.z, 1, _sA);
      const speed = vmin + (vmax - vmin) * rnd();
      const k = speed * (0.35 + 0.65 * rnd());
      emitSpark(
        point.x + _sA.x * 0.02, point.y + _sA.y * 0.02, point.z + _sA.z * 0.02,
        _sA.x * k, _sA.y * k, _sA.z * k,
        lifeMin + (lifeMax - lifeMin) * rnd(),
        sMin + (sMax - sMin) * rnd(),
        r, g, b, flags
      );
    }
  }

  function chunkBurst(point, dir, count, vmin, vmax, lifeMin, lifeMax, sMin, sMax, r, g, b, spread, floorY) {
    for (let i = 0; i < count; i += 1) {
      randAround(dir.x, dir.y, dir.z, spread, _sA);
      const speed = vmin + (vmax - vmin) * rnd();
      const s = 0.8 + rnd() * 0.35;
      debris.add(
        point.x + _sA.x * 0.02, point.y + _sA.y * 0.02, point.z + _sA.z * 0.02,
        _sA.x * speed, _sA.y * speed + 0.8, _sA.z * speed,
        lifeMin + (lifeMax - lifeMin) * rnd(),
        sMin + (sMax - sMin) * rnd(),
        sMin + (sMax - sMin) * rnd(),
        r * s, g * s, b * s,
        3.5 + rnd() * 2.5,
        floorY
      );
    }
  }

  /* ---- addEmitter ---- */
  const emitters = [];
  for (let i = 0; i < FX_POOL_SPEC.emitters; i += 1) {
    const em = {
      index: i,
      active: false,
      kind: "steam",
      x: 0, y: 0, z: 0,
      acc: 0,
      acc2: 0,
      ttl: Infinity,
      t: 0,
      scale: 1,
      shade: 1,
      drop: -1,
      light: null,
      setPos(p) {
        em.x = p.x;
        em.y = p.y;
        em.z = p.z;
      },
      stop() {
        if (!em.active) return;
        em.active = false;
        releaseLight(em.light);
        em.light = null;
      },
    };
    emitters.push(em);
  }

  function addEmitter(pos, kind = "steam", o = EMPTY) {
    let em = null;
    for (let i = 0; i < emitters.length; i += 1) {
      if (!emitters[i].active) {
        em = emitters[i];
        break;
      }
    }
    if (!em) return null;
    em.active = true;
    em.kind = kind;
    em.x = pos.x;
    em.y = pos.y;
    em.z = pos.z;
    em.acc = 0;
    em.acc2 = 0;
    em.ttl = o.ttl === undefined ? Infinity : o.ttl;
    em.t = 0;
    em.scale = o.scale === undefined ? 1 : o.scale;
    em.shade = o.shade === undefined ? 1 : o.shade;
    em.drop = -1;
    if (kind === "fire") {
      em.light = acquireLight();
    }
    return em;
  }

  function updateEmitters(dt) {
    activeEmitters = 0;
    for (let i = 0; i < emitters.length; i += 1) {
      const em = emitters[i];
      if (!em.active) continue;
      activeEmitters += 1;
      em.t += dt;
      if (em.ttl !== Infinity) {
        em.ttl -= dt;
        if (em.ttl <= 0) {
          em.stop();
          continue;
        }
      }
      const x = em.x;
      const y = em.y;
      const z = em.z;
      const s = em.scale;
      if (em.kind === "steam") {
        em.acc2 += dt * 4;
        while (em.acc2 > 1) {
          em.acc2 -= 1;
          emitLit(
            x + (rnd() - 0.5) * 0.4 * s, y + 0.8 * s, z + (rnd() - 0.5) * 0.4 * s,
            (rnd() - 0.5) * 0.4, 1.2 + rnd() * 0.8, (rnd() - 0.5) * 0.4,
            2.2 + rnd() * 1.2, 0.3 * s, (1.1 + rnd() * 0.7) * s,
            0.5, 0.5, 0.52, 0.5, em.shade, 0.9, 0.8, 1, -1
          );
        }
        em.acc += dt * 8;
        while (em.acc > 1) {
          em.acc -= 1;
          emitLit(
            x + (rnd() - 0.5) * 0.3, y + 0.3, z + (rnd() - 0.5) * 0.3,
            (rnd() - 0.5) * 0.5, 1.5 + rnd() * 1.5, (rnd() - 0.5) * 0.5,
            1 + rnd() * 1.2, 0.03, 0.012,
            0.55, 0.55, 0.56, 0.4, em.shade, 0.9, 0.6, 1, 3
          );
        }
      } else if (em.kind === "embers") {
        em.acc += dt * 8;
        while (em.acc > 1) {
          em.acc -= 1;
          const i2 = add.emit(
            x + (rnd() - 0.5) * 0.4 * s, y, z + (rnd() - 0.5) * 0.4 * s,
            (rnd() - 0.5) * 0.6, 0.6 + rnd() * 1.8, (rnd() - 0.5) * 0.6,
            1.5 + rnd() * 3.2, 0.02 + rnd() * 0.02, 0.012
          );
          if (i2 >= 0) {
            add.frame[i2] = 3;
            add.ramp[i2] = 3;
            add.r[i2] = 10; add.g[i2] = 4.2; add.b[i2] = 1;
            add.drag[i2] = 0.8;
            add.grav[i2] = -0.5;
            add.turb[i2] = 3.5;
            add.wind[i2] = 1;
            add.fout[i2] = 0.5;
          }
        }
      } else if (em.kind === "fire") {
        em.acc += dt * 24;
        while (em.acc > 1) {
          em.acc -= 1;
          const i2 = add.emit(
            x + (rnd() - 0.5) * 0.3 * s, y + 0.1 * s, z + (rnd() - 0.5) * 0.3 * s,
            (rnd() - 0.5) * 0.5, 1.2 + rnd() * 1.4, (rnd() - 0.5) * 0.5,
            0.35 + rnd() * 0.65, 0.45 * s, (0.2 + rnd() * 0.15) * s
          );
          if (i2 >= 0) {
            add.frame[i2] = 5;
            add.ramp[i2] = 2;
            add.r[i2] = 9; add.g[i2] = 5.5; add.b[i2] = 2.2;
            add.drag[i2] = 1;
            add.rot[i2] = rnd() * TAU;
            add.rotv[i2] = (rnd() - 0.5) * 4;
            add.fin[i2] = 0.12;
            add.fout[i2] = 0.4;
            add.wind[i2] = 1;
            add.turb[i2] = 2;
          }
        }
        em.acc2 += dt * 4;
        while (em.acc2 > 1) {
          em.acc2 -= 1;
          emitLit(
            x + (rnd() - 0.5) * 0.4, y + 0.8 * s, z + (rnd() - 0.5) * 0.4,
            (rnd() - 0.5) * 0.4, 1.2 + rnd() * 1.2, (rnd() - 0.5) * 0.4,
            2.2 + rnd() * 1.2, 0.3 * s, (1.1 + rnd() * 0.7) * s,
            0.13, 0.13, 0.14, 0.5, 3, 0.9, 0.7, 1, -1
          );
        }
        if (em.light) {
          const holder = em.light;
          const lx = holder.light || holder;
          if (lx && typeof lx === "object") {
            const flick = 14 + 6 * Math.sin(em.t * 23) + 4 * Math.sin(em.t * 37.7);
            if ("intensity" in lx) lx.intensity = flick * s;
            if ("distance" in lx) lx.distance = 9 * s;
            if (lx.position && typeof lx.position.set === "function") lx.position.set(x, y + 0.5, z);
          }
        }
      } else if (em.kind === "drip") {
        em.acc += dt * 1.6;
        while (em.acc > 1) {
          em.acc -= 1 + rnd() * 0.6;
          const fall = Math.sqrt((2 * Math.max(y, 0.05)) / 9.81);
          const i2 = add.emit(x, y, z, 0, -0.2, 0, fall + 0.05, 0.014, 0.014);
          if (i2 >= 0) {
            add.mode[i2] = 1;
            add.frame[i2] = 6;
            add.stretch[i2] = 0.02;
            add.grav[i2] = 9.81;
            add.r[i2] = 1.4 * em.shade + 0.4;
            add.g[i2] = 1.2 * em.shade + 0.5;
            add.b[i2] = 0.9 * em.shade + 0.6;
            add.flags[i2] = FLAG_DIE;
            add.fout[i2] = 0.98;
            add.gy[i2] = 0;
          }
          em.drop = Math.max(em.drop, fall);
        }
        if (em.drop > 0) {
          em.drop -= dt;
          if (em.drop <= 0) {
            em.drop = -1;
            splashAt(x, y - 0.02, z, 0.35 * s);
          }
        }
      }
    }
  }

  /* ---- 十一个效果 API ---- */

  function muzzleFlash(pos, dir, o = EMPTY) {
    const scale = o.scale === undefined ? 1 : o.scale;
    let dx = dir ? dir.x : 0;
    let dy = dir ? dir.y : 0;
    let dz = dir ? dir.z : -1;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    const cr = o.color === undefined ? 1 : colorR(o.color, 1);
    const cg = o.color === undefined ? 0.68 : colorG(o.color, 0.68);
    const cb = o.color === undefined ? 0.32 : colorB(o.color, 0.32);
    const x = pos.x;
    const y = pos.y;
    const z = pos.z;
    // 三层叠加的枪口辉光 + 一层内芯
    emitGlow(x + dx * 0.1 * scale, y + dy * 0.1 * scale, z + dz * 0.1 * scale, 0.045, 0.75 * scale, 1.15 * scale, 34 * cr, 34 * cg, 34 * cb, 2);
    emitGlow(x + dx * 0.14 * scale, y + dy * 0.14 * scale, z + dz * 0.14 * scale, 0.035, 0.5 * scale, 0.85 * scale, 22 * cr, 22 * cg, 22 * cb, 3);
    emitGlow(x + dx * 0.05 * scale, y + dy * 0.05 * scale, z + dz * 0.05 * scale, 0.045, 0.13 * scale, 0.2 * scale, 22, 22 * (cg + 0.25), 22 * (cb + 0.3), 0);
    emitGlow(x, y, z, 0.05, 0.8 * scale, 1.1 * scale, 0.4 * cr, 0.4 * cg, 0.4 * cb, 0);
    // 沿枪管的短火舌（stretch）
    const fi = add.emit(x + dx * 0.4 * scale, y + dy * 0.4 * scale, z + dz * 0.4 * scale, -dx, -dy, -dz, 0.04, 0.11 * scale, 0.14 * scale);
    if (fi >= 0) {
      add.mode[fi] = 1;
      add.frame[fi] = 7;
      add.stretch[fi] = 0.9 * scale;
      add.r[fi] = 18 * cr; add.g[fi] = 18 * cg; add.b[fi] = 18 * cb;
      add.fout[fi] = 0.3;
    }
    // 火星（3 颗）
    for (let i = 0; i < 3; i += 1) {
      randAround(dx, dy, dz, 0.25, _sA);
      const speed = 8 + rnd() * 14;
      emitSpark(x, y, z, _sA.x * speed, _sA.y * speed, _sA.z * speed, 0.08 + rnd() * 0.14, 0.012, 30, 18, 7, 0);
    }
    // 枪口烟
    emitLit(
      x + dx * 0.2, y + dy * 0.2, z + dz * 0.2,
      dx * 1.5, dy * 1.5 + 0.2, dz * 1.5,
      0.5 + rnd() * 0.4, 0.08 * scale, 0.45 * scale,
      0.5, 0.5, 0.52, 0.16, 1, 3, 0.3, 0.8, -1
    );
    flashLight({ x: x + dx * 0.25, y: y + dy * 0.25, z: z + dz * 0.25 }, 0xffb060, 16 * scale, 7 * scale, 0.05);
    return true;
  }

  function tracer(from, to, o = EMPTY) {
    const cr = o.color === undefined ? 1 : colorR(o.color, 1);
    const cg = o.color === undefined ? 0.8 : colorG(o.color, 0.8);
    const cb = o.color === undefined ? 0.46 : colorB(o.color, 0.46);
    const intensity = o.intensity === undefined ? 16 : o.intensity;
    const speed = o.speed === undefined ? 260 : o.speed;
    const width = o.width === undefined ? 0.024 : o.width;
    const slot = tracers.add(from, to, cr * intensity, cg * intensity, cb * intensity, speed, width);
    if (slot < 0) return -1;
    // 尾迹碎光（节流到 70ms 一次）
    if (o.trail !== false && time - _lastTrail > 0.07) {
      _lastTrail = time;
      let dx = to.x - from.x;
      let dy = to.y - from.y;
      let dz = to.z - from.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len > 2) {
        dx /= len; dy /= len; dz /= len;
        const trailLen = Math.min(len, 7);
        for (let i = 0; i < 5; i += 1) {
          const d = 0.6 + ((i + rnd()) / 5) * (trailLen - 0.6);
          const p = emitLit(
            from.x + dx * d, from.y + dy * d, from.z + dz * d,
            dx * 0.6, 0.05, dz * 0.6,
            0.45 + rnd() * 0.35, 0.04, 0.12 + rnd() * 0.08,
            0.6, 0.6, 0.62, 0.1, 1, 2, 0.1, 0.7, -1
          );
          if (p >= 0) lit.fin[p] = 0.25;
        }
      }
    }
    return slot;
  }
  let _lastTrail = -10;

  function impact(point, normal, surface = "bullet_concrete", dir = null, enemy = false) {
    let nx = normal ? normal.x : 0;
    let ny = normal ? normal.y : 1;
    let nz = normal ? normal.z : 0;
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;

    // 反射方向：有入射就用反射，否则沿法线
    let rx;
    let ry;
    let rz;
    if (dir) {
      const dl = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1;
      let dx = dir.x / dl;
      let dy = dir.y / dl;
      let dz = dir.z / dl;
      const dot = dx * nx + dy * ny + dz * nz;
      rx = dx - 2 * dot * nx;
      ry = dy - 2 * dot * ny;
      rz = dz - 2 * dot * nz;
      const rl = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
      rx /= rl; ry /= rl; rz /= rl;
    } else {
      rx = nx; ry = ny; rz = nz;
    }

    let surf = surface;
    if (enemy) surf = "enemy";
    // 也接受贴花名（bullet_metal 等）作为表面名
    if (surf === "bullet_metal") surf = "metal";
    else if (surf === "bullet_concrete") surf = "concrete";
    else if (surf === "bullet_wood") surf = "wood";
    else if (surf === "bullet_glass") surf = "glass";
    // 水面判定：与上游一致——非敌人、法线朝上、贴近地面且脚下是水洼时，一律降级成水面
    if (surf !== "enemy" && surf !== "water" && ny > 0.7 && point.y < 0.08 && isWater(point)) surf = "water";

    // 距离衰减：远处命中减半（同上游 55m）
    let dx = 0;
    let dy = 0;
    let dz = 0;
    if (camera) {
      dx = point.x - camera.position.x;
      dy = point.y - camera.position.y;
      dz = point.z - camera.position.z;
    }
    const far = dx * dx + dy * dy + dz * dz > 3025;
    const k = far ? 0.5 : 1;

    switch (surf) {
      case "metal": {
        _sA.x = rx + nx * 0.6; _sA.y = ry + ny * 0.6; _sA.z = rz + nz * 0.6;
        const l = Math.sqrt(_sA.x * _sA.x + _sA.y * _sA.y + _sA.z * _sA.z) || 1;
        _sA.x /= l; _sA.y /= l; _sA.z /= l;
        burst(point, _sA, Math.round(18 * k), 6, 24, 0.55, 0.1, 0.38, 40, 25, 10.5, 0);
        burst(point, _sA, 2 + ((rnd() * 2) | 0), 9, 18, 0.9, 0.7, 1.3, 32, 18, 7, FLAG_BOUNCE);
        emitGlow(point.x + nx * 0.03, point.y + ny * 0.03, point.z + nz * 0.03, 0.05, 0.25, 0.45, 16, 11, 5.5, 0);
        emitGlow(point.x + nx * 0.04, point.y + ny * 0.04, point.z + nz * 0.04, 0.04, 0.35, 0.5, 9, 6, 2.6, 2 + ((rnd() * 2) | 0));
        flashLight({
          x: point.x + nx * 0.12, y: point.y + ny * 0.12, z: point.z + nz * 0.12,
        }, 0xffc040, 10, 5, 0.05);
        for (let i = 0; i < 2; i += 1) {
          emitLit(
            point.x + nx * 0.04, point.y + ny * 0.04, point.z + nz * 0.04,
            nx * 0.8 + (rnd() - 0.5) * 0.5, ny * 0.8 + 0.2, nz * 0.8 + (rnd() - 0.5) * 0.5,
            0.5 + rnd() * 0.4, 0.06, 0.3 + rnd() * 0.2,
            0.4, 0.4, 0.41, 0.4, 1, 2.5, 0.3, 0.8, -1
          );
        }
        if (!far) {
          chunkBurst(point, { x: nx, y: ny, z: nz }, 2, 1.5, 4, 0.012, 0.03, 0.003, 0.005, 0.2, 0.21, 0.23, 0.8, sunFloor(point.x, point.z));
        }
        decal(point, { x: nx, y: ny, z: nz }, "bullet_metal");
        break;
      }
      case "wood": {
        const c = dust(point, { x: nx, y: ny, z: nz }, 0.75, 0.5, 0.42, 0.32);
        chunkBurst(point, { x: nx, y: ny, z: nz }, far ? 3 : 7, 2, 6, 0.004, 0.009, 0.03, 0.1, 0.62, 0.5, 0.33, 0.7, sunFloor(point.x, point.z));
        if (c > 0.5 && rnd() < 0.3) emitGlow(point.x, point.y, point.z, 0.04, 0.1, 0.2, 3, 2, 1, 0);
        decal(point, { x: nx, y: ny, z: nz }, "bullet_wood");
        break;
      }
      case "water": {
        splash(point, k);
        break;
      }
      case "rubber":
      case "dirt": {
        const isDirt = surf === "dirt";
        const r = isDirt ? 0.3 : 0.14;
        const g = isDirt ? 0.25 : 0.14;
        const b = isDirt ? 0.19 : 0.14;
        for (let i = 0; i < 5; i += 1) {
          randAround(nx, ny, nz, 0.6, _sA);
          const speed = 0.6 + rnd() * 2;
          emitLit(
            point.x + nx * 0.03, point.y + ny * 0.03, point.z + nz * 0.03,
            _sA.x * speed, _sA.y * speed, _sA.z * speed,
            0.5 + rnd() * 0.5, 0.07, 0.3 + rnd() * 0.25,
            r, g, b, 0.85, 1, 3.5, 0.1, 0.6, i < 2 ? 7 : -1
          );
        }
        chunkBurst(point, { x: nx, y: ny, z: nz }, 3, 1.5, 4, 0.01, 0.03, 0.008, 0.02, r * 0.8, g * 0.8, b * 0.8, 0.7, sunFloor(point.x, point.z));
        decal(point, { x: nx, y: ny, z: nz }, "soot", 0.2, 1);
        break;
      }
      case "glass": {
        for (let i = 0; i < 12; i += 1) {
          randAround(nx, ny, nz, 0.9, _sA);
          const speed = 1.5 + rnd() * 4.5;
          const gi = add.emit(point.x, point.y, point.z, _sA.x * speed, _sA.y * speed, _sA.z * speed, 0.4 + rnd() * 0.5, 0.012 + rnd() * 0.008, 0.008);
          if (gi >= 0) {
            add.mode[gi] = 1;
            add.frame[gi] = 6;
            add.stretch[gi] = 0.01;
            add.grav[gi] = 9.81;
            add.r[gi] = 2.6; add.g[gi] = 2.7; add.b[gi] = 2.8;
            add.flags[gi] = FLAG_DIE;
            add.ramp[gi] = 3;
          }
        }
        chunkBurst(point, { x: nx, y: ny, z: nz }, 4, 1.5, 5, 0.01, 0.03, 0.002, 0.004, 0.62, 0.72, 0.74, 0.8, sunFloor(point.x, point.z));
        emitLit(
          point.x, point.y, point.z,
          nx * 0.6, ny * 0.6 + 0.2, nz * 0.6,
          0.6, 0.08, 0.4, 0.75, 0.8, 0.82, 0.2, 1, 2.5, 0.2, 0.8, -1
        );
        decal(point, { x: nx, y: ny, z: nz }, "bullet_glass");
        break;
      }
      case "enemy": {
        _sA.x = rx + nx * 0.8; _sA.y = ry + ny * 0.8; _sA.z = rz + nz * 0.8;
        const l = Math.sqrt(_sA.x * _sA.x + _sA.y * _sA.y + _sA.z * _sA.z) || 1;
        _sA.x /= l; _sA.y /= l; _sA.z /= l;
        burst(point, _sA, Math.round(13 * k), 5, 20, 0.9, 0.12, 0.45, 42, 29, 14, 0);
        burst(point, _sA, 2, 6, 12, 1, 0.6, 1.1, 32, 18, 7, FLAG_BOUNCE);
        emitGlow(point.x, point.y, point.z, 0.06, 0.3, 0.55, 18, 12, 6, 0);
        emitGlow(point.x, point.y, point.z, 0.04, 0.3, 0.45, 8, 5, 2.4, 2 + ((rnd() * 2) | 0));
        flashLight(point, 0xffb040, 8, 4.5, 0.05);
        for (let i = 0; i < 2; i += 1) {
          emitLit(
            point.x, point.y, point.z,
            nx * 0.5 + (rnd() - 0.5) * 0.4, ny * 0.5 + 0.3, nz * 0.5 + (rnd() - 0.5) * 0.4,
            0.6 + rnd() * 0.5, 0.06, 0.3 + rnd() * 0.2,
            0.13, 0.13, 0.14, 0.65, 1, 2.2, 0.5, 0.9, -1
          );
        }
        if (!far) {
          const dark = rnd() < 0.35;
          chunkBurst(point, { x: nx, y: ny, z: nz }, 3, 2, 6, 0.012, 0.035, 0.004, 0.008, 0.6, dark ? 0.2 : 0.62, dark ? 0.05 : 0.64, 0.8, sunFloor(point.x, point.z));
        }
        break;
      }
      default: {
        dust(point, { x: nx, y: ny, z: nz }, 1, 0.52, 0.5, 0.47);
        chunkBurst(point, { x: nx, y: ny, z: nz }, far ? 2 : 4, 1.5, 5.5, 0.012, 0.035, 0.008, 0.02, 0.42, 0.41, 0.39, 0.7, sunFloor(point.x, point.z));
        _sA.x = rx + nx * 0.7; _sA.y = ry + ny * 0.7; _sA.z = rz + nz * 0.7;
        const l = Math.sqrt(_sA.x * _sA.x + _sA.y * _sA.y + _sA.z * _sA.z) || 1;
        _sA.x /= l; _sA.y /= l; _sA.z /= l;
        for (let i = 0; i < 4; i += 1) {
          randAround(_sA.x, _sA.y, _sA.z, 0.5, _sB);
          const speed = 3 + rnd() * 6;
          const pi = emitLit(
            point.x, point.y, point.z,
            _sB.x * speed, _sB.y * speed, _sB.z * speed,
            0.25 + rnd() * 0.2, 0.03, 0.09,
            0.6, 0.58, 0.54, 0.7, 1, 2, -6, 0.2, 7
          );
          if (pi >= 0) lit.turb[pi] = 0;
        }
        if (rnd() < 0.3) burst(point, _sA, 3, 4, 10, 0.6, 0.08, 0.2, 26, 15, 6, 0);
        decal(point, { x: nx, y: ny, z: nz }, "bullet_concrete");
        break;
      }
    }
    return surf;
  }

  function sunFloor(x, z) {
    const hit = probe(x, 0.5, z);
    return hit ? hit.y : groundY;
  }

  function sparks(point, normal, o = EMPTY) {
    const count = typeof o === "number" ? o : o.count === undefined ? 12 : o.count;
    let nx = normal ? normal.x : 0;
    let ny = normal ? normal.y : 1;
    let nz = normal ? normal.z : 0;
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    burst(point, { x: nx, y: ny, z: nz }, count, 5, 18, 0.6, 0.15, 0.5, 36, 22, 9, 0);
    emitGlow(point.x, point.y, point.z, 0.05, 0.2, 0.35, 10, 6.5, 3, 0);
  }

  function smoke(pos, o = EMPTY) {
    const size = o.size === undefined ? 1 : o.size;
    const life = o.life === undefined ? 2.5 : o.life;
    const rise = o.rise === undefined ? 0.6 : o.rise;
    const count = o.count === undefined ? 3 : o.count;
    const cr = o.color === undefined ? 0.32 : colorR(o.color, 0.32);
    const cg = o.color === undefined ? 0.32 : colorG(o.color, 0.32);
    const cb = o.color === undefined ? 0.33 : colorB(o.color, 0.33);
    const vel = o.vel || null;
    const vi = sunExposure(pos);
    for (let i = 0; i < count; i += 1) {
      emitLit(
        pos.x + (rnd() - 0.5) * 0.2 * size,
        pos.y + (rnd() - 0.5) * 0.2 * size,
        pos.z + (rnd() - 0.5) * 0.2 * size,
        (vel ? vel.x : 0) + (rnd() - 0.5) * 0.4,
        (vel ? vel.y : 0) + rnd() * 0.3,
        (vel ? vel.z : 0) + (rnd() - 0.5) * 0.4,
        life * (0.75 + rnd() * 0.45),
        size * 0.3,
        size * (1 + rnd() * 0.5),
        cr, cg, cb,
        (o.alpha === undefined ? 0.4 : o.alpha) * vi,
        1.2, rise, 1, -1
      );
    }
  }

  function dust(point, normal, o = EMPTY) {
    // 兼容上游 q(point, normal, scale, r, g, b) 的位置实参：scale 可直接是数字
    let size = 1;
    let cr = 0.5;
    let cg = 0.48;
    let cb = 0.45;
    if (typeof o === "number") size = o;
    else {
      if (o.scale !== undefined) size = o.scale;
      if (o.color !== undefined) {
        cr = colorR(o.color, 0.5);
        cg = colorG(o.color, 0.48);
        cb = colorB(o.color, 0.45);
      }
    }
    let nx = normal ? normal.x : 0;
    let ny = normal ? normal.y : 1;
    let nz = normal ? normal.z : 0;
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const sunK = sunExposure(point);
    for (let i = 0; i < 8; i += 1) {
      randAround(nx, ny, nz, 0.5, _sA);
      const speed = (1 + rnd() * 3.5) * size;
      const tint = 0.85 + rnd() * 0.25;
      emitLit(
        point.x + nx * 0.03, point.y + ny * 0.03, point.z + nz * 0.03,
        _sA.x * speed, _sA.y * speed, _sA.z * speed,
        0.5 + rnd() * 0.6, 0.08 * size, (0.35 + rnd() * 0.35) * size,
        cr * tint, cg * tint, cb * tint, 0.9 * sunK,
        sunK, 3.5, 0.15, 0.6, i < 3 ? 7 : -1
      );
    }
    for (let i = 0; i < 2; i += 1) {
      emitLit(
        point.x + nx * 0.15, point.y + ny * 0.15, point.z + nz * 0.15,
        nx * 0.5 + (rnd() - 0.5) * 0.3, ny * 0.5 + 0.1, nz * 0.5 + (rnd() - 0.5) * 0.3,
        2.2 + rnd() * 1.4, 0.25 * size, (0.9 + rnd() * 0.6) * size,
        cr, cg, cb, 0.28 * sunK, 1, 1.5, 0.1, 1, -1
      );
    }
    return 1;
  }

  function splash(point, o = EMPTY) {
    let scale = 1;
    if (typeof o === "number") scale = o;
    else if (o.scale !== undefined) scale = o.scale;
    splashAt(point.x, point.y, point.z, scale);
    return true;
  }

  function splashAt(x, y, z, scale) {
    // 水雾
    for (let i = 0; i < 5; i += 1) {
      const life = (0.35 + rnd() * 0.25) * scale;
      const pi = emitLit(
        x + (rnd() - 0.5) * 0.08 * scale, y + 0.1 * scale, z + (rnd() - 0.5) * 0.08 * scale,
        (rnd() - 0.5) * 0.5, (1.6 + rnd() * 1.2) * Math.sqrt(scale), (rnd() - 0.5) * 0.5,
        life * 1.6, life * 0.3, life,
        0.72, 0.78, 0.84, 0.95, 1, 0.5, -7, 0, 6
      );
      if (pi >= 0) {
        lit.rot[pi] = (rnd() - 0.5) * 0.3;
        lit.rotv[pi] = 0;
        lit.turb[pi] = 0;
        lit.sk[pi] = 3;
        lit.fout[pi] = 0.4;
      }
    }
    // 低层薄雾
    for (let i = 0; i < 2; i += 1) {
      emitLit(
        x, y + 0.15 * scale, z,
        (rnd() - 0.5) * 0.6, 0.5, (rnd() - 0.5) * 0.6,
        0.7 + rnd() * 0.4, 0.2 * scale, 0.7 * scale,
        0.7, 0.75, 0.8, 0.14, 1, 2, 0, 0.8, -1
      );
    }
    // 水滴（带重力，落到水面死掉）
    const dr = 1.9 * scale + 0.35;
    const dg = 1.5 * scale + 0.45;
    const db = 1.05 * scale + 0.55;
    const n = Math.round(14 * Math.min(scale, 1.6));
    for (let i = 0; i < n; i += 1) {
      randAround(0, 1, 0, 0.75, _sA);
      const speed = (1.5 + rnd() * 3.3) * Math.sqrt(scale);
      const di = add.emit(
        x, y + 0.03, z,
        _sA.x * speed, Math.abs(_sA.y) * speed, _sA.z * speed,
        0.5 + rnd() * 0.5, 0.012 + rnd() * 0.012, 0.01
      );
      if (di >= 0) {
        add.mode[di] = 1;
        add.frame[di] = 6;
        add.stretch[di] = 0.012;
        add.grav[di] = 9.81;
        add.drag[di] = 0.4;
        add.r[di] = dr;
        add.g[di] = dg;
        add.b[di] = db;
        add.fout[di] = 0.7;
        add.flags[di] = FLAG_DIE;
        add.sk[di] = 1;
        add.gy[di] = y;
      }
    }
    // 两个扩散环
    emitRing(x, y + 0.012, z, 0.9, 0.12 * scale, 1.5 * scale, 0.3 * scale + 0.08, 0.27 * scale + 0.09, 0.22 * scale + 0.1, 0, 1, 0);
    const ri = emitRing(x, y + 0.012, z, 1.3, 0.05 * scale, 1 * scale, 0.2 * scale + 0.05, 0.18 * scale + 0.06, 0.15 * scale + 0.07, 0, 1, 0);
    if (ri >= 0) add.fin[ri] = 0.35;
  }

  function explosion(point, o = EMPTY) {
    let scale = 1;
    if (typeof o === "number") scale = o;
    else if (o.scale !== undefined) scale = o;
    const s = Math.max(0.4, Math.min(scale, 4));
    const x = point.x;
    const y = point.y;
    const z = point.z;
    const root = Math.sqrt(s);
    const floorY = sunFloor(x, z);
    const base = y - floorY < 1.4 * s;
    flashLight({ x, y: y + 0.4, z }, 0xffd060, 320 * s, 10 + 9 * s, 0.08);
    flashLight({ x, y: y + 0.4, z }, 0xff4020, 55 * s, 8 + 6 * s, 0.45);

    const fy = y + 0.35 * s;
    emitGlow(x, fy, z, 0.055, 1.5 * s, 2.3 * s, 16, 13.5, 9.5, 0);
    emitGlow(x, fy, z, 0.05, 2.6 * s, 4.2 * s, 7, 5, 2.4, 2 + ((rnd() * 2) | 0));
    emitGlow(x, fy, z, 0.06, 2.6 * s, 4.2 * s, 3.5, 2.4, 1.1, 5);
    emitGlow(x, fy, z, 0.08, 1.8 * s, 3.4 * s, 2.6, 1.8, 0.8, 0);
    // 火球翻页
    for (let i = 0; i < 8; i += 1) {
      randAround(0, 1, 0, 0.7, _sA);
      const gi = add.emit(
        x + _sA.x * 0.3 * s, y + 0.35 * s + _sA.y * 0.3 * s, z + _sA.z * 0.3 * s,
        _sA.x * 1.4 * root, 0.8 + _sA.y * 1.4 * root, _sA.z * 1.4 * root,
        0.5 + rnd() * 0.45, 0.8 * s, 0.25 * s
      );
      if (gi >= 0) {
        add.frame[gi] = 5;
        add.ramp[gi] = 2;
        add.r[gi] = 9; add.g[gi] = 5.5; add.b[gi] = 2.2;
        add.drag[gi] = 1;
        add.rot[gi] = rnd() * TAU;
        add.rotv[gi] = (rnd() - 0.5) * 3;
        add.fout[gi] = 0.45;
        add.turb[gi] = 1.5;
      }
    }
    // 烟
    for (let i = 0; i < 8; i += 1) {
      const shade = i < 3 ? 3 : 1;
      emitLit(
        x + (rnd() - 0.5) * 0.7 * s, y + (0.2 + rnd() * 0.9) * s, z + (rnd() - 0.5) * 0.7 * s,
        (rnd() - 0.5) * 1.2, 1.2 + rnd() * 1.6, (rnd() - 0.5) * 1.2,
        1.6 + rnd() * 1.8, 0.4 * s, (1.4 + rnd() * 0.9) * s,
        shade === 3 ? 0.1 : 0.16, shade === 3 ? 0.09 : 0.15, shade === 3 ? 0.08 : 0.15,
        0.55, shade, 0.9, 0.8, 1, -1
      );
    }
    burst({ x, y: y + 0.2 * s, z }, { x: 0, y: 1, z: 0 }, Math.round(20 * root), 6, 22, 0.5, 0.12, 0.5, 40, 25, 9, 0);
    chunkBurst({ x, y: y + 0.2 * s, z }, { x: 0, y: 1, z: 0 }, Math.round(8 * s), 3, 8, 0.05, 0.14, 0.02, 0.05, 0.35, 0.32, 0.3, 1, base ? floorY : -50);
    emitRing(x, y + 0.01, z, 1.1, 0.5 * s, 3 * s, 0.5 * s + 0.1, 0.4 * s + 0.1, 0.3 * s + 0.1, 0, 1, 0);
    emitRing(x, y + 0.01, z, 1.6, 0.3 * s, 4.5 * s, 0.25 * s + 0.05, 0.2 * s + 0.05, 0.15 * s + 0.05, 0, 1, 0);
    // 地面薄烟圈
    for (let i = 0; i < 6; i += 1) {
      randAround(0, 1, 0, 1, _sA);
      emitLit(
        x + _sA.x * 0.5 * s, y + 0.12, z + _sA.z * 0.5 * s,
        _sA.x * 1.6, 0.3, _sA.z * 1.6,
        1.4 + rnd() * 1.2, 0.5 * s, (1.6 + rnd() * 1.2) * s,
        0.18, 0.17, 0.16, 0.35, 1, 1.2, 0.2, 1, -1
      );
    }
    return true;
  }

  function shell(pos, vel) {
    const vx = vel ? vel.x : (rnd() - 0.5) * 2;
    const vy = vel ? vel.y : 1.5 + rnd() * 1.5;
    const vz = vel ? vel.z : (rnd() - 0.5) * 2;
    return shells.add(pos.x, pos.y, pos.z, vx, vy, vz);
  }

  function debrisBurst(point, o = EMPTY) {
    let count = 6;
    let size = 0.06;
    let speed = 5;
    let cr = 0.4;
    let cg = 0.39;
    let cb = 0.37;
    if (o.color !== undefined) {
      cr = colorR(o.color, 0.4);
      cg = colorG(o.color, 0.4);
      cb = colorB(o.color, 0.4);
    }
    if (o.count !== undefined) count = Math.min(o.count, 40);
    if (o.size !== undefined) size = o.size;
    if (o.speed !== undefined) speed = o.speed;
    let nx = o.normal ? o.normal.x : 0;
    let ny = o.normal ? o.normal.y : 1;
    let nz = o.normal ? o.normal.z : 0;
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const floorY = sunFloor(point.x, point.z);
    chunkBurst(
      point, { x: nx, y: ny, z: nz }, count,
      speed * 0.4, speed * 1.3,
      size * 0.4, size * 1.2,
      size * 0.3, size * 0.9,
      cr, cg, cb, o.spread === undefined ? 1 : o.spread,
      floorY
    );
    return count;
  }

  function decal(point, normal, surface = "bullet_concrete", o = EMPTY) {
    const scale = typeof o === "number" ? o : o.scale;
    const tint = typeof o === "number" ? 1 : o.tint === undefined ? 1 : o.tint;
    const alpha = typeof o === "number" ? 1 : o.alpha === undefined ? 1 : o.alpha;
    return decals.add(point, normal, surface, scale, tint, alpha);
  }

  /* ---- 颜色接受 number / [r,g,b] / {r,g,b} / THREE.Color ---- */
  function colorR(c, d) {
    if (c == null) return d;
    if (typeof c === "number") return ((c >> 16) & 255) / 255;
    if (Array.isArray(c)) return c[0];
    if (c.r !== undefined) return c.r;
    return d;
  }
  function colorG(c, d) {
    if (c == null) return d;
    if (typeof c === "number") return ((c >> 8) & 255) / 255;
    if (Array.isArray(c)) return c[1];
    if (c.g !== undefined) return c.g;
    return d;
  }
  function colorB(c, d) {
    if (c == null) return d;
    if (typeof c === "number") return (c & 255) / 255;
    if (Array.isArray(c)) return c[2];
    if (c.b !== undefined) return c.b;
    return d;
  }

  /* ---- 每帧推进 ---- */
  function update(dt) {
    if (!(dt > 0)) dt = 0;
    time += dt;
    updateEmitters(dt);

    const cx = camera ? camera.position.x : 0;
    const cy = camera ? camera.position.y : 0;
    const cz = camera ? camera.position.z : 0;

    litTarget.begin();
    lit.update(dt, litTarget, cx, cy, cz, wind.x, wind.y, wind.z, time);
    litTarget.end();

    addTarget.begin();
    add.update(dt, addTarget, cx, cy, cz, wind.x, wind.y, wind.z, time);
    tracers.update(dt, addTarget, 7);
    addTarget.end();

    if (THREE) {
      debris.update(dt, _m4, _axis3, _q4, _v3, _s3);
      shells.update(dt, _m4, _q4, _v3, _s3, _onShellBounce);
    } else {
      debris.update(dt, null, null, null, null, null);
      shells.update(dt, null, null, null, null, _onShellBounce);
    }
  }

  function clear() {
    lit.clear();
    add.clear();
    tracers.clear();
    debris.clear();
    shells.clear();
    decals.clear();
    litTarget.clear();
    addTarget.clear();
    for (let i = 0; i < emitters.length; i += 1) {
      if (emitters[i].active) emitters[i].stop();
    }
    activeEmitters = 0;
    time = 0;
  }

  function setCamera(cam) {
    camera = cam || null;
  }

  function setDepthTexture(tex, o) {
    for (let i = 0; i < billboards.length; i += 1) billboards[i].setDepthTexture(tex, o);
  }

  function stats() {
    let drawCalls = FX_DRAW_CALLS;
    if (root) drawCalls = root.children.length;
    // 实测（不是声明）：已实现的效果入口数 / billboard 池数
    let kinds = 0;
    for (let i = 0; i < FX_KINDS.length; i += 1) {
      if (typeof api[FX_KINDS[i]] === "function") kinds += 1;
    }
    return {
      // 上游同名口径
      lit: lit.n,
      add: addTarget.n,
      tracers: tracers.n,
      debris: debris.live,
      shells: shells.live,
      decals: decals.count,
      emitters: activeEmitters,
      drawCalls,
      // 对账门禁口径（harness/element-manifest.json → fx）
      fxKinds: kinds,
      fxPools: billboards.length,
      drawCallsBudget: FX_DRAW_CALLS,
      drawCallsOk: drawCalls <= FX_DRAW_CALLS,
      caps: {
        lit: litCap,
        add: addCap,
        tracers: FX_POOL_SPEC.tracers,
        debris: FX_POOL_SPEC.debris,
        shells: FX_POOL_SPEC.shells,
        decals: FX_POOL_SPEC.decals,
        emitters: FX_POOL_SPEC.emitters,
      },
      time,
    };
  }

  const api = {
    muzzleFlash,
    tracer,
    impact,
    sparks,
    smoke,
    dust,
    explosion,
    shell,
    splash,
    debris: debrisBurst,
    decal,
    addEmitter,
    update,
    clear,
    setCamera,
    setDepthTexture,
    stats,
    wind,
    root,
    // 供展厅/调试直接摸池（只读用途）
    pools: { litTarget, addTarget, debris, shells, decals, tracers },
  };

  return api;
}

/* ============================== 自检 ============================== */

/**
 * 模块级自检（node 可跑，无 THREE / 无 DOM）：池容量与预算、11 个效果入口、
 * 一轮 emit + update 后各类池的真实计数、同种子逐位一致。
 * 返回 { ok, problems, ...counts }。
 */
export function selfTest() {
  const problems = [];
  if (FX_KINDS.length !== 11) problems.push("FX_KINDS != 11: " + FX_KINDS.length);
  if (FX_DRAW_CALLS !== 5) problems.push("FX_DRAW_CALLS != 5: " + FX_DRAW_CALLS);
  if (FX_POOL_SPEC.lit !== 1400 || FX_POOL_SPEC.add !== 3040) problems.push("billboard pool spec drifted");
  if (FX_POOL_SPEC.emitters !== 24) problems.push("emitter pool != 24");
  const makeRng = () => mulberry32(9173);
  const run = () => {
    const kit = createFxKit({ rng: makeRng(), seed: 9173 });
    const missing = FX_KINDS.filter((name) => typeof kit[name] !== "function");
    if (missing.length) return { kit, missing };
    const p = { x: 0, y: 0, z: 0 };
    const up = { x: 0, y: 1, z: 0 };
    kit.muzzleFlash(p, { x: 0, y: 0, z: -1 });
    kit.tracer(p, { x: 10, y: 1, z: 0 });
    kit.impact(p, up, "bullet_metal");
    kit.sparks(p, up, 6);
    kit.smoke(p);
    kit.dust(p, up);
    kit.explosion(p);
    kit.shell({ x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 });
    kit.splash(p);
    kit.debris(p);
    kit.decal(p, up, "bullet_metal");
    kit.addEmitter(p, "steam");
    for (let i = 0; i < 5; i += 1) kit.update(1 / 60);
    return { kit, missing };
  };
  const a = run();
  const b = run();
  if (a.missing.length) problems.push("missing effect API: " + a.missing.join(", "));
  if (a.missing.length === 0) {
    const st = a.kit.stats();
    if (st.fxKinds !== FX_KINDS.length) problems.push("fxKinds != FX_KINDS.length");
    if (st.fxPools !== 2) problems.push("fxPools != 2");
    if (st.drawCalls !== FX_DRAW_CALLS) problems.push("no-THREE drawCalls != budget");
    if (st.caps.lit !== FX_POOL_SPEC.lit || st.caps.add !== FX_POOL_SPEC.add) problems.push("stats caps drifted");
    if (!(st.lit > 0 && st.add > 0)) problems.push("billboard pools emitted nothing");
    if (!(st.debris > 0 && st.shells > 0 && st.decals > 0)) problems.push("ring pools emitted nothing");
    if (!(st.emitters >= 1)) problems.push("addEmitter did not activate an emitter");
    if (JSON.stringify(st) !== JSON.stringify(b.kit.stats())) problems.push("same seed is not deterministic");
    return {
      ok: problems.length === 0,
      problems,
      fxKinds: st.fxKinds,
      fxPools: st.fxPools,
      drawCalls: st.drawCalls,
      lit: st.lit,
      add: st.add,
      debris: st.debris,
      shells: st.shells,
      decals: st.decals,
      emitters: st.emitters,
    };
  }
  return { ok: false, problems, fxKinds: 0, fxPools: 0, drawCalls: 0, lit: 0, add: 0, debris: 0, shells: 0, decals: 0, emitters: 0 };
}
