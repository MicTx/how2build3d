# 元素对账：上游有什么、我们下限是多少、判红看哪里

> 这份文档解决一个具体的失败模式：**场景技术全绿，但元素是空壳**。
> 上游 Saltline 的「同水准」不是一个形容词，而是一张可数的清单——35 类道具、22 种贴花、
> 上游 51 种材质（我方 48 个条目，`SL_MATERIALS`）、29 套纹理、57 条声音规格（55 可播 + 2 张生成 IR）、2 种骨骼敌人、上游 11 个 HUD 组件（我方 10）、四区手写布局。
> 本文件把它们逐族写成**下限**，由 `harness/gates/complete.mjs` 读取执行。

三份文件构成合同：

| 层 | 文件 | 作用 |
| --- | --- | --- |
| 合同 | `harness/element-manifest.json` | 18 族的上游计数、我方资产、展厅、下限指标 |
| 申报 | `<scene>/scene.elements.json` | 本场景逐族 `used` / `n/a`（含理由与替代证据）+ `tier` |
| 实测 | `window.__PARITY__.counts` | 运行时**遍历/工厂自报**的计数，不许手填常数 |

判红规则（`complete.mjs`）：结构不全 → 红；`tier=full` 时任一 used 族低于下限 → 红；
used 族没有展厅三张截图 → 红。`tier=visual|game` 只做结构与广度检查，不套同水准下限。

```bash
node harness/gates/complete.mjs --self-test                       # 正负样例
node harness/gates/complete.mjs --scene examples/quality          # tier=visual
node harness/gates/complete.mjs --scene examples/gameplay         # tier=game
node harness/gates/complete.mjs --scene examples/parity           # tier=full，逐族下限生效
node harness/gates/complete.mjs --scene <dir> --structure-only    # 脚手架/CI 快速检查
```

## props

道具与零件目录。上游 35 类占位尺寸 + 17 个参数化 builder，其余回落到带碰撞盒的通用盒；
关卡里约 一百八十 处**手写坐标**摆放（不是随机散布）[src:pretty:L35069-L35106] [src:pretty:L37358-L37375]。

- 资产：`assets/props-kit.mjs`（尺寸表 + builder + 碰撞盒）。
- 展厅：`props`。下限：道具种类 ≥12、场中实例 ≥60。
- 判红信号：道具全是同一个盒子换了缩放；实例数过百但种类 <5。

## decals

Canvas 贴花与标识排版。22 种贴花（危险品/电压/禁止/箭头/四组 logo/泊位号/警示条/油渍/锈水/弹孔/焦痕/裂纹/涂鸦/检验铭牌/数字）[src:pretty:L33225-L33310] [src:pretty:L33585-L33620]。

- 资产：`assets/props-kit.mjs` 的贴花表（Canvas 生成，不走图片资产）。
- 展厅：`props`。下限：贴花种类 ≥6、场中贴花数 ≥15。
- 判红信号：一个场景零贴花——上游连箱门重量勾稽都要印上去。

## materials

材质目录。五十一 种命名材质，每种带 `tint/rough/metal/wet[4]/macro[4]`，湿痕与水珠是参数不是贴图 [src:pretty:L34087-L34160]。

我方 48 个条目（`SL_MATERIALS`，`assets/sl-surface.mjs`），上游 51 种仅作溯源对照；我方实际条目以运行时导出为准。

- 资产：`assets/sl-surface.mjs`（`SL_MATERIALS` + `createSurfaceMaterialFactory`）。
- 展厅：`mats`。下限：材质条目数 ≥16。
- 判红信号：`new THREE.MeshStandardMaterial({ color })` 遍地——那是 `examples/gameplay` 的**刻意反面样本**，不是可交付做法。

## textures

程序化 PBR 纹理集。27 个 `surf()` 生成器 × 29 套纹理集，MRT(count=3) 出 albedo/ORM/高度，
Sobel 高度转法线；fbm/voronoi/scratch/paint-chip 模型全部在 GLSL 里 [src:pretty:L34043-L34086]。

- 资产：`assets/sl-textures.mjs`（`createTextureFactory`）。
- 展厅：`mats`。下限：纹理集数 ≥10。
- 判红信号：纹理来自图片文件；同一材质各建各的噪声图。

## sky

程序化天空与云甲板。ridged 云底、太阳烧穿云洞、云内闪电 `uFlash/uFlashDir`、大气透视；
同一 shader 的 `uEnv` 变体烘 PMREM [src:pretty:L30644-L30740]。

- 资产：`assets/sky-deck.glsl`。展厅：`backdrop`。下限：天空 pass ≥1。
- 判红信号：用 `scene.background = new Color(...)` 加一个渐变球当天空。

## sea

海面。环形几何级差网格 + 涌浪位移 + 太阳碎光「猫爪」高光 + 波法线重建 + 雾 [src:pretty:L45181-L45240]。

- 资产：`assets/sea.glsl`。展厅：`backdrop`。下限：海面网格 ≥1（无水域场景可 n/a）。
- 判红信号：海面是一张平面 + 蓝色透明；没有随距离增长的分辨率。

## ground

地面：湿痕/积水/接缝/标线。生成 mask/detail/normal 三张 RT + 2048 标线画布；
积水深度函数按区域（室内 .12 / 室外 .6 / 码头 1）+ 水滴环涟漪 + 平面反射前置 pass [src:pretty:L44697-L44860]。

- 资产：`assets/ssr-wet.glsl`（AR 地表段 + 反射混合）。展厅：`ground`。
- 下限：地面层次 ≥2（mask/detail/marking/puddle 中至少两类）、积水区块 ≥3。
- 判红信号：整块地面一张平铺纹理；有反射但反射里没有世界。

## weather

雨与雷暴。约 9000 条 instanced 雨条 + 900 片溅射；最多 4 个室内盒 + 8 个天窗矩形排除，
雨能从屋顶开口落进棚内；雷暴按 二十二–55s 随机调度，驱动天空 uFlash、音效与后处理 uThunder [src:pretty:L45423-L45485]。

- 资产：`assets/weather-kit.mjs`。展厅：`ground`（雨落在地面上）。
- 下限：雨条实例 ≥800；雷暴事件 ≥1（可选指标）。
- 判红信号：`uRain` 常量不是被系统驱动；雨只落在外景、棚内照下。

## post

单 pass 后处理链。半分辨率 SSAO(12 tap)、体积雾采样太阳阴影图、6 级 bloom + 变形宽银幕条纹、
1×1 自动曝光 ping-pong、镜头污渍、AgX 混合调色、CA/暗角/颗粒/锐化/FXAA；
每个 pass 有 SALTLINE_POST marker 可按系统归因 [src:pretty:L31177-L31260]。

- 资产：`assets/post-chain.glsl` + `assets/post-aa.glsl` + `assets/shafts.glsl`。
- 展厅：`render`。下限：后处理 pass ≥5（scene/shafts/composite/post/aa）。
- 判红信号：后处理只有一条 `Color` 调色；曝光写死；发光体 HDR ≤1 却怪 bloom 不亮。

## shadow

软阴影（PCSS）。Vogel 盘 + blocker search + receiver-plane bias，按档 10/16 tap；
`SL_FRUSTUM/SL_DEPTH` 是**按阴影相机标定**的常数，布局校验失败即退回 stock PCF [src:pretty:L30840-L30890]。

- 资产：`assets/pcss-shadow.glsl`。展厅：`render`。
- 下限：阴影图 ≥1；PCSS 采样 ≥10（可选指标——用 stock PCF 会被记为 0）。
- 判红信号：改了阴影相机范围却没重标定 `SL_FRUSTUM`，半影全糊或全硬。

## enemies

敌人：骨骼/IK/感知。两种机器：隼（四旋翼飞行、banking、避墙）与猎犬（四足 2 骨 IK、
脚踩地身体前移、落后超过阈值迈步）；命中区头 ×2.2；感知 `sightRange 45 / 锥 200° / hearRadius 45`；
攻击令牌同时 2 个、按类型轮换、间隔 1.25s [src:pretty:L56171-L56190] [src:pretty:L56650-L56670] [src:pretty:L57429-L57440]。

- 资产：`assets/enemy-kit.mjs`（骨骼 + 动画）+ `assets/combat-kit.mjs`（感知/令牌，勿重写）。
- 展厅：`enemies`。下限：类型 ≥1、刷兵点 ≥6、可动画 rig ≥1。
- 判红信号：敌人是悬浮胶囊；走路靠整体位移；同时开火数不受控。

## weapon

武器视图模型与手感。PAC-9：手写 2D 型材挤出（49 段导轨槽、4 个材质槽）、
9 通道弹簧阻尼（`kZ 520/30`、`kP 380/26`…）、后坐分离（视觉 0.35 / 瞄准）、ADS fov 五十二、枪相机 五十四° [src:pretty:L54827-L54870] [src:pretty:L55096-L55120]。

- 资产：`assets/weapon-kit.mjs`。展厅：`weapon`。
- 下限：视图模型网格 ≥1、弹簧通道 ≥9（无第一人称武器可 n/a）。
- 判红信号：枪随相机硬贴；后坐直接改瞄准角（准星和画面对不上）。

## fx

FX：枪口焰/弹道/弹着/水花/贴花。lit + additive 两套 GPU billboard 池、tracer 48、debris 256、
shell 60、decal 160，合计 5 draw call；API 十一种：
`muzzleFlash/tracer/impact/sparks/smoke/dust/explosion/shell/splash/debris/decal/addEmitter` [src:pretty:L48488-L48510]。

- 资产：`assets/fx-kit.mjs`。展厅：`fx`。下限：FX 种类 ≥5、粒子池 ≥2。
- 判红信号：每个弹道一个 Mesh；枪口焰用点光源冒充；弹着没有表面区分。

## audio

合成音频。**上游 57 条规格**（50 个非音乐可播名 + 5 个音乐声部 + 2 张生成 IR；可播 55 条），字段 `gen/n/sr/peak/bus/max/pri/boot/loop/music/ir`；
6ms/12ms 预算的懒合成；五声部音乐按战斗强度 0.15/0.6/1 交叉淡化 [src:pretty:L50465-L50521] [src:pretty:L50664-L50670]。

**我方 58 条**（51 个非音乐可播名 + 5 声部 + 2 IR；`stats()` 自报 playable 56），按声音角色重编目录而非逐名克隆；
总线 world22/near10/dry7/music4/amb1 是重绑后的 5 条，不是上游原样。

- 资产：`assets/audio-kit.mjs`。展厅：`fx`（声音不可拍，用频谱/峰值证据代替）。
- 下限：规格条目 ≥16、音乐声部 ≥1、总线 ≥3。
- 判红信号：`AudioContext` 存在但 `--require-audio` 下 peak ≈ 0；音效来自音频文件。

## hud

HUD 与 UI 设计系统。罗盘带（−90°..450°/5° + 目标标记）、目标面板 + 3 继电器 pip、
准星随散布、命中标记三态、4 向伤害弧（SVG）、交互环、事件流、中央消息、
血量 十 段、弹药 + 弹匣 pip、无线电行、开场地点卡 [src:pretty:L57923-L57960]。

我方 10 个组件（`HUD_COMPONENTS`，`assets/hud-kit.mjs`），上游 11 个组件仅作对照；11 不计给我方。

- 资产：`assets/hud-kit.mjs`。展厅：`render`（HUD 叠在渲染结果上）。
- 下限：HUD 组件 ≥6；设计 token ≥6（可选）。
- 判红信号：一行 `#hud` 文本代替全部 UI；色值硬编码在每个组件里。

## layout

关卡布局。四区（闸口/堆场/仓库/码头）带 bounds；41 个地面与空中刷兵点、54 个掩体点
（其中 2 个在箱顶 y=2.59）、12 点过场样条、玩家起点 (−32,0,6)、撤离点（船上，半径 2.5）；
**全部手写坐标** [src:pretty:L41500-L41510] [src:pretty:L42102-L42110]。

- 资产：`assets/level-kit.mjs`（`validateLayout` 做零件数对账 + AABB 注册）。
- 展厅：`level`。下限：分区 ≥2、掩体 ≥12、目标 ≥1。
- 判红信号：布局用 `Math.random()` 撒点；掩体点不在导航网格上。

## loop

玩法循环。波次表 `[{g3,h1},{g3,h2},{g4,h3}]`、`maxAlive 9`、`spawnStagger .85`、`spawnFar 18`；
三目标全切后转追击（存活 <4 每 7s 补 5）；撤离 → 简报评分（时间/命中率/重试次数）[src:pretty:L58715-L58720] [src:pretty:L59062-L59075]。

- 资产：`assets/combat-kit.mjs`（`mission` / `autoBattle` 供自检）。
- 展厅：`level`。下限：波次 ≥1、接入循环的目标 ≥1。
- 判红信号：敌人生成不看玩家距离；目标切断没有进度衰减；没有结算。

## inspect

自检展厅与检视钩子。九展厅注册表 `gM = { mats, level, backdrop, ground, fx, weapon, enemies, props, render }`；
`__G` / `__stats()` / `__setShot` / `__errors`；URL 开关 `show/shot/bench/q/seed` [src:pretty:L59271-L59275] [src:pretty:L59432-L59440]。

- 资产：`assets/inspect-deck.mjs`（`?show=` 注册表 + `__setShot` 自动安装）。
- 下限：used 展厅 ≥1；结构检查另要求 `inspect.manifest.json` 九键齐全。
- 判红信号：展厅只有整场截图；`__setShot` 不存在（三张证据拍不出来）。

## 常见失败与处置

| 症状 | 根因 | 处置 |
| --- | --- | --- |
| `used` 但下限全红 | `__PARITY__.counts` 手填常数或没接资产 | 改成遍历/工厂自报，先接资产再申报 |
| 一片 `n/a` 过门禁 | 旧版可堆 n-a；现在 `tier=full` 要求 ≥15 族 used | 换 tier 说明范围，或补齐元素 |
| `n/a` 被判红 | 理由缺失/占位/证据不存在 | 写具体理由 + 指向真实截图 |
| 三张证据同字节 | 没调 `__setShot`，换机位失败 | 框架已自动安装 `__setShot`，检查展厅是否重置了 fov |

## 验收顺序

```bash
node harness/gates/complete.mjs --self-test
node harness/gates/inspect.mjs   --scene <dir>   # 先出三张证据
node harness/gates/complete.mjs  --scene <dir>   # 再对账
node harness/gates/perf.mjs      --scene <dir> --floors --assert
```
