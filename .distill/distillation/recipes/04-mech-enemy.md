# 配方 04 · 机械敌人与增援

> 复刻敌方单位与波次调度的结构 [src:pretty:L21333-L21357] [src:pretty:L51928-L51952]。

## 配方

1. **几何**：地面猎犬（hound）与空中旋翼（rotor）都由参数几何拼装 + 合并 [src:pretty:L1044-L1068]；重复关节走实例化 [src:L5461-L5461]。
2. **发光/警示**：`saltline-blink` 注入材质给"眼睛/警示灯"做周期闪烁，每实例一个 `blink(周期,相位,占空)` attribute，CPU 只更新共享 uTime [src:pretty:L18627-L18651]。
3. **动画**：旋翼走 `saltline-gulls` 顶点程序化动画（相位驱动，不传骨骼）[src:L5474-L5474]；`frustumCulled=false` 保证群体不被整体裁掉。
4. **声音**：脚步 3 变体、舵机/旋翼循环音挂 `world` 总线，`ref/roll` 控制距离衰减 [src:pretty:L921-L945]。
5. **调度**：任务状态袋 `c` 跟踪 `waveHot/alertT/pursuitT/pursuitLeft/queue`，切断中继触发热增援 [src:pretty:L51928-L51952]；`contactSaid/lowSaid` 防语音重复播报。
6. **确定性**：刷兵与音效变体共用 seeded rng（默认 四千二百七）[src:pretty:L51928-L51952] [src:L4206-L4206]，重开一局 `H()` 清空敌人/FX/战斗/武器/任务袋后重建 relays [src:pretty:L51928-L51952]。

## 参数表

| 参数 | 值 | 来源 |
| --- | --- | --- |
| 脚步变体 | 3 | [src:pretty:L921-L945] |
| 死亡/警报音 `pri` | 7 / 6 | [src:pretty:L921-L945] |
| 旋翼/舵机 `ref` | 5 / 4 | [src:pretty:L921-L945] |
| 闪烁周期 | `blink.x`，相位 `blink.y`，占空 `blink.z` | [src:pretty:L18627-L18651] |
| 世界边界盒 | `(-40,0,-30)~(40,30,30)` | [src:pretty:L1044-L1068] |
| 刷兵种子 | 4207 | [src:pretty:L51928-L51952] |

## 取舍与失败模式

- **取舍**：不做骨骼动画，用顶点相位 + 实例化；单位差异靠参数与材质变体表达。
- **失败**：群体闪烁"齐步走" → 每实例相位必须来自 seeded rng 而非固定值 [src:pretty:L18627-L18651]；波次重叠 → 检查 `max/pri` 抢占与 waveHot 清零 [src:pretty:L921-L945] [src:pretty:L51928-L51952]。
- **验收**：同 seed 两局敌人出现顺序一致；debugCut() 连点三次能推进到撤离 [src:pretty:L51928-L51952]。

## 实施顺序

1. 先写任务状态袋与 seeded rng，验收"重开一局完全一致" [src:pretty:L51928-L51952] [src:L4206-L4206]；
2. 用参数几何拼出单位轮廓 [src:pretty:L1044-L1068]；
3. 接 `saltline-blink` 与顶点相位动画 [src:pretty:L18627-L18651] [src:L5474-L5474]；
4. 接脚步/舵机/旋翼音与 `ref/roll` 衰减 [src:pretty:L921-L945]；
5. 最后接波次调度与 debugCut 验收捷径 [src:pretty:L51928-L51952]。

## 与其他配方的接口

敌方材质复用雨锈配方（02）的做旧纹理与闪烁注入 [src:pretty:L33030-L33054] [src:pretty:L18627-L18651]；任务流由玩法调参表与 `game:state` 事件广播驱动 [src:pretty:L51928-L51952]，HUD 目标标记同步读 relays 状态 [src:L6087-L6087]。
