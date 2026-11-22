# 创物 · 天气（weather）

> 上游锚点：`sources/jimao-3a-game/index.html` L5729-L5825（雨条/溅射 shader、Fb 种子缓冲、Nb 工厂与雷暴调度） ｜ 我方资产：`assets/weather-kit.mjs`（`WEATHER_POOL_SPEC` 9000/260/900、22–55 s 雷暴） ｜ 对账：`harness/element-manifest.json` weather 族 ｜ 验收：`node harness/gates/complete.mjs --scene examples/parity`

## 构建法则

**法则 1 · 雨是体积，不是面片**：雨条不是铺在天上的一层纹理，而是一个跟随相机的 26×15×26 m 包裹盒；粒子位置用 `mod(p - camera + 0.5*box, box)` 环绕，风与下落速度合成 `uVel=(-2.6,-9.4,1.1)`，整盒 九千 条实例只占一个 draw call [src:L5757-L5759]、[src:pretty:L45379-L45385]。断言：相机走到哪里，雨域就跟到哪里；不存在“雨只下在场景中心”的破绽。

**法则 2 · 密度变化靠抽杀，不靠重建几何**：`uRain` 不是实例数，而是存活阈值——`fract(seed) > uRain` 的粒子被丢到裁剪空间外（`gl_Position=vec4(2,2,2,1)`），几何与缓冲恒定 [src:L5760-L5761]、[src:L5774-L5774]。檐口滴水同理，用 `0.55 + 0.45*uRain` 控制落水比例 [src:L5755-L5755]。因此雨量可以在 0..1 连续变化而不触发任何 CPU 重分配。

**法则 3 · 建筑内外是排除体，不是遮挡计算**：最多 4 个室内盒（`uBoxMin/uBoxMax`）与 8 个天窗矩形（`uSky`）：点在盒内且不在任一屋顶开口下方即 kill；反过来，雨可以从开口落进棚内 [src:L5729-L5744]。这条不变式把“雨穿屋顶”的视觉错误压缩成两次矩形判断，且完全在顶点着色器里完成。

**法则 4 · 每个雨滴对太阳做 Henyey-Greenstein 相位**：`wPhase(c)` 取 g=0.72 的前向散射，`vCol = uAmb + uSunCol * wPhase(dot(toP, uSunDir))` [src:L5734-L5734]、[src:L5770-L5773]。断言：雨幕的亮度有方向性——朝太阳看时整片发亮，背光时只剩环境灰；这是雨“被看见”的物理原因，不是加了一层透明贴图。

**法则 5 · 溅射只发生在水面或积水处**：溅射顶点采样积水 mask，`mask.r ≤ 0.49` 判为水；不在 mask 矩形内或非水格的粒子有 70% 被抽杀，室内盒再抬高 0.2 m 排除 [src:L5796-L5802]。水花在积水上取满尺寸、非水格缩到 0.65，保证“落在水洼里”与“落在干地上”读得出来 [src:L5803-L5804]。

**法则 6 · 雷暴是倒计时调度，不是每帧掷骰**：首闪 `A = 22 + rng*25` 秒，触发后重装填 `30 + rng*30` 秒，事件载荷 `intensity = 0.3 + 0.7*rng` [src:pretty:L45416-L45418]、[src:pretty:L45457-L45458]。断言：闪电必须有节奏感与可复现性；每帧概率会产生“连闪”或“十分钟无雷”，而倒计时把间隔变成可测试的状态。

## 完整链路

| 环节 | 内容 | 落点 / 证据 |
| --- | --- | --- |
| 意图 | 雨幕港区要同时有近处雨条、屋顶滴水、地面水花、可听可见的雷暴 | 世界常量：地板 x=30、海面 y=-1.6、檐口 z=-10.72 |
| 算法 | 相机包裹盒 + 逐实例种子 + 抽杀密度 + 室内/天窗排除 + HG 相位 + 积水 mask 溅射 + 倒计时雷暴 | [src:L5745-L5812]、[src:pretty:L45431-L45458] |
| 常量 | 雨条 9000×quality（下限 800）；滴水 260；溅射 900×quality；盒 26×15×26；风 (-2.6,-9.4,1.1)；滴水 T=1.19 s、x∈[-16,12]、y=7；mask 阈值 0.49；雷暴 22–55 s | `assets/weather-kit.mjs` `WEATHER_POOL_SPEC/WEATHER_TUNE_DEFAULTS` |
| 上游实现 | `Fb` 生成 `aSeed vec4` 实例缓冲；`Nb` 建 rain/splash 两 mesh，`renderOrder 900/890`；`uPix = 2tan(fov/2)/h` 做透视补偿 | [src:pretty:L45345-L45358]、[src:pretty:L45437-L45441] |
| 我方资产 | `createWeatherKit(THREE,{rng,events,level,camera,renderer,sky,post})`；`root` 挂场景，`update(dt)` 驱动 uniform、雷暴、sky `uFlash` 与 post `uThunder` | `assets/weather-kit.mjs` L303-L520 |
| 运行时证据 | parity note 记「9000 雨条 + 溅射 + 仓库室内盒排除 + 22–55 s 雷暴」；`kit.stats()` 自报 `rainStreaks/splashes/thunderEvents/drawCalls` | `examples/parity/scene.elements.json` weather note、`assets/weather-kit.mjs` stats |
| 门禁 | weather 族 `rainStreaks ≥ 800`；`thunderEvents ≥ 1`（required:false 只警告）；资产门禁 marker `WEATHER_POOL_SPEC / WEATHER_TUNE_DEFAULTS / WEATHER_DRAW_CALLS` | `harness/element-manifest.json` weather 族 |
| 失效与兜底 | 无室内数据 → `uDrip=0` 且雨盒全开；低画质 → 抽杀而非减实例，钳 800；mask 未接 → 默认 1×1 黑图按整场积水处理；雷暴事件载荷复用 → 消费方必须同步读取 | [src:pretty:L45451-L45456]、`weather-kit.mjs` 约定段 |

## 思维链

### 决策链一 · 雨怎么不穿过屋顶，又能从开口落进来

**约束**（事实）：场景有仓库/棚屋，屋顶有开口；不能为雨做逐三角遮挡，也不能让整片雨在室内消失。
**目标**（事实）：室内无雨、开口下有雨柱、屋檐有滴水线。
**候选**（推断）：A 深度图逐像素遮挡，成本高且半透明雨条写深度会污染；B 给每个室内盒做裁剪平面，盒多了状态切换爆炸；C 最多 4 个 AABB 加 8 个天窗矩形白名单。
**选择**（事实）：C。`wInside(p) && !wSky(p)` 即 kill；`uSky` 存 (x, z, halfW, halfD)，`wSky` 只做两次 abs 比较 [src:L5729-L5744]。
**兜底**（事实）：`update` 每帧从 `level.interiorBoxes` 前 4 个与 `level.skylights` 前 8 个重读；没有室内数据时 uDrip=0，雨盒退化为全天空 [src:pretty:L45443-L45456]。

### 决策链二 · 雨量从 0 拉到 1 时，怎样既连续又不掉帧

**约束**（事实）：满规格 9000 条雨条 + 900 片溅射，低端机必须能降；合同下限 八百 条不能跌破 [src:pretty:L45361-L45364]。
**目标**（事实）：雨量平滑变化，帧预算可预测，不出现“突然少一半雨”的跳变。
**候选**（推断）：A 动态重建 InstancedMesh，重分配与上传峰值不可控；B 改 `instanceCount`，同样有几何批次重排；C 固定缓冲、顶点着色器抽杀。
**选择**（事实）：C。`uRain` 阈值直接决定哪些 seed 存活，雨域与 buffer 不变；kit 侧以 0.8/s 逼近目标值，`visible` 只在 `rain > 0.01` 时打开 [src:pretty:L45431-L45436]。
**兜底**（事实）：`quality.rain` 缩档但 `minStreaks=800` 兜底；抽杀发生在顶点阶段，片元不会为死粒子付代价 [src:L5760-L5774]。

### 决策链三 · 雷暴为什么由天气系统自己调度

**约束**（事实）：单文件、无外部音频调度器；闪电要同时驱动天空 `uFlash`、后处理 `uThunder` 与音效，三处不能各掷各的骰子。
**目标**（事实）：一次雷暴只有一个事件源，间隔有节奏，强度有变化。
**候选**（推断）：A 每帧 `random()<p` 触发，泊松过程会产生不可控的连闪；B 固定 30 s 定时，重复感强；C 倒计时加随机重装填。
**选择**（事实）：C。首闪 22–47 s，之后 30–60 s 重装填，`emit("thunder",{intensity})` 一次广播给天空、后处理与音频 [src:pretty:L45416-L45418]、[src:pretty:L45457-L45458]。
**兜底**（事实）：事件载荷预分配复用，消费方必须同步读取；kit 把合同区间收敛到 二十二–五十五 s，并允许 `tune` 覆盖上下限 [src:pretty:L45457-L45457]。

**推断边界**：候选集与“作者为何排除 A/B”是反推；实例数、盒尺寸、风速、阈值、相位 g 值、雷暴区间均可在引用行内核对。上游首闪是 22–47 s、重装填 30–60 s，我方 kit 按 manifest 合同统一为 22–55 s，这是有意的参数重绑而非事实改写。

## 迁移法则

**资产路由**：weather 族唯一入口 `assets/weather-kit.mjs`。`createWeatherKit(THREE, opts)` 的 three 参数可缺省（无 three 时纯 CPU 调度、排除表与 `stats()` 仍可跑）；`root` 必须挂进场景，`update(dt)` 每帧一次。不要把雨/溅射拆成两个独立系统各自更新——它们共享 `uRain` 与时间基，拆开就会漂移。

**参数重绑点**：

| 参数 | 重绑到 | 注意 |
| --- | --- | --- |
| `quality.rain` | 画质档 | 缩档后仍钳在 `minStreaks=800` 以上 |
| `level.interiorBoxes` | 关卡数据 | 只读前 4 个，自动 ±0.15 外扩、y −1/+0.3 |
| `level.skylights` | 关卡数据 | 只读前 8 个，`(x,z,w/2,d/2)` 映射到 `uSky` |
| `maskTexture/maskRect` | 地面族积水 mask | 不传则 1×1 黑图，整场按积水处理；传了才区分水花 |
| `events.emit("thunder")` | sky-deck `uFlash` + post `uThunder` + 音频 | 只允许一个调度源，场景不要二次触发 |
| `wind/box` | 场景尺度 | 改盒尺寸必须同步 `uPix` 与远淡出阈值，否则近处雨条变粗 |

**对账行**：`harness/element-manifest.json` weather 族（`asset: assets/weather-kit.mjs`，floors `rainStreaks ≥ 八百`、`thunderEvents ≥ 1`，upstream refs `[src:pretty:L45423-L45485]`）；`examples/parity/scene.elements.json` weather 条目（rainStreaks/splashes/thunderEvents/drawCalls）；资产门禁 marker `WEATHER_POOL_SPEC / WEATHER_TUNE_DEFAULTS / WEATHER_DRAW_CALLS`。三处同时成立才算天气族完整落地。
