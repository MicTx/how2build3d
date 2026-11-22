# 创物 · 玩法循环（loop）

> 上游锚点：`sources/jimao-3a-game/index.html` L6202（`Yi` 波次表 / 三中继状态机 / 撤离结算 / bootstrap / 主循环 / `debugCut` / `window.__G`）｜ 我方资产：`assets/combat-kit.mjs`（`mission` / `autoBattle` / 令牌与事件）；关九件套来自 `assets/level-kit.mjs` ｜ 对账：`harness/element-manifest.json` loop 族 ｜ 验收：`node harness/gates/complete.mjs --scene examples/parity`

## 构建法则

**法则 1 · 波次是数据表，不是脚本**：`waves: [{gull:3,hound:1},{gull:3,hound:2},{gull:4,hound:3}]` 加 `maxAlive 9 / spawnStagger 0.85 / spawnFar 18 / pursuitEvery 7 / pursuitMinAlive 4 / pursuitExtra 5` 全部集中在一张表里 [src:pretty:L58703-L58728]。难度调整只改表，不改流程；三波之后 `Math.min(P, waves.length-1)` 让后续目标复用最后一波，避免“第四波未定义”的空指针。

**法则 2 · 编队顺序也是设计参数**：生成时先按数量压入 gull，再把 hound 插到索引 `1 + i*2`（1、3、5 位）[src:pretty:L59051-L59060]。这不是随机洗牌——交错插入保证空中与地面压力同时到达，玩家不会先打一群隼再打一群犬。**组成（composition）与顺序（ordering）是两件事，后者常被忽略但直接决定第一印象**。

**法则 3 · 刷兵有三道闸，位置还要打分**：队列项带绝对时间 `now + 1.6 + i·0.85`；到点后若存活数已达 `maxAlive 9`，顺延 1s；`spawn` 失败最多重试 6 次、每次 +1.5s；成功则对 60m 内敌人 `alert` [src:pretty:L59068-L59088]。选点函数对每个候选打分：距离 ≥18m 得 2 分、越远越多；有视线遮挡再加 2.5；6s 内用过的点 −3；另加 0–1.5 随机扰动 [src:pretty:L59051-L59066]。**“刷在哪”与“刷几个”同样重要**。

**法则 4 · 目标进度必须可回退**：切断中继要按住交互 2.4s（`cutSeconds`），松开后进度以 1.6 倍速回落，而不是停在原地 [src:pretty:L59139-L59164]。这让“切断”成为一个需要掩护的动作，而不是贴上去等读条；交互还要求距离 ≤2.2m 且朝向点积 ≥0.45，背面按不到。

**法则 5 · 全切之后从“波次”切换成“追击预算”**：第三个中继断开的瞬间，`allCut=true`，发放 `pursuitLeft=5`、`pursuitT=12`；此后每 7s 若存活数 <4 就补 1 个（60% 隼 / 40% 犬），并每 4s 对 90m 内敌人发一次 alert [src:pretty:L59166-L59191]。追击不是无限刷，是**有限次数的压力尾随**，保证撤离路上紧张但可完成。

**法则 6 · 战斗强度是一个标量**：`allCut || queue.length || (waveHot && alive>0)` → `1`；否则 `alertT>0 || 26m 内有敌人` → `0.6`；否则 `0.15` [src:pretty:L59210-L59271]。这一个数同时驱动音乐声部交叉淡化、环境音与 HUD 紧张度；不给每个系统各自算一套“危险度”，是为了让画面、声音、UI 在同一拍上变化。

## 完整链路

| 环节 | 意图 | 算法 / 常量 | 上游实现 | 我方落点 | 运行时证据 | 门禁 | 失效模式与兜底 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 启动 | 分阶段可观测 | 每阶段 `Nr(文案, 进度)`，>150ms 打日志 | bootstrap [src:pretty:L59400-L59420] | 场景 `build.mjs` 顺序 | 启动日志 | 首帧 `__ready` | 任一模块抛错 → 回退占位实现，致命才 `__fatal` |
| 布防 | 首屏就有巡逻单位 | `patrol {gull:2, hound:1}`，距玩家 ≥32m | `ie()` [src:pretty:L59045-L59050] | `spawnWave` | `active` 计数 | 首帧可动 | 无合适点 → 用随机环兜底 |
| 波次 | 难度曲线 | 表 + 交错插入 + 绝对时间队列 | `F()` [src:pretty:L59051-L59066] | `combat.mission` | `queue` 长度 | `waves ≥ 1` | 波次越界 → 复用最后一波 |
| 刷兵 | 数量与位置双控 | 9 上限、0.85 间隔、18m 偏好、60m alert | `X()` [src:pretty:L59068-L59088] | `spawnAt` | `spawnsTotal` | 同屏 ≤9 | 池满 → 延迟 1s 重试，不丢弃 |
| 目标 | 可中断的占领 | 2.4s 按住、松手 1.6× 回退、2.2m/0.45 朝向 | `ue()` [src:pretty:L59139-L59164] | `mission.cutRelay` | `objective:progress` | `objectivesWired ≥ 1`（实测 3） | 目标对象缺失 → 仍可切，仅无视觉反馈 |
| 全切 | 阶段切换 | `allCut` + pursuitLeft 5 / every 7s / minAlive 4 | `me()` [src:pretty:L59166-L59191] | 事件 `objective:all` | `pursuitLeft` | 追击次数有界 | 队列非空时不补，避免叠加 |
| 撤离 | 条件门 | 半径 2.5m、高差 <3.5m、必须全切 | `ue()` 尾部 | `mission` + 关卡 `extraction` | `extraction:reached` | 未全切时提示而非结算 | 未满足 → 提示“中继尚未断开”，8s 冷却 |
| 死亡 | 失败态 | 冻结输入、全场停表、显示 relays 进度 | `player:dead` [src:pretty:L59184-L59191] | 状态机 `dead` | 死亡面板 | 可重试 | 重试保留/清空 retries 由入口参数决定 |
| 结算 | 可解释评级 | 时间 <270→2 / <400→1；命中率 ≥.5→2 / ≥.3→1；零重试 +1 | `ee()` [src:pretty:L59194-L59209] | `mission.stats` | `setDebrief` | 六级评语 | 无射击记录 → 命中率显示 `—`，按 0 分计 |
| 强度 | 音画同拍 | 0.15 / 0.6 / 1 三档 | `B()` [src:pretty:L59210-L59271] | `audio.setIntensity` | 音乐声部权重 | 无 | 强度不变时不重发，避免音量泵动 |
| 主循环 | 子系统隔离 | `dt` 钳 50ms；`game.update` 返回 bool 决定是否推进 player/weapon/enemies | 主循环 [src:pretty:L59465-L59525] | 场景 loop | `__frames`、`__stats` | 帧预算 | 每模块 try/catch 只报一次，坏模块不拖垮整帧 |

链路的“单一时钟”值得单独点出：`playing` 状态里 `c.time += dt` 是任务计时，暂停/死亡/结算都不加；`waveHot / alertT / pursuitT` 也只在 `playing` 里衰减。**把时间所有权交给状态机，子系统只读时钟**，就不会出现“暂停了敌人还在走”的经典 bug。

## 思维链

**决策链 A · 为什么整波不一次性生成**

- **约束**（事实）：同屏预算有限（9 个）；玩家可能站在刷点上；一波 7 个单位若同帧出现，会造成音效叠加、寻路拥塞与帧尖峰。
- **目标**（事实）：压力持续但不瞬杀；每个单位都有“出场”时刻；位置离玩家足够远且尽量不在视线内。
- **候选**（推断）：A 整波瞬生；B 队列 + 绝对时间 + 同屏上限；C 按击杀数逐个补。
- **选择**（事实）：B。队列项写入 `at = time + 1.6 + i·0.85`，到点还要过 `maxAlive` 闸；生成成功即对 60m 内同伴 `alert` [src:pretty:L59051-L59088]。
- **兜底**（事实）：生成失败重试 6 次（每次 +1.5s）；池不足时回收最旧残骸；仍失败则丢弃该队列项（有上限的重试，不会死循环）。

**决策链 B · 为什么占领进度允许回退**

- **约束**（事实）：中继是暴露在场地里的固定物，敌人会持续施压；如果进度只增不减，玩家可以“贴一下、躲一下、再贴一下”无风险推进。
- **目标**（事实）：切断必须是“站住 2.4 秒”的承诺，而不是可分割的采样。
- **候选**（推断）：A 一次性读条，被打断清零；B 只增不减；C 可回退的连续进度。
- **选择**（事实）：C。按住时 `t += dt / 2.4`，松开 `t -= dt·1.6`，归零时把目标视觉状态从 `cutting` 切回 `live` [src:pretty:L59139-L59164]。
- **兜底**（事实）：进度事件每帧带 `t` 给 HUD/交互环；切完立即 `setRelays(cut,total)` 并推进波次，不依赖 HUD 回调。

**决策链 C · 为什么战斗强度收敛成一个标量**

- **约束**（事实）：音乐有 5 个声部、音效有 world/near/dry/music/amb 五条总线、HUD 有警戒提示；如果各自判断“现在危不危险”，会出现音乐紧张但 HUD 平静。
- **目标**（事实）：音画同拍、状态切换无抖动、每帧成本固定。
- **候选**（推断）：A 每个系统各自采样敌人距离；B 事件驱动布尔；C 单一标量 + 只在变化时下发。
- **选择**（事实）：C。三档 0.15/0.6/1 [src:pretty:L59210-L59271]，`Y !== c.intensity` 才调 `audio.setIntensity`。
- **兜底**（事实）：结算/死亡强制把强度压回 0.15；状态机离开 `playing` 后不再更新强度，避免残留高张力音乐。

**推断边界**：波次表、上限、评分公式、回退倍率都可逐字读出（事实）；“交错插入是为了第一印象”属于从结果推断的设计意图，源码没有注释说明动机。候选 A/C 是否被真正实现过不可考。

## 迁移法则

**资产路由**：波次/刷兵/目标/结算/强度 → 场景层（上游 `mM` 的任务状态机）；令牌与感知 → `assets/combat-kit.mjs`；刷点与撤离点 → `assets/level-kit.mjs` 九件套；音乐强度 → `assets/audio-kit.mjs` 的 `setIntensity`。任务层**不得**自己实现感知或伤害结算。

**参数重绑点**：

1. `waves` / `maxAlive` → 武器 DPS（`rpm 720 × damage 26`）与敌人 `hp 45/140` 的击杀节奏；改任意一项都要重跑 `autoBattle`。
2. `spawnFar 18` / `spawnStagger 0.85` → 关卡刷点密度与分区大小；点太少会让“远离玩家”失效并退化为随机环。
3. `cutSeconds 2.4` / `interactRange 2.2` → 中继模型尺寸与掩体距离；改交互半径要检查玩家能否在掩体后够到。
4. `pursuitExtra 5` / `pursuitEvery 7` → 撤离路线长度与敌人池（8 犬 / 10 隼）；追击总量超过池会开始回收残骸。
5. 结算阈值 `<270 / <400` → 关卡实际通关时长中位数；改布局后必须重标定。

**对账行**：`waves ≥ 1`（实测 3）、`objectivesWired ≥ 1`（实测 3）。运行时另看 `mission.cut / allCut / queue / pursuitLeft / intensity` 与 `autoBattle` 返回的 `maxConcurrentAttackers / alerts / fires / shots / impacts`。

**可观测性**：`debugCut()` 直接切下一个中继 [src:pretty:L58809-L58812]，window.__G 暴露引擎上下文，__stats() 汇总 fps/state；这三个入口让“跑到第三个中继要 6 分钟”这种问题能在 10 秒内复现。**验收设施不是附属品，是循环的一部分**。

**迁移禁区**：在 `playing` 之外推进任务时钟；把波次写成 `if (killCount === 3) spawn(...)` 的脚本（无法调难度、无法复用最后一波）；让子系统各自算危险度（音画不同拍）；用无限追击替代有界追击（撤离段永远结束不了）。
