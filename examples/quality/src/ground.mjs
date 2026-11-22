/**
 * quality/src/ground.mjs — 湿地材质（上游 apron 系统原样移植）+ 平面反射管理器。
 *
 * GLSL 三段原样取自上游捕获（evidence/frames/app.pretty.js）：
 *   TR 声明段（含 gRipple/gBicubic）[src:L44697-L44738]
 *   AR 地表段（水洼/浸泡/潮带/裂缝/接缝/标线/粗糙度/法线）[src:L44739-L44850]
 *   RR 反射段 = assets/ssr-wet.glsl 的 SSR_WET_RR 块（build.mjs 按 BEGIN/END 标记切块注入
 *   `H2B.ssrWetRR`；lodD/lodP 粗糙度 LOD）——场景内不保留内嵌副本，防止改数学不同步。
 * 纹理生成（mask/detail/detailN/marks）为上游 Rb/Cb/Pb 的等价重写：
 *   mask 通道 r=微高度(水位) g=干燥 b=油污 a=磨损 [src:L44405-L44434]
 *   detail/detailN [src:L44436-L44473]；marks 画布标线 [src:L44488 起]
 * 平面反射 = 镜面相机 + 斜截头体裁剪（上游 zb）[src:L44930-L45020]。
 */
globalThis.H2B = globalThis.H2B || {};

(function () {
  const MASK_RECT = { x0: -45, z0: -35, size: 90 };   // 例场景标定：90×70 场地
  // 水洼盆（例场景标定；上游为 Saltline 堆场点位）[x, z, rx, rz, depth]
  const BASINS = [
    [-16, 4, 6.5, 3.2, 0.22], [-4, -12, 4.5, 4.0, 0.18],
    [12, 8, 5.5, 2.6, 0.20], [22, -6, 3.5, 3.5, 0.15],
    [0, 18, 7.5, 2.4, 0.17], [30, 14, 2.8, 2.2, 0.12],
  ];

  function makeGroundMask(size) {
    const R = MASK_RECT, data = new Uint8Array(size * size * 4);
    const waterLevel = 0.385, edgeWear = 0.02;
    for (let r = 0; r < size; r += 1) {
      const z = R.z0 + ((r + 0.5) / size) * 70;
      for (let c = 0; c < size; c += 1) {
        const x = R.x0 + ((c + 0.5) / size) * 90;
        const i = (r * size + c) * 4;
        // 大尺度微地形 + 盆地凹陷
        let h = 0.5 + (H2B.fbm(x / 8.5, z / 8.5, 11, 4) - 0.47) * 0.3
          + (H2B.fbm(x / 2.4, z / 2.4, 23, 3) - 0.5) * 0.14;
        for (const b of BASINS) {
          const dx = (x - b[0]) / (b[2] * 1.6), dz = (z - b[1]) / (b[3] * 1.6);
          const q = dx * dx + dz * dz;
          if (q < 9) h -= (b[4] + edgeWear) * Math.exp(-q * q);
        }
        // 场地边缘略低洼聚水
        h -= H2B.smoothstep(28, 45, Math.abs(x)) * 0.08;
        data[i] = Math.round(H2B.clamp01(0.5 + (h - waterLevel) * 2.5) * 255);
        data[i + 1] = Math.round(H2B.clamp01(
          0.5 + (H2B.fbm(x / 5.5, z / 5.5, 41, 3) - 0.5) * 1.5 + (0.5 - h) * 0.9) * 255);
        const oil = H2B.smoothstep(0.6, 0.78, H2B.fbm(x / 1.4, z / 1.4, 77, 4))
          * H2B.smoothstep(0.47, 0.62, H2B.fbm(x / 9, z / 9, 91, 2));
        data[i + 2] = Math.round(oil * 255);
        data[i + 3] = Math.round(H2B.clamp01(
          H2B.fbm(x / 22, z / 0.9, 57, 3) * 0.6 + H2B.fbm(x / 13, z / 13, 63, 3) * 0.4) * 255);
      }
    }
    return data;
  }

  function makeDetailPair(size) {
    const det = new Uint8Array(size * size * 4);
    const nrm = new Uint8Array(size * size * 4);
    const h0 = new Float32Array(size * size), h1 = new Float32Array(size * size);
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        const u = c / size, v = r / size, i = r * size + c;
        const grain = H2B.fbm(u * 96, v * 96, 3, 2, 96) * 0.6 + H2B.fbm(u * 40, v * 40, 9, 2, 40) * 0.4;
        const wear = H2B.fbm(u * 6, v * 6, 21, 4, 6);
        const jx = (H2B.fbm(u * 8, v * 8, 31, 2, 8) - 0.5) * 0.25;
        const jz = (H2B.fbm(u * 8, v * 8, 37, 2, 8) - 0.5) * 0.25;
        const crack = 1 - Math.abs(2 * H2B.fbm((u + jx) * 5, (v + jz) * 5, 43, 3, 5) - 1);
        const agg = H2B.fbm(u * 28, v * 28, 51, 3, 28);
        det[i * 4] = Math.round(H2B.clamp01(grain) * 255);
        det[i * 4 + 1] = Math.round(H2B.clamp01(wear) * 255);
        det[i * 4 + 2] = Math.round(H2B.clamp01(crack) * 255);
        det[i * 4 + 3] = Math.round(H2B.clamp01(agg) * 255);
        h0[i] = grain;
        h1[i] = H2B.fbm(u * 9, v * 9, 71, 4, 9);
      }
    }
    const wrap = (n) => (n + size) % size;
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        const i = r * size + c;
        const gx = (h0[r * size + wrap(c + 1)] - h0[r * size + wrap(c - 1)]) * 2.2;
        const gz = (h0[wrap(r + 1) * size + c] - h0[wrap(r - 1) * size + c]) * 2.2;
        const fx = (h1[r * size + wrap(c + 2)] - h1[r * size + wrap(c - 2)]) * 9;
        const fz = (h1[wrap(r + 2) * size + c] - h1[wrap(r - 2) * size + c]) * 9;
        nrm[i * 4] = Math.round(H2B.clamp01(0.5 - gx) * 255);
        nrm[i * 4 + 1] = Math.round(H2B.clamp01(0.5 - gz) * 255);
        nrm[i * 4 + 2] = Math.round(H2B.clamp01(0.5 - fx) * 255);
        nrm[i * 4 + 3] = Math.round(H2B.clamp01(0.5 - fz) * 255);
      }
    }
    return { det, nrm };
  }

  function makeMarksCanvas(THREE, seed) {
    const S = 512;
    const canvas = document.createElement("canvas");
    canvas.width = S; canvas.height = S;
    const ctx = canvas.getContext("2d");
    const rng = H2B.seededRng(seed);
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, S, S);
    // 世界区域映射：矩形 90×70 → 512²；画几条磨损车道线/停机线
    const W = 90, H = 70, s = S / W, t = S / H;
    const wx = (x) => (x + 45) * s, wz = (z) => (z + 35) * t;
    ctx.save(); ctx.globalAlpha = 1;
    for (let k = 0; k < 3; k += 1) {
      const x = -30 + k * 22;
      ctx.strokeStyle = "#ff0000"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(wx(x), wz(-28)); ctx.lineTo(wx(x), wz(26)); ctx.stroke();
    }
    ctx.strokeStyle = "#00ff00"; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(wx(-38), wz(-18)); ctx.lineTo(wx(38), wz(-18)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(wx(-38), wz(22)); ctx.lineTo(wx(38), wz(22)); ctx.stroke();
    ctx.font = '900 46px "PingFang SC", Impact, sans-serif';
    ctx.fillStyle = "#00ff00";
    ctx.fillText("堆 场 3", wx(-34), wz(2));
    ctx.restore();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = 4;
    H2B.ageCanvas(ctx, S, S, 1.6, rng);
    tex.needsUpdate = true;
    return { texture: tex, res: S };
  }

  /* ---- 上游 TR/AR 两段 GLSL（原样内嵌）；RR 段从 assets/ssr-wet.glsl 切块注入 ---- */
  const TR_DECL = `
uniform float uTime, uRain, uWetG, uReflOn, uReflLod, uMarkRes, uMaskRes;
uniform sampler2D uMask, uMarks, uDetail, uDetailN, uRefl;
uniform vec3 uMaskRect; uniform vec4 uMarkRect; uniform mat4 uReflMatrix; uniform vec2 uReflScale;
varying vec3 vGWorld;
float gRough; vec2 gNxz; float gPuddle; float gWet; float gFilm; float gSoak;
vec3 gHash3(vec2 p){ vec3 q = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.xxy + q.yzz) * q.zyx); }
float gH1(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float gVN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gH1(i), gH1(i + vec2(1.0, 0.0)), f.x), mix(gH1(i + vec2(0.0, 1.0)), gH1(i + vec2(1.0, 1.0)), f.x), f.y); }
vec4 gBicubic(sampler2D t, vec2 uv, float res){
  vec2 p = uv * res - 0.5; vec2 i = floor(p); vec2 f = p - i; vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0, w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0, w3 = f3 / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 h0 = (i + w1 / g0 - 0.5) / res, h1 = (i + w3 / g1 + 1.5) / res;
  return (textureLod(t, vec2(h0.x, h0.y), 0.0) * g0.x + textureLod(t, vec2(h1.x, h0.y), 0.0) * g1.x) * g0.y
       + (textureLod(t, vec2(h0.x, h1.y), 0.0) * g0.x + textureLod(t, vec2(h1.x, h1.y), 0.0) * g1.x) * g1.y;
}
vec2 gRipple(vec2 p, float t, float cell, float seed){
  vec2 q = p / cell + seed * 17.3; vec2 id = floor(q); vec2 f = fract(q);
  vec3 h0 = gHash3(id + seed);
  float tt = t * (0.5 + 0.55 * h0.x) + h0.y * 9.0;
  float cyc = floor(tt), life = fract(tt);
  vec3 h = gHash3(id + seed + cyc * 7.31);
  vec3 hc = gHash3(id.yx + cyc * 3.71 + seed * 5.0);
  float on = step(h.z, 0.16 + 0.5 * uRain);
  float rmax = mix(0.1, 0.36, h.x * h.x);
  vec2 c = mix(vec2(rmax + 0.05), vec2(0.95 - rmax), hc.xy);
  vec2 dv = (f - c) * cell; float d = length(dv);
  float r = life * rmax * cell;
  float w = 0.005 + 0.02 * life;
  float x = (d - r) / w;
  float ring = x * exp(-x * x) * 2.3;
  float amp = 1.0 - life; amp = amp * amp * on * mix(0.3, 1.0, h.y) * smoothstep(0.0, 0.06, life);
  return (dv / max(d, 1e-4)) * ring * amp;
}
`;

  const AR_BODY = `
{
  vec2 gxz = vGWorld.xz;
  float gDist = length(cameraPosition - vGWorld);
  vec2 muv = (gxz - uMaskRect.xy) * uMaskRect.z;
  float mIn = smoothstep(0.0, 0.05, min(min(muv.x, 1.0 - muv.x), min(muv.y, 1.0 - muv.y)));
  vec4 mk = mix(vec4(0.66, 0.5, 0.0, 0.5), gBicubic(uMask, muv, uMaskRes), mIn);
  vec4 d1 = texture2D(uDetail, gxz * 0.21);
  vec4 d2 = texture2D(uDetail, gxz * 1.37 + 0.37);
  vec4 n1 = texture2D(uDetailN, gxz * 1.37 + 0.37);
  vec4 n0 = texture2D(uDetailN, gxz * 0.21);
  float grain = d2.r;
  // 6m 伸缩缝 + 灌缝焦油
  vec2 sj = gxz / 6.0;
  vec2 sf = (0.5 - abs(fract(sj) - 0.5)) * 6.0;
  float jd = min(sf.x, sf.y) + (d1.a - 0.5) * 0.035;
  float jaa = fwidth(jd) + 1e-5;
  float tarW = 0.022 + 0.03 * d1.g;
  float tar = (1.0 - smoothstep(tarW - jaa, tarW + jaa, jd)) * clamp(tarW / jaa, 0.0, 1.0);
  float groove = (1.0 - smoothstep(0.004, 0.012 + jaa, jd)) * clamp(0.02 / jaa, 0.0, 1.0);
  vec2 sid = floor(sj);
  float sh = fract(sin(dot(sid, vec2(127.1, 311.7))) * 43758.5453);
  float sh2 = fract(sh * 7.31 + 0.13);
  float crArea = smoothstep(0.6, 0.76, mk.a * 0.7 + sh * 0.45);
  float cfw = fwidth(d1.b) * 1.5 + 0.004;
  float crack = smoothstep(0.955 - cfw, 0.975, d1.b) * crArea;
  float seal = smoothstep(0.915 - cfw, 0.94, d1.b) * crArea * step(0.72, sh2);
  vec3 alb = vec3(0.125, 0.125, 0.13);
  alb *= (0.8 + 0.4 * sh2) * (0.8 + 0.4 * d1.g) * (0.62 + 0.76 * grain);
  alb += vec3(0.11, 0.105, 0.095) * smoothstep(0.58, 0.78, d2.a);
  float polish = smoothstep(0.38, 0.72, mk.a);
  alb *= mix(1.0, 0.78, polish);
  alb = mix(alb, vec3(0.018, 0.018, 0.02), max(max(tar, seal * 0.4) * 0.94, crack * 0.9));
  alb *= 1.0 - 0.62 * mk.b;
  // 画布标线（磨损 + 剥落）
  vec2 kuv = (gxz - uMarkRect.xy) * uMarkRect.zw;
  float kIn = step(0.0, kuv.x) * step(kuv.x, 1.0) * step(0.0, kuv.y) * step(kuv.y, 1.0);
  vec3 mp = texture2D(uMarks, kuv).rgb;
  float kpx = max(fwidth(kuv.x), fwidth(kuv.y)) * uMarkRes;
  if (kpx < 1.0) mp = mix(gBicubic(uMarks, kuv, uMarkRes).rgb, mp, smoothstep(0.5, 1.0, kpx));
  mp *= kIn;
  float kw = clamp(kpx * 0.5, 0.16, 0.5);
  float chipN = 0.5;
  if (max(mp.r, mp.g) > 0.02) {
    float cf2 = 1.0 - smoothstep(6.0, 18.0, gDist), cf3 = 1.0 - smoothstep(2.5, 7.0, gDist);
    chipN = gVN(gxz * 17.0) * 0.45 + mix(0.5, gVN(gxz * 57.0 + 11.0), cf2) * 0.33 + mix(0.5, gVN(gxz * 181.0 + 5.0), cf3) * 0.22;
  }
  float chip = chipN * 0.62 + d1.a * 0.38;
  float wear = clamp(mk.a * 1.25 - 0.22 + mp.b * 0.6, 0.0, 1.0);
  float wt = mix(0.24, 0.55, wear);
  float keep = smoothstep(wt - 0.045, wt + 0.045, chip) * (1.0 - max(tar, crack));
  float eN = (chipN - 0.5) * 0.55 * (1.0 - kw * 2.0);
  float pY = smoothstep(0.5 - kw, 0.5 + kw, mp.r + eN) * keep;
  float pW = smoothstep(0.5 - kw, 0.5 + kw, mp.g + eN) * keep;
  alb *= 1.0 - 0.6 * mp.b;
  float fade = 0.72 + 0.28 * d1.g;
  alb = mix(alb, vec3(0.52, 0.34, 0.035) * fade, pY * 0.94);
  alb = mix(alb, vec3(0.47, 0.47, 0.44) * fade, pW * 0.94);
  float paint = max(pY, pW);
  // 水：积水→浸泡带→潮带→干燥 连续梯度
  float sf2 = 1.0 - smoothstep(25.0, 60.0, gDist), sf3 = 1.0 - smoothstep(8.0, 22.0, gDist);
  float sn1 = gVN(gxz * 2.5 + 3.0), sn2 = mix(0.5, gVN(gxz * 6.7 + 17.0), sf2), sn3 = mix(0.5, gVN(gxz * 20.0 + 9.0), sf3);
  float sn = sn1 * 0.5 + sn2 * 0.3 + sn3 * 0.2;
  float depth = 0.5 - mk.r + (sn - 0.5) * 0.11 + (d1.g - 0.5) * 0.03 + (grain - 0.5) * 0.012 + groove * 0.04 + crack * 0.02 - paint * 0.01;
  float puddle = smoothstep(0.0, 0.035, depth) * uWetG;
  float deep = smoothstep(0.0, 0.22, depth);
  float bandW = 0.05 + 0.15 * sn1 * sn1 + 0.05 * d1.g;
  float soak = smoothstep(-bandW, 0.0, depth) * uWetG;
  float fringe = smoothstep(-0.65, -0.02, depth);
  float dryP = 1.0 - smoothstep(0.2, 0.42, mk.g + fringe * 0.55 + (d1.g - 0.5) * 0.25 + (sn - 0.5) * 0.12);
  float damp = (1.0 - dryP) * uWetG;
  float wet = clamp(damp * 0.7 + soak * 0.3, 0.0, 1.0);
  float film = clamp(soak * (1.0 - smoothstep(0.35, 0.95, grain + (1.0 - soak) * 0.6)) + groove * 0.5, 0.0, 1.0) * (1.0 - paint * 0.4);
  alb *= mix(0.95, mix(0.7, 0.54, 1.0 - paint), damp);
  alb *= mix(1.0, 0.5, soak);
  alb = mix(alb, alb * mix(0.85, 0.4, deep) + vec3(0.004, 0.006, 0.0065) * deep, puddle);
  diffuseColor.rgb *= alb;
  // 粗糙度梯度：干 0.74 → 潮 0.42 → 浸 0.2 → 水 0.055
  float rough = mix(0.74, 0.42, damp) + (grain - 0.5) * 0.24 + (d1.g - 0.5) * 0.16 - paint * 0.05;
  rough -= polish * 0.07 + mk.b * 0.16 + max(tar, seal) * 0.1;
  rough = mix(rough, 0.2 + (grain - 0.5) * 0.14, soak * 0.9);
  rough = mix(rough, 0.13, film * 0.8);
  rough += smoothstep(10.0, 80.0, gDist) * 0.04;
  rough = mix(clamp(rough, 0.1, 1.0), 0.055, puddle);
  // 法线：骨料颗粒 + 水面涟漪
  vec2 nxz = (n1.rg - 0.5) * mix(2.1, 0.7, max(film, soak * 0.6)) + (n0.ba - 0.5) * 0.3;
  nxz *= 1.0 - puddle;
  float wsum = puddle + film * 0.2;
  vec2 wv = texture2D(uDetailN, gxz * 0.13 + uTime * vec2(0.031, 0.017)).ba - 0.5;
  vec2 wv2 = texture2D(uDetailN, gxz.yx * 0.31 - uTime * vec2(0.043, 0.027)).ba - 0.5;
  if (wsum > 0.004) {
    float rf = 1.0 - smoothstep(10.0, 34.0, gDist);
    vec2 rip = vec2(0.0);
    if (rf > 0.0) {
      vec2 gp2 = vec2(0.8 * gxz.x - 0.6 * gxz.y, 0.6 * gxz.x + 0.8 * gxz.y);
      vec2 r2 = gRipple(gp2, uTime * 0.87, 1.31, 2.0);
      rip = gRipple(gxz, uTime, 0.83, 1.0) + vec2(0.8 * r2.x + 0.6 * r2.y, -0.6 * r2.x + 0.8 * r2.y) * 0.9 + gRipple(gxz.yx, uTime * 1.13, 0.57, 3.0).yx * 0.6;
      rip *= rf * (0.3 + 0.7 * uRain) * 0.3 * smoothstep(0.0, 0.08, depth);
    }
    nxz += (rip + (wv * 0.03 + wv2 * 0.018) * (0.4 + 0.6 * deep)) * wsum;
    rough += (1.0 - rf) * 0.03 * puddle * uRain;
  }
  gSoak = soak;
  gRough = rough; gNxz = nxz; gPuddle = puddle; gWet = wet; gFilm = film;
}
`;

  H2B.createWetGround = function createWetGround(THREE, renderer, scene, camera, seed) {
    if (!H2B.ssrWetRR || !H2B.ssrWetRR.includes("uRefl")) {
      throw new Error("ground: assets/ssr-wet.glsl 的 SSR_WET_RR 块未注入——先跑 node examples/quality/build.mjs");
    }
    const maskSize = 256, detailSize = 256;
    const maskData = makeGroundMask(maskSize);
    const maskTex = new THREE.DataTexture(maskData, maskSize, maskSize, THREE.RGBAFormat);
    const { det, nrm } = makeDetailPair(detailSize);
    const detailTex = new THREE.DataTexture(det, detailSize, detailSize, THREE.RGBAFormat);
    const detailNTex = new THREE.DataTexture(nrm, detailSize, detailSize, THREE.RGBAFormat);
    for (const t of [maskTex, detailTex, detailNTex]) {
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = 4;
      t.needsUpdate = true;
    }
    detailTex.wrapS = detailTex.wrapT = THREE.RepeatWrapping;
    detailNTex.wrapS = detailNTex.wrapT = THREE.RepeatWrapping;
    const marks = makeMarksCanvas(THREE, seed);
    const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    black.needsUpdate = true;

    const uniforms = {
      uTime: { value: 0 }, uRain: { value: 0.55 }, uWetG: { value: 1 },
      uReflOn: { value: 0 }, uReflLod: { value: 0 },
      uMarkRes: { value: marks.res }, uMaskRes: { value: maskSize },
      uMask: { value: maskTex }, uMarks: { value: marks.texture },
      uDetail: { value: detailTex }, uDetailN: { value: detailNTex },
      uRefl: { value: black },
      uMaskRect: { value: new THREE.Vector3(MASK_RECT.x0, MASK_RECT.z0, 1 / MASK_RECT.size) },
      uMarkRect: { value: new THREE.Vector4(-45, -35, 1 / 90, 1 / 70) },
      uReflMatrix: { value: new THREE.Matrix4() },
      uReflScale: { value: new THREE.Vector2(0.5, 0.5) },
    };

    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    mat.name = "h2b-apron-wet";
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = "varying vec3 vGWorld;\n" + shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n  vGWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;"
      );
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\n" + TR_DECL)
        .replace("#include <map_fragment>", AR_BODY)
        .replace("#include <roughnessmap_fragment>", "float roughnessFactor = gRough;")
        .replace("#include <normal_fragment_maps>",
          "#include <normal_fragment_maps>\n  normal = normalize(mat3(viewMatrix) * normalize(vec3(-gNxz.x, 1.0, -gNxz.y)));")
        .replace("#include <lights_physical_fragment>",
          "#include <lights_physical_fragment>\n  material.specularColor = mix(material.specularColor, vec3(0.075), max(gPuddle, gSoak * 0.5));")
        .replace("#include <lights_fragment_maps>",
          "#include <lights_fragment_maps>\n" + H2B.ssrWetRR)
        .replace("#include <lights_fragment_end>",
          "#include <lights_fragment_end>\n  reflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(40.0));");
    };
    mat.customProgramCacheKey = () => "h2b-apron-wet-1";

    const geo = new THREE.PlaneGeometry(90, 70, 1, 1).rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = "h2b-apron";
    scene.add(mesh);

    /* ---- 平面反射（上游 zb：镜面相机 + 斜裁剪）---- */
    function createPlanarReflection() {
      const reflCam = new THREE.PerspectiveCamera();
      reflCam.layers.set(0);
      const rt = new THREE.WebGLRenderTarget(256, 256, {
        type: THREE.HalfFloatType, depthBuffer: true,
        minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true,
      });
      rt.texture.name = "h2b-planar-refl";
      const rot = new THREE.Matrix4();
      const camPos = new THREE.Vector3();
      const lookAt = new THREE.Vector3();
      const clipPlane = new THREE.Plane();
      const clipBias = new THREE.Vector4();
      const biasMat = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
      const hidden = [];
      let active = false;
      function pass(mainCam, planarScale, drawFn) {
        const scale = planarScale || 0;
        if (scale <= 0) { uniforms.uReflOn.value = 0; active = false; return; }
        camPos.setFromMatrixPosition(mainCam.matrixWorld);
        if (camPos.y < 0.05) { uniforms.uReflOn.value = 0; active = false; return; }
        const size = new THREE.Vector2();
        renderer.getDrawingBufferSize(size);
        const w = Math.max(64, Math.round((size.x * scale) / 16) * 16);
        const h = Math.max(32, Math.round((size.y * scale) / 8) * 8);
        if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
        rot.extractRotation(mainCam.matrixWorld);
        lookAt.set(0, 0, -1).applyMatrix4(rot).add(camPos);
        reflCam.position.set(camPos.x, -camPos.y, camPos.z);
        reflCam.up.set(0, 1, 0).applyMatrix4(rot);
        reflCam.up.y = -reflCam.up.y;
        lookAt.y = -lookAt.y;
        reflCam.lookAt(lookAt);
        reflCam.near = mainCam.near; reflCam.far = mainCam.far;
        reflCam.fov = mainCam.fov; reflCam.aspect = mainCam.aspect;
        reflCam.updateProjectionMatrix();
        reflCam.updateMatrixWorld(true);
        reflCam.matrixWorldInverse.copy(reflCam.matrixWorld).invert();
        uniforms.uReflMatrix.value.copy(biasMat).multiply(reflCam.projectionMatrix).multiply(reflCam.matrixWorldInverse);
        // 斜裁剪：反射相机近平面贴水面
        clipPlane.normal.set(0, 1, 0); clipPlane.constant = 0.01;
        clipPlane.applyMatrix4(reflCam.matrixWorldInverse);
        clipBias.set(clipPlane.normal.x, clipPlane.normal.y, clipPlane.normal.z, clipPlane.constant);
        const m = reflCam.projectionMatrix.elements;
        clipBias.multiplyScalar(2 / clipBias.dot(new THREE.Vector4(
          (Math.sign(clipBias.x) + m[8]) / m[0],
          (Math.sign(clipBias.y) + m[9]) / m[5],
          -1, (1 + m[10]) / m[14])));
        m[2] = clipBias.x; m[6] = clipBias.y; m[10] = clipBias.z + 1; m[14] = clipBias.w;
        reflCam.projectionMatrixInverse.copy(reflCam.projectionMatrix).invert();
        const pe = mainCam.projectionMatrix.elements;
        uniforms.uReflScale.value.set(pe[0] * 0.5, pe[5] * 0.5);
        uniforms.uReflLod.value = Math.log2(Math.max(h, 1) / 270);
        hidden.length = 0;
        mesh.visible = false;
        try { drawFn(reflCam, rt); } finally { mesh.visible = true; }
        uniforms.uRefl.value = rt.texture;
        uniforms.uReflOn.value = 1;
        active = true;
      }
      return { pass, get active() { return active; }, rt };
    }

    return {
      mesh, uniforms, createPlanarReflection,
      // 元素对账实测计数（complete.mjs 读 __PARITY__.counts）
      layers: 4,          // mask / detail / detailN / marks
      puddles: BASINS.length,
    };
  };
})();
