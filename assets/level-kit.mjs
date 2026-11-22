/**
 * level-kit.mjs — 关卡装配与零件对账（布局手写、构建期对账、碰撞注册）。
 *
 * 出处：
 *   - 关卡数据 schema（playerStart/objectives/enemySpawns/zones/extraction/groundSurfaceAt…）：
 *     [src:pretty:L59358-L59374]
 *   - 道具目录 PROP_SIZES（注册表即目录）：[src:pretty:L35067-L35068]
 *
 * 合同：
 *   - `validateLayout(catalog, layout)`：未知道具名 / 零件数不符 / 重复放置 → 抛错（对账即门禁）。
 *   - `createLevelKit(THREE, {catalog, layout, physics, materials})`：建网格组、注册 AABB 碰撞、
 *     返回九件套数据 + `stats`（道具/零件/碰撞盒计数）+ `showcase()`（level/props 展厅数据源）。
 */

export function validateLayout(catalog, layout) {
  const items = Array.isArray(layout) ? layout : (layout && layout.items);
  if (!Array.isArray(items)) throw new Error("layout must be an array or {items, meta}");
  const meta = Array.isArray(layout) ? {} : (layout.meta || {});
  const seen = new Set();
  for (const item of items) {
    if (!item || typeof item !== "object") throw new Error("layout item must be an object");
    const entry = catalog[item.prop];
    if (!entry) throw new Error(`unknown prop: ${item.prop}`);
    if (!Array.isArray(item.at) || item.at.length !== 3 || !item.at.every((n) => Number.isFinite(n))) {
      throw new Error(`bad placement for ${item.prop}: at must be [x,y,z]`);
    }
    if (entry.parts != null && item.parts != null && Number(entry.parts) !== Number(item.parts)) {
      throw new Error(`parts mismatch for ${item.prop}: catalog ${entry.parts} != layout ${item.parts}`);
    }
    const key = `${item.prop}@${item.at.join(",")}`;
    if (seen.has(key)) throw new Error(`duplicate placement: ${key}`);
    seen.add(key);
  }
  return { items, meta };
}

export function createLevelKit(THREE, { catalog = {}, layout = [], physics = null, materials = null } = {}) {
  const { items, meta } = validateLayout(catalog, layout);
  const group = new THREE.Group();
  group.name = "h2b-level";
  const stats = { props: 0, parts: 0, colliders: 0 };
  const materialCache = new Map();

  const materialOf = (name) => {
    if (materials && materials[name]) return materials[name];
    if (!materialCache.has(name)) {
      materialCache.set(name, new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.82, metalness: 0.08 }));
    }
    return materialCache.get(name);
  };

  for (const item of items) {
    const entry = catalog[item.prop];
    const size = entry.size || [1, 1, 1];
    const ry = item.rot && item.rot[1] ? item.rot[1] : 0;
    const halfW = Math.abs(Math.cos(ry)) * size[0] / 2 + Math.abs(Math.sin(ry)) * size[2] / 2;
    const halfD = Math.abs(Math.sin(ry)) * size[0] / 2 + Math.abs(Math.cos(ry)) * size[2] / 2;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), materialOf(entry.material));
    mesh.position.set(item.at[0], item.at[1] + size[1] / 2, item.at[2]);
    mesh.rotation.set(item.rot ? item.rot[0] || 0 : 0, ry, item.rot ? item.rot[2] || 0 : 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    stats.props += 1;
    stats.parts += item.parts != null ? Number(item.parts) : (entry.parts != null ? Number(entry.parts) : 1);
    if (physics) {
      physics.addBox(
        { x: item.at[0] - halfW, y: item.at[1], z: item.at[2] - halfD },
        { x: item.at[0] + halfW, y: item.at[1] + size[1], z: item.at[2] + halfD },
        { surface: entry.surface || "concrete", tag: item.tag || item.prop },
      );
      stats.colliders += 1;
    }
  }

  const level = {
    playerStart: meta.playerStart || { pos: { x: 0, y: 0, z: 4 }, yaw: 0 },
    objectives: meta.objectives || [],
    enemySpawns: meta.enemySpawns || [],
    zones: meta.zones || [],
    interiorBoxes: meta.interiorBoxes || [],
    cinematicPath: meta.cinematicPath || [],
    extraction: meta.extraction || { pos: { x: 0, y: 0, z: 0 }, radius: 2 },
    groundSurfaceAt: typeof meta.groundSurfaceAt === "function" ? meta.groundSurfaceAt : () => "concrete",
    update() {},
  };

  /** 展厅数据源：level = 俯视取景；props = 目录清单 */
  function showcase(kind) {
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    if (kind === "level") {
      const radius = Math.max(size.x, size.z) * 0.75;
      return { cam: [center.x, center.y + radius, center.z + 0.01], target: [center.x, 0, center.z] };
    }
    return {
      cam: [center.x + size.x * 0.7, center.y + size.y * 0.9, center.z + size.z * 0.7],
      target: [center.x, center.y, center.z],
      catalog: Object.keys(catalog),
    };
  }

  return {
    group,
    catalog,
    items,
    stats,
    ...level,
    showcase,
  };
}
