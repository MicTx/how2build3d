# 创物 · 关卡布局（layout）

> 上游锚点：`sources/jimao-3a-game/index.html` L5453（港区 C1：集装箱堆场/起重机/仓库/码头/中继/刷点/掩体/过场样条）｜ 我方资产：`assets/level-kit.mjs`（九件套 schema / `validateLayout` / AABB 注册）｜ 对账：`harness/element-manifest.json` layout 族 ｜ 验收：`node harness/gates/complete.mjs --scene examples/parity`

## 构建法则

**法则 1 · 布局是手写数据，不是生成器**：四个区、四十一 个刷兵点、五十四 个掩体点、12 个过场样条点、3 个中继、1 个撤离点，全部是常量坐标 [src:pretty:L41958-L42001] [src:pretty:L42023-L42079]。随机数只允许进入“变体”（门板开合 0.6/0.8、贴花位置、集装箱涂装种子），不进入位置。**位置一旦由随机决定，掩体关系、视线走廊、刷兵距离就都不可复现**，关卡设计也就无法被评审。

**法则 2 · 目录决定尺寸，布局只写坐标**：道具目录 `PROP_SIZES` 每项是 `[w,h,d,material,family]`，如 `container20 [6.06,2.59,2.44,"paint_red","metal"]` [src:pretty:L35067-L35070]；布局项只写 `prop`、`at`、可选 `rot`/`parts`。装配时尺寸从目录取，碰撞盒半宽按 yaw 旋转后的投影计算（不用 AABB 直接套未旋转尺寸）。因此**同一件道具在所有区里的尺寸永远一致**，换尺寸只需改目录一处。

**法则 3 · 构建期对账，不对就抛**：`validateLayout` 在建模前跑三类检查——未知道具名、`parts` 与目录不符、同一 `prop@x,y,z` 重复放置（我方 `assets/level-kit.mjs` 的 `validateLayout`，对应上游“目录 + 返回对象”的数据契约 [src:pretty:L42098-L42107]）。这比“建完再目测”便宜得多：错误在装配前暴露，错误信息带道具名与坐标。

**法则 4 · 分区是查询协议，不是美术分组**：`zones` 是四个轴对齐 bounds——gate `[-40,-30]..[-24,30]`、yard `[-24,-10]..[16,30]`、shed `[-24,-30]..[16,-10]`、quay `[16,-30]..[40,30]` [src:pretty:L42002-L42007]。每个刷兵点带 `zone` 标签，中继也带 `zone`；用途是刷兵筛选、目标归属与 HUD 地点卡，**不是**渲染批次或场景图层级。分区边界可以互相覆盖视觉上的“墙”，因为它是逻辑归属。

**法则 5 · 掩体点必须先合法**：五十四 个掩体点先是手写坐标，随后统一做导航吸附——若点落在不可走位置（箱子内部、水面），以 0.5/1/1.5/2m 四圈、每圈 8 个方向搜索最近可走点并改写 [src:pretty:L42081-L42096]；其中 2 个点直接放在箱顶 `y=2.59`，构成高低差掩体。**“设计意图坐标”与“可行走坐标”之间必须有一次显式转换**，否则猎犬会卡在集装箱里。

**法则 6 · 九件套是关卡唯一的接口面**：`playerStart / objectives / enemySpawns / zones / interiorBoxes / cinematicPath / extraction / groundSurfaceAt / update` [src:pretty:L59358-L59374]。AI 只读 `coverPoints` 与刷点，游戏只读 `objectives/extraction`，渲染只读 `interiorBoxes`（室内湿度衰减）；谁都不拿 `scene` 里的 group 去猜。展厅路径用一个同 schema 的 `stub` 关卡替换，保证所有消费者在无关卡时也能启动。

## 完整链路

| 环节 | 意图 | 算法 / 常量 | 上游实现 | 我方落点 | 运行时证据 | 门禁 | 失效模式与兜底 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 道具目录 | 尺寸/材质唯一源 | `[w,h,d,material,family]`；20ft 6.06×2.59×2.44、40ft 12.19×2.59×2.44、40hc 12.19×2.9×2.44 | 目录表 [src:pretty:L35067-L35070] | `catalog` 入参 | `stats.props` | 对账行 `placedProps ≥ 60` | 目录缺项 → `validateLayout` 抛 unknown prop |
| 堆场 | 堆叠形成巷道与高低差 | 逐层 `stack(x,z,[[len,color,opts]…])`，层高 2.08/2.59 | 集装箱堆叠 [src:pretty:L41507-L41530] | `layout.items` 坐标 | 箱数 `stats.containers` | 俯视图与常量表一致 | 堆叠穿透 → 碰撞盒按旋转投影扩大 |
| 起重机/围栏 | 天际线与边界 | 围栏按 3.35m 一段切分、长段用 `scale.x` 拉伸 | 起重机与围栏 [src:pretty:L41769-L41800] | 目录 + 手写坐标 | 段数、包围盒 | 结构门禁 | 段数取整后有余量 → 拉伸单段吸收 |
| 仓库/码头 | 室内外过渡、撤离路径 | shed 内灯与天窗、quay 船上撤离点 | 分区建造 [src:pretty:L41859-L41875] | `interiorBoxes` / `extraction` | 湿度衰减生效 | 室内盒被识别 | 无 interiorBox → 湿度恒 1，不报错 |
| 目标 | 三个区的空间锚 | 中继在 yard (1.5,7.5)、shed、quay，各自带 `zone` 与 object 引用 | 目标数组 [src:pretty:L41944-L41955] | `meta.objectives` | `counts.objectives` | `objectives ≥ 1`（实测 3） | 目标 object 缺失 → `setState` 被 try/catch 吞掉，仍可切 |
| 刷兵点 | 41 个地面/空中点，带区标签 | `g(x,z,zone)` / `x(x,y,z,zone)`；空点 y 5.2–13 | 刷点数组 [src:pretty:L41958-L42001] | `meta.enemySpawns` | `enemySpawns ≥ 6`（清单 41） | 各类型都有点 | 某类型无点 → 刷兵回落到全部点 |
| 分区 | 逻辑归属 | 4 个 AABB | bounds [src:pretty:L42002-L42007] | `meta.zones` | 地点卡/刷兵筛选 | `zones ≥ 2`（实测 4） | 点越界 → 仍按标签归属，不做空间裁剪 |
| 过场样条 | 标题镜头与 bench 航线 | 12 点 Catmull-Rom，长度下限 4m | 样条点 [src:pretty:L42009-L42022] | `meta.cinematicPath` | 标题镜头路径 | 首帧不穿模 | 点数 <2 → 用玩家起点生成两点默认路径 |
| 掩体 | 猎犬找射击位 | 手写坐标 + 8 向 nav 吸附；2 点在箱顶 | 吸附循环 [src:pretty:L42081-L42096] | `meta.coverPoints` | `coverPoints ≥ 12`（清单 54） | 全部 `isWalkable` | 四圈都失败 → 保留原点，AI 另做 LOS 检查 |
| 碰撞注册 | 一次建组、统一入物理 | 旋转投影半宽 + AABB + `surface/tag` | 返回对象 [src:pretty:L42098-L42117] | `createLevelKit` | `stats.colliders` | 与 props 数一致 | 无 physics → 跳过注册，只建视觉 |

链路的关键顺序：**目录 → 布局数据 → 对账 → 建网格 → 注册碰撞 → 吸附 → 返回九件套**。对账必须在校验前，吸附必须在碰撞注册后（因为吸附要用 `nav.isWalkable`，而 nav 由碰撞盒生成）。

## 思维链

**决策链 A · 为什么手写坐标而不是程序化撒点**

- **约束**（事实）：港区要形成“巷道—掩体—视线走廊—撤离路线”的可读空间；玩家出生点到三个中继的推进节奏要可控；敌人刷点要与掩体、分区、玩家距离同时协调。
- **目标**（事实）：首轮可玩、可评审、可回归；布局改动能 diff。
- **候选**（推断）：A 规则化撒点（泊松盘 + 约束求解）；B 全手写常量；C 手写骨架 + 程序化填充。
- **选择**（事实）：B（位置）+ 变体随机。所有集装箱、起重机、围栏、刷点、掩体、样条都是常量 [src:pretty:L41507-L41530] [src:pretty:L41958-L42001]；随机只出现在门板开合、涂装种子这类不改变空间关系的属性。
- **兜底**（事实）：手写坐标可能落在不可走处——用 nav 吸附兜底 [src:pretty:L42081-L42096]；对账用 `validateLayout` 兜底拼写/重复；分区标签兜底归属。

**决策链 B · 为什么分区用轴对齐 bounds**

- **约束**（事实）：分区要被刷兵筛选、目标归属、HUD 地点卡高频查询；场景本身是矩形的港区（堆场/仓库/码头/闸口）。
- **目标**（事实）：查询 O(1) 且实现可读，不需要多边形碰撞或网格划分。
- **候选**（推断）：A 多边形区域；B 轴对齐 AABB；C 导航网格连通分量。
- **选择**（事实）：B，四个 `min/max` [src:pretty:L42002-L42007]。港区天然矩形，AABB 足够表达；越界判定两行代码。
- **兜底**（事实）：刷兵点与中继各自带 `zone` 字符串，即使坐标漂出 bounds，归属仍按标签；bounds 只做粗筛与显示，不做权威裁剪。

**决策链 C · 为什么关卡返回数据对象而不是 scene graph**

- **约束**（事实）：关卡要被玩家、AI、HUD、音频、渲染五个系统消费；展厅路径需要无关卡启动；`?bench` 还需要用关卡航线跑测试。
- **目标**（事实）：消费者之间零耦合，替换关卡不碰业务代码。
- **候选**（推断）：A 直接暴露 `group`，各系统自己 `getObjectByName`；B 返回九件套数据 + 一个 `update()`；C 事件总线。
- **选择**（事实）：B。`playerStart/objectives/enemySpawns/zones/interiorBoxes/cinematicPath/extraction/groundSurfaceAt/update` 九项 [src:pretty:L59358-L59374]，消费者只读字段；`group` 只用于渲染与阴影。
- **兜底**（事实）：展厅模式构造同 schema 的 `stub` 关卡（80×80 地面、空目标、空刷点），所有消费者照常初始化，不会因为“没有关卡”而崩。

**推断边界**：四个 bounds 的具体数值、54 个掩体坐标、41 个刷点都可证实（事实）；但“为什么是 54 而不是 60”“为什么 gate 区不刷兵”属于设计意图，源码没有注释，只能从分布推断。候选方案 A/C 是否被实际评估过，不可证实。

## 迁移法则

**资产路由**：目录/布局/碰撞/展厅 → `assets/level-kit.mjs`；几何零件本身 → `assets/props-kit.mjs`；刷兵点的消费方是 `assets/combat-kit.mjs` 与 `assets/enemy-kit.mjs`；分区标签进 HUD 的地点卡。关卡 kit 不建任何业务对象（敌人、玩家、目标逻辑）。

**参数重绑点**：

1. `catalog[prop].size` → `layout` 里所有引用该 prop 的坐标间距、掩体吸附结果、`bounds` 是否还包得住。
2. `meta.playerStart` → 开场过场样条起点、首波刷兵 `spawnFar 18` 的参考原点。
3. `meta.extraction.radius` → 撤离判定（2.5m）与 HUD 标记；改小会让玩家在船上“进不去”。
4. `meta.zones[].min/max` → 刷兵筛选与地点卡；改边界不必改点标签，但会造成标签与空间不一致。
5. `meta.coverPoints` → 猎犬找射击位的候选集 [src:pretty:L42023-L42079]；掩体点少于敌人数量时，AI 会退化为环绕点。

**对账行**：`zones ≥ 2`（实测 4）、`coverPoints ≥ 12`（清单 54）、`objectives ≥ 1`（实测 3）；另有 `placedProps ≥ 60`、`enemySpawns`、`stats.colliders`、`containers` 供回归。

**迁移禁区**：在布局里写随机位置（不可复现、无法评审）；绕过 `validateLayout` 直接建组（重复放置会让碰撞盒叠在一起）；把分区 bounds 当作渲染裁剪（它是逻辑归属，不是相机剔除体）。
