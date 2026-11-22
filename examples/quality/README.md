# examples/quality — 雨后黄昏堆场（渲染链八系统质感基线）

## 场景意图

渲染链八系统的活体回归样本：一个雨后黄昏的堆场（集装箱、龙门吊、湿地面、低角太阳），
把 `assets/` 的八系统（SL 材质/纹理层 + 六条 GLSL pass）全部消费掉，用于回答「按工作流做出来的场景为什么工程全绿、观感像塑料沙盘」。
它不是内容展示品，也不是「全资产」样本：元素 kit（props/fx/audio/weapon/enemy/player/hud/weather）
由 `examples/parity` 覆盖，本目录在 `scene.elements.json` 里逐族申报 n/a 并写明理由。
它是资产层的可运行消费者——任何渲染链资产改动必须先过这里。

参考研究与要素规划见 [`R0.md`](R0.md)：四源参考（方法论 / 渲染链资产 / Saltline 原作 / 许可边界）、覆盖矩阵、16 类要素逐类决策、GAP 参数去向与参考对拍 delta；`node harness/gates/r0.mjs --scene examples/quality` 是它的机器验收面。

## 参数表

| 参数 | 值 | 说明 |
| --- | --- | --- |
| seed | 4207 | 进 URL，确定性重建 |
| 机位 | 展示机位 `fov 58`（玩家口径 74 见 `references/01`） | 静帧构图用窄角压缩层次；本样板无玩家相机 |
| quality | low（scale 0.7, volSteps 12） | SwiftShader 可跑的最低档 |
| draws | 71 calls / 3.2k tris / 18 programs | `render/scene.mjs --max-draws 240` 内 |
| 输出 | `build/quality/index.html` | 单文件，three r180 内联，零运行时请求 |
| 资产 marker | 19 个（见 `build.mjs --assert`） | 含 ssr-wet 的「资产名 → 切块标记 → 注入块」三段证据 |
| 八系统消费 | sky-deck / sl-surface / sl-textures / post-chain / post-aa / pcss / ssr-wet / shafts | `assets.consumption.json` 逐系统 used，`gates/assets.mjs` 全 used |
| ssr-wet 注入 | `SSR_WET_RR_BEGIN/END` 标记切块 | `build.mjs` 从 `assets/ssr-wet.glsl` 切出 RR 反射块，`ground.mjs` 只消费 `H2B.ssrWetRR`（无内嵌副本） |

## 方法论

1. **资产先于重写**（铁律 #2）：八系统全部走 `assets/` 路由入口，参数重绑而非重写标定过的数学。
2. 材质走 `sl-surface.mjs` 注入（triplanar + ORM + macro + 湿/流挂）与 `sl-textures.mjs` MRT 纹理工厂。
3. 管线读写分离：RT_scene → shafts → composite → post-chain → post-aa；PCSS 走 Vogel 盘；湿地反射按标记从 `assets/ssr-wet.glsl` 切块注入。
4. 失败降级链：管线失败退直出、chunk 手术失败退库存、资产生成失败退纯色——降级必须显式 `N/A（理由）`。

## 自检展厅（摄影棚）

`?show=<gallery>` 进入对应展台（未知名称回落正常场景），`__setShot({cam,fov,exposure})` 供外部截图脚本改机位；
协议见 `references/08-self-inspection.md`，框架见 `assets/inspect-deck.mjs`，清单见本目录 `inspect.manifest.json`。

| 展厅 | 状态 | 拍什么 |
| --- | --- | --- |
| mats | used | SL_MATERIALS 材质墙（12 种球阵） |
| props | used | 集装箱/龙门吊道具目录（内容包围盒取景） |
| ground | used | 湿地面近景：接缝/裂纹/积水/反射 |
| backdrop | used | 云甲板天空 + 吊机/船天际线 |
| render | used | 粗糙度×金属度 2×7 扫掠球阵 |
| level | used | 全场俯视布局 |
| enemies / weapon / fx | N/A | 静态质感样板无战斗系统（理由见 inspect.manifest.json） |

## 验收

- `node examples/quality/build.mjs --assert`：单文件 >1MB，19 个资产 marker 全命中，无外链。
- `node harness/render/scene.mjs --scene examples/quality --assert`：WebGL2 真实渲染 0 错误、rAF 心跳 ≥2、draws ≤240、截图 >8KB、本 README 四段齐全。
- `node harness/gates/assets.mjs --scene examples/quality`：manifest 模式（`assets.consumption.json`）八系统全部 `used`；ssr-wet 由 `SSR_WET_RR_BEGIN` 切块标记证明真实引用。
- `node harness/gates/inspect.mjs --scene examples/quality`：九展厅清单（六 used / 三 N/A）逐厅真实渲染、截图落盘 `evidence/inspect/`。
- `node harness/gates/visual.mjs --image evidence/frames/quality.png`：非黑非白、亮度、对比度、色相多样性过感知下限。
- 截图四问（`references/07-perceptual-quality.md` 第五节）逐张过：近景数材质分层、中景看体积、远景看大气、夜景看光晕。
