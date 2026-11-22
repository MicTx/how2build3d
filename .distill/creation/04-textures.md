# 创物 · 纹理（textures）

> 上游锚点：纹理管线三段 Qy/前奏/e3 [src:pretty:L32449-L32540]；二十七 个 `surf()` 生成器 [src:pretty:L32542-L32770] [src:pretty:L32771-L33015]；Sobel 高度转法线与分通道拷贝 [src:pretty:L33017-L33033]；二十九 集目录 c3 [src:pretty:L34042-L34072]；烘焙工厂 Gg/A() [src:pretty:L21333-L21357]；噪声原语与破损模型 [src:L4765-L4830] ｜ 我方资产：`assets/sl-textures.mjs`（`SL_TEX` 五段 shader、`SL_GENERATORS` 二十七 个、`SL_TEX_SETS` 二十九 套、`createTextureFactory`）｜ 对账：`harness/element-manifest.json` textures 族 ｜ 验收：`node harness/gates/complete.mjs --scene examples/parity`

## 构建法则

**法则 1 · 一次 MRT 出三张图，通道永不失配**：全屏四边形跑一遍 `surf(uv)`，`emit()` 同时写三张 RT——albedo+alpha、ORM（AO/rough/metal 打包 RGB）、高度（8.8 定点）；随后拷贝与 Sobel 两个辅助 pass 产出成品三件套 [src:pretty:L32449-L32540]。烘焙工厂按尺寸缓存 MRT（同尺寸复用）、按生成器名缓存材质，一次 draw call 产出一张完整的 PBR 集 [src:pretty:L21333-L21357]。因为三张图出自同一像素的同一数学，坑沿、锈斑、AO 在三张图里逐像素对齐——这是「手拼三张贴图」永远做不到的。

**法则 2 · 中间格式为精度服务**：`emit` 把线性 albedo 手动 `sqrt` 编码写入无色彩空间的 MRT，拷贝 pass 再平方还原线性（`uSq>0.5 → t.rgb*t.rgb`），最后写入 `SRGBColorSpace` 的成品 RT 由硬件完成正式编码 [src:pretty:L32449-L32540] [src:pretty:L33017-L33033]。高度走 8.8 定点：`floor` 进 R、小数进 G，读回时 `t.r + t.g/255` 重组，一千二十四 级灰阶骗出 8bit 精度不够的高度场 [src:pretty:L32449-L32540] [src:pretty:L33017-L33033]。中途的每一次「不标准」都是为了让最终交付物标准。

**法则 3 · 法线不是画出来的，是从高度 Sobel 出来的**：8 邻域中心差分算 `gx/gy`，`n = normalize(vec3(-gx*uK.x, -gy*uK.y, 1))`；法线强度 `uK = bump*0.001*D/tile`——把「美术手感参数 bump」换算成与纹理分辨率 D 和米制平铺 tile 双耦合的像素梯度 [src:pretty:L33017-L33033] [src:pretty:L21333-L21357]。tile 越小（细节越密）bump 越大才够看：目录里砖 bump=6/tile1.8、波纹板 19/0.762、水 30/4，这条斜率是调出来的常数 [src:pretty:L34042-L34072]。

**法则 4 · 一切随机可复现**：所有「随机」来自 PCG3 整数哈希 `pcg3` + 周期回卷 `mod(c, per)` + 每生成器私有的种子偏移，`uSeed` 由目录行提供（anodized seed=11、glass_dirty seed=40）[src:pretty:L32449-L32540] [src:pretty:L34042-L34072]。同一 seed 两次烘焙逐字节一致——纹理是纯函数 `f(set, tex档) → 三张图`，不存在「这次生成运气不好」。

**法则 5 · 集合是生成器的参数化视图**：29 套纹理集只对应 27 个生成器，因为「材质身份 = (fn, p, seed, tile, bump) 五元组」：gunmetal 与 anodized 同用 `gunmetal` fn，只差 p=[0.6]/[0.2] 与 seed；glass 与 glass_dirty 同用 `glass` fn，只差脏污参数 p=[0.3]/[1] 与 seed=40 [src:pretty:L34042-L34072]。`p` 经 `uP` 四分量 uniform 进生成器，充当磨损/锈蚀/脏污的唯一旋钮（metal 的 rust、gunmetal 的 wear 都乘 `uP.x`）[src:pretty:L32542-L32770]。加一种「新材质」的正确动作是加一行目录，不是写新 shader。

**法则 6 · 平铺周期用真实世界尺寸，失真由米制兜底**：`tile` 是米——波纹板 `[0.762, 2.286]` 就是真实波距/板宽，轮胎 `[0.5, 0.3]`，成品纹理 `texture.repeat = 1/tile` 完成换算 [src:pretty:L34042-L34072] [src:pretty:L21333-L21357]。画质档只动分辨率不动密度：`size` 是 `cap=min(tex,一千二十四)` 的比例系数（0.25/0.5/1），唯一例外是 hero 集（asphalt）在 `tex≥二千四十八` 时直接升 二千四十八 [src:pretty:L21333-L21357]。

## 完整链路

| 环节 | 内容 | 证据 |
| --- | --- | --- |
| 意图 | 单文件、零图片依赖，交付「启动期 110MB 贴图约 100ms」的全场景 PBR | manifest textures 族 detail；管线三段 [src:pretty:L32449-L32540] |
| 算法 | ① 全屏 quad + `RawShaderMaterial`(GLSL3) 跑 `surf()`，MRT(count=3) 出 albedo/ORM/高度；② copy pass 分通道搬运（albedo 平方解码）；③ Sobel pass 高度→法线（uK 换算）；④ 三张成品 RT 开 mipmap+各向异性 | [src:pretty:L21333-L21357] [src:pretty:L33017-L33033] |
| 常量表 | `SL_TEX_SETS` 29 行：`fn/size/tile/bump/p/seed/hero`；asphalt size=1 hero=true、corrugated tile=[0.762,2.286] bump=19、water tile=4 bump=30 | [src:pretty:L34042-L34072] |
| 上游实现 | 噪声库 fbm/vor(F1,F2,cell 随机)/scr(直划痕)/rustMask [src:L4765-L4800]；共享破损 paintDmg [src:L4801-L4830]；27 个 `surf()` 从沥青到水逐材质手写 [src:pretty:L32542-L32770] [src:pretty:L32771-L33015] |  |
| 我方落点 | `assets/sl-textures.mjs`：`SL_TEX.vertex/prelude/epilogue/heightNormal/copy`、`SL_GENERATORS`（27 个逐字移植）、`SL_TEX_SETS`（29 套）、`createTextureFactory(THREE, renderer, {tex})` → `get/prewarm/update/stats/dispose` | 文件 L23-L132 / L135-L638 / L642-L826 / L828-L940 |
| 运行时证据 | `factory.get("asphalt")` 返回 `{albedo, orm, normal, tile, size}`；`stats()` 实测 `sets/textureMB/genMs`；烘焙期保存/恢复 renderer 状态（autoClear/xr/shadowMap） | [src:pretty:L21333-L21357] |
| 门禁 | textures 族 floor：`textureSets ≥ 十`（上游 二十九）；对账引用 [src:pretty:L34043-L34086] | manifest `floors[0]` |
| 失效与兜底 | MRT 中间 RT 关 mipmap 用 Nearest（不浪费、不模糊）；成品 RT 才开 mipmap+Repeat+各向异性；空闲 4s 回收中间 RT/生成材质（`update()` 驱动），成品集永驻；`RawShaderMaterial` 避免 three 注入的 `position` 撞名 | [src:pretty:L21333-L21357] |

## 思维链

**决策链一 · 为什么中间 MRT 用 Nearest+关 mipmap，成品反而全开**

- **约束**（事实）：MRT 是纯中转，一个尺寸的所有集共用（`mrtCache` 按尺寸缓存），内容下一拍就被拷走 [src:pretty:L21333-L21357]。
- **目标**（事实）：成品要有 mipmap、RepeatWrapping、各向异性（游戏内远近平铺都不闪烁）[src:pretty:L21333-L21357]。
- **候选**（推断）：A 直接在 MRT 上开 mipmap/过滤（省一次拷贝，但 MRT 要按集缓存、显存翻倍）；B 中间最省、成品全开（多两次拷贝 pass）。
- **选择**（事实）：B——中间 Nearest + generateMipmaps:false + ClampToEdge，三个成品 RT 各自 generateMipmaps:true + LinearMipmapLinear + Repeat + aniso≤8 [src:pretty:L21333-L21357]。
- **兜底**（推断）：拷贝成本被启动期吸收（`prewarm` 一次结清），且同尺寸 MRT 复用让 N 个集只付一份中间税。

**决策链二 · 为什么 albedo 要 sqrt→平方往返一圈**

- **约束**（事实）：`emit` 把线性色 `sqrt` 后写入 MRT（o0=vec4(sqrt(c),a)），copy pass 又 `t.rgb*t.rgb` 还原 [src:pretty:L32449-L32540] [src:pretty:L33017-L33033]。
- **目标**（推断）：MRT 无法挂色彩空间变换（`NoColorSpace` 中转），暗部直接存 8bit 线性值会 banding。
- **候选**（推断）：A 线性直存（省事，暗部台阶）；B 手动 gamma 编码中转，硬件 sRGB 编码收尾（暗部精度翻倍）。
- **选择**（事实）：B——sqrt 中转 + copy 平方 + SRGB 成品 RT，一套动作精确补齐 8bit 中转的精度缺口 [src:pretty:L32449-L32540]。
- **兜底**（事实）：ORM/法线不经此处理（uSq=0 直拷），因为它们本来就该存「感知均匀之外」的数据，只有 albedo 吃 gamma 红利 [src:pretty:L33017-L33033]。

**决策链三 · 为什么材质级磨损参数进生成器（uP）而不是进材质工厂**

- **约束**（事实）：磨损（锈、划痕露出亮金属）改变的是 albedo/ORM 的内容，必须在烘焙期定版；运行期只能改湿/脏这类可逆状态（materials 族的分工）[src:L4937-L4967]。
- **目标**（事实）：同一把枪的 gunmetal 与 anodized 部件要有不同的磨损程度 [src:pretty:L34042-L34072]。
- **候选**（推断）：A 再写一套「少磨损」生成器（代码翻倍）；B 同一生成器加 `uP.x` 旋钮，目录行给不同值。
- **选择**（事实）：B——`p:[0.6]` vs `p:[0.2]` 加 seed 区分，两套集共享一份 shader 编译（genCache 按 fn 缓存）[src:pretty:L21333-L21357] [src:pretty:L34042-L34072]。
- **兜底**（事实）：glass 族把「干净/脏」也纳入同一旋钮（p=[0.3]/[1]），证明该模式泛化到透明材质 [src:pretty:L34042-L34072]。

**推断边界**：决策链的「候选/兜底」多为行为反推；可证实的是 MRT/成品的过滤配置、sqrt 往返、uP 复用三件事的位置与参数（行号已钉）。`bytes += size*size*4*1.34` 的 1.34 是 mipmap 链经验系数（1 + 1/3），为推断。

## 迁移法则

- **资产路由**：`createTextureFactory(THREE, renderer, {tex: 画质档})` → `factory.prewarm()`（启动期把全部集结清，运行期零烘焙）→ `createSurfaceMaterialFactory(THREE, factory, {wet})` 消费同批纹理。接材质族必须先过纹理族：`mats.get(name)` 内部按目录行 `set` 字段回源 `factory.get(set)` [src:pretty:L21333-L21357]。
- **参数重绑点**：换场景改 `SL_TEX_SETS` 行内四参数——`p`（磨损/脏污）、`seed`（换布局防「似曾相识」）、`tile`（米制平铺，直接决定地面真实比例）、`bump`（改 tile 必须连动，法则 3 的换算式）。新增集优先复用 二十七 个 fn，确实缺材质再写新 `surf()` 并同时进 `SL_GENERATORS` 与目录 [src:pretty:L34042-L34072]。
- **对账行**：`harness/element-manifest.json` → `elements[id=textures]`：`asset: assets/sl-textures.mjs`、floor `textureSets ≥ 10`（上游 generators=27 / sets=29）、doc 锚 `references/11-element-parity.md#textures`；场景侧自报 `factory.stats().sets` 进 `__PARITY__.counts`，生成毫秒与显存 MB 是 textures 族的运行时证据。
