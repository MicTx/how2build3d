/**
 * bots.mjs — 敌人：先接 combat-kit 的状态机与令牌，再把外观换成 enemy-kit 的骨骼。
 * TODO(S7)：替换成 assets/enemy-kit.mjs 的 rig（骨骼表 + 2 骨 IK + 步态）；
 *           感知/令牌不要重写，用 kit.createAgent / kit.updatePerception。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.createBots = function createBots(THREE, { scene, kit, spawns, player, rng }) {
  const bots = [];
  for (let i = 0; i < spawns.length; i += 1) {
    const spawn = spawns[i];
    const mesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.34, 1.0, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0x9aa4ae, roughness: 0.7 })
    );
    mesh.position.set(spawn.pos.x, 0.9, spawn.pos.z);
    mesh.castShadow = true;
    scene.add(mesh);
    const agent = kit.createAgent({ id: "bot-" + i, type: "hound", pos: { ...spawn.pos }, hp: 60 });
    bots.push({ mesh, agent, alive: true, type: "hound", pos: { ...spawn.pos } });
  }
  return bots;
};

H2B.stepBots = function stepBots({ kit, physics, nav, player, rng, frozen }, bots, dt) {
  if (frozen) return;
  for (const bot of bots) {
    if (!bot.alive) continue;
    // combat-kit 的 updatePerception 是「单 agent + 目标」，不是数组
    kit.updatePerception(bot.agent, player, dt);
    bot.pos.x = bot.agent.pos.x;
    bot.pos.z = bot.agent.pos.z;
    bot.mesh.position.set(bot.pos.x, 0.9, bot.pos.z);
  }
};
