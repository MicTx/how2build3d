# 创物 · 音频（audio）

> 上游锚点：`sources/jimao-3a-game/index.html` L5939 巨行（规格表约 64.9K 字符处、音乐生成约 59.9K、总线图约 70.9K、更新与离线自检约 87K）｜我方资产：`assets/audio-kit.mjs`（58 条规格 / 5 总线 / 6ms·12ms 预算 / 2 张生成 IR / 五声部）｜对账：`harness/element-manifest.json` audio 族 ｜ 验收：`node harness/gates/complete.mjs --scene examples/parity`

## 构建法则

**法则 1 · 规格表就是 API 面**：一条声音只由 11 个正典字段描述（gen/n/sr/peak/bus/max/pri/boot/loop/music/ir），引擎不认识任何具体声音名。上游 `Go` 表把配方函数、采样率、峰值、总线、并发上限、抢占优先级、启动预合成、循环、音乐号、IR 槽压进一行 [src:pretty:L50465-L50521]。表共 57 行（50 个非音乐可播名 + 5 个音乐声部 + 2 张 IR），由 `harness/claims.json#audio.specs` 登记；我方扩为 58 行，并在 import 时校验行长、字段顺序、总线合法性、配方合法性、重名与三类计数。表错就在加载期抛错，而不是在战斗里静音 [src:pretty:L50560-L50630]。

**法则 2 · 一条声音是分层配方，不是单个振荡器**：枪声由噪声瞬态、机械模态、低频推力、枪管尾音与饱和五层叠加，四个变体只改一张失谐表 [src:pretty:L48855-L48920]；金属撞击是 8 个非谐模态的衰减正弦库 [src:pretty:L49318-L49345]；弹壳是 5 个高频模态、随机反弹间隔与逐次能量衰减 [src:pretty:L49190-L49220]；爆炸是噪声爆音、下滑正弦、低通扫频、次低频、带通与 7 粒火花的并联 [src:pretty:L49830-L49862]。层数与频段分工，比事后调音量更能决定“像不像”。

**法则 3 · 预算是固定分片，不是墙钟让出**：上游后台合成每片结束检查 `performance.now()-te>6` 就 break，12ms 后再续 [src:pretty:L50755-L50757]；我方把“每帧 4 片 boot / 8 片首播 × 4096 样本”写死，墙钟只累计 `overruns` 做事后监控。前者对机器速度与 GC 抖动敏感，后者同 seed 同操作逐位一致——这条改动的实质是把“确定性”排在“瞬时吞吐”之前。

**法则 4 · 空间身份由总线与 IR 路由决定**：world/near 先进低通，再分两路卷积 send（露天湿声 0.75、仓库湿声 0.95），dry 直连主控，music 只少量喂仓库 IR [src:pretty:L50779-L50860]；每个声部再叠 HRTF/equalpower panner、inverse 距离模型，ref/roll 由规格行覆盖。室内外不是切“混响预设”，而是 `interior` 标量同时推两路 send 的增益 [src:pretty:L51475-L51510]。空间感是路由的产物，不是每个声音各自的特效。

**法则 5 · 音乐是状态函数，五声部同拍启动**：drone/ost/perc/brass/motif 五条等长 loop（100 bpm × 8 小节 = 19.2s）由同一 `t0` 启动；title/intro/dead/complete 给固定五元组，playing 按战斗强度用 smoothstep 逐层进入 [src:pretty:L51079-L51086]。乐句由四个和弦根音与固定节奏型生成，随机只用于确定性的失谐种子（同一 seed 同一结果） [src:pretty:L50168-L50235]。同拍、等长、同起点，是五条独立 buffer 不出现相位错位的全部秘密。

**法则 6 · 音频必须有可断言的展厅**：`selfTest()` 用 OfflineAudioContext 跑一段 10 秒脚本战斗（脚步、开火、警报、爆炸、受击、击杀、目标），按 20ms 挂起点推进事件，返回 peak/over/nan/rmsDb 与引擎 debug 快照 [src:pretty:L51559-L51620] [src:pretty:L51665-L51665]。声音看不见，就把听感折成四个数字：峰值、削波采样数、NaN 数、分段 RMS。

## 完整链路

| 意图 | 算法 | 常量表 | 上游实现 | 我方落点 | 运行时证据 | 门禁 | 失效模式与兜底 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 枪声可辨识 | 4 变体失谐 + 6 层并联 + tanh 饱和 | f0/f1 与模态频率表 | `KR()` [src:pretty:L48855-L48920] | `shot/shot-indoor` 两行、`renderBurst` | 离线 peak、频谱带 | parity + `--require-audio` | 变体不够 → 增 `n`，不改引擎 |
| 材质反馈 | 表面名映射到撞击/脚步配方 | metal/concrete/wood/water/glass/dirt/rubber | 两张映射表 [src:pretty:L50579-L50620] | 事件表 `impact-*` / `foot-*` | 事件→声音名可查 | gameplay 事件计数 | 未知表面回落 concrete |
| 爆炸规模 | 爆音 + 下滑正弦 + 低通扫频 + 粒子火花 | 时长 1.3/1.7s，f0 120→30 | `I8()` [src:pretty:L49830-L49862] | `explosion/explosion-dist` | peak ≤0.97、clip=0 | 同上 | 同帧多爆 → max/pri 抢占 |
| 环境底床 | 雨/室内雨/风/海四 loop，室内交叉 | fade 2s，interior 0..1 | `Oe`/`lu` [src:pretty:L51475-L51510] | `rain/wind/wave-*` + `amb1` | voiceCount、interior | `stats()` | 无 AudioContext → 静音 stub |
| 战斗音乐 | 五声部状态向量 + 强度 smoothstep | 0.15/0.6/1 三档 | `we()` [src:pretty:L51079-L51086] | `music-pad/perc/bass/lead/arp` | stemAudible、intensity | `stats().musicParts=5` | buffer 未齐 → 不启动，齐了同拍起 |
| 空间声 | 总线→低通→双卷积 send→压缩→软限幅 | ref 2.5–12、roll .5–1.4 | 总线图 [src:pretty:L50779-L50860] | `AUDIO_BUSES` + attach 节点图 | 双 IR buffer 就绪 | `reverb:[true,true]` | WebAudio 不可用 → `iC()` 空实现 |
| 懒合成 | 切片队列，boot 与首播分预算 | 6ms/12ms、4096 样本/片 | `y()` [src:pretty:L50755-L50757] | `pumpJobs` + `CHUNKS_BOOT/MISS` | `bootMsMax/missMsMax/overruns` | `stats()` | 首播缺失 → 请求排队，完成后自动起播 |
| 音频验收 | 离线脚本战斗渲染 | 10s、50Hz 事件步 | `de()` [src:pretty:L51559-L51620] | 离线混音器即计量真源 | `sample()/bands()` | `gameplay --require-audio`（peak>0.002、bands≥3、specs≥8） | 设备缺失 → Offline 路径照跑 |

对账要点：上游 57 条（50 个非音乐可播名 + 5 声部 + 2 IR，可播 55）、我方 58 条（51 个非音乐可播名 + 5 声部 + 2 IR，可播 56），**不是逐名克隆而是按“声音角色”重编目录**。因此 `element-manifest.json` 的 `specs:58` 与 `playable:56` 记的是我方资产；上游对应值是 57/55。

## 思维链

**决策链一 · 为什么用表而不是 switch**

**约束**（事实）：单文件、零音频资源，声音数量在几十条量级 [src:pretty:L921-L945]。
**目标**（事实）：新增一种声音不改引擎，只加数据 [src:pretty:L50465-L50521]。
**候选**（推断）：A 在播放点写 `if (name==='shot') synthShot()`；B 一张规格表 + 一个 `gen` 函数指针。
**选择**（事实）：B。播放 API 只查表，变体、采样率、归一化、总线、抢占全由行决定。
**兜底**（事实）：表形态在 import 期校验，非法行直接抛错，避免运行到一半才发现缺配方 [src:pretty:L50560-L50630]。
**推断边界**：无法从压缩源码证明作者先写表还是先写配方；但字段顺序稳定、配方参数集中在 `PRM`，说明表是后来收敛的接口。

**决策链二 · 为什么音乐切五声部而不是整曲**

**约束**（事实）：零音频文件，内存与加载时间都要可控；战斗强度连续变化 [src:pretty:L50168-L50235]。
**目标**（事实）：探索、交火、死亡、结算之间无缝过渡 [src:pretty:L51079-L51086]。
**候选**（推断）：A 写五首完整曲目切换；B 五条可独立混音的 loop，按状态给增益。
**选择**（事实）：B。五条 loop 共享同一小节网格与起点，切换只是增益插值，没有淡出淡入缝隙。
**兜底**（事实）：全部 stem buffer 就绪才启动 `Me()`，否则整组静音等待；dead/complete 用固定向量把节奏声部关掉，只留 drone/低音。
**推断边界**：五声部的“配器”是作者的音乐选择，不是技术必然；我方 kit 重编为 pad/perc/bass/lead/arp，证明接口可换、法则不变。

**决策链三 · 为什么把音频验收做成离线渲染**

**约束**（事实）：CI/无音频设备环境无法“听”；人工试听不可回归 [src:pretty:L51559-L51620]。
**目标**（推断）：每次改动都能自动回答“有没有声、炸不炸、是否 NaN”。
**候选**（推断）：A 录制音频文件比对；B 用 OfflineAudioContext 跑脚本战斗，量峰值/削波/RMS。
**选择**（事实）：B。脚本固定 10 秒事件序列，渲染结果可复现 [src:pretty:L51559-L51620]。
**兜底**（事实）：WebAudio 完全不可用时返回 `iC()` 静音实现，游戏仍可启动 [src:pretty:L50665-L50695]。
**推断边界**：脚本战斗的“听感覆盖”有限，它证明的是信号链健康，不是美术混音正确。

## 迁移法则

- **资产路由**：引擎在 `assets/audio-kit.mjs`；场景接线 `examples/parity/src/audio.mjs`；对账行 `harness/element-manifest.json#audio`；既有叙述 `references/11-element-parity.md#audio`、`recipes/05-synth-audio.md`。新增场景只允许“事件名 → 播放名”映射，不允许在场景里写合成器。
- **参数重绑点**：① 声音名与配方是重编的，迁移时按“角色”而非原名对表；② 五声部配器与循环长度（上游 100 bpm/19.2s，我方 96 bpm/5s）是策略参数；③ 总线并发上限上游为 22/12/8/3，我方为 22/10/7/4 并单列 `amb1`——cap 是预算，不是证据；④ 上游的湿声按总线分流，我方规格行用 `ir` 字段逐行指定 IR 槽，这是 schema 扩展；⑤ 我方浏览器原生路径目前只有 bus→convolver→master，未移植上游的 Compressor + WaveShaper 软限幅 [src:pretty:L50779-L50860]，需要广播级响度时按该段补节点。
- **对账行**：`specs=58`、`buses=5`、`musicParts=5`、`irs=2` 由 `stats()` 自报；门禁 `complete.mjs --scene examples/parity` 核对族下限，`gameplay.mjs --require-audio` 核对 peak>0.002、bands≥3、specs≥8 与确定性重放。
