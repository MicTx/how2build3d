/**
 * inspect.mjs — 九展厅注册表（装配顺序 #14）。每个展厅 = 可进入、可拍照的展台：
 * { cam, target, setup(ctx), update(t) }。协议见 references/08；框架 assets/inspect-deck.mjs。
 * 九厅全 used（tier=full 合同）：mats/props/enemies/weapon/fx/render/ground/backdrop/level。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.createInspectGalleries = function createInspectGalleries(ctx) {
  const { THREE, scene, camera, world, mats, sky, sea, ground, props, level, game, fx, weather } = ctx;

  const setAllVisible = (v) => {
    props.group.visible = v;
    level.group.visible = v;
    sea.mesh.visible = v;
  };
  const clearHelpers = () => {
    for (const c of helpers.children.slice()) { helpers.remove(c); }
  };
  const helpers = new THREE.Group();
  helpers.name = "h2b-inspect-helpers";
  helpers.visible = false;
  scene.add(helpers);

  /* mats 厅：SL 材质目录球墙（12 种代表性条目，triplanar） */
  const MAT_WALL = [
    "paint_red", "paint_teal", "paint_yellow", "hull_paint", "corrugated_roof",
    "concrete", "concrete_dirty", "steel_galv", "steel_rust", "wood_pallet",
    "hazard_stripes", "chainlink",
  ];

  let fxShowcaseT = 0;
  let fxEmitters = false;

  return {
    mats: {
      cam: [0, 2.9, 11.5],
      target: [0, 1.9, 0],
      setup() {
        setAllVisible(false);
        helpers.visible = true;
        clearHelpers();
        MAT_WALL.forEach((name, i) => {
          const mat = mats.surface.get(name, { triplanar: true });
          const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.58, 28, 20), mat);
          mesh.position.set(((i % 4) - 1.5) * 1.75, Math.floor(i / 4) * 1.6 + 1.55, 0);
          mesh.castShadow = true;
          helpers.add(mesh);
        });
        return { cam: [0, 2.9, 11.5], target: [0, 1.9, 0] };
      },
    },
    props: {
      setup() {
        setAllVisible(true);
        helpers.visible = false;
        clearHelpers();
        return { cam: [-4.5, 4.6, 3.5], target: [-14.5, 2.2, -6] };
      },
    },
    enemies: {
      setup() {
        setAllVisible(true);
        helpers.visible = false;
        if (game.enemies.stats().active < 2) {
          game.enemies.spawnAt(0, {});
          game.enemies.spawnAt(6, {});
        }
        return { cam: [-6, 2.4, -2], target: [-12, 1.1, -14] };
      },
    },
    weapon: {
      cam: [0.2, 1.62, 0.1],
      target: [-3, 1.25, -6],
      setup() {
        setAllVisible(true);
        helpers.visible = false;
        if (game.weapon.root.parent !== camera) camera.add(game.weapon.root);
        game.weapon.setVisible(true);
        return { cam: [0.2, 1.62, 0.1], target: [-3, 1.25, -6], fov: world.weaponCamera.fov };
      },
    },
    fx: {
      cam: [2, 1.8, 19],
      target: [-18, 1.1, 12],
      setup() {
        setAllVisible(true);
        helpers.visible = false;
        if (!fxEmitters) {
          fxEmitters = true;
          fx.addEmitter({ x: 20.6, y: 0.9, z: -16.6 }, "steam", {});
          fx.addEmitter({ x: -20.2, y: 0.4, z: 14.4 }, "embers", {});
          fx.addEmitter({ x: 31.1, y: 0.2, z: 6.2 }, "drip", {});
        }
        return { cam: [2, 1.8, 19], target: [-18, 1.1, 12] };
      },
      update(t) {
        fxShowcaseT += 1 / 60;
        if (fxShowcaseT > 2.2) {
          fxShowcaseT = 0;
          fx.explosion({ x: -24.2, y: 0.7, z: 8.2 }, {});
          fx.sparks({ x: -24.2, y: 0.9, z: 8.2 }, { x: 0, y: 1, z: 0 }, {});
        }
      },
    },
    render: {
      cam: [-15, 3.6, -14],
      target: [6, 2.4, 8],
      setup() {
        setAllVisible(true);
        helpers.visible = false;
        return { cam: [-15, 3.6, -14], target: [6, 2.4, 8] };
      },
    },
    ground: {
      cam: [3.5, 1.15, 9.5],
      target: [-9, 0.1, 8.5],
      setup() {
        setAllVisible(true);
        helpers.visible = false;
        return { cam: [3.5, 1.15, 9.5], target: [-9, 0.1, 8.5] };
      },
    },
    backdrop: {
      cam: [22, 4.2, 10],
      target: [110, 7, -14],
      setup() {
        setAllVisible(true);
        helpers.visible = false;
        return { cam: [22, 4.2, 10], target: [110, 7, -14], fov: 58 };
      },
    },
    level: {
      setup() {
        setAllVisible(true);
        helpers.visible = false;
        const box = new THREE.Box3().setFromObject(level.group);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const r = Math.max(size.x, size.z) * 0.78;
        return { cam: [center.x, center.y + r, center.z + 0.01], target: [center.x, 0, center.z] };
      },
    },
  };
};
