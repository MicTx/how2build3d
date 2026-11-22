# 创物 · 材质（materials）

> 上游锚点：调色板与 四十八 条目录 [src:pretty:L34073-L34154]；注入七段 dA/pA/mA/gA/vA/xA/yA [src:pretty:L34155-L34318]；注入器 h3 [src:pretty:L34320-L34344]；材质工厂 w 与缓存键 [src:pretty:L34470-L34535]；压缩源对应 [src:L5295-L5330] [src:L5332-L5416] [src:L5418-L5449] [src:pretty:L21333-L21357] ｜ 我方资产：`assets/sl-surface.mjs`（`SL_SURFACE` 七段 GLSL、`SL_MATERIALS` 四十八 条、`SL_MATERIAL_FALLBACK`、`injectSLSurface`、`createSurfaceMaterialFactory`）｜ 对账：`harness/element-manifest.json` materials 族 ｜ 验收：`node harness/gates/complete.mjs --scene examples/parity`

## 构建法则

**法则 1 · 材质是目录行，不是资产文件**：一种材质的全部身份压缩在 十二 个数字里——`set/tint/color/rough/metal/wet[4]/macro[4]/nrm`，上游用 `Nt()` 默认行 + 覆盖项的写法让 四十八 种材质只写差异字段 [src:pretty:L34073-L34154]。8 种漆色更极端：一个 `Xa(hex)` 工厂函数吃一个十六进制色就生成一条目录（同 set "paint"、同 wet `kc`、同 macro），漆色差异只是 tint 参数 [src:pretty:L34073-L34154]。复刻时先建目录表再建工厂，顺序不能反——目录是数据，工厂是把数据编译成 MeshStandardMaterial 的唯一入口 [src:pretty:L34470-L34535]。

**法则 2 · 破损是共享概率场，不是逐材质手绘**：漆面破损只有一套模型 `paintDmg(uv, amt, chip, stain, run)`，输出「透底/氧化晕/锈水流挂」三通道，由两档 voronoi 漆片 + 阈值磨损场 + 双向划痕叠加而成，`amt` 是唯一旋钮 [src:L4801-L4830]。paint 用 `uP.x`（目录 p=[0.5]），hazard 硬编码 1.4（警示条纹磨损更狠），armor 用 0.5——三种漆面对话只通过这一个数字发生 [src:L4937-L4967]。破损聚簇 `zone` 让大部分板面保持干净，磨损才有叙事焦点 [src:L4801-L4830]。

**法则 3 · 涂层按「底→旧→新」次序叠 OV，最上层决定金属度**：paint 核（n3）用 `OV(D,k)` 把粉化白、尘膜、锈晕、底漆、钢锈、新划痕亮金属六层按序 mix 进 albedo，`ta`（albedo 透明度）同步衰减；金属度 `m = fresh*0.95 + (steel-fresh)*0.15`——只有「新划出的亮金属」才算金属，老锈是绝缘体 [src:L4937-L4952]。次序即物理：先旧后新，新划痕盖在锈上才成立 [src:L4937-L4967]。

**法则 4 · 物理状态走 uniform，不烘进像素**：雨湿、宏观脏污、UV 缩放、室内系数是五个运行时 uniform（`uSlWet/uSlWetP/uSlMacro/uSlUv/uSlX`），每条目录行的 `wet[4]`/`macro[4]` 只是这些 uniform 的初值 [src:pretty:L34073-L34154]。着色器侧按法线朝向分三区计算湿度：朝上 `slUp`、垂直面流挂 `slStreak`、背雨面 `slExpo` 归零，另加贴地回溅带 `slLow`；水珠用像素足迹 `fwidth` 衰减防闪烁 [src:L5332-L5416]。天气变化是参数插值，不是贴图切换。

**法则 5 · 粗糙度是派生量，不是贴图直读**：基础粗糙度先乘 ORM.g，再加 macro 噪声扰动 `uSlMacro.y*(…)`，湿度按 `uSlWetP.y` 压低，水珠处直接钳到 0.05；最后有一条反直觉法则——法线贴图长度反调粗糙度：`sqrt(r² + (1-|n|)*0.6)`，凹凸越破碎越粗糙，用一张图的两条通道互相担保 [src:L5418-L5429]。湿法线还要按朝向压平 `normalScale*(1-0.45*slWetK*slUp)`——水膜填平了细凹凸 [src:L5418-L5449]。

**法则 6 · 键即指纹，败必有底**：注入材质必须给 `customProgramCacheKey`，上游键 `"sl2|"+tint+(triplar?"t":"")+(fx?"f":"")+(alphaCut?"a":"")` 编码全部影响编译产物的维度 [src:pretty:L34470-L34535]。降级是双层的：查无此材质→`console.warn` 一次并换 fallback 行（metal 灰）；纹理烘焙抛错→退素色 MeshStandardMaterial（roughness .6 / metalness 0），绝不崩给玩家 [src:pretty:L34470-L34535]。

## 完整链路

| 环节 | 内容 | 证据 |
| --- | --- | --- |
| 意图 | 零贴图文件的前提下，让「漆/混凝土/钢/玻璃/织物」一眼可辨，且淋雨后各自变湿的方式不同 | 目录 四十八 条覆盖 二十九 个纹理集 [src:pretty:L34073-L34154] |
| 算法 | 目录行 → `MeshStandardMaterial`（map/normalMap/roughnessMap/metalnessMap/aoMap 全接 ORM 三图）→ 七段 GLSL 注入库存 PBR → 定义四开关（SL_TINT/SL_TRIPLANAR/SL_FX/SL_ACUT） | [src:pretty:L34470-L34535] [src:pretty:L34320-L34344] |
| 常量表 | `wet=[暗降,粗糙乘,湿痕,水珠]`、`macro=[亮度,粗糙,尺度,污垢]`；漆系 wet `[0.05,0.62,0.65,0.7]`、钢系 wet `[0,0.7,0.55,0.5]`、混凝土 wet `[0.42,0.38,0.5,0]` | [src:pretty:L34073-L34154] |
| 上游实现 | 注入器 h3 按锚点缝合七段 [src:pretty:L34320-L34344]；AO chunk 把 aoMap 读取换成 `slORM.r`（布局不符退库存）[src:pretty:L34155-L34318]；压缩源 [src:L5295-L5330] [src:L5418-L5449] |  |
| 我方落点 | `assets/sl-surface.mjs`：`SL_SURFACE`（七段原样）、`SL_MATERIALS`（48 条展开）、`SL_MATERIAL_FALLBACK`、`injectSLSurface(shader, uniforms, THREE)`、`createSurfaceMaterialFactory(THREE, texFactory, {wet})` | 文件 L22-L186 / L189-L676 / L680-L696 / L698-L769 |
| 运行时证据 | `mats.get("gunmetal", {triplanar:true})` 无 UV 几何可用；`uniforms.wet` 每帧改一次全场景生效（共享 uniform 对象）；`stats()` 回报 sets/textureMB/genMs；展厅暗色金属集 `_A` 全部走 triplanar | [src:pretty:L21333-L21357] |
| 门禁 | `harness/element-manifest.json` materials 族 floor：`materialCount ≥ 十六`；对账引用 [src:pretty:L34087-L34160] | manifest `floors[0]` |
| 失效与兜底 | 未知材质名 → 告警一次 + fallback 行；烘焙失败 → 素色材质；AO 锚文本漂移 → 库存 AO（仅 UV 语义降级）；three 升级 → 锚点 `#include <…>` 语法锁死风险面 | [src:pretty:L34470-L34535] [src:pretty:L34155-L34318] |

## 思维链

**决策链一 · 为什么 8 种漆色共享一个纹理集**

- **约束**（事实）：纹理烘焙按 set 计费（一千零二十四见方 × 3 张 RT ≈ 5MB 显存/集），而油漆的本质差异只有颜色 [src:pretty:L21333-L21357]。
- **目标**（事实）：红/蓝/绿/黄/橙/白/灰/青八种漆都要有，且都带同一套 chip/stain/run 破损 [src:L4801-L4830]。
- **候选**（推断）：A 每色一套纹理集（8×5MB，浪费）；B 一套灰度 albedo + 目录 tint 换色（一套够用）；C 运行时 material.color 相乘（会污染 ORM 里的固定锈色）。
- **选择**（事实）：B 的变体——tint:1 走「加色」混合分支 `diffuseColor.rgb = sampled + diffuse*sampled.a`，用 albedo 的 alpha 通道当遮罩把目录色染上去 [src:L5332-L5416]；目录行由 `Xa(hex)` 批量生成 [src:pretty:L34073-L34154]。
- **兜底**（事实）：tint 编进缓存键与宏 `SL_TINT`，色变不触发重编译 [src:pretty:L34470-L34535]。

**决策链二 · 为什么流挂（slStreak）在 triplanar 下关闭**

- **约束**（事实）：triplanar 服务无 UV 几何（枪械/暗色金属），采样坐标是世界坐标 [src:L5332-L5416]。
- **目标**（推断）：垂直雨渍要沿「世界下方向」在表面上连续，普通 UV 物体的 vUv/世界 y 一致，triplanar 三平面切换处会断裂。
- **候选**（推断）：A 在三平面里也算流挂（接受接缝瑕疵）；B 干脆关掉（损失细节换稳定）。
- **选择**（事实）：B——`slStreak` 整段包在 `#ifndef SL_TRIPLANAR` 里，tri 材质只保留朝上/背雨两区湿度 [src:L5332-L5416]。
- **兜底**（推断）：暗色金属件（`_A` 集）本来就是低反差表面，流挂缺失不可察觉 [src:pretty:L21333-L21357]。

**决策链三 · 为什么警示条纹不做贴图而做 emit 之后的加法**

- **约束**（事实）：hazard 与 paint 共用 n3 涂层核与破损场 [src:L4937-L4967]。
- **目标**（事实）：黄黑斜纹要在磨损后仍然可读（游戏语义：危险区）。
- **选择**（事实）：斜纹 `fract((uv.x+uv.y)*5)` 算出 `pc` 后以 `nt + pc*ta` 加在成品涂层上——条纹与划痕同场磨损（同一 fbm 扰动边缘），但通过加法保持条纹亮度不被尘膜完全吃掉 [src:L4937-L4967]。
- **兜底**（推断）：若条纹被磨损到不可读，hazard 的 amt=1.4 高破损反而成为「这里危险」的视觉信号 [src:L4937-L4967]。

**推断边界**：三条链中「候选」「兜底」两段多为结果反推，上游注释未写明动机；可证实的只有选择段的行为与位置（行号已钉）。法则 4 的「三区湿度」有注释原文佐证（"strongest on up-facing faces, streaky on verticals, none underneath"）[src:L5332-L5416]。

## 迁移法则

- **资产路由**：有 UV 的场景几何 → `mats.get(name)`；无 UV / 暗色金属 / 挤出体 → `mats.get(name, {triplanar:true, scale})`；链网 → 目录自带 alphaCut+side:2（且非 triplanar 才启用 SL_ACUT mip 渐隐 [src:L5407-L5417]）；玻璃 → `transparent` 分支自动关 SL_FX、`depthWrite=false`、`envMapIntensity=1.4` [src:pretty:L34470-L34535]。
- **参数重绑点**：换场景先改 `SL_MATERIALS` 行内 `wet[4]/macro[4]`（室内 `uSlX.x=0.12` 一次调弱全部雨效 [src:pretty:L34470-L34535]）；全局湿度 `mats.uniforms.wet.value` 是唯一天气入口（共享 uniform 对象，改一处全材质生效）。查平铺周期用 `tileOf(name)`，不要手猜 tile [src:pretty:L21333-L21357]。
- **对账行**：`harness/element-manifest.json` → `elements[id=materials]`：`asset: assets/sl-surface.mjs`、floor `materialCount ≥ 16`（上游 named=51：48 目录 + 8 漆色经工厂生成计口径不同）、doc 锚 `references/11-element-parity.md#materials`；场景侧用 `mats.names.length` 自报计数进 `__PARITY__.counts`。
