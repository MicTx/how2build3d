# 01 · 方法论：从场景意图到交付的端到端工作流

> 本篇把 `00-philosophy.md` 的十条原则变成 **九个阶段 × 检查点** 的可执行流程。
> 每一阶段给出：输入 → 动作（对应 Saltline 的做法）→ 检查点 → 反例。

## 工作流

```
S0 场景意图 ─→ S1 预算契约 ─→ S2 生成器设计 ─→ S3 世界装配 ─→ S4 材质与光照
                                                            ↓
S9 可检视交付 ←─ S8 UI 与音频 ←─ S7 玩法与手感 ←─ S6 后处理 ←─ S5 天气与氛围
```

### S0 · 场景意图（一句话 + 三条美术决定）

先写一句可判断真假的话，再写三条约束。Saltline 的是"雨幕中的港区、堆叠集装箱、湿地倒影"与 token 板上那句 "port-authority signage meets a film title card" [src:L8-L10]。天空着色器里甚至写了"太阳永远从云隙烧穿，绝不躲在实云后"这样的构图铁律 [src:L4248-L4248]。

**检查点**：意图能否被一句 shader 注释表达？三条美术决定是否各自对应一个可调参数 [src:pretty:L1044-L1068]？
**反例**：先建场景再想风格，导致后期所有材质重做。

### S1 · 预算契约（先定表，后建内容）

写一张 `quality` 分级表，字段至少覆盖：渲染缩放 `scale`、MSAA、阴影尺寸、纹理上限、体积光步数、AO、平面反射、bloom、动态模糊、雨密度 [src:pretty:L1044-L1068]。同时定死像素预算（low 1e6 / medium 15e5 / high 23e5 / ultra 37e5）与自适应缩放公式 [src:pretty:L7000-L7024]。

**检查点**：最低档能不能跑？同档下分辨率是否真的被裁到预算内（本项目实测 358×202）？

### S2 · 生成器设计（资产即代码）

按三类建生成器：噪声（一张共享 256² 纹理 + CPU xorshift [src:L4206-L4206] + GPU fbm5/fbm3 [src:L4192-L4195]）、Canvas 排版/啃咬 [src:pretty:L33030-L33054]、参数几何拼装（常量表 → Box/Cylinder → applyMatrix4 → merge [src:pretty:L1044-L1068]）。

**检查点**：删掉所有资产目录能否重建同一画面？噪声是否确定性（seed 进启动参数）？

### S3 · 世界装配（常量表先行）

把世界写成一个常量表：边界盒、地面/海面高度、码头坐标、太阳方向/色/强度、玩家体型与 FOV [src:pretty:L1044-L1068]。重复单元走 InstancedMesh [src:L5461-L5461]；合并后重算法线 [src:pretty:L1-L25]。

**检查点**：世界坐标是否集中一处？draw call 是否随物体数线性增长（本项目 p50 三百二十 被结构锁死）[src:pretty:L7000-L7024]？

### S4 · 材质与光照（注入四步纪律）

`prepend 声明 → #include <anchor> 锚点替换 → 保留原语义 → 必给 customProgramCacheKey` [src:pretty:L18627-L18651]。缓存键要编码所有影响编译产物的维度（`sl2|tint+tile+interior+alphaCut` [src:pretty:L21333-L21357]）。阴影用 PCSS 时先检测 chunk 布局，不符退回 stock PCF [src:L4296-L4296]。

**检查点**：注入失败时游戏还成立吗？缓存键能否唯一代表一个编译产物？

### S5 · 天气与氛围（程序化天空 + 事件化光照）

云层/云隙/闪电/大气透视写进一个带注释的着色器 [src:L4207-L4295]；闪电由 CPU 端衰减曲线驱动 uFlash [src:pretty:L7000-L7024]；雨湿走 uniform 而非贴图切换 [src:L5318-L5318]。

**检查点**：天气变化是否零加载、零资产？意图注释是否紧贴实现？

### S6 · 后处理（一个 pass，两条数据流）

全屏 shader 的 uniform 分两组：光学组（bloom/dirt/streak/flare/CA/vignette）与游戏状态组（damage/lowHealth/ads/flash/fade/saturation/thunder）[src:L4612-L4613]。AA 与锐化互相让位（"backed off on strong edges"）[src:L4732-L4734]；颗粒按亮度加权、天空抖动去色带 [src:L4735-L4740]。

**检查点**：CPU 侧是否有一个 `post` 状态袋统一驱动？受击/开镜反馈是否走同一入口 [src:pretty:L7000-L7024]？

### S7 · 玩法与手感（先写调参表）

移动表（coyote/jumpBuffer/bob/regen）、武器表（recoil/shake/镜窗顶点）、任务状态袋 [src:pretty:L921-L945] [src:pretty:L51928-L51952]。状态切换统一走一处并广播事件（`game:state`）[src:pretty:L51928-L51952]。输入三模态归一到 `__G.input` 一个虚拟层 [src:pretty:L921-L945]。

**检查点**：调一个手感参数要不要改逻辑？同一 seed 重开一局是否完全一致？

### S8 · UI 与音频（设计系统 + 规格表）

UI：十七 个 token [src:L11-L23]、分区注释即目录 [src:L41-L48]、HUD 按可见性分层、触屏按拇指落点布局 [src:L186-L188]。音频：五十七 条声音规格表 [src:pretty:L921-L945]、总线图（HRTF→卷积→压缩→软限幅）[src:pretty:L7375-L7399]、五声部音乐按战斗强度混音。

**检查点**：加一种声音是否只需加一行表 + 一个 gen 函数？UI 组件里有没有硬编码色值？

### S9 · 可检视交付（把内部状态开放）

`window.__G`（引擎上下文）+ `window.__stats()`（统计）+ `?bench`（静音+自启+确定 seed）+ `debugCut()`（任务直达）[src:pretty:L51928-L51952]。同时把错误按 marker 分诊（`SALTLINE_POST/SKY/SHADOW`）[src:L4132-L4132]。

**检查点**：别人能否不读源码就量出你的 draw call？能否一键跳到验收状态？

## 检查点

三个贯穿全过程的门禁，任一不过就退回上一阶段：

1. **零外部资产门禁**：app 区域不得出现 fetch/图片/音频/模型文件引用（Saltline 实测 0 处，仅上游加载器死代码保留 3 处 [src:pretty:L7375-L7399]）。
2. **启动前置门禁**：所有编译与合成都在 onLevelReady 前后完成，运行期零"首次"卡顿 [src:pretty:L7000-L7024]。
3. **降级门禁**：关掉高级管线仍能出画；软阴影手术失败仍有阴影 [src:L4296-L4296]。

## 失败与回退

| 症状 | 回退阶段 | 动作 |
| --- | --- | --- |
| 真机帧时不达标 | S1 | 缩预算（scale/tex/volSteps），不砍内容 |
| shader 报"锚点找不到" | S4 | 保语义退回库存实现并告警，不崩 |
| 画面"塑料感" | S0/S5 | 回美术决定，补大气透视与粗糙度分层 [src:L4272-L4291] |
| 手感飘 | S7 | 只改调参表，不改控制器逻辑 |
| 声音糊成一片 | S8 | 调 `max/pri` 抢占与压缩器阈值 [src:pretty:L921-L945] |
