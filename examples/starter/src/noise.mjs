/**
 * starter/src/noise.mjs — 确定性噪声纹理 + 共享 GLSL fbm 片段。
 * 对应 distilled/04-code-atlas.md 图集 B：一张纹理全场复用。
 * 无 import/export：build.mjs 直接拼接，保持"单文件"哲学。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.makeNoiseTexture = function makeNoiseTexture(THREE, seed) {
  let t = (seed >>> 0) || 4207;
  const rnd = () => {
    t ^= t << 13; t >>>= 0;
    t ^= t >>> 17;
    t ^= t << 5; t >>>= 0;
    return t / 4294967296;
  };
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < data.length; i += 1) data[i] = (rnd() * 256) | 0;
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
};

// 5 octave 与 3 octave 两个档，共用上面的纹理（T-08）
H2B.GLSL_FBM = `
uniform sampler2D tNoise;
float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return texture2D(tNoise,(i+f+0.5)/256.0).r; }
float fbm5(vec2 p){ float a=0.5,s=0.0;
  for(int i=0;i<5;i++){ s+=a*n2(p); p=mat2(1.6,1.2,-1.2,1.6)*p+17.3; a*=0.5; } return s; }
float fbm3(vec2 p){ float a=0.5,s=0.0;
  for(int i=0;i<3;i++){ s+=a*n2(p); p=mat2(1.6,1.2,-1.2,1.6)*p+17.3; a*=0.5; } return s; }
`;

H2B.seededRng = function seededRng(seed) {
  let t = (seed >>> 0) || 4207;
  return () => {
    t ^= t << 13; t >>>= 0;
    t ^= t >>> 17;
    t ^= t << 5; t >>>= 0;
    return t / 4294967296;
  };
};
