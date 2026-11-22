# 01 · 文件解剖：一个 HTML 如何装下一台游戏

> 素材源：`sources/jimao-3a-game/index.html`（Saltline，1,425,707 字节，6,215 行）。
> 本篇所有数字来自 `node harness/capture/bundle.mjs`、`node harness/boot.mjs --probe` 的实测输出，所有断言挂 `[src:Lx-Ly]` 引用。

## 分层结构

整个文件只有五个物理部分，没有任何"资源文件"概念 [src:L1-L7]：

| 层 | 内容 | 位置 | 字节 |
| --- | --- | --- | --- |
| 元信息 | doctype、viewport、标题 | L1-L7 | ~1.0 KB |
| CSS | 340 行设计系统，含 token 变量 | L8-L349 | 31,502 B |
| DOM | 一个 canvas + 一个 UI 容器 | L351-L352 | 281 B |
| JS | 一个 `<script>`，esbuild 打包产物 | L359-L6213 | 1,393,607 B |
| 尾部 | `</script></body></html>` | L6214-L6215 | ~3.6 KB |

DOM 层薄到极致：`<canvas id="view" tabindex="0"></canvas>` 与 `<div id="ui"></div>` 两行就是全部静态结构 [src:L351-L352]。标题屏、HUD、设置面板、触屏控件全部由 JS 在运行时生成——UI 是"程序"而不是"页面"。

CSS 是一个完整设计系统而非样式堆：`:root` 里 十七 个语义 token（`--ink`、`--bone`、`--signal`、`--rust`…），并用 `env(safe-area-inset-*)` 做异形屏适配 [src:L11-L23]。文件头注释明确写着它的身份与分区："game/ui.css — owned by the Game agent … Sections: tokens · page + boot · HUD · radio · touch controls · menus · panel · motion preferences" [src:L8-L10]——这是多角色协作构建留下的组织痕迹。

JS 层是唯一的重头（97.7% 体积）。它是**单 IIFE 的 esbuild 产物**：`(()=>{var _M=Object.defineProperty;…` 开始 [src:pretty:L1-L25]，先打包上游 three r180（压缩、变量名压成 1-2 字符），再接 app 代码。JS 内部可读性分层十分明显：

- **上游 three 部分**（约 七十万一千八百一十九 B，50.4%）：全压缩，连 `FileLoader` 的 `fetch()` 也压在一起 [src:pretty:L7375-L7399]。
- **app 部分**（约 691,788 B，49.6%）：JS 逻辑同样压缩，但 **GLSL 以模板字符串原文保留**。分界可以精确到字符：three 的 `WebGLRenderer 以 outputColorSpace setter 收尾，紧接着第一条 app 语句是场景常量 var oi={min:new W(-四十,0,-三十),max:new W(四十,三十,三十),groundY:0,seaY:-1.6,quayX:三十}（港区可行走范围、地面与海面高度、码头坐标）——这一行同时还是画质分级、玩家体型、太阳方向的常量表 [src:pretty:L1044-L1068]。因为 esbuild 把模块拼在同一物理行，行号只能给 ±1 行的粗界，harness/capture/bundle.mjs` 用字符偏移（char-in-js = 701,819）做精确分界。

## 体积预算

| 预算项 | 实测值 | 说明 |
| --- | --- | --- |
| 游戏本体 | **1,425,707 B**（1.36 MiB） | 逐字节等于上游仓库 README 声明的数字 |
| CSS | 31,502 B（2.2%） | 340 行，token + 组件 + 触屏布局 |
| DOM | 281 B（0.02%） | 2 个标签 |
| JS/three r180 | 701,819 B（49.2% 全文件） | 渲染引擎 + 全部着色器基建 |
| JS/app | 691,788 B（48.5% 全文件） | 场景、玩法、程序化资产、音频 |
| 外部资产 | **0 B** | 无 `<img>`、无 `<script src>`、无 `<link stylesheet>`、无任何 `.png/.mp3/.glb` 文件名 |

app 区内还散布着 二百零一 段中文 UI 文案字符串（全为运行时生成）与 88 行 JS 注释 [src:pretty:L51928-L51952]。一百零九 个模板字符串以 GLSL 特征开头（`` `#ifdef ``、`` `void main ``、`` `uniform `` 等），是着色器的宿主 [src:L4192-L4195]。

三条自定义着色器区块以全大写注释自我标注，是 app 端着色器工程的"文件名"：

- `// SALTLINE_SKY`——程序化天空（云层、太阳、闪电、海雾）[src:L4207-L4212]
- `// SALTLINE_SHADOW`——通过**字符串手术**替换 three 的 `shadowmap_pars_fragment`：`It.shadowmap_pars_fragment=s.slice(0,o)+l+s.slice(a)`，注入软阴影 [src:L4349-L4351]
- `// SALTLINE_POST`——后处理（丁达尔光柱等）[src:L4349-L4351]

材质级注入用 5 个具名缓存键标记：`saltline-blink`（发光体闪烁）[src:pretty:L18627-L18651]、`saltline-gulls`、`saltline-apron-3`、`saltline-sea-1`、`pac9-detail-` [src:pretty:L5607-L5631]，全部经 `customProgramCacheKey` 暴露 [src:pretty:L18627-L18651]。

## 为什么 1.4 MB 是可能的

答案是上游 README 那句判断的可执行版本：**素材没有保存成文件，保存成了"生成这些素材的代码"**。本篇给出三条实测证据：

1. **零外部请求**。`harness/capture/bundle.mjs` 的资产审计：`externalImages=0, audioFiles=0, imageFiles=0, modelFiles=0, scriptSrc=0, linkStylesheet=0`。JS 里仅有的 3 处 `fetch(` 全部位于 three 区域的 `FileLoader`/`ImageBitmapLoader` 死代码路径（app 区域 0 处）——加载器被打包进来却从未被投喂真实 URL。
2. **运行时自举**。`node harness/boot.mjs --assert-ok` 在 headless Chrome（SwiftShader）下启动：WebGL2 上下文建立、`window.__errors` 为空、rAF 心跳持续推进——所有画面与声音都在页面内合成，无需网络。
3. **配置即内容**。一个画质分级表就换算出整条视觉预算：`test/low/medium/high/ultra` 五档各含 scale, msaa, shadow, tex, volSteps, ao, planar, bloom, motionBlur, rain 十个旋钮 [src:pretty:L1044-L1068]；玩家体型（eye:1.68, crouchEye:1.05, radius:.32, height:1.8, fov:七十四）与太阳方向 dir:(.916,.225,.331)、颜色 `(1,.72,.42)`、强度 `9` 同表存储 [src:pretty:L1044-L1068]。世界不是建模出来的，是**参数化出来的**。

对建设者的直接启示（蒸馏详见 `.distill/distillation/`）：单文件不是目标而是**约束**——它强制所有资产走程序化路线、强制预算显式化（画质表）、强制 UI 即代码。这份指南的其余部分会把这三件事拆开讲透。

## 复现

```bash
node harness/capture/bundle.mjs --assert     # 分界与体积预算（断言全部通过）
node harness/capture/prettify.mjs --assert         # 展开压缩 JS → evidence/frames/app.pretty.js（59,624 行）
node harness/boot.mjs --assert-ok          # 无外部依赖启动 + 零错误校验
node harness/capture/frames.mjs --assert   # bench 模式实测 draw call / program / 帧时
```
