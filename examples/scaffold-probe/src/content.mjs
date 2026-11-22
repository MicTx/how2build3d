/**
 * content.mjs — 内容层：道具与剪影。先用 InstancedMesh 摆重复单元，再逐件加细节。
 * TODO(S3)：换成 assets/props-kit.mjs 的道具目录（35 类 + 17 builder），并走手写布局。
 * TODO(S3)：合并后重算法线；draw call 不随实例数线性增长。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.buildContent = function buildContent(THREE, scene, mats, world, rng) {
  const group = new THREE.Group();
  group.name = "h2b-content";
  scene.add(group);

  const geo = new THREE.BoxGeometry(6.06, 2.59, 2.44);
  const mat = mats.surface.get("paint_red", { triplanar: true });
  const count = 24;
  const inst = new THREE.InstancedMesh(geo, mat, count);
  inst.name = "h2b-containers";
  inst.castShadow = true;
  inst.receiveShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i += 1) {
    const row = i % 6;
    const col = Math.floor(i / 6);
    p.set(-15 + row * 6.4, 1.3, -12 + col * 8);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (row % 2) * 0.06);
    m.compose(p, q, s);
    inst.setMatrixAt(i, m);
  }
  inst.instanceMatrix.needsUpdate = true;
  group.add(inst);

  const marks = 0;
  return {
    group,
    stats: { propKinds: 1, placedProps: count, decalTypes: marks },
  };
};
