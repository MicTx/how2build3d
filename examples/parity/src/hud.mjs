/**
 * hud.mjs — HUD 层（装配顺序 #12）：assets/hud-kit.mjs 接线。
 * token 是唯一色值来源；每帧 update(dt) 一次；低频写（0.15s）血量/弹药/目标；
 * kit 事件直驱 hitmarker / feed / message。所有 kit 调用防御式包装（签名漂移不炸 boot）。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.createHud = function createHud({ events, rng, game }) {
  const kit = HudKit.createHudKit({ doc: document, mount: document.body, events, rng });
  const guard = (fn) => { try { fn(); } catch (e) { /* HUD 组件签名漂移不致命 */ } };

  guard(() => kit.setObjective("切断三台中继 → 码头撤离"));
  guard(() => kit.message("雨后黄昏 · 盐线堆场 7 号", { hold: 2.5 }));

  events.on("mission:msg", (e) => guard(() => kit.message(e.text, { hold: 2.2 })));
  events.on("mission:brief", (s) => guard(() => kit.message(
    "简报：用时 " + s.time.toFixed(0) + "s · 击杀 " + s.kills + " · 命中 " + s.impacts + " · 戒备 " + s.alerts,
    { hold: 6 }
  )));
  events.on("player:hitEnemy", (e) => guard(() => kit.hitmarker(e && e.weak ? "weak" : e && e.killed ? "kill" : "hit")));
  events.on("mission:cut", () => guard(() => kit.setRelays(
    game.objectives.filter((o) => o.done).length, game.objectives.length
  )));

  let hudT = 0;
  let lastHealth = 1;
  function tick(dt) {
    hudT += dt;
    if (hudT < 0.15) return;
    hudT = 0;
    const p = game.playerKit.player;
    if (p.health < lastHealth) guard(() => kit.damageArc(0));
    lastHealth = p.health;
    guard(() => kit.setHealth(p.health, 100));
    const w = game.weapon.stats();
    guard(() => kit.setWeapon({ ammo: w.ammo, mag: w.magSize, reserve: w.reserve, state: w.state }));
    guard(() => kit.setPlayer({ x: p.pos.x, z: p.pos.z, yaw: p.viewYaw }));
    const done = game.objectives.filter((o) => o.done).length;
    guard(() => kit.setRelays(done, game.objectives.length));
    const next = game.objectives.find((o) => !o.done);
    guard(() => kit.setObjective(next ? next.label : "中继全断 → 码头快艇撤离"));
  }

  return {
    kit,
    tick,
    update(dt) { guard(() => kit.update(dt)); },
    stats: () => kit.stats(),
  };
};
