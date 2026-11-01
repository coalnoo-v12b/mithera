import * as THREE from 'three';

// 좀비 탈출 장면에서 함께 쓰는 작은 도우미 (그림용, 기록과는 상관없다)

export const UP = new THREE.Vector3(0, 1, 0);
export const FONT =
  'Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

// 번호로 정하는 화면용 무늬 (같은 번호면 언제나 같은 값, 0~1)
export const hash = (k) => {
  const s = Math.sin(k * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};

export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

// 글자 텍스처. glow 를 주면 네온처럼 글자 둘레가 번진다 (바탕은 투명)
export function textTexture(
  lines,
  { w = 256, h = 128, bg, fg = '#ffffff', font = 900, border, glow } = {}
) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (bg) {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
  }
  if (border) {
    g.lineWidth = Math.round(h * 0.08);
    g.strokeStyle = border;
    g.strokeRect(
      g.lineWidth / 2,
      g.lineWidth / 2,
      w - g.lineWidth,
      h - g.lineWidth
    );
  }
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (glow) {
    g.shadowColor = glow;
    g.shadowBlur = h * 0.18;
  }
  const list = Array.isArray(lines) ? lines : [lines];
  const size = Math.floor((h * 0.62) / list.length);
  list.forEach((line, k) => {
    let s = size;
    g.font = `${font} ${s}px ${FONT}`;
    const tw = g.measureText(line).width;
    if (tw > w * 0.88) {
      s = Math.floor((s * w * 0.88) / tw);
      g.font = `${font} ${s}px ${FONT}`;
    }
    const y = (h * (k + 0.5)) / list.length + h * 0.03;
    g.fillText(line, w / 2, y);
    if (glow) g.fillText(line, w / 2, y);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// 셔터 (가로 골이 진 철판)
export function shutterTexture(light = '#9aa3ad', dark = '#6f7882') {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d');
  for (let y = 0; y < 256; y += 16) {
    g.fillStyle = light;
    g.fillRect(0, y, 64, 10);
    g.fillStyle = dark;
    g.fillRect(0, y + 10, 64, 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

// 위치·크기·세로축 회전으로 만든 변환 행렬 (여러 개를 한꺼번에 그릴 때)
export const box = (x, y, z, sx, sy, sz, ry = 0) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(UP, ry),
    new THREE.Vector3(sx, sy, sz)
  );

// 화면용 의사 난수 (seed 가 같으면 같은 순서, 텍스처 무늬에 쓴다)
export function makeNoise(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
