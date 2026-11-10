# 캐릭터 시트 가공: art/<이름>_sheet.webp (초록 배경, 3줄 x 6칸: 앞 / 뒤 / 옆 걷기) →
#   public/sprites/<이름>.png (칸 크기 통일, 발밑 기준 정렬, 배경 투명) + public/sheets.js (칸 정보, 총구 위치)
# 적은 하루·레이 시트의 색을 바꿔서 만든다 (VARIANTS).
# 사용법 (프로젝트 폴더에서): python tools/sheets.py     (필요: pip install pillow numpy)
import os
import json
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, 'art')
OUT = os.path.join(ROOT, 'public', 'sprites')
SCALE = 0.5          # 원본을 절반으로 (게임 화면에서 약 100픽셀 키)
ROW_NAMES = ['front', 'back', 'side']

# 원본마다 쓸 프레임과 손볼 것
SOURCES = {
    'haru': {
        # 뒷모습 1~2번째 칸은 리본이 빠져 있어 3번째 칸의 머리를 옮겨 붙임, 옆모습 6번째 칸은 ✦ 표시라 뺌
        'frames': {'front': [0, 1, 2, 3, 4, 5], 'back': [0, 1, 2, 3, 4, 5], 'side': [0, 1, 2, 3, 4]},
        'head_fix': {'back': (2, [0, 1])},
    },
    'rei': {
        'frames': {'front': [0, 1, 2, 3, 4, 5], 'back': [0, 1, 2, 3, 4, 5], 'side': [0, 1, 2, 3, 4]},
        'head_fix': {'back': (1, [0, 3])},
    },
    'boss': {
        # 뒷모습 2·4번째 칸은 망토가 빠져 있어서 뺌
        'frames': {'front': [0, 1, 2, 3, 4, 5], 'back': [0, 2, 4, 5], 'side': [0, 1, 2, 3, 4]},
        'head_fix': {},
    },
}


def runs(mask, min_len=8):
    out, s = [], None
    for i, v in enumerate(mask):
        if v and s is None:
            s = i
        if not v and s is not None:
            out.append((s, i - 1))
            s = None
    if s is not None:
        out.append((s, len(mask) - 1))
    return [r for r in out if r[1] - r[0] > min_len]


def cut_frames(path):
    im = Image.open(path).convert('RGB')
    a = np.asarray(im).astype(np.int32)
    H, W, _ = a.shape
    bg = np.median(np.array([a[3, 3], a[3, W - 4], a[H - 4, 3], a[H - 4, W - 4], a[H // 2, 3]]), 0)
    d = np.abs(a - bg).sum(2)
    # 초록 배경 판정: 배경색과 가깝거나, 초록이 유난히 센 번진 테두리
    g_dom = (a[..., 1] - np.maximum(a[..., 0], a[..., 2]))
    fg = (d > 70) & ~((g_dom > 35) & (d < 160))
    rows = []
    for (y0, y1) in runs(fg.any(1)):
        band = []
        for (x0, x1) in runs(fg[y0:y1 + 1].any(0)):
            sub = fg[y0:y1 + 1, x0:x1 + 1]
            rgba = np.dstack([a[y0:y1 + 1, x0:x1 + 1], np.where(sub, 255, 0)]).astype(np.uint8)
            band.append(Image.fromarray(rgba, 'RGBA'))
        rows.append(band)
    return rows


def clean(img):
    # 작은 부스러기 제거 + 반으로 줄이기 (알파는 딱 끊기게)
    a = np.asarray(img).copy()
    al = a[..., 3] > 0
    # 이웃이 거의 없는 외딴 점 제거
    nb = sum(np.roll(np.roll(al, dy, 0), dx, 1) for dy in (-1, 0, 1) for dx in (-1, 0, 1)) - al
    a[..., 3] = np.where(al & (nb >= 2), 255, 0)
    im = Image.fromarray(a, 'RGBA')
    w, h = im.size
    # 알파를 먼저 곱한 상태로 줄여서 테두리에 초록이 섞이지 않게
    pre = np.asarray(im).astype(np.float32)
    pre[..., :3] *= pre[..., 3:4] / 255.0
    small = Image.fromarray(pre.clip(0, 255).astype(np.uint8), 'RGBA').resize((max(1, round(w * SCALE)), max(1, round(h * SCALE))), Image.LANCZOS)
    s = np.asarray(small).astype(np.float32)
    alpha = s[..., 3:4]
    rgb = np.where(alpha > 0, s[..., :3] * 255.0 / np.maximum(alpha, 1), 0)
    out = np.concatenate([rgb, np.where(alpha >= 110, 255, 0)], -1).clip(0, 255).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def anchor_of(img):
    # 발밑 가운데: 맨 아래 줄 y, 머리(위쪽 28%) 가운데 x
    a = np.asarray(img)[..., 3] > 0
    ys, xs = np.nonzero(a)
    top, bot = ys.min(), ys.max()
    head = a[top: top + int((bot - top) * 0.28)]
    hx = np.nonzero(head)[1].mean()
    return float(hx), int(bot), int(top)


def head_fix(frames, src, dsts):
    # 좋은 칸의 머리 부분을 리본이 빠진 칸에 옮겨 붙임 (머리 꼭대기·가운데 기준)
    sx, sb, st = anchor_of(frames[src])
    s = np.asarray(frames[src]).copy()
    hh = int((sb - st) * 0.40)
    for di in dsts:
        dx, db, dt = anchor_of(frames[di])
        d = np.asarray(frames[di]).copy()
        offx, offy = int(round(dx - sx)), dt - st
        d[dt: dt + hh] = 0
        for y in range(st, st + hh):
            for x in range(s.shape[1]):
                if s[y, x, 3] == 0:
                    continue
                ty, tx = y + offy, x + offx
                if 0 <= ty < d.shape[0] and 0 <= tx < d.shape[1]:
                    d[ty, tx] = s[y, x]
        frames[di] = Image.fromarray(d, 'RGBA')


def muzzle_of(img, row):
    # 그림에 그려진 총의 끝: 앞/옆은 오른쪽 끝, 뒤는 왼쪽 끝 (몸통 높이 띠에서)
    a = np.asarray(img)[..., 3] > 0
    ys, xs = np.nonzero(a)
    top, bot = ys.min(), ys.max()
    band = a[top + int((bot - top) * 0.32): top + int((bot - top) * 0.7)]
    cols = np.nonzero(band.any(0))[0]
    x = cols.max() if row != 'back' else cols.min()
    col = band[:, x]
    y = np.nonzero(col)[0].mean() + top + int((bot - top) * 0.32)
    return float(x), float(y)


# ───────────────────────── 색 바꾸기 (적) ─────────────────────────
def rgb_to_hsv(a):
    r, g, b = a[..., 0] / 255.0, a[..., 1] / 255.0, a[..., 2] / 255.0
    mx, mn = np.maximum(np.maximum(r, g), b), np.minimum(np.minimum(r, g), b)
    d = mx - mn
    m = d > 1e-6
    sd = np.where(m, d, 1)
    rc, gc, bc = (mx - r) / sd, (mx - g) / sd, (mx - b) / sd
    h = np.where(r == mx, bc - gc, np.where(g == mx, 2.0 + rc - bc, 4.0 + gc - rc))
    h = np.where(m, (h / 6.0) % 1.0, 0)
    s = np.where(mx > 1e-6, d / np.where(mx > 1e-6, mx, 1), 0)
    return h, s, mx


def hsv_to_rgb(h, s, v):
    i = np.floor(h * 6).astype(int) % 6
    f = h * 6 - np.floor(h * 6)
    p, q, t = v * (1 - s), v * (1 - s * f), v * (1 - s * (1 - f))
    r = np.choose(i, [v, q, p, p, t, v])
    g = np.choose(i, [t, v, v, q, p, p])
    b = np.choose(i, [p, p, t, v, v, q])
    return np.stack([r, g, b], -1)


def recolor(img, rules, head_frac=None):
    a = np.asarray(img).astype(np.float64)
    h, s, v = rgb_to_hsv(a)
    alpha = a[..., 3] > 0
    H = a.shape[0]
    ys = np.nonzero(alpha)[0]
    top, bot = (ys.min(), ys.max()) if len(ys) else (0, H)
    yy = (np.arange(H)[:, None] - top) / max(1, bot - top) * np.ones_like(h)
    for r in rules:
        h0, h1 = r.get('hue', (0, 1))
        hm = (h >= h0) & (h <= h1) if h0 <= h1 else (h >= h0) | (h <= h1)
        m = alpha & hm & (s >= r.get('smin', 0)) & (s <= r.get('smax', 1)) & (v >= r.get('vmin', 0)) & (v <= r.get('vmax', 1))
        if 'ymax' in r:
            m &= yy <= r['ymax']
        if 'to_hue' in r:
            h = np.where(m, r['to_hue'], h)
        if 'sat' in r:
            s = np.where(m, np.clip(s * r['sat'] + r.get('sat_add', 0), 0, 1), s)
        if 'val' in r:
            v = np.where(m, np.clip(v * r['val'] + r.get('val_add', 0), 0, 1), v)
    rgb = hsv_to_rgb(h, s, v) * 255
    out = np.concatenate([rgb, a[..., 3:4]], -1).clip(0, 255).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


NAVY = (0.55, 0.72)
GREEN = (0.17, 0.47)
BROWN = (0.0, 0.12)
VARIANTS = {
    # 견습 병사: 붉은 세일러복 (리본도 붉게)
    'e_trainee': ('haru', [{'hue': NAVY, 'smin': 0.2, 'to_hue': 0.985, 'sat': 1.05, 'val': 1.25}]),
    # 순찰 경비병: 회색 군복, 갈색 머리
    'e_guard': ('rei', [
        {'hue': GREEN, 'smin': 0.22, 'vmin': 0.12, 'sat': 0.12, 'val': 1.05},
        {'smax': 0.14, 'vmin': 0.5, 'ymax': 0.5, 'to_hue': 0.07, 'sat': 0, 'sat_add': 0.45, 'val': 0.62},
    ]),
    # 졸린 저격수: 검은 세일러복, 은발
    'e_sniper': ('haru', [
        {'hue': NAVY, 'smin': 0.2, 'sat': 0.15, 'val': 0.7},
        {'hue': BROWN, 'smin': 0.3, 'vmax': 0.72, 'ymax': 0.55, 'sat': 0.08, 'val': 1.75},
    ]),
    # 겁쟁이 보급병: 하얀 군복, 분홍 머리
    'e_supply': ('rei', [
        {'smax': 0.14, 'vmin': 0.5, 'ymax': 0.5, 'to_hue': 0.93, 'sat': 0, 'sat_add': 0.38},   # 머리 먼저 (하얀 옷이 분홍이 되지 않게)
        {'hue': GREEN, 'smin': 0.22, 'vmin': 0.2, 'sat': 0.1, 'val': 2.1, 'val_add': 0.1},
    ]),
}


def build(name, cfg):
    rows = cut_frames(os.path.join(ART, f'{name}_sheet.webp'))
    out_rows = {}
    for ri, rn in enumerate(ROW_NAMES):
        frames = [clean(f) for f in rows[ri]]
        if rn in cfg['head_fix']:
            src, dsts = cfg['head_fix'][rn]
            head_fix(frames, src, dsts)
        out_rows[rn] = [frames[i] for i in cfg['frames'][rn]]
    return out_rows


def pack(name, rows):
    # 모든 칸을 같은 크기로: 발밑 가운데가 칸의 (가운데, 아래)
    infos = {rn: [anchor_of(f) for f in fs] for rn, fs in rows.items()}
    left = max(ax for rn in rows for (ax, ab, at) in infos[rn])
    right = max(f.width - ax for rn in rows for f, (ax, ab, at) in zip(rows[rn], infos[rn]))
    up = max(ab for rn in rows for (ax, ab, at) in infos[rn])
    half = int(np.ceil(max(left, right))) + 2
    cw, ch = half * 2, up + 3
    cols = max(len(fs) for fs in rows.values())
    sheet = Image.new('RGBA', (cw * cols, ch * len(ROW_NAMES)), (0, 0, 0, 0))
    meta = {'cw': cw, 'ch': ch, 'cols': cols, 'rows': {}, 'muzzle': {}, 'height': 0}
    heights = []
    for ri, rn in enumerate(ROW_NAMES):
        mz = []
        for ci, (f, (ax, ab, at)) in enumerate(zip(rows[rn], infos[rn])):
            ox, oy = int(round(half - ax)), (ch - 2) - ab
            sheet.paste(f, (ci * cw + ox, ri * ch + oy), f)
            mx, my = muzzle_of(f, rn)
            mz.append((mx + ox, my + oy))
            heights.append(ab - at)
        meta['rows'][rn] = {'row': ri, 'n': len(rows[rn])}
        # 총구: 칸 기준 (발밑 가운데에서의 오프셋, 위가 +)
        meta['muzzle'][rn] = [round(float(np.mean([m[0] for m in mz])) - half, 1), round((ch - 2) - float(np.mean([m[1] for m in mz])), 1)]
    meta['height'] = int(np.median(heights))
    sheet.save(os.path.join(OUT, f'{name}.png'))
    # 얼굴 사진: 앞모습 첫 칸 위쪽
    f0 = rows['front'][0]
    ax, ab, at = infos['front'][0]
    size = int((ab - at) * 0.5)
    x0 = int(ax - size / 2)
    bust = f0.crop((x0, at - 2, x0 + size, at - 2 + size)).resize((96, 96), Image.LANCZOS)
    bust.save(os.path.join(OUT, f'{name}_bust.png'))
    return meta


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    built = {n: build(n, c) for n, c in SOURCES.items()}
    metas = {n: pack(n, rows) for n, rows in built.items()}
    for vn, (src, rules) in VARIANTS.items():
        rows = {rn: [recolor(f, rules) for f in fs] for rn, fs in built[src].items()}
        metas[vn] = pack(vn, rows)
    with open(os.path.join(ROOT, 'public', 'sheets.js'), 'w', encoding='utf-8') as fp:
        fp.write('// tools/sheets.py가 만든 파일 (직접 고치지 마세요)\n')
        fp.write('// cw/ch = 한 칸 크기, rows = 방향별 줄 번호와 프레임 수, muzzle = 발밑 기준 총구 위치(위가 +), height = 캐릭터 키(픽셀)\n')
        fp.write('export const SHEETS = ' + json.dumps(metas, ensure_ascii=False, indent=1) + ';\n')
    print(json.dumps({k: (v['cw'], v['ch'], v['height'], v['muzzle']) for k, v in metas.items()}, ensure_ascii=False))
