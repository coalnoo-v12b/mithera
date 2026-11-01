import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import Instances from './Instances.jsx';
import {
  box,
  hash,
  makeNoise,
  shutterTexture,
  textTexture,
} from './helpers.js';

// 비 내리는 밤거리: 좀비 탈출의 배경. 기록과는 상관없는 꾸밈이다.
// 젖은 아스팔트(물웅덩이·갈라진 금), 푸른 가로등과 바닥에 번지는 빛, 셔터 내린 가게와 네온 간판,
// 가로수·전봇대·전선, 멀리 안개 낀 고가도로와 불 켜진 빌딩숲, 내리는 비와 빗방울 파문.
// 좌표는 장면과 같다: x 는 길을 가로지르는 방향, z 는 바리게이트로 가는 방향.

const WALK = 4; // 인도 폭
const LAMP_GAP = 13; // 가로등 간격
const FOG = '#121a2e';

/* ---------------- 텍스처 ---------------- */

// 젖은 아스팔트: 알갱이, 갈라진 금, 물웅덩이 (웅덩이는 매끈해서 빛을 반사한다)
function asphaltTextures() {
  const N = 512;
  const rnd = makeNoise(7);
  const color = document.createElement('canvas');
  const rough = document.createElement('canvas');
  color.width = color.height = rough.width = rough.height = N;
  const g = color.getContext('2d');
  const r = rough.getContext('2d');
  g.fillStyle = '#2c3038';
  g.fillRect(0, 0, N, N);
  r.fillStyle = '#c8c8c8';
  r.fillRect(0, 0, N, N);
  for (let k = 0; k < 9000; k++) {
    const v = 34 + Math.floor(rnd() * 28);
    g.fillStyle = `rgb(${v},${v + 3},${v + 8})`;
    g.fillRect(rnd() * N, rnd() * N, 2, 2);
  }
  for (let k = 0; k < 8; k++) {
    const x = rnd() * N;
    const y = rnd() * N;
    const rx = 18 + rnd() * 60;
    const ry = 8 + rnd() * 24;
    const a = rnd() * Math.PI;
    g.fillStyle = 'rgba(12,16,26,0.8)';
    g.beginPath();
    g.ellipse(x, y, rx, ry, a, 0, Math.PI * 2);
    g.fill();
    r.fillStyle = '#121212';
    r.beginPath();
    r.ellipse(x, y, rx, ry, a, 0, Math.PI * 2);
    r.fill();
  }
  g.strokeStyle = '#15171c';
  g.lineWidth = 1.6;
  for (let k = 0; k < 28; k++) {
    let x = rnd() * N;
    let y = rnd() * N;
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < 8; s++) {
      x += (rnd() - 0.5) * 48;
      y += (rnd() - 0.5) * 48;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const map = new THREE.CanvasTexture(color);
  map.colorSpace = THREE.SRGBColorSpace;
  const roughnessMap = new THREE.CanvasTexture(rough);
  for (const t of [map, roughnessMap]) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  return { map, roughnessMap };
}
// 가운데가 밝고 가장자리로 갈수록 사라지는 둥근 빛
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
// 젖은 길에 비친 불빛: 한쪽 끝이 밝고 길게 늘어지며 사라진다
function streakTexture() {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 256;
  const g = c.getContext('2d');
  for (let y = 0; y < 256; y++) {
    const a = (1 - y / 256) ** 1.6;
    const grad = g.createLinearGradient(0, 0, 32, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, `rgba(255,255,255,${a})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, y, 32, 1);
  }
  return new THREE.CanvasTexture(c);
}
// 불 켜진 창이 드문드문 있는 빌딩 벽 (멀리 보이는 빌딩숲)
function towerTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d');
  const rnd = makeNoise(11);
  g.fillStyle = '#000000';
  g.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 128; y += 8)
    for (let x = 4; x < 64; x += 10) {
      const v = rnd();
      if (v > 0.68) {
        g.fillStyle = v > 0.9 ? '#9fd0ff' : '#ffc773';
        g.fillRect(x, y, 6, 4);
      }
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function stripes(a, b) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 16;
  const g = c.getContext('2d');
  for (let k = 0; k < 8; k++) {
    g.fillStyle = k % 2 ? a : b;
    g.fillRect(k * 16, 0, 16, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------------- 하늘·먼 풍경 ---------------- */

function NightSky() {
  const geo = useMemo(() => {
    const g = new THREE.SphereGeometry(420, 32, 16);
    const top = new THREE.Color('#050913');
    const mid = new THREE.Color('#0f1a35');
    const low = new THREE.Color('#2a3a62');
    const pos = g.attributes.position;
    const c = new THREE.Color();
    const colors = new Float32Array(pos.count * 3);
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k) / 420;
      if (y > 0.12) c.copy(mid).lerp(top, Math.min(1, (y - 0.12) / 0.5));
      else c.copy(low).lerp(mid, Math.max(0, (y + 0.02) / 0.14));
      colors.set([c.r, c.g, c.b], k * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  }, []);
  return (
    <mesh geometry={geo}>
      <meshBasicMaterial
        vertexColors
        side={THREE.BackSide}
        fog={false}
        depthWrite={false}
      />
    </mesh>
  );
}

// 길 끝: 안개 속 고가도로와 불 켜진 빌딩숲
function Skyline({ zBack, half }) {
  const tex = useMemo(() => towerTexture(), []);
  useEffect(() => () => tex.dispose(), [tex]);
  const towers = useMemo(() => {
    const list = [];
    for (let k = 0; k < 34; k++) {
      const x = -95 + k * 5.8 + (hash(k) - 0.5) * 3;
      // 길 바로 끝은 조금 더 멀리 (길이 빌딩숲으로 사라지게)
      const far = Math.abs(x) < half + 6 ? 22 : 0;
      const h = 18 + hash(k + 40) * 62;
      list.push(box(x, h / 2, zBack - 75 - far - hash(k + 9) * 25, 5.2, h, 6));
    }
    return list;
  }, [zBack, half]);
  const unit = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const z = zBack - 46;
  return (
    <group>
      <Instances matrices={towers} geometry={unit}>
        <meshStandardMaterial
          color="#0c1222"
          emissive="#ffffff"
          emissiveMap={tex}
          emissiveIntensity={0.7}
        />
      </Instances>
      {/* 고가도로 */}
      <mesh position={[0, 7.2, z]}>
        <boxGeometry args={[140, 1.3, 7]} />
        <meshStandardMaterial color="#2a3142" roughness={0.9} />
      </mesh>
      <mesh position={[0, 8.3, z - 3.4]}>
        <boxGeometry args={[140, 0.9, 0.25]} />
        <meshStandardMaterial color="#3a4256" roughness={0.9} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (half + 7), 3.3, z]}>
          <boxGeometry args={[1.6, 6.6, 2.4]} />
          <meshStandardMaterial color="#262d3d" roughness={0.9} />
        </mesh>
      ))}
      {Array.from({ length: 14 }, (_, k) => (
        <mesh key={k} position={[-65 + k * 10, 6.45, z + 3.55]}>
          <boxGeometry args={[0.5, 0.12, 0.1]} />
          <meshBasicMaterial color="#ffd27a" toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/* ---------------- 비 ---------------- */

const RAIN_N = 2600;
const RAIN_BOX = [44, 18, 50]; // 카메라 앞 둘레에 비가 내리는 상자
const DIR = new THREE.Vector3();
function Rain() {
  const ref = useRef();
  const ripRef = useRef();
  const geo = useMemo(() => {
    const rnd = makeNoise(3);
    const pos = new Float32Array(RAIN_N * 2 * 3);
    const end = new Float32Array(RAIN_N * 2);
    for (let k = 0; k < RAIN_N; k++) {
      const x = (rnd() - 0.5) * RAIN_BOX[0];
      const y = rnd() * RAIN_BOX[1];
      const z = (rnd() - 0.5) * RAIN_BOX[2];
      pos.set([x, y, z, x, y, z], k * 6);
      end[k * 2] = 0;
      end[k * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    return g;
  }, []);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { time: { value: 0 } },
        vertexShader: `
          attribute float aEnd;
          uniform float time;
          varying float vA;
          void main() {
            vec3 p = position;
            float fall = time * 17.0;
            p.y = mod(p.y - fall, ${RAIN_BOX[1].toFixed(1)});
            // 빗줄기: 아래쪽 끝은 조금 비스듬히 길게
            p += aEnd * vec3(0.06, -0.55, 0.0);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            // 카메라 가까이에서만 보이고 멀어질수록 사라진다 (빗줄기 상자의 가장자리가 보이지 않게)
            float d = -mv.z;
            vA = 0.34 * (1.0 - smoothstep(12.0, 32.0, d)) * smoothstep(0.6, 2.5, d);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          varying float vA;
          void main() { gl_FragColor = vec4(0.72, 0.8, 0.95, vA); }`,
      }),
    []
  );
  // 길바닥 빗방울 파문
  const rip = useMemo(() => {
    const rnd = makeNoise(5);
    const n = 260;
    const g = new THREE.InstancedBufferGeometry().copy(
      new THREE.RingGeometry(0.75, 1, 18).rotateX(-Math.PI / 2)
    );
    const off = new Float32Array(n * 3);
    const ph = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      off.set(
        [(rnd() - 0.5) * RAIN_BOX[0], 0.03, (rnd() - 0.5) * RAIN_BOX[2]],
        k * 3
      );
      ph[k] = rnd();
    }
    g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 3));
    g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
    g.instanceCount = n;
    return g;
  }, []);
  const ripMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { time: { value: 0 } },
        vertexShader: `
          attribute vec3 aOff;
          attribute float aPhase;
          uniform float time;
          varying float vA;
          void main() {
            float t = fract(time * 1.4 + aPhase);
            vec3 p = position * (0.04 + t * 0.32) + aOff;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            vA = (1.0 - t) * 0.5 * (1.0 - smoothstep(25.0, 55.0, -mv.z));
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          varying float vA;
          void main() { gl_FragColor = vec4(0.75, 0.85, 1.0, vA); }`,
      }),
    []
  );
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
      rip.dispose();
      ripMat.dispose();
    },
    [geo, mat, rip, ripMat]
  );
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const target = state.controls ? state.controls.target : null;
    // 빗줄기는 카메라 바로 앞 둘레에, 파문은 보고 있는 땅 위에
    const rain = ref.current;
    if (rain) {
      rain.material.uniforms.time.value = t;
      const cam = state.camera;
      cam.getWorldDirection(DIR);
      rain.position.set(
        cam.position.x + DIR.x * 16,
        cam.position.y - RAIN_BOX[1] / 2,
        cam.position.z + DIR.z * 16
      );
    }
    const rip = ripRef.current;
    if (rip) {
      rip.material.uniforms.time.value = t;
      if (target) rip.position.set(target.x, 0, target.z);
    }
  });
  return (
    <>
      <lineSegments
        ref={ref}
        geometry={geo}
        material={mat}
        frustumCulled={false}
      />
      <mesh
        ref={ripRef}
        geometry={rip}
        material={ripMat}
        frustumCulled={false}
      />
    </>
  );
}

/* ---------------- 길과 길가 ---------------- */

// 가게 간판: [글자, 바탕, 글자색, 네온 번짐색]
const SHOPS = [
  ['24시 마트', '#1b2f8f', '#ffd84a', '#ffd84a'],
  ['PC방', '#0b1636', '#5ad1ff', '#5ad1ff'],
  ['편의점', '#13532e', '#ffffff', '#8dffb8'],
  ['치킨', '#6a0f0f', '#ffcf3d', '#ff9a3d'],
  ['노래방', '#250b36', '#ff6ad5', '#ff6ad5'],
  ['분식', '#7a3a08', '#ffe6a0', '#ffb84d'],
  ['세탁소', '#0d3a5c', '#bfe6ff', '#7fd0ff'],
  ['빵집', '#5c3410', '#ffe0b0', '#ffc46b'],
  ['안경', '#1d2333', '#ffffff', '#b8c4ff'],
  ['꽃집', '#5a1036', '#ffd1e8', '#ff8ac2'],
];
const WALLS = [
  '#3a3f4c',
  '#4a3c38',
  '#353d48',
  '#463f36',
  '#2f3642',
  '#4b4441',
];

function Street({ rec, decoded }) {
  const L = rec.layout;
  const half = L.half;
  const z0 = decoded.zBack - 60;
  const z1 = L.ZB + 34;
  const len = z1 - z0;
  const tex = useMemo(() => {
    const a = asphaltTextures();
    a.map.repeat.set(2, (L.ZB - z0) / 11);
    a.roughnessMap.repeat.copy(a.map.repeat);
    return {
      ...a,
      glow: glowTexture(),
      streak: streakTexture(),
      shutter: shutterTexture('#59606b', '#3c424b'),
      awning: stripes('#c8302a', '#efe9e0'),
      pole: stripes('#f0c419', '#1b1b1b'),
      cross: textTexture(['✚', '약'], {
        w: 128,
        h: 256,
        bg: '#0b2a1c',
        fg: '#6dffb0',
        glow: '#2dff8a',
      }),
    };
  }, [L.ZB, z0]);
  useEffect(() => () => Object.values(tex).forEach((t) => t.dispose()), [tex]);
  // 길가 건물: 골목 자리는 비우고 양쪽으로 늘어선다
  const buildings = useMemo(() => {
    const list = [];
    for (const side of [-1, 1]) {
      let z = z0;
      let k = side < 0 ? 0 : 50;
      while (z < z1) {
        const w = 6 + hash(k) * 4;
        const mid = z + w / 2;
        const alley = L.alleys.some(
          ([ax, az]) =>
            Math.sign(ax) === side && Math.abs(mid - az) < w / 2 + 2.2
        );
        if (!alley)
          list.push({ side, z: mid, w: w - 0.3, h: 8 + hash(k + 7) * 15, k });
        z += alley ? 4.6 : w;
        k++;
      }
    }
    return list;
  }, [z0, z1, L.alleys]);
  // 1층: 셔터를 내린 가게와 불 켜진 가게 (불 켜진 가게에는 줄무늬 차양과 네온 간판)
  const shops = useMemo(
    () =>
      buildings
        .filter((b) => b.z > decoded.zBack - 30 && b.z < L.ZB + 2)
        .map((b) => {
          const open = hash(b.k + 3) > 0.45;
          const [text, bg, fg, glow] = SHOPS[b.k % SHOPS.length];
          return {
            b,
            open,
            awning: open && hash(b.k + 5) > 0.35,
            pharmacy: hash(b.k + 13) > 0.86,
            sign: textTexture(text, { w: 384, h: 96, bg, fg, glow }),
            glow,
          };
        }),
    [buildings, decoded.zBack, L.ZB]
  );
  useEffect(() => () => shops.forEach((s) => s.sign.dispose()), [shops]);
  const windows = useMemo(() => {
    const dark = [];
    const lit = [];
    const cool = [];
    buildings.forEach((b) => {
      const x = b.side * (half + WALK + 0.02);
      const ry = b.side < 0 ? Math.PI / 2 : -Math.PI / 2;
      for (let y = 4.8; y < b.h - 1.2; y += 2.9) {
        const cols = Math.max(1, Math.floor(b.w / 2));
        for (let c = 0; c < cols; c++) {
          const zz = b.z - b.w / 2 + ((c + 0.5) * b.w) / cols;
          const v = hash(b.k * 31 + y * 3 + c);
          (v > 0.82 ? lit : v > 0.74 ? cool : dark).push(
            box(x, y, zz, 1.0, 1.3, 1, ry)
          );
        }
      }
    });
    return { dark, lit, cool };
  }, [buildings, half]);
  const lamps = useMemo(() => {
    const list = [];
    for (let z = decoded.zBack - 20; z < L.ZB + 24; z += LAMP_GAP)
      for (const side of [-1, 1]) list.push([side * (half + 0.5), z, side]);
    return list;
  }, [decoded.zBack, L.ZB, half]);
  // 바리게이트 앞 길에 떨어지는 가로등 불빛만 바닥 빛·반사·빛줄기를 그린다
  const roadLamps = lamps.filter(([, z]) => z < L.ZB - 1);
  const trees = useMemo(() => {
    const trunks = [];
    const leaves = [];
    for (let z = decoded.zBack - 14; z < L.ZB - 4; z += 16)
      for (const side of [-1, 1]) {
        const zz = z + (side > 0 ? 7 : 0);
        if (
          L.alleys.some(
            ([ax, az]) => Math.sign(ax) === side && Math.abs(az - zz) < 3
          )
        )
          continue;
        const x = side * (half + 1.5);
        trunks.push(box(x, 1.7, zz, 0.22, 3.4, 0.22));
        for (let k = 0; k < 3; k++) {
          const s = 1.3 + hash(zz + k) * 0.6;
          leaves.push(
            box(
              x + (k - 1) * 0.6,
              3.9 + k * 0.45,
              zz + (k % 2 ? 0.4 : -0.3),
              s,
              s * 0.9,
              s
            )
          );
        }
      }
    return { trunks, leaves };
  }, [decoded.zBack, L.ZB, L.alleys, half]);
  const poles = useMemo(() => {
    const list = [];
    for (let z = decoded.zBack - 24; z < L.ZB - 6; z += 26)
      for (const side of [-1, 1]) list.push([side * (half + 3.2), z + 6.5]);
    return list;
  }, [decoded.zBack, L.ZB, half]);
  // 전봇대 사이로 늘어진 전선 세 가닥
  const wires = useMemo(() => {
    const pts = [];
    for (const side of [-1, 1]) {
      const ps = poles.filter(([x]) => Math.sign(x) === side);
      for (let k = 0; k + 1 < ps.length; k++)
        for (const dx of [-0.7, 0, 0.7]) {
          const [xa, za] = ps[k];
          const [, zb] = ps[k + 1];
          for (let s = 0; s < 8; s++) {
            const u0 = s / 8;
            const u1 = (s + 1) / 8;
            const sag = (u) => 8.6 - Math.sin(Math.PI * u) * 0.9;
            pts.push(
              xa + dx,
              sag(u0),
              za + (zb - za) * u0,
              xa + dx,
              sag(u1),
              za + (zb - za) * u1
            );
          }
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [poles]);
  useEffect(() => () => wires.dispose(), [wires]);
  // 쓰레기통과 쓰레기봉투
  const clutter = useMemo(() => {
    const bins = [];
    const bags = [];
    for (let z = decoded.zBack - 10; z < L.ZB - 4; z += 7)
      for (const side of [-1, 1]) {
        const v = hash(z * 3 + side);
        const x = side * (half + WALK - 0.7);
        if (v > 0.7) bins.push(box(x, 0.62, z, 0.75, 1.0, 0.75));
        if (v < 0.35)
          bags.push(box(x + side * 0.1, 0.3, z + 0.8, 0.55, 0.42, 0.5));
      }
    return { bins, bags };
  }, [decoded.zBack, L.ZB, half]);
  const dashes = useMemo(() => {
    const list = [];
    for (let z = z0; z < L.ZB - 8; z += 6)
      for (const x of [-half / 2, half / 2])
        list.push(box(x, 0.02, z, 0.16, 1, 3));
    return list;
  }, [z0, L.ZB, half]);
  const center = useMemo(() => {
    const list = [];
    for (let z = z0; z < L.ZB - 8; z += 4)
      for (const x of [-0.13, 0.13]) list.push(box(x, 0.018, z, 0.11, 1, 2.6));
    return list;
  }, [z0, L.ZB]);
  const zebra = useMemo(() => {
    const list = [];
    for (let x = -half + 0.6; x < half; x += 1.1)
      list.push(box(x, 0.021, L.ZB - 5.5, 0.55, 1, 3));
    return list;
  }, [half, L.ZB]);
  const plane = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const flat = useMemo(
    () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    []
  );
  const unit = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const ball = useMemo(() => new THREE.SphereGeometry(0.5, 12, 8), []);
  const trunk = useMemo(() => new THREE.CylinderGeometry(0.5, 0.6, 1, 8), []);
  return (
    <group>
      {/* 바닥 */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.01, (z0 + z1) / 2]}>
        <planeGeometry args={[220, len + 60]} />
        <meshStandardMaterial color="#1c2029" roughness={1} />
      </mesh>
      {/* 젖은 차도 */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.005, (z0 + L.ZB) / 2]}>
        <planeGeometry args={[half * 2, L.ZB - z0]} />
        <meshStandardMaterial
          map={tex.map}
          roughnessMap={tex.roughnessMap}
          roughness={1}
          metalness={0.15}
        />
      </mesh>
      {/* 인도 (조금 높게, 젖어서 반들거린다) */}
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[side * (half + WALK / 2), 0.06, (z0 + z1) / 2]}>
            <boxGeometry args={[WALK, 0.12, len]} />
            <meshStandardMaterial color="#4a505c" roughness={0.45} />
          </mesh>
          <mesh position={[side * (half + 0.08), 0.07, (z0 + L.ZB) / 2]}>
            <boxGeometry args={[0.16, 0.14, L.ZB - z0]} />
            <meshStandardMaterial color="#7d8390" roughness={0.6} />
          </mesh>
        </group>
      ))}
      {/* 가운데 노란 겹선, 흰 점선, 횡단보도 */}
      <Instances matrices={center} geometry={flat}>
        <meshStandardMaterial color="#d9a821" roughness={0.5} />
      </Instances>
      <Instances matrices={dashes} geometry={flat}>
        <meshStandardMaterial color="#cfd3da" roughness={0.5} />
      </Instances>
      <Instances matrices={zebra} geometry={flat}>
        <meshStandardMaterial color="#d6d9de" roughness={0.5} />
      </Instances>
      {/* 바리게이트 안쪽 광장 */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.008, L.ZB + 17]}>
        <planeGeometry args={[(half + 3) * 2, 34]} />
        <meshStandardMaterial color="#3b3f48" roughness={0.6} />
      </mesh>
      {/* 건물 */}
      {buildings.map((b) => (
        <mesh
          key={`${b.side}${b.k}`}
          position={[b.side * (half + WALK + 6), b.h / 2, b.z]}
        >
          <boxGeometry args={[12, b.h, b.w]} />
          <meshStandardMaterial
            color={WALLS[b.k % WALLS.length]}
            roughness={0.9}
          />
        </mesh>
      ))}
      <Instances matrices={windows.dark} geometry={plane}>
        <meshStandardMaterial
          color="#141a26"
          roughness={0.2}
          metalness={0.4}
          side={THREE.DoubleSide}
        />
      </Instances>
      <Instances matrices={windows.lit} geometry={plane}>
        <meshBasicMaterial
          color="#ffc773"
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </Instances>
      <Instances matrices={windows.cool} geometry={plane}>
        <meshBasicMaterial
          color="#8fc2ff"
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </Instances>
      {/* 1층 가게 */}
      {shops.map(({ b, open, awning, pharmacy, sign, glow }) => {
        const x = b.side * (half + WALK + 0.03);
        const ry = b.side < 0 ? Math.PI / 2 : -Math.PI / 2;
        const sw = Math.min(b.w * 0.85, 4.6);
        return (
          <group key={`s${b.side}${b.k}`}>
            {open ? (
              <mesh position={[x, 1.4, b.z]} rotation-y={ry}>
                <planeGeometry args={[b.w * 0.8, 2.2]} />
                <meshBasicMaterial color="#ffcf87" toneMapped={false} />
              </mesh>
            ) : (
              <mesh position={[x, 1.4, b.z]} rotation-y={ry}>
                <planeGeometry args={[b.w * 0.8, 2.6]} />
                <meshStandardMaterial
                  map={tex.shutter}
                  metalness={0.5}
                  roughness={0.5}
                />
              </mesh>
            )}
            {awning && (
              <mesh
                position={[x - b.side * 0.55, 2.85, b.z]}
                rotation={[0, ry, 0]}
              >
                <boxGeometry args={[b.w * 0.82, 0.06, 1.1]} />
                <meshStandardMaterial map={tex.awning} roughness={0.7} />
              </mesh>
            )}
            <mesh position={[x - b.side * 0.03, 3.5, b.z]} rotation-y={ry}>
              <planeGeometry args={[sw, 0.95]} />
              <meshBasicMaterial map={sign} toneMapped={false} />
            </mesh>
            {/* 간판 불빛이 벽과 인도에 번진다 */}
            <mesh position={[x - b.side * 0.05, 3.5, b.z]} rotation-y={ry}>
              <planeGeometry args={[sw * 1.6, 2.4]} />
              <meshBasicMaterial
                map={tex.glow}
                color={glow}
                transparent
                opacity={0.35}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
              />
            </mesh>
            {pharmacy && (
              <mesh
                position={[x - b.side * 0.55, 4.6, b.z + b.w * 0.35]}
                rotation-y={ry + Math.PI / 2}
              >
                <boxGeometry args={[0.9, 1.8, 0.2]} />
                <meshBasicMaterial map={tex.cross} toneMapped={false} />
              </mesh>
            )}
          </group>
        );
      })}
      {/* 골목 입구: 어두운 바닥과 쓰레기통 */}
      {L.alleys.map(([ax, az], k) => (
        <group key={k}>
          <mesh
            rotation-x={-Math.PI / 2}
            position={[ax + Math.sign(ax) * 5, 0.13, az]}
          >
            <planeGeometry args={[12, 4.2]} />
            <meshStandardMaterial color="#14171d" roughness={0.6} />
          </mesh>
          <mesh position={[ax + Math.sign(ax) * 3.5, 0.6, az + 1.5]}>
            <boxGeometry args={[1.4, 1.2, 0.9]} />
            <meshStandardMaterial color="#1f4a2c" roughness={0.7} />
          </mesh>
        </group>
      ))}
      {/* 가로수 */}
      <Instances matrices={trees.trunks} geometry={trunk}>
        <meshStandardMaterial color="#2d2119" roughness={1} />
      </Instances>
      <Instances matrices={trees.leaves} geometry={ball}>
        <meshStandardMaterial color="#1a3324" roughness={0.9} />
      </Instances>
      {/* 쓰레기통, 쓰레기봉투 */}
      <Instances matrices={clutter.bins} geometry={unit}>
        <meshStandardMaterial color="#1f5a35" roughness={0.6} />
      </Instances>
      <Instances matrices={clutter.bags} geometry={ball}>
        <meshStandardMaterial color="#0e1013" roughness={0.3} />
      </Instances>
      {/* 전봇대와 전선 */}
      {poles.map(([x, z], k) => (
        <group key={k} position={[x, 0, z]}>
          <mesh position={[0, 4.5, 0]}>
            <cylinderGeometry args={[0.13, 0.16, 9, 10]} />
            <meshStandardMaterial color="#5b616c" roughness={0.8} />
          </mesh>
          <mesh position={[0, 0.9, 0]}>
            <cylinderGeometry args={[0.17, 0.17, 1.6, 10, 1, true]} />
            <meshStandardMaterial map={tex.pole} roughness={0.7} />
          </mesh>
          <mesh position={[0, 8.6, 0]}>
            <boxGeometry args={[1.7, 0.12, 0.12]} />
            <meshStandardMaterial color="#3a3f47" />
          </mesh>
        </group>
      ))}
      <lineSegments geometry={wires}>
        <lineBasicMaterial color="#0b0d12" />
      </lineSegments>
      {/* 가로등: 푸른 LED, 빛기둥, 바닥에 번지는 빛, 젖은 길에 길게 비친 빛 */}
      {lamps.map(([x, z, side], k) => (
        <group key={k} position={[x, 0, z]}>
          <mesh position={[0, 2.9, 0]}>
            <cylinderGeometry args={[0.07, 0.09, 5.8, 8]} />
            <meshStandardMaterial
              color="#3a3f47"
              metalness={0.5}
              roughness={0.5}
            />
          </mesh>
          <mesh position={[-side * 0.7, 5.75, 0]} rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[0.05, 0.05, 1.4, 8]} />
            <meshStandardMaterial
              color="#3a3f47"
              metalness={0.5}
              roughness={0.5}
            />
          </mesh>
          <mesh position={[-side * 1.35, 5.62, 0]}>
            <boxGeometry args={[0.55, 0.12, 0.28]} />
            <meshBasicMaterial color="#e4f1ff" toneMapped={false} />
          </mesh>
          <mesh position={[-side * 1.35, 5.6, 0]}>
            <planeGeometry args={[2.2, 2.2]} />
            <meshBasicMaterial
              map={tex.glow}
              color="#9cc8ff"
              transparent
              opacity={0.5}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <mesh position={[-side * 1.35, 2.8, 0]}>
            <coneGeometry args={[2.4, 5.6, 20, 1, true]} />
            <meshBasicMaterial
              color="#7fb2ff"
              transparent
              opacity={0.05}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      ))}
      {roadLamps.map(([x, z, side], k) => (
        <group key={`p${k}`}>
          <mesh rotation-x={-Math.PI / 2} position={[x - side * 1.6, 0.03, z]}>
            <planeGeometry args={[7.5, 7.5]} />
            <meshBasicMaterial
              map={tex.glow}
              color="#86b4ff"
              transparent
              opacity={0.32}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <mesh
            rotation-x={-Math.PI / 2}
            position={[x - side * 2.2, 0.035, z + 5]}
          >
            <planeGeometry args={[0.9, 10]} />
            <meshBasicMaterial
              map={tex.streak}
              color="#b8d4ff"
              transparent
              opacity={0.3}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        </group>
      ))}
      {/* 가게 불빛이 젖은 인도와 길가에 비친다 */}
      {shops
        .filter((s) => s.open)
        .map(({ b, glow }) => (
          <mesh
            key={`r${b.side}${b.k}`}
            rotation-x={-Math.PI / 2}
            position={[b.side * (half + 1.2), 0.04, b.z + 3]}
          >
            <planeGeometry args={[1.2, 7]} />
            <meshBasicMaterial
              map={tex.streak}
              color={glow}
              transparent
              opacity={0.22}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        ))}
    </group>
  );
}

/* ---------------- 바리게이트 안쪽 (구급 천막, 경광등, 조명탑) ---------------- */

function SafeZone({ rec }) {
  const L = rec.layout;
  const redRef = useRef();
  const blueRef = useRef();
  const lightRef = useRef();
  useFrame((state) => {
    const on = Math.sin(state.clock.elapsedTime * 9) > 0;
    if (redRef.current) redRef.current.color.set(on ? '#ff3030' : '#4a0d0d');
    if (blueRef.current) blueRef.current.color.set(on ? '#10164a' : '#2f6bff');
    if (lightRef.current)
      lightRef.current.color.set(on ? '#ff3030' : '#2f6bff');
  });
  const cross = useMemo(
    () => textTexture('+', { w: 128, h: 128, bg: '#ffffff', fg: '#e8352b' }),
    []
  );
  useEffect(() => () => cross.dispose(), [cross]);
  return (
    <group>
      <group position={[-L.half + 1.5, 0, L.ZB + 9]}>
        <mesh position={[0, 1.1, 0]}>
          <boxGeometry args={[3.4, 2.2, 3]} />
          <meshStandardMaterial color="#e8e8e2" roughness={0.8} />
        </mesh>
        <mesh position={[0, 2.55, 0]} rotation-y={Math.PI / 4}>
          <coneGeometry args={[2.6, 0.9, 4]} />
          <meshStandardMaterial color="#c42a22" roughness={0.7} />
        </mesh>
        <mesh position={[0, 1.4, -1.51]} rotation-y={Math.PI}>
          <planeGeometry args={[0.9, 0.9]} />
          <meshBasicMaterial map={cross} />
        </mesh>
      </group>
      <group position={[L.half - 2.2, 0, L.ZB + 12]} rotation-y={0.4}>
        <mesh position={[0, 0.6, 0]}>
          <boxGeometry args={[1.9, 0.7, 4.3]} />
          <meshStandardMaterial color="#e8ebf2" roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.62, 0]}>
          <boxGeometry args={[1.92, 0.18, 4.32]} />
          <meshStandardMaterial color="#2f5fd0" roughness={0.4} />
        </mesh>
        <mesh position={[0, 1.15, -0.2]}>
          <boxGeometry args={[1.6, 0.5, 2.1]} />
          <meshStandardMaterial
            color="#1b2333"
            roughness={0.25}
            metalness={0.4}
          />
        </mesh>
        <mesh position={[-0.3, 1.48, -0.2]}>
          <boxGeometry args={[0.5, 0.14, 0.3]} />
          <meshBasicMaterial ref={redRef} color="#ff3030" toneMapped={false} />
        </mesh>
        <mesh position={[0.3, 1.48, -0.2]}>
          <boxGeometry args={[0.5, 0.14, 0.3]} />
          <meshBasicMaterial ref={blueRef} color="#2f6bff" toneMapped={false} />
        </mesh>
        <pointLight
          ref={lightRef}
          position={[0, 2.2, -0.2]}
          intensity={18}
          distance={14}
          decay={1.6}
        />
      </group>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * (L.half + 2.2), 0, L.ZB + 3.5]}>
          <mesh position={[0, 3.5, 0]}>
            <cylinderGeometry args={[0.1, 0.12, 7, 8]} />
            <meshStandardMaterial color="#3a3f47" metalness={0.5} />
          </mesh>
          <mesh position={[0, 7.1, -0.2]} rotation-x={0.5}>
            <boxGeometry args={[1.4, 0.8, 0.2]} />
            <meshBasicMaterial color="#fff6d8" toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ---------------- 빛 ---------------- */

// 달빛(푸른 빛)과 하늘빛은 은은하게, 바리게이트 쪽 가로등과 조명탑만 진짜 빛을 낸다 (빛이 많으면 느려지므로)
function Lights({ rec, decoded }) {
  const L = rec.layout;
  const lamps = useMemo(() => {
    const list = [];
    for (let z = decoded.zBack - 20; z < L.ZB + 24; z += LAMP_GAP)
      if (z > L.ZB - 42 && z < L.ZB - 1)
        for (const side of [-1, 1])
          list.push([side * (L.half + 0.5 - 1.35), 5.4, z]);
    return list;
  }, [decoded.zBack, L.ZB, L.half]);
  const targets = useMemo(() => [-1, 1].map(() => new THREE.Object3D()), []);
  return (
    <>
      <color attach="background" args={['#070c1a']} />
      <fog attach="fog" args={[FOG, 55, 230]} />
      <hemisphereLight args={['#3d5590', '#0b0e18', 0.85]} />
      <directionalLight
        position={[-20, 40, -60]}
        intensity={0.55}
        color="#9db8ff"
      />
      <directionalLight
        position={[10, 30, L.ZB + 40]}
        intensity={0.5}
        color="#cfd9ff"
      />
      {lamps.map((p, k) => (
        <pointLight
          key={k}
          position={p}
          intensity={70}
          distance={24}
          decay={1.5}
          color="#cfe2ff"
        />
      ))}
      {/* 바리게이트 조명탑이 길을 비춘다 */}
      {[-1, 1].map((side, k) => (
        <group key={side}>
          <primitive object={targets[k]} position={[side * 2, 0, L.ZB - 12]} />
          <spotLight
            position={[side * (L.half + 2.2), 7.2, L.ZB + 3.3]}
            target={targets[k]}
            intensity={260}
            angle={0.7}
            penumbra={0.6}
            distance={70}
            decay={1.4}
            color="#fff1d6"
          />
        </group>
      ))}
    </>
  );
}

export default function NightStreet({ rec, decoded }) {
  return (
    <>
      <Lights rec={rec} decoded={decoded} />
      <NightSky />
      <Skyline zBack={decoded.zBack} half={rec.layout.half} />
      <Street rec={rec} decoded={decoded} />
      <SafeZone rec={rec} />
      <Rain />
    </>
  );
}
