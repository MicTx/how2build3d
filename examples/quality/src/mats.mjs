/**
 * quality/src/mats.mjs — 资产层接线：SL GPU 纹理工厂 + SL 表面材质工厂 + PCSS chunk 手术。
 * 消费：assets/sl-textures.mjs（createTextureFactory）、assets/sl-surface.mjs
 *      （createSurfaceMaterialFactory）、assets/pcss-shadow.glsl（getShadow 整体替换）。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.createMats = function createMats(THREE, renderer, scene, opts = {}) {
  const texQuality = opts.tex || 512;
  const texFactory = createTextureFactory(THREE, renderer, { tex: texQuality });
  const surface = createSurfaceMaterialFactory(THREE, texFactory, { wet: 1 });

  /* ---- PCSS：chunk 手术（布局校验失败退库存 PCF）----
   * SL_FRUSTUM/SL_DEPTH 是场景标定值：阴影相机跨宽/跨高与深度范围（米）。
   * 上游 "never bias more than ~0.6 m per kernel" 的 receiver-plane bias 依赖这两个标定。 */
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
    // 从资产文本截取 // SALTLINE_SHADOW 标记起的手术段（到 cubeToUV 之前）
    const marker = GLSL_PCSS.indexOf("// SALTLINE_SHADOW");
    const body = GLSL_PCSS.slice(marker >= 0 ? marker : 0, GLSL_PCSS.indexOf("vec2 cubeToUV("));
    const calibrated = body
      .replace("const vec2 SL_FRUSTUM = vec2( 88.699, 54.781 );", `const vec2 SL_FRUSTUM = vec2( ${W.toFixed(3)}, ${H.toFixed(3)} );`)
      .replace("const float SL_DEPTH = 141.881;", `const float SL_DEPTH = ${D.toFixed(3)};`);
    THREE.ShaderChunk.shadowmap_pars_fragment = chunk.slice(0, start) + calibrated + chunk.slice(end);
    return true;
  }

  let pcssOk = null;
  function ensurePCSS(sun) {
    if (pcssOk === null) pcssOk = installPCSS(sun);
    return pcssOk;
  }

  /* ---- 启动期结清：预热本次场景会用到的纹理集与材质 ---- */
  function prewarm(names) {
    surface.prewarm(names);
  }

  return { texFactory, surface, ensurePCSS, prewarm, stats: () => surface.stats() };
};
