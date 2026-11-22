/**
 * quality/src/noise.mjs — 共享噪声纹理 + JS 侧确定性噪声/做旧/排版工具。
 * 上游对应：共享 256² RGBA 噪声纹理 [src:L30121 邻域]、tileable 值噪声 Ab/fs [src:L44338]、
 * 做旧四 pass Ks [src:L33102]、排版 qa [src:L33116]。JS 工具层为等价重写，公式保持一致。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.seededRng = function seededRng(seed) {
  let t = seed >>> 0;
  return () => {
    t |= 0; t = (t + 1831565813) | 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
};

H2B.makeNoiseTexture = function makeNoiseTexture(THREE, seed = 4207) {
  const rng = H2B.seededRng(seed);
  const data = new Uint8Array(256 * 256 * 4);
  for (let i = 0; i < data.length; i += 1) data[i] = (rng() * 256) | 0;
  const tex = new THREE.DataTexture(data, 256, 256, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
};

/* ---- JS 侧 tileable 值噪声（等价上游 Ab/fs：hash 晶格 + smoothstep 插值 + fbm）---- */
(function () {
  function hash2(xi, yi, seed) {
    let h = Math.imul(xi, 374761393) ^ Math.imul(yi, 668265263) ^ Math.imul(seed, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function valueNoise(x, y, seed, period) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    let x0 = xi, x1 = xi + 1, y0 = yi, y1 = yi + 1;
    if (period) {
      x0 = ((x0 % period) + period) % period; x1 = ((x1 % period) + period) % period;
      y0 = ((y0 % period) + period) % period; y1 = ((y1 % period) + period) % period;
    }
    const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed);
    const c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  }
  /** fbm：x/y 为世界坐标，period 为基频平铺周期（与上游 fs 一致的升频权重） */
  H2B.fbm = function fbm(x, y, seed, octaves = 4, period = 0) {
    let sum = 0, amp = 0.5, norm = 0, fx = x, fy = y, fp = period;
    for (let i = 0; i < octaves; i += 1) {
      sum += amp * valueNoise(fx, fy, seed + i * 17, fp || 0);
      norm += amp; fx *= 2; fy *= 2; fp *= 2; amp *= 0.5;
    }
    return sum / norm;
  };
  H2B.clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  H2B.smoothstep = (a, b, t) => {
    const n = H2B.clamp01((t - a) / (b - a));
    return n * n * (3 - 2 * n);
  };
})();

/* ---- Canvas 做旧（等价上游 Ks 四 pass：漆皮抠破→划痕→噪点→软污渍）---- */
H2B.ageCanvas = function ageCanvas(ctx, w, h, amount, rng) {
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  // 1) 漆皮剥落：幂律小孔多、大孔少
  const holes = Math.floor((amount * w * h) / 700);
  for (let i = 0; i < holes; i += 1) {
    const r = Math.pow(rng(), 3) * h * 0.09 + 0.6;
    ctx.globalAlpha = 0.45 + rng() * 0.55;
    ctx.beginPath();
    const cx = rng() * w, cy = rng() * h;
    for (let k = 0; k < 7; k += 1) {
      const a = (k / 7) * Math.PI * 2;
      const rr = r * (1 - 0.5 + rng() * 1.0);
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath(); ctx.fill();
  }
  // 2) 方向一致的细划痕
  ctx.lineCap = "round";
  for (let i = 0; i < amount * 16; i += 1) {
    const x = rng() * w, y = rng() * h, a = (rng() - 0.5) * 0.7, len = (0.1 + rng() * 0.5) * w;
    ctx.globalAlpha = 0.5 + rng() * 0.5;
    ctx.lineWidth = 0.5 + rng() * rng() * 3;
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke();
  }
  // 3) 噪点
  ctx.globalAlpha = 0.8;
  for (let i = 0; i < (amount * w * h) / 60; i += 1) ctx.fillRect(rng() * w, rng() * h, 1 + rng(), 1 + rng());
  // 4) 软污渍
  for (let i = 0; i < amount * 6; i += 1) {
    const x = rng() * w, y = rng() * h, r = (0.1 + rng() * 0.25) * h;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(0,0,0," + (0.25 + rng() * 0.4) + ")");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = 1; ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
};

/* ---- 排版（等价上游 qa/a3：逐字排版 + 字距 + 连笔桥 + 超宽缩放）---- */
H2B.layoutText = function layoutText(ctx, text, x, y, size, fill, opts = {}) {
  const font = opts.font || '"PingFang SC", Impact, sans-serif';
  const weight = opts.weight || 700;
  const spacing = opts.spacing !== undefined ? opts.spacing : size * 0.06;
  ctx.font = `${weight} ${size}px ${font}`;
  let total = 0;
  for (const ch of text) total += ctx.measureText(ch).width + spacing;
  total -= spacing;
  const squeeze = opts.maxW && total > opts.maxW ? opts.maxW / total : 1;
  let cursor = 4 / squeeze;
  const baseline = size * 1.08;
  const bridges = opts.bridges !== false;
  for (const ch of text) {
    const wch = ctx.measureText(ch).width;
    ctx.fillText(ch, cursor, baseline);
    if (bridges && !/^[ 1I.\-\/:,'!.·]$/.test(ch)) {
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillRect(cursor + wch * 0.5 - size * 0.032, 0, size * 0.064, size * 1.4);
      ctx.restore();
    }
    cursor += wch + spacing;
  }
  return total * squeeze;
};
