# 04 · 材质系统：onBeforeCompile 注入工法与库存 diff

> 素材源压缩后不可读，但**注入产物在运行时是完整明文**。本篇把 9 处注入点逐个
> 拆开，并用 `harness/analyze/chunk-diff.mjs` 与上游 three@0.180.0 的 109 个 ShaderChunk
> 做区间覆盖，回答"作者到底写了多少 GLSL"。

## 注入点清单

app 侧 9 处 `onBeforeCompile`，按手法分三类：

| # | 注入点 | 缓存键 | 手法 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | 发光体闪烁（警示灯/中继） | `saltline-blink` | vertex 注 `begin_vertex` + frag 注 `color_fragment` | [src:pretty:L18627-L18651] |
| 2 | 海鸥群 | `saltline-gulls` | vertex 程序化动画（翅膀相位） | [src:L5474-L5474] |
| 3 | 岸面/湿地（apron） | `saltline-apron-3` | frag 湿润反射增强 | [src:L5654-L5654] |
| 4 | 海面 | `saltline-sea-1` | 波形+反射+岸线泡沫 | [src:L5728-L5728] |
| 5 | 枪械细节材质 | `pac9-detail-<kind>` | `uKind` 分支 + `uRain` 雨湿 | [src:pretty:L5607-L5631] [src:L6017-L6017] |
| 6 | 通用表面（sl2 系） | `sl2\|<tint><t><f><a>` | `uSlWetP/uSlMacro/uSlUv/uSlX` 四 uniform + `h3()` 注入器 | [src:pretty:L21333-L21357] [src:L5318-L5318] |
| 7 | 天空穹顶 | （SKY 区块直写） | 全手写 ShaderMaterial | [src:L4207-L4212] |
| 8 | 后处理全屏 | （POST 区块直写） | 全手写 ShaderMaterial | [src:L4612-L4613] |
| 9 | 软阴影（全局替换） | （无键，改库源） | 字符串手术替换 chunk | [src:L4349-L4351] |

## 与上游的差异

`diff-chunks.mjs` 的结论（`evidence/shaders/chunk-diff.json`）：

- 运行时 186 段 GLSL（3.26M 归一化字符）对照上游 109 个 chunk；
- **作者手写占 75.7%**（2.47M 字符）——库存 chunk 提供骨架（`colorspace_pars_fragment` 命中 68 段、`normal_pars_*` 各 54 段、skinning/batching/logdepth 系列各 38-39 段），但五大视觉系统的主体全部自研；
- 最大的五段着色器（天空 82K、后处理 78K 等）作者占比 87-88%；
- **软阴影是唯一改库存的地方**：运行时注入 `getShadow()` PCSS 实现，带 Vogel 盘采样、blocker search、receiver-plane depth bias，且失败时保底——chunk 布局不符就 `console.warn("keeping stock PCF")` [src:L4296-L4296]。

## onBeforeCompile 工作法

以闪烁注入为完整样例（其余同理）[src:pretty:L18627-L18651]：

```js
// ① 准备自定义 attribute：每实例一个 blink(vec3: 周期, 相位, 占空)
// ② vertex：把定义头 prepend，然后替换锚点
n.vertexShader = `attribute vec3 blink;\nuniform float uTime;\nvarying float vBlink;\n` +
  n.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
 float bph = fract(uTime / max(blink.x, 0.001) + blink.y);
 vBlink = blink.x <= 0.0 ? 1.0 : mix(0.02, 1.0, smoothstep(0.0, 0.06, bph) * (1.0 - smoothstep(blink.z, blink.z + 0.12, bph)));`);
// ③ fragment：亮度乘 vBlink
n.fragmentShader = `varying float vBlink;\n` +
  n.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
 diffuseColor.rgb *= vBlink;`);
// ④ 缓存键：注入版材质必须给出，否则 three 会拿库存程序错配
e.customProgramCacheKey = () => "saltline-blink";
```

四步纪律：**prepend 声明 → `#include <anchor>` 锚点替换 → 保持原语义 → 必给缓存键**。锚点替换一律"保留原 include 行再追加"，保证未来 three 升级时锚点仍在。

材质工厂还有一层**缓存**：`sl2|` 系列把 tint/tile/interior/alphaCut 编进键字符串 `Q="sl2|"+D.tint+(G?"t":"")+(j?"f":"")+(D.alphaCut?"a":"")`，命中即复用材质实例 [src:pretty:L21333-L21357]。枪械 `pac9-detail-` 键后拼接 kind，让每把武器部件共享编译缓存 [src:pretty:L5607-L5631]。uniform 注入同样成体系：`uSlWetP`（雨湿参数）、`uSlMacro`（宏观变化）、`uSlUv`（平铺比例）、`uSlX`（室内系数）一组四个 [src:L5318-L5318]。

值得抄的还有**失败语义**：注入永远在 try/catch 里跑，布局不对就退回库存实现并告警，而不是崩给玩家 [src:L4296-L4296]。

## 枪械细节注入的分支设计

`pac9-detail-` 注入展示了"一套 shader 服务多种部件"的做法：`uKind` uniform（int）作为分支开关，让枪管/机匣/握把/弹匣共享同一个编译产物，靠 uniform 切换表面细节；`uRain` 全局 uniform 驱动金属表面雨湿润感（所有枪部件同步淋雨）[src:L6017-L6017]。它的 frag 注入替换 `normal_fragment_maps` 锚点 [src:L3288-L3288]，把程序化 bump（`dBump(normal, dHt + dDropH * 0.32)`——雨滴高度场混入法线扰动）接进库存光照。

## 工程要点汇总

1. **声明前置**：注入的 attribute/uniform/varying 声明永远 prepend 到 shader 头部，不塞进 include 锚点内部（编译器要求声明先于使用）[src:pretty:L18627-L18651]。
2. **键即指纹**：缓存键编码所有影响编译产物的维度（tint、tile、interior、alphaCut、kind），运行时只在键未命中时才真正编译 [src:pretty:L21333-L21357] [src:pretty:L5607-L5631]。
3. **注入有界**：9 处注入全部走 `#include <anchor>` 锚点或 chunk 字符串手术，没有整段替换 three 内置材质——升级 three 版本时的最大风险面被锚点语法锁死 [src:pretty:L18627-L18651] [src:L4349-L4351]。
4. **可观测**：`renderer.debug.onShaderError` 按 marker（`SALTLINE_POST/SKY/SHADOW`）给错误归类，注入材质炸了能一眼定位到系统 [src:L4132-L4132]。
5. **降级优先**：软阴影手术失败退回 stock PCF、高级管线失败退回前向渲染——两条降级链都在装配期就位 [src:L4296-L4296] [src:pretty:L7000-L7024]。
