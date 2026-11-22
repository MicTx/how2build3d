/* sl-surface.mjs — SL 表面注入与材质工厂（原样移植）
 *
 * 来源：上游 Saltline 捕获明文 evidence/frames/app.pretty.js：
 *   - 注入七段（dA/pA/mA/gA/vA/xA/yA）   [src:pretty:L34156-L34318]
 *   - AO 替换（ShaderChunk.aomap_fragment 的 .r 读取换成 slORM.r）[src:pretty:L34318]
 *   - 注入器 h3                          [src:pretty:L34320-L34344]
 *   - 材质工厂 w + 缓存键 "sl2|..."       [src:pretty:L34470-L34535]
 *   - 材质目录 l1（48 种）与调色板        [src:pretty:L34074-L34154]
 *
 * 这一层就是案例质感的来源之一：世界空间 triplanar、ORM 打包、macro 大尺度变化、
 * 雨湿/流挂/水珠、法线长度反调粗糙度、铁丝网 mip 渐隐、SL_TINT 贴花合成。
 * uniforms 保留上游命名：uSlWet（全局湿度 0..1）、uSlWetP（暗降/粗糙/湿痕/水珠）、
 * uSlMacro（亮度/粗糙/尺度/污垢）、uSlUv（uv 缩放与 triplanar 世界尺度）、uSlX（环境系数）。
 *
 * 用法（配合 assets/sl-textures.mjs）：
 *   const texFactory = createTextureFactory(THREE, renderer, { tex: 1024 });
 *   const mats = createSurfaceMaterialFactory(THREE, texFactory, { wet: 1 });
 *   scene.add(new THREE.Mesh(geo, mats.get("asphalt")));   // 世界 UV 几何
 *   scene.add(new THREE.Mesh(geo, mats.get("gunmetal", { triplanar: true }))); // 无 UV 几何
 *   // 每帧：mats.update(); 并在下雨时改 mats.uniforms.wet.value
 */
export const SL_SURFACE = {
  vertexDecl: `
varying vec3 vSlPos;
#ifdef SL_TRIPLANAR
varying vec3 vSlONrm; varying vec3 vSlAx; varying vec3 vSlAy;
#endif
`,
  vertexBody: `
#ifdef SL_TRIPLANAR
  vSlPos = position; vSlONrm = normal;
  vec3 slAx = vec3(1.0, 0.0, 0.0), slAy = vec3(0.0, 1.0, 0.0);
  #ifdef USE_SKINNING
    slAx = (skinMatrix * vec4(slAx, 0.0)).xyz; slAy = (skinMatrix * vec4(slAy, 0.0)).xyz;
  #endif
  #ifdef USE_INSTANCING
    slAx = mat3(instanceMatrix) * slAx; slAy = mat3(instanceMatrix) * slAy;
  #endif
  vSlAx = normalize(mat3(modelViewMatrix) * slAx); vSlAy = normalize(mat3(modelViewMatrix) * slAy);
#else
  vec4 slWP = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    slWP = instanceMatrix * slWP;
  #endif
  vSlPos = (modelMatrix * slWP).xyz;
#endif
`,
  fragDecl: `
uniform float uSlWet; uniform vec4 uSlWetP; uniform vec4 uSlMacro; uniform vec3 uSlUv; uniform vec2 uSlX;
varying vec3 vSlPos;
#ifdef SL_TRIPLANAR
varying vec3 vSlONrm; varying vec3 vSlAx; varying vec3 vSlAy;
vec3 slTw; vec2 slUx; vec2 slUy; vec2 slUz;
vec4 slTri(sampler2D t){ return texture2D(t, slUx) * slTw.x + texture2D(t, slUy) * slTw.y + texture2D(t, slUz) * slTw.z; }
#endif
vec4 slORM; vec2 slUv; float slWetK = 0.0; float slUp = 0.0; float slMac = 0.5; float slMac2 = 0.5; float slBead = 0.0;
float slH(vec3 p){ p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float slN3(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(slH(i), slH(i + vec3(1.0, 0.0, 0.0)), f.x), mix(slH(i + vec3(0.0, 1.0, 0.0)), slH(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(slH(i + vec3(0.0, 0.0, 1.0)), slH(i + vec3(1.0, 0.0, 1.0)), f.x), mix(slH(i + vec3(0.0, 1.0, 1.0)), slH(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
`,
  mapBody: `
#ifdef SL_TRIPLANAR
  { vec3 slOn = normalize(vSlONrm); vec3 slW3 = pow(abs(slOn), vec3(6.0)); slTw = slW3 / (slW3.x + slW3.y + slW3.z);
    vec3 slQ = vSlPos * uSlUv.z; slUx = slQ.zy; slUy = slQ.xz; slUz = slQ.xy; }
  vec4 sampledDiffuseColor = slTri(map);
  slORM = slTri(roughnessMap);
#else
  slUv = vMapUv * uSlUv.xy;
  vec4 sampledDiffuseColor = texture2D(map, slUv);
  slORM = texture2D(roughnessMap, slUv);
#endif
#ifdef SL_FX
  {
    #ifdef FLAT_SHADED
      vec3 slVN = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
    #else
      vec3 slVN = normalize(vNormal);
      #ifdef DOUBLE_SIDED
        slVN *= gl_FrontFacing ? 1.0 : -1.0;
      #endif
    #endif
    vec3 slWN = inverseTransformDirection(slVN, viewMatrix);
    vec3 slMp = vSlPos * uSlMacro.z;
    slMac = slN3(slMp); slMac2 = slN3(slMp * 3.7 + 11.3);
    float slM = slMac * 0.65 + slMac2 * 0.35 - 0.5;
    sampledDiffuseColor.rgb *= 1.0 + uSlMacro.x * slM * 2.0;
    float slGr = smoothstep(0.5, 0.85, slMac * 0.6 + slMac2 * 0.4 + (1.0 - slORM.r) * 0.3) * uSlMacro.w;
    sampledDiffuseColor.rgb *= 1.0 - slGr * 0.35;
    #if SL_TINT == 1
      sampledDiffuseColor.a *= 1.0 - slGr * 0.2;
    #endif
    // rain wetness: strongest on up-facing faces, streaky on verticals, none underneath
    slUp = smoothstep(0.15, 0.85, slWN.y);
    float slExpo = smoothstep(-0.4, -0.05, slWN.y);
    float slStreak = 0.0;
    #ifndef SL_TRIPLANAR
      float slSc = vSlPos.x + vSlPos.z;
      slStreak = slN3(vec3(slSc * 9.0, vSlPos.y * 0.55, slSc * 0.7 + 3.0)) * slN3(vec3(slSc * 29.0, vSlPos.y * 1.1, 7.0));
      slStreak = smoothstep(0.12, 0.42, slStreak) * smoothstep(0.3, 0.7, slN3(vec3(slSc * 1.1, vSlPos.y * 0.25, 1.7)));
    #endif
    float slW = uSlWet * uSlX.x * slExpo;
    slWetK = slW * mix(uSlWetP.z * (0.55 + 0.9 * slStreak), 0.75 + 0.5 * slMac, slUp);
    #ifndef SL_TRIPLANAR
      { float slLow = smoothstep(0.5, 0.0, vSlPos.y) * (1.0 - slUp) * slExpo;        // damp, splashed band where things meet the ground
        slWetK += slW * slLow * 0.6;
        float slLg = 1.0 - slLow * min(uSlMacro.w, 0.5) * 0.45;
        sampledDiffuseColor.rgb *= slLg;
        #if SL_TINT == 1
          sampledDiffuseColor.a *= slLg;
        #endif
      }
    #endif
    slWetK = clamp(slWetK, 0.0, 1.0);
    float slBf = clamp(1.0 - length(fwidth(vSlPos)) * 120.0, 0.0, 1.0);
    if (uSlWetP.w > 0.0 && slBf > 0.0) {
      float slB = slN3(vSlPos * 170.0) * 0.6 + slN3(vSlPos * 410.0 + 5.0) * 0.4;
      slBead = smoothstep(0.6, 0.68, slB) * uSlWetP.w * slW * slBf * (0.4 + 0.6 * slUp + 0.5 * slStreak);
    }
  }
#endif
#if SL_TINT == 1
  diffuseColor.rgb = sampledDiffuseColor.rgb + diffuse * sampledDiffuseColor.a;
#elif SL_TINT == 2
  { float slL = clamp(dot(sampledDiffuseColor.rgb, vec3(0.3333)) / 0.19, 0.55, 1.35);
    diffuseColor.rgb = mix(sampledDiffuseColor.rgb, diffuse * slL, sampledDiffuseColor.a * 0.96); }
#elif SL_TINT == 3
  diffuseColor *= sampledDiffuseColor;
#else
  diffuseColor.rgb *= sampledDiffuseColor.rgb;
#endif
#ifdef SL_FX
  { float slLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
    diffuseColor.rgb = mix(vec3(slLum), diffuseColor.rgb, 1.0 + 0.25 * slWetK * uSlWetP.x * 2.0);
    diffuseColor.rgb *= 1.0 - uSlWetP.x * slWetK; }
#endif
#ifdef SL_ACUT
  // alpha-tested wire mesh that survives distance: wires stay ~1 px wide through the mips (lowered threshold),
  // then dissolve into a stable ~1/3-coverage dither veil once the diamonds themselves are sub-pixel.
  { vec2 slFw = fwidth(slUv) * 512.0; float slLod = log2(max(max(slFw.x, slFw.y), 1e-4));
    float slThC = 0.5 * exp2(-clamp(slLod - 1.0, 0.0, 4.0));
    float slIgn = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float slTh = mix(slThC, 0.05 + slIgn * 0.80, smoothstep(3.5, 5.5, slLod));
    diffuseColor.a = sampledDiffuseColor.a > slTh ? 1.0 : 0.0;
    // sub-pixel wires: the surviving fragments stand in for a much thinner wire, so dim them (no white sheets in the sun)
    diffuseColor.rgb *= mix(1.0, 0.45, smoothstep(1.5, 4.5, slLod)); }
#endif
`,
  roughBody: `
float roughnessFactor = roughness * slORM.g;
#ifdef SL_FX
  roughnessFactor += uSlMacro.y * ((slMac2 - 0.5) * 1.4 + (slMac - 0.5) * 0.8);
  roughnessFactor = mix(roughnessFactor, roughnessFactor * uSlWetP.y, slWetK);
  roughnessFactor = mix(roughnessFactor, 0.05, slBead);
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) && !defined( SL_TRIPLANAR )
  { float slNl = length(texture2D(normalMap, slUv).xyz * 2.0 - 1.0);
    roughnessFactor = sqrt(roughnessFactor * roughnessFactor + clamp(1.0 - slNl, 0.0, 1.0) * 0.6); }
#endif
roughnessFactor = clamp(roughnessFactor, 0.045, 1.0);
`,
  metalBody: `
float metalnessFactor = metalness * slORM.b;
`,
  normalBody: `
#ifdef SL_TRIPLANAR
  { vec3 slOn = normalize(vSlONrm);
    vec3 slTx = texture2D(normalMap, slUx).xyz * 2.0 - 1.0, slTy = texture2D(normalMap, slUy).xyz * 2.0 - 1.0, slTz = texture2D(normalMap, slUz).xyz * 2.0 - 1.0;
    slTx.xy *= normalScale; slTy.xy *= normalScale; slTz.xy *= normalScale;
    slTx = vec3(slTx.xy + slOn.zy, abs(slTx.z) * slOn.x); slTy = vec3(slTy.xy + slOn.xz, abs(slTy.z) * slOn.y); slTz = vec3(slTz.xy + slOn.xy, abs(slTz.z) * slOn.z);
    vec3 slNo = normalize(slTx.zyx * slTw.x + slTy.xzy * slTw.y + slTz.xyz * slTw.z);
    vec3 slA = normalize(vSlAx), slB = normalize(vSlAy); vec3 slC = cross(slA, slB);
    normal = normalize(slA * slNo.x + slB * slNo.y + slC * slNo.z);
    #ifdef DOUBLE_SIDED
      normal *= faceDirection;
    #endif
  }
#elif defined( USE_NORMALMAP_TANGENTSPACE )
  { vec3 mapN = texture2D(normalMap, slUv).xyz * 2.0 - 1.0;
    mapN.xy *= normalScale * (1.0 - 0.45 * slWetK * slUp);
    normal = normalize(tbn * mapN); }
#endif
`,
};

/* 材质目录（原 l1，48 种）。wet=[暗降, 粗糙乘, 湿痕强度, 水珠]；macro=[亮度, 粗糙, 尺度, 污垢]。 */
export const SL_MATERIALS = {
  asphalt: {
      set: "asphalt",
      tint: 0,
      color: "0xffffff",
      rough: 1,
      metal: 1,
      wet: [0.45,0.3,0.5,0],
      macro: [0.22,0.12,0.35,0.35],
      nrm: 1,
  },
  concrete: {
      set: "concrete",
      tint: 0,
      color: "0xffffff",
      rough: 1,
      metal: 1,
      wet: [0.42,0.38,0.5,0],
      macro: [0.22,0.12,0.35,0.35],
      nrm: 1,
  },
  concrete_dirty: {
      set: "concrete",
      tint: 0,
      color: "0xcfc6b6",
      rough: 1,
      metal: 1,
      wet: [0.42,0.38,0.5,0],
      macro: [0.3,0.15,0.35,0.9],
      nrm: 1,
  },
  concrete_painted: {
      set: "concrete",
      tint: 2,
      color: "0x8e9296",
      rough: 0.9,
      metal: 1,
      wet: [0.15,0.55,0.6,0.3],
      macro: [0.14,0.1,0.5,0.3],
      nrm: 1,
  },
  brick: {
      set: "brick",
      tint: 0,
      color: "0xffffff",
      rough: 1,
      metal: 1,
      wet: [0.42,0.38,0.5,0],
      macro: [0.14,0.1,0.8,0.2],
      nrm: 1,
  },
  floor_epoxy: {
      set: "epoxy",
      tint: 0,
      color: "0xffffff",
      rough: 1,
      metal: 1,
      wet: [0.04,0.75,0.4,0],
      macro: [0.12,0.2,0.45,0.25],
      nrm: 1,
  },
  paint_red: {
      set: "paint",
      tint: 1,
      color: "0x7d2219",
      rough: 1,
      metal: 1,
      wet: [0.05,0.62,0.65,0.7],
      macro: [0.2,0.16,0.4,0.45],
      nrm: 1,
  },
  paint_blue: {
      set: "paint",
      tint: 1,
      color: "0x1f3f66",
      rough: 1,
      metal: 1,
      wet: [0.05,0.62,0.65,0.7],
      macro: [0.2,0.16,0.4,0.45],
      nrm: 1,
  },
  paint_green: {
      set: "paint",
      tint: 1,
      color: "0x2c5a44",
      rough: 1,
      metal: 1,
      wet: [0.05,0.62,0.65,0.7],
      macro: [0.2,0.16,0.4,0.45],
      nrm: 1,
  },
  paint_yellow: {
      set: "paint",
      tint: 1,
      color: "0xb98a1c",
      rough: 1,
      metal: 1,
      wet: [0.05,0.62,0.65,0.7],
      macro: [0.2,0.16,0.4,0.45],
      nrm: 1,
  },
  paint_orange: {
      set: "paint",
      tint: 1,
      color: "0xb3521a",
      rough: 1,
      metal: 1,
      wet: [0.05,0.62,0.65,0.7],
      macro: [0.2,0.16,0.4,0.45],
      nrm: 1,
  },
  paint_white: {
      set: "paint",
      tint: 1,
      color: "0xb9bbb6",
      rough: 1,
      metal: 1,
      wet: [0.05,0.62,0.65,0.7],
      macro: [0.2,0.16,0.4,0.45],
      nrm: 1,
  },
  paint_grey: {
      set: "paint",
      tint: 1,
      color: "0x5a6068",
      rough: 1,
      metal: 1,
      wet: [0.05,0.62,0.65,0.7],
      macro: [0.2,0.16,0.4,0.45],
      nrm: 1,
  },
  paint_teal: {
      set: "paint",
      tint: 1,
      color: "0x1f5d63",
      rough: 1,
      metal: 1,
      wet: [0.05,0.62,0.65,0.7],
      macro: [0.2,0.16,0.4,0.45],
      nrm: 1,
  },
  steel_galv: {
      set: "galv",
      tint: 0,
      color: "0xffffff",
      rough: 1,
      metal: 1,
      wet: [0,0.7,0.55,0.5],
      macro: [0.14,0.1,0.8,0.2],
      nrm: 1,
  },
  steel_dark: {
      set: "metal",
      tint: 1,
      color: "0x3d4146",
      rough: 1.15,
      metal: 1,
      wet: [0,0.7,0.55,0.5],
      macro: [0.14,0.1,0.8,0.2],
      nrm: 1,
  },
  steel_worn: {
      set: "metal",
      tint: 1,
      color: "0x8a8e92",
      rough: 0.9,
      metal: 1,
      wet: [0,0.7,0.55,0.5],
      macro: [0.14,0.1,0.8,0.2],
      nrm: 1,
  },
  steel_bare: {
      set: "brushed",
      tint: 1,
      color: "0xb4b8bb",
      rough: 1,
      metal: 1,
      wet: [0,0.7,0.55,0.5],
      macro: [0.07,0.06,3,0],
      nrm: 1,
  },
  steel_rust: {
      set: "rust",
      tint: 0,
      color: "0xffffff",
      rough: 1,
      metal: 1,
      wet: [0.3,0.6,0.55,0],
      macro: [0.14,0.1,0.8,0.2],
      nrm: 1,
  },
  diamond_plate: {
      set: "diamond",
      tint: 0,
      color: "0xffffff",
      rough: 1,
      metal: 1,
      wet: [0,0.7,0.55,0.5],
      macro: [0.14,0.1,0.8,0.2],
      nrm: 1,
  },
  corrugated_roof: {
      set: "corrugated",
      tint: 0,
      color: "0xffffff",
      rough: 1,
      metal: 1,
      wet: [0,0.7,0.55,0.5],
      macro: [0.14,0.1,0.8,0.2],
      nrm: 1,
  },
  chainlink: {
      set: "chainlink",
      tint: 3,
      color: "0xffffff",
      rough: 1,
      metal: 1,
      wet: [0,1,0,0],
      macro: [0,0,1,0],
      nrm: 1,
      alphaCut: true,
      side: 2,
  },
  aluminium: {
      set: "brushed",
      tint: 1,
      color: "0xc4c8cb",
      rough: 1.15,
      metal: 1,
      wet: [0,0.7,0.55,0.5],
      macro: [0.07,0.06,3,0],
      nrm: 1,
  },
  brass: {
      set: "brushed",
      tint: 1,
      color: "0xc29a45",
      rough: 0.9,
      metal: 1,
      wet: [0,0.7,0.55,0.5],
      macro: [0.1,0.08,20,0],
      nrm: 1,
  },
  hazard_stripes: {
      set: "hazard",
      tint: 0,
      color: "0xffffff",
      rough: 1,
      metal: 1,
      wet: [0.05,0.62,0.65,0.7],
      macro: [0.14,0.1,0.8,0.2],
      nrm: 1,
  },
  gunmetal: {
      set: "gunmetal",
      tint: 1,
      color: "0x2a2d31",
      rough: 1,
      metal: 1,
      wet: [0,0.75,0.6,0.5],
      macro: [0.08,0.06,6,0],
      nrm: 1,
  },
  anodized_black: {
      set: "anodized",
      tint: 1,
      color: "0x121416",
      rough: 0.72,
      metal: 0.9,
      wet: [0,0.75,0.6,0.5],
      macro: [0.06,0.05,6,0],
      nrm: 1,
  },
  polymer_black: {
      set: "polymer",
      tint: 1,
      color: "0x17181a",
      rough: 1,
      metal: 1,
      wet: [0,0.7,0.6,0.5],
      macro: [0.06,0.06,6,0],
      nrm: 1,
  },
  polymer_tan: {
      set: "polymer",
      tint: 1,
      color: "0x6f6048",
      rough: 1,
      metal: 1,
      wet: [0,0.7,0.6,0.5],
      macro: [0.06,0.06,6,0],
      nrm: 1,
  },
  rubber: {
      set: "polymer",
      tint: 1,
      color: "0x101010",
      rough: 1.4,
      metal: 1,
      wet: [0.05,0.6,0.6,0.4],
      macro: [0.06,0.06,6,0],
      nrm: 1,
  },
  carbon: {
      set: "carbon",
      tint: 0,
      color: "0xffffff",
      rough: 1,
      metal: 1,
      wet: [0,0.8,0.6,0.5],
      macro: [0.05,0.05,6,0],
      nrm: 1,
  },
  glove_fabric: {
      set: "fabric",
      tint: 1,
      color: "0x23262a",
      rough: 1,
      metal: 1,
      wet: [0.3,0.7,0.6,0],
      macro: [0.08,0.04,8,0],
      nrm: 1,
  },
  armor_white: {
      set: "armor",
      tint: 1,
      color: "0xaeb4b8",
      rough: 1,
      metal: 1,
      wet: [0.05,0.62,0.65,0.7],
      macro: [0.08,0.08,2.5,0.15],
      nrm: 1,
  },
  armor_orange: {
      set: "armor",
      tint: 1,
      color: "0xc1551a",
      rough: 1,
      metal: 1,
      wet: [0.05,0.62,0.65,0.7],
      macro: [0.08,0.08,2.5,0.15],
      nrm: 1,
  },
  wood_pallet: {
      set: "wood",
      tint: 0,
      color: "0xffffff",
      rough: 1,
      metal: 1,
      wet: [0.4,0.5,0.6,0],
      macro: [0.2,0.1,0.9,0.4],
      nrm: 1,
  },
  wood_dark: {
      set: "wood",
      tint: 0,
      color: "0x8a786a",
      rough: 1,
      metal: 1,
      wet: [0.4,0.5,0.6,0],
      macro: [0.2,0.1,0.9,0.4],
      nrm: 1,
  },
  plastic_blue: {
      set: "plastic",
      tint: 1,
      color: "0x1d4c86",
      rough: 1,
      metal: 1,
      wet: [0.08,0.62,0.6,0.5],
      macro: [0.14,0.1,0.8,0.2],
      nrm: 1,
  },
  plastic_red: {
      set: "plastic",
      tint: 1,
      color: "0x8e1f1a",
      rough: 1,
      metal: 1,
      wet: [0.08,0.62,0.6,0.5],
      macro: [0.14,0.1,0.8,0.2],
      nrm: 1,
  },
  plastic_grey: {
      set: "plastic",
      tint: 1,
      color: "0x4b4f54",
      rough: 1,
      metal: 1,
      wet: [0.08,0.62,0.6,0.5],
      macro: [0.14,0.1,0.8,0.2],
      nrm: 1,
  },
  tarp: {
      set: "tarp",
      tint: 1,
      color: "0x3b4a3a",
      rough: 1,
      metal: 1,
      wet: [0.08,0.62,0.6,0.5],
      macro: [0.1,0.1,1.2,0.2],
      nrm: 1,
  },
  cardboard: {
      set: "cardboard",
      tint: 0,
      color: "0xffffff",
      rough: 1,
      metal: 1,
      wet: [0.4,0.75,0.6,0],
      macro: [0.14,0.1,0.8,0.2],
      nrm: 1,
  },
  rope: {
      set: "rope",
      tint: 0,
      color: "0xffffff",
      rough: 1,
      metal: 1,
      wet: [0.42,0.38,0.5,0],
      macro: [0.07,0.06,3,0],
      nrm: 1,
  },
  tire: {
      set: "tire",
      tint: 0,
      color: "0xffffff",
      rough: 1,
      metal: 1,
      wet: [0.1,0.6,0.6,0.3],
      macro: [0.07,0.06,3,0],
      nrm: 1,
  },
  glass: {
      set: "glass",
      tint: 3,
      color: "0xffffff",
      rough: 1,
      metal: 1,
      wet: [0,1,0,0],
      macro: [0,0,1,0],
      nrm: 1,
      transparent: true,
  },
  glass_dirty: {
      set: "glass_dirty",
      tint: 3,
      color: "0xffffff",
      rough: 1,
      metal: 1,
      wet: [0,1,0,0],
      macro: [0,0,1,0],
      nrm: 1,
      transparent: true,
  },
  hull_paint: {
      set: "hull",
      tint: 1,
      color: "0x1b222b",
      rough: 1,
      metal: 1,
      wet: [0.05,0.62,0.65,0.7],
      macro: [0.22,0.12,0.35,0.35],
      nrm: 1,
  },
  hull_red: {
      set: "hull",
      tint: 1,
      color: "0x5f1f18",
      rough: 1,
      metal: 1,
      wet: [0.05,0.62,0.65,0.7],
      macro: [0.22,0.12,0.35,0.35],
      nrm: 1,
  },
  water_dark: {
      set: "water",
      tint: 0,
      color: "0xffffff",
      rough: 1,
      metal: 1,
      wet: [0,1,0,0],
      macro: [0,0,1,0],
      nrm: 1,
  },
};

export const SL_MATERIAL_FALLBACK = {"set":"metal","tint":1,"color":"0x7a7d80","rough":1,"metal":1,"wet":[0,0.7,0.55,0.5],"macro":[0.14,0.1,0.8,0.2],"nrm":1};

/* h3 的原样移植：把七段 GLSL 缝进 MeshStandardMaterial。
 * 失败面：aomap 锚文本漂移时保持库存实现（AO 仍走 ORM 图的 R 通道，仅 UV 语义降级）。 */
export function injectSLSurface(shader, uniforms, THREE) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\n" + SL_SURFACE.vertexDecl)
    .replace("#include <project_vertex>", "#include <project_vertex>\n" + SL_SURFACE.vertexBody);
  const stockAo = THREE.ShaderChunk.aomap_fragment;
  const aoPatched = stockAo.includes("texture2D( aoMap, vAoMapUv ).r")
    ? stockAo.replace("texture2D( aoMap, vAoMapUv ).r", "slORM.r")
    : stockAo; // 布局校验失败退库存实现
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\n" + SL_SURFACE.fragDecl)
    .replace("#include <map_fragment>", SL_SURFACE.mapBody)
    .replace("#include <roughnessmap_fragment>", SL_SURFACE.roughBody)
    .replace("#include <metalnessmap_fragment>", SL_SURFACE.metalBody)
    .replace("#include <normal_fragment_maps>", SL_SURFACE.normalBody)
    .replace("#include <aomap_fragment>", aoPatched);
}

export function createSurfaceMaterialFactory(THREE, textureFactory, opts = {}) {
  const shared = { wet: { value: opts.wet !== undefined ? +opts.wet : 1 } };
  const cache = new Map();
  const warned = new Set();
  const warn1 = (m) => { if (!warned.has(m)) { warned.add(m); console.warn("[sl-surface] unknown material " + m + " — fallback"); } };

  function get(name, o = {}) {
    const key = name + "|" + (o.vertexColors ? "v" : "") + (o.triplanar ? "t" + (o.scale || 1) : "")
      + (o.doubleSide ? "d" : "") + (o.interior ? "i" : "") + (o.color !== undefined ? "c" + o.color : "");
    const hit = cache.get(key);
    if (hit) return hit;
    let def = SL_MATERIALS[name];
    if (!def) { warn1(name); def = SL_MATERIAL_FALLBACK; }
    let set;
    try {
      set = textureFactory.get(def.set);
    } catch (e) {
      const m = new THREE.MeshStandardMaterial({
        color: o.color !== undefined ? o.color : (def.tint ? def.color : 0x808080),
        roughness: 0.6, metalness: 0, vertexColors: !!o.vertexColors,
      });
      m.name = name; cache.set(key, m); return m;
    }
    const tri = !!o.triplanar;
    const fx = !def.transparent && !def.alphaCut;
    const mat = new THREE.MeshStandardMaterial({
      map: set.albedo, normalMap: set.normal,
      roughnessMap: set.orm, metalnessMap: set.orm, aoMap: set.orm,
      color: o.color !== undefined ? o.color : def.color,
      roughness: def.rough, metalness: def.metal, vertexColors: !!o.vertexColors,
    });
    mat.name = name;
    mat.normalScale.set(def.nrm, def.nrm);
    if (o.doubleSide || def.side === 2) mat.side = THREE.DoubleSide;
    if (def.transparent) { mat.transparent = true; mat.depthWrite = false; mat.envMapIntensity = 1.4; }
    if (def.alphaCut) mat.alphaTest = 0.5;
    mat.defines = { ...mat.defines, SL_TINT: def.tint };
    if (tri) mat.defines.SL_TRIPLANAR = "";
    if (fx) mat.defines.SL_FX = "";
    if (def.alphaCut && !tri) mat.defines.SL_ACUT = "";
    const uniforms = {
      uSlWet: shared.wet,
      uSlWetP: { value: new THREE.Vector4(...def.wet) },
      uSlMacro: { value: new THREE.Vector4(...def.macro) },
      uSlUv: { value: new THREE.Vector3(1, 1, tri ? (o.scale || 1) / set.tile[0] : set.size) },
      uSlX: { value: new THREE.Vector2(o.interior ? 0.12 : 1, 0) },
    };
    mat.userData.sl = uniforms;
    mat.userData.set = set.key;
    mat.userData.tile = set.tile;
    if (o.interior) mat.userData.interior = true;
    mat.onBeforeCompile = (shader) => injectSLSurface(shader, uniforms, THREE);
    mat.customProgramCacheKey = () => "sl2|" + def.tint + (tri ? "t" : "") + (fx ? "f" : "") + (def.alphaCut ? "a" : "");
    cache.set(key, mat);
    return mat;
  }
  function emissive(color = 0xffffff, mult = 4) {
    const key = "em|" + color + "|" + mult;
    if (cache.has(key)) return cache.get(key);
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(mult), toneMapped: true });
    m.name = "emissive"; cache.set(key, m); return m;
  }
  return {
    get, emissive,
    names: Object.keys(SL_MATERIALS),
    uniforms: shared,
    update() { textureFactory.update && textureFactory.update(); },
    prewarm(names) { for (const n of names || Object.keys(SL_MATERIALS)) get(n); },
    stats() { return textureFactory.stats ? textureFactory.stats() : null; },
    dispose() { for (const m of cache.values()) m.dispose(); cache.clear(); },
  };
}
