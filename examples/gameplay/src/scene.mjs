/**
 * gameplay/src/scene.mjs — boot：渲染器/相机/灯光/三 kit 接线/检视协议/展厅。
 * 消费 assets/physics-kit.mjs + level-kit.mjs + combat-kit.mjs + inspect-deck.mjs。
 */
globalThis.H2B = globalThis.H2B || {};

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** 训练场地面：程序化沥青噪点 + 停机坪标线（确定性，seed 进纹理） */
function makeGroundTexture(seed) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d");
  const rng = mulberry32(seed ^ 0x5157);
  ctx.fillStyle = "#39414a";
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i += 1) {
    const v = 40 + Math.floor(rng() * 30);
    ctx.fillStyle = `rgb(${v},${v + 3},${v + 6})`;
    ctx.fillRect(rng() * 512, rng() * 512, 2, 2);
  }
  for (let i = 0; i < 40; i += 1) {
    ctx.fillStyle = `rgba(16,20,24,${0.08 + rng() * 0.14})`;
    ctx.beginPath();
    ctx.arc(rng() * 512, rng() * 512, 8 + rng() * 30, 0, 6.2832);
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(232,228,218,0.85)";
  ctx.lineWidth = 6;
  ctx.strokeRect(40, 40, 432, 432);
  ctx.beginPath();
  ctx.moveTo(256, 40);
  ctx.lineTo(256, 472);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5, 5);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

H2B.bootGameplay = function bootGameplay() {
  const params = new URLSearchParams(location.search);
  const seed = Number(params.get("seed") || 4207);
  const bench = params.has("bench");

  window.__errors = window.__errors || [];
  window.addEventListener("error", (e) => window.__errors.push(String(e.message)));

  const canvas = document.getElementById("view");
  const hud = document.getElementById("hud");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1218);
  scene.fog = new THREE.FogExp2(0x232c36, 0.006);
  const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 400);
  camera.position.set(14, 8, 20);
  camera.lookAt(0, 1, 0);

  const hemi = new THREE.HemisphereLight(0x8fa3b8, 0x2a2620, 0.4);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd9a8, 3.2);
  sun.position.set(18, 24, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -30; sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 90).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: makeGroundTexture(seed), roughness: 0.95, metalness: 0.0 })
  );
  ground.receiveShadow = true;
  scene.add(ground);

  /* ---- 三 kit 接线 ---- */
  const physics = PhysicsKit.createPhysicsKit({
    bounds: { groundY: 0, seaY: -3, quayX: 1e9 },
    region: { minX: -40, minZ: -40, maxX: 40, maxZ: 40 },
    cell: 2,
    rng: mulberry32(seed ^ 0x9e37),
  });
  const materials = {
    crate: new THREE.MeshStandardMaterial({ color: 0xc09055, roughness: 0.85 }),
    barrier: new THREE.MeshStandardMaterial({ color: 0xd8dce0, roughness: 0.45, metalness: 0.6 }),
    container: new THREE.MeshStandardMaterial({ color: 0xb04a38, roughness: 0.7, metalness: 0.25 }),
    tower: new THREE.MeshStandardMaterial({ color: 0xc4cad0, roughness: 0.9 }),
  };
  const level = LevelKit.createLevelKit(THREE, { catalog: H2B.CATALOG, layout: H2B.LAYOUT, physics, materials });
  scene.add(level.group);
  physics.build();

  const rng = mulberry32(seed);
  const events = {
    log: [],
    on() {},
    emit(type, payload) { this.log.push({ type, payload }); if (this.log.length > 200) this.log.shift(); },
  };
  const kit = CombatKit.createCombatKit({ physics, events, rng: mulberry32(seed ^ 0x9e3779b9) });

  /* ---- 玩家（脚本驱动胶囊）---- */
  const player = { pos: { ...level.playerStart.pos }, vel: { x: 0, y: 0, z: 0 }, alive: true };
  const playerMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.1, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.6 }));
  playerMesh.castShadow = true;
  scene.add(playerMesh);

  const bots = H2B.createBots(THREE, { scene, kit, spawns: level.enemySpawns, player, rng });

  /* ---- 自动战斗（?auto=<seconds>）：boot 期以固定步长跑完并落报告 ---- */
  let battleReport = null;
  if (params.has("auto")) {
    battleReport = H2B.runAutoBattle({
      kit, physics, nav: physics.nav, bots, player, rng, events,
      seconds: Number(params.get("auto")) || 10,
    });
    window.__BATTLE_REPORT = { ...battleReport, maxTokens: kit.TUNE.maxTokens };
  }

  /* ---- 检视协议 ---- */
  const time = { t: 0, frame: 0 };
  let fpsShown = 0, fpsAcc = 0, fpsFrames = 0, lastNow = performance.now();
  window.__G = {
    seed,
    params: Object.fromEntries(params),
    time,
    showcase: null,
    renderer, scene, camera,
    kit, level, bots, player,
  };
  window.__stats = () => {
    const info = renderer.info;
    return {
      calls: info.render.calls, tris: info.render.triangles, geos: info.memory.geometries,
      tex: info.memory.textures, frame: time.frame, fps: fpsShown,
      botsAlive: bots.filter((bot) => bot.alive).length,
      tokens: kit.tokens.active(),
    };
  };
  window.debugCut = () => window.__stats();

  /* ---- 九展厅（enemies/level/props used，其余 N/A 见 inspect.manifest.json）---- */
  const inspectMode = InspectDeck.readInspectMode(location.search);
  const deck = InspectDeck.createInspectDeck({
    galleries: {
      enemies: { cam: [8, 3.2, -4], target: [0, 1.4, -14] },
      level: { setup() { return level.showcase("level"); } },
      props: { setup() { return level.showcase("props"); } },
    },
  });
  const showcase = deck.boot({ camera, render: renderer, scene }, inspectMode);
  if (inspectMode.show && !showcase) console.warn(`[inspect] unknown gallery: ${inspectMode.show}`);
  window.__G.showcase = showcase ? showcase.name : null;

  // ---- 元素对账：实测计数（complete.mjs 读这里；本场是 kit 合同样本，tier=game 不套同水准下限）----
  const levelStats = level.stats || {};
  window.__PARITY__ = {
    version: 1,
    counts: {
      propKinds: Object.keys(H2B.CATALOG).length,
      placedProps: (H2B.LAYOUT.items || []).length,
      enemyTypes: new Set(bots.map((bot) => bot.type || "bot")).size,
      enemySpawns: (level.enemySpawns || []).length,
      coverPoints: (level.coverPoints || []).length,
      zones: (level.zones || []).length,
      objectives: (level.objectives || []).length,
      objectivesWired: 0,
      waves: Math.max(1, (kit.mission && kit.mission.waves ? kit.mission.waves.length : 1)),
      galleriesUsed: Object.keys(deck.galleries).length,
      springChannels: 0,
      soundSpecs: 0,
    },
    source: { scene: "examples/gameplay", levelStats, measuredAt: new Date().toISOString() },
  };

  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  function loop(now) {
    requestAnimationFrame(loop);
    let dt = (now - lastNow) / 1000;
    lastNow = now;
    if (dt < 0) dt = 0;
    if (dt > 0.1) dt = 0.1;
    fpsAcc += dt; fpsFrames += 1;
    if (fpsAcc >= 0.5) { fpsShown = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }
    const step = bench ? 1 / 60 : dt;
    time.t += step;
    time.frame += 1;
    H2B.stepBots({ kit, physics, nav: physics.nav, player, rng, frozen: Boolean(battleReport) }, bots, step);
    playerMesh.position.set(player.pos.x, player.pos.y + 0.9, player.pos.z);
    renderer.info.reset();
    renderer.render(scene, camera);
    hud.textContent = `h2b gameplay · ${fpsShown} fps · ${renderer.info.render.calls} draws · bots ${bots.filter((b) => b.alive).length}/${bots.length} · tokens ${kit.tokens.active()}/${kit.TUNE.maxTokens}`;
  }
  requestAnimationFrame(loop);
};
