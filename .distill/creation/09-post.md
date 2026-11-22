# 创物 · 后处理（post）

> 上游锚点：`// SALTLINE_POST` 后处理组（sources/jimao-3a-game/index.html L4349-L4743：共享助手 L4350-L4356、AO L4362-L4390、体积光柱 L4405-L4453、合成 L4477-L4499、bloom 金字塔 L4525-L4560、自适应曝光 L4563-L4587、grade 主 pass L4612-L4712、AA/颗粒 L4714-L4742；管线装配与运行时在 L4744-L4744）｜ 我方资产：`assets/post-chain.glsl`（shader-035-frag）、`assets/post-aa.glsl`（shader-037-frag）、`assets/shafts.glsl`（shader-021-frag）｜ 对账：`harness/element-manifest.json` post 族（floor：postPasses ≥ 5、bloomLevels ≥ 2）｜ 验收：`node harness/gates/complete.mjs --scene examples/parity`

## 构建法则

**法则 1 · 分辨率是排班表的第一列**：全分辨率只留给「必须逐像素」的 pass——场景 RT、合成、grade、final；AO 与体积光柱一律半分辨率（`hw=ceil(w/2)`），bloom 金字塔 6 级逐级折半，streak 挂在第 3 级（约 1/8 宽）上；自动曝光更是只有 1×1 像素 [src:pretty:L7000-L7024]。半分辨率产物绝不直接放大上屏：合成 pass 用联合双边 4-tap 上采，权重 `1/(0.015+|dz|/z)` 按深度差衰减，深度缝不渗色 [src:L4477-L4486]。

**法则 2 · 半分辨率 pass 各配一个「深度感知模糊」**：AO 与体积各跑两趟可分离模糊，唯一差别是深度容差 define——AO 用 `BLUR_TOL 0.04`（保边缘），体积用 `BLUR_TOL 0.30`（它是低频介质，糊即是物理）[src:pretty:L7000-L7024]。模糊核本身按深度差加权、采样深度钳 300m 防天幕远值污染 [src:L4501-L4512]。同一shader、不同容差：这是「模糊强度跟着信号物理走」的样板。

**法则 3 · AO 属于环境光，不属于太阳**：AO 乘到最终色前先测亮度 `lit = smoothstep(0.16, 0.85, luma*slExposure())`，强光像素的 AO 强度按 `(1 - 0.8*lit)` 衰减——被太阳照亮的表面不许挂脏晕；且遮挡色微冷 `(0,0.03,0.07)`，模拟天光缺口 [src:L4492-L4496]。AO tap 数按画质档 8/12/16 以 defines 重编译，半径随距离自适应缩放 [src:L4369-L4390][src:pretty:L7000-L7024]。

**法则 4 · bloom 是能量守恒的 mix，不是加法**：亮度进入 bloom 用 `col = mix(col, bloom, uBloom)` 而非 `col += bloom`——总能量不随 bloom 强度单调上涨，提亮的同时压原始信号 [src:L4675-L4679]。金字塔首级下采用部分 Karis 平均杀火蝇：权重 `1/(1+luma*0.08)`，中心四元组权重 0.5，注释点明 "tames fireflies without killing the sun" [src:L4532-L4536]。streak 是变形宽银幕语言：从 down[2] 起两趟横向高斯（1.5 与 5 texel 步长），第一趟带曝光归一阈值 `uThreshold/max(slExposure(),0.2)`、第二趟无阈值收尾 [src:L4553-L4553][src:pretty:L7000-L7024]。

**法则 5 · 光学缺陷是「有据可查的加法」**：镜头污渍是启动期烘一次的 五百十二×二百八十八 纹理（七十 个随机凸 Disc + fbm 污痕 + 拉丝），乘在 bloom 上走乘法、加在 flare 上走 1.5 倍增强 [src:L4675-L4679][src:pretty:L7000-L7024]。太阳 glare/flare 全部乘遮挡可见性 `vis` 才允许出现（`vis>0.002` 才算），可见性由 12 个 Vogel 点对深度图测得、出视野再线性淡出 [src:L4563-L4581][src:L4647-L4660]。色差按径向 `c*r2*(uCA+uDamage*0.006)`，受伤时略增 [src:L4669-L4672]。每一项缺陷都能指着公式说清「为什么存在、何时消失」。

**法则 6 · 色彩管线是双曲线混血 + 编译期分级**：曝光先乘自适应项（`uExposure * clamp(pow(key/lum,0.85), min, max)`，1×1 ping-pong、时间常数 1.5s、NaN 守卫）[src:L4356-L4356][src:L4582-L4587]，再进 filmic 曲线 `mix(slAces(col), slAgx(col), uAgxMix)`——ACES 出烧橙、AgX 滚白，0.25 偏 ACES [src:L4687-L4688][src:L4615-L4626]。「punchy」风格（对比 1.18、饱和 1.22）是 `LOOK_POWER/LOOK_SAT` 编译期 defines，不是运行时 uniform [src:pretty:L7000-L7024]。grade 链顺序固定：split-tone（青阴影暖高光）→S 曲线→提黑→玩法驱动饱和衰减→暗角（基础+低血+开镜）→伤害红边脉冲→fade→sRGB，且 grade 输出的 alpha 通道自带 Rec.601 亮度，专门供 final pass 的 FXAA 当边缘检测输入 [src:L4690-L4712]。

**法则 7 · 每个 pass 都要能被单独关掉和归因**：URL 参数逐项裁剪（`ao/vol/bloom/mb/post`），pass 缺席时对应 RT 链与 uniform 同步置零 [src:pretty:L7000-L7024]；每段 shader 以 `// SALTLINE_POST <pass名>` marker 开头，shader 编译错误按 marker 归因到具体 pass 再抛错 [src:L4349-L4356][src:pretty:L7000-L7024]。整链初始化失败退前向管线（renderer 层 ACES + 0.6×exposure），运行中某 pass 编译失败则当帧抛错、外层 catch 永久切回前向——豪华是可选的，出画是必须的 [src:pretty:L7000-L7024]。

## 完整链路

| 环节 | 内容 | 上游证据 | 我方落点 |
| --- | --- | --- | --- |
| 意图 | 观感的最后一公里：体积、辉光、镜片、影调、玩法反馈，全部收敛进一条可裁剪的 pass 链 | [src:L4349-L4356][src:pretty:L7000-L7024] | post-chain/post-aa/shafts 三资产 |
| RT 拓扑 | 全屏 3（scene/motion/ldr）+ 半屏 4（depthHalf/aoA/aoB/volA/volB 中 4）+ down×6/up×5 + streak×2 + adapt 2×1px + dirt 512×288；`EXT_color_buffer_float` 探测定 depthHalf 格式 | [src:pretty:L7000-L7024] | 接入时按自家分辨率重建 |
| pass 序 | depthhalf → AO×2 模糊(tol .04) → 体积×2 模糊(tol .30) → 合成上采 → [motionBlur 可选] → bloom 6 down(首级 Karis)+5 up → streak×2 → adapt → grade → final(FXAA+锐化+颗粒+抖动) | [src:pretty:L7000-L7024] | 次序不可乱：adapt 必须在 grade 前写完 |
| 体积光柱（shafts） | 半分辨率 raymarch `VOL_STEPS`（档位 10/12/16/24/40，运行时 max(6,档))：双叶 Henyey-Greenstein `hg(mu,0.78)*0.55+hg(mu,0.25)*0.45`、近距加权 mix(2.3,0.55,4-85m)、室内盒 uBoxDust×6 加尘、远场解析延拓进地平线色 | [src:L4425-L4443][src:L4445-L4452][src:pretty:L1044-L1068] | `assets/shafts.glsl`（tDepthHalf=线性视距·米） |
| 常量表（TUNE 27 参） | volSigma .0034 / volMaxDist 170 / aoRadius .9 / bloom .065 / bloomMix .62 / dirt .1 / streak .03(thr 2.2) / flare .16 / key .12 / 曝光钳 [0.6,2] / adaptTau 1.5 / agxMix .25 / ca .0013 / vignette .3 / grain .02 / sharpen .3 | [src:pretty:L31361-L31361][src:pretty:L7000-L7024] | 接入先抄原值再按屏寸标定 |
| 玩法状态流 | CPU 状态袋 {damage,lowHealth,ads,flash,fade,saturation,…} 每帧钳 [0,1] 整体写 uniform；饱和/暗角/红边全由它驱动 | [src:pretty:L7000-L7024][src:L4699-L4709] | 事件系统 → post 状态袋一层映射 |
| 太阳屏幕链 | 太阳点=cam+dir×500 投影；正前方 dot>0.05 门控；出视野 (|ndc|-1)/0.3 线性淡出；喂 adapt 可见性与 grade flare | [src:pretty:L7000-L7024][src:L4574-L4581] | 需要每帧相机与太阳方向 |
| 运行时证据 | capture：shader-035-frag（grade）、shader-037-frag（final）、shader-021-frag（vol）；`readAdapt()` 回读 {lum,auto,sunVis}；bench 实测 265 draw calls 量级与单链结构一致 | [src:pretty:L7000-L7024] | examples/parity 截图 diff |
| 门禁 | post 族 floor：`postPasses≥5`、`bloomLevels≥2`（required:false） | manifest post 条目 | `node harness/gates/complete.mjs --scene examples/parity` |
| 失效模式与兜底 | 初始化失败→前向回退（ACES+0.6 曝光）；pass 编译失败→当帧抛错永久回退；画面灰白→查曝光链（自适应真读到了吗、min/max 钳）；太阳糊白→bloom 阈值与 volSigma×sunRad；色带→final 抖动与 depthHalf 精度；帧时超标→dynres 控制器降 scale（21.5/17.4ms 阈值、0.6 地板、连续地板命中再降画质档并广播 quality:auto） | [src:pretty:L7000-L7024] [src:pretty:L32043-L32043] | 兜底层级必须整套移植 |

## 思维链

### 决策链 A · 分辨率预算的分配逻辑

**约束**（事实）：目标机含集显，dynres 控制器以 21.5ms/17.4ms 为降/升阈值、0.6 为 scale 地板，说明帧预算以 60fps 为轴心 [src:pretty:L7000-L7024] [src:pretty:L32043-L32043]。
**目标**（事实）：AO、体积、bloom、streak、自适应曝光全都要，但不能任何一个占满全屏带宽。
**候选**（推断）：A 全分辨率跑 AO+体积——带宽×4，低档必炸；B 四分之一分辨率——体积够用但 AO 在主视线上糊出轮廓；C 半分辨率 + 深度感知模糊 + 联合双边上采，bloom 再往下折半六层，曝光缩到 1px。
**选择**（事实）：C。半屏拓扑与上采权重在合成 pass 里闭环 [src:pretty:L7000-L7024][src:L4477-L4486]；bloom/streak/adapt 的尺寸都由同一张 `M` 表派生，resize 一处改全链 [src:pretty:L7000-L7024]。
**兜底**（事实）：`EXT_color_buffer_float` 不在时 depthHalf 退回整型 RT（线性视距精度降但仍可用）；整链构造失败连回退路径都写好了（前向 + ACES）[src:pretty:L7000-L7024]。分辨率决策的本质是「信号的频谱决定它的采样密度」——体积与 bloom 是低频，AO 边缘是中频，grade/final 是全频。

### 决策链 B · 为什么 ACES 和 AgX 各留 75%/25%

**约束**（事实）：场景是烧橙的落日+大范围天光，要求「高光烧得起来、白得下去」；上游注释原文给出态度："ACES (Hill fit) for punch and burning oranges, pulled toward AgX so highlights roll off to white" [src:L4687-L4688]。
**目标**（事实）：一条曲线同时拿到 ACES 的饱和推力与 AgX 的高光滚动。
**候选**（推断）：A 纯 ACES——落日橙够烧，但高光偏色、肤色区易崩；B 纯 AgX——白得优雅，橙色不烧、场景发灰；C 混合，比例做成 uniform 可调。
**选择**（事实）：C，`uAgxMix=0.25` 定版（偏 ACES）；再叠 `LOOK_POWER 1.18 / LOOK_SAT 1.22` 编译期分级补偿 AgX 摊薄的中频对比 [src:pretty:L7000-L7024][src:L4615-L4626]。
**兜底**（事实）：前向回退路径没有后处理曲线可用，直接用 renderer 层 `ACESFilmic + 0.6*exposure` 保底观感 [src:pretty:L7000-L7024]——回退态与豪华态共享「ACES 为主」的审美基线，切换不至于变画面性格。

### 决策链 C · 曝光闭环为什么要能读回 CPU

**约束**（事实）：自动曝光在 GPU（1px ping-pong），但截图管线、HUD 统计、回归测试都需要知道当前画面亮度；`fast`（截图模式）下还要求曝光立即可用而非等 1.5s 收敛 [src:L4563-L4587][src:pretty:L7000-L7024]。
**目标**（事实）：GPU 独占测光，CPU 只读不写，两端永不漂移。
**候选**（推断）：A CPU 侧再算一遍平均亮度——与 GPU 结论必然不一致；B 纯 GPU、CPU 永远不知道——截图/统计失明；C GPU 权威 + `readAdapt()` 把 1px RT 读回（half-float 解码，钳回 [0.6,2]）。
**选择**（事实）：C。adapt pass 顺带在同一 RT 的 g 通道写太阳可见性，一次读回两个量 {lum,auto,sunVis}；`stats()` 只在 shot 模式暴露它 [src:pretty:L7000-L7024][src:L4582-L4587]。
**兜底**（事实）：NaN/首帧守卫 `if(!(a>0.0)||a>1e4) a=avg`、前两帧与 fast 模式 `uRate=1` 直达、稳态按 `1-exp(-dt/1.5)` 缓动 [src:L4584-L4586][src:pretty:L7000-L7024]。测光值既驱动画面又能被审计，是这个闭环区别于「有自动曝光」的标志。

**推断边界**：三条链的候选清单与「频谱决定采样密度」「审美基线共享」两条因果归纳为推断；RT 尺寸、TUNE 数值、混合比例、读回接口均为行号可查事实。post 侧视觉令牌（青阴影/暖高光、烧橙落日）以上游注释与常量为准，不属臆测。

## 迁移法则

- **资产路由**：`assets/post-chain.glsl`（grade 主 pass，AgX/flare/调色/玩法反馈全套）+ `assets/post-aa.glsl`（FXAA+锐化+亮度加权颗粒+1/255 抖动）+ `assets/shafts.glsl`（体积光柱积分）三件配套，均原样移植、uniform 名保持上游 [src:L4612-L4712][src:L4714-L4742][src:L4425-L4452]。
- **参数重绑点**：TUNE 二十七 参整表照抄起步 [src:pretty:L31361-L31361]；`LOOK_POWER/LOOK_SAT` 必须以 defines 编译期注入（上游 grade pass 无此 uniform）[src:pretty:L7000-L7024]；`tDepthHalf` 合同是**线性视距（米）**，用硬件深度时在采样处换算；`uBoxDust/uBoxMin/uBoxMax` 对接自家室内盒（无室内则置 0）[src:L4435-L4443]；太阳屏幕位置与可见性每帧由相机重算 [src:pretty:L7000-L7024]；adapt ping-pong 与 `readAdapt` 作为可审计接口保留。
- **对账行**：`harness/element-manifest.json` → `id:"post"`，floor `postPasses≥5`、`bloomLevels≥2`，detail 钉死「半分辨率 SSAO(12 tap)、体积雾采样太阳阴影图、6 级 bloom+变形条纹、1×1 自动曝光、镜头污渍、AgX 混合、CA/暗角/颗粒/锐化/FXAA、每 pass SALTLINE_POST marker 可归因」；文档锚 `references/11-element-parity.md#post`；验收 `node harness/gates/complete.mjs --scene examples/parity`。
