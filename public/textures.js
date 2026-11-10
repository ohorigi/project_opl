// 도트 텍스처: 모든 표면 무늬를 코드로 한 픽셀씩 그린다 (1m = 16픽셀).
// 같은 시드를 써서 모든 플레이어 화면에 똑같은 맵이 그려진다.
import * as THREE from 'three';

export const PPU = 16; // pixels per unit

// 시드 고정 난수 (mulberry32)
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shade(c, f) {
  const [r, g, b] = hex(c);
  const k = (v) => Math.max(0, Math.min(255, Math.round(f >= 1 ? v + (255 - v) * (f - 1) : v * f)));
  return `rgb(${k(r)},${k(g)},${k(b)})`;
}

// 캔버스에 도트를 찍는 작은 도구
function painter(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return {
    c, g, w, h,
    px(x, y, col) { g.fillStyle = col; g.fillRect(x | 0, y | 0, 1, 1); },
    rect(x, y, rw, rh, col) { g.fillStyle = col; g.fillRect(x | 0, y | 0, rw | 0, rh | 0); },
  };
}

function toTexture(p, repeatUnits = null) {
  const t = new THREE.CanvasTexture(p.c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapNearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeatUnits) t.repeat.set(1 / repeatUnits[0], 1 / repeatUnits[1]);
  return t;
}

/* ───────────────────────── 바닥 (맵 전체 한 장) ───────────────────────── */
// G = shared/common.js (상자, 건물, 물 위치를 보고 그림)
export function makeGround(G) {
  const mapW = G.MAP_W, mapH = G.MAP_H;
  const W = mapW * PPU, H = mapH * PPU;
  const p = painter(W, H);
  const R = rng(1234);
  const STONE = ['#8d877c', '#958e82', '#857f74', '#9a9387'];
  const GRASS = ['#4f7a3a', '#567f3d', '#4a7236'];

  // 포장석 (2m x 2m 판석)
  const T = 2 * PPU;
  for (let ty = 0; ty < H; ty += T) {
    for (let tx = 0; tx < W; tx += T) {
      const base = STONE[Math.floor(R() * STONE.length)];
      p.rect(tx, ty, T, T, base);
      p.rect(tx + 1, ty + 1, T - 2, 1, shade(base, 1.12));       // 윗면 밝은 모서리
      p.rect(tx + 1, ty + 1, 1, T - 2, shade(base, 1.08));
      p.rect(tx + 1, ty + T - 2, T - 2, 1, shade(base, 0.86));   // 아랫면 어두운 모서리
      p.rect(tx + T - 2, ty + 1, 1, T - 2, shade(base, 0.9));
      p.rect(tx, ty, T, 1, '#5e584f');                          // 줄눈
      p.rect(tx, ty, 1, T, '#5e584f');
      for (let i = 0; i < 7; i++) p.px(tx + 2 + R() * (T - 4), ty + 2 + R() * (T - 4), shade(base, R() < 0.5 ? 0.85 : 1.1));
      if (R() < 0.18) { // 금
        let cx = tx + 4 + R() * (T - 8), cy = ty + 4 + R() * (T - 8);
        for (let i = 0; i < 6; i++) { p.px(cx, cy, shade(base, 0.68)); cx += R() < 0.5 ? 1 : 0; cy += R() < 0.5 ? 1 : -1; }
      }
    }
  }

  // 잔디: 맵 가장자리 + 들판 몇 곳 (노이즈 모양)
  const fields = [[14, 18, 7], [66, 62, 7], [4, 52, 5], [76, 28, 5], [50, 4, 4], [30, 76, 4], [70, 14, 4], [10, 66, 4], [24, 4, 3], [56, 76, 3]];
  const grassAt = (x, y) => {
    const ux = x / PPU, uy = y / PPU;
    const edge = Math.min(ux, uy, mapW - ux, mapH - uy);
    const n = Math.sin(ux * 0.9) * Math.cos(uy * 0.7) + Math.sin((ux + uy) * 0.35) * 0.8;
    if (edge < 2.4 + Math.sin(ux * 1.7 + uy) * 0.5) return true;
    for (const [fx, fy, fr] of fields) if (Math.hypot(ux - fx, uy - fy) < fr + n * 0.8) return true;
    return false;
  };
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      if (!grassAt(x, y)) continue;
      const v = R();
      p.rect(x, y, 2, 2, GRASS[v < 0.4 ? 0 : v < 0.8 ? 1 : 2]);
      if (R() < 0.2) p.px(x + (R() * 2 | 0), y, '#6f9a4d');
      if (R() < 0.05) p.px(x, y + 1, '#3b5f2c');
      if (R() < 0.006) { p.px(x, y, '#e8d86a'); p.px(x + 1, y, '#f2f0e6'); } // 들꽃
    }
  }

  // 물웅덩이와 맨홀
  for (const [ux, uy, rr] of [[24, 12, 1.1], [56, 68, 1.1], [46, 31, 0.8], [34, 49, 0.8], [64, 53, 0.9], [16, 27, 0.9]]) {
    for (let y = -rr * PPU; y <= rr * PPU; y++) {
      for (let x = -rr * PPU * 1.4; x <= rr * PPU * 1.4; x++) {
        const d = Math.hypot(x / 1.4, y) / (rr * PPU);
        if (d > 1) continue;
        p.px(ux * PPU + x, uy * PPU + y, d > 0.85 ? '#56606a' : (x + y * 2) % 9 === 0 && d < 0.6 ? '#9fb4c4' : '#4a5866');
      }
    }
  }
  for (const [ux, uy] of [[40, 31], [40, 49], [27, 44.5], [53, 35.5]]) {
    const cx = ux * PPU, cy = uy * PPU;
    for (let y = -8; y <= 8; y++) for (let x = -8; x <= 8; x++) {
      const d = Math.hypot(x, y);
      if (d <= 8) p.px(cx + x, cy + y, d > 7 ? '#3f3c38' : (Math.abs(x) + Math.abs(y)) % 4 === 0 ? '#5a5650' : '#6e6a63');
    }
  }

  // 건물 안 바닥: 나무 마루 / 체크 타일 / 회색 타일
  for (const b of G.BUILDINGS) {
    const x0 = Math.round(b.x0 * PPU), y0 = Math.round(b.y0 * PPU), x1 = Math.round(b.x1 * PPU), y1 = Math.round(b.y1 * PPU);
    if (b.floor === 'wood') {
      for (let y = y0; y < y1; y += 4) {
        let x = x0 - Math.floor(R() * 24);
        while (x < x1) {
          const len = 20 + Math.floor(R() * 28);
          const c = ['#8a5a36', '#93633c', '#7f5231', '#9a6a41'][Math.floor(R() * 4)];
          const a = Math.max(x, x0), e = Math.min(x + len, x1);
          if (e > a) {
            p.rect(a, y, e - a, 4, c);
            p.rect(a, y, e - a, 1, shade(c, 1.12));
            p.rect(a, y + 3, e - a, 1, shade(c, 0.78));
            if (x >= x0) p.rect(x, y, 1, 4, '#4f3420');
            if (R() < 0.5) p.px(a + R() * (e - a), y + 2, shade(c, 0.7));
          }
          x += len;
        }
      }
    } else {
      const ts = b.floor === 'tile' ? 16 : 8;
      for (let y = y0; y < y1; y += ts) for (let x = x0; x < x1; x += ts) {
        const odd = ((x - x0) / ts + (y - y0) / ts) % 2;
        const c = b.floor === 'tile' ? (odd ? '#c9c2b2' : '#8e8a80') : (odd ? '#7d8790' : '#737c85');
        p.rect(x, y, ts, ts, c);
        p.rect(x, y, ts, 1, shade(c, 1.1));
        p.rect(x, y, 1, ts, shade(c, 1.06));
        p.rect(x, y + ts - 1, ts, 1, shade(c, 0.8));
        if (R() < 0.3) p.px(x + 2 + R() * (ts - 4), y + 2 + R() * (ts - 4), shade(c, 0.88));
      }
    }
    // 벽 밑 그늘
    p.g.fillStyle = 'rgba(20,14,10,0.3)';
    const ix0 = b.ix0 * PPU, iy0 = b.iy0 * PPU, iw = (b.ix1 - b.ix0) * PPU, ih = (b.iy1 - b.iy0) * PPU;
    p.g.fillRect(ix0, iy0, iw, 3); p.g.fillRect(ix0, iy0, 3, ih);
    p.g.fillRect(ix0, iy0 + ih - 2, iw, 2); p.g.fillRect(ix0 + iw - 2, iy0, 2, ih);
  }

  // 물가: 돌 테두리 + 어두운 물 바닥 (물 표면은 따로 움직이는 면으로 그림)
  for (const w of G.WATER) {
    const x0 = Math.round(w.x0 * PPU), y0 = Math.round(w.y0 * PPU), x1 = Math.round(w.x1 * PPU), y1 = Math.round(w.y1 * PPU);
    p.rect(x0 - 3, y0 - 3, x1 - x0 + 6, y1 - y0 + 6, '#6f6a62');
    for (let x = x0 - 3; x < x1 + 3; x += 6) { p.rect(x, y0 - 3, 1, 3, '#55514b'); p.rect(x + 3, y1, 1, 3, '#55514b'); }
    p.rect(x0 - 3, y0 - 3, x1 - x0 + 6, 1, '#9a948a');
    p.rect(x0, y0, x1 - x0, y1 - y0, '#2a4656');
  }

  // 물체 밑동 그림자 (바닥에 닿는 상자/벽 주변을 어둡게 해서 붙어 보이게)
  p.g.fillStyle = 'rgba(30,24,18,0.28)';
  for (const b of G.BOXES) {
    if (b.z0 > 0.01 || b.kind === 'bound' || b.kind === 'fence' || b.kind === 'stone' || b.kind === 'deck') continue;
    p.g.fillRect(b.x0 * PPU - 2, b.y0 * PPU - 2, (b.x1 - b.x0) * PPU + 4, (b.y1 - b.y0) * PPU + 4);
  }
  p.g.fillStyle = 'rgba(30,24,18,0.18)';
  for (const b of G.BOXES) {
    if (b.kind !== 'bridge' && b.kind !== 'plat') continue;
    p.g.fillRect(b.x0 * PPU, b.y0 * PPU, (b.x1 - b.x0) * PPU, (b.y1 - b.y0) * PPU);
  }

  const t = toTexture(p);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/* ───────────────────────── 반복 무늬 ───────────────────────── */
const cache = new Map();
export function tex(name) {
  if (cache.has(name)) return cache.get(name);
  const t = BUILDERS[name]();
  cache.set(name, t);
  return t;
}

const BUILDERS = {
  // 건물 바깥벽: 벽돌 + 아래 기초석 + 위 처마돌 (가로 3m x 높이 2.75m, 월드 좌표 UV)
  brick() {
    const p = painter(48, 44);
    const R = rng(7);
    const B = ['#9a5a48', '#a2614d', '#8f5343', '#a8684f'];
    p.rect(0, 0, 48, 44, '#6b3f34');
    for (let row = 0; row < 11; row++) {
      const y = row * 4, off = row % 2 ? 4 : 0;
      for (let x = -off; x < 48; x += 8) {
        const c = B[Math.floor(R() * B.length)];
        p.rect(x + 1, y + 1, 7, 3, c);
        p.rect(x + 1, y + 1, 7, 1, shade(c, 1.12));
        if (R() < 0.15) p.px(x + 2 + R() * 5, y + 2, shade(c, 0.8));
      }
    }
    p.rect(0, 38, 48, 6, '#6d6a66');                 // 기초석 (아래)
    p.rect(0, 38, 48, 1, '#8a8681');
    for (let x = 0; x < 48; x += 12) p.rect(x, 39, 1, 5, '#55524e');
    p.rect(0, 0, 48, 3, '#c9bfad');                  // 처마돌 (위)
    p.rect(0, 3, 48, 1, '#5a4b40');
    const t = toTexture(p, [3, 2.75]);
    t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  },
  // 건물 안쪽 벽: 크림색 회벽 + 아래 나무 징두리판
  plaster() {
    const p = painter(32, 44);
    const R = rng(71);
    p.rect(0, 0, 32, 44, '#d8cdb4');
    for (let i = 0; i < 60; i++) p.px(R() * 32, R() * 28, R() < 0.5 ? '#cfc3a9' : '#e2d8c2');
    p.rect(0, 28, 32, 16, '#7a5234');               // 징두리판
    for (let x = 0; x < 32; x += 8) { p.rect(x, 28, 1, 16, '#5c3c25'); p.rect(x + 1, 29, 1, 14, '#8c6240'); }
    p.rect(0, 27, 32, 1, '#5c3c25');
    p.rect(0, 26, 32, 1, '#efe6d2');
    p.rect(0, 0, 32, 2, '#bfb39a');
    const t = toTexture(p, [2, 2.75]);
    t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  },
  // 감시탑: 큰 돌 블록
  towerStone() {
    const p = painter(32, 32);
    const R = rng(73);
    p.rect(0, 0, 32, 32, '#5f5b55');
    for (let row = 0; row < 4; row++) {
      const off = row % 2 ? 8 : 0;
      for (let x = -off; x < 32; x += 16) {
        const c = ['#8a847a', '#7f7a70', '#958f84'][Math.floor(R() * 3)];
        p.rect(x + 1, row * 8 + 1, 15, 7, c);
        p.rect(x + 1, row * 8 + 1, 15, 1, shade(c, 1.15));
        p.rect(x + 1, row * 8 + 7, 15, 1, shade(c, 0.8));
        for (let i = 0; i < 4; i++) p.px(x + 2 + R() * 13, row * 8 + 2 + R() * 5, shade(c, R() < 0.5 ? 0.85 : 1.1));
      }
    }
    return toTexture(p, [2, 2]);
  },
  // 공중 발판: 철망 격자
  grating() {
    const p = painter(16, 16);
    p.rect(0, 0, 16, 16, '#2a2e35');
    for (let y = 0; y < 16; y += 4) for (let x = 0; x < 16; x += 4) {
      p.rect(x, y, 3, 1, '#6c7480'); p.rect(x, y, 1, 3, '#5a616c');
    }
    p.rect(0, 0, 16, 1, '#e0b84a');
    return toTexture(p, [1, 1]);
  },
  // 징검돌
  stepStone() {
    const p = painter(16, 16);
    const R = rng(79);
    p.rect(0, 0, 16, 16, '#7d7a72');
    for (let i = 0; i < 30; i++) p.px(R() * 16, R() * 16, R() < 0.5 ? '#6c6961' : '#8f8b82');
    p.rect(0, 0, 16, 1, '#a19c92');
    return toTexture(p, [1, 1]);
  },
  // 물 표면 (움직임은 client.js에서 텍스처를 밀어서)
  water() {
    const p = painter(32, 32);
    const R = rng(83);
    p.rect(0, 0, 32, 32, '#2f6a86');
    for (let i = 0; i < 40; i++) p.px(R() * 32, R() * 32, R() < 0.5 ? '#2a5f79' : '#377796');
    for (let i = 0; i < 9; i++) {
      const x = R() * 28 | 0, y = R() * 30 | 0, l = 2 + (R() * 4 | 0);
      p.rect(x, y, l, 1, '#7fc0dc');
      p.rect(x + 1, y + 1, l, 1, '#4d93b3');
    }
    return toTexture(p, [2, 2]);
  },
  // 탁자 윗면
  tableTop() {
    const p = painter(16, 16);
    for (let y = 0; y < 16; y += 4) {
      const c = ['#9a6a40', '#a37246', '#8f623b'][(y / 4) % 3];
      p.rect(0, y, 16, 4, c);
      p.rect(0, y, 16, 1, shade(c, 1.15));
    }
    return toTexture(p, [1, 1]);
  },
  // 옥상: 자갈 깔린 방수층 (2m)
  roof() {
    const p = painter(32, 32);
    const R = rng(11);
    p.rect(0, 0, 32, 32, '#5f6268');
    for (let i = 0; i < 150; i++) p.px(R() * 32, R() * 32, R() < 0.5 ? '#6f7279' : '#53565c');
    for (let i = 0; i < 12; i++) p.px(R() * 32, R() * 32, '#8a8d93');
    p.rect(0, 0, 32, 1, '#4f5257');
    p.rect(0, 0, 1, 32, '#4f5257');
    return toTexture(p, [2, 2]);
  },
  stoneCap() {
    const p = painter(16, 16);
    const R = rng(3);
    p.rect(0, 0, 16, 16, '#c7bdab');
    for (let i = 0; i < 18; i++) p.px(R() * 16, R() * 16, R() < 0.5 ? '#b3a996' : '#d6cdbc');
    p.rect(0, 0, 16, 1, '#e2dacb');
    p.rect(15, 0, 1, 16, '#a39985');
    return toTexture(p, [1, 1]);
  },
  // 콘크리트 벽 (2m 패널, 얼룩)
  concrete() {
    const p = painter(32, 32);
    const R = rng(5);
    p.rect(0, 0, 32, 32, '#7f838c');
    for (let i = 0; i < 70; i++) p.px(R() * 32, R() * 32, R() < 0.5 ? '#767a83' : '#8a8e97');
    p.rect(0, 0, 1, 32, '#5f636b');
    p.rect(1, 0, 1, 32, '#959aa3');
    for (let k = 0; k < 3; k++) { const x = 4 + R() * 24 | 0; const len = 4 + R() * 10 | 0; p.rect(x, 0, 1, len, '#6c7078'); p.rect(x + 1, 0, 1, len - 2, '#71757d'); }
    p.px(8, 20, '#4f525a'); p.px(24, 10, '#4f525a');
    return toTexture(p, [2, 2]);
  },
  concreteLight() {
    const p = painter(16, 16);
    const R = rng(9);
    p.rect(0, 0, 16, 16, '#aaa49a');
    for (let i = 0; i < 20; i++) p.px(R() * 16, R() * 16, R() < 0.5 ? '#9d978d' : '#b7b1a7');
    return toTexture(p, [1, 1]);
  },
  // 계단 윗면: 끝에 미끄럼 방지 줄
  stairTop() {
    const p = painter(16, 16);
    const R = rng(13);
    p.rect(0, 0, 16, 16, '#b8b2a7');
    for (let i = 0; i < 16; i++) p.px(R() * 16, R() * 16, '#a7a196');
    for (let x = 0; x < 16; x += 2) { p.px(x, 0, '#e0b84a'); p.px(x + 1, 0, '#3a3530'); }
    return toTexture(p, [1, 1]);
  },
  // 모래주머니 (1m)
  sandbag() {
    const p = painter(16, 16);
    const R = rng(17);
    p.rect(0, 0, 16, 16, '#7d6c4c');
    for (let row = 0; row < 4; row++) {
      const y = row * 4, off = row % 2 ? 4 : 0;
      for (let x = -off; x < 16; x += 8) {
        const c = ['#b8a27a', '#ad976f', '#c1ab83'][Math.floor(R() * 3)];
        p.rect(x + 1, y, 6, 3, c);
        p.rect(x + 1, y, 6, 1, shade(c, 1.12));
        p.px(x + 4, y + 1, shade(c, 0.8));
      }
    }
    return toTexture(p, [1, 1]);
  },
  // 다리 바닥: 가로 판자
  plank() {
    const p = painter(16, 16);
    const R = rng(19);
    for (let x = 0; x < 16; x += 4) {
      const c = ['#8a5a34', '#93613a', '#7f532f'][Math.floor(R() * 3)];
      p.rect(x, 0, 4, 16, c);
      p.rect(x, 0, 1, 16, '#5a3a22');
      p.rect(x + 1, 0, 1, 16, shade(c, 1.1));
      p.px(x + 2, 3, '#4a3020'); p.px(x + 2, 12, '#4a3020');
    }
    return toTexture(p, [1, 1]);
  },
  beam() {
    const p = painter(16, 16);
    p.rect(0, 0, 16, 16, '#5e4130');
    p.rect(0, 0, 16, 2, '#7a573f');
    p.rect(0, 14, 16, 2, '#46301f');
    for (let x = 2; x < 16; x += 6) p.px(x, 7, '#b0a090');
    return toTexture(p, [1, 1]);
  },
  metal() {
    const p = painter(8, 8);
    p.rect(0, 0, 8, 8, '#4a505b');
    p.rect(0, 0, 8, 1, '#6c7380');
    p.rect(0, 7, 8, 1, '#363b44');
    return toTexture(p, [0.5, 0.5]);
  },
  // 기둥: 아래쪽 경고 줄무늬 (2.6m 높이에 맞춤)
  pillar() {
    const p = painter(16, 42);
    const R = rng(23);
    p.rect(0, 0, 16, 42, '#8b8f97');
    for (let i = 0; i < 30; i++) p.px(R() * 16, R() * 34, R() < 0.5 ? '#7f838b' : '#979ba3');
    for (let y = 34; y < 42; y++) for (let x = 0; x < 16; x++) p.px(x, y, ((x + y) >> 2) % 2 ? '#2c2a26' : '#e3b740');
    p.rect(0, 33, 16, 1, '#5c5f66');
    const t = toTexture(p, [1, 2.6]);
    t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  },
  boundWall() {
    const p = painter(16, 16);
    p.rect(0, 0, 16, 16, '#3c414b');
    for (let row = 0; row < 4; row++) for (let x = (row % 2) * 4; x < 16; x += 8) p.rect(x, row * 4, 7, 3, '#474d58');
    p.rect(0, 0, 16, 1, '#5b6270');
    return toTexture(p, [1, 1]);
  },
  // 나무 상자 한 면 (면 전체에 늘려 붙임): 테두리 + 판자 + 대각 보강대 + 못
  crate() {
    const p = painter(24, 24);
    const R = rng(29);
    for (let y = 0; y < 24; y += 4) {
      const c = ['#b47a43', '#bd8349', '#a9723e'][Math.floor(R() * 3)];
      p.rect(0, y, 24, 4, c);
      p.rect(0, y, 24, 1, shade(c, 1.12));
      p.rect(0, y + 3, 24, 1, shade(c, 0.82));
      for (let i = 0; i < 3; i++) p.px(R() * 24, y + 1 + R() * 2, shade(c, 0.78));
    }
    for (let i = 0; i < 22; i++) { // 대각 보강대
      p.rect(i + 1, 22 - i - 1, 3, 2, '#8a5a30');
      p.px(i + 1, 22 - i - 1, '#a87040');
    }
    const F = '#7a4b27';
    p.rect(0, 0, 24, 3, F); p.rect(0, 21, 24, 3, F); p.rect(0, 0, 3, 24, F); p.rect(21, 0, 3, 24, F);
    p.rect(0, 0, 24, 1, '#9a6535'); p.rect(0, 0, 1, 24, '#9a6535');
    for (const [x, y] of [[1, 1], [22, 1], [1, 22], [22, 22]]) p.px(x, y, '#d6d2c8');
    return toTexture(p);
  },
  crateTop() {
    const p = painter(24, 24);
    const R = rng(31);
    for (let x = 0; x < 24; x += 4) {
      const c = ['#c08a50', '#c99356', '#b78148'][Math.floor(R() * 3)];
      p.rect(x, 0, 4, 24, c);
      p.rect(x, 0, 1, 24, shade(c, 1.12));
      p.rect(x + 3, 0, 1, 24, shade(c, 0.8));
    }
    const F = '#7a4b27';
    p.rect(0, 0, 24, 2, F); p.rect(0, 22, 24, 2, F); p.rect(0, 0, 2, 24, F); p.rect(22, 0, 2, 24, F);
    for (const [x, y] of [[1, 1], [22, 1], [1, 22], [22, 22], [11, 1], [11, 22]]) p.px(x, y, '#d6d2c8');
    return toTexture(p);
  },
  // 드럼통 옆면 (둘레 32 x 높이 20): 색별로 3종
  drumBlue() { return drumSide('#2f5d8a', 41); },
  drumRed() { return drumSide('#9b3a2c', 43, true); },
  drumOlive() { return drumSide('#5a6b34', 47); },
  drumTop() {
    const p = painter(16, 16);
    p.rect(0, 0, 16, 16, '#6f7680');
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d > 6.6) p.px(x, y, '#4c525b');
      else if (d > 5.6) p.px(x, y, '#9aa1ab');
    }
    p.rect(9, 4, 3, 3, '#2a2e34'); p.px(9, 4, '#8a9099');
    return toTexture(p);
  },
};

function drumSide(base, seed, hazard = false) {
  const p = painter(32, 20);
  const R = rng(seed);
  p.rect(0, 0, 32, 20, base);
  for (let i = 0; i < 40; i++) p.px(R() * 32, R() * 20, shade(base, R() < 0.5 ? 0.85 : 1.12));
  for (const y of [0, 19]) p.rect(0, y, 32, 1, shade(base, 0.6));
  for (const y of [6, 13]) { p.rect(0, y, 32, 1, shade(base, 1.3)); p.rect(0, y + 1, 32, 1, shade(base, 0.7)); }
  for (let i = 0; i < 10; i++) p.px(R() * 32, 15 + R() * 4, '#7a4a28'); // 녹
  if (hazard) {
    // 폭발물 표시: 흰 마름모 안의 불꽃
    for (let y = 0; y < 9; y++) {
      const w = 4 - Math.abs(y - 4);
      p.rect(6 - w, 6 + y, w * 2 + 1, 1, '#f2efe6');
    }
    p.rect(5, 9, 3, 3, '#e8632a'); p.px(6, 8, '#e8632a'); p.px(6, 10, '#ffd84a'); p.px(5, 8, '#e8632a');
    p.rect(20, 6, 9, 3, '#f2efe6'); p.rect(21, 7, 7, 1, '#9b3a2c');
  } else {
    // 경고 라벨
    p.rect(3, 8, 7, 5, '#e3c341');
    p.px(6, 9, '#222'); p.px(5, 10, '#222'); p.px(7, 10, '#222'); p.px(6, 11, '#222'); p.px(6, 10, '#222');
  }
  const t = toTexture(p);
  t.repeat.set(2, 1);
  return t;
}

// 박스 지오메트리의 UV를 월드 크기(m)로 바꿔서, 텍스처가 면 크기와 상관없이 같은 밀도로 반복되게 함
export function worldUVBox(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // +x, -x, +y, -y, +z, -z
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * dims[f][0], uv.getY(k) * dims[f][1]);
    }
  }
  return g;
}

// 상자 지오메트리의 UV를 월드 좌표(m)로 맞춤 → 여러 조각으로 나뉜 벽(창턱, 문틀 등)도 무늬가 끊기지 않고 이어짐
// 결과 지오메트리는 중심이 원점이므로 메시를 상자 중심에 놓으면 됨
export function worldBox(x0, y0, z0, x1, y1, z1) {
  const g = new THREE.BoxGeometry(x1 - x0, z1 - z0, y1 - y0);
  const pos = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
  const cx = (x0 + x1) / 2, cy = (z0 + z1) / 2, cz = (y0 + y1) / 2;
  for (let i = 0; i < pos.count; i++) {
    const X = pos.getX(i) + cx, Y = pos.getY(i) + cy, Z = pos.getZ(i) + cz;
    const nx = nrm.getX(i), ny = nrm.getY(i), nz = nrm.getZ(i);
    if (Math.abs(ny) > 0.5) uv.setXY(i, X, -Z);
    else if (Math.abs(nx) > 0.5) uv.setXY(i, nx > 0 ? -Z : Z, Y);
    else uv.setXY(i, nz > 0 ? X : -X, Y);
  }
  return g;
}
