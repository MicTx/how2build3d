/**
 * ground.mjs — 地面：先做一层 SL 表面（湿痕/ORM/macro），再按需要加积水与反射。
 * TODO(S6)：接 assets/ssr-wet.glsl（GLSL_SSR_WET）做水洼权重与反射混合。
 * TODO：planar 反射前置 pass 未接（见 examples/quality/src/ground.mjs）。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.createGround = function createGround(THREE, scene, mats, world) {
  const size = world.bounds.maxX - world.bounds.minX;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size, 1, 1).rotateX(-Math.PI / 2),
    mats.surface.get("asphalt", { triplanar: true })
  );
  mesh.receiveShadow = true;
  mesh.name = "h2b-ground";
  scene.add(mesh);
  return { mesh, layers: 1, puddles: 0 };
};
