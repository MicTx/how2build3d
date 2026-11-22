# 全场景装配：从脚手架到对账全绿

> 回答一个具体问题：`node scripts/scaffold-scene.mjs --name <scene> --tier full` 生成骨架之后，
> **按什么顺序接什么、每步用什么命令验收**。本文不重复方法论（`references/00`）与逐族下限
> （`references/11`），只给装配顺序、世界常量模板、目录契约与迭代闭环。
> 配套门禁：`harness/gates/complete.mjs`（元素对账）、`harness/gates/inspect.mjs`（展厅证据）、
> `harness/gates/perf.mjs --floors`（密度下限）。

## 装配顺序

依赖是单向的：下游消费上游的常量、材质与几何，**倒着装必然返工**。
每装完一段就进对应展厅拍照（迭代闭环见下），不要攒到最后一起验。

| 序 | 阶段 | 消费资产 / 模块 | 产出 | 展厅 | 上游出处 |
| --- | --- | --- | --- | --- | --- |
| 1 | world | `src/world.mjs` 常量模板（下节） | bounds/seed/太阳/雾/画质档 | — | — |
| 2 | materials | `sl-textures.mjs`（纹理工厂）→ `sl-surface.mjs`（`SL_MATERIALS` + 工厂） | 材质目录，全场景唯一材质来源（我方 48 条） | `mats` | 材质 五十一 种带 tint/rough/metal/wet[4]/macro[4] [src:pretty:L34087-L34160]；纹理 二十七 生成器 × 二十九 套 [src:pretty:L34043-L34086] |
| 3 | ground / sky / sea | `ssr-wet.glsl`（地面三 RT + 标线画布）、`sky-deck.glsl`（云甲板 + PMREM `uEnv`）、`sea.glsl`/`snippets/sea.glsl.mjs`（环形网格） | 地面、天空、水面 | `ground` / `backdrop` | 地面 mask/detail/normal 三 RT [src:pretty:L44697-L44860]；天空 ridged 云 + 闪电 [src:pretty:L30644-L30740]；海面涌浪 + 猫爪高光 [src:pretty:L45181-L45240] |
| 4 | props + layout | `assets/props-kit.mjs`（尺寸表 + builder）、`assets/level-kit.mjs`（`validateLayout` 对账） | 道具实例 + 手写坐标布局 | `props` / `level` | 三十五 类占位 + 十七 builder、一百八十 处手写摆放 [src:pretty:L35069-L35106] [src:pretty:L37358-L37375]；四区 bounds + 四十一 刷兵点 + 五十四 掩体点 [src:pretty:L41500-L41510] [src:pretty:L42102-L42110] |
| 5 | 视觉 pass | `post-chain.glsl` + `post-aa.glsl` + `shafts.glsl` + `pcss-shadow.glsl` + `assets/weather-kit.mjs` | RT_scene→shafts→composite→post→aa 管线；雨雷 | `render` / `ground` | 单 pass 后处理链与 marker [src:pretty:L31177-L31260]；PCSS 按阴影相机标定 [src:pretty:L30840-L30890]；雨 九千 条 + 雷暴调度 [src:pretty:L45423-L45485] |
| 6 | physics | `assets/physics-kit.mjs`（AABB/胶囊/导航网格） | 碰撞世界，`moveCapsule` 接口 | — | `references/10` |
| 7 | player | `assets/player-kit.mjs`（归一输入 + `Mt` 调参表） | 玩家控制器，74° 主相机 | — | 手感调参不改逻辑（`references/00` S7） |
| 8 | weapon | `assets/weapon-kit.mjs`（型材挤出 + 9 通道弹簧阻尼） | 视图模型 + 五十四° 枪相机 | `weapon` | 9 通道弹簧阻尼、ADS fov 五十二、枪相机 五十四° [src:pretty:L55096-L55120] |
| 9 | enemies | `assets/enemy-kit.mjs`（骨骼 + IK）+ `assets/combat-kit.mjs`（感知/令牌，勿重写） | 两型敌人接入战斗令牌 | `enemies` | 隼/猎犬骨骼感知、令牌 2 并发 [src:pretty:L56171-L56190] |
| 10 | fx | `assets/fx-kit.mjs`（lit/additive 双池 + 十一种 API） | 枪口焰/弹道/弹着/贴花 | `fx` | 合计 5 draw call 的池化 [src:pretty:L48488-L48510] |
| 11 | audio | `assets/audio-kit.mjs`（58 条规格 + 5 总线 + 生成 IR） | 规格表合成音频 | `fx`（频谱/峰值证据） | 规格 `gen/n/sr/peak/bus/max/pri` [src:pretty:L50465-L50521] |
| 12 | hud | `assets/hud-kit.mjs`（token 层 + 我方 10 组件，上游 11） | HUD 叠加在 render 之上 | `render` | 罗盘带/目标面板/伤害弧 [src:pretty:L57923-L57960] |
| 13 | loop | `assets/combat-kit.mjs`（`mission`/`autoBattle`） | 波次 + 目标 + 撤离 + 简报 | `level` | 波次表 + maxAlive 9 + 撤离评分 [src:pretty:L58715-L58720] |
| 14 | inspect | `assets/inspect-deck.mjs` + `inspect.manifest.json` + `scene.elements.json` | 九展厅注册 + 对账申报 | 全部 | 九展厅注册表 [src:pretty:L59271-L59275] |

两条硬规则：

1. **第 5 步之前不接任何玩法**——观感层没立起来就装 player/enemies，调手感时会把观感问题误判成手感问题。
2. **第 14 步不是可选收尾**：`inspect.manifest.json` 九键与 `scene.elements.json` 申报是 `complete.mjs` 的输入，脚手架已生成骨架，装配过程中逐族把 `n/a` 改 `used`（或补理由），交付时门禁直接可判。

## 世界常量模板

脚手架生成的 `src/world.mjs` 即模板——**改数值，不改结构**。米制单位；四区域 bounds 手写；
机位遵守玩家口径（主 74°/枪 54°）；静帧样板才允许另立机位并在 README 参数表登记理由
（`references/01` 双相机节）。

```js
globalThis.H2B = globalThis.H2B || {};
H2B.WORLD = {
  units: "meters",
  seed: 4207,                                          // 进 URL；同 seed 截图 diff = 0
  bounds: { minX: -40, maxX: 40, minZ: -40, maxZ: 40 }, // 四区域 bounds 手写，不用随机撒点
  groundY: 0,
  seaY: -1.2,                                           // 有水域才写；无水域整行删掉
  sun: { dir: [0.916, 0.225, 0.331], color: 0xffd9a8, intensity: 3.2 },
  fog: { color: 0x232c36, density: 0.006 },
  camera:       { fov: 74, near: 0.08, far: 900 },      // 玩家主相机口径
  weaponCamera: { fov: 54, near: 0.01, far: 10 },       // 独立 layer + depthRange 切片
  quality: { low: {...}, medium: {...}, high: {...} },   // scale/shadow/tex/volSteps/planar 三档
};
H2B.seededRng = function seededRng(seed) { /* mulberry32；唯一随机源 */ };
```

约束（`references/06` 铁律 #5）：全场景只允许 `H2B.seededRng` 一个随机源，`Math.random` 出现即红；
seed 进 URL，同 seed 重建必须逐字节可复现。

## 场景目录契约

脚手架生成的目录即契约；`harness/render/scene.mjs` 与 `complete.mjs` 逐项检查，缺一即红：

```
examples/<scene>/
├── build.mjs                 # 单文件构建；readAsset/toScript 内联 three r180 与资产；--assert 自检
├── README.md                 # 四节必备：场景意图 / 参数表 / 方法论 / 验收（缺节判红）
├── inspect.manifest.json     # 九展厅键：mats level backdrop ground fx weapon enemies props render
├── scene.elements.json       # 18 族申报：used / n-a（+ reason + evidence）+ tier
├── assets.consumption.json   # 资产消费清单：八大系统逐项 used / N/A（理由）
└── src/
    ├── world.mjs             # 上节常量模板
    ├── mats.mjs / ground.mjs / sky.mjs / sea.mjs / props.mjs / layout.mjs
    ├── post.mjs / physics.mjs / player.mjs / weapon.mjs / bots.mjs / fx.mjs / audio.mjs / hud.mjs
    ├── content.mjs           # 波次、目标、简报
    ├── inspect.mjs           # 九展厅注册表 + __setShot 机位
    └── scene.mjs             # boot：renderer/双相机/灯光/检查协议（__G / __stats / __PARITY__）
```

- 构建输出：`build/<scene>/index.html` 单文件、零运行时请求（`references/00` 贯穿门禁一）。
- 证据归档：整体截图 `evidence/frames/<scene>.png`；展厅证据 `evidence/inspect/<scene>-<gallery>[-2|-3].png`；
  对账判定 `evidence/parity/<scene>.json`。
- `window.__PARITY__.counts` 必须由遍历/工厂自报产生，**不许手填常数**（`references/11` 判红第一条）。

## 迭代闭环

装配不是单向流水线，而是「装一段 → 拍一段 → 判红 → 修 → 重拍」的循环
（`references/08` 自检闭环的场景级展开）：

```bash
node examples/<scene>/build.mjs --assert                          # 1. 单文件可跑
node harness/render/scene.mjs --scene examples/<scene> --assert   # 2. 真实渲染 + README 四节 + draw cap
node examples/<scene>/build.mjs --assert --serve && \
  # 3. ?show=<gallery>&shot&seed=<seed> 进展台，每厅按断言拍 1–3 张
node harness/gates/inspect.mjs  --scene examples/<scene>          # 4. 展厅证据：used 厅三张编号截图
node harness/gates/complete.mjs --scene examples/<scene>          # 5. 元素对账：结构/下限/证据三类判红
node harness/gates/perf.mjs     --scene examples/<scene> --floors --assert   # 6. 密度下限
node harness/gates/visual.mjs   --image evidence/frames/<scene>.png          # 7. 感知下限（纯黑/纯灰拒绝）
```

判红处置顺序：**结构红**（缺申报/缺理由）→ 补 `scene.elements.json`；
**下限红**（used 族低于 floor）→ 接对应 kit 加量，不许改 floor；
**证据红**（展厅缺三张截图）→ 回 `?show=` 补拍。一次只改一个变量，同机位同 seed 重拍对比
（`references/08` 六步）。

### 从红灯到全绿的推荐顺序

1. `--structure-only` 先清结构：九键 manifest、18 族申报、`tier` 广度（full ≥15 族 used）。
2. 按「装配顺序」表逐段接资产：接完一段，对应展厅从 `n/a` 翻 `used`，立刻补三张截图。
3. `complete.mjs` 全量跑：`tier=full` 逐族 floor 生效；红哪族补哪族，不许堆 `n/a` 过门禁
   （`references/11`：`tier=full` 要求 ≥15 族 used）。
4. 最后跑 `perf.mjs --floors` 与 `visual.mjs`：密度与感知下限全绿才算交付。

## 常见装配失败

| 症状 | 根因 | 处置 |
| --- | --- | --- |
| 倒着装：先写 player 后调材质 | 违反装配顺序，调参互相污染 | 回第 2 步重立材质目录，手感参数全部走调参表 |
| `complete.mjs` 报 `__PARITY__ 缺失` | scene.mjs 没挂检查协议 | 用脚手架的 scene.mjs 模板，`__G`/`__stats`/`__PARITY__` 一并注册 |
| 展厅截图三张同字节 | `__setShot` 没装或展厅重置了 fov | 确认 `inspect.mjs` 注册了机位；机位变化必须改 `__setShot` 参数（`references/11`） |
| build 后零运行时请求被打破 | 资产读了外链或图片文件 | 全部走 `readAsset` 内联；贴图必须程序化生成（`references/03`） |
| 同 seed 两次构建 diff ≠ 0 | 场景代码里混入 `Math.random` 或 `Date.now` | 只允许 `H2B.seededRng`；时间统一从 `g.time` 取 |
