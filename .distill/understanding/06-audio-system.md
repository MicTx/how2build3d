# 06 · 音频系统：全合成的声音世界

> 没有一个音频文件。57 条声音规格（55 个可播 + 2 张生成 IR）全部是「启动期 JS 函数合成 → AudioBuffer →
> 总线图 → HRTF 空间化」的产物。

## 合成链路

音频引擎的装配集中在 L5939 巨行（展开后约 50400-50850 行）。数据结构是一张**声音规格表** `Go`：每个声音一条记录——`gen`（波形生成函数）、`n`（变体数）、`sr`（采样率）、`peak`（归一化目标）、`bus`（世界/干/音乐）、`max`（同时播放上限）、`pri`（抢占优先级）、`ref`（参考距离）、`roll`（衰减滚降）[src:pretty:L921-L945]。

表里 57 条规格中，55 个可播声音按用途分四类（另 2 条是生成 IR，见下文）：

- **一次性世界音**：敌人脚步（3 变体）、海鸥/猎犬死亡、电报、警报、爆炸、中继切断、雷、雾号、鸥鸣、旗绳拍打、集装箱哐当 [src:pretty:L921-L945]；
- **UI 音**：`ui_click/ui_hover` 走 `dry` 总线（不过空间化）[src:pretty:L921-L945]；
- **循环环境音**：雨、室内雨、风、海浪、鸥旋翼、猎犬舵机、中继嗡鸣（loop:1）[src:pretty:L921-L945]；
- **音乐声部**：drone/ost/perc/brass/motif 五轨（music:1），独立采样率（音乐轨自己的 `sr`）[src:pretty:L921-L945]。

合成执行是**渐进式的**：启动时先把 `boot:1` 标记的声音立刻合成，其余进队列；后台循环每 12ms 醒来合成一批，单批超过 6ms 就让出（`performance.now()-te>6` break）——**不阻塞首帧，但声音渐次到位**。加载屏的进度条与它联动。

每个变体的随机性来自**确定性种子**：`ao(Kb(i)+o*7919)`——声音名哈希 + 变体号 × 7919（质数）做种子，同一 seed 每次生成完全相同的波形。合成结果过两道处理再进 buffer：淡入淡出尾（非 loop 音 0.3ms/12ms 防 click）与峰值归一化（`peak/max(samples)`）。

## 音效分层

总线图是音频工程的教科书结构（全部 L5939 巨行）：

```
源 Buffer ─ HRTF Panner ─ Gain ─┐
                                ├─ [world] ─ Convolver(ir_outdoor/ir_shed) ─┐
UI/dry ─────────────────────────┤                                            ├─ Compressor ─ WaveShaper(软限幅) ─ 主音量 ─ 出
音乐/music ─────────────────────┘                                            ┘
```

- **动态范围控制**：`DynamicsCompressor` 阈值 −10 dB、knee 6、ratio 6、attack 2ms、release 0.14s，压住爆炸与枪声的峰值差 [src:pretty:L50779-L50787]。
- **软限幅**：WaveShaper 用 二千四十九 点查找表做 tanh 类曲线，压顶不削波 [src:pretty:L921-L945]。
- **卷积混响**：两个**程序化生成的脉冲响应**——`ir_outdoor`（露天）与 `ir_shed`（仓库内）也是合成 buffer（`ir:1` 标记），室内外交接时切 IR [src:pretty:L50520-L50521]。
- **空间化**：three 的 `PositionalAudio` 用 `PannerNode`，`panningModel="HRTF"`，`refDistance` 由声音规格表的 `ref` 字段驱动 [src:pretty:L50847-L50849]。

## 音乐与战斗强度

音乐不是一首曲子，是**五个可独立混合的声部**（drone 铺底 / ost 主题 / perc 打击 / brass 铜管 / motif 动机），战斗强度值驱动各声部增益——探索时只留 drone+海浪，交火时 brass/perc 推起来 [src:pretty:L50515-L50519]。任务事件音（`objective/objective_all/complete/death`）挂在 `music` 总线，与音乐同总线竞争优先级（`pri:9` 高于多数世界音）[src:pretty:L50504-L50507]。

这套"音乐即状态机混音"的做法比切换完整曲目省内存（五段 loop 远小于多首曲子），且过渡无接缝——增益插值即可。

## 值得抄的细节

1. **规格表驱动**：加一种声音 = 表里加一行 + 写一个 gen 函数，引擎其余部分零改动 [src:pretty:L921-L945]。
2. **确定性变体**：种子 = hash(name)+variant×七千九百一十九，测听可复现 [src:pretty:L921-L945]。
3. **预算化合成**：6ms/批 + 12ms 间隔，启动期不卡 UI [src:pretty:L921-L945]。
4. **抢占式播放**：`max`+`pri` 字段让 3 声爆炸不会叠成 3 倍响度，新音按优先级顶掉旧音 [src:pretty:L921-L945]。
5. **IR 也是资产**：混响的"房间"本身是合成的，室内外切换零加载 [src:pretty:L921-L945]。
