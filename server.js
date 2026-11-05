// 개선OPL 서버 - 정적 파일 + WebSocket 멀티플레이
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exec, spawn as spawnProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as G from './shared/common.js';

process.title = G.GAME_NAME;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT_FIXED = !!process.env.PORT; // 클라우드(Render 등)는 지정된 포트만 사용
let PORT = Number(process.env.PORT) || 7777;
const OPEN_BROWSER = process.argv.includes('--open');
const USE_TUNNEL = process.argv.includes('--tunnel');
let tunnelUrl = null;

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(`http://${a.address}:${PORT}`);
    }
  }
  return out;
}

// 서버를 켠 PC에서 직접 연 요청인지 (터널을 거친 요청은 cf- 헤더가 붙음)
function isHostRequest(req) {
  const ra = req.socket.remoteAddress || '';
  const loop = ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1';
  return loop && !req.headers['cf-connecting-ip'] && !req.headers['cf-ray'];
}

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
  if (url === '/api/info') {
    // 초대 주소는 서버를 켠 사람에게만 보여줌
    const info = isHostRequest(req) ? { host: true, tunnel: tunnelUrl, tunnelMode: USE_TUNNEL, lan: lanAddresses() } : { host: false };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify(info));
  }
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

// ws는 http 서버의 오류를 그대로 다시 내보내므로, 처리는 아래 server 'error'에서 함
wss.on('error', () => {});

// 그 포트에서 이미 개선OPL 서버가 돌고 있는지 확인
async function isOurServer(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
    return (await res.text()).includes(`<title>${G.GAME_NAME}</title>`);
  } catch {
    return false;
  }
}

const MAX_PORT_TRIES = 10;
let portTries = 0;
server.on('error', async (err) => {
  if (err.code !== 'EADDRINUSE') {
    console.error(err);
    process.exit(1);
  }
  if (await isOurServer(PORT)) {
    console.error(`\n  [${G.GAME_NAME}] 서버가 이미 켜져 있습니다 (http://localhost:${PORT}).`);
    console.error('  먼저 켜 둔 서버 창을 닫고 다시 실행하세요. 바로 하려면 브라우저에서 위 주소를 여세요.\n');
    process.exit(1);
  }
  if (PORT_FIXED || ++portTries >= MAX_PORT_TRIES) {
    console.error(`\n  [${G.GAME_NAME}] 포트 ${PORT}를 다른 프로그램이 쓰고 있어 서버를 열 수 없습니다.\n`);
    process.exit(1);
  }
  console.log(`  포트 ${PORT}를 다른 프로그램이 쓰고 있어 ${PORT + 1}번으로 엽니다.`);
  PORT++;
  server.listen(PORT, '0.0.0.0');
});

// ───────────────────────── 인터넷 터널 (Cloudflare, 가입 불필요) ─────────────────────────
function cloudflaredPath() {
  if (process.platform === 'win32') {
    const cands = [
      process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'cloudflared', 'cloudflared.exe'),
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'cloudflared', 'cloudflared.exe'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe'),
    ];
    for (const p of cands) if (p && fs.existsSync(p)) return p;
  }
  return 'cloudflared';
}

function copyToClipboard(text) {
  if (process.platform !== 'win32') return;
  try {
    const c = spawnProcess('clip', [], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
    c.on('error', () => {});
    c.stdin.end(text);
  } catch { /* 무시 */ }
}

function startTunnel() {
  console.log('  인터넷 주소를 만드는 중입니다... (5~15초)\n');
  let child;
  try {
    child = spawnProcess(cloudflaredPath(), ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], {
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
  } catch {
    child = null;
  }
  if (!child) return tunnelFailed();
  let log = '';
  let candidate = null;
  let announced = false;
  let fallbackTimer = null;
  const announce = () => {
    if (announced || !candidate) return;
    announced = true;
    clearTimeout(fallbackTimer);
    tunnelUrl = candidate;
    copyToClipboard(tunnelUrl);
    const line = '═'.repeat(58);
    console.log(`  ${line}`);
    console.log('   인터넷 초대 주소 (클립보드에 복사됨 - 친구에게 붙여넣기)');
    console.log(`\n   ${tunnelUrl}\n`);
    console.log('   서버를 다시 켜면 주소가 바뀝니다.');
    console.log(`  ${line}\n`);
  };
  const onData = (buf) => {
    log = (log + String(buf)).slice(-4000);
    if (!candidate) {
      const m = log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) {
        candidate = m[0];
        fallbackTimer = setTimeout(announce, 15000);
      }
    }
    if (candidate && /Registered tunnel connection/i.test(log)) announce();
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', () => tunnelFailed());
  child.on('exit', () => {
    if (tunnelUrl) console.log('\n  [알림] 인터넷 터널이 끊겼습니다. 서버를 다시 켜 주세요. (같은 네트워크 접속은 계속 가능)\n');
    else if (!announced) tunnelFailed(log);
    tunnelUrl = null;
  });
  const kill = () => { try { child.kill(); } catch { /* 이미 종료됨 */ } };
  process.on('exit', kill);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { kill(); process.exit(0); });
}

let tunnelFailReported = false;
function tunnelFailed(log = '') {
  if (tunnelFailReported) return;
  tunnelFailReported = true;
  console.log('  [실패] 인터넷 주소를 만들지 못했습니다. 같은 네트워크 접속은 계속 가능합니다.');
  if (!log) console.log('  cloudflared가 설치되어 있지 않다면: winget install --id Cloudflare.cloudflared -e');
  else console.log('  인터넷 연결을 확인하거나 잠시 후 다시 실행해 보세요.');
  console.log('');
}

server.listen(PORT, '0.0.0.0');
server.on('listening', () => {
  console.log(`\n  ${G.GAME_NAME} 서버 실행 중\n`);
  console.log(`  내 PC:      http://localhost:${PORT}`);
  for (const addr of lanAddresses()) console.log(`  같은 네트워크: ${addr}`);
  console.log('\n  친구들은 위 "같은 네트워크" 주소로 브라우저에서 접속하면 됩니다.');
  console.log('  종료하려면 이 창에서 Ctrl+C\n');
  if (USE_TUNNEL) startTunnel();
  if (OPEN_BROWSER && process.platform === 'win32') exec(`start "" "http://localhost:${PORT}"`);
});
