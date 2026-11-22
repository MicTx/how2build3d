/**
 * hud-kit.mjs — HUD 与 UI 设计系统：设计 token 层 + 10 个组件
 * （罗盘带 / 目标面板 / 生命 / 弹药 / 准星 / 命中标记 / 伤害弧 / 交互环 / 事件流 / 中央消息）。
 *
 * 出处：
 *   - 设计 token（ink/bone/signal/alarm/steel、字体三档、safe-area、gutter、text-shadow）：
 *     sources/jimao-3a-game/index.html:11-20 [src:L11-L20]
 *   - HUD 样式分区（罗盘/目标/准星/命中/弧/交互环/事件流/消息/生命/弹药）：[src:L44-L210]
 *   - 罗盘常量 -90..450、步长 5°、4px·deg⁻¹、卡片每 45°、数字每 15°、目标标记 bearing：
 *     [src:pretty:L57910-L57960] [src:pretty:L58196-L58260]
 *   - 命中标记三态 hit / weak / kill：[src:pretty:L58056-L58060] [src:pretty:L58173-L58190]
 *   - 准星随散布（spread/fov 投影 + 冲刺 +10px）、弹匣 pip、血量 10 段：
 *     [src:pretty:L58256-L58290]
 *   - 4 向伤害弧 SVG 池 / 交互环 2π·19 / 事件流 4 条 / 中央消息：
 *     [src:pretty:L57961-L57990]
 *
 * 依赖注入：document / mount / events / tokens / strings 全部参数注入，无顶层 DOM 访问、零引擎依赖；
 * rng 保留注入位（HUD 行为全确定性，不消耗随机数），kit 内零 Math.random。
 * 热循环（update）内不分配对象/数组；DOM 写入按「值变化」门控。
 *
 * 用法：
 *   const hud = createHudKit({ doc: document, mount: document.getElementById("ui"), events });
 *   hud.show(true);
 *   hud.setPlayer({ pos: { x: -32, z: 6 }, yaw: 0, health: 100, maxHealth: 100 });
 *   hud.setWeapon({ ammo: 30, magSize: 30, reserve: 120, name: "PAC-9", spread: 0.012, fov: 54 });
 *   hud.setObjective("切断三处中继");
 *   hud.setRelays(0, 3);
 *   hud.setMarkers([{ pos: relayA.pos, kind: "relay", short: "A" }]);
 *   hud.update(dt);
 *   hud.stats(); // { hudComponents, hudTokens, compassTicks, ... }
 */

/** 罗盘带规格：上游 nx=-90 / WC=450 / tx=4 / 5° 一格。 */
export const HUD_COMPASS = Object.freeze({
  minDeg: -90,
  maxDeg: 450,
  stepDeg: 5,
  pxPerDeg: 4,
  cardinals: Object.freeze({
    0: "北",
    45: "东北",
    90: "东",
    135: "东南",
    180: "南",
    225: "西南",
    270: "西",
    315: "西北",
  }),
});

/** 设计 token 层（≥6；每项落到 .sl-hud 的 --hud-* 自定义属性，组件只读 var()，不硬编码色值）。 */
export const HUD_TOKENS = Object.freeze({
  ink: "#0b0d0f",
  ink2: "#14181b",
  bone: "#e8e4da",
  boneDim: "rgba(232,228,218,.64)",
  boneFaint: "rgba(232,228,218,.24)",
  boneStrong: "rgba(232,228,218,.82)",
  shade: "rgba(0,0,0,.6)",
  shadeSoft: "rgba(0,0,0,.35)",
  plateInset: "rgba(11,13,15,.5)",
  signal: "#ffb347",
  signalHot: "#ffc977",
  rust: "#d2622a",
  steel: "#8d9aa3",
  alarm: "#ff5a40",
  line: "rgba(232,228,218,.2)",
  plate: "rgba(11,13,15,.6)",
  plateSolid: "rgba(11,13,15,.9)",
  fontDisplay: "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif",
  fontLabel: "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', system-ui, sans-serif",
  fontMono: "'PingFang SC', 'Microsoft YaHei', ui-monospace, monospace",
  safeTop: "env(safe-area-inset-top, 0px)",
  safeBottom: "env(safe-area-inset-bottom, 0px)",
  safeLeft: "env(safe-area-inset-left, 0px)",
  safeRight: "env(safe-area-inset-right, 0px)",
  gutterX: "max(16px, env(safe-area-inset-left, 0px))",
  shadow: "0 0 2px rgba(0,0,0,.75), 0 1px 5px rgba(0,0,0,.55)",
});

/** 组件清单（构建后逐件登记，stats().hudComponents 取实际登记数）。 */
export const HUD_COMPONENTS = Object.freeze([
  "compass",
  "objective",
  "health",
  "ammo",
  "crosshair",
  "hitmarker",
  "damageArcs",
  "prompt",
  "feed",
  "message",
]);

const HP_SEGMENTS = 10;
const ARC_POOL = 4;
const FEED_POOL = 4;
const RING_R = 19;
const RING_LEN = 2 * Math.PI * RING_R;
const CROSS_BAR_RELOAD_HIDDEN = "reloading_hidden";

/* ---- 热循环字符串表：全部构建期生成，update() 内只做查表/数值比较 ---- */
const ARC_ROT = new Array(361);
for (let d = -180; d <= 180; d += 1) ARC_ROT[d + 180] = `translate(-50%,-50%) rotate(${d}deg)`;
const HEADING_TEXT = new Array(360);
for (let d = 0; d < 360; d += 1) HEADING_TEXT[d] = String(d).padStart(3, "0");
const DIST_TEXT = new Array(2001);
for (let d = 0; d <= 2000; d += 1) DIST_TEXT[d] = `${d}米`;
const OPACITY_TEXT = new Array(21);
for (let i = 0; i <= 20; i += 1) OPACITY_TEXT[i] = String(i / 20);
const CROSS_XFORMS = [];
for (let i = 0; i <= 132; i += 1) {
  const g = i / 2 + 4; // gap 4..70，步长 0.5（上游同样 0.5px 量化）
  CROSS_XFORMS.push({
    t: `translate3d(-50%,${-g}px,0) translateY(-100%)`,
    b: `translate3d(-50%,${g}px,0)`,
    l: `translate3d(${-g}px,-50%,0) translateX(-100%)`,
    r: `translate3d(${g}px,-50%,0)`,
  });
}
const ENEMY_NAMES = Object.freeze({ gull: "机械飞鸥", hound: "机械猎犬" });
const DEFAULT_STRINGS = Object.freeze({
  objective: "任务目标",
  relay: "中继",
  health: "生命状态",
  promptKey: "E",
  destroyed: "已摧毁",
});
const HIT_STATES = Object.freeze(["hit", "weak", "kill"]);

/** 完整样式表；注入一次（<style data-sl-hud>），颜色/字体/间距全部走 token。 */
export const HUD_CSS = `
.sl-hud{position:absolute;inset:0;pointer-events:none;overflow:hidden;color:var(--hud-bone);font-family:var(--hud-font-label);text-shadow:var(--hud-shadow);opacity:0;transition:opacity .35s ease}
.sl-hud.on{opacity:1}
.sl-hud .h-k{font:600 11px/1 var(--hud-font-label);letter-spacing:.26em;text-transform:uppercase;color:var(--hud-bone-dim)}

/* compass */
.sl-hud .h-compass{position:absolute;top:calc(12px + var(--hud-safe-top));left:50%;width:min(420px,calc(100vw - var(--hud-gutter-x) - var(--hud-gutter-x) - 8px));height:60px;transform:translateX(-50%)}
.sl-hud .h-tape-wrap{position:absolute;left:0;right:0;top:0;height:28px;overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent,#000 16%,#000 84%,transparent);mask-image:linear-gradient(90deg,transparent,#000 16%,#000 84%,transparent)}
.sl-hud .h-tape{position:absolute;left:0;top:0;height:100%;width:2168px;will-change:transform}
.sl-hud .h-tape i{position:absolute;bottom:0;width:1px;margin-left:-.5px;background:var(--hud-bone);box-shadow:0 0 2px var(--hud-shade)}
.sl-hud .h-tape i.mn{height:4px;opacity:.45}
.sl-hud .h-tape i.md{height:7px;opacity:.8}
.sl-hud .h-tape i.mj{height:10px;width:2px;margin-left:-1px}
.sl-hud .h-tape b{position:absolute;top:0;transform:translateX(-50%);font-weight:400;white-space:nowrap}
.sl-hud .h-tape b.card{font:700 16px/1 var(--hud-font-display);letter-spacing:.04em}
.sl-hud .h-tape b.ic{font:600 11px/1.4 var(--hud-font-label);color:var(--hud-bone-dim);letter-spacing:.08em}
.sl-hud .h-tape b.num{font:400 9px/1.7 var(--hud-font-mono);color:var(--hud-bone-dim)}
.sl-hud .h-needle{position:absolute;left:50%;top:14px;width:2px;height:16px;margin-left:-1px;background:var(--hud-signal);box-shadow:0 0 0 1px var(--hud-shade-soft)}
.sl-hud .h-heading{position:absolute;left:100%;top:9px;margin-left:6px;font:500 11px/1 var(--hud-font-mono);color:var(--hud-bone-dim);letter-spacing:.06em}
.sl-hud .h-cmarks{position:absolute;left:50%;top:33px;width:0;height:0}
.sl-hud .h-cm{position:absolute;left:-24px;top:0;width:48px;text-align:center;will-change:transform;color:var(--hud-signal)}
.sl-hud .h-cm i{display:block;width:8px;height:8px;margin:0 auto 3px;border:1.5px solid currentColor;transform:rotate(45deg);background:var(--hud-plate-inset)}
.sl-hud .h-cm b{font:700 13px/1 var(--hud-font-display);letter-spacing:.06em;margin-right:4px}
.sl-hud .h-cm span{font:400 10px/1 var(--hud-font-mono);color:var(--hud-bone)}
.sl-hud .h-cm.edge{opacity:.55}
.sl-hud .h-cm.extract{color:var(--hud-bone)}
.sl-hud .h-cm.extract i{background:var(--hud-bone)}

/* objective tracker */
.sl-hud .h-obj{position:absolute;top:calc(16px + var(--hud-safe-top));left:var(--hud-gutter-x);max-width:min(300px,42vw);padding-left:12px;border-left:2px solid var(--hud-signal);opacity:0;transition:opacity .3s}
.sl-hud .h-obj.has{opacity:1}
.sl-hud .h-obj.flash{animation:sl-objflash .9s ease-out}
.sl-hud .h-obj-t{font:600 20px/1.1 var(--hud-font-label);letter-spacing:.05em;text-transform:uppercase;margin:6px 0 9px;min-height:22px}
.sl-hud .h-relays{display:flex;align-items:center;gap:5px;font:600 11px/1 var(--hud-font-label);letter-spacing:.22em;text-transform:uppercase;color:var(--hud-bone-dim)}
.sl-hud .h-relays span{margin-right:4px}
.sl-hud .h-relays i{width:9px;height:9px;border:1.5px solid var(--hud-bone);box-shadow:0 0 2px var(--hud-shade)}
.sl-hud .h-relays i.cut{background:var(--hud-signal);border-color:var(--hud-signal)}
.sl-hud .h-relays b{font:500 11px/1 var(--hud-font-mono);letter-spacing:.04em;color:var(--hud-bone);margin-left:5px}
@keyframes sl-objflash{0%{border-left-color:var(--hud-bone)}100%{border-left-color:var(--hud-signal)}}

/* crosshair + hit marker */
.sl-hud .h-cross{position:absolute;left:50%;top:50%;width:0;height:0;transition:opacity .1s}
.sl-hud .h-cross.off{opacity:0}
.sl-hud .h-cross i{position:absolute;left:0;top:0;background:var(--hud-bone);box-shadow:0 0 0 1px var(--hud-shade-soft);transition:transform .06s linear}
.sl-hud .h-cross .c-t,.sl-hud .h-cross .c-b{width:2px;height:9px;transform:translate3d(-50%,0,0)}
.sl-hud .h-cross .c-l,.sl-hud .h-cross .c-r{width:9px;height:2px;transform:translate3d(0,-50%,0)}
.sl-hud .h-cross .c-dot{width:2px;height:2px;margin:-1px 0 0 -1px;opacity:.85}
.sl-hud .h-hit{position:absolute;left:50%;top:50%;width:30px;height:30px;transform:translate(-50%,-50%);opacity:0}
.sl-hud .h-hit i{position:absolute;width:2px;height:11px;background:#fff;box-shadow:0 0 0 1px var(--hud-shade-soft)}
.sl-hud .h-hit i:nth-child(1){left:3px;top:0;transform:rotate(-45deg)}
.sl-hud .h-hit i:nth-child(2){right:3px;top:0;transform:rotate(45deg)}
.sl-hud .h-hit i:nth-child(3){left:3px;bottom:0;transform:rotate(45deg)}
.sl-hud .h-hit i:nth-child(4){right:3px;bottom:0;transform:rotate(-45deg)}
.sl-hud .h-hit.weak i{background:var(--hud-signal)}
.sl-hud .h-hit.kill i{background:var(--hud-alarm);width:3px}
.sl-hud .h-hit.on{animation:sl-hitmark 240ms ease-out both}
.sl-hud .h-hit.on.weak,.sl-hud .h-hit.on.kill{animation-name:sl-hitmark-big}
.sl-hud .h-hit.on.kill{animation-duration:420ms}
@keyframes sl-hitmark{0%{opacity:1;transform:translate(-50%,-50%) scale(1.15)}35%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-50%) scale(.92)}}
@keyframes sl-hitmark-big{0%{opacity:1;transform:translate(-50%,-50%) scale(1.5)}35%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-50%) scale(.92)}}

/* damage direction (4-slot SVG pool) */
.sl-hud .h-arcs{position:absolute;inset:0}
.sl-hud .h-arc{position:absolute;left:50%;top:50%;width:min(72vh,94vw);aspect-ratio:1;transform:translate(-50%,-50%);opacity:0;will-change:transform,opacity}
.sl-hud .h-arc svg{width:100%;height:100%;display:block;overflow:visible}
.sl-hud .h-arc path{fill:none;stroke:var(--hud-alarm);stroke-width:4;opacity:.9}
.sl-hud .h-arc path.tip{stroke-width:2.5}

/* interaction ring */
.sl-hud .h-prompt{position:absolute;left:50%;top:61%;transform:translateX(-50%);display:flex;align-items:center;gap:12px;opacity:0;transition:opacity .15s;white-space:nowrap}
.sl-hud .h-prompt.on{opacity:1}
.sl-hud .h-prompt svg{width:48px;height:48px;flex:none}
.sl-hud .h-prompt circle{fill:none;stroke-width:3}
.sl-hud .h-prompt .bg{stroke:var(--hud-bone-faint);fill:var(--hud-plate-inset)}
.sl-hud .h-prompt .fg{stroke:var(--hud-signal)}
.sl-hud .h-key{position:absolute;left:0;top:0;width:48px;line-height:48px;text-align:center;font:700 19px/48px var(--hud-font-display);letter-spacing:.04em}
.sl-hud .h-key.wide{font-size:12px;letter-spacing:.1em}
.sl-hud .h-plabel{font:600 16px/1 var(--hud-font-label);letter-spacing:.14em;text-transform:uppercase;padding:7px 10px 6px;background:var(--hud-plate);border-left:2px solid var(--hud-signal)}
.sl-hud .h-prompt.busy .h-plabel{color:var(--hud-signal)}

/* kill feed + transient message */
.sl-hud .h-feed{position:absolute;right:var(--hud-gutter-x);top:31%;text-align:right}
.sl-hud .h-fl{font:500 13px/1.5 var(--hud-font-label);letter-spacing:.18em;text-transform:uppercase;color:var(--hud-bone-dim);transition:opacity .5s}
.sl-hud .h-fl b{font-weight:600;color:var(--hud-bone)}
.sl-hud .h-fl em{font-style:normal;color:var(--hud-signal);margin-left:10px}
.sl-hud .h-fl.out{opacity:0}
.sl-hud .h-msg{position:absolute;left:50%;bottom:calc(23% + var(--hud-safe-bottom));transform:translateX(-50%);max-width:calc(100vw - var(--hud-gutter-x) - var(--hud-gutter-x));text-align:center;padding:6px 10px;background:var(--hud-plate);font:400 11px/1.4 var(--hud-font-mono);letter-spacing:.08em;text-transform:uppercase;opacity:0;transition:opacity .3s}
.sl-hud .h-msg.on{opacity:1}

/* health (10 segments, only while hurt) */
.sl-hud .h-health{position:absolute;left:var(--hud-gutter-x);bottom:calc(22px + var(--hud-safe-bottom));opacity:0;transition:opacity .6s}
.sl-hud .h-health.on{opacity:1;transition-duration:.12s}
.sl-hud .h-hp-row{display:flex;align-items:flex-end;gap:10px;margin-top:6px}
.sl-hud .h-hp-n{font:700 34px/.82 var(--hud-font-display);letter-spacing:.02em;min-width:1.6em}
.sl-hud .h-hp-bar{display:flex;gap:3px;padding-bottom:2px}
.sl-hud .h-hp-bar i{width:15px;height:5px;background:var(--hud-bone);box-shadow:0 0 2px var(--hud-shade)}
.sl-hud .h-hp-bar i.off{background:transparent;box-shadow:inset 0 0 0 1px var(--hud-bone-faint)}
.sl-hud .h-health.crit .h-hp-n{color:var(--hud-alarm)}
.sl-hud .h-health.crit .h-hp-bar i:not(.off){background:var(--hud-alarm)}

/* ammo + magazine pips */
.sl-hud .h-ammo{position:absolute;right:var(--hud-gutter-x);bottom:calc(20px + var(--hud-safe-bottom));text-align:right}
.sl-hud .h-cue{height:16px;font:600 12px/16px var(--hud-font-label);letter-spacing:.26em;margin-right:-.26em;text-transform:uppercase;color:var(--hud-signal);opacity:0}
.sl-hud .h-cue.on{opacity:1}
.sl-hud .h-cue.urgent{color:var(--hud-alarm);animation:sl-blink .7s steps(2,jump-none) infinite}
.sl-hud .h-ammo-row{display:flex;align-items:flex-end;justify-content:flex-end;gap:8px}
.sl-hud .h-ammo-n{font:700 76px/.8 var(--hud-font-display);letter-spacing:.01em;font-variant-numeric:tabular-nums}
.sl-hud .h-ammo-r{font:500 15px/1 var(--hud-font-mono);color:var(--hud-bone);padding-bottom:3px}
.sl-hud .h-ammo-r::before{content:'/ ';color:var(--hud-bone-dim)}
.sl-hud .h-ammo.low .h-ammo-n{color:var(--hud-signal)}
.sl-hud .h-pips{display:flex;justify-content:flex-end;gap:2px;margin:9px 0 7px}
.sl-hud .h-pips i{width:3px;height:11px;background:var(--hud-bone);box-shadow:0 0 2px var(--hud-shade)}
.sl-hud .h-pips i.off{background:var(--hud-bone-faint);box-shadow:none}
.sl-hud .h-ammo.low .h-pips i:not(.off){background:var(--hud-signal)}
.sl-hud .h-wname{font:600 11px/1 var(--hud-font-label);letter-spacing:.28em;margin-right:-.28em;text-transform:uppercase;color:var(--hud-bone-strong)}
@keyframes sl-blink{0%{opacity:1}100%{opacity:.35}}

@media (prefers-reduced-motion: reduce){
  .sl-hud .h-hit.on{animation-duration:1ms}
  .sl-hud .h-cue.urgent{animation:none}
  .sl-hud .h-obj.flash{animation:none}
  .sl-hud .h-cross i{transition:none}
}
`;

/**
 * createHudKit — 建 HUD DOM 并返回命令式 API。
 * @param {object}   opts
 * @param {Document} opts.doc      注入的 document（必填，无顶层 DOM 访问）
 * @param {Element}  opts.mount    挂载点（默认 doc.body）
 * @param {object}   opts.events   { on(evt,fn), off? }；自动接 player:hitEnemy / player:damaged / enemy:killed
 * @param {object}   opts.tokens   token 覆盖（HUD_TOKENS 同键）
 * @param {object}   opts.strings  文案覆盖
 * @param {object}   opts.viewport { width, height }（无 window 的宿主可显式给）
 * @param {number}   opts.markerLimit 罗盘标记容量（默认 8）
 * @param {number}   opts.maxMag  弹匣 pip 上限（默认 60）
 * @param {boolean}  opts.injectCss 是否注入 <style data-sl-hud>（默认 true）
 * @param {boolean}  opts.wireEvents 是否自动订阅事件（默认 true）
 * @param {Function} opts.rng     注入位（HUD 不消耗随机数）
 */
export function createHudKit({
  doc = globalThis.document,
  mount = null,
  rng = Math.random,
  events = { on() {}, emit() {} },
  tokens = {},
  strings = {},
  viewport = null,
  markerLimit = 8,
  maxMag = 60,
  injectCss = true,
  wireEvents = true,
} = {}) {
  if (!doc || typeof doc.createElement !== "function") {
    throw new Error("hud-kit requires a DOM document — pass { doc: document } (no top-level DOM access)");
  }
  const host = mount || doc.body;
  if (!host || typeof host.appendChild !== "function") {
    throw new Error("hud-kit requires a mount element (or doc.body)");
  }
  void rng; // rng 接口对齐 kit 约定；HUD 全确定性，不消耗随机数

  const mergedTokens = { ...HUD_TOKENS, ...tokens };
  const tokenNames = Object.keys(mergedTokens);
  const tokenCount = tokenNames.length;
  const S = { ...DEFAULT_STRINGS, ...strings };
  const markerCap = Math.max(1, Math.min(32, markerLimit | 0 || 8));
  const magCap = Math.max(1, Math.min(120, maxMag | 0 || 60));

  const el = (tag, cls, html) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const cssVar = (name) => `--hud-${name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;

  /* ---- 样式（幂等注入） ---- */
  let styleEl = null;
  let ownsStyle = false;
  if (injectCss) {
    styleEl = doc.querySelector ? doc.querySelector("style[data-sl-hud]") : null;
    if (!styleEl) {
      styleEl = el("style");
      styleEl.setAttribute("data-sl-hud", "");
      styleEl.textContent = HUD_CSS;
      (doc.head || doc.documentElement).appendChild(styleEl);
      ownsStyle = true;
    }
  }

  /* ---- 根节点 + token 落盘 ---- */
  const root = el("div", "sl-hud");
  root.setAttribute("aria-hidden", "true");
  for (let i = 0; i < tokenNames.length; i += 1) {
    const k = tokenNames[i];
    root.style.setProperty(cssVar(k), mergedTokens[k]);
  }
  host.appendChild(root);

  const components = [];
  const component = (name, node) => {
    components.push(name);
    return node;
  };

  /* ---- 罗盘带：-90..450 / 5°，卡片 45°、数字 15°（构建期一次） ---- */
  const compass = component("compass", el("div", "h-compass"));
  const tapeWrap = el("div", "h-tape-wrap");
  const tape = el("div", "h-tape");
  let tickCount = 0;
  let tickHtml = "";
  const C = HUD_COMPASS.cardinals;
  for (let d = HUD_COMPASS.minDeg; d <= HUD_COMPASS.maxDeg; d += HUD_COMPASS.stepDeg) {
    const x = (d - HUD_COMPASS.minDeg) * HUD_COMPASS.pxPerDeg;
    const norm = ((d % 360) + 360) % 360;
    const major = norm % 45 === 0;
    const medium = norm % 15 === 0;
    tickHtml += `<i class="${major ? "mj" : medium ? "md" : "mn"}" style="left:${x}px"></i>`;
    if (major) tickHtml += `<b class="${norm % 90 === 0 ? "card" : "ic"}" style="left:${x}px">${C[norm] || ""}</b>`;
    else if (medium) tickHtml += `<b class="num" style="left:${x}px">${String(norm).padStart(3, "0")}</b>`;
    tickCount += 1;
  }
  tape.innerHTML = tickHtml;
  tapeWrap.appendChild(tape);
  const headingEl = el("div", "h-heading", "000");
  const cmarks = el("div", "h-cmarks");
  compass.appendChild(tapeWrap);
  compass.appendChild(el("i", "h-needle"));
  compass.appendChild(cmarks);
  compass.appendChild(headingEl);

  const markerSlots = [];
  for (let i = 0; i < markerCap; i += 1) {
    const cm = el("div", "h-cm", "<i></i><b></b><span></span>");
    cm.style.display = "none";
    cmarks.appendChild(cm);
    markerSlots.push({
      el: cm,
      shortEl: cm.querySelector("b"),
      distEl: cm.querySelector("span"),
      active: false,
      pos: null,
      kind: "relay",
      lastDist: -1,
      lastX: Infinity,
    });
  }

  /* ---- 目标面板 + 继电器 pip ---- */
  const objective = component("objective", el("div", "h-obj"));
  objective.innerHTML = `<div class="h-k">${S.objective}</div><div class="h-obj-t"></div><div class="h-relays"><span>${S.relay}</span><b>0/0</b></div>`;
  const objText = objective.querySelector(".h-obj-t");
  const relayWrap = objective.querySelector(".h-relays");
  const relayCount = relayWrap.querySelector("b");
  let relayPips = [];
  let relayTotal = 0;
  let relayDone = -1;

  /* ---- 生命：10 段 ---- */
  const health = component("health", el("div", "h-health"));
  health.innerHTML = `<div class="h-k">${S.health}</div><div class="h-hp-row"><b class="h-hp-n">100</b><div class="h-hp-bar">${"<i></i>".repeat(HP_SEGMENTS)}</div></div>`;
  const hpNum = health.querySelector(".h-hp-n");
  const hpSegs = Array.prototype.slice.call(health.querySelectorAll(".h-hp-bar i"));

  /* ---- 瞄准/命中 ---- */
  const crosshair = component("crosshair", el("div", "h-cross", '<i class="c-t"></i><i class="c-b"></i><i class="c-l"></i><i class="c-r"></i><i class="c-dot"></i>'));
  const crossBars = Array.prototype.slice.call(crosshair.querySelectorAll("i"));
  const hitmarkerEl = component("hitmarker", el("div", "h-hit", "<i></i><i></i><i></i><i></i>"));

  /* ---- 4 向伤害弧（SVG 池） ---- */
  const arcLayer = component("damageArcs", el("div", "h-arcs"));
  const ARC_MARKUP = '<svg viewBox="-100 -100 200 200"><path d="M -38 -84 A 92 92 0 0 1 38 -84"></path><path class="tip" d="M -7 -97 L 0 -106 L 7 -97"></path></svg>';
  const arcSlots = [];
  for (let i = 0; i < ARC_POOL; i += 1) {
    const node = el("div", "h-arc", ARC_MARKUP);
    node.style.opacity = "0";
    arcLayer.appendChild(node);
    arcSlots.push({ el: node, life: 0, max: 1.5, srcX: 0, srcZ: 0, angle: Infinity, op: 0 });
  }

  /* ---- 交互环（2π·19） ---- */
  const prompt = component("prompt", el("div", "h-prompt"));
  prompt.innerHTML = `<svg viewBox="-24 -24 48 48"><circle class="bg" r="${RING_R}"></circle><circle class="fg" r="${RING_R}" stroke-dasharray="${RING_LEN.toFixed(2)}" stroke-dashoffset="${RING_LEN.toFixed(2)}" transform="rotate(-90)"></circle></svg><span class="h-key">${S.promptKey}</span><span class="h-plabel"></span>`;
  const ringFg = prompt.querySelector(".fg");
  const promptLabel = prompt.querySelector(".h-plabel");

  /* ---- 事件流（4 条池） + 中央消息 ---- */
  const feedEl = component("feed", el("div", "h-feed"));
  const feedSlots = [];
  for (let i = 0; i < FEED_POOL; i += 1) {
    const node = el("div", "h-fl");
    feedEl.appendChild(node);
    feedSlots.push({ el: node, life: 0, out: false });
  }
  const messageEl = component("message", el("div", "h-msg"));

  /* ---- 弹药 + 弹匣 pip ---- */
  const ammoEl = component("ammo", el("div", "h-ammo"));
  ammoEl.innerHTML = '<div class="h-cue"></div><div class="h-ammo-row"><b class="h-ammo-n">30</b><span class="h-ammo-r">000</span></div><div class="h-pips"></div><div class="h-wname"></div>';
  const ammoNum = ammoEl.querySelector(".h-ammo-n");
  const ammoReserve = ammoEl.querySelector(".h-ammo-r");
  const pipsEl = ammoEl.querySelector(".h-pips");
  const weaponName = ammoEl.querySelector(".h-wname");
  const cueEl = ammoEl.querySelector(".h-cue");

  /* ---- 装配 ---- */
  root.appendChild(compass);
  root.appendChild(objective);
  root.appendChild(arcLayer);
  root.appendChild(crosshair);
  root.appendChild(hitmarkerEl);
  root.appendChild(prompt);
  root.appendChild(feedEl);
  root.appendChild(messageEl);
  root.appendChild(health);
  root.appendChild(ammoEl);

  /* ---- 状态 ---- */
  const statsBag = {
    compassTicks: tickCount,
    compassMarkers: 0,
    relayPips: 0,
    hpSegments: HP_SEGMENTS,
    magPips: 0,
    damageArcs: 0,
    hitmarks: 0,
    weakHits: 0,
    kills: 0,
    prompts: 0,
    messages: 0,
    feeds: 0,
    objectiveChars: 0,
    updates: 0,
    tapeWrites: 0,
    crosshairWrites: 0,
    markerSets: 0,
  };

  const player = { posX: 0, posZ: 0, yaw: 0, heading: 0, maxHealth: 100, alive: true, sprinting: false };
  const weapon = { ammo: 30, magSize: 30, reserve: 0, name: "", state: "idle", spread: 0.012, fov: 54, ads: 0 };
  const cache = {
    tapeX: Infinity,
    heading: -1,
    gap: Infinity,
    crossOn: null,
    hp: -1,
    hpSeg: -1,
    hurt: null,
    ammo: -1,
    reserve: -1,
    name: null,
    cue: null,
    low: null,
    promptOn: null,
    promptText: null,
    promptProgress: -1,
    objectiveChars: -1,
  };
  const objectiveState = { text: "", typed: 0 };
  let objectivePrefixes = [""];
  let magPips = [];
  let visible = false;
  let compassW = 0;
  let viewW = (viewport && viewport.width) || (doc.defaultView && doc.defaultView.innerWidth) || 1280;
  let viewH = (viewport && viewport.height) || (doc.defaultView && doc.defaultView.innerHeight) || 720;
  let compassDirty = true;
  let crossDirty = true;
  let msgTimer = 0;
  let markerHalf = -1;
  let markerXforms = [];
  let tapeKeyLo = 0;
  let tapeXforms = [];

  /* ---- 罗盘位移/标记位移查表（只在 layout 时重建，不进每帧循环） ---- */
  function rebuildCompassTables() {
    const w = compassW > 0 ? compassW : 420;
    const lo = Math.round((w / 2 - (HUD_COMPASS.maxDeg - HUD_COMPASS.minDeg) * HUD_COMPASS.pxPerDeg) * 2);
    const hi = Math.round((w / 2 - (0 - HUD_COMPASS.minDeg) * HUD_COMPASS.pxPerDeg) * 2);
    tapeKeyLo = lo;
    tapeXforms = new Array(hi - lo + 1);
    for (let k = lo; k <= hi; k += 1) tapeXforms[k - lo] = `translate3d(${k / 2}px,0,0)`;
    const lim = Math.max(0, Math.round(w / 2 - 14));
    if (lim !== markerHalf) {
      markerHalf = lim;
      markerXforms = new Array(lim * 2 + 1);
      for (let k = -lim; k <= lim; k += 1) markerXforms[k + lim] = `translate3d(${k}px,0,0)`;
    }
  }

  /* ---- token 变量名快照（stats 只报数量，热循环不读） ---- */
  function layout() {
    compassW = compass.clientWidth || Math.min(420, viewW * 0.6);
    rebuildCompassTables();
    compassDirty = true;
    crossDirty = true;
    cache.tapeX = NaN;
    cache.gap = NaN;
  }

  /* ---- 罗盘带 + 标记 ---- */
  function updateCompass() {
    if (compassW <= 0) { compassW = compass.clientWidth || Math.min(420, viewW * 0.6); rebuildCompassTables(); }
    const key = Math.round((compassW / 2 - (player.heading - HUD_COMPASS.minDeg) * HUD_COMPASS.pxPerDeg) * 2);
    if (key !== cache.tapeX) {
      cache.tapeX = key;
      const idx = key - tapeKeyLo;
      if (idx >= 0 && idx < tapeXforms.length) tape.style.transform = tapeXforms[idx];
      statsBag.tapeWrites += 1;
    }
    const shown = Math.round(player.heading) % 360;
    if (shown !== cache.heading) {
      cache.heading = shown;
      headingEl.textContent = HEADING_TEXT[shown];
    }
  }

  function updateMarkers() {
    const halfW = compassW / 2 - 14;
    for (let i = 0; i < markerCap; i += 1) {
      const s = markerSlots[i];
      if (!s.active || !s.pos) continue;
      const dx = s.pos.x - player.posX;
      const dz = s.pos.z - player.posZ;
      const dist = Math.round(Math.hypot(dx, dz));
      if (dist !== s.lastDist) {
        s.lastDist = dist;
        s.distEl.textContent = dist < DIST_TEXT.length ? DIST_TEXT[dist] : `${dist}米`;
      }
      let bearing = (Math.atan2(dx, -dz) * 180) / Math.PI - player.heading;
      bearing = ((bearing + 540) % 360) - 180;
      const clamped = Math.max(-markerHalf, Math.min(markerHalf, Math.round(bearing * HUD_COMPASS.pxPerDeg)));
      if (clamped !== s.lastX) {
        s.lastX = clamped;
        s.el.style.transform = markerXforms[clamped + markerHalf];
        s.el.classList.toggle("edge", Math.abs(clamped) >= halfW);
      }
    }
  }

  /* ---- 准星随散布 ---- */
  function updateCrosshair() {
    const show = player.alive !== false && weapon.ads <= 0.6 && weapon.state !== CROSS_BAR_RELOAD_HIDDEN;
    if (show !== cache.crossOn) {
      crosshair.classList.toggle("off", !show);
      cache.crossOn = show;
    }
    if (!show) return;
    const tanSpread = Math.tan(weapon.spread);
    const tanHalfFov = Math.tan((weapon.fov * Math.PI) / 360);
    const raw = (tanSpread / (tanHalfFov || 1e-4)) * (viewH / 2) + 4 + (player.sprinting ? 10 : 0);
    const gap = Math.round(Math.max(4, Math.min(70, raw)) * 2) / 2;
    if (gap !== cache.gap) {
      cache.gap = gap;
      const xf = CROSS_XFORMS[(gap - 4) * 2];
      crossBars[0].style.transform = xf.t;
      crossBars[1].style.transform = xf.b;
      crossBars[2].style.transform = xf.l;
      crossBars[3].style.transform = xf.r;
      statsBag.crosshairWrites += 1;
    }
  }

  /* ---- 生命 10 段 ---- */
  function setHealth(value, max) {
    if (typeof max === "number" && max > 0) player.maxHealth = max;
    const maxHealth = player.maxHealth > 0 ? player.maxHealth : 100;
    const hp = Math.max(0, typeof value === "number" ? value : 0);
    const shown = Math.max(0, Math.ceil(hp));
    if (shown !== cache.hp) {
      cache.hp = shown;
      hpNum.textContent = String(shown);
    }
    const seg = Math.max(0, Math.min(HP_SEGMENTS, Math.ceil((shown / maxHealth) * HP_SEGMENTS)));
    if (seg !== cache.hpSeg) {
      cache.hpSeg = seg;
      for (let i = 0; i < HP_SEGMENTS; i += 1) hpSegs[i].className = i < seg ? "" : "off";
      health.classList.toggle("crit", seg <= 3);
    }
    const hurt = hp < maxHealth - 0.5;
    if (hurt !== cache.hurt) {
      cache.hurt = hurt;
      health.classList.toggle("on", hurt);
    }
  }

  /* ---- 弹药 + 弹匣 pip ---- */
  function buildMagPips(n) {
    const size = Math.max(1, Math.min(magCap, n | 0 || 30));
    if (size === magPips.length) return;
    pipsEl.innerHTML = "<i></i>".repeat(size);
    magPips = Array.prototype.slice.call(pipsEl.children);
    cache.ammo = -1;
    statsBag.magPips = size;
  }

  function updateAmmo() {
    const mag = Math.max(1, Math.min(magCap, weapon.magSize | 0 || 30));
    buildMagPips(mag);
    const ammo = Math.max(0, Math.min(mag, weapon.ammo | 0));
    if (ammo !== cache.ammo) {
      cache.ammo = ammo;
      ammoNum.textContent = String(ammo).padStart(2, "0");
      for (let i = 0; i < magPips.length; i += 1) magPips[i].className = i < ammo ? "" : "off";
    }
    const reserve = Math.max(0, weapon.reserve | 0);
    if (reserve !== cache.reserve) {
      cache.reserve = reserve;
      ammoReserve.textContent = String(reserve).padStart(3, "0");
    }
    if (weapon.name !== cache.name) {
      cache.name = weapon.name;
      weaponName.textContent = weapon.name || "";
    }
    const low = ammo <= Math.ceil(mag * 0.27);
    if (low !== cache.low) {
      cache.low = low;
      ammoEl.classList.toggle("low", low);
    }
    const urgent = ammo === 0 && weapon.state !== "reloading";
    const cue = weapon.state === "reloading"
      ? "换弹中"
      : ammo === 0
        ? reserve > 0
          ? "R · 换弹"
          : "弹药耗尽"
        : low
          ? "弹药不足"
          : "";
    if (cue !== cache.cue) {
      cache.cue = cue;
      cueEl.textContent = cue;
      cueEl.className = `h-cue${cue ? " on" : ""}${urgent ? " urgent" : ""}`;
    }
  }

  /* ---- 命中标记三态 ---- */
  function hitmarker(state = "hit") {
    const s = HIT_STATES.indexOf(state) >= 0 ? state : "hit";
    hitmarkerEl.classList.remove("on");
    void hitmarkerEl.offsetWidth; // 重触发 CSS 动画
    hitmarkerEl.className = `h-hit ${s} on`;
    statsBag.hitmarks += 1;
    if (s === "weak") statsBag.weakHits += 1;
    else if (s === "kill") statsBag.kills += 1;
    return s;
  }

  /* ---- 伤害弧 ---- */
  function damageArc(from) {
    if (!from) return;
    const x = typeof from.x === "number" ? from.x : from[0];
    const z = typeof from.z === "number" ? from.z : from[1];
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    let slot = arcSlots[0];
    for (let i = 0; i < ARC_POOL; i += 1) {
      if (arcSlots[i].life <= 0) { slot = arcSlots[i]; break; }
      if (arcSlots[i].life < slot.life) slot = arcSlots[i];
    }
    slot.life = slot.max;
    slot.srcX = x;
    slot.srcZ = z;
    slot.angle = Infinity;
    slot.op = -1;
    slot.el.style.opacity = "0.9";
    statsBag.damageArcs += 1;
  }

  /* ---- 交互环 ---- */
  function setPrompt(label, progress = 0) {
    const on = !!label;
    if (on !== cache.promptOn) {
      cache.promptOn = on;
      prompt.classList.toggle("on", on);
      if (on) statsBag.prompts += 1;
    }
    if (!on) {
      prompt.classList.remove("busy");
      cache.promptText = null;
      cache.promptProgress = -1;
      return;
    }
    if (label !== cache.promptText) {
      cache.promptText = label;
      promptLabel.textContent = label;
    }
    const p = Math.round(clamp01(progress) * 200) / 200;
    if (p !== cache.promptProgress) {
      cache.promptProgress = p;
      ringFg.setAttribute("stroke-dashoffset", (RING_LEN * (1 - p)).toFixed(2));
      prompt.classList.toggle("busy", p > 0);
    }
  }

  /* ---- 中央消息 / 事件流 ---- */
  function message(text, seconds = 3) {
    const msg = text || "";
    messageEl.textContent = msg;
    messageEl.classList.toggle("on", !!msg);
    msgTimer = msg ? seconds : 0;
    if (msg) statsBag.messages += 1;
  }

  function feed(html, seconds = 4.2) {
    let slot = null;
    for (let i = 0; i < FEED_POOL; i += 1) {
      if (feedSlots[i].life <= 0) { slot = feedSlots[i]; break; }
    }
    if (!slot) {
      slot = feedSlots[0];
      for (let i = 1; i < FEED_POOL; i += 1) if (feedSlots[i].life < slot.life) slot = feedSlots[i];
    }
    slot.el.innerHTML = html;
    slot.el.classList.remove("out");
    slot.life = seconds;
    slot.out = false;
    statsBag.feeds += 1;
    return slot;
  }

  /* ---- 目标面板 ---- */
  function setObjective(text) {
    const next = text || "";
    if (next === objectiveState.text) return;
    objectiveState.text = next;
    objectiveState.typed = 0;
    cache.objectiveChars = -1;
    objectivePrefixes = new Array(next.length + 1);
    objectivePrefixes[0] = "";
    for (let i = 1; i <= next.length; i += 1) objectivePrefixes[i] = next.slice(0, i);
    objText.textContent = "";
    objective.classList.toggle("has", !!next);
    objective.classList.remove("flash");
    void objective.offsetWidth;
    if (next) objective.classList.add("flash");
  }

  function setRelays(done, total = 3) {
    const t = Math.max(0, Math.min(8, total | 0));
    if (t !== relayTotal) {
      for (let i = 0; i < relayPips.length; i += 1) relayPips[i].remove();
      relayPips = [];
      for (let i = 0; i < t; i += 1) {
        const pip = el("i");
        relayWrap.insertBefore(pip, relayCount);
        relayPips.push(pip);
      }
      relayTotal = t;
      statsBag.relayPips = t;
      relayDone = -1;
    }
    const d = Math.max(0, Math.min(t, done | 0));
    if (d !== relayDone) {
      relayDone = d;
      for (let i = 0; i < relayPips.length; i += 1) relayPips[i].classList.toggle("cut", i < d);
      relayCount.textContent = `${d}/${t}`;
      relayWrap.classList.toggle("all", t > 0 && d >= t);
    }
  }

  function setMarkers(list) {
    const arr = list || [];
    let activeCount = 0;
    for (let i = 0; i < markerCap; i += 1) {
      const s = markerSlots[i];
      if (i < arr.length && arr[i] && arr[i].pos) {
        const m = arr[i];
        s.active = true;
        s.pos = m.pos;
        const kind = m.kind || "relay";
        s.el.className = `h-cm ${kind}`;
        s.el.style.display = "";
        const short = m.short || "";
        if (s.shortEl.textContent !== short) s.shortEl.textContent = short;
        s.lastDist = -1;
        s.lastX = Infinity;
        activeCount += 1;
      } else if (s.active) {
        s.active = false;
        s.pos = null;
        s.el.style.display = "none";
      }
    }
    statsBag.compassMarkers = activeCount;
    statsBag.markerSets += 1;
  }

  /* ---- 事件自动接线（与 combat-kit / player-kit 的合同同名） ---- */
  const bindings = [];
  function bind(name, fn) {
    if (typeof events.on !== "function") return;
    events.on(name, fn);
    bindings.push([name, fn]);
  }
  if (wireEvents) {
    bind("player:hitEnemy", (e) => {
      hitmarker(e && e.killed ? "kill" : e && (e.weak || e.part === "weak") ? "weak" : "hit");
    });
    bind("player:damaged", (e) => {
      if (e && e.from) damageArc(e.from);
    });
    bind("enemy:killed", (e) => {
      const type = e && (e.type || (e.enemy && e.enemy.type));
      feed(`<b>${ENEMY_NAMES[type] || "机械守卫"}</b> ${S.destroyed}`);
    });
  }

  /* ---- 热循环：定时器 + 标记，全部原地推进，无对象/数组分配 ---- */
  function update(dt) {
    statsBag.updates += 1;
    if (!visible) return;
    const step = dt > 0 ? dt : 0;

    for (let i = 0; i < ARC_POOL; i += 1) {
      const a = arcSlots[i];
      if (a.life <= 0) {
        if (a.op !== 0) {
          a.op = 0;
          a.el.style.opacity = "0";
        }
        continue;
      }
      a.life -= step;
      if (a.life <= 0) {
        a.life = 0;
        a.op = 0;
        a.el.style.opacity = "0";
        continue;
      }
      let angle = (Math.atan2(a.srcX - player.posX, -(a.srcZ - player.posZ)) * 180) / Math.PI + (player.yaw * 180) / Math.PI;
      angle = ((Math.round(angle) % 360) + 540) % 360 - 180;
      if (angle !== a.angle) {
        a.angle = angle;
        a.el.style.transform = ARC_ROT[angle + 180];
      }
      const op = Math.round(Math.max(0, Math.min(1, a.life / 0.6)) * 20) / 20;
      if (op !== a.op) {
        a.op = op;
        a.el.style.opacity = OPACITY_TEXT[Math.round(op * 20)];
      }
    }

    for (let i = 0; i < FEED_POOL; i += 1) {
      const f = feedSlots[i];
      if (f.life <= 0) continue;
      f.life -= step;
      if (f.life <= 0) {
        f.life = 0;
        f.el.textContent = "";
        if (f.out) {
          f.out = false;
          f.el.classList.remove("out");
        }
      } else if (f.life < 0.6 && !f.out) {
        f.out = true;
        f.el.classList.add("out");
      }
    }

    if (msgTimer > 0) {
      msgTimer -= step;
      if (msgTimer <= 0) {
        msgTimer = 0;
        messageEl.classList.remove("on");
      }
    }

    if (objectiveState.typed < objectiveState.text.length) {
      objectiveState.typed = Math.min(objectiveState.text.length, objectiveState.typed + step * 46);
      const n = Math.floor(objectiveState.typed);
      if (n !== cache.objectiveChars) {
        cache.objectiveChars = n;
        objText.textContent = objectivePrefixes[n] != null ? objectivePrefixes[n] : objectiveState.text;
        statsBag.objectiveChars = n;
      }
    }

    if (compassDirty) {
      updateCompass();
      compassDirty = false;
    }
    updateMarkers();
    if (crossDirty) {
      updateCrosshair();
      crossDirty = false;
    }
  }

  /* ---- 对外 API ---- */
  function show(v) {
    const next = !!v;
    if (next === visible) return visible;
    visible = next;
    root.classList.toggle("on", visible);
    if (visible) layout();
    return visible;
  }

  function setPlayer(p) {
    if (!p) return;
    if (p.pos) {
      if (typeof p.pos.x === "number") player.posX = p.pos.x;
      if (typeof p.pos.z === "number") player.posZ = p.pos.z;
    }
    if (typeof p.yaw === "number") {
      player.yaw = p.yaw;
      let deg = ((-p.yaw * 180) / Math.PI) % 360;
      if (deg < 0) deg += 360;
      player.heading = deg;
      compassDirty = true;
    } else if (typeof p.heading === "number") {
      player.heading = ((p.heading % 360) + 360) % 360;
      player.yaw = (-player.heading * Math.PI) / 180;
      compassDirty = true;
    }
    if (typeof p.sprinting === "boolean" && p.sprinting !== player.sprinting) {
      player.sprinting = p.sprinting;
      crossDirty = true;
    }
    if (typeof p.alive === "boolean" && p.alive !== player.alive) {
      player.alive = p.alive;
      crossDirty = true;
    }
    if (typeof p.health === "number") setHealth(p.health, p.maxHealth);
  }

  function setWeapon(w) {
    if (!w) return;
    let dirty = false;
    if (typeof w.ammo === "number") weapon.ammo = w.ammo;
    if (typeof w.magSize === "number") weapon.magSize = w.magSize;
    if (typeof w.reserve === "number") weapon.reserve = w.reserve;
    if (typeof w.name === "string") weapon.name = w.name;
    if (typeof w.state === "string") weapon.state = w.state;
    if (typeof w.spread === "number") { weapon.spread = w.spread; dirty = true; }
    if (typeof w.fov === "number") { weapon.fov = w.fov; dirty = true; }
    if (typeof w.ads === "number") { weapon.ads = w.ads; dirty = true; }
    updateAmmo();
    if (dirty) crossDirty = true;
  }

  function resize(width, height) {
    if (typeof width === "number") viewW = width;
    if (typeof height === "number") viewH = height;
    layout();
  }

  function reset() {
    for (let i = 0; i < ARC_POOL; i += 1) {
      const a = arcSlots[i];
      a.life = 0;
      a.op = 0;
      a.angle = Infinity;
      a.el.style.opacity = "0";
    }
    for (let i = 0; i < FEED_POOL; i += 1) {
      const f = feedSlots[i];
      f.life = 0;
      f.out = false;
      f.el.textContent = "";
      f.el.classList.remove("out");
    }
    message("");
    msgTimer = 0;
    setPrompt(null);
    setObjective("");
    setRelays(0, relayTotal);
    setHealth(player.maxHealth, player.maxHealth);
    hitmarkerEl.classList.remove("on");
    cache.hp = -1;
  }

  function stats() {
    return {
      hudComponents: components.length,
      hudTokens: tokenCount,
      compassTicks: tickCount,
      compassMarkers: statsBag.compassMarkers,
      markerCapacity: markerCap,
      relayPips: statsBag.relayPips,
      hpSegments: HP_SEGMENTS,
      magPips: statsBag.magPips,
      arcPool: ARC_POOL,
      feedPool: FEED_POOL,
      hp: cache.hp,
      ammo: cache.ammo,
      visible,
      updates: statsBag.updates,
      tapeWrites: statsBag.tapeWrites,
      crosshairWrites: statsBag.crosshairWrites,
      hitmarks: statsBag.hitmarks,
      weakHits: statsBag.weakHits,
      kills: statsBag.kills,
      damageArcs: statsBag.damageArcs,
      prompts: statsBag.prompts,
      messages: statsBag.messages,
      feeds: statsBag.feeds,
      objectiveChars: statsBag.objectiveChars,
      markerSets: statsBag.markerSets,
    };
  }

  function dispose() {
    for (let i = 0; i < bindings.length; i += 1) {
      if (typeof events.off === "function") events.off(bindings[i][0], bindings[i][1]);
    }
    bindings.length = 0;
    if (root.parentNode) root.parentNode.removeChild(root);
    if (ownsStyle && styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
  }

  /* ---- 初始状态 ---- */
  layout();
  setRelays(0, 3);
  updateAmmo();
  setHealth(player.maxHealth, player.maxHealth);

  return {
    root,
    tokens: mergedTokens,
    show,
    setPlayer,
    setWeapon,
    setHealth,
    setObjective,
    setRelays,
    setMarkers,
    setPrompt,
    hitmarker,
    damageArc,
    message,
    feed,
    update,
    reset,
    resize,
    stats,
    dispose,
  };
}

/* ============================== 自检 ============================== */

/**
 * 模块级自检（node 可跑，无 DOM）：token 层 / 组件清单 / 罗盘常量与刻度数 / 样式表完整性。
 * 组件装配需要真实 DOM（doc + mount 参数注入），由 inspect 门禁在浏览器侧验收；
 * 本自检覆盖所有可在 node 静态核对的设计系统合同。
 * 返回 { ok, problems, ...counts }。
 */
export function selfTest() {
  const problems = [];
  const tokens = Object.keys(HUD_TOKENS);
  if (tokens.length !== 26) problems.push("hudTokens != 26: " + tokens.length);
  for (const k of tokens) {
    const v = HUD_TOKENS[k];
    if (typeof v !== "string" || !v.trim()) problems.push("token " + k + " is empty");
  }
  if (HUD_COMPONENTS.length !== 10) problems.push("hudComponents != 10: " + HUD_COMPONENTS.length);
  if (new Set(HUD_COMPONENTS).size !== HUD_COMPONENTS.length) problems.push("duplicate HUD component names");
  const expectedComponents = ["compass", "objective", "health", "ammo", "crosshair", "hitmarker", "damageArcs", "prompt", "feed", "message"];
  for (const name of expectedComponents) if (!HUD_COMPONENTS.includes(name)) problems.push("missing HUD component: " + name);

  if (HUD_COMPASS.minDeg !== -90 || HUD_COMPASS.maxDeg !== 450) problems.push("compass range != -90..450");
  if (HUD_COMPASS.stepDeg !== 5) problems.push("compass step != 5deg");
  if (HUD_COMPASS.pxPerDeg !== 4) problems.push("compass pxPerDeg != 4");
  const ticks = (HUD_COMPASS.maxDeg - HUD_COMPASS.minDeg) / HUD_COMPASS.stepDeg + 1;
  if (ticks !== 109) problems.push("compass ticks != 109: " + ticks);
  const cardinals = Object.keys(HUD_COMPASS.cardinals || {});
  if (cardinals.length !== 8) problems.push("compass cardinals != 8: " + cardinals.length);

  if (typeof HUD_CSS !== "string" || HUD_CSS.length < 1000) problems.push("HUD_CSS too short");
  for (const cls of [".sl-hud", ".h-compass", ".h-obj", ".h-health", ".h-ammo", ".h-cross", ".h-hit", ".h-arcs", ".h-prompt", ".h-feed", ".h-msg"]) {
    if (!HUD_CSS.includes(cls)) problems.push("HUD_CSS missing " + cls);
  }
  const varUses = (HUD_CSS.match(/var\(--hud-/g) || []).length;
  if (varUses < 20) problems.push("HUD_CSS var(--hud-*) uses < 20: " + varUses);

  return {
    ok: problems.length === 0,
    problems,
    hudTokens: tokens.length,
    hudComponents: HUD_COMPONENTS.length,
    compassTicks: ticks,
    cssBytes: HUD_CSS.length,
    cssVarUses: varUses,
  };
}
