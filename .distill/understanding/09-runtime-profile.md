# 09 · 运行时性能画像：一帧的账本

> 数据来源：`node harness/analyze/profile.mjs --assert`（bench 模式，seed 4207，
> headless Chrome + SwiftShader，视口 640×360，画质自动判为 low）。
> 全部数字可再生：`evidence/frames/profile.json`。

## 实测方法

夹具自带检视协议是本篇的支点：`?bench` 参数自动静音+跳过开场（[src:pretty:L51928-L51952]），`window.__G.render.stats()` 暴露 renderer.info（[src:pretty:L7000-L7024]），`window.__stats()` 返回聚合状态（[src:pretty:L51928-L51952]）。`harness/capture/frames.mjs` 在页面脚本执行前钩住 `drawElements/drawArrays` 计数，rAF 边界采样 24 帧，与渲染器自报数互为印证。

**方法学诚实声明**：SwiftShader 是 CPU 软渲染，绝对帧时（p50 1175ms）只反映 pass 结构的量级，不代表任何真机 GPU；但 **draw call、program、几何量、纹理数与硬件无关**，是结构性的。

## 实测数据

| 指标 | 实测值 | 说明 |
| --- | --- | --- |
| draw calls / 帧 | p50 **320**，avg 233，峰值 735 | 峰值出现在开场/波次（全场景可视） |
| renderer.info.calls | 267 | 与钩子计数同一量级（统计窗口差异） |
| 三角形 / 帧 | **1,807,032** | 约 180 万，含 instanced 展开 |
| 几何体 | 181 个 | 拼装+合并的结果 |
| 纹理 | 134 张 | 几乎全部程序生成（05 篇） |
| programs（编译） | **268** | 含画质/材质变体 |
| 最终 GLSL 段数 | 186 段 / 3.4 MB | `capture-shaders.mjs` 全量捕获 |
| 渲染分辨率 | 358×202（scale 0.8 实际生效） | low 档预算 1e6 像素的上限裁剪 [src:pretty:L1044-L1068] |
| 软阴影 / 高级管线 | 双双开启 | `advanced:true, softShadows:true` |
| 运行时错误 | **0** | `window.__errors` 空 |

画质档在 headless 下自动判为 `low`（scale:0.7, shadow:二千四十八, volSteps:十二, rain:0.5, ao:false），自适应分辨率再把实际渲染目标压到 三百五十八×二百零二——**预算系统在无人干预时自主完成了降级**，这正是 03 篇所述像素预算警察的实测证据 [src:pretty:L1044-L1068]。

## 预算结论

一帧的账本读法：

1. **draw call 上限被结构锁死**：320 个 p50 里，五大全屏 pass（天空/海面/光柱/后处理/阴影）只占个位数，其余来自场景物体（181 几何体 × 变体材质 × 双相机）。合并（merge）与实例化（instancing）已把重复单元压平（05 篇）——**再要降 draw call 只能砍物体数或加视锥剔除密度，不能靠优化循环**。
2. **二百六十八 个 program 是材质变体的代价**：`sl2|` 缓存键按 tint/tile/interior/alphaCut 组合展开（04 篇 [src:pretty:L21333-L21357]），编译发生在启动期（onLevelReady 预热 [src:pretty:L7000-L7024]），运行时零编译卡顿——**变体多但全部前置**。
3. **1.8M 三角形靠分辨率预算兜底**：low 档把渲染目标压到 三百五十八×二百零二 后，像素工作量与 720p 相差 十二 倍——几何量与像素预算是一对可独立调节的旋钮 [src:pretty:L1044-L1068]。
4. **纹理 134 张全部可溯源**到生成器（噪声/Canvas/拼装，05 篇），无外部下载——`asset-free` 审计 `fetchSitesInAppRegion=0`。

对建设者的直译：**先定预算（像素/几何/draw call 三张表），再建内容；每帧的账要在启动期结清（编译、合成、生成全部前置），运行时只做查表与混合**。
