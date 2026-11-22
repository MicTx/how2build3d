# 02 · 技巧卡集：24 张可直接抄的模式

> 每张卡的四个字段：**原理 / 代码模式 / 取舍 / 出处**。出处均为
> `sources/jimao-3a-game/index.html` 的行号引用。建议按 `01-methodology.md`
> 的阶段顺序取用。

## 技巧卡索引

| 阶段 | 卡片 |
| --- | --- |
| S1 预算 | T-01 T-02 T-03 |
| S4 材质/光照 | T-04 T-05 T-06 T-07 |
| S2/S5 生成/氛围 | T-08 T-09 T-10 T-11 |
| S6 后处理 | T-12 T-13 T-14 |
| S3 装配 | T-15 T-16 |
| S7 玩法 | T-17 T-18 T-19 |
| S8 音频 | T-20 T-21 |
| S9 可检视 | T-22 T-23 T-24 |

### T-01 双相机分离近裁剪面

**原理**：主场景与贴脸的武器模型用两台相机、两个 layer 渲染；武器相机 near=0.01 而主相机 near=0.08，枪模再压 `depthRange` 到极小切片，避免改写主场景深度。**代码模式**：`Wn(Pi.fov,16/9,.08,900)` + `Wn(Pi.viewFov,16/9,.01,10)`、`layers.set(0/1)`。**取舍**：多一次场景遍历，换来"枪永远不被裁且不穿墙" [src:pretty:L1044-L1068] [src:pretty:L7000-L7024]。

### T-02 像素预算自适应

**原理**：每个画质档设像素上限（low 1e6 / medium 15e5 / high 23e5 / ultra 37e5），按 `实际 > 预算 → scale *= sqrt(预算/实际)` 缩渲染目标。**代码模式**：`let budget={low:1e6,...}[quality.name]`，`re*=Math.sqrt(budget/used)`。**取舍**：分辨率动态抖动时画面略软，但帧时被硬约束 [src:pretty:L1044-L1068] [src:pretty:L7000-L7024]。

### T-03 阴影隔帧更新

**原理**：`shadowMap.autoUpdate=false`，在帧循环里按条件置 `needsUpdate`（ultra 每帧、其他档隔帧或阴影图缺失时）。**代码模式**：`(T&1)===0 || !shadow.map` 门控。**取舍**：低档阴影有半帧滞后，换来一半阴影 pass 成本 [src:pretty:L7000-L7024]。

### T-04 onBeforeCompile 锚点注入

**原理**：不整段替换内置材质，只在 `#include <begin_vertex>` / `<color_fragment>` 锚点后追加自定义逻辑，声明则 prepend 到 shader 头。**代码模式**：`n.vertexShader = decl + n.vertexShader.replace(anchor, anchor + injected)`。**取舍**：依赖 three 的锚点名（升级需核对），但改动面最小 [src:pretty:L18627-L18651]。

### T-05 缓存键即编译指纹

**原理**：注入材质必须给 `customProgramCacheKey`，否则 three 会用库存程序错配。**代码模式**：`e.customProgramCacheKey=()=>"saltline-blink"`。**取舍**：漏写就是随机的渲染 bug，且难复现 [src:pretty:L18627-L18651]。

### T-06 把变体维度编进键

**原理**：键字符串编码所有影响编译结果的开关：`"sl2|"+tint+(tile?"t":"")+(fade?"f":"")+(alphaCut?"a":"")`，命中即复用材质实例。**代码模式**：先算 key，再查 `Map`，未命中才建 material。**取舍**：变体数会膨胀 program 数（实测 二百六十八），必须配合启动期预热 [src:pretty:L21333-L21357] [src:pretty:L7000-L7024]。

### T-07 chunk 手术要有布局校验与降级

**原理**：替换 three 的 `shadowmap_pars_fragment` 前，先 `indexOf("float getShadow(")` 与 `indexOf("vec2 cubeToUV")` 确认布局；不符就 `console.warn("keeping stock PCF")` 并返回 false。**代码模式**：`s.slice(0,o)+injected+s.slice(a)`。**取舍**：与 three 版本强耦合，但保底路径让风险可控 [src:L4296-L4296] [src:L4349-L4351]。

### T-08 一张共享噪声纹理 + 双档 fbm

**原理**：256² RGBA 纹理全场共享；`fbm5` 给天空云层，`fbm3` 给廉价表面；固定旋转矩阵 `mat2(1.6,1.2,-1.2,1.6)` 与偏移 17.3 去方向性。**代码模式**：`n2(p)` 取样 → `for(i<5){s+=a*n2(p);p=rot*p+17.3;a*=.5}`。**取舍**：每像素多 2-5 次采样，换来零贴图资产 [src:L4206-L4206] [src:L4192-L4195]。

### T-09 确定性 xorshift 生成

**原理**：`t^=t<<13; t^=t>>>17; t^=t<<5` 填充 Uint8Array。噪声纹理函数的种子硬编码为 `2654435769`（每次启动生成同一张纹理）；另有一个独立的 `__G.rng` 全局 PRNG，由 URL `?seed` 参数初始化（默认 4207），供场景摆放等玩法用途，两者不是同一个随机源。**代码模式**：`rng=il(+(params.seed||4207))`。**取舍**：PRNG 质量不如加密级，但足够纹理/摆放用且完全可复现 [src:L4206-L4206] [src:pretty:L51928-L51952]。

### T-10 把构图铁律写进 shader 注释

**原理**："the sun always burns through a ragged hole in the gap, never sits behind solid cloud"——云甲板刻意留缺口保证太阳可见；远云融进地平线色（大气透视）；PMREM 防火蝇。**代码模式**：注释紧贴对应代码块，每个视觉决策有专属注释段。**取舍**：注释不产生画面，但防止迭代时把美术意图改没 [src:L4243-L4251] [src:L4272-L4291]。

### T-11 闪电是事件，不是贴图

**原理**：CPU 端衰减曲线 `power*exp(-5t)*(0.55+0.45*sin(47t)*sin(13t+1))*0.35`（t>0.9 归零）驱动 shader 的 `uFlash`；天空 shader 里画云内片状闪电。**代码模式**：`uniforms.uFlash.value = flash(...)`, shader 内 `mix` 闪电颜色。**取舍**：只能做"光"不能做"云形变"，但零成本且可随机触发 [src:L4269-L4272] [src:pretty:L7000-L7024]。

### T-12 后处理 uniform 分两条数据流

**原理**：一行全是镜头光学（bloom/dirt/streak/flare/CA/vignette），另一行全是游戏状态（damage/lowHealth/ads/flash/fade/saturation/thunder）。**代码模式**：`post` 状态袋 → 每帧写入 uniform。**取舍**：单 pass 里耦合两类逻辑，但省掉多 pass 的带宽 [src:L4612-L4613] [src:pretty:L7000-L7024]。

### T-13 锐化给 AA 让位

**原理**："light unsharp mask, backed off on strong edges (those belong to FXAA)"——用对比度 `smoothstep(.04,.22,contrast)` 反过来抑制锐化，强边缘交给 AA。**代码模式**：`col += (M-blur)*uSharpen*(1-smoothstep(...))`。**取舍**：细节略软，但不会出现锯齿镶边 [src:L4732-L4734]。

### T-14 亮度加权颗粒与抖动

**原理**：胶片颗粒强度按亮度 `mix(1,.3,smoothstep(.25,.9,lum))` 减弱（暗处多、亮处少），并对天空梯度做 dithering 防色带。**代码模式**：`hash12(gl_FragCoord.xy + fract(uTime*vec2(7.31,3.17))*vec2(311.7,173.3))`。**取舍**：额外一次噪声，但去掉 8-bit 输出的色带 [src:L4735-L4740]。

### T-15 每实例相位 attribute 做闪烁

**原理**：几何体 `toNonIndexed()` 后写入 `attribute vec3 blink(周期,相位,占空)`，vertex 里算相位、frag 里乘亮度；变化只靠共享 `uTime`。**代码模式**：`fract(uTime/max(blink.x,.001)+blink.y)` + 双 smoothstep 包络。**取舍**：需要非索引几何（顶点数膨胀），换来零 CPU 更新 [src:pretty:L18627-L18651] [src:pretty:L1-L25]。

### T-16 Canvas 啃咬 + 小型排版引擎

**原理**：`destination-out` 随机多边形抠洞、随机线段划痕、点锈、径向污渍四 pass 做旧；文字用 `measureText` 逐字排版（字距/字重/连笔桥/超宽缩放）。**代码模式**：`qa(text, opts)` 返回 canvas → `CanvasTexture`。**取舍**：启动期 CPU 成本，换来零字体/贴图资产与任意文本 [src:pretty:L33030-L33054]。

### T-17 三模态归一为虚拟输入

**原理**：Pointer Lock 键鼠、触屏双摇杆、手柄轮询全部写入同一个 `input` 对象（move/look/fire/ads/sprint/crouch…），玩法层不关心来源。**代码模式**：`describeMode()/onModeChange` 处理切换。**取舍**：输入层字段多（二十二 个），但玩法代码零分支 [src:pretty:L921-L945]。

### T-18 宽容输入 coyote + jumpBuffer

**原理**：`coyote:0.12`（离台 120ms 内仍可跳）、`jumpBuffer:0.13`（落地前 130ms 的按键缓存）；跳跃高度用"顶点高度"定义再反推初速度 `sqrt(2*g*h)`。**代码模式**：把两个计时器放进玩家状态。**取舍**：几乎零成本，却决定平台跳跃"跟手"与否 [src:pretty:L921-L945]。

### T-19 手感 = 外置调参表

**原理**：bob/recoil/shake/regen/fovAds 等全部集中且自命名；枪械部件坐标也是一张表（枪口、镜窗八边形、枪机行程）。**代码模式**：`const TUNE={...}; controller.update(dt,TUNE)`。**取舍**：表变大，但调手感从"改逻辑"变成"改数据" [src:pretty:L921-L945] [src:pretty:L1044-L1068]。

### T-20 声音规格表 + 6ms 渐进合成

**原理**：57 条规格一条记录（50 个非音乐可播名 + 5 个音乐声部 + 2 张生成 IR；可播 55 条），启动期分组合成，每批超 6ms 就让出，12ms 后继续。**代码模式**：`Go[name]` + `setTimeout(worker,12)` + 峰值归一化 `peak/max(samples)`。**取舍**：开局前几秒少量音效未就绪，但首帧不卡 [src:pretty:L921-L945]。

### T-21 音乐即状态混音

**原理**：drone/ost/perc/brass/motif 五条 loop 声部，按战斗强度调各轨增益，任务事件音挂 music 总线按 `pri:9` 抢占。**代码模式**：`music:1` 标记 + 每帧 `gain.linearRampToValueAtTime(mix)`。**取舍**：写不出完整编曲的戏剧性，但过渡无接缝、内存极小 [src:pretty:L921-L945]。

### T-22 shader 错误按 marker 分诊

**原理**：`renderer.debug.onShaderError` 里用 `getShaderSource` 判命中 `SALTLINE_POST/SKY/SHADOW`，把报错归到具体系统名。**代码模式**：`re.includes(marker) ? label = "post pass" : ...`。**取舍**：多一次 getShaderSource 调用（仅错误路径），换来"哪个系统炸了"一行可见 [src:L4132-L4132]。

### T-23 状态切换单一入口 + 调试直通

**原理**：所有状态变更走 `M(state)`（广播 `game:state` 事件 + 清零计时），并提供 `debugCut()` 一键推进任务。**代码模式**：`events.on("game:state", handler)`。**取舍**：多一层间接，但重开一局能保证完全一致的初始态 [src:pretty:L51928-L51952]。

### T-24 把引擎状态开放为检视协议

**原理**：`window.__G` 暴露 {THREE,params,events,rng,time,quality,render,game,input}，`window.__stats()` 返回统计，`?bench` 自动静音+自启+固定 seed。**代码模式**：URL 参数解析 `Object.fromEntries(new URLSearchParams(location.search))`。**取舍**：多一个全局入口，但让测试、调参、教学全部可自动化 [src:pretty:L51928-L51952]。
