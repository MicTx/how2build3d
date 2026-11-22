# 保真对比报告：蒸馏补资产层前后

> 基准：上游真机截图 `evidence/frames/saltline-title.png`（2560×1268）。
> 对照：本项目 `evidence/frames/` 下的实测截图（headless Chrome + SwiftShader，800×450）。
> 本报告回答：「差距很大，是不是 skill 没蒸馏到精髓」——结论：方法论层蒸馏完整，**视觉资产层缺失**；补齐后观感差距显著收敛。

## 时间线

| 阶段 | 场景 | 关键缺失 |
| --- | --- | --- |
| D0 早前大巴扎 | `grand-bazaar.png`（升级前版本已被本次覆盖，观感见 `evidence/frames/flab-debug2.png` 同期的暗平版本） | 无后处理链、无光柱、无反射、ACES 单独、暗部死黑 |
| D1 fidelity-lab | `fidelity-lab.png` | 资产层接入后：逆光巷道 + 湿地镜面 + 光柱 + 颗粒，与上游 title 同构图 |
| D2 升级后大巴扎 | `grand-bazaar.png`（当前） | post 链 + 光柱 + PMREM 环境光 + 水洼反射 + 立面做旧 + 标识牌 |

## 对照要点

1. **构图与大气**：上游 title 的核心是「逆光 + 湿地镜面 + 体积光柱」。fidelity-lab 用移植的
   `shafts`（双叶相位、近距加权）+ Reflector 湿地 + `post-chain` 暖雾，复现了同一观感构成；
   太阳辉光、地平线暖带、远场解析延拓都来自原样移植的数学（见 `assets/shafts.glsl` 出处头）。
2. **反射**：上游的水洼锐镜面/湿沥青模糊由 SSR（`uRefl` LOD 混合）实现；fidelity-lab 用
   three 官方 Reflector 达到同构观感，`ssr-wet.glsl` 作为后续 SSR 化的移植参考。
3. **胶片感**：颗粒按亮度加权、抖动去色带、暗角与色差的标定值来自实测（`uCA` 是全 UV 量级，
   0.1 = 28px 残影，标定 0.008）——这类**量级标定**只有跑起来才测得出，也属于资产层的一部分。
4. **大巴扎升级**：PMREM 环境光消除死黑暗部；立面第二层做旧与标识牌提高近景信息密度；
   光柱在塔身后形成逆光层次。受限于仍无 bloom 源（tBloom 黑纹理）与云甲板未接入，
   与上游还有可预期差距——但已从「功能演示」跨到「氛围成立」。

## 数据

| 指标 | 上游（title, 真机） | fidelity-lab（SwiftShader） | 大巴扎升级后（SwiftShader） |
| --- | --- | --- | --- |
| draw calls | —（真机未知） | 40 | 118 |
| 三角形/帧 | — | ~5k | 16.5k |
| 管线 passes | scene + shafts + composite + post + aa（同构） | 6 pass | 5 pass |
| `__errors` | 0 | 0 | 0 |
| 帧时 | 真机 60fps | SwiftShader 12fps（软渲染，结构参考） | 30fps |

## 遗留（parked 候选）

- `tBloom` 仍是黑纹理：上游 bloom 来自 HDR 降采样链，需加两 pass 降采样才能点亮辉光。
- `sky-deck` 资产未接入大巴扎（当前仍是简化天空）；云甲板的「太阳烧穿缺口」可复用到巴扎黄昏。
- `ssr-wet` 的真 SSR（`uRefl` 反射 RT）尚未替换 Reflector：水洼目前是平面镜面。
- PCSS 资产已就位但大巴扎仍用 PCFSoft（需要自管阴影图与 `SL_FRUSTUM` 常量标定）。

每一条都有明确的资产与接入路径——**差距从"不知道为什么"变成了"还剩哪四件事"**。

## pass-2（四大遗留清零，2026-11-13_fidelity-pass2）

| 遗留 | 状态 | 实现 |
| --- | --- | --- |
| bloom | **已清** | post.mjs 内 3 级链：阈值提取（0.72）→ 两级降采样 5-tap 高斯 → `tBloom`（BAZAAR_BLOOM） |
| 云甲板天空 | **已清** | `SALTLINE_SKY` 资产接入（makeSkyDeckMaterial，uniform 重绑定），PMREM 换源 |
| PCSS | **已清** | chunk 字符串手术注入 assets/pcss-shadow（Vogel 盘），SL_FRUSTUM/SL_DEPTH 按阴影相机标定；原 chunk 备份可还原 |
| 水洼 SSR 化 | **部分** | 自定义 Reflector shader：3 tap 纵向拉伸 + 边缘衰减（真 `uRefl` SSR 仍为后续项） |

pass-2 后实测：`__errors` 0、124 draw calls（≤240 预算）、~10-20 fps（SwiftShader，结构参考）。
手术教训沉淀进 `.distill/distillation/06-visual-assets.md` 的三条接入纪律：剥头保 define、marker 起切、深度语义换算。

### 教训新增两条（pass-2）

4. **编译期切片带上下文**：从最终 GLSL 切出的资产可能含 `#endif` 包装与相邻系统定义（cubeToUV/getPointShadow 副本）——注入前要"只取本系统段"并对齐宿主 chunk 的 #if 配对。
5. **标定即资产**：`SL_FRUSTUM/SL_DEPTH` 必须用宿主阴影相机实测尺寸重算（88.7m/54.8m 是上游港区的数），硬抄上游数值等于阴影系统整体错位。
