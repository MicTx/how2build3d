/**
 * harness/constants.mjs — 跨门禁 / 资产 / 脚手架的清单单一真源。
 *
 * 四组常量（顺序即合同顺序，改动必须同步评审）：
 *   GALLERIES    九展厅。顺序同 references/08-self-inspection.md「九展厅清单」表与
 *                harness/element-manifest.json 的 galleries。
 *   SYSTEMS      八系统（渲染链基线）。顺序同 harness/gates/assets.mjs 的 SYSTEMS。
 *   KITS         八元素 kit。顺序同 harness/gates/assets.mjs 的 KITS。
 *   ELEMENT_IDS  18 族元素 id。顺序同 harness/element-manifest.json 的 elements。
 *
 * 消费者：
 *   - harness/gates/inspect.mjs    import 后原样 re-export `GALLERIES`
 *                                  （harness/gates/complete.mjs:37 的 import 不变，V6）
 *   - harness/gates/assets.mjs     模块加载时断言 SYSTEMS/KITS 键集与本文件相等；
 *                                  markers / asset 字段仍归 assets.mjs
 *   - scripts/scaffold-scene.mjs   三份清单模板（inspect/elements/consumption）
 *   - assets/inspect-deck.mjs      仅存的浏览器镜像：构建按文本内联、不能 import，
 *                                  由 harness/gates/consistency.mjs --all 动态 import 判等
 *
 * 判等门禁：node harness/gates/consistency.mjs --self-test / --all
 * 本文件只放键清单，不放资产 marker 或文档正文——那些留在各自消费者里。
 */

export const GALLERIES = Object.freeze([
  "mats",
  "props",
  "enemies",
  "weapon",
  "fx",
  "render",
  "ground",
  "backdrop",
  "level",
]);

export const SYSTEMS = Object.freeze([
  "sl-surface",
  "sl-textures",
  "post-chain",
  "post-aa",
  "pcss-shadow",
  "ssr-wet",
  "shafts",
  "sky-deck",
]);

export const KITS = Object.freeze([
  "props-kit",
  "fx-kit",
  "audio-kit",
  "weapon-kit",
  "enemy-kit",
  "player-kit",
  "hud-kit",
  "weather-kit",
]);

export const ELEMENT_IDS = Object.freeze([
  "props",
  "decals",
  "materials",
  "textures",
  "sky",
  "sea",
  "ground",
  "weather",
  "post",
  "shadow",
  "enemies",
  "weapon",
  "fx",
  "audio",
  "hud",
  "layout",
  "loop",
  "inspect",
]);
