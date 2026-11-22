// ============================================================
// how2build3d asset: sea.glsl
// system : saltline-sea-1 海面（环形级差网格 + 涌浪位移 + 太阳碎光「猫爪」高光 + 波法线重建 + 雾）
// source : snippets/sea.glsl.mjs（SEA_FRAGMENT）转正；主体为上游 MeshStandardMaterial onBeforeCompile 补丁体逐字移植
// origin : sources/jimao-3a-game/index.html L5661-L5728 [src:pretty:L45031-L45240]（evidence/frames/app.pretty.js）
// note   : 原样移植（保参数与数学），uniform 命名保持上游；接入时按场景重绑定。
// ============================================================
// saltline-sea-1 —— 上游 customProgramCacheKey 即此 marker；uniform 组保持上游命名（uTime/uDetail/uDetailN/uHazeA/uHazeB/uSunDirW）。
//
// 接入：底材 MeshStandardMaterial({ color: 16777215, roughness: 0.1, metalness: 0 })，receiveShadow=true、
// castShadow=false、frustumCulled=false、matrixAutoUpdate=false。补丁锚点（与上游 onBeforeCompile 一致）：
//   vertexShader   = VERT_HEAD + 标准头.replace("#include <begin_vertex>", 下列 SEA_BEGIN_VERTEX 本体)
//   fragmentShader = 标准头
//     .replace("#include <common>",                "#include <common>\n" + SEA_COMMON)
//     .replace("#include <map_fragment>",          SEA_MAP_FRAGMENT)
//     .replace("#include <roughnessmap_fragment>", "float roughnessFactor = gRough;")
//     .replace("#include <normal_fragment_maps>",  "#include <normal_fragment_maps>\n" + SEA_NORMAL)
//     .replace("#include <lights_fragment_maps>",  "#include <lights_fragment_maps>\n  radiance *= gOcc; iblIrradiance *= gOcc;")
//     .replace("#include <lights_fragment_end>",   "#include <lights_fragment_end>\n" + SEA_GLITTER)
//     .replace("#include <opaque_fragment>",       SEA_FOG + "\n#include <opaque_fragment>")
//   customProgramCacheKey = () => "saltline-sea-1"
//
// uniforms（上游 uniform 袋 y，按场景重绑定）：uTime{0}、uDetail/uDetailN{程序化 RT 纹理}、
//   uHazeA{horizonAway*0.85}、uHazeB{horizon*0.8}、uSunDirW{太阳世界方向}。
// 波表已内联为字面量（生成式：dir 归一化，k=2π/λ，ω=√(9.81k) 深水色散 [src:pretty:L45031-L45048]）：
//   B1 涌浪 4 波（波长 9.5/5.7/3.3/2 m，振幅 .06/.04/.026/.016 m）→ 顶点位移 SEA_BEGIN_VERTEX + 斜率 slopeA；
//   Db 碎波 7 波（波长 1.31..0.21 m）→ 斜率 slopeB（近岸权重）。
//
// 环形几何级差网格（JS 侧 BufferGeometry 配方，gv/kb [src:pretty:L45123-L45178]；seaY=-1.6）：
//   gv(start,end,step,grow,cap)：从 start 走到 end，每步 step*=grow、封顶 cap，收集环距序列。
//   x 环 n = gv(27.5, 880, 0.75, 1.075, 120) —— 63 环，自码头墙 x=30 内缩 2.5 m 起步，近处 0.75 m/环，
//     按几何级数 ×1.075 放宽至 120 m/环直到 880 m（分辨率随距离增长，非等密度平面）；
//   z 线 r = [-s 倒序镜像] + gv(-47.1, 47.1, 0.9, 1, 0.9)（带内 106 条均匀）+ s，其中 s = gv(48, 880, 0.9, 1.085, 120)（55 条），共 216 条；
//   主网格 63×216=13 608 顶点（y=seaY，normal 全 (0,1,0)），另 3 块角部补丁各 4 顶点 2 三角：
//     p(-880,-880, 27.5,-158) / p(-880, 158, 27.5, 880) / p(-880,-158,-158, 158)；
//   boundingSphere = 球心(0, seaY, 0) 半径 1300。规模 ~13 620 顶点 / ~26 672 三角（draw call=1）。

// ---- SEA_VERT_HEAD · 前置于 vertexShader 顶部 ----
uniform float uTime; varying vec3 vGWorld; varying float vSAmp;

// ---- SEA_BEGIN_VERTEX · anchor: replace("#include <begin_vertex>", 本体) ----
// 涌浪位移：B1 四波 y 升沉 + xz 一阶；幅度在码头墙 (x=30) 旁 50→220 m 平滑衰减到 0
  vec3 swp = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vSAmp = 1.0 - smoothstep(50.0, 220.0, distance(swp.xz, vec2(30.0, 0.0)));
  vec3 sdisp = vec3(0.0);
  { float ph = 0.66139 * dot(vec2(-0.92069, 0.39029), swp.xz) - 2.54720 * uTime; sdisp.y += 0.06000 * sin(ph); sdisp.xz += vec2(-0.92069, 0.39029) * (0.03600 * cos(ph)); }
  { float ph = 1.10231 * dot(vec2(-0.75071, -0.66063), swp.xz) - 3.28842 * uTime; sdisp.y += 0.04000 * sin(ph); sdisp.xz += vec2(-0.75071, -0.66063) * (0.02400 * cos(ph)); }
  { float ph = 1.90400 * dot(vec2(-0.99273, 0.12033), swp.xz) - 4.32183 * uTime; sdisp.y += 0.02600 * sin(ph); sdisp.xz += vec2(-0.99273, 0.12033) * (0.01560 * cos(ph)); }
  { float ph = 3.14159 * dot(vec2(-0.49828, 0.86701), swp.xz) - 5.55149 * uTime; sdisp.y += 0.01600 * sin(ph); sdisp.xz += vec2(-0.49828, 0.86701) * (0.00960 * cos(ph)); }
  transformed += sdisp * vSAmp;
  vGWorld = swp;

// ---- SEA_COMMON · anchor: replace("#include <common>", "#include <common>\n" + 本体) ----
uniform float uTime; uniform sampler2D uDetail, uDetailN; uniform vec3 uHazeA, uHazeB, uSunDirW;
varying vec3 vGWorld; varying float vSAmp;
float gRough; vec2 gNxz; float gOcc; float gSDist; float gSpark;

// ---- SEA_MAP_FRAGMENT · anchor: replace("#include <map_fragment>", 本体) ----
// 波法线源：slopeA(涌浪, vSAmp 权重) + slopeB(碎波, 近岸权重) + 三层 uDetailN 细波；
// 泡沫/油膜沿码头墙 (x=30) 与系泊船壳 SDF；风结构：猫爪斑块 (gust) + 长涌明暗 (swell) → gSpark
{
  vec2 sxz = vGWorld.xz;
  float sd = length(cameraPosition - vGWorld); gSDist = sd;
  vec2 slopeA = vec2(0.0), slopeB = vec2(0.0);
  slopeA += vec2(-0.92069, 0.39029) * (0.03968 * cos(0.66139 * dot(vec2(-0.92069, 0.39029), sxz) - 2.54720 * uTime));
  slopeA += vec2(-0.75071, -0.66063) * (0.04409 * cos(1.10231 * dot(vec2(-0.75071, -0.66063), sxz) - 3.28842 * uTime));
  slopeA += vec2(-0.99273, 0.12033) * (0.04950 * cos(1.90400 * dot(vec2(-0.99273, 0.12033), sxz) - 4.32183 * uTime));
  slopeA += vec2(-0.49828, 0.86701) * (0.05027 * cos(3.14159 * dot(vec2(-0.49828, 0.86701), sxz) - 5.55149 * uTime));
  slopeB += vec2(-0.80000, 0.60000) * (0.09593 * cos(4.79632 * dot(vec2(-0.80000, 0.60000), sxz) - 6.85944 * uTime));
  slopeB += vec2(-0.95067, -0.31022) * (0.10598 * cos(7.57010 * dot(vec2(-0.95067, -0.31022), sxz) - 8.61758 * uTime));
  slopeB += vec2(-0.34894, -0.93715) * (0.11023 * cos(11.02313 * dot(vec2(-0.34894, -0.93715), sxz) - 10.39889 * uTime));
  slopeB += vec2(-0.60000, 0.80000) * (0.11278 * cos(16.11073 * dot(vec2(-0.60000, 0.80000), sxz) - 12.57165 * uTime));
  slopeB += vec2(-0.99875, 0.04994) * (0.11636 * cos(23.27106 * dot(vec2(-0.99875, 0.04994), sxz) - 15.10924 * uTime));
  slopeB += vec2(0.30113, 0.95358) * (0.08021 * cos(13.36848 * dot(vec2(0.30113, 0.95358), sxz) - 11.45185 * uTime));
  slopeB += vec2(-0.86013, -0.51008) * (0.10472 * cos(29.91993 * dot(vec2(-0.86013, -0.51008), sxz) - 17.13227 * uTime));
  float nearB = 1.0 - smoothstep(25.0, 110.0, sd);
  vec2 t1 = texture2D(uDetailN, sxz * 0.113 + uTime * vec2(-0.021, 0.009)).ba - 0.5;
  vec2 t2 = texture2D(uDetailN, sxz * 0.031 + uTime * vec2(-0.007, -0.004)).ba - 0.5;
  vec2 t3 = texture2D(uDetailN, sxz.yx * 0.39 + uTime * vec2(0.031, -0.027)).ba - 0.5;
  gNxz = slopeA * vSAmp + slopeB * nearB + t1 * 0.2 + t2 * 0.24 + t3 * 0.1 * nearB;
  // foam / scum along the quay wall (x = 30) and around the moored hull x[33,49] z[-60,-9]
  float dq = sxz.x - 30.0;
  vec2 hq = abs(sxz - vec2(41.0, -34.5)) - vec2(4.0, 21.5);
  float dh = length(max(hq, 0.0)) + min(max(hq.x, hq.y), 0.0) - 4.0;
  float de = min(dq, dh);
  vec4 fn = texture2D(uDetail, sxz * 0.41 + uTime * vec2(-0.012, 0.007));
  vec4 fn2 = texture2D(uDetail, sxz * 0.093 + uTime * vec2(0.004, 0.003));
  float band = 1.0 - smoothstep(0.0, 0.2 + fn2.g * fn2.g * 2.2, de);
  float foam = clamp(band * smoothstep(0.5, 0.68, fn.a * 0.55 + fn.r * 0.25 + fn2.g * 0.3 + band * 0.2), 0.0, 1.0) * step(-0.3, de);
  float scum = (1.0 - smoothstep(0.0, 5.0, de)) * smoothstep(0.4, 0.7, fn2.g);
  vec3 alb = vec3(0.0045, 0.013, 0.017);
  alb = mix(alb, vec3(0.03, 0.04, 0.034), scum * 0.6);
  alb = mix(alb, vec3(0.3, 0.32, 0.3), foam * 0.7);
  diffuseColor.rgb *= alb;
  // wind structure: broad cat's-paw patches (ruffled, darker, duller) between calmer slicks, plus long swell shading
  vec4 fn3 = texture2D(uDetail, sxz * 0.0123 + uTime * vec2(0.0016, 0.0011));
  float gust = smoothstep(0.38, 0.62, fn2.g * 0.45 + fn3.g * 0.75 - 0.1);
  float swell = sin(dot(sxz, vec2(-0.118, 0.05)) - uTime * 0.55 + fn3.a * 5.0) * 0.5 + 0.5;
  gNxz = gNxz * mix(0.4, 1.35, gust) + vec2(-0.92, 0.39) * (swell - 0.5) * 0.07;
  gSpark = mix(0.55, 1.0, swell) * mix(1.0, 0.6, gust);
  diffuseColor.rgb *= mix(1.0, 0.6, gust);
  gRough = mix(mix(0.1, 0.32, smoothstep(12.0, 380.0, sd)) * mix(0.62, 1.5, gust), 0.65, max(foam, scum * 0.3));
  gNxz *= 1.0 - foam * 0.6;
  gOcc = mix(0.3, 1.0, smoothstep(0.0, 8.0, de)) * mix(0.8, 1.05, swell);
}

// ---- roughnessmap 替换 · anchor: replace("#include <roughnessmap_fragment>", 本行) ----
float roughnessFactor = gRough;

// ---- SEA_NORMAL · 波法线重建 · anchor: replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n" + 本体) ----
// 世界 xz 坡度 gNxz → 切线空间法线（水面无 UV 法线贴图，全部由波场解析重建）
  normal = normalize(mat3(viewMatrix) * normalize(vec3(-gNxz.x, 1.0, -gNxz.y)));

// ---- 替换 · anchor: replace("#include <lights_fragment_maps>", "#include <lights_fragment_maps>\n" + 本行) ----
// 近墙/船壳遮蔽（de<8 m 处 IBL 压暗）
  radiance *= gOcc; iblIrradiance *= gOcc;

// ---- SEA_GLITTER · 太阳碎光「猫爪」高光 · anchor: replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\n" + 本体) ----
// 强度钳 40 HDR；沿太阳方位角 az³ 聚束，涌浪/猫爪经 gSpark 打碎
  { // sun glitter: strongest along the sun's azimuth, calmer to the sides; broken by swell and cat's paws
    vec3 sv = normalize(vGWorld - cameraPosition);
    float az = max(dot(normalize(sv.xz + vec2(1e-5)), normalize(uSunDirW.xz)), 0.0);
    reflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(40.0)) * gSpark * mix(0.3, 1.0, az * az * az);
  }

// ---- SEA_FOG · 雾 · anchor: replace("#include <opaque_fragment>", 本体 + "\n#include <opaque_fragment>") ----
// 220→860 m 推向地平线雾色；朝太阳一侧用 uHazeB（日光色），背侧 uHazeA
{
  vec3 sdir = normalize(vGWorld - cameraPosition);
  float toSun = pow(max(dot(normalize(sdir.xz + vec2(1e-5)), normalize(uSunDirW.xz)), 0.0), 3.0);
  vec3 hz = mix(uHazeA, uHazeB, toSun);
  outgoingLight = mix(outgoingLight, hz, smoothstep(220.0, 860.0, gSDist) * 0.8);
}
