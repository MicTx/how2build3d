/**
 * sky.mjs — 云甲板天空（装配顺序 #3a）：assets/sky-deck.glsl 原样消费 + PMREM 环境烘制。
 * 上游纪律：太阳盘不进 PMREM（uEnv=1 时 disk*(1-uEnv) 且颜色 clamp 到 6.0 抗火点）。
 * 雷暴：weather-kit 直写 uFlash/uFlashDir（本模块只暴露 uniforms）。
 */
globalThis.H2B = globalThis.H2B || {};

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

  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: "varying vec3 vDir;\nvoid main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: GLSL_SKY_DECK,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(520, 32, 20), material);
  mesh.name = "h2b-sky-deck";
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  scene.add(mesh);

  const sun = new THREE.DirectionalLight(new THREE.Color(...W.sun.col), W.sun.intensity);
  sun.position.copy(sunDir).multiplyScalar(160);
  sun.castShadow = true;
  const shadowSize = opts.shadowSize || 2048;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 320;
  sun.shadow.camera.left = -52;
  sun.shadow.camera.right = 52;
  sun.shadow.camera.top = 46;
  sun.shadow.camera.bottom = -46;
  sun.shadow.bias = -1.2e-4;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);
  const fill = new THREE.HemisphereLight(0x36404e, 0x1c1a16, 0.32);
  scene.add(fill);
  scene.fog = new THREE.FogExp2(new THREE.Color(...W.fog.colorLin), W.fog.density);

  function captureEnvironment() {
    const cubeRT = new THREE.WebGLCubeRenderTarget(128);
    const cubeCam = new THREE.CubeCamera(1, 900, cubeRT);
    cubeCam.position.set(0, 2, 0);
    uniforms.uEnv.value = 1;
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
    pmrem.dispose();
    cubeRT.dispose();
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.4;
  }

  return { mesh, uniforms, sun, fill, sunDir, captureEnvironment, update(time) { uniforms.uTime.value = time; } };
};
