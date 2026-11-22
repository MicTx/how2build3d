/**
 * inspect-deck.mjs — 九展厅自检框架（「摄影棚」的通用蒸馏）
 *
 * 出处：自 Saltline 的 `?show=` 展厅系统移植/抽象：
 *   - 注册表九键：  [src:pretty:L59271-L59271]
 *   - show 分派：   [src:pretty:L59318-L59319]
 *   - __setShot：   [src:pretty:L59331-L59331]
 *   - stub 世界：   [src:pretty:L59357-L59357]
 *   - showcase():  [src:pretty:L59393-L59393] / [src:pretty:L59478-L59480]
 *
 * 设计约束：
 *   1. 场景只提供「展台注册表」；框架负责 URL 解析、展台引导、机位与外部截图接口。
 *   2. 未知 show 一律回落 null（正常场景），不报错——与上游同构。
 *   3. 不依赖 three.js：相机/曝光由 ctx 注入，可在任意 WebGL 场景复用。
 *
 * CLI 使用见 harness/gates/inspect.mjs；场景接入示例见 examples/quality/src/inspect.mjs。
 */

// 浏览器镜像自 harness/constants.mjs 的 GALLERIES，由 `node harness/gates/consistency.mjs --all` 判等。
// 本文件被构建脚本按文本 toScript 内联（无 ESM 运行时），因此不能新增 import；此处是唯一允许保留的镜像。
export const INSPECT_GALLERIES = ["mats", "props", "enemies", "weapon", "fx", "render", "ground", "backdrop", "level"];

/**
 * 解析展厅相关的 URL 参数。
 * @param {string} search location.search（可传空串）
 * @returns {{show: string|null, shot: boolean, bench: boolean, cam: number[]|null, fov: number|null, exposure: number|null, dt: number|null, noweapon: boolean}}
 */
export function readInspectMode(search) {
  const params = new URLSearchParams(search || "");
  let cam = null;
  const rawCam = params.get("cam");
  if (rawCam) {
    const nums = rawCam.split(",").map(Number);
    if (nums.length >= 3 && nums.every((n) => Number.isFinite(n))) cam = nums;
  }
  const num = (key) => (params.has(key) ? Number(params.get(key)) : null);
  return {
    show: params.get("show") || null,
    shot: params.has("shot"),
    bench: params.has("bench"),
    cam,
    fov: num("fov"),
    exposure: num("exposure"),
    dt: num("dt"),
    noweapon: params.has("noweapon"),
  };
}

/**
 * 创建展厅控制器。
 * @param {{galleries?: Object<string, {cam?: number[], target?: number[], setup?: Function}|Function>, stub?: Function}} options
 *   galleries: 展台注册表；每个条目是 `{cam,target,setup(ctx)}` 或直接一个 setup 函数。
 *   stub: 进入任意展台前的最小世界（80×80 地面 + 最小模块），可选。
 */
export function createInspectDeck({ galleries = {}, stub = null } = {}) {
  const deck = {
    galleries,

    has(name) {
      return Object.prototype.hasOwnProperty.call(galleries, name) && Boolean(name);
    },

    list() {
      return INSPECT_GALLERIES.map((id) => ({ id, available: deck.has(id) }));
    },

    /**
     * 按 mode.show 引导展台。返回 {name, cam, target, update} 或 null（非展厅模式/未知展台）。
     */
    boot(ctx, mode = {}) {
      const name = mode && mode.show;
      if (!name || !deck.has(name)) {
        ctx.showcase = null;
        return null;
      }
      const gallery = galleries[name];
      const entry = typeof gallery === "function" ? { setup: gallery } : gallery || {};
      ctx.showcase = name;
      if (typeof window !== "undefined") {
        window.__INSPECT_DECK__ = { version: 1, mode: name, galleries: Object.keys(galleries) };
        // 外部截图接口由框架统一安装：场景不需要自己接线，验收脚本可直接 __setShot({cam,fov,exposure})。
        // 出处：[src:pretty:L59331-L59331]
        window.__setShot = (shot) => deck.setShot(ctx, shot || {});
      }
      if (typeof stub === "function") stub(ctx, name);
      const info = (typeof entry.setup === "function" ? entry.setup(ctx, name) : null) || {};
      const cam = info.cam || entry.cam || null;
      const target = info.target || entry.target || null;
      const shot = { cam, target, fov: info.fov != null ? info.fov : mode.fov, exposure: info.exposure != null ? info.exposure : mode.exposure };
      if (shot.cam || shot.fov || shot.exposure != null) deck.setShot(ctx, shot);
      return { ...info, name, cam, target, update: info.update || entry.update || null };
    },

    /** 外部截图接口：__setShot({cam:[x,y,z], target:[x,y,z], fov, exposure}) */
    setShot(ctx, shot = {}) {
      const camera = ctx.camera || (ctx.render && ctx.render.camera) || null;
      if (camera && Array.isArray(shot.cam) && shot.cam.length >= 3) {
        camera.position.set(shot.cam[0], shot.cam[1], shot.cam[2]);
        const look = Array.isArray(shot.target) && shot.target.length >= 3 ? shot.target : [0, 1, 0];
        camera.lookAt(look[0], look[1], look[2]);
      }
      if (camera && shot.fov) {
        camera.fov = Number(shot.fov);
        camera.updateProjectionMatrix();
      }
      if (shot.exposure != null && ctx.render && "exposure" in ctx.render) {
        ctx.render.exposure = Number(shot.exposure);
      }
    },

    manifest() {
      return { version: 1, galleries: deck.list(), mode: typeof window !== "undefined" ? window.__INSPECT_DECK__ || null : null };
    },
  };
  return deck;
}
