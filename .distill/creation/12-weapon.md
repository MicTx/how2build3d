# 创物 · 武器（weapon）

> 上游锚点：`sources/jimao-3a-game/index.html` L5939（2D 型材与视图模型几何）、L6065（锚点/弹簧/后坐/换弹常量与更新函数）｜ 我方资产：`assets/weapon-kit.mjs`（`WEAPON_ANCHORS` / `WEAPON_POSES` / `WEAPON_SPRINGS` / 9 通道 / 换弹状态机）｜ 对账：`harness/element-manifest.json` weapon 族 ｜ 验收：`node harness/gates/complete.mjs --scene examples/parity`

## 构建法则

**法则 1 · 一把枪只有一张锚点表**：枪口、抛壳口、瞄具高度、镜片焦面、瞄准窗六边形、弹匣位、枪机行程、导轨顶面、握把位、护木半径、拉机柄位、握把压缩量——全部收在 `mi` 表的 十四 个字段里 [src:pretty:L52796-L52827]。几何挤出、准镜多边形挖孔、枪口世界坐标投影、弹匣换弹动画四类消费者都读同一张表；任何“这里再补一个 -0.53”的硬编码都会让枪口火焰与弹道起点分家。

**法则 2 · 参数化重复优先于逐件建模**：49 段导轨槽不是 49 个手工零件，而是一个剖面 `x` 在 `for (F < 49)` 里从 -0.094 起步、步长 0.01、每段深 0.0048 挤出 [src:pretty:L52924-L52926]；整枪 15 个零件描述、63 个实心体，按 4 个车身材质槽 + 镜片合并成 5 个 draw call。近景轮廓的“信息量”来自重复密度与材质槽划分，不来自多边形数量。

**法则 3 · 弹簧通道是固定 9 条，不许临时加**：`kZ 520/30`（前后）、`kP 380/26`（俯仰）、`kY 300/22`、`kR 300/20`（横滚）、`swY/swP 110/15`（视角摆动）、`jY/jP 140/13`（跳跃）、`bump 600/30`（换弹/拉栓冲击）——通道名即语义，顺序即对账口径 [src:pretty:L55096-L55105]。积分用半隐式欧拉，`dt > 12ms` 自动拆成 ≤8ms 子步，防止掉帧时弹簧发散 [src:pretty:L54846-L54852]。

**法则 4 · 后坐必须分离成“瞄准角”和“视觉偏移”**：一次射击只把 35%（`recoilKeep`）写进真实瞄准角，其余 65% 进视觉偏移并夹在 ±0.3 / ±0.2，保持 `recoilHold 0.09s` 后按 `recoilRecover 6.5` 衰减 [src:pretty:L52150-L52168] [src:pretty:L52279-L52291]。弹道方向由“瞄准角 + 视觉偏移 + 散布”的相机姿态算出，所以准星永远指向弹着点——**后坐可以晃眼，但不能撒谎**。

**法则 5 · 换弹是相位时间线，不是进度条**：战术换弹 2.1s、空仓换弹 2.72s，共享前缀 `magOut 0.47 / fresh 0.86 / magIn 1.345 / tap 1.5`；空仓额外有 `rackStart 1.62 / boltOut 2.02 / boltIn 2.14 / boltEnd 2.19` [src:pretty:L55022-L55031]。每个相位只在跨过阈值的那一帧发一次事件（`weapon:reload` 的 `magout/magin/tap/bolt/done`），动画、音效、弹匣可见性都挂事件而不是每帧轮询 [src:pretty:L55261-L55290]。

**法则 6 · 两套 FOV，一次投影换算**：世界相机 74°、枪相机 54°、ADS 52°；视图模型挂在枪相机下，枪口/抛壳口投到世界时乘 `tan(世界/2) / tan(枪相机/2)` 的比例 [src:pretty:L55193-L55202]。不开这层换算，ADS 时枪口位置会横向漂移，曳光弹起点与枪管错位。

## 完整链路

| 环节 | 意图 | 算法 / 常量 | 上游实现 | 我方落点 | 运行时证据 | 门禁 | 失效模式与兜底 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 型材表 | 轮廓可调、可挖孔 | 6/8/12 点多边形；`shape.holes` | 剖面与挤出 [src:pretty:L52828-L52847] | `WEAPON_PROFILES` | `weaponSolids 63` | 展厅近景无破面 | 缺 THREE 时只算型材表，`meshMode="cpu-profile"` |
| 零件装配 | 材质槽合并 | 15 描述 × slot ∈ {ano,gun,poly,plain,lens} | 零件表与合并 | `WEAPON_PARTS` | `weaponMeshes 5`、`railSlots 49` | `weaponMeshes ≥ 1` | 单件挤出失败则整枪不建，`meshBuildError` 记录原因 |
| 姿态 | hip/ADS/sprint/reload 四组锚点 | p=[x,y,z]、r=YXZ 欧拉 | 四组锚点 [src:pretty:L54827-L54843] | `WEAPON_POSES` | `pose` 输出 | 四姿态切换无跳变 | ADS 用 `0.18s` 线性插值 + smootherstep，不瞬移 |
| 弹簧 | 惯性/摆动/冲击 | 9 通道 k/c，子步 ≤8ms | 弹簧表 [src:pretty:L55096-L55105] | `WEAPON_SPRINGS` / `channels` | `weaponChannels 9` | `weaponChannels ≥ 9` | 超时步长自动细分，掉帧不发散 |
| 射击 | 节拍 + 散布 + 反馈 | 720rpm，`cooldown += 60/rpm`，帧内最多补 3 发 | 射击函数与补发 [src:pretty:L55199-L55244] [src:pretty:L55305-L55314] | `shot()` | `stats().shots` | 连打 30 发节拍稳定 | 冷却为负时夹到 -0.001，卡帧不攒无限子弹 |
| 后坐 | 视觉与瞄准分离 | keep .35 / apply 34 / recover 6.5 / hold .09 | `addRecoil` [src:pretty:L52279-L52291] | `cam.pitch/yaw` + `pose` | 准星-弹着重合 | 自动射击 10s 不偏 | 视觉偏移 clamp ±0.3/±0.2，丢帧不甩头 |
| 换弹 | 相位事件驱动 | 2.1 / 2.72 双时间线；6 个相位 | 相位推进 [src:pretty:L55261-L55290] | `WEAPON_RELOAD_TIMELINE` | `weapon:reload` 事件序列 | 空仓必拉栓、战术不拉 | 换弹中开火被拒；弹匣在 0.86s 才可见 |
| 散布 | 状态叠加而非随机漂移 | hip .0125 / ads .0012 / 移动 .013 / 空中 .022 / 蹲 -.002；rate 18 | 散布公式 [src:pretty:L55333-L55344] | `spreadS` | `stats().spread` | ADS 明显更准 | `damp` 到目标值，不会一帧跳满 |
| 视图模型投影 | 枪口/抛壳口进世界 | tan 比缩放 + 相机四元数 | `Pe()` [src:pretty:L55193-L55202] | `muzzleWorld()` / `shellTransform()` | fx 曳光起点 | 与枪管重合 | 相机缺失时返回本地锚点，不抛错 |

链路里有一个容易忽略的方向性：**输入只读**。`update(dt, input)` 不写 `input`、不读全局键位，只消费调用方给的 `fire/ads/reload/sprint/moveX/moveY/speed/onGround/vy/lookDx/lookDy`；这样同一把枪能在玩家、展厅、自动测试三种驱动下跑同一套手感。

## 思维链

**决策链 A · 为什么挤 2D 型材，而不是建 3D 枪模**

- **约束**（事实）：单 HTML、零外部资源、首屏要快；枪是近景常驻物体，轮廓和导轨密度必须撑得住贴脸看。
- **目标**（事实）：15 个可辨识零件、4 个材质槽、49 段导轨槽，且 draw call 控制在个位数。
- **候选**（推断）：A 外部 GLTF；B CSG 布尔建模；C 2D 剖面沿轴挤出 + 参数重复。
- **选择**（事实）：C。滑套/机匣/弹匣/枪托/握把各一条剖面，导轨槽用同一剖面循环 49 次 [src:pretty:L52924-L52926]；按材质槽合并后只剩 5 个 mesh。
- **兜底**（事实）：接受“参数化近似而非逐件复刻”，把预算转投材质槽（`pac9_anodised/phosphate/polymer/matte` + 镜片）与近景细节；挤出失败时整枪回落到型材计数模式，仍能对账。

**决策链 B · 后坐为什么按 35/65 拆**

- **约束**（事实）：玩家要“感到”后坐；但准星必须指向弹着，否则长按扫射会失去可信度；同时相机俯仰有 ±1.5 的硬限位。
- **目标**（事实）：短点射有上跳，长扫射不把视角顶到天上，且视觉抖动可独立调。
- **候选**（推断）：A 全量写瞄准角；B 全量给视觉偏移；C 按比例拆分。
- **选择**（事实）：C，`recoilKeep 0.35`。瞄准角吃 35% 并被 `pitchLimit` 夹住；视觉偏移吃 65%，夹 ±0.3/±0.2，`hold 0.09s` 后用 `recover 6.5` 回正 [src:pretty:L52279-L52291]。
- **兜底**（事实）：弹道从“最终相机姿态”反算，即使视觉偏移没回正，准星与弹着仍一致；recoilHold 结束后视觉偏移按 `recoilRecover 6.5` 回零，相机再以 `recoilApply 三十四` 的阻尼追上偏移量——先“晃眼”，再“归位”，两段速率分开调，互不牵制 [src:pretty:L52460-L52480]。

**决策链 C · 换弹为什么是两条时间线**

- **约束**（事实）：空仓换弹必须拉栓（否则枪机状态与动画矛盾）；战术换弹若也拉栓，2.7s 的硬直会让节奏崩掉。
- **目标**（事实）：两种换弹共享大部分动作，只差尾段；且弹匣、枪机、手部三条动画要同步。
- **候选**（推断）：A 单时间线 + 布尔跳过尾段；B 两条时间线共享前缀；C 两套完全独立动画。
- **选择**（事实）：B。`2.1 / 2.72` 两个总长，相位阈值前四个共用，空仓独享 `rackStart→boltEnd` [src:pretty:L55022-L55031]；`reloadBolt` 由 `smootherstep` 在 2.02–2.14 之间推 0→1，再在 35ms 内回落。
- **兜底**（事实）：相位用“首次跨过阈值”发事件，掉帧跳帧也不会漏发；`fresh` 弹匣在 0.86s 才重新可见，避免弹匣穿模。

**推断边界**：35/65 的拆分比例、49 段导轨槽的密度、2.1/2.72 的时长都可从常量读出（事实）；但作者是先定手感再倒推参数，还是先有参考枪数据，无法证实。“候选 A/B 被比较过”属推断，源码只留下最终选择。

## 迁移法则

**资产路由**：几何/型材/锚点/弹簧/姿态/换弹状态机/散布 → `assets/weapon-kit.mjs`；后坐的相机侧落点（`addRecoil` 的 keep 与 clamp）属于 player 契约，武器只调用、不实现；枪口与抛壳口的粒子 → `assets/fx-kit.mjs` 的 `tracer/shell/muzzleFlash`。

**参数重绑点**：

1. `WEAPON_ANCHORS.muzzle/eject` → fx 曳光起点与抛壳初速方向；改枪管长度必须同步。
2. `WEAPON_TUNE_DEFAULTS.rpm/damage` → 敌人 `hp 45/140` 与弱点 ×2.2 的击杀弹数；改射速要连带看 `bloomPerShot 0.17` 与 `spreadRate 18`。
3. `WEAPON_SPRINGS.kZ/kP` → 后坐观感；`bump` 与换弹 `magOut/magIn/tap` 相位绑定，改时间线要重调 bump 刚度。
4. `adsTime 0.18` 与 `adsFov 52` → HUD 准星收缩速度；三者不同步会出现“准星先到、画面后到”。
5. `WEAPON_POSES` 四组锚点 → 视图模型与手部/袖口位置；改握把位必须同步 `grip` 与两只手的 IK 锚。

**对账行**：`weaponMeshes ≥ 1`（three 路径实测 5，CPU 路径报 63 个实心体并在 `meshMode` 标明）、`weaponChannels ≥ 9`（实测 9）。另有 `weaponParts 15 / weaponSolids 63 / railSlots 49 / materialSlots 4 / drawCalls 5 / tris` 供回归对比。

**迁移禁区**：把后坐直接写进 `player.pitch`（准星与弹着分家）；在 `update()` 里 `new` 临时向量（热循环零分配是硬约束）；把 9 条弹簧改成“按需创建”（通道数即门禁口径，也会让换弹/跳跃的耦合失效）。
