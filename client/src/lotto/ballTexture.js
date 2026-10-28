import * as THREE from 'three';

export const BALL_COLORS = [
  '#ff5fa2',
  '#ffc93c',
  '#3b82f6',
  '#14b8a6',
  '#ff8a3d',
  '#a855f7',
];

// 공 표면 텍스처: 단색 바탕에 흰 원형 이름표 두 개(앞/뒤).
// u=0.25 지점이 +z(카메라 쪽)를 보므로, 회전이 없으면 이름표가 정면을 본다.
// scale: 공이 많을 때(작게 보일 때) 텍스처를 줄여 그래픽 메모리를 아낀다 (1 = 512x256).
export function makeBallTexture(name, color, scale = 1) {
  const c = document.createElement('canvas');
  c.width = 512 * scale;
  c.height = 256 * scale;
  const g = c.getContext('2d');
  g.scale(scale, scale);
  g.fillStyle = color;
  g.fillRect(0, 0, 512, 256);
  for (const cx of [128, 384]) {
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(cx, 128, 60, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1f2430';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 42;
    const font = (s) =>
      `700 ${s}px "Pretendard", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
    g.font = font(size);
    while (g.measureText(name).width > 100 && size > 14) {
      size -= 2;
      g.font = font(size);
    }
    g.fillText(name, cx, 131);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
