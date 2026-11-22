# 03 · 渲染管线：从 WebGL 上下文到出画

> 证据：原始行号引用 + 展开源码（`evidence/frames/app.pretty.js`）+ 运行时捕获。
> 本篇回答：画面是怎么"排班"的，光照怎么算，画质预算怎么守住。

## 管线总览

高级管线是一条**单文件手写流水线**，不是 EffectComposer。核心装配在 render 系统里完成（L4744 巨行，展开后约 2,300 行）：

1. **上下文**：`new WebGLRenderer({canvas:"#view", antialias:false, powerPreference:"high-performance", alpha:false, depth:true, stencil:false})`，随后 `autoClear=false`、`info.autoReset=false`、`shadowMap.autoUpdate=false`——三处"手动化"把每一帧的清屏、统计、阴影更新权都拿回自己手里。MSAA 不在上下文上开，而是按画质档在**渲染目标**上设 `samples`（`test/medium/high/ultra` 为 0/2/4/4）[src:pretty:L1044-L1068]。
2. **双相机**：主相机 `fov:74, near:0.08, far:900`，rotation order `YXZ`（FPS 标准序）；武器相机 viewFov:五十四, near:0.01, far:十 挂在独立 layer 上 [src:pretty:L1044-L1068]。两台相机分开近裁剪面——枪模贴脸也不会被裁掉。枪模渲染前还把 `depthRange` 压到极小切片，避免改写主场景深度。
3. **每帧排班**：`info.reset()` → 更新 `uTime/uFlash`（云内闪电衰减曲线 `power*exp(-5t)*(0.55+0.45*sin(47t)*sin(13t+1))*0.35`，t>0.9s 归零）→ 执行 `addPrePass` 注册的前置 pass → 高级管线或回退路径 → `setRenderTarget(null)`。统计在帧尾读 `renderer.info`（calls/tris）。
4. **降级保险**：整个高级管线包在 try/catch 里，一旦着色器编译失败，`console.error("[render] advanced pipeline disabled, falling back to forward rendering")` 后置回前向路径——**豪华版是可选的，游戏必须能跑**。
5. **错误分诊**：`renderer.debug.onShaderError` 里按 marker 把错误归类——命中 SALTLINE_POST 报 "post pass"、SALTLINE_SKY 报 "sky"、软阴影块报 "material (soft shadow chunk active)"，否则计入 `other` [src:L4132-L4132]。这不是炫技，是把"哪个系统炸了"变成一行日志。

**自适应分辨率**是管线的预算警察：resize() 里按画质档查像素预算（low:1e6 / medium:15e5 / high:23e5 / ultra:37e5 像素），实际尺寸乘 dpr(≤2) × quality.scale 后若超预算，按 `sqrt(预算/实际)` 缩回 [src:pretty:L1044-L1068] [src:pretty:L7000-L7024]。低画质档 render target 实测只有 358×202（capture-frames 实测 `res:[358,202]`），从根上压住软渲染的帧时。

## 色调映射与曝光

- 上下文层 `toneMapping = ACESFilmic`、exposure = 1（场景材质统一在 ACES 下调色）[src:pretty:L1-L25]。
- 后处理层再做一次 **AgX 拟合**（Filament/Blender 版，注释明确写 "as in three.js"）：`SL_SRGB_TO_REC2020 → log2 压缩 (-12.47, 4.03) → slAgxContrast 多项式 → outset → sRGB`，并用 uAgxMix 与 ACES 混合 [src:L4615-L4625]。
- 曝光有两级：全局 `exposure` + 自动曝光开关（`autoExposure` getter/setter 暴露在 render 句柄上）；室内外切换时环境强度按 interiorBoxes 命中检测缩放（室内再乘 `viewFill:1.35` 的倒数效应）[src:pretty:L7000-L7024]。
- 末段输出侧还有：亮度加权的胶片颗粒（`g*uGrain*mix(1,0.3,smoothstep(.25,.9,lum))*...`，暗处颗粒多、亮处少）、针对天空色带的抖动 [src:L4735-L4740]。

## 天空

`SALTLINE_SKY` 是一段约 90 行注释齐全的程序化天空着色器 [src:L4207-L4295]，结构即"美术方向决定物理近似"的教材：

- **云层几何**：云"roughly east-west"滚向；云底用 ridged fbm 做 ripple，且随距离衰减抗锯齿 [src:L4230-L4243]。
- **构图约束写进代码**：云甲板在东侧地平线留缺口，太阳永远从缺口烧穿——"the sun always burns through a ragged hole in the gap, never sits behind solid cloud" [src:L4243-L4251]。
- **光照近似**：密度梯度朝太阳 = 云底自阴影；薄片处透冷光、底面被暖光斜照，缺口边缘烧红 [src:L4254-L4269]。
- **事件化天气**：云内闪电（sheet lightning）走 `uFlash` uniform，由 CPU 端衰减曲线驱动 [src:L4269-L4272]。
- **工程化收尾**：远云融进地平线色（aerial perspective）、太阳盘面不进环境捕获（"the directional light is the sun there"）、PMREM 防火蝇 [src:L4272-L4291]。
- 地平线下用海雾/地面反弹色兜底 [src:L4284-L4284]。

天空的输入只有：太阳方向、天顶/地平线/远地平线三色、雾色（常量表 [src:pretty:L1044-L1068]）+ 时间 + 一张 256² 程序化噪声纹理（JS 端 xorshift 生成 [src:L4206-L4206]，GLSL 端 `fbm5/fbm3` 采样 [src:L4192-L4195]）。

## 阴影

阴影是三段式工程：

1. **基础**：平行光太阳（castShadow），`shadow.mapSize = min(quality.shadow, maxTextureSize)`，bias:-1.2e-4, normalBias:0.02, radius:1，autoUpdate 打开但受帧间节流（ultra 档每帧更新，其他档隔帧或按需）[src:pretty:L7000-L7024]。
2. **手术**：`// SALTLINE_SHADOW` 区块对 three 的 `shadowmap_pars_fragment` 做 `s.slice(0,o)+l+s.slice(a)` 字符串替换 [src:L4349-L4351]，替换进去的是 PCSS 软阴影：blocker search（8 taps）+ penumbra 随遮挡距离增长 + 视野边缘淡出 [src:L4296-L4348]。tap 数按画质档 `low?十:16` [src:L4296-L4296]。
3. **语义**：注释把单位写死——"metres across the shadow map"、"never bias more than ~0.6 m per kernel"，把物理直觉压进参数命名。

## 后处理

后处理是**单 pass 全屏 shader**（SALTLINE_POST），十三路 uniform 控制全画幅观感：`uBloom/uDirt/uStreak/uFlare/uCA/uVignette/uDamage/uLowHealth/uAds/uFlash/uFade/uSaturation/uThunder` [src:L4612-L4613]。值得抄的设计：

- **输入按语义分组**：第 4612 行全是"镜头光学"，第 4613 行全是"游戏状态"（受击、低血、开镜、闪光、淡出、雷暴）——两条数据流在 shader 入口处就分开 [src:L4612-L4613]。
- **AA 策略**：Kawase 风格双 tap + 边缘检测，"light unsharp mask, backed off on strong edges (those belong to FXAA)"——锐化让位给去锯齿，互不打架 [src:L4728-L4734]。
- **状态后处理**：受击红闪（uDamage）、低血脉冲（uLowHealth）、开镜景深感（uAds + focusDist）、雷暴白闪（uThunder）全部走同一入口，CPU 侧对应 `post:{damage,lowHealth,ads,flash,fade,saturation,focusDist,shake,wet}` 状态袋 [src:pretty:L7000-L7024]。
- 灯光池：6 盏复用 PointLight 做枪口闪光（`userData:{busy,ttl,dur,peak,persistent}`，过期回收）[src:pretty:L7000-L7024]。

## 实测校验

- `node harness/capture/frames.mjs --assert`：bench 模式 p50 265 draw calls/帧、渲染器自报 107 programs、1.8M tris——与"单 pass 后处理 + 少量全屏 pass"的结构一致。
- `evidence/shaders/chunk-diff.json`：大着色器 82K 字符中作者手写 88%——管线观感不靠堆 pass，靠写 shader。
