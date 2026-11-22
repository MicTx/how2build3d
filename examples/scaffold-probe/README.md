# examples/scaffold-probe — TODO：一句话场景意图

## 场景意图

TODO：一句话写清「这是什么地方、什么时刻、什么天气」，再写三条美术决定
（至少一条是观感决定：材质分层 / 光照分层 / 后处理目标）。
R0 参考研究见 `references/05-reference-research.md`；观感配方见 `references/07-perceptual-quality.md`。

## 参数表

| 参数 | 值 | 说明 |
| --- | --- | --- |
| seed | 4207 | 进 URL，确定性重建 |
| tier | full | 元素对账档位（visual / game / full） |
| 机位 | 主相机 fov 74 / 武器相机 54 | `references/01` 的玩家口径 |
| 输出 | `build/scaffold-probe/index.html` | 单文件，three r180 内联，零运行时请求 |
| 世界尺度 | 80×80 m（bounds 见 `src/world.mjs`） | 改数值前先读 `references/12` |

## 方法论

1. **预算先于内容**（铁律 #1）：先写死 draw call / 三角形 / 像素三张上限，再往里塞元素。
2. **资产先于重写**（铁律 #2）：先查 `assets/index.md`，能消费就不重写。
3. **元素对账**（`references/11`）：逐族 `used`/`n/a`，used 必须给实测计数；`complete.mjs` 判红。
4. **自检闭环**（`references/08`）：每完成一块 → 进展厅 → 拍照 → 看 → 改。

## 验收

```bash
node examples/scaffold-probe/build.mjs --assert
node harness/render/scene.mjs --scene examples/scaffold-probe --assert
node harness/gates/inspect.mjs  --scene examples/scaffold-probe   # 九厅三张证据
node harness/gates/complete.mjs --scene examples/scaffold-probe   # 元素对账
node harness/gates/perf.mjs     --scene examples/scaffold-probe --floors --assert
```
