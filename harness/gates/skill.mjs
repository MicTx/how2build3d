/**
 * harness/check-skill.mjs — Skill 交付门禁。
 *
 * 校验：
 *   1. SKILL.md 存在且带 YAML frontmatter（name/description 非空，name 与目录名一致）
 *   2. references/ ≥4 篇且每篇非空（>400B）
 *   3. SKILL.md 内所有相对链接可解析
 *   4. 三阶段覆盖：理解 / 蒸馏 / 构建 三个词在 skill 目录内出现
 *   5. R0 强制前置：SKILL.md 含「R0」与「参考图」标记；references/05-reference-research.md 存在
 *      且通过 ./r0.mjs 的 canonical 校验（16 类要素表 + 多参考 + 覆盖矩阵 + GAP + 参考对拍）
 *   6. snippets/ 至少 2 个 .mjs 且能被 node --check 解析
 *   7. 渐进披露（2026-11-19_skill-eval-disclosure）：frontmatter.version 是合法 semver；
 *      「## 读取预算」表存在、位于「## 何时用」之前，且 常驻/按任务加载/单次上限 三行标签齐全
 *   8. 参考索引裸路径（task-skill-index-check）：「## 参考索引」区内反引号 span 里含 `/` 的
 *      相对路径逐一做存在性校验；http(s)、含 *?<> 的通配符、含空格/等号的命令示例与纯
 *      basename 不在校验范围（防误报）
 *
 * CLI: node harness/gates/skill.mjs .        # skill 主体在仓库根
 *      node harness/gates/skill.mjs --self-test  # mkdtemp 夹具正负样例，不触碰仓库文件
 */

import { readFileSync, existsSync, readdirSync, statSync, realpathSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { validateReferenceR0 } from "./r0.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return fields;
}

/**
 * 参考索引裸路径校验（task-skill-index-check / C4）：只扫 `## 参考索引` 区内的反引号 span，
 * 仅对含 `/` 的相对路径做存在性校验。跳过：http(s) 链接、含 *?<> 的通配符、
 * 含空格/等号的命令示例、纯 basename——这些不是裸路径，报缺失即误报。
 * 返回 { problems: string[], stats: { checked, skipped, missing } }。
 */
export function checkReferenceIndex(dir, skillText) {
  const problems = [];
  const lines = String(skillText).split("\n");
  const start = lines.findIndex((l) => l === "## 参考索引");
  if (start === -1) return { problems: ["SKILL.md 缺「## 参考索引」区（渐进披露合同）"], stats: { checked: 0, skipped: 0, missing: 0 } };
  let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  if (end === -1) end = lines.length;
  const section = lines.slice(start + 1, end).join("\n");

  const stats = { checked: 0, skipped: 0, missing: 0 };
  for (const m of section.matchAll(/`([^`\n]+)`/g)) {
    const span = m[1].trim();
    if (/^https?:/i.test(span)) { stats.skipped += 1; continue; } // 外链
    if (/[*?<>]/.test(span)) { stats.skipped += 1; continue; } // 通配符
    if (/\s/.test(span) || span.includes("=")) { stats.skipped += 1; continue; } // 命令示例
    if (!span.includes("/")) { stats.skipped += 1; continue; } // 纯 basename
    stats.checked += 1;
    if (!existsSync(path.resolve(dir, span))) {
      stats.missing += 1;
      problems.push(`参考索引裸路径不存在: ${span}`);
    }
  }
  return { problems, stats };
}

/**
 * self-test（mkdtemp 夹具，零仓库触碰）：正样例全绿；删掉一个被索引裸路径判红；
 * 通配符/命令示例/纯 basename/外链/区外 span 不误报。
 */
export function selfTest() {
  const tmp = mkdtempSync(path.join(tmpdir(), "h2b-skill-index-"));
  const problems = [];
  const fixtureText = (body) => [
    "---",
    "name: how2build3d",
    "description: fixture",
    "---",
    "## 读取预算",
    "常驻 / 按任务加载 / 单次上限（占位）",
    "## 何时用",
    "占位",
    "## 参考索引",
    ...body,
    "## 配套实现",
    "- `missing/outside-section.md` — 不在参考索引区内，不校验",
  ].join("\n");
  try {
    // 夹具盘面：索引的裸路径全部在位
    mkdirSync(path.join(tmp, "references"), { recursive: true });
    writeFileSync(path.join(tmp, "references", "00-workflow.md"), "fixture\n");
    mkdirSync(path.join(tmp, "assets"), { recursive: true });
    writeFileSync(path.join(tmp, "assets", "index.md"), "fixture\n");
    mkdirSync(path.join(tmp, ".distill", "creation"), { recursive: true });
    writeFileSync(path.join(tmp, ".distill", "creation", "00-index.md"), "fixture\n");

    // ---- 正样例：全绿 ----
    const goodBody = [
      "- `references/00-workflow.md` — 裸路径（应校验且存在）",
      "- `assets/index.md` — 裸路径（应校验且存在）",
      "- `.distill/creation/00-index.md` — 裸路径（应校验且存在）",
      "- `assets/` — 目录裸路径（应校验且存在）",
      "- `references/*.md` — 通配符（不校验，文件本就不存在）",
      "- `node harness/gates/skill.mjs .` — 命令示例含空格（不校验）",
      "- `--scene=examples/quality` — 命令示例含等号（不校验）",
      "- `sea.glsl`、`post-chain` — 纯 basename（不校验）",
      "- `https://example.com/a/b.md` — 外链（不校验）",
    ];
    const good = checkReferenceIndex(tmp, fixtureText(goodBody));
    if (good.problems.length) problems.push(`正样例必须全绿，实际: ${good.problems.join("; ")}`);
    if (good.stats.checked !== 4) problems.push(`应校验 4 个裸路径，实际 ${good.stats.checked}`);
    if (good.stats.skipped !== 6) problems.push(`应跳过 6 个非裸路径 span（通配符1+命令2+basename2+外链1），实际 ${good.stats.skipped}`);

    // ---- 负样例：删掉一个被索引的裸路径 → 判红 ----
    rmSync(path.join(tmp, "references", "00-workflow.md"));
    const bad = checkReferenceIndex(tmp, fixtureText(goodBody));
    if (bad.problems.length !== 1 || !bad.problems[0].includes("references/00-workflow.md")) {
      problems.push(`删掉 references/00-workflow.md 后必须恰好判红该路径，实际: ${bad.problems.join("; ")}`);
    }

    // ---- 区界负样例：缺「## 参考索引」区判红（防空区静默绿）----
    const noSection = checkReferenceIndex(tmp, fixtureText(goodBody).replace("## 参考索引\n", ""));
    if (noSection.problems.length !== 1) problems.push("缺「## 参考索引」区必须判红");
  } catch (err) {
    problems.push(`self-test 崩溃: ${err && err.message ? err.message : err}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  if (problems.length) {
    console.error(`check-skill --self-test FAILED: ${[...new Set(problems)].join("; ")}`);
    return 1;
  }
  console.log("check-skill --self-test OK: 正样例全绿 / 删裸路径判红 / 通配符与命令示例不误报（mkdtemp 夹具，未触碰仓库文件）");
  return 0;
}

export async function main(argv) {
  if (argv.includes("--self-test")) return selfTest();
  const rel = argv.find((a) => !a.startsWith("--")) || ".";
  const dir = path.resolve(ROOT, rel);
  const problems = [];
  const detail = { dir: rel };

  const skillPath = path.join(dir, "SKILL.md");
  if (!existsSync(skillPath)) {
    console.error(`check-skill: missing ${rel}/SKILL.md`);
    return 1;
  }
  const skill = readFileSync(skillPath, "utf8");
  const fm = parseFrontmatter(skill);
  detail.frontmatter = fm;
  if (!fm) problems.push("SKILL.md 缺少 YAML frontmatter");
  else {
    if (!fm.name) problems.push("frontmatter.name 为空");
    if (!fm.description || fm.description.length < 40) problems.push("frontmatter.description 缺失或过短（<40 字符）");
    if (fm.name && fm.name !== "how2build3d" && fm.name !== path.basename(dir)) problems.push(`frontmatter.name(${fm.name}) 与目录名不一致`);

  // 触发面回归（2026-11-13_trigger-description）：description 必须覆盖三维场景 coding 的
  // 中英宽触发面并含自动触发指令——这是「涉及 3D 自动触发」的合同，防退化。
  const TRIGGER_TERMS = {
    // 同义词组：组内任一词命中即算覆盖（description 压缩后仍须覆盖每个语义面）
    english: ["Three.js", "WebGL", "GLSL", "shader", "lighting|光照", "shadow|阴影", "post-processing|后处理", "volumetric|体积光"],
    chinese: ["三维", "场景", "光照", "阴影", "后处理", "体积光", "自动触发|triggers automatically|automatically"],
    frameworks: ["Babylon"],
    reference: ["参考图", "reference images|reference research", "GAP"],
    performance: ["performance|性能"],
    memory: ["memory leak|内存泄漏", "dispose|资源释放"],
    compatibility: ["WebGPU compatibility|WebGPU 兼容"],
    instruction: ["automatically", "MANDATES"],
  };
  const desc = String(fm.description || "");
  const missing = Object.entries(TRIGGER_TERMS)
    .flatMap(([group, terms]) => terms.filter((k) => !k.split("|").some((alt) => desc.includes(alt))).map((k) => `${group}:${k}`));
  detail.triggerTerms = { covered: Object.values(TRIGGER_TERMS).flat().length - missing.length, missing };
  if (missing.length) problems.push(`description 触发面缺失: ${missing.join(", ")}（三维场景 coding 自动触发合同）`);
    if (!fm.version || !/^\d+\.\d+\.\d+$/.test(fm.version)) problems.push(`frontmatter.version 缺失或非合法 semver（x.y.z）: ${String(fm.version)}`);
  }

  // 渐进披露合同（2026-11-19_skill-eval-disclosure）：读取预算表是 SKILL.md 的
  // 「读多少、何时读」硬约束——表缺失、不在「何时用」之前、或缺任一行标签都判红。
  const headingNo = (text, heading) => {
    const i = text.split("\n").findIndex((l) => l === `## ${heading}`);
    return i === -1 ? null : i + 1;
  };
  const budgetNo = headingNo(skill, "读取预算");
  const whenNo = headingNo(skill, "何时用");
  const budgetLabels = ["常驻", "按任务加载", "单次上限"];
  const budgetSection =
    budgetNo == null
      ? null
      : skill
          .split("\n")
          .slice(budgetNo)
          .join("\n")
          .split("\n## ")[0];
  detail.disclosure = { version: fm && fm.version, budgetLine: budgetNo, whenLine: whenNo };
  if (budgetNo == null) problems.push("SKILL.md 缺「## 读取预算」表（渐进披露合同）");
  else {
    if (whenNo != null && budgetNo > whenNo) problems.push("「## 读取预算」表必须位于「## 何时用」之前");
    const missingLabels = budgetLabels.filter((l) => !budgetSection.includes(l));
    if (missingLabels.length) problems.push(`读取预算表缺行标签: ${missingLabels.join(", ")}（常驻/按任务加载/单次上限）`);
  }

  // 参考索引裸路径（task-skill-index-check / C4）：索引区里被反引号包住的相对路径必须真实存在，
  // 否则渐进披露的「按任务加载」承诺指向空文件。跳过规则见 checkReferenceIndex 注释。
  const indexVerdict = checkReferenceIndex(dir, skill);
  detail.referenceIndex = indexVerdict.stats;
  problems.push(...indexVerdict.problems);

  const refDir = path.join(dir, "references");
  const refs = existsSync(refDir) ? readdirSync(refDir).filter((f) => f.endsWith(".md")) : [];
  detail.references = refs;
  if (refs.length < 4) problems.push(`references 只有 ${refs.length} 篇（需 ≥4）`);
  for (const r of refs) {
    const p = path.join(refDir, r);
    if (statSync(p).size < 400) problems.push(`references/${r} 过短（<400B）`);
  }

  // 链接解析
  const linkRe = /\[[^\]]*\]\(([^)#]+)(?:#[^)]*)?\)/g;
  let links = 0;
  for (const m of skill.matchAll(linkRe)) {
    const target = m[1].trim();
    if (/^https?:/.test(target)) continue;
    links += 1;
    const resolved = path.resolve(dir, target);
    if (!existsSync(resolved)) problems.push(`SKILL.md 链接无法解析: ${target}`);
  }
  detail.links = links;

  // 三阶段覆盖
  const corpus = [skill, ...refs.map((r) => readFileSync(path.join(refDir, r), "utf8"))].join("\n");
  detail.stages = { 理解: corpus.includes("理解"), 蒸馏: corpus.includes("蒸馏"), 构建: corpus.includes("构建") };
  for (const [k, ok] of Object.entries(detail.stages)) {
    if (!ok) problems.push(`缺三阶段覆盖：${k}`);
  }

  // R0 强制前置（参考研究与要素规划）：references/05 用 ./r0.mjs 的 canonical 校验
  // （16 类要素表 + 多参考 + 覆盖矩阵 + GAP + 参考对拍）——与场景 R0 门禁同一套判定，
  // 类目负例只在 r0 的 self-test 维护一处，skill 不再自写类目判定（spec F3）。
  detail.r0 = {
    skillMarker: skill.includes("R0") && skill.includes("参考图"),
    researchDoc: refs.includes("05-reference-research.md"),
    checklist: false,
  };
  if (!detail.r0.skillMarker) problems.push("SKILL.md 缺 R0/参考图 标记（R0 是强制前置阶段）");
  const researchPath = path.join(refDir, "05-reference-research.md");
  if (existsSync(researchPath)) {
    const rdoc = readFileSync(researchPath, "utf8");
    const verdict = validateReferenceR0(rdoc);
    detail.r0.checklist = verdict.problems.length === 0;
    detail.r0.stats = verdict.stats;
    if (!detail.r0.checklist) {
      problems.push(`references/05 未通过 R0 canonical 校验（16 类要素表 + 多参考 + 覆盖矩阵 + GAP + 参考对拍）: ${verdict.problems.join("; ")}`);
    }
  } else {
    problems.push("缺 references/05-reference-research.md（R0 方法论文档）");
  }

  // snippets 可解析
  const snipDir = path.join(dir, "snippets");
  const snips = existsSync(snipDir) ? readdirSync(snipDir).filter((f) => f.endsWith(".mjs")) : [];
  detail.snippets = snips;
  if (snips.length < 2) problems.push(`snippets 只有 ${snips.length} 个（需 ≥2）`);
  for (const s of snips) {
    try {
      execFileSync(process.execPath, ["--check", path.join(snipDir, s)], { stdio: "pipe" });
    } catch (err) {
      problems.push(`snippets/${s} 语法错误: ${String(err.stderr || err.message).slice(0, 160)}`);
    }
  }

  console.log(JSON.stringify({ ...detail, problems }, null, 1));
  if (problems.length) {
    console.error(`check-skill FAILED: ${problems.length} problem(s)`);
    return 1;
  }
  return 0;
}

const isDirect = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error("check-skill.mjs crashed:", err && err.message ? err.message : err);
      process.exit(1);
    }
  );
}
