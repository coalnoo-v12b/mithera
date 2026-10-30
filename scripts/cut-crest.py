"""midura-logo.png 를 조각별 고해상도 이미지로 잘라 낸다.
사용: python scripts/cut-crest.py client/public/midura-logo.png client/public/crest
좌표는 원본(199x256) 픽셀 기준.
"""
import math
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops

SRC, OUT = sys.argv[1], sys.argv[2]
BLUR = float(sys.argv[3]) if len(sys.argv) > 3 else 2.2
K = 3  # 배율
SS = 4  # 단면 안티에일리어싱용 슈퍼샘플링

MID = 99.5
# MIDURA 글자 띠 아래 곡선 (왼쪽 → 오른쪽). 띠 아래 칸이 시작하는 높이를 원본에서 재어
# 맞춘 포물선이다 (가운데 32.5, 양 끝 약 52)
BAND = [(MID + d, 32.5 + 0.00195 * d * d) for d in (MID * i / 20 for i in range(-20, 21))]
BAND_L, BAND_R = BAND[:21], BAND[20:]
# 가운데 방패: 위 80, 좌우 60~139, 135 아래로 둥글게 172 까지
SL, SR, ST, SB, SY = 60, 139, 80, 172, 135
ARC_L = [(MID - (MID - SL) * math.cos(t), SY + (SB - SY) * math.sin(t))
         for t in (i * math.pi / 2 / 24 for i in range(25))]  # (60,135) → (99.5,172)
ARC_R = [(2 * MID - x, y) for x, y in ARC_L]  # (139,135) → (99.5,172)
Q = 133  # 위/아래 칸 경계

PIECES = {
    'head': [(0, 0), (199, 0)] + BAND[::-1],
    'tl': BAND_L + [(MID, ST), (SL, ST), (SL, Q), (0, Q)],
    'tr': BAND_R + [(199, Q), (SR, Q), (SR, ST), (MID, ST)],
    'bl': [(0, Q), (SL, Q)] + ARC_L + [(MID, 256), (0, 256)],
    'br': ARC_R[::-1] + [(SR, Q), (199, Q), (199, 256), (MID, 256)],
    'shield': [(SL, ST), (SR, ST)] + ARC_R + ARC_L[::-1],
}

src = Image.open(SRC).convert('RGBA')
W, H = src.width * K, src.height * K
px = np.asarray(src).astype(np.float32)
rgb_src, a_src = px[..., :3], px[..., 3]

# 1) 원본 가장자리에 붙은 회색 톱니(배경 지운 흔적)를 찾는다:
#    바깥 3px 안쪽 띠에서 거의 무채색인 픽셀 (금색 하이라이트는 남긴다)
#    (캔버스 밖도 투명으로 보도록 3px 여백을 두고 계산)
opaque = np.pad(a_src > 0, 3).astype(np.uint8) * 255
inside = np.asarray(Image.fromarray(opaque).filter(ImageFilter.MinFilter(7)))[3:-3, 3:-3] > 0
mx, mn = rgb_src.max(-1), rgb_src.min(-1)
grayish = ((mx - mn) / (mx + 1) < 0.1) & (mx > 60)
valid = (a_src > 160) & ~((a_src > 0) & ~inside & grayish)

# 2) 바깥 윤곽을 새로 만든다: 깨끗한 픽셀로 모양을 잡고 구멍을 메운 뒤,
#    크게 키워 흐리고 다시 잘라 톱니 없는 곡선으로 만든다.
#    캔버스 끝에 닿은 위·아래가 평평하게 튀어나오지 않게 M px 투명 여백을 두고 흐린다
M = 4
shape = Image.fromarray(valid.astype(np.uint8) * 255)
pad = Image.new('L', (shape.width + 2 * M, shape.height + 2 * M), 0)
pad.paste(shape, (M, M))
ImageDraw.floodfill(pad, (0, 0), 128)
pad = pad.point(lambda v: 0 if v == 128 else 255)
F = K * SS
pad = pad.resize((pad.width * F, pad.height * F), Image.BILINEAR).filter(ImageFilter.GaussianBlur(2.0 * F))
pad = pad.point(lambda v: 255 if v > 150 else 0)
shape = pad.crop((M * F, M * F, M * F + W * SS, M * F + H * SS))
alpha = shape.resize((W, H), Image.LANCZOS)

# 3) 회색 테가 있던 자리의 색은 안쪽 금색으로 채운다
ok = valid.copy()
col = np.where(ok[..., None], rgb_src, 0)
for _ in range(6):
    acc = np.zeros_like(col)
    cnt = np.zeros(ok.shape, np.float32)
    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
        acc += np.roll(col * ok[..., None], (dy, dx), (0, 1))
        cnt += np.roll(ok, (dy, dx), (0, 1))
    fill = ~ok & (cnt > 0)
    col[fill] = acc[fill] / cnt[fill][:, None]
    ok = ok | fill
rgb = Image.fromarray(col.clip(0, 255).astype(np.uint8)).resize((W, H), Image.LANCZOS)

# 3) 표면 결 다듬기: 잔 알갱이는 흐리고 큰 선은 다시 세운다
smooth = rgb.filter(ImageFilter.GaussianBlur(BLUR))
smooth = smooth.filter(ImageFilter.UnsharpMask(radius=4, percent=70, threshold=3))

full = smooth.copy()
full.putalpha(alpha)
full.save(f'{OUT}/full.webp', 'WEBP', quality=88, method=6)


def poly_mask(pts):
    m = Image.new('L', (W * SS, H * SS), 0)
    ImageDraw.Draw(m).polygon([(x * K * SS, y * K * SS) for x, y in pts], fill=255)
    return m.resize((W, H), Image.LANCZOS)


gold = Image.new('RGB', (W, H), (232, 196, 120))
for key, pts in PIECES.items():
    cut = ImageChops.multiply(poly_mask(pts), alpha)
    # 4) 잘린 단면에 얇은 금속 테두리
    rim = ImageChops.subtract(cut, cut.filter(ImageFilter.MinFilter(7)))
    piece = Image.composite(gold, smooth, rim.point(lambda v: int(v * 0.5)))
    piece.putalpha(cut)
    piece.save(f'{OUT}/{key}.webp', 'WEBP', quality=88, method=6)
    print(key, cut.getbbox())
