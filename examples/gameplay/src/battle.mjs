/**
 * gameplay/src/battle.mjs — 自动战斗编排：脚本化玩家 + 采样报告 + 确定性 hash。
 * 门禁消费 window.__BATTLE_REPORT（harness/gates/gameplay.mjs）。
 */
globalThis.H2B = globalThis.H2B || {};

function norm3(x, y, z) {
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}

H2B.botRaycast = function botRaycast(bots, origin, dir, maxDist) {
  let best = null;
  for (const bot of bots) {
    if (!bot.alive) continue;
    const center = { x: bot.pos.x, y: bot.pos.y + 1.1, z: bot.pos.z };
    const along = (center.x - origin.x) * dir.x + (center.y - origin.y) * dir.y + (center.z - origin.z) * dir.z;
    if (along <= 0 || along > maxDist) continue;
    const px = origin.x + dir.x * along;
    const py = origin.y + dir.y * along;
    const pz = origin.z + dir.z * along;
    const miss = Math.hypot(px - center.x, py - center.y, pz - center.z);
    if (miss > 0.6) continue;
    if (!best || along < best.dist) {
      best = { dist: along, point: { x: px, y: py, z: pz }, enemy: bot, part: miss < 0.25 ? "weak" : "body" };
    }
  }
  return best;
};

H2B.runAutoBattle = function runAutoBattle({ kit, physics, nav, bots, player, rng, events, seconds }) {
  const state = { t: 0, nextShot: 1.0 };
  const report = kit.autoBattle(seconds, {
    tick(dt) {
      state.t += dt;
      // 玩家脚本：走到场地中段北侧（保持对 bot 的视线），每 1.5s 朝最近 bot 开一枪
      const dx = 0 - player.pos.x;
      const dz = 10.5 - player.pos.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.6) { player.vel.x = (dx / len) * 2.0; player.vel.z = (dz / len) * 2.0; }
      else { player.vel.x = 0; player.vel.z = 0; }
      physics.moveCapsule(player.pos, player.vel, dt);
      if (state.t >= state.nextShot) {
        state.nextShot += 1.5;
        let best = null;
        for (const bot of bots) {
          if (!bot.alive) continue;
          const eye = { x: player.pos.x, y: player.pos.y + 1.4, z: player.pos.z };
          const aim = { x: bot.pos.x - eye.x, y: bot.pos.y + 1.1 - eye.y, z: bot.pos.z - eye.z };
          const dist = Math.hypot(aim.x, aim.y, aim.z);
          if (!best || dist < best.dist) best = { dist, eye, aim };
        }
        if (best) {
          kit.playerShot(best.eye, norm3(best.aim.x, best.aim.y, best.aim.z), {
            damage: 30,
            enemyRaycast: (origin, sdir, maxDist) => H2B.botRaycast(bots, origin, sdir, maxDist),
          });
        }
        kit.alert(player.pos, kit.TUNE.hearRadius);
        events.emit("weapon:fire", { origin: { ...player.pos } });
      }
      kit.mission.update(dt);
      H2B.stepBots({ kit, physics, nav, player, rng, frozen: false }, bots, dt);
    },
    sampleAttackers: () => bots.filter((bot) => bot.alive && bot.firingWindow > 0).length,
  });
  const hash = JSON.stringify({
    a: kit.stats.alerts,
    f: kit.stats.fires,
    s: kit.stats.shots,
    i: kit.stats.impacts,
    m: [kit.mission.cut, kit.mission.waveHot ? 1 : 0],
    bots: bots.map((bot) => [bot.alive ? 1 : 0, bot.agent.mode, Math.round(bot.pos.x * 100), Math.round(bot.pos.z * 100)]),
  });
  return { ...report, hash };
};
