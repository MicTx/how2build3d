/**
 * mats.mjs — 材质层接线（装配顺序 #2）：SL GPU 纹理工厂 + SL 表面材质工厂 + PCSS chunk 手术。
 * 消费：assets/sl-textures.mjs（createTextureFactory / SL_TEX_SETS）、assets/sl-surface.mjs
 * （createSurfaceMaterialFactory / SL_MATERIALS）、assets/pcss-shadow.glsl（getShadow 整体替换）。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.createMats = function createMats(THREE, renderer, scene, opts = {}) {
  const texFactory = SlTextures.createTextureFactory(THREE, renderer, { tex: opts.tex || 512 });
  const surface = SlSurface.createSurfaceMaterialFactory(THREE, texFactory, { wet: 1 });

  /* ---- PCSS：chunk 手术（布局校验失败退回库存 PCF；标定取本场景阴影相机）----
   * SL_FRUSTUM/SL_DEPTH 是场景标定值：阴影相机跨宽/跨高与深度范围（米）。
   * tap 数从安装后的 chunk 文本实测解析（不手填常数）。 */
  let pcssTaps = 0;
  function installPCSS(sun) {
    const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
    const start = chunk.indexOf("float getShadow(");
    const end = chunk.indexOf("vec2 cubeToUV(");
    if (start < 0 || end < 0 || end <= start) {
      console.warn("[H2B_SHADOW] chunk layout miss — stock PCF kept");
      return false;
    }
    const cam = sun.shadow.camera;
    const W = cam.right - cam.left, H = cam.top - cam.bottom, D = cam.far - cam.near;
    const marker = GLSL_PCSS.indexOf("// SALTLINE_SHADOW");
    const body = GLSL_PCSS.slice(marker >= 0 ? marker : 0, GLSL_PCSS.indexOf("vec2 cubeToUV("));
    const calibrated = body
      .replace("const vec2 SL_FRUSTUM = vec2( 88.699, 54.781 );", `const vec2 SL_FRUSTUM = vec2( ${W.toFixed(3)}, ${H.toFixed(3)} );`)
      .replace("const float SL_DEPTH = 141.881;", `const float SL_DEPTH = ${D.toFixed(3)};`);
    THREE.ShaderChunk.shadowmap_pars_fragment = chunk.slice(0, start) + calibrated + chunk.slice(end);
    const taps = calibrated.match(/slVogel\(\s*i\s*,\s*(\d+)\s*,\s*phi\s*\+/); // 采样环真实 tap 数
    pcssTaps = taps ? Number(taps[1]) : 0;
    return true;
  }

  let pcssOk = null;
  function ensurePCSS(sun) {
    if (pcssOk === null) pcssOk = installPCSS(sun);
    return pcssOk;
  }

  return {
    texFactory,
    surface,
    ensurePCSS,
    get pcssTaps() { return pcssTaps; },
    prewarm(names) { surface.prewarm(names); },
    update() { surface.update(); },
    stats: () => ({
      materialCount: surface.names.length,                       // 48 条目录（实测）
      textureSets: Object.keys(SlTextures.SL_TEX_SETS).length,
    }),
  };
};
