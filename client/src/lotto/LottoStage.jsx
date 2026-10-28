import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  Environment,
  Lightformer,
  OrbitControls,
  RoundedBox,
} from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { BALL_COLORS, makeBallTexture } from './ballTexture.js';
import { gateOpenAt } from './decode.js';
import { clampPan } from '../three/clampPan.js';
import { clack, loop } from '../sfx.js';

// 서버의 물리 엔진이 이미 끝까지 돌려 저장한 녹화를 3D 로 재생한다.
// 화면은 당첨자를 정하지 않고, 녹화에 담긴 공의 움직임을 그대로 보여줄 뿐이다.
// 공의 회전은 녹화에 없어서 움직인 거리만큼 굴러가는 것처럼 계산한다 (겉모습만, 결과와 무관).

const NOZZLES = [
  [1.25, 0],
  [0.386271, 1.188821],
  [-1.011271, 0.734732],
  [-1.011271, -0.734732],
  [0.386271, -1.188821],
];
const UP = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const ID_Q = new THREE.Quaternion();
const TMP_V = new THREE.Vector3();
const TMP_AXIS = new THREE.Vector3();
const TMP_Q = new THREE.Quaternion();

const glass = {
  color: '#eaf4ff',
  transparent: true,
  opacity: 0.16,
  roughness: 0.04,
  metalness: 0,
  clearcoat: 1,
  clearcoatRoughness: 0.05,
  envMapIntensity: 2.2,
  side: THREE.DoubleSide,
  depthWrite: false,
};
const metal = { color: '#d9dde4', metalness: 0.85, roughness: 0.25 };
const shell = { color: '#e8e2d9', roughness: 0.5, metalness: 0.05 };
const accent = {
  color: '#ff8a3d',
  emissive: '#ff6a10',
  emissiveIntensity: 1.3,
  toneMapped: false,
};

const airOn = (rec, playRef) =>
  playRef.current.playing && playRef.current.f < rec.airOff;

// 꼭대기에 구멍이 뚫린 유리 구 (서버의 충돌 모양과 같은 정점 배치)
function drumGeometry(R, holeY) {
  const g = new THREE.SphereGeometry(R, 64, 48);
  const pos = g.attributes.position;
  const src = g.index.array;
  const keep = [];
  const top = holeY - 1e-4;
  for (let k = 0; k < src.length; k += 3) {
    const [a, b, c] = [src[k], src[k + 1], src[k + 2]];
    if (pos.getY(a) > top || pos.getY(b) > top || pos.getY(c) > top) continue;
    keep.push(a, b, c);
  }
  g.setIndex(keep);
  g.computeVertexNormals();
  return g;
}

/* ---------------- 재생 ---------------- */

// 재생 위치(프레임)를 앞으로 보내고, 뽑힘/도착/끝 이벤트를 알린다. 다른 컴포넌트보다 먼저 실행된다.
function Playhead({ rec, playRef, speedRef, eventsRef }) {
  useFrame((_, dt) => {
    const p = playRef.current;
    if (!p.playing || p.done) return;
    // 당첨 인원이 적으면 매번, 많으면 마지막 공만 구멍에 들어가기 직전 슬로모션
    const next = rec.captures[p.cap];
    const slowAll = rec.winnerCount <= 6;
    const slow =
      next &&
      (slowAll || p.cap === rec.captures.length - 1) &&
      next[1] - p.f < rec.fps * 1.2;
    const sp = speedRef.current * (slow ? 0.45 : 1);
    p.f = Math.min(rec.frames - 1, p.f + Math.min(dt, 0.1) * rec.fps * sp);
    while (p.cap < rec.captures.length && rec.captures[p.cap][1] <= p.f) {
      eventsRef.current.onCapture(p.cap, rec.captures[p.cap][0]);
      p.cap++;
    }
    while (p.arr < rec.arrivals.length && rec.arrivals[p.arr][1] <= p.f) {
      eventsRef.current.onArrive(p.arr, rec.arrivals[p.arr][0]);
      p.arr++;
    }
    if (p.f >= rec.frames - 1) {
      p.done = true;
      eventsRef.current.onDone();
    }
  });
  return null;
}

function Ball({ name, index, geometry, register, texScale }) {
  const texture = useMemo(
    () =>
      makeBallTexture(name, BALL_COLORS[index % BALL_COLORS.length], texScale),
    [name, index, texScale]
  );
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh ref={(m) => register(index, m)} geometry={geometry} castShadow>
      <meshPhysicalMaterial
        map={texture}
        roughness={0.28}
        clearcoat={1}
        clearcoatRoughness={0.12}
      />
    </mesh>
  );
}

function Balls({ rec, decoded, names, playRef }) {
  const { ballR } = rec.layout;
  const { n, F, pos, captureAt, arriveAt } = decoded;
  const meshes = useRef([]);
  const last = useRef(null);
  const seg = n > 60 ? 20 : 32;
  const geometry = useMemo(
    () => new THREE.SphereGeometry(ballR, seg, Math.round(seg * 0.7)),
    [ballR, seg]
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  const register = (i, m) => {
    meshes.current[i] = m;
  };

  useFrame((_, dt) => {
    const f = playRef.current.f;
    const f0 = Math.floor(f);
    const f1 = Math.min(F - 1, f0 + 1);
    const t = f - f0;
    if (!last.current) last.current = new Float32Array(n * 3).fill(NaN);
    const prev = last.current;
    for (let i = 0; i < n; i++) {
      const m = meshes.current[i];
      if (!m) continue;
      const a = (f0 * n + i) * 3;
      const b = (f1 * n + i) * 3;
      const x = pos[a] + (pos[b] - pos[a]) * t;
      const y = pos[a + 1] + (pos[b + 1] - pos[a + 1]) * t;
      const z = pos[a + 2] + (pos[b + 2] - pos[a + 2]) * t;
      m.position.set(x, y, z);
      const o = i * 3;
      if (!Number.isNaN(prev[o])) {
        TMP_V.set(x - prev[o], y - prev[o + 1], z - prev[o + 2]);
        const dist = TMP_V.length();
        if (f >= arriveAt[i]) {
          // 받침대에 놓이면 이름표가 정면을 보도록 천천히 돌린다
          m.quaternion.slerp(ID_Q, 1 - Math.exp(-6 * dt));
        } else if (f >= captureAt[i]) {
          // 관을 따라 구를 때는 z 축으로만 굴러서 이름표가 계속 앞을 본다
          TMP_Q.setFromAxisAngle(
            Z_AXIS,
            (-dist * Math.sign(TMP_V.x || 1)) / ballR
          );
          m.quaternion.slerp(ID_Q, 1 - Math.exp(-4 * dt)).premultiply(TMP_Q);
        } else if (dist > 1e-5) {
          TMP_AXIS.crossVectors(UP, TMP_V);
          if (TMP_AXIS.lengthSq() < 1e-10) TMP_AXIS.set(1, 0, 0);
          TMP_Q.setFromAxisAngle(TMP_AXIS.normalize(), dist / ballR);
          m.quaternion.premultiply(TMP_Q);
        }
      }
      prev[o] = x;
      prev[o + 1] = y;
      prev[o + 2] = z;
    }
  });

  return names.map((name, i) => (
    <Ball
      key={i}
      index={i}
      name={name}
      geometry={geometry}
      register={register}
      texScale={n > 80 ? 0.5 : 1}
    />
  ));
}

/* ---------------- 기계(장식) ---------------- */

function Gate({ rec, playRef }) {
  const ref = useRef();
  const { holeR, holeY } = rec.layout;
  useFrame((_, dt) => {
    const open = gateOpenAt(rec, playRef.current.f);
    const s = THREE.MathUtils.damp(
      ref.current.scale.x,
      open ? 0.001 : 1,
      10,
      dt
    );
    ref.current.scale.set(s, 1, s);
  });
  return (
    <mesh ref={ref} position={[0, holeY + 0.02, 0]}>
      <cylinderGeometry args={[holeR + 0.02, holeR + 0.02, 0.05, 32]} />
      <meshStandardMaterial {...metal} color="#c7ccd6" />
    </mesh>
  );
}

function Drum({ rec }) {
  const { R, holeY } = rec.layout;
  const geometry = useMemo(() => drumGeometry(R, holeY), [R, holeY]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} renderOrder={2}>
      <meshPhysicalMaterial {...glass} />
    </mesh>
  );
}

function Pipe({ rec }) {
  const { holeR, holeY, tubeTop, pipe } = rec.layout;
  const pipeR = holeR + 0.03;
  const curve = useMemo(
    () => new THREE.CatmullRomCurve3(pipe.map((p) => new THREE.Vector3(...p))),
    [pipe]
  );
  const tubeGeo = useMemo(
    () => new THREE.TubeGeometry(curve, 160, pipeR, 24, false),
    [curve, pipeR]
  );
  useEffect(() => () => tubeGeo.dispose(), [tubeGeo]);
  const rings = useMemo(
    () =>
      [0.18, 0.42, 0.66, 0.88].map((t) => ({
        p: curve.getPointAt(t),
        q: new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          curve.getTangentAt(t)
        ),
      })),
    [curve]
  );
  const tubeH = tubeTop - holeY;
  return (
    <group>
      <mesh position={[0, holeY + tubeH / 2, 0]} renderOrder={3}>
        <cylinderGeometry args={[pipeR, pipeR, tubeH, 32, 1, true]} />
        <meshPhysicalMaterial {...glass} />
      </mesh>
      <mesh geometry={tubeGeo} renderOrder={3}>
        <meshPhysicalMaterial {...glass} />
      </mesh>
      <mesh position={[0, holeY, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[pipeR + 0.08, 0.1, 16, 48]} />
        <meshStandardMaterial {...metal} />
      </mesh>
      <mesh position={[0, holeY + 0.35, 0]}>
        <cylinderGeometry
          args={[pipeR + 0.16, pipeR + 0.16, 0.18, 40, 1, true]}
        />
        <meshStandardMaterial {...metal} side={THREE.DoubleSide} />
      </mesh>
      {rings.map(({ p, q }, k) => (
        <mesh key={k} position={p} quaternion={q}>
          <torusGeometry args={[pipeR + 0.05, 0.06, 12, 32]} />
          <meshStandardMaterial {...accent} emissiveIntensity={0.6} />
        </mesh>
      ))}
    </group>
  );
}

function trayBox(layout) {
  const { slots, slot0, gap, trayTop } = layout;
  const xs = slots.map((s) => s[0]);
  const zs = slots.map((s) => s[2]);
  const x0 = slot0 - 0.75;
  const x1 = Math.max(...xs) + gap / 2 + 0.25;
  const depth = Math.max(1.5, Math.max(...zs) - Math.min(...zs) + gap + 0.5);
  return { x0, x1, cx: (x0 + x1) / 2, len: x1 - x0, depth, trayTop };
}

function Tray({ rec, playRef }) {
  const { slots, gap } = rec.layout;
  const box = trayBox(rec.layout);
  const ringR = Math.min(0.41, gap * 0.43);
  const mats = useRef([]);
  useFrame((_, dt) => {
    const arrived = playRef.current.arr;
    mats.current.forEach((m, k) => {
      if (!m) return;
      const target = k < arrived ? 3 : 0.15;
      m.emissiveIntensity = THREE.MathUtils.damp(
        m.emissiveIntensity,
        target,
        6,
        dt
      );
    });
  });
  return (
    <group>
      <RoundedBox
        args={[box.len, 1.0, box.depth]}
        radius={0.18}
        smoothness={4}
        position={[box.cx, box.trayTop - 0.5, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial {...shell} />
      </RoundedBox>
      <mesh position={[box.cx, box.trayTop - 0.82, box.depth / 2 + 0.01]}>
        <boxGeometry args={[box.len - 0.3, 0.07, 0.02]} />
        <meshStandardMaterial {...accent} />
      </mesh>
      {slots.map(([x, , z], k) => (
        <group key={k} position={[x, box.trayTop + 0.005, z]}>
          <mesh>
            <cylinderGeometry args={[ringR, ringR, 0.02, 32]} />
            <meshStandardMaterial color="#d7dbe2" roughness={0.6} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
            <torusGeometry args={[ringR + 0.01, 0.025, 8, 40]} />
            <meshStandardMaterial
              ref={(m) => {
                mats.current[k] = m;
              }}
              {...accent}
              emissiveIntensity={0.15}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Base({ rec, playRef }) {
  const nozzleMats = useRef([]);
  useFrame((_, dt) => {
    const on = airOn(rec, playRef);
    nozzleMats.current.forEach((m) => {
      if (m)
        m.emissiveIntensity = THREE.MathUtils.damp(
          m.emissiveIntensity,
          on ? 2.5 : 0,
          4,
          dt
        );
    });
  });
  return (
    <group>
      <mesh position={[0, -4.05, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[4.1, 4.3, 0.3, 64]} />
        <meshStandardMaterial {...shell} />
      </mesh>
      <mesh position={[0, -3.9, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[4.12, 0.05, 12, 96]} />
        <meshStandardMaterial {...accent} />
      </mesh>
      <mesh position={[0, -3.55, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[2.7, 3.2, 0.7, 64]} />
        <meshStandardMaterial {...shell} />
      </mesh>
      <mesh position={[0, -3.22, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.72, 0.04, 12, 96]} />
        <meshStandardMaterial {...accent} />
      </mesh>
      <mesh position={[0, -3.0, 0]} castShadow>
        <cylinderGeometry args={[1.9, 2.2, 0.45, 64]} />
        <meshStandardMaterial {...metal} />
      </mesh>
      {NOZZLES.map(([x, z], k) => (
        <mesh key={k} position={[x, -2.75, z]}>
          <cylinderGeometry args={[0.1, 0.13, 0.3, 16]} />
          <meshStandardMaterial
            ref={(m) => {
              nozzleMats.current[k] = m;
            }}
            color="#cfd6e0"
            metalness={0.8}
            roughness={0.2}
            emissive="#7cc4ff"
            emissiveIntensity={0}
          />
        </mesh>
      ))}
      <mesh position={[0, -2.72, 0]}>
        <cylinderGeometry args={[0.45, 0.5, 0.25, 32]} />
        <meshStandardMaterial {...metal} />
      </mesh>
      {[-1, 1].map((sx) => (
        <RoundedBox
          key={sx}
          args={[0.35, 2.4, 0.9]}
          radius={0.12}
          position={[sx * 3.25, -2.2, 0]}
          castShadow
        >
          <meshStandardMaterial {...shell} />
        </RoundedBox>
      ))}
    </group>
  );
}

// 노즐에서 올라오는 바람 입자 (장식)
const AIR_COUNT = 320;
const AIR = Array.from({ length: AIR_COUNT }, (_, k) => {
  const h = (s) =>
    (((Math.sin(k * 12.9898 + s * 78.233) * 43758.5453) % 1) + 1) % 1;
  return {
    n: k % NOZZLES.length,
    y0: h(1),
    sp: 3 + h(2) * 4,
    ph: h(3) * Math.PI * 2,
    spread: 0.2 + h(4) * 1.2,
  };
});

function AirStreams({ rec, playRef }) {
  const { R } = rec.layout;
  const ref = useRef();
  const mat = useRef();
  const positions = useMemo(() => new Float32Array(AIR_COUNT * 3), []);
  useFrame(({ clock }, dt) => {
    const m = mat.current;
    m.opacity = THREE.MathUtils.damp(
      m.opacity,
      airOn(rec, playRef) ? 0.9 : 0,
      3,
      dt
    );
    if (m.opacity < 0.01) return;
    const t = clock.elapsedTime;
    const span = R * 1.7;
    AIR.forEach((d, k) => {
      const y = -R * 0.85 + ((d.y0 * span + t * d.sp) % span);
      const h = (y + R) / (2 * R);
      const [nx, nz] = NOZZLES[d.n];
      const a = d.ph + t * 1.8 + h * 4;
      const spread = d.spread * h * 1.6;
      let x = nx * (1 - h) + Math.cos(a) * spread;
      let z = nz * (1 - h) + Math.sin(a) * spread;
      const lim = Math.sqrt(Math.max(0, (R - 0.2) ** 2 - y * y));
      const r = Math.hypot(x, z);
      if (r > lim) {
        x *= lim / r;
        z *= lim / r;
      }
      positions[k * 3] = x;
      positions[k * 3 + 1] = y;
      positions[k * 3 + 2] = z;
    });
    ref.current.geometry.attributes.position.needsUpdate = true;
  });
  return (
    <points ref={ref} renderOrder={4}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={mat}
        size={0.12}
        color="#d6efff"
        transparent
        opacity={0}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// 기계 왼쪽 끝 (받침 원판 바깥)
const MIN_X = -4.4;

// 기계와 받침대가 화면에 꽉 차도록 카메라 거리를 정한다
function CameraRig({ rec }) {
  const { camera, size } = useThree();
  const box = trayBox(rec.layout);

  const maxX = box.x1 + 0.3;
  const cx = (MIN_X + maxX) / 2;
  const cy = 0.9;
  useEffect(() => {
    const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * (size.width / size.height));
    const dW = (maxX - MIN_X) / 2 / Math.tan(hHalf);
    const dH = 6.9 / Math.tan(vHalf);
    const d = Math.max(dW, dH) * 1.08 + 1.5;
    camera.position.set(cx, cy + d * 0.06, d);
    camera.lookAt(cx, cy, 0);
  }, [camera, size.width, size.height, cx, maxX]);
  return (
    <OrbitControls
      makeDefault
      target={[cx, cy, 0]}
      enablePan
      screenSpacePanning
      onChange={(e) => clampPan(e?.target, [MIN_X, -4, -4], [maxX, 7, 4])}
      minDistance={4}
      maxDistance={40}
      maxPolarAngle={Math.PI / 2 - 0.04}
      enableDamping
    />
  );
}

// 효과음: 바람이 부는 동안 바람 소리, 뽑힌 공이 관을 굴러가는 동안 굴러가는 소리, 받침대에 놓일 때 "딱"
function Sounds({ rec, decoded, playRef }) {
  const sound = useRef(null);
  const lastArr = useRef(0);
  useEffect(() => {
    sound.current = { wind: loop('wind'), roll: loop('roll') };
    return () => {
      sound.current.wind.stop();
      sound.current.roll.stop();
    };
  }, []);
  useFrame(({ clock }) => {
    const s = sound.current;
    if (!s) return;
    const p = playRef.current;
    const live = p.playing && !p.done;
    s.wind.set(
      live && airOn(rec, playRef) ? 1 : 0,
      0.5 + 0.3 * Math.sin(clock.elapsedTime * 0.8)
    );
    let flying = 0;
    for (const [i] of rec.captures) {
      if (decoded.captureAt[i] <= p.f && p.f < decoded.arriveAt[i]) flying++;
    }
    s.roll.set(live && flying ? Math.min(1, 0.6 + flying * 0.15) : 0, 0.55);
    if (p.arr > lastArr.current) clack(0.9, 0.3);
    lastArr.current = p.arr;
  });
  return null;
}

/* ---------------- 전체 장면 ---------------- */

// playing: 재생 중인지 (카운트다운 동안은 false), speedRef: 재생 배속
// onCapture(k, ball) / onArrive(k, ball): k 번째 당첨 공이 구멍에 들어감 / 받침대에 도착함
export default function LottoStage({
  recording,
  decoded,
  names,
  playing,
  speedRef,
  onCapture,
  onArrive,
  onDone,
}) {
  const playRef = useRef({ f: 0, cap: 0, arr: 0, playing: false, done: false });
  useEffect(() => {
    playRef.current.playing = playing;
  }, [playing]);
  const eventsRef = useRef({ onCapture, onArrive, onDone });
  useEffect(() => {
    eventsRef.current = { onCapture, onArrive, onDone };
  }, [onCapture, onArrive, onDone]);

  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      camera={{ position: [3, 3, 22], fov: 36 }}
      gl={{ antialias: true, toneMappingExposure: 0.85 }}
    >
      <Playhead
        rec={recording}
        playRef={playRef}
        speedRef={speedRef}
        eventsRef={eventsRef}
      />
      <color attach="background" args={['#dfe6ef']} />
      <fog attach="fog" args={['#dfe6ef', 30, 60]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[6, 12, 8]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-12}
        shadow-camera-right={18}
        shadow-camera-top={10}
        shadow-camera-bottom={-8}
        shadow-bias={-0.0004}
      />
      <Environment resolution={256}>
        <Lightformer
          intensity={1.6}
          position={[0, 6, 0]}
          rotation-x={Math.PI / 2}
          scale={[12, 12, 1]}
        />
        <Lightformer
          intensity={1.6}
          position={[-8, 2, 4]}
          rotation-y={Math.PI / 2}
          scale={[10, 4, 1]}
        />
        <Lightformer
          intensity={1.2}
          position={[8, 1, -4]}
          rotation-y={-Math.PI / 2}
          scale={[10, 4, 1]}
        />
        <Lightformer
          intensity={1}
          color="#ffd9b8"
          position={[0, 0, 10]}
          scale={[14, 3, 1]}
        />
      </Environment>

      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -4.2, 0]}
        receiveShadow
      >
        <planeGeometry args={[90, 90]} />
        <meshStandardMaterial color="#e6ebf2" roughness={0.9} />
      </mesh>

      <Drum rec={recording} />
      <Gate rec={recording} playRef={playRef} />
      <Pipe rec={recording} />
      <Tray rec={recording} playRef={playRef} />
      <Base rec={recording} playRef={playRef} />
      <AirStreams rec={recording} playRef={playRef} />
      <Sounds rec={recording} decoded={decoded} playRef={playRef} />
      <Balls
        rec={recording}
        decoded={decoded}
        names={names}
        playRef={playRef}
      />

      <CameraRig rec={recording} />
      <EffectComposer multisampling={2}>
        <Bloom mipmapBlur luminanceThreshold={1} intensity={0.7} radius={0.7} />
      </EffectComposer>
    </Canvas>
  );
}
