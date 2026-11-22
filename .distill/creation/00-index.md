# 创物篇 · 总纲：Saltline 全元素构建法则

> 分工：理解篇回答「上游是什么」，蒸馏篇回答「它怎么工作」，**创物篇回答「每个元素凭什么这样造、换一个场景怎么再造出来」**。
> 体例：19 个文件 × 四段式（**构建法则 / 完整链路 / 思维链 / 迁移法则**），全部断言挂行号引用；18 族顺序对齐 `harness/element-manifest.json`，另附 4 个从未蒸馏的上游遗留系统。
> 素材源：`sources/jimao-3a-game/index.html`（1,425,707 B，零外部资产）；理解用美化证据 `evidence/frames/app.pretty.js`，引用仍以夹具行号为准。

## 创物公理（跨族十二律）

以下公理由 18 个族文件交叉提炼：每条至少在三个族中独立成立，是「换皮不复用就废」的那一层。

| # | 公理 | 一句话 | 见于（族） | 锚点 |
| --- | --- | --- | --- | --- |
| 1 | **目录先行，参数即资产** | 系统边界由数据表定义（`PROP_SIZES`/`SL_MATERIALS`/`AUDIO_SPECS`/`HUD_TOKENS`/`DECAL_SPECS`），代码只解释表；新增能力 = 加一行目录，不改引擎 | props/decals/materials/textures/audio/hud | [src:pretty:L21333-L21357] |
| 2 | **单一真源，多投影消费** | 同一物理量只存一份，向渲染/查询/音频各投影一次（波表同时喂顶点位移、片元斜率与 CPU 高度；`HOUND_RIG` 同时喂网格与 IK；mask 四通道同源供 GPU 着色与 `wetnessAt` 查询）；**第二份拷贝是漂移源** | sea/ground/enemies/weapon/sky | [src:L5728-L5816] |
| 3 | **把重复压成一次绘制，把变化压进数据** | 材质桶合并键 = 几何键 + 材质键；重复件实例化；变化落在顶点色、UV、图集通道或 uniform 上，而不是新增 draw call | props/decals/fx/textures | [src:pretty:L33030-L33054] |
| 4 | **破损讲历史，物理讲状态** | 不可逆的旧（chip/stain/run 磨损）烘进像素；可逆的湿/脏/亮走 uniform 运行时叠加——烘焙期与运行期的分界线全仓库一致 | materials/textures/ground | [src:L4801-L4936] |
| 5 | **距离换精度** | 精度只花在相机能分辨的尺度：海浪振幅 50→220 m 归零、地面噪声 2.5/6.7/20 m 逐级启用、billboard 尺寸按 `dist*uPx` 钳制 | sea/ground/weather/fx | [src:L5661-L5727] |
| 6 | **数值有界，路径有底** | 一切可调参数双端钳制；每条豪华路径都配一条更土但能出画的退路（PCSS 手术失败退 stock PCF、post 链失败退前向、池满静默丢弃不阻塞） | sky/shadow/post/fx/weather | [src:L4296-L4296] |
| 7 | **预算先行，内容就范** | 先定并发/数量上限再填内容：交战令牌 2/3、同屏敌人 9、雨条 9000、FX 五个 draw call——内容在预算内被选择，不是做完再优化 | enemies/weapon/weather/layout | [src:L6087-L6087] |
| 8 | **相位时间线** | 离散过程写成「时间戳相位 + 一次性事件」而非每帧布尔：换弹 6 相位、波次绝对时间、雷暴倒计时状态——掉帧不漏相位，暂停不误推进 | weapon/loop/enemies | [src:pretty:L51928-L51952] |
| 9 | **边界量化，脏值缓存** | 连续量在写入边界量化（HUD 0.5 px/1°/1 m）并与缓存比对，值不变不写 DOM；音频切固定 4096 样本分片——换确定性、可复现与低分配 | hud/audio/inspect | [src:pretty:L921-L945] |
| 10 | **命名即协议** | `decal_<name>`/`label` 是合图器的发现键，材质桶键、`surface` 语义（metal/wood/concrete/water/glass/enemy）、`saltline-*` 缓存键都是字符串接口 | decals/props/materials/post | [src:L4801-L4936] |
| 11 | **米制语义编译进常量** | `SL_FRUSTUM/SL_DEPTH` 由关卡包围盒 `toFixed(3)` 烧进 shader 字符串；调参语言是米与视直径，不是 texel/UV；常量化的风险由替换前 `indexOf` 布局校验补偿 | sky/shadow/materials | [src:L4207-L4207] |
| 12 | **可观测性一等公民** | `window.__G`/`__stats()`/`?bench`/九展厅/kit.stats() 自报对账——每个系统自带计数器与注入接口，测量能力先于优化需求 | inspect/loop/hud/audio | [src:pretty:L51928-L51952] |

公理之间的依赖：1→7（目录行自带预算字段）；2→3（单源才敢合并）；5→6（近处精细、远处兜底）；8→9（相位是量化的一种）；12 横向监督全部。

## 阅读顺序

**先公理后各族，先资产层近邻后玩法远端**：

1. **[材质](./03-materials.md) → [纹理](./04-textures.md)** — 最底层：目录五元组、注入工法、破损模型的分界线公理在此奠基。
2. **[道具](./01-props.md) → [贴花](./02-decals.md)** — 第一批消费者：尺寸表、合并桶、图集协议演示公理 1/3/10。
3. **[天空](./05-sky.md) → [软阴影](./10-shadow.md) → [后处理](./09-post.md)** — 视觉管线三件套：米制常量、一图多用、降级链（公理 6/11 的最完整样本）。
4. **[海面](./06-sea.md) → [地面](./07-ground.md) → [天气](./08-weather.md) → [特效](./13-fx.md)** — 环境动态四族：单源多投影、距离换精度、可失败预算。
5. **[敌人](./11-enemies.md) → [武器](./12-weapon.md) → [布局](./16-layout.md) → [循环](./17-loop.md)** — 玩法四族：单一尺寸源、预算先行、相位时间线、令牌公平性。
6. **[音频](./14-audio.md) → [HUD](./15-hud.md) → [检视](./18-inspect.md)** — 外围三族：规格表驱动、边界量化、可观测性闭环。
7. **[上游遗留四系统](./19-legacy-systems.md)** — 海鸥群、菜单开场流、过场相机与 debugCut、简报结算屏：尚未移植的清单与移植切入点。

每篇独立成文，也可按需单查；对照合同用 `harness/element-manifest.json`（18 族 floor 与判红信号）与 `references/11-element-parity.md`。

## 链路模板（新增族怎么写）

新族文件（含未来从遗留系统升级出的族）必须四段齐全，doc 门禁按标题机检：

```markdown
# 创物 · <中文名>（<family-id>）
> 上游锚点：… ｜ 我方资产：… ｜ 对账：element-manifest <id> 族 ｜ 验收：complete 门禁
## 构建法则   ← 3-6 条不变式，每条带 [src:Lx-Ly]
## 完整链路   ← 意图→算法→常量表→上游实现→我方资产→运行时证据→门禁→兜底
## 思维链     ← ≥2 条五段还原（约束→目标→候选→选择→兜底），事实/推断标注
## 迁移法则   ← 资产路由 / 参数重绑点 / 对账行
```

## 推断纪律

上游是压缩产物：凡可由注释、常量、降级分支、缓存键、启动日志钉死的写「（事实）+ 引用」；只能由结果与备选空间反推的写「（推断）」，并在该篇「推断边界」小节交代。**这条纪律与 `.distill/distillation/03-reasoning-traces.md` 一致，是创物篇与臆想的唯一分界线。**

## 证据与复现

```bash
node harness/gates/citations.mjs --all                       # 全部引用合法性
node harness/gates/doc.mjs --all                             # 体量/小节/引用密度
node harness/gates/complete.mjs --scene examples/parity      # 18 族对账（创物篇的实测对应物）
node harness/gates/creation.mjs                              # 创物层结构覆盖（族/索引/导航/注册）
```

**证据可信度排序**（同理解篇）：运行时实测 > 捕获的最终 GLSL > 原始行号静态阅读 > 注释。
