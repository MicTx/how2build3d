# 08 · 玩法链路 kit：物理 / 关卡 / 战斗的 API 契约

> 观感链路的蒸馏止于「看」；这一篇把「动」的三件套——物理查询、关卡装配、战斗导演——从源文件提炼成三个可复用 kit（`assets/physics-kit.mjs`、`assets/level-kit.mjs`、`assets/combat-kit.mjs`）。physics/combat 保持纯 JS（零引擎依赖，可 node 自测）；level-kit 需要 THREE 注入。所有算法逐行对照源实现，行为合同以源为准。

## 物理（physics-kit）

源模块是一张 **AABB 盒列表 + 三平面世界**：盒子带 `surface/tag/noNav/bulletOnly/playerOnly` 旗标，世界由 `groundY/seaY/quayX` 三个常量平面兜底（地面只有两个三角形，细节全在像素层——与 `references/03` 的布局手写同源）。

- `raycast(origin, dir, max)`：slab 法逐盒求交，先撞地面/水面平面，返回 `{dist, point, normal, surface, box}`（`[src:pretty:L34705-L34705]`）。
- `lineOfSight(a, b)`：射线长度减 5cm 余量后取反——「视线」即「无遮挡」（`[src:pretty:L34781-L34781]`）。
- `groundHeight(x, z, maxY)`：取限定高度下最高的盒顶，否则落回地面/海面平面（`[src:pretty:L34786-L34786]`）。
- moveCapsule(pos, vel, dt, r=0.32, h=1.8, step)：**子步进扫掠胶囊**——按 ceil(|v|dt/(r*0.6)) 分步防穿墙，墙滑（法线投影消速）、三点迭代解穿透、落地/天花板/step-up 一并结算，返回 {onGround, hitWall, hitCeil, surface}（`[src:pretty:L34810-L34810]`）。
- `nav`：盒列表 → 导航网格（阻挡位图，dirty-flag 懒重建），`isWalkable / findPath（A* + 视线拉直）/ randomPoint / clearLine`；`noNav/bulletOnly` 盒与边界不入网格（`[src:pretty:L34875-L34875]`）。

kit 合同：`createPhysicsKit({ bounds:{groundY,seaY,quayX}, region, cell, stepHeight, agentPadding, rng })`；`Math.random` 被 rng 注入替换（铁律 #5）。

## 关卡（level-kit）

关卡不是「场景代码」，是**数据**：`playerStart / objectives / enemySpawns / zones / interiorBoxes / cinematicPath / extraction / groundSurfaceAt / update` 九件套就是关卡的全部接口面（`[src:pretty:L59358-L59374]`）。

- `catalog`：PROP_SIZES 式尺寸/材质/零件数表（`[src:pretty:L35067-L35068]`）——注册表即目录。
- `layout`：手写坐标放置表（`{prop, at, rot?, parts?, tag?}`）；**布局手写、随机只进变体**。
- `validateLayout(catalog, layout)`：未知道具名 / 零件数不符 → 构建期抛错（对账即门禁）。
- `assembleLevel(THREE, {catalog, layout, physics})`：建网格组 + 向 physics 注册 AABB 碰撞 + 返回九件套与 `stats`（道具数/零件数/碰撞盒数对账）。

## 战斗（combat-kit）

射击命中与伤害调度在 `zv`：playerShot 先打物理再打敌人射线、弱点 `part==="weak"` 伤害 ×2.2、命中走 `impact`/`player:hitEnemy` 事件（`[src:pretty:L52511-L52511]`）。

- **攻击令牌**：`maxTokens 2 / maxTokensCrowd 3 / tokenGap 1.25`——同时开火的敌人上限，压迫感与音效并发预算的来源（`[src:pretty:L57426-L57434]`）。
- **状态机**：`patrol → investigate → engage → search`，感知三段式（距离→视锥→LOS），`exposure` 有惯量（`[src:pretty:L57426-L57455]`）。
- **听觉**：`weapon:fire` 事件 + `hearRadius 45` → `alert(pos)` 传播给队友（`[src:pretty:L57433-L57434]`）。
- **任务状态袋**：`cut/allCut/queue/waveHot/alertT/pursuitT` 事件驱动增援，不做预置关卡（`.distill/understanding/07-gameplay-systems.md`，`[src:pretty:L51928-L51952]`）。
- **autoBattle(seconds, {tick, sampleAttackers, audioMeter})**：自动战斗采样器——输出 `maxConcurrentAttackers / alerts / eventLog`，接 `AnalyserNode` 后追加 `peak/clipCount/rms`（references/08 的声音自检配方）。

## 自检

- [ ] 三 kit 均可被 node 导入并过 API 断言（不依赖浏览器）
- [ ] `harness/gates/gameplay.mjs --scene` 断言令牌上限/听觉半径/同 seed 确定性
- [ ] 样例场景 `?show=enemies|level|props` 三厅可用
- [ ] kit 内零 `Math.random`（rng 注入），同 seed 事件序列 diff = 0
