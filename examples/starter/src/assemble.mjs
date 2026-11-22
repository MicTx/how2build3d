/**
 * starter/src/assemble.mjs — 参数几何拼装 + 实例化（T-15 / 图集 A）。
 * 世界坐标集中在一张常量表；重复单元走 InstancedMesh，单 draw call。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.WORLD = {
  bounds: { min: [-40, 0, -30], max: [40, 30, 30] },
  groundY: 0,
  seaY: -1.6,
  quayX: 30,
  sun: { dir: [0.30, 0.55, 0.78], color: 0xffc98a, intensity: 3.4 },
  fog: 0x2a3542,
};

H2B.assembleHarbor = function assembleHarbor(THREE, scene, opts) {
  const { noiseTex, uTime, rng } = opts;
  const W = H2B.WORLD;

  // 天空穹顶：一个 BackSide 球，全部颜色来自 GLSL
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(400, 24, 16),
    H2B.makeSkyMaterial(THREE, noiseTex, uTime)
  );
  sky.name = "h2b-sky";
  scene.add(sky);

  // 地面：注入材质做雨湿粗糙度
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 70, 1, 1),
    H2B.makeGroundMaterial(THREE, noiseTex, uTime)
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = W.groundY;
  ground.receiveShadow = true;
  ground.name = "h2b-wet-apron";
  scene.add(ground);

  // 集装箱：一个几何 + 一个材质 + InstancedMesh 24 个实例
  const box = new THREE.BoxGeometry(2.4, 2.4, 6.0);
  const boxMat = new THREE.MeshStandardMaterial({ color: 0x8a5a3b, roughness: 0.8, metalness: 0.18 });
  const count = 24;
  const inst = new THREE.InstancedMesh(box, boxMat, count);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (let i = 0; i < count; i += 1) {
    const col = i % 6;
    const row = Math.floor(i / 6);
    const stack = rng() < 0.45 ? 1 : 0;
    dummy.position.set(-18 + col * 6.2 + rng() * 0.3, 1.2 + stack * 2.45, -18 + row * 12 + rng());
    dummy.rotation.y = (rng() - 0.5) * 0.06;
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
    color.setHSL(0.02 + rng() * 0.12, 0.35 + rng() * 0.2, 0.28 + rng() * 0.16);
    inst.setColorAt(i, color);
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.castShadow = true;
  inst.receiveShadow = true;
  inst.name = "h2b-containers";
  scene.add(inst);

  // 平行光太阳 + 环境补光
  const sun = new THREE.DirectionalLight(W.sun.color, W.sun.intensity);
  sun.position.set(...W.sun.dir.map((v) => v * 60));
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
  scene.add(sun, sun.target);
  scene.add(new THREE.AmbientLight(0xb9cbe0, 1.15));
  scene.fog = new THREE.Fog(W.fog, 40, 180);

  return { sky, ground, containers: inst, sun };
};
