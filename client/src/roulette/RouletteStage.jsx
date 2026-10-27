import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, OrbitControls } from '@react-three/drei';
import { clampPan } from '../three/clampPan.js';
import { clack, loop } from '../sfx.js';

// 서버의 물리 엔진이 이미 끝까지 돌려 저장한 룰렛 녹화를 3D 로 재생한다.
// 휠 각도와 공 위치를 녹화 그대로 보여줄 뿐, 당첨자를 정하지 않는다.
// 좌표와 치수는 녹화의 layout 에 담긴 서버 값(server/src/utils/roulette.js)을 그대로 쓴다.
// 휠이 끊김 없이 돌아 보이도록 그리기 비용이 큰 실시간 그림자와 후처리(빛 번짐)는 쓰지 않는다.

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
    // 룰렛은 슬로모션을 쓰지 않는다: 재생을 느리게 하면 휠까지 느려져 보여서, 휠이 늘 같은 속도로 돌게 한다.
    // 화면이 잠깐 멈춰도(프레임 지연) 그만큼의 시간을 그대로 반영해 휠 속도가 흐트러지지 않게 한다.
    p.f = Math.min(
      rec.frames - 1,
      p.f + Math.min(dt, 0.5) * rec.fps * speedRef.current
    );
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

// 판이 바뀔 때 서버는 공을 칸에서 트랙의 던지는 자리로 옮긴다 (한 프레임 만에 순간이동).
// 그 사이를 이어 그리면 공이 휠을 가로질러 날아가 보여서, 직전에 칸 안에서 작아졌다가 던지는 자리에서 커지게 한다.
const POP = 6; // 프레임 (약 0.2초)
function Ball({ rec, decoded, playRef }) {
  const ref = useRef();
  const starts = useMemo(() => rec.rounds.slice(1).map((r) => r.start), [rec]);
  useFrame(() => {
    const f = playRef.current.f;
    let scale = 1;
    let at = f;
    for (const s of starts) {
      if (f >= s - POP && f < s) {
        scale = (s - f) / POP;
        at = Math.min(f, s - 1); // 순간이동한 프레임과 섞지 않는다
      } else if (f >= s && f < s + POP) {
        scale = (f - s) / POP;
      }
    }
    ref.current.position.set(
      lerpAt(decoded.ball, at, 3, 0),
      lerpAt(decoded.ball, at, 3, 1),
      lerpAt(decoded.ball, at, 3, 2)
    );
    ref.current.scale.setScalar(Math.max(0.001, scale));
  });
  return (
    <mesh ref={ref}>
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
function drawPockets(canvas, L, P, owner, names) {
  const S = canvas.width;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, S, S);
  const k = S / 2 / L.pocketOut;
  const cx = S / 2;
  const step = TAU / P;
  for (let p = 0; p < P; p++) {
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
  for (let p = 0; p < P; p++) {
    let name = names[owner[p]] || '';
    while (name.length > 1 && g.measureText(name).width > maxLen)
      name = name.slice(0, -1);
    const a = (p + 0.5) * step;
    g.save();
    g.translate(cx + Math.cos(a) * mid, cx + Math.sin(a) * mid);
    g.rotate(a);
    g.fillText(name, 0, 0);
    g.restore();
  }
}

// 판마다의 칸 배치. v3 부터는 판이 바뀔 때 남은 사람끼리 칸을 다시 나누므로 판마다 다르다.
function pocketConfigs(rec) {
  const L = rec.layout;
  if (!rec.rounds.length || !rec.rounds[0].owner)
    return [{ from: 0, P: L.P, owner: L.owner }];
  return rec.rounds.map((r, k) => ({
    from: k === 0 ? 0 : r.start,
    P: r.P,
    owner: r.owner,
  }));
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
  const configs = useMemo(() => pocketConfigs(rec), [rec]);
  const maxP = Math.max(...configs.map((c) => c.P));
  // 판마다의 칸 그림을 재생 전에 모두 그려서 그래픽 카드에 올려 둔다.
  // 판이 바뀔 때 그 자리에서 그리고 올리면 그 순간 화면이 뚝 끊긴다. (판이 여러 개면 1024px 로 메모리를 아낀다)
  const { gl } = useThree();
  const floorMat = useRef();
  const tex = useRef([]);
  const fretRefs = useRef([]);
  const shown = useRef(-1);
  useEffect(() => {
    const size = configs.length > 1 ? 1024 : 2048;
    const list = configs.map((c) => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      drawPockets(canvas, L, c.P, c.owner, names);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      gl.initTexture(texture);
      return texture;
    });
    tex.current = list;
    floorMat.current.map = list[0];
    floorMat.current.needsUpdate = true;
    shown.current = -1;
    return () => list.forEach((t) => t.dispose());
  }, [configs, L, names, gl]);
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
  // v1, v2 녹화: 당첨된 사람의 칸은 다음 판을 굴리는 순간 덮개로 덮인다 (서버와 같은 시점)
  const lids = useMemo(
    () =>
      configs.length > 1
        ? []
        : rec.rounds.map((r, k) => ({
            from: rec.rounds[k + 1] ? rec.rounds[k + 1].start : Infinity,
            pockets: L.owner
              .map((o, p) => (o === r.winner ? p : -1))
              .filter((p) => p >= 0),
          })),
    [rec, L, configs]
  );
  const lidRefs = useRef([]);

  useFrame(() => {
    const f = playRef.current.f;
    ref.current.rotation.y = lerpAt(decoded.wheel, f, 1, 0);
    lids.forEach((l, k) => {
      const g = lidRefs.current[k];
      if (g) g.visible = f >= l.from;
    });
    // 지금 판의 칸 배치로 바닥 그림과 칸막이를 바꾼다
    let k = 0;
    while (k + 1 < configs.length && configs[k + 1].from <= f) k++;
    if (k !== shown.current && tex.current[k]) {
      shown.current = k;
      const c = configs[k];
      floorMat.current.map = tex.current[k];
      const mid = (L.pocketIn + L.pocketOut) / 2;
      fretRefs.current.forEach((m, p) => {
        if (!m) return;
        m.visible = p < c.P;
        const a = (p / c.P) * TAU;
        m.position.set(
          Math.cos(a) * mid,
          L.floorOutY + L.fretH / 2,
          Math.sin(a) * mid
        );
        m.rotation.set(0, -a, 0);
      });
    }
  });

  const mid = (L.pocketIn + L.pocketOut) / 2;
  const fretLen = L.pocketOut - L.pocketIn;
  return (
    <group ref={ref}>
      <mesh geometry={rimGeo}>
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
      >
        <ringGeometry args={[L.pocketIn, L.pocketOut, 256, 1]} />
        <meshStandardMaterial ref={floorMat} roughness={0.5} />
      </mesh>
      {Array.from({ length: maxP }, (_, p) => (
        <mesh
          key={p}
          ref={(m) => {
            fretRefs.current[p] = m;
          }}
        >
          <boxGeometry args={[fretLen, L.fretH, 0.03]} />
          <meshStandardMaterial {...gold} />
        </mesh>
      ))}
      <mesh geometry={coneGeo}>
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
      <mesh geometry={turretGeo}>
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
      <mesh geometry={trackGeo}>
        <meshPhysicalMaterial {...darkWood} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={bodyGeo}>
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
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.0, 0]}>
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
    const nearJump = rec.rounds.some(
      (r, k) => k > 0 && f0 >= r.start - 2 && f0 <= r.start + 2
    );
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
    roll.set(nearJump ? 0 : Math.min(1, speed / 9), Math.min(1, speed / 14));
    if (f0 !== lastFrame.current && !nearJump) {
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
      dpr={[1, 1.25]}
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
    </Canvas>
  );
}
