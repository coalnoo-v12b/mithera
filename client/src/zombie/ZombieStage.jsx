import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { clampPan } from '../three/clampPan.js';
import {
  chime,
  chomp,
  groan,
  loop,
  lunge,
  pew,
  siren,
  splat,
  yay,
} from '../sfx.js';
import { ST, VEST_COLORS, ZS } from './decode.js';
import Instances from './Instances.jsx';
import NightStreet from './NightStreet.jsx';
import {
  FONT,
  UP,
  box,
  hash,
  roundRect,
  shutterTexture,
  textTexture,
} from './helpers.js';

// 좀비 탈출 녹화 재생. 서버가 끝까지 돌린 사람·좀비·경찰 시뮬레이션 기록을 그대로 보여줄 뿐,
// 화면에서 누가 살아남을지 계산하거나 바꾸는 일은 없다. 붙잡힘·구출·물림·셔터·생존은 모두 기록의 사건을 따른다.
// 좌표: x 는 길을 가로지르는 방향, z 는 길을 따라 바리게이트로 가는 방향 (서버와 같다). 카메라는 바리게이트 뒤(+z)에서 길을 내려다본다.

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const FLAT = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0),
  -Math.PI / 2
);

// 프레임 사이 위치를 보간해서 꺼낸다 (arr: [x, z] 가 프레임·사람 순으로 들어 있는 배열)
function at2(arr, count, F, i, f, out) {
  const f0 = Math.floor(f);
  const f1 = Math.min(F - 1, f0 + 1);
  const t = f - f0;
  const a = (f0 * count + i) * 2;
  const b = (f1 * count + i) * 2;
  out.set(
    arr[a] + (arr[b] - arr[a]) * t,
    0,
    arr[a + 1] + (arr[b + 1] - arr[a + 1]) * t
  );
  return out;
}

// 재생 위치를 옮기고, 생존·구출·물림·셔터 사건을 시각에 맞춰 알린다
function Playhead({ rec, decoded, playRef, speedRef, eventsRef }) {
  useFrame((_, dt) => {
    const p = playRef.current;
    if (!p.playing || p.done) return;
    p.f = Math.min(
      decoded.F - 1,
      p.f + Math.min(dt, 0.5) * rec.fps * speedRef.current
    );
    const tick = p.f * decoded.perFrame;
    const bus = eventsRef.current;
    while (
      p.won < rec.winnerCount &&
      p.won < rec.arrivals.length &&
      rec.arrivals[p.won][1] <= tick
    ) {
      if (bus) bus.arrive(p.won, rec.arrivals[p.won][0]);
      p.won++;
    }
    while (
      p.rescued < rec.rescues.length &&
      rec.rescues[p.rescued][0] <= tick
    ) {
      if (bus) bus.rescue(rec.rescues[p.rescued][1]);
      p.rescued++;
    }
    while (p.bitten < rec.bites.length && rec.bites[p.bitten][0] <= tick) {
      if (bus) bus.bite(rec.bites[p.bitten][1]);
      p.bitten++;
    }
    if (!p.opened && tick >= rec.layout.opensAt) {
      p.opened = true;
      if (bus) bus.open();
    }
    if (p.f >= decoded.F - 1) {
      p.done = true;
      if (bus) bus.done();
    }
  });
  return null;
}

// 상태 기록을 따라가며 지금 상태를 알려 주는 포인터 (사람마다 [스텝, 상태, ...])
const makeTrack = (count, start) => ({
  count,
  ptr: new Int32Array(count),
  st: Int8Array.from(start),
  since: new Float32Array(count),
  next: new Float32Array(count),
  yaw: new Float32Array(count),
  stride: new Float32Array(count),
  px: new Float32Array(count).fill(NaN),
  pz: new Float32Array(count),
  look: new Float32Array(count).fill(-1), // 피부가 좀비 색으로 바뀐 정도 (바뀔 때만 색을 다시 칠한다)
});
function advance(track, lists, tick) {
  for (let i = 0; i < track.count; i++) {
    const list = lists[i];
    while (track.ptr[i] < list.length && list[track.ptr[i]] <= tick) {
      track.st[i] = list[track.ptr[i] + 1];
      track.since[i] = list[track.ptr[i]];
      track.ptr[i] += 2;
    }
    track.next[i] = track.ptr[i] < list.length ? list[track.ptr[i]] : Infinity;
  }
}

const lerpAngle = (a, b, t) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};
/* ---------------- 가슴 이름표 (모든 이름을 한 장의 텍스처에 모아 둔다) ---------------- */

const CELL_W = 128;
const CELL_H = 56;
const ATLAS = 2048;
const COLS = ATLAS / CELL_W;
function nameAtlas(names) {
  const rows = Math.ceil(names.length / COLS);
  const h = Math.min(
    ATLAS,
    Math.max(64, 2 ** Math.ceil(Math.log2(rows * CELL_H)))
  );
  const c = document.createElement('canvas');
  c.width = ATLAS;
  c.height = h;
  const g = c.getContext('2d');
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  names.forEach((name, i) => {
    const x0 = (i % COLS) * CELL_W;
    const y0 = Math.floor(i / COLS) * CELL_H;
    // 흰 이름표 바탕
    roundRect(g, x0 + 3, y0 + 3, CELL_W - 6, CELL_H - 6, 12);
    g.fillStyle = '#ffffff';
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = '#1d2a44';
    g.stroke();
    let size = 38;
    g.font = `900 ${size}px ${FONT}`;
    const w = g.measureText(name).width;
    if (w > CELL_W - 18) {
      size = Math.floor((size * (CELL_W - 18)) / w);
      g.font = `900 ${size}px ${FONT}`;
    }
    g.fillStyle = '#1d2a44';
    g.fillText(name, x0 + CELL_W / 2, y0 + CELL_H / 2 + 2);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  return { tex, cw: CELL_W / ATLAS, ch: CELL_H / h };
}
function usePlateMaterial(atlas) {
  return useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          map: { value: atlas.tex },
          cell: { value: new THREE.Vector2(atlas.cw, atlas.ch) },
        },
        vertexShader: `
          attribute vec2 aCell;
          uniform vec2 cell;
          varying vec2 vUv;
          void main() {
            vUv = aCell + uv * cell;
            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          uniform sampler2D map;
          varying vec2 vUv;
          void main() {
            vec4 c = texture2D(map, vUv);
            if (c.a < 0.4) discard;
            gl_FragColor = vec4(c.rgb, 1.0);
          }`,
      }),
    [atlas]
  );
}

/* ---------------- 몸 (아이들과 좀비가 같이 쓰는 계산) ---------------- */

// 매 프레임 계산에 쓰는 임시 값 (렌더링 밖에서만 쓴다)
const S = {
  p: new THREE.Vector3(),
  at: new THREE.Vector3(),
  s: new THREE.Vector3(),
  one: new THREE.Vector3(1, 1, 1),
  q: new THREE.Quaternion(),
  e: new THREE.Euler(0, 0, 0, 'YXZ'),
  base: new THREE.Matrix4(),
  local: new THREE.Matrix4(),
  rot: new THREE.Matrix4(),
  out: new THREE.Matrix4(),
  c: new THREE.Color(),
  c2: new THREE.Color(),
};
// 자세: 팔(aL, aR)·다리(lL, lR)는 x 축 회전(음수면 앞으로 든다), lean 은 앞으로 숙임, roll 은 좌우 흔들림,
// lift 는 몸 높이, fwd 는 발을 앞(+)뒤(-)로 옮기는 거리 (누운 몸의 가운데가 기록된 자리에 오게)
const POSE = { aL: 0, aR: 0, lL: 0, lR: 0, lean: 0, roll: 0, lift: 0, fwd: 0 };
const setPose = (aL, aR, lL, lR, lean = 0, roll = 0, lift = 0, fwd = 0) => {
  POSE.aL = aL;
  POSE.aR = aR;
  POSE.lL = lL;
  POSE.lR = lR;
  POSE.lean = lean;
  POSE.roll = roll;
  POSE.lift = lift;
  POSE.fwd = fwd;
};
// 좀비 걸음 (어슬렁 / 쫓기 / 붙잡기 / 물감 맞고 주저앉기)
function zombiePose(kind, ph, time, i, sitLift) {
  if (kind === 'sit') {
    setPose(0.3, 0.2, -1.45, -1.35, -0.25, 0, sitLift);
    return;
  }
  if (kind === 'grab') {
    const w = Math.sin(time * 14 + i) * 0.12;
    setPose(-1.25 + w, -1.3 - w, 0.15, -0.15, 0.28, w * 0.5);
    return;
  }
  const fast = kind === 'chase';
  const a = Math.sin(ph * (fast ? 1 : 0.75));
  setPose(
    (fast ? -1.65 : -1.45) + a * 0.12,
    (fast ? -1.6 : -1.5) - a * 0.12,
    a * (fast ? 0.7 : 0.45),
    -a * (fast ? 0.7 : 0.45),
    fast ? 0.22 : 0.13,
    Math.sin(ph * 0.37 + i) * 0.08
  );
}

function bodyMatrix(p, yaw, scale) {
  const { at, q, e, s, one, base } = S;
  e.set(POSE.lean, yaw, POSE.roll);
  q.setFromEuler(e);
  at.set(
    p.x + Math.sin(yaw) * POSE.fwd,
    POSE.lift,
    p.z + Math.cos(yaw) * POSE.fwd
  );
  if (scale === 1) base.compose(at, q, one);
  else base.compose(at, q, s.set(scale, scale, scale));
  return base;
}
function placePart(mesh, i, pivot, angle) {
  const { local, rot, out, base } = S;
  local.makeTranslation(pivot[0], pivot[1], pivot[2]);
  if (angle) local.multiply(rot.makeRotationX(angle));
  out.multiplyMatrices(base, local);
  mesh.setMatrixAt(i, out);
}
// 물감 맞은 몸 위에 도는 별 셋과 머리의 파란 물감
function placeDizzy(stars, paint, i, headY, time) {
  const { at, out, q } = S;
  const base = S.base;
  S.local.makeTranslation(0, headY + 0.08, 0.06);
  out.multiplyMatrices(base, S.local);
  out.multiply(S.rot.makeScale(1.15, 0.55, 1.1));
  paint.setMatrixAt(i, out);
  at.setFromMatrixPosition(base);
  for (let k = 0; k < 3; k++) {
    const a = time * 4.2 + (k * Math.PI * 2) / 3 + i;
    S.p.set(
      at.x + Math.cos(a) * 0.36,
      at.y + headY + 0.42 + Math.sin(time * 6 + k) * 0.04,
      at.z + Math.sin(a) * 0.36
    );
    q.setFromAxisAngle(UP, time * 3 + k);
    out.compose(S.p, q, S.s.set(0.13, 0.13, 0.13));
    stars.setMatrixAt(i * 3 + k, out);
  }
}
function hideDizzy(stars, paint, i) {
  paint.setMatrixAt(i, ZERO);
  for (let k = 0; k < 3; k++) stars.setMatrixAt(i * 3 + k, ZERO);
}
function useStarGeometry() {
  return useMemo(() => {
    const shape = new THREE.Shape();
    for (let k = 0; k < 10; k++) {
      const r = k % 2 ? 0.45 : 1;
      const a = (k / 10) * Math.PI * 2 + Math.PI / 2;
      if (k === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, {
      depth: 0.35,
      bevelEnabled: false,
    }).center();
  }, []);
}

/* ---------------- 참가자 (장난감 같은 아이들, 가슴에 이름표) ---------------- */

const KID = {
  body: [0, 0.6, 0],
  head: [0, 1.1, 0],
  hair: [0, 1.1, 0],
  eyeL: [0.105, 1.13, 0.262],
  eyeR: [-0.105, 1.13, 0.262],
  armL: [0.245, 0.82, 0],
  armR: [-0.245, 0.82, 0],
  legL: [0.095, 0.36, 0],
  legR: [-0.095, 0.36, 0],
  plate: [0, 0.6, 0.213],
};
const SKINS = ['#f6cfaa', '#eebd92', '#f9d9bd', '#e2a97f'];
const HAIRS = ['#2b1d14', '#3a2718', '#1a1a1a', '#5a3a22', '#4a2e1c'];
const PANTS = ['#3c4a6b', '#4a4a52', '#2f3d5c', '#5b4a3a'];
const ZOMBIE_SKIN = '#8cc56a';

function useKidGeometry() {
  return useMemo(() => {
    const arm = new THREE.CapsuleGeometry(0.062, 0.2, 4, 8);
    arm.translate(0, -0.15, 0);
    const leg = new THREE.CapsuleGeometry(0.08, 0.16, 4, 8);
    leg.translate(0, -0.17, 0);
    const hair = new THREE.SphereGeometry(
      0.318,
      18,
      10,
      0,
      Math.PI * 2,
      0,
      Math.PI * 0.5
    );
    hair.rotateX(-0.5);
    return {
      body: new THREE.CapsuleGeometry(0.205, 0.2, 4, 12),
      head: new THREE.SphereGeometry(0.3, 18, 14),
      hair,
      eye: new THREE.SphereGeometry(0.042, 8, 6),
      arm,
      leg,
      plate: new THREE.PlaneGeometry(0.38, 0.166),
      shadow: new THREE.CircleGeometry(0.36, 16).rotateX(-Math.PI / 2),
      paint: new THREE.SphereGeometry(0.3, 12, 8),
    };
  }, []);
}

// 상태마다 아이의 자세
function kidPose(st, ph, time, i, u) {
  if (st === ST.RUN || st === ST.PASS) {
    const a = Math.sin(ph);
    setPose(a * 0.9, -a * 0.9, -a * 0.8, a * 0.8, 0.12);
  } else if (st === ST.WAIT) {
    // 통로 앞 무리: 팔을 흔들며 들여보내 달라고 한다
    const w = Math.sin(time * 7 + i) * 0.35;
    const m = Math.sin(time * 6 + i * 1.3) * 0.25;
    setPose(
      -2.7 + w,
      -2.5 - w,
      m,
      -m,
      0,
      0,
      Math.max(0, Math.sin(time * 6 + i)) * 0.05
    );
  } else if (st === ST.GRABBED) {
    // 붙잡혀 버둥거림
    const w = Math.sin(time * 16 + i) * 0.6;
    setPose(
      -2.2 + w,
      -1.0 - w,
      Math.sin(time * 12 + i) * 0.5,
      -Math.sin(time * 12 + i) * 0.5,
      -0.25,
      Math.sin(time * 20 + i) * 0.12
    );
  } else if (st === ST.TRIP) {
    // 앞으로 넘어져 엎드림
    const k = Math.min(1, u * 3);
    setPose(-2.9, -2.8, 0.15, -0.1, 1.45 * k, 0, 0.2 * k, -0.62 * k);
  } else if (st === ST.SAFE) {
    // 생존선을 넘고 만세
    const w = Math.sin(time * 10 + i) * 0.2;
    setPose(
      -2.9 + w,
      -2.9 - w,
      0,
      0,
      0,
      0,
      Math.abs(Math.sin(time * 7 + i)) * 0.18
    );
  } else if (st === ST.TURNING) {
    // 물려서 좀비가 되어 가는 중: 팔이 천천히 앞으로
    setPose(
      -1.4 * u,
      -1.4 * u,
      0,
      0,
      0.12 * u,
      Math.sin(time * 9 + i) * 0.1 * u
    );
  } else if (st === ST.ZOMBIE) zombiePose('walk', ph, time, i);
  else if (st === ST.ZGRAB) zombiePose('grab', ph, time, i);
  else if (st === ST.ZDIZZY) zombiePose('sit', ph, time, i, -0.3);
  else {
    // 출발 전: 숨 고르기
    const b = Math.sin(time * 3 + i * 0.7) * 0.06;
    setPose(b, -b, 0, 0);
  }
}
const isZombieSt = (s) => s === ST.ZOMBIE || s === ST.ZGRAB || s === ST.ZDIZZY;

// 몸의 한 부분 (사람 수만큼 한꺼번에 그린다)
function Part({ meshRef, geometry, count, color, extra, material }) {
  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material || null, count]}
      frustumCulled={false}
    >
      {!material && (
        <meshStandardMaterial color={color} roughness={0.65} {...extra} />
      )}
    </instancedMesh>
  );
}

function Kids({ rec, decoded, names, playRef, me, meRef, tagRef, ringRef }) {
  const { n, F } = decoded;
  const geo = useKidGeometry();
  const star = useStarGeometry();
  const atlas = useMemo(() => nameAtlas(names), [names]);
  const plateMat = usePlateMaterial(atlas);
  useEffect(
    () => () => {
      atlas.tex.dispose();
      plateMat.dispose();
    },
    [atlas, plateMat]
  );
  // 이름표마다 텍스처의 어느 칸을 쓸지
  const plateGeo = useMemo(() => {
    const g = geo.plate.clone();
    const cells = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      cells[i * 2] = (i % COLS) * atlas.cw;
      cells[i * 2 + 1] = 1 - (Math.floor(i / COLS) + 1) * atlas.ch;
    }
    g.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
    return g;
  }, [geo, atlas, n]);

  const bodyRef = useRef();
  const headRef = useRef();
  const hairRef = useRef();
  const eyeLRef = useRef();
  const eyeRRef = useRef();
  const armLRef = useRef();
  const armRRef = useRef();
  const legLRef = useRef();
  const legRRef = useRef();
  const plateRef = useRef();
  const shadowRef = useRef();
  const starRef = useRef();
  const paintRef = useRef();
  const outlineRef = useRef();
  const trackRef = useRef(null);

  // 조끼·머리카락·바지·피부 색
  useLayoutEffect(() => {
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      bodyRef.current.setColorAt(i, c.set(VEST_COLORS[i % VEST_COLORS.length]));
      hairRef.current.setColorAt(i, c.set(HAIRS[(i * 7) % HAIRS.length]));
      legLRef.current.setColorAt(i, c.set(PANTS[(i * 3) % PANTS.length]));
      legRRef.current.setColorAt(i, c);
      c.set(SKINS[i % SKINS.length]);
      headRef.current.setColorAt(i, c);
      armLRef.current.setColorAt(i, c);
      armRRef.current.setColorAt(i, c);
      c.set('#1b1b1b');
      eyeLRef.current.setColorAt(i, c);
      eyeRRef.current.setColorAt(i, c);
    }
    for (const m of [
      bodyRef,
      hairRef,
      legLRef,
      legRRef,
      headRef,
      armLRef,
      armRRef,
      eyeLRef,
      eyeRRef,
    ])
      m.current.instanceColor.needsUpdate = true;
  }, [n]);

  useFrame((state) => {
    const mesh = {
      body: bodyRef.current,
      head: headRef.current,
      hair: hairRef.current,
      eyeL: eyeLRef.current,
      eyeR: eyeRRef.current,
      armL: armLRef.current,
      armR: armRRef.current,
      legL: legLRef.current,
      legR: legRRef.current,
      plate: plateRef.current,
    };
    const shadow = shadowRef.current;
    const stars = starRef.current;
    const paint = paintRef.current;
    if (!mesh.body || !shadow || !stars || !paint) return;
    if (!trackRef.current || trackRef.current.count !== n) {
      trackRef.current = makeTrack(n, new Int8Array(n));
      trackRef.current.look.fill(0);
    }
    const tr = trackRef.current;
    const f = playRef.current.f;
    const tick = f * decoded.perFrame;
    const time = state.clock.elapsedTime;
    const { p, c, c2 } = S;
    advance(tr, decoded.events, tick);
    let recolor = false;
    for (let i = 0; i < n; i++) {
      const st = tr.st[i];
      at2(decoded.pos, n, F, i, f, p);
      if (Number.isNaN(tr.px[i])) {
        tr.px[i] = p.x;
        tr.pz[i] = p.z;
      }
      const dx = p.x - tr.px[i];
      const dz = p.z - tr.pz[i];
      const moved = Math.hypot(dx, dz);
      tr.px[i] = p.x;
      tr.pz[i] = p.z;
      tr.stride[i] += moved;

      if (st === ST.GONE) {
        for (const k in mesh) mesh[k].setMatrixAt(i, ZERO);
        shadow.setMatrixAt(i, ZERO);
        hideDizzy(stars, paint, i);
        if (i === me) {
          if (tagRef.current) tagRef.current.style.display = 'none';
          if (ringRef.current) ringRef.current.visible = false;
          if (outlineRef.current) outlineRef.current.visible = false;
        }
        continue;
      }
      // 바라보는 방향: 움직이면 가는 쪽, 생존한 뒤에는 카메라(바리게이트 안쪽) 쪽
      const walking =
        st === ST.RUN || st === ST.PASS || st === ST.WAIT || st === ST.ZOMBIE;
      if (walking && moved > 0.004)
        tr.yaw[i] = lerpAngle(tr.yaw[i], Math.atan2(dx, dz), 0.25);
      else if (st === ST.SAFE || st === ST.READY)
        tr.yaw[i] = lerpAngle(tr.yaw[i], 0, 0.15);

      // 피부: 물리면 1초 동안 초록색으로 바뀐다
      const span = Math.max(1, tr.next[i] - tr.since[i]);
      const u = Math.min(1, (tick - tr.since[i]) / span);
      const look =
        st === ST.TURNING ? Math.round(u * 8) / 8 : isZombieSt(st) ? 1 : 0;
      if (look !== tr.look[i]) {
        tr.look[i] = look;
        c.set(SKINS[i % SKINS.length]).lerp(c2.set(ZOMBIE_SKIN), look);
        mesh.head.setColorAt(i, c);
        mesh.armL.setColorAt(i, c);
        mesh.armR.setColorAt(i, c);
        c.set('#1b1b1b').lerp(c2.set('#f4f4f4'), look);
        mesh.eyeL.setColorAt(i, c);
        mesh.eyeR.setColorAt(i, c);
        recolor = true;
      }

      kidPose(st, tr.stride[i] * 5.6, time, i, u);
      let scale = 1;
      if (st === ST.SAFE) {
        // 환호하다가 바리게이트 안쪽으로 들어가며 작아져 사라진다
        const t = (tick - tr.since[i]) / rec.hz;
        if (t > 2.1) scale = Math.max(0.05, 1 - (t - 2.1) / 0.4);
      }
      const base = bodyMatrix(p, tr.yaw[i], scale);
      placePart(mesh.body, i, KID.body, 0);
      placePart(mesh.head, i, KID.head, 0);
      placePart(mesh.hair, i, KID.hair, 0);
      placePart(mesh.eyeL, i, KID.eyeL, 0);
      placePart(mesh.eyeR, i, KID.eyeR, 0);
      placePart(mesh.armL, i, KID.armL, POSE.aL);
      placePart(mesh.armR, i, KID.armR, POSE.aR);
      placePart(mesh.legL, i, KID.legL, POSE.lL);
      placePart(mesh.legR, i, KID.legR, POSE.lR);
      placePart(mesh.plate, i, KID.plate, 0);
      if (st === ST.ZDIZZY) placeDizzy(stars, paint, i, KID.head[1], time);
      else hideDizzy(stars, paint, i);
      S.out.makeTranslation(p.x, 0.02, p.z);
      shadow.setMatrixAt(i, S.out);

      if (i === me) {
        if (ringRef.current) {
          ringRef.current.position.set(p.x, 0.04, p.z);
          ringRef.current.visible = true;
        }
        const o = outlineRef.current;
        if (o) {
          o.visible = true;
          o.matrix.copy(base);
          o.matrixWorldNeedsUpdate = true;
        }
        if (!meRef.current) meRef.current = new THREE.Vector3();
        meRef.current.set(p.x, POSE.lift, p.z);
        // 머리 위 "내 생존자" 표시: 화면 좌표로 바꿔서 겹쳐 그린다
        const tag = tagRef.current;
        if (tag) {
          S.at.set(p.x, 1.75 * scale + POSE.lift, p.z).project(state.camera);
          const show =
            S.at.z < 1 && Math.abs(S.at.x) < 1.1 && Math.abs(S.at.y) < 1.1;
          tag.style.display = show ? 'block' : 'none';
          if (show)
            tag.style.transform = `translate(${((S.at.x + 1) / 2) * state.size.width}px, ${((1 - S.at.y) / 2) * state.size.height}px) translate(-50%, -100%)`;
        }
      }
    }
    for (const k in mesh) mesh[k].instanceMatrix.needsUpdate = true;
    shadow.instanceMatrix.needsUpdate = true;
    stars.instanceMatrix.needsUpdate = true;
    paint.instanceMatrix.needsUpdate = true;
    if (recolor)
      for (const k of ['head', 'armL', 'armR', 'eyeL', 'eyeR'])
        if (mesh[k].instanceColor) mesh[k].instanceColor.needsUpdate = true;
  });

  return (
    <>
      <Part meshRef={bodyRef} geometry={geo.body} count={n} color="#ffffff" />
      <Part meshRef={headRef} geometry={geo.head} count={n} color="#ffffff" />
      <Part
        meshRef={hairRef}
        geometry={geo.hair}
        count={n}
        color="#ffffff"
        extra={{ roughness: 0.9 }}
      />
      <Part
        meshRef={eyeLRef}
        geometry={geo.eye}
        count={n}
        color="#ffffff"
        extra={{ roughness: 0.3 }}
      />
      <Part
        meshRef={eyeRRef}
        geometry={geo.eye}
        count={n}
        color="#ffffff"
        extra={{ roughness: 0.3 }}
      />
      <Part meshRef={armLRef} geometry={geo.arm} count={n} color="#ffffff" />
      <Part meshRef={armRRef} geometry={geo.arm} count={n} color="#ffffff" />
      <Part meshRef={legLRef} geometry={geo.leg} count={n} color="#ffffff" />
      <Part meshRef={legRRef} geometry={geo.leg} count={n} color="#ffffff" />
      <Part
        meshRef={plateRef}
        geometry={plateGeo}
        count={n}
        material={plateMat}
      />
      <instancedMesh
        ref={shadowRef}
        args={[geo.shadow, null, n]}
        frustumCulled={false}
      >
        <meshBasicMaterial
          color="#000000"
          transparent
          opacity={0.25}
          depthWrite={false}
        />
      </instancedMesh>
      <instancedMesh
        ref={starRef}
        args={[star, null, n * 3]}
        frustumCulled={false}
      >
        <meshBasicMaterial color="#ffd23f" toneMapped={false} />
      </instancedMesh>
      <instancedMesh
        ref={paintRef}
        args={[geo.paint, null, n]}
        frustumCulled={false}
      >
        <meshStandardMaterial
          color="#1f6dff"
          emissive="#1a4fd8"
          emissiveIntensity={0.6}
          roughness={0.25}
        />
      </instancedMesh>
      {me >= 0 && (
        <>
          {/* 내 생존자: 금색 테두리와 발밑 고리 */}
          <group ref={outlineRef} matrixAutoUpdate={false} visible={false}>
            <mesh position={KID.body} scale={1.16}>
              <capsuleGeometry args={[0.205, 0.2, 4, 12]} />
              <meshBasicMaterial color="#ffc93d" side={THREE.BackSide} />
            </mesh>
            <mesh position={KID.head} scale={1.1}>
              <sphereGeometry args={[0.3, 18, 14]} />
              <meshBasicMaterial color="#ffc93d" side={THREE.BackSide} />
            </mesh>
          </group>
          <mesh ref={ringRef} rotation-x={-Math.PI / 2} visible={false}>
            <ringGeometry args={[0.48, 0.66, 32]} />
            <meshBasicMaterial color="#ffc93d" toneMapped={false} />
          </mesh>
        </>
      )}
    </>
  );
}

/* ---------------- 좀비 떼 ---------------- */

const ZOM = {
  body: [0, 0.8, 0],
  head: [0, 1.33, 0],
  eyeL: [0.1, 1.37, 0.235],
  eyeR: [-0.1, 1.37, 0.235],
  armL: [0.29, 1.03, 0],
  armR: [-0.29, 1.03, 0],
  legL: [0.11, 0.47, 0],
  legR: [-0.11, 0.47, 0],
};
const ZSKINS = ['#8cc56a', '#7bb85c', '#9ccf74', '#86b96f'];
const ZSHIRTS = ['#6b5b7a', '#5f6e52', '#7a5f4b', '#4f6175', '#8a6a6a'];

function Zombies({ decoded, playRef }) {
  const { zn, F } = decoded;
  const geo = useMemo(() => {
    const arm = new THREE.CapsuleGeometry(0.072, 0.3, 4, 8);
    arm.translate(0, -0.21, 0);
    const leg = new THREE.CapsuleGeometry(0.095, 0.24, 4, 8);
    leg.translate(0, -0.22, 0);
    return {
      body: new THREE.CapsuleGeometry(0.245, 0.3, 4, 12),
      head: new THREE.SphereGeometry(0.27, 16, 12),
      eye: new THREE.SphereGeometry(0.068, 10, 8),
      arm,
      leg,
      shadow: new THREE.CircleGeometry(0.4, 16).rotateX(-Math.PI / 2),
      paint: new THREE.SphereGeometry(0.27, 12, 8),
    };
  }, []);
  const star = useStarGeometry();
  const bodyRef = useRef();
  const headRef = useRef();
  const eyeLRef = useRef();
  const eyeRRef = useRef();
  const armLRef = useRef();
  const armRRef = useRef();
  const legLRef = useRef();
  const legRRef = useRef();
  const shadowRef = useRef();
  const starRef = useRef();
  const paintRef = useRef();
  const trackRef = useRef(null);
  useLayoutEffect(() => {
    if (!zn) return;
    const c = new THREE.Color();
    for (let j = 0; j < zn; j++) {
      bodyRef.current.setColorAt(j, c.set(ZSHIRTS[j % ZSHIRTS.length]));
      c.set(ZSKINS[(j * 3) % ZSKINS.length]);
      headRef.current.setColorAt(j, c);
      armLRef.current.setColorAt(j, c);
      armRRef.current.setColorAt(j, c);
    }
    for (const m of [bodyRef, headRef, armLRef, armRRef])
      m.current.instanceColor.needsUpdate = true;
  }, [zn]);

  useFrame((state) => {
    const mesh = {
      body: bodyRef.current,
      head: headRef.current,
      eyeL: eyeLRef.current,
      eyeR: eyeRRef.current,
      armL: armLRef.current,
      armR: armRRef.current,
      legL: legLRef.current,
      legR: legRRef.current,
    };
    const shadow = shadowRef.current;
    const stars = starRef.current;
    const paint = paintRef.current;
    if (!mesh.body || !shadow || !stars || !paint) return;
    if (!trackRef.current || trackRef.current.count !== zn)
      trackRef.current = makeTrack(zn, decoded.zstart);
    const tr = trackRef.current;
    const f = playRef.current.f;
    const tick = f * decoded.perFrame;
    const time = state.clock.elapsedTime;
    const { p } = S;
    advance(tr, decoded.zevents, tick);
    for (let j = 0; j < zn; j++) {
      const st = tr.st[j];
      if (st === ZS.HIDDEN) {
        for (const k in mesh) mesh[k].setMatrixAt(j, ZERO);
        shadow.setMatrixAt(j, ZERO);
        hideDizzy(stars, paint, j);
        continue;
      }
      at2(decoded.zpos, zn, F, j, f, p);
      if (Number.isNaN(tr.px[j])) {
        tr.px[j] = p.x;
        tr.pz[j] = p.z;
        tr.yaw[j] = 0;
      }
      const dx = p.x - tr.px[j];
      const dz = p.z - tr.pz[j];
      const moved = Math.hypot(dx, dz);
      tr.px[j] = p.x;
      tr.pz[j] = p.z;
      tr.stride[j] += moved;
      if (st !== ZS.DIZZY && st !== ZS.GRAB && moved > 0.003)
        tr.yaw[j] = lerpAngle(tr.yaw[j], Math.atan2(dx, dz), 0.2);
      zombiePose(
        st === ZS.DIZZY
          ? 'sit'
          : st === ZS.GRAB
            ? 'grab'
            : st === ZS.CHASE
              ? 'chase'
              : 'walk',
        tr.stride[j] * 4.6 + j,
        time,
        j,
        -0.4
      );
      bodyMatrix(p, tr.yaw[j], 1);
      placePart(mesh.body, j, ZOM.body, 0);
      placePart(mesh.head, j, ZOM.head, 0);
      placePart(mesh.eyeL, j, ZOM.eyeL, 0);
      placePart(mesh.eyeR, j, ZOM.eyeR, 0);
      placePart(mesh.armL, j, ZOM.armL, POSE.aL);
      placePart(mesh.armR, j, ZOM.armR, POSE.aR);
      placePart(mesh.legL, j, ZOM.legL, POSE.lL);
      placePart(mesh.legR, j, ZOM.legR, POSE.lR);
      if (st === ZS.DIZZY) placeDizzy(stars, paint, j, ZOM.head[1], time);
      else hideDizzy(stars, paint, j);
      S.out.makeTranslation(p.x, 0.02, p.z);
      shadow.setMatrixAt(j, S.out);
    }
    for (const k in mesh) mesh[k].instanceMatrix.needsUpdate = true;
    shadow.instanceMatrix.needsUpdate = true;
    stars.instanceMatrix.needsUpdate = true;
    paint.instanceMatrix.needsUpdate = true;
  });

  if (!zn) return null;
  return (
    <>
      <Part meshRef={bodyRef} geometry={geo.body} count={zn} color="#ffffff" />
      <Part meshRef={headRef} geometry={geo.head} count={zn} color="#ffffff" />
      <Part
        meshRef={eyeLRef}
        geometry={geo.eye}
        count={zn}
        color="#f6f6ee"
        extra={{ roughness: 0.3 }}
      />
      <Part
        meshRef={eyeRRef}
        geometry={geo.eye}
        count={zn}
        color="#f6f6ee"
        extra={{ roughness: 0.3 }}
      />
      <Part meshRef={armLRef} geometry={geo.arm} count={zn} color="#ffffff" />
      <Part meshRef={armRRef} geometry={geo.arm} count={zn} color="#ffffff" />
      <Part meshRef={legLRef} geometry={geo.leg} count={zn} color="#3b3f52" />
      <Part meshRef={legRRef} geometry={geo.leg} count={zn} color="#3b3f52" />
      <instancedMesh
        ref={shadowRef}
        args={[geo.shadow, null, zn]}
        frustumCulled={false}
      >
        <meshBasicMaterial
          color="#000000"
          transparent
          opacity={0.25}
          depthWrite={false}
        />
      </instancedMesh>
      <instancedMesh
        ref={starRef}
        args={[star, null, zn * 3]}
        frustumCulled={false}
      >
        <meshBasicMaterial color="#ffd23f" toneMapped={false} />
      </instancedMesh>
      <instancedMesh
        ref={paintRef}
        args={[geo.paint, null, zn]}
        frustumCulled={false}
      >
        <meshStandardMaterial
          color="#1f6dff"
          emissive="#1a4fd8"
          emissiveIntensity={0.6}
          roughness={0.25}
        />
      </instancedMesh>
    </>
  );
}

/* ---------------- 경찰의 파란 물감탄 ---------------- */

// 물감탄은 경찰 물총에서 기록에 남은 닿은 자리까지 낮은 포물선으로 날아간다.
// 맞으면 그 자리에서 파란 물감이 터지고, 빗나가면 길바닥에 물감 자국이 남는다.
const TRAIL = 6;
const BURST = 8;
const SPLASH_S = 0.55;
const SPLAT_S = 3; // 길바닥 물감 자국이 남아 있는 시간
const G = {
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  p: new THREE.Vector3(),
  q: new THREE.Quaternion(),
  s: new THREE.Vector3(),
  m: new THREE.Matrix4(),
};
function arc(out, a, b, h, u) {
  out.lerpVectors(a, b, u);
  out.y += h * 4 * u * (1 - u);
  return out;
}
// 경찰 물총 끝 (경찰이 목표를 바라볼 때)
function muzzle(cop, to, out) {
  const dx = to[0] - cop[0];
  const dz = to[2] - cop[2];
  const d = Math.hypot(dx, dz) || 1;
  return out.set(
    cop[0] + (dx / d) * 0.55 + (dz / d) * 0.12,
    cop[1] + 1.02,
    cop[2] + (dz / d) * 0.55 - (dx / d) * 0.12
  );
}

function Shots({ rec, decoded, playRef }) {
  const dropRef = useRef();
  const ringRef = useRef();
  const splatRef = useRef();
  const L = rec.layout;
  const shots = useMemo(
    () =>
      rec.shots.map(([fire, c, hit, , , ok, x, z]) => ({
        fire,
        hit,
        cop: c,
        ok: ok === 1,
        to: [x / 100, ok === 1 ? 1.15 : 0.04, z / 100],
      })),
    [rec]
  );
  const geo = useMemo(
    () => ({
      drop: new THREE.SphereGeometry(1, 8, 6),
      ring: new THREE.RingGeometry(0.6, 1, 24),
      splat: new THREE.CircleGeometry(1, 12),
    }),
    []
  );
  const soundRef = useRef({ fired: 0, landed: 0 });
  useFrame(() => {
    const dm = dropRef.current;
    const rm = ringRef.current;
    const sm = splatRef.current;
    if (!dm || !rm || !sm) return;
    const pl = playRef.current;
    const tick = pl.f * decoded.perFrame;
    const hz = rec.hz;
    const { a, b, p, q, s, m } = G;
    let d = 0;
    shots.forEach((shot, k) => {
      const live = tick >= shot.fire && tick <= shot.hit + SPLASH_S * hz;
      b.fromArray(shot.to);
      muzzle(L.cops[shot.cop], shot.to, a);
      const h = a.distanceTo(b) * 0.06;
      const u = Math.min(
        1,
        (tick - shot.fire) / Math.max(1, shot.hit - shot.fire)
      );
      // 날아가는 물감 덩어리와 꼬리
      for (let j = 0; j < TRAIL; j++, d++) {
        if (!live || tick > shot.hit) {
          dm.setMatrixAt(d, ZERO);
          continue;
        }
        const uj = Math.max(0, u - j * 0.035);
        arc(p, a, b, h, uj);
        const r = 0.13 * (1 - j / TRAIL) + 0.03;
        m.compose(p, q.identity(), s.set(r, r, r));
        dm.setMatrixAt(d, m);
      }
      // 닿은 자리에서 튀는 물감
      const t = (tick - shot.hit) / hz;
      for (let j = 0; j < BURST; j++, d++) {
        if (!live || t < 0 || t > SPLASH_S) {
          dm.setMatrixAt(d, ZERO);
          continue;
        }
        const ang = (j / BURST) * Math.PI * 2 + k;
        const reach = (shot.ok ? 0.7 : 0.5) * (t / SPLASH_S);
        p.set(
          b.x + Math.cos(ang) * reach,
          b.y + 1.6 * t - 4.9 * t * t,
          b.z + Math.sin(ang) * reach
        );
        if (p.y < 0.03) p.y = 0.03;
        const r = 0.09 * (1 - t / SPLASH_S) + 0.02;
        m.compose(p, q.identity(), s.set(r, r, r));
        dm.setMatrixAt(d, m);
      }
      // 맞은 자리: 퍼지는 고리
      if (!live || t < 0 || t > SPLASH_S || !shot.ok) rm.setMatrixAt(k, ZERO);
      else {
        const r = 0.35 + 0.7 * (t / SPLASH_S);
        m.compose(b, q.identity(), s.set(r, r, r));
        rm.setMatrixAt(k, m);
      }
      // 빗나간 물감은 길바닥에 자국이 남았다가 옅어진다
      const ts = (tick - shot.hit) / hz;
      if (shot.ok || ts < 0 || ts > SPLAT_S) sm.setMatrixAt(k, ZERO);
      else {
        const r =
          0.55 *
          Math.min(1, ts * 8) *
          (1 - Math.max(0, ts - SPLAT_S + 0.6) / 0.6);
        p.set(b.x, 0.035 + (k % 7) * 0.001, b.z);
        m.compose(p, FLAT, s.set(r * (1 + (k % 3) * 0.15), r, r));
        sm.setMatrixAt(k, m);
      }
    });
    dm.instanceMatrix.needsUpdate = true;
    rm.instanceMatrix.needsUpdate = true;
    sm.instanceMatrix.needsUpdate = true;
    // 소리: 쏠 때 "퓽", 닿을 때 "철퍽" (순서대로 정렬돼 있어서 앞에서부터 센다)
    const snd = soundRef.current;
    if (pl.playing && !pl.done) {
      let fired = 0;
      while (snd.fired < shots.length && shots[snd.fired].fire <= tick) {
        snd.fired++;
        fired++;
      }
      if (fired) pew();
      let landed = 0;
      let ok = false;
      while (snd.landed < shots.length && shots[snd.landed].hit <= tick) {
        ok = ok || shots[snd.landed].ok;
        snd.landed++;
        landed++;
      }
      if (landed) splat(ok ? 1 : 0.45);
    }
  });
  if (!shots.length) return null;
  return (
    <>
      <instancedMesh
        ref={dropRef}
        args={[geo.drop, null, shots.length * (TRAIL + BURST)]}
        frustumCulled={false}
      >
        <meshStandardMaterial
          color="#2a7bff"
          emissive="#0b3fb0"
          emissiveIntensity={0.5}
          roughness={0.2}
        />
      </instancedMesh>
      <instancedMesh
        ref={ringRef}
        args={[geo.ring, null, shots.length]}
        frustumCulled={false}
      >
        <meshBasicMaterial
          color="#7fb2ff"
          transparent
          opacity={0.75}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </instancedMesh>
      <instancedMesh
        ref={splatRef}
        args={[geo.splat, null, shots.length]}
        frustumCulled={false}
      >
        {/* 밤에도 잘 보이게 형광 물감처럼 은은히 빛난다 */}
        <meshStandardMaterial
          color="#1f5fe0"
          emissive="#1a4fd8"
          emissiveIntensity={0.7}
          roughness={0.3}
          polygonOffset
          polygonOffsetFactor={-2}
        />
      </instancedMesh>
    </>
  );
}

/* ---------------- 경찰 (바리게이트 위, 파란 몸통·주황 탱크 물총) ---------------- */

function CopBody({ vest, gunRef, megaphone }) {
  return (
    <>
      <mesh position={[0, 0.82, 0]}>
        <capsuleGeometry args={[0.25, 0.36, 4, 12]} />
        <meshStandardMaterial color="#22314f" roughness={0.6} />
      </mesh>
      {/* 형광 조끼와 등판의 "경찰" */}
      <mesh position={[0, 0.9, 0]}>
        <cylinderGeometry args={[0.272, 0.272, 0.42, 14, 1, true]} />
        <meshStandardMaterial
          color="#c8ef3c"
          roughness={0.5}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh position={[0, 0.92, -0.278]} rotation-y={Math.PI}>
        <planeGeometry args={[0.4, 0.2]} />
        <meshBasicMaterial map={vest} transparent />
      </mesh>
      <mesh position={[0, 1.3, 0]}>
        <sphereGeometry args={[0.22, 14, 10]} />
        <meshStandardMaterial color="#f1c8a3" />
      </mesh>
      {/* 모자 */}
      <mesh position={[0, 1.47, 0]}>
        <cylinderGeometry args={[0.23, 0.24, 0.13, 16]} />
        <meshStandardMaterial color="#1b2740" />
      </mesh>
      <mesh position={[0, 1.43, 0.18]}>
        <boxGeometry args={[0.36, 0.03, 0.16]} />
        <meshStandardMaterial color="#111a2c" />
      </mesh>
      <mesh position={[0, 1.48, 0.235]}>
        <boxGeometry args={[0.08, 0.07, 0.01]} />
        <meshStandardMaterial color="#f2c94c" metalness={0.6} roughness={0.3} />
      </mesh>
      {[0.12, -0.12].map((x) => (
        <mesh key={x} position={[x, 0.22, 0]}>
          <capsuleGeometry args={[0.09, 0.26, 4, 8]} />
          <meshStandardMaterial color="#1b2740" />
        </mesh>
      ))}
      {megaphone ? (
        <group position={[0.18, 1.3, 0.28]} rotation-x={Math.PI / 2}>
          <mesh>
            <cylinderGeometry args={[0.05, 0.16, 0.34, 14, 1, true]} />
            <meshStandardMaterial color="#f2f2f2" side={THREE.DoubleSide} />
          </mesh>
        </group>
      ) : (
        // 물총: 파란 몸통, 위에 주황 탱크
        <group ref={gunRef} position={[0.12, 1.02, 0.3]}>
          <mesh rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.06, 0.08, 0.62, 12]} />
            <meshStandardMaterial color="#2a7bff" roughness={0.35} />
          </mesh>
          <mesh position={[0, 0.13, -0.08]} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.085, 0.085, 0.26, 12]} />
            <meshStandardMaterial color="#ff8a2a" roughness={0.4} />
          </mesh>
          <mesh position={[0, -0.12, -0.12]}>
            <boxGeometry args={[0.07, 0.2, 0.09]} />
            <meshStandardMaterial color="#1b2740" />
          </mesh>
        </group>
      )}
      {/* 팔 (물총을 앞으로 든다) */}
      {[0.27, -0.27].map((x) => (
        <mesh key={x} position={[x * 0.9, 1.05, 0.14]} rotation-x={-1.25}>
          <capsuleGeometry args={[0.07, 0.26, 4, 8]} />
          <meshStandardMaterial color="#22314f" />
        </mesh>
      ))}
    </>
  );
}

function Cop({ rec, decoded, playRef, k, vest }) {
  const ref = useRef();
  const gunRef = useRef();
  const pos = rec.layout.cops[k];
  const mine = useMemo(
    () =>
      rec.shots
        .filter((s) => s[1] === k)
        .map(([fire, , hit, , , , x, z]) => ({
          fire,
          hit,
          to: [x / 100, z / 100],
        })),
    [rec, k]
  );
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const tick = playRef.current.f * decoded.perFrame;
    let target = null;
    let since = Infinity;
    for (const s of mine) {
      if (s.fire > tick) break;
      if (tick <= s.hit + rec.hz * 0.8) {
        target = s.to;
        since = tick - s.fire;
      }
    }
    // 기본은 길(-z) 쪽
    const want = target
      ? Math.atan2(target[0] - pos[0], target[1] - pos[2])
      : Math.PI;
    g.rotation.y = lerpAngle(g.rotation.y, want, 0.2);
    // 쏘는 순간 물총이 살짝 뒤로 튄다
    if (gunRef.current)
      gunRef.current.position.z =
        0.3 - (since < 3 ? 0.08 * (1 - since / 3) : 0);
  });
  return (
    <group ref={ref} position={pos} rotation-y={Math.PI}>
      <CopBody vest={vest} gunRef={gunRef} />
    </group>
  );
}

function Cops({ rec, decoded, playRef }) {
  const vest = useMemo(
    () => textTexture(['POLICE', '경찰'], { w: 256, h: 128, fg: '#1b2740' }),
    []
  );
  useEffect(() => () => vest.dispose(), [vest]);
  const L = rec.layout;
  return (
    <>
      {L.cops.map((c, k) => (
        <group key={k}>
          {/* 발판 (버스 지붕 위가 아니면 나무 상자) */}
          {c[1] < 2.5 && (
            <mesh position={[c[0], c[1] / 2, c[2]]}>
              <boxGeometry args={[0.95, c[1], 0.85]} />
              <meshStandardMaterial color="#9a6a3a" roughness={0.9} />
            </mesh>
          )}
          <Cop
            rec={rec}
            decoded={decoded}
            playRef={playRef}
            k={k}
            vest={vest}
          />
        </group>
      ))}
      {/* 안쪽에서 확성기로 지휘하는 경찰 (어깨 너머로 길을 보는 자리) */}
      <group
        position={[L.half - 3.2, 0, L.ZB + 7.2]}
        rotation-y={Math.PI + 0.25}
      >
        <CopBody vest={vest} megaphone />
      </group>
    </>
  );
}

/* ---------------- 바리게이트 (노란 버스, 철망, 모래주머니, 통로 셔터, 금색 생존선) ---------------- */

function chainTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = '#c9ced6';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(64, 64);
  g.moveTo(64, 0);
  g.lineTo(0, 64);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
function stripeTexture(a, b, n = 6) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = b;
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = a;
  const w = 256 / n;
  for (let k = -1; k < n + 1; k++) {
    g.beginPath();
    g.moveTo(k * w, 64);
    g.lineTo(k * w + w / 2, 64);
    g.lineTo(k * w + w, 0);
    g.lineTo(k * w + w / 2, 0);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
function busTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffc21a';
  g.fillRect(0, 0, 1024, 256);
  // 창문 줄
  g.fillStyle = '#2b3446';
  for (let k = 0; k < 8; k++) {
    roundRect(g, 40 + k * 120, 30, 100, 78, 10);
    g.fill();
  }
  g.fillStyle = '#7d8ea8';
  for (let k = 0; k < 8; k++) g.fillRect(50 + k * 120, 40, 80, 8);
  // 검은 띠와 글씨
  g.fillStyle = '#1b1b1b';
  g.fillRect(0, 128, 1024, 12);
  g.fillRect(0, 196, 1024, 10);
  g.font = `900 52px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('어린이 통학버스', 512, 168);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const BUS_H = 2.85;
const BUS_END = -5.75; // 버스 오른쪽 끝 (1번 통로 왼쪽)
const FENCE_H = 2.5;

// 셔터 하나: 처음엔 내려가 있다가 셔터가 올라가는 시각에 말려 올라간다. 위의 신호등은 경찰이
// 그 통로로 사람을 부르는 동안 초록, 잠깐 멈췄을 때 빨강.
function Shutter({ rec, decoded, playRef, g, k, tex, sign }) {
  const L = rec.layout;
  const shutterRef = useRef();
  const lampRef = useRef();
  const log = useMemo(() => rec.gates.filter((e) => e[1] === k), [rec, k]);
  const w = L.gateHalf * 2;
  useFrame((state) => {
    const tick = playRef.current.f * decoded.perFrame;
    const open = Math.min(1, Math.max(0, (tick - L.opensAt) / (1.2 * rec.hz)));
    if (shutterRef.current)
      shutterRef.current.scale.y = Math.max(0.04, 1 - open);
    let paused = false;
    for (const [t, , o] of log) {
      if (t > tick) break;
      paused = !o;
    }
    const lamp = lampRef.current;
    if (lamp) {
      const on = tick >= L.opensAt && !paused;
      const blink = !on && Math.sin(state.clock.elapsedTime * 10) > 0;
      lamp.color.set(on ? '#3dff6e' : blink ? '#ff3b30' : '#7a1a14');
    }
  });
  return (
    <group position={[g, 0, L.ZB]}>
      {/* 양옆 기둥과 위 상자 */}
      {[-1, 1].map((sgn) => (
        <mesh key={sgn} position={[sgn * (L.gateHalf + 0.13), 1.5, 0.35]}>
          <boxGeometry args={[0.26, 3.0, 0.7]} />
          <meshStandardMaterial
            color="#3d4450"
            metalness={0.4}
            roughness={0.5}
          />
        </mesh>
      ))}
      <mesh position={[0, 2.82, 0.35]}>
        <boxGeometry args={[w + 0.52, 0.42, 0.72]} />
        <meshStandardMaterial color="#4a525e" metalness={0.4} roughness={0.5} />
      </mesh>
      <mesh position={[0, 2.82, -0.015]}>
        <planeGeometry args={[0.7, 0.32]} />
        <meshBasicMaterial map={sign} />
      </mesh>
      <mesh position={[w / 2 - 0.05, 3.12, 0.1]}>
        <sphereGeometry args={[0.12, 14, 10]} />
        <meshBasicMaterial ref={lampRef} color="#7a1a14" toneMapped={false} />
      </mesh>
      <group ref={shutterRef} position={[0, 2.6, 0.12]}>
        <mesh position={[0, -1.3, 0]}>
          <planeGeometry args={[w, 2.6]} />
          <meshStandardMaterial
            map={tex}
            metalness={0.5}
            roughness={0.45}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
      {/* 통로 바닥 노랑·검정 줄무늬 */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 0.35]}>
        <planeGeometry args={[w, 0.9]} />
        <meshStandardMaterial color="#e8c22a" roughness={0.8} />
      </mesh>
    </group>
  );
}

function Barricade({ rec, decoded, playRef }) {
  const L = rec.layout;
  const left = -L.half - 3;
  const right = L.half + 3;
  const busEnd = BUS_END;
  const tex = useMemo(
    () => ({
      chain: chainTexture(),
      stripe: stripeTexture('#e8352b', '#ffffff'),
      bus: busTexture(),
      shutter: shutterTexture(),
      line: textTexture('생존선', { w: 256, h: 96, fg: '#ffd23f' }),
      signs: L.gates.map((_, k) =>
        textTexture(`${k + 1}번 통로`, {
          w: 256,
          h: 112,
          bg: '#1d6b3a',
          fg: '#ffffff',
        })
      ),
    }),
    [L.gates]
  );
  useEffect(
    () => () => {
      for (const t of Object.values(tex))
        if (Array.isArray(t)) t.forEach((x) => x.dispose());
        else t.dispose();
    },
    [tex]
  );
  // 통로와 버스를 뺀 철망 구간
  const segments = useMemo(() => {
    const cuts = [[left, BUS_END]];
    L.gates.forEach((g) =>
      cuts.push([g - L.gateHalf - 0.26, g + L.gateHalf + 0.26])
    );
    cuts.sort((a, b) => a[0] - b[0]);
    const list = [];
    let x = left;
    for (const [a, b] of cuts) {
      if (a > x + 0.05) list.push([x, a]);
      x = Math.max(x, b);
    }
    if (right > x + 0.05) list.push([x, right]);
    return list;
  }, [L.gates, L.gateHalf, left, right]);
  // 모래주머니: 철망 구간 바닥에 두 줄로 쌓는다
  const bags = useMemo(() => {
    const list = [];
    segments.forEach(([a, b]) => {
      for (let row = 0; row < 2; row++)
        for (let x = a + 0.3 + row * 0.25; x < b - 0.25; x += 0.55)
          list.push(
            box(
              x,
              0.16 + row * 0.27,
              L.ZB + 0.22,
              0.5,
              0.27,
              0.36,
              (x * 7) % 0.2
            )
          );
    });
    return list;
  }, [segments, L.ZB]);
  const posts = useMemo(() => {
    const list = [];
    segments.forEach(([a, b]) => {
      const k = Math.max(1, Math.round((b - a) / 2));
      for (let s = 0; s <= k; s++)
        list.push(
          box(
            a + ((b - a) * s) / k,
            FENCE_H / 2,
            L.ZB + 0.45,
            0.09,
            FENCE_H,
            0.09
          )
        );
    });
    return list;
  }, [segments, L.ZB]);
  const unit = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const bag = useMemo(() => new THREE.SphereGeometry(0.5, 10, 6), []);
  const chainMats = useMemo(
    () =>
      segments.map(([a, b]) => {
        const t = tex.chain.clone();
        t.repeat.set((b - a) * 3.2, FENCE_H * 3.2);
        t.needsUpdate = true;
        return t;
      }),
    [segments, tex.chain]
  );
  useEffect(() => () => chainMats.forEach((t) => t.dispose()), [chainMats]);
  const busLen = busEnd - left;
  return (
    <group>
      {/* 노란 통학버스 (왼쪽 벽) */}
      <group position={[(left + busEnd) / 2, 0, L.ZB + 1.25]}>
        <mesh position={[0, 0.4 + (BUS_H - 0.4) / 2, 0]}>
          <boxGeometry args={[busLen, BUS_H - 0.4, 2.5]} />
          <meshStandardMaterial color="#ffc21a" roughness={0.5} />
        </mesh>
        {[-1.255, 1.255].map((z) => (
          <mesh
            key={z}
            position={[0, 0.4 + (BUS_H - 0.4) / 2, z]}
            rotation-y={z < 0 ? Math.PI : 0}
          >
            <planeGeometry args={[busLen, BUS_H - 0.4]} />
            <meshStandardMaterial map={tex.bus} roughness={0.5} />
          </mesh>
        ))}
        <mesh position={[0, BUS_H + 0.02, 0]}>
          <boxGeometry args={[busLen - 0.1, 0.06, 2.4]} />
          <meshStandardMaterial color="#f2f2ee" roughness={0.6} />
        </mesh>
        {[-busLen / 2 + 1.3, busLen / 2 - 1.5].map((x) =>
          [-1.15, 1.15].map((z) => (
            <mesh
              key={`${x}${z}`}
              position={[x, 0.45, z]}
              rotation-x={Math.PI / 2}
            >
              <cylinderGeometry args={[0.45, 0.45, 0.3, 18]} />
              <meshStandardMaterial color="#1c1c1c" roughness={0.9} />
            </mesh>
          ))
        )}
      </group>
      {/* 버스와 1번 통로 사이 콘크리트 방벽 */}
      <mesh
        position={[
          (busEnd + L.gates[0] - L.gateHalf - 0.26) / 2,
          0.55,
          L.ZB + 0.35,
        ]}
      >
        <boxGeometry
          args={[
            Math.max(0.1, L.gates[0] - L.gateHalf - 0.26 - busEnd),
            1.1,
            0.7,
          ]}
        />
        <meshStandardMaterial color="#b9b5ad" roughness={0.9} />
      </mesh>
      {/* 철망 구간 */}
      {segments.map(([a, b], k) => (
        <group key={k}>
          <mesh position={[(a + b) / 2, FENCE_H / 2 + 0.25, L.ZB + 0.45]}>
            <planeGeometry args={[b - a, FENCE_H - 0.5]} />
            <meshStandardMaterial
              map={chainMats[k]}
              alphaMap={chainMats[k]}
              transparent
              alphaTest={0.3}
              color="#d9dde3"
              metalness={0.6}
              roughness={0.4}
              side={THREE.DoubleSide}
            />
          </mesh>
          <mesh
            position={[(a + b) / 2, FENCE_H, L.ZB + 0.45]}
            rotation-z={Math.PI / 2}
          >
            <cylinderGeometry args={[0.04, 0.04, b - a, 8]} />
            <meshStandardMaterial
              color="#9aa1aa"
              metalness={0.6}
              roughness={0.4}
            />
          </mesh>
          {/* 빨강·하양 차단막 */}
          <mesh position={[(a + b) / 2, 1.05, L.ZB + 0.08]}>
            <boxGeometry args={[b - a - 0.1, 0.24, 0.06]} />
            <meshStandardMaterial map={tex.stripe} roughness={0.6} />
          </mesh>
        </group>
      ))}
      <Instances matrices={posts} geometry={unit}>
        <meshStandardMaterial color="#8a9099" metalness={0.5} roughness={0.5} />
      </Instances>
      <Instances matrices={bags} geometry={bag}>
        <meshStandardMaterial color="#c8b48a" roughness={1} />
      </Instances>
      {L.gates.map((g, k) => (
        <Shutter
          key={k}
          rec={rec}
          decoded={decoded}
          playRef={playRef}
          g={g}
          k={k}
          tex={tex.shutter}
          sign={tex.signs[k]}
        />
      ))}
      {/* 금색 생존선과 은은한 빛 */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.04, L.lineZ]}>
        <planeGeometry args={[right - left, 0.22]} />
        <meshBasicMaterial color="#ffcf3d" toneMapped={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.035, L.lineZ]}>
        <planeGeometry args={[right - left, 1.0]} />
        <meshBasicMaterial
          color="#ffcf3d"
          transparent
          opacity={0.28}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {L.gates.map((g) => (
        <mesh
          key={g}
          rotation-x={-Math.PI / 2}
          position={[g, 0.045, L.lineZ + 0.5]}
          rotation-z={Math.PI}
        >
          <planeGeometry args={[1.5, 0.56]} />
          <meshBasicMaterial map={tex.line} transparent toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/* ---------------- 길 위 자동차·장애물 ---------------- */

const CAR_COLORS = ['#c94c4c', '#4c6fc9', '#e6e6e6', '#3d3d3d', '#6aa86a'];
function Car({ car, k, blink, taxiSign }) {
  const [x, z, len, wid, along, kind] = car;
  const ry = along ? 0 : Math.PI / 2; // 길이 방향을 z 로 맞춘 뒤 돌린다
  if (kind === 0) {
    // 옆으로 누운 택시: 바퀴가 길 가운데를, 지붕의 TAXI 표시등이 길가를 본다
    return (
      <group position={[x, 0, z]} rotation-y={ry + (k % 2 ? 0.08 : -0.06)}>
        <group position={[0.86, wid / 2 - 0.05, 0]} rotation-z={Math.PI / 2}>
          <mesh position={[0, 0.58, 0]}>
            <boxGeometry args={[wid - 0.1, 0.72, len]} />
            <meshStandardMaterial
              color="#f4b223"
              roughness={0.35}
              metalness={0.15}
            />
          </mesh>
          <mesh position={[0, 1.18, -0.12]}>
            <boxGeometry args={[wid * 0.82, 0.55, len * 0.52]} />
            <meshStandardMaterial
              color="#1b2333"
              roughness={0.2}
              metalness={0.4}
            />
          </mesh>
          <mesh position={[(wid - 0.1) / 2 + 0.005, 0.62, 0]}>
            <boxGeometry args={[0.02, 0.14, len * 0.9]} />
            <meshStandardMaterial color="#1b1b1b" />
          </mesh>
          {[-1, 1].map((sx) =>
            [-1, 1].map((sz) => (
              <mesh
                key={`${sx}${sz}`}
                position={[(sx * wid) / 2.25, 0.34, (sz * len) / 3]}
                rotation-z={Math.PI / 2}
              >
                <cylinderGeometry args={[0.34, 0.34, 0.24, 16]} />
                <meshStandardMaterial color="#141414" roughness={0.9} />
              </mesh>
            ))
          )}
          <mesh position={[0, 1.55, -0.12]}>
            <boxGeometry args={[0.62, 0.2, 0.26]} />
            <meshBasicMaterial map={taxiSign} toneMapped={false} />
          </mesh>
        </group>
      </group>
    );
  }
  // 옆으로 멈춰 선 승용차: 비상등이 깜빡인다
  const color = CAR_COLORS[k % CAR_COLORS.length];
  return (
    <group position={[x, 0, z]} rotation-y={ry + (k % 2 ? 0.1 : -0.12)}>
      <mesh position={[0, 0.58, 0]}>
        <boxGeometry args={[wid, 0.62, len]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.2} />
      </mesh>
      <mesh position={[0, 1.12, -0.1]}>
        <boxGeometry args={[wid * 0.86, 0.5, len * 0.5]} />
        <meshStandardMaterial
          color="#2b3446"
          roughness={0.25}
          metalness={0.4}
        />
      </mesh>
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <mesh
            key={`${sx}${sz}`}
            position={[(sx * wid) / 2.2, 0.34, (sz * len) / 3]}
            rotation-z={Math.PI / 2}
          >
            <cylinderGeometry args={[0.33, 0.33, 0.24, 16]} />
            <meshStandardMaterial color="#1c1c1c" roughness={0.9} />
          </mesh>
        ))
      )}
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <mesh
            key={`l${sx}${sz}`}
            position={[(sx * wid) / 2.6, 0.72, (sz * len) / 2 + sz * 0.01]}
            material={blink}
          >
            <boxGeometry args={[0.32, 0.12, 0.04]} />
          </mesh>
        ))
      )}
    </group>
  );
}
function Hazard({ h, k }) {
  const [x, z, kind] = h;
  const ry = hash(k) * Math.PI * 2;
  if (kind === 0)
    // 넘어진 쇼핑카트
    return (
      <group position={[x, 0, z]} rotation-y={ry}>
        <group rotation-z={0.25} position={[0, 0.05, 0]}>
          <mesh position={[0, 0.62, 0]}>
            <boxGeometry args={[0.6, 0.45, 0.85]} />
            <meshStandardMaterial
              color="#b7c0cc"
              metalness={0.7}
              roughness={0.35}
              transparent
              opacity={0.75}
            />
          </mesh>
          <mesh position={[0, 0.95, -0.48]} rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[0.03, 0.03, 0.6, 8]} />
            <meshStandardMaterial color="#e8352b" />
          </mesh>
          {[-0.24, 0.24].map((sx) =>
            [-0.32, 0.32].map((sz) => (
              <mesh key={`${sx}${sz}`} position={[sx, 0.08, sz]}>
                <sphereGeometry args={[0.07, 8, 6]} />
                <meshStandardMaterial color="#222" />
              </mesh>
            ))
          )}
        </group>
      </group>
    );
  if (kind === 1)
    // 주황 고깔
    return (
      <group position={[x, 0, z]} rotation-y={ry}>
        <mesh position={[0, 0.03, 0]}>
          <boxGeometry args={[0.5, 0.06, 0.5]} />
          <meshStandardMaterial color="#e05a14" />
        </mesh>
        <mesh position={[0, 0.38, 0]}>
          <coneGeometry args={[0.2, 0.7, 14]} />
          <meshStandardMaterial color="#ff6a1a" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.42, 0]}>
          <cylinderGeometry args={[0.112, 0.135, 0.12, 14, 1, true]} />
          <meshStandardMaterial color="#ffffff" side={THREE.DoubleSide} />
        </mesh>
      </group>
    );
  // 쓰레기봉투
  return (
    <group position={[x, 0, z]} rotation-y={ry}>
      <mesh position={[0, 0.27, 0]} scale={[1, 0.7, 0.85]}>
        <sphereGeometry args={[0.4, 14, 10]} />
        <meshStandardMaterial color="#1f2328" roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.58, 0]}>
        <coneGeometry args={[0.08, 0.16, 8]} />
        <meshStandardMaterial color="#1f2328" roughness={0.35} />
      </mesh>
    </group>
  );
}
function Obstacles({ rec }) {
  const blinkRef = useRef(null);
  useFrame((state) => {
    if (blinkRef.current)
      blinkRef.current.emissiveIntensity =
        Math.sin(state.clock.elapsedTime * 6) > 0 ? 1.6 : 0.1;
  });
  const taxiSign = useMemo(
    () => textTexture('TAXI', { w: 128, h: 48, bg: '#ffd23f', fg: '#1b1b1b' }),
    []
  );
  useEffect(() => () => taxiSign.dispose(), [taxiSign]);
  const blink = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#ffa21a',
        emissive: '#ff8a00',
        emissiveIntensity: 1,
      }),
    []
  );
  useEffect(() => {
    blinkRef.current = blink;
    return () => {
      blinkRef.current = null;
      blink.dispose();
    };
  }, [blink]);
  const L = rec.layout;
  return (
    <>
      {L.cars.map((c, k) => (
        <Car key={k} car={c} k={k} blink={blink} taxiSign={taxiSign} />
      ))}
      {L.hazards.map((h, k) => (
        <Hazard key={k} h={h} k={k} />
      ))}
    </>
  );
}

/* ---------------- 카메라 ---------------- */

// target 에서 dir 방향으로 물러나며, corners 가 모두 화면 안에 들어오는 가장 가까운 카메라 위치를 찾는다
function fitView(camera, target, dir, corners) {
  const v = new THREE.Vector3();
  const fits = (d) => {
    camera.position.copy(target).addScaledVector(dir, d);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    return corners.every((c) => {
      v.copy(c).project(camera);
      return Math.abs(v.x) < 0.94 && Math.abs(v.y) < 0.9 && v.z < 1;
    });
  };
  let lo = 3;
  let hi = 300;
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return target.clone().addScaledVector(dir, hi);
}
const box8 = (x0, x1, y0, y1, z0, z1) => {
  const list = [];
  for (const x of [x0, x1])
    for (const y of [y0, y1])
      for (const z of [z0, z1]) list.push(new THREE.Vector3(x, y, z));
  return list;
};
const smooth = (a, b, t) => {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
};
const CAM = {
  pos: new THREE.Vector3(),
  target: new THREE.Vector3(),
  want: new THREE.Vector3(),
};

// 자동 카메라: 처음에는 높이서 길 전체(참가자와 뒤따르는 좀비 떼)를 보여주고, 곧 경찰 어깨 너머로
// 바리게이트와 길을 내려다보는 자리로 내려온다. 화면을 직접 돌리거나 옮기면 자동 이동을 멈춘다.
// "내 생존자 찾기"를 누르면 내 생존자 앞쪽에서 얼굴·가슴 이름표와 뒤쫓는 좀비가 보이게 따라간다.
function CameraRig({
  rec,
  decoded,
  playRef,
  followRef,
  autoRef,
  meRef,
  onUserMove,
}) {
  const { camera, size, controls } = useThree();
  const L = rec.layout;
  const viewsRef = useRef(null);
  useEffect(() => {
    const startTarget = new THREE.Vector3(
      0,
      0,
      (decoded.zBack + L.front) / 2 + 6
    );
    const start = fitView(
      camera,
      startTarget,
      new THREE.Vector3(0, 0.52, 0.85).normalize(),
      box8(-L.half, L.half, 0, 1.5, decoded.zBack, L.front + 2).concat(
        box8(-L.half - 3, L.half + 3, 0, 3, L.ZB, L.ZB + 1)
      )
    );
    const mainTarget = new THREE.Vector3(0, 1.2, L.ZB - 18);
    const main = fitView(
      camera,
      mainTarget,
      new THREE.Vector3(0.08, 0.3, 0.95).normalize(),
      box8(-L.half + 2, L.half - 2, 0, 3.1, L.ZB - 0.5, L.ZB + 2.6)
    );
    viewsRef.current = { startTarget, start, mainTarget, main };
    camera.position.copy(start);
    camera.lookAt(startTarget);
    if (controls) {
      controls.target.copy(startTarget);
      controls.update();
    }
  }, [camera, size.width, size.height, controls, L, decoded.zBack]);

  const userMoved = useCallback(() => {
    autoRef.current = false;
    onUserMove();
  }, [autoRef, onUserMove]);

  useFrame(() => {
    const views = viewsRef.current;
    if (!controls || !views) return;
    const { pos, target, want } = CAM;
    if (followRef.current && meRef.current) {
      // 내 생존자 앞(바리게이트 쪽)에서 뒤돌아본다: 얼굴과 이름표, 뒤쫓는 좀비가 함께 보인다
      const me = meRef.current;
      // 바리게이트에 가까이 오면(셔터·기둥에 가리지 않게) 길 쪽 뒤에서 통로를 함께 보는 자리로 옮긴다.
      // 바리게이트를 넘은 뒤에는 다시 앞에서 본다
      const d = L.ZB - me.z;
      const k = d < 0.5 ? 1 : smooth(5, 9, d);
      target.set(me.x, me.y + 0.8, me.z - 1.2 * k + 1.5 * (1 - k));
      want.set(
        me.x + 1.4,
        me.y + 3.1 + 0.6 * (1 - k),
        me.z + 6.2 * k - 5.8 * (1 - k)
      );
      controls.target.lerp(target, 0.1);
      camera.position.lerp(want, 0.08);
      controls.update();
      return;
    }
    if (!autoRef.current) return;
    const t = (playRef.current.f * decoded.perFrame) / rec.hz;
    const k = smooth(2.2, 8, t);
    target.lerpVectors(views.startTarget, views.mainTarget, k);
    pos.lerpVectors(views.start, views.main, k);
    // 사람이 돌려 놓은 뒤 "전체 보기"로 돌아올 때 튀지 않게 조금씩 다가간다
    controls.target.lerp(target, 0.08);
    camera.position.lerp(pos, 0.08);
    controls.update();
  });

  return (
    <OrbitControls
      makeDefault
      enablePan
      screenSpacePanning
      onStart={userMoved}
      onChange={(e) =>
        clampPan(
          e?.target,
          [-L.half - 10, 0, decoded.zBack - 12],
          [L.half + 10, 12, L.ZB + 20]
        )
      }
      minDistance={3}
      maxDistance={200}
      maxPolarAngle={Math.PI / 2 - 0.06}
      enableDamping
    />
  );
}

/* ---------------- 소리 ---------------- */

// 달리는 사람이 많을수록 발소리(낮은 웅성거림)가 커지고, 바람 소리가 깔린다
function Sounds({ decoded, playRef }) {
  const rainRef = useRef(null);
  const stepsRef = useRef(null);
  const hordeRef = useRef(null);
  const trackRef = useRef(null);
  const zTrackRef = useRef(null);
  useEffect(() => {
    rainRef.current = loop('rain');
    stepsRef.current = loop('steps');
    hordeRef.current = loop('horde');
    return () => {
      rainRef.current.stop();
      stepsRef.current.stop();
      hordeRef.current.stop();
    };
  }, []);
  useFrame(() => {
    const p = playRef.current;
    if (!rainRef.current) return;
    // 비는 늘 내린다
    rainRef.current.set(p.done ? 0.5 : 0.8);
    if (!p.playing || p.done) {
      stepsRef.current.set(0);
      hordeRef.current.set(p.done ? 0 : 0.35, 0.3);
      return;
    }
    const tick = p.f * decoded.perFrame;
    if (!trackRef.current || trackRef.current.count !== decoded.n)
      trackRef.current = makeTrack(decoded.n, new Int8Array(decoded.n));
    if (!zTrackRef.current || zTrackRef.current.count !== decoded.zn)
      zTrackRef.current = makeTrack(decoded.zn, decoded.zstart);
    const tr = trackRef.current;
    const zt = zTrackRef.current;
    // 이번 프레임에 새로 붙잡힌 사람이 있으면 좀비가 "으어!" 하고 덮친다
    let grabbed = false;
    for (let i = 0; i < decoded.n; i++) {
      const before = tr.st[i];
      const list = decoded.events[i];
      while (tr.ptr[i] < list.length && list[tr.ptr[i]] <= tick) {
        tr.st[i] = list[tr.ptr[i] + 1];
        tr.ptr[i] += 2;
      }
      if (tr.st[i] === ST.GRABBED && before !== ST.GRABBED) grabbed = true;
    }
    advance(zt, decoded.zevents, tick);
    if (grabbed) lunge();
    let running = 0;
    let zombies = 0;
    for (let i = 0; i < decoded.n; i++) {
      const s = tr.st[i];
      if (s === ST.RUN || s === ST.PASS) running++;
      if (s === ST.ZOMBIE || s === ST.ZGRAB) zombies++;
    }
    let chasing = 0;
    for (let j = 0; j < decoded.zn; j++) {
      const s = zt.st[j];
      if (s === ZS.SHAMBLE || s === ZS.GRAB) zombies++;
      if (s === ZS.CHASE) {
        zombies++;
        chasing++;
      }
    }
    // 달리는 사람이 많을수록 발소리가 크고 잦다
    const run = Math.min(1, (running / decoded.n) * 1.6);
    stepsRef.current.set(run * 0.9, run);
    // 좀비가 많고 쫓는 좀비가 많을수록 신음이 크고 거칠다
    hordeRef.current.set(
      0.3 + Math.min(0.7, zombies / 90),
      Math.min(1, chasing / 30)
    );
  });
  return null;
}

/* ---------------- 화면 위 안내 ---------------- */

const BUBBLE = {
  safe: (name) => (
    <>
      <b>{name}</b> 님 생존!
    </>
  ),
  rescue: (name) => (
    <>
      <b>{name}</b> 님 구출!
    </>
  ),
  bite: (name) => (
    <>
      <b>{name}</b> 님이 물렸어요
    </>
  ),
};

function Hud({ rec, names, me, busRef, tagRef, follow, onFollow, onOverview }) {
  const [list, setList] = useState([]); // 생존선을 넘은 순서대로 참가자 번호
  const [bubbles, setBubbles] = useState([]);
  const [opened, setOpened] = useState(false);
  const [bitten, setBitten] = useState(0);
  useEffect(() => {
    let id = 0;
    const push = (kind, who) => {
      id++;
      const item = { id, kind, who };
      setBubbles((b) => [...b.slice(-2), item]);
    };
    busRef.current = {
      arrive: (who) => {
        setList((l) => [...l, who]);
        push('safe', who);
      },
      rescue: (who) => push('rescue', who),
      bite: (who) => {
        setBitten((b) => b + 1);
        push('bite', who);
      },
      open: () => setOpened(true),
    };
    return () => {
      busRef.current = null;
    };
  }, [busRef]);
  const W = rec.winnerCount;
  const recent = list
    .map((who, k) => [k, who])
    .slice(-6)
    .reverse();
  const myRank = me >= 0 ? list.indexOf(me) : -1;
  return (
    <div className="zombie-hud">
      {me >= 0 && (
        <div ref={tagRef} className="zombie-me-tag">
          내 생존자 · {names[me]}
        </div>
      )}
      <div className="zombie-title">
        <b>🧟 좀비 탈출</b>
        <span>바리게이트까지 달려!</span>
      </div>
      <div className="zombie-count">
        생존 <b>{list.length}</b> / {W}
        <small>
          {opened
            ? `먼저 생존선을 넘은 ${W}명${bitten ? ` · 물림 ${bitten}명` : ''}`
            : '셔터가 열릴 때까지 바리게이트 앞에 모여요'}
        </small>
      </div>
      {opened && <div className="zombie-open">🚨 셔터가 올라가요! 통로로!</div>}
      <div className="zombie-bubbles">
        {bubbles.map((b) => (
          <div key={b.id} className={`zombie-bubble ${b.kind}`}>
            {BUBBLE[b.kind](names[b.who] + (b.who === me ? '(나)' : ''))}
          </div>
        ))}
      </div>
      {list.length > 0 && (
        <ol className="zombie-rank" aria-label="생존자 명단">
          <li className="head">생존자 명단</li>
          {recent.map(([k, who]) => (
            <li
              key={k}
              className={
                (k === list.length - 1 ? 'new' : '') + (who === me ? ' me' : '')
              }
            >
              <span>{k + 1}</span>
              <em>{names[who]}</em>
            </li>
          ))}
          {myRank >= 0 && myRank < list.length - 6 && (
            <li className="me">
              <span>{myRank + 1}</span>
              <em>{names[me]} (나)</em>
            </li>
          )}
        </ol>
      )}
      {me >= 0 && (
        <div className="zombie-cam">
          {follow ? (
            <>
              <button type="button" onClick={onOverview}>
                전체 보기
              </button>
              <button type="button" className="on" onClick={onFollow}>
                ● 내 생존자 추적 중
              </button>
            </>
          ) : (
            <button type="button" className="find" onClick={onFollow}>
              🎯 내 생존자 찾기
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- 전체 장면 ---------------- */

// playing: 재생 중인지 (카운트다운 동안은 false), speedRef: 재생 배속, me: 내 참가자 번호 (없으면 -1)
// onArrive(k, 참가자 번호): k 번째로 생존선을 넘어 당첨이 확정됨
export default function ZombieStage({
  recording,
  decoded,
  names,
  playing,
  speedRef,
  onArrive,
  onDone,
  me = -1,
}) {
  const playRef = useRef({
    f: 0,
    won: 0,
    rescued: 0,
    bitten: 0,
    opened: false,
    playing: false,
    done: false,
  });
  useEffect(() => {
    playRef.current.playing = playing;
  }, [playing]);
  const busRef = useRef(null);
  const eventsRef = useRef(null);
  const soundAtRef = useRef(0);
  useEffect(() => {
    // 생존 "뽁"은 너무 잦으면 묶어서 한 번만
    const now = () => performance.now();
    eventsRef.current = {
      arrive: (k, who) => {
        if (busRef.current) busRef.current.arrive(who);
        if (now() - soundAtRef.current > 110) {
          soundAtRef.current = now();
          yay();
        }
        onArrive(k, who);
      },
      rescue: (who) => {
        if (busRef.current) busRef.current.rescue(who);
        chime();
      },
      bite: (who) => {
        if (busRef.current) busRef.current.bite(who);
        chomp();
        setTimeout(groan, 160);
      },
      open: () => {
        if (busRef.current) busRef.current.open();
        siren();
      },
      done: onDone,
    };
  }, [onArrive, onDone]);
  const meRef = useRef(null); // 내 생존자의 지금 자리 (Kids 가 매 프레임 채운다)
  const tagRef = useRef(null);
  const ringRef = useRef(null);
  const followRef = useRef(false);
  const autoRef = useRef(true);
  const [follow, setFollow] = useState(false);
  const toggleFollow = () => {
    followRef.current = !followRef.current;
    if (!followRef.current) autoRef.current = true;
    setFollow(followRef.current);
  };
  const overview = () => {
    followRef.current = false;
    autoRef.current = true;
    setFollow(false);
  };
  const stopFollow = useCallback(() => {
    if (!followRef.current) return;
    followRef.current = false;
    setFollow(false);
  }, []);

  return (
    <>
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 30, 90], fov: 42, near: 0.3, far: 900 }}
        gl={{ antialias: true }}
      >
        <Playhead
          rec={recording}
          decoded={decoded}
          playRef={playRef}
          speedRef={speedRef}
          eventsRef={eventsRef}
        />
        <NightStreet rec={recording} decoded={decoded} />
        <Barricade rec={recording} decoded={decoded} playRef={playRef} />
        <Obstacles rec={recording} />
        <Cops rec={recording} decoded={decoded} playRef={playRef} />
        <Kids
          rec={recording}
          decoded={decoded}
          names={names}
          playRef={playRef}
          me={me}
          meRef={meRef}
          tagRef={tagRef}
          ringRef={ringRef}
        />
        <Zombies decoded={decoded} playRef={playRef} />
        <Shots rec={recording} decoded={decoded} playRef={playRef} />
        <Sounds decoded={decoded} playRef={playRef} />
        <CameraRig
          rec={recording}
          decoded={decoded}
          playRef={playRef}
          followRef={followRef}
          autoRef={autoRef}
          meRef={meRef}
          onUserMove={stopFollow}
        />
      </Canvas>
      <Hud
        rec={recording}
        names={names}
        me={me}
        busRef={busRef}
        tagRef={tagRef}
        follow={follow}
        onFollow={toggleFollow}
        onOverview={overview}
      />
    </>
  );
}
