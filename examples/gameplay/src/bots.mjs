/**
 * gameplay/src/bots.mjs — 训练用悬浮 bot：combat-kit 状态机 + 令牌化开火 + 胶囊移动。
 * 参考四足步态方法论见 references/09（本样例按最小实现）。
 */
globalThis.H2B = globalThis.H2B || {};

function norm3(x, y, z) {
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}

H2B.createBots = function createBots(THREE, { scene, kit, spawns, player, rng }) {
  const bots = [];
  const bodyGeo = new THREE.CapsuleGeometry(0.35, 0.9, 6, 12);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x5c6b78, roughness: 0.6, metalness: 0.35 });
  const eyeGeo = new THREE.SphereGeometry(0.12, 12, 8);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0xff8820, emissiveIntensity: 2 });

  spawns.forEach((spawn, index) => {
    const agent = kit.createAgent({ pos: { ...spawn.pos }, fwd: { x: 0, z: 1 } });
    const group = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.castShadow = true;
    group.add(body);
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(0, 0.45, 0.3);
    group.add(eye);
    scene.add(group);
    const bot = {
      index,
      agent,
      group,
      alive: true,
      hp: 100,
      pos: agent.pos,
      vel: { x: 0, y: 0, z: 0 },
      cooldown: 1 + rng() * 0.6,
      firingWindow: 0,
      wanderT: rng() * 3,
      wander: null,
      damage(dmg) {
        this.hp -= dmg;
        if (this.hp <= 0 && this.alive) {
          this.alive = false;
          kit.releaseToken(this.agent);
          const at = kit.agents.indexOf(this.agent);
          if (at >= 0) kit.agents.splice(at, 1);
          this.group.visible = false;
          return true;
        }
        return false;
      },
    };
    agent.bot = bot;
    bots.push(bot);
  });
  return bots;
};

H2B.stepBots = function stepBots({ kit, physics, nav, player, rng, frozen }, bots, dt) {
  for (const bot of bots) {
    if (!bot.alive) continue;
    const agent = bot.agent;
    if (frozen) {
      bot.group.position.set(bot.pos.x, bot.pos.y + 1.1, bot.pos.z);
      continue;
    }
    const fwd = { x: player.pos.x - bot.pos.x, z: player.pos.z - bot.pos.z };
    const fwdLen = Math.hypot(fwd.x, fwd.z) || 1;
    agent.fwd = { x: fwd.x / fwdLen, z: fwd.z / fwdLen };
    const mode = kit.updatePerception(agent, { pos: player.pos, alive: player.alive }, dt);

    bot.firingWindow = Math.max(0, bot.firingWindow - dt);
    if (mode === "engage") {
      if (!agent.token) agent.token = kit.tokens.acquire();
      if (agent.token) {
        bot.cooldown -= dt;
        if (bot.cooldown <= 0) {
          bot.cooldown = kit.TUNE.tokenGap + 0.4 + rng() * 0.6;
          const eye = { x: bot.pos.x, y: bot.pos.y + 1.2, z: bot.pos.z };
          const dir = norm3(player.pos.x - eye.x, player.pos.y + 1 - eye.y, player.pos.z - eye.z);
          kit.fireBolt(eye, dir);
          bot.firingWindow = 0.5;
        }
      }
    } else if (agent.token) {
      kit.releaseToken(agent);
    }

    // 移动：engage 原地压制；investigate 走 lastKnown；patrol 家附近游走
    let vel = { x: 0, y: 0, z: 0 };
    if (mode === "investigate") {
      const path = nav.findPath(bot.pos, agent.lastKnown);
      const goal = path && path.length ? path[0] : agent.lastKnown;
      const dx = goal.x - bot.pos.x, dz = goal.z - bot.pos.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.5) vel = { x: (dx / len) * 2.2, y: 0, z: (dz / len) * 2.2 };
    } else if (mode === "patrol") {
      bot.wanderT -= dt;
      if (bot.wanderT <= 0 || !bot.wander) {
        bot.wander = nav.randomPoint(agent.home, 8);
        bot.wanderT = 2.5 + rng() * 2;
      }
      const dx = bot.wander.x - bot.pos.x, dz = bot.wander.z - bot.pos.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.6) vel = { x: (dx / len) * 1.2, y: 0, z: (dz / len) * 1.2 };
    }
    physics.moveCapsule(bot.pos, vel, dt);
    bot.group.position.set(bot.pos.x, bot.pos.y + 1.1, bot.pos.z);
    bot.group.rotation.y = Math.atan2(agent.fwd.x, agent.fwd.z);
  }
};
