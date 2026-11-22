# 创物 · 检视（inspect）

> 上游锚点：`sources/jimao-3a-game/index.html` L6202（`QC()` 参数协议、`__G/__frames/__ready/__errors/__setShot/__stats`、`#bench` 性能模式、`gM` 九展厅分派）+ L4132（shader 编译错误分支）｜ 我方资产：`assets/inspect-deck.mjs`（`INSPECT_GALLERIES` 九厅 / `readInspectMode` / `createInspectDeck`）｜ 对账：`harness/element-manifest.json` inspect 族 ｜ 验收：`node harness/gates/inspect.mjs --scene examples/parity`

## 构建法则

**法则 1 · 检视是 URL 协议，不是内部开关**：`?show=<gallery>` 选展厅，`?shot` 进截图模式，`?bench` 进性能模式，`?cam=x,y,z[,tx,ty,tz]`、`?fov=`、`?exposure=`、`?dt=`、`?noweapon` 逐个覆盖相机与运行参数；`#bench` 与 `?bench` 等价，且强制 `noaudio=1&autostart=1` [src:pretty:L59306-L59332]。未知的 `show` 不报错，直接回落正常场景——检视入口永远不把产品弄坏。

**法则 2 · 展台 = stub 世界 + 同一个 ctx**：进入任意展厅先建一块 80×80 地面与最小 `level` stub，再调用该厅的 `showcase(ctx)`；展厅只依赖自己要展示的子系统，其余模块用 `dr.<module>()` 的桩实现顶上 [src:pretty:L59357-L59397]。展台消费的是游戏同一份材质、道具、敌人实例，不是另写一套展示模型。

**法则 3 · 就绪的定义是“第 2 帧”，不是 load 事件**：`window.__frames` 从 0 起累加，`__frames === 2` 才把 `__ready` 置真 [src:pretty:L59504-L59504]。第一帧完成资源上传、第二帧证明交换链已稳定（推断：这是两帧条件的工程动机，源码只给出门限）。`__fatal` 记录单点致命错误，`__errors` 收集所有 `error` 事件与被劫持的 `console.error`（每条截断 400 字），页面即使降级也保留证据 [src:pretty:L59266-L59299]。

**法则 4 · 相机与曝光是一等外部接口**：`__setShot({cam, target, fov, exposure})` 由宿主统一安装，截图脚本不需要理解场景内部结构 [src:pretty:L59321-L59331]；展厅的 `showcase(ctx)` 返回 `{cam, target, update}`，框架据此设默认机位并逐帧驱动展台动画 [src:pretty:L59393-L59397]。自检的“可拍照”因此是协议能力，不是每个展厅各写一遍。

**法则 5 · 失败一律降级，不终止启动**：模块加载失败时，若该模块有桩实现就换桩并继续；`showcase` 抛错只写 `__fatal` 并继续渲染；未知展厅回落正常场景；shader 编译失败走 `onShaderError`/`console.error` 分支，错误进入 __errors 供事后分诊 [src:pretty:L59336-L59340] [src:L4132-L4132]。这套系统把“错误”当数据，而不是当崩溃。

**法则 6 · bench 复用产品相机路径**：性能模式不另写测试轨迹，而是拿关卡 `cinematicPath`（或两条硬编码兜底）做 30 秒周期巡航，2 秒后开始采样帧时，每秒打印 avg/median/p99/fps/render stats/errors/GPU/buffer/quality [src:pretty:L59521-L59545] [src:pretty:L59560-L59575]。测试路径与玩家看到的路径同源，测到的就是产品。

**法则 7 · 九厅按“可感知表面”划分，不按资产类型划分**：`mats/props/enemies/weapon/fx/render/ground/backdrop/level` 九个键覆盖材质、道具、敌人、武器、特效、渲染、地面、天际线、布局——每一厅对应一类“人眼能判对错”的表面 [src:pretty:L59271-L59271]。资产目录可以变，表面分类相对稳定。

## 完整链路

| 阶段 | 机制 | 常量/键 | 上游证据 | 我方落点 | 运行时证据 | 门禁 | 失效模式与兜底 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 解析 | `URLSearchParams` → 普通对象；bench 改参数 | show/shot/bench/cam/fov/exposure/dt/noweapon | `QC()` [src:pretty:L59306-L59332] | `readInspectMode(search)` | 返回 mode 对象 | — | 未知参数忽略 |
| 选厅 | `i.show && gM[i.show] ? i.show : null` | 九键注册表 | `gM` [src:pretty:L59271-L59271] | `INSPECT_GALLERIES` + `deck.has` | `__G.showcase` | `__G.showcase` 对齐 | 未知厅 → null → 正常场景 |
| 建桩 | 80×80 地面 + level 空实现 | `stub:true` | [src:pretty:L59357-L59370] | `stub(ctx, name)` 可选 | 场景可渲染 | 展厅非黑 | 未提供 stub → 直接 setup |
| 展台 | `showcase(ctx)` 返回机位与 update | `{cam,target,update}` | [src:pretty:L59393-L59397] | `entry.setup(ctx)` / `entry.cam` | 展台动画 | 逐厅截图 | setup 抛错 → `__fatal`，继续 |
| 拍照 | `__setShot` 改相机/投影/曝光 | cam/fov/exposure | [src:pretty:L59331-L59331] | `deck.setShot(ctx, shot)` | 截图差异 | 感知下限 + 3 张证据 | 无相机 → 静默跳过 |
| 就绪 | 帧计数到 2 | `__frames=2` | [src:pretty:L59504-L59504] | 场景自身 rAF 计数 | `__ready` | 等待 ready 再截图 | 永不 ready → 超时失败 |
| 错误 | `error` 事件 + console.error 劫持 | 400 字/条 | [src:pretty:L59286-L59299] | 场景 `__errors` | `__errors.length` | 0 错误 | 单条错误不阻断 |
| 性能 | cinematicPath 巡航 + 每秒采样 | 30s 周期、2s 预热 | [src:pretty:L59521-L59545] | 场景 bench 桩 | p99/errors 文本 | `--bench` 人工/脚本读 | 路径不足 2 点 → 兜底两点 |
| 统计 | `__stats()` 合并 render.stats + fps + state | 任意键 | [src:pretty:L59432-L59440] | 场景暴露同名函数 | JSON 快照 | 采集脚本消费 | 模块缺失 → 空统计 |

补充：上游 `L6203-L6209` 的 `<pre id="bench">` 文本同时打印 GPU、drawing buffer、quality、dpr、avg/median/p99、stats 与 errors——性能读数与错误读数在同一屏，避免“快了但错了”被漏掉 [src:L6203-L6209]。

## 思维链

**决策链一 · 为什么做成九个展厅，而不是一个大场景**

**约束**（事实）：整场景截图只能回答“整体像不像”，局部材质、道具比例、敌人姿态的问题会被淹没 [src:pretty:L59271-L59271]。
**目标**（推断）：每完成一块，能在 1–2 分钟内拍一张可判读的对照图。
**候选**（推断）：A 一个总场景 + 相机预设；B 九个独立展台 + stub 世界。
**选择**（事实）：B。九厅各自最小依赖，场景失败不会拖垮其他厅；stub 保证单厅也能起 [src:pretty:L59357-L59370]。
**兜底**（事实）：未知厅回落正常场景；模块缺失换桩；展厅抛错只记 `__fatal`。
**推断边界**：九厅的划分是作者按本项目资产面裁的，不是通用分类法；换项目应重裁表面，而不是照抄九键。

**决策链二 · 为什么 ready 要等两帧**

**约束**（事实）：`DOMContentLoaded`/`load` 早于首帧，资源未上传完就截图会得到黑屏或半成品 [src:pretty:L59504-L59504]。
**目标**（推断）：外部脚本只凭一个布尔量就能安全截图。
**候选**（推断）：A 监听 load；B 监听首帧；C 帧计数到 2。
**选择**（事实）：C。首帧完成上传，第二帧证明循环稳定；代价是“就绪”比“可渲染”晚一帧。
**兜底**（事实）：`__fatal` 与 `__errors` 同时暴露，超时方能看到失败原因，而不是无限等待。
**推断边界**：两帧对 WebGL2 足够，但对异步纹理流式加载的项目可能不够；届时应把 ready 条件扩展为“帧数 + 资源计数”，而不是改回 load。

**决策链三 · 为什么 bench 要复用 cinematicPath**

**约束**（事实）：性能测试需要稳定、可重复、覆盖多区域的相机轨迹 [src:pretty:L59521-L59545]。
**目标**（推断）：测试路径不偏离玩家实际看到的负载。
**候选**（推断）：A 写一条专用测试样条；B 复用关卡过场路径。
**选择**（事实）：B。`cinematicPath` 本来就是跨闸口/堆场/仓库/码头的 12 点路径，天然覆盖不同遮挡与材质；不足两点时用起终点兜底。
**兜底**（事实）：`?dt=` 固定步长，2 秒预热丢弃，采样窗口 3000 帧滚动。
**推断边界**：过场路径偏“展示”，不等于最坏战斗负载；bench 的数字应解读为“展示路径下的稳定帧时”，战斗峰值仍需 gameplay 门禁补。

## 迁移法则

- **资产路由**：框架在 `assets/inspect-deck.mjs`；接入示例 `examples/quality/src/inspect.mjs` 与 `examples/parity/src/inspect.mjs`；协议说明 `references/08-self-inspection.md`；门禁 `harness/gates/inspect.mjs` 与 `complete.mjs`；对账行 `harness/element-manifest.json#inspect`。
- **参数重绑点**：① 上游展厅是函数 `gM[name](ctx)` 且自带 `showcase`，我方抽象为 `{cam,target,setup}` 或函数，返回 `{name,cam,target,update}`；② 上游 `__setShot` 由 `QC()` 安装，我方由 `deck.boot` 统一安装并额外暴露 `__INSPECT_DECK__`；③ 上游 `show` 未命中回落 null，我方 `boot` 同样返回 null；④ 我方框架不依赖 three.js，相机由 `ctx.camera`/`ctx.render.camera` 注入，可在任意 WebGL 场景复用。
- **对账行**：`INSPECT_GALLERIES` 九键齐全；`inspect.manifest.json` 每键 `used` 或 `n/a`（带理由）；`__G.showcase` 与当前厅一致；`__INSPECT_DECK__` 存在；每 used 厅三张截图（默认 + fov45 + fov74）；0 错误且截图过感知下限。`complete.mjs` 另核 used 族必须有对应展厅与三张证据图。
