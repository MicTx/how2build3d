# 创物 · 地面（ground）

> 上游锚点：`sources/jimao-3a-game/index.html` L5475-L5661（saltline-apron-3 三段 GLSL 与材质注入）、L44951-L45029（平面反射 pass） ｜ 我方资产：`assets/ssr-wet.glsl`（反射 + 双三次采样）、`examples/parity/src/ground.mjs`（mask/detail/marks 生成 + 平面反射） ｜ 对账：`harness/element-manifest.json` ground 族 ｜ 验收：`node harness/gates/complete.mjs --scene examples/parity`

## 构建法则

**法则 1 · 地面首先是一张水位图，其次才是材质**：积水不是“画出来的水洼”，而是 `depth = 0.5 - mask.r` 与噪声扰动比较后的等值区。mask 的 r 通道存微高度，`depth` 再叠加四层世界空间噪声、detail 颗粒、接缝凹槽与标线厚度 [src:L5583-L5597]；`puddle` 只是 `smoothstep(0, 0.035, depth)` 的结果 [src:L5585-L5585]。所以改水洼形状的正确入口是 mask 生成器，不是 shader 里的阈值。

**法则 2 · 一张 mask 四通道分工，禁止每层各建一张图**：r=微高度（水位）、g=干燥度、b=油污、a=磨损/交通抛光，四通道在同一次 `Rb` 遍历里写死 [src:pretty:L44405-L44422]。着色时一次 `gBicubic` 取出 `mk` [src:L5519-L5521]，随后 albedo、roughness、法线、标线磨损全部从这四通道派生 [src:L5549-L5625]。这条不变式把“地面有多少种脏”压缩成一次纹理采样，也让 CPU 查询只需读同一张 `Uint8Array`。

**法则 3 · 水是连续梯度，不是二值开关**：从积水 → 浸泡带 → 湿晕 → 干斑，四段 `smoothstep` 共用同一个 `depth`：`puddle` 5 cm 斜坡、`soak` 10–30 cm 浸泡带、`fringe` 约 1 m 湿晕、`dryP` 由 mask.g 与 fringe 共同决定 [src:L5585-L5592]。roughness 依次落到 0.055 / 0.13 / 0.2 / 0.42–0.74 [src:L5599-L5605]。断言：任何“水洼边界”都必须是渐变，出现硬边即是常量绑错。

**法则 4 · 标线是第二张画布，崩边在世界空间算**：标线/胎痕单独走 70×60 m 的 Canvas（`fa`），用 uMarkRect 映射，不烘进 albedo [src:pretty:L44487-L44495]；近距离用 `gBicubic` 消 texel 块 [src:L5557-L5559]，崩边 `chipN` 用 17/57/181 三频世界噪声，按距离逐级启用 [src:L5561-L5570]。这条法则解决“贴图放大后出现马赛克边”的典型失败：磨损发生在米/厘米尺度，而不是纹素尺度。

**法则 5 · 反射有两种材质语言，不能共用一套 LOD**：积水是锐镜像，`lodP = clamp(r*9.5-0.45, 0, 6.5)+0.9`；湿沥青只允许“竖向拉伸、随掠射角收紧”的模糊 sheen，`lodD = clamp(3+r*6.5-3.4*graz, 2, 7.5)`，两者按 `gPuddle/gSoak` 混合 [src:L5638-L5644]。采样是三次竖向偏移加权，最后 `min(pr, 48)` 防爆 [src:L5645-L5650]。这条不变式保证湿地面不会变成“第二面镜子”。

**法则 6 · CPU 查询与 GPU 着色共享同一张 mask**：`puddleDepth(x,z) = 0.5 - U1(mask, x, z, 0)`，`wetnessAt` 再按室内 0.12、场外 0.6、码头 1.0 分段 [src:pretty:L45509-L45526]；`U1` 是对同一 Uint8Array 的双线性采样 [src:pretty:L44424-L44434]。因此脚步声、水花触发点与画面上的积水永远同源，不会出现“看着是水、踩上去没声”。

## 完整链路

| 环节 | 内容 | 落点 / 证据 |
| --- | --- | --- |
| 意图 | 雨后港区地面要同时读作沥青、混凝土、积水、轮胎印与旧标线，并且可被玩法查询 | 世界常量 `quayX=三十`、`Li={x0:-44,z0:-40,size:80}` [src:pretty:L44352-L44352] |
| 算法 | mask 水位场 → 6 m 板缝/沥青裂缝 → 第二张标线画布 → 连续水带 → 粗糙度 LOD → 平面反射 | [src:L5514-L5626]、[src:L5627-L5653] |
| 常量 | mask 512/1024；detail 256/512；marks 1024/2048；水位 0.385；接缝 6 m；tar 0.022–0.052；水坡 0.035；深水 0.22；rough 0.055–0.74；反射 clamp 48 | [src:pretty:L45461-L45479] |
| 上游实现 | `Ib` 注入 `uMask/uMarks/uDetail/uDetailN/uRefl` 与 `uReflMatrix`；apron 为 190×320 平面旋转后平移到 x∈[-160,30]；`RR` 段替换 `lights_fragment_maps` | [src:L5654-L5661]、[src:pretty:L44940-L44948] |
| 我方资产 | `assets/ssr-wet.glsl` 保留 `gBicubic/gRipple/RR` 反射块；宿主 `ground.mjs` 以 6 个水洼盆 + 75×70 m mask 重写生成器 | `assets/ssr-wet.glsl`、`examples/parity/src/ground.mjs` L9-L70 |
| 运行时证据 | `puddlePatches=6`、`groundLayers=4`（运行时口径：mask/detail/detailN/marks）；平面反射目标按 `quality.planar` 缩放并对齐 16/8 | `examples/parity/scene.elements.json` ground note、`examples/parity/src/ground.mjs` stats |
| 门禁 | ground 族 `groundLayers ≥ 2`、`puddlePatches ≥ 3`；资产门禁要求 `ssr-wet` 整套接线 | `harness/element-manifest.json` ground 族 |
| 失效与兜底 | mask 边界渗色 → mIn 0.05 m 边带；近看 texel 块 → gBicubic；水洼黑块 → `deep` 只压暗不切黑 [src:L5596-L5597]；反射二次镜面 → gSoak 模糊带；planar:0 → uReflOn=0 但湿感仍由 albedo/rough 保留 [src:pretty:L44977-L44985] | [src:L5521-L5521]、[src:L5651-L5651] |

## 思维链

### 决策链一 · 80 m 地面怎么同时容得下大水洼和厘米级崩边

**约束**（事实）：mask 只有 八十×八十 m、512 或 1024 见方，即 十六 cm 或 8 cm 一个纹素 [src:pretty:L45462-L45466]；相机可以贴到地面 1 m 内。
**目标**（事实）：水洼边缘要有有机岸线，标线崩边要细到厘米，但内存只允许一张 1 MB 级的 mask。
**候选**（推断）：A 把 mask 提到 4K，内存与生成时间都翻 16 倍；B 用几何水面片，接缝与地形对不上；C 低分辨率水位场 + 世界空间多频噪声扰动。
**选择**（事实）：C。`depth` 在 mask 水位上叠加 2.5/6.7/20 三频噪声，并按距离逐级启用 [src:L5581-L5587]；标线另用 17/57/181 三频崩边 [src:L5561-L5566]。
**兜底**（事实）：`gBicubic` 对 mask/marks 做 4-tap B-spline 采样，把数据图的 texel 边抹掉；`mIn` 在 mask 四周留 5 cm 过渡带，防止边界拉花 [src:L5520-L5521]、[src:L5485-L5495]。

### 决策链二 · 湿地反射为什么不走真 SSR

**约束**（事实）：渲染预算由画质档 `planar` 控制（0 / 0.5 / 1），后处理只有一条全屏 pass；场景里同时有海面、雨、溅射要排除在反射相机外 [src:pretty:L44976-L45027]。
**目标**（事实）：积水要有清楚的倒影，湿沥青要有“亮一层”的 sheen，但不能出现第二面镜子或双倍几何。
**候选**（推断）：A 屏幕空间射线步进，单帧成本高且在湿沥青上噪声大；B 每个水洼一块平面反射，draw call 爆炸；C 一块低分辨率平面反射目标 + 按粗糙度查 LOD。
**选择**（事实）：C。反射相机镜像主相机、斜截头体裁剪、对齐 16/8 像素；`uReflLod = log2(h/270)` 把目标分辨率折进 LOD；puddle/soak/damp 三档 LOD 在 `RR` 内混合 [src:pretty:L44986-L45020]、[src:L5638-L5648]。
**兜底**（事实）：`quality.planar<=0` 或相机低于 0.03 m 时直接 `uReflOn=0`；此时湿感仍由 albedo 压暗与 roughness 下拉承担，不会整块变干 [src:pretty:L44977-L44985]。

### 决策链三 · 标线为什么不烘进 albedo

**约束**（事实）：标线要被积水淹没、被磨损啃掉、被反射一起反射；烘进 albedo 后就无法单独控制这些耦合。
**目标**（事实）：旧标线在不同湿度、不同距离下都保持“画在地上”的质感。
**候选**（推断）：A 直接画进 detail 图；B 每个标线一个贴花 mesh；C 独立 marks 画布 + 世界空间程序化崩边。
**选择**（事实）：C。`marks` 是第二张 Canvas，`kIn` 裁出有效矩形，`kpx` 估算屏幕上的纹素尺寸，`kpx<1` 时切 `gBicubic`，崩边 `chipN` 按距离启用 17/57/181 三频 [src:L5554-L5570]。
**兜底**（事实）：`keep` 同时乘 `(1 - max(tar, crack))`，标线遇到接缝/裂缝自动断开；`paint` 参与 roughness 与法线削弱，避免新漆比周围更“塑料” [src:L5570-L5578]。

**推断边界**：三条链的候选集与合作者动机属于反推；mask 通道语义、生成分辨率、阈值、LOD 公式、反射 pass 的排除清单均可在引用行内核对。尤其“作者是否考虑过 SSR”无法从产物证明，只能由 `quality.planar` 档位与单 pass 后处理结构推断其预算取向。

## 迁移法则

**资产路由**：ground 族拆成两半——屏幕空间反射与双三次采样进 `assets/ssr-wet.glsl`（纯 GLSL，`gBicubic/gRipple` 可直接复用），水位图/细节/标线生成器进宿主 `examples/parity/src/ground.mjs`。上游 `Ib` 的材质注入参数（`uMaskRect/uMarkRect/uReflMatrix/uReflScale/uReflLod`）必须原样保留，否则 `RR` 段无法与反射 pass 对齐。

**参数重绑点**：

| 参数 | 重绑到 | 注意 |
| --- | --- | --- |
| `Li` / `uMaskRect` | 场地包围盒 | 上游 80×80；parity 改为 75×70，改尺寸必须同步 mask 生成器与 `U1` 采样 |
| `waterLevel` | mask 生成器 | 上游 0.385；`depth=0.5-mk.r` 的单位由此固定，改它等于整体升降水位 |
| `uWetG` | 材质工厂 `mats.uniforms.wet` | 全局湿度乘子，天气切换只动这里 |
| `uReflOn/uReflLod` | `zb` pass | 由 `quality.planar` 与反射目标高度写入，宿主不要手填 |
| BASINS | 场景标定 | parity 用 6 个水洼盆；上游是辐射状 二十六 个凹点 [src:pretty:L44353-L44379] |
| 反射排除表 | `zb(i, uniforms, [apron, sea, rain, splash])` | 新增不参与反射的网格必须加进这个数组 |

**对账行**：`harness/element-manifest.json` ground 族（`asset: assets/ssr-wet.glsl`，floors `groundLayers ≥ 2`、`puddlePatches ≥ 3`，upstream refs `[src:pretty:L44697-L44860]`）；`examples/parity/scene.elements.json` ground 条目（6 个水洼、4 层）；`assets.consumption.json` 的 `ssr-wet: used`。三者同时为真，才允许在成品场景里声称“湿地反射已接线”。
