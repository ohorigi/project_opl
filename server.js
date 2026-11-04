// 개선OPL 서버 - 정적 파일 + WebSocket 멀티플레이
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as G from './shared/common.js';

process.title = G.GAME_NAME;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 7777;
const OPEN_BROWSER = process.argv.includes('--open');

// ───────────────────────── 정적 파일 ─────────────────────────
const ROUTES = [
  ['/shared/', path.join(__dirname, 'shared')],
  ['/lib/', path.join(__dirname, 'node_modules', 'three', 'build')],
  ['/', path.join(__dirname, 'public')],
];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  if (url === '/') url = '/index.html';
  for (const [prefix, root] of ROUTES) {
    if (!url.startsWith(prefix)) continue;
    const file = path.normalize(path.join(root, url.slice(prefix.length)));
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
    return;
  }
  res.writeHead(404); res.end();
});

// ───────────────────────── 게임 상태 ─────────────────────────
const players = new Map();
const pickups = [];
let nextId = 1;
let nextPickupId = 1;
let rosterDirty = false;

const r2 = (v) => Math.round(v * 100) / 100;
const kindIndex = (k) => G.PICKUP_KINDS.indexOf(k);

function newItem(kind) {
  const w = G.WEAPONS[kind];
  return { kind, mag: w.mag, reserve: w.reserve };
}

function ammoFor(kind) {
  const w = G.WEAPONS[kind];
  return w ? { mag: w.mag, reserve: w.reserve } : { mag: 0, reserve: 0 };
}

for (const s of G.PICKUP_SPOTS) {
  pickups.push({ id: nextPickupId++, kind: s.kind, x: s.x, y: s.y, z: s.z, active: true, respawnAt: 0, isStatic: true, ...ammoFor(s.kind) });
}

function addDropped(item, x, y, z, noPickId) {
  const now = Date.now();
  pickups.push({
    id: nextPickupId++, kind: item.kind, x, y, z, active: true, isStatic: false,
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

function colorFor(id) {
  const hue = Math.round((id * 137.508) % 360);
  return `hsl(${hue}, 75%, 58%)`;
}

function send(p, msg) {
  if (p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
}
function broadcast(msg, except) {
  const s = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p !== except && p.joined && p.ws.readyState === 1) p.ws.send(s);
  }
}
function sys(text) { broadcast({ type: 'sys', text }); }

function sendRoster() {
  const list = [...players.values()].filter((p) => p.joined)
    .map((p) => ({ id: p.id, name: p.name, color: p.color, kills: p.kills, deaths: p.deaths }));
  broadcast({ type: 'roster', list });
}

function spawn(p) {
  const others = [...players.values()].filter((q) => q !== p && q.joined && q.alive);
  let best = G.SPAWNS[0], bestD = -1;
  for (const s of G.SPAWNS) {
    let d = 1000;
    for (const q of others) d = Math.min(d, Math.hypot(q.x - s.x, q.y - s.y) + Math.abs(q.z - s.z) * 2);
    d += Math.random() * 8;
    if (d > bestD) { bestD = d; best = s; }
  }
  const now = Date.now();
  Object.assign(p, {
    x: best.x, y: best.y, z: best.z, yaw: Math.atan2(G.MAP_H / 2 - best.y, G.MAP_W / 2 - best.x),
    hp: G.MAX_HP, alive: true, inv: [newItem('pistol'), null, null], slot: 0,
    reloadUntil: 0, lastShot: 0, protectUntil: now + G.SPAWN_PROTECT_MS, respawnAt: 0,
  });
  p.spawnSeq++;
  send(p, { type: 'spawn', x: p.x, y: p.y, z: p.z, yaw: p.yaw, sq: p.spawnSeq });
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
  if (it && it.kind !== 'pistol' && it.mag + it.reserve > 0) addDropped(it, v.x, v.y, v.z, null);
  broadcast({ type: 'kill', k: k ? k.id : 0, v: v.id, w: wkind, x: r2(v.x), y: r2(v.y), z: r2(v.z) });
  rosterDirty = true;
}

function damage(t, dmg, by, wkind, hx, hy, hz) {
  if (!t.alive) return;
  if (Date.now() < t.protectUntil) {
    send(by, { type: 'hitm', id: t.id, dmg: 0, prot: 1, x: r2(hx), y: r2(hy), z: r2(hz) });
    return;
  }
  t.hp -= dmg;
  const kill = t.hp <= 0;
  send(t, { type: 'hurt', dmg, fx: r2(by.x), fy: r2(by.y), by: by.id });
  send(by, { type: 'hitm', id: t.id, dmg, kill: kill ? 1 : 0, x: r2(hx), y: r2(hy), z: r2(hz) });
  if (kill) killPlayer(t, by, wkind);
}

function fire(p, m) {
  p.ackFs = Math.max(p.ackFs, m.fs | 0);
  if (!p.alive || p.reloadUntil) return;
  const it = p.inv[p.slot];
  if (!it) return;
  const w = G.WEAPONS[it.kind];
  const now = Date.now();
  if (now - p.lastShot < w.interval * 1000 * 0.8) return;
  if (it.mag <= 0) { startReload(p); return; }
  if (!Array.isArray(m.p) || m.p.length === 0) return;

  p.lastShot = now;
  it.mag--;
  p.protectUntil = 0;

  // 클라이언트가 보낸 총구 위치가 서버 위치와 가까우면 사용
  let ox = p.x, oy = p.y, oz = p.z + G.GUN_H;
  if (Array.isArray(m.o) && m.o.length === 3 && m.o.every(Number.isFinite)) {
    if (Math.hypot(m.o[0] - ox, m.o[1] - oy, m.o[2] - oz) < 1.5) [ox, oy, oz] = m.o;
  }

  const ends = [];
  const dmgMap = new Map();
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
      const q = players.get(tid);
      if (q && q !== p && q.alive && Number.isFinite(t) && t <= wr.t + 0.6 && t <= w.range + 0.5) {
        const hx = ox + dx * t, hy = oy + dy * t, hz = oz + dz * t;
        const d = Math.hypot(hx - q.x, hy - q.y, hz - (q.z + 1));
        if (d < 2.4) {
          endT = t; type = 2;
          const cur = dmgMap.get(q) || { dmg: 0, x: hx, y: hy, z: hz };
          cur.dmg += w.dmg;
          dmgMap.set(q, cur);
        }
      }
    }
    ends.push([r2(ox + dx * endT), r2(oy + dy * endT), r2(oz + dz * endT), type]);
  }

  broadcast({ type: 'shot', by: p.id, w: kindIndex(it.kind), o: [r2(ox), r2(oy), r2(oz)], e: ends }, p);
  for (const [q, h] of dmgMap) damage(q, h.dmg, p, it.kind, h.x, h.y, h.z);
  if (it.mag === 0) startReload(p);
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
  for (const pk of pickups) {
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

function sanitizeName(s) {
  return String(s ?? '').replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);
}

function handle(p, m) {
  if (!m || typeof m.type !== 'string') return;
  switch (m.type) {
    case 'join': {
      if (p.joined) return;
      p.name = sanitizeName(m.name) || `플레이어${p.id}`;
      p.joined = true;
      spawn(p);
      rosterDirty = true;
      sys(`${p.name} 님이 입장했습니다`);
      break;
    }
    case 'st': {
      if (!p.joined || !p.alive || m.sq !== p.spawnSeq) return;
      const { x, y, z, yaw } = m;
      if (![x, y, z, yaw].every(Number.isFinite)) return;
      p.x = Math.max(0, Math.min(G.MAP_W, x));
      p.y = Math.max(0, Math.min(G.MAP_H, y));
      p.z = Math.max(0, Math.min(10, z));
      p.yaw = yaw;
      break;
    }
    case 'fire': fire(p, m); break;
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
      if (text) broadcast({ type: 'chat', id: p.id, name: p.name, color: p.color, text });
      break;
    }
    case 'ping': send(p, { type: 'pong', t: m.t }); break;
  }
}

// ───────────────────────── 틱 ─────────────────────────
const TICK_MS = 50;
setInterval(() => {
  const now = Date.now();

  for (const p of players.values()) {
    if (!p.joined) continue;
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

  for (const pk of pickups) {
    if (!pk.active) {
      if (pk.isStatic && now >= pk.respawnAt) { pk.active = true; Object.assign(pk, ammoFor(pk.kind)); }
      continue;
    }
    if (pk.expireAt && now >= pk.expireAt) { pk.remove = true; continue; }
    for (const p of players.values()) {
      if (!p.joined || !p.alive) continue;
      if (Math.hypot(p.x - pk.x, p.y - pk.y) > G.PICK_R || Math.abs(p.z - pk.z) > 1.2) continue;
      if (pk.noPick === p.id && now < pk.noPickUntil) continue;
      if (tryAutoPick(p, pk)) { consumePickup(pk); break; }
    }
  }
  for (let i = pickups.length - 1; i >= 0; i--) if (pickups[i].remove) pickups.splice(i, 1);

  if (rosterDirty) { rosterDirty = false; sendRoster(); }

  // 스냅샷
  const ps = [];
  for (const p of players.values()) {
    if (!p.joined) continue;
    const it = p.inv[p.slot];
    ps.push([p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.yaw), Math.max(0, Math.round(p.hp)), p.alive ? 1 : 0,
      it ? kindIndex(it.kind) : -1, now < p.protectUntil ? 1 : 0]);
  }
  const pk = pickups.filter((q) => q.active).map((q) => [q.id, kindIndex(q.kind), q.x, q.y, q.z]);
  for (const p of players.values()) {
    if (!p.joined || p.ws.readyState !== 1) continue;
    const me = {
      inv: p.inv.map((it) => (it ? [kindIndex(it.kind), it.mag, it.reserve] : null)),
      slot: p.slot,
      rl: p.reloadUntil ? Math.max(0, p.reloadUntil - now) : 0,
      rt: p.reloadTotal || 0,
      ack: p.ackFs,
      ra: p.alive ? 0 : Math.max(0, p.respawnAt - now),
    };
    p.ws.send(JSON.stringify({ type: 'snap', t: now, ps, pk, me }));
  }
}, TICK_MS);

// ───────────────────────── 접속 ─────────────────────────
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });
wss.on('connection', (ws) => {
  const id = nextId++;
  const p = {
    id, ws, name: '', joined: false, color: colorFor(id),
    x: 32, y: 32, z: 0, yaw: 0, hp: G.MAX_HP, alive: false, kills: 0, deaths: 0,
    inv: [null, null, null], slot: 0, lastShot: 0, reloadUntil: 0, reloadTotal: 0, reloadSlot: 0,
    respawnAt: 0, spawnSeq: 0, protectUntil: 0, ackFs: 0,
  };
  players.set(id, p);
  send(p, { type: 'welcome', id, color: p.color });

  ws.on('message', (data) => {
    let m;
    try { m = JSON.parse(data); } catch { return; }
    handle(p, m);
  });
  ws.on('close', () => {
    players.delete(id);
    if (p.joined) {
      sys(`${p.name} 님이 나갔습니다`);
      rosterDirty = true;
    }
  });
  ws.on('error', () => {});
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[${G.GAME_NAME}] 포트 ${PORT}가 이미 사용 중입니다. 이미 실행 중인 서버를 끄거나 PORT 환경변수로 다른 포트를 지정하세요.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ${G.GAME_NAME} 서버 실행 중\n`);
  console.log(`  내 PC:      http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  같은 네트워크: http://${a.address}:${PORT}`);
    }
  }
  console.log('\n  친구들은 위 "같은 네트워크" 주소로 브라우저에서 접속하면 됩니다.');
  console.log('  종료하려면 이 창에서 Ctrl+C\n');
  if (OPEN_BROWSER && process.platform === 'win32') exec(`start "" "http://localhost:${PORT}"`);
});
