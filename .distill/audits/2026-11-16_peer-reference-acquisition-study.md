# 同类项目研究 · 参考图获取与细节挖掘（2026-11-16）

> 目的：为增强 R0「找更多参考图、挖更多细节」做同类项目调研。
> 方法：GitHub / arXiv 公开资料研读，每条结论标注出处 URL。
> 范围：不引入外部依赖，只吸收方法论，落到 `references/05-reference-research.md` 的增强。

## 样本与关键结论

### 1. Holodeck（allenai/Holodeck，CVPR 2024，语言→3D 具身环境）

- 出处：<https://github.com/allenai/holodeck>（README，2026-11-16 读）
- 做法：LLM 生成**结构化场景规格**（房间类型/材质/灯光/约束），不是直接生成坐标；
  资产选择用「描述驱动的检索」——对 Objaverse 资产做标注，再按
  LLM 给出的**自然语言描述**做特征匹配（CLIP 特征库）选出最贴切资产。
- 可借鉴（→ R0 增强）：
  - **规格先于坐标**：参考研究产出结构化属性描述（形容词级），再映射到具体资产/参数；
    R0 的 16 类决策表正是这个形态，应保留并强调「描述→检索」的顺序。
  - **检索用"描述"而非"名字"**：找参考资产/参考图时用属性句
    （"weathered wooden fishing crates stacked by a harbor wall"），
    比单词查询命中率高；这直接支持 R0 的查询派生规则。

### 2. SceneCraft（Hu et al., 2024，LLM Agent → Blender 脚本渲染复杂场景）

- 出处：<https://arxiv.org/abs/2403.01248>（摘要，2026-11-16 读）
- 做法：场景图蓝图（空间关系）→ 数值约束布局 → **渲染图像交回
  VLM（GPT-V 类）评审，迭代 refinement**；配 library learning 把常用脚本函数
  沉淀为可复用库。
- 可借鉴（→ R0 增强）：
  - **渲染图当参考的"对照组"**：构建后用真实参考图与同机位渲染图并排对比，
    让视觉模型/人按"逐图分解"同模板审出 delta，回灌 GAP 表——把 R0 从
    "一次前置"升级为**闭环**（本仓库已有截图证据链与九展厅，落点天然存在）。
  - **可复用库**：与本项目"配方而非素材"铁律同构，佐证资产层路线。

### 3. three-geo（w3reality/three-geo，1.4k★，three.js 真实地形）

- 出处：<https://github.com/w3reality/three-geo>（README，2026-11-16 读）
- 做法：输入 GPS 坐标 + 半径 + zoom，从 Mapbox 拿 RGB 编码 DEM + 卫星瓦片，
  近实时生成卫星贴图地形 THREE.Mesh；提供 proj/projInv 把经纬度映射到 WebGL 坐标。
- 可借鉴（→ R0 增强）：
  - **地理数据是"硬参考"**：地形/水文（要素 1/2/10）可用权威地理数据源
    （DEM/卫星图/OSM 轮廓）替代"拍脑袋地形"；R0 渠道表补这一源。
  - **坐标即尺度**：真实坐标给出真实比例，免掉比例失真类 GAP。

### 4. BlenderGIS（domlysz/BlenderGIS，8.3k★，真实地理数据进 DCC）

- 出处：<https://github.com/domlysz/BlenderGIS/wiki>（首页算子清单，2026-11-16 读）
- 做法：Basemaps / Get OSM / Get SRTM 三类 web geodata 算子：底图、OSM 建筑
  轮廓+属性、SRTM 高程，全部可导入为几何/纹理。
- 可借鉴（→ R0 增强）：
  - **三源对应三数据类型**：底图（图像）、OSM（结构化属性）、SRTM（高程数字）——
    R0 的"权威文本>图纸>图像"优先序可以落到具体数据源：SRTM/OSM 数值
    优先于航拍目测；"Georender/Geophotos"（带地理配准的渲染/照片）进一步支持
    **同机位对拍**思路。

## 综合 → R0 增强设计（落在 references/05-reference-research.md）

| 借鉴点 | 来源 | 落地 |
| --- | --- | --- |
| 描述式检索（属性句>关键词） | Holodeck | 新增「查询派生」小节：16 类要素 → 属性句查询模板（多语言） |
| 权威地理数据作硬参考 | three-geo / BlenderGIS | 渠道表加「权威地理数据」行（DEM/卫星/OSM） |
| 渲染-参考对拍闭环 | SceneCraft | 新增「参考对拍」小节：同机位/同时刻渲染 vs 参考图并排审 delta → 回灌 GAP |
| 归档纪律（记录出处/许可） | BlenderGIS 数据源许可实践 | 新增「参考归档与许可」小节：manifest 模板，观察入仓、图像外链 |

## 不采用

- 直接集成 Mapbox/OSM 拉取管线：违反本仓库「零外部资产」贯穿门禁（离线单文件约束），
  只作为 R0 研究期渠道，不进运行时。
- Objaverse/CLIP 资产检索：与本仓库程序化生成资产路线冲突，仅吸收"描述式检索"思想。
