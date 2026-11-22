/**
 * weather-kit.mjs — 天气系统：instanced 雨条（9000 档 + 260 檐口滴水）+ 溅射（900 片）
 * + 4 室内盒 / 8 天窗矩形排除 + 22-55s 雷暴调度（驱动 sky-deck uFlash 与 post-chain uThunder）。
 * 只写这一层；不改任何其它资产。
 *
 * 出处（upstream sources/jimao-3a-game/index.html，6215 行；行号按 prettify 产物 [src:pretty] 规则）：
 *   - wInside 4 盒排除（uBoxMin[4]/uBoxMax[4]）+ wPhase HG 相位（g=0.72）：
 *     [src:pretty:L45243-L45250]
 *   - 雨条 shader kR（uVel 风 (-2.6,-9.4,1.1) 含下落速度、相机 wrap uBox 26×15×26、
 *     wSky 8 天窗矩形——雨从屋顶开口落进棚内、檐口滴水线 aSeed.w<0 自 7m 自由落体、
 *     密度 uRain 抽杀、y 地板裁剪 p.x>30 落海面 -1.6）+ FR 片元（横截面×纵向端帽）：
 *     [src:pretty:L45251-L45298]
 *   - 溅射 shader UR（uMask 积水采样 r≤0.49 判水、mask 矩形内才判、非水 70% 抽杀、
 *     相机 snap 4m 体积 30m、近玩家加密 rr*=.35+1.3|rr|、cyc 生命周期 0.26+.14z、
 *     室内盒抬高 0.2 排除、11-15m 远淡出）+ NR 片元（crown 冠形 + 核心亮点）：
 *     [src:pretty:L45299-L45344]
 *   - 种子缓冲 Fb（aSeed vec4 逐实例 rng 填充，滴水段 [i,i+e) seed.w=-1）：
 *     [src:pretty:L45345-L45358]
 *   - 工厂 Nb（quality 缩档 max(.15, rain||.5) [src:pretty:L45361-L45364]、9e3*n 雨条 / 260
 *     滴水 / 9e2*n 溅射、uVel=(-2.6,-9.4,1.1) / uBox=(26,15,26) [src:pretty:L45384-L45385]、
 *     uSunCol=sun*1.9、uAmb=fog*.15、renderOrder 900 [src:pretty:L45399-L45400] / 890
 *     [src:pretty:L45415-L45415]、frustumCulled=false、matrixAutoUpdate=false）：
 *     [src:pretty:L45359-L45415]
 *   - 状态机与 update（b/m 初值 0.6、首闪 A=22+rng*25 [src:pretty:L45416-L45418]；
 *     rain 以 0.8/s 逼近目标、visible=rain>0.01、uPix=2tan(fov/2)/h
 *     [src:pretty:L45433-L45441]、室内盒逐帧读 level.interiorBoxes 前 4 个
 *     （±0.15 外扩 / y -1/+0.3）[src:pretty:L45443-L45451]、uDrip=有盒即 1、
 *     uSky 前 8 个 (x,z,w*.5,(d||w)*.5) [src:pretty:L45452-L45456]、雷暴倒计时
 *     emit("thunder",{intensity:.3+.7rng}) 重装填 30+rng*30 [src:pretty:L45457-L45460]）
 *
 * 数量对齐（harness/element-manifest.json「weather」族 floor，references/11-element-parity.md#weather）：
 *   - rainStreaks ≥ 800（本 kit 上限对齐上游 9000，quality.rain 缩档但钳在 800 之上）；
 *   - thunderEvents ≥ 1（可选指标：雷暴 22-55s 调度必然产事件）。
 *
 * 雷暴区间说明：需求卡与 manifest 合同为 22-55s（thunderMin=22, thunderSpan=33 均匀采样）；
 * 上游实现是首闪 A=22+rng*25（22-47）[src:pretty:L45418-L45418]、重装填 30+rng*30（30-60）
 * [src:pretty:L45457-L45457]，本 kit 按合同收敛到 22-55，两个档位均可经 tune 覆盖。
 *
 * 约定（与 assets/combat-kit.mjs、assets/fx-kit.mjs 同族）：
 *   1. three 作为第 1 个参数注入，**不顶层 import**；`createWeatherKit({opts})` 单参调用
 *      也合法（鸭子类型识别），无 three 时纯 CPU 运行（雷暴调度/排除表/stats 照常，mesh=null）。
 *   2. rng 注入；kit 内零 Math.random（铁律 #5）。aSeed 缓冲与雷暴间隔/强度/闪电方位
 *      全部走注入 rng；注入定种 rng 即逐帧可复现。
 *   3. 热循环（update 内）零分配：uniform 向量/数组预分配复用，update 只做数值写入；
 *      thunder 事件载荷预分配复用（消费方须同步读取）。stats() 是慢路径，允许建对象。
 *   4. uSunCol/uAmb 是线性 HDR vec3（上游 = 太阳色 ×1.9 / 雾色 ×0.15），交 post AgX tonemap。
 *
 * 接线：
 *   const weather = createWeatherKit(THREE, { rng, events, level, camera, renderer, sky, post });
 *   scene.add(weather.root);
 *   weather.setRain(1);                 // 雨量目标 0..1（0.8/s 逼近）
 *   weather.update(dt);                 // 每帧：驱动 uniforms + 雷暴 + sky/post
 *   weather.stats();                    // { rainStreaks, splashes, thunderEvents, drawCalls, ... }
 *
 * 上游世界常量（可经 tune 覆盖）：檐口滴水线 x∈[-16,12] 自 y=7 落于 z=-10.72、
 * 地板分界 x=30（之外落海面 y=-1.6）、溅射 x≤29.7。默认 maskRect scale=0 →
 * 无 mask 时整场按积水处理（uMask 采到 1×1 黑 → pud=1），接真实地面积水 mask 时
 * 传 { maskTexture, maskRect:{x0,z0,size} }（对应上游 uMaskRect=(x0,z0,1/size)）。
 */

/* ---- 数量合同（对齐上游实数与 manifest floor） ---- */

export const WEATHER_POOL_SPEC = Object.freeze({
  rainStreaks: 9000, // 上游 9e3*quality [src:pretty:L45361-L45364]
  eaveDrips: 260, // 檐口滴水线固定 260 [src:pretty:L45363-L45363]
  splashes: 900, // 上游 9e2*quality [src:pretty:L45364-L45364]
  minStreaks: 800, // manifest floor：雨条实例 ≥800（element-manifest.json weather 族）
  indoorBoxes: 4, // 室内排除盒上限 [src:pretty:L45243-L45247]
  skylights: 8, // 天窗矩形上限 [src:pretty:L45259-L45265]
});

export const WEATHER_DRAW_CALLS = 2; // rain + rainSplash（上游 renderOrder 900/890 两 mesh）

/** 天气调参表：调参不改逻辑，全部字段可覆盖。 */
export const WEATHER_TUNE_DEFAULTS = Object.freeze({
  rainLevel: 0.6, // 初始雨量（上游 b/m 初值 0.6 [src:pretty:L45416-L45417]）
  rainTarget: 0.6,
  rainLerp: 0.8, // 逼近速率 0.8/s [src:pretty:L45433-L45434]
  rainFloor: 0.01, // visible 阈值 [src:pretty:L45434-L45434]
  thunderMin: 22, // 雷暴间隔下限（合同 22-55s；上游首闪 A=22+… [src:pretty:L45418-L45418]）
  thunderSpan: 33, // 均匀采样跨度 → 22..55s（上游重装填 30..60 [src:pretty:L45457-L45457]）
  thunderIntensityBase: 0.3, // intensity = base + span*rng [src:pretty:L45457-L45457]
  thunderIntensitySpan: 0.7,
  flashDecay: 7.5, // 闪电主闪指数衰减（sky uFlash 包络）
  flashSecondDelay: 0.22, // 二次回闪延迟（雷的多闪观感）
  flashSecondGain: 0.65,
  thunderGateDecay: 5, // post uThunder 雷暴活动门限的时间常数（秒）
  windX: -2.6, // 上游 uVel (-2.6,-9.4,1.1)：风+下落合速度 [src:pretty:L45384-L45384]
  windY: -9.4,
  windZ: 1.1,
  boxX: 26, // 相机跟随雨域 26×15×26 [src:pretty:L45385-L45385]
  boxY: 15,
  boxZ: 26,
  dripX0: -16, // 檐口滴水线（上游棚南檐硬编码）[src:pretty:L45266-L45271]
  dripX1: 12,
  dripY: 7,
  dripZ: -10.72,
  dripPeriod: 1.19, // 滴水自由落体周期 T [src:pretty:L45267-L45267]
  groundSplitX: 30, // p.x>30 之外地板 -1.6（海面），之内 0 [src:pretty:L45279-L45279]
  groundLowY: -1.6,
  splashMaxX: 29.7, // 溅射 x 上限（上游码头岸线）[src:pretty:L45320-L45320]
  fov: 62, // camera 缺省时的 fov（uPix = 2tan(fov/2)/h [src:pretty:L45440-L45441]）
  boxPadXZ: 0.15, // 室内盒水平外扩 [src:pretty:L45447-L45448]
  boxPadLow: 1, // 盒底向下扩 1
  boxPadTop: 0.3, // 盒顶向上扩 0.3 [src:pretty:L45447-L45448]
});

/* ---- GLSL（照抄上游 kR/FR/UR/NR/Ub，世界常量提为 uniform） ---- */

/** wInside 4 盒排除 + wPhase HG 相位（g=0.72）。[src:pretty:L45243-L45250] */
const WEATHER_COMMON_FN = `
uniform vec3 uBoxMin[4]; uniform vec3 uBoxMax[4];
bool wInside(vec3 p){
  for (int i = 0; i < 4; i++) { if (all(greaterThan(p, uBoxMin[i])) && all(lessThan(p, uBoxMax[i]))) return true; }
  return false;
}
float wPhase(float c){ float g = 0.72; return (1.0 - g * g) / (12.566 * pow(1.0 + g * g - 2.0 * g * c, 1.5)); }
`;

/** 雨条顶点：上游 kR + wSky 天窗；uDripLine/uGround/uDripPeriod 为原世界常量提参。 [src:pretty:L45251-L45291] */
const WEATHER_RAIN_VERT = `
uniform float uTime, uRain, uPix, uDrip, uDripPeriod; uniform vec3 uVel, uBox, uSunDir, uSunCol, uAmb;
uniform vec4 uDripLine; uniform vec3 uGround;
attribute vec4 aSeed;
varying vec3 vCol; varying float vA; varying vec2 vUv;
${WEATHER_COMMON_FN}
uniform vec4 uSky[8];   // roof openings (x, z, half w, half d): rain falls through these into the shed
bool wSky(vec3 p){
  for (int i = 0; i < 8; i++) { if (abs(p.x - uSky[i].x) < uSky[i].z && abs(p.z - uSky[i].y) < uSky[i].w) return true; }
  return false;
}
void main(){
  vUv = position.xy;
  float sp = 0.82 + 0.36 * aSeed.w;
  vec3 vel = uVel * sp;
  vec3 p; float len; float kill = 0.0;
  if (aSeed.w < 0.0) {                       // eave drip line (shed south eave), free-fall from 7 m
    float T = uDripPeriod; float t = fract(uTime / T * (0.9 + 0.2 * aSeed.y) + aSeed.z) * T;
    p = vec3(mix(uDripLine.x, uDripLine.y, aSeed.x), uDripLine.z - 4.9 * t * t,
             uDripLine.w + 0.05 * sin(aSeed.x * 911.0));
    vel = vec3(0.0, -9.81 * t - 0.3, 0.0); len = 0.022 * length(vel) + 0.03;
    kill = 1.0 - uDrip;
    if (fract(aSeed.x * 37.7) > 0.55 + 0.45 * uRain) kill = 1.0;
  } else {
    p = aSeed.xyz * uBox + vel * uTime;
    p = mod(p - cameraPosition + 0.5 * uBox, uBox) - 0.5 * uBox + cameraPosition;
    len = 0.03 * length(vel);
    if (fract(aSeed.w * 7.13 + aSeed.x) > uRain) kill = 1.0;
    if (wInside(p) && !wSky(p)) kill = 1.0;
  }
  if (p.y < (p.x > uGround.x ? uGround.y : uGround.z)) kill = 1.0;
  vec3 dir = normalize(vel);
  vec3 toP = p - cameraPosition; float dist = length(toP);
  vec3 side = normalize(cross(dir, toP));
  float w0 = 0.005 + 0.004 * fract(aSeed.w * 3.7);
  float w = max(w0, dist * uPix * 0.75);
  vec3 wp = p + dir * (len * (position.y - 0.5)) + side * (w * position.x);
  float a = (w0 / w) * smoothstep(0.7, 2.6, dist) * (1.0 - smoothstep(0.38, 0.5, dist / uBox.x));
  float c = dot(toP / max(dist, 1e-3), uSunDir);
  vCol = uAmb + uSunCol * wPhase(c);
  vA = a * (0.55 + 0.45 * fract(aSeed.w * 13.3));
  gl_Position = kill > 0.5 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

/** 雨条片元：上游 FR。[src:pretty:L45292-L45298] */
const WEATHER_RAIN_FRAG = `
varying vec3 vCol; varying float vA; varying vec2 vUv;
void main(){
  float x = 1.0 - abs(vUv.x) * 2.0;
  float e = smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
  gl_FragColor = vec4(vCol, vA * x * e);
}
`;

/** 溅射顶点：上游 UR；uSplashMaxX 为原 29.7 提参。 [src:pretty:L45299-L45331] */
const WEATHER_SPLASH_VERT = `
uniform float uTime, uRain, uSplashMaxX; uniform vec3 uSunDir, uSunCol, uAmb, uMaskRect; uniform sampler2D uMask;
attribute vec4 aSeed;
varying vec3 vCol; varying float vA; varying vec2 vUv; varying float vLife;
${WEATHER_COMMON_FN}
vec2 sHash(vec2 p){ vec3 q = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
void main(){
  vUv = position.xy;
  float period = 0.26 + 0.14 * aSeed.z;
  float tt = uTime / period + aSeed.w * 10.0; float cyc = floor(tt); float life = fract(tt);
  vec2 r = sHash(aSeed.xy * 91.7 + cyc * 0.371);
  vec2 rr = r - 0.5; rr *= 0.35 + 1.3 * abs(rr);                    // denser near the player
  vec2 snap = floor(cameraPosition.xz / 4.0) * 4.0;
  vec3 p = vec3(snap.x + rr.x * 30.0, 0.0, snap.y + rr.y * 30.0);
  float kill = 0.0;
  vec2 muv = (p.xz - uMaskRect.xy) * uMaskRect.z;
  float inM = step(0.0, muv.x) * step(muv.x, 1.0) * step(0.0, muv.y) * step(muv.y, 1.0);
  float pud = step(textureLod(uMask, muv, 0.0).r, 0.49) * inM;
  float k = fract(aSeed.w * 5.3 + cyc * 0.17);
  if (pud < 0.5 && k > 0.3) kill = 1.0;
  if (k > 0.2 + 0.8 * uRain) kill = 1.0;
  if (p.x > uSplashMaxX || wInside(p + vec3(0.0, 0.2, 0.0))) kill = 1.0;
  float sz = mix(0.04, 0.08, aSeed.z) * mix(0.65, 1.0, pud);
  float wd = sz * (0.7 + 1.5 * life), ht = sz * (0.4 + 1.3 * sin(life * 3.14159));
  vec3 toP = p - cameraPosition; float dist = length(toP);
  vec3 side = normalize(vec3(toP.z, 0.0, -toP.x));
  vec3 wp = p + side * (wd * position.x * 2.0) + vec3(0.0, ht * position.y + 0.004, 0.0);
  float c = dot(toP / max(dist, 1e-3), uSunDir);
  vCol = uAmb * 1.4 + uSunCol * wPhase(c) * 0.8;
  vA = (1.0 - life) * (1.0 - smoothstep(11.0, 15.0, dist)) * mix(0.5, 1.0, pud);
  vLife = life;
  gl_Position = kill > 0.5 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

/** 溅射片元：上游 NR（crown 冠形 + 核心亮点）。[src:pretty:L45332-L45344] */
const WEATHER_SPLASH_FRAG = `
varying vec3 vCol; varying float vA; varying vec2 vUv; varying float vLife;
void main(){
  float x = vUv.x * 2.0, y = vUv.y;
  // little crown: a rim arc that opens outward, plus a few thrown droplets
  float dome = smoothstep(1.0, 0.25, length(vec2(x * 1.15, y * 1.5)));
  float crown = dome * (0.35 + 0.65 * smoothstep(0.25, 0.75, length(vec2(x, y * 1.4))));
  float core = smoothstep(0.5, 0.0, length(vec2(x * 1.6, (y - 0.25) * 1.6))) * (1.0 - vLife);
  float dots = smoothstep(0.16, 0.05, length(vec2(abs(x) - 0.75, y - 0.82))) + smoothstep(0.14, 0.04, length(vec2(x - 0.2, y - 0.93)));
  float a = clamp(crown * 0.5 + core * 0.8 + dots * 0.0, 0.0, 1.0) * vA * 0.6;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vCol, a);
}
`;

/* ---- 小工具（确定性；GLSL 内的随机全在 shader 侧 hash，CPU 侧只用注入 rng） ---- */

const EMPTY = {};
const TAU = Math.PI * 2;

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

/** 无 three 时的最小 vec3/vec4 桩（有 set 语义，uniform 结构与 three.Vector3/4 同形）。 */
function mkV3(x, y, z) {
  return { x, y, z, set(nx, ny, nz) { this.x = nx; this.y = ny; this.z = nz; return this; } };
}
function mkV4(x, y, z, w) {
  return { x, y, z, w, set(nx, ny, nz, nw) { this.x = nx; this.y = ny; this.z = nz; this.w = nw; return this; } };
}

/** 光色注入统一到线性 {x,y,z}（THREE.Color / {r,g,b} / number 都接受；只在构建期调用）。 */
function toLinearRGB(c, fallback) {
  if (c === undefined || c === null) return fallback;
  if (typeof c === "number") {
    return { x: ((c >> 16) & 255) / 255, y: ((c >> 8) & 255) / 255, z: (c & 255) / 255 };
  }
  if (typeof c === "object" && "r" in c) return { x: c.r, y: c.g, z: c.b };
  return { x: 0.2, y: 0.2, z: 0.2 };
}

function setXYZ(v, x, y, z) {
  if (v && typeof v.set === "function") v.set(x, y, z);
  else if (v) { v.x = x; v.y = y; v.z = z; }
}

/* ---- 种子几何（上游 Fb：quad + aSeed；滴水段 seed.w=-1）。[src:pretty:L45345-L45358] */

function buildSeedGeometry(THREE, instances, drips, rng) {
  const n = instances + drips;
  const seeds = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i += 1) seeds[i] = rng();
  for (let i = instances; i < n; i += 1) seeds[i * 4 + 3] = -1; // 滴水段标记
  let geo = null;
  if (THREE && THREE.InstancedBufferGeometry) {
    geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 2, 1, 3]);
    const attr = new THREE.InstancedBufferAttribute(seeds, 4);
    geo.setAttribute("aSeed", attr);
    geo.instanceCount = n;
    if (THREE.Sphere) geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  }
  return { geo, seeds, n };
}

/* ======================================================================
 * createWeatherKit
 * ==================================================================== */

/**
 * 创建天气 kit。
 * @param {Object|null} THREE three 命名空间（可省略或放进 options；省略时纯 CPU 模拟）
 * @param {Object} [options]
 * @param {Function} [options.rng] 注入随机源（雷暴间隔/强度/闪电方位/aSeed 缓冲；默认 Math.random 仅在注入缺省处）
 * @param {Object} [options.events] {emit()}；雷暴 emit("thunder", {intensity})（载荷复用，同步读取）
 * @param {number} [options.quality] 雨量密度档 0.15..1（上游 quality.rain；默认 1 = 满规格 9000/900）
 * @param {Object} [options.level] {interiorBoxes:[{min,max}], skylights:[{x,z,w,d}]}（每帧读取，同上游）
 * @param {Object} [options.camera] {fov}（uPix 计算）
 * @param {Object} [options.renderer] 可选（getDrawingBufferSize 取画幅高）
 * @param {Object} [options.resolution] 可选 {x,y}（显式画幅，优先于 renderer）
 * @param {Object} [options.sky] sky-deck 材质或 {uniforms}；写 uFlash/uFlashDir
 * @param {Object} [options.post] post-chain 材质或 {uniforms}；写 uThunder
 * @param {Object|number} [options.sunDir] 太阳方向（wPhase 各向异性；默认归一 (-0.55,.72,.42)）
 * @param {Object|number} [options.sunCol] 太阳色（线性；上游 = 太阳色 ×1.9）
 * @param {Object|number} [options.amb] 环境色（线性；上游 = 雾色 ×0.15）
 * @param {Object} [options.mask] 地面积水 {texture, rect:{x0,z0,size}}（溅射积水判定；缺省整场按积水）
 * @param {Object} [options.tune] WEATHER_TUNE_DEFAULTS 覆盖
 */
export function createWeatherKit(THREE, options = {}) {
  if (THREE && typeof THREE.BufferGeometry !== "function") {
    options = THREE;
    THREE = null;
  }
  const opts = options || {};
  const rng = typeof opts.rng === "function" ? opts.rng : Math.random;
  const events = opts.events || EMPTY;
  const TUNE = { ...WEATHER_TUNE_DEFAULTS, ...opts.tune };
  const level = opts.level || null;
  const camera = opts.camera || null;
  const renderer = opts.renderer || null;
  const resolution = opts.resolution || null;
  const sky = opts.sky && (opts.sky.uniforms ? opts.sky : { uniforms: opts.sky });
  const post = opts.post && (opts.post.uniforms ? opts.post : { uniforms: opts.post });
  const skyU = sky ? sky.uniforms : null;
  const postU = post ? post.uniforms : null;

  /* ---- 数量（quality 缩档 + manifest floor 钳制） ---- */
  const q = Math.max(0.15, opts.quality === undefined ? 1 : opts.quality);
  const streaks = Math.max(WEATHER_POOL_SPEC.minStreaks, Math.round(WEATHER_POOL_SPEC.rainStreaks * q));
  const drips = WEATHER_POOL_SPEC.eaveDrips;
  const splashes = Math.max(1, Math.round(WEATHER_POOL_SPEC.splashes * q));

  /* ---- 排除表（预分配：4 盒 min/max + 8 天窗；update 内只写不建） ---- */
  const V3 = THREE && THREE.Vector3 ? THREE.Vector3 : mkV3;
  const V4 = THREE && THREE.Vector4 ? THREE.Vector4 : mkV4;
  const boxMin = [];
  const boxMax = [];
  const skyRects = [];
  for (let i = 0; i < WEATHER_POOL_SPEC.indoorBoxes; i += 1) { boxMin.push(new V3(0, 0, 0)); boxMax.push(new V3(0, 0, 0)); }
  for (let i = 0; i < WEATHER_POOL_SPEC.skylights; i += 1) skyRects.push(new V4(0, 0, -1, -1));
  const staticBoxes = [];
  const staticSkylights = [];

  /* ---- 雨/溅射种子缓冲（构建期 rng；aSeed 决定逐实例相位/位置/速率） ---- */
  const rainSeeds = buildSeedGeometry(THREE, streaks, drips, rng);
  const splashSeeds = buildSeedGeometry(THREE, splashes, 0, rng);

  /* ---- uniforms（结构即合同；three.ShaderMaterial 直接吃同一对象） ---- */
  const sunDir = opts.sunDir || { x: -0.55, y: 0.72, z: 0.42 };
  const sdLen = Math.hypot(sunDir.x, sunDir.y, sunDir.z) || 1;
  const sunCol = toLinearRGB(opts.sunCol, { x: 0.42, y: 0.46, z: 0.54 }); // 上游 sun*1.9 量级
  const amb = toLinearRGB(opts.amb, { x: 0.022, y: 0.025, z: 0.033 }); // 上游 fog*0.15 量级
  const maskRect = opts.mask && opts.mask.rect ? opts.mask.rect : null;

  const shared = {
    uTime: { value: 0 },
    uRain: { value: TUNE.rainLevel },
    uSunDir: { value: new V3(sunDir.x / sdLen, sunDir.y / sdLen, sunDir.z / sdLen) },
    uSunCol: { value: new V3(sunCol.x, sunCol.y, sunCol.z) },
    uAmb: { value: new V3(amb.x, amb.y, amb.z) },
    uBoxMin: { value: boxMin },
    uBoxMax: { value: boxMax },
  };

  const rainUniforms = {
    ...shared,
    uPix: { value: 0.002 },
    uDrip: { value: 0 },
    uDripPeriod: { value: TUNE.dripPeriod },
    uVel: { value: new V3(TUNE.windX, TUNE.windY, TUNE.windZ) },
    uBox: { value: new V3(TUNE.boxX, TUNE.boxY, TUNE.boxZ) },
    uSky: { value: skyRects },
    uDripLine: { value: new V4(TUNE.dripX0, TUNE.dripX1, TUNE.dripY, TUNE.dripZ) },
    uGround: { value: new V3(TUNE.groundSplitX, TUNE.groundLowY, 0) },
  };

  const splashUniforms = {
    ...shared,
    uMaskRect: {
      value: maskRect
        ? new V3(maskRect.x0 || 0, maskRect.z0 || 0, 1 / (maskRect.size || 1))
        : new V3(0, 0, 0), // scale=0 → muv 恒 (0,0) → 采黑 → 整场按积水（缺省 mask 合同）
    },
    uMask: { value: (opts.mask && opts.mask.texture) || null },
    uSplashMaxX: { value: TUNE.splashMaxX },
  };
  if (!splashUniforms.uMask.value && THREE && THREE.DataTexture) {
    // 缺省 1×1 黑纹理（上游 ground 构建同款占位），保证 shader 有可采样对象
    const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    black.needsUpdate = true;
    splashUniforms.uMask.value = black;
  }

  /* ---- mesh（three 缺席时保持 null；CPU 状态机不受影响） ---- */
  let rainMesh = null;
  let splashMesh = null;
  let root = null;
  if (THREE && THREE.ShaderMaterial && rainSeeds.geo && splashSeeds.geo) {
    const rainMat = new THREE.ShaderMaterial({
      uniforms: rainUniforms,
      vertexShader: WEATHER_RAIN_VERT,
      fragmentShader: WEATHER_RAIN_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    rainMat.name = "weather_rain";
    rainMesh = new THREE.Mesh(rainSeeds.geo, rainMat);
    rainMesh.frustumCulled = false;
    rainMesh.castShadow = false;
    rainMesh.receiveShadow = false;
    rainMesh.matrixAutoUpdate = false;
    rainMesh.renderOrder = 900;
    rainMesh.name = "rain";

    const splashMat = new THREE.ShaderMaterial({
      uniforms: splashUniforms,
      vertexShader: WEATHER_SPLASH_VERT,
      fragmentShader: WEATHER_SPLASH_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    splashMat.name = "weather_rainSplash";
    splashMesh = new THREE.Mesh(splashSeeds.geo, splashMat);
    splashMesh.frustumCulled = false;
    splashMesh.castShadow = false;
    splashMesh.receiveShadow = false;
    splashMesh.matrixAutoUpdate = false;
    splashMesh.renderOrder = 890;
    splashMesh.name = "rainSplash";

    root = new THREE.Group();
    root.name = "weather";
    root.add(splashMesh);
    root.add(rainMesh);
  }

  /* ---- 状态机（预分配事件载荷与临时量；update 零分配） ---- */
  const THUNDER_EVT = { intensity: 0 };
  let time = 0;
  let rainCur = TUNE.rainLevel;
  let rainTarget = TUNE.rainTarget;
  let visible = rainCur > TUNE.rainFloor;
  let thunderT = TUNE.thunderMin + rng() * TUNE.thunderSpan; // 首闪在 22-55s
  let flashAmp = 0;
  let flashVal = 0; // 当前包络值（stats 读这个）
  let flashT = -1; // <0 = 包络空闲
  let flashDirX = 0;
  let flashDirY = 0.6;
  let flashDirZ = -0.8;
  let thunderGate = 0; // post uThunder：雷暴活动 0..1
  const camFov = camera && camera.fov ? camera.fov : TUNE.fov;
  const _bufSize = THREE && THREE.Vector2 ? new THREE.Vector2() : null;

  function strike(intensity) {
    flashAmp = intensity;
    flashT = 0;
    // 闪电方位：全天球随机仰角（避免贴地平线），与 uFlashDir 的 pow5 聚光配对
    const az = rng() * TAU;
    const el = 0.25 + rng() * 0.6;
    const ce = Math.cos(el);
    flashDirX = Math.sin(az) * ce;
    flashDirY = Math.sin(el);
    flashDirZ = Math.cos(az) * ce;
    thunderGate = Math.min(1, thunderGate + 0.45 * intensity);
    thunderT = TUNE.thunderMin + rng() * TUNE.thunderSpan; // 重装填仍在 22-55s
    THUNDER_EVT.intensity = intensity;
    if (typeof events.emit === "function") events.emit("thunder", THUNDER_EVT);
    stats.thunderEvents += 1;
  }

  /* ---- update：每帧驱动 uniforms + 雷暴调度 + sky/post 包络（零分配） ---- */
  function update(dt) {
    time += dt;
    // rain 以 0.8/s 逼近目标 [src:pretty:L45433-L45434]
    rainCur += (rainTarget - rainCur) * Math.min(1, dt * TUNE.rainLerp);
    visible = rainCur > TUNE.rainFloor;
    rainUniforms.uTime.value = time;
    rainUniforms.uRain.value = rainCur;
    splashUniforms.uTime.value = time;
    splashUniforms.uRain.value = rainCur;
    if (rainMesh) rainMesh.visible = visible;
    if (splashMesh) splashMesh.visible = visible;

    // uPix = 2tan(fov/2)/画幅高 [src:pretty:L45437-L45441]
    let h = 0;
    if (resolution && resolution.y > 8) h = resolution.y;
    else if (renderer && typeof renderer.getDrawingBufferSize === "function" && _bufSize) {
      renderer.getDrawingBufferSize(_bufSize);
      h = _bufSize.y;
    }
    if (h > 8) rainUniforms.uPix.value = (2 * Math.tan((camFov * Math.PI) / 360)) / Math.max(1, h);

    // 室内盒（≤4，前 4 个生效；±0.15 / y -1/+0.3 外扩）[src:pretty:L45443-L45451]
    const boxes = (level && level.interiorBoxes) || staticBoxes;
    for (let i = 0; i < WEATHER_POOL_SPEC.indoorBoxes; i += 1) {
      const q2 = boxes[i];
      if (q2 && q2.min && q2.max) {
        boxMin[i].set(q2.min.x - TUNE.boxPadXZ, q2.min.y - TUNE.boxPadLow, q2.min.z - TUNE.boxPadXZ);
        boxMax[i].set(q2.max.x + TUNE.boxPadXZ, q2.max.y + TUNE.boxPadTop, q2.max.z + TUNE.boxPadXZ);
      } else {
        boxMin[i].set(0, 0, 0);
        boxMax[i].set(0, 0, 0);
      }
    }
    rainUniforms.uDrip.value = boxes.length ? 1 : 0;

    // 天窗（≤8，(x,z,w*.5,(d||w)*.5)；缺省 (0,0,-1,-1) 永不命中）[src:pretty:L45452-L45456]
    const sks = (level && level.skylights) || staticSkylights;
    for (let i = 0; i < WEATHER_POOL_SPEC.skylights; i += 1) {
      const q2 = sks[i];
      if (q2 && q2.w > 0) skyRects[i].set(q2.x, q2.z, q2.w * 0.5, (q2.d || q2.w) * 0.5);
      else skyRects[i].set(0, 0, -1, -1);
    }

    // 雷暴调度（22-55s 均匀；强度 0.3-1）[src:pretty:L45457-L45457]
    thunderT -= dt;
    if (thunderT <= 0) strike(TUNE.thunderIntensityBase + TUNE.thunderIntensitySpan * rng());

    // 闪电包络：主闪指数衰减 + flashSecondDelay 后的二次回闪 → sky uFlash/uFlashDir
    if (flashT >= 0) {
      flashT += dt;
      const t = flashT;
      let env = flashAmp * Math.exp(-t * TUNE.flashDecay)
        + flashAmp * TUNE.flashSecondGain * Math.exp(-Math.abs(t - TUNE.flashSecondDelay) * 9);
      if (t > TUNE.flashSecondDelay * 3 && env < 0.004) { env = 0; flashT = -1; }
      flashVal = env;
      if (skyU) {
        if (skyU.uFlash) skyU.uFlash.value = env;
        if (skyU.uFlashDir && env > 0) setXYZ(skyU.uFlashDir.value, flashDirX, flashDirY, flashDirZ);
      }
    } else {
      flashVal = 0;
    }

    // post uThunder：雷暴活动门限（击中抬升、按时间常数衰减，雨量贡献基线）
    thunderGate *= Math.exp(-dt / Math.max(0.1, TUNE.thunderGateDecay));
    if (postU && postU.uThunder) postU.uThunder.value = Math.min(1, thunderGate + rainCur * 0.35);
  }

  /* ---- 公开 API ---- */

  /** 雨量目标 0..1（0.8/s 逼近；0 = 收雨）。 */
  function setRain(w) {
    rainTarget = clamp(w, 0, 1);
  }

  /** 手动触发雷暴（导演钩子/测试用；同样重装填 22-55s）。 */
  function thunder(intensity) {
    strike(clamp(intensity === undefined ? 1 : intensity, 0, 1));
  }

  /** 注入/替换室内排除盒（≤4 生效；亦可由 level.interiorBoxes 每帧提供）。 */
  function setIndoorBoxes(boxes) {
    staticBoxes.length = 0;
    if (!boxes) return;
    for (let i = 0; i < WEATHER_POOL_SPEC.indoorBoxes && i < boxes.length; i += 1) staticBoxes.push(boxes[i]);
  }

  /** 注入/替换天窗矩形（≤8 生效；{x,z,w,d}，w/d 为全宽全深）。 */
  function setSkylights(rects) {
    staticSkylights.length = 0;
    if (!rects) return;
    for (let i = 0; i < WEATHER_POOL_SPEC.skylights && i < rects.length; i += 1) staticSkylights.push(rects[i]);
  }

  function stats() {
    let usedBoxes = 0;
    const boxes = (level && level.interiorBoxes) || staticBoxes;
    for (let i = 0; i < WEATHER_POOL_SPEC.indoorBoxes && i < boxes.length; i += 1) {
      const q2 = boxes[i];
      if (q2 && q2.min && q2.max) usedBoxes += 1;
    }
    let usedSky = 0;
    const sks = (level && level.skylights) || staticSkylights;
    for (let i = 0; i < WEATHER_POOL_SPEC.skylights && i < sks.length; i += 1) {
      if (sks[i] && sks[i].w > 0) usedSky += 1;
    }
    return {
      // manifest「weather」族对账口径
      rainStreaks: streaks,
      splashes,
      thunderEvents: stats.thunderEvents,
      drawCalls: root ? root.children.length : WEATHER_DRAW_CALLS,
      // 运行态
      rainLevel: rainCur,
      rainTarget,
      visible,
      flash: flashVal,
      thunder: postU && postU.uThunder ? postU.uThunder.value : thunderGate,
      indoorBoxes: usedBoxes,
      skylights: usedSky,
      eaveDrips: drips,
      time,
      caps: { ...WEATHER_POOL_SPEC },
      drawCallsBudget: WEATHER_DRAW_CALLS,
    };
  }
  stats.thunderEvents = 0;

  /* ---- selfTest：node 离线自证（确定性 stub rng，零依赖） ---- */
  function selfTest({ steps = 600 } = {}) {
    const checks = [];
    const failed = [];
    const rec = (name, ok, detail) => {
      checks.push({ name, ok, detail });
      if (!ok) failed.push(name);
    };
    const stubSky = { uniforms: { uFlash: { value: 0 }, uFlashDir: { value: { x: 0, y: 1, z: 0 } } } };
    const stubPost = { uniforms: { uThunder: { value: 0 } } };

    // 定种 rng（与 mulberry32 同族，本地实现避免依赖其它 kit）
    function seeded(seed) {
      let s = seed >>> 0;
      return function next() {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    // 1. 数量 floor：雨条 ≥800（manifest），溅射 900，滴水 260
    const st = stats();
    rec("caps: rainStreaks>=800", st.rainStreaks >= WEATHER_POOL_SPEC.minStreaks,
      `rainStreaks=${st.rainStreaks} floor=${WEATHER_POOL_SPEC.minStreaks}`);
    rec("caps: splashes==900@q1", st.splashes === WEATHER_POOL_SPEC.splashes, `splashes=${st.splashes}`);
    rec("caps: eaveDrips==260", st.eaveDrips === WEATHER_POOL_SPEC.eaveDrips, `drips=${st.eaveDrips}`);
    rec("caps: drawCalls<=2", st.drawCalls <= WEATHER_DRAW_CALLS, `drawCalls=${st.drawCalls}`);

    // 2. quality 缩档仍守 floor
    const loKit = createWeatherKit(null, { rng: seeded(7), quality: 0.15 });
    rec("quality 0.15 仍 ≥800", loKit.stats().rainStreaks >= WEATHER_POOL_SPEC.minStreaks,
      `rainStreaks=${loKit.stats().rainStreaks}`);

    // 3. shader 自检：括号配平 + 关键 uniform 在场
    const shaders = [
      ["rain_vert", WEATHER_RAIN_VERT, ["uVel", "uBox", "uSky[8]", "uBoxMin[4]", "wSky", "wInside", "aSeed"]],
      ["rain_frag", WEATHER_RAIN_FRAG, ["vCol", "vA"]],
      ["splash_vert", WEATHER_SPLASH_VERT, ["uMask", "uMaskRect", "wInside", "uSplashMaxX"]],
      ["splash_frag", WEATHER_SPLASH_FRAG, ["crown"]],
    ];
    for (const [name, src, keys] of shaders) {
      let bal = 0;
      let minBal = 0;
      for (const ch of src) {
        if (ch === "{") bal += 1;
        else if (ch === "}") { bal -= 1; if (bal < minBal) minBal = bal; }
      }
      rec(`glsl ${name} 括号配平`, bal === 0 && minBal === 0, `balance=${bal} min=${minBal}`);
      const missing = keys.filter((k) => src.indexOf(k) < 0);
      rec(`glsl ${name} 关键符号`, missing.length === 0, missing.join(","));
    }

    // 4. 雷暴调度：22-55s 边界 + 事件计数 + sky/post 驱动
    const bus = [];
    const w = createWeatherKit(null, {
      rng: seeded(1234), quality: 0.2,
      events: { emit(name, payload) { bus.push({ name, t: 0, intensity: payload.intensity }); } },
      sky: stubSky, post: stubPost,
      tune: { rainLevel: 0.4, rainTarget: 0.4 },
    });
    const dt = 1 / 30;
    const strikes = [];
    let last = 0;
    let clock = 0;
    for (let i = 0; i < 60 * 30; i += 1) {
      w.update(dt);
      clock += dt;
      if (w.stats().thunderEvents > last) {
        strikes.push(clock - (strikes.length ? strikes[strikes.length - 1] : 0));
        last = w.stats().thunderEvents;
      }
    }
    rec("thunderEvents>=1（可选 floor）", w.stats().thunderEvents >= 1, `events=${w.stats().thunderEvents}`);
    const outOfBand = strikes.filter((g) => g < 22 - 0.01 || g > 55 + 0.01);
    rec("雷暴间隔 ∈ [22,55]s", strikes.length > 0 && outOfBand.length === 0, `${strikes.length} 次, 出界 ${outOfBand.length}`);
    const badI = bus.filter((e) => e.intensity < 0.3 - 1e-6 || e.intensity > 1 + 1e-6);
    rec("thunder.intensity ∈ [0.3,1]", badI.length === 0, `${badI.length} 出界`);

    // 5. 手动雷暴 → uFlash/uThunder 驱动 + 包络衰减
    w.thunder(1);
    w.update(dt);
    const f0 = stubSky.uniforms.uFlash.value;
    const g0 = stubPost.uniforms.uThunder.value;
    rec("击中后 uFlash>0", f0 > 0, `uFlash=${f0.toFixed(4)}`);
    rec("击中后 uThunder∈(0,1]", g0 > 0 && g0 <= 1, `uThunder=${g0.toFixed(4)}`);
    const dir = stubSky.uniforms.uFlashDir.value;
    const dirLen = Math.hypot(dir.x, dir.y, dir.z);
    rec("uFlashDir 归一", Math.abs(dirLen - 1) < 1e-3, `len=${dirLen.toFixed(4)}`);
    for (let i = 0; i < 120; i += 1) w.update(dt); // 4s 后包络归零
    rec("4s 后 uFlash≈0", stubSky.uniforms.uFlash.value < 0.004, `uFlash=${stubSky.uniforms.uFlash.value}`);

    // 6. 雨量 lerp + visible 门限 + 收雨
    const w2 = createWeatherKit(null, { rng: seeded(99), sky: stubSky, post: stubPost, tune: { rainLevel: 0, rainTarget: 0 } });
    w2.setRain(1);
    for (let i = 0; i < 30 * 8; i += 1) w2.update(dt);
    rec("setRain(1) 8s 收敛", w2.stats().rainLevel > 0.95, `rainLevel=${w2.stats().rainLevel.toFixed(3)}`);
    w2.setRain(0);
    for (let i = 0; i < 30 * 8; i += 1) w2.update(dt);
    rec("setRain(0) 8s 后隐藏(<0.01)", w2.stats().visible === false, `visible=${w2.stats().visible} rain=${w2.stats().rainLevel.toFixed(4)}`);

    // 7. 排除表钳制：>4 盒只取前 4，>8 天窗只取前 8
    const w3 = createWeatherKit(null, { rng: seeded(5) });
    const six = [];
    for (let i = 0; i < 6; i += 1) six.push({ min: { x: i, y: 0, z: i }, max: { x: i + 1, y: 3, z: i + 1 } });
    w3.setIndoorBoxes(six);
    const ten = [];
    for (let i = 0; i < 10; i += 1) ten.push({ x: i, z: i, w: 2, d: 2 });
    w3.setSkylights(ten);
    w3.update(dt);
    const st3 = w3.stats();
    rec("室内盒钳到 4", st3.indoorBoxes === 4, `indoorBoxes=${st3.indoorBoxes}`);
    rec("天窗钳到 8", st3.skylights === 8, `skylights=${st3.skylights}`);

    // 8. level 表每帧读取（同上游合同）
    const lvl = {
      interiorBoxes: [{ min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 3, z: 2 } }],
      skylights: [{ x: 1, z: 1, w: 2 }],
    };
    const w4 = createWeatherKit(null, { rng: seeded(6), level: lvl });
    w4.update(dt);
    rec("level.interiorBoxes 生效", w4.stats().indoorBoxes === 1, `indoorBoxes=${w4.stats().indoorBoxes}`);
    rec("level.skylights 生效(w*d 默认方)", w4.stats().skylights === 1, `skylights=${w4.stats().skylights}`);

    // 9. 确定性：同种子两次构建 → 相同雷暴节拍
    const sched = (seed) => {
      const wk = createWeatherKit(null, { rng: seeded(seed) });
      const out = [];
      let tt = 0;
      let prev = 0;
      for (let i = 0; i < 30 * 200; i += 1) {
        wk.update(dt);
        tt += dt;
        const ev = wk.stats().thunderEvents;
        if (ev > prev) { out.push(tt); prev = ev; }
      }
      return out;
    };
    const a1 = sched(31337);
    const a2 = sched(31337);
    rec("同种子雷暴节拍逐位一致", a1.length === a2.length && a1.every((v, i) => v === a2[i]),
      `n=${a1.length}/${a2.length}`);
    rec("aSeed 缓冲确定性（seeded 构建两次一致）", (() => {
      const g1 = buildSeedGeometry(null, 16, 4, seeded(42));
      const g2 = buildSeedGeometry(null, 16, 4, seeded(42));
      for (let i = 0; i < g1.seeds.length; i += 1) if (g1.seeds[i] !== g2.seeds[i]) return false;
      return g1.seeds[17 * 4 + 3] === -1; // 滴水段标记在第 17..20 槽
    })(), "seed buffer");

    return { pass: failed.length === 0, checks, failed, checkCount: checks.length };
  }

  return {
    TUNE,
    WEATHER_POOL_SPEC,
    rain: {
      mesh: rainMesh,
      geometry: rainSeeds.geo,
      uniforms: rainUniforms,
      cap: streaks,
      drips,
      seeds: rainSeeds.seeds,
    },
    splash: {
      mesh: splashMesh,
      geometry: splashSeeds.geo,
      uniforms: splashUniforms,
      cap: splashes,
      seeds: splashSeeds.seeds,
    },
    root,
    wind: rainUniforms.uVel.value,
    setRain,
    get rainLevel() { return rainCur; },
    thunder,
    setIndoorBoxes,
    setSkylights,
    update,
    stats,
    selfTest,
  };
}

/* ============================== 模块级自检 ============================== */

/**
 * 模块级自检（node 可跑，无 THREE / 无 DOM）：构造无 three 实例并跑实例 selfTest
 * （内部用定种 rng 重建，不依赖 Math.random）。返回 { ok, checks, failed }。
 */
export function selfTest() {
  const result = createWeatherKit(null, {}).selfTest();
  return { ok: !!result.pass, checks: result.checks, failed: result.failed };
}
