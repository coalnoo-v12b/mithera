import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, OrbitControls } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { clampPan } from '../three/clampPan.js';
import { clack, loop } from '../sfx.js';

// 서버의 물리 엔진이 이미 끝까지 돌려 저장한 룰렛 녹화를 3D 로 재생한다.
// 휠 각도와 공 위치를 녹화 그대로 보여줄 뿐, 당첨자를 정하지 않는다.
// 좌표와 치수는 녹화의 layout 에 담긴 서버 값(server/src/utils/roulette.js)을 그대로 쓴다.

const TAU = Math.PI * 2;
const v2 = (r, y) => new THREE.Vector2(r, y);

const wood = {
  color: '#5a2a14',
  roughness: 0.35,
  metalness: 0.05,
  clearcoat: 1,
  clearcoatRoughness: 0.12,
};
const darkWood = { ...wood, color: '#3a1a0c' };
const gold = { color: '#d4a52c', metalness: 1, roughness: 0.25 };

/* ---------------- 재생 ---------------- */

// 재생 위치(프레임)를 앞으로 보내고, 당첨 확정/끝 이벤트를 알린다. 다른 컴포넌트보다 먼저 실행된다.
function Playhead({ rec, playRef, speedRef, eventsRef }) {
  useFrame((_, dt) => {
    const p = playRef.current;
    if (!p.playing || p.done) return;
    // 공이 칸에 들어가기 직전에는 슬로모션 (당첨 인원이 적으면 매 판, 많으면 마지막 판만)
    const next = rec.rounds[p.won];
    const slowAll = rec.winnerCount <= 3;
    const slow =
      next &&
      (slowAll || p.won === rec.rounds.length - 1) &&
      next.settle - p.f < rec.fps * 2.4 &&
      next.settle - p.f > 0;
    const sp = speedRef.current * (slow ? 0.5 : 1);
    p.f = Math.min(rec.frames - 1, p.f + Math.min(dt, 0.1) * rec.fps * sp);
    while (p.won < rec.rounds.length && rec.rounds[p.won].settle <= p.f) {
      eventsRef.current.onArrive(p.won, rec.rounds[p.won].winner);
      p.won++;
    }
    if (p.f >= rec.frames - 1) {
      p.done = true;
      eventsRef.current.onDone();
    }
  });
  return null;
}

const lerpAt = (arr, f, stride, k) => {
  const f0 = Math.floor(f);
  const f1 = Math.min(arr.length / stride - 1, f0 + 1);
  const t = f - f0;
  return (
    arr[f0 * stride + k] + (arr[f1 * stride + k] - arr[f0 * stride + k]) * t
  );
};

function Ball({ rec, decoded, playRef }) {
  const ref = useRef();
  useFrame(() => {
    const f = playRef.current.f;
    ref.current.position.set(
      lerpAt(decoded.ball, f, 3, 0),
      lerpAt(decoded.ball, f, 3, 1),
      lerpAt(decoded.ball, f, 3, 2)
    );
  });
  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[rec.layout.ballR, 32, 24]} />
      <meshPhysicalMaterial
        color="#fbfbf6"
        roughness={0.15}
        clearcoat={1}
        clearcoatRoughness={0.05}
      />
    </mesh>
  );
}

/* ---------------- 휠(회전판) ---------------- */

// 칸 바닥 그림: 빨강/검정 칸과 주인 이름. 캔버스 오른쪽이 +x, 아래쪽이 +z 인 위에서 본 그림이다.
function pocketTexture(L, names) {
  const S = 2048;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  const k = S / 2 / L.pocketOut;
  const cx = S / 2;
  const step = TAU / L.P;
  for (let p = 0; p < L.P; p++) {
    const a0 = p * step;
    const a1 = a0 + step;
    g.beginPath();
    g.arc(cx, cx, L.pocketOut * k, a0, a1);
    g.arc(cx, cx, L.pocketIn * k, a1, a0, true);
    g.closePath();
    g.fillStyle = p % 2 ? '#141417' : '#b3202a';
    g.fill();
  }
  // 이름: 칸 가운데에 바깥쪽을 향해 쓴다
  const mid = ((L.pocketIn + L.pocketOut) / 2) * k;
  const arc = mid * step;
  const size = Math.max(14, Math.min(46, arc * 0.5));
  g.fillStyle = '#f6e7b5';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${size}px "Pretendard", "Malgun Gothic", sans-serif`;
  const maxLen = (L.pocketOut - L.pocketIn) * k * 0.86;
  for (let p = 0; p < L.P; p++) {
    let name = names[L.owner[p]] || '';
    while (name.length > 1 && g.measureText(name).width > maxLen)
      name = name.slice(0, -1);
    const a = (p + 0.5) * step;
    g.save();
    g.translate(cx + Math.cos(a) * mid, cx + Math.sin(a) * mid);
    g.rotate(a);
    g.fillText(name, 0, 0);
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// 당첨된 사람의 칸을 덮는 금색 덮개 (휠 기준 각도 a0~a1)
function Lid({ L, p }) {
  const step = TAU / L.P;
  const a0 = p * step;
  // RingGeometry 를 눕히면(x 축 -90도) 세계 각도가 반대로 돌아가서 시작 각도를 뒤집는다
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, L.rimY - 0.035, 0]}>
      <ringGeometry
        args={[L.pocketIn + 0.02, L.pocketOut - 0.02, 8, 1, -(a0 + step), step]}
      />
      <meshStandardMaterial
        {...gold}
        emissive="#b8860b"
        emissiveIntensity={0.35}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function Wheel({ rec, decoded, names, playRef }) {
  const L = rec.layout;
  const ref = useRef();
  const texture = useMemo(() => pocketTexture(L, names), [L, names]);
  useEffect(() => () => texture.dispose(), [texture]);
  const rimGeo = useMemo(
    () =>
      new THREE.LatheGeometry(
        [v2(L.rimIn, L.rimY), v2(L.rimOut, L.rimOutY)],
        128
      ),
    [L]
  );
  const wallGeo = useMemo(
    () =>
      new THREE.LatheGeometry(
        [v2(L.pocketOut, L.floorOutY - 0.01), v2(L.rimIn, L.rimY)],
        128
      ),
    [L]
  );
  const coneGeo = useMemo(
    () =>
      new THREE.LatheGeometry(
        [
          v2(L.coneTopR, L.coneTopY),
          v2(L.pocketIn, L.floorInY + 0.12),
          v2(L.pocketIn, L.floorInY - 0.02),
        ],
        128
      ),
    [L]
  );
  const turretGeo = useMemo(
    () =>
      new THREE.LatheGeometry(
        [
          v2(0, L.turretTop + 0.1),
          v2(0.06, L.turretTop + 0.06),
          v2(0.12, L.turretTop - 0.05),
          v2(0.08, L.turretTop - 0.2),
          v2(0.14, L.turretTop - 0.35),
          v2(0.3, L.coneTopY + 0.12),
          v2(L.coneTopR, L.coneTopY),
        ],
        64
      ),
    [L]
  );
  useEffect(
    () => () =>
      [rimGeo, wallGeo, coneGeo, turretGeo].forEach((g) => g.dispose()),
    [rimGeo, wallGeo, coneGeo, turretGeo]
  );
  const frets = useMemo(
    () =>
      Array.from({ length: L.P }, (_, p) => {
        const a = (p / L.P) * TAU;
        const mid = (L.pocketIn + L.pocketOut) / 2;
        return { a, x: Math.cos(a) * mid, z: Math.sin(a) * mid };
      }),
    [L]
  );
  // 덮개는 다음 판을 굴리는 순간 생긴다 (서버와 같은 시점)
  const lids = useMemo(
    () =>
      rec.rounds.map((r, k) => ({
        from: rec.rounds[k + 1] ? rec.rounds[k + 1].start : Infinity,
        pockets: L.owner
          .map((o, p) => (o === r.winner ? p : -1))
          .filter((p) => p >= 0),
      })),
    [rec, L]
  );
  const lidRefs = useRef([]);

  useFrame(() => {
    const f = playRef.current.f;
    ref.current.rotation.y = lerpAt(decoded.wheel, f, 1, 0);
    lids.forEach((l, k) => {
      const g = lidRefs.current[k];
      if (g) g.visible = f >= l.from;
    });
  });

  const mid = (L.pocketIn + L.pocketOut) / 2;
  const fretLen = L.pocketOut - L.pocketIn;
  return (
    <group ref={ref}>
      <mesh geometry={rimGeo} receiveShadow>
        <meshPhysicalMaterial
          {...wood}
          color="#7a3b1c"
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh geometry={wallGeo}>
        <meshStandardMaterial color="#1c1a18" side={THREE.DoubleSide} />
      </mesh>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, (L.floorInY + L.floorOutY) / 2 + 0.01, 0]}
        receiveShadow
      >
        <ringGeometry args={[L.pocketIn, L.pocketOut, 256, 1]} />
        <meshStandardMaterial map={texture} roughness={0.5} />
      </mesh>
      {frets.map(({ a, x, z }, p) => (
        <mesh
          key={p}
          position={[x, L.floorOutY + L.fretH / 2, z]}
          rotation={[0, -a, 0]}
          castShadow
        >
          <boxGeometry args={[fretLen, L.fretH, 0.03]} />
          <meshStandardMaterial {...gold} />
        </mesh>
      ))}
      <mesh geometry={coneGeo} receiveShadow>
        <meshPhysicalMaterial {...wood} side={THREE.DoubleSide} />
      </mesh>
      {/* 원뿔 위 장식 살 */}
      {[0, 1, 2, 3].map((k) => {
        const a = (k / 4) * TAU;
        const r = (L.coneTopR + L.pocketIn) / 2 - 0.15;
        const y =
          L.coneTopY -
          ((r - L.coneTopR) / (L.pocketIn - L.coneTopR)) *
            (L.coneTopY - L.floorInY - 0.12);
        return (
          <mesh
            key={k}
            position={[Math.cos(a) * r, y + 0.03, Math.sin(a) * r]}
            rotation={[0, -a, -0.32]}
          >
            <boxGeometry args={[1.3, 0.04, 0.07]} />
            <meshStandardMaterial {...gold} />
          </mesh>
        );
      })}
      <mesh geometry={turretGeo} castShadow>
        <meshStandardMaterial {...gold} side={THREE.DoubleSide} />
      </mesh>
      <mesh
        position={[mid * 0, L.rimY + 0.005, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[L.rimIn - 0.02, L.rimIn + 0.02, 128]} />
        <meshStandardMaterial {...gold} side={THREE.DoubleSide} />
      </mesh>
      {lids.map((l, k) => (
        <group
          key={k}
          ref={(g) => {
            lidRefs.current[k] = g;
          }}
          visible={false}
        >
          {l.pockets.map((p) => (
            <Lid key={p} L={L} p={p} />
          ))}
        </group>
      ))}
    </group>
  );
}

/* ---------------- 그릇(움직이지 않음)과 테이블 ---------------- */

function Bowl({ rec }) {
  const L = rec.layout;
  const trackGeo = useMemo(
    () =>
      new THREE.LatheGeometry(
        [
          v2(L.trackIn, L.trackInY),
          v2(L.trackOut, L.trackOutY),
          v2(L.wallR, L.trackOutY),
          v2(L.wallR, L.wallTop),
        ],
        160
      ),
    [L]
  );
  const bodyGeo = useMemo(
    () =>
      new THREE.LatheGeometry(
        [
          v2(L.wallR, L.wallTop),
          v2(L.wallR + 0.25, L.wallTop + 0.08),
          v2(L.wallR + 0.65, L.wallTop + 0.02),
          v2(L.wallR + 0.75, L.wallTop - 0.2),
          v2(L.wallR + 0.75, -1.0),
          v2(L.trackIn - 0.05, -1.0),
          v2(L.trackIn - 0.05, L.trackInY - 0.02),
        ],
        160
      ),
    [L]
  );
  useEffect(
    () => () => [trackGeo, bodyGeo].forEach((g) => g.dispose()),
    [trackGeo, bodyGeo]
  );
  const slope = (L.trackOutY - L.trackInY) / (L.trackOut - L.trackIn);
  const deflY = L.trackOutY - slope * (L.trackOut - L.deflectorR);
  return (
    <group>
      <mesh geometry={trackGeo} receiveShadow>
        <meshPhysicalMaterial {...darkWood} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={bodyGeo} castShadow receiveShadow>
        <meshPhysicalMaterial {...wood} side={THREE.DoubleSide} />
      </mesh>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, L.wallTop + 0.085, 0]}
      >
        <ringGeometry args={[L.wallR + 0.22, L.wallR + 0.28, 160]} />
        <meshStandardMaterial {...gold} side={THREE.DoubleSide} />
      </mesh>
      {Array.from({ length: L.deflectors }, (_, k) => {
        const a = ((k + 0.5) / L.deflectors) * TAU;
        return (
          <mesh
            key={k}
            position={[
              Math.cos(a) * L.deflectorR,
              deflY + 0.03,
              Math.sin(a) * L.deflectorR,
            ]}
            rotation={[0, -a + Math.PI / 4, 0]}
            scale={[0.22, 0.09, 0.11]}
            castShadow
          >
            <octahedronGeometry args={[1, 0]} />
            <meshStandardMaterial {...gold} />
          </mesh>
        );
      })}
    </group>
  );
}

function Table() {
  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -1.0, 0]}
        receiveShadow
      >
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#0f4a38" roughness={0.95} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.995, 0]}>
        <ringGeometry args={[5.6, 5.7, 128]} />
        <meshStandardMaterial {...gold} />
      </mesh>
    </group>
  );
}

// 그릇 전체가 화면에 들어오도록 비스듬히 내려다보는 카메라
function CameraRig() {
  const { camera, size } = useThree();
  useEffect(() => {
    const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * (size.width / size.height));
    const d = Math.max(5.6 / Math.tan(hHalf), 4.4 / Math.tan(vHalf)) + 1;
    const dir = new THREE.Vector3(0, 0.78, 0.62).normalize();
    camera.position
      .copy(dir.multiplyScalar(d))
      .add(new THREE.Vector3(0, -0.4, 0));
    camera.lookAt(0, -0.4, 0);
  }, [camera, size.width, size.height]);
  return (
    <OrbitControls
      makeDefault
      target={[0, -0.4, 0]}
      enablePan
      screenSpacePanning
      onChange={(e) => clampPan(e?.target, [-5, -1, -5], [5, 1.5, 5])}
      minDistance={2.5}
      maxDistance={30}
      maxPolarAngle={Math.PI / 2 - 0.1}
      enableDamping
    />
  );
}

// 효과음: 공이 휠에 대해 움직이는 빠르기만큼 굴러가는 소리, 휠 안에서 방향이 확 꺾이면(칸막이·다이아몬드에 부딪히면) "딱"
function Sounds({ rec, decoded, playRef }) {
  const L = rec.layout;
  const sound = useRef(null);
  const lastFrame = useRef(-1);
  useEffect(() => {
    sound.current = loop('roll');
    return () => sound.current.stop();
  }, []);
  useFrame(() => {
    const roll = sound.current;
    if (!roll) return;
    const p = playRef.current;
    const F = decoded.F;
    const f0 = Math.min(F - 3, Math.max(1, Math.floor(p.f)));
    if (!p.playing || p.done) {
      roll.set(0);
      return;
    }
    const b = decoded.ball;
    const at = (f) => [b[f * 3], b[f * 3 + 1], b[f * 3 + 2]];
    const [x0, y0, z0] = at(f0 - 1);
    const [x1, y1, z1] = at(f0);
    const [x2, y2, z2] = at(f0 + 1);
    // 휠과 같이 도는 속도는 빼고 공이 휠 위를 미끄러지는 빠르기만 본다
    const w = (decoded.wheel[f0 + 1] - decoded.wheel[f0]) * rec.fps;
    const r = Math.hypot(x1, z1);
    const onWheel = r < L.rimOut;
    const vx = (x2 - x1) * rec.fps - (onWheel ? w * z1 : 0);
    const vz = (z2 - z1) * rec.fps + (onWheel ? w * x1 : 0);
    const vy = (y2 - y1) * rec.fps;
    const speed = Math.hypot(vx, vy, vz);
    roll.set(Math.min(1, speed / 9), Math.min(1, speed / 14));
    if (f0 !== lastFrame.current) {
      lastFrame.current = f0;
      const ax = x1 - x0;
      const ay = y1 - y0;
      const az = z1 - z0;
      const bx = x2 - x1;
      const by = y2 - y1;
      const bz = z2 - z1;
      const la = Math.hypot(ax, ay, az);
      const lb = Math.hypot(bx, by, bz);
      if (la > 0.01 && lb > 0.01) {
        const cos = (ax * bx + ay * by + az * bz) / (la * lb);
        if (cos < 0.6 && r < L.trackIn + 0.6)
          clack(Math.min(1, la * 8), onWheel ? 0.7 : 0.4);
      }
    }
  });
  return null;
}

/* ---------------- 전체 장면 ---------------- */

// playing: 재생 중인지 (카운트다운 동안은 false), speedRef: 재생 배속
// onArrive(k, 참가자 번호): k 번째 판에서 공이 칸에 멈춰 당첨이 확정됨
export default function RouletteStage({
  recording,
  decoded,
  names,
  playing,
  speedRef,
  onArrive,
  onDone,
}) {
  const playRef = useRef({ f: 0, won: 0, playing: false, done: false });
  useEffect(() => {
    playRef.current.playing = playing;
  }, [playing]);
  const eventsRef = useRef({ onArrive, onDone });
  useEffect(() => {
    eventsRef.current = { onArrive, onDone };
  }, [onArrive, onDone]);

  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      camera={{ position: [0, 9, 8], fov: 36 }}
      gl={{ antialias: true, toneMappingExposure: 0.95 }}
    >
      <Playhead
        rec={recording}
        playRef={playRef}
        speedRef={speedRef}
        eventsRef={eventsRef}
      />
      <color attach="background" args={['#0b2a21']} />
      <fog attach="fog" args={['#0b2a21', 22, 45]} />
      <ambientLight intensity={0.3} />
      <spotLight
        position={[2, 12, 4]}
        angle={0.55}
        penumbra={0.6}
        intensity={260}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
      />
      <Environment resolution={256}>
        <Lightformer
          intensity={2}
          position={[0, 6, 0]}
          rotation-x={Math.PI / 2}
          scale={[10, 10, 1]}
        />
        <Lightformer
          intensity={1.4}
          color="#ffd9a0"
          position={[-8, 3, 3]}
          rotation-y={Math.PI / 2}
          scale={[10, 3, 1]}
        />
        <Lightformer
          intensity={1}
          color="#ffe6c0"
          position={[8, 2, -3]}
          rotation-y={-Math.PI / 2}
          scale={[10, 3, 1]}
        />
      </Environment>

      <Table />
      <Bowl rec={recording} />
      <Wheel
        rec={recording}
        decoded={decoded}
        names={names}
        playRef={playRef}
      />
      <Ball rec={recording} decoded={decoded} playRef={playRef} />
      <Sounds rec={recording} decoded={decoded} playRef={playRef} />

      <CameraRig />
      <EffectComposer multisampling={2}>
        <Bloom mipmapBlur luminanceThreshold={1} intensity={0.4} radius={0.6} />
      </EffectComposer>
    </Canvas>
  );
}
