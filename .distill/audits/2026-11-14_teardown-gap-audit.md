# 2026-11-14 · 原作拆解差距审计：视频拆解 × how2build3d 覆盖矩阵

> 来源：抖音《把英文换成中文就叫自主研发？几猫比原作只改了 85...》（Gwaanl 作品，https://v.douyin.com/i6V9F3foWJI/ ，转述稿由用户提供）。
> 对象：本仓库蒸馏的原作 `sources/jimao-3a-game/index.html`（几猫= Saltline 汉化版；上游为 Fable 5.2 一次成型的单文件射击游戏）。
> 目的：用视频的「拆解清单」当审计镜头，找出技能（方法论+资产）仍未蒸馏的维度，并以 Spec 包 `2026-11-14_self-inspection` 修复。

## 一、视频拆解摘要（按维度）

1. 单文件 1.4MB、140 万字符：一半是 three.js，另一半是游戏源码；图片 0 / 音频 0 / 模型 0，仅菜单三款字体外链。
2. 材质：27 段材质小程序（GPU 现算），每材质出 albedo/粗糙/凹凸三图；最高画质 110MB 贴图、约 100ms；原料只有随机噪点（粗+细 fbm）。
3. 掉漆：噪声划线→掉漆露底漆→露锈钢板，每块掉漆正下方有锈水。
4. 文字：Canvas 现写；箱门总重/自重/净重三数加减勾稽。
5. 几何：36 种道具全用方块/圆柱/管子拼；叉车 277 零件、门架链 92 节、岸吊 89 级踏板、缆绳挡鼠盘；全场 290 万三角形，地面只有 2 个三角形。
6. 地面：接缝/裂纹/标线/积水逐像素算；布局非随机——47 个集装箱、26 摊积水全部手写坐标。
7. 光照：天空盒+程序化云/太阳（云给太阳留缺口）；光柱每像素最多 40 步、每步查阴影；积水是真实镜子（每帧多画一遍世界）；一帧最多 25 道后处理工序。
8. 声音：55 种、3 分半，全部波形现算；雨声按雨滴计数（6 秒每耳 1020 滴）；铁皮仓库混响切换；5 条 D 小调音轨按战斗强度叠加。
9. 敌人：两种机器；机器狗无走路动画——脚踩地不动、身体前移、落后超过阈值迈步、关节角现算；网格寻路、听得见枪声、轮流开火（同时最多两个）。
10. **自检展厅（摄影棚）**：URL 加 `show=mats` 出材质墙，`props`/`enemies`/... 共九个展厅（mats、props、enemies、weapon、fx、render、ground、backdrop、level）；做完一块→进展厅→拍照→看→改。
11. **声音自检**：声音没法拍照，就写自检让游戏自动打 10 秒仗，量音量有没有爆。
12. 过程数字：8 小时无人值守、输入 4 亿+ token、输出 270 万、约 550 美元（记录用，不入技能）。

## 二、覆盖矩阵

| # | 拆解维度 | 现有覆盖 | 判定 |
| --- | --- | --- | --- |
| 1 | 单文件 / 零外部资产 | `references/00-workflow.md` 三门禁；SKILL description「single-file HTML」 | 已覆盖 |
| 2 | 材质 27 生成器 / MRT 三输出 / 启动期成本 | `assets/sl-textures.mjs`（27 生成器 × 29 纹理集）；`references/07` | 已覆盖 |
| 3 | 掉漆三层 + 锈水 | `references/07` 材质分层第 5 层（paint/rust/ageCanvas） | 已覆盖 |
| 4 | Canvas 文字 / 重量勾稽 | `references/03`「Canvas 做旧与排版」 | 已覆盖 |
| 5 | 天空云洞 / 光柱 / 镜面水 / 后处理链 | `assets/sky-deck.glsl` `shafts.glsl` `ssr-wet.glsl` `post-chain.glsl`；`references/01` | 已覆盖 |
| 6 | 55 音效 / 五声部 / 混响切换 | `references/04` 声音规格表、总线图、五声部 | 已覆盖 |
| 7 | 290 万三角 vs 地面 2 三角 | `references/06` 性能预算；`sl-surface` 地面注入 | 已覆盖 |
| 8 | 47 集装箱 / 26 水洼手写坐标 | `references/03` 世界常量表（弱） | 部分覆盖 → 并入 t06 补「布局手写」 |
| 9 | **九展厅 show= 摄影棚** | 无；S9 只有 `__G/__stats/?bench/debugCut` | **缺口 T1** |
| 10 | **自检闭环（拍图→看→改）** | 无；只有门禁与截图四问 | **缺口 T2** |
| 11 | **程序化四足步态** | 无；`references/04` 不涉及动画 | **缺口 T3** |
| 12 | **敌人 AI（寻路/听觉/令牌）** | 无；`.distill/understanding/07` 仅简述波次 | **缺口 T3** |
| 13 | **36 道具 / 277 零件 / 92 链环** | `references/03` 仅「几何三级复用」 | **缺口 T4** |
| 14 | 8 小时 / $550 成本 | 非技能内容 | 仅记录 |

## 三、根因

- **T1｜没有「摄影棚」**：技能教了「把引擎上下文暴露给自动化验收」（铁律 #8），但没有给「每个子系统一个可拍照展台」的载体。模型只能看整场景截图，看不出材质墙/道具目录/敌人展台的局部问题。
- **T2｜没有自检闭环**：门禁是「交付前一次性」，不是「每完成一块→拍→看→改」的循环；声音更是没有任何可量化的自检配方。
- **T3｜程序化动画与敌人 AI 未蒸馏**：全部 references 只覆盖渲染与玩法调参，四足步态与敌人感知/令牌（同时开火上限）在源文件里有完整实现却未进入任何方法论文档。
- **T4｜道具解剖缺失**：源文件用「零件表 + 注册表 + showcase」造 36 种道具，技能只有几何复用三条，缺零件级工艺。

## 四、修复映射（本包交付）

| 根因 | 修复 | 任务 |
| --- | --- | --- |
| T1 | 新 `references/08-self-inspection.md`：九展厅清单 + 接入契约 + 展台相机 | t02 |
| T1 | 新 `assets/inspect-deck.mjs`：`?show=` 注册表 / `showcase(ctx)` / `__setShot` 框架 | t03 |
| T1 | 新 `harness/gates/inspect.mjs`：九厅 used/N/A + 每厅真实渲染截图门禁 | t04 |
| T1 | `examples/quality` 接入六厅（三厅 N/A 有理由），成为活体样本 | t05 |
| T2 | `references/08` 的「自检闭环」「声音自检」两节 + 门禁截图留证 | t02/t04 |
| T3 | 新 `references/09-procedural-animation-and-ai.md`：骨骼/步态/AI 令牌/听觉 | t06 |
| T4 | `references/03` 增「道具解剖与零件目录」节（PROP_SIZES、零件命名、密度分级、布局手写） | t06 |
| 全部 | SKILL/README×2/docs.manifest 路由；全量回归 | t07/t08 |

源文件锚点（供引用校验）：
- 九展厅注册表：`[src:pretty:L59271-L59271]`（`gM = { mats, level, backdrop, ground, fx, weapon, enemies, props, render }`）
- show 分派与 `__G`：`[src:pretty:L59318-L59319]`；`__setShot`：`[src:pretty:L59331-L59331]`
- 展厅 stub 世界（80×80 地面）：`[src:pretty:L59357-L59357]`；`showcase()` 引导：`[src:pretty:L59393-L59393]`；逐帧更新：`[src:pretty:L59478-L59480]`
- 四足骨骼：`[src:pretty:L55749-L55749]`（`legs: FL/FR/RL/RR`）、`[src:pretty:L55756-L55756]`（`Z_()` 骨骼构建）
- 猎犬参数：`[src:pretty:L56634-L56634]`；脚掌状态：`[src:pretty:L56713-L56713]`；`lift`：`[src:pretty:L56754-L56754]`
- 敌人 AI 参数：`[src:pretty:L57426-L57426]`（`sightRange 四十五 / hearRadius 四十五 / maxTokens 2`）

## 五、验收命令

- `node harness/gates/inspect.mjs --self-test`：负样例（缺厅 / N/A 无理由）必须判红，正样例判绿。
- `node harness/gates/inspect.mjs --scene examples/quality`：六厅真实渲染、截图非黑、`__G.showcase` 对齐。
- `node examples/quality/build.mjs --assert && node harness/render/scene.mjs --scene examples/quality --assert`：默认路径零回归。
- `node harness/gates/doc.mjs --all && node harness/gates/citations.mjs --all && node harness/gates/skill.mjs .`：新参考全部入清单、引用零悬空。
- `node harness/gates/perf.mjs --self-test && node harness/gates/perf.mjs --assert && node harness/boot.mjs --assert-ok && node harness/render/starter.mjs --assert && bash scripts/install-skill.sh --check`：全量回归。

## 六、结论

视频里最值钱的不是「八个系统怎么画」，而是**「模型如何自己看见并修正」**：九展厅 = 可观测面，自检闭环 = 修正回路。方法论的下一层不是更多规则，而是把「自检界面」做成可复用资产与门禁——与 `2026-11-14_quality-transfer` 的「资产消费 + 感知验收」同构，这次补的是「过程自评」这一环。
