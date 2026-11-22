/**
 * quality/src/content.mjs — 场景内容：雨后黄昏堆场。SL 材质目录消费（48 种取子集）。
 * 内容设计目标：让每个观感系统都有戏份——体积光（龙门吊缝隙）、湿地反射（水洼）、
 * PCSS（集装箱投影）、材质分层（漆面破损/锈/镀锌）、铁丝网 mip 渐隐、做旧标牌。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.buildContent = function buildContent(THREE, scene, mats, seed) {
  const rng = H2B.seededRng(seed);
  const { surface } = mats;
  const content = new THREE.Group();
  content.name = "h2b-content";
  scene.add(content);

  const box = (w, h, d, mat, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.castShadow = true; m.receiveShadow = true;
    content.add(m);
    return m;
  };

  // ---- 龙门吊（体积光穿过它的缝隙；锈 + 漆面）----
  const gantry = new THREE.Group();
  gantry.name = "h2b-gantry";
  const legGeo = new THREE.BoxGeometry(1.1, 14, 1.1);
  const steelDark = surface.get("steel_dark", { triplanar: true });
  const paintYellow = surface.get("paint_yellow", { triplanar: true });
  const legs = [[-12, 0, -20], [-12, 0, 14], [12, 0, -20], [12, 0, 14]];
  for (const [x, , z] of legs) {
    const leg = new THREE.Mesh(legGeo, steelDark);
    leg.position.set(x, 7, z);
    leg.castShadow = true;
    gantry.add(leg);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(26.5, 1.7, 1.9), paintYellow);
  beam.position.set(0, 13.6, -3);
  beam.castShadow = true;
  gantry.add(beam);
  const beam2 = new THREE.Mesh(new THREE.BoxGeometry(26.5, 0.9, 1.4), steelDark);
  beam2.position.set(0, 12.2, -3);
  gantry.add(beam2);
  // 横梁格栅：让光柱切成条
  for (let i = 0; i < 9; i += 1) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.5, 2.1), steelDark);
    rib.position.set(-12 + i * 3, 13.6, -3);
    rib.castShadow = true;
    gantry.add(rib);
  }
  // 斜撑
  for (const [x, z, s] of [[-12, -20, 1], [-12, 14, -1], [12, -20, 1], [12, 14, -1]]) {
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 12), steelDark);
    brace.position.set(x, 8.4, z + s * 6);
    brace.rotation.x = s * 0.62;
    brace.castShadow = true;
    gantry.add(brace);
  }
  content.add(gantry);

  // ---- 集装箱堆（瓦楞 + 漆面破损 + 锈）：前景左右框住太阳走廊的暗色质量 ----
  const containerMat = surface.get("corrugated_roof", { triplanar: true });
  const stackColors = ["paint_red", "paint_blue", "paint_teal", "paint_green", "hull_paint", "paint_orange"];
  const stacks = [
    // 左列（前景框）：正对太阳走廊左侧
    [-24, 1.25, 8, 0.06, 0], [-18, 1.25, 13, -0.04, 1], [-24, 3.8, 8.3, 0.08, 3],
    // 右列（前景框）
    [10, 1.25, 4, -0.03, 1], [17, 1.25, 9, 0.05, 2], [10.4, 3.8, 4.2, 0.02, 5], [17, 3.8, 9.4, 0, 0],
    // 纵深两列（中景）
    [-4, 1.25, 18, 0.1, 4], [2.5, 1.25, 21, -0.06, 2],
  ];
  stacks.forEach(([x, y, z, ry, ci], i) => {
    const mat = i % 2 === 0 ? surface.get(stackColors[ci % stackColors.length], { triplanar: true }) : containerMat;
    const c = new THREE.Mesh(new THREE.BoxGeometry(5.9, 2.55, 2.44), mat);
    c.position.set(x, y + (y > 2 ? 0 : 0), z);
    c.rotation.y = ry;
    c.castShadow = true; c.receiveShadow = true;
    content.add(c);
  });

  // ---- 铁丝网围栏（SL_ACUT：alpha-cut 铁丝网 mip 渐隐）----
  const fence = surface.get("chainlink");
  const fenceGeo = new THREE.PlaneGeometry(60, 2.4, 1, 1);
  // UV 米制化：slUv = vMapUv（uSlUv=1,1），铁丝网平铺周期按米
  {
    const uv = fenceGeo.attributes.uv;
    for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * 60, uv.getY(i) * 2.4);
  }
  for (const [x, z, ry] of [[0, -30, 0], [-34, -6, Math.PI / 2]]) {
    const f = new THREE.Mesh(fenceGeo, fence);
    f.position.set(x, 1.2, z);
    f.rotation.y = ry;
    f.receiveShadow = false;
    content.add(f);
  }

  // ---- 混凝土隔离墩 + 木质托盘 + 轮胎（材质目录散步）----
  const barrier = surface.get("concrete", { triplanar: true });
  for (let i = 0; i < 6; i += 1) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.8, 0.7), barrier);
    b.position.set(-14 + i * 5.4, 0.4, -14 + rng() * 0.5);
    b.rotation.y = (rng() - 0.5) * 0.3;
    b.castShadow = true; b.receiveShadow = true;
    content.add(b);
  }
  const wood = surface.get("wood_pallet", { triplanar: true });
  const palletGroup = new THREE.Group();
  for (let i = 0; i < 5; i += 1) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.14, 1.0), wood);
    p.position.set(18 + (i % 2) * 1.4, 0.07 + Math.floor(i / 2) * 0.16, 8 + rng() * 0.6);
    p.rotation.y = rng() * 0.4;
    p.castShadow = true;
    palletGroup.add(p);
  }
  const tireMat = surface.get("tire", { triplanar: true });
  for (let i = 0; i < 3; i += 1) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.15, 10, 20), tireMat);
    t.position.set(16.2 + i * 0.34, 0.15, 11.6);
    t.rotation.x = Math.PI / 2 + rng() * 0.2;
    t.castShadow = true;
    palletGroup.add(t);
  }
  content.add(palletGroup);

  // ---- 路灯（发光体：bloom/光斑戏份）----
  const lampMat = surface.get("gunmetal", { triplanar: true });
  const emissive = surface.emissive(0xffe9b8, 6);
  for (const [x, z] of [[-20, -10], [8, 18], [26, -2]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 7.2, 8), lampMat);
    pole.position.set(x, 3.6, z);
    pole.castShadow = true;
    content.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.32), emissive);
    head.position.set(x, 7.3, z);
    content.add(head);
  }

  // ---- 做旧标牌（Canvas 排版 + 做旧四 pass）----
  function makeSign() {
    const S = 512;
    const canvas = document.createElement("canvas");
    canvas.width = S; canvas.height = S / 4;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#d8cfae";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#20242a";
    H2B.layoutText(ctx, "堆 场 三 号", 20, 26, 72, "#20242a", { maxW: 460 });
    H2B.layoutText(ctx, "YARD NO.3", 20, 108, 36, "#3a4048", { maxW: 400, weight: 900 });
    H2B.ageCanvas(ctx, canvas.width, canvas.height, 1.8, rng);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 1.1),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.35 })
    );
    sign.position.set(-11.6, 9.5, -3.9);
    sign.rotation.y = 0.06;
    sign.castShadow = true;
    content.add(sign);
  }
  makeSign();

  // ---- 外围地面圆盘：场地之外的素面延伸，让地平线接住 ----
  const outer = new THREE.Mesh(
    new THREE.CircleGeometry(420, 48).rotateX(-Math.PI / 2),
    surface.get("concrete", { triplanar: true })
  );
  outer.position.y = -0.06;
  outer.receiveShadow = true;
  outer.name = "h2b-outer-ground";
  content.add(outer);

  // ---- 远景剪影（shafts 远场解析延拓的接网点）----
  const farMat = new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: 0.9, metalness: 0 });
  for (let i = 0; i < 14; i += 1) {
    const a = (i / 14) * Math.PI * 2 + 0.3;
    const dist = 150 + rng() * 90;
    const b = new THREE.Mesh(new THREE.BoxGeometry(8 + rng() * 16, 10 + rng() * 26, 8 + rng() * 10), farMat);
    b.position.set(Math.cos(a) * dist, b.geometry.parameters.height / 2 - 0.5, Math.sin(a) * dist);
    content.add(b);
  }

  return { content };
};
