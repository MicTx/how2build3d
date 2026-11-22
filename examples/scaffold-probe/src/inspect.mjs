/**
 * inspect.mjs — 九展厅注册表：每个可感知子系统一个可进入、可拍照的展台。
 * 现在九厅都指向同一个小场景的机位；补内容时把对应 setup 换成真实展台。
 * 协议见 references/08-self-inspection.md；框架见 assets/inspect-deck.mjs。
 */
globalThis.H2B = globalThis.H2B || {};

H2B.createInspectGalleries = function createInspectGalleries(ctx) {
  const { THREE, scene, content, ground } = ctx;
  const focus = new THREE.Box3().setFromObject(content.group).getCenter(new THREE.Vector3());
  const gallery = (cam, target) => ({ cam, target });
  return {
    mats: gallery([focus.x + 6, 3, focus.z + 10], [focus.x, 2, focus.z]),
    props: gallery([focus.x, 4.5, focus.z + 16], [focus.x, 2, focus.z]),
    enemies: gallery([focus.x + 8, 3.2, focus.z - 4], [focus.x, 1.4, focus.z - 12]),
    weapon: gallery([0, 1.7, 16], [0, 1.5, 10]),
    fx: gallery([0, 2.2, 14], [0, 1.2, 6]),
    render: gallery([-18, 4.2, -18], [focus.x, 3, focus.z]),
    ground: gallery([0, 1.6, 12], [0, 0.2, 4]),
    backdrop: gallery([0, 9, 34], [0, 5, 0]),
    level: gallery([0, 42, 44], [0, 0, 0]),
  };
};
