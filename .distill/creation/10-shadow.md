# 创物 · 阴影（shadow）

> 上游锚点：`// SALTLINE_SHADOW` PCSS 软阴影（sources/jimao-3a-game/index.html L4296-L4348；frustum 拟合与 chunk 替换在 L4296-L4349；基础参数与更新门控在 L4744-L4744）｜ 我方资产：`assets/pcss-shadow.glsl`（capture shader-011-frag lines 1242-1343 原样移植）｜ 对账：`harness/element-manifest.json` shadow 族（floor：shadowMaps ≥ 1、shadowTaps ≥ 10）｜ 验收：`node harness/gates/complete.mjs --scene examples/parity`

## 构建法则

**法则 1 · 先把世界尺度编译进 shader，再谈参数**：阴影参数的语言是米，不是 texel。运行时先用关卡 AABB 在光空间求包围盒（8 角投影 + 1m 边距、`near=max(1,p-4)`、`far=d+4`），把得到的 `width/height/depth` 经模板字符串 `toFixed(3)` 烧成常量 `SL_FRUSTUM`/`SL_DEPTH`——"metres across the shadow map" 写进注释就是单位合同 [src:L4296-L4296][src:L4298-L4299]。此后所有半径都在米域表达再换算：blocker 搜索半径 `(0.55*shadowRadius)/SL_FRUSTUM` 是"米→uv"的显式换算 [src:L4321-L4322]。

**法则 2 · 半影宽度由遮挡距离驱动（PCSS 的本义）**：先 Vogel 盘 8 tap 找 blocker 平均深度 `avg`，无 blocker 立即返回 1.0（全亮路径零成本）[src:L4323-L4331]；半影米数 `penM = clamp(distM*0.022*shadowRadius, 0.012*shadowRadius, 0.60*shadowRadius)`——离遮挡物越远影越糊，但双端钳死永不发散，注释自认 "sun half-angle scaled up for look"（物理系数为观感放大）[src:L4332-L4336]。之后 十六 tap Vogel 盘做百分比逼近 PCF [src:L4337-L4342]。tap 数是画质档合同：`low?十:十六`、searchTaps 固定 8 [src:pretty:L7000-L7024]。

**法则 3 · 接收面深度梯度是免费的 bias 修正**：用 `dFdx/dFdy` 在屏幕空间重建接收面在阴影 uv 空间的深度梯度 `dz`，每个采样点的比较深度随偏移量投影 `zr + dot(o, dz)`——曲面 acne 被几何而不是魔法数字消掉 [src:L4312-L4318]。梯度本身要钳制：`maxSlope = 0.0030/max(texel)` 注释写死 "never bias more than ~0.6 m per kernel"，防止掠射面上 bias 爆炸 [src:L4317-L4317]。bias 基线三件套在灯上：bias:-1.2e-4, normalBias:0.02, radius:1 [src:pretty:L7000-L7024]。

**法则 4 · 视锥边缘必须淡出，不给硬边露脸**：采样点落在阴影图边界附近时把遮挡结果 mix 回 1.0：`lit = mix(1.0, lit, smoothstep(0.0, 0.02, min(e.x, e.y)))`，`e` 是到 uv 边缘的距离——阴影图覆盖不到的地方永远不是"黑"，而是"未知=亮" [src:L4343-L4346]。同理函数头部的 frustum 外早退返回 1.0 [src:L4306-L4311]。这条是所有单张定向光阴影图的通用保险。

**法则 5 · patch three 而不是重写阴影系统**：PCSS 的落点是字符串手术 `shadowmap_pars_fragment = s.slice(0,o) + pcss + s.slice(a)`，只换 getShadow()，three 的阴影图生成、光照管线、点光路径全部保留 [src:L4349-L4349]。手术前先 indexOf("float getShadow(") 与 `indexOf("vec2 cubeToUV")` 校验 chunk 布局，不匹配直接退回 stock PCF 并留原 chunk（`Xy()` 可还原）[src:L4296-L4296] [src:pretty:L30834-L30834]。驱动层面还有第二道兜底：自检盒渲染若报软阴影 chunk 编译失败，恢复原 chunk、切 `PCFSoftShadowMap`、radius=2 用模糊半径近似软影 [src:pretty:L7000-L7024]。

**法则 6 · 阴影更新节奏与置信度挂钩**：`shadowMap.autoUpdate=false` 全局接管，更新门控为 `ultra || 截图模式 || 偶数帧 || 阴影图未建` 才置 needsUpdate——非 ultra 档隔帧重绘，ultra/首帧/截图全量 [src:pretty:L7000-L7024]。图尺寸按档 `min(quality.shadow, maxTextureSize)`（一千二十四/2048/4096），切画质档时 dispose 旧图强制重建 [src:pretty:L1044-L1068][src:pretty:L7000-L7024]。

**法则 7 · 一张阴影图至少两个消费者**：除了材质侧 PCSS，体积光柱 pass 直接绑同一张 `tShadow`，每步进点用手写 unpackRGBA 打包解码 + 单点 `step` 比较做太阳可见性，frustum 外返回 1.0、阴影图未生成时整体退化为无影 [src:L4409-L4414][src:pretty:L7000-L7024]。数据只生成一次，解码方式按消费者的预算各取所需。

## 完整链路

| 环节 | 内容 | 上游证据 | 我方落点 |
| --- | --- | --- | --- |
| 意图 | 低角太阳下的长软影：半影随遮挡距离生长，无固定半径 PCF 的「假软」 | [src:L4332-L4336] | pcss-shadow.glsl 头注释 |
| frustum 拟合 | 关卡 AABB（底两角 + 远两角）→光空间 8 角 min/max → +1m 边距、near-4/far+4 → 返回 width/height/depth | [src:L4296-L4296] | 移植 `Gy` 拟合算法到接入代码 |
| 常量注入 | `SL_FRUSTUM = vec2(w,h)`、`SL_DEPTH = depth` 模板字符串编译期固化 | [src:L4298-L4299] | 资产里是捕获值 88.699/54.781/141.881，接入必须重算 |
| 采样核 | `slIGN` 无纹理 IGN 随机 + `slVogel` 黄金角 2.39996323 螺旋盘，搜索/滤波各一盘、相位差 1.7 | [src:L4300-L4305] | 原样保留 |
| bias 链 | `bias(-1.2e-4) → normalBias(0.02) → receiver-plane dz(钳 0.6m/kernel) → zr` | [src:L4312-L4318][src:pretty:L7000-L7024] | dz 段必须随 SL_FRUSTUM 重算后验证 |
| blocker search | 8 tap Vogel，`d < zr+dot(o,dz)` 计入平均；`nb<0.5` 早退全亮 | [src:L4321-L4331] | 同上 |
| 半影 PCF | penM 米制双端钳 → filtR 至少 1.25 texel → 16 tap `step` 平均 | [src:L4332-L4342] | tap 数经 defines/参数按档切换 |
| 边缘淡出 | uv 边缘 2% 带内 mix 回 1.0 | [src:L4343-L4346] | 同上 |
| 替换与还原 | `indexOf` 布局校验 → slice 拼接 → `Xy()` 保存原文可还原；driver 拒绝再退 PCFSoft+radius2 | [src:L4349-L4349][src:L4296-L4296][src:pretty:L7000-L7024] | 接入代码必须实现两级兜底 |
| 运行时证据 | capture `evidence/shaders/shader-011-frag.glsl` lines 1242-1343；`stats().softShadows` 暴露开关状态 | [src:pretty:L7000-L7024] | examples/parity 截图对比 |
| 门禁 | shadow 族 floor：`shadowMaps≥1`、`shadowTaps≥10` | manifest shadow 条目 | `node harness/gates/complete.mjs --scene examples/parity` |
| 失效模式与兜底 | three 升级 chunk 变形→布局校验失败自动退 stock PCF；驱动拒编→自检后 PCFSoft 兜底；条纹/acne→查 dz 钳制与 normalBias；半影全屏糊→penM 上钳或 radius 误传大值；边缘黑框→边缘淡出被删 | [src:L4296-L4296][src:pretty:L30834-L30834][src:pretty:L7000-L7024] | 全部兜底分支随资产移植 |

## 思维链

### 决策链 A · 尺度为什么烧成编译期常量

**约束**（事实）：半影半径、搜索半径的合理值都以米为单位（0.012-0.60m 钳），而米→uv 的换算分母 `SL_FRUSTUM` 只有关卡加载、光空间包围盒算完之后才存在 [src:L4296-L4296][src:L4332-L4336]。
**目标**（事实）：参数在 shader 内保持米制语义，换关卡、换阴影分辨率都不需要重调参。
**候选**（推断）：A 每帧以 uniform 下发 frustum 尺寸——灵活但多一路状态、且米制参数仍要与 camera 漂移对账；B 编译期 `toFixed(3)` 注入常量——换关卡时重建材质即可，shader 里永远是纯常量表达式。
**选择**（事实）：B。`qy()` 收 `Gy()` 的 {width,height,depth}，直接插进模板字符串生成最终 GLSL [src:L4298-L4299][src:L4296-L4296]。
**兜底**（事实）：既然烧死了常量，chunk 来源成了新的脆弱点——所以替换前必须 `indexOf` 校验 three 的 chunk 布局，不符即退 stock PCF 并把原 chunk 存进 `xf` 备还原 [src:L4296-L4296][src:L4349-L4349]。常量化省下的运行时成本，一部分花在了布局防御上。

### 决策链 B · 一张图两个消费者，两种解码

**约束**（事实）：体积光柱每像素步进 `VOL_STEPS`（10-40 按档）个点，每个点都要太阳可见性；若每点跑 十六 tap PCSS 就是数百次阴影图采样 [src:pretty:L1044-L1068][src:L4425-L4443]。
**目标**（事实）：在半分辨率、每步 1-tap 的预算内给 raymarch 提供可见性，且不生成第二张图。
**候选**（推断）：A 体积侧也调 PCSS——采样爆炸；B 预烘一张「可见性图」——多一个全屏 pass 与一次数据落地；C 直接绑同一张阴影图，体积侧手写打包深度解码 + 单点 `step`。
**选择**（事实）：C。`sunVis()` 自己解 unpackRGBAToDepth 的 RGBA 编码（点积展开系数 0.99609375 系列），容差 0.0006，frustum 外返回 1.0 [src:L4409-L4414]；绑定侧 `tShadow = sun.shadow.map.texture`、uHasShadow 按图是否存在置位 [src:pretty:L7000-L7024]。
**兜底**（事实）：uHasShadow=0（首帧或阴影图未建）时整条可见性短路为 1，光柱先出来，阴影下一帧补上 [src:pretty:L7000-L7024]。半分辨率下 1-tap 的粗糙度由后级 `BLUR_TOL 0.30` 的深度感知模糊抹平——消费者侧的宽容差替生产者省掉了精度。

### 决策链 C · 隔帧更新为什么敢开

**约束**（事实）：阴影图重绘=一次全场景 depth pass，是最贵的隐形成本；上游已在全局关掉 autoUpdate，改由帧循环门控 [src:pretty:L7000-L7024]。
**目标**（事实）：ultra/截图全量、其余档隔帧，画质损失不可感知。
**候选**（推断）：A 每帧更新——无风险但双倍 depth 成本；B 只在场景变化时更新——需要脏标记系统，工程量大；C 按档时间换挡：偶数帧更新 + ultra 每帧 + 首帧/截图强制。
**选择**（事实）：C。门控表达式 `(quality=="ultra"||shot||(T&1)===0||!shadow.map)` 与 `onLevelReady` 的一次强制更新组合成完整策略 [src:pretty:L7000-L7024]。
**兜底**（事实）：太阳方向是关卡常量、不随帧变（`Mn.dir` 表），这是 C 成立的物理前提；切画质档改 mapSize 时 dispose 阴影图强制重建，不留旧分辨率的脏图 [src:pretty:L1044-L1068][src:pretty:L7000-L7024]。若把这套搬到太阳会动的场景，隔帧挡必须重估——这是移植时最容易被忽略的隐含前提（推断）。

**推断边界**：候选清单、以及「体积侧宽容差替生产者省精度」「隔帧依赖太阳静止」两条因果解释为推断；门控表达式、钳制数值、tap 数、绑定路径均为可复核事实。

## 迁移法则

- **资产路由**：`assets/pcss-shadow.glsl` 原样移植（含 `getShadow` + three 原生 `getPointShadow` 尾段，便于回退后点光仍有阴影）；接入方式是字符串替换 three `ShaderChunk.shadowmap_pars_fragment`，替换区间由 `indexOf("float getShadow(")` 到 `// cubeToUV()` 注释定位，与上游完全一致 [src:L4296-L4296][src:L4349-L4349]。
- **参数重绑点**：`SL_FRUSTUM/SL_DEPTH` 必须用自己的关卡包围盒经 Gy 式拟合重算，禁止沿用捕获值 [src:L4298-L4299]；tap/searchTaps 按画质档（低档 十/8，其余 十六/8）[src:pretty:L7000-L7024]；bias 三件套 `-1.2e-4 / 0.02 / 1` 与图尺寸 `min(quality.shadow, maxTextureSize)` 照抄起步再调 [src:pretty:L7000-L7024]；体积侧复用时自己实现打包解码（资产 `shafts.glsl` 的 `sunVis` 即范本）[src:L4409-L4414]。
- **对账行**：`harness/element-manifest.json` → `id:"shadow"`，floor `shadowMaps≥1`、`shadowTaps≥10`（required:false），detail 钉死「Vogel 盘 + blocker search + receiver-plane bias、10/16 tap、布局自检失败退 stock PCF、bias -1.2e-4 / normalBias .02、隔帧门控」；文档锚 `references/11-element-parity.md#shadow`；验收 `node harness/gates/complete.mjs --scene examples/parity`。
