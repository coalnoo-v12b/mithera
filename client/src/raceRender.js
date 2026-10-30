// 구슬 레이스 경기 기록(recording)을 canvas 에 그리는 순수 함수 모음. (React 와 무관해서 Node 에서도 그려 볼 수 있다)
// 승자는 이미 서버가 정했고, 여기서는 기록된 움직임을 네온 스타일로 보여주기만 한다.
//
// 화면 구성: 왼쪽 미니맵 패널 | 메인 화면(카메라가 선두 무리를 따라감) + 오른쪽 위 실시간 순위 + 맨 위 "도착 / 총원"
export const VIEW_W = 480;
export const VIEW_H = 720;
const MM_W = 84; // 왼쪽 미니맵 패널 폭
const MV_X = MM_W; // 메인 화면 시작 x
const MV_W = VIEW_W - MM_W;
const SEE_W = 440; // 기본 화면에 보이는 트랙의 가로 길이(월드 px)
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const FONT = 'Pretendard, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
const CYAN = '#22d3ee';

// 구슬 수에 맞춰 색상환을 균등하게 나눈 네온 색
export const colorOf = (i, n) =>
  `hsl(${(Math.round((i * 360) / Math.max(n, 1)) + 12) % 360} 100% 62%)`;

export function createRenderer(rec, decoded, names) {
  const { xs, ys, bars } = decoded;
  const n = rec.n,
    F = rec.frames,
    r = rec.r;
  const orderIdx = new Array(n);
  rec.order.forEach((m, k) => {
    orderIdx[m] = k;
  });
  const finishFrame = ys.map((a) => {
    const f = a.findIndex((y) => y >= rec.finishY);
    return f < 0 ? Infinity : f;
  });
  const cam = { x: 0, y: 0, z: 1, init: false };
  const glow = n <= 40; // 구슬이 아주 많으면 번짐 효과를 줄여 가볍게 그린다

  const at = (arr, f) => {
    const f0 = clamp(Math.floor(f), 0, F - 1),
      f1 = Math.min(F - 1, f0 + 1),
      t = f - f0;
    return arr[f0] + (arr[f1] - arr[f0]) * t;
  };
  const posAt = (f) => {
    const px = new Array(n),
      py = new Array(n);
    for (let i = 0; i < n; i++) {
      px[i] = at(xs[i], f);
      py[i] = at(ys[i], f);
    }
    return { px, py };
  };
  const rankList = (f, py) => {
    const done = [],
      rest = [];
    for (let i = 0; i < n; i++) (finishFrame[i] <= f ? done : rest).push(i);
    done.sort((a, b) => orderIdx[a] - orderIdx[b]);
    rest.sort((a, b) => py[b] - py[a]);
    return done.concat(rest);
  };
  const label = (i, max) => {
    const t = [...names[i]];
    return t.slice(0, max).join('') + (t.length > max ? '…' : '');
  };
  const setGlow = (ctx, color, blur) => {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
  };
  const noGlow = (ctx) => {
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  };
  const rectPath = (ctx, cx, cy, w, h, a) => {
    const c = Math.cos(a),
      s = Math.sin(a);
    const pts = [
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
      [w / 2, h / 2],
      [-w / 2, h / 2],
    ].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
    ctx.beginPath();
    pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  };

  // ---------- 월드(메인 화면) ----------
  function drawWorld(ctx, f, px, py, order, S, vw, vh) {
    const y0 = cam.y - 80,
      y1 = cam.y + vh + 80;

    // 거리 눈금
    ctx.font = `700 ${11 / S}px ${FONT}`;
    ctx.textAlign = 'left';
    for (let y = 500; y < rec.finishY; y += 500) {
      if (y < y0 || y > y1) continue;
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      ctx.fillRect(0, y, rec.W, 1.5 / S);
      ctx.fillStyle = 'rgba(255,255,255,.3)';
      ctx.fillText(`${Math.round(y / 10)}m`, 10, y - 5 / S);
    }

    // 벽: 안쪽 가장자리를 형광 흰색 막대로 (처음 3개는 좌우 벽과 바닥)
    ctx.lineCap = 'round';
    if (glow) setGlow(ctx, CYAN, 16);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 5 / S;
    rec.shapes.rects.forEach(([cx, cy, w, h], k) => {
      if (k > 2) return;
      ctx.beginPath();
      if (h > w) {
        const x = cx > rec.W / 2 ? cx - w / 2 : cx + w / 2;
        ctx.moveTo(x, y0 - 50);
        ctx.lineTo(x, y1 + 50);
      } else {
        const y = cy - h / 2;
        ctx.moveTo(-10, y);
        ctx.lineTo(rec.W + 10, y);
      }
      ctx.stroke();
    });
    // 경사: 가는 윤곽선
    ctx.strokeStyle = '#d6dbe4';
    ctx.lineWidth = 3 / S;
    ctx.fillStyle = 'rgba(255,255,255,.05)';
    if (glow) setGlow(ctx, CYAN, 8);
    rec.shapes.rects.forEach(([cx, cy, w, h, a], k) => {
      if (k < 3) return;
      const ext = Math.max(w, h);
      if (cy + ext < y0 || cy - ext > y1) return;
      rectPath(ctx, cx, cy, w, h, a);
      ctx.fill();
      ctx.stroke();
    });
    // 핀/범퍼
    if (glow) setGlow(ctx, CYAN, 9);
    for (const [cx, cy, cr] of rec.shapes.circles) {
      if (cy < y0 || cy > y1) continue;
      const bump = cr > 15;
      ctx.beginPath();
      ctx.arc(cx, cy, cr, 0, TAU);
      ctx.fillStyle = bump ? '#3b0a2a' : '#04202a';
      ctx.fill();
      ctx.strokeStyle = bump ? '#f472b6' : CYAN;
      ctx.lineWidth = (bump ? 4 : 2.5) / S;
      if (glow) ctx.shadowColor = bump ? '#f472b6' : CYAN;
      ctx.stroke();
    }
    // 회전 막대
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 3 / S;
    ctx.fillStyle = 'rgba(250,204,21,.16)';
    if (glow) setGlow(ctx, '#facc15', 12);
    rec.shapes.bars.forEach(([cx, cy, w, h], k) => {
      if (cy < y0 - 160 || cy > y1 + 160) return;
      rectPath(ctx, cx, cy, w, h, at(bars[k], f));
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, TAU);
      ctx.fillStyle = '#fff7d6';
      ctx.fill();
      ctx.fillStyle = 'rgba(250,204,21,.16)';
    });
    noGlow(ctx);

    // 결승선
    if (rec.finishY > y0 - 40 && rec.finishY < y1) {
      const cell = rec.W / 30;
      for (let k = 0; k < 30; k++)
        for (let j = 0; j < 2; j++) {
          ctx.fillStyle = (k + j) % 2 ? '#ffffff' : '#111111';
          ctx.fillRect(k * cell, rec.finishY + j * cell, cell, cell);
        }
      ctx.font = `900 ${24 / S}px ${FONT}`;
      ctx.textAlign = 'center';
      if (glow) setGlow(ctx, '#facc15', 14);
      ctx.fillStyle = '#facc15';
      ctx.fillText('FINISH', rec.W / 2, rec.finishY - 14 / S);
      noGlow(ctx);
    }

    // 구슬 꼬리(궤적)
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      if (py[i] < y0 - 60 || py[i] > y1 + 60) continue;
      let lx = px[i],
        ly = py[i];
      for (let k = 1; k <= 7; k++) {
        const pf = Math.max(0, f - k * 0.45);
        const nx = at(xs[i], pf),
          ny = at(ys[i], pf);
        ctx.strokeStyle = colorOf(i, n);
        ctx.globalAlpha = 0.55 * (1 - k / 8);
        ctx.lineWidth = r * 1.6 * (1 - k / 9);
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(nx, ny);
        ctx.stroke();
        lx = nx;
        ly = ny;
      }
    }
    ctx.globalAlpha = 1;

    // 구슬 (아래쪽이 위로 오도록 y 오름차순)
    const idxs = Array.from({ length: n }, (_, i) => i).sort(
      (a, b) => py[a] - py[b]
    );
    for (const i of idxs) {
      if (py[i] < y0 - 40 || py[i] > y1 + 40) continue;
      const c = colorOf(i, n);
      if (glow) setGlow(ctx, c, 16);
      const g = ctx.createRadialGradient(
        px[i] - r * 0.35,
        py[i] - r * 0.35,
        1,
        px[i],
        py[i],
        r
      );
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.3, c);
      g.addColorStop(1, c);
      ctx.beginPath();
      ctx.arc(px[i], py[i], r, 0, TAU);
      ctx.fillStyle = g;
      ctx.fill();
      noGlow(ctx);
      ctx.lineWidth = 2 / S;
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.stroke();
    }
    // 이름표: 구슬 위에 큰 네온 글씨. 순위가 높은 구슬부터 그리고, 앞서 그린 이름표와 겹치면 건너뛴다.
    const showAll = n <= 16;
    const top8 = new Set(order.slice(0, 8));
    ctx.font = `800 ${15 / S}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    const placed = [];
    for (const i of order) {
      if (py[i] < y0 || py[i] > y1) continue;
      if (!showAll && !top8.has(i)) continue;
      const text = label(i, 6);
      const tx = clamp(px[i], cam.x + 34 / S, cam.x + vw - 34 / S),
        ty = py[i] - r - 6 / S;
      const bw = (text.length * 15 * 1.0 + 10) / S,
        bh = 19 / S;
      if (
        placed.some(
          (p) => Math.abs(p.x - tx) < (p.w + bw) / 2 && Math.abs(p.y - ty) < bh
        )
      )
        continue;
      placed.push({ x: tx, y: ty, w: bw });
      ctx.lineWidth = 4 / S;
      ctx.strokeStyle = 'rgba(0,0,0,.9)';
      ctx.strokeText(text, tx, ty);
      ctx.fillStyle = colorOf(i, n);
      ctx.fillText(text, tx, ty);
    }
  }

  // ---------- 왼쪽 미니맵 ----------
  function drawMinimap(ctx, py, px, vw, vh) {
    ctx.fillStyle = '#0c0c0c';
    ctx.fillRect(0, 0, MM_W, VIEW_H);
    const sc = Math.min((MM_W - 14) / rec.W, (VIEW_H - 24) / rec.H);
    const mw = rec.W * sc,
      mh = rec.H * sc,
      ox = (MM_W - mw) / 2,
      oy = 12;
    ctx.fillStyle = '#303030';
    ctx.fillRect(ox, oy, mw, mh);
    ctx.strokeStyle = '#2a9d2a';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox, oy, mw, mh);
    ctx.strokeStyle = '#9aa3b2';
    ctx.lineWidth = 1;
    rec.shapes.rects.forEach(([cx, cy, w, h, a], k) => {
      if (k < 3) return;
      const c = Math.cos(a),
        s = Math.sin(a);
      ctx.beginPath();
      [
        [-w / 2, -h / 2],
        [w / 2, -h / 2],
        [w / 2, h / 2],
        [-w / 2, h / 2],
      ].forEach(([x, y], q) => {
        const X = ox + (cx + x * c - y * s) * sc,
          Y = oy + (cy + x * s + y * c) * sc;
        q ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
      });
      ctx.closePath();
      ctx.stroke();
    });
    ctx.fillStyle = CYAN;
    for (const [cx, cy, cr] of rec.shapes.circles) {
      ctx.beginPath();
      ctx.arc(ox + cx * sc, oy + cy * sc, Math.max(1, cr * sc * 0.55), 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 1.2;
    rec.shapes.bars.forEach(([cx, cy, w]) => {
      ctx.beginPath();
      ctx.moveTo(ox + (cx - w / 2) * sc, oy + cy * sc);
      ctx.lineTo(ox + (cx + w / 2) * sc, oy + cy * sc);
      ctx.stroke();
    });
    ctx.fillStyle = '#facc15';
    ctx.fillRect(ox, oy + rec.finishY * sc - 1, mw, 2);
    // 지금 메인 화면이 보는 구역 (줌아웃으로 지도보다 넓어져도 패널 밖으로 나가지 않게 자른다)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, MM_W, VIEW_H);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(ox + cam.x * sc, oy + cam.y * sc, vw * sc, vh * sc);
    ctx.restore();
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.arc(ox + px[i] * sc, oy + py[i] * sc, 2.6, 0, TAU);
      ctx.fillStyle = colorOf(i, n);
      ctx.fill();
    }
  }

  // ---------- 오른쪽 위 실시간 순위 + 도착 수 ----------
  function drawRanking(ctx, f, order) {
    const done = order.filter((i) => finishFrame[i] <= f).length;
    ctx.textAlign = 'right';
    ctx.lineJoin = 'round';
    ctx.font = `800 20px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.fillText(`${done} / ${n}`, VIEW_W - 12, 28);
    const rows = Math.min(n, 8);
    ctx.font = `800 17px ${FONT}`;
    order.slice(0, rows).forEach((i, k) => {
      const y = 58 + k * 25,
        c = colorOf(i, n);
      const txt = `${label(i, 6)} #${k + 1}`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,.95)';
      ctx.strokeText(txt, VIEW_W - 12, y);
      if (glow) setGlow(ctx, c, 10);
      ctx.fillStyle = c;
      ctx.fillText(txt, VIEW_W - 12, y);
      noGlow(ctx);
    });
  }

  function draw(ctx, f, opts = {}) {
    const { px, py } = posAt(f);
    const order = rankList(f, py);

    // 카메라: 선두를 화면 아래쪽(72%)에 두고 그 위로 무리가 보이게 한다.
    // 선두와 상위 60% 구슬 사이가 벌어지면 자동으로 멀어져서(줌아웃) 무리가 한 화면에 들어오게 한다.
    const lead = order.slice(0, Math.min(4, n));
    const fx = lead.reduce((s, i) => s + px[i], 0) / lead.length;
    const leaderY = py[order[0]];
    const kth = order[Math.min(n - 1, Math.max(0, Math.ceil(n * 0.6) - 1))];
    const spread = Math.max(0, leaderY - py[kth]);
    const S0 = MV_W / SEE_W;
    const zTarget =
      (opts.zoom || 1) * clamp(VIEW_H / ((spread + 380) * S0), 0.55, 1.1);
    cam.z += (zTarget - cam.z) * (cam.init ? 0.04 : 1);
    const S = S0 * cam.z;
    const vw = MV_W / S,
      vh = VIEW_H / S;
    const tx =
      vw >= rec.W ? (rec.W - vw) / 2 : clamp(fx - vw / 2, 0, rec.W - vw);
    // 결승선은 항상 화면 안에 남겨서 결승선을 넘는 순간이 보이게 한다
    const ty = clamp(
      Math.min(leaderY - vh * 0.72, rec.finishY - vh * 0.55),
      -40,
      rec.H - vh
    );
    if (!cam.init) {
      cam.x = tx;
      cam.y = ty;
      cam.init = true;
    } else {
      cam.x += (tx - cam.x) * 0.1;
      cam.y += (ty - cam.y) * 0.1;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.save();
    ctx.beginPath();
    ctx.rect(MV_X, 0, MV_W, VIEW_H);
    ctx.clip();
    ctx.setTransform(S, 0, 0, S, MV_X - cam.x * S, -cam.y * S);
    drawWorld(ctx, f, px, py, order, S, vw, vh);
    ctx.restore();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // 화면 밖으로 나간 상위 3명은 가장자리에 화살표로 알려준다
    order.slice(0, 3).forEach((i) => {
      const sx = MV_X + (px[i] - cam.x) * S,
        sy = (py[i] - cam.y) * S;
      if (sy < 20 || sy > VIEW_H - 20) return;
      const left = sx < MV_X + 6,
        right = sx > VIEW_W - 6;
      if (!left && !right) return;
      const ax = left ? MV_X + 10 : VIEW_W - 10,
        dir = left ? -1 : 1;
      ctx.fillStyle = colorOf(i, n);
      ctx.beginPath();
      ctx.moveTo(ax + dir * 8, sy);
      ctx.lineTo(ax - dir * 4, sy - 8);
      ctx.lineTo(ax - dir * 4, sy + 8);
      ctx.closePath();
      ctx.fill();
    });
    drawMinimap(ctx, py, px, vw, vh);
    drawRanking(ctx, f, order);

    if (opts.overlay) {
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(MV_X, 0, MV_W, VIEW_H);
      const cx = MV_X + MV_W / 2;
      ctx.textAlign = 'center';
      ctx.lineJoin = 'round';
      ctx.font = `900 ${opts.overlay.size || 120}px ${FONT}`;
      ctx.lineWidth = 10;
      ctx.strokeStyle = 'rgba(0,0,0,.95)';
      ctx.strokeText(opts.overlay.text, cx, VIEW_H / 2);
      setGlow(ctx, '#facc15', 24);
      ctx.fillStyle = '#facc15';
      ctx.fillText(opts.overlay.text, cx, VIEW_H / 2);
      noGlow(ctx);
      if (opts.overlay.sub) {
        ctx.font = `800 26px ${FONT}`;
        ctx.lineWidth = 6;
        ctx.strokeStyle = 'rgba(0,0,0,.95)';
        ctx.strokeText(opts.overlay.sub, cx, VIEW_H / 2 + 52);
        ctx.fillStyle = '#fff';
        ctx.fillText(opts.overlay.sub, cx, VIEW_H / 2 + 52);
      }
    }
    return { order, py, px };
  }

  return { draw, finishFrame, orderIdx, at, n, F };
}
