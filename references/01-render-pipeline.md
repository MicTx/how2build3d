# 渲染管线检查表

## 上下文与预算

- `WebGLRenderer({antialias:false})`：MSAA 由画质档在渲染目标上设 `samples`，不在上下文开。
- `autoClear=false`、`info.autoReset=false`、`shadowMap.autoUpdate=false`：清屏/统计/阴影更新权拿回手里。
- 画质表字段：`scale, msaa, shadow, tex, volSteps, ao, planar, bloom, motionBlur, rain`（低/中/高示例：`.7/0/2048/512/12`、` .85/2/2048/1024/16`、`1/4/4096/1024/24`）。
- 像素预算：`low:1e6, medium:15e5, high:23e5, ultra:37e5`；超预算时 `scale *= sqrt(budget/used)`。
- dpr 封顶 2；渲染目标分辨率随预算变化，相机 aspect 同步更新。

## 双相机

- 主相机（**玩家第一人称口径**）：`fov 74, near .08, far 900`，`rotation.order='YXZ'`。
- 武器/近景相机：`fov 54, near .01, far 10`，独立 layer。
- 近景渲染前压 `depthRange` 到极小切片，避免改写主场景深度。
- 观感样板（`examples/quality`、`examples/gameplay`）用的是**展示机位**，`fov 58`：静帧构图用窄角压缩层次，不是玩家口径。新建可玩场景必须回 74/54；只做静帧样板时，在 README 参数表登记机位与理由。

## 每帧排班

1. `info.reset()`
2. 更新 `uTime` 与事件光（`flash = power*exp(-5t)*(0.55+0.45*sin(47t)*sin(13t+1))*.35`，t>0.9 归零）
3. 执行前置 pass 队列
4. 高级管线（try/catch，失败退前向）
5. `setRenderTarget(null)`，帧尾读 `info`

## 阴影

- 平行光 `castShadow`；`mapSize = min(quality.shadow, maxTextureSize)`；`bias:-1.2e-4, normalBias:.02`。
- `autoUpdate=false` + 隔帧门控（ultra 每帧，其他隔帧/阴影图缺失时）。
- 软阴影：替换 `getShadow()` 为 Vogel 盘 + blocker search + receiver-plane bias；tap 数按档 10/16；**布局校验失败退回 stock PCF**。

## 完整管线模板（资产层消费者）

```
scene → RT_scene(hdr + DepthTexture)
RT_scene.depth ──► shafts pass → RT_shaft(acc, T)        （assets/shafts.glsl，1/4 res）
RT_scene + RT_shaft ──► composite: scene*T + acc → RT_comp
RT_comp ──► post-chain → RT_post（读写分离！）             （assets/post-chain.glsl）
RT_post ──► post-aa → 屏幕                                （assets/post-aa.glsl）
```

- 锚点契约：shafts 的 `tDepthHalf` 若为硬件深度，在采样处换算 `viewDist = (near*far)/(far - d*(far-near))`（省一张深度 pass）。
- RT 全部 HalfFloat、颜色空间 NoColorSpace；最终编码只由 post-chain 的 `toSRGB` 完成（renderer 设 `outputColorSpace=LinearSRGB`、`toneMapping=NoToneMapping`）。
- 工程红线：post pass 读写不同 RT；相机 dt 钳非负；管线异常整体回退直出。

## 后处理

- 单全屏 pass；uniform 两行分组：光学（bloom/dirt/streak/flare/CA/vignette）与状态（damage/lowHealth/ads/flash/fade/saturation/thunder）。
- AgX 拟合 + ACES 混合；Kawase 两 tap AA；锐化用 `1-smoothstep(.04,.22,contrast)` 给 AA 让位；亮度加权颗粒；天空抖动去色带。
- CPU 侧 `post` 状态袋每帧整体写入。

## 错误分诊

`renderer.debug.onShaderError` 内 `getShaderSource` 命中 marker 就归到系统名（post/sky/shadow/material），只打一行日志。

## 交付前自检

- [ ] 关掉高级管线仍能出画
- [ ] 五档切换不触发重编译崩溃
- [ ] `__stats()` 能报 calls/tris/geos/tex
- [ ] 同 seed 两次截图 diff 为 0
