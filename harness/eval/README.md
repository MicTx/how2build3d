# harness/eval — Skill 价值评测预注册（两臂对照）

> 本文件回答一个问题：带着 how2build3d Skill（`SKILL.md` 渐进披露）做三维场景任务，是否比不带 Skill 更快通过门禁、观感更接近参考？
> 方法是两臂对照实验：with-skill vs without-skill。**提示、臂定义、指标、样本量与盲评方式在执行前预注册钉死**（本文件），防止事后挑指标；
> 实际执行需 user 提供 agent 命令与预算（Parked P1，spec 包 `2026-11-19_skill-eval-disclosure`）：未授权前 `harness/eval/run.mjs` 只允许 `--dry-run`，不得生成 `evidence/eval/report.json`。

## 预注册

- 登记 schema：`how2build3d/skill-eval-prereg@1`。机器可读真源是本文件唯一的 fenced json 块（见「机器可读预注册块」），人读表格是它的展开，**二者必须一致**：改一处必须同步另一处。
- 登记日期：2026-11-20。冻结后不得改动提示文本、臂定义、指标方向与判读门槛；发现缺陷走 spec 包修订留痕，不在结果出来后追改。
- 运行入口（由 task-eval-runner 交付）：`node harness/eval/run.mjs --dry-run --assert --out <plan.json>` 生成两臂计划；`--execute` 缺 `--agent-cmd` / `--budget-usd` 时 exit 2 并打印 Parked P1 指引。

## 任务提示

三条提示对应门禁矩阵前三行的任务类型（质感复刻 / 元素对拍 / 玩法链路）。每条都是自包含的一句话任务书：**两臂收到逐字相同的文本**，差异只在是否注入 Skill（见「两臂设计」）。

### P1 质感复刻（taskType=质感复刻，tier=visual）

> 用 Three.js 从零构建一个黄昏雨后海滨堆场场景：天空、海面、湿地反射、锈蚀材质与后处理齐备，只允许程序化生成资产，产出一个浏览器可直接打开、可截图评审的单文件场景。

评估面：R0 参考研究是否先于构建发生（参考源 ≥3、覆盖矩阵配额核对）、渲染链八系统观感（材质分层 / 体积 / 大气 / 光晕四问）。

### P2 元素对拍（taskType=元素对拍，tier=full）

> 用 Three.js 构建一个不少于 15 族环境元素的完整场景（props、贴花、材质、纹理、天空、海面、地面、天气、后处理、阴影、敌人、武器、特效、音频、HUD、布局），逐族申报 used / N/A 并给出证据，不许静默缺席。

评估面：18 族申报结构、used 族下限、逐族证据、规模漂移是否对照基线。

### P3 玩法链路（taskType=玩法链路，tier=game）

> 用 Three.js 实现一个可玩的第三人称射击训练场：物理移动、关卡布局、敌人波次与自动战斗齐备，60 秒自动战斗必须可复跑并落可读报告。

评估面：物理 / 导航 / 关卡 / 令牌 / 自动战斗链路完整性与会话可复算性。

## 两臂设计

| 臂 | 定义 | 注入物 |
| --- | --- | --- |
| with-skill | 任务提示 + how2build3d Skill | `SKILL.md`（渐进披露：常驻 ≤20 KB；按任务加载单篇 reference ≤13 KB、每次 ≤3 篇；单次注入合计 ≤64 KB） |
| without-skill | 仅任务提示 | 无：不注入 `SKILL.md`、`references/`、`.distill/`、`assets/index.md` 等任何本仓库文档 |

- 臂间唯一差异是 Skill 的有无：同一 agent 命令、同一预算、同一硬件、同一评审环境。
- 臂标签对盲评员不可见；样本去标签后随机顺序呈现。

## 指标

| 指标 | 机器名 | 定义 | 方向 |
| --- | --- | --- | --- |
| 门禁通过数 | gatePassCount | 按该提示对应矩阵行的「必跑门禁」逐项运行，统计通过条数 | 越高越好 |
| 参考对拍 delta | referenceParityDelta | 同机位渲染 vs 参考图并排对拍后仍未回灌 GAP 表闭合的 delta 条数 | 越低越好 |
| 盲评分 | blindScore | 盲评员按 1–5 锚点量表对产出场景打分，每臂取均值 | 越高越好 |

- gatePassCount 与 referenceParityDelta 由 runner 机器复算；blindScore 由盲评员人工给出。
- 任一臂样本缺失时该项指标记 UNKNOWN，不得用另一臂数据补齐。

## 样本量与盲评

- 样本量：每臂每提示 3 个独立样本（samplesPerArm=3），全实验 2 臂 × 3 提示 × 3 样本 = 18 次运行；样本间只换随机种子，不换提示文本。
- 盲评方式：3 名盲评员，评前不接触本仓库；样本去臂标后随机顺序呈现；每样本按 1–5 锚点量表打总分并留一句评语（构图 / 质感 / 动效各一）；评员不知道 with-skill / without-skill 分组与实验假设。
- 判读门槛（预注册钉死）：with-skill 臂判优需同时满足 gatePassCount 均值高于对照、referenceParityDelta 均值不高于对照、blindScore 均值高出 ≥0.5 分；否则记「未见显著差异」，不事后找补。

## 门禁矩阵

矩阵固定放本文件（Decision 2026-11-19：不放 `references/12-full-scene-assembly.md`，也不放根 README，避免多包共改一处）。评测任务按任务类型查表拿「必跑门禁」，gatePassCount 以本表为准。

| 任务类型 | 必跑门禁 | 示例 | tier |
| --- | --- | --- | --- |
| 质感复刻 | `node harness/gates/r0.mjs --scene <dir>`、`node harness/gates/assets.mjs --scene <dir>`、`node harness/gates/inspect.mjs --scene <dir>`、`node harness/gates/visual.mjs --image <png>` | `examples/quality` | `visual` |
| 元素对拍 | `node harness/gates/complete.mjs --scene <dir>`、`node harness/gates/parity.mjs --scene <dir>` | `examples/parity` | `full` |
| 玩法链路 | `node harness/gates/gameplay.mjs --scene <dir>` | `examples/gameplay` | `game` |
| 全场景装配 | `node harness/gates/complete.mjs --scene <dir>`、`node harness/gates/perf.mjs --scene <dir> --assert`、`node harness/gates/webgpu.mjs --scene <dir>` | `examples/starter` | `full` |

- tier 语义沿用 `references/11-element-parity.md`：`full` 逐族下限生效，`visual` / `game` 只做结构与广度检查；质感复刻的 R0 参考研究前置由 `r0.mjs` 门禁体现。
- 行内 `<dir>` 指评测样本的产出目录，`<png>` 指其评审截图；构建与真实渲染验收命令（如 `node harness/render/scene.mjs --scene <dir> --assert`）是门禁前置，不计入门禁通过数。
- 第四行（全场景装配）本轮无对应提示，留作后续扩展，不进入本预注册的 18 次运行。

## 机器可读预注册块

`harness/eval/run.mjs` 只解析下面这个 fenced json 块（本文件唯一的围栏代码块）；它与上文人读表格一一对应：

```json
{
  "schema": "how2build3d/skill-eval-prereg@1",
  "registeredAt": "2026-11-20",
  "arms": ["with-skill", "without-skill"],
  "prompts": [
    {
      "id": "P1",
      "taskType": "质感复刻",
      "tier": "visual",
      "text": "用 Three.js 从零构建一个黄昏雨后海滨堆场场景：天空、海面、湿地反射、锈蚀材质与后处理齐备，只允许程序化生成资产，产出一个浏览器可直接打开、可截图评审的单文件场景。"
    },
    {
      "id": "P2",
      "taskType": "元素对拍",
      "tier": "full",
      "text": "用 Three.js 构建一个不少于 15 族环境元素的完整场景（props、贴花、材质、纹理、天空、海面、地面、天气、后处理、阴影、敌人、武器、特效、音频、HUD、布局），逐族申报 used / N/A 并给出证据，不许静默缺席。"
    },
    {
      "id": "P3",
      "taskType": "玩法链路",
      "tier": "game",
      "text": "用 Three.js 实现一个可玩的第三人称射击训练场：物理移动、关卡布局、敌人波次与自动战斗齐备，60 秒自动战斗必须可复跑并落可读报告。"
    }
  ],
  "metrics": ["gatePassCount", "referenceParityDelta", "blindScore"],
  "samplesPerArm": 3,
  "blindReview": "3 名盲评员，评前不接触本仓库；样本去臂标后随机顺序呈现，按 1–5 锚点量表打分并留一句评语；评员不知道 with-skill / without-skill 分组与实验假设。",
  "judgement": "with-skill 判优需同时：gatePassCount 均值 > without-skill；referenceParityDelta 均值 ≤ without-skill；blindScore 均值 ≥ without-skill + 0.5。否则记未见显著差异。",
  "execution": {
    "status": "parked",
    "requires": ["--agent-cmd", "--budget-usd"],
    "report": "evidence/eval/report.json",
    "note": "未获 user 授权前只允许 --dry-run（计划 status=not-run）；--execute 缺授权参数必须 exit 2，落 report 即伪造证据。"
  }
}
```

## 执行与证据边界

- 实际两臂执行、盲评主持与 `evidence/eval/report.json` 生成是 Parked P1：需 user 提供 agent 命令（`--agent-cmd`）与预算（`--budget-usd`）。
- `--dry-run` 只写计划文件（schema `how2build3d/skill-eval-plan@1`、`status=not-run`、两臂指标骨架全 null），绝不写 report。
- 报告归档后本文件的预注册字段不得回改；复算以同一条计划文件为输入。
