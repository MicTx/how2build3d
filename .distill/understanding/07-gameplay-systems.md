# 07 · 玩法系统：状态机、手感调参表与任务流

> 玩法代码全部在压缩巨行里，但作者把**调参表外置成常量对象**——手感是数据不是魔法。

## 玩家与武器

**玩家控制器**有一张完整的移动手感表（L5939 巨行）：`accelAir:9, gravity:21, jumpApex:1`（跳跃高度用"顶点高度"而非初速度定义——`rC=sqrt(2*gravity*jumpApex)` 反推出速度）；**宽容输入**双件套 `coyote:0.12`（离台 120ms 内仍可跳）+ `jumpBuffer:0.13`（落地前 130ms 按跳缓存）；蹲伏高度 crouchHeight:1.15、视线切换速率 `eyeRate:十一`（站蹲 1.68↔1.05 的插值速度）[src:pretty:L921-L945] [src:pretty:L1044-L1068]。

**步态与镜头**：三种步幅 `stride:{walk:1.55, sprint:2.1, crouch:1.05}`；视角摇晃 `bobY:0.024, bobX:0.013`，冲刺加速 1.9 倍、开镜压到 0.22 倍；落地下沉 `landDip:0.36`（上限 0.2）；FOV 呼吸——冲刺 +6°、开镜 五十二°（与武器相机 `viewFov:五十四` 联动）[src:pretty:L921-L945] [src:pretty:L1044-L1068]。

**射击手感**：后坐力三段 `recoilKeep:0.35`（保留比例）/`recoilApply:34`（施加速率）/`recoilRecover:6.5`（恢复速率）/`recoilHold:0.09`（保持时长）；受击震屏 `shakeDecay:1.7, shakePitch/Yaw:0.03, shakeRoll:0.045`；血量再生 regenDelay:4, regenRate:二十五（脱战 4 秒后每秒回 二十五）[src:pretty:L921-L945]。

**武器是一张装配表**："几猫九式突击步枪"的每个部件有坐标常量——枪口 `[0,0,-0.531]`、抛壳口、机瞄高度 sightY:0.069、镜片焦距 lensF:0.0285、**镜窗八边形顶点数组**（红点镜开窗形状逐点定义）、弹匣位、枪机行程 boltTravel:0.062、导轨顶、握把/护木位置与半径 [src:pretty:L921-L945]。换弹动画拉枪机 = 沿 `boltTravel` 平移；开镜 = 相机对齐 `sightY` 与镜窗中心。

## 敌人与波次

敌人系统是**事件驱动的增援调度**而非预置关卡：任务状态袋 `c`（L6202 巨行）跟踪 `cut/allCut/queue/waveHot/alertT/pursuitT/pursuitLeft/contactSaid/lowSaid/extractHint/used/relays`——切断中继触发 waveHot（热增援）与 pursuitT（追击计时）[src:pretty:L51928-L51952]。敌人种类在音效表可见轮廓：地面猎犬（hound，脚步 3 变体、舵机声循环）与空中旋翼（gull_rotor 循环音）[src:pretty:L921-L945]。警报状态有语音提示（`contactSaid/lowSaid` 一次性播报防重复）[src:pretty:L51928-L51952]。

## 任务流

主循环是「突入 → 切三处中继 → 应对增援 → 撤离」：

- **中继对象**在关卡装配期生成：`relays = A().map(...)`，每处带 `id/short(字母标号)/t(计时)/cut/cutting` 状态，字母标号由 id 尾字符或序号生成（A/B/C）[src:pretty:L51928-L51952]。HUD 对应两种标记（世界空间菱形 `h-cm` + 屏幕边缘箭头 `h-wm`）[src:L59-L60]。
- **切断交互**是按住式（按住 E），中继对象暴露 `setState("live"/"cutting"/"cut")` 方法，由游戏侧驱动视觉状态（灯光闪烁注入材质 `saltline-blink` 即服务于它）[src:pretty:L51928-L51952] [src:pretty:L18627-L18651]。
- **进度上报**：HUD 走 `setRelays(0, relays.length)` 接口 [src:L6087-L6087]。
- **标题过场**：Catmull-Rom 样条相机沿 cinematicPath 巡港，加正弦漂浮（`sin(t*0.31)*0.05` 级别的手持感），无路径时退化为玩家出生点上空的默认两帧路径 [src:pretty:L21333-L21357] [src:pretty:L51928-L51952]。
- **调试直通**：debugCut() 一键切掉下一个未切中继——作者给自己留的验收捷径 [src:pretty:L51928-L51952]。

## 输入三模态

输入系统同时服务键鼠（Pointer Lock [src:pretty:L921-L945]）、触屏（双摇杆 + 屏幕按钮 [src:pretty:L921-L945]）、手柄（`gamepad` 轮询，映射 RT/LT/A/B/X/Y/L3/Start）[src:pretty:L921-L945]。`__G.input` 暴露 22 个字段（move/look/fire/ads/sprint/crouch/locked/touch/gamepad/sensitivity/invertY/mode/down/pressed/update/endFrame/requestLock/exitLock/setGameplay/setPrompt/onModeChange/describeMode），是三模态归一化后的**统一虚拟输入**。

## 调参表的启示

所有手感数字集中在三张表（移动/武器/任务），没有一处魔法数散落在逻辑里。这让"调手感"变成改数据，且每个数字的语义自命名（`coyote`/`jumpBuffer`/`recoilKeep`）。蒸馏到 `.distill/distillation/01-methodology.md` 的检查点：**先写调参表，再写控制器**。

## 状态机全景

`__G.game` 的公开面（start/pause/resume/update/debugCut/state/flow/run/menus）与状态迁移事件 `events.emit("game:state", {state, prev})` 构成可观测骨架 [src:pretty:L51928-L51952]。状态切换统一走 `M(P)` 函数：变更即广播、清零计时——**一处切换，全系统感知**。恢复现场（重开一局）的 `H()` 把敌人/FX/战斗/武器/任务袋全部重置后再重建 relays，保证"再来一局"与首局完全一致（确定性 RNG 种子 四千二百七 之下逐帧可复现 [src:pretty:L51928-L51952]）。

这就是玩法层的完整闭环：常量表定义"是什么"，状态机定义"何时变"，事件总线定义"谁知道了"，调参表定义"手感几分"。
