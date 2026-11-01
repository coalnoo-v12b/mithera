import { useLayoutEffect, useRef } from 'react';

// 같은 모양을 여러 자리에 한꺼번에 그린다 (matrices: 자리마다 변환 행렬)
export default function Instances({ matrices, children, geometry }) {
  const ref = useRef();
  useLayoutEffect(() => {
    if (!ref.current) return;
    matrices.forEach((m, k) => ref.current.setMatrixAt(k, m));
    ref.current.instanceMatrix.needsUpdate = true;
  }, [matrices]);
  if (!matrices.length) return null;
  return (
    <instancedMesh ref={ref} args={[geometry, null, matrices.length]}>
      {children}
    </instancedMesh>
  );
}
