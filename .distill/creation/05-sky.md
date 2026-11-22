# 创物 · 天空（sky）

> 上游锚点：`// SALTLINE_SKY` 程序化云甲板天空（sources/jimao-3a-game/index.html L4207-L4295；常量与噪声 L4191-L4206；装配与 PMREM L4296-L4296）｜ 我方资产：`assets/sky-deck.glsl`（capture shader-003-frag 原样移植，uniform 名保持上游）｜ 对账：`harness/element-manifest.json` sky 族（floor：skyPasses ≥ 1）｜ 验收：`node harness/gates/complete.mjs --scene examples/parity`

## 构建法则

**法则 1 · 一段 shader 两副面孔**：天空必须同时充当「屏幕背景」和「图像基光照（IBL）」，且两副面孔由同一个 uniform 开关 uEnv 切换，绝不允许两份实现。屏幕版含 110 亮度的太阳盘 HDR 直视 [src:L4279-L4282]；PMREM 版由调用方把 uEnv 置 1：太阳盘被 (1.0 - uEnv) 关掉、整帧输出被 `min(col, vec3(6.0))` 限幅，防止高亮经 mip 平均后污染环境探针 [src:L4291-L4293]。上游用 `Vy()` 克隆 sky 材质、只改 uEnv=1 再 `PMREMGenerator.fromScene` 烘室外环境，室内另走 CubeCamera 探针 [src:L4296-L4296]。这就是「环境贴图是天空的低通+限幅版本」——不是两张图，是同一数学的两种预算。

**法则 2 · 云是平面投影，不是体积**：云甲板的一切细节都住在 2D 参数化空间 `cuv = d.xz / (h + 0.10)` 里——视线方向投影到固定高度平面，`+0.10` 同时消灭 `h→0` 奇点并让地平线附近云纹被自然压缩成「透视密度」 [src:L4231-L4231]。滚动、domain warp、fbm5 密度、ridged 云底全部在这个 2D 空间完成，一个 pass 出完整天空，不做任何 3D raymarch [src:L4233-L4242]。云的运动是「平移 + warp」而非 4D 噪声流动：`wind = vec2(-0.012, 0.004) * uTime` 直接加在坐标上，湍流感由 `fbm3(q*0.45+7.1)` 偏移域提供 [src:L4232-L4235]。

**法则 3 · 构图铁律用 smoothstep 公差编码，不用硬边界**：「太阳永远从云隙烧穿、绝不躲在实云后」这条导演命令的落点是三层乘法：云甲板在朝日方向留缺口（`edge` 随 skyToSun 抬升）[src:L4243-L4246]；缺口内再挖噪声调制的 ragged 洞 `hole = smoothstep(0.972, 0.9985, mu + (dens-0.5)*0.012)`——`mu→1`（正对太阳）时必然全开，但洞缘参差 [src:L4248-L4250]；残余薄云 scud 只降低太阳盘亮度不吞掉它 [src:L4251-L4252]。太阳盘本体也是公差带：`smoothstep(0.999905, 0.999955, mu)` 用 cos 阈值带编码约 0.5° 视直径，边缘半像素过渡 [src:L4279-L4282]。硬阈值是脆的，公差带是可调焦的。

**法则 4 · 自阴影 = 沿光方向偏移采样一次**：云底明暗不 raymarch，只再采一次密度 `densS = fbm5(qq + sd*0.22)`（`sd` 是太阳的水平方向），密度差 `(dens - densS)` 就是「朝着太阳那侧更薄」的梯度，直接当自阴影用 [src:L4254-L4259]。一次额外 fbm 买走整个云底的体积感；同族技巧还有缺口边缘「烧红」：`rim = cov*(1-cov)*4` 抛物线取边缘带，乘太阳色与 `pow(ts,4)` [src:L4262-L4268]。近似的成本表要写成显式公式，不许凭感觉调。

**法则 5 · 噪声与色表是全场景共享资产**：fbm 用一张 256² RGBA 噪声纹理（CPU xorshift 生成一次）+ `n2/fbm5/fbm3` 三函数，旋转矩阵 `mat2(1.6,1.2,-1.2,1.6)` 与偏移 `+17.3` 全场景统一 [src:L4192-L4195][src:L4206-L4206]。天空的输入收敛为五个常量：太阳方向/颜色/强度与天顶/地平/远地平/雾四色，由 `Mn`/`en` 常量表注入 uniform [src:pretty:L1044-L1068][src:L4197-L4198]。改氛围只改常量表，不动 shader。

**法则 6 · 天气是 CPU 事件，不是 shader 内随机**：云内片状闪电只消费 `uFlash`（强度）与 uFlashDir（方位）两个 uniform，亮度还反过来乘云密度 `(0.4 + 2.2*dens*dens)`——厚云处闪得越亮 [src:L4269-L4271]。衰减曲线在 CPU：`power*exp(-5t)*(0.55+0.45*sin(47t)*sin(13t+1))*0.35`，t>0.9s 归零；雷暴事件到达时用随机方位角 `π*(0.55..1.45)`、仰角 0.35..0.65 重设 uFlashDir，与 post 侧 uThunder 同源驱动 [src:pretty:L7000-L7024]。shader 里不许掷骰子，随机性集中在事件层。

## 完整链路

| 环节 | 内容 | 上游证据 | 我方落点 |
| --- | --- | --- | --- |
| 意图 | 雨幕港区黄昏：云甲板向东滚、太阳从云隙烧穿、远场融进地平线 | [src:L4231-L4251][src:L4272-L4277] | sky-deck.glsl 头注释 |
| 算法 | 平面投影 2D fbm + 梯度自阴影 + 公差带构图 + aerial perspective | [src:L4231-L4259][src:L4272-L4277] | 同上，逐式原样移植 |
| 常量表 | `Mn.dir(0.916,0.225,0.331)`、`SunCol(1,.72,.42)`×9、`zenith(.055,.085,.13)`、`horizon(.95,.55,.28)`、`horizonAway(.16,.22,.3)`、`fog(.42,.47,.52)` | [src:pretty:L1044-L1068] | 接入时按场景重绑五色+太阳 |
| 噪声底座 | 256² RGBA xorshift 纹理 + `n2/fbm5/fbm3`（归一化除数 0.96875/0.875） | [src:L4192-L4206] | 内联进资产头 |
| 上游实现 | frag 主体 ~85 行：clear sky→aureole→云甲板→scud→光照→闪电→远场→太阳盘→地平线下→限幅 | [src:L4207-L4293] | `assets/sky-deck.glsl` 全文 |
| 装配 | BoxGeometry(2,2,2) sky mesh：`depthWrite:false`、`renderOrder:-1e3`、`frustumCulled:false`、顶点 `p.xyww` 压远平面；材质名 `saltline-sky` | [src:L4296-L4296] [src:pretty:L30748-L30748] | 路由见「迁移法则」 |
| 环境烘焙 | 克隆材质置 `uEnv=1` → `fromScene(0.1,100)` 烘室外 PMREM，`environmentIntensity=2`；室内 CubeCamera 128 探针另烘 | [src:L4296-L4296] [src:pretty:L30777-L30777] [src:pretty:L7000-L7024] | uEnv 协议是接入合同的一部分 |
| 运行时证据 | capture `evidence/shaders/shader-003-frag.glsl`（asset 头注明）；雷暴调度 22-55s 驱动 `uFlash/uFlashDir` | [src:pretty:L7000-L7024] | examples/parity 场景复现 |
| 门禁 | `harness/element-manifest.json` sky 族 floor `skyPasses≥1`；citations/complete 双门禁 | manifest sky 条目 | `node harness/gates/complete.mjs --scene examples/parity` |
| 失效模式与兜底 | 太阳被实云吞→检查 `hole` 与 `skyToSun` 同源；远场走样→`ridg` 距离衰减项被删；PMREM 火蝇→`uEnv` 限幅被绕过；地平线露馅→地平线下海雾分支兜底；环境烘焙失败→try/catch 后 environment 留空、游戏照跑 | [src:L4237-L4240][src:L4291-L4293][src:L4284-L4288][src:pretty:L7000-L7024] | 兜底分支一并移植 |

## 思维链

### 决策链 A · 为什么一份 shader 要伺候两个消费者

**约束**（事实）：屏幕上玩家要直视 110 亮度的太阳盘；但同一片天空还要烘成 PMREM 给 PBR 材质当 IBL，室内还要 CubeCamera 探针——三处消费 [src:L4279-L4282][src:L4296-L4296][src:pretty:L7000-L7024]。太阳盘若进 IBL，mip 平均会把超高亮摊成一片「假发光」，metal 高光炸成火蝇。
**目标**（事实）：三种消费零复制、零漂移，且 IBL 版本必须限幅。
**候选**（推断）：A 写屏幕版/IBL 版两份 shader——保真但必然漂移；B 烘完再在 RT 上做限幅——高亮已经写进纹理，mip 链还是会渗；C 单 shader 挂 `uEnv` 开关：关太阳盘 + 出口限幅 6.0。
**选择**（事实）：C。`Hy()` 出厂默认 `uEnv=0`，`Vy()` 克隆材质只改 `uEnv=1` 即烘室外；室内探针在 `K()` 里临时置 1、烘完还原 [src:L4296-L4296][src:pretty:L7000-L7024]。
**兜底**（事实）：整个环境捕获包 try/catch，失败只 `console.error("[render] environment capture failed…")`，`environment` 留空、游戏继续跑——IBL 是增益项不是生存项 [src:pretty:L7000-L7024]。

### 决策链 B · 云的参数化：投影平面为什么够用

**约束**（事实）：6214 行单文件、零外部资源，天空只分到约 90 行 shader；fbm 已是全场景共享底座 [src:L4207-L4295][src:L4192-L4195]。
**目标**（推断）：云要同时给出「向东滚的运动」「云底翻卷细节」「地平线透视密度」「与太阳的构图关系」，帧预算却只允许一个 pass。
**候选**（推断）：A 真 3D 体积云 raymarch——每像素几十步 3D 噪声，预算不可承受；B 球壳贴天幕图——无透视视差，走近穿帮；C 视线方向投影到固定高度平面（`d.xz/(h+0.10)`），全部细节在 2D 噪声里做。
**选择**（事实）：C。`+0.10` 偏置一石二鸟：防 `h→0` 除零，同时地平线附近 uv 被压缩=免费的远云密度感 [src:L4231-L4231]。
**兜底**（事实）：平面感的破绽由两条近似掩护——ridged 云底制造起伏错觉，aerial perspective 把远云按 `exp(-h*11)` 融进地平线色，视线根本没机会「看穿」它是平面 [src:L4237-L4240][src:L4272-L4277]。

### 决策链 C · 闪电为什么住在 CPU

**约束**（事实）：闪电要同时被天空（云内片状闪电）、后处理（雷暴白闪）、天气 kit（二十二-55s 雷暴调度）三方消费，且 `uFlashDir` 要真随机方位 [src:L4269-L4271][src:pretty:L7000-L7024]。
**目标**（推断）：三方共享同一事件源，时序确定、可测、可重放。
**候选**（推断）：A shader 内 `hash(uTime)` 自闪——三方对不齐、不可测；B CPU 事件 + uniform 下发。
**选择**（事实）：B。CPU 衰减曲线 `power*exp(-5t)*(0.55+0.45*sin(47t)*sin(13t+1))*0.35`（0.9s 截止）逐帧写 uFlash，`thunder` 事件处理器随机化 uFlashDir 后再驱动 post [src:pretty:L7000-L7024]。
**兜底**（事实）：`uFlash` 出厂默认 0、方向默认 `(-0.5,0.5,-0.7).normalize()`，不接天气 kit 天空也自洽 [src:L4296-L4296]。

**推断边界**：三条链中「候选」清单与帧预算的具体数字无法从压缩源码直接证实，属于由结果与单文件约束反推的推断；凡标「事实」处均有行号钉死。天空 shader 的美术动词（滚向东、烧穿、scud）来自上游英文注释原文，不属推断。

## 迁移法则

- **资产路由**：`assets/sky-deck.glsl` 原样移植（capture shader-003-frag，出处头注明 origin L4207-L4295），接入时自建 `BoxGeometry(2,2,2)` + ShaderMaterial，材质参数照抄上游：`depthWrite:false`、`renderOrder:-1e3`、`frustumCulled:false`、`castShadow/receiveShadow:false`、`matrixAutoUpdate:false` [src:L4296-L4296]。
- **参数重绑点**：五色+太阳常量（`Mn`/`en` 表）按自己场景的天空重设，shader 不动 [src:pretty:L1044-L1068]；`uTime` 由帧循环注入；`uFlash/uFlashDir` 对接天气事件（衰减曲线照抄 [src:pretty:L7000-L7024]）；`uEnv` 协议保持「屏幕 0 / IBL 1」，自建 PMREM 时克隆材质置 1，出口限幅不得删除 [src:L4291-L4293]；噪声纹理 256² 可用任何 PRNG 重生成，`n2` 的 256 归一除数随之对齐 [src:L4206-L4206]。
- **对账行**：`harness/element-manifest.json` → `id:"sky"`，floor `skyPasses≥1`，detail 要求 ridged 云底/烧穿/闪电/大气透视/uEnv 变体五项俱全；文档锚 `references/11-element-parity.md#sky`；验收命令 `node harness/gates/complete.mjs --scene examples/parity`。
