import { lazy } from 'react';
import Show3D from './Show3D.jsx';
import { decodeSiege, TEAM_COLORS } from '../siege/decode.js';

// three.js 가 커서 성벽 탈환전을 볼 때만 불러온다
const SiegeStage = lazy(() => import('../siege/SiegeStage.jsx'));
const chipColor = (i) => TEAM_COLORS[i % TEAM_COLORS.length];

// 서버가 끝까지 돌려서 저장한 성벽 탈환전 기록을 재생한다.
// 성벽 위 도착 구역에 발을 디디거나 성문 안쪽 도착선을 넘은 순서대로 당첨이고, 화면은 기록을 보여줄 뿐이다.
// 당첨자가 많아서 이름 팝업 대신 장면 위의 도착 인원·실시간 순위로 알린다.
export default function Siege(props) {
  return (
    <Show3D
      {...props}
      Stage={SiegeStage}
      decode={decodeSiege}
      speedKey="midura-siege-speed"
      idleText="병사들이 성으로 달려가는 중… 성벽이나 부서진 성문으로 먼저 들어온 병사가 당첨이에요"
      chipColor={chipColor}
      popup={false}
      loadingText="성을 짓는 중…"
    />
  );
}
