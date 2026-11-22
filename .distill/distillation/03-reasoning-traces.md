# 03 · 思维链：从代码痕迹反推作者的决策顺序

> 源码压缩得只剩行为，但**注释、参数命名、降级分支与错误分诊**留住了推理链。
> 本篇把可复原的决策按"约束 → 目标 → 候选 → 选择 → 兜底"五段还原，并标明
> 哪些是证据、哪些是推断。

## 决策链一 · 单文件约束下的资产路线

**约束**（事实）：仓库只允许一个 HTML——`<!doctype html>` 起首 [src:L1-L7]。零外部请求由 `harness/capture/bundle.mjs` 的资产审计输出字段证明：`scriptSrc=0, imageFiles=0, audioFiles=0`（app 区域 `fetch` 0 处），不是从 HTML 头行推断的。
**目标**（事实）：雨中港区、集装箱、湿地倒影、枪械与机械敌人都要出现 [src:L8-L10]。
**候选**（推断）：A 内联 base64 图片/音频 → 体积爆炸；B 全部程序化生成 → 代码量爆炸但字节小。
**选择**（事实）：B。CPU 生成 256² 噪声纹理 [src:L4206-L4206]、GPU fbm 覆盖所有表面 [src:L4192-L4195]、Canvas 排版做标识 [src:pretty:L33030-L33054]、几何拼装做模型 [src:pretty:L1044-L1068]。
**兜底**（事实）：启动期"6ms/批"让步式合成，避免把 B 的成本压到首帧 [src:pretty:L921-L945]。

## 决策链二 · 天空的美术意图如何变成数学

**约束**：天空要"雨幕中的港区黄昏"，但不能有 HDRI 贴图。
**目标**（注释原文事实）：云甲板向东滚、云底有 ridged 细节、太阳永远从云隙烧穿 [src:L4230-L4251]。
**推理链**（注释逐条可复原）：
1. 远云若保留细节会走样 → 加距离衰减；"fading with distance so the horizon does not alias" [src:L4237-L4237]。
2. 太阳被实云挡住就没戏 → 主动留缺口，写成铁律 [src:L4243-L4251]。
3. 云要有体积感但不想算真体积 → 密度梯度朝太阳当自阴影 [src:L4254-L4259]。
4. 缺口边缘要"烧" → 薄云处暖光 + 冷光透射 [src:L4259-L4269]。
5. 远场要融进地平线 → aerial perspective [src:L4272-L4272]。
6. 太阳盘面不能进环境捕获（否则 PMREM 出火蝇）→ "the directional light is the sun there" [src:L4279-L4291]。

这条链的价值在于：**每一步都是"因为观察到某个失效模式，所以加一条近似"**，而不是先套一个物理模型。

## 决策链三 · 为什么改 three 的阴影 chunk 而不是自己写阴影

**约束**：软阴影需要 penumbra 随遮挡距离变化（PCSS），three 的 PCF 固定半径 [src:L4296-L4296]。
**候选**（推断）：A 自己写一套阴影 pass；B 复用 three 的阴影图与光照管线，只换 `getShadow()`。
**选择**（事实）：B——用 `s.slice(0,o)+l+s.slice(a)` 把 `shadowmap_pars_fragment` 里的 `getShadow` 换成 Vogel 盘采样 + blocker search [src:L4296-L4306] [src:L4349-L4349]。
**兜底**（事实）：先 `indexOf("float getShadow(")` 与 `indexOf("vec2 cubeToUV")` 校验布局，不符就"keeping stock PCF" [src:L4296-L4296]。
**推理**（事实）：注释把单位写死——"metres across the shadow map"、"never bias more than ~0.6 m per kernel"，说明作者先把世界尺度换算成 shadow uv 才敢调参数 [src:L4296-L4296]。

## 决策链四 · 后处理的"两条数据流"

**约束**（推断）：多 pass 带宽在集显/移动端吃紧。
**选择**（事实）：一个全屏 pass 承载 bloom/dirt/streak/flare/CA/vignette 与 damage/lowHealth/ads/flash/fade/saturation/thunder 十三路 uniform [src:L4612-L4613]。
**推理**（源码行为事实）：CPU 侧 `post:{damage,lowHealth,ads,flash,fade,saturation,focusDist,shake,wet}` 状态袋每帧整体写入 [src:pretty:L7000-L7024]——把"镜头"与"状态"合流是为了只上传一次 uniform。
**兜底**（事实）：o.post 标记后处理 shader 是否编译失败，失败立即抛错让外层 catch 切回前向管线 [src:pretty:L7000-L7024]。

## 决策链五 · 可检视性不是事后补的

**证据**（事实）：`?bench` 一键静音+自启+确定 seed [src:pretty:L51928-L51952]；window.__G 暴露引擎上下文 [src:pretty:L51928-L51952]；debugCut() 直达任务终点 [src:pretty:L51928-L51952]；shader 错误按 marker 分诊 [src:L4132-L4132]；HUD 甚至自带 GPU/帧时 p99/stats/errors 打印 [src:L6203-L6203]。
**推断**：作者在开发期就需要反复量化与自动验收，把这些入口作为一等设施留在产品里。这条链最值得抄——**测量能力先于优化需求**。

## 推断边界

凡标"推断"的步骤均无法从压缩源码证实，只能由结果与备选空间反推。可证实的部分一律以行号引用钉死；这正是不臆测的纪律。
