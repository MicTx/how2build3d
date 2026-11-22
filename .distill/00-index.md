# 00 · 理解篇总索引：读完这九篇，就理解了这个文件

> 本索引串起理解篇九篇报告。每篇都可独立复现（`harness/` 命令）+ 全部断言挂行号引用。
> 素材源：`sources/jimao-3a-game/index.html`（1,425,707 B，零外部资产）。

## 阅读顺序

**先读结论再读细节**。建议路径：

1. **[01 文件解剖](./understanding/01-anatomy.md)** — 知道"1.4 MB 装一台游戏"的四层体积预算与 three/app 分界（字符级 七十万一千八百一十九 B 分界点 [src:pretty:L1044-L1068]）。
2. **[09 运行时性能画像](./understanding/09-runtime-profile.md)** — 拿到一帧的账本（p50 三百二十 draw calls、1.8M tris、二百六十八 programs、一百八十六 段最终 GLSL），建立预算直觉 [src:pretty:L7000-L7024]。
3. **[02 模块地图](./understanding/02-module-map.md)** — 二十个子系统的静态/运行时双证据清单 [src:L4207-L4212]。
4. **[03 渲染管线](./understanding/03-render-pipeline.md)** → **[04 材质系统](./understanding/04-material-system.md)** — 管线的排班、注入的工法（9 处 onBeforeCompile）[src:pretty:L18627-L18651]。
5. **[05 程序化资产](./understanding/05-procedural-assets.md)** → **[06 音频系统](./understanding/06-audio-system.md)** — "素材即生成代码"的两条主链 [src:L4206-L4206] [src:pretty:L921-L945]。
6. **[07 玩法系统](./understanding/07-gameplay-systems.md)** → **[08 UI/HUD](./understanding/08-ui-hud.md)** — 手感调参表与 UI 设计系统 [src:pretty:L1044-L1068] [src:L11-L23]。

读完可直接进入蒸馏层：`.distill/distillation/00-philosophy.md`（哲学）→ `01-methodology.md`（工作流）→ `02-techniques.md`（技巧卡）→ `recipes/`（配方）→ [`creation/00-index.md`](./creation/00-index.md)（创物篇：18 族逐族构建法则、完整链路与思维链）。

## 结论级摘要

| 篇 | 一句话结论 |
| --- | --- |
| 01 | 97.7% 体积是 JS，一半是引擎一半是"配方"；零外部资产是约束也是解法 |
| 09 | 预算先于内容：像素预算（low 档 1e6）与 draw call（p50 三百二十）在启动期就被锁死 [src:pretty:L1044-L1068] |
| 02 | 二十个系统靠三条线索可辨：SALTLINE_ 区块、saltline- 缓存键、CSS 分区注释 [src:pretty:L18627-L18651] |
| 03 | 自研单 pass 后处理 + 双相机（主 七十四°/枪 五十四°）+ 自适应分辨率 + 全链路降级 [src:pretty:L7000-L7024] |
| 04 | 75.7% GLSL 作者手写；注入四步纪律（prepend 声明 → 锚点替换 → 保语义 → 给缓存键）[src:pretty:L18627-L18651] |
| 05 | 一张共享 256² 噪声纹理 + fbm 覆盖所有表面；Canvas 排版引擎做标识 [src:L4192-L4195] [src:pretty:L33030-L33054] |
| 06 | 五十七 种声音规格全合成，规格表驱动；音乐五声部按战斗强度混音 [src:pretty:L921-L945] |
| 07 | 手感 = 三张常量表（移动/武器/任务），含 coyote/jumpBuffer/recoil 宽容输入 [src:pretty:L921-L945] |
| 08 | 三十一点五 KB CSS 设计系统（十七 token + 分区注释），UI 即代码 [src:L11-L23] |

## 贯穿全篇的五条判断

1. **约束即设计**：单文件不是结果而是手段，它逼出程序化资产、预算表、UI 即代码三个必然 [src:L1-L7]。
2. **确定性可复现**：seed 四千二百七 贯穿噪声、音效、刷兵，同一输入同一世界 [src:pretty:L51928-L51952]。
3. **预算前置**：编译、合成、生成全部在 `onLevelReady` 前完成；运行期只做查表与混合 [src:pretty:L7000-L7024]。
4. **降级是设计的一部分**：高级管线失败退前向、软阴影手术失败退 stock PCF、无声模式 bench [src:L4296-L4296] [src:pretty:L7000-L7024]。
5. **可检视性**：window.__G 与 __stats() 是作者留的检视协议——作者预期你"看"，而不只是"玩" [src:pretty:L51928-L51952]。

## 证据与复现

```bash
node harness/capture/bundle.mjs --assert      # 01 篇：分界与体积
node harness/capture/frames.mjs --assert    # 09 篇：帧级统计
node harness/capture/shaders.mjs --assert   # 02/04 篇：186 段最终 GLSL
node harness/analyze/chunk-diff.mjs --assert       # 04 篇：与上游 109 chunk diff
node harness/analyze/profile.mjs --assert    # 09 篇：性能画像
node harness/gates/doc.mjs --all            # 全部门禁
node harness/gates/citations.mjs --all            # 全部引用合法性
```

**证据可信度排序**（本项目遵循）：运行时实测 > 最终 GLSL 明文 > 原始行号静态阅读 > 注释。
