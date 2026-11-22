/**
 * quality/src/inspect.mjs — 九展厅注册表（quality 场景版）。
 *
 * 六厅 used：mats / props / ground / backdrop / render / level
 * 三厅 N/A：enemies / weapon / fx（本场景是静态质感样板，无战斗系统；理由见 inspect.manifest.json）
 *
 * 协议见 references/08-self-inspection.md；框架见 assets/inspect-deck.mjs。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.createInspectGalleries = function createInspectGalleries(THREE, ctx) {
  const { scene, mats } = ctx;
  const contentGroup = ctx.content && ctx.content.content ? ctx.content.content : ctx.content;
  const surface = mats.surface;
  const helpers = new THREE.Group();
  helpers.name = "h2b-inspect-helpers";
  helpers.visible = false;
  scene.add(helpers);

  const MATERIAL_WALL = [
    "steel_dark", "paint_yellow", "paint_red", "paint_blue", "paint_teal", "paint_green",
    "paint_orange", "hull_paint", "corrugated_roof", "concrete", "wood_pallet", "chainlink",
  ];

  function clearHelpers() {
    while (helpers.children.length) {
      const child = helpers.children.pop();
      helpers.remove(child);
      if (child.geometry) child.geometry.dispose();
    }
  }

  function addSphere(x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.55, 32, 24), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    helpers.add(mesh);
    return mesh;
  }

  function frameContent(padding = 0.9, topDown = false) {
    const box = new THREE.Box3().setFromObject(contentGroup);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.z) * padding;
    if (topDown) return { cam: [center.x, center.y + radius, center.z + 0.01], target: [center.x, 0, center.z] };
    return {
      cam: [center.x + radius * 0.75, center.y + size.y * 0.9, center.z + radius * 0.75],
      target: [center.x, center.y, center.z],
    };
  }

  return {
    mats: {
      cam: [0, 2.8, 9.5],
      target: [0, 1.9, 0],
      setup() {
        clearHelpers();
        helpers.visible = true;
        contentGroup.visible = false;
        MATERIAL_WALL.forEach((name, index) => {
          const material = surface.get(name, { triplanar: true });
          addSphere(((index % 4) - 1.5) * 1.7, Math.floor(index / 4) * 1.55 + 1.5, 0, material);
        });
      },
    },
    props: {
      setup() {
        clearHelpers();
        helpers.visible = false;
        contentGroup.visible = true;
        return frameContent(0.85);
      },
    },
    ground: {
      cam: [7, 1.6, 12],
      target: [3, 0, -2],
      setup() {
        clearHelpers();
        helpers.visible = false;
        contentGroup.visible = true;
      },
    },
    backdrop: {
      cam: [-14, 3.4, -10],
      target: [8, 12, -34],
      setup() {
        clearHelpers();
        helpers.visible = false;
        contentGroup.visible = true;
      },
    },
    render: {
      cam: [0, 2.4, 10],
      target: [0, 1.4, 0],
      setup() {
        clearHelpers();
        helpers.visible = true;
        contentGroup.visible = false;
        for (let row = 0; row < 2; row += 1) {
          for (let col = 0; col < 7; col += 1) {
            const material = new THREE.MeshStandardMaterial({
              color: row ? 0xb8b0a2 : 0x7c8a96,
              roughness: 0.06 + col * 0.13,
              metalness: row ? 0.05 : 0.85,
            });
            addSphere((col - 3) * 1.2, 1.1 + row * 1.25, 0, material);
          }
        }
      },
    },
    level: {
      setup() {
        clearHelpers();
        helpers.visible = false;
        contentGroup.visible = true;
        return frameContent(1.05, true);
      },
    },
  };
};
