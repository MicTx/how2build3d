# 2026-11-15 · 元素对账与同水准实测审计：上游 Saltline × parity 参照场景

> 对象：`examples/parity`（tier=full 参照场景，Spec 包 `2026-11-15_element-kits` 交付）对照上游 `sources/jimao-3a-game/index.html`（6215 行）的逐族实测。
> 数据源（全部机器产出，未手填）：`evidence/parity/parity.json`（complete 门禁判定）、`evidence/parity/baseline.json`（parity.mjs --record 基线）、`evidence/frames/perf-gate.json`（perf --floors 剖面）、`.spec/specs/archive/2026-11-15_element-kits/runs.jsonl`（6/6 任务 verify 记录）。
> 结论先行：**18 族全部 `used`、数量下限（floor）全部通过、判定 problems 为空**；「同水准」主张的证据边界是本参照场景本身——泛化到任意场景由每场景各自的 complete/perf 门禁负责。

## 实测方法

```bash
node harness/gates/complete.mjs --scene examples/parity   # 逐族 used/n-a + floor 判定 → evidence/parity/parity.json
node harness/gates/perf.mjs --scene examples/parity --floors --assert   # 密度下限 + 预算上限 → evidence/frames/perf-gate.json
node harness/gates/parity.mjs --scene examples/parity     # 对 baseline.json（±15% 容差）回归比对
node harness/gates/inspect.mjs  --scene examples/parity   # 9 展厅 × 3 张编号截图证据
```

- 计数来源是运行时 `window.__PARITY__.counts`（遍历/工厂自报，门禁拒收手填常数）；判定与证据截图同 seed（4207）可复现。
- 性能门禁按 `harness/perf.budget.json` 的约束只引计数类指标（draw call/三角形/program）；SwiftShader 软渲染的帧时绝对值无参考价值，仅作 p50/p99 结构参考。
- 证据链归档：`runs.jsonl` 记录 6/6 任务 verify exit=0（fp=4958e3b0a541）；全电池 16 项 13 绿，2 项环境阻塞（boot 心跳、电池 inspect 300s 超时档）已按 external_blocked 留档并在本包 task_0002 补跑。

## 覆盖矩阵（18 族）

| 族 | 上游计数 | floor（manifest） | parity 实测 | 判定 |
| --- | --- | --- | --- | --- |
| props | 三十五 类占位 + 十七 参数化 builder，约 一百八十 处手写摆放 [src:pretty:L35069-L35106] [src:pretty:L37358-L37375] | 种类≥12、实例≥60 | **19 类 / 60 实例** | ✅ used |
| decals | 22 种 Canvas 贴花 [src:pretty:L33225-L33310] [src:pretty:L33585-L33620] | 种类≥6、场中≥15 | **22 种 / 17 处** | ✅ used |
| materials | 五十一 种命名材质（tint/rough/metal/wet[4]/macro[4]）[src:pretty:L34087-L34160] | 条目≥16 | **48 种** | ✅ used |
| textures | 二十七 个生成器 × 二十九 套纹理集 [src:pretty:L34043-L34086] | 纹理集≥10 | **二十九 套** | ✅ used |
| sky | 云甲板天空 + PMREM `uEnv` [src:pretty:L30644-L30740] | 天空 pass≥1 | **1 pass** | ✅ used |
| sea | 环形网格 + 涌浪 + 猫爪高光 [src:pretty:L45181-L45240] | 海面网格≥1 | **1** | ✅ used |
| ground | mask/detail/normal 三 RT + 二千四十八 标线画布 [src:pretty:L44697-L44860] | 层次≥2、积水块≥3 | **4 层 / 6 块** | ✅ used |
| weather | ~九千 条雨 + 900 溅射 + 雷暴调度 [src:pretty:L45423-L45485] | 雨条≥800 | **4950 条** | ✅ used（雷暴事件 0/1 可选指标未触发，见短板） |
| post | 单 pass 后处理链，系统级 marker [src:pretty:L31177-L31260] | pass≥5 | **5 pass** | ✅ used（bloom 级数 0/2 可选指标，见短板） |
| shadow | PCSS Vogel 盘 十/16 tap [src:pretty:L30840-L30890] | 阴影图≥1、tap≥十 | **1 图 / 16 tap** | ✅ used |
| enemies | 2 型（隼/猎犬）、骨骼 IK、感知 [src:pretty:L56171-L56190] [src:pretty:L57429-L57440] | 类型≥1、刷兵点≥6、rig≥1 | **2 型 / 12 点 / 18 rig** | ✅ used |
| weapon | 9 通道弹簧阻尼、ADS fov 五十二 [src:pretty:L55096-L55120] | 视图模型≥1、通道≥9 | **5 网格 / 9 通道** | ✅ used |
| fx | 十一 API、5 draw call 池 [src:pretty:L48488-L48510] | FX 种类≥5、池≥2 | **十一 种 / 2 池 / 5 dc** | ✅ used |
| audio | `Go` 规格表 + 5 总线 + 2 生成 IR [src:pretty:L50465-L50521] | 规格≥16、声部≥1、总线≥3 | **我方 58 / 5 声部 / 5 总线** | ✅ used |
| hud | 十一 组件 + token 层 [src:pretty:L57923-L57960] | 组件≥6、token≥6 | **10 组件 / 26 token** | ✅ used |
| layout | 四区手写坐标、四十一 刷兵点、五十四 掩体点 [src:pretty:L41500-L41510] [src:pretty:L42102-L42110] | 分区≥2、掩体≥12、目标≥1 | **4 区 / 18 掩体 / 3 目标** | ✅ used |
| loop | 波次表 + 撤离评分 [src:pretty:L58715-L58720] | 波次≥1、目标接入≥1 | **3 波 / 3 目标全接入** | ✅ used |
| inspect | 九展厅注册表 [src:pretty:L59271-L59275] | used 厅≥1 | **9/9 全 used** | ✅ used |

> audio 数字口径：上游 57 条（50 + 5 + 2，可播 55），我方 58 条（51 + 5 + 2，playable 56）；登记见 `harness/claims.json#audio.specs`。

## 性能与预算实测（parity，quality=low 档）

- 预算上限门禁：drawCalls **188**（≤500）、tris **43,670**（≤4,000,000）、programs **23**（≤400）、geometries 95 / textures 99——全部在 `harness/perf.budget.json` 上限内，ok=true。
- 密度下限门禁（--floors）：p50 每帧 **169 draws**（≥8）、三角形/program 下限过——「非空壳」反向门禁通过。
- 结构参考（非真机性能）：p50 帧时 310ms / p99 401.7ms（SwiftShader CPU 渲染，`perf.budget.json` 注明绝对帧时无参考价值）。
- 回归基线：`parity.mjs --record` 已固化 drawCalls 188 / tris 43,670 / materials 48 / propKinds 19 / soundSpecs 58，容差 ±15%；后续改场景跑 `parity.mjs --scene examples/parity` 即得回归红绿。

## 已知短板

1. **两条可选指标未触发**：`weather.thunderEvents` 0/1（雷暴调度未在采样窗口内触发事件）、`post.bloomLevels` 0/2（bloom 金字塔级数未上报）——均为 `required:false`，门禁绿但已记 warning；补齐属场景调参而非 kit 缺口。
2. **超 floor 但低于上游的族**（诚实清单）：雨条 4,950 < 上游 ~9,000（quality=low 档 55%）；刷兵点 12 < 上游 41、掩体点 18 < 上游 54、道具摆放 60 < 上游 ~180——下限合同表达的是「非空壳」底线，追平上游密度是各场景按预算自行抬高 `perf.budget.json` 与布局数据的职责（`element-manifest.json` $comment 即此意）。
3. **环境阻塞未清项**：`boot.mjs` 心跳假红（宿主机 steal 11-49%，`boot.mjs`/夹具零改动，两包连续留档）；电池 inspect 项 300s 超时档在证据阶段 600s 档已实跑绿，本包 task_0002 以 600s 补跑刷新。
4. **视口外的差距**：上游 290 万三角形、110MB 程序化贴图、277 件叉车/89 级岸吊踏板属「参数化近似 + 数量以 floor 表达」的既定取舍（见原计划不做清单），不在 parity 场景的复刻范围。

## 结论

`examples/parity` 以 18/18 族 `used`、floor 全过、预算全绿的实测结果，验证了原 P6 计划的核心主张：**从 `scaffold-scene` 骨架出发、照 `references/12` 装配顺序、由 `complete.mjs` 判红驱动，可以收敛到「9 展厅全 used、元素对账全绿、观感有下限保证」的单文件场景**。技能的元素层合同（manifest ↔ 申报 ↔ 运行时自报）与双向下限门禁（上限防空转、下限防空壳）已在一个完整场景上闭环。剩余差距集中在「密度追平上游」与两条可选指标，均已在要素清单与预算机制内表达，不构成方法论缺口。
