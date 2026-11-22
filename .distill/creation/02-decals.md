# 创物 · 贴花（decals）

> 上游锚点：Canvas 贴花工厂 `l3` 与 22 个 painter 在 `sources/jimao-3a-game/index.html` L5294（SL_TRIPLANAR 注入区起点），地面标线图集 `Pb` 在 L5474 行内，共享漆面破损 `paintDmg` 在 L4801-L4936；美化版对应 L33036-L34042、L44488-L44690、L32508-L32678。 ｜ 我方资产：`assets/props-kit.mjs` 的 `DECAL_SPECS` / `DECAL_TYPES` / `DECAL_PALETTE` / `createDecalFactory` / `decals.canvas|label|number`。 ｜ 对账：`harness/element-manifest.json` decals 族（`decalTypes ≥ 6`、`placedDecals ≥ 15`）。 ｜ 验收：`node harness/gates/complete.mjs --scene examples/parity`。

## 构建法则

**法则 1 · 贴花是确定性的绘制程序**：一张贴花 = 绘制函数 + 六色调色板 + seed 的纯函数，同 `name` 同 `seed` 必须逐像素一致。工厂为每个名字注册一个 `(ctx, W, H, rng, pal)` painter；贴花查找器用 FNV-1a 把名字散列成 32 位种子，再与用户 seed 混合喂给 mulberry32；调色板只有 white/black/yellow/red/navy/orange 六色，所有危险标、油渍、锈流都从这六色与透明度里调。贴花纹理按 `w×h×4×1.34` 记账（含 mipmap 余量），因此"再加一种贴花"的代价是可预先计算的字节数，而不是一次美术外包。[src:pretty:L33036-L33043] [src:pretty:L33142-L33160] [src:pretty:L33225-L33310]

**法则 2 · 做旧是四道按密度缩放的 pass**：咬边、划痕、点锈、径向污渍各是一段可参数化循环，不是一张污渍贴图。`ra()` 生成 9 边形随机孔洞，半径按 `n(1−o+s·o·2)` 抖动；`Ks()` 以 `destination-out` 依次挖：孔洞数量 `n·W·H/700`、孔径 `pow(s,3)·H·0.09+0.6`；划痕 `n·16` 条、线宽 `0.5+s²·3`、长度 `(0.1+s·0.5)·W`；锈点 `n·W·H/60` 个 1–2px 方点；污渍 `n·6` 个径向渐变，中心 alpha `0.25+s·0.4`。`amount` 一路贯穿，所以同一 painter 能以 0.15 印出"轻度磨损"，以 0.8 印出"二十年旧牌"。[src:pretty:L33063-L33108]

**法则 3 · 文字是一台小型排版引擎**：`qa()` 逐字 `measureText` 再 `fillText`，字距 `s·0.06`，对不在 `I/1/空格/连字符/句点` 白名单里的字符用 `destination-out` 挖断桥（stencil 漏字），并按 `maxW/fitW` 整体横向缩放；`label()` 统一转大写，缓存键为 `l:text|color|font|distress`，画布宽度被 `min(1, 2000/(测量宽+32))` 压到 2000px 以内，材质名固定为 `label`。字体未就绪时不阻塞：启动时对 五百/600/700/900 四个字重调用 document.fonts.load()，命中后延迟 120ms 重绘所有文本贴花并标脏纹理。[src:pretty:L33110-L33141] [src:pretty:L33983-L34010] [src:pretty:L34010-L34042]

**法则 4 · 贴花材质是"透明薄片"而不是普通表面**：贴花材质的固定组合是 `transparent:true`、`depthWrite:false`、`polygonOffset:true`、`polygonOffsetFactor:-2`、`polygonOffsetUnits:-2`，再按规格给 `roughness/metalness`；纹理设 sRGB、各向异性 4、开 mipmap。几何侧再叠一道保险：集装箱侧面贴花用 `0.0012–0.003m` 的深度偏移，招牌面板用 `0.0362m` 的相对偏移。名字也是协议：普通贴花统一 `decal_<name>`，文本材质统一 `label`，后者正是关卡级合图器的发现依据。[src:pretty:L33142-L33160] [src:pretty:L35805-L35845] [src:pretty:L36450-L36493]

**法则 5 · 地面标线是通道编码的世界空间图集**：`Pb(2048)` 把世界矩形 `x∈[−40,30]`、`z∈[−30,30]` 一次性映射进画布（`setTransform` 带 `−x0·s, −z0·o`），用 `globalCompositeOperation="lighter"` 叠加，三种颜色各占一个用途：红 `#ff0000` 画车道线/禁停/泊位，绿 `#00ff00` 画中文、编号与箭头，蓝 `rgba(0,0,255,α)` 画轮胎痕与拖痕；随机种子固定为 90210。纹理以 `flipY=false`、clamp、mipmap、各向异性上传，地面 shader 用世界矩形 uniform 反查。数学上这是"一张图代替 N 个 quad"：标线跨几十米仍连续，且没有接缝与 z-fighting。[src:pretty:L44488-L44505] [src:pretty:L44560-L44585] [src:pretty:L44640-L44690]

**法则 6 · 漆面破损是共享 shader 模型，贴花只负责局部故事**：`paintDmg(uv, amt, chip, stain, run)` 同时输出三种独立量：`chip` 是"露底"（两层 Voronoi 薄片 `20×11`/`64×40` + 磨损阈值 `0.925−0.06·amt` + 划痕），`stain` 是孔洞周围的氧化晕（用同一 Voronoi 的半径与 `fbm` 门控），`run` 是"锈流"（向上取 4 个样本，按 `1−i/5` 衰减累积，再乘纵向拉长的条纹噪声）。它被 `paint`/`hazard`/`armor` 三种 surf 以不同 `amt` 调用（`uP.x`、1.4、0.5），所以集装箱、机械、护栏的掉漆是同一套物理，而不是三张贴图。贴花 rust_run/grime_streak 只负责在局部补一笔"这里流过锈"，不承担全表面磨损。[src:pretty:L32508-L32540] [src:pretty:L32665-L32678] [src:L4801-L4936]

## 完整链路

从"一个名字"到"贴在地面/箱门/招牌上的像素"，逐环节如下：

| 环节 | 内容 | 证据/落点 |
| --- | --- | --- |
| 意图与预算 | 港区危险标、泊位号、中文钢印、地面导视、油渍/锈流/弹孔，全部零图片资产；启动期生成 | [src:pretty:L33030-L33054] [src:pretty:L44488-L44505] |
| 规格表 | 22 条 `[w,h,{bleed,rough,metal,text}]`；6 色板；6 种招牌面 + 5 条中文钢印文案 | [src:pretty:L33036-L33043] [src:pretty:L33225-L33310] → `DECAL_SPECS`、`DECAL_TYPES`、`DECAL_PALETTE`、`SIGN_DECALS/SIGN_TEXTS` |
| 绘制算法 | painter `(ctx,W,H,rng,pal)` → 底色 bleed（alpha 0.012）→ 图形 → 四道做旧；名字散列 + seed 决定 rng | [src:pretty:L33142-L33160] [src:pretty:L33063-L33108] → `createDecalFactory().canvas(name,{seed})` |
| 文字排版 | 字体栈（PingFang SC / Impact / Arial / 等宽），逐字测量、字距、断桥、`fitW/maxW`，宽度上限 2000px | [src:pretty:L33110-L33141] [src:pretty:L33983-L34010] → `stampText`、`label(text,{color,font,distress,maxW})` |
| 编号 | 上游用 640×128 数字图集 + 材质 UV `repeat(0.1,1)/offset(d/10,0)`；我方用 `drawImage` 裁出单格 | [src:pretty:L33935-L33962] [src:pretty:L33965-L33982] → `number(v)`、`decals.number` |
| 材质与薄片 | sRGB + aniso 4 + mipmap；transparent、depthWrite false、polygonOffset −2；按规格给 rough/metal | [src:pretty:L33142-L33160] → `decalMaterialFor()`（`mat.name="decal_"+…`） |
| 局部放置 | 世界 `decal(name,size,x,y,z,dir)` / `label(text,…)` 生成带朝向的平面；集装箱侧面用 `F()` 按瓦楞曲面重采样 UV；招牌面版与文字压板 | [src:pretty:L35805-L35845] [src:pretty:L36450-L36493] [src:pretty:L40280-L40330] → `buildModel` 的 `decal/label/number` 零件 |
| 地面标线 | 2048 世界图集：红=线、绿=文字/箭头、蓝=轮胎痕；`lighter` 叠加；`flipY=false`、clamp、mipmap | [src:pretty:L44488-L44505] [src:pretty:L44560-L44585] [src:pretty:L44640-L44690] → 归 `ground` 族（上游 shader 以 `uMarks/uMarkRect` 采样；我方 `assets/ssr-wet.glsl` 只覆盖湿面/反射，标线层按此协议补） |
| 关卡级合图 | `rb()` 收集 `material.name==="label"` 的非动态 mesh，按高度排序做 shelf packing，2px 留白，2048 宽 POW 高；逐 mesh 重写 UV，替换成单一 `label_atlas` 材质 | [src:pretty:L40470-L40560] [src:pretty:L41890-L41924] → 我方未内建 rb，靠 `createDecalFactory` 缓存；迁移时按此协议补 |
| 漆面破损 | `paintDmg` 输出 chip/stain/run，供 paint/hazard/armor surf 以 `amt` 调用；集装箱顶点色再叠一层脏污/凹痕 | [src:pretty:L32508-L32540] [src:pretty:L32665-L32678] [src:pretty:L35573-L35897] → `sl-surface` / `sl-textures` 的材质层；本 kit 提供 `rust_run/grime_streak` 贴花 |
| 运行时证据 | `decalTypes`、`decalSlots`、`decalMeshes`、`decalBytes`（按画布尺寸记账）；场景侧 `__PARITY__.counts.placedDecals` | `assets/props-kit.mjs` `decals.stats()` / `writeStats`；`examples/parity` 13 块地面贴花 |
| 门禁 | 数量下限（≥6 种、≥15 处）；判红：一个场景零贴花 | `node harness/gates/complete.mjs --scene examples/parity` |
| 失效模式与兜底 | 未知贴花→warn 并回落 `grime_streak`；painter 抛错→`failed` 计数并抛出；无 DOM→记录型 stub 画布（`live=false`，只留槽位）；超尺寸→`maxSize` 夹取；字体未就绪→120ms 后重绘；z-fighting→polygonOffset + 微偏移 | [src:pretty:L33954-L33964] [src:pretty:L34010-L34042]；kit 的 `createDecalFactory/createStubCanvas` |

这条链的独特处在于"三层分辨率"：单张贴花按 128–640px 画布生成，文字按测量宽度自适应，地面标线按 2048 世界图集一次铺满；三者都在 CPU 启动期完成，运行时只剩纹理绑定与采样。

## 思维链

### 决策链一 · 为什么用 Canvas 2D，而不是位图或 SDF

**约束**（事实）：仓库只允许一个 HTML、零外部请求；22 种图形必须风格统一；还需要任意中文、任意编号；启动期有分片预算。  
**目标**（推断）：图形多、可改、可复现、无字体/图片资产，且单张成本可预算。  
**候选**（推断）：A 打包位图图集；B 在 shader 里用 SDF 字形 + 程序化形状；C Canvas 2D 逐张绘制 + `CanvasTexture`。  
**选择**（事实）：C。22 个 painter 覆盖全部图形，`qa()` 负责文字排版，`Ks()` 负责做旧；每张画布按 `w·h·4·1.34` 记账；结果按 `name|seed` 缓存，重复引用零成本。[src:pretty:L33142-L33160] [src:pretty:L33225-L33310]  
**兜底**（事实）：未知贴花 `console.warn` 后回落 `grime_streak`；painter 抛错把 `failed` 加一并继续抛给调用方；无 DOM 环境返回记录型画布，仍能验证"画了多少笔"；文字材质在字体加载完成后延迟重绘，避免用错字体定型。

### 决策链二 · 为什么地面标线是一张世界图集，而不是几百个贴花 quad

**约束**（事实）：标线要跨几十米（车道线、泊位线、斑马线），必须在任意距离连续；地面已有湿痕/反射/细节三张数据图；还要区分"漆线、文字、轮胎痕"三类内容。  
**目标**（推断）：一次采样拿到全部标线，零接缝、零额外 mesh、可做通道分离。  
**候选**（推断）：A 每段线一个贴花 quad；B 世界空间大画布 + RGB 通道编码，地面 shader 反查；C 把标线烘进地面顶点色。  
**选择**（事实）：B。`Pb()` 用 `setTransform` 把世界矩形映射进 2048 画布，`lighter` 叠加；红通道画漆线，绿通道画中文/编号/箭头，蓝通道画轮胎痕；纹理 `flipY=false`、clamp、mipmap，地面 shader 用 uMarkRect 反查世界坐标。[src:pretty:L44488-L44505] [src:pretty:L44560-L44585] [src:pretty:L44640-L44690]  
**兜底**（事实）：图集尺寸固定 2048，超出的内容只能压缩线宽/字号；mipmap 防止远距闪烁；轮胎痕用低 alpha 蓝通道叠加，避免抢主标线；若地面 shader 未接 marks 贴图，标线整体不出现，但不会破坏其他地面层。

### 决策链三 · 为什么中文标签要在关卡级再打一次图集

**约束**（事实）：关卡里中文标签几十处（通道名、泊位名、货位牌、冷机铭牌），每张都是独立 CanvasTexture；有些标签挂在会动的门上；字体加载是异步的。  
**目标**（推断）：标签多而小，希望一次 draw call；但不能把动态件合死。  
**候选**（推断）：A 保持每标签独立材质；B 预先把所有标签烘进一张世界大图；C 运行时收集 `name==="label"` 的非动态 mesh，按高度排序打进 2048 宽 POT 图集，逐 mesh 重写 UV 并替换成单一 atlas 材质。  
**选择**（事实）：C。`rb()` 先按 `material.name==="label"` 收集，沿父链排除 `noMerge`；按高度降序做 shelf packing（2px 留白，宽度上限 2048，总高超过 4096 则放弃）；每个 mesh 克隆几何并重写 UV 到图集子矩形；最后所有标签共享一份 `label_atlas` 材质。`C1` 用 `try/catch` 包住并在失败时保留原材质。[src:pretty:L40470-L40560] [src:pretty:L41890-L41924]  
**兜底**（事实）：唯一标签材质少于 2 种时直接不启用（避免无收益）；`noMerge` 标签跳过；总高超过 4096 放弃合图；合图异常由关卡捕获并记 `[level] label atlas failed`。

**推断边界**：三条链的"候选空间"与"目标"均为从代码形态反推，压缩源码不保留作者当时的讨论；"选择"与"兜底"均有行号或可观察行为支撑。特别是"为什么图集宽固定 2048、留白 2px"只能确认是常量，无法证实其调参过程。

## 迁移法则

**资产路由**：凡场景需要危险标、泊位号、货位牌、中文钢印、油渍/锈流/弹孔/裂纹/涂鸦，消费 `assets/props-kit.mjs` 的 `createDecalFactory()`，不要引入图片贴花。路线分三层：
- 单张贴花/文字/编号 → `decals.canvas(name,{seed})`、`decals.label(text,opts)`、`decals.number(v)`，再按 `aspect` 生成平面；
- 地面导视 → 不要逐个 quad 铺，按 `Pb` 的"世界矩形 + 通道编码 + 一张 2048 图集"交给 `ground` 族（上游以 `uMarks/uMarkRect` 采样；我方 `assets/ssr-wet.glsl` 目前只覆盖湿面/反射，标线层需按此协议补）；
- 全表面掉漆/氧化/锈流 → 不归贴花，走 `sl-surface`/`sl-textures` 的 `paintDmg` 材质模型；贴花只补局部故事。路由总表见 `assets/index.md`。

**参数重绑点**（换场景必调）：
- `DECAL_SPECS` 的 `[w,h]`、`bleed`（渗出底色，决定边缘融合）、`rough/metal`（贴花与底材的反射匹配）、`text`（是否含排版文字）；
- `DECAL_PALETTE` 六色——换品牌色/信号色时只改这里，所有 painter 同步；
- `seed`——同 seed 逐像素一致，是截图基线与 A/B 对比的前提；
- `maxSize`（默认 1024）与画布上限 2000px——移动端可下调，但文字会变糊；
- 字体栈（PingFang SC / Noto Sans CJK SC / Impact / Arial）——缺 CJK 字体会退化，必须在目标平台实测；
- 贴花薄片的 `polygonOffset −2/−2` 与几何偏移 1–3mm——z-fighting 的第一道防线；
- 上游式合图协议：文本材质名必须是 `label`、普通贴花是 `decal_<name>`，`rb()` 的 scale 0.5、gutter 2px、宽 2048、总高 ≤4096——改任一常量都要重跑标签清晰度检查；
- 地面图集的世界矩形 `x0/z0/w/h` 与 `uMarkRect`——换地图必须同步改，否则标线会整体错位。

**对账行**：`harness/element-manifest.json` decals 族下限为 `decalTypes ≥ 6`、`placedDecals ≥ 15`；`examples/parity` 申报 22 种贴花、13 块地面贴花 + 道具自带贴花槽。判红信号是"一个场景零贴花"——上游连箱门重量勾稽、通道名、货位限重都要印上去；另一个隐性判红是"贴花来自图片文件或每个贴花一张独立未缓存纹理"，后者会把纹理与材质数量推爆。验收前先跑 `selfTest()`（22 painter 是否真的落笔）与 `decals.stats()`，再跑 `complete.mjs --scene examples/parity`。
