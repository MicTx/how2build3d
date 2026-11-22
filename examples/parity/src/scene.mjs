/**
 * scene.mjs — boot：按 references/12 装配顺序整场接线。
 * 1 world → 2 mats → 3 sky/sea/ground → 4 physics+layout(struct)+props → 5 post/pipeline/weather
 * → 10 fx → 7-9 player/weapon/enemies(combat) → 11 audio → 12 hud → 13 mission → 14 inspect + 协议。
 * __PARITY__.counts 全部由 kit.stats()/遍历自报（complete.mjs 红点合同，不许手填）。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.bootScene = function bootScene() {
  const world = H2B.WORLD;
  const params = new URLSearchParams(location.search);
  const seed = Number(params.get("seed") || world.seed);
  const bench = params.has("bench");
  const qualityName = params.get("q") || "low";
  const quality = world.quality[qualityName] || world.quality.low;
  const rng = H2B.seededRng(seed);
  const events = H2B.createEventBus();

  window.__errors = window.__errors || [];
  window.addEventListener("error", (e) => window.__errors.push(String(e.message)));

  /* ---- 渲染器：最终编码交给 post-chain（AgX + toSRGB），内置 tonemap 关闭 ---- */
  const canvas = document.getElementById("view");
  const hudEl = document.getElementById("hud");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    const src = gl.getShaderSource(fs) || "";
    const sys = src.includes("SALTLINE_POST") ? "post" : src.includes("SALTLINE_SKY") ? "sky"
      : src.includes("SALTLINE_SHADOW") ? "shadow" : src.includes("vGWorld") ? "ground"
      : src.includes("vSlPos") ? "sl-material" : src.includes("SEA_") ? "sea" : "misc";
    console.error("[H2B_SHADER:" + sys + "]", gl.getShaderInfoLog(fs));
    window.__errors.push("shader:" + sys + ":" + (String(gl.getShaderInfoLog(fs) || "") + " ||VS: " + String(gl.getShaderInfoLog(vs) || "") + " | PROG: " + String(gl.getProgramInfoLog ? gl.getProgramInfoLog(program) || "" : "")).slice(0, 600));
  };
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(world.fog.colorLin[0], world.fog.colorLin[1], world.fog.colorLin[2]);
  const camera = new THREE.PerspectiveCamera(world.camera.fov, window.innerWidth / window.innerHeight, world.camera.near, world.camera.far);
  camera.position.set(0, 1.7, 33);
  camera.rotation.order = "YXZ";
  scene.add(camera);  // 武器视图模型挂在相机下，相机必须在场景图内

  /* ---- #2 材质目录 ---- */
  const mats = H2B.createMats(THREE, renderer, scene, { tex: quality.tex });

  /* ---- #3 sky / sea / ground ---- */
  const noiseTex = H2B.makeNoiseTexture(THREE, seed);
  const sky = H2B.createSky(THREE, scene, renderer, noiseTex, { shadowSize: quality.shadow });
  const sea = H2B.createSea(THREE, scene, world, seed);
  const ground = H2B.createWetGround(THREE, renderer, scene, camera, seed);
  ground.planar = ground.createPlanarReflection();

  /* ---- #4/#6 physics + level-kit 结构 + props-kit 道具（碰撞盒当场注册）---- */
  const physics = PhysicsKit.createPhysicsKit({
    bounds: { groundY: world.groundY, seaY: world.seaY, quayX: world.sea.quayX },
    region: { minX: world.bounds.minX, minZ: world.bounds.minZ, maxX: world.bounds.maxX, maxZ: world.bounds.maxZ },
    cell: 2,
    rng,
    groundSurfaceAt: H2B.STRUCT_LAYOUT.meta.groundSurfaceAt,
  });
  const level = LevelKit.createLevelKit(THREE, {
    catalog: H2B.STRUCT_CATALOG,
    layout: H2B.STRUCT_LAYOUT,
    physics,
    materials: new Proxy({}, { get: (_t, name) => mats.surface.get(String(name), { triplanar: true }) }),
  });
  scene.add(level.group);
  physics.build();
  const props = H2B.buildProps(THREE, { scene, mats, physics, rng });

  /* ---- #5 后处理链与体积光柱 ---- */
  const post = H2B.createPostChain(THREE, renderer, () => quality);
  const pipeline = H2B.createPipeline({
    THREE, renderer, scene, camera, post, mats,
    sun: sky.sun, sunDir: sky.sunDir,
    ground,
    occluders: [props.group, level.group],
    quality: () => quality,
  });

  /* ---- 天气（sky/post uniforms + 仓库室内盒 + 天窗排除）---- */
  const sunColV = new THREE.Vector3(world.sun.col[0] * 1.9, world.sun.col[1] * 1.9, world.sun.col[2] * 1.9);
  const ambV = new THREE.Vector3(world.fog.colorLin[0] * 0.15, world.fog.colorLin[1] * 0.15, world.fog.colorLin[2] * 0.15);
  const weather = WeatherKit.createWeatherKit(THREE, {
    rng,
    events,
    quality: quality.rain,
    level: { interiorBoxes: H2B.STRUCT_LAYOUT.meta.interiorBoxes, skylights: H2B.STRUCT_LAYOUT.meta.skylights },
    camera,
    renderer,
    sky: { uniforms: sky.uniforms },
    post: { uniforms: post.mats.postMat.uniforms },
    sunDir: { x: sky.sunDir.x, y: sky.sunDir.y, z: sky.sunDir.z },
    sunCol: { x: sunColV.x, y: sunColV.y, z: sunColV.z },
    amb: { x: ambV.x, y: ambV.y, z: ambV.z },
    mask: { rect: { x: -45, z: -35, w: 75, d: 70 }, texture: ground.uniforms.uMask.value },
  });
  scene.add(weather.root);

  /* ---- #10 fx 双池（physics/事件就绪后建）---- */
  const fx = FxKit.createFxKit(THREE, {
    rng, physics, events, camera,
    wind: { x: 1.2, y: 0, z: 0.6 },
    sunDir: { x: sky.sunDir.x, y: sky.sunDir.y, z: sky.sunDir.z },
    sun: world.sun.color, ambLo: 0x2a2f3a, ambHi: 0x8fa8c8,
    seed: seed ^ 0xf0d3, groundY: world.groundY,
  });
  scene.add(fx.root);

  /* ---- #7-#9 player / weapon / enemies（combat 导演）---- */
  const game = H2B.initGameplay({ THREE, scene, camera, canvas, world, rng, events, fx, mats, physics, level });

  /* ---- #11 audio / #12 hud ---- */
  const audio = H2B.createAudio({ events, rng });
  const hud = H2B.createHud({ events, rng, game });

  /* ---- ?auto=<seconds>：boot 期固定步长自动战斗（harness/gates/gameplay.mjs 协议）----
   * 在预热/PMREM 之前跑：600 步纯 CPU 采样，报告必须落在门禁 2.6s 读取窗内；
   * auto 模式跳过纹理预热与环境捕获（视觉启动件），PCSS 手术保留（文本级，<1ms）。 */
  const autoSeconds = params.has("auto") ? Number(params.get("auto")) || 10 : 0;
  let pcssInstalled = false;
  if (autoSeconds > 0) {
    pcssInstalled = mats.ensurePCSS(sky.sun);
    window.__BATTLE_REPORT = H2B.runAutoBattle({ game, audio, seconds: autoSeconds });
  } else {
    mats.prewarm([
      "asphalt", "concrete", "concrete_dirty", "paint_red", "paint_teal", "paint_yellow", "hull_paint",
      "corrugated_roof", "steel_dark", "steel_worn", "steel_rust", "chainlink",
      "hazard_stripes", "wood_pallet", "tire", "gunmetal", "anodized_black", "polymer_black", "glass",
    ]);
    pcssInstalled = mats.ensurePCSS(sky.sun);
    sky.captureEnvironment();
  }

  /* ---- #14 九展厅 ---- */
  const inspectMode = InspectDeck.readInspectMode(location.search);
  const galleries = H2B.createInspectGalleries({
    THREE, scene, camera, renderer, world, mats, sky, sea, ground, props,
    level: game.level, game, fx, weather, audio, hud,
  });
  const deck = InspectDeck.createInspectDeck({ galleries });
  const showcase = deck.boot({ camera, render: renderer, scene, THREE }, inspectMode);
  if (inspectMode.show && !showcase) console.warn("[inspect] unknown gallery: " + inspectMode.show);

  /* ---- __G / __stats 检查协议 ---- */
  const time = { t: 0, frame: 0 };
  let fpsShown = 0, fpsAcc = 0, fpsFrames = 0, lastNow = performance.now();
  window.__G = {
    seed, params: Object.fromEntries(params), time,
    quality,
    showcase: showcase ? showcase.name : null,
    renderer, scene, camera, world,
  };
  window.__stats = () => {
    const i = renderer.info;
    return {
      calls: i.render.calls, tris: i.render.triangles, geos: i.memory.geometries,
      tex: i.memory.textures, programs: i.programs ? i.programs.length : 0,
      frame: time.frame, fps: fpsShown, quality: quality.name,
    };
  };
  window.debugCut = () => window.__stats();

  /* ---- 元素对账：18 族实测计数（kit.stats()/遍历自报）---- */
  let skyMeshes = 0, shadowMaps = 0;
  scene.traverse((o) => {
    if (o.name === "h2b-sky-deck") skyMeshes += 1;
    if (o.isDirectionalLight && o.castShadow) shadowMaps += 1;
  });
  const fxStats = fx.stats();
  const audioStats = audio.stats() || {};
  const hudStats = hud.stats() || {};
  const gameCounts = game.counts();
  const specCount = AudioKit.AUDIO_SPECS.length;
  window.__PARITY__ = {
    version: 1,
    counts: {
      propKinds: props.stats().propKinds,
      placedProps: props.stats().placedProps,
      decalTypes: props.kit.stats().decalTypes,
      placedDecals: props.stats().placedDecals,
      materialCount: mats.stats().materialCount,
      textureSets: mats.stats().textureSets,
      skyPasses: skyMeshes,
      seaSurfaces: sea.stats().seaSurfaces,
      groundLayers: ground.layers,
      puddlePatches: ground.puddles,
      rainStreaks: weather.stats().rainStreaks,
      thunderEvents: weather.stats().thunderEvents,
      postPasses: pipeline.passes,
      bloomLevels: pipeline.bloomLevels,
      shadowMaps,
      shadowTaps: pcssInstalled ? mats.pcssTaps : 0,
      enemyTypes: gameCounts.enemyTypes,
      enemySpawns: gameCounts.enemySpawns,
      enemyRigs: gameCounts.enemyRigs,
      weaponMeshes: gameCounts.weaponMeshes,
      weaponChannels: gameCounts.weaponChannels,
      fxKinds: fxStats.fxKinds,
      fxPools: fxStats.fxPools,
      fxDrawCalls: fxStats.drawCalls,
      soundSpecs: audioStats.specs !== undefined ? audioStats.specs : specCount,
      musicParts: audioStats.musicParts !== undefined ? audioStats.musicParts : AudioKit.AUDIO_SPECS.filter((s) => s.music >= 0).length,
      audioBuses: audioStats.buses !== undefined ? audioStats.buses : Object.keys(AudioKit.AUDIO_BUSES).length,
      hudComponents: hudStats.hudComponents || 0,
      hudTokens: hudStats.hudTokens || 0,
      zones: gameCounts.zones,
      coverPoints: gameCounts.coverPoints,
      objectives: gameCounts.objectives,
      objectivesWired: gameCounts.objectivesWired,
      waves: gameCounts.waves,
      galleriesUsed: Object.keys(deck.galleries).length,
    },
    source: { scene: "examples/parity", seed, measuredAt: new Date().toISOString() },
  };

  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  /* ---- 主循环：bench 定步长 1/60（同 seed 逐帧可复现）---- */
  function loop(now) {
    requestAnimationFrame(loop);
    let dt = (now - lastNow) / 1000;
    lastNow = now;
    if (dt < 0) dt = 0;
    if (dt > 0.1) dt = 0.1;
    const step = bench ? 1 / 60 : dt;
    fpsAcc += step; fpsFrames += 1;
    if (fpsAcc >= 0.5) { fpsShown = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }
    time.t += step;
    time.frame += 1;

    mats.update();
    sky.update(time.t);
    sea.update(time.t);
    ground.uniforms.uTime.value = time.t;

    if (showcase) {
      /* 展厅模式：玩法冻结（相机归展台），fx 展台自己的 update 继续放效果 */
      if (showcase.update) showcase.update(time.t);
    } else {
      game.update(step);
      audio.setIntensity(Math.min(1, game.enemies.stats().active / 4));
    }
    weather.update(step);
    fx.update(step);
    audio.update(step);
    hud.update(step);
    hud.tick(step);

    renderer.info.reset();
    pipeline.frame(step);
    hudEl.textContent = "h2b parity · 盐线堆场 · " + fpsShown + " fps · "
      + renderer.info.render.calls + " draws · q=" + quality.name
      + " · 目标 " + game.objectives.filter((o) => o.done).length + "/3";
  }
  requestAnimationFrame(loop);
};
