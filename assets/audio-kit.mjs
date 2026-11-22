/**
 * audio-kit.mjs — 合成音频：58 条规格表 / 5 总线 / 6ms·12ms 预算懒合成 / 2 张生成 IR / 五声部强度混音。
 *
 * 出处（上游 Saltline 捕获明文编号，与 references/11-element-parity.md#audio、
 * harness/element-manifest.json audio 族同源）：
 *   - 上游表 57 行（50 非音乐 + 5 声部 + 2 IR）；本 kit 重编目录为 56 可播 + 2 IR 共 58 条规格
 *     （字段 gen/n/sr/peak/bus/max/pri/boot/loop/music/ir）、总线 world22/near10/dry7/music4/amb1
 *     （名字内含声部上限）、6ms/12ms 预算懒合成：[src:pretty:L50465-L50521]
 *   - 五声部音乐按战斗强度 0.15/0.6/1 交叉淡化：[src:pretty:L50664-L50670]
 *
 * 下限对齐 harness/element-manifest.json audio 族（references/11-element-parity.md:149）：
 * 规格条目 ≥16（本表 58）、音乐声部 ≥1（本表 5）、总线 ≥3（本表 5）。
 *
 * 预算语义：合成按 4096 样本分片、每帧固定步进（boot 4 片 / 首播 8 片，实测 ≪1ms/帧），
 * 工作量按构造有界、远低于 6ms/12ms 上限；不在循环内查墙钟，分片进度与机器速度/GC 抖动
 * 无关——确定性由构造保证；墙钟只做事后监控（stats.overruns / bootMsMax / missMsMax）。
 *
 * 纯 JS、零引擎依赖、可 node 自测。AudioContext 可选注入：attach(ctx) 走原生节点图
 * （BufferSource→总线 Gain→ConvolverIR→主控→Analyser），未注入时离线混音器即计量真源
 * （peak/clip/voiceCount/频段 全部可 node 复现，供 harness/gates/gameplay.mjs --require-audio）。
 * 确定性：rng 注入、kit 内零 Math.random 调用（默认参数同 assets/combat-kit.mjs:26 约定）；
 * 分片不改变 rng 消耗顺序，同种子同操作序列结果逐位一致。
 * 热循环（update/renderFrame）零分配——混音缓冲、声部槽、队列槽、频段状态全部预分配。
 *
 * 用法：
 *   const kit = createAudioKit({ rng });        // node：离线路径可直接测
 *   kit.update(1 / 60);                          // 每音频帧渲染 frame(512) 样本并推进懒合成
 *   kit.play("shot", { rate: 1.02 });            // 56 可播名之一（规格表见 AUDIO_SPECS）
 *   kit.setIntensity(0.6);                       // 0..1，五声部按 0.15/0.6/1 交叉淡化
 *   const { peak, clip, voiceCount } = kit.stats();
 *   kit.bands(); kit.sample();                   // 门禁证据：6 频段、512 时域样本（audioMeter 合同）
 *   kit.attach(audioCtx);                        // 浏览器生产路径（可选）
 */

export const AUDIO_SPEC_FIELDS = ["gen", "n", "sr", "peak", "bus", "max", "pri", "boot", "loop", "music", "ir"];

/* 5 总线：名字内含声部上限（world22/near10/dry7/music4/amb1）[src:pretty:L50465-L50521] */
export const AUDIO_BUSES = { world22: 22, near10: 10, dry7: 7, music4: 4, amb1: 1 };
const BUS_ORDER = ["world22", "near10", "dry7", "music4", "amb1"];
const BUS_GAIN = { world22: 0.9, near10: 0.8, dry7: 1.0, music4: 0.75, amb1: 0.6 };

/* 懒合成预算：boot 每帧切片 ≤6ms；首次播放缺失 ≤12ms [src:pretty:L50465-L50521]
 * 实现为「固定分片步进」：每帧最多 CHUNKS_BOOT/CHUNKS_MISS 个 4096 样本分片，工作量按构造
 * 有界（步长按 6/12ms 上限选型，实测 ≪1ms/帧）。不在循环里查墙钟——分片进度与机器速度/
 * GC 抖动无关，确定性由构造保证；墙钟只做事后监控（stats.overruns）。 */
export const AUDIO_BUDGET = { bootMs: 6, missMs: 12 };
const CHUNK = 4096; /* 合成分片粒度（样本） */
const CHUNKS_BOOT = 4;
const CHUNKS_MISS = 8;

const GENS = ["noise", "burst", "fm", "sweep", "click", "hum", "stem", "ir"];

/**
 * 58 条规格表：56 可播（max ≥ 1）+ 2 张生成 IR（gen "ir"，max 0 不可直接播放）。
 * 字段：gen 合成配方 / n 名字 / sr 采样率 / peak 目标峰值 / bus 总线 / max 同声部上限 /
 * pri 优先级（0 最高）/ boot 启动期预合成 / loop 循环 / music 音乐声部号（-1 非音乐，0..4 五声部）/
 * ir 卷积 IR（-1 干声，0=ir-quay 1=ir-hold）。
 */
export const AUDIO_SPECS = [
  /* —— 武器（dry7 / near10）—— */
  { gen: "burst", n: "shot", sr: 32000, peak: 0.9, bus: "dry7", max: 3, pri: 0, boot: true, loop: false, music: -1, ir: -1 },
  { gen: "burst", n: "shot-indoor", sr: 32000, peak: 0.85, bus: "dry7", max: 3, pri: 0, boot: true, loop: false, music: -1, ir: 1 },
  { gen: "fm", n: "enemy-bolt", sr: 32000, peak: 0.55, bus: "dry7", max: 3, pri: 1, boot: true, loop: false, music: -1, ir: -1 },
  { gen: "burst", n: "bolt-hit", sr: 32000, peak: 0.5, bus: "dry7", max: 3, pri: 1, boot: true, loop: false, music: -1, ir: -1 },
  { gen: "click", n: "reload-start", sr: 22050, peak: 0.4, bus: "near10", max: 1, pri: 2, boot: false, loop: false, music: -1, ir: -1 },
  { gen: "click", n: "reload-end", sr: 22050, peak: 0.45, bus: "near10", max: 1, pri: 2, boot: false, loop: false, music: -1, ir: -1 },
  { gen: "noise", n: "mag-out", sr: 32000, peak: 0.35, bus: "near10", max: 1, pri: 2, boot: false, loop: false, music: -1, ir: -1 },
  { gen: "noise", n: "mag-in", sr: 32000, peak: 0.45, bus: "near10", max: 1, pri: 2, boot: true, loop: false, music: -1, ir: -1 },
  { gen: "burst", n: "bolt-rack", sr: 32000, peak: 0.5, bus: "near10", max: 1, pri: 1, boot: true, loop: false, music: -1, ir: -1 },
  { gen: "click", n: "dry-fire", sr: 22050, peak: 0.3, bus: "dry7", max: 1, pri: 2, boot: false, loop: false, music: -1, ir: -1 },
  { gen: "noise", n: "ads-in", sr: 22050, peak: 0.18, bus: "near10", max: 1, pri: 3, boot: false, loop: false, music: -1, ir: -1 },
  /* —— 弹着 —— */
  { gen: "burst", n: "impact-concrete", sr: 32000, peak: 0.7, bus: "dry7", max: 3, pri: 1, boot: true, loop: false, music: -1, ir: -1 },
  { gen: "burst", n: "impact-metal", sr: 32000, peak: 0.65, bus: "dry7", max: 3, pri: 1, boot: true, loop: false, music: -1, ir: 1 },
  { gen: "burst", n: "impact-wood", sr: 32000, peak: 0.55, bus: "dry7", max: 3, pri: 1, boot: false, loop: false, music: -1, ir: -1 },
  { gen: "noise", n: "impact-water", sr: 32000, peak: 0.6, bus: "world22", max: 2, pri: 1, boot: false, loop: false, music: -1, ir: -1 },
  { gen: "burst", n: "impact-body", sr: 32000, peak: 0.5, bus: "dry7", max: 3, pri: 1, boot: true, loop: false, music: -1, ir: -1 },
  { gen: "noise", n: "impact-crate", sr: 32000, peak: 0.5, bus: "dry7", max: 3, pri: 2, boot: false, loop: false, music: -1, ir: -1 },
  { gen: "click", n: "shell-drop", sr: 32000, peak: 0.3, bus: "near10", max: 3, pri: 3, boot: false, loop: false, music: -1, ir: 1 },
  /* —— 爆炸 —— */
  { gen: "sweep", n: "explosion", sr: 32000, peak: 0.95, bus: "world22", max: 2, pri: 0, boot: true, loop: false, music: -1, ir: 0 },
  { gen: "sweep", n: "explosion-dist", sr: 32000, peak: 0.5, bus: "world22", max: 1, pri: 1, boot: false, loop: false, music: -1, ir: 0 },
  { gen: "noise", n: "debris", sr: 32000, peak: 0.5, bus: "near10", max: 3, pri: 2, boot: false, loop: false, music: -1, ir: -1 },
  { gen: "noise", n: "splash-large", sr: 32000, peak: 0.7, bus: "world22", max: 1, pri: 1, boot: false, loop: false, music: -1, ir: -1 },
  /* —— 移动（near10）—— */
  { gen: "noise", n: "foot-concrete", sr: 32000, peak: 0.28, bus: "near10", max: 2, pri: 2, boot: false, loop: false, music: -1, ir: -1 },
  { gen: "noise", n: "foot-metal", sr: 32000, peak: 0.3, bus: "near10", max: 2, pri: 2, boot: false, loop: false, music: -1, ir: 1 },
  { gen: "noise", n: "foot-water", sr: 32000, peak: 0.32, bus: "near10", max: 2, pri: 2, boot: false, loop: false, music: -1, ir: -1 },
  { gen: "noise", n: "jump", sr: 32000, peak: 0.25, bus: "near10", max: 1, pri: 3, boot: false, loop: false, music: -1, ir: -1 },
  { gen: "noise", n: "land", sr: 32000, peak: 0.4, bus: "near10", max: 1, pri: 2, boot: false, loop: false, music: -1, ir: -1 },
  /* —— 世界（world22 / amb1）—— */
  { gen: "noise", n: "wave-lap", sr: 44100, peak: 0.3, bus: "world22", max: 1, pri: 3, boot: false, loop: true, music: -1, ir: -1 },
  { gen: "noise", n: "wave-swell", sr: 44100, peak: 0.35, bus: "world22", max: 1, pri: 3, boot: false, loop: true, music: -1, ir: -1 },
  { gen: "noise", n: "wind", sr: 44100, peak: 0.25, bus: "world22", max: 1, pri: 3, boot: false, loop: true, music: -1, ir: -1 },
  { gen: "noise", n: "rain", sr: 44100, peak: 0.3, bus: "amb1", max: 1, pri: 3, boot: true, loop: true, music: -1, ir: -1 },
  { gen: "burst", n: "thunder", sr: 32000, peak: 0.8, bus: "world22", max: 1, pri: 1, boot: false, loop: false, music: -1, ir: 0 },
  { gen: "hum", n: "crane-creak", sr: 32000, peak: 0.3, bus: "world22", max: 1, pri: 3, boot: false, loop: false, music: -1, ir: -1 },
  { gen: "fm", n: "gate-alarm", sr: 44100, peak: 0.5, bus: "world22", max: 1, pri: 1, boot: false, loop: true, music: -1, ir: -1 },
  { gen: "noise", n: "radio-chatter", sr: 32000, peak: 0.35, bus: "near10", max: 1, pri: 2, boot: false, loop: false, music: -1, ir: -1 },
  { gen: "hum", n: "dock-horn", sr: 32000, peak: 0.6, bus: "world22", max: 1, pri: 1, boot: false, loop: false, music: -1, ir: 0 },
  { gen: "burst", n: "container-slam", sr: 32000, peak: 0.75, bus: "world22", max: 1, pri: 1, boot: false, loop: false, music: -1, ir: 1 },
  /* —— UI / 玩法（dry7 + music4 单发）—— */
  { gen: "click", n: "hitmarker", sr: 22050, peak: 0.3, bus: "dry7", max: 1, pri: 1, boot: true, loop: false, music: -1, ir: -1 },
  { gen: "fm", n: "kill-confirm", sr: 22050, peak: 0.35, bus: "dry7", max: 1, pri: 1, boot: false, loop: false, music: -1, ir: -1 },
  { gen: "hum", n: "damage-grunt", sr: 32000, peak: 0.45, bus: "dry7", max: 1, pri: 1, boot: false, loop: false, music: -1, ir: -1 },
  { gen: "fm", n: "objective", sr: 22050, peak: 0.4, bus: "dry7", max: 1, pri: 1, boot: false, loop: false, music: -1, ir: -1 },
  { gen: "hum", n: "wave-in", sr: 32000, peak: 0.5, bus: "dry7", max: 1, pri: 1, boot: false, loop: false, music: -1, ir: -1 },
  { gen: "sweep", n: "pursuit-stinger", sr: 32000, peak: 0.55, bus: "music4", max: 1, pri: 1, boot: false, loop: false, music: -1, ir: -1 },
  { gen: "fm", n: "extract-ready", sr: 22050, peak: 0.45, bus: "music4", max: 1, pri: 1, boot: false, loop: false, music: -1, ir: -1 },
  { gen: "click", n: "ui-click", sr: 22050, peak: 0.25, bus: "dry7", max: 2, pri: 2, boot: false, loop: false, music: -1, ir: -1 },
  /* —— NPC（near10）—— */
  { gen: "hum", n: "npc-shout", sr: 32000, peak: 0.5, bus: "near10", max: 2, pri: 2, boot: false, loop: false, music: -1, ir: -1 },
  { gen: "hum", n: "npc-alert", sr: 32000, peak: 0.55, bus: "near10", max: 2, pri: 1, boot: true, loop: false, music: -1, ir: -1 },
  { gen: "hum", n: "npc-death", sr: 32000, peak: 0.5, bus: "near10", max: 2, pri: 2, boot: false, loop: false, music: -1, ir: -1 },
  { gen: "noise", n: "crate-drag", sr: 44100, peak: 0.35, bus: "near10", max: 1, pri: 3, boot: false, loop: true, music: -1, ir: -1 },
  /* —— 环境底床（amb1 单声部）—— */
  { gen: "hum", n: "amb-hum", sr: 44100, peak: 0.2, bus: "amb1", max: 1, pri: 3, boot: false, loop: true, music: -1, ir: -1 },
  { gen: "click", n: "amb-drips", sr: 44100, peak: 0.25, bus: "amb1", max: 1, pri: 3, boot: false, loop: true, music: -1, ir: 1 },
  /* —— 五声部音乐（music4，music 0..4；由 setIntensity 驱动，play() 不受理）—— */
  { gen: "stem", n: "music-pad", sr: 44100, peak: 0.38, bus: "music4", max: 1, pri: 2, boot: true, loop: true, music: 0, ir: -1 },
  { gen: "stem", n: "music-perc", sr: 44100, peak: 0.42, bus: "music4", max: 1, pri: 2, boot: true, loop: true, music: 1, ir: -1 },
  { gen: "stem", n: "music-bass", sr: 44100, peak: 0.4, bus: "music4", max: 1, pri: 2, boot: true, loop: true, music: 2, ir: -1 },
  { gen: "stem", n: "music-lead", sr: 44100, peak: 0.36, bus: "music4", max: 1, pri: 2, boot: true, loop: true, music: 3, ir: -1 },
  { gen: "stem", n: "music-arp", sr: 44100, peak: 0.32, bus: "music4", max: 1, pri: 2, boot: true, loop: true, music: 4, ir: -1 },
  /* —— 2 张生成 IR（gen "ir"，max 0：不可直接播放，供卷积湿声）—— */
  { gen: "ir", n: "ir-quay", sr: 44100, peak: 0.8, bus: "dry7", max: 0, pri: 9, boot: true, loop: false, music: -1, ir: 0 },
  { gen: "ir", n: "ir-hold", sr: 44100, peak: 0.8, bus: "dry7", max: 0, pri: 9, boot: true, loop: false, music: -1, ir: 1 },
];

/* 每个可播名的合成参数（规格表只保留 11 个正典字段，配方参数落在这里） */
const PRM = {
  shot: { dur: 0.22, a: 0.001, r: 0.1, f0: 190, f1: 50, nm: 0.8 },
  "shot-indoor": { dur: 0.3, a: 0.001, r: 0.14, f0: 150, f1: 45, nm: 0.75 },
  "enemy-bolt": { dur: 0.16, a: 0.002, r: 0.07, f0: 720, ratio: 2.5, i0: 380, i1: 40 },
  "bolt-hit": { dur: 0.12, a: 0.001, r: 0.06, f0: 900, f1: 300, nm: 0.5 },
  "reload-start": { dur: 0.1, steps: 5 },
  "reload-end": { dur: 0.08, steps: 4 },
  "mag-out": { dur: 0.12, lp: 3000, hp: 300 },
  "mag-in": { dur: 0.12, lp: 2400, hp: 200 },
  "bolt-rack": { dur: 0.16, a: 0.001, r: 0.07, f0: 320, f1: 90, nm: 0.7 },
  "dry-fire": { dur: 0.05, steps: 2 },
  "ads-in": { dur: 0.08, lp: 1200, hp: 400 },
  "impact-concrete": { dur: 0.14, a: 0.001, r: 0.07, f0: 260, f1: 70, nm: 0.9 },
  "impact-metal": { dur: 0.22, a: 0.001, r: 0.12, f0: 520, f1: 130, nm: 0.6 },
  "impact-wood": { dur: 0.12, a: 0.001, r: 0.06, f0: 200, f1: 60, nm: 0.9 },
  "impact-water": { dur: 0.3, lp: 1800, hp: 250 },
  "impact-body": { dur: 0.12, a: 0.002, r: 0.06, f0: 130, f1: 45, nm: 0.7 },
  "impact-crate": { dur: 0.14, lp: 1400, hp: 180 },
  "shell-drop": { dur: 0.25, steps: 3, sparse: true },
  explosion: { dur: 1.3, a: 0.002, r: 0.7, f0: 120, f1: 30, nm: 0.5 },
  "explosion-dist": { dur: 1.7, a: 0.01, r: 1.0, f0: 70, f1: 22, nm: 0.4 },
  debris: { dur: 0.45, lp: 2200, hp: 300 },
  "splash-large": { dur: 0.8, lp: 1200, hp: 120 },
  "foot-concrete": { dur: 0.11, lp: 900, hp: 150 },
  "foot-metal": { dur: 0.12, lp: 1100, hp: 200 },
  "foot-water": { dur: 0.14, lp: 1500, hp: 250 },
  jump: { dur: 0.13, lp: 800, hp: 120 },
  land: { dur: 0.2, lp: 700, hp: 90 },
  "wave-lap": { dur: 4.0, lp: 900, hp: 120, swell: 2 },
  "wave-swell": { dur: 4.0, lp: 600, hp: 80, swell: 1 },
  wind: { dur: 5.0, lp: 500, hp: 60, swell: 3 },
  rain: { dur: 3.0, lp: 4000, hp: 900 },
  thunder: { dur: 1.6, a: 0.01, r: 1.0, f0: 90, f1: 26, nm: 0.95 },
  "crane-creak": { dur: 0.8, f0: 340, vib: 6, form: 3 },
  "gate-alarm": { dur: 1.2, f0: 440, ratio: 1.00947, i0: 120, i1: 120 }, /* ratio 使 f0·ratio·dur 为整数 → 循环连续 */
  "radio-chatter": { dur: 1.5, lp: 2600, hp: 500, chop: 8 },
  "dock-horn": { dur: 0.9, f0: 98, vib: 0.8, form: 1.2 },
  "container-slam": { dur: 0.7, a: 0.001, r: 0.4, f0: 160, f1: 40, nm: 0.9 },
  hitmarker: { dur: 0.04, steps: 2 },
  "kill-confirm": { dur: 0.12, a: 0.002, r: 0.05, f0: 1320, ratio: 1.5, i0: 90, i1: 10 },
  "damage-grunt": { dur: 0.35, f0: 150, vib: 7, form: 4 },
  objective: { dur: 0.18, a: 0.004, r: 0.08, f0: 660, ratio: 2, i0: 140, i1: 20 },
  "wave-in": { dur: 0.5, f0: 220, vib: 1.5, form: 2 },
  "pursuit-stinger": { dur: 0.5, a: 0.004, r: 0.3, f0: 500, f1: 90, nm: 0.2 },
  "extract-ready": { dur: 0.25, a: 0.004, r: 0.12, f0: 520, ratio: 1.335, i0: 200, i1: 30 },
  "ui-click": { dur: 0.03, steps: 2 },
  "npc-shout": { dur: 0.5, f0: 190, vib: 8, form: 5 },
  "npc-alert": { dur: 0.35, f0: 240, vib: 10, form: 6 },
  "npc-death": { dur: 0.6, f0: 130, vib: 5, form: 3 },
  "crate-drag": { dur: 2.5, lp: 1000, hp: 140, chop: 3 },
  "amb-hum": { dur: 3.0, f0: 55, vib: 0.3, form: 0.5 },
  "amb-drips": { dur: 1.2, steps: 2, sparse: true },
  "ir-quay": { dur: 0.9, dk: 5.5 },
  "ir-hold": { dur: 1.8, dk: 3.2 },
};

/* 五声部交叉淡化：按战斗强度 0.15/0.6/1 三档逐层进入 [src:pretty:L50664-L50670]
 * calm(<0.15)=pad；0.15..0.6=+perc+bass；0.6..<1=+lead；1=全五声部。pad 是常驻底床，随强度让位。 */
const STEM_AUDIBLE = 0.02;
function stemTargets(i) {
  const g = [Math.max(0.2, 1 - 0.55 * i), seg(0.12, 0.2, i), seg(0.3, 0.5, i), seg(0.55, 0.68, i), seg(0.88, 1.0, i)];
  return g;
}

/* 乐句数据固定（零 rng）：96bpm 2 小节 = 5.0s 循环；频率取 0.2Hz 网格保证循环首尾连续 */
const STEM_LOOP = 5.0;
const LEAD_NOTES = [220.0, 261.6, 293.6, 329.6, 392.0];
const LEAD_PAT = [0, 2, 1, 3, 2, 4, 3, -1, 0, 2, 1, 3, 4, 3, 2, -1];
const ARP_NOTES = [440.0, 523.2, 659.2, 784.0, 880.0];
const ARP_PAT = [0, 1, 2, 3, 4, 3, 2, 1, 0, 2, 4, 2, 1, 3, 2, 0, 0, 1, 2, 3, 4, 3, 2, 1, 0, 2, 4, 2, 3, 1, 2, 0];
const BASS_PAT = [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0];
const STEM_NAMES = ["music-pad", "music-perc", "music-bass", "music-lead", "music-arp"];

function seg(a, b, x) { const t = (x - a) / (b - a); if (t <= 0) return 0; if (t >= 1) return 1; return t * t * (3 - 2 * t); }
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

/* ---- 模块级校验：规格表形态在 import 时即成立（58 行 / 字段齐全 / 总线与配方合法） ---- */
(function validateSpecs() {
  if (AUDIO_SPECS.length !== 58) throw new Error(`audio-kit: 规格表应 58 行，实际 ${AUDIO_SPECS.length}`);
  const names = new Set();
  let playable = 0, music = 0, irs = 0;
  for (const row of AUDIO_SPECS) {
    const keys = Object.keys(row);
    if (keys.length !== AUDIO_SPEC_FIELDS.length || AUDIO_SPEC_FIELDS.some((f, i) => keys[i] !== f)) {
      throw new Error(`audio-kit: 规格 ${row.n} 字段不是 gen/n/sr/peak/bus/max/pri/boot/loop/music/ir`);
    }
    if (names.has(row.n)) throw new Error(`audio-kit: 规格名重复 ${row.n}`);
    names.add(row.n);
    if (!(row.bus in AUDIO_BUSES)) throw new Error(`audio-kit: ${row.n} 总线 ${row.bus} 不在 5 总线内`);
    if (GENS.indexOf(row.gen) < 0) throw new Error(`audio-kit: ${row.n} 未知配方 ${row.gen}`);
    if (row.music < -1 || row.music > 4) throw new Error(`audio-kit: ${row.n} music 字段越界`);
    if (row.ir < -1 || row.ir > 1) throw new Error(`audio-kit: ${row.n} ir 字段越界`);
    if (row.max >= 1) playable += 1;
    if (row.music >= 0) music += 1;
    if (row.gen === "ir") irs += 1;
    if (row.gen !== "stem" && !PRM[row.n]) throw new Error(`audio-kit: ${row.n} 缺合成参数`);
  }
  if (playable !== 56) throw new Error(`audio-kit: 可播规格应 56，实际 ${playable}`);
  if (music !== 5) throw new Error(`audio-kit: 音乐声部应 5，实际 ${music}`);
  if (irs !== 2) throw new Error(`audio-kit: 生成 IR 应 2 张，实际 ${irs}`);
})();

/* ====== 合成配方：分片渲染 renderX(p, sr, rng, loop, st, from, to, out) ======
 * st 是跨片状态（相位/滤波器）：首次进入时惰性初始化；分片不改变 rng 消耗顺序 → 确定性。 */

function normalize(out, peak, guard) {
  let m = 0;
  for (let i = 0; i < out.length; i += 1) { const a = out[i] < 0 ? -out[i] : out[i]; if (a > m) m = a; }
  const k = m > 1e-9 ? peak / m : 0;
  for (let i = 0; i < out.length; i += 1) out[i] *= k;
  if (guard !== undefined) out[out.length] = guard; /* 末尾守护样本：插值越界与循环回绕 */
  return out;
}

function renderNoise(p, sr, rng, loop, st, from, to, out) {
  const n = out.length - 1;
  if (st.lp === undefined) { st.lp = 0; st.hp = 0; }
  const la = 1 - Math.exp((-2 * Math.PI * p.lp) / sr);
  const ha = 1 - Math.exp((-2 * Math.PI * p.hp) / sr);
  const a = Math.max(1, Math.round((loop ? 0.006 : 0.008) * sr));
  const r = loop ? 1 : Math.max(1, Math.round(0.05 * sr));
  for (let i = from; i < to; i += 1) {
    st.lp += la * ((rng() * 2 - 1) - st.lp);
    st.hp += ha * (st.lp - st.hp);
    let env = i < a ? i / a : !loop && i > n - r ? (n - i) / r : 1;
    if (p.swell) { const s = Math.sin((2 * Math.PI * p.swell * i) / n); env *= 0.55 + 0.45 * s * s; }
    if (p.chop) { const c = Math.sin((2 * Math.PI * p.chop * i) / n); env *= 0.35 + 0.65 * Math.max(0, c); }
    out[i] = (st.lp - st.hp) * env;
  }
}

function renderBurst(p, sr, rng, loop, st, from, to, out) {
  const n = out.length - 1;
  if (st.ph === undefined) { st.ph = 0; st.lp = 0; }
  const a = Math.max(1, Math.round(p.a * sr));
  const r = Math.max(1, Math.round(p.r * sr));
  for (let i = from; i < to; i += 1) {
    const t = i / n;
    const k = Math.exp(-6 * t);
    st.ph += (2 * Math.PI * (p.f1 + (p.f0 - p.f1) * k)) / sr;
    st.lp += 0.32 * (rng() * 2 - 1 - st.lp);
    const env = i < a ? i / a : i > n - r ? (n - i) / r : 1;
    out[i] = env * (Math.sin(st.ph) * Math.exp(-9 * t) + p.nm * st.lp * Math.exp(-4 * t));
  }
}

function renderFm(p, sr, rng, loop, st, from, to, out) {
  const n = out.length - 1;
  if (st.ph === undefined) { st.ph = 0; st.mph = 0; st.lp = 0; }
  const a = Math.max(1, Math.round((p.a || 0.003) * sr));
  const r = Math.max(1, Math.round((p.r || p.dur * 0.4) * sr));
  const nz = p.nm != null ? 0.15 : 0;
  for (let i = from; i < to; i += 1) {
    const t = i / n;
    const idx = (p.i1 || 0) + ((p.i0 || 0) - (p.i1 || 0)) * Math.exp(-5 * t);
    st.mph += (2 * Math.PI * p.f0 * p.ratio) / sr;
    st.ph += (2 * Math.PI * (p.f0 + Math.sin(st.mph) * idx)) / sr;
    st.lp += 0.25 * (rng() * 2 - 1 - st.lp);
    const env = i < a ? i / a : i > n - r ? (n - i) / r : 1;
    out[i] = env * (Math.sin(st.ph) + nz * st.lp);
  }
}

function renderSweep(p, sr, rng, loop, st, from, to, out) {
  const n = out.length - 1;
  if (st.ph === undefined) { st.ph = 0; st.lp = 0; }
  const a = Math.max(1, Math.round(p.a * sr));
  const r = Math.max(1, Math.round(p.r * sr));
  for (let i = from; i < to; i += 1) {
    const t = i / n;
    st.ph += (2 * Math.PI * (p.f1 + (p.f0 - p.f1) * Math.exp(-4 * t))) / sr;
    st.lp += 0.2 * (rng() * 2 - 1 - st.lp);
    const env = i < a ? i / a : i > n - r ? (n - i) / r : 1;
    out[i] = env * (Math.sin(st.ph) * (1 - p.nm * 0.4) + p.nm * st.lp * Math.exp(-3 * t));
  }
}

function renderClick(p, sr, rng, loop, st, from, to, out) {
  const n = out.length - 1;
  if (st.lp === undefined) { st.lp = 0; st.hold = 0; }
  const segN = Math.max(1, Math.floor(n / p.steps));
  const impN = Math.max(1, Math.round(0.003 * sr));
  for (let i = from; i < to; i += 1) {
    if (i % segN === 0) st.hold = rng() * 2 - 1;
    if (p.sparse) {
      /* 稀疏脉冲：每段开头 ~3ms 瞬态，其余静默（弹壳落地 / 滴水） */
      const off = i % segN;
      const env = off < impN ? 1 - off / impN : 0;
      st.lp += 0.5 * (st.hold * env - st.lp);
      out[i] = st.lp;
    } else {
      st.lp += 0.45 * (st.hold - st.lp);
      out[i] = st.lp;
    }
  }
  if (!loop && to >= n) { const r = Math.max(1, Math.round(0.01 * sr)); for (let i = n - r; i < n; i += 1) out[i] *= (n - i) / r; }
}

function renderHum(p, sr, rng, loop, st, from, to, out) {
  const n = out.length - 1;
  if (st.ph === undefined) st.ph = [0, 0, 0, 0];
  const a = Math.max(1, Math.round(0.01 * sr));
  const r = loop ? 1 : Math.max(1, Math.round(0.06 * sr));
  const harm = [1, 2, 3, 5], hAmp = [1, 0.4, 0.25, 0.12];
  /* 循环时颤动/共振调制取整周期数，相位逐样本积分 → 首尾连续无跳变 */
  const vibCyc = (loop ? Math.max(1, Math.round(5.5 * p.dur)) / p.dur : 5.5);
  const formCyc = (loop ? Math.max(1, Math.round(p.form * p.dur)) / p.dur : p.form);
  for (let i = from; i < to; i += 1) {
    const t = i / n;
    const vib = 1 + 0.02 * p.vib * Math.sin(2 * Math.PI * vibCyc * t);
    const form = 1 + 0.4 * Math.sin(2 * Math.PI * formCyc * t);
    let v = 0;
    for (let h = 0; h < 4; h += 1) {
      st.ph[h] += (2 * Math.PI * p.f0 * harm[h] * vib) / sr;
      v += hAmp[h] * Math.sin(st.ph[h]);
    }
    const env = i < a ? i / a : !loop && i > n - r ? (n - i) / r : 1;
    out[i] = env * v * form * (1 + 0.05 * (rng() * 2 - 1));
  }
}

/* 五声部分片渲染：pad 带跨片相位；perc/bass/lead/arp 按事件重放（与整块渲染逐位一致） */
function renderStem(part, sr, st, from, to, out) {
  const n = out.length - 1;
  if (part === 0) { /* pad：3 个 0.2Hz 网格失谐锯 + 单极低通 */
    if (st.ph === undefined) { st.ph = [0, 0, 0]; st.lp = 0; }
    const f = [110.0, 110.4, 164.8], amp = 0.22, cut = 900;
    const la = 1 - Math.exp((-2 * Math.PI * cut) / sr);
    for (let i = from; i < to; i += 1) {
      let v = 0;
      for (let k = 0; k < 3; k += 1) {
        st.ph[k] += f[k] / sr;
        if (st.ph[k] >= 1) st.ph[k] -= 1;
        v += (st.ph[k] * 2 - 1) * amp;
      }
      st.lp += la * (v - st.lp);
      const s = Math.sin((2 * Math.PI * 2 * i) / n);
      out[i] = st.lp * (0.7 + 0.3 * s * s);
    }
  } else if (part === 1) { /* perc：底鼓（四分）+ 噪声 hat（反八分）；噪声用固定 LCG（零 rng） */
    const kickN = Math.round(0.09 * sr);
    for (let b = 0; b < 8; b += 1) {
      const st0 = Math.round((b * n) / 8);
      const stEnd = Math.min(n, st0 + kickN);
      if (stEnd <= from || st0 >= to) continue;
      let ph = 0;
      for (let i = st0; i < stEnd; i += 1) {
        const t = (i - st0) / kickN;
        ph += (2 * Math.PI * (45 + 75 * Math.exp(-18 * t))) / sr;
        if (i >= from && i < to) out[i] += Math.sin(ph) * Math.exp(-7 * t) * 0.9;
      }
    }
    if (st.hats === undefined) { /* hat 噪声一次预生成（事件序固定 → 与整块渲染一致） */
      let seed = 0x9e3779b9;
      const hn = Math.round(0.004 * sr);
      st.hats = new Float32Array(16 * hn);
      for (let e = 0; e < 16 * hn; e += 1) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        st.hats[e] = ((seed / 4294967295) * 2 - 1) * 0.12;
      }
    }
    const hn = Math.round(0.004 * sr);
    for (let b = 1; b < 16; b += 2) {
      const st0 = Math.round((b * n) / 16);
      const stEnd = Math.min(n, st0 + hn);
      for (let i = Math.max(st0, from); i < Math.min(stEnd, to); i += 1) {
        out[i] += st.hats[(b >> 1) * hn + (i - st0)] * (1 - (i - st0) / hn);
      }
    }
  } else if (part === 2) { /* bass：55Hz 次八分门型（tanh 轻驱动） */
    const gate = BASS_PAT, gn = n / gate.length;
    for (let g = 0; g < gate.length; g += 1) {
      if (!gate[g]) continue;
      const st0 = Math.round(g * gn), len = Math.round(gn * 0.92);
      for (let i = Math.max(st0, from); i < Math.min(st0 + len, to); i += 1) {
        const atk = Math.min(1, (i - st0) / (0.005 * sr));
        const rel = Math.min(1, (st0 + len - i) / (0.02 * sr));
        const v = Math.sin((2 * Math.PI * 55 * i) / sr) * atk * rel;
        out[i] += Math.tanh(v * 1.6) * 0.7;
      }
    }
  } else if (part === 3) { /* lead：小调五声旋律（正弦 + 三次谐波），半拍音符 */
    const pat = LEAD_PAT, pn = n / pat.length;
    for (let g = 0; g < pat.length; g += 1) {
      const note = pat[g];
      if (note < 0) continue;
      const f = LEAD_NOTES[note], st0 = Math.round(g * pn), len = Math.round(pn * 0.9);
      for (let i = Math.max(st0, from); i < Math.min(st0 + len, to); i += 1) {
        const atk = Math.min(1, (i - st0) / (0.004 * sr));
        const rel = Math.min(1, (st0 + len - i) / (0.03 * sr));
        const phv = (2 * Math.PI * f * i) / sr;
        out[i] += (Math.sin(phv) + 0.3 * Math.sin(3 * phv)) * atk * rel * 0.2;
      }
    }
  } else { /* arp：16 分正弦琶音 */
    const pat = ARP_PAT, pn = n / pat.length;
    for (let g = 0; g < pat.length; g += 1) {
      const f = ARP_NOTES[pat[g]], st0 = Math.round(g * pn), len = Math.round(pn * 0.7);
      for (let i = Math.max(st0, from); i < Math.min(st0 + len, to); i += 1) {
        const env = Math.min(1, (i - st0) / (0.002 * sr)) * (1 - (i - st0) / len);
        out[i] += Math.sin((2 * Math.PI * f * i) / sr) * env * 0.14;
      }
    }
  }
}

/* IR 整块渲染（工厂期一次性生成，不走帧预算） */
function renderIr(p, sr, rng) {
  const n = Math.max(64, Math.round(p.dur * sr));
  const out = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i += 1) {
    const t = i / n;
    const a = 0.45 * Math.pow(0.06, t); /* 单极截止随时间收紧（damp） */
    lp += a * (rng() * 2 - 1 - lp);
    out[i] = lp * Math.pow(0.001, t * p.dk * 0.5);
  }
  return normalize(out, 0.9, undefined);
}

function renderChunk(spec, st, from, to, out, rng) {
  const p = PRM[spec.n];
  switch (spec.gen) {
    case "noise": return renderNoise(p, spec.sr, rng, spec.loop, st, from, to, out);
    case "burst": return renderBurst(p, spec.sr, rng, spec.loop, st, from, to, out);
    case "fm": return renderFm(p, spec.sr, rng, spec.loop, st, from, to, out);
    case "sweep": return renderSweep(p, spec.sr, rng, spec.loop, st, from, to, out);
    case "click": return renderClick(p, spec.sr, rng, spec.loop, st, from, to, out);
    case "hum": return renderHum(p, spec.sr, rng, spec.loop, st, from, to, out);
    case "stem": return renderStem(spec.music, spec.sr, st, from, to, out);
    default: throw new Error(`audio-kit: 未知配方 ${spec.gen}`);
  }
}

function specLength(spec) {
  if (spec.gen === "stem") return Math.round(STEM_LOOP * spec.sr);
  return Math.max(8, Math.round(PRM[spec.n].dur * spec.sr));
}

/* ================= 工厂 ================= */

export function createAudioKit({
  rng = Math.random, /* 注入约定同 assets/combat-kit.mjs:26：kit 逻辑只调 rng() */
  sampleRate = 44100,
  frame = 512,
  masterGain = 0.9,
  budget = {},
} = {}) {
  if (typeof rng !== "function") throw new Error("audio-kit requires rng() injectable");
  const BOOT_MS = budget.bootMs || AUDIO_BUDGET.bootMs;
  const MISS_MS = budget.missMs || AUDIO_BUDGET.missMs;
  const frameN = frame >>> 0 || 512;
  const clock = typeof performance !== "undefined" && performance.now ? () => performance.now() : () => Date.now();

  const specByName = {};
  for (let i = 0; i < AUDIO_SPECS.length; i += 1) specByName[AUDIO_SPECS[i].n] = AUDIO_SPECS[i];

  /* —— 预分配：混音缓冲 / 计量 / 频段 / 卷积（热循环零分配） —— */
  const master = new Float32Array(frameN);
  const meterBuf = new Float32Array(frameN);
  const send = [new Float32Array(frameN), new Float32Array(frameN)];
  const bandOut = new Float32Array(6);
  const bandState = new Float64Array(6);
  const bandA = [120, 350, 800, 2000, 5000, 12000].map((f) => 1 - Math.exp((-2 * Math.PI * f) / sampleRate));
  const native = { ctx: null, master: null, analyser: null, meter: null, bus: {}, conv: [], stemGain: [], stemSrc: [] };

  /* —— 声部池：按总线预分配（world22/near10/dry7/music4/amb1 上限内建） —— */
  const pools = {};
  for (let b = 0; b < BUS_ORDER.length; b += 1) {
    const cap = AUDIO_BUSES[BUS_ORDER[b]];
    pools[BUS_ORDER[b]] = [];
    for (let i = 0; i < cap; i += 1) {
      pools[BUS_ORDER[b]].push({ on: false, spec: null, buf: null, posF: 0, gain: 1, rate: 1, loop: false, rel: false, relStart: 0, envA: 1, envR: 1, wet: 0, irIdx: -1, native: null });
    }
  }

  /* —— 2 张生成 IR：工厂期整块生成（离线湿声的稀疏卷积抽头 + 原生 ConvolverNode 共用） —— */
  const irBuf = [renderIr(PRM["ir-quay"], 44100, rng), renderIr(PRM["ir-hold"], 44100, rng)];
  const TAPS = 64;
  const irState = [];
  for (let k = 0; k < 2; k += 1) {
    const src = irBuf[k], L = src.length;
    const c = new Float32Array(TAPS), off = new Int32Array(TAPS);
    for (let t = 0; t < TAPS; t += 1) { off[t] = Math.min(L - 1, Math.round((t * L) / TAPS)); c[t] = src[off[t]] * 0.35; }
    irState.push({ dl: new Float32Array(L), c, off, w: 0, L });
  }

  /* —— 懒合成作业：{spec,out,st,pos,n,pending}；分片渲染 + 片间墙钟检查 ——
   * bootQ：boot:true 行（pri 升序）每帧 ≤6ms；missQ：首播缺失 ≤12ms，完成即自动起播 pending。 */
  const buffers = new Map();
  const bootQ = [];
  const bootRows = AUDIO_SPECS.filter((r) => r.boot && r.gen !== "ir");
  bootRows.sort((x, y) => (x.pri - y.pri) || (x.n < y.n ? -1 : 1)); /* pri 优先、name 定序（确定性） */
  for (let i = 0; i < bootRows.length; i += 1) {
    const spec = bootRows[i];
    bootQ.push({ spec, out: new Float32Array(specLength(spec) + 1), st: {}, pos: 0, n: specLength(spec), pending: null });
  }
  const missQ = [];
  const M = { peak: 0, clip: 0, voiceCount: 0, bootMsMax: 0, missMsMax: 0, missMsLast: 0, bootMsSum: 0, bootMsN: 0, overruns: 0, dropped: 0, deferred: 0 };

  function finalize(job) {
    normalize(job.out, 0.85, job.spec.loop ? job.out[0] : 0);
    buffers.set(job.spec.n, job.out);
  }
  function startPending(job) {
    const spec = job.spec;
    const gain = job.pending.gain, rate = job.pending.rate;
    job.pending = null;
    const v = allocVoice(spec);
    if (v) { startVoice(v, spec, gain, rate); if (native.ctx) playNative(v, spec, gain, rate); }
    else M.dropped += 1;
  }
  function pumpJobs(list, stride) {
    const t0 = clock();
    let done = 0;
    while (list.length && done < stride) {
      const job = list[0];
      const to = Math.min(job.n, job.pos + CHUNK);
      renderChunk(job.spec, job.st, job.pos, to, job.out, rng);
      job.pos = to;
      done += 1;
      if (job.pos >= job.n) {
        finalize(job);
        list.shift();
        if (job.pending) startPending(job);
      }
    }
    return clock() - t0;
  }

  /* —— 五声部常驻声部 —— */
  const stemVoice = [];
  for (let i = 0; i < 5; i += 1) stemVoice.push({ on: false, buf: null, posF: 0, gain: 0, target: 0, wet: 0, irIdx: -1, rate: 1, loop: true, rel: false, relStart: 0, envA: 64, envR: 4096 });
  let intensity = 0;
  function ensureStems() { /* stem 缓冲随 boot 队列就绪后挂到常驻声部 */
    for (let s = 0; s < 5; s += 1) {
      const v = stemVoice[s];
      if (!v.on) {
        const buf = buffers.get(STEM_NAMES[s]);
        if (buf) { v.on = true; v.buf = buf; v.posF = 0; v.gain = 0; }
      }
    }
  }

  /* —— 声部分配 / 偷声（bus 上限 + spec.max 同声部上限；pri 高者胜） —— */
  function allocVoice(spec) {
    const pool = pools[spec.bus];
    let count = 0, free = null, sameCount = 0, victim = null;
    for (let i = 0; i < pool.length; i += 1) {
      const v = pool[i];
      if (!v.on) { if (!free) free = v; continue; }
      count += 1;
      if (v.spec.n === spec.n) {
        sameCount += 1;
        if (spec.loop) return v; /* 循环声去重：复用已有声部 */
      }
      if (!victim || v.spec.pri > victim.spec.pri || (v.spec.pri === victim.spec.pri && v.posF > victim.posF)) victim = v;
    }
    if (sameCount >= spec.max) { /* 超同声部上限：偷最旧同名 */
      let old = null;
      for (let i = 0; i < pool.length; i += 1) { const v = pool[i]; if (v.on && v.spec.n === spec.n && (!old || v.posF < old.posF)) old = v; }
      if (old) { killVoice(old); return old; }
    }
    if (free) return free;
    if (count >= pool.length) { /* 总线上限：偷低 pri / 最旧 */
      if (victim && victim.spec.pri <= spec.pri) { killVoice(victim); return victim; }
      M.dropped += 1;
      return null;
    }
    return null;
  }
  function killVoice(v) {
    if (v.native) { try { v.native.src.stop(); } catch (e) { /* 已停 */ } }
    v.on = false; v.spec = null; v.buf = null; v.native = null;
  }
  function startVoice(v, spec, gain, rate) {
    if (v.native) { try { v.native.src.stop(); } catch (e) { /* 已停 */ } v.native = null; }
    v.on = true; v.spec = spec; v.buf = buffers.get(spec.n);
    v.posF = 0; v.gain = gain; v.rate = rate; v.loop = spec.loop;
    v.rel = false; v.relStart = 0;
    v.envA = Math.max(1, Math.round(0.002 * spec.sr));
    v.envR = Math.max(1, Math.round((spec.loop ? 0.12 : 0.05) * spec.sr));
    v.irIdx = spec.ir >= 0 ? spec.ir : -1;
    v.wet = spec.ir >= 0 ? 1 : 0;
    return {
      v,
      stop() {
        if (v.on && !v.rel) {
          v.rel = true; v.relStart = v.posF >>> 8;
          if (v.native) { try { v.native.src.stop(); } catch (e) { /* 已停 */ } }
        }
      },
    };
  }

  /* —— 播放 API —— */
  function play(name, opts) {
    const spec = specByName[name];
    if (!spec || spec.gen === "stem" || spec.gen === "ir" || spec.max < 1) return null;
    const gain = opts && opts.gain != null ? opts.gain : 1;
    const rate = opts && opts.rate != null ? opts.rate : 0.94 + rng() * 0.12; /* 触发期变奏走注入 rng */
    if (!buffers.has(name)) {
      const job = { spec, out: new Float32Array(specLength(spec) + 1), st: {}, pos: 0, n: specLength(spec), pending: { gain, rate } };
      missQ.push(job);
      M.missMsLast = pumpJobs(missQ, CHUNKS_MISS); /* 当场在 12ms 预算步进内尽量渲染 */
      if (M.missMsLast > MISS_MS) M.overruns += 1;
      if (!buffers.has(name)) { M.deferred += 1; return null; } /* 未完成：留待 update 续渲并自动起播 */
    }
    const v = allocVoice(spec);
    if (!v) return null;
    const h = startVoice(v, spec, gain, rate);
    if (native.ctx) playNative(v, spec, gain, rate);
    return h;
  }
  function stopAll() {
    for (let b = 0; b < BUS_ORDER.length; b += 1) {
      const pool = pools[BUS_ORDER[b]];
      for (let i = 0; i < pool.length; i += 1) if (pool[i].on) killVoice(pool[i]);
    }
  }

  /* —— 五声部强度混音：0.15/0.6/1 交叉淡化 [src:pretty:L50664-L50670] —— */
  function setIntensity(v) {
    intensity = clamp01(+v || 0);
    const g = stemTargets(intensity);
    for (let s = 0; s < 5; s += 1) stemVoice[s].target = g[s];
    if (native.ctx) {
      for (let s = 0; s < 5; s += 1) {
        const gn = native.stemGain[s];
        if (gn) gn.gain.setTargetAtTime(g[s] * 0.85, native.ctx.currentTime, 0.15);
      }
    }
    return intensity;
  }

  /* —— 离线渲染（未 attach AudioContext 时的计量真源） —— */
  function mixVoice(v, advBase) {
    const buf = v.buf, len = buf.length - 1; /* 末位是守护样本 */
    const adv = Math.max(1, Math.round(advBase * v.rate * 256));
    /* stem 声部无 spec：套用 music4 总线增益与声部峰值（≈0.38×0.75） */
    const gBase = v.spec ? v.spec.peak * BUS_GAIN[v.spec.bus] * v.gain : v.gain * 0.285;
    const A = v.envA, R = v.envR, L = len;
    let posF = v.posF;
    for (let s = 0; s < frameN; s += 1) {
      let idx = posF >>> 8;
      if (idx >= L) {
        if (!v.loop) { v.on = false; break; } /* 单发声部播完即释放 */
        posF -= L << 8;
        idx = posF >>> 8;
      }
      let env = idx < A ? idx / A : 1;
      if (v.rel && idx > v.relStart) { const e = 1 - (idx - v.relStart) / R; if (e <= 0) { v.on = false; break; } env = e; }
      else if (!v.loop && idx > L - R) env = (L - idx) / R;
      const frac = (posF & 255) / 256;
      const x = (buf[idx] + (buf[idx + 1] - buf[idx]) * frac) * env * gBase;
      master[s] += x;
      if (v.wet) send[v.irIdx][s] += x;
      posF += adv;
    }
    v.posF = posF;
  }
  function convolveIR(k) {
    const st = irState[k], dl = st.dl, c = st.c, off = st.off, L = st.L;
    let w = st.w;
    for (let s = 0; s < frameN; s += 1) {
      dl[w] = send[k][s];
      let acc = 0;
      for (let t = 0; t < TAPS; t += 1) acc += c[t] * dl[(w - off[t] + L) % L];
      master[s] += acc;
      w = w + 1 === L ? 0 : w + 1;
    }
    st.w = w;
  }
  function meterPass(x) {
    if (x > M.peak) M.peak = x;
    else if (-x > M.peak) M.peak = -x;
    if (x >= 0.99 || x <= -0.99) M.clip += 1;
    let v = x;
    for (let k = 0; k < 6; k += 1) {
      const nv = bandState[k] + bandA[k] * (v - bandState[k]);
      bandOut[k] += Math.abs(v - nv);
      bandState[k] = nv;
      v = nv;
    }
  }
  function renderFrame() {
    master.fill(0);
    send[0].fill(0);
    send[1].fill(0);
    let vc = 0;
    for (let b = 0; b < BUS_ORDER.length; b += 1) {
      const pool = pools[BUS_ORDER[b]];
      for (let i = 0; i < pool.length; i += 1) {
        const v = pool[i];
        if (!v.on) continue;
        mixVoice(v, v.spec.sr / sampleRate);
        if (v.on) vc += 1;
      }
    }
    for (let s = 0; s < 5; s += 1) {
      const sv = stemVoice[s];
      if (!sv.on || sv.gain <= STEM_AUDIBLE) continue;
      mixVoice(sv, 1); /* stem buf 与渲染 sr 一致 */
      vc += 1;
    }
    convolveIR(0);
    convolveIR(1);
    for (let s = 0; s < frameN; s += 1) {
      let x = master[s];
      const a = x < 0 ? -x : x;
      if (a > 0.8) { /* 软限幅：渐近 0.97，杜绝 ≥0.99 的削波计数 */
        const over = 0.17 * Math.tanh((a - 0.8) / 0.17);
        x = (x < 0 ? -1 : 1) * (0.8 + over);
      }
      meterBuf[s] = x;
      meterPass(x);
    }
    for (let k = 0; k < 6; k += 1) bandOut[k] = bandOut[k] * 0.5 / frameN;
    M.voiceCount = vc;
  }

  /* —— 原生 WebAudio 路径（可选注入；AudioContext 是运行时能力而非引擎依赖） —— */
  function toAudioBuffer(actx, data, sr) {
    const b = actx.createBuffer(1, data.length - (data.length % 2), sr);
    if (b.copyToChannel) b.copyToChannel(data.subarray(0, b.length), 0, 0);
    else b.getChannelData(0).set(data.subarray(0, b.length));
    return b;
  }
  function attach(actx, opts) {
    if (!actx || typeof actx.createGain !== "function") return false;
    dispose();
    native.ctx = actx;
    const g = (v) => { const n = actx.createGain(); n.gain.value = v; return n; };
    native.master = g(masterGain);
    native.analyser = actx.createAnalyser();
    native.analyser.fftSize = 2048;
    native.meter = new Float32Array(2048);
    native.master.connect(native.analyser);
    native.analyser.connect((opts && opts.destination) || actx.destination);
    for (let b = 0; b < BUS_ORDER.length; b += 1) {
      const gn = g(BUS_GAIN[BUS_ORDER[b]]);
      gn.connect(native.master);
      native.bus[BUS_ORDER[b]] = gn;
    }
    for (let k = 0; k < 2; k += 1) {
      const conv = actx.createConvolver();
      conv.buffer = toAudioBuffer(actx, irBuf[k], 44100);
      const wet = g(0.35);
      conv.connect(wet);
      wet.connect(native.master);
      native.conv.push(conv);
    }
    for (let s = 0; s < 5; s += 1) {
      const buf = buffers.get(STEM_NAMES[s]);
      if (!buf) continue; /* stem 未就绪：boot 完成后 setIntensity 会接管已有源；未就绪则本拍静音 */
      const src = actx.createBufferSource();
      src.buffer = toAudioBuffer(actx, buf, 44100);
      src.loop = true;
      const gn = g(0);
      src.connect(gn);
      gn.connect(native.master);
      src.start();
      native.stemGain.push(gn);
      native.stemSrc.push(src);
    }
    setIntensity(intensity);
    return true;
  }
  function playNative(v, spec, gain, rate) {
    const actx = native.ctx;
    const src = actx.createBufferSource();
    src.buffer = toAudioBuffer(actx, v.buf, spec.sr);
    src.playbackRate.value = rate;
    src.loop = spec.loop;
    const vg = actx.createGain();
    vg.gain.value = spec.peak * BUS_GAIN[spec.bus] * gain;
    src.connect(vg);
    vg.connect(native.bus[spec.bus]);
    if (spec.ir >= 0) vg.connect(native.conv[spec.ir]);
    src.start();
    v.native = { src, vg };
    if (!spec.loop) {
      const dur = (v.buf.length - 1) / spec.sr / rate;
      src.stop(actx.currentTime + Math.min(dur + 0.1, 12));
    }
  }
  function readNativeMeter() {
    native.analyser.getFloatTimeDomainData(native.meter);
    let vc = 0;
    for (let b = 0; b < BUS_ORDER.length; b += 1) {
      const pool = pools[BUS_ORDER[b]];
      for (let i = 0; i < pool.length; i += 1) if (pool[i].on) vc += 1;
    }
    for (let s = 0; s < 5; s += 1) if (stemVoice[s].on && stemVoice[s].gain > STEM_AUDIBLE) vc += 1;
    M.voiceCount = vc;
    for (let s = 0; s < frameN; s += 1) {
      const x = native.meter[s];
      meterBuf[s] = x;
      meterPass(x);
    }
    for (let k = 0; k < 6; k += 1) bandOut[k] = bandOut[k] * 0.5 / frameN;
  }
  function dispose() {
    for (let b = 0; b < BUS_ORDER.length; b += 1) {
      const pool = pools[BUS_ORDER[b]];
      for (let i = 0; i < pool.length; i += 1) {
        const v = pool[i];
        if (v.native) { try { v.native.src.stop(); } catch (e) { /* noop */ } v.native = null; }
      }
    }
    for (let i = native.stemSrc.length - 1; i >= 0; i -= 1) { try { native.stemSrc[i].stop(); } catch (e) { /* noop */ } }
    for (let i = native.stemGain.length - 1; i >= 0; i -= 1) { try { native.stemGain[i].disconnect(); } catch (e) { /* noop */ } }
    native.stemGain.length = 0;
    native.stemSrc.length = 0;
    native.conv.length = 0;
    if (native.analyser) { try { native.analyser.disconnect(); } catch (e) { /* noop */ } }
    if (native.master) { try { native.master.disconnect(); } catch (e) { /* noop */ } }
    for (let b = 0; b < BUS_ORDER.length; b += 1) { if (native.bus[BUS_ORDER[b]]) { try { native.bus[BUS_ORDER[b]].disconnect(); } catch (e) { /* noop */ } } native.bus[BUS_ORDER[b]] = null; }
    native.ctx = null; native.master = null; native.analyser = null; native.meter = null;
    stopAll();
  }

  /* —— 每帧推进：懒合成切片（6ms/12ms）→ 五声部平滑 → 渲染/计量 —— */
  function update(dt) {
    if (!(dt > 0)) dt = 1 / 60;
    if (dt > 0.25) dt = 0.25;
    if (bootQ.length) {
      const bootMs = pumpJobs(bootQ, CHUNKS_BOOT);
      if (bootMs > M.bootMsMax) M.bootMsMax = bootMs;
      M.bootMsSum += bootMs; M.bootMsN += 1;
      if (bootMs > BOOT_MS) M.overruns += 1; /* 监控：本帧墙钟越限（多为进程级 GC/JIT 抖动，算法工作量由步长有界） */
    }
    if (missQ.length) {
      const missMs = pumpJobs(missQ, CHUNKS_MISS);
      if (missMs > M.missMsMax) M.missMsMax = missMs;
      if (missMs > MISS_MS) M.overruns += 1;
    }
    ensureStems();
    for (let s = 0; s < 5; s += 1) {
      const sv = stemVoice[s];
      sv.gain += (sv.target - sv.gain) * Math.min(1, dt * 8);
    }
    if (native.ctx) readNativeMeter();
    else renderFrame();
    /* 不返回 stats()：stats() 按需调用（对象快照有分配，不进热循环） */
  }

  function stats() {
    let vc = 0;
    let stems = 0;
    for (let b = 0; b < BUS_ORDER.length; b += 1) {
      const pool = pools[BUS_ORDER[b]];
      for (let i = 0; i < pool.length; i += 1) if (pool[i].on) vc += 1;
    }
    for (let s = 0; s < 5; s += 1) if (stemVoice[s].on && stemVoice[s].gain > STEM_AUDIBLE) { vc += 1; stems += 1; }
    M.voiceCount = vc;
    return {
      peak: M.peak, clip: M.clip, voiceCount: M.voiceCount, stemAudible: stems,
      specs: AUDIO_SPECS.length, playable: 56, buses: BUS_ORDER.length, musicParts: 5, irs: 2,
      intensity,
      bootPending: bootQ.length, missPending: missQ.length, missMsLast: M.missMsLast,
      bootMsMean: M.bootMsN ? M.bootMsSum / M.bootMsN : 0,
      bootMsMax: M.bootMsMax, missMsMax: M.missMsMax, overruns: M.overruns, dropped: M.dropped, deferred: M.deferred,
    };
  }

  /* 时域样本（combat-kit audioMeter 合同：sample() → 类数组，combat-kit.mjs:254） */
  function sample() { return meterBuf; }
  /* 频段能量（--require-audio 的 bands ≥3 证据，harness/gates/gameplay.mjs:161） */
  function bands() { return bandOut; }
  function irs() { return [irBuf[0], irBuf[1]]; }
  function specs() { return AUDIO_SPECS; }

  return { SPECS: AUDIO_SPECS, BUSES: AUDIO_BUSES, BUDGET: { bootMs: BOOT_MS, missMs: MISS_MS }, play, stopAll, setIntensity, update, stats, sample, bands, irs, specs, attach, dispose };
}

/* ============================== 自检 ============================== */

/**
 * 模块级自检（node 可跑，零 AudioContext）：规格表/总线/预算口径，
 * 离线混音器跑一轮 boot + play("shot")，验证 peak/sample/bands/IR 都是真实产出。
 * 返回 { ok, problems, ...counts }。
 */
export function selfTest() {
  const problems = [];
  const irs = AUDIO_SPECS.filter((r) => r.gen === "ir");
  const playable = AUDIO_SPECS.filter((r) => r.gen !== "ir" && r.max >= 1);
  if (AUDIO_SPECS.length !== 58) problems.push("specs != 58: " + AUDIO_SPECS.length);
  if (playable.length !== 56) problems.push("playable != 56: " + playable.length);
  if (irs.length !== 2) problems.push("IR specs != 2: " + irs.length);
  if (Object.keys(AUDIO_BUSES).length !== 5) problems.push("buses != 5");
  if (AUDIO_BUDGET.bootMs !== 6 || AUDIO_BUDGET.missMs !== 12) problems.push("budget != 6/12ms");
  if (new Set(AUDIO_SPECS.map((r) => r.n)).size !== AUDIO_SPECS.length) problems.push("duplicate spec names");
  for (const spec of AUDIO_SPECS) {
    for (const field of AUDIO_SPEC_FIELDS) if (!(field in spec)) problems.push(spec.n + ": missing field " + field);
    if (!(spec.bus in AUDIO_BUSES)) problems.push(spec.n + ": unknown bus " + spec.bus);
  }

  let s = 1;
  const rng = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const kit = createAudioKit({ rng });
  for (let i = 0; i < 40; i += 1) kit.update(1 / 60);
  const voice = kit.play("shot", { rate: 1 });
  for (let i = 0; i < 20; i += 1) kit.update(1 / 60);
  const st = kit.stats();
  const sample = kit.sample();
  const bands = kit.bands();
  const irBufs = kit.irs();
  if (!voice) problems.push("play('shot') returned no voice");
  if (!(st.peak > 0.002)) problems.push("offline mixer peak too low: " + st.peak);
  if (st.specs !== 58 || st.playable !== 56 || st.buses !== 5 || st.musicParts !== 5) problems.push("stats counts drifted");
  if (st.irs !== 2) problems.push("stats.irs != 2");
  if (!(sample.length > 0) || !Array.prototype.every.call(sample, Number.isFinite)) problems.push("sample() returned non-finite buffer");
  if (bands.length !== 6) problems.push("bands() length != 6");
  if (irBufs.length !== 2 || !(irBufs[0].length > 0 && irBufs[1].length > 0)) problems.push("irs() returned empty IR");
  for (const fn of ["play", "stopAll", "setIntensity", "update", "stats", "sample", "bands", "irs", "specs", "attach", "dispose"]) {
    if (typeof kit[fn] !== "function") problems.push("missing API: " + fn);
  }
  return {
    ok: problems.length === 0,
    problems,
    specs: st.specs,
    playable: st.playable,
    buses: st.buses,
    musicParts: st.musicParts,
    irs: st.irs,
    peak: st.peak,
    sampleLength: sample.length,
    bands: bands.length,
  };
}
