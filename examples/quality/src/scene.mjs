/**
 * quality/src/scene.mjs — boot：渲染器/相机/画质档/交互/检视协议/错误分诊。
 * 启动期结清所有编译与合成（S2/S3/S4 成本前置）；同 seed 两次截图 diff 为 0。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.QUALITY = {
  low:    { name: "low",    scale: 0.70, msaa: 0, shadow: 1024, tex: 512,  volSteps: 12, planar: 0.0, bloom: true, rain: 0.5 },
  medium: { name: "medium", scale: 0.85, msaa: 2, shadow: 2048, tex: 1024, volSteps: 16, planar: 0.5, bloom: true, rain: 0.8 },
  high:   { name: "high",   scale: 1.00, msaa: 4, shadow: 4096, tex: 2048, volSteps: 24, planar: 1.0, bloom: true, rain: 1.0 },
};

H2B.bootQuality = function bootQuality() {
  const params = new URLSearchParams(location.search);
  const seed = Number(params.get("seed") || 4207);
  const bench = params.has("bench");
  const qualityName = params.get("q") || "low";
  let quality = H2B.QUALITY[qualityName] || H2B.QUALITY.low;

  window.__errors = window.__errors || [];
  window.addEventListener("error", (e) => window.__errors.push(String(e.message)));

  const canvas = document.getElementById("view");
  const hud = document.getElementById("hud");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;   // 最终编码由 post-chain 的 toSRGB 完成
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;         // PCSS 手术成功后接管（全替换）
  renderer.info.autoReset = false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  // 错误分诊：marker 命中即归到系统名（S9）
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    const src = gl.getShaderSource(fs) || "";
    const sys = src.includes("SALTLINE_POST") ? "post" : src.includes("SALTLINE_SKY") ? "sky"
      : src.includes("SALTLINE_SHADOW") ? "shadow" : src.includes("vGWorld") ? "ground"
      : src.includes("vSlPos") ? "sl-material" : "misc";
    console.error(`[H2B_SHADER:${sys}]`, gl.getShaderInfoLog(fs));
    window.__errors.push("shader:" + sys);
  };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1216);
  const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 900);
  camera.position.set(-24, 3.6, -26);
  const target = new THREE.Vector3(5, 5.5, 0);
  camera.lookAt(target);

  const noiseTex = H2B.makeNoiseTexture(THREE, seed);
  const sky = H2B.createSky(THREE, scene, renderer, noiseTex, { shadowSize: quality.shadow });
  const mats = H2B.createMats(THREE, renderer, scene, { tex: quality.tex });
  const ground = H2B.createWetGround(THREE, renderer, scene, camera, seed);
  ground.planar = ground.createPlanarReflection();
  const content = H2B.buildContent(THREE, scene, mats, seed);

  // 启动期结清：预热本次用到的材质 → 编译 → 环境捕获（S2/S3/S4 成本前置）
  mats.prewarm([
    "steel_dark", "paint_yellow", "corrugated_roof", "paint_red", "paint_blue", "paint_teal",
    "paint_green", "hull_paint", "paint_orange", "chainlink", "concrete", "wood_pallet", "tire", "gunmetal",
  ]);
  sky.captureEnvironment();
  const pcssInstalled = mats.ensurePCSS(sky.sun);

  const post = H2B.createPostChain(THREE, renderer, () => quality);
  const pipeline = H2B.createPipeline({
    THREE, renderer, scene, camera, post,
    sun: sky.sun, sunDir: sky.sunDir, ground, content, quality: () => quality,
  });

  // ---- 自检展厅（?show=<gallery>）：九展厅协议见 references/08-self-inspection.md ----
  const inspectMode = InspectDeck.readInspectMode(location.search);
  const deck = InspectDeck.createInspectDeck({
    galleries: H2B.createInspectGalleries(THREE, { scene, mats, ground, sky, content, renderer, camera }),
  });
  const showcase = deck.boot({ camera, render: renderer, scene, THREE }, inspectMode);
  if (inspectMode.show && !showcase) console.warn(`[inspect] unknown gallery: ${inspectMode.show}`);

  // ---- 交互（轨道轻量版）----
  let dragging = false, px = 0, py = 0, yaw = Math.atan2(camera.position.x - target.x, camera.position.z - target.z), pitch = 0.12, dist = 30;
  const applyCam = () => {
    camera.position.set(
      target.x + Math.sin(yaw) * Math.cos(pitch) * dist,
      target.y + Math.sin(pitch) * dist,
      target.z + Math.cos(yaw) * Math.cos(pitch) * dist
    );
    camera.lookAt(target);
  };
  // 初始机位代入轨道参数
  yaw = Math.atan2(camera.position.x - target.x, camera.position.z - target.z);
  dist = camera.position.distanceTo(target);
  pitch = Math.asin((camera.position.y - target.y) / dist);
  canvas.addEventListener("pointerdown", (e) => { dragging = true; px = e.clientX; py = e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointerup", () => { dragging = false; });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    yaw -= (e.clientX - px) * 0.0045; pitch = Math.max(-0.05, Math.min(1.35, pitch + (e.clientY - py) * 0.0035));
    px = e.clientX; py = e.clientY; applyCam();
  });
  canvas.addEventListener("wheel", (e) => { dist = Math.max(4, Math.min(160, dist * (1 + e.deltaY * 0.001))); applyCam(); }, { passive: true });
  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  // ---- 画质切换 1/2/3 ----
  window.addEventListener("keydown", (e) => {
    const names = ["low", "medium", "high"];
    const idx = names.indexOf(quality.name);
    if (e.key === "1" || e.key === "2" || e.key === "3") {
      quality = H2B.QUALITY[names[Number(e.key) - 1]];
      sky.sun.shadow.mapSize.set(quality.shadow, quality.shadow);
      if (sky.sun.shadow.map) { sky.sun.shadow.map.dispose(); sky.sun.shadow.map = null; }
    }
  });

  // ---- __G 检视协议 ----
  let fpsAcc = 0, fpsFrames = 0, fpsShown = 0, acc = 0, lastNow = performance.now();
  window.__G = {
    seed, params: Object.fromEntries(params), quality: () => quality,
    time: pipeline.time,
    showcase: showcase ? showcase.name : null,
    setQuality(name) { quality = H2B.QUALITY[name] || quality; },
    renderer, scene, camera,
  };
  window.__stats = () => {
    const i = renderer.info;
    return {
      calls: i.render.calls, tris: i.render.triangles, geos: i.memory.geometries,
      tex: i.memory.textures, programs: i.programs ? i.programs.length : 0,
      frame: pipeline.time.frame, fps: fpsShown, quality: quality.name,
    };
  };
  window.debugCut = () => {
    const g = window.__stats();
    console.log("debugCut:", JSON.stringify(g));
    return g;
  };

  // ---- 元素对账：实测计数（harness/gates/complete.mjs 读这里；契约见 references/12）----
  // 数字必须来自遍历/工厂自报，不许手填常数。
  const contentMeshes = [];
  content.content.traverse((o) => { if (o.isMesh) contentMeshes.push(o); });
  const geoSignatures = new Set(contentMeshes.map((m) => {
    const p = (m.geometry && m.geometry.parameters) || {};
    return `${m.geometry.type}:${(p.width || p.radius || 0).toFixed(2)}x${(p.height || 0).toFixed(2)}x${(p.depth || 0).toFixed(2)}`;
  }));
  window.__PARITY__ = {
    version: 1,
    counts: {
      propKinds: geoSignatures.size,          // 不同几何规格的道具形态（本样板未消费 props-kit）
      placedProps: contentMeshes.length,
      materialCount: mats.surface.names.length,
      textureSets: typeof SL_TEX_SETS !== "undefined" ? Object.keys(SL_TEX_SETS).length : 0,
      skyPasses: 1,
      groundLayers: ground.layers,
      puddlePatches: ground.puddles,
      postPasses: pipeline.passes,
      shadowMaps: sky.sun && sky.sun.castShadow ? 1 : 0,
      shadowTaps: pcssInstalled ? 16 : 0,
      galleriesUsed: Object.keys(deck.galleries).length,
    },
    source: { scene: "examples/quality", measuredAt: new Date().toISOString() },
  };

  let hudTimer = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    let dt = (now - lastNow) / 1000;
    lastNow = now;
    if (dt < 0) dt = 0;                       // 工程红线：dt 钳非负（首帧时间戳可能提前）
    if (dt > 0.1) dt = 0.1;
    fpsAcc += dt; fpsFrames += 1;
    if (fpsAcc >= 0.5) { fpsShown = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }
    pipeline.frame(bench ? 1 / 60 : dt);
    sky.update(pipeline.time.t);
    if (showcase && typeof showcase.update === "function") showcase.update(pipeline.time.t);
    ground.uniforms.uTime.value = pipeline.time.t;
    mats.surface.update();
    hudTimer += dt;
    if (hudTimer > 0.25) {
      hudTimer = 0;
      const s = window.__stats();
      hud.innerHTML = `h2b <b>quality</b> 雨后黄昏堆场 · <b>${fpsShown}</b> fps · ${s.calls} draws · ${(s.tris / 1000).toFixed(0)}k tris · q=${quality.name} [1/2/3]`;
    }
    acc += 1;
  }
  requestAnimationFrame(loop);
};
