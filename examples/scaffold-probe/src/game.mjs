/**
 * game.mjs — 玩法装配：physics-kit + level-kit + combat-kit + bots。
 * 三个 kit 的职责边界见 references/10-gameplay-chain.md；不要在这里重写 AI/令牌。
 * TODO(S7)：把 layout 换成真实四区；把 bots 换成 assets/enemy-kit.mjs 的骨骼 rig；
 *           接玩家控制器（assets/player-kit.mjs）与武器（assets/weapon-kit.mjs）。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.initGameplay = function initGameplay({ THREE, scene, world, rng, player }) {
  const physics = PhysicsKit.createPhysicsKit({
    bounds: world.bounds,
    region: { x: world.bounds.maxX - world.bounds.minX, z: world.bounds.maxZ - world.bounds.minZ },
    groundSurfaceAt: () => "concrete",
    rng,
  });
  const materials = {
    crate: new THREE.MeshStandardMaterial({ color: 0xc09055, roughness: 0.85 }),
    barrier: new THREE.MeshStandardMaterial({ color: 0xd8dce0, roughness: 0.45, metalness: 0.6 }),
    container: new THREE.MeshStandardMaterial({ color: 0xb04a38, roughness: 0.7, metalness: 0.25 }),
  };
  const level = LevelKit.createLevelKit(THREE, { catalog: H2B.CATALOG, layout: H2B.LAYOUT, physics, materials });
  scene.add(level.group);
  physics.build();

  const events = { log: [], on() {}, emit(type, payload) { this.log.push({ type, payload }); if (this.log.length > 200) this.log.shift(); } };
  const kit = CombatKit.createCombatKit({ physics, events, rng });
  const bots = H2B.createBots(THREE, { scene, kit, spawns: level.enemySpawns, player, rng });

  return {
    physics, level, kit, bots, events,
    update(dt) {
      H2B.stepBots({ kit, physics, nav: physics.nav, player, rng, frozen: false }, bots, dt);
    },
    counts() {
      return {
        enemyTypes: new Set(bots.map((b) => b.type)).size,
        enemySpawns: (level.enemySpawns || []).length,
        coverPoints: (level.coverPoints || []).length,
        zones: (level.zones || []).length,
        objectives: (level.objectives || []).length,
      };
    },
  };
};
