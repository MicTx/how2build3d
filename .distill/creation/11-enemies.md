# 创物 · 敌人（enemies）

> 上游锚点：`sources/jimao-3a-game/index.html` L6065（rig 尺寸表 / 规格 / 令牌池）、L6087（感知 `think` 与 `requestToken` 主体）、L6202（刷兵与波次）｜ 我方资产：`assets/enemy-kit.mjs`（`ENEMY_TUNE_DEFAULTS` / `HOUND_RIG` / `GULL_HULL` / `GAIT` / `HIT_ZONES` / `solveIK`）+ `assets/combat-kit.mjs`（感知与令牌的唯一实现，勿重写）｜ 对账：`harness/element-manifest.json` enemies 族 ｜ 验收：`node harness/gates/complete.mjs --scene examples/parity`

## 构建法则

**法则 1 · 尺寸只写一次**：一份骨骼尺寸表同时决定网格零件长度、IK 解算长度、脚掌落点半径；出现第二份“看起来差不多”的数字，脚就会在坡地上滑。上游把 stand 0.72 / L1 0.4 / L2 0.42 / l0 0.075 / hipX 0.165 / footX 0.275 / footZ `[0.37,0.37,-0.42,-0.42]` / footR 0.046 全部收进一张表 [src:pretty:L55739-L55754]；网格装配时腿件长度不是美术常量，而是回读同一张表。我方 `assets/enemy-kit.mjs` 的 `HOUND_RIG` 原样冻结它，`buildRig()` 里 `len === 1` 与 `r === 1` 两个分支就是仅有的回读点——**改腿长不许改网格**。

**法则 2 · 身体前进、脚找地**：四足没有走路动画，每帧预测下一落点，用“脚掌当前世界位置与预测点的水平距离”决定迈不迈步。四条腿按对角步序 `[[0,3],[1,2]]` 分组交替 [src:pretty:L56674-L56679]；摆动时长 `clamp(0.27 − speedEff·0.026, 0.14, 0.27)`，触发阈值移动中 0.09m、静止超过 0.25s 后收紧到 0.035m，连续使用同一组要乘 1.25 惩罚 [src:pretty:L57214-L57259]。抬脚高度 `0.065 + min(0.09, speed·0.02)`：慢走不划水，快跑不飘。

**法则 3 · IK 只夹紧、不失败**：两骨解算先求髋外展，再用余弦定理求 hip/knee；可达距离上限 `(L1+L2)·0.995`、下限 `|L1−L2|+0.03`，超出即夹紧，而不是返回 NaN 或让腿甩出去 [src:pretty:L55682-L55697]。脚被墙推、踩上箱顶、坡地抬升都只改目标点，关节角自动跟随——**姿态是解出来的，不是关键帧摆出来的**。

**法则 4 · 命中区先球后胶囊，倍率在外层结算**：猎犬先测头球 r=0.155（命中即报 part="weak"），再测两段胶囊 r=0.27 / 0.25（报 part="body"）[src:pretty:L56861-L56870]；射线-球与射线-胶囊都实现为“线段最近点再走球测试” [src:pretty:L57400-L57425]。弱点 ×2.2 不写在敌人里，由 combat-kit.playerShot 读 part==="weak" 施加——敌人只负责如实报部位，数值归战斗层。

**法则 5 · 开火权是令牌，不是状态**：全局同时开火上限 `maxTokens 2`（场上存活 >5 时放宽到 3），相邻两次开火至少隔 `tokenGap 1.25s`，且按类型轮换——上一令牌给了隼，猎犬的请求会被压后 [src:pretty:L57496-L57535]。令牌在进入 telegraph 前申请，在 burst 结束、丢失目标或死亡时释放；“能不能打”与“想不想打”解耦后，伤害峰值、音效并发、帧预算被同一个整数约束住。

**法则 6 · 死亡是状态迁移，尸体走池**：隼死亡断一只桨、`vel.y += 1.5`、给一个随机自旋，然后进入坠落态（重力 9.5 / 水平拖曳 0.4 / 5s 或落水或撞地才爆炸回收）[src:pretty:L56374-L56395] [src:pretty:L56396-L56453]；猎犬死亡侧倒并 `addWreck`，残骸队列上限 5，超出时最旧一具被标记 `sink` 缓慢下沉后再 `retire` [src:pretty:L57601-L57605]。尸体不是特效，是可驱逐的缓存对象。

## 完整链路

| 环节 | 意图 | 算法 / 常量 | 上游实现 | 我方落点 | 运行时证据 | 门禁 | 失效模式与兜底 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| rig 装配 | 一个 mesh、一根骨架、名字即文档 | 根骨骼挂 mesh、`Skeleton`、`bind`、包围球外扩 | SkinnedMesh 装配 [src:pretty:L55641-L55662] | `createEnemyKit(THREE)` + `SKELETONS` | `stats().enemyRigs`、`mesh.isSkinnedMesh` | `enemyRigs ≥ 1` | 无 THREE 时 rig 不落网格，步态/IK/命中仍可 node 自测 |
| 四足步态 | 脚不滑、落地有声 | 0.09 / 0.035 阈值、对角相位、1.25 惩罚 | 步态 `H` [src:pretty:L57214-L57259] | `GAIT` + `gait()` | `stats().steps / gaitSwings` | 展厅走 10s 无滑步 | 速度极低时退化为静止微调，不触发迈步 |
| 两骨 IK | 任意落点都有解 | 外展 + 余弦定理 + reach 夹紧 | `q_` 解算 [src:pretty:L55682-L55697] | `solveIK()` / `HOUND_RIG` | `selfCheck()` 的 reach 边界 | 标称点与超距点均有限 | 超距夹紧到 0.995 倍，绝不 NaN |
| 躯干姿态 | 坡地自动前倾/侧倾 | 前后脚高差 ×0.6、弹簧 160/17·130/15 | 躯干 `O` [src:pretty:L57260-L57319] | `houndPose()` | 头位置 `headPos` 供命中/视觉 | 头球与画面一致 | 死亡时改吃 `diePitch/dieRoll`，不跑弹簧 |
| 感知 | 便宜的“看见” | 距离 45 → 视锥 200° → `lineOfSight`；exposure 上升 0.1 / 下降 0.45 | `think` [src:pretty:L57536-L57605] | `combat-kit.updatePerception` | `enemy:alert` 事件 | 45m 内外各测一次 | 每 0.11–0.19s 才做一次 LOS，丢失 4s 转 search |
| 令牌 | 同时开火上限 | 2 / 3、间隔 1.25s、类型轮换 | `requestToken` [src:pretty:L57496-L57535] | `combat-kit.tokens` | `maxConcurrentAttackers` | `autoBattle` 断言 ≤ 2 | 拿不到令牌仍走位压制，不站桩 |
| 隼飞行 | 悬停/绕圈/避墙 | 轨道 13–23m、三触须轮转、加速度钳 11 | 巡逻与避障 [src:pretty:L56434-L56497]、banking [src:pretty:L56521-L56538] | `gullAlive()` | 速度/滚转采样 | 撞墙不穿模 | 逐轴去穿 + 贴地钳 +1.1，最坏原地抖 |
| 命中 | 打哪算哪 | 头球 0.155、胶囊 0.27/0.25、隼椭球 0.5×y2.3 | 命中区 [src:pretty:L56861-L56870] | `raycast()` / `HIT_ZONES` | `part` 字段 | 弱点 ×2.2 结算 | 无命中返回 null，子弹继续走到墙 |
| 残骸 | 尸体不无限堆积 | 上限 5、最旧 sink→retire | `addWreck` [src:pretty:L57601-L57605] | `wrecks` 队列 | `stats().wreckEvictions` | 连杀 10 只仍 ≤5 | 队列满时立即驱逐，不阻塞生成 |
| 刷兵 | 出生即复用 | 池 10 隼 / 8 犬、41 个点、`spawnFar 18` | `spawn` [src:pretty:L57738-L57751] | `setSpawnPoints()` / `spawnAt()` | `enemySpawns`、`enemyTypes` | 点 ≥6、类型 ≥1 | 无空闲犬时回收最旧残骸当新单位 |

链路的方向是单向的：`level.enemySpawns`（数据）→ `combat.createAgent`（感知身份）→ `enemy._activate`（rig 与运动）→ 事件（`enemy:spawn/alert/fire/step/killed`）→ HUD/音频。任何一环想反向读别人的内部字段，都说明接口没设计完。

## 思维链

**决策链 A · 为什么是程序化步态，而不是走路动画**

- **约束**（事实）：单文件、零外部资源；同屏可到 9 个敌人；地形有坡、箱顶、台阶，且脚要能踩在任意 `groundHeight` 上。
- **目标**（事实）：脚不滑、落地有音效、死亡能侧倒，且不引入动画资产与采样器。
- **候选**（推断）：A 预制 walk cycle + 蒙皮采样；B 纯程序 IK + 落点阈值；C 整体位移 + 腿部正弦摆动。
- **选择**（事实）：B。相位表只定义“哪两条腿一组”，落点由速度预测、地面高度与阈值决定 [src:pretty:L57214-L57259]；关节角由 IK 反解 [src:pretty:L55682-L55697]。
- **兜底**（事实）：阈值分移动/静止两档，静止久了收紧到 3.5cm 做姿态微调；IK 超距夹紧；地面查询带 `pos.y+0.6` 上限，避免从箱底吸脚。

**决策链 B · 为什么把开火权抽成全局令牌池**

- **约束**（事实）：9 个敌人同屏；伤害峰值、枪口音效并发与帧时间都有预算；玩家需要“看得懂”的压迫节奏。
- **目标**（事实）：敌人轮流上，而不是齐射秒杀；同时避免全隼或全犬同帧开火造成类型单一。
- **候选**（推断）：A 每个敌人独立冷却；B 全局令牌池；C 按距离加权随机。
- **选择**（事实）：B + 类型轮换。`lastType / wantT` 记住上一令牌的类型与时间，若刚给过隼，猎犬请求会被判负 [src:pretty:L57496-L57535]；令牌间隔兼作音效错峰。
- **兜底**（事实）：场上人数 >5 时上限升到 3；拿不到令牌的单位仍执行走位/绕后/近战突进（`lunge` 会主动 `releaseToken`），所以“没枪权”不等于“没行为”。

**决策链 C · 弱点为什么放在结算层**

- **约束**（事实）：同一套敌人要被玩家射击、被爆炸波及、被自动战斗采样三条路径命中；倍率若写在敌人内部，会出现三份不一致的 ×2.2。
- **目标**（事实）：部位判定与数值结算各自可单测。
- **候选**（推断）：A 敌人在 `damage()` 内乘倍率；B 敌人只报 `part`，战斗层统一乘；C 在射线函数里乘。
- **选择**（事实）：B。敌人 `_raycast` 只写 `part="weak"|"body"` [src:pretty:L56861-L56870]；`combat-kit.playerShot` 做 `part === "weak" ? 2.2 : 1`。
- **兜底**（事实）：未传 `part` 时按 `"body"` 处理；霰弹/爆炸等无部位来源走基础伤害，不会因缺字段变成 0。

**推断边界**：以上“候选”集合是从结果反推的备选空间，压缩源码无法证明作者真的比较过 A/C；可证实的只有最终参数、分支与阈值，均已用行号钉死。作者的调参顺序（先令牌还是先伤害）不可考。

## 迁移法则

**资产路由**：骨骼/网格/步态/IK/命中区/残骸 → `assets/enemy-kit.mjs`；感知四态、令牌池、听觉 rally、弹道池 → `assets/combat-kit.mjs`；刷兵点与分区标签 → `assets/level-kit.mjs` 的 `enemySpawns`。敌人 kit **不得**自己实现 `lineOfSight` 或令牌计数。

**参数重绑点**（改一个必须连带检查）：

1. `HOUND_RIG.L1/L2/stand` → `GAIT.stepThreshold`（步距随腿长缩放）、`HIT_ZONES.houndHeadR`、出生时的 `groundHeight` 偏移。
2. `ENEMY_TUNE_DEFAULTS.hound.hp / gull.hp` → 武器 `damage 26` 与弱点 ×2.2 的击杀弹数（猎犬头 3 枪 / 身 6 枪，隼头 1 枪 / 身 2 枪）。
3. `maxTokens / tokenGap` → `combat-kit.autoBattle` 的 `maxConcurrentAttackers` 断言与音频并发预算。
4. `poolGulls / poolHounds` → 关卡 `enemySpawns` 数量与 `maxAlive 9`（池小于同屏上限会 spawn 失败）。

**对账行**：`enemyTypes`（≥1，实测 2）、`enemySpawns`（≥6，清单 41）、`enemyRigs`（≥1，每实例一块 SkinnedMesh）。`enemy-kit.stats()` 直接输出这三项，`selfCheck()` 另行校验骨骼表无悬挂父级、IK 超距夹紧、步态对覆盖四腿、头球半径未被改动。

**迁移禁区**：把 IK 结果写回 `HOUND_RIG`（尺寸源被污染）；在 kit 内使用 `Math.random`（破坏同 seed 复现）；用普通 Mesh 冒充敌人（`enemyRigs` 门禁会红，且无法做步态）。
