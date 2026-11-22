# 创物 · HUD（hud）

> 上游锚点：`sources/jimao-3a-game/index.html` L6087 巨行（HUD DOM 构建、逐帧更新、`saltline.settings.v1`、键位表）+ L8-L210 的 HUD CSS 分区 ｜ 我方资产：`assets/hud-kit.mjs`（26 个 token / 10 个组件 / 罗盘常量 / 完整 CSS / 事件自动接线）｜ 对账：`harness/element-manifest.json` hud 族 ｜ 验收：`node harness/gates/complete.mjs --scene examples/parity`

## 构建法则

**法则 1 · token 先行，组件只读 `var()`**：`:root` 一次定义墨色、骨色、信号色、锈、钢、警报、三档字体、四向安全区、页边距与双层投影 [src:L11-L23]；HUD 根节点只做 `opacity` 淡入，罗盘/目标/弹药等组件全部引用变量，没有一处硬编码色值 [src:L41-L44]。美术方向因此是“一处可改”的，而不是散落在几十条规则里。

**法则 2 · 连续量先量化，再与缓存比对，最后才写 DOM**：罗盘位移量化到 0.5px、方位角取整、标记距离取整数米、伤害弧透明度取 1/20 档、准星间距取 0.5px 档 [src:pretty:L58196-L58280]。每次写入前与上一帧缓存比较，值没变就不碰 DOM——HUD 的写次数由“状态变化次数”决定，而不是帧率。

**法则 3 · 一个数据源，两个投影**：同一个任务标记同时投到罗盘带下沿（相对方位角 × 4px/° 并夹在带宽内）和世界空间屏幕位置（`project()` 后处理相机后方、夹到 0.9/0.82 安全框、3 米内标 near、接近屏幕中心标 dim）[src:pretty:L58196-L58255]。两个视图共享 `{pos, kind, short}`，不各自维护一份状态。

**法则 4 · 准星是弹道仪表，不是装饰**：准星四条线的间距由武器散布直接换算——`tan(spread)/tan(fov/2)·(H/2)+4`，冲刺再 +10px，夹在 4..70px，量化 0.5px [src:pretty:L58256-L58280]。ADS 超过 0.6 或换弹隐藏态时整组收起，开火时玩家看到的就是当前弹道锥的像素投影。

**法则 5 · 事件组件池化，可见性分层**：4 个伤害弧槽、4 条击杀事件、8 个罗盘标记、3 个继电器 pip 全部预分配复用 [src:pretty:L58040-L58070] [src:pretty:L58114-L58175]；血条只在受伤时出现 [src:L125-L127]，目标面板只在有目标时 `has`，交互环只在可交互时 `on`。常驻层（罗盘/弹药）与事件层（命中/受伤/播报）分开，不打扰是第一原则。

**法则 6 · 设置是版本化 schema，不是散落变量**：存储键 `saltline.settings.v1`，默认 `{quality:"auto", sens:1, invertY:false, volume:.8, fov:74}`；读取时逐字段校验：quality 必须在枚举内，sens 夹 0.2–3，volume 夹 0–1，fov 夹 60–95，任何异常静默回默认 [src:pretty:L58356-L58382]。写盘只发生在用户显式操作后，不做每帧持久化。

**法则 7 · 热循环零分配靠“构建期字符串表”**：伤害弧旋转、方位文本、距离文本、透明度文本、五档准星变换全部在构建期生成查表，`update()` 内只做整数索引与数值比较。这是 HUD 能在 60fps 下持续写几十个节点却不产生 GC 压力的原因。

## 完整链路

| 意图 | 算法 | 常量表 | 上游实现 | 我方落点 | 运行时证据 | 门禁 | 失效模式与兜底 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 方位感知 | 刻度带 `x=(deg+90)*4`，整带平移到 `W/2-(head+90)*4` | 范围 -90..450、步长 5°、4px/°、卡片 45°、数字 15° | `hM`/`se` [src:pretty:L57919-L57970] [src:pretty:L58196-L58220] | `HUD_COMPASS` + `updateCompass` | `compassTicks=109` | `hudComponents≥6` | 宽度自适应 `min(420px, vw-gutter*2-8)` |
| 目标追踪 | 方位角 `atan2(dx,-dz)-head` 归一化后夹带；世界投影二次夹取 | `K/2-14`、0.9/0.82、3m、0.16 中心阈 | `setMarkers`/更新循环 [src:pretty:L58114-L58175] | `setMarkers` + `updateMarkers` | `compassMarkers`、`markerCapacity=8` | render 厅实拍 | 相机后方 `z>1` 时翻转 xy 再夹取 |
| 命中反馈 | 三态 hit/weak/kill，动画时长 240/420ms，缩放 1.15/1.5 | 白/信号/警报三色 | `hitmarker()` [src:pretty:L58040-L58070] | `hitmarker` 组件 | `hitmarks/weakHits/kills` | 事件接线测试 | 击杀且弱点 → 事件流追加“弱点命中” |
| 受伤方向 | 来源方位 + 玩家 yaw 得弧旋转，1.5s 生命，0.6s 淡出 | 4 槽、透明度 1/20 档 | `player:hit` 监听 [src:pretty:L58040-L58070] | `damageArcs` SVG 池 | `damageArcs` | 同上 | 槽满偷最旧 |
| 交互提示 | 环形进度 `2π·19`，dashoffset 按进度量化 0.005 | 半径 19、键位随输入设备切换 | `setPrompt` [src:pretty:L58114-L58175] | `prompt` + `setPrompt` | `prompts` | 展厅交互 | 进度 0 时仍显示“按住 E” |
| 生命/弹药 | 10 段血条 `ceil(hp/max*10)`，≤3 段 crit；弹匣 pip 1..60 | 低弹阈 `ceil(mag*.27)` | `se()` [src:pretty:L58290-L58345] | `setHealth/setWeapon` | `hpSegments=10`、`magPips` | stats 对账 | 血条仅受伤可见；弹匣上限夹 60 |
| 事件流/消息 | 4 条池、4.2s 生命、0.6s 淡出；中央消息定时 | 池 4、消息 3s 默认 | `feed()/message()` [src:pretty:L58173-L58190] | `feed`/`message` | `feeds/messages` | 同上 | 池满移最旧 |
| 设置 | 版本化 JSON + 逐字段 clamp + try/catch | quality 四档、sens/vol/fov 区间 | `YC/Wf` [src:pretty:L58356-L58382] | 场景设置模块（kit 暂未内含） | localStorage 往返 | 设置面板 | 解析失败回默认，不阻断启动 |
| 键位 | code→动作表，鼠标/触屏/手柄三套描述 | 27 个键码 | `h_` [src:pretty:L51700-L51720] [src:L6088-L6112] | `HUD_COMPONENTS`/`DEFAULT_STRINGS` | `describeMode()` | 操作说明面板 | 未知 code 忽略 |

对账要点：上游 HUD 还包含波次警告 `h-warn`、无线电行 `comms`、世界空间标记 `h-wm`、地点卡 `loc-card` [src:L6087-L6087]；我方 `HUD_COMPONENTS` 只保留 10 个核心件。这是“组件族下限”而非“全量克隆”，缺的三件应在场景层补，不应偷偷算进 hud 族。

## 思维链

**决策链一 · 为什么 HUD 每帧都在写 DOM 却不卡**

**约束**（事实）：HUD 每帧跟随相机与武器状态，DOM 节点多、样式写代价高 [src:pretty:L58196-L58280]。
**目标**（推断）：60fps 下不产生布局抖动与 GC。
**候选**（推断）：A 每帧全量重建 innerHTML；B 节点常驻，仅改 `transform/opacity/textContent`。
**选择**（事实）：B，并且先量化再与缓存比对：罗盘 0.5px、方位 1°、距离 1m、透明度 1/20、准星 0.5px。动画属性只用 `transform/opacity`，罗盘带 `will-change:transform` [src:L46-L60]。
**兜底**（事实）：`prefers-reduced-motion` 下把动画时长压到近零、关闭波次警告闪烁与弹匣告急闪烁 [src:L332-L337]。
**推断边界**：量化步长是作者按观感选的，无法从源码证明每个步长都经过实验；但所有步长成对出现（写入前 round、缓存比较），说明是有意设计。

**决策链二 · 为什么同一个标记要画两遍**

**约束**（事实）：目标可能在视野内、视野外、相机后方、极近处 [src:pretty:L58196-L58255]。
**目标**（事实）：玩家永远知道“往哪转、还有多远”。
**候选**（推断）：A 只画屏幕空间箭头；B 罗盘带 + 世界投影双轨。
**选择**（事实）：B。罗盘带给相对方位与距离，世界投影给具体位置；屏幕外贴边半透明，极近处 dim，3 米内 near。
**兜底**（事实）：相机后方先把投影 xy 取反，再按 0.9/0.82 安全框夹取；夹取后仍超界就标 `offscreen`。
**推断边界**：双轨是否比单轨更易读，属于可用性判断；代码只证明两条投影共享同一数据源。

**决策链三 · 为什么设置要带版本号**

**约束**（事实）：本地存储会跨版本残留，字段可能缺失、类型错误、越界 [src:pretty:L58356-L58382]。
**目标**（推断）：升级后旧设置不炸新版本，坏数据不阻断启动。
**候选**（推断）：A 直接 `JSON.parse` 后展开；B 默认值 + 逐字段白名单 + clamp + try/catch。
**选择**（事实）：B，键名带 `.v1`，未来可写迁移函数。
**兜底**（事实）：解析异常、字段非法一律回默认，写盘失败静默。
**推断边界**：当前没有 v2，迁移路径是预留而非既成事实。

## 迁移法则

- **资产路由**：组件与 CSS 在 `assets/hud-kit.mjs`；场景接线 `examples/parity/src/hud.mjs`；对账行 `harness/element-manifest.json#hud`；既有叙述 `references/11-element-parity.md#hud`、`.distill/understanding/08-ui-hud.md`。HUD 只消费 `setPlayer/setWeapon/setObjective/setRelays/setMarkers/setPrompt/message/feed/hitmarker`，不直接读游戏对象。
- **参数重绑点**：① 上游 CSS 变量名 `--bone/--signal` 在我方规范为 `--hud-bone/--hud-signal`，组件必须走 token 映射；② 上游 `h-warn/comms/h-wm/loc-card` 未进 kit，需要时在场景层实现并另立对账；③ 设置 schema 目前不在 hud-kit 内，路由到菜单/场景设置模块；④ 上游罗盘带固定 2168px，我方按 `min(420px, vw-gutter*2-8)` 自适应，但刻度常量不变；⑤ 触屏布局必须保持“拇指角落清空” [src:L186-L190]，不要用缩放桌面 HUD 代替。
- **对账行**：`stats()` 自报 `hudComponents=10`、`hudTokens=26`、`compassTicks`、`hpSegments=10`、`arcPool=4`、`feedPool=4`；门禁 `complete.mjs --scene examples/parity` 校验 hud 族 used 且 render 厅有截图，`inspect.mjs` 校验展厅非黑与 `__G.showcase` 对齐。
