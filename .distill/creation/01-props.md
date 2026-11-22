# 创物 · 道具（props）

> 上游锚点：尺寸表 `Gi` 与道具工厂 `Yg` 在 `sources/jimao-3a-game/index.html` 的 L5453 超长行内（约 15.5KB 起），四区手写布置同在 L5453 的 `C1`（约 170.7KB 起）；装配 DSL 与 17 个 builder 见 `evidence/frames/app.pretty.js` L35446-L37372。 ｜ 我方资产：`assets/props-kit.mjs`（`PROP_SIZES` / `BUILDERS` / `buildModel` / `createPropsKit`）。 ｜ 对账：`harness/element-manifest.json` props 族（`propKinds ≥ 12`、`placedProps ≥ 60`）。 ｜ 验收：`node harness/gates/complete.mjs --scene examples/parity`。

## 构建法则

**法则 1 · 目录先行**：先钉死"有什么、多大、什么表面"的目录，builder 只是可选覆盖，未知键必须无痛降级。目录是一条 36 行的五元组表 `[w,h,d,material,family]`：前三项是米制包围盒，第四项进材质工厂（`sl-surface` 名称），第五项进物理表面族。工厂 `Yg.build()` 先查 `Xg[e]`，命中才调用 builder；builder 抛错时 `console.error` 并继续走回落；未登记者 `Gi[e] || [1,1,1,"concrete","concrete"]` 并 `console.warn`，通用盒以 `"bottom"` 对齐地面并同时产出同尺寸碰撞盒。目录因此是可数的合同，而不是注释：改一个尺寸必须同时改 builder 与碰撞盒，否则对账必然穿帮。[src:pretty:L35068-L35104] [src:pretty:L35107-L35133]

**法则 2 · 零件是材质桶的成员**：绘制次数按材质计，不按零件计；合并键 = 几何键 + 材质键。装配器 `jn` 内部是 `buckets: Map<material, geos[]>`，`add()` 先把几何乘上当前变换栈矩阵，再按材质塞桶；`push()/pop()` 维护嵌套局部坐标系；`parts()` 对每个桶执行 `mergeGeometries`，`group()` 每材质落成一个 mesh，`cast` 标志逐桶记录。结果是：继电器节点这种上百个零件的英雄件，最终 draw call 只等于其材质数；集装箱的瓦楞、猫道的格栅、货架的搁板都因"同几何同材质"落进同一桶。我方 kit 进一步把"同几何键 + 同材质键且数量 ≥ 4"的重复件收成 InstancedMesh，但语义不变：先按材质归并，再按重复度实例化。[src:pretty:L35446-L35511] [src:pretty:L35513-L35526]

**法则 3 · 轮廓放样优先于盒体缩放**：凡有断面、曲率或型材的道具，一律"采样轮廓 → 沿轴放样 → 逐顶点着色"；盒体只留给硬边件与 fallback。新泽西护栏是 12 点断面沿 3m 长度放样，底缘翻边用 `y − v·0.022` 抬升，顶点色同时表达水泥脏污、修补斑与底缘阴影；集装箱侧板先由 `Uc()` 采样瓦楞轮廓，再由 `la()` 沿箱长放样，并在顶点上叠三层变化（漆色抖动、底缘泥污、凹痕/锈斑）；灯杆用三段线性变径八棱柱，半径从 0.168m 收到 0.07m，段间故意加 7mm/14mm 重叠遮住接缝。放样点的密度直接决定面数与法线质量，也避免了 UV 展开与法线贴图这两笔额外资产。[src:pretty:L35927-L36003] [src:pretty:L35573-L35897] [src:pretty:L36019-L36103]

**法则 4 · 贴花与文字是带姿态的零件**：decal / label / number 三种零件进入同一局部坐标系，按宽高比与上限缩放，作为薄片几何提交，而不是后处理贴图。`jn.decal()` 以 `size·aspect` 生成平面；集装箱侧面的贴花由 `F()` 重新沿瓦楞曲面采样并重写 UV，保证贴花随波纹起伏而非悬空；文字与贴花经 `Mi()`/`Jn()` 缓存返回 `{material, aspect}`；标志牌把 0.5m 危险面版与 0.07m 文字压在同一块铝板上，文字最大宽 0.52m，超宽由 `aspect` 自动压缩。贴花因此可以参与合并、遮挡与碰撞排序，和"最后贴一张图"是两套不同的成本结构。[src:pretty:L35805-L35845] [src:pretty:L35525-L35560] [src:pretty:L36450-L36493]

**法则 5 · 碰撞盒与视觉同源，但允许分墙、分步、只挡弹**：每件道具自带局部坐标 collider 数组（`y=0` 落地），视觉参数变化必须同步改变碰撞盒；长盒旋转后由关卡按长轴切段。集装箱门开度 `doors>0.03` 时门扇绕铰链转 112°/100°，碰撞盒按门扇扫过的 3 段弧线切分，而不是留一整块实心箱；钢梯 12 级每级一个盒，另加平台与两侧扶手；标志牌面板标 `bulletOnly`，只挡弹道不挡行走；灯杆的锥形体用 0.34m 见方的保守盒覆盖。摆放阶段 `M()` 用 matrixWorld 变换每个 AABB，并在 `|sin(2θ)|>0.2` 时把长边切成至多 十 段来近似旋转体——旋转碰撞不是靠一个巨大的外接盒糊弄过去。[src:pretty:L35845-L35897] [src:pretty:L36575-L36642] [src:pretty:L36450-L36493] [src:pretty:L40335-L40373]

**法则 6 · seed 进每个 builder，变体空间有界且可缓存**：同 seed 必须逐字节复现；可枚举维度量化进缓存键，颜色在材质替换层生效。确定性 rng 是 `seed·2654435761` 后接 mulberry32；集装箱缓存键为 `type|seed%6|round(doors·10)/10|round(wear·2)/2`，单类型上界 6×11×3=一百九十八 个变体；颜色不进几何键，而是在 `Zg(parts, Map([[Jt, paint_<color>]]))` 时替换材质槽；非法颜色回落到 `seed·7+3 mod 8` 的色板项。现实收益是：一百九十八 个键之外的任意摆放都复用已有几何，而"同 seed 同结果"让截图 diff 与自检成为可能。[src:pretty:L35154-L35161] [src:pretty:L35900-L35927]

## 完整链路

以"从一张尺寸表到可走进去的堆场"为一条链，逐环节钉住上游实现与我方落点：

| 环节 | 内容 | 证据/落点 |
| --- | --- | --- |
| 意图与预算 | 港区四区（闸口/堆场/仓库/码头）+ 35 类道具 + 约 180 处手写坐标；零模型文件，几何在启动期拼装 | [src:pretty:L41859-L41924]（C1 的合并/动态分离）[src:pretty:L42110-L42118]（`props: t.placed.length` 等汇总）[src:pretty:L37358-L37372] |
| 算法入口 | `Yg.build(name, opts)`：builder 覆盖 → 通用盒回落；返回组带 `userData.prop/size/colliders` | [src:pretty:L35107-L35133] |
| 常量表 | 36 行 `[w,h,d,material,family]`；17 个 builder 注册；8 色集装箱色板 | [src:pretty:L35068-L35104] [src:pretty:L35900-L35927] |
| 上游实现 | 集装箱三变体 `M3/zA`；护栏 `S3`；灯杆 `T3`；围栏 `A3`；岗亭 `R3`；道闸 `C3`；系缆桩 `I3`；标志牌 `z3`；泛光灯 `D3`；钢梯 `k3`；猫道 `F3`；货架 `U3`；冷机 `N3`；继电器 `B3` | [src:pretty:L35573-L35897] [src:pretty:L35927-L36003] [src:pretty:L36019-L36103] [src:pretty:L36105-L36153] [src:pretty:L36155-L36308] [src:pretty:L36310-L36362] [src:pretty:L36450-L36493] [src:pretty:L36495-L36573] [src:pretty:L36575-L36642] [src:pretty:L36643-L36670] [src:pretty:L36738-L36833] [src:pretty:L36834-L36992] [src:pretty:L36998-L37352] |
| 装配 | 材质桶 + 变换栈 + 逐桶合并；同几何同材质重复件实例化 | [src:pretty:L35446-L35511] → `assets/props-kit.mjs` `buildModel`（纯数据 parts）与 `build()`（bucket/InstancedMesh） |
| 细节与贴花 | 箱号/CSC/中文吨位、危险面版、货位牌、冷机铭牌；文字上限与宽高比压缩 | [src:pretty:L35805-L35845] [src:pretty:L36450-L36493] → `DECAL_SPECS`、`buildModel` 的 `decal/label/number` 零件、`createDecalFactory` |
| 在场摆放 | `stack()` 逐箱累高 + 0.05/0.04m 抖动 + 门向 flip + 冷机后挂；`place()` 记录 `placed`；四区锚点与金属地面矩形 | [src:pretty:L40403-L40445] [src:pretty:L41507-L41768] [src:pretty:L41769-L41858] → 场景侧 `place/stack`（`examples/parity` 60 处手写摆放）、kit 的 `worldColliders/showcase` |
| 合并与动态分离 | 静态根按材质桶二次合并，`noMerge` 子树移到动态根；继电器双门、灯带、天线保留为动态件 | [src:pretty:L41890-L41924] [src:pretty:L37300-L37352] → 消费侧拆分；kit 把 `relay_node` 的运行数据挂在 `userData` |
| 运行时证据 | `stats()` 实测 `propKinds/propFamilies/builderCount/builtProps/builtParts/builtMeshes/builtInstanced/builtColliders/fallbacks`；场景侧 `__PARITY__.counts.propKinds/placedProps` | `assets/props-kit.mjs` `writeStats/selfTest`；`harness/element-manifest.json` props floor |
| 门禁 | 结构门禁 + 数量下限（≥12 类、≥60 实例）；kit 自检：尺寸=目录、零件≥4、碰撞盒≥1、同 seed 逐字节一致、22 贴花可绘 | `node harness/gates/complete.mjs --scene examples/parity`；`selfTest()` |
| 失效模式与兜底 | builder 抛错→`console.error` 后回落通用盒；未知键→warn+盒；无 THREE→`build()` 抛错但 `partsOf/collidersOf` 仍可跑；缺 CJK 字体→`label()` 退化为记录型画布；旋转长盒→按长轴切段 | [src:pretty:L35107-L35133] [src:pretty:L40335-L40373]；kit 的 `fallbackModel/build/applyPhysics` |

这条链的关键顺序是：**先有目录（可数），再有装配（可合并），最后才是摆放（可复现）**。反过来先摆场景再补目录，会立刻遇到"种类数对不上、碰撞盒与视觉不同步、同 seed 不一致"三类返工。

## 思维链

### 决策链一 · 为什么是"目录 + 覆盖式 builder"，而不是 36 个独立工厂

**约束**（事实）：单文件、零外部请求、启动期拼装；需求登记 35 类，但只有少数需要真零件（集装箱、灯杆、岗亭、货架、冷机、继电器）；关卡里约 180 处引用，任意一类缺失或拼错都会让整片区域变成空白。  
**目标**（事实）：种类可数、尺寸可改、未知键不崩，且新增道具不必动场景代码。  
**候选**（推断）：A 每类一个独立工厂，显式 import；B 只有尺寸表，所有道具都是缩放盒；C 尺寸表为底 + `_i(name, fn)` 可选覆盖，配通用盒回落。  
**选择**（事实）：C。`Gi` 是目录真源，`Xg` 是覆盖表，`Yg.build()` 的处理顺序是 builder → 通用盒 → 警告；通用盒也带同尺寸 collider 和底部对齐，因此"忘记实现"只损失细节，不损失可玩性。[src:pretty:L35068-L35104] [src:pretty:L35107-L35133]  
**兜底**（事实）：builder 抛错被 try/catch 吃掉并继续；未知键 `console.warn` 后仍返回盒；我方 `selfTest` 用"尺寸=目录、零件≥4、碰撞盒≥1"把这条链钉死。

### 决策链二 · 为什么集装箱要用型材放样，并把开合状态烘进几何

**约束**（事实）：箱体是场景主视觉，侧面瓦楞必须在低角度阳光下有真法线；玩家要能走进开着的箱门；同 seed 截图必须一致；箱体数量多，不能每个都几百个独立 mesh。  
**目标**（推断）：一只箱子同时满足"近看有波纹、开门有真碰撞、同变体可复用、颜色可换"。  
**候选**（推断）：A 盒子 + 法线贴图（要 UV 展开与贴图资产）；B 瓦楞用小盒逐条拼（接缝多、零件爆炸）；C 断面轮廓采样 + 沿长度放样 + 逐顶点颜色，门扇单独放样并按开度旋转。  
**选择**（事实）：C。`Uc()` 采样瓦楞断面，`la()` 放样侧板；顶点色叠漆面抖动、底缘泥污、凹痕与锈斑；门扇按 `doors` 旋转 112°/100°，`doors>0.03` 时生成 3 段弧形碰撞盒；贴花 `F()` 再沿同一曲面重采样 UV，所以箱号、CSC 铭牌能贴着波纹走。[src:pretty:L35573-L35897] [src:pretty:L35805-L35845]  
**兜底**（事实）：开度量化到 0.1、磨损量化到 0.5，缓存键只保留 198 个变体；未知颜色由 seed 选色；无 THREE 时 `partsOf()` 仍返回完整零件与碰撞数据，场景烘焙不依赖渲染器。

### 决策链三 · 为什么合并按材质桶，且必须留一条"动态分离"的缝

**约束**（事实）：继电器节点有大量零件，但场景要控 draw call；不同材质不能合批；少数件必须逐帧动（双门开合、灯带脉冲、天线摇摆）。  
**目标**（推断）：静态件尽量少 draw call，动态件不被合并吃掉，二者共享同一套 build 数据。  
**候选**（推断）：A 每个零件一个 mesh，简单但 draw call 爆炸；B 全场景合成一个 mesh，材质不允许且动态件无法分离；C 按材质桶合并 + 显式 `noMerge` 子树，关卡级再把静态根二次合并。  
**选择**（事实）：C。`jn` 的桶负责道具内部合并；关卡 `C1` 遍历静态根，把 noMerge 子树 `attach` 到动态根，再把静态根按材质桶合并成 `level-merged`；继电器用多个 `jn` 实例分别产出主体、门组、灯组、天线组，并把后三者标记 noMerge。[src:pretty:L35446-L35511] [src:pretty:L41890-L41924] [src:pretty:L37300-L37352]  
**兜底**（事实）：`cast` 标志逐桶控制阴影；重复件达到阈值才实例化；`noMerge` 沿父链向上检查，避免把动态件的子件误并进静态网格。

**推断边界**：凡标"推断"的候选空间与目标，只能由最终代码形态反推，压缩源码不保留作者的讨论过程；标"事实"的部分均以行号钉死。尤其"为什么选择 112°/100° 这两个开度"无法证实，只能确认它们是作者写死的常量。

## 迁移法则

**资产路由**：凡场景需要港区/仓库/工地类的可走道具（集装箱、护栏、灯杆、围栏、岗亭、道闸、货架、冷机、中继节点），直接消费 `assets/props-kit.mjs`，不要另写盒体占位。浏览器里 `createPropsKit(THREE, { materials, decals, instanceThreshold })`，其中 `materials` 必须是 `sl-surface` 工厂（`get(name)`），否则回落到 `MATERIAL_PRESETS`；只做布局/导航烘焙时走纯数据路径 `buildModel()` / `propColliders()` / `worldColliders()`，不需要 THREE。场景没有道具时应在 `scene.elements.json` 写 `n/a` 并给出理由，而不是拿一个缩放盒充数。路由总表见 `assets/index.md`。

**参数重绑点**（换场景必调）：
- `PROP_SIZES` 的三维与第五项 `family`——米制尺寸与物理表面族，改尺寸必须同步对应 `build*` 与碰撞盒；
- 第四项材质名——必须在 `sl-surface` 材质目录中存在，否则会静默回落 `MATERIAL_PRESETS.concrete` 外观；
- `seed`、`doors`（0–1，量化 0.1）、`wear`（0–1，量化 0.5）、`color`（8 色板）——直接决定箱体变体与磨损；
- `instanceThreshold`（默认 4）——重复件实例化的门槛，移动端可调高；
- `createCanvas/doc/decalMaxSize`——无 DOM 环境用 stub 画布，浏览器上限默认 1024；
- `applyPhysics` 的 `tag/surface` 与 `worldColliders` 的 `rotY`——碰撞标签与旋转近似；
- 展厅排布常量 26m 行宽、1m 间距——只影响 `showcase()` 机位，不影响场景。

**对账行**：`harness/element-manifest.json` props 族下限为 `propKinds ≥ 12`、`placedProps ≥ 60`；`examples/parity` 申报 36 类目录、17 builder、60 处手写摆放。判红信号是"道具全是同一个盒子换缩放"与"实例过百但种类 <5"——前者说明 builder 没接，后者说明布点在刷同一种占位。验收前先跑 `selfTest()`，再跑 `complete.mjs --scene examples/parity`；截图证据走 `props` 展厅。
