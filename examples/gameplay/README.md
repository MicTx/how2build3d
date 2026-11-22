# examples/gameplay — 令牌射击场（玩法链路活体样本）

## 场景意图

三 kit 接入的可运行战斗样本（`physics-kit` + `level-kit` + `combat-kit`，外加 `inspect-deck`）：
一个手写布局的训练场（集装箱掩体 + 弹药箱 + 岸吊塔），三个悬浮 bot 用 `assets/combat-kit.mjs`
的状态机与攻击令牌交战，玩家由脚本驱动开一枪触发听觉链路。
它证明的是「物理/关卡/战斗」三 kit 的装配合同，不是内容展示品——任何带角色的场景都从这里起步。

本场景**不接** `props-kit` 与 `enemy-kit`：道具是 level-kit 手写 layout 的简单盒体，敌人是 combat-kit
agent bot（胶囊体/状态机），没有 enemy-kit 的骨骼/IK rig。因此 `scene.elements.json` 的 props/enemies
申报为 n/a（附理由与替代证据），与 `harness/gates/assets.mjs` 的结论一致；道具目录与敌人骨架由
`examples/parity` 覆盖。`inspect.manifest.json` 的 props/enemies 展厅展示的是本场景自己的布局与 bot，
不是对应 kit 的展台。

## 参数表

| 参数 | 值 | 说明 |
| --- | --- | --- |
| seed | 4207（bot 用 seed^0x9e3779b9） | 进 URL，确定性重建 |
| 机位 | 展示机位 `fov 58`（玩家口径 74 见 `references/01`） | 观察训练场全貌；玩家由脚本驱动，无第一人称相机 |
| auto | `?auto=10` | boot 期以固定步长自动战斗 10 秒并落 `__BATTLE_REPORT` |
| 令牌 | maxTokens 2 / tokenGap 1.25 | 同时开火 bot 上限（`gates/gameplay.mjs` 断言） |
| 听觉 | hearRadius 45 | 玩家开枪 → alert 传播 |
| 布局 | 手写坐标 9 件道具 | 零件数对账（validateLayout），不随机 |
| 输出 | `build/gameplay/index.html` | 单文件，three r180 内联，零运行时请求 |

## 方法论

1. **世界常量先于内容**（铁律 #1）：`physics-kit` 的 groundY/seaY/quayX 三平面兜底，盒子只做碰撞体。
2. **布局手写**：`H2B.LAYOUT` 全部坐标写死；随机只进 bot 游走（rng 注入）。
3. **令牌化交战**：bot 只有拿到令牌才开火，`maxTokens` 同时上限；听声 → investigate → engage → search 全走 kit 状态机。
4. **确定性**：kit 内零 `Math.random`；同 seed 两局 `__BATTLE_REPORT.hash` 一致（门禁断言）。

## 验收

- `node examples/gameplay/build.mjs --assert`：单文件 >1MB，10 个 kit marker 全命中，无外链。
- `node harness/render/scene.mjs --scene examples/gameplay --assert`：WebGL2 真实渲染 0 错误、rAF 心跳 ≥2、draws ≤240、本 README 四段齐全。
- `node harness/gates/inspect.mjs --scene examples/gameplay`：三厅 used + 六厅 N/A（有理由）逐厅渲染验收。
- `node harness/gates/complete.mjs --scene examples/gameplay --structure-only`：tier=game 结构对账（3 used / 15 n-a）；props/enemies 的 n/a 与 `assets.mjs` 的 `n/a(declared:props|enemies)` 交叉校验一致。
- `node harness/gates/assets.mjs --scene examples/gameplay`：manifest 模式（`assets.consumption.json`）八系统 + sea 全部 `N/A`（附理由）；props/enemies 为 `n/a(declared:props|enemies)`，与 complete 门禁同口径。
- `node harness/gates/gameplay.mjs --scene examples/gameplay`：自动战斗 10s ×2 局——令牌上限、听觉触发、确定性 hash 三断言。
- `--self-test`：令牌/感知/听觉/对账/确定性的无浏览器正负样例。
