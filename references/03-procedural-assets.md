# 程序化资产：噪声 / Canvas / 几何 / 实例化

## 一张噪声纹理打天下

```js
function makeNoise(seed) {
  let t = seed >>> 0;
  const rnd = () => (t ^= t << 13, t >>>= 0, t ^= t >>> 17, t ^= t << 5, t >>>= 0, t / 4294967296);
  const data = new Uint8Array(256 * 256 * 4);
  for (let i = 0; i < data.length; i++) data[i] = (rnd() * 256) | 0;
  return new THREE.DataTexture(data, 256, 256, THREE.RGBAFormat);
}
```

- seed 进 URL 参数（默认 4207），噪声/音效/刷兵共用一个 seeded rng。
- GPU 侧 `n2 → fbm5/fbm3`，全场共享，**不要每个材质各建一张**。
- 用计算换字节：4K PBR 贴图组 ~12-25MB，等价 fbm 是 ~1KB 代码 + 256KB 显存。

## Canvas 做旧与排版

四 pass 叠出"用了二十年的铁牌"：

1. `destination-out` + 随机多边形抠漆皮（孔径 `pow(rnd(),3)*t*.09+0.6`，小洞多）；
2. 随机细划痕（`n*16` 条，线宽 `0.5+rnd()*rnd()*3`，方向一致）；
3. 点锈 + `createRadialGradient` 软污渍；
4. `qa()` 排版：逐字 `measureText`/`fillText`，字距 `字号*.06`、字重 700、连笔桥、超宽缩放。

产出 `CanvasTexture`，运行期只调 uniform。

## 几何三级复用

1. **参数几何**：Box/Cylinder/Lathe + `applyMatrix4` 摆位；
2. **合并**：`mergeGeometries` 合成单网格，合并后 `computeVertexNormals`；需要每面独立 attribute 时先 `toNonIndexed()`；
3. **实例化**：重复单元用 `InstancedMesh`，`setMatrixAt` + `setColorAt`，单 draw call 铺满场景。

世界写进一张常量表：`bounds/groundY/seaY/quayX/sun(dir,color,intensity)/player(eye,crouchEye,radius,height,fov)`。

## 道具解剖与零件目录

道具不是「雕」出来的，是「拼」出来的：全部用参数几何（方块/圆柱/圆环/挤出体）按零件表组合。

- **注册表即目录**：一张 `PROP_SIZES` 表定义每种道具的尺寸/材质/锈蚀档（如集装箱 20/40/40HC 的长宽高），配 `create / register / showcase` 三个出口——`showcase` 就是 `?show=props` 展台的数据源（`[src:pretty:L35067-L35067]`、`[src:pretty:L35068-L35068]`）。
- **零件命名与层级**：每件道具按「主体 / 细节 / 紧固件」命名并成组；英雄道具把零件数写进常量注释——叉车 277 个零件、门架链 92 节链环、岸吊 89 级踏板——预算核算与展台抽查都靠它对账。
- **细节密度分级**：近景英雄件做全零件；中景结构件保留轮廓 + 2–3 个特征细节；远景剪影只做体块。同一道具三档，不搞一套打天下。
- **布局手写**：地图不随机生成——47 个集装箱、26 摊积水的坐标全部写死在关卡常量表里，随机只用于纹理/音效变体，不用于空间布局。同 seed 截图布局 diff = 0。
- **验收**：`?show=props` 展台陈列 ≥6 种道具；零件数与常量注释一致；布局坐标改动必须同时更新常量表与截图基线。

## 天气与雨

- `rain` 密度由画质档控制；雨粒子 instanced sprite + `attribute vec4 aPar`。
- 雨湿走 `uSlWetP/uRain` uniform 与法线扰动（`dBump(normal, dHt + dDropH*0.32)`），不切贴图。
- 闪电是事件：CPU 衰减曲线写 `uFlash`。

## 自检

- [ ] 删掉所有资产目录仍能重建同一画面
- [ ] 同 seed 两次生成的纹理 checksum 一致
- [ ] 纹理总数不随材质数量线性增长
- [ ] 生成成本全部在启动期（`onLevelReady`）结清
