/**
 * skill/how2build3d/snippets/sea.glsl.mjs — 海面/湿地 GLSL 片段。
 * 与 noise 片段（tNoise + fbm3）配合；湿润度由 uniform 驱动，不切贴图。
 */

export const SEA_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying vec3 vWorld;
uniform float uTime;
uniform float uWet;      // 0..1 全局雨湿
uniform vec3  uSunDir;
uniform vec3  uSunCol;

// 由 noise 片段提供：uniform sampler2D tNoise; float fbm3(vec2);

void main() {
  // 低频涌浪 + 高频碎波（两层 fbm，共享噪声纹理）
  float swell = fbm3(vUv * 3.0 + vec2(uTime * 0.02, 0.0));
  float chop  = fbm3(vUv * 11.0 - vec2(uTime * 0.05, uTime * 0.01));
  float wave  = swell * 0.65 + chop * 0.35;

  // 基础色：深水 → 岸边浅色
  vec3 deep = vec3(0.035, 0.05, 0.06);
  vec3 shallow = vec3(0.10, 0.13, 0.14);
  vec3 col = mix(deep, shallow, smoothstep(0.3, 0.8, wave));

  // 太阳镜面高光（方向来自常量表）
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 H = normalize(normalize(uSunDir) + V);
  float spec = pow(max(H.y, 0.0), 180.0) * (0.4 + wave * 0.6);
  col += uSunCol * spec * 1.6;

  // 雨湿：提高对比 + 微弱粗糙度变化，不换贴图
  col = mix(col, col * 1.25 + 0.02, uWet);
  float foam = smoothstep(0.78, 0.86, wave) * uWet;
  col += vec3(0.75, 0.78, 0.8) * foam * 0.35;

  gl_FragColor = vec4(col, 1.0);
}
`;
