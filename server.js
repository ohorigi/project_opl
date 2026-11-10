// 개선OPL 서버 - 정적 파일 + WebSocket 멀티플레이
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exec, spawn as spawnProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as G from './shared/common.js';
import * as Game from './game.js';

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
  ['/jsm/', path.join(__dirname, 'node_modules', 'three', 'examples', 'jsm')],
  ['/', path.join(__dirname, 'public')],
];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
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

// ───────────────────────── 접속 (게임 판정은 game.js) ─────────────────────────
function log(text) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`  ${t} ${text}`);
}
Game.setLogger(log);

const HEARTBEAT_MS = 5000;
const DEAD_AFTER_MS = 12000;
const CLOSE_REASONS = {
  1000: '정상 종료',
  1001: '창을 닫았거나 새로고침함',
  1005: '이유 없이 종료',
  1006: '네트워크가 끊김',
  1009: '메시지가 너무 큼',
  1011: '서버 오류',
  4001: '보낸 데이터가 서버에 닿지 않아 클라이언트가 재연결함',
};

const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });
wss.on('connection', (ws, req) => {
  const ra = req.socket.remoteAddress || '';
  const via = req.headers['cf-connecting-ip'] ? '인터넷'
    : (ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1') ? '이 PC' : '같은 네트워크';
  const p = Game.connect(ws, via);
  ws.on('pong', () => Game.touch(p));
  ws.on('message', (data) => {
    Game.touch(p);
    let m;
    try { m = JSON.parse(data); } catch { return; }
    try {
      Game.message(p, m);
    } catch (err) {
      log(`[오류] ${p.name || p.id}의 메시지 처리 중: ${err.stack || err.message}`);
    }
  });
  ws.on('close', (code) => {
    const why = p.timedOut ? `${DEAD_AFTER_MS / 1000}초간 응답 없음` : (CLOSE_REASONS[code] || '알 수 없음');
    Game.disconnect(p, code, why);
  });
  ws.on('error', (err) => log(`[연결 오류] ${p.name || p.id}: ${err.message}`));
});

// 하트비트: 응답이 없는 연결(반쯤 끊긴 연결)을 정리해서 맵에 멈춘 유령 플레이어가 남지 않게 함
setInterval(() => Game.heartbeat(DEAD_AFTER_MS), HEARTBEAT_MS);

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
  let cfOut = '';
  let lineBuf = '';
  let lastErrAt = 0;
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
    const text = String(buf);
    cfOut = (cfOut + text).slice(-4000);
    if (!candidate) {
      const m = cfOut.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) {
        candidate = m[0];
        fallbackTimer = setTimeout(announce, 15000);
      }
    }
    if (candidate && /Registered tunnel connection/i.test(cfOut)) announce();
    // 연결된 뒤 터널 쪽 오류는 서버 창에 남김 (끊김 원인 파악용, 초당 1줄 제한)
    lineBuf += text;
    const lines = lineBuf.split(/\r?\n/);
    lineBuf = lines.pop();
    for (const ln of lines) {
      if (!announced || !/\bERR\b/.test(ln)) continue;
      const now = Date.now();
      if (now - lastErrAt < 1000) continue;
      lastErrAt = now;
      log(`[터널] ${ln.replace(/^\S+\s+ERR\s+/, '').slice(0, 160)}`);
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', () => tunnelFailed());
  child.on('exit', () => {
    if (tunnelUrl) console.log('\n  [알림] 인터넷 터널이 끊겼습니다. 서버를 다시 켜 주세요. (같은 네트워크 접속은 계속 가능)\n');
    else if (!announced) tunnelFailed(cfOut);
    tunnelUrl = null;
  });
  const kill = () => { try { child.kill(); } catch { /* 이미 종료됨 */ } };
  process.on('exit', kill);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { kill(); process.exit(0); });
}

let tunnelFailReported = false;
function tunnelFailed(output = '') {
  if (tunnelFailReported) return;
  tunnelFailReported = true;
  console.log('  [실패] 인터넷 주소를 만들지 못했습니다. 같은 네트워크 접속은 계속 가능합니다.');
  if (!output) console.log('  cloudflared가 설치되어 있지 않다면: winget install --id Cloudflare.cloudflared -e');
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
