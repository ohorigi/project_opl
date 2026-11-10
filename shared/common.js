// 개선OPL - 서버와 클라이언트가 함께 쓰는 맵 / 물리 / 무기 정의
// 좌표계: x = 동(+) 서(-), y = 남(+) 북(-), z = 높이(+위)

export const GAME_NAME = '개선OPL';

export const MAP_W = 80;
export const MAP_H = 80;

export const PLAYER_R = 0.4;      // 이동 충돌 반경
export const FOOT_R = 0.36;       // 발판 판정 반경 (모서리에 걸쳐도 올라섬 → 상자 옆면에 끼지 않음)
export const PLAYER_H = 1.8;      // 키
export const GUN_H = 1.2;         // 총구 높이(사격 높이)
export const EYE_H = 1.5;         // 눈 높이 (건물 안팎이 보이는지 판정)
export const STEP_H = 0.55;       // 오를 수 있는 단차 (계단 한 칸 = 0.5)
export const SNAP_H = 0.6;        // 내려갈 때 바닥에 붙는 높이
export const GRAVITY = 26;
export const MOVE_SPEED = 6;
export const WATER_SLOW = 0.45;   // 물에 들어가면 이동 속도 배율
export const MAX_HP = 100;
export const RESPAWN_MS = 3000;
export const SPAWN_PROTECT_MS = 5000; // 부활 후 무적 (이 동안은 공격도 못 함)
export const HITBOX_R = 0.45;
export const PICK_R = 1.1;
export const SLOT_COUNT = 3;
export const HEAL_AMOUNT = 50;
export const FLOOR_Z = 3;         // 2층(옥상) 높이
export const JUMP_V = 7.6;        // 점프 초속 → 약 1.1m 점프
export const PAD_V = 15;          // 점프 발판 초속 → 약 4.3m (옥상/탑 위로)
export const CHARACTER_COUNT = 2; // 고를 수 있는 캐릭터 수 (모습은 public/characters.js, 그림은 public/sprites)
export const PROP_RESPAWN_MS = 45000; // 부서진 상자/드럼통이 다시 생기는 시간

// 건물 치수
export const WALL_T = 0.4;        // 벽 두께
export const WALL_H = 2.75;       // 벽 높이 (= 천장 아래면)
export const DOOR_H = 2.3;        // 문 높이
export const SILL_H = 0.95;       // 창턱 높이 (총은 창문 너머로 쏠 수 있음)
export const WIN_TOP = 2.1;       // 창문 윗변
export const ROOF_Z = 3;          // 옥상 바닥 높이

// ───────────────────────── 무기 ─────────────────────────
// dmg: 탄당 데미지, range: 사거리(m), interval: 발사 간격(초), spread: 탄퍼짐(라디안)
export const WEAPONS = {
  pistol:  { name: '권총',     dmg: 20, pellets: 1, range: 16,  interval: 0.30,  mag: 12, reserve: 0,   infinite: true, reload: 1.1, spread: 0.025, color: '#e6e6e6', len: 0.42, shake: 0.08 },
  smg:     { name: '기관단총', dmg: 11, pellets: 1, range: 12,  interval: 0.085, mag: 30, reserve: 120, reload: 1.7, spread: 0.075, color: '#4fc3f7', len: 0.62, shake: 0.05 },
  shotgun: { name: '산탄총',   dmg: 13, pellets: 8, range: 7.5, interval: 0.85,  mag: 6,  reserve: 24,  reload: 2.1, spread: 0.2,   color: '#ff8a65', len: 0.82, shake: 0.32 },
  rifle:   { name: '돌격소총', dmg: 22, pellets: 1, range: 22,  interval: 0.12,  mag: 25, reserve: 100, reload: 1.9, spread: 0.035, color: '#aed581', len: 0.95, shake: 0.09 },
  sniper:  { name: '저격소총', dmg: 50, pellets: 1, range: 45,  interval: 1.3,   mag: 5,  reserve: 20,  reload: 2.4, spread: 0.003, color: '#ce93d8', len: 1.3,  shake: 0.4 },
  // 보스 전용 (보스를 쓰러뜨리면 떨어뜨림)
  gatling: { name: '개틀링',   dmg: 7,  pellets: 1, range: 24,  interval: 0.07,  mag: 150, reserve: 300, reload: 3.0, spread: 0.09, color: '#ff5252', len: 1.15, shake: 0.06 },
  // 적 전용 (모습 표시용, 떨어뜨리지 않음)
  blaster: { name: '에너지총', dmg: 0,  pellets: 1, range: 18,  interval: 1,     mag: 1,   reserve: 0,   reload: 1,   spread: 0,    color: '#ff4d8a', len: 0.7,  shake: 0, enemyOnly: true },
};
export const WEAPON_KINDS = Object.keys(WEAPONS);
export const PICKUP_KINDS = [...WEAPON_KINDS, 'health'];

// 수류탄: 부활할 때마다 count개. 조준점으로 던지고 fuse초 뒤 폭발
export const NADE = { count: 3, range: 14, fuse: 1.9, g: 22, radius: 4.5, dmg: 110, minDmg: 15, selfMul: 0.6, cooldown: 0.9 };
// 빨간 드럼통: 부서지면 폭발
export const BARREL = { radius: 3.6, dmg: 90, minDmg: 15 };
export const KILL_NAMES = { grenade: '수류탄', barrel: '드럼통 폭발', zone: '바닥 장판' };

// ───────────────────────── PvE: 적 / 스테이지 ─────────────────────────
// dmgMul: 적이 쏘는 총알 데미지 배율, acc: 탄퍼짐 배율, react: 처음 발견하고 쏘기까지 걸리는 시간(초)
// range: [가까이 붙지 않는 거리, 이보다 멀면 다가옴], burst/pause: 연사 발 수 / 쉬는 시간
export const ENEMIES = {
  // 모두 한 발씩, 느린 탄, 쏘기 전 예고. charge = 예고 시간, cooldown = 다음 공격까지(초), speed = 탄 속도, r = 탄 크기
  trainee: { name: '견습 병사', sprite: 'e_trainee', hp: 30, weapon: 'rifle', speed: 2.4, sight: 16, range: [6, 12], react: 1.0,
    atk: { count: 1, spread: 0, speed: 5.5, r: 0.3, dmg: 8, charge: 0.75, cooldown: [3.2, 4.2], range: 16 } },
  guard: { name: '순찰 경비병', sprite: 'e_guard', hp: 40, weapon: 'rifle', speed: 2.2, sight: 14, range: [6, 11], react: 0.3, patrol: 7,
    atk: { count: 1, spread: 0, speed: 5.5, r: 0.3, dmg: 8, charge: 1.0, alert: true, cooldown: [3.5, 4.5], range: 15 } },
  sniper: { name: '졸린 저격수', sprite: 'e_sniper', hp: 28, weapon: 'sniper', speed: 2.0, sight: 28, range: [12, 28], react: 1.0, stationary: true,
    atk: { count: 1, spread: 0, speed: 13, r: 0.22, dmg: 14, charge: 2.0, cooldown: [5, 5.5], range: 30, laser: true, rest: true, look: 'bolt' } },
  supply: { name: '겁쟁이 보급병', sprite: 'e_supply', hp: 25, weapon: 'rifle', speed: 3.6, sight: 12, range: [0, 0], react: 0.2, flee: true },
  boss: { name: '진홍의 여제 카르민', sprite: 'boss', hp: 1000, weapon: 'gatling', speed: 2.0, sight: 26, range: [6, 12], react: 0.8,
    scale: 1.45, r: 0.65, h: 2.6, boss: true },
};
export const ENEMY_KINDS = Object.keys(ENEMIES);
export const MAX_ATTACKERS = 2; // 동시에 공격 준비할 수 있는 적 수 (보스 제외) → 많이 모여도 너무 어렵지 않게

// 지금 맵을 다섯 구역으로 나눈 스테이지. start = 플레이어 시작 위치, enemies = [종류, x, y, z, 고정?]
// wave = 남은 적이 이 수 이하가 되면 추가로 나오는 적
export const STAGES = [
  {
    id: '1-1', name: '들판 정찰', start: { x: 4, y: 27, z: 0 },
    enemies: [['trainee', 13, 19], ['trainee', 22.5, 4.5], ['trainee', 16, 14], ['supply', 20, 24]],
  },
  {
    id: '1-2', name: '관제소 점거', start: { x: 27.5, y: 19 },
    enemies: [['trainee', 33.5, 9.5], ['guard', 39, 13.5], ['guard', 40.5, 20], ['trainee', 45, 4], ['supply', 33, 21.5]],
    wave: { at: 1, enemies: [['trainee', 47, 18], ['guard', 28, 3]] },
  },
  {
    id: '1-3', name: '북동 수로', start: { x: 44, y: 18.5 },
    enemies: [['sniper', 58, 10, 4.1], ['trainee', 65, 18.5], ['guard', 70, 12], ['trainee', 60, 28], ['guard', 75, 27], ['supply', 51, 31]],
    wave: { at: 2, enemies: [['trainee', 77, 18], ['sniper', 49, 10, 3.5, true]] },
  },
  {
    id: '1-4', name: '창고 돌파', start: { x: 54, y: 29.5 },
    enemies: [['guard', 63, 44], ['trainee', 71.5, 36.5], ['trainee', 64, 37], ['sniper', 68, 40.5, 3], ['guard', 62, 50], ['supply', 77, 40]],
    wave: { at: 2, enemies: [['trainee', 77, 52], ['guard', 58, 52.5], ['trainee', 66, 53]] },
  },
  {
    id: '1-5', name: '보스전 · 중앙 광장', start: { x: 52, y: 62 }, boss: true,
    enemies: [['boss', 40, 51.5], ['trainee', 34, 52], ['trainee', 46.5, 50.5], ['supply', 30, 60]],
  },
];

// ───────────────────────── 맵 ─────────────────────────
function B(x0, y0, x1, y1, z0, z1, kind, extra) {
  return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1), z0, z1, kind, ...extra };
}
const SIDE_MIRROR = { n: 's', s: 'n', w: 'e', e: 'w', i: 'i' };
const MIRROR_BLD = new Map(); // 절반 건물 → 대칭 건물
// 맵 중심 기준 180도 회전 대칭
function mirrorBox(b) {
  const m = { ...b, x0: MAP_W - b.x1, x1: MAP_W - b.x0, y0: MAP_H - b.y1, y1: MAP_H - b.y0 };
  if (b.side) m.side = SIDE_MIRROR[b.side];
  if (b.bld) m.bld = MIRROR_BLD.get(b.bld) || b.bld;
  return m;
}
function mirrorRect(r) {
  return { ...r, x0: MAP_W - r.x1, x1: MAP_W - r.x0, y0: MAP_H - r.y1, y1: MAP_H - r.y0 };
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

// 사각형에서 구멍(사각형들)을 뺀 나머지 조각들
function subtractRects(r, holes) {
  let rs = [r];
  for (const h of holes) {
    const next = [];
    for (const a of rs) {
      if (h.x1 <= a.x0 || h.x0 >= a.x1 || h.y1 <= a.y0 || h.y0 >= a.y1) { next.push(a); continue; }
      if (h.y0 > a.y0) next.push({ x0: a.x0, y0: a.y0, x1: a.x1, y1: h.y0 });
      if (h.y1 < a.y1) next.push({ x0: a.x0, y0: h.y1, x1: a.x1, y1: a.y1 });
      const y0 = Math.max(a.y0, h.y0), y1 = Math.min(a.y1, h.y1);
      if (h.x0 > a.x0) next.push({ x0: a.x0, y0, x1: h.x0, y1 });
      if (h.x1 < a.x1) next.push({ x0: h.x1, y0, x1: a.x1, y1 });
    }
    rs = next;
  }
  return rs;
}

// 옥상 난간 (gaps: 계단/다리/발판이 붙는 구멍)
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

// 문/창문이 뚫린 벽 한 줄. axis 'x' = x 방향으로 뻗은 벽(y는 f0~f1)
function wallRun(out, bld, side, axis, f0, f1, a0, a1, ops = [], kind = 'bwall') {
  const mk = (s0, s1, z0, z1) => out.push(axis === 'x'
    ? B(s0, f0, s1, f1, z0, z1, kind, { bld, side })
    : B(f0, s0, f1, s1, z0, z1, kind, { bld, side }));
  for (const [s0, s1] of subtractGaps(a0, a1, ops.map((o) => [o.c - o.w / 2, o.c + o.w / 2]))) mk(s0, s1, 0, WALL_H);
  for (const o of ops) {
    const s0 = o.c - o.w / 2, s1 = o.c + o.w / 2;
    if (o.t === 'door') mk(s0, s1, DOOR_H, WALL_H);
    else { mk(s0, s1, 0, SILL_H); mk(s0, s1, WIN_TOP, WALL_H); }
  }
}

// 안으로 들어갈 수 있는 건물: 벽 4면(문/창문) + 천장 겸 옥상 + 옥상 난간
function building(out, list, x0, y0, x1, y1, ops, opt = {}) {
  const T = WALL_T;
  const bld = {
    x0, y0, x1, y1, ix0: x0 + T, iy0: y0 + T, ix1: x1 - T, iy1: y1 - T,
    openings: [], floor: opt.floor || 'wood', name: opt.name || '',
  };
  list.push(bld);
  const run = (side, axis, f0, f1, a0, a1, os = []) => {
    wallRun(out, bld, side, axis, f0, f1, a0, a1, os);
    for (const o of os) {
      bld.openings.push({
        x: axis === 'x' ? o.c : (side === 'w' ? x0 : x1),
        y: axis === 'x' ? (side === 'n' ? y0 : y1) : o.c,
        side, t: o.t, w: o.w,
      });
    }
  };
  run('n', 'x', y0, y0 + T, x0, x1, ops.n);
  run('s', 'x', y1 - T, y1, x0, x1, ops.s);
  run('w', 'y', x0, x0 + T, y0 + T, y1 - T, ops.w);
  run('e', 'y', x1 - T, x1, y0 + T, y1 - T, ops.e);
  for (const r of subtractRects({ x0, y0, x1, y1 }, opt.holes || [])) out.push(B(r.x0, r.y0, r.x1, r.y1, WALL_H, ROOF_Z, 'roof', { bld }));
  parapets(out, x0, y0, x1, y1, ROOF_Z, opt.gaps || {});
  return bld;
}

const door = (c, w = 1.8) => ({ c, w, t: 'door' });
const win = (c, w = 1.6) => ({ c, w, t: 'win' });

function buildMap() {
  const center = [];
  const half = [];
  const bCenter = [];
  const bHalf = [];
  const waterHalf = [];
  const padHalf = [];
  // 드럼통 (tone 0 파랑, 1 빨강 = 폭발, 2 올리브)
  const drum = (x, y, z = 0, tone = 0) => half.push(B(x - 0.38, y - 0.38, x + 0.38, y + 0.38, z, z + 1.25, 'drum', { tone }));
  const crate = (x0, y0, x1, y1, z0 = 0, z1 = z0 + 1.3) => half.push(B(x0, y0, x1, y1, z0, z1, 'crate'));

  // ── 중앙 건물 C: 서/동 문, 안쪽 계단 2개로 옥상 구멍(해치)까지
  const hatchN = { x0: 42.4, y0: 34.4, x1: 47.6, y1: 36.2 };
  const C = building(center, bCenter, 32, 34, 48, 46, {
    n: [win(35), win(38.6)], s: [win(45), win(41.4)],
    w: [door(40, 2), win(37.2), win(42.8)], e: [door(40, 2), win(42.8), win(37.2)],
  }, { holes: [hatchN, mirrorRect(hatchN)], gaps: { w: [[38, 41]], e: [[39, 42]] }, floor: 'tile', name: '중앙 건물' });
  center.push(B(39, 39.3, 41, 40.7, 0, 0.9, 'table'));
  center.push(B(39, 39, 41, 41, 3, 4.4, 'wall'));             // 옥상 가운데 엄폐벽
  for (let i = 0; i < 5; i++) {                              // 북쪽 벽을 따라 동쪽으로 올라가는 계단 (대칭 → 남쪽)
    half.push(B(41.6 + i, 34.4, i === 4 ? 47.6 : 42.6 + i, 36.2, 0, (i + 1) * 0.5, 'stair'));
  }
  crate(36, 38.6, 37.2, 39.8);
  drum(45.5, 42, 0, 2);

  // ── 서쪽 건물 A '창고' (대칭으로 동쪽 건물 B): 방 2칸, 바깥 계단, 남쪽 점프 발판
  const A = building(half, bHalf, 6, 33, 20, 47, {
    n: [win(10.5), door(17)], s: [win(9.5), win(16.5)],
    w: [win(37), door(42)], e: [win(36), door(44)],
  }, { gaps: { n: [[7, 9.5]], e: [[38, 41]], s: [[11.5, 14.5]] }, floor: 'wood', name: '창고' });
  wallRun(half, A, 'i', 'y', 12.8, 13.2, 33.4, 46.6, [door(40)], 'iwall');
  stairs(half, 7, 28, 9.5, 33, 'n');
  crate(6.6, 33.6, 7.9, 34.9);
  crate(18.2, 45.2, 19.5, 46.5);
  half.push(B(15, 37.5, 17, 38.6, 0, 0.9, 'table'));
  drum(8, 45.8, 0, 0);
  crate(15, 35, 16.3, 36.3, 3);                              // 옥상 엄폐물
  drum(9, 44, 3, 2);
  padHalf.push({ x: 13, y: 48.7 });                          // → A 옥상

  // ── A-C 다리: 가운데가 끊겨 있어 점프로 건너야 함 (아래로 지나갈 수 있음)
  for (const [a, b] of [[20, 24.6], [27, 32]]) {
    half.push(B(a, 38, b, 41, 2.6, 3, 'bridge'));
    half.push(B(a, 38, b, 38.3, 3, 3.9, 'rail'));
    half.push(B(a, 40.7, b, 41, 3, 3.9, 'rail'));
  }
  half.push(B(23.8, 39.1, 24.6, 39.9, 0, 2.6, 'pillar'));
  half.push(B(27, 39.1, 27.8, 39.9, 0, 2.6, 'pillar'));

  // ── 북서 감시탑: 상자를 밟고 점프로만 올라감 (저격소총)
  half.push(B(4, 4, 8, 8, 0, 3.9, 'tower'));
  parapets(half, 4, 4, 8, 8, 3.9, { e: [[4.35, 5.65]] });
  crate(9.7, 4.35, 11, 5.65);
  crate(8, 4.35, 9.3, 5.65);
  crate(8, 4.35, 9.3, 5.65, 1.3);
  half.push(B(14, 3, 14.8, 9, 0, 2.6, 'wall'));

  // ── 북서 들판: 연못(징검다리), 울타리(점프로 넘음)
  waterHalf.push({ x0: 18, y0: 17, x1: 24.5, y1: 21.5 });
  for (const [x, y] of [[19.6, 19.2], [21.3, 18.6], [22.9, 19.6]]) half.push(B(x - 0.45, y - 0.45, x + 0.45, y + 0.45, 0, 0.3, 'stone'));
  half.push(B(11, 25.4, 26, 25.6, 0, 0.9, 'fence'));
  half.push(B(26, 13, 26.2, 18, 0, 0.9, 'fence'));
  half.push(B(26, 21, 26.2, 25.4, 0, 0.9, 'fence'));
  half.push(B(2, 16, 6, 16.6, 0, 1.3, 'low'));
  drum(11, 11, 0, 0); drum(11.9, 11, 0, 1); drum(11.45, 11.8, 0, 2);
  crate(20, 8, 21.2, 9.2);
  crate(25, 4, 26.3, 5.3);
  crate(25.1, 4.1, 26.2, 5.2, 1.3, 2.4);
  half.push(B(27, 21, 32, 21.6, 0, 2.6, 'wall'));
  crate(1.5, 29, 2.8, 30.3);
  crate(2, 23.5, 3.2, 24.7);

  // ── 북쪽 건물 D '관제소': 방 2칸, 남쪽 점프 발판, 옥상 동쪽으로 공중 발판
  const D = building(half, bHalf, 30, 6, 42, 16, {
    n: [win(33), win(39.5)], s: [door(33), win(39.5)],
    w: [win(8.5), door(12.5)], e: [win(13.5)],
  }, { gaps: { s: [[35, 38]], e: [[9, 11]] }, floor: 'tile2', name: '관제소' });
  wallRun(half, D, 'i', 'y', 36.3, 36.7, 6.4, 15.6, [door(10.5, 1.6)], 'iwall');
  crate(30.6, 6.6, 31.8, 7.8);
  half.push(B(39, 8, 41, 9, 0, 0.9, 'table'));
  drum(41, 15, 0, 1);
  crate(31, 13.5, 32.3, 14.8, 3);
  padHalf.push({ x: 36.5, y: 18.2 });                        // → D 옥상

  // ── 공중 발판: D 옥상 → 북동 감시탑 (2m 간격, 조금씩 높아짐)
  const plat = (x0, y0, x1, y1, top) => {
    half.push(B(x0, y0, x1, y1, top - 0.3, top, 'plat'));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    half.push(B(cx - 0.18, cy - 0.18, cx + 0.18, cy + 0.18, 0, top - 0.3, 'pole'));
  };
  plat(44, 9, 46, 11, 3.2);
  plat(48, 9, 50, 11, 3.5);
  plat(52, 9, 54, 11, 3.8);
  half.push(B(56, 7, 60, 13, 0, 4.1, 'tower'));
  parapets(half, 56, 7, 60, 13, 4.1, { w: [[9, 11]], e: [[9, 11]] });
  padHalf.push({ x: 61.5, y: 10 });                          // → 북동 감시탑
  half.push(B(50, 15, 56, 15.6, 0, 2.6, 'wall'));

  // ── 북동 수로: 물에 들어가면 느려짐 → 뛰어넘거나 나무다리/징검돌로
  waterHalf.push({ x0: 46, y0: 22, x1: 80, y1: 24.6 });
  half.push(B(62, 21.7, 64.6, 24.9, 0, 0.25, 'deck'));
  half.push(B(71.1, 22.85, 71.9, 23.75, 0, 0.3, 'stone'));
  drum(52, 19.5, 0, 0); drum(53, 19.3, 0, 1);
  crate(66, 16, 67.3, 17.3);
  crate(67.6, 16.4, 68.6, 17.4, 0, 1.0);
  crate(74.5, 4.5, 75.8, 5.8);
  crate(74.6, 4.6, 75.7, 5.7, 1.3, 2.5);
  drum(70, 30, 0, 1); drum(70.9, 30.1, 0, 0);

  // ── 가운데 띠 (건물 사이)
  crate(27.5, 27.5, 28.8, 28.8);
  drum(30, 30.5, 0, 2);
  half.push(B(36, 27, 44, 27.6, 0, 1.3, 'low'));
  crate(46, 25.5, 47.3, 26.8);
  half.push(B(44, 29.5, 49, 30.1, 0, 1.3, 'low'));
  crate(52, 28, 53.3, 29.3);

  // 대칭 복제 (건물은 대칭 건물을 먼저 만들어 둠)
  const bMirror = bHalf.map((b) => {
    const m = {
      ...mirrorRect(b), ...{ ix0: MAP_W - b.ix1, ix1: MAP_W - b.ix0, iy0: MAP_H - b.iy1, iy1: MAP_H - b.iy0 },
      openings: b.openings.map((o) => ({ ...mirrorPoint(o), side: SIDE_MIRROR[o.side] })),
    };
    MIRROR_BLD.set(b, m);
    return m;
  });
  const buildings = [...bCenter, ...bHalf, ...bMirror];
  buildings.forEach((b, i) => { b.id = i; });

  const bounds = [
    B(-1, -1, MAP_W + 1, 0, 0, 4, 'bound'),
    B(-1, MAP_H, MAP_W + 1, MAP_H + 1, 0, 4, 'bound'),
    B(-1, 0, 0, MAP_H, 0, 4, 'bound'),
    B(MAP_W, 0, MAP_W + 1, MAP_H, 0, 4, 'bound'),
  ];
  const boxes = [...center, ...half, ...half.map(mirrorBox), ...bounds];
  boxes.forEach((b, i) => {
    b.id = i;
    b.bi = b.bld ? b.bld.id : -1;
    delete b.bld;
    if (b.kind === 'crate') b.hpMax = 60;
    if (b.kind === 'drum') { b.hpMax = b.tone === 1 ? 30 : 80; if (b.tone === 1) b.boom = true; }
    b.hp = b.hpMax || 0;
    // 옥상 위에 놓인 것 (건물 안에 들어가면 지붕과 함께 숨김)
    b.roofOf = -1;
    if (b.z0 >= ROOF_Z - 0.05) {
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      const bl = buildings.find((q) => cx > q.x0 && cx < q.x1 && cy > q.y0 && cy < q.y1);
      if (bl) b.roofOf = bl.id;
    }
  });
  return {
    boxes, buildings,
    water: [...waterHalf, ...waterHalf.map(mirrorRect)],
    pads: [...padHalf, ...padHalf.map(mirrorPoint)].map((p) => ({ ...p, z: 0 })),
  };
}

const MAP = buildMap();
export const BOXES = MAP.boxes;
export const BUILDINGS = MAP.buildings;
export const WATER = MAP.water;
export const PADS = MAP.pads;
export const PROPS = BOXES.filter((b) => b.hpMax);                       // 부서지는 것 (상자, 드럼통)
const OPAQUE_KINDS = new Set(['bwall', 'iwall', 'roof', 'tower']);
export const OPAQUE = BOXES.filter((b) => OPAQUE_KINDS.has(b.kind));    // 건물 안팎 시야를 막는 것

const spawnHalf = [
  { x: 2.5, y: 10, z: 0 }, { x: 20, y: 3, z: 0 }, { x: 33, y: 3, z: 0 }, { x: 64, y: 4, z: 0 },
  { x: 12, y: 22, z: 0 }, { x: 36, y: 30, z: 0 }, { x: 50, y: 18, z: 0 }, { x: 2.5, y: 36, z: 0 },
];
export const SPAWNS = [...spawnHalf, ...spawnHalf.map(mirrorPoint)];

const pickupHalf = [
  { kind: 'sniper', x: 6, y: 6.5, z: 3.9 },        // 북서 감시탑 위
  { kind: 'rifle', x: 9.5, y: 40, z: 0 },          // 창고 안
  { kind: 'smg', x: 39, y: 12, z: 0 },             // 관제소 안
  { kind: 'shotgun', x: 25.8, y: 39.5, z: 0 },     // 끊긴 다리 밑
  { kind: 'rifle', x: 58, y: 10, z: 4.1 },         // 북동 감시탑 위
  { kind: 'health', x: 36, y: 36.6, z: 0 },        // 중앙 건물 안
  { kind: 'health', x: 3, y: 33, z: 0 },
  { kind: 'smg', x: 75, y: 17, z: 0 },
];
export const PICKUP_SPOTS = [...pickupHalf, ...pickupHalf.map(mirrorPoint)];

// 아이템을 먹으면 다음엔 이 중 빈 곳에 무작위로 다시 생김
const itemSpotHalf = [
  ...pickupHalf.map(({ x, y, z }) => ({ x, y, z })),
  { x: 12, y: 20.5, z: 0 }, { x: 28, y: 31, z: 0 }, { x: 45, y: 18, z: 0 }, { x: 70, y: 12, z: 0 },
  { x: 16.5, y: 41.5, z: 0 }, { x: 33.5, y: 10, z: 0 }, { x: 40, y: 37.5, z: 0 }, { x: 16, y: 40, z: 3 },
  { x: 35, y: 11, z: 3 }, { x: 22, y: 30, z: 0 }, { x: 50, y: 32, z: 0 }, { x: 5, y: 22, z: 0 },
  { x: 64, y: 28, z: 0 }, { x: 52, y: 4, z: 0 }, { x: 76, y: 36, z: 0 }, { x: 30, y: 25, z: 0 },
  { x: 45, y: 10, z: 3.2 }, { x: 22.5, y: 13, z: 0 }, { x: 11, y: 30.5, z: 0 },
];
export const ITEM_SPOTS = [...itemSpotHalf, ...itemSpotHalf.map(mirrorPoint)];

// ───────────────────────── 물리 ─────────────────────────
function circleBox(x, y, r, b) {
  const cx = x < b.x0 ? b.x0 : (x > b.x1 ? b.x1 : x);
  const cy = y < b.y0 ? b.y0 : (y > b.y1 ? b.y1 : y);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy < r * r;
}

export function isBlocked(x, y, z) {
  for (const b of BOXES) {
    if (b.dead) continue;
    if (b.z1 > z + STEP_H && b.z0 < z + PLAYER_H - 0.05 && circleBox(x, y, PLAYER_R, b)) return true;
  }
  return false;
}

// 현재 높이 z에서 디딜 수 있는 가장 높은 바닥
export function groundAt(x, y, z) {
  let g = 0;
  for (const b of BOXES) {
    if (b.dead) continue;
    if (b.z1 <= z + STEP_H && b.z1 > g && circleBox(x, y, FOOT_R, b)) g = b.z1;
  }
  return g;
}

export function inWater(x, y) {
  for (const w of WATER) if (x > w.x0 && x < w.x1 && y > w.y0 && y < w.y1) return true;
  return false;
}

export function padAt(x, y, z) {
  if (z > 0.05) return null;
  for (const p of PADS) if (Math.hypot(x - p.x, y - p.y) < 0.62) return p;
  return null;
}

// 건물 안(1층)에 있으면 건물 번호, 아니면 -1
export function insideBuilding(x, y, z) {
  if (z > ROOF_Z - 0.4) return -1;
  for (const b of BUILDINGS) if (x > b.ix0 && x < b.ix1 && y > b.iy0 && y < b.iy1) return b.id;
  return -1;
}

// p: {x,y,z,vz,onGround}, (mx,my): 이동 방향 (맵 좌표)
// 점프 발판을 밟으면 p.evt = 'pad'
export function stepMove(p, mx, my, dt) {
  const len = Math.hypot(mx, my);
  if (len > 1) { mx /= len; my /= len; }
  const spd = MOVE_SPEED * (p.z < 0.05 && inWater(p.x, p.y) ? WATER_SLOW : 1);
  const dx = mx * spd * dt, dy = my * spd * dt;
  let stuck = isBlocked(p.x, p.y, p.z);
  if (stuck) {
    // 낮은 물체에 파묻혔으면 그 위로 올려줌 (그래도 막히면 빠져나갈 수 있게 자유 이동)
    let top = -1;
    for (const b of BOXES) {
      if (b.dead) continue;
      if (b.z1 > p.z + STEP_H && b.z0 < p.z + PLAYER_H && b.z1 - p.z <= 0.9 && circleBox(p.x, p.y, PLAYER_R, b)) top = Math.max(top, b.z1);
    }
    if (top >= 0 && !isBlocked(p.x, p.y, top)) { p.z = top; p.vz = 0; p.onGround = true; stuck = false; }
  }
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
  if (p.onGround && p.vz <= 0 && p.z - g <= SNAP_H) {
    p.z = g; p.vz = 0;
  } else {
    p.onGround = false;
    p.vz -= GRAVITY * dt;
    // 올라가다 천장(다리 바닥, 건물 천장 등)에 머리가 닿으면 멈춤
    if (p.vz > 0 && isBlocked(p.x, p.y, p.z + p.vz * dt)) p.vz = 0;
    const zPrev = p.z;
    p.z += p.vz * dt;
    // 빠르게 떨어져도 이전 높이 기준 발판을 놓치지 않게 둘 다 확인
    const g2 = Math.max(groundAt(p.x, p.y, p.z), p.vz <= 0 ? groundAt(p.x, p.y, zPrev) : 0);
    if (p.z <= g2) { p.z = g2; p.vz = 0; p.onGround = true; } // 상자 모서리에 걸치면 위로 올라섬
  }
  if (p.onGround && padAt(p.x, p.y, p.z)) {
    p.vz = PAD_V;
    p.onGround = false;
    p.evt = 'pad';
  }
}

// 점프: 바닥에 서 있을 때만
export function tryJump(p) {
  if (!p.onGround) return false;
  p.vz = JUMP_V;
  p.onGround = false;
  return true;
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

// 지형 광선 판정 (난간 'rail'은 총알을 막지 않음, 부서진 물체는 무시)
export function raycastWorld(ox, oy, oz, dx, dy, dz, maxT) {
  let best = maxT, hit = null;
  for (const b of BOXES) {
    if (b.kind === 'rail' || b.dead) continue;
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

// 건물 벽/지붕/탑이 두 점 사이를 가리는지 (상자·드럼통은 시야를 가리지 않음)
export function opaqueBetween(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.01) return false;
  const ux = dx / len, uy = dy / len, uz = dz / len;
  const minX = Math.min(ax, bx), maxX = Math.max(ax, bx);
  const minY = Math.min(ay, by), maxY = Math.max(ay, by);
  const minZ = Math.min(az, bz), maxZ = Math.max(az, bz);
  for (const b of OPAQUE) {
    if (b.x1 < minX || b.x0 > maxX || b.y1 < minY || b.y0 > maxY || b.z1 < minZ || b.z0 > maxZ) continue;
    const t = rayBox(ax, ay, az, ux, uy, uz, b, len);
    if (t >= 0 && t < len - 0.05) return true;
  }
  return false;
}

// 시야 규칙: 둘 다 바깥이면 항상 보임. 한쪽이라도 건물 안이면 창문/문으로 직접 보일 때만
export function canSee(vx, vy, vz, tx, ty, tz) {
  if (insideBuilding(vx, vy, vz) < 0 && insideBuilding(tx, ty, tz) < 0) return true;
  const ez = vz + EYE_H;
  return !opaqueBetween(vx, vy, ez, tx, ty, tz + 1.45) || !opaqueBetween(vx, vy, ez, tx, ty, tz + 0.9);
}

// 눈높이 z에서 건물 벽에 막히지 않고 보이는 영역 (다각형 꼭짓점 [x,y]...)
export function visibilityPolygon(x, y, z, radius) {
  const boxes = OPAQUE.filter((b) => b.z0 <= z && b.z1 > z
    && b.x1 > x - radius && b.x0 < x + radius && b.y1 > y - radius && b.y0 < y + radius);
  const angles = [];
  for (const b of boxes) {
    for (const [cx, cy] of [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]]) {
      const a = Math.atan2(cy - y, cx - x);
      angles.push(a - 0.0005, a + 0.0005);
    }
  }
  for (let k = 0; k < 72; k++) angles.push(-Math.PI + (k / 72) * Math.PI * 2);
  angles.sort((a, b) => a - b);
  const pts = [];
  for (const a of angles) {
    const dx = Math.cos(a), dy = Math.sin(a);
    let t = radius;
    for (const b of boxes) {
      const h = rayBox(x, y, z, dx, dy, 0, b, t);
      if (h >= 0 && h < t) t = h;
    }
    pts.push([x + dx * t, y + dy * t]);
  }
  return pts;
}

// r, h: 보스처럼 큰 적은 판정 상자도 큼
export function playerBox(x, y, z, r = HITBOX_R, h = PLAYER_H) {
  return { x0: x - r, x1: x + r, y0: y - r, y1: y + r, z0: z, z1: z + h };
}

// 사격 판정: targets = [{id,x,y,z}]
export function traceShot(ox, oy, oz, dx, dy, dz, range, targets) {
  const w = raycastWorld(ox, oy, oz, dx, dy, dz, range);
  let best = w.t, target = null;
  for (const q of targets) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, playerBox(q.x, q.y, q.z, q.r, q.h), best);
    if (t >= 0 && t < best) { best = t; target = q; }
  }
  return {
    t: best,
    x: ox + dx * best, y: oy + dy * best, z: oz + dz * best,
    target,
    hit: target ? null : w.hit,
    type: target ? 2 : (w.hit ? 1 : 0),
  };
}

// ───────────────────────── 수류탄 ─────────────────────────
// 조준점(tx,ty,tz)에 떨어지도록 던지는 초속 (최대 사거리 NADE.range)
export function nadeVelocity(ox, oy, oz, tx, ty, tz) {
  let dx = tx - ox, dy = ty - oy;
  let hd = Math.hypot(dx, dy);
  if (hd > NADE.range) { dx *= NADE.range / hd; dy *= NADE.range / hd; hd = NADE.range; }
  const T = Math.max(0.4, Math.min(1.05, 0.3 + hd * 0.055));
  const dz = Math.max(-6, Math.min(4, tz - oz));
  return [dx / T, dy / T, (dz + 0.5 * NADE.g * T * T) / T];
}

function hitNormal(b, x, y, z, vx, vy, vz) {
  if (b === GROUND) return [0, 0, 1];
  const faces = [
    [Math.abs(x - b.x0), -1, 0, 0], [Math.abs(x - b.x1), 1, 0, 0],
    [Math.abs(y - b.y0), 0, -1, 0], [Math.abs(y - b.y1), 0, 1, 0],
    [Math.abs(z - b.z0), 0, 0, -1], [Math.abs(z - b.z1), 0, 0, 1],
  ];
  let best = null;
  for (const f of faces) {
    if (f[1] * vx + f[2] * vy + f[3] * vz >= 0) continue; // 그 면을 향해 움직이고 있지 않음
    if (!best || f[0] < best[0]) best = f;
  }
  return best ? [best[1], best[2], best[3]] : [0, 0, 1];
}

const r3 = (v) => Math.round(v * 1000) / 1000;
// 튕기면서 굴러가는 궤적 (0.05초 간격 [t,x,y,z]) - 서버가 계산해서 모두에게 보냄
export function simulateNade(ox, oy, oz, vx, vy, vz) {
  let x = ox, y = oy, z = oz;
  const DT = 1 / 120;
  const steps = Math.round(NADE.fuse / DT);
  const pts = [[0, r3(x), r3(y), r3(z)]];
  const bounces = [];
  let rest = false;
  let nextRec = 0.05;
  for (let s = 1; s <= steps; s++) {
    const t = s * DT;
    if (!rest) {
      vz -= NADE.g * DT;
      let remain = DT;
      for (let k = 0; k < 4 && remain > 1e-9; k++) {
        const sp = Math.hypot(vx, vy, vz);
        if (sp < 1e-6) break;
        const ux = vx / sp, uy = vy / sp, uz = vz / sp;
        const h = raycastWorld(x, y, z, ux, uy, uz, sp * remain);
        if (!h.hit) { x += vx * remain; y += vy * remain; z += vz * remain; break; }
        x += ux * h.t; y += uy * h.t; z += uz * h.t;
        const n = hitNormal(h.hit, x, y, z, vx, vy, vz);
        x += n[0] * 0.03; y += n[1] * 0.03; z += n[2] * 0.03;
        const vn = vx * n[0] + vy * n[1] + vz * n[2];
        const tx = vx - vn * n[0], ty = vy - vn * n[1], tz = vz - vn * n[2];
        vx = tx * 0.72 - vn * n[0] * 0.38;
        vy = ty * 0.72 - vn * n[1] * 0.38;
        vz = tz * 0.72 - vn * n[2] * 0.38;
        remain -= h.t / sp;
        if (Math.abs(vn) > 1.5) bounces.push(r3(t));
        if (n[2] > 0.5 && vz < 1.3) { rest = true; vx = vy = vz = 0; break; }
      }
      if (z < 0) z = 0;
    }
    if (t >= nextRec - 1e-9 || s === steps) { pts.push([r3(t), r3(x), r3(y), r3(z)]); nextRec += 0.05; }
  }
  return { pts, x, y, z, bounces };
}

// 폭발 데미지 (중심 maxDmg → 반경 끝 minDmg)
export function blastDamage(d, radius, maxDmg, minDmg) {
  if (d >= radius) return 0;
  return Math.round(minDmg + (maxDmg - minDmg) * (1 - d / radius));
}

export function floorLabel(z) {
  if (z >= 3.7) return '탑';
  if (z >= FLOOR_Z - 0.4) return '2F';
  if (z > 0.3) return '계단';
  return '1F';
}
