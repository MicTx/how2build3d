/**
 * skill/how2build3d/snippets/sky.glsl.mjs — 程序化黄昏天空 GLSL 片段。
 * 用法：与 H2B.GLSL_FBM（shared noise）一起拼进 ShaderMaterial。
 * 设计铁律：云甲板永远留缺口；太阳从缺口烧穿；远云融进地平线色。
 */

export const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const SKY_FRAGMENT = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform float uTime;
uniform vec3 uZenith, uHorizon, uAway;

// 由 noise 片段提供：
// uniform sampler2D tNoise;
// float fbm5(vec2 p); float fbm3(vec2 p);

void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);

  // 天顶 → 地平线：地平线占主要比例，天空才有"黄昏感"
  vec3 col = mix(uHorizon, uZenith, smoothstep(0.30, 0.92, h));

  // 云甲板：东西向滚动 + ridged 云底，距离衰减抗锯齿
  vec2 uv = vec2(atan(d.z, d.x) * 0.9 + uTime * 0.01, d.y * 2.2);
  float clouds = fbm5(uv * 2.0);

  // 构图铁律：朝日方向留缺口
  float gap = smoothstep(0.15, 0.55, abs(d.x * 0.8 + d.z * 0.2));
  float deck = smoothstep(0.42, 0.72, clouds) * (1.0 - gap) * smoothstep(0.02, 0.35, h);
  col = mix(col, mix(uAway * 1.6, uHorizon * 0.9, clouds), deck * 0.65);

  // 太阳盘 + 宽光晕（太阳方向由 CPU 常量表给定）
  float sd = max(dot(d, normalize(vec3(0.30, 0.14, 0.95))), 0.0);
  col += vec3(1.0, 0.72, 0.42) * (pow(sd, 220.0) * 3.2 + pow(sd, 12.0) * 0.55);

  // 地平线下：海雾 / 地面反弹
  col = mix(col, uAway * 0.8, smoothstep(0.5, 0.42, h));

  gl_FragColor = vec4(col, 1.0);
}
`;
