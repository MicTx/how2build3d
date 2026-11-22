# 10 · 玩法链路：物理 / 关卡 / 战斗的装配工作流

> 观感链路解决「看见」，玩法链路解决「动起来」：物理查询 → 关卡装配 → 战斗导演。三个 kit 的 API 契约见 `.distill/distillation/08-gameplay-kits.md`；本层是 S7（玩法阶段）的施工顺序与检查点。

## S7.1 物理：世界常量与碰撞体

- 先写世界常量：`groundY / seaY / quayX` 三平面 + 区域 `region`。地面只有两个三角形，所有起伏交给像素层（与 `references/03` 一致）。
- 碰撞全部用 AABB 盒：`addBox(min,max,{surface,tag,noNav,bulletOnly,playerOnly})`。旗标是玩法的一部分——bulletOnly 挡子弹不挡人、playerOnly 只挡玩家、noNav 不入导航网格（`[src:pretty:L34676-L34676]`）。
- 检查点：射线从空中落下能命中 `groundY`；`groundHeight(x,z)` 在盒顶处高于地面。

## S7.2 胶囊移动与导航

- 角色移动统一走 `moveCapsule(pos, vel, dt, r, h, step)`：子步进防穿墙、墙滑、step-up、落地/天花板判定一次结算（`[src:pretty:L34810-L34810]`）。
- 导航网格由盒列表自动生成（dirty-flag 懒重建）：`nav.isWalkable / findPath / randomPoint / clearLine`；A* 后再用视线拉直，路径更自然（`[src:pretty:L34875-L34875]`）。
- 检查点：机器人在有掩体的场地里能从出生点走到任意可走点；贴墙移动不抖。

## S7.3 关卡装配（数据优先）

关卡是数据不是代码，九个字段就是全部接口面：`playerStart / objectives / enemySpawns / zones / interiorBoxes / cinematicPath / extraction / groundSurfaceAt / update`（`[src:pretty:L59358-L59374]`）。

1. 写 `catalog`：每个道具的尺寸/材质/零件数（`[src:pretty:L35067-L35068]`）。
2. 写 `layout`：全部坐标手写——**布局不随机，随机只进变体**。
3. `validateLayout` 构建期对账：未知道具名、零件数不符、重复坐标立即判红。
4. `createLevelKit` 一次性建组 + 注册碰撞，返回九件套与 `stats`。

检查点：`stats.props/parts/colliders` 与目录对得上；`?show=level` 俯视图与常量表一致。

## S7.4 战斗导演（令牌化）

- **攻击令牌**先行：`maxTokens 2 / maxTokensCrowd 3 / tokenGap 1.25`（`[src:pretty:L57426-L57434]`）。没有令牌的敌人只能压制走位，不能开火——同时开火上限同时约束伤害峰值、音效并发与帧预算。
- **状态机**：`patrol → investigate → engage → search`；感知三段式（距离→视锥→lineOfSight），`exposure` 有惯量（`[src:pretty:L57426-L57455]`）。
- **听觉**：`weapon:fire` 事件 → 半径 `hearRadius` 内 `alert(pos)` → 队友 rally；这是「枪声引来增援」的全部实现。
- **射击调度**：`playerShot / enemyShot` 先物理后敌人射线，弱点 ×2.2，命中统一走 `impact` 事件（`[src:pretty:L52511-L52511]`）。
- 检查点：同时开火数 ≤ `maxTokens`；45m 内开枪触发 investigate、45m 外不触发。

## S7.5 自动战斗自检

- `autoBattle(seconds, {tick, sampleAttackers, audioMeter})`：固定步长跑一段战斗，采样 `maxConcurrentAttackers / alerts / fires / shots / impacts`；接 `AnalyserNode` 时追加 `peak / clipCount / rms`。
- 断言：`maxConcurrentAttackers ≤ maxTokens`、`alerts ≥ 1`、`fires ≥ 1`、`peak ≤ 0.97`、`clipCount = 0`。
- 确定性：kit 内零 `Math.random`（rng 注入），同 seed 两局事件序列 hash 必须相等——这是回归对照的基线。

## 装配顺序与失败回退

| 症状 | 回退到 | 动作 |
| --- | --- | --- |
| 角色穿墙/贴墙抖动 | S7.2 | 检查 `moveCapsule` 的 radius/stepHeight，子步进数是否被改小 |
| 敌人不开火 | S7.4 | 先查令牌池是否泄漏（release 未调用），再查 LOS/engage 阈值 |
| 敌人瞬移式警觉 | S7.4 | 检查 `exposure` 是否被绕过（直接 set mode） |
| 路径走不通 | S7.2 | `findPath` 返回 null 时降级直线移动；检查 `noNav` 旗标 |
| 战斗不可复现 | S7.5 | 搜索 `Math.random`，全部替换为注入 rng |
| 零件数对不上 | S7.3 | `validateLayout` 已判红——别绕过它 |

## 自检

- [ ] `harness/gates/gameplay.mjs --self-test` 全绿（令牌/感知/听觉/对账/确定性）
- [ ] `--scene` 自动战斗断言全过，截图落盘
- [ ] 关卡九件套与 `stats` 对账一致
- [ ] 同 seed 两局 `hash` 相等
