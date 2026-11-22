# 04 · 代码图集：原文片段与可复用骨架

> 本篇把最值得抄的代码模式按"原文 → 骨架 → 落地点"整理。原文出自
> `sources/jimao-3a-game/index.html`，展开可读版在
> `evidence/frames/app.pretty.js`（prettier 展开，59,624 行）。

## 图集 A · 画质分级表（S1 的直接模板）

**原文要点**：`test/low/medium/high/ultra` 五档，字段 `scale,msaa,shadow,tex,volSteps,ao,planar,bloom,motionBlur,rain` [src:pretty:L1044-L1068]。

```js
export const QUALITY = {
  low:    { scale: .7, msaa: 0, shadow: 2048, tex: 512,  volSteps: 12, ao: false, planar: 0,   bloom: true, rain: .5 },
  medium: { scale: .85, msaa: 2, shadow: 2048, tex: 1024, volSteps: 16, ao: true,  planar: .5, bloom: true, rain: .8 },
  high:   { scale: 1, msaa: 4, shadow: 4096, tex: 1024, volSteps: 24, ao: true,  planar: .5, bloom: true, rain: 1 },
};
```
**落地点**：`examples/starter/src/scene.mjs` 用它驱动 renderer target size 与 shader define。

## 图集 B · 噪声纹理与 fbm（S2 的直接模板）

**原文要点**：JS 端 xorshift 生成 256²×4 数组 [src:L4206-L4206]；GLSL 端 value noise + 双档 fbm [src:L4192-L4195]。

```js
// CPU: 确定性噪声纹理
function makeNoise(seed) {
  let t = seed >>> 0;
  const rnd = () => (t ^= t << 13, t >>>= 0, t ^= t >>> 17, t ^= t << 5, t >>>= 0, t / 4294967296);
  const data = new Uint8Array(256 * 256 * 4);
  for (let i = 0; i < data.length; i++) data[i] = (rnd() * 256) | 0;
  return new THREE.DataTexture(data, 256, 256);
}
```
```glsl
// GPU: 5 octave 与 3 octave 共用一张纹理
float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return texture2D(tNoise,(i+f+0.5)/256.0).r; }
float fbm5(vec2 p){ float a=.5,s=0.; for(int i=0;i<5;i++){s+=a*n2(p);p=mat2(1.6,1.2,-1.2,1.6)*p+17.3;a*=.5;} return s; }
```
**落地点**：`examples/starter/src/noise.mjs`；配方 `.distill/distillation/recipes/00-sky.md`。

## 图集 C · onBeforeCompile 四步骨架（S4 的直接模板）

**原文要点**：闪烁材质 prepend 声明 → 替换 begin_vertex/color_fragment → 给缓存键 [src:pretty:L18627-L18651]。

```js
function injectBlink(mat, uTime) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = `attribute vec3 blink; uniform float uTime; varying float vBlink;\n` +
      shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
        float bph = fract(uTime / max(blink.x, 0.001) + blink.y);
        vBlink = blink.x <= 0.0 ? 1.0 : mix(0.02, 1.0, smoothstep(0.0, 0.06, bph) * (1.0 - smoothstep(blink.z, blink.z + 0.12, bph)));`);
    shader.fragmentShader = `varying float vBlink;\n` +
      shader.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
        diffuseColor.rgb *= vBlink;`);
  };
  mat.customProgramCacheKey = () => "my-blink";   // 漏写 = 随机渲染 bug
}
```
**落地点**：`examples/starter/src/materials.mjs`。

## 图集 D · 缓存键编码变体（S4）

**原文要点**：`"sl2|"+tint+(tile?"t":"")+(fade?"f":"")+(alphaCut?"a":"")` 组合键 + Map 复用 [src:pretty:L21333-L21357]；枪械键 `pac9-detail-<kind>` [src:pretty:L5607-L5631]。

```js
const cache = new Map();
function material(tint, { tile, fade, alphaCut }) {
  const key = `surf|${tint}${tile ? "t" : ""}${fade ? "f" : ""}${alphaCut ? "a" : ""}`;
  if (cache.has(key)) return cache.get(key);
  const m = build(tint, { tile, fade, alphaCut });
  m.customProgramCacheKey = () => key;
  cache.set(key, m);
  return m;
}
```

## 图集 E · 后处理状态袋（S6）

**原文要点**：十三路 uniform 分两行声明 [src:L4612-L4613]；CPU 侧 `post` 状态袋 [src:pretty:L7000-L7024]。

```js
const post = { damage: 0, lowHealth: 0, ads: 0, flash: 0, fade: 0,
               saturation: 1, focusDist: 0, shake: 0, wet: 1 };
// 每帧一次写入，不逐字段 set
for (const k of Object.keys(post)) uniforms["u" + cap(k)] && (uniforms["u" + cap(k)].value = post[k]);
```

## 图集 F · 声音规格表（S8）

**原文要点**：一条记录 = 一个声音 [src:pretty:L921-L945]。

```js
const VOICES = {
  explosion: { gen: synthExplosion, n: 2, sr: 22050, peak: .97, bus: "world", max: 3, pri: 10 },
  rain:      { gen: synthRain,      n: 1, sr: 22050, peak: .5,  bus: "world", max: 1, loop: 1 },
};
// 变体种子：hash(name) + variant * 7919
```
**落地点**：`.distill/distillation/recipes/05-synth-audio.md`。

## 图集 G · 检视协议（S9）

**原文要点**：URL 参数 → 上下文 → 全局入口 [src:pretty:L51928-L51952]。

```js
const params = Object.fromEntries(new URLSearchParams(location.search));
const ctx = { params, rng: seededRng(+(params.seed || 4207)), time: { t: 0, dt: 0, frame: 0 }, quality: QUALITY[params.q || "low"] };
window.__G = ctx;
window.__stats = () => ({ ...renderer.info.render, fps: 1 / ctx.time.dt, state: game.state });
```
**落地点**：`examples/starter/src/scene.mjs`（starter 自带这一层，便于 `render-starter.mjs` 量测）。

## 图集 H · 错误分诊（S9）

**原文要点**：按 marker 给 shader 报错归类 [src:L4132-L4132]。

```js
renderer.debug.onShaderError = (gl, program, vs, fs) => {
  const src = gl.getShaderSource(fs) || "";
  const label = src.includes("MY_POST") ? "post pass"
              : src.includes("MY_SKY")  ? "sky"
              : src.includes("MY_SHADOW") ? "soft shadow" : "material";
  console.error(`[render] shader error in ${label}: ${gl.getShaderInfoLog(fs)}`);
};
```

## 图集 I · 降级链（贯穿）

**原文要点**：chunk 布局校验失败退 stock PCF [src:L4296-L4296]；高级管线异常退回前向 [src:pretty:L7000-L7024]；`bench` 强制静音自启 [src:pretty:L51928-L51952]。

> 使用约定：所有骨架均需保留"保底路径"，否则不是同一套方法论。
