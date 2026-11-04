// 개선OPL 클라이언트 - 쿼터뷰 렌더링 / 입력 / 네트워크
import * as THREE from 'three';
import * as G from '/shared/common.js';

document.title = G.GAME_NAME;
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
const WK = G.WEAPON_KINDS;
const PK = G.PICKUP_KINDS;

/* ═════════════════════════ 상태 ═════════════════════════ */
const me = { x: 32, y: 20, z: 0, vz: 0, onGround: true, yaw: 0, alive: false, hp: 100, sq: 0, prot: false };
const S = {
  ws: null, connected: false, joined: false, myId: 0, myColor: '#ffffff',
  inv: [null, null, null], slot: 0, slotLockUntil: 0,
  reloadEnd: 0, reloadTotal: 1, respawnEnd: 0,
  fs: 0, ack: 0, ping: 0,
  remotes: new Map(), roster: new Map(), pickups: new Map(),
  nextFireAt: 0, lastReloadReq: 0, lastSend: 0, killerName: '',
};
const keys = new Set();
const mouse = { x: innerWidth / 2, y: innerHeight / 2, left: false, right: false };
let chatOpen = false;
window.__opl = { me, S, keys, mouse }; // 디버그용

/* ═════════════════════════ 사운드 (WebAudio 합성) ═════════════════════════ */
const Sfx = (() => {
  let ctx = null, master = null, noise = null;
  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    master = ctx.createGain();
    master.gain.value = 0.4;
    master.connect(ctx.destination);
    const len = ctx.sampleRate;
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  const PROF = {
    pistol: { f: 2600, dur: 0.12, g: 0.5, thump: 150 },
    smg: { f: 3000, dur: 0.07, g: 0.38, thump: 170 },
    shotgun: { f: 1200, dur: 0.33, g: 0.9, thump: 90 },
    rifle: { f: 2000, dur: 0.13, g: 0.55, thump: 120 },
    sniper: { f: 950, dur: 0.6, g: 1.0, thump: 70 },
  };
  function shot(kind, vol = 1) {
    if (!ctx || vol <= 0.02) return;
    const p = PROF[kind] || PROF.pistol;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(p.f, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + p.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(p.g * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + p.dur);
    src.connect(lp).connect(g).connect(master);
    src.start(t, Math.random() * 0.3);
    src.stop(t + p.dur + 0.02);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(p.thump, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.12);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.7 * vol * p.g, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(og).connect(master);
    o.start(t);
    o.stop(t + 0.16);
  }
  function tone(freq, dur, type = 'square', vol = 0.15, freq2 = null, delay = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freq2) o.frequency.exponentialRampToValueAtTime(freq2, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  return {
    init, shot,
    hit: () => tone(1500, 0.05, 'square', 0.07),
    kill: () => { tone(880, 0.09, 'square', 0.09); tone(1320, 0.16, 'square', 0.09, null, 0.08); },
    hurt: () => tone(190, 0.16, 'sawtooth', 0.12, 80),
    pick: () => { tone(660, 0.06, 'triangle', 0.15); tone(990, 0.09, 'triangle', 0.15, null, 0.06); },
    empty: () => tone(2200, 0.03, 'square', 0.05),
    reload: () => { tone(500, 0.04, 'square', 0.05); tone(720, 0.04, 'square', 0.05, null, 0.12); },
    swap: () => tone(420, 0.06, 'triangle', 0.1, 640),
    die: () => tone(320, 0.7, 'sawtooth', 0.12, 55),
  };
})();

/* ═════════════════════════ 렌더러 / 카메라 ═════════════════════════ */
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#202736');

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
const CAM_AZ = Math.PI / 4;
const CAM_EL = THREE.MathUtils.degToRad(55);
const CAM_DIST = 90;
const camOffset = new THREE.Vector3(
  Math.cos(CAM_EL) * Math.sin(CAM_AZ), Math.sin(CAM_EL), Math.cos(CAM_EL) * Math.cos(CAM_AZ),
).multiplyScalar(CAM_DIST);
// 화면 기준 이동 방향 (맵 좌표)
const FWD = { x: -Math.sin(CAM_AZ), y: -Math.cos(CAM_AZ) };
const RIGHT = { x: Math.cos(CAM_AZ), y: -Math.sin(CAM_AZ) };
let viewSize = 24;
let zoomMul = 1;
let shake = 0;
const camTarget = new THREE.Vector3(G.MAP_W / 2, 0, G.MAP_H / 2);

function updateProjection() {
  const h = (viewSize * zoomMul) / 2;
  const w = (h * innerWidth) / innerHeight;
  camera.left = -w; camera.right = w; camera.top = h; camera.bottom = -h;
  camera.updateProjectionMatrix();
}
updateProjection();
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight, false); updateProjection(); });

scene.add(new THREE.HemisphereLight('#e8f0ff', '#6b5a48', 1.5));
const sun = new THREE.DirectionalLight('#fff4e0', 2.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -44, right: 44, top: 44, bottom: -44, near: 1, far: 170 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const SUN_OFF = new THREE.Vector3(-22, 48, -12);

/* ═════════════════════════ 텍스처 ═════════════════════════ */
function canvasTex(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
const groundTex = canvasTex(512, (g, s) => {
  g.fillStyle = '#aaa697';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 5000; i++) {
    const v = Math.random();
    g.fillStyle = v < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';
    g.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
  g.strokeStyle = 'rgba(70,64,52,0.22)';
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, s); g.stroke();
    g.beginPath(); g.moveTo(0, i * 128); g.lineTo(s, i * 128); g.stroke();
  }
  g.strokeStyle = 'rgba(60,54,44,0.35)';
  g.lineWidth = 4;
  g.strokeRect(0, 0, s, s);
}, G.MAP_W / 4);
const crateTex = canvasTex(128, (g, s) => {
  g.fillStyle = '#c08a52'; g.fillRect(0, 0, s, s);
  g.strokeStyle = '#7d5530'; g.lineWidth = 10; g.strokeRect(5, 5, s - 10, s - 10);
  g.lineWidth = 8; g.beginPath(); g.moveTo(10, 10); g.lineTo(s - 10, s - 10); g.stroke();
  g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 2;
  for (let y = 26; y < s; y += 22) { g.beginPath(); g.moveTo(10, y); g.lineTo(s - 10, y); g.stroke(); }
});

/* ═════════════════════════ 맵 ═════════════════════════ */
const STYLE = {
  building: ['#8792a8', '#b9c4d6'],
  parapet: ['#a3adc1', '#d3dbe8'],
  wall: ['#6f7890', '#8d96ab'],
  crate: null,
  low: ['#a39570', '#bcae86'],
  stair: ['#c3baa7', '#e5dece'],
  bridge: ['#7b6f62', '#ab9c8b'],
  rail: ['#3d4350', '#596071'],
  pillar: ['#6b7280', '#7d8594'],
  bound: ['#353c4c', '#454d60'],
};
const matCache = {};
function kindMats(kind) {
  if (matCache[kind]) return matCache[kind];
  let side, top;
  if (kind === 'crate') {
    side = top = new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.85 });
  } else {
    const [sc, tc] = STYLE[kind] || STYLE.wall;
    side = new THREE.MeshStandardMaterial({ color: sc, roughness: 0.9 });
    top = new THREE.MeshStandardMaterial({ color: tc, roughness: 0.85 });
  }
  return (matCache[kind] = [side, side, top, side, side, side]);
}

const pickables = [];
const FLOOR_KINDS = new Set(['building', 'stair', 'bridge', 'ground']);
const edgeMat = new THREE.LineBasicMaterial({ color: '#141821', transparent: true, opacity: 0.35 });

function buildLevel() {
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: '#2a3140', roughness: 1 }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.set(G.MAP_W / 2, -0.05, G.MAP_H / 2);
  scene.add(outer);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(G.MAP_W, G.MAP_H), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(G.MAP_W / 2, 0, G.MAP_H / 2);
  ground.receiveShadow = true;
  ground.userData = { kind: 'ground' };
  scene.add(ground);
  pickables.push(ground);

  for (const b of G.BOXES) {
    const z1 = b.kind === 'bound' ? 1.2 : b.z1; // 외곽 벽은 시야를 가리지 않게 낮게 그림
    const geo = new THREE.BoxGeometry(b.x1 - b.x0, z1 - b.z0, b.y1 - b.y0);
    const mesh = new THREE.Mesh(geo, kindMats(b.kind));
    mesh.position.set((b.x0 + b.x1) / 2, (b.z0 + z1) / 2, (b.y0 + b.y1) / 2);
    mesh.castShadow = b.kind !== 'bound';
    mesh.receiveShadow = true;
    mesh.userData = { kind: b.kind };
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat));
    scene.add(mesh);
    if (b.kind !== 'rail') pickables.push(mesh);
  }
}
buildLevel();

/* ═════════════════════════ 캐릭터 모델 ═════════════════════════ */
const bodyGeo = new THREE.CapsuleGeometry(0.34, 0.8, 4, 12);
const headGeo = new THREE.SphereGeometry(0.25, 16, 12);
const visorGeo = new THREE.BoxGeometry(0.14, 0.09, 0.32);
const gunGeos = {};
function gunGeo(kind) {
  if (gunGeos[kind]) return gunGeos[kind];
  const w = G.WEAPONS[kind];
  const g = new THREE.BoxGeometry(w.len, 0.12, 0.13);
  g.translate(w.len / 2, 0, 0);
  return (gunGeos[kind] = g);
}
const GUN_X = 0.18;

function makeAvatar(color, isMe) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, transparent: true });
  const headMat = new THREE.MeshStandardMaterial({ color: '#f2d4b6', roughness: 0.7, transparent: true });
  const visorMat = new THREE.MeshStandardMaterial({ color: '#1c2230', roughness: 0.3, transparent: true });
  const gMat = new THREE.MeshStandardMaterial({ color: '#dddddd', roughness: 0.45, metalness: 0.3, transparent: true });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.74;
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.55;
  const visor = new THREE.Mesh(visorGeo, visorMat);
  visor.position.set(0.18, 1.58, 0);
  const gun = new THREE.Mesh(gunGeo('pistol'), gMat);
  gun.position.set(GUN_X, G.GUN_H, 0);
  for (const m of [body, head, visor, gun]) m.castShadow = true;
  group.add(body, head, visor, gun);

  // 벽 뒤에 가려졌을 때 보이는 실루엣
  const silMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, depthFunc: THREE.GreaterDepth, depthWrite: false });
  const sb = new THREE.Mesh(bodyGeo, silMat);
  sb.position.copy(body.position);
  const sh = new THREE.Mesh(headGeo, silMat);
  sh.position.copy(head.position);
  sb.renderOrder = sh.renderOrder = 5;
  group.add(sb, sh);

  if (isMe) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.62, 40),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    group.add(ring);
  }
  scene.add(group);
  return { group, gun, gMat, bodyMat, silMat, mats: [bodyMat, headMat, visorMat, gMat], kind: 'pistol', opacity: 1, kick: 0, isMe };
}
function disposeAvatar(av) {
  scene.remove(av.group);
  for (const m of av.mats) m.dispose();
  av.silMat.dispose();
}
function setAvatarWeapon(av, kind) {
  av.gun.visible = !!kind;
  if (!kind || av.kind === kind) return;
  av.kind = kind;
  av.gun.geometry = gunGeo(kind);
  av.gMat.color.set(G.WEAPONS[kind].color);
}
function setAvatarOpacity(av, o) {
  if (Math.abs(av.opacity - o) < 0.001) return;
  av.opacity = o;
  for (const m of av.mats) { m.opacity = o; m.depthWrite = o > 0.98; }
  av.silMat.opacity = 0.4 * o;
  av.group.visible = o > 0.01;
}
function setAvatarColor(av, color) {
  av.bodyMat.color.set(color);
  av.silMat.color.set(color);
}
function placeAvatar(av, x, y, z, yaw, dt) {
  av.group.position.set(x, z, y);
  av.group.rotation.y = -yaw;
  av.kick *= Math.exp(-dt * 16);
  av.gun.position.x = GUN_X - av.kick;
}
// 총구 위치 (월드 좌표, 맵 기준 x/y/z)
function muzzleOf(av, x, y, z, yaw) {
  const len = G.WEAPONS[av.kind] ? G.WEAPONS[av.kind].len : 0.4;
  const d = GUN_X + len;
  return [x + Math.cos(yaw) * d, y + Math.sin(yaw) * d, z + G.GUN_H];
}

let myAv = null;

/* ═════════════════════════ 아이템 모델 ═════════════════════════ */
const beamGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.8, 20, 1, true);
function pickupColor(kind) { return kind === 'health' ? '#4ade80' : G.WEAPONS[kind].color; }
function makePickupModel(kind) {
  const group = new THREE.Group();
  const color = pickupColor(kind);
  const inner = new THREE.Group();
  inner.position.y = 0.7;
  group.add(inner);
  if (kind === 'health') {
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#16a34a', emissiveIntensity: 0.7 });
    inner.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.2), mat));
    inner.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.2), mat));
  } else {
    const w = G.WEAPONS[kind];
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.4, metalness: 0.3 });
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(w.len, 0.14, 0.15), mat);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.25, 0.12), mat);
    grip.position.set(-w.len / 2 + 0.15, -0.15, 0);
    inner.add(barrel, grip);
  }
  for (const m of inner.children) m.castShadow = true;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.7, 36),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  }));
  beam.position.y = 0.9;
  group.add(ring, beam);
  scene.add(group);
  return { group, inner };
}
function disposeGroup(group) {
  scene.remove(group);
  group.traverse((o) => {
    if (o.material) o.material.dispose();
    if (o.geometry && o.geometry !== beamGeo) o.geometry.dispose();
  });
}

/* ═════════════════════════ 사거리 원 / 조준선 ═════════════════════════ */
const rangeRing = new THREE.Mesh(
  new THREE.RingGeometry(1, 1.1, 8),
  new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.18, depthWrite: false }),
);
rangeRing.rotation.x = -Math.PI / 2;
rangeRing.renderOrder = 2;
scene.add(rangeRing);
let rangeRingFor = '';
function updateRangeRing(kind) {
  if (rangeRingFor === kind) return;
  rangeRingFor = kind;
  rangeRing.geometry.dispose();
  const r = G.WEAPONS[kind].range;
  rangeRing.geometry = new THREE.RingGeometry(r - 0.07, r + 0.07, 180);
}
const aimGeo = new THREE.BufferGeometry();
aimGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
const aimLine = new THREE.Line(aimGeo, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.3, depthWrite: false }));
aimLine.frustumCulled = false;
scene.add(aimLine);

/* ═════════════════════════ 효과 ═════════════════════════ */
const fx = [];
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitSphere = new THREE.SphereGeometry(1, 10, 8);
function addTracer(ax, ay, az, bx, by, bz, color, width = 0.05, life = 0.12) {
  const len = Math.hypot(bx - ax, by - ay, bz - az);
  if (len < 0.05) return;
  const m = new THREE.Mesh(unitBox, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  m.position.set((ax + bx) / 2, (az + bz) / 2, (ay + by) / 2);
  m.scale.set(width, width, len);
  m.lookAt(bx, bz, by);
  scene.add(m);
  fx.push({ m, life, max: life, kind: 'fade' });
}
function burst(x, y, z, color, count, speed = 4, size = 0.08, life = 0.5) {
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(unitBox, new THREE.MeshBasicMaterial({ color, transparent: true }));
    m.scale.setScalar(size * (0.6 + Math.random() * 0.8));
    m.position.set(x, z, y);
    const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 1.3, Math.random() * 2 - 1).multiplyScalar(speed);
    scene.add(m);
    fx.push({ m, life: life * (0.7 + Math.random() * 0.6), max: life, kind: 'particle', v });
  }
}
function flash(x, y, z, color, size = 0.32) {
  const m = new THREE.Mesh(unitSphere, new THREE.MeshBasicMaterial({
    color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  m.position.set(x, z, y);
  m.scale.setScalar(size);
  scene.add(m);
  fx.push({ m, life: 0.06, max: 0.06, kind: 'fade' });
}
function impact(x, y, z, type) {
  if (type === 2) burst(x, y, z, '#d63a3a', 8, 3.5, 0.09, 0.45);
  else if (type === 1) burst(x, y, z, '#ffd9a0', 5, 3, 0.06, 0.3);
}
function updateFx(dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.life -= dt;
    if (f.life <= 0) {
      scene.remove(f.m);
      f.m.material.dispose();
      fx.splice(i, 1);
      continue;
    }
    if (f.kind === 'particle') {
      f.v.y -= 14 * dt;
      f.m.position.addScaledVector(f.v, dt);
      if (f.m.position.y < 0.03) { f.m.position.y = 0.03; f.v.set(0, 0, 0); }
    }
    f.m.material.opacity = clamp(f.life / f.max, 0, 1);
  }
}

/* ═════════════════════════ 화면 라벨 ═════════════════════════ */
const labelsEl = $('labels');
const _v = new THREE.Vector3();
function toScreen(x, y, z) {
  _v.set(x, z, y).project(camera);
  return {
    x: ((_v.x + 1) / 2) * innerWidth,
    y: ((1 - _v.y) / 2) * innerHeight,
    on: _v.x > -1.1 && _v.x < 1.1 && _v.y > -1.1 && _v.y < 1.1,
  };
}
window.__opl.toScreen = toScreen;
function makeTag(isMe) {
  const el = document.createElement('div');
  el.className = 'tag' + (isMe ? ' me' : '');
  const nameEl = document.createElement('div');
  nameEl.className = 'name';
  const hp = document.createElement('div');
  hp.className = 'hp';
  const hpEl = document.createElement('i');
  hp.appendChild(hpEl);
  el.append(nameEl, hp);
  labelsEl.appendChild(el);
  return { el, nameEl, hpEl, name: null, color: null, hp: -1, shown: true };
}
function updateTag(tag, name, color, hp, x, y, z, opacity) {
  const p = toScreen(x, y, z + 2.15);
  const show = p.on && opacity > 0.3;
  if (show !== tag.shown) { tag.shown = show; tag.el.style.display = show ? '' : 'none'; }
  if (!show) return;
  tag.el.style.left = p.x + 'px';
  tag.el.style.top = p.y + 'px';
  if (tag.name !== name) { tag.name = name; tag.nameEl.textContent = name; }
  if (tag.color !== color) { tag.color = color; tag.nameEl.style.color = color; }
  if (tag.hp !== hp) {
    tag.hp = hp;
    tag.hpEl.style.width = clamp(hp, 0, 100) + '%';
    tag.hpEl.style.background = hp > 50 ? '#6ee7a0' : hp > 25 ? '#ffd166' : '#ff5a5a';
  }
}
const myTag = makeTag(true);
myTag.el.style.display = 'none';
myTag.shown = false;

const dmgNums = [];
function addDmgNum(x, y, z, text, cls = '') {
  const el = document.createElement('div');
  el.className = 'dmgnum ' + cls;
  el.textContent = text;
  labelsEl.appendChild(el);
  dmgNums.push({ el, x: x + (Math.random() - 0.5) * 0.4, y, z, t: 0 });
}

/* ═════════════════════════ 네트워크 ═════════════════════════ */
function connect() {
  return new Promise((resolve, reject) => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}`);
    S.ws = ws;
    ws.onopen = () => { S.connected = true; resolve(); };
    ws.onerror = () => reject(new Error('connect failed'));
    ws.onclose = () => {
      S.connected = false;
      if (S.joined) {
        S.joined = false;
        $('hud').classList.add('hidden');
        $('login').classList.remove('hidden');
        $('joinbtn').disabled = true;
        $('loginmsg').textContent = '서버 연결이 끊어졌습니다. 새로고침(F5) 해주세요.';
      }
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      onMessage(m);
    };
  });
}
function send(m) {
  if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(m));
}
setInterval(() => { if (S.joined) send({ type: 'ping', t: performance.now() }); }, 2000);

function nameOf(id) {
  const r = S.roster.get(id);
  return r ? r.name : '???';
}
function colorOf(id) {
  const r = S.roster.get(id);
  return r ? r.color : '#cccccc';
}

function onMessage(m) {
  switch (m.type) {
    case 'welcome':
      S.myId = m.id;
      S.myColor = m.color;
      if (myAv) setAvatarColor(myAv, m.color);
      break;
    case 'roster': {
      S.roster.clear();
      for (const p of m.list) S.roster.set(p.id, p);
      for (const r of S.remotes.values()) setAvatarColor(r.av, colorOf(r.id));
      if (!$('scoreboard').classList.contains('hidden')) renderScoreboard();
      $('pcount').textContent = `${m.list.length}명 접속`;
      break;
    }
    case 'snap': onSnap(m); break;
    case 'spawn':
      Object.assign(me, { x: m.x, y: m.y, z: m.z, vz: 0, onGround: true, yaw: m.yaw, sq: m.sq, alive: true, hp: G.MAX_HP });
      camTarget.set(me.x, me.z, me.y);
      S.nextFireAt = 0;
      S.reloadEnd = 0;
      break;
    case 'shot': onRemoteShot(m); break;
    case 'hitm': {
      const hm = $('hitmark');
      hm.classList.remove('show', 'kill');
      void hm.offsetWidth;
      hm.classList.add('show');
      if (m.prot) { addDmgNum(m.x, m.y, m.z, '보호중', 'prot'); break; }
      if (m.kill) hm.classList.add('kill');
      addDmgNum(m.x, m.y, m.z, String(m.dmg), m.kill ? 'kill' : '');
      if (m.kill) Sfx.kill(); else Sfx.hit();
      break;
    }
    case 'hurt': {
      Sfx.hurt();
      shake = Math.min(0.6, shake + 0.25);
      const v = $('vignette');
      v.style.transition = 'none';
      v.style.opacity = '1';
      requestAnimationFrame(() => { v.style.transition = ''; v.style.opacity = me.hp < 30 ? '0.45' : '0'; });
      break;
    }
    case 'kill': onKill(m); break;
    case 'pick':
      Sfx.pick();
      if (m.kind === 'health') showNotice('+50 체력', '#4ade80');
      else if (m.ammo) showNotice(`${G.WEAPONS[m.kind].name} 탄약 보충`, G.WEAPONS[m.kind].color);
      else {
        showNotice(`${G.WEAPONS[m.kind].name} 획득!`, G.WEAPONS[m.kind].color);
        if (typeof m.slot === 'number') { S.slot = m.slot; S.slotLockUntil = performance.now() + 300; }
      }
      break;
    case 'chat': addChat(m.name, m.color, m.text); break;
    case 'sys': addChat(null, null, m.text); break;
    case 'pong': S.ping = Math.round(performance.now() - m.t); break;
  }
}

function onSnap(m) {
  const now = performance.now();
  const seen = new Set();
  for (const a of m.ps) {
    const [id, x, y, z, yaw, hp, alive, wi, prot] = a;
    if (id === S.myId) {
      me.alive = !!alive;
      me.hp = hp;
      me.prot = !!prot;
      if (myAv) setAvatarWeapon(myAv, wi >= 0 ? WK[wi] : null);
      continue;
    }
    seen.add(id);
    let r = S.remotes.get(id);
    if (!r) {
      r = {
        id, x, y, z, yaw, tx: x, ty: y, tz: z, tyaw: yaw, hp, alive: !!alive, prot: !!prot,
        av: makeAvatar(colorOf(id), false), tag: makeTag(false), vis: 0,
      };
      S.remotes.set(id, r);
    }
    if ((!r.alive && alive) || Math.hypot(x - r.x, y - r.y) > 6) { r.x = x; r.y = y; r.z = z; r.vis = 0; }
    r.tx = x; r.ty = y; r.tz = z; r.tyaw = yaw;
    r.hp = hp; r.alive = !!alive; r.prot = !!prot;
    setAvatarWeapon(r.av, wi >= 0 ? WK[wi] : null);
  }
  for (const [id, r] of S.remotes) {
    if (!seen.has(id)) { disposeAvatar(r.av); r.tag.el.remove(); S.remotes.delete(id); }
  }

  const seenPk = new Set();
  for (const [id, ki, x, y, z] of m.pk) {
    seenPk.add(id);
    if (S.pickups.has(id)) continue;
    const kind = PK[ki];
    const model = makePickupModel(kind);
    model.group.position.set(x, z, y);
    const label = document.createElement('div');
    label.className = 'plabel';
    label.textContent = kind === 'health' ? '체력 +50' : G.WEAPONS[kind].name;
    label.style.color = pickupColor(kind);
    label.style.display = 'none';
    labelsEl.appendChild(label);
    S.pickups.set(id, { id, kind, x, y, z, model, label, labelShown: false, phase: Math.random() * 6 });
  }
  for (const [id, pk] of S.pickups) {
    if (!seenPk.has(id)) { disposeGroup(pk.model.group); pk.label.remove(); S.pickups.delete(id); }
  }

  const mm = m.me;
  S.inv = mm.inv.map((a) => (a ? { kind: WK[a[0]], mag: a[1], reserve: a[2] } : null));
  if (now > S.slotLockUntil) S.slot = mm.slot;
  S.ack = mm.ack;
  S.reloadEnd = mm.rl ? now + mm.rl : 0;
  S.reloadTotal = mm.rt || 1;
  S.respawnEnd = mm.ra ? now + mm.ra : 0;
}

function onRemoteShot(m) {
  const kind = WK[m.w];
  const w = G.WEAPONS[kind];
  if (!w) return;
  const [ox, oy, oz] = m.o;
  const r = S.remotes.get(m.by);
  if (r) {
    r.av.kick = 0.14;
    const mz = muzzleOf(r.av, r.x, r.y, r.z, r.yaw);
    if (r.vis > 0.3) flash(mz[0], mz[1], mz[2], '#ffe7a3');
  }
  for (const [x, y, z, type] of m.e) {
    const dx = x - ox, dy = y - oy, dz = z - oz;
    const len = Math.hypot(dx, dy, dz) || 1;
    const s = Math.min(0.6, len);
    addTracer(ox + (dx / len) * s, oy + (dy / len) * s, oz + (dz / len) * s, x, y, z, w.color,
      kind === 'sniper' ? 0.08 : 0.05, kind === 'sniper' ? 0.25 : 0.1);
    impact(x, y, z, type);
  }
  const dist = Math.hypot(ox - me.x, oy - me.y);
  Sfx.shot(kind, Math.pow(clamp(1 - dist / 55, 0, 1), 1.6));
}

function onKill(m) {
  burst(m.x, m.y, m.z + 1, colorOf(m.v), 22, 5, 0.12, 0.8);
  addKillFeed(m.k, m.v, m.w);
  if (m.v === S.myId) {
    me.alive = false;
    S.killerName = nameOf(m.k);
    Sfx.die();
    shake = 0.5;
  } else if (m.k === S.myId) {
    showNotice(`${nameOf(m.v)} 처치!`, '#ff6b6b');
  }
}

/* ═════════════════════════ 조준 ═════════════════════════ */
const raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _n = new THREE.Vector3();
const aim = { x: 32, y: 32, z: G.GUN_H, lock: 0 };

function updateAim() {
  _ndc.set((mouse.x / innerWidth) * 2 - 1, -(mouse.y / innerHeight) * 2 + 1);
  raycaster.setFromCamera(_ndc, camera);
  const gunZ = me.z + G.GUN_H;
  const o = raycaster.ray.origin, d = raycaster.ray.direction;
  // 기본: 내 총구 높이의 수평면을 조준
  const t = (gunZ - o.y) / d.y;
  aim.x = o.x + d.x * t;
  aim.y = o.z + d.z * t;
  aim.z = gunZ;
  aim.lock = 0;
  if (!S.joined || !me.alive) return;

  // 1) 마우스가 적 위에 있으면 그 적을 조준 (다른 층이면 높이까지 맞춤)
  const ppu = innerHeight / (viewSize * zoomMul);
  let best = Math.max(14, ppu * 0.7), lockR = null;
  for (const r of S.remotes.values()) {
    if (!r.alive || r.vis < 0.5) continue;
    const s = toScreen(r.x, r.y, r.z + 1.0);
    const dd = Math.hypot(s.x - mouse.x, s.y - mouse.y);
    if (dd < best) { best = dd; lockR = r; }
  }
  if (lockR) {
    aim.lock = lockR.id;
    if (Math.abs(lockR.z - me.z) > 0.8) { aim.x = lockR.x; aim.y = lockR.y; aim.z = lockR.z + 1.1; }
    return;
  }

  // 2) 다른 층의 바닥을 가리키면 그 위치의 가슴 높이를 조준
  const hits = raycaster.intersectObjects(pickables, false);
  if (hits.length) {
    const h = hits[0];
    if (h.face && FLOOR_KINDS.has(h.object.userData.kind)) {
      _n.copy(h.face.normal).transformDirection(h.object.matrixWorld);
      if (_n.y > 0.7 && Math.abs(h.point.y - me.z) > 1.0) {
        aim.x = h.point.x; aim.y = h.point.z; aim.z = h.point.y + G.GUN_H;
      }
    }
  }
}

function aimAngles() {
  const ox = me.x, oy = me.y, oz = me.z + G.GUN_H;
  const dx = aim.x - ox, dy = aim.y - oy, dz = aim.z - oz;
  const hd = Math.hypot(dx, dy);
  const yaw = hd > 0.05 ? Math.atan2(dy, dx) : me.yaw;
  const pitch = hd > 0.05 ? clamp(Math.atan2(dz, hd), -1.3, 1.3) : 0;
  return { ox, oy, oz, yaw, pitch };
}

function remoteTargets() {
  const out = [];
  for (const r of S.remotes.values()) if (r.alive) out.push({ id: r.id, x: r.x, y: r.y, z: r.z });
  return out;
}

/* ═════════════════════════ 사격 / 무기 ═════════════════════════ */
function predictedMag() {
  const it = S.inv[S.slot];
  if (!it) return 0;
  return Math.max(0, it.mag - Math.max(0, S.fs - S.ack));
}
function isMoving() {
  return keys.has('KeyW') || keys.has('KeyA') || keys.has('KeyS') || keys.has('KeyD');
}

function tryFire(now) {
  if (!S.joined || !me.alive || chatOpen) return;
  const it = S.inv[S.slot];
  if (!it) return;
  const kind = it.kind;
  const w = G.WEAPONS[kind];
  if (now < S.nextFireAt) return;
  if (S.reloadEnd && now < S.reloadEnd) return;
  if (predictedMag() <= 0) {
    if (now - S.lastReloadReq > 600) { S.lastReloadReq = now; send({ type: 'reload' }); Sfx.empty(); }
    return;
  }
  S.nextFireAt = now + w.interval * 1000;
  S.fs++;

  const { ox, oy, oz, yaw, pitch } = aimAngles();
  const spread = w.spread * (isMoving() ? 1.4 : 1);
  const targets = remoteTargets();
  const pellets = [];
  for (let i = 0; i < w.pellets; i++) {
    const ry = yaw + (w.pellets > 1 ? Math.random() * 2 - 1 : Math.random() + Math.random() - 1) * spread;
    const rp = pitch + (Math.random() * 2 - 1) * spread * 0.3;
    const dx = Math.cos(rp) * Math.cos(ry), dy = Math.cos(rp) * Math.sin(ry), dz = Math.sin(rp);
    const tr = G.traceShot(ox, oy, oz, dx, dy, dz, w.range, targets);
    pellets.push([+dx.toFixed(4), +dy.toFixed(4), +dz.toFixed(4), +tr.t.toFixed(3), tr.target ? tr.target.id : 0]);
    addTracer(ox + dx * 0.6, oy + dy * 0.6, oz + dz * 0.6, tr.x, tr.y, tr.z, w.color,
      kind === 'sniper' ? 0.08 : 0.05, kind === 'sniper' ? 0.25 : 0.1);
    impact(tr.x, tr.y, tr.z, tr.type);
  }
  send({ type: 'fire', fs: S.fs, o: [+ox.toFixed(2), +oy.toFixed(2), +oz.toFixed(2)], p: pellets });

  me.yaw = yaw;
  if (myAv) {
    myAv.kick = 0.16;
    const mz = muzzleOf(myAv, me.x, me.y, me.z, yaw);
    flash(mz[0], mz[1], mz[2], '#ffe7a3', kind === 'shotgun' || kind === 'sniper' ? 0.45 : 0.3);
  }
  Sfx.shot(kind);
  shake = Math.min(0.7, shake + w.shake);
}

function selectSlot(i) {
  if (!me.alive) return;
  if (!S.inv[i]) { showNotice(`${i + 1}번 슬롯이 비어 있습니다`, '#9aa6b8'); return; }
  if (i === S.slot) return;
  const now = performance.now();
  S.slot = i;
  S.slotLockUntil = now + 400;
  S.nextFireAt = Math.max(S.nextFireAt, now + 180);
  S.reloadEnd = 0;
  send({ type: 'slot', i });
  Sfx.swap();
}
function requestReload() {
  const it = S.inv[S.slot];
  if (!it || !me.alive) return;
  const w = G.WEAPONS[it.kind];
  if (S.reloadEnd > performance.now()) return;
  if (predictedMag() >= w.mag) return;
  if (!w.infinite && it.reserve <= 0) { showNotice('남은 탄약이 없습니다', '#ff8a8a'); return; }
  send({ type: 'reload' });
  Sfx.reload();
}

/* ═════════════════════════ 입력 ═════════════════════════ */
addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0) mouse.left = true;
  if (e.button === 2) mouse.right = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) mouse.left = false;
  if (e.button === 2) mouse.right = false;
});
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', (e) => {
  if (!S.joined) return;
  viewSize = clamp(viewSize + Math.sign(e.deltaY) * 2, 16, 36);
}, { passive: true });
addEventListener('blur', () => { keys.clear(); mouse.left = mouse.right = false; });

const chatEl = $('chat');
const chatInput = $('chatinput');
function openChat() {
  chatOpen = true;
  keys.clear();
  mouse.left = false;
  chatEl.classList.add('open');
  chatInput.value = '';
  chatInput.focus();
}
function closeChat() {
  chatOpen = false;
  chatEl.classList.remove('open');
  chatInput.blur();
}

addEventListener('keydown', (e) => {
  if (!S.joined) return;
  if (chatOpen) {
    if (e.code === 'Enter' && !e.isComposing) {
      const t = chatInput.value.trim();
      if (t) send({ type: 'chat', text: t });
      closeChat();
      e.preventDefault();
    } else if (e.code === 'Escape') {
      closeChat();
    }
    return;
  }
  if (e.code === 'Enter') { e.preventDefault(); openChat(); return; }
  if (e.code === 'Tab') { e.preventDefault(); showScoreboard(true); return; }
  keys.add(e.code);
  if (e.repeat) return;
  switch (e.code) {
    case 'Digit1': case 'Numpad1': selectSlot(0); break;
    case 'Digit2': case 'Numpad2': selectSlot(1); break;
    case 'Digit3': case 'Numpad3': selectSlot(2); break;
    case 'KeyR': requestReload(); break;
    case 'KeyE': send({ type: 'swap' }); break;
  }
});
addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'Tab') showScoreboard(false);
});

/* ═════════════════════════ HUD ═════════════════════════ */
const hudCache = {};
function setText(el, key, text) {
  if (hudCache[key] !== text) { hudCache[key] = text; el.textContent = text; }
}
const slotEls = [...document.querySelectorAll('.slot')];
const crosshair = $('crosshair');
let noticeTimer = 0;
function showNotice(text, color = '#ffffff') {
  const n = $('notice');
  n.textContent = text;
  n.style.color = color;
  n.classList.add('show');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => n.classList.remove('show'), 1300);
}
function addKillFeed(k, v, wkind) {
  const feed = $('killfeed');
  const el = document.createElement('div');
  el.className = 'kf' + (k === S.myId || v === S.myId ? ' mine' : '');
  const ks = document.createElement('span');
  ks.textContent = nameOf(k);
  ks.style.color = colorOf(k);
  const ws = document.createElement('span');
  ws.className = 'w';
  ws.textContent = `[${G.WEAPONS[wkind] ? G.WEAPONS[wkind].name : '?'}]`;
  const vs = document.createElement('span');
  vs.textContent = nameOf(v);
  vs.style.color = colorOf(v);
  el.append(ks, ws, vs);
  feed.prepend(el);
  while (feed.children.length > 6) feed.lastChild.remove();
  setTimeout(() => el.remove(), 6000);
}
function addChat(name, color, text) {
  const log = $('chatlog');
  const el = document.createElement('div');
  if (name) {
    const n = document.createElement('b');
    n.textContent = name + ': ';
    n.style.color = color;
    el.append(n, document.createTextNode(text));
  } else {
    el.className = 'sys';
    el.textContent = text;
  }
  log.appendChild(el);
  while (log.children.length > 8) log.firstChild.remove();
  setTimeout(() => el.remove(), 10000);
}
function showScoreboard(show) {
  $('scoreboard').classList.toggle('hidden', !show);
  if (show) renderScoreboard();
}
function renderScoreboard() {
  const body = $('scorebody');
  body.textContent = '';
  const list = [...S.roster.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  for (const p of list) {
    const tr = document.createElement('tr');
    if (p.id === S.myId) tr.className = 'me';
    const td1 = document.createElement('td');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = p.color;
    td1.append(dot, document.createTextNode(p.name));
    const td2 = document.createElement('td');
    td2.textContent = p.kills;
    const td3 = document.createElement('td');
    td3.textContent = p.deaths;
    tr.append(td1, td2, td3);
    body.appendChild(tr);
  }
}

function nearestSwapPickup() {
  let best = null, bd = G.PICK_R + 0.4;
  for (const pk of S.pickups.values()) {
    if (pk.kind === 'health') continue;
    const d = Math.hypot(pk.x - me.x, pk.y - me.y);
    if (d < bd && Math.abs(pk.z - me.z) < 1.2) { bd = d; best = pk; }
  }
  return best;
}

function updateHUD(now) {
  if (!S.joined) return;
  const hp = Math.max(0, Math.round(me.hp));
  setText($('hpval'), 'hp', String(hp));
  const fill = $('hpfill');
  if (hudCache.hpw !== hp) {
    hudCache.hpw = hp;
    fill.style.width = hp + '%';
    fill.style.background = hp > 50 ? '#6ee7a0' : hp > 25 ? '#ffd166' : '#ff5a5a';
    if (hp < 30 && me.alive) $('vignette').style.opacity = '0.45';
    else if (hp >= 30) $('vignette').style.opacity = '0';
  }
  setText($('floor'), 'floor', G.floorLabel(me.z));
  setText($('ping'), 'ping', `${S.ping} ms`);

  for (let i = 0; i < 3; i++) {
    const it = S.inv[i];
    const el = slotEls[i];
    const nameEl = el.querySelector('.wname');
    const ammoEl = el.querySelector('.ammo');
    let name, ammo, color = '', low = false;
    if (!it) { name = '비어있음'; ammo = ''; }
    else {
      const w = G.WEAPONS[it.kind];
      const mag = i === S.slot ? predictedMag() : it.mag;
      name = w.name;
      ammo = `${mag} / ${w.infinite ? '∞' : it.reserve}`;
      color = w.color;
      low = mag <= Math.ceil(w.mag * 0.25);
    }
    setText(nameEl, 'sn' + i, name);
    setText(ammoEl, 'sa' + i, ammo);
    const cls = `slot${!it ? ' empty' : ''}${i === S.slot ? ' active' : ''}`;
    if (hudCache['sc' + i] !== cls) { hudCache['sc' + i] = cls; el.className = cls; }
    if (hudCache['scol' + i] !== color) { hudCache['scol' + i] = color; el.style.setProperty('--wc', color || 'var(--accent)'); }
    ammoEl.classList.toggle('low', low);
  }

  const cur = S.inv[S.slot];
  if (cur) {
    const w = G.WEAPONS[cur.kind];
    setText($('wstats'), 'ws', `데미지 ${w.dmg}${w.pellets > 1 ? '×' + w.pellets : ''} · 사거리 ${w.range}m · 초당 ${(1 / w.interval).toFixed(1)}발`);
  }

  // 줍기 안내 (인벤토리가 가득 찬 경우 E로 교체)
  const hint = $('hint');
  let hintText = '';
  if (me.alive) {
    const pk = nearestSwapPickup();
    if (pk && !S.inv.some((it) => it && it.kind === pk.kind) && !S.inv.some((it) => !it)) {
      hintText = `[E] ${G.WEAPONS[pk.kind].name} 줍기 — 들고 있는 ${cur ? G.WEAPONS[cur.kind].name : ''}과 교체`;
    }
  }
  setText(hint, 'hint', hintText);
  hint.classList.toggle('show', !!hintText);

  // 조준점
  crosshair.style.transform = `translate(${mouse.x}px, ${mouse.y}px)`;
  const range = cur ? G.WEAPONS[cur.kind].range : 0;
  const far = cur && Math.hypot(aim.x - me.x, aim.y - me.y) > range;
  const ccls = aim.lock ? 'lock' : far ? 'far' : '';
  if (hudCache.cross !== ccls) { hudCache.cross = ccls; crosshair.className = ccls; }

  const rr = $('reloadring');
  const reloading = S.reloadEnd > now && me.alive;
  rr.classList.toggle('show', reloading);
  if (reloading) $('reloadfill').style.width = `${clamp(1 - (S.reloadEnd - now) / S.reloadTotal, 0, 1) * 100}%`;

  const death = $('death');
  death.classList.toggle('hidden', me.alive);
  if (!me.alive) {
    setText($('deathby'), 'dby', S.killerName ? `${S.killerName} 에게 당했습니다` : '');
    const left = S.respawnEnd ? Math.max(0, S.respawnEnd - now) : 0;
    setText($('deathtimer'), 'dt', `${Math.ceil(left / 1000)}초 후 부활`);
  }
}

/* ═════════════════════════ 미니맵 ═════════════════════════ */
const mm = $('minimap');
const mctx = mm.getContext('2d');
const MMS = mm.width / G.MAP_W;
const mmStatic = document.createElement('canvas');
mmStatic.width = mm.width;
mmStatic.height = mm.height;
(() => {
  const g = mmStatic.getContext('2d');
  const COL = {
    building: '#7f8aa3', parapet: '#aab4c8', wall: '#58617a', crate: '#a87a4a', low: '#958863',
    stair: '#c9c0ae', bridge: '#8f8272', pillar: '#555c6b', rail: '#5c6270',
  };
  g.fillStyle = '#3b4250';
  g.fillRect(0, 0, mm.width, mm.height);
  const sorted = G.BOXES.filter((b) => b.kind !== 'bound').sort((a, b) => a.z1 - b.z1);
  for (const b of sorted) {
    g.fillStyle = COL[b.kind] || '#666';
    g.fillRect(b.x0 * MMS, b.y0 * MMS, (b.x1 - b.x0) * MMS, (b.y1 - b.y0) * MMS);
  }
})();
function drawMinimap() {
  mctx.clearRect(0, 0, mm.width, mm.height);
  mctx.drawImage(mmStatic, 0, 0);
  for (const pk of S.pickups.values()) {
    mctx.fillStyle = pickupColor(pk.kind);
    mctx.fillRect(pk.x * MMS - 2, pk.y * MMS - 2, 4, 4);
  }
  for (const r of S.remotes.values()) {
    if (!r.alive || r.vis < 0.5) continue;
    mctx.fillStyle = '#ff4d4d';
    mctx.beginPath();
    mctx.arc(r.x * MMS, r.y * MMS, 3.5, 0, Math.PI * 2);
    mctx.fill();
  }
  if (S.joined && me.alive) {
    mctx.save();
    mctx.translate(me.x * MMS, me.y * MMS);
    mctx.rotate(me.yaw);
    mctx.fillStyle = '#ffffff';
    mctx.strokeStyle = '#000';
    mctx.lineWidth = 1;
    mctx.beginPath();
    mctx.moveTo(6, 0); mctx.lineTo(-4, 4); mctx.lineTo(-2, 0); mctx.lineTo(-4, -4);
    mctx.closePath();
    mctx.fill();
    mctx.stroke();
    mctx.restore();
  }
}

/* ═════════════════════════ 프레임 업데이트 ═════════════════════════ */
function updateLocal(dt, now) {
  if (!S.joined) return;
  if (me.alive) {
    let f = 0, s = 0;
    if (!chatOpen) {
      if (keys.has('KeyW')) f++;
      if (keys.has('KeyS')) f--;
      if (keys.has('KeyD')) s++;
      if (keys.has('KeyA')) s--;
    }
    G.stepMove(me, FWD.x * f + RIGHT.x * s, FWD.y * f + RIGHT.y * s, dt);
    if (Math.hypot(aim.x - me.x, aim.y - me.y) > 0.25) me.yaw = Math.atan2(aim.y - me.y, aim.x - me.x);
    if (now - S.lastSend > 33) {
      S.lastSend = now;
      send({ type: 'st', x: +me.x.toFixed(3), y: +me.y.toFixed(3), z: +me.z.toFixed(3), yaw: +me.yaw.toFixed(3), sq: me.sq });
    }
  }
  if (!myAv) myAv = makeAvatar(S.myColor, true);
  placeAvatar(myAv, me.x, me.y, me.z, me.yaw, dt);
  let op = me.alive ? 1 : 0;
  if (me.alive && me.prot) op = 0.55 + 0.3 * Math.sin(now / 55);
  setAvatarOpacity(myAv, op);
}

function updateRemotes(dt, now) {
  const k = 1 - Math.exp(-dt * 15);
  for (const r of S.remotes.values()) {
    r.x += (r.tx - r.x) * k;
    r.y += (r.ty - r.y) * k;
    r.z += (r.tz - r.z) * k;
    r.yaw = angleLerp(r.yaw, r.tyaw, k);
    // 시야(벽/상자에 가려지면 안 보임)
    let target = r.alive ? 1 : 0;
    if (r.alive && S.joined && me.alive) {
      target = G.lineOfSight(me.x, me.y, me.z + G.GUN_H, r.x, r.y, r.z + G.GUN_H) ? 1 : 0;
    }
    r.vis += (target - r.vis) * Math.min(1, dt * 12);
    let op = r.vis;
    if (r.prot) op *= 0.55 + 0.3 * Math.sin(now / 55);
    setAvatarOpacity(r.av, op);
    placeAvatar(r.av, r.x, r.y, r.z, r.yaw, dt);
  }
}

function updatePickups(dt, now) {
  const t = now / 1000;
  for (const pk of S.pickups.values()) {
    pk.model.inner.rotation.y = t * 1.6 + pk.phase;
    pk.model.inner.position.y = 0.7 + Math.sin(t * 2.4 + pk.phase) * 0.1;
  }
}

function updateCamera(dt, now) {
  const cur = S.inv[S.slot];
  const sniper = cur && cur.kind === 'sniper';
  const aiming = mouse.right && me.alive && S.joined;
  const targetZoom = aiming ? (sniper ? 1.45 : 1.15) : 1;
  zoomMul += (targetZoom - zoomMul) * Math.min(1, dt * 6);
  updateProjection();

  let tx, ty, tz;
  if (S.joined) {
    // 마우스 방향으로 시야를 살짝(우클릭 시 크게) 내밀기
    const nx = (mouse.x / innerWidth) * 2 - 1;
    const ny = -((mouse.y / innerHeight) * 2 - 1);
    const halfH = (viewSize * zoomMul) / 2;
    const halfW = (halfH * innerWidth) / innerHeight;
    const sx = nx * halfW, sy = (ny * halfH) / Math.sin(CAM_EL);
    const frac = aiming ? (sniper ? 0.75 : 0.45) : 0.12;
    tx = me.x + (RIGHT.x * sx + FWD.x * sy) * frac;
    ty = me.y + (RIGHT.y * sx + FWD.y * sy) * frac;
    tz = me.z;
  } else {
    const t = now / 1000;
    tx = 32 + Math.sin(t * 0.12) * 14;
    ty = 32 + Math.cos(t * 0.09) * 10;
    tz = 0;
  }
  const k = 1 - Math.exp(-dt * 7);
  camTarget.x += (tx - camTarget.x) * k;
  camTarget.y += (tz - camTarget.y) * k;
  camTarget.z += (ty - camTarget.z) * k;

  shake = Math.max(0, shake - dt * 2.2);
  const sa = shake * shake * 0.9;
  const shx = (Math.random() * 2 - 1) * sa, shz = (Math.random() * 2 - 1) * sa;
  camera.position.set(camTarget.x + camOffset.x + shx, camTarget.y + camOffset.y, camTarget.z + camOffset.z + shz);
  camera.lookAt(camTarget.x + shx, camTarget.y, camTarget.z + shz);
  sun.position.copy(camTarget).add(SUN_OFF);
  sun.target.position.copy(camTarget);
}

function updateAimVisuals() {
  const cur = S.inv[S.slot];
  const show = S.joined && me.alive && !!cur;
  rangeRing.visible = show;
  aimLine.visible = show;
  if (!show) return;
  const w = G.WEAPONS[cur.kind];
  updateRangeRing(cur.kind);
  rangeRing.position.set(me.x, me.z + 0.05, me.y);
  const { ox, oy, oz, yaw, pitch } = aimAngles();
  const dx = Math.cos(pitch) * Math.cos(yaw), dy = Math.cos(pitch) * Math.sin(yaw), dz = Math.sin(pitch);
  const tr = G.traceShot(ox, oy, oz, dx, dy, dz, w.range, remoteTargets());
  const pos = aimGeo.attributes.position;
  pos.setXYZ(0, ox + dx * 0.6, oz + dz * 0.6, oy + dy * 0.6);
  pos.setXYZ(1, tr.x, tr.z, tr.y);
  pos.needsUpdate = true;
  aimLine.material.opacity = cur.kind === 'sniper' ? 0.55 : 0.25;
  aimLine.material.color.set(tr.target ? '#ff6b6b' : '#ffffff');
}

function updateLabels(dt) {
  for (const r of S.remotes.values()) {
    updateTag(r.tag, nameOf(r.id), colorOf(r.id), r.hp, r.x, r.y, r.z, r.alive ? r.av.opacity : 0);
  }
  if (S.joined) updateTag(myTag, nameOf(S.myId), S.myColor, me.hp, me.x, me.y, me.z, me.alive ? 1 : 0);

  const cx = S.joined ? me.x : camTarget.x, cy = S.joined ? me.y : camTarget.z;
  for (const pk of S.pickups.values()) {
    const near = Math.hypot(pk.x - cx, pk.y - cy) < 11;
    let show = false, p;
    if (near) { p = toScreen(pk.x, pk.y, pk.z + 1.55); show = p.on; }
    if (show !== pk.labelShown) { pk.labelShown = show; pk.label.style.display = show ? '' : 'none'; }
    if (show) { pk.label.style.left = p.x + 'px'; pk.label.style.top = p.y + 'px'; }
  }

  for (let i = dmgNums.length - 1; i >= 0; i--) {
    const d = dmgNums[i];
    d.t += dt;
    if (d.t > 0.9) { d.el.remove(); dmgNums.splice(i, 1); continue; }
    const p = toScreen(d.x, d.y, d.z + 0.6 + d.t * 1.5);
    d.el.style.left = p.x + 'px';
    d.el.style.top = p.y + 'px';
    d.el.style.opacity = String(clamp(1.4 - d.t / 0.9, 0, 1));
  }
}

let lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000));
  lastT = now;
  updateLocal(dt, now);
  updateRemotes(dt, now);
  updateCamera(dt, now);
  updateAim();
  if (mouse.left) tryFire(now);
  updatePickups(dt, now);
  updateFx(dt);
  updateAimVisuals();
  renderer.render(scene, camera);
  updateLabels(dt);
  updateHUD(now);
  drawMinimap();
}
requestAnimationFrame(frame);

/* ═════════════════════════ 로그인 ═════════════════════════ */
const nameInput = $('nameinput');
const joinBtn = $('joinbtn');
try { nameInput.value = localStorage.getItem('opl_name') || ''; } catch { /* 저장소 사용 불가 */ }
nameInput.focus();

async function join() {
  if (S.joined || joinBtn.disabled) return;
  Sfx.init();
  joinBtn.disabled = true;
  $('loginmsg').textContent = '';
  try {
    if (!S.connected) await connect();
  } catch {
    $('loginmsg').textContent = '서버에 연결할 수 없습니다. 서버가 켜져 있는지 확인하세요.';
    joinBtn.disabled = false;
    return;
  }
  const name = nameInput.value.trim();
  try { localStorage.setItem('opl_name', name); } catch { /* 무시 */ }
  send({ type: 'join', name });
  S.joined = true;
  nameInput.blur();
  $('login').classList.add('hidden');
  $('hud').classList.remove('hidden');
  joinBtn.disabled = false;
}
joinBtn.addEventListener('click', join);
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) join();
});
