# 配方 02 · 雨、锈与标识做旧

> 复刻 Canvas 做旧引擎与雨湿注入 [src:pretty:L33030-L33054] [src:L5318-L5318]。

## 配方

1. **基础色**：Canvas 填一块金属底/油漆色（来自 token 板的 `--rust/--steel` 色系 [src:L11-L23]）。
2. **啃咬边缘**：`globalCompositeOperation="destination-out"`，用随机多边形 `ra()` 抠掉漆皮，孔径按 `pow(rnd(),3)*t*.09+0.6` 分布（小洞多、大洞少）[src:pretty:L33030-L33054]。
3. **划痕**：`n*十六` 条随机线段，线宽 `0.5+rnd()*rnd()*3`（偏细），角度 `±0.35` 弧度，方向一致（雨蚀方向）[src:pretty:L33030-L33054]。
4. **点锈 + 污渍**：`destination-out` 点阵 + createRadialGradient 软污渍（alpha 0.25~0.65）[src:pretty:L33030-L33054]。
5. **文字**：`qa()` 排版引擎——逐字 measureText / fillText，字距 `s*.06`、字重 七百、连笔桥、超宽缩放 [src:pretty:L33030-L33054]。
6. **运行时雨湿**：成品做 `CanvasTexture`，材质侧 `uSlWetP/uRain` 按天气混合粗糙度与法线扰动（枪械同款 `dBump(normal, dHt + dDropH*0.32)` 思路）[src:L6017-L6017] [src:L5318-L5318]。
7. **雨粒子**：instanced sprite + `attribute vec4 aPar` 每粒子参数，闪烁由 vBlink 相位控制 [src:pretty:L18627-L18651]。

## 参数表

| 参数 | 值 | 来源 |
| --- | --- | --- |
| 孔洞数量 | `floor(n*w*h/700)` | [src:pretty:L33030-L33054] |
| 划痕数量 | `n*16` | [src:pretty:L33030-L33054] |
| 点锈数量 | `n*w*h/60` | [src:pretty:L33030-L33054] |
| 污渍半径 | `(.1+.25*rnd())*h` | [src:pretty:L33030-L33054] |
| 字距 | `字号*0.06` | [src:pretty:L33030-L33054] |
| 雨密度档 | `.4/.5/.8/1/1` | [src:pretty:L1044-L1068] |
| 雨湿 uniform | `uSlWetP,uSlMacro,uSlUv,uSlX` | [src:L5318-L5318] |

## 取舍与失败模式

- **取舍**：所有"旧"都在启动期一次性烘进 Canvas 纹理，运行期只调 uniform。
- **失败**：seed 不固定会让每次刷新锈斑位置不同 → 噪声与 Canvas 随机必须共用一个 seeded rng [src:L4206-L4206] [src:pretty:L51928-L51952]。
- **验收**：同 seed 两次生成的 texture checksum 一致；低画质档雨粒子数量随 `rain` 旋钮下降。

## 实施顺序

1. 先写一个 seeded rng，让 Canvas 与噪声共用种子 [src:L4206-L4206] [src:pretty:L51928-L51952]；
2. 实现 `ra()` 随机多边形 + 四 pass 做旧，验收"旧得像用了二十年" [src:pretty:L33030-L33054]；
3. 加 `qa()` 排版引擎，验收中英混排与字距补偿 [src:pretty:L33030-L33054]；
4. 产出 `CanvasTexture` 并接 `uSlWetP/uRain` [src:L5318-L5318] [src:L6017-L6017]；
5. 最后接 instanced 雨粒子，按画质档 `rain` 控密度 [src:pretty:L18627-L18651] [src:pretty:L1044-L1068]。

## 与其他配方的接口

本配方产出的纹理被海面/岸面（01）与机械敌人（04）共享；做旧参数 `n` 是唯一旋钮，改一处全局生效 [src:pretty:L33030-L33054]。雨湿 uniform 在武器配方（03）里同样被 `pac9-detail` 注入复用 [src:pretty:L5607-L5631]。
