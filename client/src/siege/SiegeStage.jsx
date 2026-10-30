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
import { clack, horn, loop, pop } from '../sfx.js';
import { ROUTE, ST, TEAM_COLORS } from './decode.js';

// 성벽 탈환전 녹화 재생. 서버가 끝까지 돌린 병사 시뮬레이션 기록을 그대로 보여줄 뿐,
// 화면에서 누가 이길지 계산하거나 바꾸는 일은 없다. 물줄기·넘어짐·공성추·성문·도착은 모두 기록의 사건을 따른다.

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

// 프레임 사이 위치를 보간해서 꺼낸다
function posAt(d, i, f, out) {
  const f0 = Math.floor(f);
  const f1 = Math.min(d.F - 1, f0 + 1);
  const t = f - f0;
  const a = (f0 * d.n + i) * 3;
  const b = (f1 * d.n + i) * 3;
  out.set(
    d.pos[a] + (d.pos[b] - d.pos[a]) * t,
    d.pos[a + 1] + (d.pos[b + 1] - d.pos[a + 1]) * t,
    d.pos[a + 2] + (d.pos[b + 2] - d.pos[a + 2]) * t
  );
  return out;
}

function Playhead({ rec, decoded, playRef, speedRef, eventsRef }) {
  useFrame((_, dt) => {
    const p = playRef.current;
    if (!p.playing || p.done) return;
    p.f = Math.min(
      decoded.F - 1,
      p.f + Math.min(dt, 0.5) * rec.fps * speedRef.current
    );
    const tick = p.f * decoded.perFrame;
    while (
      p.won < rec.winnerCount &&
      p.won < rec.arrivals.length &&
      rec.arrivals[p.won][1] <= tick
    ) {
      const [who, , route] = rec.arrivals[p.won];
      if (eventsRef.current) eventsRef.current.arrive(p.won, who, route);
      p.won++;
    }
    if (!p.gate && rec.ram.breakTick >= 0 && tick >= rec.ram.breakTick) {
      p.gate = true;
      if (eventsRef.current) eventsRef.current.gate();
    }
    if (p.f >= decoded.F - 1) {
      p.done = true;
      if (eventsRef.current) eventsRef.current.done();
    }
  });
  return null;
}

/* ---------------- 이름표 (모든 이름을 한 장의 텍스처에 모아 둔다) ---------------- */

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
  g.lineJoin = 'round';
  names.forEach((name, i) => {
    const cx = (i % COLS) * CELL_W + CELL_W / 2;
    const cy = Math.floor(i / COLS) * CELL_H + CELL_H / 2;
    let size = 44;
    g.font = `800 ${size}px Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
    const w = g.measureText(name).width;
    if (w > CELL_W - 12) {
      size = Math.floor((size * (CELL_W - 12)) / w);
      g.font = `800 ${size}px Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
    }
    g.lineWidth = 7;
    g.strokeStyle = 'rgba(10, 16, 40, 0.75)';
    g.strokeText(name, cx, cy);
    g.fillStyle = '#ffffff';
    g.fillText(name, cx, cy);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  return { tex, cw: CELL_W / ATLAS, ch: CELL_H / h };
}

/* ---------------- 병사들 ---------------- */

// 병사 한 명을 이루는 부분. pivot 기준으로 x 축 회전(팔·다리 흔들기)을 한다.
const PARTS = {
  body: { pivot: [0, 0.78, 0] },
  head: { pivot: [0, 1.24, 0] },
  helmet: { pivot: [0, 1.29, 0] },
  armL: { pivot: [0.31, 1.0, 0] },
  armR: { pivot: [-0.31, 1.0, 0] },
  legL: { pivot: [0.12, 0.46, 0] },
  legR: { pivot: [-0.12, 0.46, 0] },
  plate: { pivot: [0, 0.8, -0.275] },
};

function useSoldierGeometry() {
  return useMemo(() => {
    const arm = new THREE.CapsuleGeometry(0.075, 0.26, 4, 8);
    arm.translate(0, -0.2, 0);
    const leg = new THREE.CapsuleGeometry(0.09, 0.22, 4, 8);
    leg.translate(0, -0.2, 0);
    const plate = new THREE.PlaneGeometry(0.58, 0.254);
    plate.rotateY(Math.PI); // 등 쪽(-z)을 바라보게
    return {
      body: new THREE.CapsuleGeometry(0.25, 0.3, 4, 12),
      head: new THREE.SphereGeometry(0.22, 16, 12),
      helmet: new THREE.SphereGeometry(
        0.255,
        16,
        8,
        0,
        Math.PI * 2,
        0,
        Math.PI * 0.55
      ),
      arm,
      leg,
      plate,
      shadow: new THREE.CircleGeometry(0.42, 16).rotateX(-Math.PI / 2),
    };
  }, []);
}

const lerpAngle = (a, b, t) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

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
};

// 병사마다 화면에서만 쓰는 값 (지금 상태, 방향, 걸음 위상)
const makeLive = (n) => ({
  n,
  ptr: new Int32Array(n),
  st: new Int8Array(n),
  since: new Float32Array(n),
  next: new Float32Array(n), // 다음 상태로 바뀌는 스텝
  yaw: new Float32Array(n),
  stride: new Float32Array(n),
  px: new Float32Array(n).fill(NaN),
  pz: new Float32Array(n),
});

// 팔다리 각도 [왼팔, 오른팔, 다리] (x 축 회전). 상태마다 자세가 다르다.
function limbs(st, ph, climbY, time, i) {
  if (st === ST.RUN || st === ST.GATE) {
    const a = Math.sin(ph);
    return [a * 0.9, -a * 0.9, a * 0.7];
  }
  if (st === ST.PUSH) {
    // 물에 밀려 비틀거림
    const w = Math.sin(time * 18 + i) * 0.3;
    return [-1.9 + w, -1.4 - w, 0.35];
  }
  if (st === ST.QUEUE) {
    // 사다리 발치 무리 속: 팔을 들어 앞사람을 밀치고 사다리를 잡으려 한다
    const w = Math.sin(time * 9 + i * 1.7) * 0.45;
    return [-2.0 + w, -1.6 - w, Math.sin(ph + time * 4) * 0.4];
  }
  if (st === ST.CLIMB) {
    const c = Math.sin(climbY * 5);
    return [-2.5 + c * 0.35, -2.5 - c * 0.35, c * 0.45];
  }
  if (st === ST.STEP) return [-2.7, -2.7, 0];
  if (st === ST.ARRIVED) {
    const w = Math.sin(time * 10 + i) * 0.25;
    return [-2.9 + w, -2.9 - w, Math.sin(ph) * 0.5];
  }
  if (st === ST.FALL) return [-2.2, -1.6, 0];
  if (st === ST.DOWN) return [-0.5, 0.4, 0];
  // 출발 전: 숨 고르기
  const b = Math.sin(time * 3 + i * 0.7) * 0.06;
  return [b, -b, 0];
}

function Army({ rec, decoded, names, playRef, me, meRef, tagRef }) {
  const { n } = decoded;
  const geo = useSoldierGeometry();
  const atlas = useMemo(() => nameAtlas(names), [names]);
  const plateMat = useMemo(
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
  const helmetRef = useRef();
  const armLRef = useRef();
  const armRRef = useRef();
  const legLRef = useRef();
  const legRRef = useRef();
  const plateRef = useRef();
  const shadowRef = useRef();
  const meRingRef = useRef();
  const liveRef = useRef(null);

  // 팀 색
  useLayoutEffect(() => {
    const c = new THREE.Color();
    const dark = new THREE.Color();
    for (let i = 0; i < n; i++) {
      c.set(TEAM_COLORS[i % TEAM_COLORS.length]);
      dark.copy(c).multiplyScalar(0.8);
      bodyRef.current.setColorAt(i, c);
      helmetRef.current.setColorAt(i, dark);
    }
    bodyRef.current.instanceColor.needsUpdate = true;
    helmetRef.current.instanceColor.needsUpdate = true;
  }, [n]);

  const L = rec.layout;
  const tilt = Math.atan2(L.lean - L.topZ, L.H - L.topDrop);

  useFrame((state) => {
    const mesh = {
      body: bodyRef.current,
      head: headRef.current,
      helmet: helmetRef.current,
      armL: armLRef.current,
      armR: armRRef.current,
      legL: legLRef.current,
      legR: legRRef.current,
      plate: plateRef.current,
      shadow: shadowRef.current,
    };
    if (!mesh.body) return;
    if (!liveRef.current || liveRef.current.n !== n)
      liveRef.current = makeLive(n);
    const live = liveRef.current;
    const f = playRef.current.f;
    const tick = f * decoded.perFrame;
    const time = state.clock.elapsedTime;
    const { p, at, s, one, q, e, base, local, rot, out } = S;
    const ev = decoded.events;
    const part = (key, i, angle) => {
      const [px, py, pz] = PARTS[key].pivot;
      local.makeTranslation(px, py, pz);
      if (angle) local.multiply(rot.makeRotationX(angle));
      out.multiplyMatrices(base, local);
      mesh[key].setMatrixAt(i, out);
    };
    for (let i = 0; i < n; i++) {
      // 지금 시각까지의 상태
      const list = ev[i];
      while (live.ptr[i] < list.length && list[live.ptr[i]] <= tick) {
        live.st[i] = list[live.ptr[i] + 1];
        live.since[i] = list[live.ptr[i]];
        live.ptr[i] += 2;
      }
      live.next[i] = live.ptr[i] < list.length ? list[live.ptr[i]] : Infinity;
      const st = live.st[i];
      posAt(decoded, i, f, p);
      if (Number.isNaN(live.px[i])) {
        live.px[i] = p.x;
        live.pz[i] = p.z;
      }
      const dx = p.x - live.px[i];
      const dz = p.z - live.pz[i];
      const moved = Math.hypot(dx, dz);
      live.px[i] = p.x;
      live.pz[i] = p.z;
      live.stride[i] += moved;

      if (st === ST.GONE) {
        for (const key in mesh) mesh[key].setMatrixAt(i, ZERO);
        if (i === me && tagRef.current) tagRef.current.style.display = 'none';
        if (i === me && meRef.current) meRef.current.visible = false;
        continue;
      }
      // 바라보는 방향: 달릴 때는 가는 쪽, 그 밖에는 성벽 쪽
      if (
        (st === ST.RUN || st === ST.GATE || st === ST.QUEUE) &&
        moved > 0.002
      ) {
        live.yaw[i] = lerpAngle(live.yaw[i], Math.atan2(dx, dz), 0.25);
      } else if (st !== ST.DOWN && st !== ST.FALL && st !== ST.PUSH) {
        live.yaw[i] = lerpAngle(live.yaw[i], 0, 0.15);
      }

      // 몸 전체 자세
      let lean = 0;
      let lift = 0;
      let scale = 1;
      if (st === ST.CLIMB || st === ST.STEP) lean = -tilt * 0.6;
      if (st === ST.FALL) {
        const span = Math.max(1, live.next[i] - live.since[i]);
        lean = -1.5 * Math.min(1, (tick - live.since[i]) / span);
      }
      // 누운 몸의 가운데가 기록된 자리에 오도록 발을 앞으로 옮긴다 (서버의 겹침 판정과 같은 자리)
      let shift = 0;
      if (st === ST.DOWN) {
        // 밀려나며(떨어진 뒤) 0.45초 동안 뒤로 넘어간다 (서버에서 누운 몸의 자리가 넓어지는 동안)
        const u = Math.min(1, (tick - live.since[i]) / (0.45 * rec.hz));
        lean = -0.35 - 1.15 * u;
        lift = 0.22 * u;
        shift = 0.55 * u;
      }
      if (st === ST.PUSH) lean = -0.35;
      if (st === ST.ARRIVED) {
        // 성벽 쪽은 성 안 계단으로 내려가며, 성문 쪽은 안뜰로 걸어 들어가며 작아져 사라진다
        const t = (tick - live.since[i]) / rec.hz;
        const from = decoded.route[i] === ROUTE.GATE ? 1.2 : 1.3;
        const span = decoded.route[i] === ROUTE.GATE ? 0.8 : 1.3;
        if (t > from) scale = Math.max(0.05, 1 - (t - from) / span);
      }
      e.set(lean, live.yaw[i], 0);
      q.setFromEuler(e);
      s.set(scale, scale, scale);
      at.copy(p).setY(p.y + lift);
      if (shift) {
        at.x += Math.sin(live.yaw[i]) * shift;
        at.z += Math.cos(live.yaw[i]) * shift;
      }
      base.compose(at, q, scale === 1 ? one : s);

      const [armL, armR, leg] = limbs(st, live.stride[i] * 5.2, p.y, time, i);
      part('body', i, 0);
      part('head', i, 0);
      part('helmet', i, 0);
      part('armL', i, armL);
      part('armR', i, armR);
      part('legL', i, leg);
      part('legR', i, -leg);
      part('plate', i, 0);

      // 발밑 그림자 (땅 위에 있을 때만)
      if (p.y < 0.3 && st !== ST.FALL) {
        out.makeTranslation(p.x, 0.02, p.z);
        mesh.shadow.setMatrixAt(i, out);
      } else mesh.shadow.setMatrixAt(i, ZERO);

      if (i === me && meRef.current) {
        meRef.current.position.copy(p);
        meRef.current.visible = true;
        if (meRingRef.current)
          meRingRef.current.visible = p.y < 0.3 && st !== ST.FALL;
        // 머리 위 "내 병사" 표시: 화면 좌표로 바꿔서 겹쳐 그린다
        const tag = tagRef.current;
        if (tag) {
          S.at.set(p.x, p.y + 2.1 * scale, p.z).project(state.camera);
          const show =
            S.at.z < 1 && Math.abs(S.at.x) < 1.1 && Math.abs(S.at.y) < 1.1;
          tag.style.display = show ? 'block' : 'none';
          if (show)
            tag.style.transform = `translate(${((S.at.x + 1) / 2) * state.size.width}px, ${((1 - S.at.y) / 2) * state.size.height}px) translate(-50%, -100%)`;
        }
      }
    }
    for (const key in mesh) mesh[key].instanceMatrix.needsUpdate = true;
  });

  const std = (color, extra) => (
    <meshStandardMaterial color={color} roughness={0.6} {...extra} />
  );
  return (
    <>
      <instancedMesh
        ref={bodyRef}
        args={[geo.body, null, n]}
        frustumCulled={false}
      >
        {std('#ffffff')}
      </instancedMesh>
      <instancedMesh
        ref={helmetRef}
        args={[geo.helmet, null, n]}
        frustumCulled={false}
      >
        {std('#ffffff', { metalness: 0.45, roughness: 0.35 })}
      </instancedMesh>
      <instancedMesh
        ref={headRef}
        args={[geo.head, null, n]}
        frustumCulled={false}
      >
        {std('#f1c8a3')}
      </instancedMesh>
      <instancedMesh
        ref={armLRef}
        args={[geo.arm, null, n]}
        frustumCulled={false}
      >
        {std('#d6dae2', { metalness: 0.3 })}
      </instancedMesh>
      <instancedMesh
        ref={armRRef}
        args={[geo.arm, null, n]}
        frustumCulled={false}
      >
        {std('#d6dae2', { metalness: 0.3 })}
      </instancedMesh>
      <instancedMesh
        ref={legLRef}
        args={[geo.leg, null, n]}
        frustumCulled={false}
      >
        {std('#4a3426')}
      </instancedMesh>
      <instancedMesh
        ref={legRRef}
        args={[geo.leg, null, n]}
        frustumCulled={false}
      >
        {std('#4a3426')}
      </instancedMesh>
      <instancedMesh
        ref={plateRef}
        args={[plateGeo, plateMat, n]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={shadowRef}
        args={[geo.shadow, null, n]}
        frustumCulled={false}
      >
        <meshBasicMaterial
          color="#000000"
          transparent
          opacity={0.22}
          depthWrite={false}
        />
      </instancedMesh>
      {me >= 0 && (
        <group ref={meRef} visible={false}>
          <mesh
            ref={meRingRef}
            position={[0, 0.04, 0]}
            rotation-x={-Math.PI / 2}
          >
            <ringGeometry args={[0.5, 0.68, 32]} />
            <meshBasicMaterial color="#ffc93d" toneMapped={false} />
          </mesh>
        </group>
      )}
    </>
  );
}

/* ---------------- 물대포·물총 ---------------- */

// 물줄기는 쏜 자리에서 기록에 남은 닿은 자리까지 포물선으로 날아가고, 닿으면 물보라가 퍼진다.
// 누가 맞았는지는 병사의 상태 기록(넘어짐·밀려남·떨어짐)이 보여준다.
const CANNON_DROPS = 28;
const GUN_DROPS = 14;
const BURST = 8;
const SPLASH_S = 0.6; // 물보라가 남아 있는 시간
const TAIL_S = 0.3; // 닿은 뒤 물줄기 꼬리가 따라 들어오는 시간
const W = {
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  p: new THREE.Vector3(),
  n: new THREE.Vector3(),
  q: new THREE.Quaternion(),
  s: new THREE.Vector3(),
  m: new THREE.Matrix4(),
  flat: new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    -Math.PI / 2
  ),
};

// 쏜 자리 → 닿은 자리 포물선 위의 점 (u: 0~1)
function arc(out, a, b, h, u) {
  out.lerpVectors(a, b, u);
  out.y += h * 4 * u * (1 - u);
  return out;
}

function Water({ rec, decoded, playRef }) {
  const dropRef = useRef();
  const ringRef = useRef();
  const L = rec.layout;
  // arc: 포물선 높이(거리 대비), size: 물방울 크기, ring: 땅에 닿았을 때 퍼지는 고리 반지름
  const shots = useMemo(
    () => [
      ...rec.cannonShots.map(([fire, c, hit, , x, y, z]) => ({
        fire,
        hit,
        from: L.cannons[c],
        to: [x / 100, y / 100, z / 100],
        big: true,
        drops: CANNON_DROPS,
        arc: 0.18,
        size: 0.3,
        ring: 2.0,
      })),
      // 안뜰 물대포는 성문 통로 천장 아래로 낮게 쏜다
      ...(rec.gateShots || []).map(([fire, c, hit, , x, y, z]) => ({
        fire,
        hit,
        from: [
          L.gateCannons[c][0],
          L.gateCannons[c][1] + 0.6,
          L.gateCannons[c][2],
        ],
        to: [x / 100, y / 100, z / 100],
        big: true,
        drops: CANNON_DROPS,
        arc: 0.03,
        size: 0.26,
        ring: 1.6,
      })),
      ...rec.gunShots.map(([fire, g, hit, , , x, y, z]) => ({
        fire,
        hit,
        from: [L.defenders[g][0], L.defenders[g][1] + 1.0, L.defenders[g][2]],
        to: [x / 100, y / 100, z / 100],
        big: false,
        drops: GUN_DROPS,
        arc: 0.04,
        size: 0.09,
        ring: 0.45,
      })),
      // 꼭대기 수비군의 물바가지: 흉벽 위에서 사다리 위 병사에게 쏟아붓는다
      ...(rec.dumps || []).map(([fire, k, hit, , , x, y, z]) => ({
        fire,
        hit,
        from: [
          L.guards[k][0] * 0.82 + (x / 100) * 0.18,
          L.H + 1.25,
          L.WZ + 0.05,
        ],
        to: [x / 100, y / 100, z / 100],
        big: false,
        drops: GUN_DROPS,
        arc: 0.12,
        size: 0.17,
        ring: 0.7,
      })),
    ],
    [rec, L]
  );
  const drops = shots.reduce((sum, s) => sum + s.drops + BURST, 0);
  const geo = useMemo(
    () => ({
      drop: new THREE.SphereGeometry(1, 8, 6),
      ring: new THREE.RingGeometry(0.75, 1, 28),
    }),
    []
  );
  const soundRef = useRef({ fired: new Set(), landed: new Set() });

  useFrame(() => {
    const dm = dropRef.current;
    const rm = ringRef.current;
    if (!dm || !rm) return;
    const pl = playRef.current;
    const tick = pl.f * decoded.perFrame;
    const hz = rec.hz;
    const { a, b, p, q, s, m, flat } = W;
    let d = 0;
    shots.forEach((shot, k) => {
      const nDrops = shot.drops;
      const live =
        tick >= shot.fire && tick <= shot.hit + SPLASH_S * hz && pl.playing;
      a.fromArray(shot.from);
      b.fromArray(shot.to);
      const h = a.distanceTo(b) * shot.arc;
      // 물줄기: 머리는 날아가고, 닿은 뒤에는 꼬리가 따라 들어간다
      const head = Math.min(
        1,
        (tick - shot.fire) / Math.max(1, shot.hit - shot.fire)
      );
      const tail = Math.max(
        0,
        tick <= shot.hit
          ? head - 0.45
          : 0.55 + 0.45 * Math.min(1, (tick - shot.hit) / (TAIL_S * hz))
      );
      const size = shot.size;
      for (let j = 0; j < nDrops; j++, d++) {
        const u = tail + ((head - tail) * j) / (nDrops - 1);
        if (!live || head - tail < 0.01 || tick < shot.fire) {
          dm.setMatrixAt(d, ZERO);
          continue;
        }
        arc(p, a, b, h, u);
        // 물방울을 물줄기 방향으로 길게 늘여 이웃과 이어 붙인다 (구슬처럼 끊겨 보이지 않게)
        const du = (head - tail) / (nDrops - 1);
        arc(W.n, a, b, h, Math.min(1, u + Math.max(du, 0.002)));
        W.n.sub(p);
        const seg = W.n.length();
        const r = size * (0.8 + (0.35 * ((j * 7) % 5)) / 4);
        if (seg > 1e-4) q.setFromUnitVectors(UP, W.n.divideScalar(seg));
        else q.identity();
        s.set(r, Math.max(r, seg * 0.8), r);
        m.compose(p, q, s);
        dm.setMatrixAt(d, m);
      }
      // 물보라: 닿은 자리에서 물방울이 튀고 고리가 퍼진다
      const t = (tick - shot.hit) / hz;
      for (let j = 0; j < BURST; j++, d++) {
        if (!live || t < 0 || t > SPLASH_S) {
          dm.setMatrixAt(d, ZERO);
          continue;
        }
        const ang = (j / BURST) * Math.PI * 2 + k;
        const reach = (shot.big ? 1.6 : 0.5) * (t / SPLASH_S);
        p.set(
          b.x + Math.cos(ang) * reach,
          b.y + (shot.big ? 3 : 1.2) * t - 4.9 * t * t,
          b.z + Math.sin(ang) * reach
        );
        if (p.y < b.y) p.y = b.y;
        const r = size * 0.8 * (1 - t / SPLASH_S);
        s.set(r, r, r);
        q.identity();
        m.compose(p, q, s);
        dm.setMatrixAt(d, m);
      }
      if (!live || t < 0 || t > SPLASH_S) rm.setMatrixAt(k, ZERO);
      else {
        // 땅에 닿은 물대포는 바닥에 퍼지는 고리, 사다리·벽에 닿은 물은 세워진 고리
        const ground = shot.big && b.y < 0.3;
        const r =
          (ground ? shot.ring : shot.big ? 0.9 : shot.ring) *
          (0.3 + 0.7 * (t / SPLASH_S));
        s.set(r, r, r);
        p.copy(b);
        if (ground) p.y = 0.06;
        m.compose(p, ground ? flat : q.identity(), s);
        rm.setMatrixAt(k, m);
      }
      // 소리: 쏠 때 "쉭", 닿을 때 "철썩"
      const snd = soundRef.current;
      if (pl.playing && !pl.done) {
        if (tick >= shot.fire && !snd.fired.has(k)) {
          snd.fired.add(k);
          clack(shot.big ? 0.35 : 0.12, shot.big ? 0.75 : 1);
        }
        if (tick >= shot.hit && !snd.landed.has(k)) {
          snd.landed.add(k);
          clack(shot.big ? 0.8 : 0.3, shot.big ? 0.15 : 0.4);
        }
      }
    });
    dm.instanceMatrix.needsUpdate = true;
    rm.instanceMatrix.needsUpdate = true;
  });

  if (!shots.length) return null;
  return (
    <>
      <instancedMesh
        ref={dropRef}
        args={[geo.drop, null, drops]}
        frustumCulled={false}
      >
        <meshStandardMaterial
          color="#8fd3ff"
          emissive="#2f8fd6"
          emissiveIntensity={0.35}
          roughness={0.15}
          transparent
          opacity={0.85}
        />
      </instancedMesh>
      <instancedMesh
        ref={ringRef}
        args={[geo.ring, null, shots.length]}
        frustumCulled={false}
      >
        <meshBasicMaterial
          color="#d8f1ff"
          transparent
          opacity={0.7}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </instancedMesh>
    </>
  );
}

/* ---------------- 수비군 (성벽 위 물총, 탑 위 물대포) ---------------- */

// 수비군 한 명: 주황 옷, 물총. 가장 최근에 쏜 쪽을 바라본다.
function Defender({ position, gun }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.78, 0]}>
        <capsuleGeometry args={[0.24, 0.3, 4, 10]} />
        <meshStandardMaterial color="#f08a2c" roughness={0.6} />
      </mesh>
      <mesh position={[0, 1.24, 0]}>
        <sphereGeometry args={[0.22, 14, 10]} />
        <meshStandardMaterial color="#f1c8a3" />
      </mesh>
      <mesh position={[0, 1.3, 0]}>
        <sphereGeometry
          args={[0.26, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55]}
        />
        <meshStandardMaterial color="#e85d1a" metalness={0.3} roughness={0.4} />
      </mesh>
      {gun && (
        <group position={[0, 0.95, 0.32]} rotation-x={Math.PI / 2}>
          <mesh>
            <cylinderGeometry args={[0.08, 0.1, 0.55, 10]} />
            <meshStandardMaterial color="#2f8fd6" roughness={0.4} />
          </mesh>
          <mesh position={[0, -0.12, 0.12]}>
            <boxGeometry args={[0.12, 0.2, 0.2]} />
            <meshStandardMaterial color="#ffb347" />
          </mesh>
        </group>
      )}
    </group>
  );
}

// 각자 가장 최근 물줄기의 목표 쪽으로 몸을 돌린다
function useAim(ref, shotsOf, from, decoded, playRef, hz) {
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const tick = playRef.current.f * decoded.perFrame;
    let target = null;
    for (const s of shotsOf) {
      if (s.fire > tick) break;
      if (tick <= s.hit + hz) target = s.to;
    }
    // 기본은 들판(-z) 쪽
    const want = target
      ? Math.atan2(target[0] - from[0], target[2] - from[2])
      : Math.PI;
    g.rotation.y = lerpAngle(g.rotation.y, want, 0.15);
  });
}

function GunDefender({ rec, decoded, playRef, k }) {
  const ref = useRef();
  const pos = rec.layout.defenders[k];
  const mine = useMemo(
    () =>
      rec.gunShots
        .filter((s) => s[1] === k)
        .map(([fire, , hit, , , x, , z]) => ({
          fire,
          hit,
          to: [x / 100, 0, z / 100],
        })),
    [rec, k]
  );
  useAim(ref, mine, pos, decoded, playRef, rec.hz);
  return (
    <group ref={ref} position={pos} rotation-y={Math.PI}>
      <Defender position={[0, 0, 0]} gun />
    </group>
  );
}

// gate: 성 안뜰 물대포 (땅 위, 성문 쪽으로 낮게), 아니면 탑 위 물대포
// 사다리 꼭대기 수비군: 물바가지를 들고 있다가, 기록된 순간 사다리 쪽으로 몸을 내밀며 쏟아붓는다
function BucketGuard({ rec, decoded, playRef, k }) {
  const bodyRef = useRef();
  const bucketRef = useRef();
  const pos = rec.layout.guards[k];
  const mine = useMemo(
    () => (rec.dumps || []).filter((d) => d[1] === k),
    [rec, k]
  );
  const lx = rec.layout.ladders[k];
  useFrame(() => {
    const tick = playRef.current.f * decoded.perFrame;
    let pour = 0;
    for (const d of mine) {
      if (d[0] > tick) break;
      const span = Math.max(1, d[2] - d[0]);
      const u = (tick - d[0]) / span;
      if (u <= 1.6) pour = u <= 1 ? u : 1 - (u - 1) / 0.6;
    }
    if (bodyRef.current) bodyRef.current.rotation.x = -0.5 * pour;
    if (bucketRef.current)
      bucketRef.current.rotation.z = (lx < pos[0] ? 1 : -1) * 2.0 * pour;
  });
  return (
    <group position={pos} rotation-y={Math.PI}>
      <group ref={bodyRef}>
        <Defender position={[0, 0, 0]} />
        <group
          ref={bucketRef}
          position={[lx < pos[0] ? 0.35 : -0.35, 1.05, 0.35]}
        >
          <mesh>
            <cylinderGeometry args={[0.22, 0.17, 0.32, 12, 1, true]} />
            <meshStandardMaterial color="#8a5a2b" side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, 0.12, 0]}>
            <cylinderGeometry args={[0.2, 0.2, 0.02, 12]} />
            <meshStandardMaterial color="#6fc3ff" transparent opacity={0.85} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

function Cannon({ rec, decoded, playRef, k, gate = false }) {
  const ref = useRef();
  const pos = gate ? rec.layout.gateCannons[k] : rec.layout.cannons[k];
  const mine = useMemo(
    () =>
      (gate ? rec.gateShots || [] : rec.cannonShots)
        .filter((s) => s[1] === k)
        .map(([fire, , hit, , x, , z]) => ({
          fire,
          hit,
          to: [x / 100, 0, z / 100],
        })),
    [rec, k, gate]
  );
  useAim(ref, mine, pos, decoded, playRef, rec.hz);
  return (
    <group
      ref={ref}
      position={[pos[0], gate ? 0 : 10, pos[2]]}
      rotation-y={Math.PI}
    >
      {/* 받침과 포신 (탑 위는 들판으로 기울이고, 안뜰은 성문 쪽으로 낮게) */}
      <mesh position={[0, gate ? 0.55 : 0.35, 0]}>
        <boxGeometry args={[0.9, gate ? 1.1 : 0.7, 1.1]} />
        <meshStandardMaterial color="#6b4423" roughness={0.8} />
      </mesh>
      <group
        position={[0, gate ? 1.35 : 0.85, 0.2]}
        rotation-x={Math.PI / 2 + (gate ? 0.04 : 0.35)}
      >
        <mesh>
          <cylinderGeometry args={[0.28, 0.36, 1.8, 16]} />
          <meshStandardMaterial
            color="#2f6fd6"
            metalness={0.4}
            roughness={0.35}
          />
        </mesh>
        <mesh position={[0, -0.95, 0]}>
          <cylinderGeometry args={[0.32, 0.32, 0.18, 16]} />
          <meshStandardMaterial
            color="#f2a33a"
            metalness={0.5}
            roughness={0.3}
          />
        </mesh>
      </group>
      <Defender position={[0.8, 0, -0.5]} />
    </group>
  );
}

/* ---------------- 공성추와 성문 ---------------- */

const ramFront = (R, tick, hz) =>
  Math.min(R.stop, R.start + R.speed * (tick / hz));

// 통나무가 문을 치는 움직임: 뒤로 당겼다가 빠르게 앞으로 (s: 다음 타격까지 남은 초, a: 지난 타격 뒤 지난 초)
function logSwing(s, a) {
  if (a >= 0 && a < 0.3) return 0.7 * (1 - a / 0.3);
  if (s < 0 || s > 0.7) return 0;
  if (s > 0.25) return -0.9 * (1 - (s - 0.25) / 0.45);
  return -0.9 + 1.6 * (1 - s / 0.25);
}

const WHEELS = [
  [-0.82, -0.95],
  [0.82, -0.95],
  [-0.82, -3.7],
  [0.82, -3.7],
];
// 공성추: 바퀴 달린 틀에 매단 통나무와, 뒤에서 미는 공병 두 명 (참가자가 아니라 이름이 없다)
function Ram({ rec, decoded, playRef }) {
  const R = rec.ram;
  const groupRef = useRef();
  const logRef = useRef();
  const wheelRefs = useRef([]);
  const crewRefs = useRef([]);
  const soundRef = useRef(0);
  useFrame((state) => {
    const g = groupRef.current;
    if (!g) return;
    const tick = playRef.current.f * decoded.perFrame;
    const front = ramFront(R, tick, rec.hz);
    g.position.z = front;
    const moving = front < R.stop;
    // 다음·지난 타격
    let next = -1;
    let prev = -1;
    for (const s of R.strikes) {
      if (s > tick) {
        next = s;
        break;
      }
      prev = s;
    }
    const swing = logSwing(
      next < 0 ? -1 : (next - tick) / rec.hz,
      prev < 0 ? -1 : (tick - prev) / rec.hz
    );
    if (logRef.current) logRef.current.position.z = -2.1 + swing;
    const roll = (front - R.start) / 0.45;
    wheelRefs.current.forEach(
      (w) => w && w.parent && (w.parent.rotation.x = roll)
    );
    const t = state.clock.elapsedTime;
    crewRefs.current.forEach((c, k) => {
      if (!c) return;
      const legs = moving ? Math.sin(roll * 2.4 + k * Math.PI) * 0.6 : 0;
      c.children[3].rotation.x = legs;
      c.children[4].rotation.x = -legs;
      c.position.y = moving
        ? Math.abs(Math.sin(roll * 2.4)) * 0.04
        : Math.sin(t * 3 + k) * 0.01;
    });
    // 소리: 문을 칠 때 "쿵"
    const pl = playRef.current;
    const hitCount = R.strikes.filter((s) => s <= tick).length;
    if (pl.playing && !pl.done && hitCount > soundRef.current) {
      clack(1, 0.02);
      soundRef.current = hitCount;
    } else if (hitCount < soundRef.current) soundRef.current = hitCount;
  });
  const wood = <meshStandardMaterial color="#8a5a2b" roughness={0.85} />;
  const dark = <meshStandardMaterial color="#5a3a1c" roughness={0.85} />;
  return (
    <group ref={groupRef} position={[0, 0, R.start]}>
      {/* 바닥 틀 */}
      <mesh position={[0, 0.72, -2.4]}>
        <boxGeometry args={[1.5, 0.22, 4.2]} />
        {wood}
      </mesh>
      {WHEELS.map(([x, z], k) => (
        <group key={k} position={[x, 0.45, z]}>
          <mesh
            ref={(el) => {
              wheelRefs.current[k] = el;
            }}
            rotation-z={Math.PI / 2}
          >
            <cylinderGeometry args={[0.45, 0.45, 0.18, 14]} />
            {dark}
          </mesh>
        </group>
      ))}
      {/* 기둥과 들보 */}
      {[-1.3, -3.4].map((z) =>
        [-0.62, 0.62].map((x) => (
          <mesh key={`p${x}${z}`} position={[x, 1.75, z]}>
            <boxGeometry args={[0.14, 1.85, 0.14]} />
            {wood}
          </mesh>
        ))
      )}
      {[-0.62, 0.62].map((x) => (
        <mesh key={`b${x}`} position={[x, 2.7, -2.35]}>
          <boxGeometry args={[0.16, 0.16, 2.5]} />
          {wood}
        </mesh>
      ))}
      <mesh position={[0, 2.85, -2.35]}>
        <boxGeometry args={[1.5, 0.12, 2.7]} />
        {dark}
      </mesh>
      {/* 매달린 통나무와 쇠머리 */}
      <group ref={logRef} position={[0, 1.55, -2.1]}>
        <mesh rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.3, 0.3, 4.2, 14]} />
          <meshStandardMaterial color="#9b6b3a" roughness={0.8} />
        </mesh>
        <mesh position={[0, 0, 2.15]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.36, 0.3, 0.4, 14]} />
          <meshStandardMaterial
            color="#4b4f57"
            metalness={0.6}
            roughness={0.35}
          />
        </mesh>
      </group>
      {/* 공병 */}
      {[-0.42, 0.42].map((x, k) => (
        <group
          key={x}
          ref={(el) => {
            crewRefs.current[k] = el;
          }}
          position={[x, 0, -5.0]}
        >
          <mesh position={[0, 0.78, 0]}>
            <capsuleGeometry args={[0.24, 0.3, 4, 10]} />
            <meshStandardMaterial color="#7d6a55" />
          </mesh>
          <mesh position={[0, 1.24, 0]}>
            <sphereGeometry args={[0.22, 12, 10]} />
            <meshStandardMaterial color="#f1c8a3" />
          </mesh>
          <mesh position={[0, 1.29, 0]}>
            <sphereGeometry
              args={[0.25, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55]}
            />
            <meshStandardMaterial
              color="#8d939c"
              metalness={0.4}
              roughness={0.4}
            />
          </mesh>
          <group position={[0.12, 0.46, 0]}>
            <mesh position={[0, -0.2, 0]}>
              <capsuleGeometry args={[0.09, 0.22, 4, 8]} />
              <meshStandardMaterial color="#4a3426" />
            </mesh>
          </group>
          <group position={[-0.12, 0.46, 0]}>
            <mesh position={[0, -0.2, 0]}>
              <capsuleGeometry args={[0.09, 0.22, 4, 8]} />
              <meshStandardMaterial color="#4a3426" />
            </mesh>
          </group>
          {/* 앞으로 뻗어 미는 팔 */}
          {[-0.3, 0.3].map((ax) => (
            <mesh
              key={ax}
              position={[ax, 1.0, 0.22]}
              rotation-x={Math.PI / 2 - 0.3}
            >
              <capsuleGeometry args={[0.075, 0.32, 4, 8]} />
              <meshStandardMaterial color="#d6dae2" />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

// 성문: 공성추가 칠 때마다 흔들리다가, 기록된 순간에 안쪽으로 부서지며 열린다
const DEBRIS = 7;
function GateDoors({ rec, decoded, playRef, stone }) {
  const L = rec.layout;
  const R = rec.ram;
  const gH = L.gate.half;
  const gateH = 4.2;
  const leftRef = useRef();
  const rightRef = useRef();
  const debrisRef = useRef([]);
  const crashRef = useRef(false);
  const debris = useMemo(
    () =>
      Array.from({ length: DEBRIS }, (_, k) => ({
        x: (k / (DEBRIS - 1) - 0.5) * gH * 1.6,
        vx: ((k % 3) - 1) * 0.9,
        vy: 3 + (k % 4) * 0.8,
        vz: 2.5 + (k % 3) * 0.9,
        spin: 4 + k,
      })),
    [gH]
  );
  useFrame(() => {
    const tick = playRef.current.f * decoded.perFrame;
    const broke = R.breakTick >= 0 && tick >= R.breakTick;
    let angle = 0;
    if (broke) {
      const t = (tick - R.breakTick) / rec.hz;
      angle = 1.6 * Math.min(1, t / 0.35);
    } else {
      // 타격 직후 살짝 안쪽으로 밀렸다가 돌아온다
      for (const s of R.strikes) {
        if (s > tick) break;
        const a = (tick - s) / rec.hz;
        if (a < 0.4) angle = 0.08 * (1 - a / 0.4);
      }
    }
    if (leftRef.current) leftRef.current.rotation.y = -angle;
    if (rightRef.current) rightRef.current.rotation.y = angle;
    // 부서지는 나뭇조각
    const t = broke ? (tick - R.breakTick) / rec.hz : -1;
    debrisRef.current.forEach((m, k) => {
      if (!m) return;
      const d = debris[k];
      if (t < 0 || t > 2.6) {
        m.visible = false;
        return;
      }
      m.visible = true;
      const tt = Math.min(t, 0.9);
      m.position.set(
        d.x + d.vx * tt,
        Math.max(0.1, 2.2 + d.vy * tt - 4.9 * tt * tt),
        L.WZ + 0.3 + d.vz * tt
      );
      m.rotation.set(d.spin * tt, d.spin * 0.6 * tt, 0);
      const fade = t > 2 ? 1 - (t - 2) / 0.6 : 1;
      m.scale.setScalar(Math.max(0.01, fade));
    });
    const pl = playRef.current;
    if (broke && !crashRef.current && pl.playing) {
      crashRef.current = true;
      clack(1, 0.03);
      setTimeout(() => clack(1, 0.08), 60);
      setTimeout(() => clack(0.9, 0.2), 140);
      pop();
    }
  });
  const door = <meshStandardMaterial color="#7b4a22" roughness={0.85} />;
  return (
    <group>
      {[
        [leftRef, -gH, 1],
        [rightRef, gH, -1],
      ].map(([ref, x, dir]) => (
        <group key={x} ref={ref} position={[x, 0, L.WZ + 0.25]}>
          <mesh position={[(dir * gH) / 2, gateH / 2, 0]}>
            <boxGeometry args={[gH - 0.04, gateH - 0.05, 0.22]} />
            {door}
          </mesh>
          {/* 쇠띠 */}
          {[0.9, 2.2, 3.5].map((y) => (
            <mesh key={y} position={[(dir * gH) / 2, y, -0.13]}>
              <boxGeometry args={[gH - 0.1, 0.12, 0.04]} />
              <meshStandardMaterial
                color="#3d3f45"
                metalness={0.6}
                roughness={0.4}
              />
            </mesh>
          ))}
        </group>
      ))}
      {debris.map((d, k) => (
        <mesh
          key={k}
          ref={(el) => {
            debrisRef.current[k] = el;
          }}
          visible={false}
        >
          <boxGeometry args={[0.6, 0.12, 0.22]} />
          {door}
        </mesh>
      ))}
      {/* 성문 위 석조 틀 */}
      <mesh position={[0, gateH + 0.25, L.WZ - 0.12]}>
        <boxGeometry args={[gH * 2 + 1.2, 0.5, 0.3]} />
        <meshStandardMaterial map={stone} color="#d9c3a0" roughness={0.9} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (gH + 0.3), gateH / 2, L.WZ - 0.12]}>
          <boxGeometry args={[0.6, gateH, 0.3]} />
          <meshStandardMaterial map={stone} color="#d9c3a0" roughness={0.9} />
        </mesh>
      ))}
      {/* 성문 도착선 (문 안쪽) */}
      <mesh position={[0, 0.03, L.gate.arriveZ]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[gH * 2, 0.3]} />
        <meshBasicMaterial color="#ffd34d" toneMapped={false} />
      </mesh>
    </group>
  );
}

/* ---------------- 기마병 ---------------- */

// 기록에 남은 자리·방향 그대로 달린다. 말발굽 소리는 달리는 말 수만큼 커진다.
function Horse({ track, playRef, k }) {
  const ref = useRef();
  const legRefs = useRef([]);
  const strideRef = useRef(0);
  const lastRef = useRef(null);
  const len = track.x.length;
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const f = playRef.current.f;
    const kf = f - track.from;
    if (kf < 0 || kf > len - 1) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const k0 = Math.floor(kf);
    const k1 = Math.min(len - 1, k0 + 1);
    const t = kf - k0;
    const px = (track.x[k0] + (track.x[k1] - track.x[k0]) * t) / 100;
    const pz = (track.z[k0] + (track.z[k1] - track.z[k0]) * t) / 100;
    g.position.set(px, 0, pz);
    const hx = track.h[k0 * 2] + (track.h[k1 * 2] - track.h[k0 * 2]) * t;
    const hz =
      track.h[k0 * 2 + 1] + (track.h[k1 * 2 + 1] - track.h[k0 * 2 + 1]) * t;
    g.rotation.y = Math.atan2(hx, hz);
    // 달린 거리만큼 다리를 굴린다
    const last = lastRef.current;
    if (last) strideRef.current += Math.hypot(px - last[0], pz - last[1]);
    lastRef.current = [px, pz];
    const ph = strideRef.current * 3.2 + k;
    legRefs.current.forEach((leg, j) => {
      if (leg)
        leg.rotation.x =
          Math.sin(ph + (j % 2 ? Math.PI : 0) + (j > 1 ? 0.6 : 0)) * 0.7;
    });
    g.position.y = Math.abs(Math.sin(ph)) * 0.12;
    // 사라질 때 작아진다
    const fade = Math.min(1, (len - 1 - kf) / 4);
    g.scale.setScalar(Math.max(0.01, fade));
  });
  const coat = k % 3 === 0 ? '#f2efe8' : k % 3 === 1 ? '#7a4b2a' : '#3b2a20';
  return (
    <group ref={ref} visible={false}>
      {/* 말 몸통·목·머리 */}
      <mesh position={[0, 1.15, 0]} rotation-x={Math.PI / 2}>
        <capsuleGeometry args={[0.42, 1.2, 6, 12]} />
        <meshStandardMaterial color={coat} roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.65, 0.85]} rotation-x={-0.6}>
        <capsuleGeometry args={[0.2, 0.55, 4, 10]} />
        <meshStandardMaterial color={coat} roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.95, 1.18]} rotation-x={0.5}>
        <boxGeometry args={[0.28, 0.32, 0.6]} />
        <meshStandardMaterial color={coat} roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.95, 0.75]}>
        <boxGeometry args={[0.08, 0.5, 0.5]} />
        <meshStandardMaterial color="#2a1d14" />
      </mesh>
      {/* 다리 넷 */}
      {[
        [0.22, 0.6],
        [-0.22, 0.6],
        [0.22, -0.6],
        [-0.22, -0.6],
      ].map(([lx, lz], j) => (
        <group
          key={j}
          ref={(el) => {
            legRefs.current[j] = el;
          }}
          position={[lx, 0.95, lz]}
        >
          <mesh position={[0, -0.45, 0]}>
            <cylinderGeometry args={[0.09, 0.07, 0.9, 8]} />
            <meshStandardMaterial color={coat} roughness={0.7} />
          </mesh>
        </group>
      ))}
      {/* 마구 */}
      <mesh position={[0, 1.58, -0.05]}>
        <boxGeometry args={[0.9, 0.12, 0.8]} />
        <meshStandardMaterial color="#c0392b" />
      </mesh>
      {/* 기수: 주황 갑옷, 깃발 달린 긴 막대 */}
      <group position={[0, 1.55, -0.05]}>
        <mesh position={[0, 0.45, 0]}>
          <capsuleGeometry args={[0.24, 0.3, 4, 10]} />
          <meshStandardMaterial color="#f08a2c" />
        </mesh>
        <mesh position={[0, 0.92, 0]}>
          <sphereGeometry args={[0.21, 12, 10]} />
          <meshStandardMaterial color="#f1c8a3" />
        </mesh>
        <mesh position={[0, 0.98, 0]}>
          <sphereGeometry
            args={[0.25, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55]}
          />
          <meshStandardMaterial
            color="#e85d1a"
            metalness={0.4}
            roughness={0.35}
          />
        </mesh>
        <group position={[0.3, 0.55, 0.2]} rotation-x={Math.PI / 2 - 0.35}>
          <mesh>
            <cylinderGeometry args={[0.04, 0.04, 2.6, 6]} />
            <meshStandardMaterial color="#6b4423" />
          </mesh>
          <mesh position={[0.22, 1.05, 0]}>
            <boxGeometry args={[0.42, 0.3, 0.02]} />
            <meshStandardMaterial color="#2446a6" side={THREE.DoubleSide} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

function Cavalry({ rec, playRef }) {
  const riders = useMemo(() => rec.cavalry || [], [rec]);
  const soundRef = useRef(null);
  const hornRef = useRef(false);
  useEffect(() => {
    soundRef.current = loop('roll');
    return () => soundRef.current.stop();
  }, []);
  useFrame(() => {
    const pl = playRef.current;
    const snd = soundRef.current;
    if (!snd) return;
    let on = 0;
    for (const r of riders)
      if (pl.f >= r.from && pl.f <= r.from + r.x.length - 1) on++;
    if (on && !hornRef.current && pl.playing) {
      hornRef.current = true;
      horn();
    }
    // 말발굽: 낮고 빠르게 덜컹거리는 소리
    snd.set(pl.playing && !pl.done ? Math.min(1, on * 0.25) : 0, 0.55);
  });
  return riders.map((track, k) => (
    <Horse key={k} k={k} track={track} playRef={playRef} />
  ));
}

/* ---------------- 거마책 (출발선 앞 나무 말뚝 장애물) ---------------- */

// 긴 가로 들보에 X 자로 엇갈린 말뚝 세 쌍을 밧줄로 묶었다. 끝은 꿀색으로 깎은 뾰족한 머리.
const LOG_LEN = 2.2;
const LOG_TILT = 0.72; // 말뚝이 세로에서 기울어진 각도
function StakePair({ x }) {
  const wood = <meshStandardMaterial color="#b5682f" roughness={0.75} />;
  const tip = <meshStandardMaterial color="#f0c46a" roughness={0.6} />;
  const rope = <meshStandardMaterial color="#d8b878" roughness={0.9} />;
  return (
    <group position={[x, 0.75, 0]}>
      {[LOG_TILT, -LOG_TILT].map((a) => (
        <group key={a} rotation-x={a}>
          <mesh>
            <cylinderGeometry args={[0.13, 0.14, LOG_LEN, 10]} />
            {wood}
          </mesh>
          <mesh position={[0, LOG_LEN / 2 + 0.13, 0]}>
            <coneGeometry args={[0.13, 0.28, 8]} />
            {tip}
          </mesh>
          {/* 땅에 박는 나무 못 */}
          <mesh position={[0.2, -LOG_LEN / 2 + 0.12, 0]}>
            <cylinderGeometry args={[0.05, 0.05, 0.36, 6]} />
            <meshStandardMaterial color="#8a5a2b" roughness={0.8} />
          </mesh>
        </group>
      ))}
      {/* 교차점을 감은 밧줄 */}
      <mesh rotation-y={Math.PI / 2}>
        <torusGeometry args={[0.2, 0.05, 8, 16]} />
        {rope}
      </mesh>
      <mesh rotation-z={Math.PI / 2} rotation-y={0.5}>
        <torusGeometry args={[0.19, 0.045, 8, 16]} />
        {rope}
      </mesh>
    </group>
  );
}

function Barricades({ rec }) {
  const list = rec.layout.barricades || [];
  return list.map(([bx, bz, half], k) => (
    <group key={k} position={[bx, 0, bz]}>
      {/* 가로 들보 */}
      <mesh position={[0, 0.75, 0]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.13, 0.13, half * 2 + 0.3, 10]} />
        <meshStandardMaterial color="#c98a45" roughness={0.75} />
      </mesh>
      {/* 들보 끝 나뭇결 면 */}
      {[-1, 1].map((sd) => (
        <mesh
          key={sd}
          position={[sd * (half + 0.16), 0.75, 0]}
          rotation-z={Math.PI / 2}
        >
          <cylinderGeometry args={[0.11, 0.11, 0.02, 10]} />
          <meshStandardMaterial color="#e2b06a" roughness={0.8} />
        </mesh>
      ))}
      {[-half + 0.6, 0, half - 0.6].map((x) => (
        <StakePair key={x} x={x} />
      ))}
      {/* 들보를 감은 밧줄 */}
      {[-half / 2, half / 2].map((x) => (
        <mesh key={x} position={[x, 0.75, 0]} rotation-y={Math.PI / 2}>
          <torusGeometry args={[0.16, 0.04, 8, 14]} />
          <meshStandardMaterial color="#d8b878" roughness={0.9} />
        </mesh>
      ))}
    </group>
  ));
}

/* ---------------- 성과 들판 ---------------- */

function stoneTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#b9a47f';
  g.fillRect(0, 0, 512, 256);
  const rows = 6;
  const bh = 256 / rows;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? 0 : 42;
    for (let x = -off; x < 512; x += 84) {
      const v = 200 + Math.floor(Math.random() * 30);
      g.fillStyle = `rgb(${v + 22}, ${v + 6}, ${v - 28})`;
      g.fillRect(x + 3, r * bh + 3, 78, bh - 6);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function bannerTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#2446a6';
  g.fillRect(0, 0, 128, 256);
  g.strokeStyle = '#f2c14e';
  g.lineWidth = 8;
  g.strokeRect(8, 8, 112, 210);
  // 끝이 뾰족한 깃발
  g.fillStyle = '#2446a6';
  g.beginPath();
  g.moveTo(0, 224);
  g.lineTo(64, 256);
  g.lineTo(128, 224);
  g.fill();
  // 방패 문장
  g.fillStyle = '#f2c14e';
  g.beginPath();
  g.moveTo(34, 70);
  g.lineTo(94, 70);
  g.lineTo(94, 120);
  g.quadraticCurveTo(94, 160, 64, 176);
  g.quadraticCurveTo(34, 160, 34, 120);
  g.closePath();
  g.fill();
  g.fillStyle = '#2446a6';
  g.beginPath();
  g.arc(64, 112, 16, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function Instances({ matrices, children, geometry }) {
  const ref = useRef();
  useLayoutEffect(() => {
    matrices.forEach((m, k) => ref.current.setMatrixAt(k, m));
    ref.current.instanceMatrix.needsUpdate = true;
  }, [matrices]);
  return (
    <instancedMesh ref={ref} args={[geometry, null, matrices.length]}>
      {children}
    </instancedMesh>
  );
}

const box = (x, y, z, sx, sy, sz, ry = 0) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(UP, ry),
    new THREE.Vector3(sx, sy, sz)
  );

const GATE_H = 4.2; // 성문 높이

function Castle({ rec, decoded, playRef }) {
  const L = rec.layout;
  const { H, WZ, walk, FW } = L;
  const half = FW / 2 + 2.2;
  const gH = L.gate.half;
  const towerHalf = gH + 1.3; // 성문 위 망루 너비의 절반
  const stone = useMemo(() => {
    const t = stoneTexture();
    t.repeat.set((half * 2) / 6, H / 3);
    return t;
  }, [half, H]);
  const banner = useMemo(() => bannerTexture(), []);
  useEffect(
    () => () => {
      stone.dispose();
      banner.dispose();
    },
    [stone, banner]
  );
  const unit = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);

  // 흉벽(톱니): 사다리가 걸린 자리와 성문 위 망루 자리는 비워 둔다. 망루 위에도 톱니를 얹는다.
  const merlons = useMemo(() => {
    const list = [];
    for (let x = -half + 0.5; x <= half - 0.5; x += 1.6) {
      if (L.ladders.some((lx) => Math.abs(lx - x) < 1.4)) continue;
      if (Math.abs(x) < towerHalf + 0.5) continue;
      list.push(box(x, H + 0.45, WZ + 0.25, 0.95, 0.9, 0.5));
      list.push(box(x, H + 0.3, WZ + walk - 0.2, 0.95, 0.6, 0.4));
    }
    for (let x = -towerHalf + 0.4; x <= towerHalf - 0.4; x += 1.2)
      list.push(box(x, H + 2.75, WZ + 0.05, 0.7, 0.7, 0.5));
    return list;
  }, [L.ladders, half, H, WZ, walk, towerHalf]);
  const side = half - gH; // 성문 양옆 성벽 한 덩어리의 폭

  // 사다리: 기둥 두 개와 가로대
  const lean = L.lean;
  const len = Math.hypot(H + 0.3, lean);
  const ang = Math.atan2(lean, H + 0.3);
  const ladder = useMemo(() => {
    const rails = [];
    const rungs = [];
    const q = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      ang
    );
    L.ladders.forEach((lx) => {
      const at = (along, side) => {
        const v = new THREE.Vector3(side, along, 0).applyQuaternion(q);
        return v.add(new THREE.Vector3(lx, 0, WZ - lean));
      };
      [-0.9, 0, 0.9].forEach((side) =>
        rails.push(
          new THREE.Matrix4().compose(
            at(len / 2, side),
            q,
            new THREE.Vector3(0.09, len, 0.09)
          )
        )
      );
      for (let a = 0.3; a < len - 0.1; a += 0.38) {
        rungs.push(
          new THREE.Matrix4().compose(
            at(a, 0),
            q,
            new THREE.Vector3(1.8, 0.05, 0.06)
          )
        );
      }
    });
    return { rails, rungs };
  }, [L.ladders, WZ, lean, len, ang]);

  // 사다리 사이 성벽에 거는 깃발 (성문 자리는 성문 양옆으로)
  const banners = useMemo(() => {
    const xs = [];
    for (let k = 0; k + 1 < L.ladders.length; k++) {
      const mid = (L.ladders[k] + L.ladders[k + 1]) / 2;
      if (Math.abs(mid) < gH + 1) {
        const inner = Math.abs(L.ladders[k + 1]);
        xs.push(-(gH + inner) / 2, (gH + inner) / 2);
      } else xs.push(mid);
    }
    xs.push(L.ladders[0] - 1.7, L.ladders[L.ladders.length - 1] + 1.7);
    return xs;
  }, [L.ladders, gH]);

  const towers = L.towers;
  return (
    <group>
      {/* 성벽: 가운데 성문 자리를 비우고 양쪽 덩어리 + 성문 위 들보, 그 위 망루 */}
      {[-1, 1].map((sg) => (
        <mesh key={sg} position={[sg * (gH + side / 2), H / 2, WZ + walk / 2]}>
          <boxGeometry args={[side, H, walk]} />
          <meshStandardMaterial map={stone} roughness={0.9} />
        </mesh>
      ))}
      <mesh position={[0, (GATE_H + H) / 2, WZ + walk / 2]}>
        <boxGeometry args={[gH * 2, H - GATE_H, walk]} />
        <meshStandardMaterial map={stone} roughness={0.9} />
      </mesh>
      <mesh position={[0, H + 1.2, WZ + walk / 2 - 0.15]}>
        <boxGeometry args={[towerHalf * 2, 2.4, walk - 0.3]} />
        <meshStandardMaterial map={stone} roughness={0.9} />
      </mesh>
      <mesh position={[0, H + 1.3, WZ - 0.33]}>
        <boxGeometry args={[1.4, 1.6, 0.1]} />
        <meshStandardMaterial map={banner} />
      </mesh>
      <GateDoors rec={rec} decoded={decoded} playRef={playRef} stone={stone} />
      <Instances matrices={merlons} geometry={unit}>
        <meshStandardMaterial color="#cdb68d" roughness={0.9} />
      </Instances>
      {/* 도착 구역: 성벽 위 통로 */}
      <mesh
        position={[0, H + 0.015, WZ + L.arriveZ + (walk - L.arriveZ) / 2]}
        rotation-x={-Math.PI / 2}
      >
        <planeGeometry args={[half * 2, walk - L.arriveZ]} />
        <meshBasicMaterial
          color="#ffd34d"
          transparent
          opacity={0.28}
          depthWrite={false}
        />
      </mesh>
      {banners.map((x) => (
        <mesh key={x} position={[x, H - 1.6, WZ - 0.03]} rotation-y={Math.PI}>
          <planeGeometry args={[1.1, 2.2]} />
          <meshStandardMaterial
            map={banner}
            transparent
            alphaTest={0.5}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
      {/* 사다리 */}
      <Instances matrices={ladder.rails} geometry={unit}>
        <meshStandardMaterial color="#8a5a2b" roughness={0.8} />
      </Instances>
      <Instances matrices={ladder.rungs} geometry={unit}>
        <meshStandardMaterial color="#9c6a35" roughness={0.8} />
      </Instances>
      {/* 양쪽 탑 (물대포가 있는 곳) */}
      {towers.map(([x, z]) => (
        <group key={x} position={[x, 0, z]}>
          <mesh position={[0, 5, 0]}>
            <cylinderGeometry args={[2.6, 2.9, 10, 20]} />
            <meshStandardMaterial map={stone} roughness={0.9} />
          </mesh>
          {Array.from({ length: 10 }, (_, k) => {
            const a = (k / 10) * Math.PI * 2;
            return (
              <mesh
                key={k}
                position={[Math.cos(a) * 2.45, 10.4, Math.sin(a) * 2.45]}
                rotation-y={-a}
              >
                <boxGeometry args={[0.5, 0.8, 0.9]} />
                <meshStandardMaterial color="#cdb68d" roughness={0.9} />
              </mesh>
            );
          })}
          <mesh position={[0, 12.5, 0]}>
            <cylinderGeometry args={[0.05, 0.05, 4, 6]} />
            <meshStandardMaterial color="#5b4630" />
          </mesh>
          <mesh position={[x < 0 ? 0.55 : -0.55, 13.9, 0]}>
            <planeGeometry args={[1.1, 0.7]} />
            <meshStandardMaterial color="#e2602d" side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
      {/* 성 안쪽 본성 */}
      <mesh position={[0, 5.5, WZ + walk + 13]}>
        <boxGeometry args={[Math.max(14, FW * 0.4), 11, 8]} />
        <meshStandardMaterial map={stone} roughness={0.9} />
      </mesh>
      {[-1, 1].map((s) => (
        <group
          key={s}
          position={[s * Math.max(8, FW * 0.22), 0, WZ + walk + 13]}
        >
          <mesh position={[0, 7, 0]}>
            <cylinderGeometry args={[2.2, 2.4, 14, 18]} />
            <meshStandardMaterial map={stone} roughness={0.9} />
          </mesh>
          <mesh position={[0, 16.2, 0]}>
            <coneGeometry args={[2.8, 4.5, 18]} />
            <meshStandardMaterial color="#2c4fb3" roughness={0.5} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Field({ rec, decoded }) {
  const L = rec.layout;
  const back = decoded.zBack - 12;
  const trees = useMemo(() => {
    const list = [];
    const span = L.FW / 2 + 16;
    for (let k = 0; k < 26; k++) {
      const side = k % 2 ? 1 : -1;
      const x = side * (span + (k % 5) * 3.1);
      const z = L.WZ + 12 - (k >> 1) * 4.3;
      list.push(box(x, 2.2, z, 2.4, 4.4, 2.4));
    }
    return list;
  }, [L.FW, L.WZ]);
  const stakes = useMemo(() => {
    const list = [];
    const span = L.FW / 2 + 7;
    for (let z = back + 6; z < L.WZ - 2; z += 0.7) {
      list.push(box(-span, 0.6, z, 0.18, 1.2, 0.18));
      list.push(box(span, 0.6, z, 0.18, 1.2, 0.18));
    }
    return list;
  }, [L.FW, L.WZ, back]);
  const cone = useMemo(() => new THREE.ConeGeometry(0.5, 1, 8), []);
  const unit = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, L.WZ / 2]}>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color="#7fa653" roughness={1} />
      </mesh>
      {/* 흙길: 병사들이 달리는 들판 */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, (back + L.WZ) / 2]}>
        <planeGeometry args={[L.FW + 12, L.WZ - back + 4]} />
        <meshStandardMaterial color="#c9a66b" roughness={1} />
      </mesh>
      <Instances matrices={trees} geometry={cone}>
        <meshStandardMaterial color="#3f7a3a" roughness={0.9} />
      </Instances>
      <Instances matrices={stakes} geometry={unit}>
        <meshStandardMaterial color="#7a5430" roughness={0.9} />
      </Instances>
      {[-1, 0, 1].map((k) => (
        <mesh key={k} position={[k * 60, -8, L.WZ + 70]}>
          <sphereGeometry args={[40, 24, 16]} />
          <meshStandardMaterial color="#6f9a5a" roughness={1} />
        </mesh>
      ))}
    </group>
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

// 자동 카메라: 처음에는 들판 전체를 보여주고, 줄이 생길 즈음 성벽 쪽으로 다가간다.
// 화면을 직접 돌리거나 옮기면 자동 이동을 멈춘다. "내 병사 찾기"를 누르면 내 병사를 따라간다.
function CameraRig({ rec, decoded, playRef, followRef, meRef, onUserMove }) {
  const { camera, size, controls } = useThree();
  const L = rec.layout;
  const viewsRef = useRef(null);
  const autoRef = useRef(true);
  useEffect(() => {
    const half = L.FW / 2 + 5;
    const baseZ = L.WZ - L.lean;
    const wideTarget = new THREE.Vector3(
      0,
      2.5,
      (decoded.zBack + L.WZ) / 2 + 3
    );
    const wide = fitView(
      camera,
      wideTarget,
      new THREE.Vector3(0, 0.6, -0.8).normalize(),
      box8(-half, half, 0, 0, decoded.zBack - 1, L.WZ).concat(
        box8(-half, half, 0, L.H + 3, L.WZ, L.WZ + L.walk)
      )
    );
    // 성벽 쪽 장면: 가운데 성문과 양옆 사다리 몇 개가 크게 보이게 (나머지는 돌려서 본다)
    const wallTarget = new THREE.Vector3(0, L.H * 0.45, baseZ - 2);
    const span = Math.min(L.FW / 2 + 1.5, 19);
    const wall = fitView(
      camera,
      wallTarget,
      new THREE.Vector3(0, 0.36, -0.93).normalize(),
      box8(-span, span, 0, L.H + 2.5, baseZ - 9, L.WZ + L.walk)
    );
    viewsRef.current = { wideTarget, wide, wallTarget, wall };
    camera.position.copy(wide);
    camera.lookAt(wideTarget);
    if (controls) {
      controls.target.copy(wideTarget);
      controls.update();
    }
  }, [camera, size.width, size.height, controls, L, decoded.zBack]);

  const userMoved = useCallback(() => {
    autoRef.current = false;
    onUserMove();
  }, [onUserMove]);

  useFrame(() => {
    const views = viewsRef.current;
    if (!controls || !views) return;
    if (followRef.current && meRef.current) {
      autoRef.current = false;
      S.at.copy(meRef.current.position).setY(meRef.current.position.y + 1);
      const delta = S.at.sub(controls.target).multiplyScalar(0.12);
      controls.target.add(delta);
      camera.position.add(delta);
      // 멀리 있으면 조금씩 다가간다
      if (camera.position.distanceTo(controls.target) > 16)
        camera.position.lerp(controls.target, 0.04);
      controls.update();
      return;
    }
    if (!autoRef.current) return;
    const t = (playRef.current.f * decoded.perFrame) / rec.hz;
    const k = smooth(2.5, 7.5, t);
    controls.target.lerpVectors(views.wideTarget, views.wallTarget, k);
    camera.position.lerpVectors(views.wide, views.wall, k);
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
          [-L.FW / 2 - 12, 0, decoded.zBack - 8],
          [L.FW / 2 + 12, 14, L.WZ + 10]
        )
      }
      minDistance={4}
      maxDistance={180}
      maxPolarAngle={Math.PI / 2 - 0.08}
      enableDamping
    />
  );
}

/* ---------------- 소리 ---------------- */

// 달리는 병사가 많을수록 발소리(낮은 웅성거림)가 커지고, 성벽에 오르면 짧게 "띵"
function Sounds({ decoded, playRef }) {
  const march = useRef(null);
  const wind = useRef(null);
  const arrivedRef = useRef({ count: 0, at: 0 });
  useEffect(() => {
    march.current = loop('roll');
    wind.current = loop('wind');
    return () => {
      march.current.stop();
      wind.current.stop();
    };
  }, []);
  const stateRef = useRef(null);
  useFrame((state) => {
    const p = playRef.current;
    if (!march.current) return;
    if (!p.playing || p.done) {
      march.current.set(0);
      wind.current.set(p.done ? 0 : 0.35, 0.3);
      return;
    }
    const tick = p.f * decoded.perFrame;
    if (!stateRef.current || stateRef.current.ptr.length !== decoded.n)
      stateRef.current = {
        ptr: new Int32Array(decoded.n),
        st: new Int8Array(decoded.n),
      };
    const { ptr, st } = stateRef.current;
    let running = 0;
    let arrived = 0;
    for (let i = 0; i < decoded.n; i++) {
      const list = decoded.events[i];
      while (ptr[i] < list.length && list[ptr[i]] <= tick) {
        st[i] = list[ptr[i] + 1];
        ptr[i] += 2;
      }
      if (st[i] === ST.RUN) running++;
      if (st[i] === ST.ARRIVED || st[i] === ST.GONE) arrived++;
    }
    march.current.set(Math.min(1, (running / decoded.n) * 1.6) * 0.8, 0.15);
    wind.current.set(0.35, 0.3);
    const a = arrivedRef.current;
    const now = state.clock.elapsedTime;
    if (arrived > a.count && now - a.at > 0.12) {
      pop();
      a.at = now;
      a.count = arrived;
    }
  });
  return null;
}

/* ---------------- 화면 위 안내 (도착 인원, 실시간 순위) ---------------- */

function Hud({ rec, names, me, busRef, tagRef, follow, onFollow }) {
  const [list, setList] = useState([]); // 들어온 순서대로 [참가자 번호, 길]
  const [gate, setGate] = useState(false);
  useEffect(() => {
    busRef.current = {
      arrive: (who, route) => setList((l) => [...l, [who, route]]),
      gate: () => setGate(true),
    };
    return () => {
      busRef.current = null;
    };
  }, [busRef]);
  const W = rec.winnerCount;
  const latest = list[list.length - 1];
  const viaGate = list.filter(([, r]) => r === ROUTE.GATE).length;
  const recent = list
    .map((x, k) => [k, ...x])
    .slice(-5)
    .reverse();
  const myRank = me >= 0 ? list.findIndex(([who]) => who === me) : -1;
  const routeName = (r) => (r === ROUTE.GATE ? '성문' : '성벽');
  return (
    <div className="siege-hud">
      {me >= 0 && (
        <div ref={tagRef} className="siege-me-tag">
          내 병사 · {names[me]}
        </div>
      )}
      <div className="siege-goal">먼저 성에 들어온 {W}명이 당첨!</div>
      <div className="siege-count">
        🚩 성 진입 <b>{list.length}</b> / {W}
        <small>
          {gate
            ? `성벽 ${list.length - viaGate}명 · 성문 ${viaGate}명`
            : '공성추가 성문을 두드리는 중'}
        </small>
      </div>
      {gate && (
        <div className="siege-gate">
          성문 돌파!
          {(rec.cavalry || []).length > 0 && <small>기마병 출격!</small>}
        </div>
      )}
      {latest !== undefined && (
        <div className="siege-bubble" key={list.length}>
          <b>{names[latest[0]]}</b> 님{' '}
          {latest[1] === ROUTE.GATE ? '성문 돌파!' : '성벽 도달!'}
        </div>
      )}
      {list.length > 0 && (
        <ol className="siege-rank" aria-label="입성 순위">
          <li className="head">입성 순위</li>
          {recent.map(([k, who, r]) => (
            <li
              key={k}
              className={
                (k === list.length - 1 ? 'new' : '') + (who === me ? ' me' : '')
              }
            >
              <span>{k + 1}</span>
              <em>{names[who]}</em>
              <i>{routeName(r)}</i>
            </li>
          ))}
          {myRank >= 0 && myRank < list.length - 5 && (
            <li className="me">
              <span>{myRank + 1}</span>
              <em>{names[me]} (나)</em>
              <i>{routeName(list[myRank][1])}</i>
            </li>
          )}
        </ol>
      )}
      {me >= 0 && (
        <button type="button" className="siege-find" onClick={onFollow}>
          {follow ? '✕ 따라가기 끄기' : '🎯 내 병사 찾기'}
        </button>
      )}
    </div>
  );
}

/* ---------------- 전체 장면 ---------------- */

// playing: 재생 중인지 (카운트다운 동안은 false), speedRef: 재생 배속, me: 내 참가자 번호 (없으면 -1)
// onArrive(k, 참가자 번호): k 번째로 성에 들어와(성벽이든 성문이든) 당첨이 확정됨
export default function SiegeStage({
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
    gate: false,
    playing: false,
    done: false,
  });
  useEffect(() => {
    playRef.current.playing = playing;
  }, [playing]);
  const busRef = useRef(null);
  const eventsRef = useRef(null);
  useEffect(() => {
    eventsRef.current = {
      arrive: (k, who, route) => {
        if (busRef.current) busRef.current.arrive(who, route);
        onArrive(k, who);
      },
      gate: () => {
        if (busRef.current) busRef.current.gate();
      },
      done: onDone,
    };
  }, [onArrive, onDone]);
  const meRef = useRef(null);
  const tagRef = useRef(null);
  const followRef = useRef(false);
  const [follow, setFollow] = useState(false);
  const toggleFollow = () => {
    followRef.current = !followRef.current;
    setFollow(followRef.current);
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
        camera={{ position: [0, 30, -30], fov: 40, near: 0.3, far: 600 }}
        gl={{ antialias: true }}
      >
        <Playhead
          rec={recording}
          decoded={decoded}
          playRef={playRef}
          speedRef={speedRef}
          eventsRef={eventsRef}
        />
        <color attach="background" args={['#9fd0f2']} />
        <fog attach="fog" args={['#bfe0f5', 90, 260]} />
        <hemisphereLight args={['#ffffff', '#8a7a55', 1.4]} />
        <directionalLight
          position={[-30, 50, -20]}
          intensity={2.2}
          color="#fff1d6"
        />
        <Field rec={recording} decoded={decoded} />
        <Castle rec={recording} decoded={decoded} playRef={playRef} />
        <Barricades rec={recording} />
        <Ram rec={recording} decoded={decoded} playRef={playRef} />
        {recording.layout.defenders.map((_, k) => (
          <GunDefender
            key={k}
            k={k}
            rec={recording}
            decoded={decoded}
            playRef={playRef}
          />
        ))}
        {recording.layout.cannons.map((_, k) => (
          <Cannon
            key={k}
            k={k}
            rec={recording}
            decoded={decoded}
            playRef={playRef}
          />
        ))}
        {(recording.layout.gateCannons || []).map((_, k) => (
          <Cannon
            key={`g${k}`}
            k={k}
            gate
            rec={recording}
            decoded={decoded}
            playRef={playRef}
          />
        ))}
        {(recording.layout.guards || []).map((_, k) => (
          <BucketGuard
            key={`b${k}`}
            k={k}
            rec={recording}
            decoded={decoded}
            playRef={playRef}
          />
        ))}
        <Army
          rec={recording}
          decoded={decoded}
          names={names}
          playRef={playRef}
          me={me}
          meRef={meRef}
          tagRef={tagRef}
        />
        <Water rec={recording} decoded={decoded} playRef={playRef} />
        <Cavalry rec={recording} playRef={playRef} />
        <Sounds decoded={decoded} playRef={playRef} />
        <CameraRig
          rec={recording}
          decoded={decoded}
          playRef={playRef}
          followRef={followRef}
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
      />
    </>
  );
}
