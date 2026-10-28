// 확대한 뒤 화면을 옮길 때(OrbitControls 의 pan) 장면 밖으로 너무 멀리 가지 않게 막는다.
// 바라보는 점(target)을 상자 안으로 되돌리고, 카메라도 같은 만큼 옮겨서 보는 각도는 그대로 둔다.
// min, max: [x, y, z]
export function clampPan(controls, min, max) {
  if (!controls) return;
  const t = controls.target;
  const dx = Math.min(max[0], Math.max(min[0], t.x)) - t.x;
  const dy = Math.min(max[1], Math.max(min[1], t.y)) - t.y;
  const dz = Math.min(max[2], Math.max(min[2], t.z)) - t.z;
  if (!dx && !dy && !dz) return;
  t.set(t.x + dx, t.y + dy, t.z + dz);
  controls.object.position.set(
    controls.object.position.x + dx,
    controls.object.position.y + dy,
    controls.object.position.z + dz
  );
}
