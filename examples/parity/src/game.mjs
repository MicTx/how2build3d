/**
 * game.mjs — 玩法链路（装配顺序 #6-#13）：physics + level + combat + player + weapon
 * + enemies + fx 消费 + mission(波次/目标/撤离)。感知与令牌不重写，全部对接 kit。
 * 展示口径：武器由脚本节流开火（autoBattle 风格），玩家行走/视角走 player-kit 真实输入。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.initGameplay = function initGameplay(ctx) {
  const { THREE, scene, camera, canvas, world, events, fx, mats, physics, level } = ctx;
  const rng = ctx.rng;
  const meta = H2B.STRUCT_LAYOUT.meta;

    /* ---- #9 combat 导演 ---- */
  const combat = CombatKit.createCombatKit({ physics, events, rng });

  /* ---- #7 player ---- */
  const playerKit = PlayerKit.createPlayerKit({ physics, events, rng, camera });
  playerKit.input.attach(canvas);
  playerKit.input.setGameplay(true);
  playerKit.player.reset({ pos: { x: meta.playerStart.pos.x, y: meta.playerStart.pos.y, z: meta.playerStart.pos.z }, yaw: meta.playerStart.yaw });

  /* ---- #8 weapon（挂相机；材质槽走 SL 目录）---- */
  const weapon = WeaponKit.createWeaponKit(THREE, {
    rng,
    events,
    camera: null,
    materials: {
      ano: mats.surface.get("anodized_black", {}),
      gun: mats.surface.get("gunmetal", {}),
      poly: mats.surface.get("polymer_black", {}),
      plain: mats.surface.get("steel_worn", {}),
      lens: mats.surface.get("glass", {}),
    },
  });
  camera.add(weapon.root);

  /* ---- #10 enemies（骨骼 rig + 感知对接 combat）---- */
  const enemies = EnemyKit.createEnemyKit(THREE, {
    combat,
    physics,
    events,
    rng,
    fx,
    mats: { get: (slot) => mats.surface.get(slot, {}) },
  });
  enemies.setSpawnPoints(level.enemySpawns);

  /* ---- 武器事件 → fx/tracer/弹道结算（相机与弹道同源：player 视角差喂 weapon）---- */
  const tracerEnd = { x: 0, y: 0, z: 0 };
  events.on("weapon:fire", (e) => {
    fx.muzzleFlash(e.muzzle, e.dir, { scale: e.ads > 0.5 ? 0.8 : 1 });
    /* 听觉链：枪声在 hearRadius 内唤醒巡逻者（combat-kit.alert，不重写传播） */
    combat.alert(e.origin, combat.TUNE.hearRadius);
    const hit = combat.playerShot(e.origin, e.dir, {
      enemyRaycast: (o, d, max) => enemies.raycast(o, d, max),
    });
    const end = hit && hit.point ? hit.point : null;
    if (end) { tracerEnd.x = end.x; tracerEnd.y = end.y; tracerEnd.z = end.z; }
    else {
      tracerEnd.x = e.origin.x + e.dir.x * 120;
      tracerEnd.y = e.origin.y + e.dir.y * 120;
      tracerEnd.z = e.origin.z + e.dir.z * 120;
    }
    fx.tracer(e.origin, tracerEnd, {});
    const shellXf = weapon.shellTransform(undefined, camera, playerKit.player.vel);
    fx.shell({ x: shellXf.x, y: shellXf.y, z: shellXf.z }, { x: shellXf.vx, y: shellXf.vy, z: shellXf.vz });
  });
  events.on("impact", (e) => {
    if (!e || !e.point) return;
    const kind = /metal/.test(e.surface || "") ? "bullet_metal"
      : /water/.test(e.surface || "") ? null
      : "bullet_concrete";
    if (!kind) { fx.splash(e.point, {}); return; }
    fx.impact(e.point, e.normal || null, kind, null, false);
  });

  /* ---- #13 mission：波次表 + 目标 + 撤离 + 简报 ---- */
  const WAVES = [
    { gulls: 3, hounds: 1 },
    { gulls: 3, hounds: 2 },
    { gulls: 4, hounds: 3 },
  ];
  const MAX_ALIVE = 6;
  const objectives = level.objectives.map((o) => ({ ...o, done: false, holdT: 0 }));
  const mission = { wavesTotal: 0,
    phase: "insert", t: 0, wave: -1, waveT: 0, reinforceT: 24,
    kills: 0, endT: 0, extracted: false,
    summary: { time: 0, kills: 0, shots: 0, impacts: 0, alerts: 0 },
  };
  mission.wavesTotal = WAVES.length;
  const playerView = { pos: playerKit.player.pos, alive: true };

  function announce(msg) { events.emit("mission:msg", { text: msg }); }

  function spawnNextWave() {
    mission.wave += 1;
    if (mission.wave >= WAVES.length) return;
    const w = WAVES[mission.wave];
    mission.waveT = 0;
    const alive = enemies.stats().active;
    const room = Math.max(0, MAX_ALIVE - alive);
    const want = Math.min(room, w.gulls + w.hounds);
    if (want > 0) enemies.spawnWave(want, {});
    announce("第 " + (mission.wave + 1) + " 波来袭：" + w.gulls + " 隼 " + w.hounds + " 犬");
  }

  function cutObjective(obj, playerPos) {
    obj.done = true;
    combat.mission.cutRelay();
    fx.explosion({ x: obj.pos.x, y: obj.pos.y + 1.4, z: obj.pos.z }, {});
    fx.addEmitter({ x: obj.pos.x, y: obj.pos.y + 1.2, z: obj.pos.z }, "smoke", {});
    announce(obj.label + " 完成（" + objectives.filter((o) => o.done).length + "/3）");
  }

  function update(dt) {
    mission.t += dt;
    /* 玩家帧序：input.update → player.update → endFrame（kit 合同） */
    playerKit.input.update(dt);
    playerKit.player.update(dt);
    playerKit.input.endFrame();
    playerView.alive = playerKit.player.alive;

    /* 武器脚本节流开火（自动战斗采样口径），视角差喂 weapon 弹簧 */
    const p = playerKit.player;
    const lookDx = p.viewYaw - (game.prevYaw || p.viewYaw);
    const lookDy = p.viewPitch - (game.prevPitch || p.viewPitch);
    game.prevYaw = p.viewYaw;
    game.prevPitch = p.viewPitch;
    const eye = p.eye;
    let target = null;
    let best = 46;
    for (const e of enemies.active) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - eye.x, (e.pos.y - eye.y) * 0.6, e.pos.z - eye.z);
      if (d < best) { best = d; target = e; }
    }
    fire.cool -= dt;
    if (target && fire.cool <= 0) { fire.burst = 0.42; fire.cool = 1.7 + rng() * 0.9; }
    if (fire.burst > 0) fire.burst -= dt;
    weapon.update(dt, {
      fire: fire.burst > 0 && playerKit.player.alive,
      ads: false, reload: false, sprint: false, crouch: false,
      moveX: 0, moveY: 0,
      speed: p.speed, onGround: p.onGround, vy: p.vel.y,
      lookDx, lookDy,
    });
    weapon.root.position.set(weapon.pose.x, weapon.pose.y, weapon.pose.z);
    weapon.root.rotation.set(weapon.pose.rx, weapon.pose.ry, weapon.pose.rz, "YXZ");

    /* 导演 */
    combat.updateBolts(dt);
    enemies.update(dt, playerView);
    if (mission.phase === "insert") {
      if (mission.t > 2.5) { mission.phase = "waves"; announce("防守堆场：切断三台中继后向码头撤离"); spawnNextWave(); }
    } else if (mission.phase === "waves" || mission.phase === "pursuit") {
      mission.waveT += dt;
      const alive = enemies.stats().active;
      const allCut = objectives.every((o) => o.done);
      if (mission.phase === "waves") {
        if (allCut) { mission.phase = "pursuit"; announce("中继全断：敌方增援，向码头快艇撤离！"); spawnNextWave(); }
        else if (alive === 0 && mission.waveT > 6) spawnNextWave();
        else if (mission.waveT > 45) spawnNextWave();
      } else {
        mission.reinforceT -= dt;
        if (alive < 3 && mission.reinforceT <= 0 && !mission.extracted) {
          mission.reinforceT = 24;
          if (alive + 2 <= MAX_ALIVE) enemies.spawnWave(2, {});
        }
        const ex = meta.extraction;
        const dEx = Math.hypot(p.pos.x - ex.pos.x, p.pos.z - ex.pos.z);
        if (dEx < ex.radius) {
          mission.phase = "exfil";
          announce("登船撤离——任务简报生成中");
        }
      }
    } else if (mission.phase === "exfil") {
      mission.endT += dt;
      if (mission.endT > 2) {
        mission.extracted = true;
        mission.phase = "briefing";
        const s = combat.stats;
        mission.summary = {
          time: mission.t, kills: mission.kills, shots: s.shots, impacts: s.impacts, alerts: s.alerts,
        };
        events.emit("mission:brief", mission.summary);
      }
    }
    /* 目标切割：贴近中继 1.2s */
    for (const obj of objectives) {
      if (obj.done) continue;
      const d = Math.hypot(p.pos.x - obj.pos.x, p.pos.z - obj.pos.z);
      if (d < obj.radius) {
        obj.holdT += dt;
        if (obj.holdT > 1.2) cutObjective(obj, p.pos);
      } else obj.holdT = Math.max(0, obj.holdT - dt * 2);
    }
  }

  events.on("player:hitEnemy", (e) => { if (e && e.killed) mission.kills += 1; });

  const fire = { burst: 0, cool: 1.4 };
  const game = {
    physics, level, combat, playerKit, weapon, enemies, mission, objectives,
    prevYaw: 0, prevPitch: 0, respawnT: 0,
    update(dt) {
      update(dt);
      if (!playerKit.player.alive && game.respawnT <= 0) {
        game.respawnT = 3;
        announce("你被击倒了——3 秒后在闸口重生");
      }
      if (game.respawnT > 0) {
        game.respawnT -= dt;
        if (game.respawnT <= 0) {
          playerKit.player.reset({ pos: { ...meta.playerStart.pos }, yaw: meta.playerStart.yaw });
          announce("重新部署完成");
        }
      }
    },
    counts() {
      const es = enemies.stats();
      const ws = weapon.stats();
      return {
        enemyTypes: es.enemyTypes,
        enemySpawns: es.enemySpawns,
        enemyRigs: es.enemyRigs,
        weaponMeshes: ws.weaponMeshes,
        weaponChannels: ws.weaponChannels,
        waves: WAVES.length,
        objectives: objectives.length,
        objectivesWired: objectives.length,   // 全部接入切割循环
        zones: level.zones.length,
        coverPoints: meta.coverPoints.length,
        playerTuneFields: playerKit.stats().tuneFields,
        maxAlive: MAX_ALIVE,
      };
    },
  };
  return game;
};

/**
 * runAutoBattle — `?auto=<seconds>` 的确定性自动战斗采样（harness/gates/gameplay.mjs 协议）。
 * 采样器用 combat-kit.autoBattle 本体（sampleAttackers=令牌池实测、audioMeter=audio-kit 离线表），
 * tick 就是活局同一个 game.update(1/60)——报告字段 maxConcurrentAttackers/alerts/fires/shots/
 * impacts/peak/clipCount/rms 全部 kit 自报；hash 供门禁做双局确定性比对。
 */
H2B.runAutoBattle = function runAutoBattle({ game, audio, seconds = 10, fixedDt = 1 / 60 }) {
  const kit = game.combat;
  const result = kit.autoBattle(seconds, {
    fixedDt,
    tick: (dt) => { game.update(dt); if (audio) audio.update(dt); },  // 音频帧同步推进，峰值表反映真实战斗混音
    sampleAttackers: () => kit.tokens.active(),
    audioMeter: audio ? { sample: () => audio.kit.sample() } : null,
  });
  return {
    ...result,
    maxTokens: kit.TUNE.maxTokens,
    soundSpecs: typeof AudioKit !== "undefined" && AudioKit.AUDIO_SPECS ? AudioKit.AUDIO_SPECS.length : 0,
    bands: audio ? audio.kit.bands().length : 0,
    hash: [result.alerts, result.fires, result.shots, result.impacts, result.maxConcurrentAttackers].join("|"),
  };
};
