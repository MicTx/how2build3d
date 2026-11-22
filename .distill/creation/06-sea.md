# 创物 · 海面（sea）

> 上游锚点：`sources/jimao-3a-game/index.html` L5668-L5728（saltline-sea-1 片元/顶点补丁）、L5712（gv/kb 环形级差网格） ｜ 我方资产：`assets/sea.glsl`（七补丁体）、`examples/parity/src/sea.mjs`（切块 + 环网格装配） ｜ 对账：`harness/element-manifest.json` sea 族 ｜ 验收：`node harness/gates/complete.mjs --scene examples/parity`

## 构建法则

**法则 1 · 一张波表，三种消费**：海面的波长、振幅、方向只写一次，然后同时喂给顶点位移、片元斜率与 CPU 高度查询——任何改波的动作都不允许出现第二份拷贝。上游先把 B1 四道涌浪（λ 9.5/5.7/3.3/2 m，振幅 0.06/0.04/0.026/0.016 m）与 Db 七道碎波（λ 1.31…0.21 m）归一化方向、按 k=2π/λ、ω=√(9.81k) 预解算 [src:pretty:L45031-L45056]，再用模板字符串生成顶点位移 `CR` 与斜率 `PR/IR` [src:pretty:L45057-L45070]。CPU 侧的 `Lb` 只取 B1，并在码头墙 (30, 0) 半径 50→220 m 上做 `smoothstep` 衰减 [src:pretty:L45051-L45056]。断言的实质是：视觉波高、受光斜率、物理水位永远是同一组数的三种投影。

**法则 2 · 几何分辨率随距离增长，而不是均匀细分**：`gv(start,end,step,grow,cap)` 从 0.75 m 起步、每环 ×1.075、封顶 120 m；x 环从 27.5 m 走到 880 m，z 向带内 0.9 m 均匀、带外 ×1.085 [src:pretty:L45123-L45178]。这不是“省顶点”的小技巧，而是把顶点预算全部押在相机可能看清的近岸 50 m 内，同时用一条 880 m 的稀疏外圈保证地平线不断。结果是一张 63 环 × 216 线、约 1.36 万顶点的单网格，加三块角补丁封边，整个海面 1 个 draw call。

**法则 3 · 位移只在近岸生效**：顶点位移乘 `vSAmp = 1 - smoothstep(50, 220, distance(swp.xz, vec2(30, 0)))`，y 升沉与 xz 一阶摆动同相，码头墙旁波高最大、220 m 外归零 [src:L5713-L5718]。这条不变式的价值在于消灭两种远场病：顶点在稀疏环上抖动、以及波面与天空盒地平线错位。远海因此退化为静态平面，靠雾和 glitter 维持“在动”的错觉。

**法则 4 · 法线不是贴图，是波场的一阶导**：`gNxz` 由涌浪斜率 `slopeA * vSAmp`、碎波斜率 `slopeB * nearB` 与三层滚动 detailN（0.113/0.031/0.39 三频）叠加，再转成切线空间法线 `normalize(-gNxz.x, 1, -gNxz.y)` [src:L5668-L5704]。海面没有 UV 展开、没有法线贴图资产，波峰受光完全由同一张波表解析给出；detailN 只补近处碎纹，不承担大形。

**法则 5 · 高光沿太阳方位聚束，并被阵风打碎**：`directSpecular` 先钳到 40，再乘 `gSpark` 与 `az³`，其中 `az` 是视方向与太阳方位的水平对齐度 [src:L5719-L5727]。这保证 glitter 是一条朝太阳收束、随浪闪断的光路，而不是整片镜面白；40 的 HDR 上限则防止单点爆值穿透 bloom 变成脏斑。`gSpark` 由长涌明暗与猫爪阵风共同调制，背风处仍保留 0.55 下限。

**法则 6 · 岸线三件事共享一个距离场**：泡沫、油膜、环境遮蔽都由 `de = min(x - 30, 船壳圆角盒 SDF)` 驱动——泡沫带宽随 detail 噪声平方扩张、油膜限 5 m、`gOcc` 限 8 m [src:L5680-L5704]。因为它们量的是同一个 `de`，靠岸的脏、暗、白沫在视觉上锁死，不会出现“泡沫在左、暗部在右”的漂移。

## 完整链路

| 环节 | 内容 | 落点 / 证据 |
| --- | --- | --- |
| 意图 | 雨幕港区需要一片会动的海，且只能出现在码头墙外；不能是一块均匀蓝板 | 世界常量 `seaY=-1.6`、`quayX=30` |
| 算法 | 4 涌浪 + 7 碎波的正弦叠加（深水色散）→ 解析斜率 → 级差环网格 → 方位聚束 glitter → 距离雾 | [src:pretty:L45031-L45070] |
| 常量 | λ 9.5/5.7/3.3/2 m；A .06/.04/.026/.016 m；gv .75×1.075 cap 120；rough .1→.32；glitter clamp 40；雾 220→860 m | [src:pretty:L45123-L45178]、[src:L5719-L5727] |
| 上游实现 | `MeshStandardMaterial.onBeforeCompile` 七锚点 replace；`customProgramCacheKey = "saltline-sea-1"`；`receiveShadow=true`、`castShadow=false`、`frustumCulled=false`、`matrixAutoUpdate=false` | [src:L5719-L5728] |
| 我方资产 | `assets/sea.glsl` 把七段拆成 `SEA_VERT_HEAD / SEA_BEGIN_VERTEX / SEA_COMMON / SEA_MAP_FRAGMENT / SEA_NORMAL / SEA_GLITTER / SEA_FOG`；宿主按 `// ---- SEA_` 标记切块后 replace，网格按 `gv` 配方装配 | `assets/sea.glsl` L38-L133、`examples/parity/src/sea.mjs` |
| 运行时证据 | 63 环 × 216 线 ≈ 13.6k 顶点 + 3 角补丁，1 draw call；`__PARITY__` 自报 `seaSurfaces` | `examples/parity/scene.elements.json` sea note |
| 门禁 | `assets.mjs` 以 `saltline-sea-1 / SEA_GLITTER / SEA_NORMAL / uSunDirW` 判 used；`complete.mjs` 要求 sea 族 `seaSurfaces ≥ 1` | `harness/element-manifest.json` sea 族 |
| 失效与兜底 | 远场闪 → `vSAmp` 归零；glitter 爆 → clamp 40；无海场景 → sea 可声明 n/a（资产门禁记 optional）；锚点错配 → 固定 cacheKey 便于 shader 错误分诊 | [src:L5713-L5718]、[src:L5719-L5727] |

## 思维链

### 决策链一 · 海的几何怎么建

**约束**（事实）：单文件、零外部资源，海必须延伸到地平线，`boundingSphere` 半径 1300 m [src:pretty:L45169-L45178]；相机常驻码头，最近水线只有 2.5 m。
**目标**（事实）：近处看得见波峰，远处不闪、不裂、不露边。
**候选**（推断）：A 均匀 1 m 网格，880 m 需要近百万顶点；B 一张平面加滚动法线贴图，无真实高差，岸线会穿帮；C 级差环网格。
**选择**（事实）：C。`gv` 用几何级数把环距从 0.75 m 放宽到 120 m，再用三块角补丁封住 880 m 方形的缺口 [src:pretty:L45123-L45178]。
**兜底**（事实）：`frustumCulled=false` 加固定 boundingSphere 消除包围球误裁；顶点位移在 220 m 外归零，远处退化为静态平面，靠雾融进地平线 [src:L5713-L5718]。

### 决策链二 · 水面法线从哪来

**约束**（事实）：海面材质仍是 `MeshStandardMaterial`，没有 UV 展开，资产里也没有法线贴图；顶点只有 1.36 万。
**目标**（事实）：波峰要有可读的受光方向与高光，不能是一块随视角滑动的塑料膜。
**候选**（推断）：A 顶点位移后每帧 `computeVertexNormals`，1.36 万顶点 × 60 fps 的 CPU 重算法线不可持续；B 高度图 bump，需要额外纹理且会与位移脱节；C 波表解析斜率加 detailN 细纹。
**选择**（事实）：C。`slopeA/slopeB` 直接由 `cos(phase)` 给出，与顶点位移同源；`normal` 在片元里由世界 xz 坡度重建 [src:L5668-L5704]。
**兜底**（事实）：roughness 随距离从 0.1 抬到 0.32，远处高频法线自然淡出，避免稀疏环上的法线闪烁 [src:L5701-L5704]。

### 决策链三 · 为什么 glitter 必须钳 40 并乘 az³

**约束**（事实）：太阳方向光强度 9，后处理链有 bloom；水面镜面高光在 HDR 下会先爆点再被 bloom 放大。
**目标**（事实）：得到一条朝太阳的碎光路，随浪闪断，而不是整片白。
**候选**（推断）：A 直接吃物理 specular；B 用屏幕空间 bloom 遮罩裁；C 方位聚束乘 `gSpark`，并在进入 bloom 前钳 40。
**选择**（事实）：C。`az³` 把能量压到太阳方位 三十° 内，`gSpark` 用长涌与猫爪打碎，clamp 40 给 bloom 留安全余量 [src:L5719-L5727]。
**兜底**（事实）：长涌因子下限 0.55、阵风再乘 0.6–1.0，背风侧仍保留微弱反光，避免海面在逆光时完全死黑 [src:L5699-L5701]。

**推断边界**：决策链中的候选空间与“作者当时为什么排除 A/B”属于由结果反推的推断；波表数值、锚点替换、距离阈值、clamp 值与衰减区间均可在上述行号内逐字核对。凡标“推断”的步骤不当作事实引用。

## 迁移法则

**资产路由**：sea 族只有一个入口 `assets/sea.glsl`——它是 GLSL 文本资产而非 ES module，按文件原样读入后以 `// ---- SEA_` 标记切块，再 replace 到 `MeshStandardMaterial` 的七个 `#include` 锚点；宿主实现见 `examples/parity/src/sea.mjs`。不要为它新建 JS 工厂，也不要把补丁体改写成 `ShaderMaterial`（会丢掉 three 的光照/阴影 chunk）。

**参数重绑点**：

| 参数 | 重绑到 | 注意 |
| --- | --- | --- |
| `uDetail / uDetailN` | 场景程序化 RT | 三频平铺基数 0.113/0.031/0.39 已写死在 shader，改基数会同时改泡沫与猫爪尺度 |
| `uSunDirW` | sky-deck 太阳方向 | 必须与 PCSS/体积光同一个太阳向量 |
| `uHazeA / uHazeB` | `horizonAway*0.85` / `horizon*0.8` | 改天空色时同步，否则海天接缝出现色带 |
| `seaY / quayX` | 世界常量表 | 改码头墙位必须同步泡沫的 `x=30` 与船壳 SDF 中心 (41, -34.5) |
| 底材 | `color 16777215, roughness 0.1, metalness 0` | roughness 会被 `gRough` 整体覆盖，只作为兜底初值 |

**对账行**：`harness/element-manifest.json` 的 sea 族（`asset: assets/sea.glsl`，floor `seaSurfaces ≥ 1`，upstream refs `[src:pretty:L45181-L45240]`）；`examples/parity/scene.elements.json` 的 sea 条目（1 draw call）；资产门禁 marker `saltline-sea-1 / SEA_GLITTER / SEA_NORMAL / uSunDirW`。三者必须同时成立，才算这一族真正落地。
