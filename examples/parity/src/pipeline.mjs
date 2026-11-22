/**
 * quality/src/pipeline.mjs — 每帧排班：阴影门控 → 平面反射 → 场景 HDR+深度 →
 * 体积光柱 → 合成 → 亮部金字塔 → post-chain → post-aa。失败整体回退直出。
 * __G/__stats()/?bench/debugCut() 检视协议齐全（S9）。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.createPipeline = function createPipeline(ctx) {
  const { THREE, renderer, scene, camera, post, sun, ground, quality } = ctx;
  const W = H2B.WORLD;
  const { mats } = post;
  const raycaster = new THREE.Raycaster();
  const adaptState = { luma: 0.5, vis: 0, counter: 0 };
  let pcssApplied = false;
  let bloomDraws = 0;
  let bloomLevelsSeen = 0;
  let frame = 0;
  const time = { t: 0, frame: 0, dt: 0, last: 0 };

  // ---- 太阳在画面中的 UV + 可见度（CPU，低频刷新）----
  const sunUv = new THREE.Vector3();
  function updateSunVis(content) {
    sunUv.copy(ctx.sunDir).multiplyScalar(400).add(camera.position).project(camera);
    const inView = sunUv.z < 1 && Math.abs(sunUv.x) < 1.2 && Math.abs(sunUv.y) < 1.2;
    let vis = 0;
    if (inView) {
      raycaster.set(camera.position, ctx.sunDir);
      raycaster.far = 400;
      vis = raycaster.intersectObjects(ctx.occluders, true).length ? 0 : 1;
    }
    post.mats.postMat.uniforms.uSunUv.value.set((sunUv.x + 1) / 2, (sunUv.y + 1) / 2);
    post.mats.postMat.uniforms.uSunOn.value = vis;
    return vis;
  }

  function renderFrame(dt) {
    frame += 1; time.frame = frame; time.t += dt; time.dt = dt;
    renderer.info.reset();
    const q = quality();
    const size = new THREE.Vector2();
    renderer.getDrawingBufferSize(size);
    const chain = post.ensureChain(size.x, size.y, q.msaa);
    const sceneRT = post.sceneRT();

    // 阴影隔帧门控
    renderer.shadowMap.autoUpdate = false;
    if ((frame % 3 === 1 && q.shadowPass !== false) || !sun.shadow.map) sun.shadow.needsUpdate = true;
    if (!pcssApplied && ctx.mats) { pcssApplied = ctx.mats.ensurePCSS(sun); }

    // 平面反射前置 pass（水洼镜面）
    if (ground && ground.planar && q.planar > 0) {
      ground.planar.pass(camera, q.planar, (reflCam, rt) => {
        renderer.setRenderTarget(rt);
        renderer.render(scene, reflCam);
      });
    }

    // 场景 → HDR+深度
    renderer.setRenderTarget(sceneRT);
    renderer.render(scene, camera);

    // 体积光柱（1/4 res）
    const sm = mats.shaftsMat.uniforms;
    sm.tDepthHalf.value = sceneRT.depthTexture;
    sm.uCamWorld.value.copy(camera.matrixWorld);
    sm.uCamPos.value.copy(camera.position);
    sm.uTanHalf.value.set(Math.tan(camera.fov * Math.PI / 360) * camera.aspect, Math.tan(camera.fov * Math.PI / 360));
    sm.uNear.value = camera.near; sm.uFar.value = camera.far; sm.uFarZ.value = camera.far;
    sm.uSunDir.value.copy(ctx.sunDir);
    // 上游 [src:L31680-L31684]：uSunRad = 光色 × 强度 × volSunScale；uAmb = 雾色 × volAmbient
    sm.uSunRad.value.set(...W.sun.col).multiplyScalar(W.sun.intensity * W.shafts.sunScale);
    sm.uAmb.value.set(...W.fog.colorLin).multiplyScalar(W.shafts.ambient);
    sm.uMaxDist.value = W.shafts.maxDist; sm.uSigma.value = W.shafts.sigma; sm.uFarHaze.value = W.shafts.farHaze;
    sm.uZen.value.set(...W.zenith); sm.uHor.value.set(...W.horizon); sm.uHorAway.value.set(...W.horizonAway);
    sm.uSunCol.value.set(...W.sun.col);
    if (sun.shadow.map) {
      sm.tShadow.value = sun.shadow.map.texture;
      sm.uShadowMatrix.value.copy(sun.shadow.matrix);
      sm.uHasShadow.value = 1;
    } else {
      sm.uHasShadow.value = 0;
    }
    post.draw(chain.shaftRT, mats.shaftsMat);

    // 合成 scene*T + acc
    mats.compositeMat.uniforms.tScene.value = sceneRT.texture;
    mats.compositeMat.uniforms.tShaft.value = chain.shaftRT.texture;
    post.draw(chain.compRT, mats.compositeMat);

    // 亮部金字塔
    mats.brightMat.uniforms.tSrc.value = chain.compRT.texture;
    mats.brightMat.uniforms.uThresh.value = q.bloom === false ? 99.0 : 1.0;
    post.draw(chain.a, mats.brightMat); bloomDraws += 1;
    const tent = mats.tentMat.uniforms;
    tent.uMul.value = 1;
    tent.tSrc.value = chain.a.texture; tent.uTexel.value.set(1 / chain.a.width, 1 / chain.a.height);
    post.draw(chain.b, mats.tentMat); bloomDraws += 1;
    tent.tSrc.value = chain.b.texture; tent.uTexel.value.set(1 / chain.b.width, 1 / chain.b.height);
    post.draw(chain.c, mats.tentMat); bloomDraws += 1;
    tent.tSrc.value = chain.c.texture; tent.uTexel.value.set(1 / chain.c.width, 1 / chain.c.height);
    post.draw(chain.d, mats.tentMat); bloomDraws += 1;
    tent.tSrc.value = chain.d.texture; tent.uTexel.value.set(1 / chain.d.width, 1 / chain.d.height);
    tent.uMul.value = 1.4;
    post.draw(chain.bloomRT, mats.tentMat);
    bloomLevelsSeen = bloomDraws; bloomDraws = 0;
    mats.streakMat.uniforms.tSrc.value = chain.c.texture;
    mats.streakMat.uniforms.uTexel.value.set(1 / chain.c.width, 1 / chain.c.height);
    post.draw(chain.streakRT, mats.streakMat);
    // ADS 柔边用 tBlur（1/4）
    tent.uMul.value = 1;
    tent.tSrc.value = chain.compRT.texture; tent.uTexel.value.set(1 / chain.compRT.width, 1 / chain.compRT.height);
    post.draw(chain.blurRT, mats.tentMat);

    // 自适应：1×1 GPU 乒乓（5-tap 场景采样，tau 1.5s）；太阳可见度 CPU 低频写 uSunOn
    {
      const A = post.adapt;
      const next = A.idx === 0 ? A.b : A.a;
      const prev = A.idx === 0 ? A.a : A.b;
      A.mat.uniforms.tSrc.value = chain.compRT.texture;
      A.mat.uniforms.tPrev.value = prev.texture;
      A.mat.uniforms.uTau.value = 1 - Math.exp(-Math.max(dt, 0) / 1.5);
      A.mat.uniforms.uFirst.value = frame === 1 ? 1 : 0;
      post.draw(next, A.mat);
      A.swap();
      mats.postMat.uniforms.tAdapt.value = next.texture;
      if (frame % 20 === 0 && ctx.content) {
        adaptState.vis = updateSunVis(ctx.occluders);
      }
    }

    // post-chain → postRT
    const pu = mats.postMat.uniforms;
    pu.tScene.value = chain.compRT.texture;
    pu.tBloom.value = chain.bloomRT.texture;
    pu.tBlur.value = chain.blurRT.texture;
    pu.tStreak.value = chain.streakRT.texture;
    pu.uBloom.value = q.bloom ? 0.065 : 0;
    pu.uAspect.value = chain.hw / chain.hh;
    pu.uTime.value = time.t;
    post.draw(chain.postRT, mats.postMat);

    // post-aa → 屏幕
    const au = mats.aaMat.uniforms;
    au.tSrc.value = chain.postRT.texture;
    au.uTexel.value.set(1 / chain.hw, 1 / chain.hh);
    au.uTime.value = time.t;
    post.draw(null, mats.aaMat);
  }

  // ---- 降级：高级管线异常退直出（与上游 [advanced disabled] 同构）----
  function frameAdvanced(dt) {
    try {
      renderFrame(dt);
    } catch (e) {
      console.warn("[H2B_POST] advanced disabled, falling back:", e && e.message);
      (window.__errors = window.__errors || []).push("pipeline:" + (e && e.message || e) + " @ " + String(e && e.stack || "").split("\n").slice(1, 3).join(" <- ").slice(0, 300));
      const info = renderer.getContext().getError ? renderer.getContext().getError() : 0;
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    }
  }

  // passes：scene → shafts → composite → post-chain → post-aa（元素对账实测值，见 references/12）
  return { frame: frameAdvanced, time, quality, passes: 5, get bloomLevels() { return bloomLevelsSeen; } };
};
