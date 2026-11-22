# 音频与玩法：规格表、总线、调参表、状态机

## 声音规格表

一条记录 = 一个声音：

```js
const VOICES = {
  explosion: { gen: synthExplosion, n: 2, sr: 22050, peak: .97, bus: "world", max: 3, pri: 10, ref: 12, roll: .5 },
  rain:      { gen: synthRain,      n: 1, sr: 22050, peak: .5,  bus: "world", max: 1, loop: 1 },
  ui_click:  { gen: synthClick,     n: 1, sr: 22050, peak: .3,  bus: "dry",   max: 2, pri: 9 },
};
```

- 变体种子 `hash(name)+variant*7919`，确定性。
- 非 loop 音加 0.3ms/12ms 淡入淡出防 click，再按 `peak/max(samples)` 归一化。
- 渐进合成：`boot:1` 立即，其余队列，每批 >6ms 让出，12ms 后继续；未就绪用 ready callback。

## 总线图

```
源 → HRTF Panner(panningModel="HRTF", refDistance=ref) → Gain
   → [world] Convolver(程序化 IR: outdoor/shed) ─┐
   → [dry]   ───────────────────────────────────┼→ Compressor → WaveShaper → 主音量
   → [music] ───────────────────────────────────┘
```

- Compressor：`threshold:-10, knee:6, ratio:6, attack:.002, release:.14`。
- WaveShaper：2049 点软限幅表。
- 音乐五声部（drone/ost/perc/brass/motif）按战斗强度调增益；任务事件音挂 music 总线 `pri:9` 抢占。
- 混合响应也要生成：`ir_outdoor/ir_shed` 是合成 buffer，室内外切换零加载。

## 手感调参表

```js
const TUNE = {
  gravity: 21, jumpApex: 1, coyote: .12, jumpBuffer: .13,
  eyeRate: 11, stride: { walk: 1.55, sprint: 2.1, crouch: 1.05 },
  recoilKeep: .35, recoilApply: 34, recoilRecover: 6.5, recoilHold: .09,
  regenDelay: 4, regenRate: 25, fovSprint: 6, fovAds: 52,
};
```

- 跳跃初速度由高度反推 `sqrt(2*g*h)`；coyote/jumpBuffer 是"跟手"的关键。
- 武器部件也是表：枪口/机瞄高度/镜窗多边形/枪机行程/握把。
- **先写表再写控制器**：调手感不改逻辑代码。

## 输入与状态机

- 三模态（Pointer Lock 键鼠 / 触屏双摇杆 / 手柄）归一到一个 `input` 虚拟层，玩法层零分支。
- 状态切换走单一入口 `M(state)`，广播 `game:state` 并清零计时。
- 任务状态袋跟踪 `cut/allCut/queue/waveHot/alertT/pursuitT/extractHint`；重开一局先全量重置再重建对象。
- `debugCut()` 一键推进任务，是验收捷径。

## UI

- `:root` 17 个语义 token（色板/字体/四向 safe-area/阴影），组件零硬编码色值。
- 分区注释即目录；HUD 按可见性分层（常驻/事件/模态）；血条只在受伤时出现。
- 触屏布局按拇指落点，不缩放键鼠 UI；`touch-action:none`。
- UI DOM 由 JS 模板字符串生成，与游戏状态同源更新。

## 自检

- [ ] 加一种声音 = 加一行表 + 一个 gen 函数
- [ ] 同 seed 两次 buffer checksum 一致
- [ ] 调一个手感参数不需改逻辑
- [ ] 重开一局与首局完全一致
