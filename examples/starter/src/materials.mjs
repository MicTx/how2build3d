/**
 * starter/src/materials.mjs — 程序化天空 + onBeforeCompile 注入示例。
 * 对应技巧卡 T-04/T-05/T-10：美术意图写注释、锚点替换、必给缓存键。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.makeSkyMaterial = function makeSkyMaterial(THREE, noiseTex, uTime) {
  // Art direction: a burning gap in the cloud deck; the sun is never hidden.
  // Cheap self-shadowing: density gradient toward the sun fakes volume.
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      tNoise: { value: noiseTex },
      uTime,
      uZenith: { value: new THREE.Color(0x0b1220) },
      uHorizon: { value: new THREE.Color(0xf28b46) },
      uAway: { value: new THREE.Color(0x2a3542) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: `
      precision highp float;
      varying vec3 vDir;
      uniform float uTime;
      uniform vec3 uZenith, uHorizon, uAway;
      ${H2B.GLSL_FBM}
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y*0.5+0.5, 0.0, 1.0);
        vec3 col = mix(uHorizon, uZenith, smoothstep(0.30, 0.92, h));
        // cloud deck rolls east-west; ridged underside fades with distance
        vec2 uv = vec2(atan(d.z,d.x)*0.9 + uTime*0.01, d.y*2.2);
        float clouds = fbm5(uv*2.0);
        float gap = smoothstep(0.15, 0.55, abs(d.x*0.8 + d.z*0.2));
        float deck = smoothstep(0.42,0.72,clouds) * (1.0-gap) * smoothstep(0.02,0.35,h);
        col = mix(col, mix(uAway*1.6, uHorizon*0.9, clouds), deck*0.65);
        // the sun always burns through the gap: tight disk + broad aureole
        float sd = max(dot(d, normalize(vec3(0.30,0.14,0.95))),0.0);
        col += vec3(1.0,0.72,0.42) * (pow(sd, 220.0)*3.2 + pow(sd, 12.0)*0.55);
        gl_FragColor = vec4(col,1.0);
      }
    `,
  });
};

H2B.makeGroundMaterial = function makeGroundMaterial(THREE, noiseTex, uTime) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x2b3138, roughness: 0.72, metalness: 0.12 });
  // T-04: prepend declarations -> replace #include anchor -> keep original line -> cache key.
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tNoise = { value: noiseTex };
    shader.uniforms.uTime = uTime;
    shader.fragmentShader = `uniform float uTime;\n${H2B.GLSL_FBM}\n` +
      shader.fragmentShader.replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
         float wet = fbm3(gl_FragCoord.xy * 0.005 + vec2(uTime * 0.01, 0.0));
         roughnessFactor = clamp(roughnessFactor - wet * 0.45, 0.08, 1.0);`
      );
  };
  // T-05: without this key three may reuse the stock program.
  mat.customProgramCacheKey = () => "h2b-wet-ground-1";
  return mat;
};
