/**
 * physics-kit.mjs — 世界查询与胶囊移动框架（纯 JS，零引擎依赖，可 node 自测）。
 *
 * 出处（逐行对照源实现，行为合同以源为准）：
 *   - 盒列表/旗标/地面海面平面：[src:pretty:L34676-L34676]
 *   - slab 射线：               [src:pretty:L34705-L34705]
 *   - lineOfSight：             [src:pretty:L34781-L34781]
 *   - groundHeight：            [src:pretty:L34786-L34786]
 *   - 扫掠胶囊（子步进/墙滑/step-up）：[src:pretty:L34810-L34810]
 *   - 导航网格（A*+拉直）：      [src:pretty:L34875-L34875]
 *
 * 确定性：kit 内零 Math.random——randomPoint 使用注入 rng（铁律 #5）。
 */

export function createPhysicsKit({
  bounds = { groundY: 0, seaY: -2, quayX: 1e9 },
  region = { minX: -64, minZ: -64, maxX: 64, maxZ: 64 },
  cell = 4,
  stepHeight = 0.55,
  agentPadding = 0.35,
  groundSurfaceAt = null,
  rng = Math.random,
} = {}) {
  const boxes = [];
  const world = {
    groundY: bounds.groundY,
    seaY: bounds.seaY,
    quayX: bounds.quayX,
    region: { ...region },
  };

  /* ---- 盒列表 ---- */
  function addBox(min, max, opts = {}) {
    const box = {
      min: { x: Math.min(min.x, max.x), y: Math.min(min.y, max.y), z: Math.min(min.z, max.z) },
      max: { x: Math.max(min.x, max.x), y: Math.max(min.y, max.y), z: Math.max(min.z, max.z) },
      surface: opts.surface || "concrete",
      tag: opts.tag || "",
      noNav: !!opts.noNav,
      bulletOnly: !!opts.bulletOnly,
      playerOnly: !!opts.playerOnly,
    };
    boxes.push(box);
    navDirty = true;
    return box;
  }

  function removeBox(box) {
    const index = boxes.indexOf(box);
    if (index >= 0) {
      boxes.splice(index, 1);
      navDirty = true;
    }
  }

  function build() {
    navDirty = true;
    rebuildNav();
  }

  /* ---- slab 射线（地面/海面平面优先，逐盒求交） ---- */
  function raycast(origin, dir, max = 500) {
    let best = max;
    let hitBox = null;
    let axis = -1;
    let sign = 0;
    let plane = 0;
    const ox = origin.x, oy = origin.y, oz = origin.z;
    const dx = dir.x, dy = dir.y, dz = dir.z;
    if (dy < -1e-6) {
      const tGround = (world.groundY - oy) / dy;
      if (tGround > 0 && tGround < best) {
        if (ox + dx * tGround <= world.quayX) {
          best = tGround; plane = 1;
        } else {
          const tSea = (world.seaY - oy) / dy;
          if (tSea > 0 && tSea < best) { best = tSea; plane = 2; }
        }
      }
    }
    const invX = dx === 0 ? Infinity : 1 / dx;
    const invY = dy === 0 ? Infinity : 1 / dy;
    const invZ = dz === 0 ? Infinity : 1 / dz;
    for (let i = 0; i < boxes.length; i += 1) {
      const box = boxes[i];
      if (box.playerOnly) continue;
      let tMin = 0;
      let tMax = best;
      let enterAxis = -1;
      let enterSign = 0;
      const axes = [
        { o: ox, d: dx, inv: invX, min: box.min.x, max: box.max.x, axis: 0 },
        { o: oy, d: dy, inv: invY, min: box.min.y, max: box.max.y, axis: 1 },
        { o: oz, d: dz, inv: invZ, min: box.min.z, max: box.max.z, axis: 2 },
      ];
      let miss = false;
      for (const a of axes) {
        if (a.d !== 0) {
          let near = (a.min - a.o) * a.inv;
          let far = (a.max - a.o) * a.inv;
          let s = -1;
          if (near > far) { const tmp = near; near = far; far = tmp; s = 1; }
          if (near > tMin) { tMin = near; enterAxis = a.axis; enterSign = s; }
          if (far < tMax) tMax = far;
          if (tMin > tMax) { miss = true; break; }
        } else if (a.o < a.min || a.o > a.max) { miss = true; break; }
      }
      if (miss || enterAxis < 0) continue;
      best = tMin; hitBox = box; axis = enterAxis; sign = enterSign; plane = 0;
    }
    if (!hitBox && !plane) return null;
    const point = { x: ox + dx * best, y: oy + dy * best, z: oz + dz * best };
    if (plane) {
      const surface = plane === 2
        ? "water"
        : (typeof groundSurfaceAt === "function" ? groundSurfaceAt(point.x, point.z) : "concrete");
      return { dist: best, point, normal: { x: 0, y: 1, z: 0 }, surface, box: null };
    }
    const normal = { x: 0, y: 0, z: 0 };
    if (axis === 0) normal.x = sign;
    else if (axis === 1) normal.y = sign;
    else normal.z = sign;
    return { dist: best, point, normal, surface: hitBox.surface, box: hitBox };
  }

  function lineOfSight(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return true;
    const hit = raycast(a, { x: dx / len, y: dy / len, z: dz / len }, len - 0.05);
    return !hit;
  }

  function groundHeight(x, z, maxY = 50) {
    let height = x <= world.quayX ? world.groundY : world.seaY;
    for (let i = 0; i < boxes.length; i += 1) {
      const box = boxes[i];
      if (box.bulletOnly) continue;
      if (x >= box.min.x && x <= box.max.x && z >= box.min.z && z <= box.max.z
        && box.max.y <= maxY && box.max.y > height) height = box.max.y;
    }
    return height;
  }

  /* ---- 扫掠胶囊：子步进 + 墙滑 + 落地/天花板/step-up ---- */
  function moveCapsule(pos, vel, dt, radius = 0.32, height = 1.8, step = true) {
    const result = { onGround: false, hitWall: false, hitCeil: false, surface: "concrete" };
    const moveX = vel.x * dt;
    const moveZ = vel.z * dt;
    const substeps = Math.max(1, Math.ceil(Math.hypot(moveX, moveZ) / (radius * 0.6)));
    const startY = pos.y;
    for (let s = 0; s < substeps; s += 1) {
      pos.x += moveX / substeps;
      pos.z += moveZ / substeps;
      for (let iter = 0; iter < 3; iter += 1) {
        let touched = false;
        for (let i = 0; i < boxes.length; i += 1) {
          const box = boxes[i];
          if (box.bulletOnly || box.max.y <= pos.y + (step ? stepHeight : 0.08) || box.min.y >= pos.y + height) continue;
          const closestX = Math.max(box.min.x, Math.min(box.max.x, pos.x));
          const closestZ = Math.max(box.min.z, Math.min(box.max.z, pos.z));
          const offsetX = pos.x - closestX;
          const offsetZ = pos.z - closestZ;
          const distSq = offsetX * offsetX + offsetZ * offsetZ;
          if (distSq >= radius * radius) continue;
          if (distSq > 1e-10) {
            const dist = Math.sqrt(distSq);
            const push = radius - dist;
            const nx = offsetX / dist;
            const nz = offsetZ / dist;
            pos.x += nx * push;
            pos.z += nz * push;
            const into = vel.x * nx + vel.z * nz;
            if (into < 0) { vel.x -= nx * into; vel.z -= nz * into; }
          } else {
            const toMinX = pos.x - box.min.x;
            const toMaxX = box.max.x - pos.x;
            const toMinZ = pos.z - box.min.z;
            const toMaxZ = box.max.z - pos.z;
            const least = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);
            if (least === toMinX) { pos.x = box.min.x - radius; if (vel.x > 0) vel.x = 0; }
            else if (least === toMaxX) { pos.x = box.max.x + radius; if (vel.x < 0) vel.x = 0; }
            else if (least === toMinZ) { pos.z = box.min.z - radius; if (vel.z > 0) vel.z = 0; }
            else { pos.z = box.max.z + radius; if (vel.z < 0) vel.z = 0; }
          }
          touched = true;
          result.hitWall = true;
        }
        if (!touched) break;
      }
    }
    const targetY = pos.y + vel.y * dt;
    const footPad = radius * 0.7;
    let ground = pos.x <= world.quayX + footPad ? world.groundY : -50;
    let groundSurface = null;
    let ceiling = Infinity;
    const stepTop = startY + (step ? stepHeight : 0.08) + 1e-4;
    for (let i = 0; i < boxes.length; i += 1) {
      const box = boxes[i];
      if (box.bulletOnly) continue;
      if (pos.x + footPad < box.min.x || pos.x - footPad > box.max.x
        || pos.z + footPad < box.min.z || pos.z - footPad > box.max.z) continue;
      if (box.max.y <= stepTop && box.max.y > ground) { ground = box.max.y; groundSurface = box.surface; }
      if (box.min.y >= startY + height - 0.05 && box.min.y < ceiling) ceiling = box.min.y;
    }
    if (vel.y > 0 && targetY + height > ceiling) {
      pos.y = ceiling - height; vel.y = 0; result.hitCeil = true;
    } else if (targetY <= ground) {
      pos.y = ground; if (vel.y < 0) vel.y = 0; result.onGround = true;
    } else if (step && vel.y <= 0 && targetY - ground < stepHeight) {
      pos.y = ground; vel.y = 0; result.onGround = true;
    } else {
      pos.y = targetY;
    }
    if (result.onGround) {
      result.surface = groundSurface
        || (typeof groundSurfaceAt === "function" ? groundSurfaceAt(pos.x, pos.z) : "concrete");
    }
    return result;
  }

  /* ---- 导航网格：阻挡位图 + A* + 视线拉直 ---- */
  let navDirty = true;
  let navBlocked = null;
  const navW = Math.max(1, Math.ceil((region.maxX - region.minX) / cell));
  const navH = Math.max(1, Math.ceil((region.maxZ - region.minZ) / cell));
  const navMinX = region.minX;
  const navMinZ = region.minZ;

  function rebuildNav() {
    navBlocked = new Uint8Array(navW * navH);
    for (let i = 0; i < boxes.length; i += 1) {
      const box = boxes[i];
      if (box.noNav || box.bulletOnly || box.max.y < stepHeight + 0.05 || box.min.y > 1.5) continue;
      const gx0 = Math.max(0, Math.floor((box.min.x - agentPadding - navMinX) / cell));
      const gx1 = Math.min(navW - 1, Math.floor((box.max.x + agentPadding - navMinX) / cell));
      const gz0 = Math.max(0, Math.floor((box.min.z - agentPadding - navMinZ) / cell));
      const gz1 = Math.min(navH - 1, Math.floor((box.max.z + agentPadding - navMinZ) / cell));
      for (let gz = gz0; gz <= gz1; gz += 1) {
        for (let gx = gx0; gx <= gx1; gx += 1) navBlocked[gz * navW + gx] = 1;
      }
    }
    for (let gz = 0; gz < navH; gz += 1) {
      for (let gx = 0; gx < navW; gx += 1) {
        const wx = navMinX + (gx + 0.5) * cell;
        if (wx > world.quayX - agentPadding || gx === 0 || gz === 0 || gx === navW - 1 || gz === navH - 1) {
          navBlocked[gz * navW + gx] = 1;
        }
      }
    }
    navDirty = false;
  }

  function ensureNav() { if (navDirty || !navBlocked) rebuildNav(); }
  function cellIndex(x, z) {
    const gx = Math.floor((x - navMinX) / cell);
    const gz = Math.floor((z - navMinZ) / cell);
    if (gx < 0 || gz < 0 || gx >= navW || gz >= navH) return -1;
    return gz * navW + gx;
  }
  function cellCenter(index) {
    return { x: navMinX + ((index % navW) + 0.5) * cell, z: navMinZ + (Math.floor(index / navW) + 0.5) * cell };
  }
  function clampedCell(x, z) {
    const gx = Math.max(0, Math.min(navW - 1, Math.floor((x - navMinX) / cell)));
    const gz = Math.max(0, Math.min(navH - 1, Math.floor((z - navMinZ) / cell)));
    return { index: gz * navW + gx, blocked: navBlocked[gz * navW + gx] === 1 };
  }

  const nav = {
    isWalkable(x, z) {
      ensureNav();
      const index = cellIndex(x, z);
      return index >= 0 && !navBlocked[index];
    },
    findPath(from, to) {
      ensureNav();
      const start = clampedCell(from.x, from.z);
      const goal = clampedCell(to.x, to.z);
      if (start.blocked || goal.blocked) return null;
      if (start.index === goal.index) return [{ x: to.x, z: to.z }];
      const total = navW * navH;
      const open = [start.index];
      const gScore = new Float32Array(total).fill(Infinity);
      const fScore = new Float32Array(total).fill(Infinity);
      const came = new Int32Array(total).fill(-1);
      const closed = new Uint8Array(total);
      const heuristic = (index) => {
        const ax = index % navW, az = Math.floor(index / navW);
        const bx = goal.index % navW, bz = Math.floor(goal.index / navW);
        return Math.hypot(ax - bx, az - bz);
      };
      gScore[start.index] = 0;
      fScore[start.index] = heuristic(start.index);
      const neighbors = [
        [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
        [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
      ];
      let found = false;
      while (open.length) {
        let bestIdx = 0;
        for (let i = 1; i < open.length; i += 1) if (fScore[open[i]] < fScore[open[bestIdx]]) bestIdx = i;
        const current = open.splice(bestIdx, 1)[0];
        if (current === goal.index) { found = true; break; }
        closed[current] = 1;
        const cx = current % navW, cz = Math.floor(current / navW);
        for (const [dxCell, dzCell, cost] of neighbors) {
          const nxCell = cx + dxCell, nzCell = cz + dzCell;
          if (nxCell < 0 || nzCell < 0 || nxCell >= navW || nzCell >= navH) continue;
          const next = nzCell * navW + nxCell;
          if (navBlocked[next] || closed[next]) continue;
          if (dxCell !== 0 && dzCell !== 0
            && (navBlocked[cz * navW + nxCell] || navBlocked[nzCell * navW + cx])) continue;
          const tentative = gScore[current] + cost;
          if (tentative < gScore[next]) {
            gScore[next] = tentative;
            fScore[next] = tentative + heuristic(next);
            came[next] = current;
            if (!open.includes(next)) open.push(next);
          }
        }
      }
      if (!found) return null;
      const cells = [];
      for (let at = goal.index; at !== -1; at = came[at]) cells.push(at);
      cells.reverse();
      const path = [];
      let anchor = 0;
      while (anchor < cells.length - 1) {
        let next = cells.length - 1;
        for (let probe = cells.length - 1; probe > anchor + 1; probe -= 1) {
          if (gridLine(cells[anchor], cells[probe])) { next = probe; break; }
        }
        path.push(cellCenter(cells[next]));
        anchor = next;
      }
      if (cellIndex(to.x, to.z) === goal.index && path.length) path[path.length - 1] = { x: to.x, z: to.z };
      return path;
    },
    randomPoint(center, radius) {
      ensureNav();
      for (let attempt = 0; attempt < 24; attempt += 1) {
        const angle = rng() * 6.2832;
        const dist = Math.sqrt(rng()) * radius;
        const x = center.x + Math.cos(angle) * dist;
        const z = center.z + Math.sin(angle) * dist;
        const index = cellIndex(x, z);
        if (index >= 0 && !navBlocked[index]) return { x, z };
      }
      const fallback = clampedCell(center.x, center.z);
      return fallback.index >= 0 ? cellCenter(fallback.index) : { x: center.x, z: center.z };
    },
    clearLine(a, b) {
      ensureNav();
      return gridLine(cellIndex(a.x, a.z), cellIndex(b.x, b.z));
    },
    grid: () => { ensureNav(); return { blocked: navBlocked, w: navW, h: navH, minX: navMinX, minZ: navMinZ, cell }; },
  };

  function gridLine(fromIndex, toIndex) {
    if (fromIndex < 0 || toIndex < 0) return false;
    let x0 = fromIndex % navW, z0 = Math.floor(fromIndex / navW);
    const x1 = toIndex % navW, z1 = Math.floor(toIndex / navW);
    const dx = Math.abs(x1 - x0), dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1, sz = z0 < z1 ? 1 : -1;
    let err = dx - dz;
    for (;;) {
      if (navBlocked[z0 * navW + x0]) return false;
      if (x0 === x1 && z0 === z1) return true;
      const e2 = err * 2;
      if (e2 > -dz) { err -= dz; x0 += sx; }
      if (e2 < dx) { err += dx; z0 += sz; }
    }
  }

  return {
    boxes,
    bounds: world,
    addBox,
    removeBox,
    build,
    raycast,
    lineOfSight,
    groundHeight,
    moveCapsule,
    nav,
  };
}
