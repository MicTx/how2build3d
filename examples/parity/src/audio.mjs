/**
 * audio.mjs — 合成音频（装配顺序 #11）：assets/audio-kit.mjs 接线。
 * 离线混音器即计量真源（无 AudioContext 依赖，headless 零音频设备可跑）；
 * kit 事件 → 58 条规格表的播放名映射；stats() 全部工厂自报。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.createAudio = function createAudio({ events, rng }) {
  const kit = AudioKit.createAudioKit({ rng });
  const play = (name, opts) => { try { kit.play(name, opts); } catch (e) { /* 规格表外名字忽略 */ } };

  events.on("weapon:fire", () => play("shot"));
  events.on("weapon:dry", () => play("dry-fire"));
  events.on("weapon:reload", (e) => play(e && e.phase === "end" ? "reload-end" : "reload-start"));
  events.on("enemy:fire", () => play("enemy-bolt"));
  events.on("impact", (e) => {
    const s = (e && e.surface) || "";
    play(/metal/.test(s) ? "impact-metal" : /water/.test(s) ? "impact-water" : "impact-concrete");
  });
  events.on("player:step", (e) => {
    const s = (e && e.surface) || "";
    play(/metal/.test(s) ? "foot-metal" : /indoor/.test(s) ? "foot-metal" : "foot-concrete");
  });
  events.on("player:land", () => play("land"));
  events.on("player:jump", () => play("jump"));
  events.on("player:hitEnemy", (e) => play(e && e.killed ? "hitmarker" : "impact-body"));
  events.on("thunder", () => play("thunder"));
  events.on("mission:cut", () => play("objective"));
  events.on("mission:brief", () => play("objective"));

  return {
    kit,
    update(dt) { kit.update(dt); },
    setIntensity(v) { kit.setIntensity(Math.max(0, Math.min(1, v))); },
    stats: () => kit.stats(),
  };
};
