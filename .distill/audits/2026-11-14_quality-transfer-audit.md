# 2026-11-14 · 观感转移审计：从 Saltline 到新场景

> 起因：遵守构建与几何门禁，并不保证新场景能重现 Saltline 的材质、光照与空间层次。
> 本审计逐维度拆差、给出根因编号与修复映射；修复产物即本仓库 v3 变更。

## 一、实测对照

下表以 Saltline 实现为基准，列出移植时应检查的常见退化。公开示例的实渲对照可用 `node harness/render/scene.mjs --scene examples/quality --assert` 重建。

| 维度 | Saltline（案例） | 简化实现的表现 | 差距 |
| --- | --- | --- | --- |
| 材质层 | SL 表面注入：triplanar、ORM 打包（AO/粗糙/金属）、macro 变化、湿/流挂/水珠、法线-粗糙耦合、alpha-wire mip 渐隐、SL_TINT 贴花、LOOK 分级 [src:pretty:L34156-L34344]；GPU 纹理工厂 MRT 出 albedo+ORM+法线 [src:pretty:L32449-L32540] | 只有 albedo 纹理和标量 roughness/metalness | 缺少法线、粗糙度与遮蔽变化 |
| 后处理 | RT_scene→shafts→composite→post-chain（AgX 拟合+暗角+色差+光斑+自适应曝光）→post-aa（Kawase AA+亮度加权颗粒），读写分离 [src:L4349-L4550] [src:pretty:L31108-L31132] | 用单 pass bloom 代替整条链路 | 无 AA，自适应曝光丢失 |
| 阴影/反射 | PCSS（Vogel 盘+blocker search+receiver-plane bias）[src:L4296-L4348]；湿地 SSR 水洼镜面/湿沥青拉伸 [src:L5661-L5728] + 平面反射 | 库存 PCFSoft；无任何反射 | 资产未消费 |
| 体积/环境 | 光柱积分（VOL_STEPS 十二–四十）[src:L4425-L4450]；PMREM 环境；云甲板天空 [src:L4207-L4295] | HemisphereLight 常数 + 渐变天空 | 资产未消费 |
| 氛围 | 雨、湿、雾、闪电事件、大气透视 | FogExp2 + 星点夜景；夜景浑浊无光晕 | — |

模型轮廓对齐之后，仍需单独验收反光、材质分层与体积光。

## 二、根因（skill 侧 R1–R7）

- **R1 工作流零路由**：九阶段表 S4/S5/S6 的动作是抽象指令（"onBeforeCompile 四步""单 pass 后处理"），从不指向 `assets/`。模型按字面重造低配轮子（4-tap bloom / 渐变天空 / 纯色材质）。
- **R2 无可运行消费者**：全资产接入的原型在 `prune-scenes` 提交中删除；`examples/starter` 是红盒子画面，把「合格输出」锚定拉低。
- **R3 材质系统未蒸馏**：`assets/` 只有 6 个 pass 级 GLSL；真正决定质感的 SL 表面注入与 GPU 纹理工厂（上游手写代码的两大主体）不在任何交付物里。
- **R4 校准参数藏在隐藏目录**：接入纪律与标定表只在 `.distill/distillation/06-visual-assets.md`，工作流文档不引用；且其中部分标定是移植小场景口径，与上游原生配置（uCA 0.0013 / bloom 0.065 / agxMix 0.25 / volSigma 0.0034 / 自适应曝光 key 0.12 [src:pretty:L31361-L31387]）混用会直接跑偏。
- **R5 门禁全是工程指标**：draw call/确定性/文档结构绿即可交付；没有资产消费检查、没有感知质量下限。
- **R6 R0 只对几何保真**：12 类要素与 GAP 表没有观感维度（光照情绪/反射与湿润/后处理风格/材质磨损层级），模型修完体量就通过了。
- **R7 验收无观感锚点**：没有「近景数材质分层/中景看体积/远景看大气/夜景看光晕」的四问，验收只覆盖 UI 流程与几何断言。

## 三、修复映射（本次 v3 交付）

| 根因 | 修复 |
| --- | --- |
| R1 | SKILL.md 九阶段表加「资产路由」列；S6 出口硬检查点「资产消费清单」（八系统逐项 used/N/A）；铁律 #2「资产先于重写」 |
| R2 | 新 `examples/quality/`：全资产接入单文件场景「雨后黄昏堆场」（真实渲染验收绿：0 shader 错误、8 系统全部消费） |
| R3 | 新 `assets/sl-surface.mjs`（333→769 行：七段注入 GLSL + 48 材质目录 + 工厂）与 `assets/sl-textures.mjs`（938 行：5 shader + 27 生成器 + 29 纹理集 + MRT 工厂），逐字移植带 [src:pretty:] 出处 |
| R4 | 新 `references/07-perceptual-quality.md`：材质分层十项清单、光照分层、两套校准口径对照表、失败映射；06 篇标注为移植标定并指向 07 |
| R5 | 新 `harness/gates/assets.mjs`（资产消费门禁：marker/manifest 双模式 + 负向断言）、`harness/gates/visual.mjs`（感知下限：非黑非白/亮度/对比度/色相多样性） |
| R6 | references/05 扩为 16 类（+4 类观感要素）；GAP 模板加「观感 GAP→资产映射」列；R0 验收加「至少一条观感 GAP 有资产映射」 |
| R7 | references/07 第五节「截图四问」验收锚点；SKILL.md S9 接 `--visual-gate` |

另修复：SKILL.md 铁律 #10 文本粘连（重复铁律 #9 尾段）；`.distill` 两处死链 `.distill/screenshots/title.png`（已捕获为 `evidence/frames/saltline-title*.png`）；引用校验器扩展 `src:pretty:` 语法（指向 `evidence/frames/app.pretty.js`），1189 refs 全绿。

## 四、验证记录


- `node examples/quality/build.mjs --assert`：单文件 2.18MB，12 个资产 marker 全命中。
- 真实渲染（SwiftShader）：0 shader 错误，71 draws / 3k tris / q=low；截图见 `evidence/frames/quality.png`（GPU 1×1 乒乓自适应曝光）。
- `node harness/gates/assets.mjs --scene examples/quality`：八系统全部 used。
- `node harness/gates/visual.mjs --image evidence/frames/quality.png`：对比度 RMS 0.24、非黑非白 0.99、色相桶 ≥2，通过。
- `node harness/gates/citations.mjs --all`：1222 refs / 0 problems（新增 `src:pretty:` 引用语法，指向 app.pretty.js）。
- `node harness/gates/skill.mjs .`：0 problems（触发面 25 项全覆盖）。

## 五、结论

**方法论层从来不是瓶颈；被漏掉的是「可执行的观感资产 + 强制消费路径 + 感知验收」三件套。**
蒸馏的产出必须包含第五类「可复用资产」（能直接跑的文件），且工作流要把「消费资产」写成硬检查点——
否则模型会忠实地按抽象指令重造低配轮子，工程全绿、观感断崖。
