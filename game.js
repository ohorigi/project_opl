// 개선OPL 게임 판정: PvP 방 / PvE 방(스테이지 1-1 ~ 1-5, 적 AI, 보스)
// 두 방은 같은 맵을 쓰지만 플레이어, 아이템, 부서진 물체, 적이 따로 있다.
import * as G from './shared/common.js';

const r2 = (v) => Math.round(v * 100) / 100;
const kindIndex = (k) => G.PICKUP_KINDS.indexOf(k);
const rand = (a, b) => a + Math.random() * (b - a);
const randIn = ([a, b]) => rand(a, b);
const randInt = ([a, b]) => Math.floor(rand(a, b + 1));

let nextId = 1;
let log = () => {};
export function setLogger(fn) { log = fn; }

function newItem(kind) {
  const w = G.WEAPONS[kind];
  return { kind, mag: w.mag, reserve: w.reserve };
}
function ammoFor(kind) {
  const w = G.WEAPONS[kind];
  return w ? { mag: w.mag, reserve: w.reserve } : { mag: 0, reserve: 0 };
}
function colorFor(id) {
  const hue = Math.round((id * 137.508) % 360);
  return `hsl(${hue}, 75%, 58%)`;
}
// 아이템이 다시 생길 수 있는 자리 (막혔거나 물속인 곳은 제외)
const ITEM_SPOTS = G.ITEM_SPOTS.filter((s) => !G.isBlocked(s.x, s.y, s.z)
  && Math.abs(G.groundAt(s.x, s.y, s.z + 0.01) - s.z) < 0.01 && !G.inWater(s.x, s.y));
const ROOFS = G.BOXES.filter((b) => b.kind === 'roof' && (b.x1 - b.x0) > 2.4 && (b.y1 - b.y0) > 2.4);

/* ═════════════════════════ 방 ═════════════════════════ */
class World {
  constructor(mode) {
    this.mode = mode;
    this.players = new Map();     // 사람 + (PvE) 적
    this.pickups = [];
    this.nades = [];
    this.projs = [];   // PvE 적 탄
    this.zones = [];   // PvE 보스 바닥 장판
    this.nextPickupId = 1;
    this.nextNadeId = 1;
    this.rosterDirty = false;
    this.props = G.PROPS.map((b) => ({ dead: false, hp: b.hpMax, respawnAt: 0 }));
    this.deadProps = [];
    this.propsDirty = true;
    this.stage = null;
    this.resetPickups();
  }
  resetPickups() {
    this.pickups.length = 0;
    for (const s of G.PICKUP_SPOTS) {
      this.pickups.push({ id: this.nextPickupId++, kind: s.kind, x: s.x, y: s.y, z: s.z, active: true, respawnAt: 0, isStatic: true, ...ammoFor(s.kind) });
    }
  }
  resetProps() {
    for (const s of this.props) { s.dead = false; s.respawnAt = 0; }
    G.PROPS.forEach((b, i) => { this.props[i].hp = b.hpMax; });
    this.propsDirty = true;
  }
  humans() { return [...this.players.values()].filter((p) => !p.isBot && p.joined); }
  bots() { return [...this.players.values()].filter((p) => p.isBot); }
}
export const worlds = { pvp: new World('pvp'), pve: new World('pve') };
// 지금 처리 중인 방. 부서진 물체 상태(물리 판정용)를 이 방 것으로 맞춘다
let W = worlds.pvp;
const PROP_INDEX = new Map(G.PROPS.map((b, i) => [b.id, i]));
function use(world) {
  W = world;
  for (let i = 0; i < G.PROPS.length; i++) {
    const b = G.PROPS[i], s = world.props[i];
    b.dead = s.dead;
    b.hp = s.hp;
  }
}
function propState(b) { return W.props[PROP_INDEX.get(b.id)]; }

/* ═════════════════════════ 보내기 ═════════════════════════ */
function send(p, msg) {
  if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
}
function broadcast(msg, except) {
  const s = JSON.stringify(msg);
  for (const p of W.players.values()) {
    if (p !== except && p.ws && p.joined && p.ws.readyState === 1) p.ws.send(s);
  }
}
function sys(text) { broadcast({ type: 'sys', text }); }
function sendRoster() {
  const list = W.humans().map((p) => ({ id: p.id, name: p.name, color: p.color, kills: p.kills, deaths: p.deaths, char: p.char }));
  broadcast({ type: 'roster', list });
}

/* ═════════════════════════ 아이템 ═════════════════════════ */
// 먹은 아이템은 원래 자리가 아닌, 다른 아이템과 떨어진 빈 자리에 무작위로 다시 생김
function relocatePickup(pk) {
  const others = W.pickups.filter((q) => q !== pk && q.active && !q.remove);
  const free = ITEM_SPOTS.filter((s) => Math.hypot(s.x - pk.x, s.y - pk.y) > 4
    && others.every((q) => Math.hypot(q.x - s.x, q.y - s.y) > 3)
    && !G.isBlocked(s.x, s.y, s.z) && Math.abs(G.groundAt(s.x, s.y, s.z + 0.01) - s.z) < 0.01);
  const pool = free.length ? free : ITEM_SPOTS;
  const s = pool[Math.floor(Math.random() * pool.length)];
  Object.assign(pk, { x: s.x, y: s.y, z: s.z, id: W.nextPickupId++, active: true }, ammoFor(pk.kind));
}
function addDropped(item, x, y, z, noPickId) {
  const now = Date.now();
  W.pickups.push({
    id: W.nextPickupId++, kind: item.kind, x, y, z, active: true, isStatic: false,
    mag: item.mag, reserve: item.reserve, expireAt: now + 25000,
    noPick: noPickId, noPickUntil: now + 1500,
  });
}
function consumePickup(pk) {
  if (pk.isStatic) {
    pk.active = false;
    pk.respawnAt = Date.now() + (pk.kind === 'health' ? 20000 : 15000);
  } else {
    pk.remove = true;
  }
}
function tryAutoPick(p, pk) {
  if (pk.kind === 'health') {
    if (p.hp >= G.MAX_HP) return false;
    p.hp = Math.min(G.MAX_HP, p.hp + G.HEAL_AMOUNT);
    send(p, { type: 'pick', kind: 'health' });
    return true;
  }
  const w = G.WEAPONS[pk.kind];
  const own = p.inv.findIndex((it) => it && it.kind === pk.kind);
  if (own >= 0) {
    if (w.infinite) return false;
    const it = p.inv[own];
    const space = w.reserve - it.reserve;
    if (space <= 0) return false;
    it.reserve += Math.min(space, pk.mag + pk.reserve);
    send(p, { type: 'pick', kind: pk.kind, ammo: 1 });
    return true;
  }
  const empty = p.inv.findIndex((it) => !it);
  if (empty >= 0) {
    p.inv[empty] = { kind: pk.kind, mag: pk.mag, reserve: pk.reserve };
    p.slot = empty;
    p.reloadUntil = 0;
    send(p, { type: 'pick', kind: pk.kind, slot: empty });
    return true;
  }
  return false;
}
// E키: 현재 무기와 바닥 무기 교체
function swap(p) {
  if (!p.alive) return;
  let best = null, bd = G.PICK_R + 0.4;
  for (const pk of W.pickups) {
    if (!pk.active || pk.remove || pk.kind === 'health') continue;
    const d = Math.hypot(p.x - pk.x, p.y - pk.y);
    if (d < bd && Math.abs(p.z - pk.z) < 1.2) { bd = d; best = pk; }
  }
  if (!best) return;
  if (p.inv.some((it) => it && it.kind === best.kind)) return;
  const cur = p.inv[p.slot];
  p.inv[p.slot] = { kind: best.kind, mag: best.mag, reserve: best.reserve };
  p.reloadUntil = 0;
  consumePickup(best);
  if (cur) addDropped(cur, best.x, best.y, best.z, p.id);
  send(p, { type: 'pick', kind: best.kind, slot: p.slot });
}

/* ═════════════════════════ 부활 / 피해 ═════════════════════════ */
// PvP: 맵 전체에서 무작위, 적과 가깝거나 적에게 보이는 자리는 피함
function randomSpawnPoint(p) {
  const enemies = [...W.players.values()].filter((q) => q !== p && q.joined && q.alive);
  let best = null, bestScore = -Infinity;
  for (let i = 0; i < 80; i++) {
    let x, y, z;
    if (Math.random() < 0.2) {
      const b = ROOFS[Math.floor(Math.random() * ROOFS.length)];
      x = b.x0 + 0.9 + Math.random() * (b.x1 - b.x0 - 1.8);
      y = b.y0 + 0.9 + Math.random() * (b.y1 - b.y0 - 1.8);
      z = b.z1;
    } else {
      x = 1.5 + Math.random() * (G.MAP_W - 3);
      y = 1.5 + Math.random() * (G.MAP_H - 3);
      z = 0;
    }
    if (!validSpot(x, y, z)) continue;
    let minD = 30, seen = false;
    for (const q of enemies) {
      minD = Math.min(minD, Math.hypot(q.x - x, q.y - y) + Math.abs(q.z - z));
      if (!seen && G.lineOfSight(q.x, q.y, q.z + G.GUN_H, x, y, z + G.GUN_H)) seen = true;
    }
    const score = Math.min(minD, 20) - (seen ? 12 : 0) + Math.random() * 6;
    if (score > bestScore) { bestScore = score; best = { x, y, z }; }
  }
  return best || G.SPAWNS[Math.floor(Math.random() * G.SPAWNS.length)];
}
function validSpot(x, y, z) {
  if (G.isBlocked(x, y, z) || Math.abs(G.groundAt(x, y, z + 0.01) - z) > 0.01) return false;
  if (z === 0 && (G.inWater(x, y) || G.PADS.some((d) => Math.hypot(d.x - x, d.y - y) < 1.4))) return false;
  return true;
}
// PvE: 스테이지 시작 지점 근처 (여러 명이면 옆으로 나란히)
function stageSpot(k) {
  const st = G.STAGES[W.stage ? W.stage.i : 0].start;
  const z = st.z || 0;
  for (let t = 0; t < 24; t++) {
    const a = (k + t) * 2.39996, r = t === 0 && k === 0 ? 0 : 0.9 + 0.45 * ((k + t) % 4);
    const x = st.x + Math.cos(a) * r, y = st.y + Math.sin(a) * r;
    if (validSpot(x, y, z)) return { x, y, z };
  }
  return { x: st.x, y: st.y, z };
}

function spawn(p, at = null, keepInv = false) {
  const pt = at || (W.mode === 'pve' ? stageSpot(Math.floor(Math.random() * 6)) : randomSpawnPoint(p));
  const now = Date.now();
  Object.assign(p, {
    x: pt.x, y: pt.y, z: pt.z, yaw: Math.atan2(G.MAP_H / 2 - pt.y, G.MAP_W / 2 - pt.x),
    hp: G.MAX_HP, alive: true, slot: keepInv ? p.slot : 0,
    reloadUntil: 0, lastShot: 0, protectUntil: now + (W.mode === 'pve' && keepInv ? 2500 : G.SPAWN_PROTECT_MS), respawnAt: 0,
    nades: G.NADE.count, lastNade: 0,
  });
  if (!keepInv || !p.inv) p.inv = [newItem('pistol'), W.mode === 'pve' ? newItem('rifle') : null, null];
  if (!keepInv && W.mode === 'pve') p.slot = 1;
  p.spawnSeq++;
  send(p, { type: 'spawn', x: p.x, y: p.y, z: p.z, yaw: p.yaw, sq: p.spawnSeq, prot: p.protectUntil - now, mode: W.mode });
}

function startReload(p) {
  const it = p.inv[p.slot];
  if (!it || p.reloadUntil) return;
  const w = G.WEAPONS[it.kind];
  if (it.mag >= w.mag) return;
  if (!w.infinite && it.reserve <= 0) return;
  p.reloadUntil = Date.now() + w.reload * 1000;
  p.reloadTotal = w.reload * 1000;
  p.reloadSlot = p.slot;
}

function killPlayer(v, k, wkind) {
  v.alive = false;
  v.hp = 0;
  v.deaths++;
  v.respawnAt = Date.now() + G.RESPAWN_MS;
  v.reloadUntil = 0;
  if (k && k !== v) k.kills++;
  const it = v.inv[v.slot];
  if (it && it.kind !== 'pistol' && !G.WEAPONS[it.kind].enemyOnly && it.mag + it.reserve > 0) addDropped(it, v.x, v.y, v.z, null);
  if (v.isBot) {
    v.removeAt = Date.now() + 1800;
    const boss = G.ENEMIES[v.type].boss;
    const drop = (kind, dx) => {
      const w = G.WEAPONS[kind];
      W.pickups.push({ id: W.nextPickupId++, kind, x: v.x + dx, y: v.y, z: v.z, active: true, isStatic: false,
        mag: w ? w.mag : 0, reserve: w ? w.reserve : 0, expireAt: Date.now() + 30000 });
    };
    if (boss) { drop('gatling', -0.6); drop('health', 0.6); }
    else if (G.ENEMIES[v.type].flee) { drop('health', 0.6); drop(['rifle', 'smg', 'shotgun'][Math.floor(Math.random() * 3)], -0.6); } // 보급병은 꼭 줌
    else {
      if (Math.random() < 0.25) drop('health', 0.6);
      if (Math.random() < 0.15) drop(['rifle', 'smg', 'shotgun', 'rifle'][Math.floor(Math.random() * 4)], -0.6);
    }
  }
  broadcast({ type: 'kill', k: k ? k.id : 0, v: v.id, w: wkind, x: r2(v.x), y: r2(v.y), z: r2(v.z) });
  if (!v.isBot || (k && !k.isBot)) W.rosterDirty = true;
}

// by: 공격한 쪽 (없을 수도 있음), src: 공격이 날아온 위치 (피격 방향 표시용)
function damage(t, dmg, by, wkind, hx, hy, hz, src) {
  if (!t.alive) return;
  const mark = by && by !== t && by.joined && !by.isBot;
  if (Date.now() < t.protectUntil) {
    if (mark) send(by, { type: 'hitm', id: t.id, dmg: 0, prot: 1, x: r2(hx), y: r2(hy), z: r2(hz) });
    return;
  }
  t.hp -= dmg;
  const kill = t.hp <= 0;
  const from = src || by || t;
  send(t, { type: 'hurt', dmg, fx: r2(from.x), fy: r2(from.y), by: by ? by.id : 0 });
  if (mark) send(by, { type: 'hitm', id: t.id, dmg, kill: kill ? 1 : 0, x: r2(hx), y: r2(hy), z: r2(hz) });
  if (t.isBot && by && !by.isBot) alertBot(t, by, Date.now());
  if (kill) killPlayer(t, by && by.joined ? by : null, wkind);
}
// PvE에서는 사람끼리, 적끼리는 서로 다치지 않음
function canHurt(by, q) {
  if (W.mode !== 'pve' || !by || by === q) return true;
  return !!by.isBot !== !!q.isBot;
}

/* ═════════════════════════ 부서지는 물체 (상자, 드럼통) ═════════════════════════ */
function damageProp(b, dmg, by) {
  if (b.dead || !b.hpMax) return;
  const s = propState(b);
  s.hp -= dmg;
  b.hp = s.hp;
  if (s.hp <= 0) breakProp(b, by);
}
function breakProp(b, by) {
  if (b.dead) return;
  const s = propState(b);
  b.dead = s.dead = true;
  b.hp = s.hp = 0;
  s.respawnAt = Date.now() + G.PROP_RESPAWN_MS;
  W.propsDirty = true;
  // 위에 쌓여 있던 상자/드럼통도 같이 무너짐
  for (const c of G.PROPS) {
    if (!c.dead && Math.abs(c.z0 - b.z1) < 0.05 && c.x0 < b.x1 && c.x1 > b.x0 && c.y0 < b.y1 && c.y1 > b.y0) breakProp(c, by);
  }
  // 빨간 드럼통은 폭발 (연쇄 폭발이 보이게 아주 잠깐 늦게)
  if (b.boom) {
    const x = (b.x0 + b.x1) / 2, y = (b.y0 + b.y1) / 2, z = b.z0 + 0.5;
    const world = W;
    setTimeout(() => { use(world); explode(x, y, z, G.BARREL.radius, G.BARREL.dmg, G.BARREL.minDmg, by, 'barrel'); }, 140);
  }
}
function updateProps(now) {
  G.PROPS.forEach((b, i) => {
    const s = W.props[i];
    if (!s.dead || now < s.respawnAt) return;
    // 받치던 물체가 아직 부서져 있거나 그 자리에 사람이 있으면 조금 뒤에 다시 시도
    const supported = b.z0 < 0.05 || G.BOXES.some((c) => !c.dead && Math.abs(c.z1 - b.z0) < 0.05
      && c.x0 < b.x1 && c.x1 > b.x0 && c.y0 < b.y1 && c.y1 > b.y0);
    const occupied = [...W.players.values()].some((p) => p.joined && p.alive
      && p.x > b.x0 - 0.6 && p.x < b.x1 + 0.6 && p.y > b.y0 - 0.6 && p.y < b.y1 + 0.6 && p.z < b.z1 && p.z + G.PLAYER_H > b.z0);
    if (!supported || occupied) { s.respawnAt = now + 2000; return; }
    b.dead = s.dead = false;
    b.hp = s.hp = b.hpMax;
    W.propsDirty = true;
  });
  if (W.propsDirty) {
    W.propsDirty = false;
    W.deadProps = G.PROPS.filter((b, i) => W.props[i].dead).map((b) => b.id);
  }
}

/* ═════════════════════════ 폭발 (수류탄, 빨간 드럼통) ═════════════════════════ */
function explode(x, y, z, radius, maxDmg, minDmg, by, wkind) {
  broadcast({ type: 'boom', x: r2(x), y: r2(y), z: r2(z), r: radius, k: wkind });
  const cz = z + 0.25;
  for (const q of [...W.players.values()]) {
    if (!q.joined || !q.alive || !canHurt(by, q)) continue;
    const d = Math.hypot(q.x - x, q.y - y, q.z + 0.9 - cz);
    if (d >= radius) continue;
    // 벽/상자 뒤에 있으면 안전 (몸의 세 지점 중 하나라도 보이면 피해)
    const seen = [0.3, 1.0, 1.6].some((h) => G.lineOfSight(x, y, cz, q.x, q.y, q.z + h));
    if (!seen) continue;
    let dmg = G.blastDamage(d, radius, maxDmg, minDmg);
    if (q === by) dmg = Math.round(dmg * G.NADE.selfMul);
    damage(q, dmg, by, wkind, q.x, q.y, q.z + 1, { x, y });
  }
  for (const b of G.PROPS) {
    if (b.dead) continue;
    const px = Math.max(b.x0, Math.min(x, b.x1)), py = Math.max(b.y0, Math.min(y, b.y1)), pz = Math.max(b.z0, Math.min(cz, b.z1));
    const d = Math.hypot(px - x, py - y, pz - cz);
    if (d < radius) damageProp(b, G.blastDamage(d, radius, maxDmg, minDmg) * 1.5, by);
  }
}

/* ═════════════════════════ 수류탄 ═════════════════════════ */
function launchNade(p, ox, oy, oz, tx, ty, tz, c = 0) {
  const now = Date.now();
  const v = G.nadeVelocity(ox, oy, oz, tx, ty, tz);
  const sim = G.simulateNade(ox, oy, oz, v[0], v[1], v[2]);
  const id = W.nextNadeId++;
  W.nades.push({ id, by: p, x: sim.x, y: sim.y, z: sim.z, at: now + G.NADE.fuse * 1000 });
  broadcast({ type: 'nade', id, by: p.id, pts: sim.pts, b: sim.bounces, c });
}
function throwNade(p, m) {
  const now = Date.now();
  if (!p.alive || p.nades <= 0 || now < p.protectUntil || now - p.lastNade < G.NADE.cooldown * 1000) return;
  if (!Array.isArray(m.t) || m.t.length !== 3 || !m.t.every(Number.isFinite)) return;
  let ox = p.x, oy = p.y, oz = p.z + 1.35;
  if (Array.isArray(m.o) && m.o.length === 3 && m.o.every(Number.isFinite)
    && Math.hypot(m.o[0] - ox, m.o[1] - oy, m.o[2] - oz) < 1.5) [ox, oy, oz] = m.o;
  p.nades--;
  p.lastNade = now;
  launchNade(p, ox, oy, oz, m.t[0], m.t[1], m.t[2], m.c | 0);
}
function updateNades(now) {
  for (let i = W.nades.length - 1; i >= 0; i--) {
    const n = W.nades[i];
    if (now < n.at) continue;
    W.nades.splice(i, 1);
    explode(n.x, n.y, n.z, G.NADE.radius, G.NADE.dmg, G.NADE.minDmg, n.by, 'grenade');
  }
}

/* ═════════════════════════ 사격 (사람) ═════════════════════════ */
function hitTargets(exceptBots) {
  const out = [];
  for (const q of W.players.values()) {
    if (!q.joined || !q.alive || (exceptBots && q.isBot)) continue;
    const def = q.isBot ? G.ENEMIES[q.type] : null;
    out.push({ id: q.id, x: q.x, y: q.y, z: q.z, r: def ? def.r : undefined, h: def ? def.h : undefined });
  }
  return out;
}
function fire(p, m) {
  p.ackFs = Math.max(p.ackFs, m.fs | 0);
  if (!p.alive || p.reloadUntil) return;
  const it = p.inv[p.slot];
  if (!it) return;
  const w = G.WEAPONS[it.kind];
  const now = Date.now();
  if (now < p.protectUntil) return; // 부활 무적 중에는 공격 불가
  if (now - p.lastShot < w.interval * 1000 * 0.8) return;
  if (it.mag <= 0) { startReload(p); return; }
  if (!Array.isArray(m.p) || m.p.length === 0) return;

  p.lastShot = now;
  it.mag--;

  // 클라이언트가 보낸 총구 위치가 서버 위치와 가까우면 사용
  let ox = p.x, oy = p.y, oz = p.z + G.GUN_H;
  if (Array.isArray(m.o) && m.o.length === 3 && m.o.every(Number.isFinite)) {
    if (Math.hypot(m.o[0] - ox, m.o[1] - oy, m.o[2] - oz) < 1.5) [ox, oy, oz] = m.o;
  }

  const ends = [];
  const dmgMap = new Map();
  const propDmg = new Map();
  for (const pel of m.p.slice(0, w.pellets)) {
    if (!Array.isArray(pel) || pel.length < 5) continue;
    let [dx, dy, dz, t, tid] = pel.map(Number);
    const len = Math.hypot(dx, dy, dz);
    if (!Number.isFinite(len) || len < 1e-6) continue;
    dx /= len; dy /= len; dz /= len;
    const wr = G.raycastWorld(ox, oy, oz, dx, dy, dz, w.range);
    let endT = wr.t, type = wr.hit ? 1 : 0;
    // 클라이언트 판정 검증: 벽을 뚫지 않았고, 사거리 안이며, 대상이 실제로 근처에 있을 것
    if (tid) {
      const q = W.players.get(tid);
      if (q && q !== p && q.alive && canHurt(p, q) && Number.isFinite(t) && t <= wr.t + 0.6 && t <= w.range + 0.5) {
        const hx = ox + dx * t, hy = oy + dy * t, hz = oz + dz * t;
        const d = Math.hypot(hx - q.x, hy - q.y, hz - (q.z + 1));
        if (d < 3.6) { // 인터넷 지연을 감안한 허용 오차
          endT = t; type = 2;
          const cur = dmgMap.get(q) || { dmg: 0, x: hx, y: hy, z: hz };
          cur.dmg += w.dmg;
          dmgMap.set(q, cur);
        }
      }
    }
    // 총알이 상자/드럼통에 맞으면 그 물체가 데미지를 받음
    if (type === 1 && wr.hit && wr.hit.hpMax) propDmg.set(wr.hit, (propDmg.get(wr.hit) || 0) + w.dmg);
    ends.push([r2(ox + dx * endT), r2(oy + dy * endT), r2(oz + dz * endT), type]);
  }

  broadcast({ type: 'shot', by: p.id, w: kindIndex(it.kind), o: [r2(ox), r2(oy), r2(oz)], e: ends }, p);
  for (const [q, h] of dmgMap) damage(q, h.dmg, p, it.kind, h.x, h.y, h.z);
  for (const [b, d] of propDmg) damageProp(b, d, p);
  if (it.mag === 0) startReload(p);
}

/* ═════════════════════════ PvE: 길찾기 (1층 바닥, 0.5m 격자) ═════════════════════════ */
const NAV = (() => {
  const S = 0.5, NX = G.MAP_W / S, NY = G.MAP_H / S;
  const walk = new Uint8Array(NX * NY);
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const x = (i + 0.5) * S, y = (j + 0.5) * S;
      walk[j * NX + i] = !G.isBlocked(x, y, 0) && G.groundAt(x, y, 0.01) < 0.35 ? (G.inWater(x, y) ? 3 : 1) : 0;
    }
  }
  return { S, NX, NY, walk };
})();
function nearestWalk(c) {
  const { NX, NY, walk } = NAV;
  const cx = c % NX, cy = Math.floor(c / NX);
  for (let r = 1; r < 8; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x >= 0 && y >= 0 && x < NX && y < NY && walk[y * NX + x]) return y * NX + x;
    }
  }
  return -1;
}
function findPath(x0, y0, x1, y1) {
  const { S, NX, NY, walk } = NAV;
  const cell = (x, y) => Math.max(0, Math.min(NY - 1, Math.floor(y / S))) * NX + Math.max(0, Math.min(NX - 1, Math.floor(x / S)));
  let s = cell(x0, y0), goal = cell(x1, y1);
  if (!walk[s]) s = nearestWalk(s);
  if (!walk[goal]) goal = nearestWalk(goal);
  if (s < 0 || goal < 0) return null;
  const N = NX * NY;
  const g = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const heap = [];
  const gx = goal % NX, gy = Math.floor(goal / NX);
  const h = (c) => { const dx = Math.abs(c % NX - gx), dy = Math.abs(Math.floor(c / NX) - gy); return Math.max(dx, dy) + 0.41 * Math.min(dx, dy); };
  const push = (c, f) => {
    heap.push([f, c]);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  g[s] = 0;
  push(s, h(s));
  let expanded = 0;
  while (heap.length && expanded < 9000) {
    const [, c] = pop();
    if (closed[c]) continue;
    closed[c] = 1;
    expanded++;
    if (c === goal) break;
    const cx = c % NX, cy = Math.floor(c / NX);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= NX || y >= NY) continue;
        const n = y * NX + x;
        if (!walk[n] || closed[n]) continue;
        if (dx && dy && (!walk[cy * NX + x] || !walk[y * NX + cx])) continue; // 모서리 끼임 방지
        const ng = g[c] + (dx && dy ? 1.414 : 1) * walk[n];
        if (ng < g[n]) { g[n] = ng; came[n] = c; push(n, ng + h(n)); }
      }
    }
  }
  if (came[goal] < 0 && goal !== s) return null;
  const path = [];
  for (let c = goal; c >= 0 && c !== s; c = came[c]) path.push({ x: (c % NX + 0.5) * S, y: (Math.floor(c / NX) + 0.5) * S });
  path.reverse();
  return path.filter((_, i) => i % 2 === 1 || i === path.length - 1);
}

/* ═════════════════════════ PvE: 적 ═════════════════════════ */
function makeBot(type, x, y, z = 0, fixed = false) {
  const def = G.ENEMIES[type];
  const n = Math.max(1, W.humans().length);
  const hpMul = 1 + (def.boss ? 0.6 : 0.45) * (n - 1);
  const b = {
    id: nextId++, isBot: true, ws: null, type, name: def.name, joined: true, alive: true, color: '#ff4d4d', char: -1,
    x, y, z, vz: 0, onGround: true, yaw: Math.random() * Math.PI * 2, hp: Math.round(def.hp * hpMul), hpMax: Math.round(def.hp * hpMul),
    inv: [newItem(def.weapon)], slot: 0, kills: 0, deaths: 0, spawnSeq: 1, protectUntil: 0, reloadUntil: 0, lastShot: 0,
    nades: 0, lastNade: 0, kneel: 0, ackFs: 0,
    home: { x, y, z }, fixed: fixed || !!def.stationary, target: 0, reactAt: 0, nextShotAt: 0, burstLeft: 0, lastSeen: null,
    strafe: 1, strafeUntil: 0, path: null, pathAt: 0, pathI: 0, stuckT: 0, wanderAt: Date.now() + Math.random() * 3000, wanderTo: null,
    laserAt: 0, cycle: 'idle', cycleUntil: 0, phase2: false, summons: 0, nextNadeAt: 0, removeAt: 0,
  };
  if (def.patrol) {
    for (let t = 0; t < 16; t++) {
      const a = Math.random() * Math.PI * 2;
      const px = x + Math.cos(a) * def.patrol, py = y + Math.sin(a) * def.patrol;
      if (px < 1 || py < 1 || px > G.MAP_W - 1 || py > G.MAP_H - 1 || !validSpot(px, py, z)) continue;
      if (!G.lineOfSight(x, y, z + 0.6, px, py, z + 0.6)) continue;
      b.patrolPts = [{ x, y }, { x: px, y: py }];
      b.patrolI = 1;
      break;
    }
  }
  W.players.set(b.id, b);
  return b;
}
function alertBot(b, src, now) {
  if (!b.alive) return;
  if (!b.lastSeen || now - b.lastSeen.t > 1500) b.lastSeen = { x: src.x, y: src.y, z: src.z, t: now };
}
function turnToward(b, yaw, dt, rate = 7) {
  let d = yaw - b.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  b.yaw += Math.max(-rate * dt, Math.min(rate * dt, d));
}

// ───── 적 공격: 눈에 보이는 느린 탄 + 쏘기 전 예고 (플레이어가 피할 수 있게) ─────
let nextProjId = 1;
let nextZoneId = 1;
// 탄 발사: (x,y,z)에서 yaw 방향으로. 서버가 직접 움직이며 판정, 클라이언트는 받은 정보로 그대로 그림
function shootProj(b, yaw, a, z = null) {
  const sc = G.ENEMIES[b.type].scale || 1;
  const ox = b.x + Math.cos(yaw) * 0.55 * sc, oy = b.y + Math.sin(yaw) * 0.55 * sc;
  const oz = z ?? b.z + G.GUN_H;
  const p = {
    id: nextProjId++, by: b, x: ox, y: oy, z: oz, vx: Math.cos(yaw) * a.speed, vy: Math.sin(yaw) * a.speed,
    r: a.r, dmg: a.dmg, until: Date.now() + (a.range / a.speed) * 1000, k: a.look || 'orb',
  };
  // 쏘자마자 벽 속이면 버림
  if (G.isBlocked(ox, oy, b.z) && G.raycastWorld(b.x, b.y, oz, Math.cos(yaw), Math.sin(yaw), 0, 0.6 * sc).hit) return;
  W.projs.push(p);
  broadcast({ type: 'proj', id: p.id, by: b.id, x: r2(ox), y: r2(oy), z: r2(oz), vx: r2(p.vx), vy: r2(p.vy), r: a.r, k: p.k, ms: Math.round(p.until - Date.now()) });
}
function updateProjs(now, dt) {
  const humans = [...W.players.values()].filter((q) => !q.isBot && q.joined && q.alive);
  for (let i = W.projs.length - 1; i >= 0; i--) {
    const p = W.projs[i];
    let gone = now >= p.until, hitWho = null;
    for (let s = 0; s < 3 && !gone; s++) {
      const sdt = dt / 3;
      const len = Math.hypot(p.vx, p.vy) * sdt;
      const w = G.raycastWorld(p.x, p.y, p.z, p.vx / Math.hypot(p.vx, p.vy), p.vy / Math.hypot(p.vx, p.vy), 0, len);
      if (w.hit) {
        gone = true;
        if (w.hit.hpMax) damageProp(w.hit, p.dmg, p.by);
        break;
      }
      p.x += p.vx * sdt;
      p.y += p.vy * sdt;
      for (const q of humans) {
        // 몸통 원기둥과 탄의 거리 (판정은 보이는 것보다 살짝 작게 → 아슬아슬하게 피해도 인정)
        if (p.z < q.z + 0.1 || p.z > q.z + G.PLAYER_H) continue;
        if (Math.hypot(q.x - p.x, q.y - p.y) < p.r + 0.3) { hitWho = q; gone = true; break; }
      }
    }
    if (!gone) continue;
    W.projs.splice(i, 1);
    broadcast({ type: 'pend', id: p.id, x: r2(p.x), y: r2(p.y), z: r2(p.z), hit: hitWho ? 1 : 0 });
    if (hitWho) damage(hitWho, p.dmg, p.by && p.by.alive ? p.by : null, p.by && p.by.inv ? p.by.inv[0].kind : 'blaster', p.x, p.y, p.z, { x: p.x - p.vx, y: p.y - p.vy });
  }
}
// 바닥 장판: 붉은 원이 먼저 깔리고 ms 뒤에 터짐 → 원 밖으로 피하면 안전
function placeZone(b, x, y, z, r, ms, dmg) {
  const zn = { id: nextZoneId++, by: b, x, y, z, r, at: Date.now() + ms, dmg };
  W.zones.push(zn);
  broadcast({ type: 'zone', id: zn.id, x: r2(x), y: r2(y), z: r2(z), r, ms });
}
function updateZones(now) {
  for (let i = W.zones.length - 1; i >= 0; i--) {
    const zn = W.zones[i];
    if (now < zn.at) continue;
    W.zones.splice(i, 1);
    broadcast({ type: 'zboom', id: zn.id });
    for (const q of [...W.players.values()]) {
      if (q.isBot || !q.joined || !q.alive) continue;
      if (Math.abs(q.z - zn.z) > 1.6 || Math.hypot(q.x - zn.x, q.y - zn.y) > zn.r + 0.2) continue;
      damage(q, zn.dmg, zn.by && zn.by.alive ? zn.by : null, 'zone', q.x, q.y, q.z + 1, { x: zn.x, y: zn.y });
    }
  }
}

function summon(boss, n) {
  boss.summons++;
  let made = 0;
  for (let t = 0; t < 30 && made < n; t++) {
    const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 4;
    const x = boss.x + Math.cos(a) * r, y = boss.y + Math.sin(a) * r;
    if (x < 1 || y < 1 || x > G.MAP_W - 1 || y > G.MAP_H - 1 || !validSpot(x, y, 0)) continue;
    const b = makeBot('trainee', x, y, 0);
    b.lastSeen = boss.lastSeen;
    made++;
  }
  broadcast({ type: 'sys', text: `${boss.name}: 호위병을 불렀습니다!` });
}

// 보스: 기본 탄막(부채꼴 / 원형 / 개틀링 난사) + 바닥 장판. 모든 공격은 예고가 있음
const BOSS_ATK = {
  fan: { speed: 8, r: 0.32, dmg: 10, range: 22, look: 'boss' },
  ring: { speed: 6, r: 0.34, dmg: 8, range: 20, look: 'boss' },
  spray: { speed: 9.5, r: 0.26, dmg: 6, range: 22, look: 'orb' },
};
function bossAttack(b, tgt, td, now, def) {
  if (!b.phase2 && b.hp < b.hpMax * 0.5) {
    b.phase2 = true;
    broadcast({ type: 'bossphase', id: b.id, phase: 2 });
    summon(b, 2);
  }
  const p2 = b.phase2;
  // 패턴 진행 중
  if (b.pat) {
    const P = b.pat;
    if (now < P.fireAt) return;
    const aim = Math.atan2(tgt.y - b.y, tgt.x - b.x);
    if (P.kind === 'fan') {
      const n = p2 ? 7 : 5, spread = 0.5;
      for (let i = 0; i < n; i++) shootProj(b, aim + (i / (n - 1) - 0.5) * spread * 2, BOSS_ATK.fan, b.z + 1.4);
      b.pat = null;
    } else if (P.kind === 'ring') {
      const n = 16;
      const off = P.shots % 2 ? Math.PI / n : 0;
      for (let i = 0; i < n; i++) shootProj(b, off + (i / n) * Math.PI * 2, BOSS_ATK.ring, b.z + 1.4);
      P.shots++;
      if (P.shots < (p2 ? 2 : 1)) P.fireAt = now + 650; else b.pat = null;
    } else if (P.kind === 'spray') {
      shootProj(b, aim + Math.sin(P.shots * 0.55) * 0.22, BOSS_ATK.spray, b.z + 1.3);
      P.shots++;
      P.fireAt = now + (p2 ? 100 : 130);
      if (P.shots >= (p2 ? 16 : 12)) { b.pat = null; setAvatarSpinMsg(b, 0); }
    } else if (P.kind === 'zones') {
      b.pat = null;
    }
    if (!b.pat) b.nextShotAt = now + (p2 ? 900 : 1300);
    return;
  }
  if (now < b.nextShotAt) return;
  // 다음 패턴 고르기 (같은 것만 반복하지 않게)
  const opts = ['fan', 'zones', 'spray', 'ring'].filter((k) => k !== b.lastPat);
  const kind = opts[Math.floor(Math.random() * opts.length)];
  b.lastPat = kind;
  if (kind === 'zones') {
    // 플레이어 발밑 + 주변에 붉은 원 → 1.4초 뒤 폭발
    const humans = [...W.players.values()].filter((q) => !q.isBot && q.joined && q.alive && Math.hypot(q.x - b.x, q.y - b.y) < 20);
    const spots = humans.map((q) => [q.x, q.y, q.z]);
    for (let k = spots.length; k < (p2 ? 5 : 3); k++) {
      const q = humans[k % Math.max(1, humans.length)] || tgt;
      const a = Math.random() * Math.PI * 2, r = 2.5 + Math.random() * 3;
      spots.push([q.x + Math.cos(a) * r, q.y + Math.sin(a) * r, q.z]);
    }
    for (const [x, y, z] of spots) placeZone(b, x, y, z, 2.1, p2 ? 1250 : 1500, 26);
    broadcast({ type: 'charge', id: b.id, ms: 500, k: 'zones' });
    b.pat = { kind, fireAt: now + 500, shots: 0 };
    return;
  }
  const charge = kind === 'spray' ? 650 : kind === 'ring' ? 700 : 500;
  broadcast({ type: 'charge', id: b.id, ms: charge, k: kind });
  if (kind === 'spray') setAvatarSpinMsg(b, 1);
  b.pat = { kind, fireAt: now + charge, shots: 0 };
}
function setAvatarSpinMsg(b, on) {
  if (on) broadcast({ type: 'spin', id: b.id, ms: 2600 });
}

function botAttack(b, tgt, td, now, def) {
  if (now < b.reactAt) return;
  if (def.boss) { bossAttack(b, tgt, td, now, def); return; }
  const a = def.atk;
  if (!a || td > a.range) return;
  // 예고(충전/레이저)가 끝나면 그 순간의 표적 위치로 쏨 → 움직이면 피함
  if (b.chargeUntil) {
    if (now < b.chargeUntil) return;
    b.chargeUntil = 0;
    const aim = b.lockYaw ?? Math.atan2(tgt.y - b.y, tgt.x - b.x);
    for (let i = 0; i < a.count; i++) {
      const off = a.count > 1 ? (i / (a.count - 1) - 0.5) * a.spread * 2 : 0;
      shootProj(b, aim + off, a);
    }
    b.lockYaw = null;
    b.nextShotAt = now + randIn(a.cooldown) * 1000;
    if (a.rest) broadcast({ type: 'rest', id: b.id, ms: Math.round(b.nextShotAt - now) }); // 저격수: 쏘고 나면 꾸벅꾸벅
    return;
  }
  if (now < b.nextShotAt) return;
  // 동시에 공격을 준비하는 적이 너무 많으면 잠깐 기다림
  let busy = 0;
  for (const o of W.players.values()) if (o.isBot && o !== b && o.alive && o.chargeUntil > now) busy++;
  if (busy >= G.MAX_ATTACKERS) { b.nextShotAt = now + 400 + Math.random() * 700; return; }
  const ms = a.charge * 1000;
  b.chargeUntil = now + ms;
  if (a.alert) {
    broadcast({ type: 'charge', id: b.id, ms, k: 'alert' }); // 머리 위에 '!' 뜬 뒤 쏨
  } else if (a.laser) {
    // 저격수: 레이저가 겨눈 방향을 마지막 0.35초에 고정 → 레이저를 보고 옆으로 피하면 됨
    broadcast({ type: 'laser', id: b.id, to: tgt.id, ms });
    const lockAt = ms - 350;
    setTimeout(() => {
      if (!b.alive) return;
      const t = W.players.get(tgt.id);
      if (t) b.lockYaw = Math.atan2(t.y - b.y, t.x - b.x);
    }, Math.max(0, lockAt));
  } else {
    broadcast({ type: 'charge', id: b.id, ms, k: 'shot' });
  }
}

function followPath(b, tx, ty, now) {
  if (!b.path || now - b.pathAt > 1500) {
    b.path = findPath(b.x, b.y, tx, ty);
    b.pathAt = now;
    b.pathI = 0;
  }
  if (!b.path) {
    const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy) || 1;
    return [dx / d, dy / d];
  }
  let wp = b.path[b.pathI];
  while (wp && Math.hypot(wp.x - b.x, wp.y - b.y) < 0.5) { b.pathI++; wp = b.path[b.pathI]; }
  if (!wp) return null;
  const dx = wp.x - b.x, dy = wp.y - b.y, d = Math.hypot(dx, dy) || 1;
  return [dx / d, dy / d];
}

function botMove(b, tgt, td, now, dt, def) {
  let mx = 0, my = 0, speed = def.speed;
  if (def.flee) {
    // 겁쟁이 보급병: 가까운 플레이어 반대쪽으로 도망 (막히면 옆으로)
    let near = null, nd = def.sight;
    for (const p of W.players.values()) {
      if (p.isBot || !p.joined || !p.alive) continue;
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d < nd) { nd = d; near = p; }
    }
    if (near) {
      const ax = (b.x - near.x) / (nd || 1), ay = (b.y - near.y) / (nd || 1);
      mx = ax - ay * b.strafe * 0.6;
      my = ay + ax * b.strafe * 0.6;
      turnToward(b, Math.atan2(my, mx), dt, 8);
      if (now > b.strafeUntil) { b.strafe = Math.random() < 0.5 ? -1 : 1; b.strafeUntil = now + 1200 + Math.random() * 1500; }
      tgt = null;
    } else {
      speed *= 0.4;
    }
  }
  if (def.flee) {
    // (위에서 방향을 정함)
  } else if (tgt) {
    const dx = (tgt.x - b.x) / (td || 1), dy = (tgt.y - b.y) / (td || 1);
    const [rmin, rmax] = def.range;
    if (td > rmax) { mx += dx; my += dy; } else if (td < rmin) { mx -= dx; my -= dy; }
    if (now > b.strafeUntil) {
      const r = Math.random();
      b.strafe = r < 0.4 ? -1 : r < 0.8 ? 1 : 0;
      b.strafeUntil = now + 700 + Math.random() * 1300;
    }
    mx += -dy * b.strafe * 0.8;
    my += dx * b.strafe * 0.8;
    b.path = null;
  } else if (b.lastSeen && now - b.lastSeen.t < 9000) {
    // 마지막으로 본 곳까지 길을 찾아감
    const L = b.lastSeen;
    if (Math.hypot(L.x - b.x, L.y - b.y) < 1.2) b.lastSeen = null;
    else {
      const step = followPath(b, L.x, L.y, now);
      if (step) { [mx, my] = step; turnToward(b, Math.atan2(my, mx), dt, 5); }
    }
  } else if (def.patrol && b.patrolPts) {
    // 순찰: 두 지점을 천천히 왕복
    speed *= 0.6;
    const t = b.patrolPts[b.patrolI];
    const dx = t.x - b.x, dy = t.y - b.y, d = Math.hypot(dx, dy);
    if (d < 0.4) b.patrolI = 1 - b.patrolI;
    else { mx = dx / d; my = dy / d; turnToward(b, Math.atan2(dy, dx), dt, 4); }
  } else {
    // 자기 자리 근처를 천천히 어슬렁거림
    speed *= 0.45;
    if (now > b.wanderAt) {
      b.wanderAt = now + 2500 + Math.random() * 3500;
      const a = Math.random() * Math.PI * 2;
      b.wanderTo = Math.random() < 0.6 ? { x: b.home.x + Math.cos(a) * 2.5, y: b.home.y + Math.sin(a) * 2.5 } : null;
    }
    if (b.wanderTo) {
      const dx = b.wanderTo.x - b.x, dy = b.wanderTo.y - b.y, d = Math.hypot(dx, dy);
      if (d > 0.3) { mx = dx / d; my = dy / d; turnToward(b, Math.atan2(dy, dx), dt, 4); } else b.wanderTo = null;
    }
  }
  const len = Math.hypot(mx, my);
  if (len > 1) { mx /= len; my /= len; }
  const k = speed / G.MOVE_SPEED;
  const ox = b.x, oy = b.y;
  G.stepMove(b, mx * k, my * k, dt);
  b.evt = null;
  if (len > 0.1 && Math.hypot(b.x - ox, b.y - oy) < 0.01) {
    b.stuckT += dt;
    if (b.stuckT > 0.5) { b.strafe = -b.strafe || 1; b.strafeUntil = now + 900; b.path = null; b.wanderTo = null; b.stuckT = 0; }
  } else b.stuckT = 0;
}

function botTick(b, now, dt) {
  if (!b.alive) {
    if (b.removeAt && now >= b.removeAt) W.players.delete(b.id);
    return;
  }
  const def = G.ENEMIES[b.type];
  const it = b.inv[0];
  const w = G.WEAPONS[it.kind];
  const eyeZ = b.z + G.GUN_H * Math.min(def.scale || 1, 1.25);
  let tgt = null, td = Infinity;
  for (const p of W.players.values()) {
    if (p.isBot || !p.joined || !p.alive) continue;
    const d = Math.hypot(p.x - b.x, p.y - b.y);
    if (d > def.sight || d >= td) continue;
    if (!G.lineOfSight(b.x, b.y, eyeZ, p.x, p.y, p.z + 1.0)) continue;
    td = d;
    tgt = p;
  }
  if (tgt) {
    if (b.target !== tgt.id) {
      b.target = tgt.id;
      b.reactAt = Math.max(b.reactAt, now + def.react * 1000);
      for (const o of W.players.values()) { // 근처 동료에게 알림
        if (o.isBot && o !== b && o.alive && !o.target && Math.hypot(o.x - b.x, o.y - b.y) < 14) alertBot(o, tgt, now);
      }
    }
    b.lastSeen = { x: tgt.x, y: tgt.y, z: tgt.z, t: now };
    turnToward(b, Math.atan2(tgt.y - b.y, tgt.x - b.x), dt);
    botAttack(b, tgt, td, now, def);
  } else {
    if (b.target) b.reactAt = now + def.react * 600;
    b.target = 0;
    b.chargeUntil = 0;
  }
  if (!b.fixed) botMove(b, tgt, td, now, dt, def);
  else G.stepMove(b, 0, 0, dt);
}

/* ═════════════════════════ PvE: 스테이지 ═════════════════════════ */
function spawnEnemies(list) {
  for (const [type, x, y, z = 0, fixed = false] of list) makeBot(type, x, y, z, fixed);
}
function startStage(i, now) {
  for (const b of W.bots()) W.players.delete(b.id);
  W.nades.length = 0;
  for (const p of W.projs) broadcast({ type: 'pend', id: p.id });
  W.projs.length = 0;
  W.zones.length = 0;
  const def = G.STAGES[i];
  if (i === 0) { W.resetProps(); use(W); W.resetPickups(); }
  W.stage = { i, phase: 'fight', waveDone: !def.wave, until: 0, startedAt: now, bossId: 0 };
  spawnEnemies(def.enemies);
  const boss = W.bots().find((b) => G.ENEMIES[b.type].boss);
  if (boss) W.stage.bossId = boss.id;
  // 모두 새 스테이지 시작 지점으로 (살아 있으면 무기 유지 + 체력 회복)
  W.humans().forEach((p, k) => {
    if (i === 0) { p.inv = null; spawn(p, stageSpot(k)); } else spawn(p, stageSpot(k), p.alive);
  });
  broadcast({ type: 'stage', ev: 'start', i });
  log(`[PvE] 스테이지 ${def.id} ${def.name} 시작 (${W.humans().length}명)`);
}
function pveTick(now, dt) {
  const humans = W.humans();
  if (!humans.length) {
    if (W.stage) { for (const b of W.bots()) W.players.delete(b.id); W.stage = null; }
    return;
  }
  if (!W.stage) { startStage(0, now); return; }
  const st = W.stage;
  for (const b of W.bots()) botTick(b, now, dt);
  updateProjs(now, dt);
  updateZones(now);
  const alive = W.bots().filter((b) => b.alive).length;
  if (st.phase === 'fight') {
    const def = G.STAGES[st.i];
    if (!st.waveDone && alive <= def.wave.at) {
      st.waveDone = true;
      spawnEnemies(def.wave.enemies);
      broadcast({ type: 'stage', ev: 'wave', i: st.i });
    } else if (alive === 0 && st.waveDone) {
      const last = st.i === G.STAGES.length - 1;
      st.phase = last ? 'allclear' : 'clear';
      st.until = now + (last ? 15000 : 4500);
      st.time = now - st.startedAt;
      broadcast({ type: 'stage', ev: last ? 'allclear' : 'clear', i: st.i, ms: st.time });
      log(`[PvE] 스테이지 ${def.id} 클리어`);
    }
  } else if (now >= st.until) {
    startStage(st.phase === 'allclear' ? 0 : st.i + 1, now);
  }
}

/* ═════════════════════════ 메시지 / 틱 ═════════════════════════ */
function sanitizeName(s) {
  return String(s ?? '').replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);
}

const sessions = new Map(); // 재접속용: key → { kills, deaths, color, mode, expireAt }
const SESSION_KEEP_MS = 60000;
const conns = new Map();    // 접속한 모든 연결 (입장 전 포함)

export function connect(ws, via) {
  const id = nextId++;
  const p = {
    id, ws, via, key: '', name: '', joined: false, color: colorFor(id), world: null,
    x: G.MAP_W / 2, y: G.MAP_H / 2, z: 0, yaw: 0, hp: G.MAX_HP, alive: false, kills: 0, deaths: 0, char: 0, nades: 0, lastNade: 0,
    inv: [null, null, null], slot: 0, lastShot: 0, reloadUntil: 0, reloadTotal: 0, reloadSlot: 0,
    respawnAt: 0, spawnSeq: 0, protectUntil: 0, ackFs: 0, lastSeen: Date.now(), lastMoveAt: 0,
  };
  conns.set(id, p);
  send(p, { type: 'welcome', id, color: p.color });
  return p;
}

export function message(p, m) {
  p.lastSeen = Date.now();
  if (!m || typeof m.type !== 'string') return;
  if (m.type === 'ping') { send(p, { type: 'pong', t: m.t }); return; }
  if (m.type === 'join') { join(p, m); return; }
  if (!p.world) return;
  use(p.world);
  switch (m.type) {
    case 'st': {
      if (!p.joined || !p.alive || m.sq !== p.spawnSeq) return;
      const { x, y, z, yaw } = m;
      if (![x, y, z, yaw].every(Number.isFinite)) return;
      const nx = Math.max(0, Math.min(G.MAP_W, x)), ny = Math.max(0, Math.min(G.MAP_H, y));
      if (Math.hypot(nx - p.x, ny - p.y) > 0.02) p.lastMoveAt = Date.now();
      p.x = nx;
      p.y = ny;
      p.z = Math.max(0, Math.min(10, z));
      p.yaw = yaw;
      p.kneel = m.k ? 1 : 0; // 무릎 쏴 자세 (모습만)
      break;
    }
    case 'fire': fire(p, m); break;
    case 'nade': throwNade(p, m); break;
    case 'slot': {
      const i = m.i | 0;
      if (i >= 0 && i < G.SLOT_COUNT && p.inv[i] && p.slot !== i) { p.slot = i; p.reloadUntil = 0; }
      break;
    }
    case 'reload': if (p.alive) startReload(p); break;
    case 'swap': swap(p); break;
    case 'chat': {
      if (!p.joined) return;
      const text = String(m.text ?? '').trim().slice(0, 100);
      // 서버를 켠 PC에서만: /stage 3 → PvE 스테이지 1-3으로 바로 이동 (시험용)
      const sm = /^\/stage\s+([1-5])$/.exec(text);
      if (sm && W.mode === 'pve' && p.via === '이 PC') { startStage(Number(sm[1]) - 1, Date.now()); return; }
      if (text) broadcast({ type: 'chat', id: p.id, name: p.name, color: p.color, text });
      break;
    }
  }
}

function join(p, m) {
  if (p.joined) return;
  const mode = m.mode === 'pve' ? 'pve' : 'pvp';
  p.world = worlds[mode];
  use(p.world);
  p.name = sanitizeName(m.name) || `플레이어${p.id}`;
  p.char = Math.max(0, Math.min(G.CHARACTER_COUNT - 1, m.char | 0));
  p.key = typeof m.key === 'string' ? m.key.slice(0, 64) : '';
  let resumed = false;
  if (p.key) {
    // 같은 키로 아직 남아 있는 옛 연결(반쯤 끊긴 연결)이 있으면 넘겨받고 정리
    for (const q of conns.values()) {
      if (q !== p && q.joined && q.key === p.key) {
        if (q.world === p.world) Object.assign(p, { kills: q.kills, deaths: q.deaths, color: q.color });
        q.joined = false;
        q.replaced = true;
        if (q.world) q.world.players.delete(q.id);
        q.ws.terminate();
        resumed = true;
      }
    }
    // 최근에 끊긴 사람이면 점수와 색을 이어받음
    const s = sessions.get(p.key);
    if (!resumed && s && s.expireAt > Date.now() && s.mode === mode) {
      Object.assign(p, { kills: s.kills, deaths: s.deaths, color: s.color });
      resumed = true;
    }
    sessions.delete(p.key);
  }
  p.joined = true;
  W.players.set(p.id, p);
  if (mode === 'pve' && W.stage) spawn(p, stageSpot(W.humans().length - 1));
  else if (mode === 'pvp') spawn(p);
  W.rosterDirty = true;
  if (mode === 'pve' && W.stage) send(p, { type: 'stage', ev: 'start', i: W.stage.i, late: 1 });
  const where = mode === 'pve' ? 'PvE' : 'PvP';
  sys(resumed ? `${p.name} 님이 다시 연결했습니다` : `${p.name} 님이 입장했습니다 (${where})`);
  log(`[${resumed ? '재접속' : '입장'}] ${p.name} (${p.via}, ${where})`);
}

export function disconnect(p, code, why) {
  conns.delete(p.id);
  if (!p.world) return;
  use(p.world);
  W.players.delete(p.id);
  if (!p.joined || p.replaced) return;
  const normal = code === 1000 || code === 1001;
  if (p.key) sessions.set(p.key, { kills: p.kills, deaths: p.deaths, color: p.color, mode: W.mode, expireAt: Date.now() + SESSION_KEEP_MS });
  sys(normal ? `${p.name} 님이 나갔습니다` : `${p.name} 님의 연결이 끊어졌습니다`);
  log(`[${normal ? '퇴장' : '끊김'}] ${p.name} (${p.via}) - 코드 ${code}, ${why}`);
  W.rosterDirty = true;
}

// 하트비트: 응답이 없는 연결(반쯤 끊긴 연결)을 정리해서 맵에 멈춘 유령 플레이어가 남지 않게 함
export function heartbeat(deadAfterMs) {
  const now = Date.now();
  for (const p of conns.values()) {
    if (p.ws.readyState !== 1) continue;
    if (now - p.lastSeen > deadAfterMs) {
      p.timedOut = true;
      p.ws.terminate();
      continue;
    }
    try { p.ws.ping(); } catch { /* 무시 */ }
  }
  for (const [k, s] of sessions) if (s.expireAt < now) sessions.delete(k);
}
export function touch(p) { p.lastSeen = Date.now(); }

const TICK_MS = 50;
function tickWorld(world, now) {
  use(world);
  for (const p of W.players.values()) {
    if (!p.joined || p.isBot) continue;
    if (!p.alive && p.respawnAt && now >= p.respawnAt) spawn(p);
    if (p.reloadUntil && now >= p.reloadUntil) {
      const it = p.inv[p.reloadSlot];
      if (it && p.reloadSlot === p.slot) {
        const w = G.WEAPONS[it.kind];
        const need = w.mag - it.mag;
        const take = w.infinite ? need : Math.min(need, it.reserve);
        it.mag += take;
        if (!w.infinite) it.reserve -= take;
      }
      p.reloadUntil = 0;
    }
  }
  if (W.mode === 'pve') pveTick(now, TICK_MS / 1000);

  for (const pk of W.pickups) {
    if (!pk.active) {
      if (pk.isStatic && now >= pk.respawnAt) relocatePickup(pk);
      continue;
    }
    if (pk.expireAt && now >= pk.expireAt) { pk.remove = true; continue; }
    for (const p of W.players.values()) {
      if (!p.joined || !p.alive || p.isBot) continue;
      if (Math.hypot(p.x - pk.x, p.y - pk.y) > G.PICK_R || Math.abs(p.z - pk.z) > 1.2) continue;
      if (pk.noPick === p.id && now < pk.noPickUntil) continue;
      if (tryAutoPick(p, pk)) { consumePickup(pk); break; }
    }
  }
  for (let i = W.pickups.length - 1; i >= 0; i--) if (W.pickups[i].remove) W.pickups.splice(i, 1);
  updateNades(now);
  updateProps(now);

  if (W.rosterDirty) { W.rosterDirty = false; sendRoster(); }
  if (!W.humans().length) return;

  // 스냅샷: [id,x,y,z,yaw,hp,살았나,무기,무적,무릎,적종류(0=사람)]
  const ps = [];
  for (const p of W.players.values()) {
    if (!p.joined) continue;
    const it = p.inv[p.slot];
    ps.push([p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.yaw), Math.max(0, Math.round(p.hp)), p.alive ? 1 : 0,
      it ? kindIndex(it.kind) : -1, now < p.protectUntil ? 1 : 0, p.alive && p.kneel ? 1 : 0,
      p.isBot ? G.ENEMY_KINDS.indexOf(p.type) + 1 : 0]);
  }
  const pk = W.pickups.filter((q) => q.active).map((q) => [q.id, kindIndex(q.kind), q.x, q.y, q.z]);
  let sg = null;
  if (W.mode === 'pve' && W.stage) {
    const st = W.stage;
    const boss = st.bossId ? W.players.get(st.bossId) : null;
    sg = [st.i, st.phase === 'fight' ? 0 : st.phase === 'clear' ? 1 : 2, W.bots().filter((b) => b.alive).length,
      boss ? Math.max(0, Math.round(boss.hp)) : 0, boss ? boss.hpMax : 0, boss ? boss.id : 0, boss && boss.phase2 ? 2 : 1];
  }
  for (const p of W.players.values()) {
    if (!p.joined || p.isBot || !p.ws || p.ws.readyState !== 1) continue;
    const me = {
      inv: p.inv.map((it) => (it ? [kindIndex(it.kind), it.mag, it.reserve] : null)),
      slot: p.slot,
      rl: p.reloadUntil ? Math.max(0, p.reloadUntil - now) : 0,
      rt: p.reloadTotal || 0,
      ack: p.ackFs,
      ra: p.alive ? 0 : Math.max(0, p.respawnAt - now),
      gn: p.alive ? p.nades : 0,
      pt: p.alive ? Math.max(0, p.protectUntil - now) : 0,
    };
    p.ws.send(JSON.stringify({ type: 'snap', t: now, ps, pk, me, dp: W.deadProps, sg }));
  }
}
setInterval(() => {
  const now = Date.now();
  for (const world of Object.values(worlds)) {
    try { tickWorld(world, now); } catch (err) { log(`[오류] ${world.mode} 틱: ${err.stack || err.message}`); }
  }
}, TICK_MS);
