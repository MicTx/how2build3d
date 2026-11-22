# 配方 03 · 第一人称武器装配

> 复刻 `pac9-detail-` 材质与武器常量表 [src:pretty:L5607-L5631] [src:pretty:L921-L945]。

## 配方

1. **双相机**：主相机 `fov:74, near:.08, far:900`；武器相机 `viewFov:五十四, near:.01, far:十`，独立 layer [src:pretty:L1044-L1068]；渲染前压 depthRange 防穿墙 [src:pretty:L7000-L7024]。
2. **部件表**：把枪拆成坐标常量——枪口、抛壳口、机瞄高度、镜窗八边形顶点、弹匣、枪机行程、导轨、握把/护木 [src:pretty:L921-L945]。
3. **拼装**：参数几何（Box/Cylinder）+ applyMatrix4 摆位 + 合并 [src:pretty:L1044-L1068] [src:pretty:L1-L25]；每部件写入 `uKind` 对应的材质分支（共享一个编译产物）[src:L6017-L6017]。
4. **细节注入**：`pac9-detail-<kind>` 缓存键 + `onBeforeCompile` 替换 `normal_fragment_maps` 锚点，注入程序化 bump（雨滴高度场混入法线）[src:pretty:L5607-L5631] [src:L3288-L3288]。
5. **动画由状态驱动**：换弹 = 弹匣位移 + 枪机沿 `boltTravel` 平移；开镜 = 相机对齐 `sightY` 与镜窗中心，FOV 收至武器相机；后坐力三段 `Keep/Apply/Recover` [src:pretty:L921-L945]。
6. **反馈**：6 盏复用 PointLight 做枪口闪光（ttl 回收）[src:pretty:L7000-L7024]；后处理 `uAds/uFlash` 与状态袋 [src:L4612-L4613]。

## 参数表

| 参数 | 值 | 来源 |
| --- | --- | --- |
| `muzzle` | `[0,0,-0.531]` | [src:pretty:L921-L945] |
| `sightY` / `lensF` | `.069` / `.0285` | [src:pretty:L921-L945] |
| `boltTravel` | `.062` | [src:pretty:L921-L945] |
| `squeeze`（握持压缩） | `.86` | [src:pretty:L921-L945] |
| `fovAds` / `adsLook` | `52` / `.6` | [src:pretty:L921-L945] |
| `recoilKeep/Apply/Recover/Hold` | `.35/34/6.5/.09` | [src:pretty:L921-L945] |
| 主/武器相机 FOV | `74/54` | [src:pretty:L1044-L1068] |

## 取舍与失败模式

- **取舍**：把"模型"变成装配表，细节密度靠材质注入而非多边形；代价是枪械造型受参数几何形状限制。
- **失败**：枪模穿墙 → 检查 depthRange 切片与 layer 掩码；开镜抖动 → 检查 sightY 与镜窗中心是否同一坐标系 [src:pretty:L7000-L7024]。
- **验收**：双相机各一次 draw，枪在任何墙面前不被裁；五档画质切换不重编译崩溃。

## 实施顺序

1. 先搭双相机与 layer，验收"枪贴脸不被裁" [src:pretty:L1044-L1068] [src:pretty:L7000-L7024]；
2. 写部件坐标表，用参数几何拼出可辨识的轮廓 [src:pretty:L921-L945] [src:pretty:L1044-L1068]；
3. 接 `pac9-detail` 注入与 bump 细节 [src:pretty:L5607-L5631] [src:L6017-L6017]；
4. 加换弹/开镜/后坐三段动画 [src:pretty:L921-L945]；
5. 最后接枪口光池与后处理 `uAds/uFlash` [src:pretty:L7000-L7024] [src:L4612-L4613]。

## 与其他配方的接口

武器用雨锈配方（02）的 `uRain` 做表面淋雨 [src:L6017-L6017]；用音频配方（05）的脚步/枪声规格表做反馈 [src:pretty:L921-L945]。调参表与玩法系统共享 TUNE 结构，改手感不动装配逻辑 [src:pretty:L921-L945]。
