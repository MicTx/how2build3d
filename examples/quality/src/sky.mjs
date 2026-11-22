/**
 * quality/src/sky.mjs — 云甲板天空（assets/sky-deck.glsl 原样消费）+ PMREM 环境光照。
 * 上游纪律：太阳盘不进 PMREM（uEnv=1 时 disk*(1-uEnv) 且颜色 clamp 到 6.0 抗火点）。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.WORLD = {
  seed: 4207,
  groundY: 0,
  // 上游标定 [src:L30035-L30041]：方向/色温/强度与天空四色
  sun: { dir: [0.916, 0.225, 0.331], col: [1.0, 0.72, 0.42], intensity: 9.0 },
  fog: { color: [0.42, 0.47, 0.52], density: 0.0028 },
  zenith: [0.055, 0.085, 0.13],
  horizon: [0.95, 0.55, 0.28],
  horizonAway: [0.16, 0.22, 0.3],
  // 上游体积配置 [src:L31361-L31366]：volSunScale .85 / volAmbient .2 / sigma / maxDist / farHaze
  shafts: { sigma: 0.0034, maxDist: 170, farHaze: 0.42, sunScale: 0.85, ambient: 0.2 },
};

H2B.makeSkyMaterial = function makeSkyMaterial(THREE, noiseTex, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `
varying vec3 vDir;
void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: GLSL_SKY_DECK,
  });
};

H2B.createSky = function createSky(THREE, scene, renderer, noiseTex, opts = {}) {
  const W = H2B.WORLD;
  const sunDir = new THREE.Vector3(...W.sun.dir).normalize();
  const uniforms = {
    uTime: { value: 0 },
    uEnv: { value: 0 },
    uFlash: { value: 0 },
    uFlashDir: { value: new THREE.Vector3(0, 1, 0) },
    tNoise: { value: noiseTex },
    uSunDir: { value: sunDir },
    uZen: { value: new THREE.Vector3(...W.zenith) },
    uHor: { value: new THREE.Vector3(...W.horizon) },
    uHorAway: { value: new THREE.Vector3(...W.horizonAway) },
    uSunCol: { value: new THREE.Vector3(...W.sun.col) },
  };

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(520, 32, 20), H2B.makeSkyMaterial(THREE, noiseTex, uniforms));
  mesh.name = "h2b-sky-deck";
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  scene.add(mesh);

  // 太阳平行光 + 环境
  const sun = new THREE.DirectionalLight(new THREE.Color(...W.sun.col), W.sun.intensity);
  sun.position.copy(sunDir).multiplyScalar(160);
  sun.castShadow = true;
  sun.shadow.mapSize.set(opts.shadowSize || 2048, opts.shadowSize || 2048);
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 320;
  sun.shadow.camera.left = -55; sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
  sun.shadow.bias = -1.2e-4;
  scene.add(sun, sun.target);
  const fill = new THREE.HemisphereLight(0x36404e, 0x1c1a16, 0.3);
  scene.add(fill);
  scene.fog = new THREE.FogExp2(new THREE.Color(...W.fog.color), W.fog.density);

  // ---- PMREM 环境：uEnv=1 捕获天空（无太阳盘、无火点），一次结清 ----
  function captureEnvironment() {
    const cubeRT = new THREE.WebGLCubeRenderTarget(128);
    const cubeCam = new THREE.CubeCamera(1, 900, cubeRT);
    cubeCam.position.set(0, 2, 0);
    uniforms.uEnv.value = 1;
    // 捕获期只留天空：场景其余对象临时隐藏
    const hidden = [];
    scene.traverse((o) => {
      if (o !== mesh && (o.isMesh || o.isInstancedMesh) && o.visible) { hidden.push(o); o.visible = false; }
    });
    const prevFog = scene.fog;
    scene.fog = null;
    cubeCam.update(renderer, scene);
    for (const o of hidden) o.visible = true;
    scene.fog = prevFog;
    uniforms.uEnv.value = 0;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromCubemap(cubeRT.texture);
    pmrem.dispose(); cubeRT.dispose();
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.4;
  }

  return {
    mesh, uniforms, sun, fill,
    sunDir,
    captureEnvironment,
    update(time) { uniforms.uTime.value = time; },
  };
};
