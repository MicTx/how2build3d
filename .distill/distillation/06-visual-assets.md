# 06 · 视觉资产层：被第一次蒸馏漏掉的精髓

> 本文是蒸馏的自我修正记录。第一版 skill 蒸馏了**方法论层**（工作流/预算/注入纪律/
> 检视协议），漏掉了**资产层**——上游观感的真正来源是那 75.7% 手写 GLSL 的具体数学。
> 本篇把这一层补进 skill，并给出接入方式与参数表。

## 为什么会漏

对照实测（`evidence/frames/saltline-title.png` vs 本项目早前场景截图）逐项拆差：

| 维度 | 上游 | 早前我们的大巴扎 | 归因 |
| --- | --- | --- | --- |
| 体积光柱 | 光柱穿过堆场缝隙，双叶相位 + 近距增强 [src:L4425-L4445] | 无 | 资产层缺失 |
| 湿地反射 | 水洼锐镜面 + 湿沥青纵向拉伸模糊，按粗糙度 LOD [src:L1974-L1991之捕获对应] | 无 | 资产层缺失 |
| 后处理 | AgX 拟合 + 暗角 + 色差 + 颗粒 + 抖动 + Kawase AA 一条链 [src:L4612-L4740] | 只有 ACES | 资产层缺失 |
| 几何细节 | 1.8M 三角形、锈迹流挂、涂印编号、标识系统 | 12k 三角形、单层纹理 | 执行层未做满 |
| 光照 | PCSS 软阴影 + PMREM 环境 + 室内外环境切换 [src:L4296-L4348] | PCFSoft + 环境光常量 | 资产层缺失 |

结论：**方法论告诉你"要有体积光"，但不替你写出光柱的积分。** 蒸馏的四类产出
（常量表/生成器/注入骨架/降级链）里，第四类"可复用资产"没有交付——这是缺失的精髓。

## 资产清单

六个资产已从捕获的最终 GLSL 原样移植进 `assets/`（含出处头）：

1. **post-chain**：AgX（sRGB→REC2020→log2 压缩→多项式对比→outset→sRGB，与 ACES 按 uAgxMix 混合）[src:L4615-L4625]；暗角 `smoothstep(0.22,0.85,r2)*uVignette`；色差 `off = c*r2*uCA`（注意：**uCA 是全 UV 量级**，0.1 即 28px 偏移，标定后用 0.008）；颗粒/抖动/锐化在 post-aa。
2. **post-aa**：Kawase 双 tap + `#define` 级 FXAA 分支；颗粒按亮度加权 `mix(1.0,0.30,smoothstep(0.25,0.9,l))` [src:L4735-L4739]。
3. **shafts**：沿视线向太阳步进 `VOL_STEPS` 次，`ext = uSigma*shape(h)*(1+uBoxDust*inb)`，双叶相位 `hg(mu,0.78)*0.55+hg(mu,0.25)*0.45`，近距加权 `mix(2.3,0.55,smoothstep(4,85,t))`，远场解析延拓进地平线色 [src:L4425-L4450]。深度输入约定：**线性视距（米）**。
4. **sky-deck**：云甲板"太阳永远从缺口烧穿"的构图铁律与距离衰减抗锯齿 [src:L4230-L4251]。
5. **pcss-shadow**：Vogel 盘 blocker search，"never bias more than ~0.6 m per kernel" 的 receiver-plane bias [src:L4296-L4348]。
6. **ssr-wet**：水洼锐镜面/湿沥青纵向拉伸的混合权重 `mix(lodD, ..., gSoak)→lodP, gPuddle`，bicubic 采样 [src:L1561-L1601之捕获对应、L1974-L1991]。

## 接入方式

提取器 `harness/capture/assets.mjs` 的三条规则（踩过的坑即纪律）：

1. **剥头保留调参 define**：捕获源顶部是 three 的 GLSL3 前缀（`#version`/`layout(location=0) out`/`#define varying in`…），必须剥；但上游材质自己的 `#define LOOK_POWER 1.180` 是调参常量，**必须抢救回来**——否则 `undeclared identifier`。
2. **从自有代码 marker 起切**：每个系统有 `// SALTLINE_*` 或 `varying vec2 vUv` 起点标记，切早了会把 three 注入的 uniform/函数（`viewMatrix/cameraPosition/sRGBTransferOETF`）一起带进来，撞上 three 自带前缀的重复定义。
3. **深度语义**：shafts 的 `tDepthHalf` 是**线性视距（米）**而非硬件深度；用硬件深度纹理时在采样处换算 `viewDist = 2nf/(f+n-d(f-n))`，可直接省掉一整张深度 pass（大巴扎因此从 350 降到 118 draw calls）。

### 管线模板

```
scene → RT_scene(hdr+depth)
RT_scene.depth ─┬─ shafts pass → RT_shaft(acc, T)
                └─ composite: scene*T + acc → RT_comp
RT_comp → post-chain → RT_post（读写分离！）
RT_post → post-aa → 屏幕
```

三条工程红线（每条都真实踩过）：**post pass 不能读写同一张 RT**；**相机 dt 必须钳非负**
（首帧 rAF 时间戳可能早于 performance.now()，负 u 会打崩 Catmull-Rom）；**管线失败整体回退直出**
（与上游 `[advanced disabled, falling back]` 同构）。

## 参数表（移植标定值·大巴扎场景 800×450 low 档）

> 注意：本表是「小场景移植标定」，不是上游原生配置。上游原生值（uCA 0.0013 / uVignette 0.3 / bloom 0.065 / agxMix 0.25 / volSigma 0.0034 / 自适应曝光 key 0.12）见 `references/07-perceptual-quality.md` 第三节，两套口径按场景选用。

| 参数 | 上游语义 | 标定值（800×450, low 档） |
| --- | --- | --- |
| `uCA` | 全 UV 量级的通道偏移 | **0.008**（0.1 = 28px 残影） |
| `uVignette` | 边缘压暗 | 0.42–0.5 |
| `uGrain` | 亮度加权颗粒 | 0.026–0.03 |
| `uAgxMix` | AgX 与 ACES 混合 | 0.5 |
| `uExposure` | 线性曝光（NoToneMapping 下） | 1.5–1.8 |
| `VOL_STEPS` | 光柱步数 | 十二（low 档，上游 low 同值 [src:pretty:L1044-L1068]） |
| `uSigma` | 消光系数 | 0.02–0.028 |
| 反射 RT | 镜面分辨率 | 512²（水洼）/ 1024²（整面湿地） |

## 与第一次蒸馏的关系

方法论层（S0–S9）依然成立——本次补齐正是按它执行的：S0 明确"补观感差距"，S1 沿用画质表，
S2/S4 从捕获 GLSL 移植而非重写，S9 用同一检视协议验收。缺的只是第四类产出。
`assets/` 现在是 skill 的一部分：**方法论 + 资产**才构成完整蒸馏。
