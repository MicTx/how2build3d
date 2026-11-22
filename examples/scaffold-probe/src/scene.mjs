/**
 * scene.mjs — boot：渲染器 / 相机 / 灯光 / 检查协议。装配顺序见 references/12。
 * 顺序：world → mats → ground → content → (layout/bots) → inspect → 协议 → loop
 * TODO(S9)：把 HUD 从一行文字换成 assets/hud-kit.mjs；把 __PARITY__ 计数换成实测值。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.bootScene = function bootScene() {
  const world = H2B.WORLD;
  const params = new URLSearchParams(location.search);
  const seed = Number(params.get("seed") || world.seed);
  const bench = params.has("bench");
  const quality = world.quality[params.get("q") || "low"] || world.quality.low;

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
  scene.background = new THREE.Color(world.fog.color);
  scene.fog = new THREE.FogExp2(world.fog.color, world.fog.density);

  const camera = new THREE.PerspectiveCamera(
    world.camera.fov,
    window.innerWidth / window.innerHeight,
    world.camera.near,
    world.camera.far
  );
  camera.position.set(0, 8, 34);
  camera.lookAt(0, 2, 0);

  const hemi = new THREE.HemisphereLight(0x8fa3b8, 0x2a2620, 0.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(world.sun.color, world.sun.intensity);
  sun.position.set(world.sun.dir[0] * 40, world.sun.dir[1] * 40, world.sun.dir[2] * 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality.shadow, quality.shadow);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  scene.add(sun);

  const rng = H2B.seededRng(seed);
  const mats = H2B.createMats(THREE, renderer, scene, { tex: quality.tex });
  mats.prewarm(["asphalt", "paint_red", "steel_dark", "concrete"]);
  const ground = H2B.createGround(THREE, scene, mats, world);
  const content = H2B.buildContent(THREE, scene, mats, world, rng);

  /* ---- 玩法装配（仅 game / full 档存在 game.mjs 时）---- */
  const player = { pos: { x: 0, y: 0, z: 14 }, vel: { x: 0, y: 0, z: 0 }, alive: true };
  const game = typeof H2B.initGameplay === "function"
    ? H2B.initGameplay({ THREE, scene, world, rng, player })
    : null;
  const gameCounts = game && typeof game.counts === "function" ? game.counts() : {};

  /* ---- 九展厅 ---- */
  const inspectMode = InspectDeck.readInspectMode(location.search);
  const deck = InspectDeck.createInspectDeck({
    galleries: H2B.createInspectGalleries({ THREE, scene, content, ground, renderer, camera }),
  });
  const showcase = deck.boot({ camera, render: renderer, scene }, inspectMode);
  if (inspectMode.show && !showcase) console.warn("[inspect] unknown gallery: " + inspectMode.show);

  /* ---- 检视协议 ---- */
  const time = { t: 0, frame: 0 };
  let fpsShown = 0, fpsAcc = 0, fpsFrames = 0, lastNow = performance.now();
  window.__G = {
    seed, params: Object.fromEntries(params), time, quality,
    showcase: showcase ? showcase.name : null,
    renderer, scene, camera, world,
  };
  window.__stats = () => {
    const info = renderer.info;
    return {
      calls: info.render.calls, tris: info.render.triangles, geos: info.memory.geometries,
      tex: info.memory.textures, programs: info.programs ? info.programs.length : 0,
      frame: time.frame, fps: fpsShown, quality: quality.name,
    };
  };
  window.debugCut = () => window.__stats();

  /* ---- 元素对账：先全 0，模型按 complete.mjs 的红点逐条填实测值 ---- */
  window.__PARITY__ = {
    version: 1,
    counts: {
      propKinds: content.stats.propKinds,
      placedProps: content.stats.placedProps,
      decalTypes: content.stats.decalTypes,
      placedDecals: 0,
      materialCount: mats.catalog.length,
      textureSets: typeof SL_TEX_SETS !== "undefined" ? Object.keys(SL_TEX_SETS).length : 0,
      skyPasses: 0,
      seaSurfaces: 0,
      groundLayers: ground.layers,
      puddlePatches: ground.puddles,
      rainStreaks: 0,
      thunderEvents: 0,
      postPasses: 1,
      bloomLevels: 0,
      shadowMaps: sun.castShadow ? 1 : 0,
      shadowTaps: 0,
      enemyTypes: 0,
      enemySpawns: 0,
      enemyRigs: 0,
      weaponMeshes: 0,
      weaponChannels: 0,
      fxKinds: 0,
      fxPools: 0,
      soundSpecs: 0,
      musicParts: 0,
      audioBuses: 0,
      hudComponents: 0,
      hudTokens: 0,
      zones: 0,
      coverPoints: 0,
      objectives: 0,
      objectivesWired: 0,
      waves: 0,
      galleriesUsed: Object.keys(deck.galleries).length,
      ...gameCounts,
    },
    source: { scene: "TODO", measuredAt: new Date().toISOString() },
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
    time.t += bench ? 1 / 60 : dt;
    time.frame += 1;
    mats.update();
    if (game) game.update(bench ? 1 / 60 : dt);
    if (showcase && typeof showcase.update === "function") showcase.update(time.t);
    renderer.info.reset();
    renderer.render(scene, camera);
    hud.textContent = "h2b " + document.title + " · " + fpsShown + " fps · "
      + renderer.info.render.calls + " draws · " + (renderer.info.render.triangles / 1000).toFixed(0) + "k tris · q=" + quality.name;
  }
  requestAnimationFrame(loop);
};
