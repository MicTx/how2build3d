# 配方 05 · 全合成音频与五声部混音

> 复刻 五十七 条声音规格表与总线图 [src:pretty:L921-L945]，配套代码图集 F。

## 配方

1. **规格表**：一条记录 = 一个声音：`gen`（生成函数）、`n`（变体数）、`sr`（采样率）、`peak`（目标峰值）、`bus`、`max`（同播上限）、`pri`（抢占优先级）、`ref/roll`（空间衰减）[src:pretty:L921-L945]。
2. **确定性变体**：`ao(hash(name)+variant*七千九百一十九)` 作种子，同一 seed 生成同一波形 [src:pretty:L921-L945] [src:pretty:L51928-L51952]。
3. **后处理**：非 loop 音加 0.3ms/12ms 淡入淡出防 click，再按 `peak/max(samples)` 归一化 [src:pretty:L921-L945]。
4. **渐进合成**：`boot:1` 的立即合成，其余进队列；每批 >6ms 让出，12ms 后继续；未完成前用 ready callback 排队等 buffer [src:pretty:L921-L945]。
5. **总线图**：世界音 → HRTF Panner（`panningModel="HRTF"` [src:pretty:L7375-L7399]）→ Convolver（程序化 IR `ir_outdoor/ir_shed`）→ Compressor → WaveShaper 软限幅 → 主音量；UI 走 `dry` 绕过空间化 [src:pretty:L921-L945]。
6. **音乐**：drone/ost/perc/brass/motif 五条 loop 声部（`music:1`），按战斗强度调各轨增益；任务事件音（`objective/complete/death`）挂 music 总线 pri:9 抢占 [src:pretty:L921-L945]。

## 参数表

| 参数 | 值 | 来源 |
| --- | --- | --- |
| Compressor | `threshold:-10, knee:6, ratio:6, attack:.002, release:.14` | [src:pretty:L921-L945] |
| WaveShaper 曲线 | 2049 点查找表 | [src:pretty:L921-L945] |
| 爆炸 `peak/max/pri` | `.97/3/10` | [src:pretty:L921-L945] |
| UI `ui_click` | `peak:.3, bus:"dry", pri:9` | [src:pretty:L921-L945] |
| 循环环境音 | `rain/wind/sea/relay_hum/...` `loop:1` | [src:pretty:L921-L945] |
| 让步调度 | 6ms/批，12ms 间隔 | [src:pretty:L921-L945] |
| 变体种子步长 | 7919（质数） | [src:pretty:L921-L945] |

## 取舍与失败模式

- **取舍**：音乐是"状态混音"而非完整曲目，内存极小、过渡无接缝，代价是写不出交响式编曲。
- **失败**：开局静音 → `bench` 强制 `noaudio=1`，先确认不是测试参数造成 [src:pretty:L51928-L51952]；声音糊 → 调 `max/pri` 与压缩器阈值 [src:pretty:L921-L945]；室内外混响不切 → 检查 `ir_outdoor/ir_shed` 是否按 interiorBoxes 命中切换 [src:pretty:L7000-L7024]。
- **验收**：静音开关零请求；同 seed 两次合成的 buffer checksum 一致；启动期不出现 >6ms 长任务。

## 实施顺序

1. 先写规格表与一个 gen 函数，验收"能出声" [src:pretty:L921-L945]；
2. 接确定性变体与峰值归一化，验收 checksum [src:pretty:L921-L945] [src:pretty:L51928-L51952]；
3. 搭总线图（HRTF → 卷积 → 压缩 → 软限幅）[src:pretty:L7375-L7399] [src:pretty:L921-L945]；
4. 接 6ms/批渐进合成与 ready callback 排队 [src:pretty:L921-L945]；
5. 最后接五声部混音与任务事件抢占 [src:pretty:L921-L945]。

## 与其他配方的接口

`bench` 参数强制 `noaudio=1`，是自动化测试的前置 [src:pretty:L51928-L51952]；室内外 IR 切换由 interiorBoxes 命中检测提供 [src:pretty:L7000-L7024]；战斗强度来自任务状态袋 `waveHot/pursuitT` [src:pretty:L51928-L51952]，与本配方解耦为单一增益值。
