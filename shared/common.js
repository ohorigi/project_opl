// 개선OPL - 서버와 클라이언트가 함께 쓰는 맵 / 물리 / 무기 정의
// 좌표계: x = 동(+) 서(-), y = 남(+) 북(-), z = 높이(+위)

export const GAME_NAME = '개선OPL';

export const MAP_W = 64;
export const MAP_H = 64;

export const PLAYER_R = 0.4;      // 이동 충돌 반경
export const FOOT_R = 0.22;       // 발판 판정 반경
export const PLAYER_H = 1.8;      // 키
export const GUN_H = 1.2;         // 총구 높이(시야/사격 높이)
export const STEP_H = 0.55;       // 오를 수 있는 단차 (계단 한 칸 = 0.5)
export const SNAP_H = 0.6;        // 내려갈 때 바닥에 붙는 높이
export const GRAVITY = 26;
export const MOVE_SPEED = 6;
export const MAX_HP = 100;
export const RESPAWN_MS = 3000;
export const SPAWN_PROTECT_MS = 1500;
export const HITBOX_R = 0.45;
export const PICK_R = 1.1;
export const SLOT_COUNT = 3;
export const HEAL_AMOUNT = 50;
export const FLOOR_Z = 3;         // 2층 높이

// ───────────────────────── 무기 ─────────────────────────
// dmg: 탄당 데미지, range: 사거리(m), interval: 발사 간격(초), spread: 탄퍼짐(라디안)
export const WEAPONS = {
  pistol:  { name: '권총',     dmg: 20,  pellets: 1, range: 16,  interval: 0.30,  mag: 12, reserve: 0,   infinite: true, reload: 1.1, spread: 0.025, color: '#e6e6e6', len: 0.42, shake: 0.08 },
  smg:     { name: '기관단총', dmg: 11,  pellets: 1, range: 12,  interval: 0.085, mag: 30, reserve: 120, reload: 1.7, spread: 0.075, color: '#4fc3f7', len: 0.62, shake: 0.05 },
  shotgun: { name: '산탄총',   dmg: 13,  pellets: 8, range: 7.5, interval: 0.85,  mag: 6,  reserve: 24,  reload: 2.1, spread: 0.2,   color: '#ff8a65', len: 0.82, shake: 0.32 },
  rifle:   { name: '돌격소총', dmg: 22,  pellets: 1, range: 22,  interval: 0.12,  mag: 25, reserve: 100, reload: 1.9, spread: 0.035, color: '#aed581', len: 0.95, shake: 0.09 },
  sniper:  { name: '저격소총', dmg: 100, pellets: 1, range: 45,  interval: 1.3,   mag: 5,  reserve: 20,  reload: 2.4, spread: 0.003, color: '#ce93d8', len: 1.3,  shake: 0.4 },
};
export const WEAPON_KINDS = Object.keys(WEAPONS);
export const PICKUP_KINDS = [...WEAPON_KINDS, 'health'];

// ───────────────────────── 맵 ─────────────────────────
function B(x0, y0, x1, y1, z0, z1, kind) {
  return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1), z0, z1, kind };
}
// 맵 중심 기준 180도 회전 대칭
function mirrorBox(b) {
  return { ...b, x0: MAP_W - b.x1, x1: MAP_W - b.x0, y0: MAP_H - b.y1, y1: MAP_H - b.y0 };
}
function mirrorPoint(p) {
  return { ...p, x: MAP_W - p.x, y: MAP_H - p.y };
}

function subtractGaps(a0, a1, gaps) {
  let segs = [[a0, a1]];
  for (const [g0, g1] of gaps || []) {
    const next = [];
    for (const [s0, s1] of segs) {
      if (g1 <= s0 || g0 >= s1) { next.push([s0, s1]); continue; }
      if (g0 > s0) next.push([s0, g0]);
      if (g1 < s1) next.push([g1, s1]);
    }
    segs = next;
  }
  return segs.filter(([s0, s1]) => s1 - s0 > 0.05);
}

// 옥상 난간 (gaps: 계단/다리가 붙는 구멍)
const PARAPET_T = 0.35, PARAPET_H = 0.75;
function parapets(out, x0, y0, x1, y1, z, gaps = {}) {
  const t = PARAPET_T, h = PARAPET_H;
  for (const [a, b] of subtractGaps(x0, x1, gaps.n)) out.push(B(a, y0, b, y0 + t, z, z + h, 'parapet'));
  for (const [a, b] of subtractGaps(x0, x1, gaps.s)) out.push(B(a, y1 - t, b, y1, z, z + h, 'parapet'));
  for (const [a, b] of subtractGaps(y0 + t, y1 - t, gaps.w)) out.push(B(x0, a, x0 + t, b, z, z + h, 'parapet'));
  for (const [a, b] of subtractGaps(y0 + t, y1 - t, gaps.e)) out.push(B(x1 - t, a, x1, b, z, z + h, 'parapet'));
}

// 계단: dir = 내려가는 방향 (n: 북쪽으로 내려감)
function stairs(out, x0, y0, x1, y1, dir, n = 5, rise = 0.5) {
  for (let i = 0; i < n; i++) {
    const h = (i + 1) * rise;
    if (dir === 'n') { const d = (y1 - y0) / n; out.push(B(x0, y0 + i * d, x1, y0 + (i + 1) * d, 0, h, 'stair')); }
    if (dir === 's') { const d = (y1 - y0) / n; out.push(B(x0, y1 - (i + 1) * d, x1, y1 - i * d, 0, h, 'stair')); }
    if (dir === 'w') { const d = (x1 - x0) / n; out.push(B(x0 + i * d, y0, x0 + (i + 1) * d, y1, 0, h, 'stair')); }
    if (dir === 'e') { const d = (x1 - x0) / n; out.push(B(x1 - (i + 1) * d, y0, x1 - i * d, y1, 0, h, 'stair')); }
  }
}

function buildMap() {
  const center = [];
  const half = [];

  // ── 중앙 건물 C (2층 옥상, 계단 남/북, 다리 동/서)
  center.push(B(26, 26, 38, 38, 0, 3, 'building'));
  parapets(center, 26, 26, 38, 38, 3, { w: [[30.5, 33.5]], e: [[30.5, 33.5]], n: [[29, 31.5]], s: [[32.5, 35]] });
  center.push(B(31, 31, 33, 33, 3, 4.4, 'wall'));

  // ── 서쪽 건물 A (대칭으로 동쪽 건물 B 생성)
  half.push(B(6, 26, 18, 38, 0, 3, 'building'));
  parapets(half, 6, 26, 18, 38, 3, { n: [[8, 10.5]], e: [[30.5, 33.5]], s: [[12, 14]] });
  stairs(half, 8, 21, 10.5, 26, 'n');
  half.push(B(9, 30.5, 10.5, 32, 3, 4.3, 'crate'));
  half.push(B(13.5, 28, 15, 29.5, 3, 4.3, 'crate'));
  half.push(B(11, 34, 12.5, 35.5, 3, 4.3, 'crate'));

  // ── A-C 다리 (아래로 지나갈 수 있음)
  half.push(B(18, 30.5, 26, 33.5, 2.6, 3, 'bridge'));
  half.push(B(18, 30.5, 26, 30.8, 3, 3.9, 'rail'));
  half.push(B(18, 33.2, 26, 33.5, 3, 3.9, 'rail'));
  half.push(B(19.6, 31.6, 20.4, 32.4, 0, 2.6, 'pillar'));
  half.push(B(23.6, 31.6, 24.4, 32.4, 0, 2.6, 'pillar'));

  // ── C 북쪽 계단 + 옥상 엄폐물
  stairs(half, 29, 21, 31.5, 26, 'n');
  half.push(B(28, 34.8, 29.2, 36, 3, 4.3, 'crate'));

  // ── 북동 감시탑
  half.push(B(54, 4, 58, 8, 0, 3, 'building'));
  parapets(half, 54, 4, 58, 8, 3, { w: [[4.5, 6.5]] });
  stairs(half, 49, 4.5, 54, 6.5, 'w');

  // ── 북서 들판
  half.push(B(6, 6, 7.5, 7.5, 0, 1.3, 'crate'));
  half.push(B(7.8, 7.2, 9, 8.4, 0, 1.3, 'crate'));
  half.push(B(14, 4, 14.8, 10, 0, 2.6, 'wall'));
  half.push(B(2, 16, 6, 16.6, 0, 1.3, 'low'));

  // ── 북쪽 중앙
  half.push(B(24, 14, 34, 14.6, 0, 2.6, 'wall'));
  half.push(B(28, 9, 29.5, 10.5, 0, 1.3, 'crate'));
  half.push(B(36, 8, 37.5, 9.5, 0, 1.3, 'crate'));
  half.push(B(20, 8, 21.2, 9.2, 0, 1.3, 'crate'));

  // ── 북동
  half.push(B(42, 10, 48, 10.6, 0, 2.6, 'wall'));
  half.push(B(47.4, 10.6, 48, 16, 0, 2.6, 'wall'));
  half.push(B(56, 14, 57.5, 15.5, 0, 1.3, 'crate'));
  half.push(B(44, 19, 45.5, 20.5, 0, 1.3, 'crate'));
  half.push(B(36, 20, 40, 20.6, 0, 1.3, 'low'));

  // ── 통로
  half.push(B(21, 22, 22.5, 23.5, 0, 1.3, 'crate'));
  half.push(B(1.5, 29, 3, 30.5, 0, 1.3, 'crate'));
  half.push(B(40, 24, 41.2, 25.2, 0, 1.3, 'crate'));

  const bounds = [
    B(-1, -1, MAP_W + 1, 0, 0, 4, 'bound'),
    B(-1, MAP_H, MAP_W + 1, MAP_H + 1, 0, 4, 'bound'),
    B(-1, 0, 0, MAP_H, 0, 4, 'bound'),
    B(MAP_W, 0, MAP_W + 1, MAP_H, 0, 4, 'bound'),
  ];

  return [...center, ...half, ...half.map(mirrorBox), ...bounds];
}

export const BOXES = buildMap();

const spawnHalf = [
  { x: 3, y: 3, z: 0 }, { x: 20, y: 4, z: 0 }, { x: 33, y: 5, z: 0 }, { x: 60, y: 10, z: 0 },
  { x: 12, y: 21, z: 0 }, { x: 8, y: 36, z: 3 }, { x: 40, y: 16, z: 0 }, { x: 3, y: 24, z: 0 },
];
export const SPAWNS = [...spawnHalf, ...spawnHalf.map(mirrorPoint)];

const pickupHalf = [
  { kind: 'sniper', x: 56, y: 6, z: 3 },       // 감시탑 위
  { kind: 'rifle', x: 15.5, y: 35.5, z: 3 },   // 건물 A 옥상
  { kind: 'smg', x: 30, y: 7, z: 0 },
  { kind: 'shotgun', x: 22, y: 32, z: 0 },     // 다리 밑
  { kind: 'rifle', x: 51, y: 19, z: 0 },
  { kind: 'health', x: 3, y: 33, z: 0 },
  { kind: 'health', x: 29, y: 29, z: 3 },      // 중앙 옥상
];
export const PICKUP_SPOTS = [...pickupHalf, ...pickupHalf.map(mirrorPoint)];

// ───────────────────────── 물리 ─────────────────────────
function circleBox(x, y, r, b) {
  const cx = x < b.x0 ? b.x0 : (x > b.x1 ? b.x1 : x);
  const cy = y < b.y0 ? b.y0 : (y > b.y1 ? b.y1 : y);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy < r * r;
}

export function isBlocked(x, y, z) {
  for (const b of BOXES) {
    if (b.z1 > z + STEP_H && b.z0 < z + PLAYER_H - 0.05 && circleBox(x, y, PLAYER_R, b)) return true;
  }
  return false;
}

// 현재 높이 z에서 디딜 수 있는 가장 높은 바닥
export function groundAt(x, y, z) {
  let g = 0;
  for (const b of BOXES) {
    if (b.z1 <= z + STEP_H && b.z1 > g && circleBox(x, y, FOOT_R, b)) g = b.z1;
  }
  return g;
}

// p: {x,y,z,vz,onGround}, (mx,my): 이동 방향 (맵 좌표)
export function stepMove(p, mx, my, dt) {
  const len = Math.hypot(mx, my);
  if (len > 1) { mx /= len; my /= len; }
  const dx = mx * MOVE_SPEED * dt, dy = my * MOVE_SPEED * dt;
  const stuck = isBlocked(p.x, p.y, p.z);
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.12));
  for (let i = 0; i < n; i++) {
    if (dx && (stuck || !isBlocked(p.x + dx / n, p.y, p.z))) p.x += dx / n;
    if (dy && (stuck || !isBlocked(p.x, p.y + dy / n, p.z))) p.y += dy / n;
    if (p.onGround) {
      const g = groundAt(p.x, p.y, p.z);
      if (g > p.z) p.z = g;
    }
  }
  p.x = Math.max(PLAYER_R, Math.min(MAP_W - PLAYER_R, p.x));
  p.y = Math.max(PLAYER_R, Math.min(MAP_H - PLAYER_R, p.y));

  const g = groundAt(p.x, p.y, p.z);
  if (p.onGround && p.z - g <= SNAP_H) {
    p.z = g; p.vz = 0;
  } else {
    p.onGround = false;
    p.vz -= GRAVITY * dt;
    p.z += p.vz * dt;
    const g2 = groundAt(p.x, p.y, p.z);
    if (p.z <= g2) { p.z = g2; p.vz = 0; p.onGround = true; }
  }
}

// 광선-상자 교차 (slab). 시작점이 상자 안이면 0
export function rayBox(ox, oy, oz, dx, dy, dz, b, maxT) {
  let t0 = 0, t1 = maxT;
  if (dx !== 0) {
    let a = (b.x0 - ox) / dx, c = (b.x1 - ox) / dx;
    if (a > c) { const s = a; a = c; c = s; }
    if (a > t0) t0 = a; if (c < t1) t1 = c; if (t0 > t1) return -1;
  } else if (ox < b.x0 || ox > b.x1) return -1;
  if (dy !== 0) {
    let a = (b.y0 - oy) / dy, c = (b.y1 - oy) / dy;
    if (a > c) { const s = a; a = c; c = s; }
    if (a > t0) t0 = a; if (c < t1) t1 = c; if (t0 > t1) return -1;
  } else if (oy < b.y0 || oy > b.y1) return -1;
  if (dz !== 0) {
    let a = (b.z0 - oz) / dz, c = (b.z1 - oz) / dz;
    if (a > c) { const s = a; a = c; c = s; }
    if (a > t0) t0 = a; if (c < t1) t1 = c; if (t0 > t1) return -1;
  } else if (oz < b.z0 || oz > b.z1) return -1;
  return t0;
}

// 지형 광선 판정 (난간 'rail'은 총알/시야를 막지 않음)
export function raycastWorld(ox, oy, oz, dx, dy, dz, maxT) {
  let best = maxT, hit = null;
  for (const b of BOXES) {
    if (b.kind === 'rail') continue;
    const t = rayBox(ox, oy, oz, dx, dy, dz, b, best);
    if (t >= 0 && t < best) { best = t; hit = b; }
  }
  if (dz < 0) {
    const tg = -oz / dz;
    if (tg >= 0 && tg < best) { best = tg; hit = GROUND; }
  }
  return { t: best, hit };
}
export const GROUND = { kind: 'ground' };

export function lineOfSight(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.01) return true;
  const r = raycastWorld(ax, ay, az, dx / len, dy / len, dz / len, len);
  return r.t >= len - 0.05;
}

export function playerBox(x, y, z) {
  return { x0: x - HITBOX_R, x1: x + HITBOX_R, y0: y - HITBOX_R, y1: y + HITBOX_R, z0: z, z1: z + PLAYER_H };
}

// 사격 판정: targets = [{id,x,y,z}]
export function traceShot(ox, oy, oz, dx, dy, dz, range, targets) {
  const w = raycastWorld(ox, oy, oz, dx, dy, dz, range);
  let best = w.t, target = null;
  for (const q of targets) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, playerBox(q.x, q.y, q.z), best);
    if (t >= 0 && t < best) { best = t; target = q; }
  }
  return {
    t: best,
    x: ox + dx * best, y: oy + dy * best, z: oz + dz * best,
    target,
    type: target ? 2 : (w.hit ? 1 : 0),
  };
}

export function floorLabel(z) {
  if (z >= FLOOR_Z - 0.4) return '2F';
  if (z > 0.3) return '계단';
  return '1F';
}
