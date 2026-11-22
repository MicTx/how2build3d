/**
 * starter/src/scene.mjs — 预算契约、自适应分辨率、检视协议与错误分诊。
 * 对应技巧卡 T-01/T-02/T-22/T-24 与图集 G/H。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.QUALITY = {
  low:    { scale: 0.70, msaa: 0, shadow: 1024, tex: 256,  volSteps: 12, bloom: false, rain: 0.5 },
  medium: { scale: 0.85, msaa: 2, shadow: 1024, tex: 512,  volSteps: 16, bloom: true,  rain: 0.8 },
  high:   { scale: 1.00, msaa: 4, shadow: 2048, tex: 1024, volSteps: 24, bloom: true,  rain: 1.0 },
};

H2B.bootStarter = function bootStarter() {
  const params = Object.fromEntries(new URLSearchParams(location.search));
  const seed = Number(params.seed || 4207);
  const quality = H2B.QUALITY[params.q || "low"] || H2B.QUALITY.low;
  const rng = H2B.seededRng(seed);
  const canvas = document.getElementById("view");
  window.__errors = window.__errors || [];
  window.addEventListener("error", (e) => window.__errors.push(String(e.message)));

  // 启动链可观察契约：__READY__ 在编译/合成完成后才置 ready；
  // __DEGRADE__ 记录注入模式与回退；bench 固定帧步进让同 seed 双渲染逐像素可复现。
  const inject = ["post", "chunk", "asset"].includes(params.__FORCE_FAIL__) ? params.__FORCE_FAIL__ : null;
  const degrade = { injected: inject, fallback: inject ? { post: "forward", chunk: "stock", asset: "flat" }[inject] : null };
  window.__DEGRADE__ = degrade;
  const bench = Object.prototype.hasOwnProperty.call(params, "bench");
  const holdFrame = Math.max(1, Number(params.frame || 64));
  const ready = { ready: false, at: 0, firstFrameAt: 0, maxBatchMs: 0, batches: [] };
  window.__READY__ = ready;
  function batch(name, fn) {
    const t0 = performance.now();
    const value = fn();
    const ms = performance.now() - t0;
    ready.batches.push({ name, ms: Math.round(ms * 100) / 100 });
    if (ms > ready.maxBatchMs) ready.maxBatchMs = Math.round(ms * 100) / 100;
    return value;
  }

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;

  // T-22: shader error triage by marker
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    const src = gl.getShaderSource(fs) || "";
    const label = src.includes("h2b-sky") || src.includes("uZenith") ? "sky"
      : src.includes("h2b-wet") || src.includes("fbm3") ? "wet-ground" : "material";
    const info = gl.getShaderInfoLog(fs) || "";
    window.__errors.push(`[render] shader error in ${label}: ${info.slice(0, 300)}`);
  };

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(74, 16 / 9, 0.08, 900);
  camera.rotation.order = "YXZ";
  camera.position.set(0, 2.4, 22);
  camera.lookAt(0, 2.0, -8);

  const noiseTex = batch("noise", () => H2B.makeNoiseTexture(THREE, seed));
  const uTime = { value: 0 };
  // 失败注入：chunk -> 库存实现（assemble 抛错时退化为基础网格）；asset -> 纯色材质。
  // 不注入时走正常装配路径，行为零变化。
  let parts;
  try {
    if (inject === "chunk") throw new Error("injected chunk failure");
    parts = batch("assemble", () => H2B.assembleHarbor(THREE, scene, { noiseTex, uTime, rng }));
  } catch (err) {
    degrade.fallback = "stock";
    parts = { sky: batch("stock-sky", () => new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshBasicMaterial({ color: 0x223344 }))) };
    scene.add(parts.sky);
  }
  if (inject === "asset") {
    degrade.fallback = "flat";
    batch("flat-materials", () => {
      scene.traverse((obj) => {
        if (obj.isMesh) obj.material = new THREE.MeshBasicMaterial({ color: 0x447766 });
      });
    });
  }
  if (inject === "post") {
    degrade.fallback = "forward";
    batch("forward-pass", () => { renderer.toneMapping = THREE.NoToneMapping; });
  }

  const post = { damage: 0, lowHealth: 0, ads: 0, flash: 0, fade: 0, saturation: 1, wet: 1 };
  const time = { t: 0, dt: 0, frame: 0 };
  const ctx = { params, seed, rng, quality, time, scene, camera, render: null, post };
  window.__G = ctx;
  window.__stats = () => ({
    calls: renderer.info.render.calls,
    tris: renderer.info.render.triangles,
    geos: renderer.info.memory.geometries,
    tex: renderer.info.memory.textures,
    fps: time.dt > 0 ? Number((1 / time.dt).toFixed(1)) : 0,
    state: "running",
  });

  // T-02: pixel budget governor
  function resize() {
    const w = window.innerWidth || 960;
    const h = window.innerHeight || 540;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let scale = quality.scale;
    const budget = { low: 1e6, medium: 15e5, high: 23e5 }[quality.name || (scale <= .7 ? "low" : scale <= .85 ? "medium" : "high")] || 1e6;
    const used = w * dpr * h * dpr * scale * scale;
    if (used > budget) scale *= Math.sqrt(budget / used);
    renderer.setPixelRatio(dpr * scale);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  ctx.render = { stats: () => window.__stats(), resize };
  // 编译/合成批次全部完成后才置 ready；首帧不得早于该时刻。
  batch("warmup", () => { renderer.compile(scene, camera); });
  ready.at = performance.now();
  ready.ready = true;

  let last = performance.now();
  let hudAt = 0;
  function frame(now) {
    // bench 用 1/60 定步长 + 定格，消除墙钟 dt 造成的不可复现像素。
    const dt = bench ? 1 / 60 : Math.min((now - last) / 1000, 0.1);
    last = now;
    time.t += dt; time.dt = dt; time.frame += 1;
    uTime.value = time.t;
    if (!ready.firstFrameAt) ready.firstFrameAt = performance.now();
    renderer.info.reset();
    // 轻巡巡让画面确实在动（同 seed 仍确定）
    camera.position.x = Math.sin(time.t * 0.12) * 2.2;
    camera.lookAt(0, 2.0, -8);
    parts.sky.position.copy(camera.position);
    try {
      renderer.render(scene, camera);
    } catch (err) {
      window.__errors.push(String(err && err.message ? err.message : err));
    }
    if (now - hudAt > 500) {
      hudAt = now;
      const el = document.getElementById("hud");
      if (el) el.textContent = `h2b starter · ${window.__stats().fps} fps · ${Math.round(noiseTex.image.width)}px noise · seed ${seed}`;
    }
    if (bench && time.frame >= holdFrame) {
      // hold：不再推进帧，页面停在确定帧供截图（心跳/错误仍可观察）。
      return;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return ctx;
};
