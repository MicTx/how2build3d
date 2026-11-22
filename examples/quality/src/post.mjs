/**
 * quality/src/post.mjs — 观感链路 RT 与 pass（消费 assets/post-chain.glsl + post-aa.glsl 原样）。
 * 支撑 pass（亮部提取/金字塔/条纹/污渍/自适应）为集成层代码；主 pass 与 AA 数学原样保留。
 * 工程红线：post pass 读写不同 RT；管线失败整体回退直出。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.createPostChain = function createPostChain(THREE, renderer, quality) {
  const W = H2B.WORLD;
  const fsScene = new THREE.Scene();
  const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  fsScene.add(quad);
  const FS_VERT = "varying vec2 vUv;\nvoid main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
  const mkMat = (frag, uniforms, defines) => new THREE.ShaderMaterial({
    uniforms, defines, vertexShader: FS_VERT, fragmentShader: frag,
    depthTest: false, depthWrite: false,
  });

  const rt = (w, h, opts = {}) => new THREE.WebGLRenderTarget(Math.max(2, w | 0), Math.max(2, h | 0), {
    type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, ...opts,
  });

  // ---- 场景目标（HDR + 深度纹理供 shafts / 自适应）----
  let sceneRT = null;
  function makeSceneRT(w, h, samples) {
    const depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.type = THREE.UnsignedIntType;
    return new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, depthBuffer: true, depthTexture, samples,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
  }

  // ---- 亮部金字塔（Kawase 降采样 + 双层合成）----
  const brightMat = mkMat(`
uniform sampler2D tSrc; uniform float uThresh;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = smoothstep(uThresh, uThresh + 0.55, l);
  gl_FragColor = vec4(c * k, 1.0);
}`, { tSrc: { value: null }, uThresh: { value: 1.0 } });
  const tentMat = mkMat(`
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uMul;
varying vec2 vUv;
void main(){
  vec2 t = uTexel;
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0
    + (texture2D(tSrc, vUv + vec2(-t.x, -t.y)).rgb + texture2D(tSrc, vUv + vec2(t.x, -t.y)).rgb
     + texture2D(tSrc, vUv + vec2(-t.x, t.y)).rgb + texture2D(tSrc, vUv + vec2(t.x, t.y)).rgb) * 2.0
    + texture2D(tSrc, vUv + vec2(-2.0 * t.x, 0.0)).rgb + texture2D(tSrc, vUv + vec2(2.0 * t.x, 0.0)).rgb
    + texture2D(tSrc, vUv + vec2(0.0, -2.0 * t.y)).rgb + texture2D(tSrc, vUv + vec2(0.0, 2.0 * t.y)).rgb;
  gl_FragColor = vec4(c / 16.0 * uMul, 1.0);
}`, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uMul: { value: 1 } });
  const streakMat = mkMat(`
uniform sampler2D tSrc; uniform vec2 uTexel;
varying vec2 vUv;
void main(){
  vec3 c = vec3(0.0);
  for (int i = -12; i <= 12; i++) {
    c += texture2D(tSrc, vUv + vec2(float(i) * uTexel.x * 3.0, 0.0)).rgb * (1.0 - abs(float(i)) / 13.0);
  }
  gl_FragColor = vec4(c / 13.0, 1.0);
}`, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });

  // ---- 体积光柱（assets/shafts.glsl；硬件深度→线性视距的换算按 assets/index.md 纪律）----
  const shaftsFrag = GLSL_SHAFTS
    .replace(
      "uniform float uHasShadow, uMaxDist, uSigma, uFarZ, uFarHaze, uFlicker, uBoxDust;",
      "uniform float uHasShadow, uMaxDist, uSigma, uFarZ, uFarHaze, uFlicker, uBoxDust, uNear, uFar;"
    )
    .replace(
      "float z = texture2D(tDepthHalf, vUv).r;",
      "float dHW = texture2D(tDepthHalf, vUv).x;\n  float z = (uNear * uFar) / (uFar - dHW * (uFar - uNear));"
    );
  const shaftsMat = mkMat(shaftsFrag, {
    tDepthHalf: { value: null }, tShadow: { value: null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uCamPos: { value: new THREE.Vector3() },
    uSunRad: { value: new THREE.Vector3() }, uAmb: { value: new THREE.Vector3() },
    uTanHalf: { value: new THREE.Vector2() },
    uHasShadow: { value: 0 }, uMaxDist: { value: W.shafts.maxDist }, uSigma: { value: W.shafts.sigma },
    uFarZ: { value: 900 }, uFarHaze: { value: 1.6 }, uFlicker: { value: 0 }, uBoxDust: { value: 0 },
    uBoxMin: { value: new THREE.Vector3() }, uBoxMax: { value: new THREE.Vector3() },
    uSunDir: { value: new THREE.Vector3() }, uZen: { value: new THREE.Vector3(...W.zenith) },
    uHor: { value: new THREE.Vector3(...W.horizon) }, uHorAway: { value: new THREE.Vector3(...W.horizonAway) },
    uSunCol: { value: new THREE.Vector3(...W.sun.col) },
    uNear: { value: 0.1 }, uFar: { value: 900 },
  }, { VOL_STEPS: "12" });

  // ---- 合成：scene*T + acc ----
  const compositeMat = mkMat(`
uniform sampler2D tScene, tShaft;
varying vec2 vUv;
void main(){
  vec4 s = texture2D(tScene, vUv);
  vec4 v = texture2D(tShaft, vUv);
  gl_FragColor = vec4(s.rgb * v.a + v.rgb, 1.0);
}`, { tScene: { value: null }, tShaft: { value: null } });

  // ---- 镜头污渍贴图（Canvas 一次性）----
  function makeDirt() {
    const S = 256, canvas = document.createElement("canvas");
    canvas.width = S; canvas.height = S;
    const ctx = canvas.getContext("2d");
    const rng = H2B.seededRng(9021);
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 42; i += 1) {
      const x = rng() * S, y = rng() * S, r = 4 + rng() * 26;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const a = 0.10 + rng() * 0.5;
      g.addColorStop(0, "rgba(255,255,255," + a.toFixed(3) + ")");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 160; i += 1) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(rng() * S, rng() * S, 1 + rng() * 2, 1 + rng() * 2);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ---- 自适应：GPU 1×1 乒乓（上游 adapt 语义；CPU 读回在 SwiftShader 下不可靠，禁用）----
  const adaptA = rt(1, 1), adaptB = rt(1, 1);
  let adaptIdx = 0;
  const adaptMat = mkMat(`
uniform sampler2D tSrc; uniform sampler2D tPrev; uniform float uTau; uniform float uFirst;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vec2(0.5)).rgb * 0.36
    + texture2D(tSrc, vec2(0.18, 0.18)).rgb * 0.16
    + texture2D(tSrc, vec2(0.82, 0.18)).rgb * 0.16
    + texture2D(tSrc, vec2(0.18, 0.82)).rgb * 0.16
    + texture2D(tSrc, vec2(0.82, 0.82)).rgb * 0.16;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float p = texture2D(tPrev, vec2(0.5)).r;
  gl_FragColor = vec4(uFirst > 0.5 ? l : mix(p, l, uTau), 1.0, 0.0, 1.0);
}`, { tSrc: { value: null }, tPrev: { value: adaptA.texture }, uTau: { value: 0.1 }, uFirst: { value: 1 } });
  const adaptTex = adaptA.texture;

  // ---- 主 pass（assets/post-chain.glsl 原样；标定值取上游实测配置 [src:L31369-L31387]）----
  const postMat = mkMat(GLSL_POST_CHAIN, {
    tScene: { value: null }, tBloom: { value: null }, tBlur: { value: null },
    tStreak: { value: null }, tDirt: { value: makeDirt() }, tAdapt: { value: adaptTex },
    uExposure: { value: 1.0 }, uKey: { value: 0.35 }, uMinE: { value: 0.25 }, uMaxE: { value: 2.0 }, uAuto: { value: 1 },
    uSunCol: { value: new THREE.Vector3(...W.sun.col) },
    uSunUv: { value: new THREE.Vector2(0.5, 0.8) },
    uTime: { value: 0 }, uAspect: { value: 1 },
    uBloom: { value: 0.065 }, uDirt: { value: 0.1 }, uStreak: { value: 0.03 }, uFlare: { value: 0.16 },
    uCA: { value: 0.0013 }, uVignette: { value: 0.3 },
    uDamage: { value: 0 }, uLowHealth: { value: 0 }, uAds: { value: 0 }, uFlash: { value: 0 },
    uFade: { value: 0 }, uSaturation: { value: 1.0 }, uSunOn: { value: 0 }, uThunder: { value: 0 },
    uAgxMix: { value: 0.25 },
  });
  const aaMat = mkMat(GLSL_POST_AA, {
    tSrc: { value: null }, uTexel: { value: new THREE.Vector2() },
    uTime: { value: 0 }, uGrain: { value: 0.02 }, uSharpen: { value: 0.3 }, uFxaa: { value: 1 },
  });

  let chain = null;
  function ensureChain(w, h, samples) {
    if (chain && chain.w === w && chain.h === h && chain.samples === samples) return chain;
    disposeChain();
    const q = quality();
    const hw = Math.max(2, Math.round(w * q.scale)), hh = Math.max(2, Math.round(h * q.scale));
    const dw = Math.max(2, Math.round(hw / 2)), qw = Math.max(2, Math.round(hw / 4)), sw = Math.max(2, Math.round(hw / 8)), xs = Math.max(2, Math.round(hw / 16));
    sceneRT = makeSceneRT(hw, hh, samples);
    chain = {
      w, h, samples, hw, hh,
      shaftRT: rt(qw, qw), compRT: rt(hw, hh),
      a: rt(dw, dw), b: rt(qw, qw), c: rt(sw, sw), d: rt(xs, xs),
      bloomRT: rt(qw, qw), streakRT: rt(qw, qw), blurRT: rt(qw, qw),
      postRT: rt(hw, hh),
    };
    return chain;
  }
  function disposeChain() {
    if (!chain) return;
    for (const k of ["shaftRT", "compRT", "a", "b", "c", "d", "bloomRT", "streakRT", "blurRT", "postRT"]) chain[k].dispose();
    if (sceneRT) sceneRT.dispose();
    chain = null;
  }

  const draw = (target, mat) => {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(fsScene, fsCam);
  };

  return {
    ensureChain, disposeChain, get chain() { return chain; },
    quad, fsScene, fsCam,
    mats: { brightMat, tentMat, streakMat, shaftsMat, compositeMat, postMat, aaMat, adaptMat },
    draw,
    adapt: { mat: adaptMat, a: adaptA, b: adaptB, swap: () => (adaptIdx = adaptIdx === 0 ? 1 : 0), get idx() { return adaptIdx; } },
    sceneRT: () => sceneRT,
  };
};
