# 02 · 模块与系统地图：二十个子系统的双证据清单

> 证据分两路：**静态** = 原始 fixture 的行号引用（app 区多为压缩巨行，行号即"门牌"）；
> **运行时** = `harness/capture/shaders.mjs` 落盘的最终 GLSL（186 段）与 `capture-frames.mjs` 的实测统计。
> 展开后的可读源码在 `evidence/frames/app.pretty.js`（59,624 行），供人读，不作为引用对象。

## 系统总表

| # | 系统 | 静态证据 | 运行时证据 |
| --- | --- | --- | --- |
| 1 | 启动与参数协议 | `QC()`：URLSearchParams→`{THREE,params,events,rng,time,quality}`，`?bench` 自动 `noaudio=1&autostart=1`，RNG 默认种子 四千二百七 [src:pretty:L51928-L51952] | `boot.mjs`：WebGL2 建立、`__errors` 空、rAF 心跳推进 |
| 2 | 渲染核心 | 自研 advanced pipeline：onLevelReady 编译预热 + 失败即回退前向渲染 [src:pretty:L7000-L7024]；自适应分辨率按画质档设像素预算 low:1e6/medium:15e5/high:23e5/ultra:37e5 [src:pretty:L1044-L1068] | `rendererStatsSample: calls=267, tris=1.8M, geos=181, tex=134, programs=107`（capture-frames 实测） |
| 3 | 画质分级 | `test/low/medium/high/ultra` 十旋钮表：scale/msaa/shadow/tex/volSteps/ao/planar/bloom/motionBlur/rain [src:pretty:L1044-L1068] | bench 实测 `quality: {name:"low", scale:.7, shadow:2048, volSteps:12, rain:.5}` |
| 4 | 程序化天空 | `// SALTLINE_SKY`：云层滚向、云底 ripple、云隙烧穿、云内闪电、远距大气透视 [src:L4207-L4295] | 捕获 `shader-003-frag.glsl`（7,359B，saltline-custom） |
| 5 | 软阴影 | `// SALTLINE_SHADOW`：对 three `shadowmap_pars_fragment` 做字符串手术 `s.slice(0,o)+l+s.slice(a)`；blocker search + penumbra 随遮挡距离增长 + 边缘淡出 [src:L4296-L4348] | 运行时最终 GLSL 中该块与上游可 diff（见 04 篇） |
| 6 | 后处理 | 单一全屏 pass：AgX 拟合、`uBloom/uDirt/uStreak/uFlare/uCA/uVignette/uDamage/uLowHealth/uAds/uFlash/uFade/uSaturation/uThunder` 十三路控制 [src:L4612-L4625] | 运行时捕获该 frag，含 `uDamage/uLowHealth` 受击反馈位 |
| 7 | AA 与锐化 | Kawase 风格两 tap 采样 + "light unsharp mask, backed off on strong edges (those belong to FXAA)" + 亮度加权胶片颗粒 + 抖动去色带 [src:L4728-L4740] | 大 shader（82K 字符）作者占比 88%（chunk-diff） |
| 8 | 海面 | `saltline-sea-1` 缓存键 + 波形/反射/湿润度 [src:L5728-L5728] | 捕获含 `saltline-sea` 的 frag 多份（画质变体） |
| 9 | 体积光柱/室内探针 | "denser sampling near the eye"、"dusty interior (the shed)"、far-field 渐隐注释与 captureInteriorProbe [src:L4425-L4439] [src:pretty:L7000-L7024] | 捕获含 shaft 注释段的 frag |
| 10 | 材质注入 | `onBeforeCompile` ×9；缓存键 `saltline-blink/-gulls/-apron-3/-sea-1/pac9-detail-` [src:pretty:L18627-L18651] [src:pretty:L5607-L5631] | `manifest.json`：52 段带 saltline 标记的最终 GLSL |
| 11 | 程序化噪声 | JS 端 xorshift 生成 256×256 RGBA 噪声纹理（Uint8Array 262144）[src:L4206-L4206]；GLSL 端 `fbm5/fbm3` [src:L4192-L4195] | 最终 GLSL 中 `tNoise` 采样遍布天空/海面/锈迹 |
| 12 | 关卡几何 | 港区边界 oi={min:(-四十,0,-三十),max:(四十,三十,三十),groundY:0,seaY:-1.6,quayX:三十}；太阳 Mn={dir:(.916,.225,.331),color:(1,.72,.42),intensity:9} [src:pretty:L1044-L1068] | 181 geometries / 1.8M tris per frame |
| 13 | 粒子/雨 | instanced sprite（aPar attribute）+ vBlink 闪烁 [src:pretty:L18627-L18651]；quality 档 `rain` 旋钮 [src:pretty:L1044-L1068] | 捕获含 `attribute vec4 aPar` 的 vert/frag 配对 |
| 14 | 海鸥群 | `saltline-gulls` 键 + `frustumCulled=!1` 全量绘制 [src:L5474-L5474] | gulls 在 render stats 的 geos 中 |
| 15 | 音频 | 总线+压缩器+滤波+卷积（`bus:`/Compressor/Biquad/Convolver 同处 L5939 巨行）[src:pretty:L921-L945] | bench 模式 `noaudio=1` 验证静音路径 |
| 16 | 玩家控制器 | Pi={eye:1.68,crouchEye:1.05,radius:.32,height:1.8,fov:七十四,viewFov:五十四} + 蹲伏视线插值 [src:pretty:L1044-L1068] | 玩法状态由 `__G.game.state` 暴露 |
| 17 | 武器/枪模 | 枪口/机瞄/握把变换常量 `eu/qv/tu/nu` + `sightY:.069` [src:pretty:L921-L945] [src:pretty:L5607-L5631] | `pac9-detail-` 动态缓存键出现在捕获清单 |
| 18 | 敌人与波次 | 敌人/波次/刷兵逻辑位于 L5939 巨行（enemy count=5 处）[src:pretty:L921-L945] | HUD 波次警告 CSS 区块 [src:L79-L79] |
| 19 | 输入 | Pointer Lock + 触屏双摇杆 + 手柄（requestPointerLock/`pointerlockchange`/`gamepad`）[src:pretty:L921-L945] | input 表面 22 个键由 `__G.input` 暴露 |
| 20 | 检视协议 | window.__G（THREE/params/events/rng/time/quality/render/game/input）+ window.__stats() [src:pretty:L51928-L51952] | `capture-frames.mjs` 直接消费 `__G.render.stats()` |

## 静态证据

app 区代码高度压缩（变量名 1-2 字符），但三条"自我标注"线索把子系统切开：

1. **大写着色器区块名**：`SALTLINE_SKY/SHADOW/POST` 是作者留在 GLSL 里的文件名 [src:L4207-L4207] [src:L4296-L4296] [src:L4349-L4349]。
2. **具名缓存键**：`customProgramCacheKey=()=>"saltline-*"` 把每个注入材质钉在名字上 [src:pretty:L18627-L18651]。
3. **CSS 分区注释**：HUD/触屏/菜单/动效偏好各有归属注释 [src:L8-L10]。

## 运行时证据

运行时清单由 `capture-shaders.mjs` 产出（186 段最终 GLSL，3.4MB，`saltline-custom=52`）。`diff-chunks.mjs` 用上游 109 个 ShaderChunk 做区间覆盖：**作者手写 GLSL 占 75.7%**——五大着色器（天空/海面/光柱/后处理/雨雪）是从零写的，three 只提供骨架与基建。这与"程序化资产是内容主体"的判断互为印证（见 05 篇）。

运行时还暴露了两条静态分析拿不到的事实：高级管线失败会**整体回退**到前向渲染（`advanced pipeline disabled, falling back to forward rendering` 的 catch 分支 [src:pretty:L7000-L7024]），以及画质档是**运行时可切换**的（setQuality 重建 shadow map 与 MSAA samples）。
