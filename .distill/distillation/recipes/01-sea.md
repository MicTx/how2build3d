# 配方 01 · 海面与湿地倒影

> 复刻 `saltline-sea-1` 与 `saltline-apron-3` 的材质注入思路 [src:L5728-L5728] [src:L5654-L5654]。

## 配方

1. **平面基准**：世界常量表定海面 seaY:-1.6、地面 groundY:0、码头 `quayX:三十` [src:pretty:L1044-L1068]——海面是一个参数，不是一个模型。
2. **波形**：fbm 采样共享噪声纹理 [src:L4192-L4195]，低频起伏 + 高频碎波；时间只进 `uTime`，几何不位移（省顶点开销）。
3. **反射**：画质档 `planar` 旋钮控制平面反射（0 / 0.5 / 1）[src:pretty:L1044-L1068]；低档 `planar:0` 时用粗糙度近似，仍然有"湿"的观感。
4. **岸面泡沫**：`saltline-apron-3` 在注入材质里把岸线距离混进颜色与粗糙度 [src:L5654-L5654]；雨湿由 `uSlWetP` 全局 uniform 驱动 [src:L5318-L5318]。
5. **后处理合流**：反射/湿润的最后一层观感交给全屏 pass 的 `uDirt/uStreak/uCA` 与状态袋 `post.wet` [src:L4612-L4613] [src:pretty:L7000-L7024]。
6. **缓存键**：海面 `saltline-sea-1`、岸面 `saltline-apron-3` 各给具名键，避免与库存程序错配 [src:L5728-L5728] [src:pretty:L18627-L18651]。

## 参数表

| 参数 | 值 | 来源 |
| --- | --- | --- |
| `seaY` / `groundY` / `quayX` | -1.6 / 0 / 30 | [src:pretty:L1044-L1068] |
| `planar`（test/low/medium/high/ultra） | .5 / 0 / .5 / .5 / 1 | [src:pretty:L1044-L1068] |
| `tex`（纹理上限） | 256 / 512 / 1024 / 1024 / 2048 | [src:pretty:L1044-L1068] |
| `rain`（雨密度影响湿感） | .4 / .5 / .8 / 1 / 1 | [src:pretty:L1044-L1068] |
| 噪声 octave | 3（海面）/ 5（天空） | [src:L4192-L4195] |
| 太阳色（高光色来源） | `(1,.72,.42)` | [src:pretty:L1044-L1068] |

## 取舍与失败模式

- **取舍**：不用真反射探针也能有"湿地"；代价是高光方向依赖太阳参数，阴天场景要另配。
- **失败**：低档出现"镜面塑料" → `planar:0` 时把 roughness 抬高并保留 `uSlWetP` 的渐变，而非直接关掉湿感。
- **验收**：五档切换不重编译崩溃；同 seed 波形一致；岸线泡沫不随视角闪烁。

## 实施顺序

1. 先定海面/地面/码头三个高度常量 [src:pretty:L1044-L1068]；
2. 用平面几何 + fbm 波形的纯色版本验收"水在动" [src:L4192-L4195]；
3. 接高光与 `planar` 旋钮，逐档验收反射预算 [src:pretty:L1044-L1068]；
4. 加岸线泡沫与雨湿 uniform [src:L5654-L5654] [src:L5318-L5318]；
5. 最后接后处理 `uDirt/uStreak` 与 `post.wet` [src:L4612-L4613] [src:pretty:L7000-L7024]。

## 与其他配方的接口

海面用天空配方的太阳色与雾色 [src:pretty:L1044-L1068]，雨锈配方（02）把 `uSlWetP` 复用于岸面金属 [src:L5318-L5318]；画质档 `tex/planar/volSteps` 三旋钮由 S1 预算表统一控制，海面内部只读不写 [src:pretty:L1044-L1068]。
