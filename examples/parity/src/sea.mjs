/**
 * sea.mjs — 海面（装配顺序 #3b）：assets/sea.glsl 原样消费。
 * 补丁体按 `// ---- SEA_XXX` 标记切块后 replace 进 MeshStandardMaterial 锚点；
 * customProgramCacheKey 固定 "saltline-sea-1"（资产门禁 marker）。
 * 网格按资产头注释的 gv 配方建环形级差网格（x 环 63 / z 线 ~216），1 draw call；
 * uDetail/uDetailN 用本场景定种噪声 RT（程序化，无外链贴图）。
 */
globalThis.H2B = globalThis.H2B || {};

(function () {
  /** 资产头注释的环距配方：从 start 走到 end，每步 step*=grow、封顶 cap。 */
  function gv(start, end, step, grow, cap) {
    const out = [];
    let s = step;
    let v = start;
    while (v <= end && out.length < 4096) {
      out.push(v);
      s = Math.min(s * grow, cap);
      v += s;
    }
    return out;
  }

  /** 从 GLSL_SEA 文本按 `// ---- SEA_XXX` 标记切块（补丁体本体，不含标记行）。 */
  function seaPatch(name) {
    const begin = GLSL_SEA.indexOf("// ---- " + name);
    if (begin < 0) throw new Error("sea.glsl: patch missing: " + name);
    const head = GLSL_SEA.indexOf("\n", begin) + 1;
    const next = GLSL_SEA.indexOf("// ---- ", head);
    const raw = GLSL_SEA.slice(head, next >= 0 ? next : GLSL_SEA.length);
    // 本体里内嵌的 anchor 注释行必须剥掉——three.resolveIncludes 会把注释里的
    // "#include <...>" 字样也展开成 chunk（注释不再受保护）。
    return raw.split("\n").filter((line) => !/^\/\/ ---- /.test(line)).join("\n").trim();
  }

  function makeDetailRt(THREE, size, seed) {
    const rng = H2B.seededRng(seed);
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < data.length; i += 4) {
      const v = (rng() * 256) | 0;
      const w = (rng() * 256) | 0;
      data[i] = v; data[i + 1] = w; data[i + 2] = (v + w) >> 1; data[i + 3] = (rng() * 256) | 0;
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  }

  H2B.createSea = function createSea(THREE, scene, world, seed) {
    const seaY = world.seaY;
    // 资产头配方：x 环 gv(27.5,880,.75,1.075,120)=63；z 线 = 镜像 s + 带内 band + s ≈ 216 条
    const rings = gv(27.5, 880, 0.75, 1.075, 120);
    const sparse = gv(48, 880, 0.9, 1.085, 120);
    const band = gv(-47.1, 47.1, 0.9, 1.0, 0.9);
    const lines = [];
    for (let i = sparse.length - 1; i >= 0; i -= 1) lines.push(-sparse[i]);
    for (const z of band) lines.push(z);
    for (const z of sparse) lines.push(z);

    const positions = [];
    const indices = [];
    for (const x of rings) for (const z of lines) positions.push(x, seaY, z);
    const cols = lines.length;
    for (let r = 0; r < rings.length - 1; r += 1) {
      for (let q = 0; q < cols - 1; q += 1) {
        const a = r * cols + q, b = a + 1, c = a + cols, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    // 上游另有 3 块西向角部补丁；本场景码头墙（x=30）以西没有可见水面，按配方裁掉。

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    const normals = new Float32Array(positions.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));

    const uniforms = {
      uTime: { value: 0 },
      uDetail: { value: makeDetailRt(THREE, 128, seed ^ 0x53ea) },
      uDetailN: { value: makeDetailRt(THREE, 128, seed ^ 0x53eb) },
      uHazeA: { value: new THREE.Vector3(...world.horizonAway).multiplyScalar(0.85) },
      uHazeB: { value: new THREE.Vector3(...world.horizon).multiplyScalar(0.8) },
      uSunDirW: { value: new THREE.Vector3(...world.sun.dir).normalize() },
    };

    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0 });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\n" + seaPatch("SEA_VERT_HEAD"))
        .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + seaPatch("SEA_BEGIN_VERTEX"));
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\n" + seaPatch("SEA_COMMON"))
        .replace("#include <map_fragment>", seaPatch("SEA_MAP_FRAGMENT"))
        .replace("#include <roughnessmap_fragment>", "float roughnessFactor = gRough;\n/* sea: 本体已声明，库存 chunk 就此接管 */")
        .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n" + seaPatch("SEA_NORMAL"))
        .replace("#include <lights_fragment_maps>", "#include <lights_fragment_maps>\n  radiance *= gOcc; iblIrradiance *= gOcc;")
        .replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\n" + seaPatch("SEA_GLITTER"))
        .replace("#include <opaque_fragment>", seaPatch("SEA_FOG") + "\n#include <opaque_fragment>");
    };
    material.customProgramCacheKey = () => "saltline-sea-1";

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "h2b-sea";
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, seaY, 0), 1300);
    scene.add(mesh);

    return {
      mesh,
      uniforms,
      update(time) { uniforms.uTime.value = time; },
      stats: () => ({ seaSurfaces: 1, verts: positions.length / 3, tris: indices.length / 3 }),
    };
  };
})();
