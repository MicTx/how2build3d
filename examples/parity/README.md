# examples/parity — 盐线堆场：元素对账宿主场景（tier=full）

## 场景意图

一句话：**雨后黄昏的盐线集装箱堆场**——闸口、堆场、仓库、码头四区手写布局，海面在码头墙以东铺到地平线；玩家切断三台中继后向码头快艇撤离。
三条美术决定：

1. **材质分层**（观感）：全部网格走 `sl-surface` 材质目录（48 条，triplanar + ORM + 湿法线耦合），湿地积水用 `ssr-wet` 的 mask/detail/marks 四层 + 平面反射前置 pass——湿沥青、漆皮破损、锈流是画面的第一观感。
2. **光照分层**（观感）：低太阳（0.916, 0.225, 0.331）烧穿 `sky-deck` 云甲板，体积光柱从龙门吊与仓库门缝切进堆场；PCSS 软阴影按本场景阴影相机标定（SL_FRUSTUM/SL_DEPTH 手术进 chunk）。
3. **后处理目标**：单 pass `post-chain`（AgX + 暗角 + CA + 镜头污渍 + 自适应曝光）收束为「胶片 + 交换机」的工业质感；bloom 金字塔只收 HDR 发光体（路灯/枪口焰/余烬）。

`__PARITY__.counts` 是 18 族实测计数（kit.stats()/遍历自报），`scene.elements.json` 逐族申报 used——本场景是 P2-P4 元素 kit 的**宿主参照**（assets/index.md 第五节）。

## 参数表

| 参数 | 值 | 说明 |
| --- | --- | --- |
| seed | 4207 | 进 URL，同 seed 截图逐帧可复现（唯一随机源 `H2B.seededRng`） |
| tier | full | 18 族全 used，逐族下限生效（harness/element-manifest.json） |
| 机位 | 主 74° / 武器 54° | 玩家口径（references/01）；展厅机位在 `src/inspect.mjs` 注册 |
| 输出 | `build/parity/index.html` | 单文件，three r180 + 八 GLSL 系统 + sea + 14 kit 内联，零运行时请求 |
| 世界尺度 | 80×80 m 四区（bounds ±40）+ 海面 x>27.5 至 880 m | 手写坐标，无随机撒点 |
| draw call 预算 | 单帧 ≤ 900（含阴影/平面反射/后处理全链） | 铁律 #1：预算先于内容；`perf.budget.json` 同值 |
| 质量档 | low/medium/high（q= 参数） | scale/shadow/tex/volSteps/planar/rain 三档 |
| 雨量 | 9000 雨条 + 900 溅射（档位缩放，下限 800） | weather-kit；仓库室内盒 + 天窗排除 |
| 玩法 | 3 波 {3隼1犬}/{3隼2犬}/{4隼3犬}，maxAlive 6 | 武器脚本节流开火（autoBattle 口径）；玩家行走/视角走 player-kit 真实输入 |

## 方法论

1. **预算先于内容**（铁律 #1）：先写死 draw call / 三角形 / 像素三张上限（`perf.budget.json`），再按 `references/12` 装配顺序往里塞元素。
2. **资产先于重写**（铁律 #2）：八 GLSL 系统 + sea + 十四 kit 全部 `assets/` 原样内联（GLSL 字符串、kit IIFE 命名空间），场景层只做接线与布局，不改资产行为；ssr-wet 的 `SSR_WET_RR` 反射块由 build 按 BEGIN/END 标记切出注入，`ground.mjs` 只消费 `H2B.ssrWetRR`。
3. **装配顺序**（references/12）：world → mats → sky/sea/ground → physics+layout+props → post/weather → fx → player/weapon/enemies → audio → hud → loop(mission) → inspect。倒装会返工。
4. **元素对账**（references/11）：18 族逐族 used；`complete.mjs` 判红点；计数全部 kit.stats()/遍历自报。
5. **自检闭环**（references/08）：每装完一段进对应展厅 `?show=<gallery>` 拍照看图；九厅三张编号截图由 `inspect.mjs` 门禁留证。

## 验收

```bash
node examples/parity/build.mjs --assert
node harness/render/scene.mjs --scene examples/parity --assert --max-draws 900
node harness/gates/inspect.mjs  --scene examples/parity            # 九厅三张证据
node harness/gates/complete.mjs --scene examples/parity            # 元素对账（18 族 + 下限）
node harness/gates/perf.mjs     --scene examples/parity --floors --assert
node harness/gates/visual.mjs   --image evidence/frames/parity.png
node harness/gates/assets.mjs   --scene examples/parity            # 八系统 + sea + 八 kit（kit 结论读本场景 build 产物）
```

`--max-draws 900` 是场景自报预算（README 参数表 + perf.budget.json 同源），单文件装配的 SwiftShader 口径。
资产门禁的 kit 消费结论以内联后的 `build/parity/index.html` 为证据——先跑上面的 build 再跑 assets 门禁（CI 同序）。
