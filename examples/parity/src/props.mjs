/**
 * props.mjs — 道具层装配（装配顺序 #4）：assets/props-kit.mjs 整套接线。
 *   - CATALOG 从 PROP_SIZES 生成（注册表即目录），validateLayout 构建期对账；
 *   - build() 落网格 → applyPhysics 注册碰撞盒（surface/bulletOnly）；
 *   - 地面贴花走 props.decals.canvas（22 种 Canvas 贴花）手写点位；
 *   - 计数全部走 kit.stats()/遍历自报，不手填（complete.mjs 的红点合同）。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.buildProps = function buildProps(THREE, { scene, mats, physics, rng }) {
  const layout = H2B.PROPS_LAYOUT;
  const catalog = {};
  for (const name of Object.keys(PropsKit.PROP_SIZES)) {
    const row = PropsKit.PROP_SIZES[name];
    catalog[name] = { size: [row[0], row[1], row[2]], material: row[3], family: row[4], surface: "metal" };
  }
  // 构建期对账：未知道具 / 坏点位 / 重复放置 → 抛错（level-kit.validateLayout）
  LevelKit.validateLayout(catalog, layout);

  const surface = mats.surface;
  const propsKit = PropsKit.createPropsKit(THREE, {
    materials: { get: (name) => surface.get(name, { triplanar: true }) },
    decals: PropsKit.createDecalFactory({ maxSize: 512 }),
    rng,
    instanceThreshold: 2,
  });

  const group = new THREE.Group();
  group.name = "h2b-props";
  scene.add(group);
  const placed = [];
  for (const item of layout.items) {
    const g = propsKit.build(item.prop, {
      seed: item.seed === undefined ? 7 : item.seed,
      color: item.color,
      doors: /^container/.test(item.prop) ? 0.6 : undefined,
    });
    g.position.set(item.at[0], item.at[1], item.at[2]);
    g.rotation.y = item.rot ? item.rot[1] : 0;
    g.userData.tag = item.tag || item.prop;
    group.add(g);
    placed.push(g);
    if (physics) propsKit.applyPhysics(physics, g, { tag: g.userData.tag });
  }
  // 2-mesh 小道具不投影（draw-call 预算：阴影 pass 只留大件承影）
  for (const g of placed) {
    if (!/^(container|relay_node|jersey_barrier|fence_panel|stairs_metal|sign_post|dumpster|generator)/.test(g.userData.prop)) {
      g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    }
  }

  /* ---- 地面贴花：手写点位（油渍/烧灼/裂缝/涂鸦/泊位号/警戒条纹/锈流/编号/弹孔）---- */
  const decalPlane = (kind, x, z, size, rot, seed, opts = {}) => {
    const made = propsKit.decals.canvas(kind, { seed: seed | 0 });
    const tex = new THREE.CanvasTexture(made.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    mat.name = "ground-decal-" + kind;
    const spec = PropsKit.DECAL_SPECS[kind];
    const aspect = spec ? spec[0] / spec[1] : 1;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size / aspect), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = rot || 0;
    mesh.position.set(x, opts.y === undefined ? 0.02 : opts.y, z);
    mesh.renderOrder = 1;
    mesh.name = "h2b-ground-decal";
    scene.add(mesh);
    return mesh;
  };
  const groundDecals = [
    decalPlane("oil_stain", -19.5, 14.2, 3.2, 0.4, 41),
    decalPlane("oil_stain", 6.2, 19.5, 2.4, -0.8, 42),
    decalPlane("leak_stain", 4.6, 16.6, 2.2, 1.2, 43),
    decalPlane("scorch", -27.2, -4.5, 2.6, 0, 44),
    decalPlane("crack", -11, 6.5, 3.4, 0.9, 45),
    decalPlane("crack", 22.5, -20.5, 2.8, -0.5, 46),
    decalPlane("graffiti_tag", -12.6, -4.1, 2.4, 0.05, 47, { y: 0.035 }),
    decalPlane("rust_run", -14.4, -4.4, 1.6, 0.2, 48, { y: 0.03 }),
    decalPlane("berth4", 32.5, 10, 6, 0.02, 49),
    decalPlane("caution_stripes", -1, 24.6, 4.2, 0.02, 50),
    decalPlane("numbers_0_9", 18.5, -13.6, 2.2, -0.35, 51, { y: 0.03 }),
    decalPlane("bullet_metal", 31.2, 6.5, 0.7, 0.6, 52),
    decalPlane("bullet_concrete", 30.9, 7.4, 0.7, -0.9, 53),
  ];

  return {
    kit: propsKit,
    group,
    placed,
    groundDecals,
    layout,
    catalog,
    stats: () => {
      const s = propsKit.stats();
      s.placedProps = placed.length;                       // 遍历自报
      s.placedDecals = s.decalMeshes + groundDecals.length;
      s.propKinds = new Set(placed.map((g) => g.userData.prop)).size;
      return s;
    },
  };
};
