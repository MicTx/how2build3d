# 08 · 自检展厅：模型自己的「摄影棚」

> 上游案例在 URL 后加 `?show=mats`：游戏消失，变成一面材质墙；`props` 是道具陈列、`enemies` 是敌人展台——同样的入口一共九个，全是给作者自己看的（玩家用不上）。做完一块→进展厅拍一张→看一眼→改，8 小时无人值守靠的就是这个闭环。本篇把「摄影棚」蒸馏成可复用协议：**每个可感知的子系统，都必须有一个可进入、可拍照、可断言的展台。**

## 九展厅清单

九个展台覆盖「模型能看什么」的全部表面。每个场景按实际系统写 `used` 或 `N/A（理由）`——与资产消费清单同一纪律。

| 展厅 | 拍什么 | 相机要点 | 通过断言 |
| --- | --- | --- | --- |
| `mats` | 材质墙：每种材质一个球/板，近距扫过 | 正对墙、无遮挡、光照均匀 | ≥8 种材质同框；每球可见法线/粗糙差异 |
| `props` | 道具目录：全部可复用道具按类摆开 | 45° 俯视，单品可辨识 | ≥6 种道具；比例与命名牌一致 |
| `enemies` | 敌人展台：每种敌人一个静态/循环动作位 | 平视，留出动作空间 | 每类敌人可辨；动画状态不炸 |
| `weapon` | 武器展台：枪械/工具 45° 旋转展示 | 近距，按部件拆看 | 枪口/机瞄/握把关系正确 |
| `fx` | 特效展台：枪口焰/弹道/烟尘/水花逐项触发 | 侧向慢速重放 | 每类特效可单发触发、无残留 |
| `render` | 渲染展台：粗糙度×金属度扫掠球阵（2×7） | 正面、环境光充足 | 球阵梯度连续、无过曝死黑 |
| `ground` | 地面近景：接缝/裂纹/标线/积水/湿痕 | 贴近地面 1.6m 视高 | 近景 ≥3 层细节；湿地有反射 |
| `backdrop` | 天际线：天空/吊机/船/远景分层 | 平视地平线，可切子项 | 云层有结构、太阳缺口可见 |
| `level` | 布局俯视：整关按坐标摆位 | 顶视/等距全览 | 布局与常量表一致、无穿模悬空 |

## 接入契约

### URL 与注册表

```
?show=<gallery>   进入展台；未知名称回落正常场景（不报错）
?shot             截图模式：自动开始、跳过片头、固定 seed
?bench            性能模式：noaudio + autostart
?cam=x,y,z[,tx,ty,tz]  ?fov=  ?exposure=   ?dt=   ?noweapon
```

- 展台注册表固定九键：`mats / props / enemies / weapon / fx / render / ground / backdrop / level`，与上游一致（`[src:pretty:L59271-L59271]`）。
- 进入展台时先建 **stub 世界**：一块 80×80 地面 + 最小模块，再调 `showcase(ctx)`（`[src:pretty:L59357-L59357]`）；展台只依赖它要展示的子系统，其余模块用 stub 顶上（`[src:pretty:L59318-L59319]`）。
- `showcase(ctx)` 返回 `{ cam, target, update }`：`cam/target` 是默认机位，`update(dt)` 逐帧驱动展台动画（`[src:pretty:L59393-L59393]`、`[src:pretty:L59478-L59480]`）。
- `__setShot({cam,fov,exposure})` 供外部脚本改机位/曝光——自检截图靠它（`[src:pretty:L59331-L59331]`）。

### 资产层 API（`assets/inspect-deck.mjs`）

```js
import { INSPECT_GALLERIES, readInspectMode, createInspectDeck } from "assets/inspect-deck.mjs";
const mode = readInspectMode(location.search);       // { show, shot, bench, cam, fov, exposure, dt, noweapon }
const deck = createInspectDeck({
  galleries: {
    mats: { cam: [0, 1.6, 6], target: [0, 1.4, 0], setup(ctx) { /* 建材质墙 */ } },
    // ... 其余展台
  },
  stub(ctx) { /* 80×80 地面 + 最小模块 */ },
});
const info = deck.boot(ctx, mode);                    // 未知 show 返回 null → 正常场景
// 页面暴露 window.__INSPECT_DECK__ = { version, mode, galleries }
```

- 场景清单 `inspect.manifest.json` 固定九键：`{"galleries":{"mats":{"state":"used"},"enemies":{"state":"n/a","reason":"无战斗系统"}}}`。
- 门禁 `node harness/gates/inspect.mjs --scene <dir>`：九键齐全、used 厅逐厅真实渲染、截图非黑、`__G.showcase` 对齐。

## 自检闭环

**每个子系统完成一块，必须走一遍这个循环；没有截图的「完成」不算完成。**

1. **构建**：`node <scene>/build.mjs --assert`，保证单文件可跑。
2. **进展台**：`?show=<gallery>&shot&seed=<seed>` 打开对应展台。
3. **拍**：按展台断言取 1–3 张（整体 + 局部）；文件按 `<scene>-<gallery>-<n>.png` 归档到 `evidence/inspect/`。
4. **看**：对照该展台的通过断言逐条打分；记录「差在哪一层」（材质/光照/后处理/布局）。
5. **改**：只改资产参数或展台对象，不重写管线；一次只改一个变量。
6. **重拍**：同机位同 seed 重拍，与上一张对比；直到断言全过。

上游的做法是「做完一块拍一张」，全程 70+ 张；本技能要求**每个 used 展厅至少留 3 张编号截图**，作为交付证据与回归基线。自检记录（照片 + 差异说明）随 Spec 包归档。

## 声音自检

声音拍不了照，就让它自己打仗给你听：

1. `?shot&bench`（noaudio 关闭，自动开始）+ 固定 seed 进入一局；
2. 脚本让游戏自动战斗 10 秒（`debugCut()` 推进事件、固定输入/自动瞄准）；
3. 在 `AudioContext` 输出前挂 `AnalyserNode`，记录 `peak`、`rms`、`clipCount`（连续 ≥0.99 采样数）；
4. 断言：`peak ≤ 0.97`、`clipCount = 0`、目标总线 `rms` 在 −18～−12 dBFS；超限先调 `max/pri` 与压缩器阈值，不调音量滑杆。

## 失败模式

- **无展厅**：只有整场景截图 → 局部问题永远看不见，观感修复靠猜。
- **展厅与游戏分叉**：展台另写一套对象 → 拍到的不是游戏里跑的东西；展台必须消费同一份材质/道具/敌人实例。
- **只拍一张**：没有局部与对比 → 无法定位层级；至少「整体 + 局部 + 修改后」三张。
- **N/A 无理由**：清单缺行或写空话 → 门禁判红；N/A 必须说明「本场景确实没有该需求」。
- **截图不留证**：拍完就删 → 回归无基线；evidence/inspect 必须随包归档。

## 验收

- [ ] `inspect.manifest.json` 九键齐全，used/N/A 逐项有说法
- [ ] `harness/gates/inspect.mjs --scene <dir>` 全绿（每 used 厅截图非黑）
- [ ] 每个 used 展厅 ≥3 张编号截图入 `evidence/inspect/`
- [ ] 声音自检：peak ≤0.97、clipCount=0
- [ ] 展台对象与游戏共用同一实例（抽查一处材质/一个敌人）
