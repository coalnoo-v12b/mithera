import { lazy } from 'react';
import Show3D from './Show3D.jsx';
import { decodeZombie, VEST_COLORS } from '../zombie/decode.js';

// three.js 가 커서 좀비 탈출을 볼 때만 불러온다
const ZombieStage = lazy(() => import('../zombie/ZombieStage.jsx'));
const chipColor = (i) => VEST_COLORS[i % VEST_COLORS.length];

// 서버가 끝까지 돌려서 저장한 좀비 탈출 기록을 재생한다.
// 바리게이트 통로를 지나 금색 생존선을 먼저 넘은 순서대로 당첨이고, 화면은 기록을 보여줄 뿐이다.
// 당첨자가 많아서 이름 팝업 대신 장면 위의 생존 인원·생존자 명단으로 알린다.
export default function Zombie(props) {
  return (
    <Show3D
      {...props}
      Stage={ZombieStage}
      decode={decodeZombie}
      speedKey="midura-zombie-speed"
      idleText="좀비 떼를 피해 바리게이트로 달리는 중… 생존선을 먼저 넘은 사람이 당첨이에요"
      chipColor={chipColor}
      popup={false}
      loadingText="거리를 봉쇄하는 중…"
    />
  );
}
