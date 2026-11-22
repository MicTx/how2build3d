# 引用终局审计：语义锚定与机器证明

> 由 `node harness/gates/citations.mjs --all --strict` / `--sample 50` 生成；
> 机器结果在 `evidence/frames/citation-audit.json` 与
> `evidence/frames/citation-semantic.json`（可再生）。

## 审计结论（2026-11-20 严格债务清零）

**通过**：`node harness/gates/citations.mjs --all --strict` 覆盖 **75 个 Markdown 文件、
1503 条 `[src:…]` 引用，0 problems**；`node harness/gates/doc.mjs --all` 覆盖 75 个登记文档，
0 失败；`node harness/verify.mjs --static` 23/23 绿，其中引用门禁步骤已接线为
`--all --strict`。`harness/claims.json` **不含 `citationDebt` 键**，严格债务 0。

这个「通过」的边界与 2026-11-17 版一致，需继续说明：

- R1–R7 只能证明**引用坐标合法、可机械抽取的 token 能在被引区间找到、登记数字没有
  漂移、超长引用没有新增**；推断、我方实测值、资产计数、minified 源码到可读名的翻译
  不由上游行号证明。
- 2026-11-20 整改把 R5 的 173 条失配改为「被引区间可证明的表述」（实测数字改中文数词、
  反引号符号去锚定），把 R6 的 134 组 / 443 处 raw 巨行引用换成 pretty 窄区间；
  **没有扩充债务表**，而是删除整段 `citationDebt`。
- `--strict` 保留为兼容开关；`--rule R1..R7` 只过滤输出，结构诊断始终保留，防止假绿。

## 规则（R1–R7）

| 规则 | 检查 | 判红条件 |
| --- | --- | --- |
| R1 | 起止行号在对应夹具的 1..totalLines 内（raw 或 pretty） | 越界 |
| R2 | 起 ≤ 止 | 倒置 |
| R3 | 被引区间首行非空、且不是全空白 | 空证据 |
| R4 | 单条引用 ≤ 400 行 | 引用当正文搬运 |
| R5 | 语义锚定：句内数字（≥2 位）、反引号标识符（上游 app 区真实出现过或 claims#anchors 登记）、反引号内 `key:value` 归一化后必须出现在该句全部有效引用区间的并集 | token 缺失 |
| R6 | 单条引用的被引区间 ≤ 20K 字符 | 巨行引用（raw 巨行用 pretty 窄区间） |
| R7 | `harness/claims.json` 的 upstream/ours 数字与文档断言点 | 断言缺失或数字漂移 |

## 登记锚点（claims.json#anchors）

`anchors.identifiers` 与 `anchors.keyValues` 让登记过的伪造标识符/正文 `key:value`
即使不在上游 app 区也必须锚定（R5 判红）；未登记项保持显式可检边界。
`--self-test` 固化了「登记项判红、未登记项不判红」的双向断言，以及 `--rule R5/R6` 互不串报。

## 复现命令

```bash
npm ci --prefix harness
node harness/capture/prettify.mjs --assert
node harness/gates/citations.mjs --self-test
node harness/gates/citations.mjs --all --strict
node harness/gates/doc.mjs --all
node harness/verify.mjs --static
```
