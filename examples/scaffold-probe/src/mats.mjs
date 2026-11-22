/**
 * mats.mjs — 材质层接线：SL 纹理工厂 + SL 表面材质工厂。
 * TODO(S4)：接 PCSS chunk 手术（assets/pcss-shadow.glsl → GLSL_PCSS），标定 SL_FRUSTUM/SL_DEPTH。
 * TODO(S4)：单调材质超过 3 个即说明目录没用起来——改走 surface.get(name)。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.createMats = function createMats(THREE, renderer, scene, opts = {}) {
  const texFactory = createTextureFactory(THREE, renderer, { tex: opts.tex || 512 });
  const surface = createSurfaceMaterialFactory(THREE, texFactory, { wet: 1 });
  return {
    texFactory,
    surface,
    catalog: surface.names,
    prewarm(names) { surface.prewarm(names); },
    update() { surface.update(); },
  };
};
