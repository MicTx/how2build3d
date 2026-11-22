# 工作流 S0–S9：理解 → 蒸馏 → 构建

## 三阶段

- **理解**：先跑现场（headless Chrome + WebGL），量出 draw call / program / 帧时 / 最终 GLSL，再读源码。证据优先级：运行时实测 > 捕获的最终 GLSL > 静态源码 > 注释。压缩产物不可读时，用 `shaderSource` 钩子拿最终明文；用上游 ShaderChunk 做区间 diff 算出"作者写了多少"。
- **蒸馏**：把观察收敛成四类资产——常量表、生成器、注入骨架、降级链。每条断言挂行号引用，不写无出处的散文。
- **构建**：按下表顺序落地，每阶段过检查点。

## 阶段表

| 阶段 | 输入 | 动作 | 检查点 |
| --- | --- | --- | --- |
| **R0 参考研究** | 真实地点名称（或虚构世界观设定） | ≥3 参考源逐项分解（权威文本/地理数据/图像/视频），查询派生 + 覆盖矩阵配额核对；无图像时按 **16 类要素**清单逐类决策（12 类空间 + 4 类观感，见 `references/05`）；产出 GAP 表（真实值 vs 规划值，每条带参数去向）；构建后参考对拍回灌 GAP | 三大 GAP 排进本次构建；16 类无沉默项；覆盖矩阵无未登记缺口；对拍 delta 已进 GAP；来源全部可追溯 |
| S0 意图 | R0 的 GAP 表 + 需求 | 一句场景意图 + 三条美术决定，写成注释；美术决定必须引用 GAP 表条目 | 每条决定对应一个可调参数与一条参考条目 |
| S1 预算 | S0 | 画质分级表 + 像素预算 + 自适应缩放公式 | 最低档分辨率实测被裁 |
| S2 生成器 | S1 | 共享噪声纹理/fbm、Canvas 做旧与排版、参数几何；道具目录与零件 builder 走 `assets/props-kit.mjs` | 零资产重建 + seed 确定性 |
| S3 装配 | S2 | 世界常量表、InstancedMesh、合并、重算法线；关卡九件套与布局用手写坐标（`assets/level-kit.mjs` 对账） | draw call 有上下界 |
| S4 材质 | S3 | onBeforeCompile 四步、缓存键、chunk 手术 | 注入失败仍出画 |
| S5 氛围 | S4 | 程序化天空、uniform 天气、闪电衰减曲线；海面走 `assets/sea.glsl`，雨雷走 `assets/weather-kit.mjs` | 天气零加载 |
| S6 后处理 | S5 | 单 pass、双流 uniform、AA/锐化让位、颗粒抖动 | 统一 post 状态袋 |
| S7 玩法 | S1 | 手感调参表、宽容输入、三模态虚拟输入；玩家控制器走 `assets/player-kit.mjs`，角色/敌人动画走 `references/09` + `assets/enemy-kit.mjs`，物理/关卡/战斗走 `references/10` + 三 kit，武器走 `assets/weapon-kit.mjs`，FX 走 `assets/fx-kit.mjs` | 调参不改逻辑；令牌上限/听觉/同 seed 确定性过 `gameplay` 门禁 |
| S8 UI/音频 | S7 | 设计 token、规格表、总线图、五声部混音；HUD 走 `assets/hud-kit.mjs`，音频走 `assets/audio-kit.mjs` | 加声音只加一行表；音频 peak/clip 可量测 |
| S9 交付 | 全部 | `__G`/`__stats()`/`?bench`/`debugCut`/错误分诊 + **九展厅自检协议**（`references/08`，`assets/inspect-deck.mjs`） | 不读源码可量测；九厅 used/N-A 齐全且 `complete`/`inspect` 门禁过 |

## 三个贯穿门禁

1. **零外部资产**：app 区域无 `fetch`、无图片/音频/模型文件、无 `<script src>`、无外链样式。
2. **启动前置**：所有编译与合成在 `onLevelReady` 阶段完成；合成用 6ms/批让步调度，不让首帧卡顿。
3. **全链路降级**：高级管线异常 → 前向渲染；chunk 布局不符 → 库存 PCF；测试模式 → 静音+自启+固定 seed。

## 失败回退表

| 症状 | 回退到 | 动作 |
| --- | --- | --- |
| 真机帧时不达标 | S1 | 缩 scale/tex/volSteps，不砍内容 |
| shader 锚点找不到 | S4 | 退回库存实现并告警 |
| 画面塑料感 | S4/S5/S6 | 按 references/07 材质分层清单逐项对照；缺哪层补哪层资产（正常/ORM/wet/macro），不靠加滤镜 |
| 夜景浑浊、发光无光晕 | S6 | 查 post-chain 曝光与 bloom 能量；发光体 HDR 值 >1；uNight 渐变链 |
| 地面干涩、无反射 | S4/S6 | 接入 ssr-wet + 平面反射；uSlWet×uSlWetP 至少启用湿痕与粗糙下拉 |
| 手感飘 | S7 | 只改调参表 |
| 声音糊 | S8 | 调 max/pri 与压缩器阈值 |
| 有画面无玩法 | S7 | 按 `references/10` 装三 kit，再按 `references/12` 依次接玩家/武器/敌人/FX/HUD |
| 技术全绿但观感空壳 | S1/S3 | `node harness/gates/complete.mjs` 读元素对账，`perf.mjs --floors` 判密度下限；缺哪族补哪族资产 |
| 无法验收 | S9 | 补检视入口 |
