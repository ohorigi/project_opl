// 개선OPL 클라이언트 - 쿼터뷰 렌더링 / 입력 / 네트워크
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as G from '/shared/common.js';
import { PixelPipeline } from '/pixelpass.js';
import { makeGround, tex, worldBox } from '/textures.js';
import { FOG } from '/fog.js';
import { SHEETS } from '/sheets.js';
import {
  CHARACTERS, toonMat, buildGunGroup, gunMats, makeAvatar, disposeAvatar, setAvatarWeapon, setAvatarOpacity,
  setAvatarColor, setAvatarShield, setAvatarHit, setAvatarSpin, poseAvatar, muzzleOf, ejectPointOf, makeBaker,
  initSprites, spriteUrl,
} from '/characters.js';

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
const me = { x: G.MAP_W / 2, y: 20, z: 0, vz: 0, onGround: true, yaw: 0, alive: false, hp: 100, sq: 0, prot: false, evt: null };
const S = {
  ws: null, connected: false, joined: false, myId: 0, myColor: '#ffffff',
  inv: [null, null, null], slot: 0, slotLockUntil: 0,
  reloadEnd: 0, reloadTotal: 1, respawnEnd: 0,
  fs: 0, ack: 0, ping: 0,
  remotes: new Map(), roster: new Map(), pickups: new Map(),
  nextFireAt: 0, lastReloadReq: 0, lastSend: 0, killerName: '',
  name: '', clockOff: null, reconnectTries: 0, char: 0, wasAir: false,
  lastPongAt: 0, lastSnapAt: 0, firstUnackedAt: 0, lastPingAt: 0,
  protEnd: 0, nades: 0, nadeLockUntil: 0, nextNadeAt: 0, protWarnAt: 0,
  mode: 'pvp', sg: null, bossId: 0,
};
// 탭마다 고유한 키: 연결이 끊겼다 다시 붙으면 서버가 점수/색을 이어줌
const SESSION_KEY = (() => {
  let k = null;
  try { k = sessionStorage.getItem('opl_key'); } catch { /* 저장소 사용 불가 */ }
  if (!k) {
    k = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { sessionStorage.setItem('opl_key', k); } catch { /* 무시 */ }
  }
  return k;
})();
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
  // 잡음 한 번 (폭발, 부서짐, 물소리)
  function noiseHit(f0, f1, dur, vol, type = 'lowpass') {
    if (!ctx || vol <= 0.02) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 0.4);
    src.stop(t + dur + 0.02);
  }
  return {
    init, shot,
    boom: (vol = 1) => {
      noiseHit(1800, 60, 1.1, 1.1 * vol);
      tone(90, 0.5, 'sine', 0.6 * vol, 28);
    },
    bounce: (vol = 1) => tone(900, 0.04, 'square', 0.05 * vol, 600),
    pin: () => { tone(1800, 0.03, 'square', 0.05); tone(1300, 0.05, 'triangle', 0.06, null, 0.05); },
    pad: () => { tone(220, 0.25, 'square', 0.08, 880); tone(330, 0.2, 'triangle', 0.08, 1200, 0.03); },
    splash: (vol = 1) => noiseHit(2400, 500, 0.18, 0.18 * vol, 'bandpass'),
    breakWood: (vol = 1) => { noiseHit(1400, 200, 0.35, 0.5 * vol); tone(160, 0.12, 'square', 0.08 * vol, 70); },
    breakMetal: (vol = 1) => { noiseHit(3500, 900, 0.3, 0.35 * vol, 'bandpass'); tone(520, 0.3, 'triangle', 0.06 * vol, 380); },
    blocked: () => tone(260, 0.08, 'square', 0.05, 200),
    laser: () => { tone(1800, 0.12, 'sine', 0.05, 2400); tone(1800, 0.12, 'sine', 0.05, 2400, 0.25); },
    charge: () => tone(300, 0.35, 'sine', 0.05, 900),
    spin: () => tone(120, 0.7, 'sawtooth', 0.06, 620),
    fanfare: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'square', 0.08, null, i * 0.12)); },
    stageStart: () => { tone(392, 0.12, 'square', 0.07); tone(523, 0.2, 'square', 0.07, null, 0.12); },
    hit: () => tone(1500, 0.05, 'square', 0.07),
    kill: () => { tone(880, 0.09, 'square', 0.09); tone(1320, 0.16, 'square', 0.09, null, 0.08); },
    hurt: () => tone(190, 0.16, 'sawtooth', 0.12, 80),
    pick: () => { tone(660, 0.06, 'triangle', 0.15); tone(990, 0.09, 'triangle', 0.15, null, 0.06); },
    empty: () => tone(2200, 0.03, 'square', 0.05),
    reload: () => { tone(500, 0.04, 'square', 0.05); tone(720, 0.04, 'square', 0.05, null, 0.12); },
    swap: () => tone(420, 0.06, 'triangle', 0.1, 640),
    die: () => tone(320, 0.7, 'sawtooth', 0.12, 55),
    jump: () => tone(300, 0.09, 'triangle', 0.08, 520),
    land: () => tone(120, 0.06, 'triangle', 0.08, 70),
  };
})();

/* ═════════════════════════ 렌더러 / 카메라 (도트 렌더링) ═════════════════════════ */
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap; // 도트에 맞게 경계가 딱 떨어지는 그림자

const scene = new THREE.Scene();
scene.background = new THREE.Color('#2a3424');

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
const CAM_AZ = Math.PI / 4;
const CAM_EL = THREE.MathUtils.degToRad(42);
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
FOG.size.value.set(G.MAP_W, G.MAP_H);

const pixel = new PixelPipeline(renderer, camera);
initSprites(pixel.spriteScene, pixel.spriteUniforms);
pixel.resize();
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight, false); pixel.resize(); });

// 조명: 따뜻한 햇빛 + 푸른 하늘빛. 툰 셰이딩이라 명암이 2~3단계로 끊어져 도트처럼 보임
scene.add(new THREE.HemisphereLight('#cfe0ff', '#5a4a3a', 1.3));
const sun = new THREE.DirectionalLight('#fff0d6', 2.7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -46, right: 46, top: 46, bottom: -46, near: 1, far: 170 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const SUN_OFF = new THREE.Vector3(-22, 48, -12);

/* ═════════════════════════ 맵 (도트 텍스처) ═════════════════════════ */
const pickables = [];
const FLOOR_KINDS = new Set(['roof', 'stair', 'bridge', 'ground', 'tower', 'plat']);
const lv = (name, color = '#ffffff') => toonMat(color, { map: tex(name), transparent: false });
// 안 보이지만 그림자는 그대로 드리우는 재질 (건물 안에 들어가면 지붕/앞벽을 이걸로 바꿈)
const INVIS = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
const MT = {
  brick: lv('brick'), plaster: lv('plaster'), cap: lv('stoneCap'), roof: lv('roof'), concrete: lv('concrete'),
  crate: lv('crate'), crateTop: lv('crateTop'), sandbag: lv('sandbag'), concreteLight: lv('concreteLight'),
  stairTop: lv('stairTop'), beam: lv('beam'), plank: lv('plank'), metal: lv('metal'), pillar: lv('pillar'),
  bound: lv('boundWall'), tower: lv('towerStone'), grating: lv('grating'), stepStone: lv('stepStone'), tableTop: lv('tableTop'),
};
// 면 순서: +x(동), -x(서), +y(위), -y(아래), +z(남), -z(북)
const six = (side, top) => [side, side, top, side, side, side];
function wallMats(side, kind) {
  const B = MT.brick, P = MT.plaster, C = MT.cap;
  if (kind === 'iwall') return [P, P, C, C, P, P];
  if (side === 'n') return [B, B, C, C, P, B];   // 안쪽(남쪽 면)만 회벽
  if (side === 's') return [B, B, C, C, B, P];
  if (side === 'w') return [P, B, C, C, B, B];
  return [B, P, C, C, B, B];
}
const KIND_MATS = {
  roof: [MT.cap, MT.cap, MT.roof, MT.cap, MT.cap, MT.cap],
  parapet: six(MT.cap, MT.cap),
  wall: six(MT.concrete, MT.cap),
  low: six(MT.sandbag, MT.sandbag),
  stair: six(MT.concreteLight, MT.stairTop),
  bridge: six(MT.beam, MT.plank),
  rail: six(MT.metal, MT.metal),
  pillar: six(MT.pillar, MT.concreteLight),
  bound: six(MT.bound, MT.bound),
  tower: six(MT.tower, MT.roof),
  plat: six(MT.metal, MT.grating),
  pole: six(MT.metal, MT.metal),
  stone: six(MT.stepStone, MT.stepStone),
  deck: six(MT.beam, MT.plank),
  table: six(MT.beam, MT.tableTop),
  crate: six(MT.crate, MT.crateTop),
};
const DRUM_MATS = [lv('drumBlue'), lv('drumRed'), lv('drumOlive')];
const drumTopMat = lv('drumTop');
const trimMat = toonMat('#6b4223', { transparent: false });
const fenceMat = toonMat('#8a5d38', { transparent: false });

// 드럼통 옆모습 (테두리와 띠가 튀어나온 원통)
const drumGeo = (() => {
  const pts = [[0.3, 0], [0.36, 0.02], [0.37, 0.06], [0.355, 0.1], [0.355, 0.38], [0.385, 0.4], [0.385, 0.44], [0.355, 0.46],
    [0.355, 0.79], [0.385, 0.81], [0.385, 0.85], [0.355, 0.87], [0.355, 1.17], [0.37, 1.21], [0.36, 1.25], [0.32, 1.25]];
  return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 14);
})();
const drumLidGeo = new THREE.CircleGeometry(0.33, 14).rotateX(-Math.PI / 2);

// 상자 모서리 각재: 기둥 4개 + 위/아래 테 (상자 바닥 가운데 기준 좌표)
function crateTrimGeo(w, h, d) {
  const out = [];
  const t = 0.1, p = 0.025;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    out.push(new THREE.BoxGeometry(t, h, t).translate(sx * (w / 2 - t / 2 + p), h / 2, sy * (d / 2 - t / 2 + p)));
  }
  for (const z of [0.04, h - 0.04]) {
    for (const sy of [-1, 1]) out.push(new THREE.BoxGeometry(w + p * 2, 0.08, t).translate(0, z, sy * (d / 2 - t / 2 + p)));
    for (const sx of [-1, 1]) out.push(new THREE.BoxGeometry(t, 0.08, d + p * 2).translate(sx * (w / 2 - t / 2 + p), z, 0));
  }
  return mergeGeometries(out);
}
// 나무 울타리: 기둥 + 가로대 2줄
function fenceGeo(b) {
  const parts = [];
  const alongX = (b.x1 - b.x0) >= (b.y1 - b.y0);
  const len = alongX ? b.x1 - b.x0 : b.y1 - b.y0;
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const n = Math.max(1, Math.round(len / 1.2));
  for (let i = 0; i <= n; i++) {
    const a = -len / 2 + (len * i) / n;
    parts.push(new THREE.BoxGeometry(0.13, 0.95, 0.13).translate(alongX ? cx + a : cx, 0.475, alongX ? cy : cy + a));
  }
  for (const h of [0.32, 0.72]) parts.push(new THREE.BoxGeometry(alongX ? len : 0.07, 0.1, alongX ? 0.07 : len).translate(cx, h, cy));
  return mergeGeometries(parts);
}

const propViews = new Map();   // 상자/드럼통: box.id → { b, obj, wob, pop }
const cutInfo = G.BUILDINGS.map(() => ({ hide: [], stubs: [] })); // 건물 안에 들어갔을 때 숨길 것
const waterTex = [];
const padViews = [];
function regHide(bi, obj) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.userData.mat = o.material;
    cutInfo[bi].hide.push(o);
  });
}

function buildLevel() {
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), toonMat('#3a5a2c', { transparent: false }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.set(G.MAP_W / 2, -0.05, G.MAP_H / 2);
  scene.add(outer);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(G.MAP_W, G.MAP_H), toonMat('#ffffff', { map: makeGround(G), transparent: false }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(G.MAP_W / 2, 0, G.MAP_H / 2);
  ground.receiveShadow = true;
  ground.userData = { kind: 'ground' };
  scene.add(ground);
  pickables.push(ground);

  let drumIdx = 0;
  for (const b of G.BOXES) {
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const w = b.x1 - b.x0, d = b.y1 - b.y0, h = b.z1 - b.z0;
    // 부서지는 물체: 그룹째로 숨기거나 흔들 수 있게 바닥 가운데를 원점으로
    if (b.kind === 'drum' || b.kind === 'crate') {
      const obj = new THREE.Group();
      obj.position.set(cx, b.z0, cy);
      if (b.kind === 'drum') {
        const body = new THREE.Mesh(drumGeo, DRUM_MATS[b.tone || 0]);
        body.rotation.y = drumIdx * 1.7;
        const lid = new THREE.Mesh(drumLidGeo, drumTopMat);
        lid.position.y = 1.235;
        lid.rotation.y = drumIdx * 2.3;
        obj.add(body, lid);
        drumIdx++;
      } else {
        const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), KIND_MATS.crate);
        const trim = new THREE.Mesh(crateTrimGeo(w, h, d), trimMat);
        obj.add(body, trim);
      }
      obj.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.userData = { kind: b.kind }; pickables.push(o); } });
      scene.add(obj);
      propViews.set(b.id, { b, obj, wob: 0, pop: 0, dead: false });
      if (b.roofOf >= 0) regHide(b.roofOf, obj);
      continue;
    }
    if (b.kind === 'fence') {
      const m = new THREE.Mesh(fenceGeo(b), fenceMat);
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
      continue;
    }
    const z1 = b.kind === 'bound' ? 1.2 : b.z1; // 외곽 벽은 시야를 가리지 않게 낮게 그림
    const mats = b.kind === 'bwall' || b.kind === 'iwall' ? wallMats(b.side, b.kind) : (KIND_MATS[b.kind] || KIND_MATS.wall);
    const mesh = new THREE.Mesh(worldBox(b.x0, b.y0, b.z0, b.x1, b.y1, z1), mats);
    mesh.position.set(cx, (b.z0 + z1) / 2, cy);
    mesh.castShadow = b.kind !== 'bound';
    mesh.receiveShadow = true;
    mesh.userData = { kind: b.kind };
    scene.add(mesh);
    if (b.kind !== 'rail') pickables.push(mesh);
    // 건물 안을 보여줄 때: 지붕/옥상 물건은 숨기고, 카메라 쪽(남·동) 벽과 칸막이벽은 허리 높이로 자름
    if (b.kind === 'roof' && b.bi >= 0) regHide(b.bi, mesh);
    else if (b.roofOf >= 0) regHide(b.roofOf, mesh);
    else if (b.bi >= 0 && (b.kind === 'iwall' || b.side === 's' || b.side === 'e')) {
      if (b.z0 >= 1.0) regHide(b.bi, mesh);
      else if (b.z1 > 1.05) {
        const stub = new THREE.Mesh(worldBox(b.x0, b.y0, b.z0, b.x1, b.y1, 1.0), mats);
        stub.position.set(cx, (b.z0 + 1.0) / 2, cy);
        stub.receiveShadow = true;
        stub.visible = false;
        scene.add(stub);
        mesh.userData.mat = mesh.material;
        cutInfo[b.bi].stubs.push([mesh, stub]);
      }
    }
  }

  // 물 (도트 물결이 천천히 흘러감)
  for (const wa of G.WATER) {
    const t = tex('water').clone();
    t.needsUpdate = true;
    t.repeat.set((wa.x1 - wa.x0) / 2, (wa.y1 - wa.y0) / 2);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(wa.x1 - wa.x0, wa.y1 - wa.y0),
      toonMat('#ffffff', { map: t, transparent: true, opacity: 0.9, emissive: '#16384a', emissiveIntensity: 0.7, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set((wa.x0 + wa.x1) / 2, 0.03, (wa.y0 + wa.y1) / 2);
    m.receiveShadow = true;
    m.renderOrder = 1;
    scene.add(m);
    waterTex.push(t);
  }

  // 점프 발판
  const padBase = toonMat('#3a3f47', { transparent: false });
  const padRing = toonMat('#e3b740', { transparent: false, emissive: '#e3b740', emissiveIntensity: 0.35 });
  for (const p of G.PADS) {
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.y);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.7, 0.1, 16), padBase);
    base.position.y = 0.05;
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.11, 16, 1, true), padRing);
    ring.position.y = 0.055;
    for (let i = 0; i < 4; i++) { // 노란/검은 경고 띠
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.5), padBase);
      s.position.set(Math.cos(i * Math.PI / 2) * 0.0, 0.112, 0);
      s.rotation.y = i * Math.PI / 4 + Math.PI / 8;
      if (i < 2) g.add(s);
    }
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.44, 16).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#7ff0ff', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.y = 0.115;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 2.2, 14, 1, true),
      new THREE.MeshBasicMaterial({ color: '#7ff0ff', transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = 1.15;
    base.receiveShadow = ring.receiveShadow = true;
    g.add(base, ring, glow, beam);
    scene.add(g);
    padViews.push({ p, g, glow, beam, kick: 0 });
  }
}
buildLevel();

// 건물 하나를 잘라서 안을 보여주거나 되돌림
function setCut(bi, on) {
  const ci = cutInfo[bi];
  if (!ci) return;
  for (const m of ci.hide) { m.material = on ? INVIS : m.userData.mat; m.userData.hidden = on; }
  for (const [full, stub] of ci.stubs) {
    full.material = on ? INVIS : full.userData.mat;
    full.userData.hidden = on;
    stub.visible = on;
  }
}

/* ═════════════════════════ 시야 (건물 안 / 창문) ═════════════════════════ */
const FOG_PPU = 5;
const fogCanvas = document.createElement('canvas');
fogCanvas.width = G.MAP_W * FOG_PPU;
fogCanvas.height = G.MAP_H * FOG_PPU;
const fogCtx = fogCanvas.getContext('2d');
const fogTex = new THREE.CanvasTexture(fogCanvas);
fogTex.flipY = false;
fogTex.magFilter = fogTex.minFilter = THREE.NearestFilter;
fogTex.generateMipmaps = false;
FOG.tex.value = fogTex;
let cutBi = -1, fogMode = 0, peekBi = -1;
let lastFogAt = 0, lastFogKey = '';

// 건물 안 = 그 건물을 잘라서 보여주고, 창문/문으로 보이는 곳 말고는 어둡게.
// 밖에서 창문/문 가까이 가면 = 그 건물을 잘라서 창문으로 보이는 만큼만 안을 보여줌.
function updateCutaway(now) {
  let want = -1, mode = 0;
  if (S.joined && me.alive) {
    const inB = G.insideBuilding(me.x, me.y, me.z);
    if (inB >= 0) { want = inB; mode = 1; peekBi = -1; }
    else if (me.z < 1.2) {
      let best = -1, bd = 2.1;
      for (const b of G.BUILDINGS) {
        for (const o of b.openings) {
          const d = Math.hypot(o.x - me.x, o.y - me.y) - (b.id === peekBi ? 0.6 : 0); // 떨림 방지
          if (d < bd) { bd = d; best = b.id; }
        }
      }
      peekBi = best;
      if (best >= 0) { want = best; mode = 2; }
    } else peekBi = -1;
  } else peekBi = -1;
  if (want !== cutBi) {
    if (cutBi >= 0) setCut(cutBi, false);
    if (want >= 0) setCut(want, true);
    cutBi = want;
  }
  fogMode = mode;
  FOG.on.value = mode ? 1 : 0;
  FOG.roofLit.value = mode === 2 ? 1 : 0;
  if (!mode) return;
  const key = `${mode}|${cutBi}|${me.x.toFixed(2)}|${me.y.toFixed(2)}|${me.z.toFixed(1)}`;
  if (key === lastFogKey && now - lastFogAt < 500) return;
  if (now - lastFogAt < 40) return;
  lastFogKey = key;
  lastFogAt = now;
  const s = FOG_PPU;
  const eyeZ = mode === 1 ? Math.min(me.z + G.EYE_H, G.WALL_H - 0.3) : me.z + G.EYE_H;
  const poly = G.visibilityPolygon(me.x, me.y, eyeZ, 50);
  fogCtx.fillStyle = mode === 1 ? '#000' : '#fff';
  fogCtx.fillRect(0, 0, fogCanvas.width, fogCanvas.height);
  if (mode === 2) {
    const b = G.BUILDINGS[cutBi];
    fogCtx.fillStyle = '#000';
    fogCtx.fillRect(b.x0 * s, b.y0 * s, (b.x1 - b.x0) * s, (b.y1 - b.y0) * s);
  }
  fogCtx.fillStyle = '#fff';
  fogCtx.strokeStyle = '#fff';
  fogCtx.lineWidth = s * 0.9; // 경계의 벽 면도 밝게
  fogCtx.lineJoin = 'round';
  fogCtx.beginPath();
  poly.forEach(([x, y], i) => (i ? fogCtx.lineTo(x * s, y * s) : fogCtx.moveTo(x * s, y * s)));
  fogCtx.closePath();
  fogCtx.fill();
  fogCtx.stroke();
  fogTex.needsUpdate = true;
}

/* ═════════════════════════ 부서지는 물체 ═════════════════════════ */
let propVersion = 0;
function propAt(x, y, z) {
  for (const v of propViews.values()) {
    const b = v.b;
    if (!v.dead && x > b.x0 - 0.08 && x < b.x1 + 0.08 && y > b.y0 - 0.08 && y < b.y1 + 0.08 && z > b.z0 - 0.08 && z < b.z1 + 0.08) return v;
  }
  return null;
}
function applyDeadProps(list) {
  const dead = new Set(list || []);
  for (const [id, v] of propViews) {
    const isDead = dead.has(id);
    if (isDead === v.dead) continue;
    v.dead = isDead;
    v.b.dead = isDead;
    v.obj.visible = !isDead;
    propVersion++;
    if (isDead) breakFx(v.b);
    else { v.pop = 0.3; }
  }
}
function breakFx(b) {
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, cz = (b.z0 + b.z1) / 2;
  const vol = Math.pow(clamp(1 - Math.hypot(cx - me.x, cy - me.y) / 40, 0, 1), 1.5);
  if (b.kind === 'crate') {
    for (let i = 0; i < 12; i++) debris(cx, cy, cz, ['#b47a43', '#8a5a30', '#c99356'][i % 3], [0.32, 0.06, 0.1], 4.5, b.z0);
    burst(cx, cy, cz, '#d8c4a0', 10, 2.5, 0.08, 0.6);
    Sfx.breakWood(vol);
  } else {
    const col = ['#2f5d8a', '#9b3a2c', '#5a6b34'][b.tone || 0];
    for (let i = 0; i < 9; i++) debris(cx, cy, cz, i % 3 ? col : '#6f7680', [0.18, 0.03, 0.14], 5, b.z0);
    Sfx.breakMetal(vol);
  }
  smoke(cx, cy, cz, 0, 0, 0.9, 1.1);
}
function updateProps(dt) {
  for (const v of propViews.values()) {
    if (v.wob > 0) {
      v.wob = Math.max(0, v.wob - dt);
      const k = v.wob / 0.25;
      v.obj.rotation.z = Math.sin(v.wob * 70) * 0.05 * k;
      v.obj.rotation.x = Math.cos(v.wob * 55) * 0.03 * k;
    }
    if (v.pop > 0) {
      v.pop = Math.max(0, v.pop - dt);
      v.obj.scale.setScalar(1 - (v.pop / 0.3) * 0.4);
    }
  }
}

/* ═════════════════════════ 물 / 점프 발판 연출 ═════════════════════════ */
function updateEnvironment(dt, now) {
  const t = now / 1000;
  for (const w of waterTex) { w.offset.x = Math.floor(t * 3) / 32; w.offset.y = Math.floor(t * 1.5) / 32; }
  for (const pv of padViews) {
    pv.kick = Math.max(0, pv.kick - dt * 3);
    pv.glow.material.opacity = 0.35 + 0.25 * Math.sin(t * 5 + pv.p.x) + pv.kick * 0.5;
    pv.beam.material.opacity = 0.05 + pv.kick * 0.25;
    pv.g.scale.y = 1 - pv.kick * 0.5;
  }
}
function padFx(x, y) {
  for (const pv of padViews) if (Math.hypot(pv.p.x - x, pv.p.y - y) < 1) pv.kick = 1;
  burst(x, y, 0.15, '#7ff0ff', 12, 4, 0.07, 0.5);
}
function splashFx(x, y) {
  burst(x, y, 0.08, '#cfeefc', 4, 1.6, 0.05, 0.35);
}

/* ═════════════════════════ 캐릭터 ═════════════════════════ */
let myAv = null;
function charOf(id) {
  const r = S.roster.get(id);
  return r && Number.isInteger(r.char) ? r.char : 0;
}
// 공중에 떠 있는지 (점프 자세용)
function isAirborne(x, y, z) {
  return z - G.groundAt(x, y, z + 0.05) > 0.15;
}

/* ═════════════════════════ 아이템 모델 ═════════════════════════ */
const beamGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.8, 12, 1, true);
const pickRingGeo = new THREE.RingGeometry(0.55, 0.7, 20);
function pickupColor(kind) { return kind === 'health' ? '#4ade80' : G.WEAPONS[kind].color; }
function makePickupModel(kind) {
  const group = new THREE.Group();
  const color = pickupColor(kind);
  const inner = new THREE.Group();
  inner.position.y = 0.75;
  group.add(inner);
  if (kind === 'health') {
    const white = toonMat('#f4f1ea', { transparent: false });
    const red = toonMat('#d8322c', { transparent: false, emissive: '#7a1010', emissiveIntensity: 0.4 });
    inner.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.34), white));
    for (const s of [-1, 1]) {
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.02), red); a.position.z = s * 0.18; inner.add(a);
      const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.26, 0.02), red); b2.position.z = s * 0.18; inner.add(b2);
    }
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.08), toonMat('#3a3f47', { transparent: false }));
    handle.position.y = 0.2; inner.add(handle);
  } else {
    const g = buildGunGroup(kind, gunMats());
    g.group.position.x = -G.WEAPONS[kind].len * 0.5;
    inner.add(g.group);
  }
  inner.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  const ring = new THREE.Mesh(pickRingGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  }));
  beam.position.y = 0.9;
  group.add(ring, beam);
  scene.add(group);
  return { group, inner };
}
// 지오메트리는 여러 곳에서 같이 쓰므로 재질만 정리
function disposeGroup(group) {
  scene.remove(group);
  group.traverse((o) => { if (o.material) o.material.dispose(); });
}

/* ═════════════════════════ 사거리 표시 / 조준선 ═════════════════════════ */
// 사거리 원을 총구 높이에서 사방으로 쏜 광선으로 그림 → 드럼통·상자·벽 뒤는 원이 안쪽으로 막혀 보임
const RANGE_N = 360;
const rangeLineGeo = new THREE.BufferGeometry();
rangeLineGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(RANGE_N * 3), 3));
const rangeLine = new THREE.LineLoop(rangeLineGeo, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.32, depthWrite: false }));
rangeLine.frustumCulled = false;
rangeLine.renderOrder = 2;
const rangeFillGeo = new THREE.BufferGeometry();
rangeFillGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((RANGE_N + 1) * 3), 3));
{
  const idx = [];
  for (let i = 0; i < RANGE_N; i++) idx.push(RANGE_N, i, (i + 1) % RANGE_N);
  rangeFillGeo.setIndex(idx);
}
const rangeFill = new THREE.Mesh(rangeFillGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.045, depthWrite: false, side: THREE.DoubleSide }));
rangeFill.frustumCulled = false;
rangeFill.renderOrder = 2;
scene.add(rangeLine, rangeFill);
let rangeKey = '';
function updateRangeShape(kind) {
  const R = G.WEAPONS[kind].range;
  const key = `${kind}|${me.x.toFixed(2)}|${me.y.toFixed(2)}|${me.z.toFixed(2)}|${propVersion}`;
  if (key === rangeKey) return;
  rangeKey = key;
  const ox = me.x, oy = me.y, oz = me.z + G.GUN_H;
  const near = G.BOXES.filter((b) => !b.dead && b.kind !== 'rail' && b.z0 <= oz && b.z1 >= oz
    && b.x1 > ox - R && b.x0 < ox + R && b.y1 > oy - R && b.y0 < oy + R);
  const lp = rangeLineGeo.attributes.position, fp = rangeFillGeo.attributes.position;
  const y = me.z + 0.06;
  for (let i = 0; i < RANGE_N; i++) {
    const a = (i / RANGE_N) * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    let t = R;
    for (const b of near) {
      const h = G.rayBox(ox, oy, oz, dx, dy, 0, b, t);
      if (h >= 0 && h < t) t = h;
    }
    lp.setXYZ(i, ox + dx * t, y, oy + dy * t);
    fp.setXYZ(i, ox + dx * t, y, oy + dy * t);
  }
  fp.setXYZ(RANGE_N, ox, y, oy);
  lp.needsUpdate = fp.needsUpdate = true;
}
const aimGeo = new THREE.BufferGeometry();
aimGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
const aimLine = new THREE.Line(aimGeo, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.3, depthWrite: false }));
aimLine.frustumCulled = false;
scene.add(aimLine);

/* ═════════════════════════ 수류탄 ═════════════════════════ */
const nadeViews = [];
let localNadeSeq = 0;
const nadeBodyMat = toonMat('#4d5a32', { transparent: false });
const nadeMetalMat = toonMat('#9aa1ab', { transparent: false });
const nadeLightMat = new THREE.MeshBasicMaterial({ color: '#ff3b2f' });
function makeNadeMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), nadeBodyMat);
  body.scale.set(1, 1.15, 1);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.06, 8), nadeMetalMat);
  cap.position.y = 0.12;
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.02), nadeMetalMat);
  lever.position.set(0.06, 0.06, 0);
  lever.rotation.z = -0.3;
  const light = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), nadeLightMat);
  light.position.y = 0.16;
  g.add(body, cap, lever, light);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { g, light };
}
// pts = [[t,x,y,z]...] (서버나 내가 계산한 궤적), bounces = 튕긴 시각들
function spawnNadeView(id, pts, bounces, seq = 0) {
  const { g, light } = makeNadeMesh();
  scene.add(g);
  const v = { id, seq, pts, bounces: bounces || [], bi: 0, t0: performance.now(), g, light, spin: Math.random() * 6 };
  nadeViews.push(v);
  return v;
}
function onNadeMsg(m) {
  if (m.by === S.myId) {
    const mine = nadeViews.find((v) => v.seq === m.c && typeof v.id === 'string');
    if (mine) { mine.id = m.id; mine.pts = m.pts; mine.bounces = m.b || []; return; }
  }
  spawnNadeView(m.id, m.pts, m.b);
  const r = S.remotes.get(m.by);
  if (r && r.vis > 0.3) r.av.kick = 0.12;
}
function updateNades(now) {
  for (let i = nadeViews.length - 1; i >= 0; i--) {
    const v = nadeViews[i];
    const t = (now - v.t0) / 1000;
    if (t > G.NADE.fuse + 1.2) { scene.remove(v.g); nadeViews.splice(i, 1); continue; }
    const p = v.pts;
    let k = 1;
    while (k < p.length - 1 && p[k][0] < t) k++;
    const a = p[k - 1], b = p[k];
    const f = clamp((t - a[0]) / ((b[0] - a[0]) || 1), 0, 1);
    const x = a[1] + (b[1] - a[1]) * f, y = a[2] + (b[2] - a[2]) * f, z = a[3] + (b[3] - a[3]) * f;
    const moving = Math.hypot(b[1] - a[1], b[2] - a[2], b[3] - a[3]) > 0.01;
    v.g.position.set(x, z + 0.1, y);
    if (moving) { v.g.rotation.x += 0.25; v.g.rotation.z += 0.18; }
    // 터지기 직전일수록 빨간 불이 빨리 깜빡임
    const left = G.NADE.fuse - t;
    v.light.visible = left < 0 ? true : Math.floor(t * (left < 0.6 ? 14 : 4)) % 2 === 0;
    while (v.bi < v.bounces.length && v.bounces[v.bi] <= t) {
      v.bi++;
      Sfx.bounce(Math.pow(clamp(1 - Math.hypot(x - me.x, y - me.y) / 30, 0, 1), 1.5));
    }
  }
}

// 폭발: 섬광 + 불덩이 + 연기 + 파편 + 그을음 + 충격파
const scorchGeo = new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2);
const shockGeo = new THREE.RingGeometry(0.85, 1, 24).rotateX(-Math.PI / 2);
function onBoom(m) {
  const { x, y, z } = m;
  const r = m.r || G.NADE.radius;
  // 가장 가까운 수류탄 모형 제거
  let best = -1, bd = 2.5;
  for (let i = 0; i < nadeViews.length; i++) {
    const p = nadeViews[i].g.position;
    const d = Math.hypot(p.x - x, p.z - y);
    if (d < bd) { bd = d; best = i; }
  }
  if (best >= 0) { scene.remove(nadeViews[best].g); nadeViews.splice(best, 1); }
  flash(x, y, z + 0.4, '#fff2c0', r * 0.55);
  flash(x, y, z + 0.4, '#ff9a3a', r * 0.35);
  burst(x, y, z + 0.3, '#ffb347', 16, 7, 0.14, 0.45);
  burst(x, y, z + 0.3, '#ff5a2a', 10, 5, 0.12, 0.4);
  burst(x, y, z + 0.2, '#3a3430', 10, 6, 0.08, 0.9);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    smoke(x + Math.cos(a) * 0.4, y + Math.sin(a) * 0.4, z + 0.3, Math.cos(a) * 1.4, Math.sin(a) * 1.4, 1.6 + Math.random() * 0.8, 1.8);
  }
  const ground = G.groundAt(x, y, z + 0.3);
  const sc = new THREE.Mesh(scorchGeo, new THREE.MeshBasicMaterial({ color: '#15110e', transparent: true, opacity: 0.5, depthWrite: false }));
  sc.position.set(x, ground + 0.035, y);
  sc.scale.setScalar(r * 0.32);
  sc.renderOrder = 1;
  scene.add(sc);
  fx.push({ m: sc, life: 14, max: 14, kind: 'decal' });
  const sw = new THREE.Mesh(shockGeo, new THREE.MeshBasicMaterial({ color: '#fff4d0', transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
  sw.position.set(x, ground + 0.08, y);
  scene.add(sw);
  fx.push({ m: sw, life: 0.32, max: 0.32, kind: 'shock', r });
  const dist = Math.hypot(x - me.x, y - me.y);
  shake = Math.min(1, shake + Math.max(0, 1 - dist / 16) * 0.9);
  Sfx.boom(Math.pow(clamp(1 - dist / 60, 0, 1), 1.3));
}

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
    } else if (f.kind === 'shell') {
      f.v.y -= 14 * dt;
      f.m.position.addScaledVector(f.v, dt);
      f.m.rotation.x += f.spin.x * dt;
      f.m.rotation.y += f.spin.y * dt;
      f.m.rotation.z += f.spin.z * dt;
      if (f.m.position.y < f.floor) {
        f.m.position.y = f.floor;
        if (f.v.y < -1) { f.v.y *= -0.35; f.v.x *= 0.5; f.v.z *= 0.5; f.spin.multiplyScalar(0.4); }
        else { f.v.set(0, 0, 0); f.spin.set(0, 0, 0); f.m.rotation.x = Math.PI / 2; }
      }
      f.m.material.opacity = clamp(f.life / 0.4, 0, 1);
      continue;
    } else if (f.kind === 'smoke') {
      f.m.position.addScaledVector(f.v, dt);
      f.v.x *= Math.exp(-dt * 2.5);
      f.v.z *= Math.exp(-dt * 2.5);
      const p = 1 - f.life / f.max;
      f.m.scale.setScalar(f.size * (0.25 + 0.75 * Math.sqrt(p)));
      f.m.material.opacity = f.op * (1 - p);
      continue;
    } else if (f.kind === 'decal') {
      f.m.material.opacity = 0.5 * clamp(f.life / 3, 0, 1);
      continue;
    } else if (f.kind === 'shock') {
      const p = 1 - f.life / f.max;
      f.m.scale.setScalar(0.4 + p * f.r);
      f.m.material.opacity = 0.7 * (1 - p);
      continue;
    }
    f.m.material.opacity = clamp(f.life / f.max, 0, 1);
  }
}

// 파편 (부서진 상자 판자, 드럼통 조각): 튀어 올랐다가 바닥에서 튀고 사라짐
function debris(x, y, z, color, size, speed, floor) {
  const m = new THREE.Mesh(unitBox, toonMat(color));
  m.scale.set(size[0], size[1], size[2]);
  m.position.set(x + (Math.random() - 0.5) * 0.5, z, y + (Math.random() - 0.5) * 0.5);
  m.castShadow = true;
  const a = Math.random() * Math.PI * 2;
  const v = new THREE.Vector3(Math.cos(a) * speed * (0.3 + Math.random() * 0.7), 2 + Math.random() * speed * 0.7, Math.sin(a) * speed * (0.3 + Math.random() * 0.7));
  const spin = new THREE.Vector3(Math.random() * 16 - 8, Math.random() * 16 - 8, Math.random() * 16 - 8);
  scene.add(m);
  fx.push({ m, life: 2.2, max: 2.2, kind: 'shell', v, spin, floor: floor + 0.03 });
}

// 화약 연기 한 덩이 (vx, vz = 맵 기준 x/y 방향 속도)
const smokeGeo = new THREE.SphereGeometry(1, 16, 12);
function smoke(x, y, z, vx, vy, size, life) {
  const m = new THREE.Mesh(smokeGeo, new THREE.MeshLambertMaterial({ color: '#d8d4cc', transparent: true, opacity: 0.32, depthWrite: false }));
  m.position.set(x, z, y);
  m.scale.setScalar(size * 0.25);
  scene.add(m);
  fx.push({ m, life, max: life, kind: 'smoke', v: new THREE.Vector3(vx, 0.35 + Math.random() * 0.3, vy), size: size * 0.85, op: 0.32 });
}

// 탄피: 오른쪽 배출구에서 튀어나와 바닥에 한 번 튀고 사라짐 (산탄총은 빨간 산탄)
const shellGeos = {
  small: new THREE.CylinderGeometry(0.016, 0.016, 0.06, 6),
  big: new THREE.CylinderGeometry(0.024, 0.024, 0.12, 6),
  shot: new THREE.CylinderGeometry(0.026, 0.026, 0.09, 8),
};
function ejectShell(av, x, y, z, yaw, kind) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const g = kind === 'sniper' ? shellGeos.big : kind === 'shotgun' ? shellGeos.shot : shellGeos.small;
  const m = new THREE.Mesh(g, toonMat(kind === 'shotgun' ? '#b3261e' : '#d8b24a', { emissive: '#3a2a08', emissiveIntensity: 0.4 }));
  const ep = ejectPointOf(av, x, y, z, yaw);
  m.position.set(ep[0], ep[2], ep[1]);
  m.castShadow = true;
  const side = 1.6 + Math.random() * 0.9;
  const v = new THREE.Vector3(-s * side - c * 0.4, 2.2 + Math.random(), c * side - s * 0.4);
  const spin = new THREE.Vector3(Math.random() * 20 - 10, Math.random() * 20 - 10, Math.random() * 20 - 10);
  scene.add(m);
  fx.push({ m, life: 1.6, max: 1.6, kind: 'shell', v, spin, floor: z + 0.02 });
}

// 사격 연출: 반동, 머리카락 흩날림, 총구 화염, 연기, 탄피, (저격) 흙먼지
function gunFx(av, x, y, z, yaw, kind) {
  const big = kind === 'sniper', mid = kind === 'shotgun';
  av.kick = big ? 0.2 : mid ? 0.16 : 0.1;
  av.flick = Math.min(0.9, av.flick + (big ? 0.7 : mid ? 0.4 : 0.08));
  const mz = muzzleOf(av, x, y, z, yaw);
  flash(mz[0], mz[1], mz[2], '#ffe7a3', big ? 0.55 : mid ? 0.45 : 0.28);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const puffs = big ? 7 : mid ? 4 : 1;
  for (let i = 0; i < puffs; i++) {
    let vx = c * (0.6 + Math.random()), vy = s * (0.6 + Math.random());
    if (big && i < 4) { // 소염기 양옆으로 뿜어져 나오는 연기
      const side = i % 2 ? 1 : -1;
      vx = -s * side * 2.2 + c * 0.3;
      vy = c * side * 2.2 + s * 0.3;
    }
    smoke(mz[0], mz[1], mz[2], vx, vy, big ? 0.9 : mid ? 0.6 : 0.35, big ? 1.4 : 0.8);
  }
  ejectShell(av, x, y, z, yaw, kind);
  if (big) burst(x + c * 0.2, y + s * 0.2, z + 0.05, '#b59a6a', 10, 2.2, 0.06, 0.6);
}

/* ═════════════════════════ 화면 라벨 ═════════════════════════ */
const labelsEl = $('labels');
const _v = new THREE.Vector3();
function toScreen(x, y, z) {
  _v.set(x, z, y).project(camera);
  const s = pixel.ndcToScreen(_v.x, _v.y);
  return {
    x: s.x,
    y: s.y,
    on: s.x > -40 && s.x < innerWidth + 40 && s.y > -40 && s.y < innerHeight + 40,
  };
}
window.__opl.toScreen = toScreen;
function makeTag(isMe) {
  const el = document.createElement('div');
  el.className = 'tag' + (isMe ? ' me' : '');
  const line = document.createElement('div');
  line.className = 'tline';
  const nameEl = document.createElement('span');
  nameEl.className = 'name';
  const kdEl = document.createElement('span');
  kdEl.className = 'kd';
  line.append(nameEl, kdEl);
  const hp = document.createElement('div');
  hp.className = 'hp';
  const hpEl = document.createElement('i');
  hp.appendChild(hpEl);
  el.append(line, hp);
  labelsEl.appendChild(el);
  return { el, nameEl, kdEl, hpEl, name: null, kd: null, color: null, hp: -1, shown: true };
}
// 이름표: 이름 + 처치/사망 + 체력바
function kdOf(id) {
  const r = S.roster.get(id);
  return r ? `${r.kills}/${r.deaths}` : '0/0';
}
function updateTag(tag, name, color, hp, x, y, z, opacity, kd = '', h = 2.05, hpMax = 100) {
  const p = toScreen(x, y, z + h);
  const show = p.on && opacity > 0.3;
  if (show !== tag.shown) { tag.shown = show; tag.el.style.display = show ? '' : 'none'; }
  if (!show) return;
  tag.el.style.left = p.x + 'px';
  tag.el.style.top = p.y + 'px';
  if (tag.name !== name) { tag.name = name; tag.nameEl.textContent = name; }
  if (tag.kd !== kd) { tag.kd = kd; tag.kdEl.textContent = kd; }
  if (tag.color !== color) { tag.color = color; tag.nameEl.style.color = color; }
  if (tag.hp !== hp) {
    tag.hp = hp;
    const pct = (hp / hpMax) * 100;
    tag.hpEl.style.width = clamp(pct, 0, 100) + '%';
    tag.hpEl.style.background = pct > 50 ? '#6ee7a0' : pct > 25 ? '#ffd166' : '#ff5a5a';
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
    let opened = false;
    ws.onopen = () => { opened = true; S.connected = true; resolve(); };
    ws.onerror = () => { if (!opened) reject(new Error('connect failed')); };
    ws.onclose = (e) => {
      if (S.ws !== ws) return;
      S.connected = false;
      if (opened && S.joined) startReconnect(e.code);
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      try { onMessage(m); } catch (err) { console.error('message error', m.type, err); }
    };
  });
}
function send(m) {
  if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(m));
}

/* ── 자동 재연결: 잠깐 끊겨도 튕기지 않고 다시 붙음 ── */
const RECONNECT_MAX = 15;
function resetWorld() {
  for (const r of S.remotes.values()) { disposeAvatar(r.av); r.tag.el.remove(); }
  S.remotes.clear();
  for (const pk of S.pickups.values()) { disposeGroup(pk.model.group); pk.label.remove(); }
  S.pickups.clear();
  for (const v of nadeViews) scene.remove(v.g);
  nadeViews.length = 0;
  S.fs = 0;
  S.ack = 0;
  S.clockOff = null;
  S.reloadEnd = 0;
  me.alive = false;
  keys.clear();
  mouse.left = false;
}
function startReconnect(code) {
  resetWorld();
  S.reconnectTries = 0;
  $('reconnect').classList.remove('hidden');
  tryReconnect(code);
}
async function tryReconnect(code) {
  S.reconnectTries++;
  const why = code === 4001 ? '연결이 불안정해' : '연결이 끊겨';
  $('reconnectmsg').textContent = `${why} 다시 연결하는 중... (${S.reconnectTries}/${RECONNECT_MAX})`;
  try {
    await connect();
  } catch {
    if (S.reconnectTries >= RECONNECT_MAX) { giveUpReconnect(code); return; }
    setTimeout(() => tryReconnect(code), Math.min(4000, 500 * 2 ** (S.reconnectTries - 1)));
    return;
  }
  send({ type: 'join', name: S.name, key: SESSION_KEY, char: S.char, mode: S.mode });
  markLinkFresh();
  $('reconnect').classList.add('hidden');
  addChat(null, null, '다시 연결되었습니다');
}
function giveUpReconnect(code) {
  $('reconnect').classList.add('hidden');
  S.joined = false;
  $('hud').classList.add('hidden');
  $('login').classList.remove('hidden');
  $('joinbtn').disabled = false;
  $('loginmsg').textContent = `서버에 다시 연결하지 못했습니다 (코드 ${code}). 서버가 켜져 있는지 확인하고 다시 입장하세요.`;
}
/* ── 연결 감시: 받기만 되고 보내기가 막힌 '반쪽 연결'을 찾아 스스로 재연결 ── */
const PONG_TIMEOUT_MS = 7000;   // 이 시간 동안 핑 응답이 없으면
const SNAP_TIMEOUT_MS = 5000;   // 이 시간 동안 서버 화면 정보가 없으면
const UNACKED_SHOT_MS = 3000;   // 쏜 총알이 이 시간 동안 서버에 확인되지 않으면
function markLinkFresh() {
  const now = performance.now();
  S.lastPongAt = now;
  S.lastSnapAt = now;
  S.firstUnackedAt = 0;
}
function forceReconnect(code) {
  const old = S.ws;
  S.ws = null;
  S.connected = false;
  if (old) {
    old.onclose = old.onmessage = old.onerror = null;
    try { old.close(code, 'stalled'); } catch { /* 이미 닫힘 */ }
  }
  startReconnect(code);
}
setInterval(() => {
  if (!S.joined || !S.connected) return;
  const now = performance.now();
  if (now - S.lastPingAt >= 2000) { S.lastPingAt = now; send({ type: 'ping', t: now }); }
  if (document.visibilityState !== 'visible') return; // 백그라운드 탭은 타이머가 느려지므로 판단하지 않음
  const stalled = now - S.lastPongAt > PONG_TIMEOUT_MS
    || now - S.lastSnapAt > SNAP_TIMEOUT_MS
    || (S.firstUnackedAt && now - S.firstUnackedAt > UNACKED_SHOT_MS);
  if (stalled) forceReconnect(4001);
}, 500);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') markLinkFresh();
});

function enemyOf(id) {
  const r = S.remotes.get(id);
  return r && r.etype ? G.ENEMIES[r.etype] : null;
}
function nameOf(id) {
  const r = S.roster.get(id);
  if (r) return r.name;
  const e = enemyOf(id);
  return e ? e.name : '???';
}
function colorOf(id) {
  const r = S.roster.get(id);
  if (r) return r.color;
  return enemyOf(id) ? '#ff5a5a' : '#cccccc';
}
// PvE에서는 사람끼리 같은 편
function isFoe(r) {
  return S.mode !== 'pve' || !!r.etype;
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
      for (const r of S.remotes.values()) {
        if (r.etype) continue;
        if (r.av.charId !== charOf(r.id)) { // 캐릭터 정보가 늦게 오면 그 캐릭터로 다시 만듦
          const kind = r.av.kind, op = r.av.opacity;
          disposeAvatar(r.av);
          r.av = makeAvatar(scene, charOf(r.id), colorOf(r.id), false);
          setAvatarWeapon(r.av, kind);
          setAvatarOpacity(r.av, op);
        } else {
          setAvatarColor(r.av, colorOf(r.id));
        }
      }
      updateKD();
      if (S.roster.has(S.myId) && S.roster.get(S.myId).color !== S.myColor) {
        S.myColor = S.roster.get(S.myId).color; // 재접속 시 원래 색으로 복구
        if (myAv) setAvatarColor(myAv, S.myColor);
      }
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
      S.protEnd = performance.now() + (m.prot || 0);
      S.nades = G.NADE.count;
      if (m.mode) S.mode = m.mode;
      break;
    case 'stage': onStage(m); break;
    case 'proj': onProj(m); break;
    case 'pend': endProj(m.id, m.hit); break;
    case 'zone': onZone(m); break;
    case 'zboom': onZoneBoom(m.id); break;
    case 'charge': onCharge(m); if (m.k === 'alert') bubble(m.id, '!', m.ms, 'alert'); break;
    case 'rest': bubble(m.id, 'Zzz', m.ms, 'zzz'); break;
    case 'laser': onLaser(m); break;
    case 'spin': { const r = S.remotes.get(m.id); if (r) { setAvatarSpin(r.av, 45); r.spinUntil = performance.now() + 3600; Sfx.spin(); } break; }
    case 'bossphase': showBanner('보스 2단계!', '분노한 카르민이 수류탄을 던지고 호위병을 부릅니다', 2600, 'boss'); break;
    case 'shot': onRemoteShot(m); break;
    case 'nade': onNadeMsg(m); break;
    case 'boom': onBoom(m); break;
    case 'hitm': {
      const hm = $('hitmark');
      hm.classList.remove('show', 'kill');
      void hm.offsetWidth;
      hm.classList.add('show');
      if (m.prot) { addDmgNum(m.x, m.y, m.z, '보호중', 'prot'); break; }
      if (m.kill) hm.classList.add('kill');
      addDmgNum(m.x, m.y, m.z, String(m.dmg), m.kill ? 'kill' : '');
      { const t = S.remotes.get(m.id); if (t) setAvatarHit(t.av); }
      if (m.kill) Sfx.kill(); else Sfx.hit();
      break;
    }
    case 'hurt': {
      Sfx.hurt();
      if (myAv) setAvatarHit(myAv);
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
    case 'pong':
      S.lastPongAt = performance.now();
      S.ping = Math.round(S.lastPongAt - m.t);
      break;
  }
}

// 서버 시계 추정: 가장 빨리 도착한 스냅샷 기준으로 빠르게 맞추고, 늦게 오면 천천히 따라감
function updateClock(serverT, now) {
  const sample = serverT - now;
  if (S.clockOff === null) S.clockOff = sample;
  else if (sample > S.clockOff) S.clockOff += (sample - S.clockOff) * 0.3;
  else S.clockOff += (sample - S.clockOff) * 0.01;
}

function onSnap(m) {
  const now = performance.now();
  updateClock(m.t, now);
  const seen = new Set();
  for (const a of m.ps) {
    const [id, x, y, z, yaw, hp, alive, wi, prot, kn, et] = a;
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
      const etype = et ? G.ENEMY_KINDS[et - 1] : null;
      r = {
        id, x, y, z, yaw, buf: [], hp, alive: !!alive, prot: !!prot, etype,
        av: makeAvatar(scene, etype || charOf(id), etype ? '#ff5a5a' : colorOf(id), false), tag: makeTag(false), vis: 0, kneel: false,
      };
      if (etype) r.tag.el.classList.add('foe');
      S.remotes.set(id, r);
    }
    const last = r.buf[r.buf.length - 1];
    // 부활/순간이동이면 보간하지 않고 바로 그 위치로
    if ((!r.alive && alive) || (last && Math.hypot(x - last.x, y - last.y) > 6)) {
      r.buf.length = 0;
      r.x = x; r.y = y; r.z = z; r.yaw = yaw; r.vis = 0;
    }
    r.buf.push({ t: m.t, x, y, z, yaw });
    while (r.buf.length > 2 && r.buf[1].t < m.t - 1000) r.buf.shift();
    r.hp = hp; r.alive = !!alive; r.prot = !!prot; r.kneel = !!kn;
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
  S.lastSnapAt = now;
  if (mm.ack >= S.fs) S.firstUnackedAt = 0;         // 쏜 총알이 모두 서버에 도착함
  else if (mm.ack > S.ack) S.firstUnackedAt = now;  // 일부 도착: 남은 것 기준으로 다시 잼
  S.ack = mm.ack;
  S.reloadEnd = mm.rl ? now + mm.rl : 0;
  S.reloadTotal = mm.rt || 1;
  S.respawnEnd = mm.ra ? now + mm.ra : 0;
  S.protEnd = mm.pt ? now + mm.pt : 0;
  S.sg = m.sg || null;
  if (now > S.nadeLockUntil && typeof mm.gn === 'number') S.nades = mm.gn;
  applyDeadProps(m.dp);
}

function onRemoteShot(m) {
  const kind = WK[m.w];
  const w = G.WEAPONS[kind];
  if (!w) return;
  const [ox, oy, oz] = m.o;
  const r = S.remotes.get(m.by);
  if (r && r.vis > 0.3) gunFx(r.av, r.x, r.y, r.z, r.yaw, kind);
  if (r && kind === 'gatling') { setAvatarSpin(r.av, 45); r.spinUntil = performance.now() + 400; }
  for (const [x, y, z, type] of m.e) {
    const dx = x - ox, dy = y - oy, dz = z - oz;
    const len = Math.hypot(dx, dy, dz) || 1;
    const s = Math.min(0.6, len);
    const mz = r && r.vis > 0.3 ? tracerStart(r.av, r.x, r.y, r.z, Math.atan2(dy, dx), x, y, z, ox, oy, oz) : null;
    if (mz) addTracer(mz[0], mz[1], mz[2], x, y, z, w.color, kind === 'sniper' ? 0.08 : 0.05, kind === 'sniper' ? 0.25 : 0.1);
    else addTracer(ox + (dx / len) * s, oy + (dy / len) * s, oz + (dz / len) * s, x, y, z, w.color,
      kind === 'sniper' ? 0.08 : 0.05, kind === 'sniper' ? 0.25 : 0.1);
    impact(x, y, z, type);
    if (type === 1) { const pv = propAt(x, y, z); if (pv) pv.wob = 0.25; }
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
// x,y,z = 총알이 향하는 점, tx,ty,tz = 수류탄을 던질 바닥 지점, lock = 조준 고정된 적
const aim = { x: 32, y: 32, z: G.GUN_H, lock: 0, tx: 32, ty: 32, tz: 0 };

// 화면 점 p와 선분 a-b 사이 거리 (px)
function segDist(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const L = vx * vx + vy * vy || 1;
  const t = clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / L, 0, 1);
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
}

function updateAim() {
  pixel.screenToNdc(mouse.x, mouse.y, _ndc);
  raycaster.setFromCamera(_ndc, camera);
  const gunZ = me.z + G.GUN_H;
  const o = raycaster.ray.origin, d = raycaster.ray.direction;
  // 기본: 내 총구 높이의 수평면에서 마우스 아래 지점 → 수평으로 쏨 (화면에서 총알 선이 조준점을 지나감)
  const tPlane = (gunZ - o.y) / d.y;
  aim.x = o.x + d.x * tPlane;
  aim.y = o.z + d.z * tPlane;
  aim.z = gunZ;
  aim.tx = aim.x; aim.ty = aim.y; aim.tz = me.z;
  aim.lock = 0;
  if (!S.joined || !me.alive) return;

  // 1) 마우스가 적의 몸(발끝~머리) 위에 있으면 그 적의 몸통 가운데를 정확히 조준
  const ppu = innerHeight / (viewSize * zoomMul);
  const rad = Math.max(12, ppu * 0.45);
  let best = Infinity, lockR = null;
  for (const r of S.remotes.values()) {
    if (!r.alive || r.vis < 0.5 || !isFoe(r)) continue;
    const dd = segDist(mouse, toScreen(r.x, r.y, r.z + 0.1), toScreen(r.x, r.y, r.z + r.av.bodyH));
    if (dd < rad && dd < best) { best = dd; lockR = r; }
  }
  if (lockR) {
    aim.lock = lockR.id;
    aim.x = lockR.x; aim.y = lockR.y; aim.z = lockR.z + (lockR.etype === 'boss' ? 1.3 : 1.0);
    aim.tx = lockR.x; aim.ty = lockR.y; aim.tz = lockR.z;
    return;
  }

  // 2) 마우스 아래의 실제 표면
  const hits = raycaster.intersectObjects(pickables, false);
  const h = hits.find((q) => !q.object.userData.hidden && q.object.visible && q.object.parent.visible);
  if (!h) return;
  aim.tx = h.point.x; aim.ty = h.point.z; aim.tz = h.point.y;
  const up = h.face ? _n.copy(h.face.normal).transformDirection(h.object.matrixWorld).y > 0.7 : false;
  // 다른 층(옥상, 아래 마당)의 바닥 → 그 위치의 가슴 높이를 조준
  if (up && FLOOR_KINDS.has(h.object.userData.kind) && Math.abs(h.point.y - me.z) > 1.0) {
    aim.x = h.point.x; aim.y = h.point.z; aim.z = h.point.y + G.GUN_H;
    return;
  }
  // 내가 선 층의 바닥이면 수평으로 쏨. 그 밖(벽, 상자, 드럼통의 옆면·윗면)은 가리킨 점을 정확히 → 맞는 곳 = 조준점
  if (up && Math.abs(h.point.y - me.z) < 0.35) return;
  aim.x = h.point.x; aim.y = h.point.z; aim.z = h.point.y;
}

function aimAngles() {
  const ox = me.x, oy = me.y, oz = me.z + G.GUN_H;
  const dx = aim.x - ox, dy = aim.y - oy, dz = aim.z - oz;
  const hd = Math.hypot(dx, dy);
  const yaw = hd > 0.05 ? Math.atan2(dy, dx) : me.yaw;
  const pitch = hd > 0.05 ? clamp(Math.atan2(dz, hd), -1.3, 1.3) : 0;
  return { ox, oy, oz, yaw, pitch };
}

// 총알 궤적은 몸 가운데(판정 위치)에서 계산하지만, 보이는 선은 총구에서 맞은 곳까지 그림
function tracerStart(av, x, y, z, yaw, ex, ey, ez, fx, fy, fz) {
  if (av && av.group.visible) {
    const mz = muzzleOf(av, x, y, z, yaw);
    const dOrigin = Math.hypot(ex - fx, ey - fy, ez - fz);
    const dMuzzle = Math.hypot(ex - mz[0], ey - mz[1], ez - mz[2]);
    if (dMuzzle > 0.2 && dMuzzle < dOrigin) return mz;
  }
  return null;
}

function remoteTargets() {
  const out = [];
  for (const r of S.remotes.values()) {
    if (!r.alive || !isFoe(r)) continue;
    const e = r.etype ? G.ENEMIES[r.etype] : null;
    out.push({ id: r.id, x: r.x, y: r.y, z: r.z, r: e ? e.r : undefined, h: e ? e.h : undefined });
  }
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

function isProtected(now) {
  return S.protEnd > now;
}
function protWarn(now) {
  if (now - S.protWarnAt < 900) return;
  S.protWarnAt = now;
  showNotice('부활 보호 중에는 공격할 수 없습니다', '#9fe8ff');
  Sfx.blocked();
}

// 수류탄: 조준점(바닥)으로 던짐. 궤적은 바로 그려 보이고, 서버 궤적이 오면 그걸로 맞춤
function throwNade(now) {
  if (!S.joined || !me.alive || chatOpen) return;
  if (isProtected(now)) { protWarn(now); return; }
  if (S.nades <= 0) { showNotice('수류탄이 없습니다', '#9aa6b8'); Sfx.empty(); return; }
  if (now < S.nextNadeAt) return;
  S.nextNadeAt = now + G.NADE.cooldown * 1000;
  S.nades--;
  S.nadeLockUntil = now + 800;
  const o = [me.x, me.y, me.z + 1.35];
  const t = [aim.tx, aim.ty, Math.max(0, aim.tz)];
  const v = G.nadeVelocity(o[0], o[1], o[2], t[0], t[1], t[2]);
  const sim = G.simulateNade(o[0], o[1], o[2], v[0], v[1], v[2]);
  localNadeSeq++;
  spawnNadeView('L' + localNadeSeq, sim.pts, sim.bounces, localNadeSeq);
  send({ type: 'nade', o: o.map((q) => +q.toFixed(3)), t: t.map((q) => +q.toFixed(2)), c: localNadeSeq });
  Sfx.pin();
  if (myAv) myAv.kick = 0.12;
}

function tryFire(now) {
  if (!S.joined || !me.alive || chatOpen) return;
  const it = S.inv[S.slot];
  if (!it) return;
  if (isProtected(now)) { protWarn(now); return; }
  const kind = it.kind;
  const w = G.WEAPONS[kind];
  if (now < S.nextFireAt) return;
  if (S.reloadEnd && now < S.reloadEnd) return;
  if (predictedMag() <= 0) {
    if (now - S.lastReloadReq > 600) { S.lastReloadReq = now; send({ type: 'reload' }); Sfx.empty(); }
    return;
  }
  S.nextFireAt = now + w.interval * 1000;
  if (S.fs === S.ack) S.firstUnackedAt = now;
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
    const mz = tracerStart(myAv, me.x, me.y, me.z, yaw, tr.x, tr.y, tr.z, ox, oy, oz);
    if (mz) addTracer(mz[0], mz[1], mz[2], tr.x, tr.y, tr.z, w.color, kind === 'sniper' ? 0.08 : 0.05, kind === 'sniper' ? 0.25 : 0.1);
    else addTracer(ox + dx * 0.6, oy + dy * 0.6, oz + dz * 0.6, tr.x, tr.y, tr.z, w.color,
      kind === 'sniper' ? 0.08 : 0.05, kind === 'sniper' ? 0.25 : 0.1);
    impact(tr.x, tr.y, tr.z, tr.type);
    if (tr.hit && tr.hit.hpMax) { const pv = propViews.get(tr.hit.id); if (pv) pv.wob = 0.25; }
  }
  send({ type: 'fire', fs: S.fs, o: [+ox.toFixed(2), +oy.toFixed(2), +oz.toFixed(2)], p: pellets });

  me.yaw = yaw;
  if (myAv) gunFx(myAv, me.x, me.y, me.z, yaw, kind);
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
  if (e.button === 1) { e.preventDefault(); throwNade(performance.now()); } // 휠 클릭 = 수류탄
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
    case 'KeyG': throwNade(performance.now()); break;
    case 'Space':
      e.preventDefault();
      if (me.alive && G.tryJump(me)) Sfx.jump();
      break;
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
  ws.textContent = `[${G.WEAPONS[wkind] ? G.WEAPONS[wkind].name : G.KILL_NAMES[wkind] || '?'}]`;
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

// 내 처치/사망 (HUD + 사망 화면)
function updateKD() {
  const r = S.roster.get(S.myId);
  const k = r ? r.kills : 0, d = r ? r.deaths : 0;
  $('kills').textContent = k;
  $('deaths').textContent = d;
  $('kdr').textContent = (d ? k / d : k).toFixed(2);
  $('deathkd').textContent = `처치 ${k} · 사망 ${d}`;
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
  $('ping').classList.toggle('bad', S.ping > 250);

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
    const iconKey = it ? it.kind : '';
    if (hudCache['si' + i] !== iconKey) {
      hudCache['si' + i] = iconKey;
      const img = el.querySelector('.wicon');
      img.src = it ? ICONS[it.kind] : '';
      img.style.visibility = it ? 'visible' : 'hidden';
    }
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

  // 수류탄 수 / 부활 보호
  setText($('nadecount'), 'nc', String(S.nades));
  $('nadebox').classList.toggle('empty', S.nades <= 0);
  const prot = me.alive && isProtected(now);
  const pb = $('protbar');
  pb.classList.toggle('show', prot);
  if (prot) setText(pb, 'pb', `부활 보호 ${((S.protEnd - now) / 1000).toFixed(1)}초 · 공격 불가 · 피해 없음`);

  const death = $('death');
  death.classList.toggle('hidden', me.alive);
  if (!me.alive) {
    setText($('deathby'), 'dby', S.killerName ? `${S.killerName} 에게 당했습니다` : '');
    const left = S.respawnEnd ? Math.max(0, S.respawnEnd - now) : 0;
    setText($('deathtimer'), 'dt', `${Math.ceil(left / 1000)}초 후 부활${S.mode === 'pve' ? ' (스테이지 시작 지점)' : ''}`);
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
    roof: '#6d6f74', bwall: '#9a5a48', iwall: '#c9bea6', parapet: '#c7bdab', wall: '#7f838c', crate: '#b47a43', low: '#b8a27a',
    stair: '#b8b2a7', bridge: '#8a5a34', pillar: '#8b8f97', rail: '#4a505b', drum: '#4a7ab0', tower: '#8a847a',
    plat: '#4a505b', pole: '#4a505b', fence: '#8a5d38', stone: '#7d7a72', deck: '#8a5a34', table: '#9a6a40',
  };
  g.fillStyle = '#7d776c';
  g.fillRect(0, 0, mm.width, mm.height);
  g.fillStyle = '#3f7fa8';
  for (const w of G.WATER) g.fillRect(w.x0 * MMS, w.y0 * MMS, (w.x1 - w.x0) * MMS, (w.y1 - w.y0) * MMS);
  // 건물은 지붕 아래 방 구조가 보이게 (바닥 → 벽)
  for (const b of G.BUILDINGS) {
    g.fillStyle = '#b9ab8e';
    g.fillRect(b.x0 * MMS, b.y0 * MMS, (b.x1 - b.x0) * MMS, (b.y1 - b.y0) * MMS);
  }
  const sorted = G.BOXES.filter((b) => b.kind !== 'bound' && b.kind !== 'roof' && b.z0 < 2.7).sort((a, b) => a.z1 - b.z1);
  for (const b of sorted) {
    g.fillStyle = COL[b.kind] || '#666';
    g.fillRect(b.x0 * MMS, b.y0 * MMS, Math.max(1, (b.x1 - b.x0) * MMS), Math.max(1, (b.y1 - b.y0) * MMS));
  }
  g.fillStyle = '#e3b740';
  for (const p of G.PADS) { g.beginPath(); g.arc(p.x * MMS, p.y * MMS, 2.2, 0, Math.PI * 2); g.fill(); }
})();
function drawMinimap() {
  mctx.clearRect(0, 0, mm.width, mm.height);
  mctx.drawImage(mmStatic, 0, 0);
  mctx.fillStyle = '#5a4a3a';
  for (const v of propViews.values()) {   // 부서진 자리는 지움
    if (!v.dead) continue;
    const b = v.b;
    mctx.fillRect(b.x0 * MMS, b.y0 * MMS, Math.max(1, (b.x1 - b.x0) * MMS), Math.max(1, (b.y1 - b.y0) * MMS));
  }
  for (const pk of S.pickups.values()) {
    mctx.fillStyle = pickupColor(pk.kind);
    mctx.fillRect(pk.x * MMS - 2, pk.y * MMS - 2, 4, 4);
  }
  for (const r of S.remotes.values()) {
    if (!r.alive || (r.vis < 0.5 && !(S.mode === 'pve' && r.etype))) continue;
    mctx.fillStyle = r.etype ? (r.vis < 0.5 ? '#8a2a2a' : '#ff4d4d') : S.mode === 'pve' ? '#6ee7a0' : '#ff4d4d';
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
// 물속이면 발이 잠겨 보이게 조금 내려 그림
const WATER_SINK = 0.16;
const sinkOf = (x, y, z) => (z < 0.05 && G.inWater(x, y) ? WATER_SINK : 0);
let lastSplashAt = 0;

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
    if (me.evt === 'pad') { me.evt = null; Sfx.pad(); padFx(me.x, me.y); }
    if ((f || s) && sinkOf(me.x, me.y, me.z) && now - lastSplashAt > 160) {
      lastSplashAt = now;
      splashFx(me.x, me.y);
      Sfx.splash(0.6);
    }
    if (Math.hypot(aim.x - me.x, aim.y - me.y) > 0.25) me.yaw = Math.atan2(aim.y - me.y, aim.x - me.x);
    // 저격소총을 들고 멈춘 채 우클릭 → 무릎 쏴 자세 (모습만 바뀜)
    const cur = S.inv[S.slot];
    me.kneel = !chatOpen && mouse.right && f === 0 && s === 0 && !!cur && cur.kind === 'sniper';
    if (now - S.lastSend > 33) {
      S.lastSend = now;
      send({ type: 'st', x: +me.x.toFixed(3), y: +me.y.toFixed(3), z: +me.z.toFixed(3), yaw: +me.yaw.toFixed(3), sq: me.sq, k: me.kneel ? 1 : 0 });
    }
  } else {
    me.kneel = false;
  }
  if (me.onGround && S.wasAir && me.alive) Sfx.land();
  S.wasAir = !me.onGround;
  if (myAv && myAv.charId !== S.char) { disposeAvatar(myAv); myAv = null; }
  if (!myAv) myAv = makeAvatar(scene, S.char, S.myColor, true);
  poseAvatar(myAv, me.x, me.y, me.z - sinkOf(me.x, me.y, me.z), me.yaw, dt, { kneel: me.kneel, air: !me.onGround });
  setAvatarOpacity(myAv, me.alive ? 1 : 0);
  setAvatarShield(myAv, me.alive && isProtected(now), now);
}

// 다른 플레이어는 약간(INTERP_MS) 과거 시점을 두 스냅샷 사이로 보간해서 그림
// → 인터넷에서 패킷이 불규칙하게 와도 끊기지 않고 부드럽게 움직임
const INTERP_MS = 120;
function sampleRemote(r, renderT) {
  const b = r.buf;
  if (!b.length) return;
  if (renderT <= b[0].t || b.length === 1) { const s = b[0]; r.x = s.x; r.y = s.y; r.z = s.z; r.yaw = s.yaw; return; }
  const lastS = b[b.length - 1];
  if (renderT >= lastS.t) {
    // 데이터가 늦으면 최대 150ms까지만 이어서 예측, 그 뒤엔 멈춤
    const prev = b[b.length - 2];
    const span = lastS.t - prev.t || 1;
    const a = Math.min(renderT - lastS.t, 150) / span;
    r.x = lastS.x + (lastS.x - prev.x) * a;
    r.y = lastS.y + (lastS.y - prev.y) * a;
    r.z = lastS.z;
    r.yaw = lastS.yaw;
    return;
  }
  let i = b.length - 2;
  while (i > 0 && b[i].t > renderT) i--;
  const s0 = b[i], s1 = b[i + 1];
  const a = (renderT - s0.t) / (s1.t - s0.t || 1);
  r.x = s0.x + (s1.x - s0.x) * a;
  r.y = s0.y + (s1.y - s0.y) * a;
  r.z = s0.z + (s1.z - s0.z) * a;
  r.yaw = angleLerp(s0.yaw, s1.yaw, a);
}

function updateRemotes(dt, now) {
  const renderT = S.clockOff === null ? 0 : now + S.clockOff - INTERP_MS;
  for (const r of S.remotes.values()) {
    sampleRemote(r, renderT);
    // 시야: 둘 다 밖이면 항상 보임. 한쪽이 건물 안이면 창문/문으로 직접 보일 때만
    let target = r.alive ? 1 : 0;
    if (r.alive && S.joined && me.alive) target = G.canSee(me.x, me.y, me.z, r.x, r.y, r.z) ? 1 : 0;
    r.vis += (target - r.vis) * Math.min(1, dt * 14);
    setAvatarOpacity(r.av, r.vis);
    setAvatarShield(r.av, r.prot && r.vis > 0.3, now);
    if (r.spinUntil && now > r.spinUntil) { setAvatarSpin(r.av, 0); r.spinUntil = 0; }
    poseAvatar(r.av, r.x, r.y, r.z - sinkOf(r.x, r.y, r.z), r.yaw, dt, { kneel: r.kneel, air: r.alive && isAirborne(r.x, r.y, r.z) });
  }
}

function updatePickups(dt, now) {
  const t = now / 1000;
  const cb = cutBi >= 0 ? G.BUILDINGS[cutBi] : null;
  for (const pk of S.pickups.values()) {
    pk.model.inner.rotation.y = t * 1.6 + pk.phase;
    pk.model.inner.position.y = 0.7 + Math.sin(t * 2.4 + pk.phase) * 0.1;
    // 건물 안 아이템은 보일 때만, 잘라 보는 건물의 옥상 아이템은 숨김
    let vis = !S.joined || !me.alive || G.canSee(me.x, me.y, me.z, pk.x, pk.y, pk.z);
    if (cb && pk.z > 2.5 && pk.x > cb.x0 && pk.x < cb.x1 && pk.y > cb.y0 && pk.y < cb.y1) vis = false;
    pk.model.group.visible = vis;
  }
}

function updateCamera(dt, now) {
  const cur = S.inv[S.slot];
  const sniper = cur && cur.kind === 'sniper';
  const aiming = mouse.right && me.alive && S.joined;
  const targetZoom = aiming ? (sniper ? 1.45 : 1.15) : 1;
  zoomMul += (targetZoom - zoomMul) * Math.min(1, dt * 6);
  if (Math.abs(targetZoom - zoomMul) < 0.003) zoomMul = targetZoom; // 확대가 끝나면 정확히 맞춰 도트가 흔들리지 않게

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
    tx = G.MAP_W / 2 + Math.sin(t * 0.12) * 18;
    ty = G.MAP_H / 2 + Math.cos(t * 0.09) * 13;
    tz = 0;
  }
  const k = 1 - Math.exp(-dt * 7);
  camTarget.x += (tx - camTarget.x) * k;
  camTarget.y += (tz - camTarget.y) * k;
  camTarget.z += (ty - camTarget.z) * k;

  shake = Math.max(0, shake - dt * 2.2);
  const sa = shake * shake * 0.9;
  const shx = (Math.random() * 2 - 1) * sa, shz = (Math.random() * 2 - 1) * sa;
  pixel.place(camTarget, camOffset, viewSize * zoomMul, { x: shx, z: shz });
  // 그림자 카메라도 빛 방향 기준 그림자 맵 텍셀 단위로 맞춰 움직여서 그림자 가장자리가 지글거리지 않게
  const step = 92 / 2048;
  const a = camTarget.dot(LIGHT_R), b = camTarget.dot(LIGHT_U);
  _sunT.copy(camTarget).addScaledVector(LIGHT_R, Math.round(a / step) * step - a).addScaledVector(LIGHT_U, Math.round(b / step) * step - b);
  sun.position.copy(_sunT).add(SUN_OFF);
  sun.target.position.copy(_sunT);
}
const _lightM = new THREE.Matrix4().lookAt(SUN_OFF, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
const LIGHT_R = new THREE.Vector3().setFromMatrixColumn(_lightM, 0);
const LIGHT_U = new THREE.Vector3().setFromMatrixColumn(_lightM, 1);
const _sunT = new THREE.Vector3();

function updateAimVisuals() {
  const cur = S.inv[S.slot];
  const show = S.joined && me.alive && !!cur;
  rangeLine.visible = rangeFill.visible = show && fogMode !== 0;
  aimLine.visible = show;
  if (!show) return;
  const w = G.WEAPONS[cur.kind];
  if (fogMode !== 0) updateRangeShape(cur.kind);
  const { ox, oy, oz, yaw, pitch } = aimAngles();
  const dx = Math.cos(pitch) * Math.cos(yaw), dy = Math.cos(pitch) * Math.sin(yaw), dz = Math.sin(pitch);
  const tr = G.traceShot(ox, oy, oz, dx, dy, dz, w.range, remoteTargets());
  const pos = aimGeo.attributes.position;
  const mz = tracerStart(myAv, me.x, me.y, me.z, yaw, tr.x, tr.y, tr.z, ox, oy, oz);
  if (mz) pos.setXYZ(0, mz[0], mz[2], mz[1]);
  else pos.setXYZ(0, ox + dx * 0.6, oz + dz * 0.6, oy + dy * 0.6);
  pos.setXYZ(1, tr.x, tr.z, tr.y);
  pos.needsUpdate = true;
  aimLine.material.opacity = tr.target ? 0.75 : cur.kind === 'sniper' ? 0.6 : 0.42;
  aimLine.material.color.set(tr.target ? '#ff2a2a' : '#ff4d4d');
}

function updateLabels(dt) {
  for (const r of S.remotes.values()) {
    const e = r.etype ? G.ENEMIES[r.etype] : null;
    if (e && e.boss) { updateTag(r.tag, '', '#ff5a5a', 0, r.x, r.y, r.z, 0); continue; } // 보스는 화면 위 체력바로
    updateTag(r.tag, nameOf(r.id), colorOf(r.id), r.hp, r.x, r.y, r.z, r.alive ? r.av.opacity : 0, e ? '' : kdOf(r.id), r.av.tagH, e ? Math.round(e.hp * hpScale()) : 100);
  }
  if (S.joined && myAv) updateTag(myTag, nameOf(S.myId), S.myColor, me.hp, me.x, me.y, me.z, me.alive ? 1 : 0, S.mode === 'pve' ? '' : kdOf(S.myId), myAv.tagH);

  const cx = S.joined ? me.x : camTarget.x, cy = S.joined ? me.y : camTarget.z;
  for (const pk of S.pickups.values()) {
    const near = Math.hypot(pk.x - cx, pk.y - cy) < 11 && pk.model.group.visible;
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
  updateCutaway(now);
  updateRemotes(dt, now);
  updateCamera(dt, now);
  updateAim();
  if (mouse.left) tryFire(now);
  updatePickups(dt, now);
  updateProps(dt);
  updateNades(now);
  updateLasers(now);
  updateProjViews(now);
  updateZoneViews(now);
  updateCharges(now);
  updateBubbles(now);
  updateEnvironment(dt, now);
  updatePveHud(now);
  updateFx(dt);
  updateAimVisuals();
  pixel.render(scene);
  updateLabels(dt);
  updateHUD(now);
  drawMinimap();
}
requestAnimationFrame(frame);

/* ═════════════════════════ 초대 주소 (서버를 켠 PC에서만) ═════════════════════════ */
function renderInvite(info) {
  const rows = [];
  if (info.tunnelMode) rows.push(['인터넷', info.tunnel]);
  for (const a of info.lan || []) rows.push(['같은 네트워크', a]);
  for (const box of document.querySelectorAll('.invite')) {
    box.textContent = '';
    const title = document.createElement('div');
    title.className = 'ititle';
    title.textContent = '친구 초대 주소 — 클릭하면 복사됩니다';
    box.appendChild(title);
    for (const [label, url] of rows) {
      const row = document.createElement('div');
      row.className = 'irow' + (url ? '' : ' pending');
      const l = document.createElement('span');
      l.className = 'ilabel';
      l.textContent = label;
      const u = document.createElement('span');
      u.className = 'iurl';
      u.textContent = url || '주소 만드는 중...';
      row.append(l, u);
      if (url) {
        row.addEventListener('mousedown', (e) => e.stopPropagation());
        row.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(url); } catch { return; }
          row.classList.add('copied');
          u.textContent = '복사됨!';
          setTimeout(() => { row.classList.remove('copied'); u.textContent = url; }, 1200);
        });
      }
      box.appendChild(row);
    }
    box.classList.toggle('hidden', rows.length === 0);
  }
}
async function refreshInvite() {
  let info;
  try { info = await (await fetch('/api/info', { cache: 'no-store' })).json(); } catch { return; }
  if (!info.host) return;
  renderInvite(info);
  if (info.tunnelMode && !info.tunnel) setTimeout(refreshInvite, 2000);
}
refreshInvite();

/* ═════════════════════════ PvE: 적 머리 위 말풍선 ('!' 발견, 'Zzz' 조는 중) ═════════════════════════ */
const bubbles = [];
function bubble(id, text, ms, cls) {
  const r = S.remotes.get(id);
  if (!r) return;
  for (const b of bubbles) if (b.id === id) b.until = 0;
  const el = document.createElement('div');
  el.className = 'bubble ' + cls;
  el.textContent = text;
  labelsEl.appendChild(el);
  bubbles.push({ id, el, until: performance.now() + ms });
}
function updateBubbles(now) {
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    const r = S.remotes.get(b.id);
    if (now > b.until || !r || !r.alive || r.vis < 0.3) { b.el.remove(); bubbles.splice(i, 1); continue; }
    const p = toScreen(r.x, r.y, r.z + r.av.tagH + 0.35);
    b.el.style.left = p.x + 'px';
    b.el.style.top = p.y + 'px';
  }
}

/* ═════════════════════════ PvE: 적 탄 / 바닥 장판 / 공격 예고 ═════════════════════════ */
const projViews = new Map();
const PROJ_COL = { orb: ['#ff4d8a', '#ffd0e4'], bolt: ['#ff3030', '#fff0c0'], boss: ['#ff7a2a', '#fff2a0'] };
const orbGeo = new THREE.SphereGeometry(1, 10, 8);
function onProj(m) {
  const [c0, c1] = PROJ_COL[m.k] || PROJ_COL.orb;
  const g = new THREE.Group();
  const glow = new THREE.Mesh(orbGeo, new THREE.MeshBasicMaterial({ color: c0, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.setScalar(m.r * 1.5);
  const core = new THREE.Mesh(orbGeo, new THREE.MeshBasicMaterial({ color: c1 }));
  core.scale.setScalar(m.r * 0.65);
  if (m.k === 'bolt') { glow.scale.set(m.r * 3.2, m.r * 0.9, m.r * 0.9); core.scale.set(m.r * 2.4, m.r * 0.45, m.r * 0.45); }
  g.add(glow, core);
  g.rotation.y = -Math.atan2(m.vy, m.vx);
  g.position.set(m.x, m.z, m.y);
  scene.add(g);
  // 벽에 닿는 거리까지만 날아감 (서버 판정과 같은 방식)
  const sp = Math.hypot(m.vx, m.vy) || 1;
  const wall = G.raycastWorld(m.x, m.y, m.z, m.vx / sp, m.vy / sp, 0, sp * (m.ms / 1000));
  projViews.set(m.id, { m, g, glow, t0: performance.now(), maxT: wall.t / sp, sp });
}
function endProj(id, hit) {
  const v = projViews.get(id);
  if (!v) return;
  projViews.delete(id);
  const p = v.g.position;
  burst(p.x, p.z, p.y, (PROJ_COL[v.m.k] || PROJ_COL.orb)[0], hit ? 8 : 5, 2.5, 0.06, 0.3);
  scene.remove(v.g);
  v.g.traverse((o) => { if (o.material) o.material.dispose(); });
}
function updateProjViews(now) {
  for (const [id, v] of projViews) {
    const t = Math.min((now - v.t0) / 1000, v.maxT);
    if ((now - v.t0) / 1000 > v.m.ms / 1000 + 0.3) { endProj(id, false); continue; }
    v.g.position.set(v.m.x + v.m.vx * t, v.m.z, v.m.y + v.m.vy * t);
    v.glow.material.opacity = 0.45 + 0.2 * Math.sin(now / 40);
  }
}

// 바닥 장판: 붉은 원이 차오르다가 다 차면 폭발 → 원 밖으로 피하기
const zoneViews = new Map();
const zoneRingGeo = new THREE.RingGeometry(0.93, 1, 32).rotateX(-Math.PI / 2);
const zoneDiscGeo = new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2);
function onZone(m) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(zoneRingGeo, new THREE.MeshBasicMaterial({ color: '#ff3030', transparent: true, opacity: 0.9, depthWrite: false }));
  const base = new THREE.Mesh(zoneDiscGeo, new THREE.MeshBasicMaterial({ color: '#ff2020', transparent: true, opacity: 0.16, depthWrite: false }));
  const fill = new THREE.Mesh(zoneDiscGeo, new THREE.MeshBasicMaterial({ color: '#ff5a2a', transparent: true, opacity: 0.45, depthWrite: false }));
  ring.scale.setScalar(m.r);
  base.scale.setScalar(m.r);
  fill.scale.setScalar(0.01);
  g.add(base, fill, ring);
  const gz = G.groundAt(m.x, m.y, m.z + 0.3);
  g.position.set(m.x, gz + 0.05, m.y);
  g.renderOrder = 3;
  scene.add(g);
  zoneViews.set(m.id, { m, g, ring, fill, t0: performance.now() });
  const d = Math.hypot(m.x - me.x, m.y - me.y);
  if (d < m.r + 0.5 && S.joined && me.alive) showNotice('발밑이 위험! 붉은 원 밖으로', '#ff6a5a');
}
function onZoneBoom(id) {
  const v = zoneViews.get(id);
  if (!v) return;
  zoneViews.delete(id);
  const p = v.g.position;
  flash(p.x, p.z, p.y + 0.3, '#ffcf7a', v.m.r * 0.7);
  burst(p.x, p.z, p.y + 0.2, '#ff6a2a', 14, 6, 0.1, 0.45);
  burst(p.x, p.z, p.y + 0.1, '#3a2a24', 8, 4, 0.07, 0.6);
  const dist = Math.hypot(p.x - me.x, p.z - me.y);
  shake = Math.min(0.8, shake + Math.max(0, 1 - dist / 12) * 0.4);
  Sfx.boom(Math.pow(clamp(1 - dist / 40, 0, 1), 1.4) * 0.6);
  scene.remove(v.g);
  v.g.traverse((o) => { if (o.material) o.material.dispose(); });
}
function updateZoneViews(now) {
  for (const v of zoneViews.values()) {
    const k = clamp((now - v.t0) / v.m.ms, 0, 1);
    v.fill.scale.setScalar(Math.max(0.01, v.m.r * k));
    v.ring.material.opacity = 0.6 + 0.4 * Math.sin(now / (k > 0.75 ? 35 : 90));
  }
}

// 공격 예고: 총구에 빛이 모이다가 발사
const charges = [];
function onCharge(m) {
  const r = S.remotes.get(m.id);
  if (!r) return;
  const col = m.k === 'zones' ? '#ff3030' : m.k === 'ring' ? '#ff9a2a' : '#ff4d8a';
  const g = new THREE.Mesh(orbGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(g);
  charges.push({ r, g, t0: performance.now(), ms: m.ms, big: !!(r.etype === 'boss') });
  if (r.vis > 0.3 && Math.hypot(r.x - me.x, r.y - me.y) < 16) Sfx.charge();
}
function updateCharges(now) {
  for (let i = charges.length - 1; i >= 0; i--) {
    const c = charges[i];
    const k = (now - c.t0) / c.ms;
    if (k >= 1 || !c.r.alive) {
      scene.remove(c.g);
      c.g.material.dispose();
      charges.splice(i, 1);
      continue;
    }
    const mz = c.big ? [c.r.x, c.r.y, c.r.z + 1.5] : muzzleOf(c.r.av);
    c.g.position.set(mz[0], mz[2], mz[1]);
    c.g.scale.setScalar((c.big ? 0.9 : 0.25) * (0.3 + k) * (1 + 0.15 * Math.sin(now / 30)));
    c.g.visible = c.r.vis > 0.3;
  }
}

/* ═════════════════════════ PvE: 스테이지 / 보스 / 저격 레이저 ═════════════════════════ */
// 적 체력은 사람 수에 따라 늘어남 (서버와 같은 식, 이름표 체력바 비율용)
function hpScale() {
  return 1 + 0.45 * Math.max(0, S.roster.size - 1);
}
let bannerTimer = 0;
function showBanner(title, sub = '', ms = 2600, cls = '') {
  const b = $('banner');
  $('bannertitle').textContent = title;
  $('bannersub').textContent = sub;
  b.className = 'show ' + cls;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { b.className = ''; }, ms);
}
const fmtTime = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
function onStage(m) {
  const st = G.STAGES[m.i];
  if (!st) return;
  if (m.ev === 'start') {
    for (const id of [...projViews.keys()]) endProj(id, false);
    for (const id of [...zoneViews.keys()]) onZoneBoom(id);
    showBanner(`STAGE ${st.id}`, st.name + (st.boss ? ' — 보스 등장!' : ''), 2800, st.boss ? 'boss' : '');
    Sfx.stageStart();
  } else if (m.ev === 'wave') {
    showBanner('증원 도착!', '적이 더 몰려옵니다', 1800, 'warn');
  } else if (m.ev === 'clear') {
    showBanner('STAGE CLEAR', `${st.id} ${st.name} · ${fmtTime(m.ms || 0)}`, 3800, 'clear');
    Sfx.fanfare();
  } else if (m.ev === 'allclear') {
    showBanner('ALL CLEAR!', `보스 ${G.ENEMIES.boss.name} 격파! 15초 뒤 1-1부터 다시 시작합니다`, 9000, 'clear');
    Sfx.fanfare();
  }
}

// 저격수 레이저: 쏘기 전에 붉은 선으로 겨눔 → 피할 시간
const lasers = [];
const laserMat = new THREE.LineBasicMaterial({ color: '#ff2a2a', transparent: true, opacity: 0.85, depthWrite: false });
function onLaser(m) {
  const r = S.remotes.get(m.id);
  if (!r) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
  const line = new THREE.Line(geo, laserMat);
  line.frustumCulled = false;
  scene.add(line);
  lasers.push({ from: m.id, to: m.to, until: performance.now() + m.ms, line });
  if (m.to === S.myId) { Sfx.laser(); showNotice('저격수가 노리고 있습니다! 숨으세요', '#ff5a5a'); }
}
function updateLasers(now) {
  for (let i = lasers.length - 1; i >= 0; i--) {
    const L = lasers[i];
    const r = S.remotes.get(L.from);
    const t = L.to === S.myId ? me : S.remotes.get(L.to);
    if (now > L.until || !r || !r.alive || !t) {
      scene.remove(L.line);
      L.line.geometry.dispose();
      lasers.splice(i, 1);
      continue;
    }
    const a = muzzleOf(r.av);
    const pos = L.line.geometry.attributes.position;
    pos.setXYZ(0, a[0], a[2], a[1]);
    pos.setXYZ(1, t.x, t.z + 1.0, t.y);
    pos.needsUpdate = true;
    L.line.visible = r.vis > 0.3 && (L.until - now > 350 || Math.floor(now / 60) % 2 === 0);
  }
}

function updatePveHud() {
  const pve = S.joined && S.mode === 'pve' && S.sg;
  $('stagebar').classList.toggle('hidden', !pve);
  if (!pve) { $('bossbar').classList.add('hidden'); return; }
  const [i, phase, left, bhp, bmax, bid, bphase] = S.sg;
  const st = G.STAGES[i];
  setText($('stagebar'), 'stg', `STAGE ${st.id} · ${st.name} · ${phase === 0 ? `남은 적 ${left}` : phase === 1 ? '클리어!' : '전체 클리어!'}`);
  const showBoss = !!bid && bhp > 0;
  $('bossbar').classList.toggle('hidden', !showBoss);
  if (showBoss) {
    $('bossfill').style.width = `${(bhp / bmax) * 100}%`;
    setText($('bossname'), 'bn', `${G.ENEMIES.boss.name}${bphase === 2 ? ' · 분노' : ''}`);
    setText($('bosshp'), 'bh', `${bhp} / ${bmax}`);
    $('bossbar').classList.toggle('rage', bphase === 2);
  }
}

/* ═════════════════════════ 무기 아이콘 굽기 ═════════════════════════ */
const baker = makeBaker(renderer);
const ICONS = {};
for (const k of G.WEAPON_KINDS) ICONS[k] = baker.weaponIcon(k);
const BUSTS = CHARACTERS.map((c) => spriteUrl(c.sprite + '_bust'));
// 선택 카드: 걷기 시트 (고른 캐릭터는 앞·옆·뒤로 돌며 걷고, 나머지는 서 있음)
const sheetImgs = CHARACTERS.map((c) => { const im = new Image(); im.src = spriteUrl(c.sprite); return im; });
const ROW_ORDER = ['front', 'side', 'back'];
let cardTick = 0;
setInterval(() => {
  cardTick++;
  document.querySelectorAll('.charcard canvas').forEach((cv) => {
    const i = Number(cv.dataset.i);
    const im = sheetImgs[i];
    if (!im.complete || !im.naturalWidth) return;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, cv.width, cv.height);
    const sh = SHEETS[CHARACTERS[i].sprite];
    const sel = i === S.char;
    const row = sh.rows[sel ? ROW_ORDER[Math.floor(cardTick / 18) % 3] : 'front'];
    const col = sel ? cardTick % row.n : 1;
    g.drawImage(im, col * sh.cw, row.row * sh.ch, sh.cw, sh.ch, 0, 0, cv.width, cv.height);
  });
}, 140);

/* ═════════════════════════ 로그인: 모드 + 캐릭터 선택 ═════════════════════════ */
const nameInput = $('nameinput');
const joinBtn = $('joinbtn');
try { nameInput.value = localStorage.getItem('opl_name') || ''; } catch { /* 저장소 사용 불가 */ }
try { S.char = Math.max(0, Math.min(CHARACTERS.length - 1, Number(localStorage.getItem('opl_char')) || 0)); } catch { /* 무시 */ }
try { S.mode = localStorage.getItem('opl_mode') === 'pve' ? 'pve' : 'pvp'; } catch { /* 무시 */ }

function renderModeSelect() {
  for (const b of document.querySelectorAll('.modebtn')) b.classList.toggle('sel', b.dataset.mode === S.mode);
}
for (const b of document.querySelectorAll('.modebtn')) {
  b.addEventListener('click', () => {
    S.mode = b.dataset.mode;
    try { localStorage.setItem('opl_mode', S.mode); } catch { /* 무시 */ }
    renderModeSelect();
    Sfx.init();
    Sfx.swap();
  });
}
renderModeSelect();

function renderCharSelect() {
  const wrap = $('charsel');
  wrap.textContent = '';
  CHARACTERS.forEach((c, i) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'charcard' + (i === S.char ? ' sel' : '');
    const img = document.createElement('canvas');
    img.width = SHEETS[c.sprite].cw; img.height = SHEETS[c.sprite].ch;
    img.dataset.i = String(i);
    const nm = document.createElement('b');
    nm.textContent = c.name;
    const ds = document.createElement('small');
    ds.textContent = c.desc;
    card.append(img, nm, ds);
    card.addEventListener('click', () => {
      S.char = i;
      try { localStorage.setItem('opl_char', String(i)); } catch { /* 무시 */ }
      renderCharSelect();
      Sfx.init();
      Sfx.swap();
    });
    wrap.appendChild(card);
  });
  $('myportrait').src = BUSTS[S.char];
}
renderCharSelect();
if (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) {
  $('mobilewarn').classList.remove('hidden');
}
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
  S.name = name;
  send({ type: 'join', name, key: SESSION_KEY, char: S.char, mode: S.mode });
  $('myportrait').src = BUSTS[S.char];
  document.body.classList.toggle('pve', S.mode === 'pve');
  markLinkFresh();
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

// 디버그용 상태 보기
window.__opl.dbg = () => ({
  cutBi, fogMode, nades: S.nades, prot: isProtected(performance.now()),
  deadProps: [...propViews.values()].filter((v) => v.dead).length, nadeViews: nadeViews.length,
});
window.__opl.throwNade = () => throwNade(performance.now());
window.__opl.aim = aim;
window.__opl.aimAngles = () => aimAngles();
window.__opl.remoteTargets = () => remoteTargets();
