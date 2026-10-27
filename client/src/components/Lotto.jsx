import { lazy } from 'react';
import Show3D from './Show3D.jsx';
import { BALL_COLORS } from '../lotto/ballTexture.js';
import { decodeLotto } from '../lotto/decode.js';

// three.js 가 커서 로또 추첨기를 볼 때만 불러온다
const LottoStage = lazy(() => import('../lotto/LottoStage.jsx'));
const chipColor = (ball) => BALL_COLORS[ball % BALL_COLORS.length];

// 서버의 물리 엔진(Rapier)이 끝까지 돌려서 저장한 로또 추첨기 녹화를 재생한다.
// 공이 구멍으로 빨려 올라간 순서가 그대로 당첨 순서다. 화면은 녹화를 보여줄 뿐 결과를 정하지 않는다.
export default function Lotto(props) {
  return (
    <Show3D
      {...props}
      Stage={LottoStage}
      decode={decodeLotto}
      speedKey="midura-lotto-speed"
      idleText="공기를 불어넣어 섞는 중… 구멍으로 먼저 올라온 공이 당첨이에요"
      chipColor={chipColor}
    />
  );
}
