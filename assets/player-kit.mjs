/**
 * player-kit.mjs — 玩家控制器：三模态归一输入（pointer-lock 键鼠 / 触屏 / 手柄）、
 * Mt 手感调参表、physics-kit moveCapsule 对接、脚步与落地事件。
 *
 * 出处（上游 Saltline 捕获明文编号，逐行为对照源实现，行为合同以源为准）：
 *   - 键位表 27 项 + 灵敏度（mouse .0021 / touch .0052 / 键盘转向 2.1 / 手柄 3）+
 *     摇杆半径 58px：[src:pretty:L51710-L51744]
 *   - 输入系统 v_ 整体：pointer-lock + 捕获失败回退 drag（边缘持续转向）+ 触屏虚拟摇杆/
 *     双指分区（左 45% 移动、右侧视角）+ 手柄标准映射轮询（死区 .16、按键阈值 .4）+
 *     三源 move 叠加钳制单位圆 + pressed 边沿集 + endFrame 清零：
 *     [src:pretty:L51745-L52132]；手柄按键映射 {0:jump,1:crouch,2:reload,3:interact,
 *     5:melee,6:ads,7:fire,9:pause,10:sprint,11:melee}：[src:pretty:L52050-L52068]
 *   - Mt 手感调参表（coyote .12 / jumpBuffer .13 / stride / bob / rollStrafe / landDip /
 *     regenDelay 4 / regenRate 25 …共 36 顶层字段）与起跳速度 rC=√(2·g·apex)：
 *     [src:pretty:L52133-L52171]
 *   - 玩家控制器 x_ 整体：reset/damage/heal、加减速（accelGround 34/decleGround 26/
 *     accelAir 9）、coyote+buffer 起跳、moveCapsule 半步重力调用、落地 landDip 弹簧+
 *     硬着陆伤害（>13 部分 ×7）、stride 相位整越发 player:step、bob/roll、regen、
 *     落水回 lastSafe（-12 伤）、相机（眼高/后坐/抖动/fov）、死亡相机：
 *     [src:pretty:L52172-L52510]
 *   - 事件消费合同（audio/fx 消费 player:step/land/jump/hit 的载荷字段）：
 *     [src:pretty:L51333-L51350]、[src:pretty:L48429-L48437]
 *   - 玩家尺寸 Pi（eye 1.68 / crouchEye 1.05 / radius .32 / height 1.8 / fov 74）：
 *     [src:pretty:L30042-L30042]
 *   - damp/clamp/lerp/smoothstep 助手公式：[src:pretty:L30177-L30184]
 *
 * 数量对齐说明：harness/element-manifest.json 18 族中没有 player 独立族
 * （references/12-full-scene-assembly.md 装配表第 7 层展厅列为「—」），本 kit 的数量
 * 合同对齐上游实数：Mt 36 顶层字段（含 stride 3 子字段）、键位表 27 项、手柄按键 10 项、
 * 3 种输入模态（lock/drag/touch）+ 手柄正交通道。
 *
 * 约定（与 assets/combat-kit.mjs 同族）：纯 JS、零引擎依赖、physics/events/rng 参数注入、
 * 可 node 自测。相机可选注入（鸭子类型：position.set / rotation.set+order / fov /
 * updateProjectionMatrix），未注入时 eye/viewPitch/viewYaw/viewRoll/fov 仍每帧更新。
 * 确定性：控制器上游本就无随机源——rng 仅为注入签名对齐，kit 内零调用、零 Math.random，
 * 同输入脚本逐位可复现（selfTest 第 16 项）。
 * 热循环（input.update / player.update / endFrame）零分配：事件载荷预分配复用
 * （EVT_*），消费方须同步读取（与上游传 live pos 引用同一约定）。
 *
 * 用法：
 *   const kit = createPlayerKit({ physics, events, tune: { coyote: 0.2 } });
 *   kit.input.attach(renderer.domElement);        // 浏览器：接真实键鼠/触屏/pointer-lock
 *   kit.input.setGameplay(true);
 *   kit.input.update(dt); kit.player.update(dt); kit.input.endFrame();  // 每帧
 *   kit.selfTest();                               // node 离线自证（16 项）
 */

/* ---- Mt 手感调参表 [src:pretty:L52133-L52170]：调参不改逻辑，全部字段可覆盖 ---- */
export const PLAYER_TUNE_DEFAULTS = Object.freeze({
  walk: 3.8,
  sprint: 6.4,
  crouch: 1.9,
  ads: 2.4,
  accelGround: 34,
  decelGround: 26,
  accelAir: 9,
  gravity: 21,
  jumpApex: 1,
  coyote: 0.12,
  jumpBuffer: 0.13,
  standHeight: 1.8,
  crouchHeight: 1.15,
  eyeRate: 11,
  stride: Object.freeze({ walk: 1.55, sprint: 2.1, crouch: 1.05 }),
  bobY: 0.024,
  bobX: 0.013,
  bobSprint: 1.9,
  bobAds: 0.22,
  rollStrafe: 0.02,
  landDip: 0.36,
  landDipMax: 0.2,
  fovSprint: 6,
  fovAds: 52,
  adsLook: 0.6,
  regenDelay: 4,
  regenRate: 25,
  recoilKeep: 0.35,
  recoilApply: 34,
  recoilRecover: 6.5,
  recoilHold: 0.09,
  shakeDecay: 1.7,
  shakePitch: 0.03,
  shakeYaw: 0.03,
  shakeRoll: 0.045,
  pitchLimit: 1.5,
});

/* ---- 玩家尺寸 Pi [src:pretty:L30042-L30042]（viewFov 供 weapon-kit 枪相机） ---- */
export const PLAYER_DIMS = Object.freeze({
  eye: 1.68,
  crouchEye: 1.05,
  radius: 0.32,
  height: 1.8,
  fov: 74,
  viewFov: 54,
});

/* ---- 键位表 h_ [src:pretty:L51710-L51738]：code → 动作，27 项 ---- */
export const KEY_ACTIONS = Object.freeze({
  KeyW: "forward",
  KeyS: "back",
  KeyA: "left",
  KeyD: "right",
  Space: "jump",
  ShiftLeft: "sprint",
  ShiftRight: "sprint",
  KeyC: "crouch",
  ControlLeft: "crouch",
  ControlRight: "crouch",
  KeyR: "reload",
  KeyE: "interact",
  KeyF: "melee",
  KeyV: "melee",
  Escape: "pause",
  KeyP: "pause",
  KeyQ: "alt",
  Enter: "fire",
  NumpadEnter: "fire",
  ArrowLeft: "turnL",
  ArrowRight: "turnR",
  ArrowUp: "turnU",
  ArrowDown: "turnD",
  KeyJ: "turnL",
  KeyL: "turnR",
  KeyI: "turnU",
  KeyK: "turnD",
});

/* ---- 手柄标准映射 X [src:pretty:L52050-L52061]：按钮索引 → 动作，10 项 ---- */
export const GAMEPAD_BUTTONS = Object.freeze({
  0: "jump",
  1: "crouch",
  2: "reload",
  3: "interact",
  5: "melee",
  6: "ads",
  7: "fire",
  9: "pause",
  10: "sprint",
  11: "melee",
});

/* ---- 输入模态与缩放常量 [src:pretty:L51739-L51744] ---- */
export const INPUT_MODES = Object.freeze(["lock", "drag", "touch"]);
export const INPUT_SCALES = Object.freeze({
  mouse: 0.0021,
  touch: 0.0052,
  keyTurn: 2.1,
  pad: 3,
  padDeadzone: 0.16,
  padButton: 0.4,
  stickRadius: 58,
  mouseJumpGuard: 400,
});

/* ---- 事件名合同（audio/fx 消费侧 [src:pretty:L51333-L51350]） ---- */
export const PLAYER_EVENT_NAMES = Object.freeze([
  "player:jump",
  "player:land",
  "player:step",
  "player:hit",
  "player:dead",
  "player:rescued",
  "input:lock",
  "input:mode",
]);

/* ---- 助手（公式逐字对照 [src:pretty:L30177-L30184]） ---- */
function clampN(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function lerpN(a, b, t) { return a + (b - a) * t; }
function clamp01N(v) { return Math.min(1, Math.max(0, v)); }
function smoothstepN(e0, e1, x) {
  const n = clamp01N((x - e0) / (e1 - e0));
  return n * n * (3 - 2 * n);
}
function dampN(cur, target, rate, dt) { return target + (cur - target) * Math.exp(-rate * dt); }

const ALWAYS_ON = { pause: 1 }; /* g_ [src:pretty:L51744]：非 gameplay 仍可读 pause */
const NO_MOVE_RESULT = { onGround: false, hitWall: false, hitCeil: false, surface: "" };

export function createPlayerKit({
  physics,
  events = { on() {}, emit() {} },
  rng = Math.random, /* 注入签名对齐 combat-kit:26；本 kit 无随机源，恒不调用（确定性由构造保证） */
  tune = {},
  camera = null,
  groundSurfaceAt = null,
  getGamepads = null,
  externalAds = null,
  now = null,
} = {}) {
  if (!physics) throw new Error("player-kit requires physics (physics-kit instance or compatible moveCapsule)");
  const TUNE = {
    ...PLAYER_TUNE_DEFAULTS,
    ...tune,
    stride: { ...PLAYER_TUNE_DEFAULTS.stride, ...((tune && tune.stride) || {}) },
  };
  const DIMS = PLAYER_DIMS;
  /* rC = √(2·gravity·jumpApex) [src:pretty:L52171]：apex 是调参旋钮，g 只改滞空时间 */
  const jumpSpeed = Math.sqrt(2 * TUNE.gravity * TUNE.jumpApex);
  const clockFn = now || (() => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now()));

  /* ---- 计数器（stats() 真源；热循环内只做原地自增） ---- */
  const counters = {
    jumps: 0, steps: 0, lands: 0, hitsTaken: 0, deaths: 0, rescues: 0,
    fallDamage: 0, regenHealed: 0, healed: 0, distance: 0, maxFallSpeed: 0,
    airTimeMax: 0, wallHits: 0, lockRequests: 0, modeSwitches: 0,
  };

  /* ---- 后处理 uniform 馈送 [src:pretty:L52506-L52507]（原地更新，供 post-chain 读） ---- */
  const post = { damage: 0, lowHealth: 0, ads: 0 };

  /* ---- 预分配事件载荷（复用；消费方须同步读取） ---- */
  const EVT_JUMP = { pos: null };
  const EVT_LAND = { speed: 0, surface: "concrete", pos: null };
  const EVT_STEP = { surface: "concrete", sprint: false, pos: null };
  const EVT_HIT = { amount: 0, fromPos: null };
  const EVT_DEAD = {};
  const EVT_RESCUED = {};
  const EVT_LOCK = { locked: false };
  const EVT_MODE = { mode: "lock" };

  /* ======================================================================
   * 输入系统（上游 v_ [src:pretty:L51745-L52132]）
   * 三模态：lock（pointer-lock 键鼠）/ drag（捕获不可用的边缘转向回退）/ touch；
   * 手柄为正交通道（gamepad 旗标），move 三源叠加钳制单位圆。
   * ==================================================================== */
  const srcKey = new Set();
  const srcMouse = new Set();
  const srcTouch = new Set();
  const srcPad = new Set();
  const srcSets = { key: srcKey, mouse: srcMouse, touch: srcTouch, pad: srcPad };
  const downSet = new Set();
  const pressSet = new Set();
  const modeCbs = [];

  let everLocked = false;
  let failCount = 0;
  let lockRequestedAt = 0;
  let adsToggle = false;      /* j：触屏 ADS 自锁 [src:pretty:L51953-L51955] */
  let padMoveX = 0;           /* re */
  let padMoveY = 0;           /* $ */
  let stickX = 0;
  let stickY = 0;
  let stickOn = false;
  let dragX = 0.5;
  let dragY = 0.5;
  let dragInside = false;
  let lastTouchAt = -1e9;
  let lockImpl = null;
  let exitImpl = null;
  let detachFns = null;
  /* attach 内部触屏指针状态 */
  let stickId = -1;
  let stickPxX = 0;
  let stickPxY = 0;
  let lookId = -1;
  let lookPxX = 0;
  let lookPxY = 0;

  const input = {
    move: { x: 0, y: 0 },
    look: { dx: 0, dy: 0 },
    fire: false,
    ads: false,
    sprint: false,
    crouch: false,
    locked: false,
    touch: false,
    gamepad: false,
    sensitivity: 1,
    invertY: false,
    mode: "lock",
    gameplay: false,

    down(action) { return downSet.has(action) && (input.gameplay || ALWAYS_ON[action] === 1); },
    pressed(action) { return pressSet.has(action) && (input.gameplay || ALWAYS_ON[action] === 1); },

    /* ---- 喂入 API（attach 之外的可编程/测试路径，语义与 DOM 事件一致） ---- */
    key(code, isDown) {
      const action = KEY_ACTIONS[code];
      if (action) setSource("key", action, isDown);
    },
    mouseMove(dx, dy) { /* mousemove：movement 累积（drag 模式另记光标位置） [src:pretty:L51856-L51868] */
      if (!input.gameplay) return;
      if (!(input.locked || input.mode === "drag")) return;
      if (Math.abs(dx) > INPUT_SCALES.mouseJumpGuard || Math.abs(dy) > INPUT_SCALES.mouseJumpGuard) return;
      input.look.dx += dx * INPUT_SCALES.mouse * input.sensitivity;
      input.look.dy += dy * INPUT_SCALES.mouse * input.sensitivity * (input.invertY ? -1 : 1);
    },
    cursor(x01, y01, inside) { dragX = x01; dragY = y01; dragInside = !!inside; },
    mouseButton(btn, isDown) { /* g() [src:pretty:L51840] */
      const action = btn === 0 ? "fire" : btn === 2 ? "ads" : btn === 1 ? "melee" : null;
      setSource("mouse", action, isDown);
    },
    setLock(isLocked) { /* pointerlockchange [src:pretty:L51869-L51878] */
      input.locked = !!isLocked;
      if (input.locked) {
        everLocked = true;
        lockRequestedAt = 0;
        failCount = 0;
        if (!input.touch) setMode("lock");
      } else {
        srcMouse.clear();
        downSet.delete("fire");
        downSet.delete("ads");
        for (const action of srcKey) downSet.add(action);
      }
      EVT_LOCK.locked = input.locked;
      events.emit("input:lock", EVT_LOCK);
    },
    requestLock() { /* A() [src:pretty:L51889-L51906]：真实 DOM 调用仅在 attach 后 */
      if (input.touch || input.locked) return false;
      lockRequestedAt = clockFn();
      counters.lockRequests += 1;
      if (lockImpl) return lockImpl();
      return true; /* 可编程路径：调用方随后 setLock(true) 或 lockFailed() */
    },
    lockFailed() { /* m() [src:pretty:L51886-L51888]：仅从未成功锁定过才回退 drag */
      lockRequestedAt = 0;
      if (!input.locked && !input.touch) {
        failCount += 1;
        if (!everLocked) setMode("drag");
      }
    },
    exitLock() { if (exitImpl) exitImpl(); },
    beginTouch() { /* K() [src:pretty:L51992-L52000]：首次触控即切换模态 */
      if (!input.touch) {
        input.touch = true;
        if (input.locked) input.setLock(false); /* 有 DOM 时 exitLock 会经 pointerlockchange 走同一路径 */
        else input.exitLock();
        setMode("touch");
      }
    },
    stick(x, y) { stickX = clampN(x, -1, 1); stickY = clampN(y, -1, 1); stickOn = true; },
    stickEnd() { stickX = 0; stickY = 0; stickOn = false; },
    touchLook(dx, dy) { /* Q() [src:pretty:L51989-L51991] */
      input.look.dx += dx * INPUT_SCALES.touch * input.sensitivity;
      input.look.dy += dy * INPUT_SCALES.touch * input.sensitivity * (input.invertY ? -1 : 1);
    },
    touchButton(action, isDown) { setSource("touch", action, isDown); },
    adsToggleNext() { adsToggle = !adsToggle; return adsToggle; }, /* 触屏 ADS 自锁键 [src:pretty:L51953] */

    setGameplay(on) { /* setGameplay [src:pretty:L51780-L51782] */
      const next = !!on;
      if (next !== input.gameplay) {
        input.gameplay = next;
        if (!next) clearSources();
      }
    },
    onModeChange(cb) { if (typeof cb === "function") modeCbs.push(cb); },
    describeMode() { /* [src:pretty:L51789-L51797] */
      if (input.mode === "touch") return "触屏操作已启用";
      if (input.mode === "drag") return "鼠标捕获不可用：移动鼠标调整视角，停在屏幕边缘持续转向；点击开火；方向键或 IJKL 也可转向";
      return input.locked ? "鼠标已捕获，按 Esc 释放" : "点击游戏画面以捕获鼠标";
    },

    update: updateInput,
    endFrame() { /* B() [src:pretty:L52128-L52130] */
      pressSet.clear();
      input.look.dx = 0;
      input.look.dy = 0;
    },
    attach,
    detach,
  };

  function setMode(next) { /* p() [src:pretty:L51799-L51809] */
    if (input.mode === next) return;
    input.mode = next;
    counters.modeSwitches += 1;
    for (const cb of modeCbs) {
      try { cb(next); } catch (err) { console.error(err); }
    }
    EVT_MODE.mode = next;
    events.emit("input:mode", EVT_MODE);
  }

  function setSource(src, action, isDown) { /* d() [src:pretty:L51810-L51820]：多源去重 + 边沿 */
    if (!action) return;
    const set = srcSets[src];
    if (isDown) {
      if (set.has(action)) return;
      set.add(action);
      if (!downSet.has(action)) { downSet.add(action); pressSet.add(action); }
    } else {
      if (!set.delete(action)) return;
      if (!srcKey.has(action) && !srcMouse.has(action) && !srcTouch.has(action) && !srcPad.has(action)) downSet.delete(action);
    }
  }

  function clearSources() { /* v() [src:pretty:L51821-L51824] */
    srcKey.clear();
    srcMouse.clear();
    srcTouch.clear();
    srcPad.clear();
    downSet.clear();
    adsToggle = false;
    input.stickEnd();
  }

  function padDeadzone(v) { /* ue() [src:pretty:L52065-L52068] */
    const a = Math.abs(v);
    return a < INPUT_SCALES.padDeadzone ? 0 : (Math.sign(v) * (a - INPUT_SCALES.padDeadzone)) / (1 - INPUT_SCALES.padDeadzone);
  }

  function pollPads(dt) { /* me() [src:pretty:L52069-L52098] */
    padMoveX = 0;
    padMoveY = 0;
    if (!getGamepads) return;
    let pads;
    try { pads = getGamepads(); } catch { getGamepads = null; return; }
    let pad = null;
    if (pads) {
      for (let i = 0; i < pads.length; i += 1) {
        const p = pads[i];
        if (p && p.connected && p.mapping === "standard") { pad = p; break; }
      }
    }
    if (!pad) {
      if (input.gamepad) { input.gamepad = false; srcPad.clear(); }
      return;
    }
    input.gamepad = true;
    padMoveX = padDeadzone(pad.axes[0] || 0);
    padMoveY = -padDeadzone(pad.axes[1] || 0);
    const lx = padDeadzone(pad.axes[2] || 0);
    const ly = padDeadzone(pad.axes[3] || 0);
    if (input.gameplay) {
      input.look.dx += lx * Math.abs(lx) * INPUT_SCALES.pad * dt * input.sensitivity;
      input.look.dy += ly * Math.abs(ly) * INPUT_SCALES.pad * 0.7 * dt * input.sensitivity * (input.invertY ? -1 : 1);
    }
    for (const idx in GAMEPAD_BUTTONS) {
      const btn = pad.buttons[idx];
      setSource("pad", GAMEPAD_BUTTONS[idx], !!btn && (btn.pressed || btn.value > INPUT_SCALES.padButton));
    }
  }

  function updateInput(dt) { /* ee() [src:pretty:L52099-L52127] */
    pollPads(dt);
    if (lockRequestedAt && clockFn() - lockRequestedAt > 1200 && !input.locked) input.lockFailed();
    if (input.mode === "drag" && input.gameplay && dragInside && !input.locked) { /* 边缘持续转向 */
      const ex = dragX < 0.12 ? -(0.12 - dragX) / 0.12 : dragX > 0.88 ? (dragX - 0.88) / 0.12 : 0;
      const ey = dragY < 0.1 ? -(0.1 - dragY) / 0.1 : dragY > 0.9 ? (dragY - 0.9) / 0.1 : 0;
      input.look.dx += ex * 2.4 * dt * input.sensitivity;
      input.look.dy += ey * 1.2 * dt * input.sensitivity * (input.invertY ? -1 : 1);
    }
    let mx = 0;
    let my = 0;
    let sprintHeld = false;
    if (input.gameplay) {
      mx = (downSet.has("right") ? 1 : 0) - (downSet.has("left") ? 1 : 0);
      my = (downSet.has("forward") ? 1 : 0) - (downSet.has("back") ? 1 : 0);
      sprintHeld = downSet.has("sprint");
      if (stickOn) {
        mx += stickX;
        my += stickY;
        if (Math.hypot(stickX, stickY) > 0.93 && stickY > 0.8) sprintHeld = true; /* 摇杆满推自动冲刺 */
      }
      mx += padMoveX;
      my += padMoveY;
      const len = Math.hypot(mx, my);
      if (len > 1) { mx /= len; my /= len; }
      const turn = (downSet.has("turnR") ? 1 : 0) - (downSet.has("turnL") ? 1 : 0);
      const tilt = (downSet.has("turnD") ? 1 : 0) - (downSet.has("turnU") ? 1 : 0);
      if (turn) input.look.dx += turn * INPUT_SCALES.keyTurn * dt;
      if (tilt) input.look.dy += tilt * INPUT_SCALES.keyTurn * 0.6 * dt;
    }
    input.move.x = mx;
    input.move.y = my;
    input.fire = input.gameplay && downSet.has("fire");
    input.ads = input.gameplay && (downSet.has("ads") || adsToggle);
    input.sprint = input.gameplay && sprintHeld;
    input.crouch = input.gameplay && downSet.has("crouch");
  }

  /* ---- attach：真实 DOM 接线（setup 期分配；热路径仍走上面的零分配喂入） ---- */
  function attach(target) {
    if (!target || (typeof document === "undefined" && !target.ownerDocument)) return () => {};
    const doc = target.ownerDocument || document;
    const win = doc.defaultView || (typeof window !== "undefined" ? window : null);
    if (!win) return () => {};
    detachFns = [];
    const on = (el, ev, fn, opts) => {
      el.addEventListener(ev, fn, opts);
      detachFns.push(() => el.removeEventListener(ev, fn, opts));
    };

    lockImpl = () => { /* [src:pretty:L51889-L51906] */
      if (!target.requestPointerLock) { input.lockFailed(); return false; }
      try {
        const p = target.requestPointerLock();
        if (p && p.catch) p.catch(() => input.lockFailed());
      } catch { input.lockFailed(); }
      try { target.focus({ preventScroll: true }); } catch { /* 无焦点环境 */ }
      return true;
    };
    exitImpl = () => {
      try { if (doc.pointerLockElement) doc.exitPointerLock(); } catch { /* 已退出 */ }
    };

    /* 键盘 [src:pretty:L51825-L51839] */
    on(win, "keydown", (e) => {
      const action = KEY_ACTIONS[e.code];
      if (!action) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
      if (t && t.tagName === "BUTTON" && (e.code === "Space" || e.code === "Enter" || e.code === "NumpadEnter")) return;
      if (input.gameplay && (e.code === "Space" || e.code.startsWith("Arrow") || e.code === "ControlLeft")) e.preventDefault();
      if (!e.repeat) input.key(e.code, true);
    });
    on(win, "keyup", (e) => input.key(e.code, false));
    on(win, "blur", clearSources);

    /* 鼠标 [src:pretty:L51841-L51885] */
    on(target, "mousedown", (e) => {
      if (input.touch && clockFn() - lastTouchAt < 800) return;
      if (!input.gameplay) return;
      if (!input.locked && input.mode === "lock") { input.requestLock(); e.preventDefault(); return; }
      input.mouseButton(e.button, true);
      e.preventDefault();
    });
    on(doc, "mouseup", (e) => input.mouseButton(e.button, false));
    on(doc, "contextmenu", (e) => { if (e.target === target || input.gameplay) e.preventDefault(); });
    on(doc, "mousemove", (e) => {
      if (input.mode === "drag") input.cursor(e.clientX / Math.max(1, win.innerWidth), e.clientY / Math.max(1, win.innerHeight), true);
      input.mouseMove(e.movementX || 0, e.movementY || 0);
    });
    on(doc, "mouseleave", () => { dragInside = false; });
    on(doc, "pointerlockchange", () => input.setLock(doc.pointerLockElement === target));
    on(doc, "pointerlockerror", () => input.lockFailed());

    /* 触屏：window 首触切模态；target 上左 45% 摇杆 / 右侧视角 [src:pretty:L52004-L52049] */
    on(win, "touchstart", () => { lastTouchAt = clockFn(); input.beginTouch(); }, { passive: true, capture: true });
    on(target, "touchstart", (e) => {
      e.preventDefault();
      lastTouchAt = clockFn();
      if (!input.gameplay) return;
      for (const t of e.changedTouches) {
        if (t.clientX < win.innerWidth * 0.45 && stickId < 0) {
          stickId = t.identifier;
          stickPxX = t.clientX;
          stickPxY = t.clientY;
          input.stick(0, 0);
        } else if (lookId < 0) {
          lookId = t.identifier;
          lookPxX = t.clientX;
          lookPxY = t.clientY;
        }
      }
    }, { passive: false });
    on(target, "touchmove", (e) => {
      e.preventDefault();
      if (!input.gameplay) return;
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) {
          let dx = t.clientX - stickPxX;
          let dy = t.clientY - stickPxY;
          const len = Math.hypot(dx, dy);
          if (len > INPUT_SCALES.stickRadius) {
            dx *= INPUT_SCALES.stickRadius / len;
            dy *= INPUT_SCALES.stickRadius / len;
          }
          input.stick(dx / INPUT_SCALES.stickRadius, -dy / INPUT_SCALES.stickRadius);
        } else if (t.identifier === lookId) {
          input.touchLook(t.clientX - lookPxX, t.clientY - lookPxY);
          lookPxX = t.clientX;
          lookPxY = t.clientY;
        }
      }
    }, { passive: false });
    const touchEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) { stickId = -1; input.stickEnd(); } else if (t.identifier === lookId) lookId = -1;
      }
    };
    on(target, "touchend", touchEnd, { passive: false });
    on(target, "touchcancel", touchEnd, { passive: false });
    on(target, "contextmenu", (e) => e.preventDefault());

    /* 手柄轮询源 */
    if (!getGamepads && typeof navigator !== "undefined" && navigator.getGamepads) {
      getGamepads = () => navigator.getGamepads();
    }
    return input.detach;
  }

  function detach() {
    if (!detachFns) return;
    for (const fn of detachFns) fn();
    detachFns = null;
    lockImpl = null;
    exitImpl = null;
  }

  /* ======================================================================
   * 玩家控制器（上游 x_ [src:pretty:L52172-L52510]）
   * ==================================================================== */
  const player = {
    pos: { x: 0, y: 0, z: 0 },
    eye: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    forward: { x: 0, y: 0, z: -1 },
    lastSafe: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    health: 100,
    maxHealth: 100,
    alive: true,
    onGround: true,
    sprinting: false,
    crouching: false,
    ads: 0,
    speed: 0,
    enabled: true,
    invulnerable: false,
    baseFov: DIMS.fov,
    hurtPulse: 0,
    lookScale: 1,
    tuning: TUNE,
    /* 每帧写回的相机/观感状态（未注入 camera 也可读） */
    viewPitch: 0,
    viewYaw: 0,
    viewRoll: 0,
    fov: DIMS.fov,
    hitWall: false,
    hitCeil: false,
    phase: 0,          /* stride 相位 h [src:pretty:L52423-L52429] */
    bob: { amp: 0, x: 0, y: 0 },
    dip: { x: 0, v: 0 }, /* 落地下沉弹簧 g [src:pretty:L52469-L52473] */
    shake: 0,
    reset,
    damage: applyDamage,
    heal,
    addRecoil,
    addShake,
    setFov,
    update,
  };

  /* 控制器内部状态（对照上游 x_ 闭包变量） */
  let capsuleH = TUNE.standHeight; /* o */
  let wasGround = true;            /* l：兼作 moveCapsule 的 step 旗标 [src:pretty:L52391] */
  let coyoteT = 0;                 /* r */
  let bufferT = 0;                 /* a */
  let airT = 0;                    /* c */
  let peakFall = 0;                /* u */
  let bobAmp = 0;                  /* f */
  let bobYOff = 0;                 /* d */
  let bobXOff = 0;                 /* p */
  let strafeRoll = 0;              /* v */
  let noDamageT = 99;              /* E：regen 计时 [src:pretty:L52438-L52439] */
  let deadT = 0;                   /* z */
  let hurtW = 0;                   /* w */
  let lowHealthS = 0;              /* S */
  let eyeH = DIMS.eye;             /* s */
  let recoilPitchS = 0;            /* x */
  let recoilYawS = 0;              /* y */
  let recoilPitchV = 0;            /* b */
  let recoilYawV = 0;              /* m */
  let recoilHoldT = 0;             /* A */
  let shakeAmp = 0;                /* _ */
  let shakeClock = 0;              /* M */
  let fovCur = DIMS.fov;           /* H */
  let lastSurface = "concrete";    /* q */

  function surfaceAt() { /* j() [src:pretty:L52322-L52334] */
    try {
      if (typeof groundSurfaceAt === "function") {
        const s = groundSurfaceAt(player.pos.x, player.pos.z);
        if (s) return s;
      }
    } catch { /* 注入回调异常回落 */ }
    return lastSurface || "concrete";
  }

  function canStand() { /* G() 站立净空 [src:pretty:L52304-L52321] */
    const boxes = physics.boxes;
    if (!boxes) return true;
    const r = DIMS.radius * 0.9;
    const yLow = player.pos.y + TUNE.crouchHeight - 0.05;
    const yHigh = player.pos.y + TUNE.standHeight;
    for (let i = 0; i < boxes.length; i += 1) {
      const b = boxes[i];
      if (b.bulletOnly) continue;
      if (player.pos.x + r < b.min.x || player.pos.x - r > b.max.x || player.pos.z + r < b.min.z || player.pos.z - r > b.max.z) continue;
      if (b.min.y < yHigh && b.max.y > yLow) return false;
    }
    return true;
  }

  function reset(start) { /* [src:pretty:L52228-L52264] */
    const s = start || { pos: { x: 0, y: 0, z: 0 }, yaw: 0 };
    player.pos.x = s.pos.x;
    player.pos.y = s.pos.y;
    player.pos.z = s.pos.z;
    player.yaw = s.yaw || 0;
    player.pitch = 0;
    player.vel.x = 0;
    player.vel.y = 0;
    player.vel.z = 0;
    player.health = player.maxHealth;
    player.alive = true;
    player.onGround = true;
    player.sprinting = false;
    player.crouching = false;
    player.invulnerable = false;
    player.speed = 0;
    eyeH = DIMS.eye;
    capsuleH = TUNE.standHeight;
    coyoteT = 0;
    bufferT = 0;
    wasGround = true;
    airT = 0;
    peakFall = 0;
    player.phase = 0;
    bobAmp = 0;
    bobYOff = 0;
    bobXOff = 0;
    strafeRoll = 0;
    player.dip.x = 0;
    player.dip.v = 0;
    recoilPitchS = 0;
    recoilYawS = 0;
    recoilPitchV = 0;
    recoilYawV = 0;
    recoilHoldT = 0;
    noDamageT = 99;
    hurtW = 0;
    lowHealthS = 0;
    deadT = 0;
    shakeAmp = 0;
    shakeClock = 0;
    lastSurface = "concrete";
    player.hurtPulse = 0;
    player.lastSafe.x = player.pos.x;
    player.lastSafe.y = player.pos.y;
    player.lastSafe.z = player.pos.z;
    cameraUpdate(0);
    hudUpdate(0);
  }

  function applyDamage(amount, fromPos) { /* damage() [src:pretty:L52265-L52275] */
    if (!player.alive || player.invulnerable || !(amount > 0)) return false;
    player.health = Math.max(0, player.health - amount);
    noDamageT = 0;
    hurtW = Math.min(1, hurtW + 0.35 + amount / 40);
    addShake(0.22 + amount / 70);
    counters.hitsTaken += 1;
    EVT_HIT.amount = amount;
    EVT_HIT.fromPos = fromPos || null;
    events.emit("player:hit", EVT_HIT);
    if (player.health <= 0) {
      player.alive = false;
      deadT = 0;
      player.sprinting = false;
      counters.deaths += 1;
      events.emit("player:dead", EVT_DEAD);
    }
    return true;
  }

  function heal(amount) { /* [src:pretty:L52276-L52278] */
    if (!player.alive || !(amount > 0)) return player.health;
    const before = player.health;
    player.health = Math.min(player.maxHealth, player.health + amount);
    counters.healed += player.health - before;
    return player.health;
  }

  function addRecoil(pitch = 0, yaw = 0) { /* [src:pretty:L52279-L52288]：weapon-kit 调用 */
    const keep = TUNE.recoilKeep;
    player.pitch = clampN(player.pitch + pitch * keep, -TUNE.pitchLimit, TUNE.pitchLimit);
    player.yaw += yaw * keep;
    recoilPitchS = clampN(recoilPitchS + pitch * (1 - keep), -0.3, 0.3);
    recoilYawS = clampN(recoilYawS + yaw * (1 - keep), -0.2, 0.2);
    recoilHoldT = TUNE.recoilHold;
  }

  function addShake(amount = 0.3) { shakeAmp = Math.min(1, shakeAmp + amount); } /* [src:pretty:L52289-L52291] */
  function setFov(v) { player.baseFov = clampN(+v || DIMS.fov, 55, 100); } /* [src:pretty:L52292-L52294] */

  /* ---- 主更新 N(F) [src:pretty:L52335-L52442] ---- */
  function update(dt) {
    const ext = externalAds ? externalAds() : null;
    if (typeof ext === "number") player.ads = clamp01N(ext);
    else player.ads = dampN(player.ads, player.enabled && input.ads ? 1 : 0, 14, dt);

    if (!player.alive) {
      deadT += dt;
      deadUpdate(dt);
      cameraUpdate(dt);
      hudUpdate(dt);
      return;
    }

    const active = player.enabled;
    player.lookScale = lerpN(1, TUNE.adsLook, player.ads);
    if (active) {
      player.yaw -= input.look.dx * player.lookScale;
      player.pitch = clampN(player.pitch - input.look.dy * player.lookScale, -TUNE.pitchLimit, TUNE.pitchLimit);
      if (player.yaw > Math.PI * 4 || player.yaw < -Math.PI * 4) player.yaw %= Math.PI * 2;
    }
    if (active && input.crouch) player.crouching = true;
    else if (player.crouching && canStand()) player.crouching = false;
    capsuleH = player.crouching ? TUNE.crouchHeight : TUNE.standHeight;

    const strafe = active ? input.move.x : 0;
    const fwd = active ? input.move.y : 0;
    const moving = strafe * strafe + fwd * fwd > 0.01;
    const wantSprint = active && input.sprint && fwd > 0.55 && Math.abs(strafe) < 0.6
      && !player.crouching && player.ads < 0.35 && !input.fire;
    player.sprinting = (wantSprint && player.onGround && player.speed > TUNE.walk * 0.6)
      || (wantSprint && !player.onGround && player.sprinting);

    let target = TUNE.walk;
    if (player.crouching) target = TUNE.crouch;
    else if (wantSprint) target = TUNE.sprint;
    target = lerpN(target, Math.min(target, TUNE.ads), player.ads);
    if (fwd < 0) target *= lerpN(1, 0.82, -fwd);

    const sy = Math.sin(player.yaw);
    const cy = Math.cos(player.yaw);
    const wishX = (strafe * cy - fwd * sy) * target;
    const wishZ = (-strafe * sy - fwd * cy) * target;

    const accel = player.onGround ? (moving ? TUNE.accelGround : TUNE.decelGround) : moving ? TUNE.accelAir : 0.6;
    let dx = wishX - player.vel.x;
    let dz = wishZ - player.vel.z;
    if (!player.onGround && !moving) { dx = -player.vel.x; dz = -player.vel.z; }
    const dLen = Math.hypot(dx, dz);
    const stepA = accel * dt;
    if (dLen <= stepA || dLen < 1e-6) {
      if (player.onGround || moving) { player.vel.x = wishX; player.vel.z = wishZ; }
    } else {
      player.vel.x += (dx / dLen) * stepA;
      player.vel.z += (dz / dLen) * stepA;
    }

    /* coyote / jumpBuffer 宽容输入 [src:pretty:L52376-L52387] */
    coyoteT = player.onGround ? TUNE.coyote : Math.max(0, coyoteT - dt);
    bufferT = active && input.pressed("jump") ? TUNE.jumpBuffer : Math.max(0, bufferT - dt);
    if (bufferT > 0 && coyoteT > 0 && (!player.crouching || canStand())) {
      player.vel.y = jumpSpeed;
      bufferT = 0;
      coyoteT = 0;
      player.onGround = false;
      player.crouching = false;
      capsuleH = TUNE.standHeight;
      counters.jumps += 1;
      EVT_JUMP.pos = player.pos;
      events.emit("player:jump", EVT_JUMP);
    }
    player.vel.y -= TUNE.gravity * dt * 0.5;
    if (player.vel.y < -40) player.vel.y = -40;

    /* moveCapsule 对接 physics-kit：step 旗标用上一帧落地态 [src:pretty:L52390-L52392] */
    const preVelY = player.vel.y;
    const R = physics.moveCapsule(player.pos, player.vel, dt, DIMS.radius, capsuleH, wasGround) || NO_MOVE_RESULT;
    if (!R.onGround) player.vel.y -= TUNE.gravity * dt * 0.5;

    const bounds = physics.bounds;
    const region = bounds && bounds.region;
    if (region) {
      player.pos.x = clampN(player.pos.x, region.minX + 0.4, region.maxX - 0.4);
      player.pos.z = clampN(player.pos.z, region.minZ + 0.4, region.maxZ - 0.4);
    }
    player.onGround = !!R.onGround;
    player.hitWall = !!R.hitWall;
    player.hitCeil = !!R.hitCeil;
    if (R.hitWall) counters.wallHits += 1;
    if (R.surface) lastSurface = R.surface;

    if (player.onGround) {
      if (!wasGround && airT > 0.12) { /* 落地：landDip 弹簧 + 硬着陆伤害 + 事件 [src:pretty:L52402-L52409] */
        const impact = Math.max(0, -preVelY, peakFall);
        player.dip.v -= Math.min(impact * TUNE.landDip, 3.2);
        if (impact > 7.5) addShake(Math.min(0.5, (impact - 7.5) * 0.06));
        if (impact > counters.maxFallSpeed) counters.maxFallSpeed = impact;
        counters.lands += 1;
        EVT_LAND.speed = impact;
        EVT_LAND.surface = surfaceAt();
        EVT_LAND.pos = player.pos;
        events.emit("player:land", EVT_LAND);
        if (impact > 13) {
          const dmg = (impact - 13) * 7;
          counters.fallDamage += dmg;
          applyDamage(dmg, null);
        }
        player.phase = 0.35;
      }
      airT = 0;
      peakFall = 0;
      if (bounds && bounds.quayX !== undefined && player.pos.x <= bounds.quayX - 1.2 && player.pos.y > -0.5) {
        player.lastSafe.x = player.pos.x;
        player.lastSafe.y = player.pos.y;
        player.lastSafe.z = player.pos.z;
      } else if (!bounds || bounds.quayX === undefined) {
        player.lastSafe.x = player.pos.x;
        player.lastSafe.y = player.pos.y;
        player.lastSafe.z = player.pos.z;
      }
    } else {
      airT += dt;
      peakFall = Math.max(peakFall, -player.vel.y);
      if (airT > counters.airTimeMax) counters.airTimeMax = airT;
    }
    wasGround = player.onGround;

    /* 落水救援：回 lastSafe + 12 伤 [src:pretty:L52413-L52421] */
    if (bounds && bounds.seaY !== undefined && player.pos.y < bounds.seaY - 2.2) {
      player.pos.x = player.lastSafe.x;
      player.pos.y = player.lastSafe.y;
      player.pos.z = player.lastSafe.z;
      player.vel.x = 0;
      player.vel.y = 0;
      player.vel.z = 0;
      player.onGround = true;
      wasGround = true;
      shakeAmp = 0.6;
      player.yaw += Math.PI;
      counters.rescues += 1;
      applyDamage(12, null);
      events.emit("player:rescued", EVT_RESCUED);
    }
    player.speed = Math.hypot(player.vel.x, player.vel.z);
    counters.distance += player.speed * dt;

    /* stride 相位 → 脚步事件（相位整越触发，与步态天然同步） [src:pretty:L52423-L52429] */
    const stride = player.crouching ? TUNE.stride.crouch : player.sprinting ? TUNE.stride.sprint : TUNE.stride.walk;
    if (player.onGround && player.speed > 0.5) {
      const prev = player.phase;
      player.phase += (player.speed * dt) / stride;
      if (Math.floor(player.phase) > Math.floor(prev)) {
        counters.steps += 1;
        EVT_STEP.surface = surfaceAt();
        EVT_STEP.sprint = player.sprinting;
        EVT_STEP.pos = player.pos;
        events.emit("player:step", EVT_STEP);
      }
    } else if (player.onGround) {
      player.phase = dampN(player.phase, Math.round(player.phase), 8, dt);
    }

    /* 相机 bob [src:pretty:L52430-L52435] 与横滚 [src:pretty:L52436-L52437] */
    const bobTarget = player.onGround
      ? clamp01N(player.speed / TUNE.walk) * (player.sprinting ? TUNE.bobSprint : 1) * lerpN(1, TUNE.bobAds, player.ads) * (player.crouching ? 0.7 : 1)
      : 0;
    bobAmp = dampN(bobAmp, bobTarget, 9, dt);
    bobYOff = -Math.cos(player.phase * Math.PI * 2) * TUNE.bobY * bobAmp;
    bobXOff = Math.sin(player.phase * Math.PI) * TUNE.bobX * bobAmp;
    player.bob.amp = bobAmp;
    player.bob.x = bobXOff;
    player.bob.y = bobYOff;

    const strafeVel = player.vel.x * cy - player.vel.z * sy;
    strafeRoll = dampN(strafeRoll, (-strafeVel / TUNE.sprint) * TUNE.rollStrafe * lerpN(1, 0.4, player.ads), 8, dt);

    /* 生命回复：受伤 regenDelay 秒后按 regenRate 回 [src:pretty:L52438-L52439] */
    noDamageT += dt;
    if (noDamageT > TUNE.regenDelay && player.health < player.maxHealth) {
      const before = player.health;
      player.health = Math.min(player.maxHealth, player.health + TUNE.regenRate * dt);
      counters.regenHealed += player.health - before;
    }

    cameraUpdate(dt);
    hudUpdate(dt);
  }

  /* ---- 死亡路径 Q(F) [src:pretty:L52443-L52455] ---- */
  function deadUpdate(dt) {
    player.vel.x = dampN(player.vel.x, 0, 5, dt);
    player.vel.z = dampN(player.vel.z, 0, 5, dt);
    player.vel.y -= TUNE.gravity * dt;
    try {
      const R = physics.moveCapsule(player.pos, player.vel, dt, DIMS.radius, 0.6, wasGround);
      wasGround = !!(R && R.onGround);
    } catch { /* 无胶囊环境 */ }
    const seaY = physics.bounds && physics.bounds.seaY;
    if (seaY !== undefined && player.pos.y < seaY - 1) {
      player.pos.y = seaY - 1;
      player.vel.y = 0;
    }
    player.speed = 0;
    player.sprinting = false;
    bobAmp = dampN(bobAmp, 0, 10, dt);
    bobXOff *= 0.9;
    bobYOff *= 0.9;
  }

  /* ---- 相机 K(F) [src:pretty:L52456-L52501]：眼高/下沉/后坐/抖动/fov/前进向量 ---- */
  function cameraUpdate(dt) {
    let eyeTarget = player.crouching ? DIMS.crouchEye : DIMS.eye;
    let deadPitchAdd = 0;
    let deadRollAdd = 0;
    if (player.alive) {
      eyeH = dt > 0 ? dampN(eyeH, eyeTarget, TUNE.eyeRate, dt) : eyeTarget;
    } else {
      const z = smoothstepN(0, 0.85, deadT);
      const j = z * z;
      eyeTarget = lerpN(DIMS.eye, 0.22, j);
      eyeH = dampN(eyeH, eyeTarget, 18, dt);
      deadPitchAdd = 1.15 * j;
      deadRollAdd = -0.25 * z + 0.12 * Math.sin(z * Math.PI);
    }
    if (dt > 0) {
      const acc = -player.dip.x * 150 - player.dip.v * 17; /* landDip 弹簧（刚度 150 / 阻尼 17） */
      player.dip.v += acc * dt;
      player.dip.x += player.dip.v * dt;
      player.dip.x = clampN(player.dip.x, -TUNE.landDipMax, 0.05);
      recoilHoldT -= dt;
      if (recoilHoldT <= 0) {
        recoilPitchS = dampN(recoilPitchS, 0, TUNE.recoilRecover, dt);
        recoilYawS = dampN(recoilYawS, 0, TUNE.recoilRecover, dt);
      }
      recoilPitchV = dampN(recoilPitchV, recoilPitchS, TUNE.recoilApply, dt);
      recoilYawV = dampN(recoilYawV, recoilYawS, TUNE.recoilApply, dt);
      shakeAmp = Math.max(0, shakeAmp - TUNE.shakeDecay * dt);
      shakeClock += dt;
    }
    player.shake = shakeAmp;
    const sy = Math.sin(player.yaw);
    const cy = Math.cos(player.yaw);
    player.eye.x = player.pos.x + bobXOff * cy;
    player.eye.y = player.pos.y + eyeH + bobYOff + player.dip.x;
    player.eye.z = player.pos.z - bobXOff * sy;
    player.viewPitch = clampN(player.pitch + recoilPitchV, -1.55, 1.55);
    player.viewYaw = player.yaw + recoilYawV;
    const s2 = shakeAmp * shakeAmp;
    const t = shakeClock;
    const shP = s2 * TUNE.shakePitch * (Math.sin(t * 43.1) + 0.6 * Math.sin(t * 71.7 + 1.3));
    const shY = s2 * TUNE.shakeYaw * (Math.sin(t * 37.3 + 2.1) + 0.6 * Math.sin(t * 83.9));
    const shR = s2 * TUNE.shakeRoll * (Math.sin(t * 29.7 + 0.7) + 0.5 * Math.sin(t * 61.3 + 4));
    player.viewRoll = strafeRoll + shR + deadRollAdd + bobXOff * 0.35;
    player.forward.x = -Math.sin(player.viewYaw) * Math.cos(player.viewPitch);
    player.forward.y = Math.sin(player.viewPitch);
    player.forward.z = -Math.cos(player.viewYaw) * Math.cos(player.viewPitch);
    const fovTarget = lerpN(player.baseFov + (player.sprinting ? TUNE.fovSprint : 0), TUNE.fovAds, player.ads);
    fovCur = dt > 0 ? dampN(fovCur, fovTarget, player.ads > 0.02 && player.ads < 0.98 ? 30 : 7, dt) : fovTarget;
    player.fov = fovCur;
    if (camera) {
      camera.position.set(player.eye.x, player.eye.y, player.eye.z);
      if (camera.rotation) {
        camera.rotation.order = "YXZ";
        camera.rotation.set(player.viewPitch + shP + deadPitchAdd + player.dip.x * 0.12, player.viewYaw + shY, player.viewRoll);
      }
      if (camera.__fovLocked !== true && camera.fov !== undefined && Math.abs(camera.fov - fovCur) > 0.01) {
        camera.fov = fovCur;
        if (typeof camera.updateProjectionMatrix === "function") camera.updateProjectionMatrix();
      }
    }
  }

  /* ---- HUD/后处理馈送 ie(F) [src:pretty:L52502-L52508] ---- */
  function hudUpdate(dt) {
    hurtW = Math.max(0, hurtW - dt * 1.9);
    player.hurtPulse = hurtW;
    const lowTarget = player.alive ? smoothstepN(0.55, 0.12, player.health / player.maxHealth) : 1;
    lowHealthS = dt > 0 ? dampN(lowHealthS, lowTarget, 4, dt) : lowTarget;
    post.damage = hurtW;
    post.lowHealth = lowHealthS;
    post.ads = player.ads;
  }

  player.reset({ pos: { x: 0, y: 0, z: 0 }, yaw: 0 });

  /* ---- stats()：按需快照（对象分配不进热循环） ---- */
  const TUNE_TOP_COUNT = Object.keys(TUNE).length;
  const TUNE_STRIDE_COUNT = Object.keys(TUNE.stride).length;
  function stats() {
    return {
      /* 数量口径（上游实数对齐，见文件头） */
      tuneFields: TUNE_TOP_COUNT + TUNE_STRIDE_COUNT,
      keyMapEntries: Object.keys(KEY_ACTIONS).length,
      padButtonEntries: Object.keys(GAMEPAD_BUTTONS).length,
      inputModes: INPUT_MODES.length,
      /* 输入态 */
      mode: input.mode,
      locked: input.locked,
      touch: input.touch,
      gamepad: input.gamepad,
      gameplay: input.gameplay,
      /* 玩家态 */
      health: player.health,
      alive: player.alive,
      onGround: player.onGround,
      speed: player.speed,
      distance: counters.distance,
      /* 事件计数（热循环内原地自增） */
      ...counters,
    };
  }

  /* ======================================================================
   * selfTest：node 离线自证（stub 世界，零依赖、确定性）
   * ==================================================================== */
  function stubWorld({ groundY = 0, seaY, boxes = [] } = {}) {
    const bx = boxes;
    const bounds = {
      groundY,
      seaY: seaY === undefined ? -1e9 : seaY,
      quayX: 1e9,
      region: { minX: -64, minZ: -64, maxX: 64, maxZ: 64 },
    };
    function moveCapsule(pos, vel, dt, radius, height, step) {
      const result = { onGround: false, hitWall: false, hitCeil: false, surface: "concrete" };
      pos.x += vel.x * dt;
      pos.z += vel.z * dt;
      const stepTop = pos.y + (step ? 0.55 : 0.08);
      for (let i = 0; i < bx.length; i += 1) {
        const b = bx[i];
        if (b.bulletOnly) continue;
        if (b.max.y <= stepTop || b.min.y >= pos.y + height) continue;
        const cx = clampN(pos.x, b.min.x, b.max.x);
        const cz = clampN(pos.z, b.min.z, b.max.z);
        const ox = pos.x - cx;
        const oz = pos.z - cz;
        const d2 = ox * ox + oz * oz;
        if (d2 >= radius * radius) continue;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          const push = radius - d;
          const nx = ox / d;
          const nz = oz / d;
          pos.x += nx * push;
          pos.z += nz * push;
          const into = vel.x * nx + vel.z * nz;
          if (into < 0) { vel.x -= nx * into; vel.z -= nz * into; }
        } else {
          const dl = [pos.x - b.min.x, b.max.x - pos.x, pos.z - b.min.z, b.max.z - pos.z];
          const m = Math.min(dl[0], dl[1], dl[2], dl[3]);
          if (m === dl[0]) pos.x = b.min.x - radius;
          else if (m === dl[1]) pos.x = b.max.x + radius;
          else if (m === dl[2]) pos.z = b.min.z - radius;
          else pos.z = b.max.z + radius;
        }
        result.hitWall = true;
      }
      let ground = groundY;
      let surface = null;
      const pad = radius * 0.7;
      for (let i = 0; i < bx.length; i += 1) {
        const b = bx[i];
        if (b.bulletOnly) continue;
        if (pos.x + pad < b.min.x || pos.x - pad > b.max.x || pos.z + pad < b.min.z || pos.z - pad > b.max.z) continue;
        if (b.max.y <= stepTop && b.max.y > ground) { ground = b.max.y; surface = b.surface || "concrete"; }
      }
      const ty = pos.y + vel.y * dt;
      if (vel.y <= 0 && ty <= ground) {
        pos.y = ground;
        vel.y = 0;
        result.onGround = true;
        result.surface = surface || "concrete";
      } else {
        pos.y = ty;
      }
      return result;
    }
    return { boxes: bx, bounds, moveCapsule };
  }

  function selfTest() {
    const checks = [];
    const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail === undefined ? "" : String(detail) });
    const DT = 1 / 60;
    const ev = () => {
      const log = [];
      return { log, on() {}, emit(name, payload) { log.push({ name, payload }); } };
    };
    const makeKit = (opts = {}) => {
      const bus = ev();
      const kit = createPlayerKit({ physics: opts.physics || stubWorld(), events: bus, ...opts });
      kit.input.setGameplay(true);
      return { kit, bus };
    };
    const frame = (kit, feed, n = 1, dt = DT) => {
      for (let i = 0; i < n; i += 1) {
        if (feed) feed(i);
        kit.input.update(dt);
        kit.player.update(dt);
        kit.input.endFrame();
      }
    };

    /* 1. Mt 数值逐字段对上游 [src:pretty:L52133-L52170] */
    {
      const expect = {
        walk: 3.8, sprint: 6.4, crouch: 1.9, ads: 2.4, accelGround: 34, decelGround: 26, accelAir: 9,
        gravity: 21, jumpApex: 1, coyote: 0.12, jumpBuffer: 0.13, standHeight: 1.8, crouchHeight: 1.15,
        eyeRate: 11, bobY: 0.024, bobX: 0.013, bobSprint: 1.9, bobAds: 0.22, rollStrafe: 0.02,
        landDip: 0.36, landDipMax: 0.2, fovSprint: 6, fovAds: 52, adsLook: 0.6, regenDelay: 4,
        regenRate: 25, recoilKeep: 0.35, recoilApply: 34, recoilRecover: 6.5, recoilHold: 0.09,
        shakeDecay: 1.7, shakePitch: 0.03, shakeYaw: 0.03, shakeRoll: 0.045, pitchLimit: 1.5,
      };
      let bad = "";
      for (const k in expect) if (PLAYER_TUNE_DEFAULTS[k] !== expect[k]) bad += k + ",";
      check(
        "Mt 调参表逐字段对上游（36 顶层 + stride 3 子字段）",
        !bad && PLAYER_TUNE_DEFAULTS.stride.walk === 1.55 && PLAYER_TUNE_DEFAULTS.stride.sprint === 2.1
          && PLAYER_TUNE_DEFAULTS.stride.crouch === 1.05 && Object.keys(PLAYER_TUNE_DEFAULTS).length === 36,
        bad || "36+3",
      );
    }

    /* 2. 调参不改逻辑：jumpApex 是行为旋钮，apex 随表翻倍 */
    {
      const apexOf = (tune) => {
        const { kit } = makeKit({ tune });
        let max = 0;
        const feed = () => { kit.input.key("Space", true); };
        /* 先站 1 帧再跳：feed 只按一次 */
        frame(kit, null, 2);
        let jumped = false;
        for (let i = 0; i < 90; i += 1) {
          if (!jumped) { kit.input.key("Space", true); jumped = true; }
          kit.input.update(DT);
          kit.player.update(DT);
          kit.input.endFrame();
          if (kit.player.pos.y > max) max = kit.player.pos.y;
        }
        return max;
      };
      const a1 = apexOf(undefined);
      const a2 = apexOf({ jumpApex: 2 });
      check("调参不改逻辑：jumpApex 1→2 顶点随之 1m→2m（同一代码路径）", a1 > 0.85 && a1 < 1.15 && a2 > 1.8 && a2 < 2.2, `apex1=${a1.toFixed(3)} apex2=${a2.toFixed(3)}`);
    }

    /* 3. 键鼠模态：WASD 归一 + gameplay 门 + pause 常通 */
    {
      const { kit } = makeKit();
      kit.input.key("KeyW", true);
      kit.input.key("KeyD", true);
      kit.input.update(DT);
      const diag = Math.SQRT1_2;
      const okDiag = Math.abs(kit.input.move.x - diag) < 1e-9 && Math.abs(kit.input.move.y - diag) < 1e-9;
      kit.input.setGameplay(false);
      kit.input.key("Escape", true);
      kit.input.update(DT);
      check("键鼠模态：对角归一 √2/2、gameplay 关闭归零、pause 常通", okDiag && kit.input.move.x === 0 && kit.input.move.y === 0 && kit.input.down("pause") === true, "");
    }

    /* 4. pointer-lock 视角：累积 ×0.0021×灵敏度、invertY、endFrame 清零、pitchLimit */
    {
      const { kit } = makeKit();
      kit.input.setLock(true);
      kit.input.mouseMove(100, 50);
      const dx1 = kit.input.look.dx;
      const dy1 = kit.input.look.dy;
      kit.input.endFrame();
      const { kit: kitInv } = makeKit();
      kitInv.input.sensitivity = 2;
      kitInv.input.invertY = true;
      kitInv.input.setLock(true);
      kitInv.input.mouseMove(100, 50);
      check(
        "pointer-lock 视角：0.0021 缩放累积、endFrame 清零",
        Math.abs(dx1 - 100 * 0.0021) < 1e-12 && Math.abs(dy1 - 50 * 0.0021) < 1e-12 && kit.input.look.dx === 0
          && Math.abs(kitInv.input.look.dy - (-50 * 0.0021 * 2)) < 1e-12,
        "",
      );
      const { kit: kitPitch } = makeKit();
      kitPitch.input.setLock(true);
      kitPitch.input.sensitivity = 100;
      kitPitch.player.update(DT); /* 初始落地帧 */
      for (let i = 0; i < 40; i += 1) { kitPitch.input.mouseMove(0, 400); kitPitch.input.update(DT); kitPitch.player.update(DT); kitPitch.input.endFrame(); }
      check("pitchLimit 1.5 钳制（持续俯视不打穿）", Math.abs(Math.abs(kitPitch.player.pitch) - 1.5) < 1e-9, `pitch=${kitPitch.player.pitch.toFixed(4)}`);
    }

    /* 5. lock 失败回退 drag：从未成功锁定才回退；曾锁定保持 lock；drag 边缘转向 */
    {
      const { kit } = makeKit();
      kit.input.requestLock();
      kit.input.lockFailed();
      const fallback = kit.input.mode === "drag";
      kit.input.cursor(0.95, 0.5, true); /* drag 模式：光标停在右缘持续转向 */
      kit.input.update(1);
      const edge = kit.input.look.dx;
      const { kit: kitEver } = makeKit();
      kitEver.input.requestLock();
      kitEver.input.setLock(true);
      kitEver.input.setLock(false);
      kitEver.input.lockFailed();
      check(
        "捕获失败回退：未锁过→drag；锁过→保持 lock；drag 边缘持续转向",
        fallback && kitEver.input.mode === "lock" && edge > 1.3 && edge < 1.5,
        `mode=${kit.input.mode}/${kitEver.input.mode} edge=${edge.toFixed(3)}`,
      );
    }

    /* 6. 触屏模态：beginTouch 切换、摇杆归一、满推自动冲刺、touchLook 缩放 */
    {
      const { kit } = makeKit();
      kit.input.setLock(true);
      kit.input.beginTouch();
      const modeOk = kit.input.touch === true && kit.input.mode === "touch" && kit.input.locked === false;
      kit.input.stick(0.7, 0.7);
      kit.input.update(DT);
      const nx = kit.input.move.x; /* 取值拷贝：move 是复用对象，下个 update 会改写 */
      const ny = kit.input.move.y;
      kit.input.stick(0, 1);
      kit.input.update(DT);
      const sprintAuto = kit.input.sprint === true;
      kit.input.touchLook(10, 4);
      check(
        "触屏模态：首触切换、摇杆归一、满推自动冲刺、0.0052 视角缩放",
        modeOk && Math.abs(nx - 0.7) < 1e-9 && Math.abs(ny - 0.7) < 1e-9 && sprintAuto
          && Math.abs(kit.input.look.dx - 10 * 0.0052) < 1e-12,
        "",
      );
    }

    /* 7. 手柄模态：死区 0.16、轴符号翻转、标准按键映射、|x|·x 曲线 */
    {
      let pad = { connected: true, mapping: "standard", axes: [0.15, -1, 0.5, 0], buttons: [] };
      const { kit } = makeKit({ getGamepads: () => [pad] });
      kit.input.update(DT);
      const moveOk = kit.input.move.x === 0 && kit.input.move.y === 1; /* axes[0]=0.15 死区归零；axes[1]=-1 → forward +1 */
      const dz = (0.5 - 0.16) / 0.84; /* 死区先重标定再走 |x|·x 曲线 */
      const lookOk = Math.abs(kit.input.look.dx - dz * dz * 3 * DT) < 1e-12;
      pad = { connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons: [{ pressed: true, value: 1 }] };
      kit.input.update(DT);
      const btnOk = kit.input.pressed("jump") === true;
      pad.buttons[0] = { pressed: false, value: 0.3 };
      kit.input.update(DT);
      check(
        "手柄模态：死区 .16、axes[1] 上推为 forward、按钮 0→jump、阈值 .4",
        moveOk && lookOk && btnOk && kit.input.down("jump") === false && kit.input.gamepad === true,
        `move=(${kit.input.move.x},${kit.input.move.y})`,
      );
    }

    /* 8. 三源叠加钳制单位圆 */
    {
      let pad = { connected: true, mapping: "standard", axes: [1, 1, 0, 0], buttons: [] };
      const { kit } = makeKit({ getGamepads: () => [pad] });
      kit.input.key("KeyD", true);
      kit.input.key("KeyW", true);
      kit.input.stick(1, 1);
      kit.input.update(DT);
      const len = Math.hypot(kit.input.move.x, kit.input.move.y);
      check("三模态叠加钳制：键盘+手柄+摇杆合成不超单位圆", len <= 1 + 1e-12, `len=${len.toFixed(6)}`);
    }

    /* 9. coyote 0.12：0.05s 仍可跳 / 0.15s 不可跳 */
    {
      const platform = stubWorld({
        groundY: -10,
        boxes: [{ min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 0, z: 1 }, surface: "concrete" }],
      });
      const { kit, bus } = makeKit({ physics: platform });
      frame(kit, null, 2);
      kit.player.pos.z = -1.5; /* 走出平台边缘，坠入 -10 深坑 */
      frame(kit, null, 3); /* 0.05s */
      kit.input.key("Space", true);
      frame(kit, null, 1);
      const earlyJumps = bus.log.filter((e) => e.name === "player:jump").length;
      const { kit: kit2, bus: bus2 } = makeKit({ physics: platform });
      frame(kit2, null, 2);
      kit2.player.pos.z = -1.5;
      frame(kit2, null, 9); /* 0.15s */
      kit2.input.key("Space", true);
      frame(kit2, null, 30);
      const lateJumps = bus2.log.filter((e) => e.name === "player:jump").length;
      check("coyote 0.12s：离地 0.05s 可跳、0.15s 不可跳", earlyJumps === 1 && lateJumps === 0, `early=${earlyJumps} late=${lateJumps}`);
    }

    /* 10. jumpBuffer 0.13：落地前预按，落地后 ≤2 帧起跳 */
    {
      const { kit, bus } = makeKit();
      kit.player.pos.y = 3;
      let pressed = false;
      for (let i = 0; i < 40; i += 1) {
        if (i === 29 && !pressed) { kit.input.key("Space", true); pressed = true; }
        kit.input.update(DT);
        kit.player.update(DT);
        kit.input.endFrame();
        if (kit.player.pos.y > 0.5 && i > 33) break; /* 落地后再起跳 */
      }
      const jumps = bus.log.filter((e) => e.name === "player:jump").length;
      check("jumpBuffer 0.13s：预按缓存，落地 1-2 帧内起跳", jumps === 1 && kit.player.pos.y > 0.5, `jumps=${jumps} y=${kit.player.pos.y.toFixed(2)}`);
    }

    /* 11. 脚步事件：stride 相位整越触发，载荷 {surface, sprint, pos} */
    {
      const { kit, bus } = makeKit();
      kit.input.key("KeyW", true);
      kit.input.key("ShiftLeft", true);
      frame(kit, null, 120); /* 2s 冲刺 */
      const steps = bus.log.filter((e) => e.name === "player:step");
      const last = steps.length ? steps[steps.length - 1].payload : null;
      const cadenceOk = steps.length >= 3 && steps.length <= 8; /* 2s × 6.4m/s ≈ 12m ÷ stride 2.1m ≈ 6 步（含加速斜坡） */
      check(
        "脚步事件：2s 冲刺 3-8 步、载荷 surface/sprint/pos 齐备",
        cadenceOk && last && last.surface === "concrete" && last.sprint === true && last.pos === kit.player.pos,
        `steps=${steps.length}`,
      );
    }

    /* 12. 落地：landDip 弹簧 + 硬着陆伤害公式 (impact-13)×7 */
    {
      const drop = (h) => {
        const { kit, bus } = makeKit();
        kit.player.pos.y = h;
        let landSpeed = null;
        let dipMin = 0;
        let landed = false;
        for (let i = 0; i < 200; i += 1) {
          kit.input.update(DT);
          kit.player.update(DT);
          kit.input.endFrame();
          if (!landed && bus.log.some((e) => e.name === "player:land")) {
            landed = true;
            landSpeed = bus.log.find((e) => e.name === "player:land").payload.speed;
          }
          if (kit.player.dip.x < dipMin) dipMin = kit.player.dip.x;
        }
        return { landSpeed, dipMin, health: kit.player.health };
      };
      const soft = drop(3);
      const softOk = soft.landSpeed !== null && soft.landSpeed > 10.5 && soft.landSpeed < 12
        && soft.dipMin < -0.001 && soft.dipMin >= -0.2 - 1e-9 && soft.health === 100;
      const hard = drop(8);
      const hardExpect = 100 - (hard.landSpeed - 13) * 7;
      const hardOk = hard.landSpeed > 17 && Math.abs(hard.health - hardExpect) < 1e-6 && hard.health < 65;
      check("落地事件：3m 无伤下陷 ≤0.2m；8m 触发 (impact-13)×7 摔伤", softOk && hardOk, `soft=${soft.landSpeed && soft.landSpeed.toFixed(2)}/${soft.dipMin.toFixed(3)} hard=${hard.landSpeed && hard.landSpeed.toFixed(2)}→${hard.health.toFixed(1)}`);
    }

    /* 13. 生命回复：damage 40 → 5s 后 ≈ 60+25 */
    {
      const { kit } = makeKit();
      frame(kit, null, 2);
      kit.player.damage(40, null);
      const h0 = kit.player.health;
      frame(kit, null, 300); /* 5s：4s regenDelay + 1s 回复 */
      check("生命回复：regenDelay 4s 后按 25/s 回满路径", h0 === 60 && kit.player.health > 84 && kit.player.health < 86, `60→${kit.player.health.toFixed(2)}`);
    }

    /* 14. 海面救援：掉海回 lastSafe、-12 伤、yaw+π */
    {
      const sea = stubWorld({
        groundY: -10,
        seaY: -2.2,
        boxes: [{ min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 0, z: 1 }, surface: "quay" }],
      });
      const { kit, bus } = makeKit({ physics: sea });
      frame(kit, null, 2); /* lastSafe = 平台 */
      const yaw0 = kit.player.yaw;
      kit.player.pos.x = 5; /* 出平台坠海 */
      frame(kit, null, 60);
      const rescued = bus.log.some((e) => e.name === "player:rescued");
      check(
        "落水救援：回 lastSafe + 12 伤 + yaw+π",
        rescued && Math.abs(kit.player.pos.x) < 1e-9 && Math.abs(kit.player.health - 88) < 1e-9 && Math.abs(kit.player.yaw - yaw0 - Math.PI) < 1e-9,
        `pos=(${kit.player.pos.x.toFixed(2)},${kit.player.pos.y.toFixed(2)}) hp=${kit.player.health}`,
      );
    }

    /* 15. moveCapsule 对接：墙滑停靠 + 0.5m step-up（记录途中最高点，避免走穿箱子后读数） */
    {
      const wallWorld = stubWorld({ boxes: [{ min: { x: 2, y: -1, z: -1 }, max: { x: 4, y: 2, z: 1 }, surface: "metal" }] });
      const { kit: kW } = makeKit({ physics: wallWorld });
      kW.input.key("KeyD", true);
      frame(kW, null, 150);
      const wallOk = kW.player.pos.x <= 2 - 0.32 + 0.02 && kW.player.pos.x > 1.4 && Math.abs(kW.player.pos.z) < 1e-6 && kW.stats().wallHits > 0;
      const stepWorld = stubWorld({ boxes: [{ min: { x: 1.5, y: 0, z: -1 }, max: { x: 3, y: 0.5, z: 1 }, surface: "wood" }] });
      const { kit: kS } = makeKit({ physics: stepWorld });
      kS.input.key("KeyD", true);
      let stepMaxY = 0;
      frame(kS, () => { if (kS.player.pos.y > stepMaxY) stepMaxY = kS.player.pos.y; }, 45);
      check("胶囊对接：贴墙停靠半径 0.32、0.5m 台阶 step-up", wallOk && stepMaxY > 0.49, `wall x=${kW.player.pos.x.toFixed(3)} stepMaxY=${stepMaxY.toFixed(3)}`);
    }

    /* 16. 确定性：同输入脚本两遍逐位一致；tune 覆盖走同逻辑但轨迹不同 */
    {
      const script = (kit) => {
        const out = [];
        kit.player.reset({ pos: { x: 0, y: 0, z: 0 }, yaw: 0 });
        for (let i = 0; i < 180; i += 1) {
          if (i < 60) kit.input.key("KeyW", true);
          else kit.input.key("KeyW", false);
          if (i >= 20 && i < 25) kit.input.key("ShiftLeft", true);
          if (i === 25) kit.input.key("ShiftLeft", false);
          if (i === 40) kit.input.key("Space", true);
          if (i === 41) kit.input.key("Space", false);
          if (i >= 80 && i < 140) kit.input.mouseMove(6, -2);
          kit.input.update(DT);
          kit.player.update(DT);
          kit.input.endFrame();
          out.push(kit.player.pos.x, kit.player.pos.y, kit.player.pos.z, kit.player.vel.x, kit.player.vel.y, kit.player.vel.z, kit.player.yaw, kit.player.pitch);
        }
        return out;
      };
      const a = script(makeKit().kit);
      const b = script(makeKit().kit);
      const c = script(makeKit({ tune: { walk: 7.6 } }).kit);
      let same = a.length === b.length;
      for (let i = 0; same && i < a.length; i += 1) if (a[i] !== b[i]) same = false;
      let diff = false;
      for (let i = 0; !diff && i < a.length; i += 1) if (a[i] !== c[i]) diff = true;
      check("确定性：同脚本两遍逐位相等；改 walk 调参轨迹不同", same && diff, `n=${a.length} same=${same} tuneDiff=${diff}`);
    }

    const failed = checks.filter((c) => !c.ok).map((c) => c.name);
    return { pass: failed.length === 0, checks, failed, checkCount: checks.length };
  }

  return {
    TUNE,
    DIMS,
    jumpSpeed,
    input,
    player,
    post,
    stats,
    selfTest,
    reset(start) { player.reset(start); },
    resetStats() {
      counters.jumps = 0; counters.steps = 0; counters.lands = 0; counters.hitsTaken = 0;
      counters.deaths = 0; counters.rescues = 0; counters.fallDamage = 0; counters.regenHealed = 0;
      counters.healed = 0; counters.distance = 0; counters.maxFallSpeed = 0; counters.airTimeMax = 0;
      counters.wallHits = 0; counters.lockRequests = 0; counters.modeSwitches = 0;
    },
  };
}

/* ============================== 模块级自检 ============================== */

/**
 * 模块级自检（node 可跑，无 DOM）：用最小 stub 物理构造实例，跑实例 selfTest。
 * 返回 { ok, checks, failed }，与 props/fx/audio/hud/enemy 的模块级入口同形。
 */
export function selfTest() {
  const physics = {
    raycast() { return null; },
    groundHeight() { return 0; },
    moveCapsule() {
      return { onGround: true, hitWall: false, hitCeil: false, surface: "concrete" };
    },
  };
  const result = createPlayerKit({ physics }).selfTest();
  return { ok: !!result.pass, checks: result.checks, failed: result.failed };
}
