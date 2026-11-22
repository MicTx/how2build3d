# baselines — 入库的验收基线

`evidence/` 整体不入库（`.gitignore`），但漂移门禁需要一份**可随仓库分发**的基线。
本目录是唯一例外：两个文件都是从实测产物原样复制的快照，不含手填数字。

## inline-manifest 生成物政策

`examples/parity/inline-manifest.json` 的政策是 **snapshot 入库 + 构建幂等**：该文件是 `examples/parity/build.mjs` 的生成物，以 snapshot 形式入库（可 diff、可评审），构建必须幂等——同一提交上重建结果与 committed snapshot **byte/hash 完全一致**。`harness/gates/repro.mjs --inline-manifest --assert` 用 `git show HEAD` 的 committed snapshot 与重建结果做 byte/hash 对比（`git diff` 仅作辅助），不一致判红；若生成逻辑有意变更，重建后把新 snapshot 一并提交即可。

## 文件

| 文件 | 用途 | 来源（原路径） | sha256 |
| --- | --- | --- | --- |
| `parity.json` | `harness/gates/parity.mjs` 的漂移基线（五项计数 ±15%） | `evidence/parity/baseline.json`（`parity --scene examples/parity --record` 于 2026-11-14T20:01:40.714Z 生成） | `62e064ade55194939f143691236bf56a8659896d98762426bf1d0de48115ae0e` |
| `parity-report.json` | 静态链的报告夹具：`parity --report` 用它做无 Chrome 比对 | `evidence/parity/parity.json`（`complete.mjs --scene examples/parity` 于 2026-11-14T20:04:36.173Z 生成的实测报告） | `37cc4e5c5ba3557246a1e01d0c645cd8adba1f503638c9a57c434d1614402050` |

`parity.json` 记录的五项指标：`drawCalls=188`、`tris=43670`、`materials=48`、`propKinds=19`、`soundSpecs=58`，容差 `tolerance=0.15`。

`parity.mjs` 默认读取 `harness/baselines/parity.json`；旧路径 `evidence/parity/baseline.json` 仅在默认路径缺失时作**只读回退**（不会回写）。已有基线时 `--record` 默认 exit 1 并打印旧/新摘要，必须加 `--force` 才覆盖。

## 再生命令

基线来自真实场景运行（需要系统 Chrome）：

```bash
# 1) 先构建；重建后的场景才能提供新计数
node examples/parity/build.mjs --assert

# 2) 生成九展厅截图证据（evidence/inspect/parity-*.png，gitignored；complete 每厅校验三张）
node harness/gates/inspect.mjs --scene examples/parity

# 3) 生成完整对账报告（evidence/parity/parity.json，gitignored）
node harness/gates/complete.mjs --scene examples/parity

# 4) 现场实测并重录基线（--record 已有基线时拒绝，需 --force）
node harness/gates/parity.mjs --scene examples/parity --record --force

# 5) 把实测报告同步为静态夹具
cp evidence/parity/parity.json harness/baselines/parity-report.json
sha256sum harness/baselines/parity.json harness/baselines/parity-report.json
```

`verify --static` 在干净 checkout / 无 Chrome CI 上运行 `complete --structure-only --no-evidence`：截图是 Chrome 运行产物、不入库，静态链只验结构与资产交叉校验；截图完整性由 `verify --full` 的 `inspect` + 末尾 `complete`（不带 `--no-evidence`）负责。

无 Chrome 环境可用入库夹具重录同一组指标（日志会注明 `recorded fixture`）：

```bash
node harness/gates/parity.mjs --record --force
```

更新后务必把本表里的 sha256 与新值同步，并在提交信息里注明场景改动。

## 归档的 ui-review 截图：6 张历史缺失

`.spec/specs/archive/2026-11-14_quality-transfer/ui-review.json` 的 artifacts 引用了 6 张截图：

- `evidence/after-museum.png`
- `evidence/saltline-game.png`
- `evidence/quality.png`
- `evidence/after-night.png`
- `evidence/after-overview.png`
- `evidence/starter.png`

这些路径从未被 git 跟踪（`evidence/` 自始 gitignored），当前工作树中也不存在（帧证据已迁到 `evidence/frames/`）。它们是**历史缺失**，本仓库不补造、不伪造；需要时用现行门禁重新生成：

```bash
node harness/render/scene.mjs --scene examples/quality --assert
node harness/render/starter.mjs --assert
node harness/gates/inspect.mjs --scene examples/quality
```

新生成的截图落在 `evidence/frames/` 与 `evidence/inspect/`，仍按可再生证据处理，不入库。
