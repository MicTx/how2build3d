---
name: how2build3d
version: 0.1.0
description: "3D scene coding — triggers automatically for ANY 3D/三维/三维场景/3D场景/scene work: Three.js, WebGL/WebGPU, Babylon, GLSL shaders, 程序化天空海面地形, 光照, 阴影 PCF/PCSS, 后处理 bloom/AgX, 反射 SSR, 体积光, 粒子, LOD, draw call 预算, 画质分级, 材质质感/材质分层/湿地面反射, HUD, FPS, 合成音频, 性能预算, 内存泄漏, 资源释放, WebGPU 兼容, single-file HTML. 真实场景 MANDATES 参考图 reference research FIRST: ≥3 sources + coverage matrix + GAP table before coding, reference shoot-out after first render (no images → 16-category plan). 建个场景/做个3D的/write a 3D demo → use proactively even if not named."
---

# how2build3d — 端到端三维场景建设

本技能把「场景意图」变成「可运行、可量测、可降级」的三维场景。方法论通用、抽象、与具体项目无关：**理解 → 蒸馏 → 构建**。

**核心判断：观感差距的根因在资产层，不在工作流层。** 方法论告诉你「要有体积光」，但只有资产层替你写出光柱的积分、湿地的权重、材质的分层。因此本技能交付两类东西，缺一不可：
- **方法论层**：R0–S9 的工作流、预算、注入纪律、检视协议（`references/`）。
- **资产层**：从上游捕获并原样移植的可执行系统（`assets/`，含六件 GLSL pass + SL 材质/纹理工厂（合称八系统）+ 可选 `sea.glsl`）。

> 构建任何场景时，**先查 `assets/index.md`，能消费就不重写**。重写资产层已有系统 = 用低配轮子换掉标定过的数学，是观感断崖的第一根因。

## 读取预算

渐进披露的硬合同：常驻注入只留本文件，其余材料按任务加载，单次注入总量封顶。

| 行 | 读取范围 | 预算 |
| --- | --- | --- |
| 常驻 | `SKILL.md`（本文件，随技能自动注入） | ≤20 KB |
| 按任务加载 | 单篇 `references/*.md` ≤13 KB；每次至多加载 3 篇；`assets/index.md` 仅在 S2–S6 资产路由时加载 | 按需，不常驻 |
| 单次上限 | 常驻 + 本次按任务加载的合计注入量 | ≤64 KB |

## 何时用

- 要新建 WebGL/Three.js 场景、demo、游戏原型、可视化页面
- 要审查既有 3D 项目：画质预算、着色器注入、启动期成本、失败降级
- 要排查掉帧、内存增长、资源未释放、事件射线过重或 WebGPU/WebGL 兼容回归
- 要在无外部资产约束下做完整场景（离线单文件、无 CDN、无贴图包）
- 要把一个「能跑但塑料感」的场景提升到案例级质感（走 S4/S5/S6 资产路由）

## 三阶段（本项目的工作法，也是你执行任务时的顺序）

0. **R0 参考研究（真实场景的强制前置）**：凡构建"真实地点/真实风貌"的场景，先找**多张参考图**与**至少三个参考源**（权威文本、权威地理数据、图像、视频），用**查询派生**（属性句 + 双语行话）把参考找够——**覆盖矩阵**（远景/中景/特写/俯视/夜景/湿天配额）核对通过才算找够；逐参考分解体量/立面/色彩/密度/动态（带尺度锚点与取色坐标），产出 **GAP 表**；构建后做**参考对拍**（同机位渲染 vs 参考图并排审 delta，回灌 GAP 表）。没有真实图像时，必须先对 **16 类环境要素**（12 类空间要素 + 光照情绪/反射与湿润/后处理风格/材质磨损层级 4 类观感要素）逐类给出决策，再开工。方法与模板见 `references/05-reference-research.md`。**无 R0 产出不得进入 S1。**
1. **理解**：先读现场。跑一次真实渲染，量出 draw call / program / 帧时 / 最终 GLSL，再读源码。证据优先级：运行时实测 > 捕获的最终 GLSL > 静态源码 > 注释。参考 `references/00-workflow.md` 的 S0 与检查点。
2. **蒸馏**：把观察变成**常量表、生成器、注入骨架、降级链、可复用资产**五类产出，而不是写成散文。第五类「可复用资产」不是比喻——它必须是仓库里能直接跑的文件（`assets/*.glsl`、`assets/*.mjs`）。参考 `references/01-render-pipeline.md`、`references/02-materials-and-shaders.md` 与 `assets/index.md`。
3. **构建**：按 R0→S1→S9 顺序落地，每阶段过检查点才进入下一阶段。**S2–S6 默认消费资产层**：先查 `assets/index.md` 路由表，再决定「复用 / 参数重绑 / 确实不适用（写明理由）」。参考 `references/00-workflow.md`、`references/03-procedural-assets.md` 与 `references/07-perceptual-quality.md`。

## 九阶段工作流（R0 + S0–S9）

| 阶段 | 动作 | 资产路由（先查 assets/index.md） | 硬性检查点 |
| --- | --- | --- | --- |
| **R0 参考研究** | ≥3 参考源逐项分解（含权威地理数据源）；查询派生 + 覆盖矩阵配额核对；无图像时 16 类要素逐类决策；产出 GAP 表（每条带参数去向 + 观感差距→资产映射）；构建后参考对拍回灌 GAP | — | 三大 GAP 已排进本次构建；16 类无沉默项；观感 GAP 至少一条有资产映射；覆盖矩阵无未登记缺口；对拍 delta ≥3 条已进 GAP |
| --- | --- | --- | --- |
| S0 | 写一句场景意图 + 三条美术决定（含一条观感决定：材质/光照/后处理目标） | 定「本次消费哪些系统」清单 | 每条决定对应一个可调参数 |
| S1 | 画质分级表（scale/msaa/shadow/tex/volSteps/ao/planar/bloom/motionBlur/rain）+ 像素预算 | 资产档位与画质档对齐（VOL_STEPS/tex/planar） | 最低档真能跑且分辨率被裁到预算内 |
| S2 | **消费 `assets/sl-textures.mjs`**（GPU 程序化 PBR 纹理工厂）或等价生成器；Canvas 做旧/排版 | sl-textures / 本文件 03 | 删掉资产目录仍能重建画面；seed 确定性 |
| S3 | 世界常量表；重复单元 InstancedMesh；合并后重算法线；**材质目录取 `SL_MATERIALS`** | sl-surface 目录 | draw call 不随物体数线性爆炸 |
| S4 | **消费 `assets/sl-surface.mjs`**：triplanar + ORM + macro 至少启用两项；湿地面走地面注入模板；`onBeforeCompile` 四步注入 + 缓存键 | sl-surface（必需） | 资产消费清单：S4 行 used/N/A 有理由；注入失败仍有画面 |
| S5 | **消费 `assets/sky-deck.glsl`**（云甲板天空）+ PMREM 环境捕获；闪电走 uniform 与 CPU 衰减曲线 | sky-deck | 天空/环境来自资产或 N/A；天气变化零加载 |
| S6 | **消费 `assets/post-chain.glsl` + `post-aa.glsl`**：RT_scene→shafts→composite→post-chain→post-aa，读写分离；PCSS 走 `assets/pcss-shadow.glsl`；湿地反射走 `assets/ssr-wet.glsl` + `assets/shafts.glsl` | post-chain / post-aa / pcss / ssr-wet / shafts（必需） | 资产消费清单：八系统逐项 used/N/A（`harness/gates/assets.mjs` 的 `SYSTEMS`）；有统一 post 状态袋；管线失败整体回退直出 |
| S7 | 手感调参表（coyote/jumpBuffer/recoil/bob）；三模态归一输入；角色/敌人走 `references/09-procedural-animation-and-ai.md`（骨骼 + 脚掌落点 + 攻击令牌）；**物理/关卡/战斗装配走 `references/10-gameplay-chain.md` + 三 kit（`physics-kit` / `level-kit` / `combat-kit`）** | — | 调参不改逻辑；令牌上限/听觉/同 seed 确定性过 `gameplay` 门禁 |
| S8 | 设计 token + 规格表音频（HRTF/卷积/压缩/软限幅、五声部混音） | — | 加声音只加一行表+一个 gen |
| S9 | `window.__G` / `__stats()` / `?bench` / `debugCut()` + **九展厅自检协议（`?show=<gallery>` / `__setShot`）** + 错误分诊 + **视觉感知门禁**（`node harness/gates/visual.mjs --image <png>`）+ **展厅门禁**（`node harness/gates/inspect.mjs --scene <dir>`）+ **元素对账门禁**（`node harness/gates/complete.mjs --scene <dir>`） | — | 不读源码就能量出 draw call；九展厅 used/N/A 清单齐全；截图过感知下限；元素对账逐族 used/N-A 有据 |

三个贯穿门禁：**零外部资产 / 启动前置 / 全链路降级**。

**资产消费清单（S6 出口的硬检查点）**：在场景根的 `assets.consumption.json` 的 `systems` 字段逐项写 `used` 或 `"N/A: 理由"`，缺一行不得进入 S7——
`sl-surface` / `sl-textures` / `post-chain` / `post-aa` / `pcss-shadow` / `ssr-wet` / `shafts` / `sky-deck`（可执行载体：`harness/gates/assets.mjs` 的 `SYSTEMS`）。
`sea` 属 `OPTIONAL_SYSTEMS`（海景场景才要求；不消费记 `missing(optional)`，也可写 N/A）；元素 kit 按场景可选（`KITS`）。声明 `used` 不是证据：仍须 marker 命中或原样引用资产文件；`quality` / `parity` / `gameplay` 缺 `assets.consumption.json` 直接判红。
N/A 只在场景确实没有对应需求时成立（例：无地面 → ssr-wet N/A；非真实天空 → sky-deck 可换但须写明替代）。

## 铁律

1. **预算先于内容**：先写死像素、几何、draw call 三张上限，再建场景。
2. **资产先于重写**：构建每个观感系统前先查 `assets/`；能复用就复用，要改就参数重绑，不重写标定过的数学。
3. **配方而非素材**：资产是生成它的代码；共享一张噪声纹理，不各建各的。
4. **成本前置**：编译、合成、生成全在启动期；运行期只查表与混合。
5. **确定性**：seed 进 URL，噪声/音效/刷兵同源；同 seed 截图 diff = 0。
6. **降级是设计**：高级管线失败退前向、chunk 手术失败退库存实现、资产生成失败退纯色材质。
7. **命名即文档**：给每个子系统一个 marker（`MY_SKY`/`MY_POST`/`SALTLINE_*`），错误按 marker 分诊。
8. **可检视**：每个可感知的子系统必须有可进入、可拍照的展台——九展厅协议（`references/08-self-inspection.md`）先于验收；把引擎上下文开放给自动化验收；截图 + 指标双证据。
9. **引用即证据**：本技能的所有方法论条目都挂原项目行号引用，见本机 `.distill/understanding/` 与 `.distill/distillation/`。
10. **先真实后数字**：真实地点的标志物高度/比例/关系来自参考研究（R0 的 GAP 表），不允许拍脑袋；没有参考数据时，16 类要素的规划就是你的参考。
11. **跨框架可迁移**：description 里的 Babylon.js / WebGL / WebGPU 只是入口词——本 skill 的方法论（预算表、Chunk 注入、R0、降级链）在所有 WebGL 系引擎上同构。遇到非 Three.js 框架时，把 `THREE.ShaderChunk` 换成该引擎的等价物即可，其余照做。
12. **资源有主**：geometry/material/texture/renderTarget/loader/worker 必须有明确 owner 与 dispose 路径；热循环零分配，pointer 事件射线有预算，详见 `references/06-performance-and-memory.md`。

## 反模式速查

**重写资产层已有系统**（自造 4-tap bloom / 手写渐变天空 / 纯 albedo 材质替代 ORM+normal 分层——观感断崖第一因）、漏写 `customProgramCacheKey`、整段替换内置 shader、每个材质各建噪声图、用 `Math.random`、天气贴图切换、锐化与 AA 打架、把编译留到首次使用、豪华路径无降级、手感数字散落、UI 硬编码色值、不留检视入口、资源无 dispose、热帧 `new`/`clone`、pointermove 全场景 raycast。详见 `.distill/distillation/05-antipatterns.md` 与 `references/06-performance-and-memory.md`。

## 参考索引

- `references/00-workflow.md` — S0–S9 详细步骤、检查点、失败回退表
- `references/01-render-pipeline.md` — 双相机、像素预算、阴影、后处理
- `references/02-materials-and-shaders.md` — 注入四步、缓存键、chunk 手术、GLSL 配方、SL 表面系统配方
- `references/03-procedural-assets.md` — 噪声/Canvas/几何/实例化
- `references/04-audio-and-gameplay.md` — 声音规格表、总线、调参表、状态机
- `references/05-reference-research.md` — R0 参考研究：查询派生、覆盖矩阵、16 类要素清单、GAP 模板（含观感 GAP）、参考对拍闭环与归档许可
- `references/06-performance-and-memory.md` — 性能预算、资源生命周期、热循环零分配、实例化/事件成本、后处理 buffer、WebGPU/WebGL 兼容与回归门禁
- `references/07-perceptual-quality.md` — 观感配方：材质分层清单、光照分层、大气、校准参数表、验收锚点
- `references/08-self-inspection.md` — 九展厅自检协议：九厅清单、接入契约、自检闭环、声音自检与失败模式
- `references/09-procedural-animation-and-ai.md` — 骨骼与步态（脚掌落点/9cm 阈值）、敌人状态机、攻击令牌、听觉与寻路
- `references/10-gameplay-chain.md` — 玩法链路装配：物理（AABB/胶囊/导航网格）、关卡九件套与零件对账、令牌化战斗与自动战斗自检
- `references/11-element-parity.md` — 元素对账合同：18 族上游计数、我方资产、展厅、下限指标与判红信号
- `references/12-full-scene-assembly.md` — 全场景装配手册：kit 依赖图、世界常量模板、场景目录契约、迭代闭环
- `snippets/sky.glsl.mjs`、`snippets/sea.glsl.mjs` — 可直接用的 GLSL 片段
- `.distill/creation/00-index.md` — **创物篇索引**：19 个创物文件的构建法则总目录（跨族十二公理、18 族阅读顺序），按任务加载，不在常驻注入内
- `assets/` — **资产层（本项目蒸馏的第四/第五类产出）**：
  - 六件 GLSL pass（八系统中的六件）：`post-chain` / `post-aa` / `shafts` / `sky-deck` / `pcss-shadow` / `ssr-wet`（原样移植，`assets/index.md` 有接入契约与参数表）+ `sea.glsl`（海面 pass，可选：补丁体 replace 进 `MeshStandardMaterial` 锚点，marker `saltline-sea-1`）
  - **SL 材质层（另两系统）**：`sl-surface.mjs`（triplanar / ORM / macro / 湿痕 / 水珠 / alpha-wire / SL_TINT / LOOK 分级）与 `sl-textures.mjs`（27 个 GPU 生成器 × 29 纹理集，MRT 出 albedo+ORM+normal）
  - **元素 kit（八 kit，按场景可选）**：P2 `props-kit`（36 行尺寸表 + 17 builder + Canvas 贴花）/ `fx-kit`（双 billboard 池 + 四环形池，5 draw call）/ `audio-kit`（58 条合成规格 + 5 总线 + 分片预算）；P3 `weapon-kit`（视图模型 + 9 通道弹簧后坐）/ `enemy-kit`（骨骼 IK + 步态 + 命中区，只对接 combat-kit）/ `player-kit`（三模态输入 + coyote/buffer 手感表）；P4 `hud-kit`（token 化 DOM HUD 十组件）/ `weather-kit`（instanced 雨条 + 雷暴调度驱动 sky/post）。全部参数注入、八个 kit 都有模块级 node `selfTest()`（`weapon` / `player` / `weather` 的模块级入口构造无 THREE / 最小 stub 实例后跑实例自检）；marker 集合见 `assets/index.md` 第五节与 `harness/gates/assets.mjs` 的 `KITS` / `OPTIONAL_SYSTEMS`
  - 蒸馏说明见 `.distill/distillation/06-visual-assets.md`。**方法论 + 资产才构成完整蒸馏**。

## 配套实现

- `examples/starter/` — 方法论的最小骨架证明（预算/检视/注入），不是观感参照。
- `examples/quality/` — **渲染链八系统观感基线**：接入 sky-deck + post-chain + post-aa + pcss + ssr-wet + shafts + sl-surface + sl-textures 的可运行单文件场景「雨后黄昏堆场」（元素 kit 不接入，宿主是 examples/parity）。`node examples/quality/build.mjs --assert` 构建，`node harness/render/scene.mjs --scene examples/quality --assert` 真实渲染验收。
- `examples/gameplay/` — **玩法基线**：手写布局 + physics/level/combat 三 kit 的令牌射击场训练场，`?auto=10` 自动战斗落报告。`node examples/gameplay/build.mjs --assert` 构建，`node harness/gates/gameplay.mjs --scene examples/gameplay` 门禁验收。
- `examples/parity/` — **元素对账参照场景**：P2–P4 八元素 kit + `sea.glsl` 的宿主场景「雨后黄昏盐线堆场」（18 族全 used，`__PARITY__.counts` 自报计数）。`node examples/parity/build.mjs --assert` 构建，`node harness/render/scene.mjs --scene examples/parity --assert` 真实渲染验收，`node harness/gates/complete.mjs --scene examples/parity --structure-only` 元素对账、`node harness/gates/parity.mjs --scene examples/parity` 漂移门禁（对 `harness/baselines/parity.json` 五项计数 ±15%）。
- 构建命令：`node examples/starter/build.mjs --assert`（骨架）；`node harness/render/starter.mjs --assert`（骨架验收）；`node harness/gates/skill.mjs .`（文档门禁）；`node harness/gates/assets.mjs --scene examples/quality`（资产消费门禁）；`node harness/gates/visual.mjs --image evidence/frames/quality.png`（视觉感知下限，加 `--floors` 启用密度下限验收档）；`node harness/gates/inspect.mjs --scene examples/quality`（九展厅自检门禁）；`node harness/gates/complete.mjs --scene <dir>`（元素对账门禁，装配顺序见 `references/12-full-scene-assembly.md`）；`node harness/gates/parity.mjs --scene <dir>`（元素规模漂移门禁，默认读 `harness/baselines/parity.json`；`--record` 已有基线时拒绝，`--force` 才重录；`--self-test` 离线自测）；`node harness/gates/perf.mjs --scene <dir> --assert`（性能门禁，默认 fail-closed；`--no-assert` 仅看报告；`--floors` 启用密度下限）；`node harness/gates/gameplay.mjs --scene examples/gameplay`（玩法链路门禁）；`node scripts/scaffold-scene.mjs --name <scene> --tier full`（新场景骨架，生成即自测）；`node harness/gates/webgpu.mjs --scene <dir>`（WebGPU/WebGL 兼容占位门禁：能力探测 + WebGL2 回退契约，`references/06-performance-and-memory.md` 兼容矩阵）。
- **会话 dump/replay（可审计重放）**：`node harness/gates/gameplay.mjs --scene examples/gameplay --dump-session <file>` 与 `node harness/gates/inspect.mjs --scene examples/quality --dump-session <file>` 把当次门禁采集写成规范化会话（schema `how2build3d/gameplay-session@1` / `how2build3d/inspect-session@1`，含 scene、seed、generatedAt 与 runs/results）；`node harness/gates/gameplay.mjs --replay <file>`、`node harness/gates/inspect.mjs --replay <file>` 离线复跑同一断言函数（令牌/听觉/确定性；九厅覆盖/证据截图元数据），可重复 exit 0/1，篡改判红。**Chrome 前置**：`--dump-session` 是 live 采集，需系统 Chrome（本机 `/usr/bin/google-chrome`）+ 可写 `build/`、`evidence/`，实跑属 manual 验收，环境不满足或失败记 UNKNOWN 不记绿；`--replay` 离线执行，不需要 Chrome。
