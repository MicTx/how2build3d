# 性能、内存与兼容性：同行 issue 反推的硬规则

这一层不是“再快一点”的建议清单，而是从 three.js、react-three-fiber、drei、postprocessing、PlayCanvas、Babylon.js 的 issue/PR 里反复出现的失败模式反推出来的交付约束。性能问题通常不是某个 shader 慢，而是资源没有 owner、热循环持续分配、同一场景被重复渲染、事件射线无预算，或者把 WebGPU 当成了默认快路径。

## 性能预算

先写预算，再写场景。任何“看起来不卡”的判断都不算验收。

| 指标 | 采集点 | 默认预算 | 说明 |
| --- | --- | --- | --- |
| draw calls | `renderer.info.render.calls` / WebGL hook | p50 ≤ 450，单帧 ≤ 1000 | 与物体数、材质切换、后处理 pass 直接相关 |
| triangles | `renderer.info.render.triangles` | ≤ 4,000,000 | 单帧提交量；不含被裁剪对象 |
| programs | `renderer.info.programs` + link hook | ≤ 400 | 材质/关键字变体过多会让编译与切换成本上升 |
| geometries | `renderer.info.memory.geometries` | ≤ 300 | 动态替换必须 dispose 旧 geometry |
| textures | `renderer.info.memory.textures` | ≤ 250 | 显存与上传成本的主要来源 |
| pixel budget | `width × height × dpr² × scale²` | low 1e6 / medium 1.5e6 / high 2.3e6 | 超预算按 `scale *= sqrt(budget/used)` 收缩 |
| frame time | `performance.now()` + rAF | p50 仅作结构参考，SwiftShader 不当真机 FPS | 真机结果必须注明设备、浏览器、分辨率与画质档 |

预算默认值由 `harness/perf.budget.json` 管理，门禁由 `harness/gates/perf.mjs` 执行。预算不是永久真理：每次有意提高上限，必须在变更说明里写出场景、设备、前后对比和理由。

## 内存生命周期

每个 GPU/浏览器资源都必须有明确 owner 和释放路径：

- **geometry / material / texture / renderTarget**：替换前 `dispose()` 旧对象，卸载时释放当前对象；不要只把引用置空等 GC。
- **loader / worker / decoder**：KTX2、DRACO、图片解码和自定义 worker 用完或卸载时调用其 `dispose()`；加载器实例不要每次请求都新建后遗弃。
- **scene object**：从 scene 移除只是解除引用，不等于释放 GPU 资源；移除与 dispose 分开写。
- **renderer**：页面/画布卸载时停止 RAF、移除事件监听、dispose render targets，再释放 renderer；不要在 remount 时叠加旧 renderer。
- **事件监听**：DOM/Canvas 监听器、ResizeObserver、IntersectionObserver 与自定义事件总线都要在卸载路径中解绑。
- **缓存**：材质 Map、纹理 Map、几何缓存要有上限或显式清理；缓存命中率不是无限增长的许可。

推荐把资源生命周期写成一张表：

| 资源 | 创建者 | 复用范围 | 释放时机 | 释放方法 |
| --- | --- | --- | --- | --- |
| `noiseTex` | `makeNoiseTexture()` | 全场景共享 | 场景销毁 | `texture.dispose()` |
| `mat.*` | 材质工厂 | 按 cache key 复用 | 场景销毁 | `material.dispose()` |
| `rt.*` | post pipeline | 全帧复用 | resize/销毁 | `renderTarget.dispose()` |
| `worker.decoder` | loader | 按格式复用 | loader 销毁 | `decoder.dispose()` |

## 热循环零分配

每帧执行的路径里不要创建新对象、数组、闭包或克隆：

- 预分配 `Vector3`、`Matrix4`、`Quaternion`、`Color` 与 scratch 数组；在循环里 `.set()` / `.copy()`，不要 `new`。
- 实例矩阵用 `dummy.position.set(...); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix)`，最后只设一次 `instanceMatrix.needsUpdate = true`。
- 不在 `requestAnimationFrame` 内 `filter/map/reduce` 大数组；更新用索引循环和 dirty 标志。
- 不每帧 `clone()` 材质/几何；参数变化优先改 uniform 或写实例 attribute。
- React/R3F 场景中避免每个实例一个组件；优先一个 InstancedMesh 组件从数据数组批量更新。
- 事件处理不要每帧重建 raycast 目标数组；缓存可拾取对象集合，必要时用 BVH 或分层过滤。

## 实例化与事件成本

实例化和批处理是有条件的优化，不是“见到循环就 InstancedMesh”：

- 静态重复物优先 InstancedMesh；每个实例的矩阵与颜色写入一次或按需更新。
- 动态增删的批量对象维护 `dirty` 标志，排序/压缩按帧摊开，避免每次 add/remove 都全量排序。
- 十万级几何、千万级三角形时先比较普通 Mesh、BatchedMesh 与实例化的 CPU/GPU 账本，不能只凭 API 名字选方案。
- pointer 事件只挂需要的类型；`pointermove` 若必须响应，节流到固定频率并限制 raycast 对象数。
- 点击/悬停只需命中检测时，不在每次移动做全场景 raycast；用层级、layer、包围盒或 BVH 先裁剪。
- 事件回调里不要创建新数组/对象；命中结果复用或在事件外缓存。

## 后处理与渲染目标

后处理是性能账本的重灾区，尤其是多 pass、透明、SSR、体积光和 MSAA：

- 场景几何只渲染一次；后处理需要的 depth/normal/velocity 通过共享 G-buffer 或一次 prepass 获取，不要每个 effect 重画场景。
- 后处理管线维护固定 render target 池；按分辨率/格式复用，resize 时统一重建并释放旧目标。
- MSAA 只开在真正需要的最终目标或几何 pass；不要因为 composer 配置让所有中间 buffer 都被 MSAA 放大。
- 透明/透射材质会触发额外 scene pass；若使用 transmission、折射或 SSR，必须把重复渲染计入 draw call 与 frame time 预算。
- 多 View/多相机共享后处理时，先确认每个 View 是否重复整条管线；必要时合并到同一 render target 或降低非主 View 质量。
- 单 pass 优先；每增加一个全屏 pass，都要给出像素成本、带宽成本与可关闭的降级路径。

## WebGPU / WebGL 兼容

WebGPU 不是自动加速开关，跨后端兼容要按矩阵验收：

- 启动时做能力探测：`navigator.gpu`、adapter、device、所需 texture format、compute 支持；失败时回退 WebGL2/WebGL。
- 同一场景至少在 WebGL2 和 WebGPU 各跑一次启动、渲染、截图和性能快照；不能只凭后端名称宣称兼容。
- 不假设 WebGPU 更快：大量非实例 mesh、UBO/bind group 更新、旧驱动都可能让 WebGPU 更慢；以本地基线和真实数据为准。
- WebGPU 旧版本可能对 geometry/material 保持强引用；不要依赖 GC 回收 GPU 资源，显式 dispose 是跨后端契约。
- 高级路径必须 opt-in，并列出限制条件、回退行为与不支持项；默认路径应是最稳的 WebGL2/forward 路径。
- 每个后端保留相同的 `__G` / `__stats()` 检视协议，避免只在某个后端可测。

## 测量与回归

把性能验收做成可重复的证据，而不是一次性的截图：

1. 固定 seed、viewport、deviceScaleFactor、画质档和 waitMs。
2. 至少采集 12 帧；记录 p50/p99 frame time、draw calls、triangles、programs、geometries、textures。
3. 同时记录环境：GPU 字符串、浏览器版本、后端类型、分辨率、画质档。
4. 与 `harness/perf.budget.json` 比较；结构指标硬失败，绝对帧时只作为结构参考（SwiftShader 例外）。
5. 变更前后各跑一次，保留 `evidence/frames/profile.json` 与 `evidence/frames/perf-gate.json`。
6. 任何超出预算的变更必须在 PR/交付说明中记录回退方案：降 scale、降 tex、降 volSteps、关闭 bloom/AA/SSR，或减少实例/对象数。
7. 性能门禁失败时先看哪个 count 超限，再决定是修实现还是更新预算；不要直接放宽阈值掩盖回归。

## Checklist

- [ ] 每个 geometry/material/texture/renderTarget/loader/worker 都有 owner、复用范围、dispose 路径
- [ ] 热循环没有 `new` / `clone` / 新数组 / 新闭包
- [ ] InstancedMesh 或 BatchedMesh 有动态增删策略，排序不全量重复
- [ ] pointer 事件有类型裁剪、节流与 raycast 预算
- [ ] 后处理只渲染一次场景，render target 可复用并可释放
- [ ] `customProgramCacheKey` 唯一、稳定、编码所有编译维度
- [ ] WebGPU/WebGL2 都有能力探测、回退与同场景验收
- [ ] `perf.mjs --assert` 通过，profile 与 gate 证据已保存

## 同行证据

以下 issue/PR 是这套规则的直接来源（抽样，不代表穷举）：

| 项目 | 链接 | 反推出的规则 |
| --- | --- | --- |
| three.js | [#24451 WebGLShaderCache poor performance](https://github.com/mrdoob/three.js/issues/24451) | 短语义 cache key、避免每帧全源码查找 |
| three.js | [#28423 transmission pass performance](https://github.com/mrdoob/three.js/pull/28423) | 透明/后处理不得重复画场景，复用颜色与深度 |
| three.js | [#30560 WebGPU UBO performance](https://github.com/mrdoob/three.js/issues/30560) | WebGPU 需基准，不假设快于 WebGL |
| three.js | [#31468 BatchedMesh removals](https://github.com/mrdoob/three.js/pull/31468) | 动态实例排序摊开，避免 O(n²) |
| three.js | [#28776 BatchedMesh CPU usage](https://github.com/mrdoob/three.js/issues/28776) | 批处理按规模与更新频率设上界 |
| react-three-fiber | [#3306 Instances vs pure InstancedMesh](https://github.com/pmndrs/react-three-fiber/issues/3306) | 数据导向实例更新，避免每实例一个组件 |
| react-three-fiber | [#320 event handler raycast cost](https://github.com/pmndrs/react-three-fiber/issues/320) | pointermove 射线预算、裁剪与节流 |
| react-three-fiber | [#2710 no-new-in-loop / no-clone-in-loop](https://github.com/pmndrs/react-three-fiber/pull/2710) | 热循环零分配是 lint 级规则 |
| react-three-fiber | [#3590 GLTF leak on reload](https://github.com/pmndrs/react-three-fiber/issues/3590) | 模型/loader/纹理必须有 dispose 路径 |
| drei | [#1911 AVIF texture OOM](https://github.com/pmndrs/drei/issues/1911) | 显存生命周期与纹理尺寸预算 |
| drei | [#2897 WebGPU Line leak](https://github.com/pmndrs/drei/issues/2897) | WebGPU 也不能依赖 GC，显式 dispose |
| drei | [#415 dispose line geometry](https://github.com/pmndrs/drei/pull/415) | 动态替换先释放旧 geometry |
| postprocessing | [#419 Render Pipeline Redesign](https://github.com/pmndrs/postprocessing/issues/419) | buffer pool、输入输出声明、避免重复渲染 |
| postprocessing | [#637 draw calls with Views](https://github.com/pmndrs/postprocessing/issues/637) | 多 View/后处理纳入同一性能快照 |
| PlayCanvas | [#3986 WebGPU support](https://github.com/playcanvas/engine/issues/3986) | 跨后端兼容是逐项矩阵，不是开关 |
| PlayCanvas | [#3543 dynamic batching for skinned meshes](https://github.com/playcanvas/engine/issues/3543) | 动态对象也需要批处理策略 |
| PlayCanvas | [#3361 progressive multi-frame rendering](https://github.com/playcanvas/engine/issues/3361) | 静止/运动分档，渐进质量与动态分辨率 |
| Babylon.js | [#18441 tree-shaking pure barrel](https://github.com/BabylonJS/Babylon.js/pull/18441) | bundle 体积与 tree-shaking 也要设基线 |
| Babylon.js | [#18962 Gaussian point splatting](https://github.com/BabylonJS/Babylon.js/pull/18962) | 高级路径 opt-in、能力探测、自动回退 |

## 宿主 steal、swap 与浏览器门禁

浏览器门禁（Chrome 实测链）在宿主资源被挤压时会"假红"：超时、心跳停跳、SwiftShader 渲染失败——这些是宿主噪声，不是产品缺陷。`harness/boot.mjs` 在启动 Chrome 前显式采样宿主环境，超阈值时打印 `environment-blocked` 并 **exit 3**，不再进入 Chrome 步骤。

- **检测方法**：`node harness/boot.mjs --probe` 输出 `environment.supported/stealPct/swapUsedPct/blocked`。Linux 读 `/proc/stat`（500ms 窗口 steal 差值）与 `/proc/meminfo`（swap used）；macOS 读 `sysctl vm.swapusage`（swap used%），`stealPct` 报 `0` 并以 `stealSource:"none"` 标明（裸机无 steal 计数器）；采样缺失时 `supported=false` 且**不误判阻塞**。
- **阈值与覆盖**：steal 默认 5%；swap used 默认 Linux 50%、macOS 95（swap 常驻是 macOS 内存管理常态，只拦交换风暴）；`H2B_STEAL_MAX_PCT` / `H2B_SWAP_MAX_PCT` 环境变量可覆盖（`-1` 强制 blocked，用于自检）。
- **退出码契约**：`0` = 绿、`1` = 产品红、`3` = environment-blocked；`boot.mjs` 导出 `EXIT_ENVIRONMENT_BLOCKED=3`，`verify.mjs` 的 `runStep` 遇子步骤 exit 3 只报环境阻塞、不打印 FAILED。
- **重试与基线策略**：环境阻塞不记红也不记绿——证据 JSON 记 `status:"n/a"` 与 reason（以 `environment-blocked` 开头）；恢复手段是释放宿主压力或调阈值后**重跑命令**（证据可再生，`evidence/` 不入库）。
