# 材质与着色器：注入纪律

## 四步注入骨架

```js
mat.onBeforeCompile = (shader) => {
  shader.uniforms.uTime = uTime;                                    // ① 共享 uniform
  shader.vertexShader = DECL + shader.vertexShader.replace(       // ② 声明前置
    "#include <begin_vertex>", "#include <begin_vertex>\n" + VERT_BODY); // ③ 锚点追加
  shader.fragmentShader = DECL_F + shader.fragmentShader.replace(
    "#include <color_fragment>", "#include <color_fragment>\n" + FRAG_BODY);
};
mat.customProgramCacheKey = () => "my-inject-1";                  // ④ 必给缓存键
```

三条硬约束：

- **声明前置**，不塞进 include 内部（GLSL 要求声明先于使用）。
- **保留原 include 行**，只追加；three 升级时锚点仍在。
- **缓存键编码所有影响编译的维度**（tint/tile/interior/alphaCut/kind），并用 Map 复用材质实例。

## 常见锚点

| 用途 | 锚点 |
| --- | --- |
| 顶点位置/相位 | `#include <begin_vertex>` |
| 漫反射颜色 | `#include <color_fragment>` |
| 粗糙度 | `#include <roughnessmap_fragment>` |
| 金属度 | `#include <metalnessmap_fragment>` |
| 法线扰动 | `#include <normal_fragment_maps>` |
| AO | `#include <aomap_fragment>` |

## chunk 手术（改上游库源码）

只在必须整体替换某函数时做（如 PCSS `getShadow()`）：

1. `indexOf("float getShadow(")` 与 `indexOf("vec2 cubeToUV")` 校验布局；
2. `s.slice(0,start) + injected + s.slice(end)` 替换；
3. 不符就告警并 **return false 保持库存实现**；
4. 用 marker 常量（如 `"// MY_SHADOW"`）供错误分诊识别。

## SL 表面注入（资产层，首选路径）

`assets/sl-surface.mjs` 是上游表面系统的原样移植，接入 = 一处 `onBeforeCompile` + 五个 define + 一组 uniform：

```js
import { createTextureFactory } from "../../assets/sl-textures.mjs";
import { createSurfaceMaterialFactory } from "../../assets/sl-surface.mjs";
const texFactory = createTextureFactory(THREE, renderer, { tex: quality.tex });
const mats = createSurfaceMaterialFactory(THREE, texFactory, { wet: 1 }); // wet 全局湿度 0-1
mesh.material = mats.get("steel_dark", { triplanar: true });              // 目录 48 种
```

- **七个注入段**：顶点声明/顶点体/片元声明/map 段/roughness 段/metalness 段/normal 段，全部用 `#include <common>`、`<project_vertex>`、`<map_fragment>`、`<roughnessmap_fragment>`、`<metalnessmap_fragment>`、`<normal_fragment_maps>`、`<aomap_fragment>` 锚点；AO 段的 `.r` 读取换成 `slORM.r`（布局不符时保持库存实现）。
- **uniform 语义**：`uSlWet`（全局湿度）× `uSlWetP`（暗降/粗糙乘/湿痕/水珠）、`uSlMacro`（亮度/粗糙/尺度/污垢）、`uSlUv`（UV 缩放；triplanar 时 z=世界尺度）、`uSlX`（环境系数）。
- **define 组合**：`SL_TINT`（1 加法/2 亮度混合/3 乘法）、`SL_TRIPLANAR`（无 UV 几何）、`SL_FX`（湿/宏观变化，透明与 alphaCut 材质自动关闭）、`SL_ACUT`（铁丝网 mip 渐隐）。
- **纹理来源**：`sl-textures.mjs` 的 MRT 工厂一次生成 albedo（sRGB）/ORM/法线三张，`texture.repeat=1/tile` 完成米制平铺；生成器与参数集全部带出处，改参数前先对照 07 篇校准表。

**不要**用「纯色 MeshStandardMaterial + 手调 roughness」替代这一层——那是「塑料感」的第一来源。

## GLSL 配方要点

- 噪声：一张共享 256² RGBA 纹理；`n2()` value noise；`fbm5` 给天空、`fbm3` 给表面；旋转矩阵 `mat2(1.6,1.2,-1.2,1.6)` + 偏移 `17.3` 去方向性。
- 天空：云甲板留缺口锁定太阳、密度梯度当自阴影、远距衰减抗锯齿、远云融进地平线、太阳盘不进 PMREM。
- 海面/湿地：`uSlWetP/uRain` uniform 驱动粗糙度，不切贴图；波形 fbm + `uTime`。
- 闪烁：每实例 `attribute vec3 blink(周期,相位,占空)`，vertex 算相位、frag 乘亮度；几何需 `toNonIndexed()`。
- 后处理：见 `01-render-pipeline.md`。

## 复用片段

`snippets/sky.glsl.mjs` 与 `snippets/sea.glsl.mjs` 导出可直接拼进 ShaderMaterial 的 GLSL 字符串。

## 自检

- [ ] 每个注入材质都有 `customProgramCacheKey`
- [ ] 每个缓存键能唯一代表一个编译产物
- [ ] 注入失败时场景仍出画
- [ ] 最终 GLSL 可被 `shaderSource` 钩子捕获并 diff
