/**
 * combat-kit.mjs — 战斗导演：攻击令牌 / 状态机 / 听觉传播 / 任务状态袋 / 自动战斗采样。
 *
 * 出处：
 *   - 射线命中 + 弱点 ×2.2 + impact 事件：[src:pretty:L52511-L52511]
 *   - 感知与令牌参数（sightRange 45 / hearRadius 45 / maxTokens 2 / tokenGap 1.25）：
 *     [src:pretty:L57426-L57434]
 *   - 任务状态袋（事件驱动增援）：.distill/understanding/07-gameplay-systems.md [src:L6202-L6202]
 *
 * 纯 JS、零引擎依赖、可 node 自测；确定性：rng 注入，kit 内零 Math.random（铁律 #5）。
 */

export const COMBAT_TUNE_DEFAULTS = {
  sightRange: 45,
  sightCone: 200,
  loseSight: 4,
  searchTime: 8,
  hearRadius: 45,
  maxTokens: 2,
  maxTokensCrowd: 3,
  tokenGap: 1.25,
  exposureUp: 0.1,
  exposureDown: 0.45,
};

export function createCombatKit({ physics, events = { on() {}, emit() {} }, rng = Math.random, tune = {} } = {}) {
  if (!physics) throw new Error("combat-kit requires physics (physics-kit instance or compatible)");
  const TUNE = { ...COMBAT_TUNE_DEFAULTS, ...tune };
  const stats = { alerts: 0, fires: 0, shots: 0, impacts: 0 };

  /* ---- 攻击令牌池：同时开火上限 ---- */
  let tokenSeq = 0;
  let tokenActive = 0;
  const tokens = {
    limit: TUNE.maxTokens,
    active: () => tokenActive,
    acquire() {
      if (tokenActive >= tokens.limit) return null;
      tokenActive += 1;
      tokenSeq += 1;
      return { id: tokenSeq };
    },
    release(token) {
      if (token && token.released !== true) {
        token.released = true;
        tokenActive = Math.max(0, tokenActive - 1);
      }
    },
  };

  /* ---- 敌人注册与状态机 ---- */
  const agents = [];
  function createAgent({ pos = { x: 0, y: 0, z: 0 }, eye = null, fwd = { x: 0, z: 1 }, home = null, passive = false } = {}) {
    const agent = {
      pos,
      eye: eye || { x: pos.x, y: pos.y + 1, z: pos.z },
      fwd: { ...fwd },
      home: home || { x: pos.x, z: pos.z },
      passive: !!passive,
      mode: "patrol",
      seeT: 0,
      noSeeT: 0,
      senseT: 0,
      exposure: 0,
      modeT: 0,
      lastKnown: { x: pos.x, y: 0, z: pos.z },
      token: null,
    };
    agents.push(agent);
    return agent;
  }

  function losCheck(agent, target) {
    const eye = agent.customEye || { x: agent.pos.x, y: agent.pos.y + 1, z: agent.pos.z };
    const dx = target.x - eye.x;
    const dz = target.z - eye.z;
    const flat = Math.hypot(dx, dz) || 1e-4;
    const dist = Math.hypot(dx, target.y - eye.y, dz);
    if (dist > TUNE.sightRange) return false;
    const dot = (dx * agent.fwd.x + dz * agent.fwd.z) / flat;
    const cone = Math.cos(((TUNE.sightCone / 2) * Math.PI) / 180);
    if (!(agent.mode === "engage" || dot > cone || dist < 3.5)) return false;
    return physics.lineOfSight(eye, target);
  }

  function updatePerception(agent, target, dt) {
    const targetPos = target && target.pos ? target.pos : target;
    const seen = !agent.passive && target && target.alive !== false && losCheck(agent, targetPos);
    if (seen) {
      agent.seeT += dt;
      agent.noSeeT = 0;
      agent.lastKnown = { x: targetPos.x, y: targetPos.y, z: targetPos.z };
      agent.exposure = Math.min(1, agent.exposure + dt * TUNE.exposureUp);
    } else {
      agent.noSeeT += dt;
      agent.seeT = Math.max(0, agent.seeT - dt * 0.6);
      agent.exposure = Math.max(0, agent.exposure - dt * TUNE.exposureDown);
    }
    if (agent.mode === "engage") {
      if (agent.noSeeT > TUNE.loseSight || (target && target.alive === false)) {
        agent.mode = "search";
        agent.modeT = TUNE.searchTime + rng() * 3;
        if (agent.token) { tokens.release(agent.token); agent.token = null; }
      }
    } else if (seen && agent.seeT > (agent.mode === "patrol" ? 0.8 : 0.36)) {
      agent.mode = "engage";
      agent.noSeeT = 0;
      events.emit("enemy:alert", { agent, seen: true });
      stats.alerts += 1;
      rally(agent.pos, 18, targetPos);
    } else if (agent.mode !== "patrol") {
      agent.modeT -= dt;
      if (agent.modeT <= 0) {
        agent.mode = "patrol";
        agent.home = { x: agent.pos.x, z: agent.pos.z };
      }
    }
    return agent.mode;
  }

  function releaseToken(agent) {
    if (agent.token) { tokens.release(agent.token); agent.token = null; }
  }

  function rally(pos, radius, target, except = null) {
    for (const agent of agents) {
      if (agent === except || agent.passive || agent.mode === "engage") continue;
      const d = Math.hypot(agent.pos.x - pos.x, agent.pos.z - pos.z);
      if (d > radius) continue;
      agent.lastKnown = { x: target.x, y: target.y || 0, z: target.z };
      agent.mode = "investigate";
      agent.modeT = 9 + rng() * 4;
    }
  }

  function provoke(agent, playerPos) {
    if (agent.passive || agent.mode === "engage") return;
    agent.lastKnown = { x: playerPos.x, y: playerPos.y, z: playerPos.z };
    agent.mode = "investigate";
    agent.modeT = 10;
    agent.seeT = 1;
    agent.senseT = 0;
    rally(agent.pos, 20, playerPos, agent);
  }

  function alert(pos, radius = TUNE.hearRadius) {
    for (const agent of agents) {
      if (agent.passive || agent.mode === "engage") continue;
      const d = Math.hypot(agent.pos.x - pos.x, agent.pos.z - pos.z);
      if (d > radius) continue;
      agent.lastKnown = { x: pos.x, y: Math.max(0, (pos.y || 0) - 1.6), z: pos.z };
      if (agent.mode === "patrol") events.emit("enemy:alert", { agent, noise: true });
      agent.mode = "investigate";
      agent.modeT = 9 + rng() * 4;
      stats.alerts += 1;
    }
  }

  /* ---- 弹道池 ---- */
  const bolts = Array.from({ length: 32 }, () => ({ on: false, life: 0, pos: null, dir: null, from: null, len: 0 }));
  function fireBolt(pos, dir, { speed = 90, life = 1.3 } = {}) {
    const bolt = bolts.find((b) => !b.on) || null;
    if (!bolt) return null;
    bolt.on = true;
    bolt.life = life;
    bolt.pos = { ...pos };
    bolt.dir = { ...dir };
    bolt.from = { ...pos };
    bolt.len = 0;
    bolt.speed = speed;
    stats.fires += 1;
    events.emit("enemy:fire", { pos: { ...pos }, dir: { ...dir } });
    return bolt;
  }
  function updateBolts(dt) {
    for (const bolt of bolts) {
      if (!bolt.on) continue;
      const step = bolt.speed * dt;
      const hit = physics.raycast(bolt.pos, bolt.dir, step + 0.2);
      bolt.len += step;
      bolt.pos = {
        x: bolt.pos.x + bolt.dir.x * step,
        y: bolt.pos.y + bolt.dir.y * step,
        z: bolt.pos.z + bolt.dir.z * step,
      };
      if (hit || bolt.len > 300) { bolt.on = false; events.emit("impact", { point: bolt.pos, surface: hit ? hit.surface : "air" }); }
    }
  }

  /* ---- 射击调度（弱点 ×2.2 + impact 事件，合同同源） ---- */
  function playerShot(origin, dir, { damage = 28, range = 300, enemyRaycast = null } = {}) {
    stats.shots += 1;
    const wall = physics.raycast(origin, dir, range);
    const maxDist = wall ? wall.dist : range;
    const enemyHit = enemyRaycast ? enemyRaycast(origin, dir, maxDist) : null;
    if (enemyHit) {
      const mult = enemyHit.part === "weak" ? 2.2 : 1;
      const killed = enemyHit.enemy && typeof enemyHit.enemy.damage === "function"
        ? enemyHit.enemy.damage(damage * mult, enemyHit.point, dir, enemyHit.part) === true
        : false;
      stats.impacts += 1;
      events.emit("player:hitEnemy", { enemy: enemyHit.enemy, part: enemyHit.part, killed, weak: enemyHit.part === "weak" });
      return { ...enemyHit, killed, surface: "enemy" };
    }
    if (wall) {
      stats.impacts += 1;
      events.emit("impact", { point: wall.point, surface: wall.surface, dist: wall.dist });
      return wall;
    }
    return null;
  }

  function enemyShot(origin, dir, { damage = 6, range = 200, player = null } = {}) {
    const wall = physics.raycast(origin, dir, range);
    const maxDist = wall ? wall.dist : range;
    if (player && player.alive !== false) {
      const aim = { x: player.pos.x - origin.x, y: player.pos.y + 1 - origin.y, z: player.pos.z - origin.z };
      const along = aim.x * dir.x + aim.y * dir.y + aim.z * dir.z;
      if (along > 0 && along < maxDist) {
        events.emit("player:damaged", { damage, from: { ...origin } });
        return { hit: true, point: { x: origin.x + dir.x * along, y: origin.y + dir.y * along, z: origin.z + dir.z * along } };
      }
    }
    return wall ? { hit: false, point: wall.point, surface: wall.surface } : null;
  }

  /* ---- 任务状态袋（事件驱动增援） ---- */
  const mission = {
    cut: 0,
    allCut: 0,
    queue: 0,
    waveHot: false,
    alertT: 0,
    pursuitT: 0,
    cutRelay() {
      mission.cut += 1;
      mission.waveHot = true;
      mission.alertT = 6 + rng() * 4;
      mission.pursuitT = 20 + rng() * 10;
      events.emit("mission:cut", { cut: mission.cut });
      return mission.cut;
    },
    update(dt) {
      if (mission.alertT > 0) mission.alertT = Math.max(0, mission.alertT - dt);
      if (mission.pursuitT > 0) mission.pursuitT = Math.max(0, mission.pursuitT - dt);
      if (mission.alertT === 0) mission.waveHot = false;
    },
  };

  /* ---- 自动战斗采样（门禁与声音自检的数据源） ---- */
  function autoBattle(seconds, { tick, sampleAttackers = null, audioMeter = null, fixedDt = 1 / 60 } = {}) {
    if (typeof tick !== "function") throw new Error("autoBattle requires tick(dt)");
    const statsBefore = { ...stats };
    const hz = audioMeter && typeof audioMeter.sample === "function" ? audioMeter : null;
    let maxConcurrentAttackers = 0;
    let peak = 0;
    let clipCount = 0;
    let rmsAcc = 0;
    let rmsN = 0;
    const steps = Math.round(seconds / fixedDt);
    const sampleEvery = Math.max(1, Math.round(0.1 / fixedDt));
    for (let i = 0; i < steps; i += 1) {
      tick(fixedDt);
      if (sampleAttackers) {
        const firing = sampleAttackers();
        if (firing > maxConcurrentAttackers) maxConcurrentAttackers = firing;
      }
      if (hz && i % 2 === 0) {
        const data = hz.sample();
        for (let j = 0; j < data.length; j += 1) {
          const v = Math.abs(data[j]);
          if (v > peak) peak = v;
          if (v >= 0.99) clipCount += 1;
          rmsAcc += data[j] * data[j];
          rmsN += 1;
        }
      }
    }
    const rms = rmsN ? Math.sqrt(rmsAcc / rmsN) : 0;
    return {
      seconds,
      maxConcurrentAttackers,
      samples: sampleAttackers ? Math.floor(steps / sampleEvery) : 0,
      alerts: stats.alerts - statsBefore.alerts,
      fires: stats.fires - statsBefore.fires,
      shots: stats.shots - statsBefore.shots,
      impacts: stats.impacts - statsBefore.impacts,
      peak,
      clipCount,
      rms,
    };
  }

  return {
    TUNE,
    tokens,
    agents,
    createAgent,
    updatePerception,
    releaseToken,
    rally,
    provoke,
    alert,
    bolts,
    fireBolt,
    updateBolts,
    playerShot,
    enemyShot,
    mission,
    stats,
    autoBattle,
  };
}
