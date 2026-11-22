# how2build3d assets — 移植资产索引

> 来源：`harness/capture/assets.mjs` 从捕获的最终 GLSL（`evidence/shaders/`）原样移植；
> SL 材质/纹理层从 `evidence/frames/app.pretty.js` 的明文产物原样移植（模块形态）。
> 元素 kit（第五节）同源、同样按模块形态移植：纯 JS、零引擎依赖、three/材质/物理/音频上下文参数注入，
> 贴花与 FX 图集全部 Canvas 程序化（不引外部贴图文件）。各 kit 的 node 自检入口见第五节（覆盖范围按实际导出）。
> 每个资产头部带出处（捕获文件 + 原始行号）；接入方式见 `.distill/distillation/06-visual-assets.md` 与 `references/07-perceptual-quality.md`。

## 一、GLSL pass 资产（八系统 + 可选 sea）

| 资产 | 系统 | 关键函数/Uniform | 原始出处 |
| --- | --- | --- | --- |
| `post-chain.glsl` | 后处理主 pass：AgX 拟合、暗角、色差、光斑、抖动、锐化 | `slAgx/slAgxContrast`, `uVignette/uCA/uAgxMix/uExposure`, `tScene/tBloom/tBlur/tStreak/tDirt/tAdapt` | [src:L4349-L4352] [src:pretty:L31176-L31268] |
| `post-aa.glsl` | Kawase AA + 亮度加权颗粒 + 抖动去色带 | `uGrain/uSharpen/uFxaa`, `hash12` | [src:L4728-L4740] |
| `shafts.glsl` | 体积光柱积分 pass（双叶相位 + 近距加权 + 远场解析延拓） | `VOL_STEPS`, `uSunRad/uSigma/uMaxDist`, `tDepthHalf`（线性视距）, `uHasShadow` | [src:L4425-L4450] |
| `sky-deck.glsl` | 云甲板天空：ridged 云底、太阳烧穿、云内闪电、大气透视 | `fbm5`, `uSunDir/uFlash` | [src:L4207-L4295] |
| `pcss-shadow.glsl` | PCSS 软阴影：Vogel 盘采样、blocker search、receiver-plane bias | `slIGN/slVogel/getShadow`, `SL_FRUSTUM/SL_DEPTH` | [src:L4296-L4348] |
| `ssr-wet.glsl` | 湿地屏幕空间反射：`uRefl` LOD 混合、水洼/湿沥青权重、bicubic 采样；RR 反射块带 `SSR_WET_RR_BEGIN/END` 切块标记（场景按标记注入，不复制数学） | `gPuddle/gSoak/gBicubic`, `uReflScale/uReflLod` | [src:L5661-L5728] |
| `sea.glsl` | 海面（P4 新增，按场景可选）：涌浪顶点位移、波斜率着色、三层细波法线重建、太阳碎光「猫爪」高光、雾；含 JS 侧环形级差网格配方 | `saltline-sea-1`（customProgramCacheKey）、`SEA_VERT_HEAD/SEA_BEGIN_VERTEX/SEA_COMMON/SEA_MAP_FRAGMENT/SEA_NORMAL/SEA_GLITTER/SEA_FOG`、`uTime/uDetail/uDetailN/uHazeA/uHazeB/uSunDirW`、全局 `gRough/gNxz/gOcc/gSDist/gSpark` | [src:pretty:L45031-L45240] [src:pretty:L45123-L45178] |

## 二、SL 材质层（观感的核心，v3 新增）

| 资产 | 系统 | 关键接口 | 原始出处 |
| --- | --- | --- | --- |
| `sl-surface.mjs` | 表面注入 + 材质工厂：triplanar、ORM 打包读取、macro 大尺度变化、湿/流挂/水珠、法线-粗糙耦合、alpha-wire mip 渐隐、SL_TINT 1-3、LOOK_POWER/SAT 分级 | `SL_SURFACE`（七段 GLSL）、`SL_MATERIALS`（48 种目录）、`injectSLSurface()`、`createSurfaceMaterialFactory()` | [src:pretty:L34156-L34344] [src:pretty:L34470-L34535] |
| `sl-textures.mjs` | GPU 程序化 PBR 纹理工厂：MRT(count=3) 输出 albedo/ORM/高度，Sobel 高度→法线；27 个 `surf()` 生成器 × 29 个纹理集 | `SL_TEX`（5 个 shader）、`SL_GENERATORS`、`SL_TEX_SETS`、`createTextureFactory()` | [src:pretty:L32449-L32540] [src:pretty:L32542-L32770] [src:pretty:L32771-L33016] [src:pretty:L34042-L34072] |

## 三、自检展厅框架（v3 新增）

| 资产 | 系统 | 关键接口 | 原始出处 |
| --- | --- | --- | --- |
| `inspect-deck.mjs` | 九展厅自检框架（「摄影棚」）：`?show=<gallery>` 注册表、`showcase(ctx)` 展台引导、`__setShot` 外部截图接口、stub 世界 | `INSPECT_GALLERIES`（mats/props/enemies/weapon/fx/render/ground/backdrop/level）、`readInspectMode(search)`、`createInspectDeck({galleries, stub})` | [src:pretty:L59271-L59271] [src:pretty:L59318-L59319] [src:pretty:L59331-L59331] [src:pretty:L59393-L59393] |

## 四、玩法链路框架（v3 新增）

| 资产 | 系统 | 关键接口 | 原始出处 |
| --- | --- | --- | --- |
| `physics-kit.mjs` | 世界查询与胶囊移动：AABB 盒列表（surface/tag/noNav/bulletOnly/playerOnly）、slab 射线、lineOfSight、groundHeight、扫掠胶囊（子步进/墙滑/step-up）、导航网格（A*+拉直） | `createPhysicsKit({bounds, region, cell, stepHeight, agentPadding, groundSurfaceAt, rng})` → `addBox/removeBox/build/raycast/lineOfSight/groundHeight/moveCapsule/nav` | [src:pretty:L34676-L34676] [src:pretty:L34705-L34705] [src:pretty:L34810-L34810] [src:pretty:L34875-L34875] |
| `level-kit.mjs` | 关卡装配：九件套数据 schema（playerStart/objectives/enemySpawns/zones/extraction/groundSurfaceAt…）、PROP_SIZES 式目录、手写布局、零件数对账、AABB 碰撞注册 | `validateLayout(catalog, layout)`、`createLevelKit(THREE, {catalog, layout, physics, materials})` → `{group, stats, showcase, ...九件套}` | [src:pretty:L59358-L59374] [src:pretty:L35067-L35068] |
| `combat-kit.mjs` | 战斗导演：攻击令牌池（同时开火上限）、四态状态机、听觉传播（hearRadius）、弹道池、射击调度（弱点 ×2.2）、任务状态袋、autoBattle 自动战斗采样 | `createCombatKit({physics, events, rng, tune})` → `tokens/createAgent/updatePerception/rally/provoke/alert/fireBolts/playerShot/enemyShot/mission/autoBattle` | [src:pretty:L52511-L52511] [src:pretty:L57426-L57434] |

## 五、元素 kit（P2–P4 逐阶段新增，按场景可选）

> 元素 kit 与二/三层同一条纪律：纯 JS、零引擎依赖、rng 注入、three/材质/物理/事件全部**参数注入**（不顶层 import）。
> 八个 kit 都导出**模块级** `selfTest()`（node 离线可跑；`enemy-kit` 另保留工厂实例上的 `selfCheck()`；
> `weapon-kit` / `player-kit` / `weather-kit` 的模块级入口构造无 THREE / 最小 stub 实例后跑实例 selfTest）。
> 所有 kit 的 `stats()` 都可离线调用。与八系统不同，它们是**按场景可选**的能力——
> 观感样板申报 props/fx/audio 为 n/a 是合法的，用到哪个才要求哪个整套接线（判定见 `harness/gates/assets.mjs` 的 `KITS`）。
>
> **selfTest 的机器验收面是 `node harness/gates/kit-selftest.mjs --all`，范围就是上述八个元素 kit（显式清单，
> 不用 `assets/*-kit.mjs` 通配——通配会把第四节三个玩法 kit 扫进来，因它们没有模块级 selfTest 而误判红）**。
> 该门禁带静态范围对账：清单外的 `-kit.mjs` 一旦导出模块级 selfTest、或清单内 kit 丢失 selfTest 导出都会判红，
> 防止清单漂移。`physics` / `level` / `combat` 是玩法链路 kit（第四节），**按设计不带模块级 selfTest**，
> 其替代验收面是：`node harness/gates/gameplay.mjs --self-test`（令牌池/状态机/听觉传播/布局对账/确定性）、
> `node harness/gates/gameplay.mjs --scene examples/parity --require-audio`（自动战斗 + 音频证据；gameplay 示例为静音）与
> `node examples/gameplay/build.mjs --assert`（宿主场景构建）。

### 5.1 P2：道具 / FX / 音频（三 kit）

| 资产 | 系统 | 关键接口 | 原始出处 |
| --- | --- | --- | --- |
| `props-kit.mjs` | 道具目录 + 参数化 builder + Canvas 贴花：36 行尺寸表（`[w,h,d,material,family]`）、17 个 builder（3 个集装箱变体 + 上游注册表 14 个）、22 种贴花、碰撞盒（`surface`/`bulletOnly`）、同尺寸同材质重复件走 InstancedMesh、开容器后分墙碰撞盒 | `createPropsKit(THREE, {materials, decals, rng, instanceThreshold})` → `build/applyPhysics/showcase/stats/writeStats/reset/decals`（组带 `userData.size/colliders/lamps/decals`）；纯数据 `PROP_SIZES`、`BUILDER_NAMES`、`DECAL_SPECS/DECAL_TYPES/DECAL_PALETTE`、`MATERIAL_PRESETS`、`SIGN_DECALS/SIGN_TEXTS`、`buildModel/propColliders/worldColliders/createRng/selfTest` | [src:pretty:L35068-L35104] [src:pretty:L37358-L37372] [src:pretty:L33225-L33310] [src:pretty:L33585-L33620] |
| `fx-kit.mjs` | FX 池：lit 1400 / add 3040 双 billboard 池 + tracer 48 / debris 256 / shell 60 / decal 160 四个环形池 + 24 个环境发射器（steam/embers/fire/drip）；11 种效果 API；根组只挂 5 个 mesh = 5 draw call | `createFxKit(THREE, {rng, physics, ground, events, lightPool, wind, sunDir, sun/sunLo/sunHi, ambLo, ambHi, camera, seed, atlas, groundY})` → `muzzleFlash/tracer/impact/sparks/smoke/dust/explosion/shell/splash/debris/decal/addEmitter/update/clear/setCamera/setDepthTexture/stats`；常量 `FX_POOL_SPEC/FX_DRAW_CALLS/FX_KINDS/FX_EMITTER_KINDS/FX_ATLAS/FX_SURFACE_DECAL/FX_DECAL_SIZE`；模块级 `selfTest` | [src:pretty:L48488-L48510] [src:pretty:L45423-L45485] |
| `audio-kit.mjs` | 合成音频：本 kit 58 条规格（51 非音乐 + 5 声部 + 2 生成 IR；可播 56；上游表 57 条 = 50 + 5 + 2、可播 55）、5 总线（world22/near10/dry7/music4/amb1）、6ms/12ms 分片预算懒合成、五声部按战斗强度 0.15/0.6/1 交叉淡化、可选 AudioContext 节点图（BufferSource→Gain→Convolver→主控→Analyser） | `createAudioKit({rng, sampleRate, frame, masterGain, budget})` → `play/stopAll/setIntensity/update/stats/sample/bands/irs/specs/attach/dispose`；常量 `AUDIO_SPECS/AUDIO_BUSES/AUDIO_BUDGET/AUDIO_SPEC_FIELDS`；模块级 `selfTest` | [src:pretty:L50465-L50521] [src:pretty:L50664-L50670] |

- 计数口径（照原文核对过，不手填）：`PROP_SIZES` 按上游 36 行全量收录（上游 manifest 记 35 类，多一行是 `bollard_post` 同族占位）；
  builder 17 = 3 个集装箱变体 + `_i()` 注册的 14 个（需求文字只列 13 个，漏了 `bollard_post`）；`DECAL_SPECS` 22 种。
  `stats()` 的 `propKinds/propFamilies/builderCount/decalTypes` 与 `builtProps/builtParts/builtMeshes/builtInstanced/builtColliders/decalSlots` 全是运行时实测。
- 贴花是 Canvas 程序化图（`decals.canvas(name)` / `label(text, opts)` / `number(d)`），不引入贴图文件依赖；`fx-kit` 的图集同理（定种 PRNG，逐次构建一致）。
- 元素 kit 的下限门禁走 `harness/element-manifest.json`（18 族合同 + `harness/gates/complete.mjs`）；资产门禁只回答「用到就必须整套接线」。

### 5.2 P3：武器 / 敌人 / 玩家（三 kit）

| 资产 | 系统 | 关键接口 | 原始出处 |
| --- | --- | --- | --- |
| `weapon-kit.mjs` | 第一人称视图模型：49 段导轨槽 + 4 材质槽的手写 2D 型材挤出（15 零件描述 / 63 实心体）、9 通道弹簧阻尼（子步进半隐式欧拉，>12ms 拆 ≤8ms）、后坐分离（瞄准吃 35%、视觉 65%，相机与弹道同源）、hip/ADS/sprint/reload 四组锚点、换弹状态机（战术 2.1s / 空仓 2.72s） | `createWeaponKit(THREE, {rng, events, camera, materials, tune, seed})` → `update/addRecoil/pullTrigger/muzzleWorld/ejectWorld/shellTransform/shotDir/applyCamera/setCamera/reset/setAmmo/setVisible/stats/selfTest`，实例面 `root/pose/mag/aim/cam/channels/lastShot`；常量 `WEAPON_ANCHORS/WEAPON_SPRINGS/WEAPON_SPRING_CHANNELS/WEAPON_POSES/WEAPON_RELOAD_TIMELINE/WEAPON_TUNE_DEFAULTS/WEAPON_MATERIAL_SLOTS/WEAPON_PROFILES/WEAPON_PARTS`、`createRng` | [src:pretty:L54827-L54870] [src:pretty:L55096-L55120] |
| `enemy-kit.mjs` | 敌人：骨骼表→SkinnedMesh 装配、2 骨 IK + 步态相位表（脚掌落点 9cm 阈值）、四旋翼飞行（banking / 三段避墙触须 / 加速度钳 11）、命中区（头球 `part:"weak"` ×2.2、双胶囊 body）、残骸池（maxWrecks 5） | `createEnemyKit(THREE, {combat, physics, events, rng/seed, tune, mats, fx})` → `spawn/spawnAt/spawnWave/setSpawnPoints/update/raycast/stats/writeStats/selfCheck/addWreck/deactivate`，实例面 `pools/active/wrecks`；模块级 `selfTest`（实例 selfCheck 封装）；常量 `ENEMY_TUNE_DEFAULTS/HOUND_RIG/GULL_HULL/GAIT/HIT_ZONES/SKELETONS`、`solveIK/createRng` | [src:pretty:L55641-L55662] [src:pretty:L55682-L55697] [src:pretty:L56634-L56650] [src:pretty:L57426-L57444] |
| `player-kit.mjs` | 玩家控制器：三模态归一输入（pointer-lock / 拖拽 / 触屏 + 手柄标准映射，27 键位 + 10 手柄键）、Mt 手感表（36 顶层字段 + stride 3 子字段）、coyote+buffer 起跳、`moveCapsule` 半步重力、落地 landDip 弹簧与硬着陆伤害、regen、脚步/落地事件 | `createPlayerKit({physics, events, rng, tune, camera, groundSurfaceAt, getGamepads, externalAds, now})` → `input(attach/detach/update/endFrame/setGameplay)/player(pos/vel/eye/reset/damage/heal/addRecoil/addShake/update)/post/stats/selfTest`，面 `TUNE/jumpSpeed`；常量 `PLAYER_TUNE_DEFAULTS/PLAYER_DIMS/KEY_ACTIONS/GAMEPAD_BUTTONS/INPUT_MODES/INPUT_SCALES/PLAYER_EVENT_NAMES` | [src:pretty:L51710-L51744] [src:pretty:L51745-L52132] [src:pretty:L52133-L52171] [src:pretty:L52172-L52510] |

- `stats()` 口径（实测，非手填）：weapon 的 `weaponMeshes` 在 three 路径是真实 mesh 数（按材质槽合并 4 + 镜片 = 5、`drawCalls` 5），CPU 路径是型材实心体数 63，`meshMode` 标明走哪条；`weaponChannels=9`、`railSlots=49`、`materialSlots=4`、`weaponParts=15`、`tris=3020`。
  enemy 的 `enemyTypes(=2)/enemySpawns(setSpawnPoints 实测)/enemyRigs(SkinnedMesh 实测)` 正是 `harness/element-manifest.json` enemies 族三项 floor（≥1 / ≥6 / ≥1）。
- `player-kit` 在 18 族里**没有独立族**（`references/12-full-scene-assembly.md` 装配表第 7 层展厅列为「—」），数量合同对齐上游实数：Mt 36 字段、键位 27、手柄键 10、输入模态 3 + 手柄正交通道。
- enemy-kit 的感知/令牌**只对接** `combat-kit` 既有 `createAgent/updatePerception/fireBolt/enemyShot/playerShot`，×2.2 由 `combat-kit.playerShot` 对 `part==="weak"` 施加（`combat-kit.mjs:196-197`），本 kit 不重写感知；weapon 的 `muzzleWorld/shellTransform` 直接喂 `fx-kit` 的 `muzzleFlash/tracer/shell`。

### 5.3 P4：HUD / 天气（两 kit）+ `sea.glsl`（pass 资产，登记见第一节）

| 资产 | 系统 | 关键接口 | 原始出处 |
| --- | --- | --- | --- |
| `hud-kit.mjs` | HUD 与 UI 设计系统：token 层（26 项 → `.sl-hud` 的 `--hud-*` 自定义属性，组件只读 `var()`）+ 10 个组件（罗盘带 / 目标面板 / 生命 / 弹药 / 准星 / 命中标记 / 伤害弧 / 交互环 / 事件流 / 中央消息）；罗盘 -90..450、5° 一格、4px·deg⁻¹、卡片每 45°、数字每 15° | `createHudKit({doc, mount, events, rng, tokens, strings, viewport, markerLimit, maxMag, injectCss, wireEvents})` → `show/setPlayer/setWeapon/setHealth/setObjective/setRelays/setMarkers/setPrompt/hitmarker/damageArc/message/feed/update/reset/resize/stats/dispose`；常量 `HUD_TOKENS/HUD_COMPONENTS/HUD_CSS/HUD_COMPASS`；模块级 `selfTest`（token/组件/罗盘/CSS 静态合同） | [src:L11-L20] [src:L44-L210] [src:pretty:L57910-L57960] [src:pretty:L58256-L58290] |
| `weather-kit.mjs` | 天气：instanced 雨条 9000（含檐口滴水 260）+ 溅射 900、4 室内盒 / 8 天窗矩形排除、22-55s 雷暴调度（驱动 sky-deck `uFlash/uFlashDir` 与 post-chain `uThunder`）；`renderOrder` 900/890 两 mesh = 2 draw call | `createWeatherKit(THREE, {rng, events, quality, level, camera, renderer, resolution, sky, post, sunDir, sunCol, amb, mask, tune})` → `setRain/rainLevel/thunder/setIndoorBoxes/setSkylights/update/stats/selfTest`，面 `TUNE/WEATHER_POOL_SPEC/rain/splash/root/wind`；常量 `WEATHER_POOL_SPEC/WEATHER_TUNE_DEFAULTS/WEATHER_DRAW_CALLS` | [src:pretty:L45243-L45250] [src:pretty:L45251-L45344] [src:pretty:L45359-L45415] [src:pretty:L45457-L45460] |

- 常量实测（本轮 `node` 导入核对）：`HUD_TOKENS` 26 项、`HUD_COMPONENTS` 10 项、`HUD_COMPASS` 为 `{minDeg:-90,maxDeg:450,stepDeg:5,pxPerDeg:4}`；
  `WEATHER_POOL_SPEC` 为 `{rainStreaks:9000, eaveDrips:260, splashes:900, minStreaks:800, indoorBoxes:4, skylights:8}`、`WEATHER_DRAW_CALLS=2`、`WEATHER_TUNE_DEFAULTS` 30 个字段。
  `hud-kit.stats()` 的 `hudComponents/hudTokens/compassTicks(=109)/relayPips/hpSegments/magPips` 与 `weather-kit.stats()` 的 `rainStreaks(≥800)/splashes/thunderEvents/drawCalls(≤2)` 均为运行时实测。
- `sea.glsl` 是**纯 GLSL 资产、无 JS 工厂**（登记在第一节）：marker `saltline-sea-1` + 7 个补丁体（`SEA_VERT_HEAD/SEA_BEGIN_VERTEX/SEA_COMMON/SEA_MAP_FRAGMENT/SEA_NORMAL/SEA_GLITTER/SEA_FOG`），
  消费方按文件头注释把补丁 `replace` 进 `MeshStandardMaterial` 的对应 `#include` 锚点；JS 侧网格配方 `gv(27.5,880,.75,1.075,120)` 63 环 × 216 线 = 13 608 顶点 + 3 角部补丁（~26 672 三角、1 draw call、`seaY=-1.6`）。
  资产门禁的 `OPTIONAL_SYSTEMS` 以「marker 命中或源码引用 `sea.glsl`」判 used，缺席记 `missing(optional)` 不判红（无海面的场景不需要它）；
  场景在 `scene.elements.json` 里把 sea 族写 n/a 时直接记 `n/a(declared:sea)`（quality 就是这条，它的理由文字里虽出现 `sea.glsl` 也不算消费）。
- HUD 的 token 是**唯一色值来源**：组件内不硬编码颜色，改主题只改 token；`update(dt)` 内零分配、DOM 写入按「值变化」门控，`dispose()` 摘事件与节点。
- `weather-kit` 的雨/溅射是 instanced + 逐实例 `aSeed`（定种 rng），`quality.rain` 缩档钳在 `minStreaks=800` 之上；雷暴事件载荷预分配**消费方须同步读取**；`uSunCol`(太阳×1.9)/`uAmb`(雾×0.15) 是线性 HDR，交 post AgX 统一 tonemap。

## 接入约定

1. 捕获源是 GLSL3（three ShaderMaterial + `glslVersion: GLSL3` 的产物）。接入时剥离前缀头
   （`#version`/`layout(location=0) out`/three 内建 `#define`），**保留上游调参 define**
   （如 `LOOK_POWER/LOOK_SAT`——它们不是 three 内建，是上游材质自己的常量）。
2. `shafts` 资产的深度输入约定是**线性视距（米）**：`dist = z * rl`、`isSky = z > uFarZ*0.97`。
   用硬件深度纹理时在采样处换算：`viewDist = 2nf/(f+n-d(f-n))`（按 three `perspectiveDepthToViewZ` 约定等价写作 `(n*f)/(f - d*(f-n))`）。
3. `uHasShadow=0` 时跳过 `tShadow` 采样（无自定义阴影图也可跑，软阴影交给 three PCFSoft）。
   three 的 shadow map 就是 RGBA-packed depth，解包权重与 `unpackRGBAToDepth` 一致，可直接喂 `tShadow` + `light.shadow.matrix`。
4. 移植资产的 uniform 命名保持上游，便于对照 `.distill/understanding/` 的行号引用。
5. SL 纹理工厂必须用 **RawShaderMaterial**（GLSL3 自带 in/out，不吃 three 前缀，否则 `position` 重定义）；GLSL pass 资产用 ShaderMaterial 即可（GLSL1 语法由 three 兼容宏转换）。
6. `SL_TEX_SETS` 的 `size` 是画质档 `tex` 的比例系数，`tile` 是米制平铺周期，`bump` 经 `0.001*D/tile` 换算进法线 pass——改参数前先读 `references/07-perceptual-quality.md`。
7. 元素 kit 的 three / 材质 / 物理 / 事件全部**参数注入**（`createPropsKit(THREE, …)`、`createFxKit(THREE, …)`、
   `createAudioKit({rng, …})`），kit 内不顶层 import three、零 `Math.random`；node 无 THREE 路径必须仍可跑
   （props 的目录/零件表/碰撞盒/贴花表、fx 的纯 CPU 池推进、audio 的离线混音器都是计量真源）。接新场景先跑 `selfTest()`/`stats()`。
8. `props-kit.build(name, {seed, …})` 返回的组上带 `userData.size/colliders/lamps/decals`；碰撞盒注册走
   `applyPhysics(physics, group, {tag})`（局部坐标、y=0 落地、`bulletOnly` 只挡弹道不挡行走、`rotY=π/2` 时 AABB 由 kit 转置）。
   改尺寸表前同步 `PROP_SIZES` 与对应 builder，`selfTest()` 会逐个 builder 校验「尺寸=目录、零件≥4、碰撞盒≥1、同 seed 逐字节一致」。
9. `fx-kit` 的颜色是**线性 HDR**（火焰 5~40 量级），粒子材质关掉内置 tonemapping，交给 `post-chain` 的 AgX 统一映射
   （否则二次映射）；`stats().drawCalls` 必须等于 `FX_DRAW_CALLS`（5），新增池要同步改预算与门禁。
10. `audio-kit` 的 6ms/12ms 预算是**按构造有界**（4096 样本固定分片步进，不看墙钟），墙钟只做事后监控
    （`stats.overruns/bootMsMax/missMsMax`）；未 `attach(ctx)` 时离线混音器即计量真源，`sample()` 满足
    `combat-kit.mjs:254` 的 audioMeter 合同、`bands()` 给 6 个频段。`AUDIO_SPECS` 里 `gen:"ir"` 的 2 条是卷积 IR，不可直接播放。
11. `weapon-kit` 挂在**相机子节点**（`camera.add(weapon.root)`），每帧一次 `update(dt, input)` 后写 `root.position/rotation`
    再 `applyCamera(camera)`（fov + 后坐/抖动姿态）；`muzzleWorld/shellTransform/shotDir` 喂 `fx-kit`。
    后坐是**相机与弹道同源**：瞄准角只吃 `recoilKeep`(0.35)，其余进视觉偏移，否则会出现「准星与画面对不上」。
12. `enemy-kit` 只做适配不重写：感知/令牌用 `combat-kit` 的 `createAgent/updatePerception/releaseToken`，命中走
    `combat.playerShot(origin, dir, {enemyRaycast})`，头球报 `part:"weak"` 由 combat-kit 施加 ×2.2（`combat-kit.mjs:196-197`）。
    `setSpawnPoints` 至少 6 点；`update(dt, player)` 与 `combat.updateBolts(dt)` 同一 tick；事件载荷逐敌预分配，**消费方不得留存引用**。
13. `player-kit` 每帧顺序固定 `input.update(dt)` → `player.update(dt)` → `input.endFrame()`（pressed 边沿在 endFrame 清零）；
    移动走 `physics-kit.moveCapsule`，`physics` 必填（不注入直接抛错）。相机可选（鸭子类型：`position.set`/`rotation.set`/`fov`/`updateProjectionMatrix`），
    未注入时 `eye/viewPitch/viewYaw/fov` 仍每帧更新；`rng` 仅为签名对齐，kit 内零随机调用。
14. 装配顺序按 `references/12-full-scene-assembly.md` 第 7 层：player → weapon（挂相机）→ enemy（注册刷兵点后 spawn）
    → fx/audio 消费 `player:step/land/jump/hit`、`enemy:fire/killed` 等事件；三 kit 都不改既有资产行为。
15. `hud-kit` 的 `doc`/`mount` 参数注入（无顶层 DOM 访问），HUD 色值只认 token（组件内不硬编码），接新主题改 `tokens` 而不是改 CSS；
    每帧 `update(dt)` 一次，`hitmarker/damageArc/message/feed` 可由 combat/player 事件直接驱动；视口变化要调 `resize()`，卸载调 `dispose()`。
16. `weather-kit` 把 `root` 加进场景，每帧 `update(dt)`；室内盒取 `level.interiorBoxes` 前 4 个（自动 ±0.15 外扩、y -1/+0.3），天窗取前 8 个；
    雷暴 `emit("thunder")` 同时写 sky-deck 的 `uFlash/uFlashDir` 与 post-chain 的 `uThunder`（不要在场景里二次调度）。
    无 three 时纯 CPU 路径仍可跑（雷暴调度/排除表/stats 可 node 测）；`quality.rain` 缩档不会跌破 `minStreaks=800`。
17. `sea.glsl` 按**文件原样读入**（`readAsset("assets/sea.glsl")`）后把各补丁体 `replace` 进 `MeshStandardMaterial` 的锚点，
    `.glsl` 不是 ES module，不要用 `import()` 加载；`customProgramCacheKey` 固定 `saltline-sea-1`；uniform 保上游名
    （`uDetail/uDetailN` 由场景重绑程序化 RT），网格按文末 `gv/kb` 配方建环形级差网格（`frustumCulled=false`、`matrixAutoUpdate=false`）。

## 消费者

- `examples/quality/`：渲染链八系统接入的可运行单文件场景「雨后黄昏堆场」（sky-deck + post-chain + post-aa + pcss + ssr-wet + shafts + sl-surface + sl-textures；ssr-wet 的 `SSR_WET_RR` 块由 build 按标记切出注入），`node examples/quality/build.mjs --assert` 构建、`node harness/render/scene.mjs --scene examples/quality --assert` 真实渲染验收。这是渲染链资产的活体回归样本；kit 层在 `scene.elements.json` 申报 n/a（宿主是 `examples/parity`）。
- `examples/quality/`（自检展厅）：六厅 `?show=mats|props|ground|backdrop|render|level` 可直接进入并截图，`node harness/gates/inspect.mjs --scene examples/quality` 验收；三厅（enemies/weapon/fx）以 `inspect.manifest.json` 写 N/A 理由。
- `examples/starter/`：最小骨架，不消费资产层（对照用）。
- 元素 kit（第五节）：`examples/parity/` 是它们的宿主参照场景（同包新建：`?show=props|fx` 展厅直接用
  `props.showcase()` / `fx` 池；`enemies` 展厅是 `enemy-kit` 刷兵实拍、`weapon` 展厅是 `camera.add(weapon.root)` 实拍、
  `render` 展厅叠 `hud-kit` 的 DOM 层、`ground` 展厅挂 `weather-kit`、`backdrop` 展厅接 `sea.glsl` 海面；
  `__PARITY__.counts` 自报 `propKinds=36`、`decalTypes=22`、`fxKinds/fxPools/drawCalls`、`specs=58`、
  `weaponMeshes/weaponChannels`、`enemyTypes/enemySpawns/enemyRigs`、`hudComponents/hudTokens`、`rainStreaks/splashes`）。
  消费证据是各 kit 的模块级/实例 `selfTest()` 与 `stats()` 实测输出（`sea.glsl` 是 GLSL 资产，做括号/uniform 自检，不做 node 导入）。
- `examples/gameplay/`：三 kit 宿主（physics/level/combat + inspect-deck）；`scene.elements.json` 的 props/enemies
  申报 n/a（未接 props-kit/enemy-kit，敌人是 combat-kit agent bot），与 `harness/gates/assets.mjs` 的
  `n/a(declared:props|enemies)` 交叉校验一致；`node harness/gates/complete.mjs --scene examples/gameplay --structure-only` 验收。
- 门禁：`harness/gates/assets.mjs` 的证据语料只收本场景 `.mjs/.js` 与 `build/<scene>/*.html`（不再收 `.md/.json`，
  也不混入其它场景产物）；`quality/parity/gameplay` 的 `assets.consumption.json` 必填；`--self-test` 覆盖
  空目录/仅 README/仅申报/半接线四个负样例。`KITS` 为八 kit 各挂一组 marker（P2：`createPropsKit/PROP_SIZES/DECAL_SPECS/BUILDER_NAMES`、
  `createFxKit/FX_POOL_SPEC/FX_KINDS/FX_ATLAS`、`createAudioKit/AUDIO_SPECS/AUDIO_BUSES/AUDIO_BUDGET`；P3：`createWeaponKit/WEAPON_ANCHORS/WEAPON_SPRINGS/WEAPON_PARTS`、
  `createEnemyKit/ENEMY_TUNE_DEFAULTS/HIT_ZONES/SKELETONS`、`createPlayerKit/PLAYER_TUNE_DEFAULTS/KEY_ACTIONS/INPUT_MODES`；
  P4：`createHudKit/HUD_TOKENS/HUD_COMPONENTS/HUD_CSS`、`createWeatherKit/WEATHER_POOL_SPEC/WEATHER_TUNE_DEFAULTS/WEATHER_DRAW_CALLS`，均取 kit 内真实导出名）；
  `sea.glsl` 走 `OPTIONAL_SYSTEMS`（`saltline-sea-1/SEA_GLITTER/SEA_NORMAL/uSunDirW` 或资产文件引用）；
  `ssr-wet` 的 marker 含 `SSR_WET_RR_BEGIN`（证明场景按标记从资产切块，而不是内嵌副本）。
  `harness/gates/complete.mjs` 读 `harness/element-manifest.json` 的 `elements[].asset` 与 assets 门禁交叉校验
  （used 不得 missing、n/a 不得被资产门禁判 used）。
  `harness/gates/gameplay.mjs --require-audio` 消费 audio-kit 上报的 `peak/bands`（peak>0.002、bands≥3）。
- 历史验证记录（全资产接入原型、多 pass 管线、降级回退）已随 `prune-scenes` 移除；当前以 `examples/quality` 为准。
