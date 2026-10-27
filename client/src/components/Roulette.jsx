import { lazy } from 'react';
import Show3D from './Show3D.jsx';
import { decodeRoulette } from '../roulette/decode.js';

// three.js 가 커서 룰렛을 볼 때만 불러온다
const RouletteStage = lazy(() => import('../roulette/RouletteStage.jsx'));
const chipColor = () => '#d4a52c';

// 서버의 물리 엔진(Rapier)이 끝까지 돌려서 저장한 룰렛 녹화를 재생한다.
// 공이 멈춘 칸의 주인이 당첨이고, 여러 명이면 당첨된 칸을 덮고 다시 굴린다. 화면은 녹화를 보여줄 뿐이다.
export default function Roulette(props) {
  return (
    <Show3D
      {...props}
      Stage={RouletteStage}
      decode={decodeRoulette}
      speedKey="midura-roulette-speed"
      idleText="휠이 돌고 공이 트랙을 달리는 중… 공이 멈춘 칸의 주인이 당첨이에요"
      chipColor={chipColor}
    />
  );
}
