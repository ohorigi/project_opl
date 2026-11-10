// 캐릭터: Grok으로 만든 도트 걷기 시트(앞 / 뒤 / 옆 × 6장)를 3D 세상 위에 세워서 그림.
// 시트는 tools/sheets.py가 가공한 public/sprites/<이름>.png, 칸 정보는 public/sheets.js.
// 적은 하루·레이 시트의 색을 바꾼 것. 총은 그림에 그려져 있음.
// 3D 총 모델(바닥 아이템/아이콘용) 로컬 좌표: +X = 총구 방향, +Y = 위, +Z = 오른쪽
import * as THREE from 'three';
import * as G from '/shared/common.js';
import { patchFog } from '/fog.js';
import { SHEETS } from '/sheets.js';

// 고를 수 있는 캐릭터 (G.CHARACTER_COUNT와 수가 같아야 함)
export const CHARACTERS = [
  { name: '하루', desc: '갈색 단발 · 세일러복', sprite: 'haru' },
  { name: '레이', desc: '은발 · 녹색 군복', sprite: 'rei' },
];
export const spriteUrl = (name) => `/sprites/${name}.png`;

export const GUN_SCALE = 1.3;        // 3D 총 모델 크기 (바닥 아이템)
const SPRITE_H = 2.0;                // 화면에 보이는 키 (월드 단위)
const CAM_EL = THREE.MathUtils.degToRad(42);
const CAM_AZ = Math.PI / 4;
const COS_EL = Math.cos(CAM_EL), SIN_EL = Math.sin(CAM_EL);
const PI = Math.PI;

const toonGrad = (() => {
  const t = new THREE.DataTexture(new Uint8Array([78, 158, 255]), 3, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();
export function toonMat(color, extra = {}) {
  return patchFog(new THREE.MeshToonMaterial({ color, gradientMap: toonGrad, transparent: true, ...extra }));
}
export { toonGrad };

const geoCache = new Map();
const geo = (key, make) => { let g = geoCache.get(key); if (!g) { g = make(); geoCache.set(key, g); } return g; };
const box = (w, h, d) => geo(`b${w}_${h}_${d}`, () => new THREE.BoxGeometry(w, h, d));
const cylX = (r, len, seg = 8) => geo(`cx${r}_${len}_${seg}`, () => new THREE.CylinderGeometry(r, r, len, seg).rotateZ(PI / 2));
const cylZ = (r, len, seg = 10) => geo(`cz${r}_${len}_${seg}`, () => new THREE.CylinderGeometry(r, r, len, seg).rotateX(PI / 2));

// ───────────────────────── 총 모델 ─────────────────────────
// 총구가 G.WEAPONS[k].len 위치(+X)에 오게 만든 뒤 GUN_SCALE 배로 키움. grip/fore = 양손 위치
export const WEAPON_MODELS = {
  pistol(add, M) {
    add(box(0.3, 0.075, 0.05), M.metal, 0.27, 0.02, 0);                 // 슬라이드
    for (let i = 0; i < 3; i++) add(box(0.008, 0.06, 0.052), M.dark, 0.15 + i * 0.02, 0.02, 0); // 톱니
    add(box(0.22, 0.012, 0.052), M.accent, 0.29, 0.062, 0);
    add(box(0.02, 0.02, 0.02), M.dark, 0.41, 0.068, 0);                // 가늠쇠
    add(cylX(0.012, 0.04), M.dark, 0.43, 0.02, 0);                      // 총구
    add(box(0.2, 0.04, 0.045), M.dark, 0.25, -0.03, 0);                 // 프레임
    add(box(0.07, 0.012, 0.03), M.dark, 0.2, -0.075, 0);                // 방아쇠울
    add(box(0.065, 0.15, 0.048), M.grip, 0.15, -0.095, 0, 0.25);        // 손잡이
    return { grip: [0.15, -0.08, 0.035], fore: [0.16, -0.07, -0.035] };
  },
  smg(add, M) {
    add(box(0.34, 0.11, 0.07), M.metal, 0.2, 0, 0);
    add(box(0.1, 0.03, 0.074), M.dark, 0.26, 0.03, 0);                  // 배출구
    add(box(0.24, 0.02, 0.072), M.accent, 0.18, -0.03, 0);
    add(box(0.16, 0.06, 0.06), M.dark, 0.43, 0.01, 0);                  // 총열 덮개
    for (let i = 0; i < 3; i++) add(box(0.025, 0.02, 0.062), M.metal, 0.38 + i * 0.045, 0.02, 0);
    add(cylX(0.02, 0.1), M.dark, 0.56, 0.01, 0);
    add(box(0.05, 0.22, 0.04), M.dark, 0.24, -0.16, 0, -0.1);           // 탄창
    add(box(0.055, 0.13, 0.045), M.grip, 0.08, -0.1, 0, 0.2);
    add(box(0.08, 0.012, 0.03), M.dark, 0.14, -0.065, 0);
    add(box(0.18, 0.02, 0.02), M.dark, -0.05, 0.03, 0);                 // 접이식 개머리판
    add(box(0.18, 0.02, 0.02), M.dark, -0.05, -0.03, 0);
    add(box(0.02, 0.08, 0.04), M.dark, -0.14, 0, 0);
    add(box(0.04, 0.03, 0.02), M.dark, 0.12, 0.07, 0);                  // 가늠자
    return { grip: [0.08, -0.09, 0.035], fore: [0.32, -0.05, -0.045] };
  },
  shotgun(add, M) {
    add(box(0.24, 0.1, 0.07), M.metal, 0.12, 0, 0);
    add(cylX(0.03, 0.62), M.metal, 0.51, 0.025, 0);
    add(cylX(0.025, 0.46), M.dark, 0.45, -0.03, 0);
    add(cylX(0.044, 0.2), M.wood, 0.5, -0.03, 0);                       // 펌프
    for (let i = 0; i < 3; i++) add(cylX(0.046, 0.012), M.woodDark, 0.43 + i * 0.07, -0.03, 0);
    add(cylX(0.036, 0.03), M.accent, 0.76, 0.025, 0);
    add(box(0.015, 0.015, 0.015), M.shell, 0.8, 0.06, 0);               // 가늠쇠 구슬
    add(box(0.3, 0.09, 0.05), M.wood, -0.13, -0.03, 0, 0.1);            // 개머리판
    for (let i = 0; i < 3; i++) add(box(0.03, 0.05, 0.052), M.shell, -0.18 + i * 0.045, -0.02, 0, 0.1); // 예비탄
    add(box(0.055, 0.12, 0.045), M.wood, 0.03, -0.08, 0, 0.3);
    add(box(0.08, 0.012, 0.03), M.dark, 0.08, -0.06, 0);
    return { grip: [0.04, -0.08, 0.035], fore: [0.5, -0.06, -0.045] };
  },
  rifle(add, M) {
    add(box(0.4, 0.11, 0.07), M.metal, 0.15, 0, 0);
    add(box(0.09, 0.025, 0.072), M.dark, 0.18, 0.025, 0);               // 배출구
    add(box(0.26, 0.09, 0.075), M.dark, 0.48, 0, 0);                    // 총열 덮개
    for (let i = 0; i < 4; i++) add(box(0.03, 0.02, 0.077), M.metal, 0.38 + i * 0.06, 0.035, 0);
    add(box(0.2, 0.014, 0.078), M.accent, 0.48, -0.03, 0);
    add(cylX(0.018, 0.3), M.metal, 0.75, 0.01, 0);
    add(cylX(0.026, 0.06), M.dark, 0.92, 0.01, 0);                      // 소염기
    add(box(0.06, 0.1, 0.04), M.dark, 0.26, -0.1, 0, -0.18);            // 곡선 탄창
    add(box(0.06, 0.1, 0.04), M.dark, 0.29, -0.19, 0, -0.42);
    add(box(0.055, 0.13, 0.045), M.grip, 0.05, -0.1, 0, 0.25);
    add(box(0.08, 0.012, 0.03), M.dark, 0.11, -0.065, 0);
    add(box(0.24, 0.09, 0.05), M.dark, -0.16, -0.01, 0);                // 개머리판
    add(box(0.1, 0.03, 0.052), M.metal, -0.18, 0.045, 0);               // 뺨받침
    add(box(0.16, 0.035, 0.03), M.dark, 0.15, 0.075, 0);                // 운반손잡이/가늠자
    add(box(0.02, 0.05, 0.02), M.dark, 0.6, 0.055, 0);                  // 가늠쇠
    return { grip: [0.05, -0.09, 0.035], fore: [0.48, -0.06, -0.045] };
  },
  sniper(add, M) {
    add(box(0.62, 0.12, 0.08), M.metal, 0.19, 0, 0);
    add(box(0.46, 0.018, 0.082), M.accent, 0.2, -0.03, 0);
    add(box(0.5, 0.025, 0.04), M.dark, 0.2, 0.072, 0);                 // 레일
    for (let i = 0; i < 8; i++) add(box(0.02, 0.012, 0.045), M.metal, 0.0 + i * 0.06, 0.09, 0);
    add(cylX(0.026, 0.72), M.metal, 0.86, 0.015, 0);                   // 총열
    add(box(0.1, 0.065, 0.075), M.dark, 1.25, 0.015, 0);               // 소염기
    add(box(0.06, 0.03, 0.08), M.metal, 1.24, 0.015, 0);
    add(cylX(0.036, 0.34), M.dark, 0.25, 0.15, 0);                     // 조준경
    add(cylX(0.05, 0.07), M.dark, 0.41, 0.15, 0);
    add(cylX(0.044, 0.06), M.dark, 0.1, 0.15, 0);
    add(cylX(0.039, 0.006), M.glass, 0.447, 0.15, 0);
    add(cylZ(0.016, 0.03), M.metal, 0.25, 0.15, 0.04);                 // 조절 다이얼
    add(cylX(0.016, 0.03), M.metal, 0.25, 0.19, 0);
    add(box(0.03, 0.07, 0.03), M.dark, 0.17, 0.105, 0);
    add(box(0.03, 0.07, 0.03), M.dark, 0.33, 0.105, 0);
    add(cylZ(0.012, 0.06), M.metal, 0.04, 0.03, 0.06);                 // 노리쇠 손잡이
    add(box(0.11, 0.15, 0.066), M.dark, 0.3, -0.12, 0);                // 탄창
    add(box(0.055, 0.14, 0.046), M.grip, 0.1, -0.1, 0, 0.25);
    add(box(0.09, 0.012, 0.03), M.dark, 0.15, -0.065, 0);
    add(box(0.26, 0.11, 0.06), M.metal, -0.24, -0.01, 0);              // 개머리판
    add(box(0.14, 0.03, 0.062), M.dark, -0.22, 0.055, 0);
    add(box(0.03, 0.13, 0.068), M.grip, -0.38, -0.01, 0);
    add(cylX(0.01, 0.3), M.dark, 0.66, -0.035, 0.03);                  // 접힌 양각대
    add(cylX(0.01, 0.3), M.dark, 0.66, -0.035, -0.03);
    return { grip: [0.1, -0.1, 0.035], fore: [0.44, -0.07, -0.045] };
  },
  // 적 에너지총 (아이콘용)
  blaster(add, M) {
    add(box(0.42, 0.1, 0.07), M.accent, 0.2, 0, 0);
    add(box(0.12, 0.06, 0.075), M.dark, 0.44, 0, 0);
    add(box(0.055, 0.13, 0.045), M.grip, 0.06, -0.09, 0, 0.25);
    return { grip: [0.06, -0.08, 0.035], fore: [0.3, -0.05, -0.045] };
  },
  // 보스 전용 개틀링: 6연장 회전 총열 + 탄약 드럼
  gatling(add, M, sub) {
    add(box(0.42, 0.16, 0.16), M.metal, 0.1, 0, 0);
    add(box(0.32, 0.035, 0.165), M.accent, 0.1, 0.06, 0);
    add(cylZ(0.13, 0.12, 14), M.dark, 0.02, -0.17, 0);               // 탄약 드럼
    add(cylZ(0.06, 0.125, 10), M.metal, 0.02, -0.17, 0);
    add(box(0.2, 0.03, 0.035), M.dark, 0.14, 0.15, 0);               // 위 손잡이
    add(box(0.03, 0.07, 0.03), M.dark, 0.06, 0.11, 0);
    add(box(0.03, 0.07, 0.03), M.dark, 0.22, 0.11, 0);
    add(box(0.06, 0.15, 0.05), M.grip, -0.1, -0.1, 0, 0.3);          // 뒤 손잡이
    add(cylX(0.09, 0.07, 12), M.dark, 0.35, 0, 0);                   // 회전부 뭉치
    const sp = sub(0.36, 0, 0);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      sp.add(cylX(0.022, 0.78), M.metal, 0.4, Math.cos(a) * 0.055, Math.sin(a) * 0.055);
    }
    sp.add(cylX(0.085, 0.035, 12), M.dark, 0.12, 0, 0);
    sp.add(cylX(0.085, 0.035, 12), M.dark, 0.74, 0, 0);
    return { grip: [-0.1, -0.08, 0.035], fore: [0.2, 0.12, -0.04], spinner: sp.group };
  },
};

export function buildGunGroup(kind, baseMats, opacity = 1) {
  const group = new THREE.Group();
  const wc = G.WEAPONS[kind].color;
  const accent = toonMat(wc, { emissive: wc, emissiveIntensity: 0.25, opacity, depthWrite: opacity > 0.98 });
  const add = (g, m, x, y, z, rz = 0) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.rotation.z = rz;
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };
  // 따로 돌아가는 부품 묶음 (개틀링 총열)
  const sub = (x, y, z) => {
    const sg = new THREE.Group();
    sg.position.set(x, y, z);
    group.add(sg);
    return {
      group: sg,
      add(g, m, px, py, pz) {
        const mesh = new THREE.Mesh(g, m);
        mesh.position.set(px - x, py - y, pz - z);
        mesh.castShadow = true;
        sg.add(mesh);
        return mesh;
      },
    };
  };
  const hands = WEAPON_MODELS[kind](add, { ...baseMats, accent }, sub);
  group.scale.setScalar(GUN_SCALE);
  const s = GUN_SCALE;
  return { group, accent, spinner: hands.spinner || null, grip: hands.grip.map((v) => v * s), fore: hands.fore.map((v) => v * s) };
}

export function gunMats(opacity = 1) {
  const o = { opacity, depthWrite: opacity > 0.98 };
  return {
    metal: toonMat('#3a3f47', o),
    dark: toonMat('#22252b', o),
    grip: toonMat('#2c2622', o),
    wood: toonMat('#8a5530', o),
    woodDark: toonMat('#5a361e', o),
    shell: toonMat('#b3261e', o),
    glass: toonMat('#7fd3ff', { ...o, emissive: '#3aa0ff', emissiveIntensity: 0.9 }),
  };
}


// ───────────────────────── 캐릭터 시트 (앞 / 뒤 / 옆 걷기) ─────────────────────────
let SPR = null; // { scene, uniforms } - client.js가 PixelPipeline을 만든 뒤 알려 줌
export function initSprites(scene, uniforms) { SPR = { scene, uniforms }; }

const texCache = new Map();
function sheetTex(name) {
  let t = texCache.get(name);
  if (!t) {
    t = new THREE.TextureLoader().load(spriteUrl(name));
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearFilter;   // 작게 그릴 때는 부드럽게
    t.magFilter = THREE.NearestFilter;  // 크게 그릴 때는 도트 그대로
    t.generateMipmaps = false;
    texCache.set(name, t);
  }
  return t;
}
const quadGeo = new THREE.PlaneGeometry(1, 1);

// 화면에서는 똑바로 보이고, 깊이는 발밑을 지나는 세로 판 위의 점처럼 계산 → 벽/상자에 자연스럽게 가려짐 (가려진 곳은 실루엣)
function spriteMat(tex, color) {
  const u = SPR.uniforms;
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: tex },
      frame: { value: new THREE.Vector4(0, 0, 1, 1) },  // uv 시작, 크기
      anchor: { value: new THREE.Vector3() },           // 발밑 (월드)
      sizePx: { value: new THREE.Vector2(32, 48) },     // 화면 픽셀 크기
      pivotPx: { value: new THREE.Vector2(16, 48) },    // 그림 안의 기준점 (왼쪽 위에서, 화면 픽셀)
      offsetPx: { value: new THREE.Vector2(0, 0) },     // 기준점이 놓일 곳 (발밑 화면 점에서, 위가 +)
      flip: { value: 1 },
      tDepth: u.tDepth, rtSize: u.rtSize, pixel: u.pixel, margin: u.margin, off: u.off,
      screenSize: u.screenSize, worldPerPx: u.worldPerPx,
      opacity: { value: 1 }, flash: { value: 0 },
      silColor: { value: new THREE.Color(color) }, silAlpha: { value: 0.45 },
    },
    vertexShader: `
      uniform vec4 frame;
      uniform vec3 anchor;
      uniform vec2 sizePx;
      uniform vec2 pivotPx;
      uniform vec2 offsetPx;
      uniform float flip;
      uniform vec2 screenSize;
      uniform float worldPerPx;
      varying vec2 vUv;
      void main() {
        vec2 corner = vec2(position.x + 0.5, 0.5 - position.y);
        vec2 local = corner * sizePx - pivotPx;
        local.x *= flip;
        vec2 r = vec2(local.x, -local.y) + offsetPx;
        vec4 a = projectionMatrix * viewMatrix * vec4(anchor, 1.0);
        vec2 ap = floor((a.xy * 0.5 + 0.5) * screenSize + 0.5);
        vec4 d = projectionMatrix * viewMatrix * vec4(anchor + vec3(0.0, max(r.y, 0.0) * worldPerPx / ${COS_EL.toFixed(6)}, 0.0), 1.0);
        gl_Position = vec4((ap + r) / screenSize * 2.0 - 1.0, d.z, 1.0);
        vUv = frame.xy + vec2(corner.x, 1.0 - corner.y) * frame.zw;
      }`,
    fragmentShader: `
      uniform sampler2D map;
      uniform sampler2D tDepth;
      uniform vec2 rtSize;
      uniform float pixel;
      uniform vec2 margin;
      uniform vec2 off;
      uniform float opacity;
      uniform float flash;
      uniform vec3 silColor;
      uniform float silAlpha;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(map, vUv);
        if (c.a < 0.5) discard;
        vec2 p = floor(gl_FragCoord.xy / pixel + margin + off);
        float wd = texture2D(tDepth, (p + 0.5) / rtSize).x;
        if (gl_FragCoord.z > wd + 0.00003) {
          if (silAlpha <= 0.0) discard;
          gl_FragColor = vec4(silColor, silAlpha * opacity);
        } else {
          gl_FragColor = vec4(mix(c.rgb, vec3(1.0), flash), opacity);
        }
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide, // 좌우로 뒤집어 그려도 보이게
  });
}

// ───────────────────────── 게임용 아바타 ─────────────────────────
const shieldGeo = new THREE.IcosahedronGeometry(1, 1);
const shadowGeo = new THREE.CircleGeometry(1, 16).rotateX(-PI / 2);
const _R = new THREE.Vector3(Math.cos(CAM_AZ), 0, -Math.sin(CAM_AZ)); // 화면 오른쪽 (월드)

// look: 캐릭터 번호(0, 1..) 또는 적 종류('trainee', 'boss'..)
export function makeAvatar(scene, look, color, isMe) {
  const enemy = typeof look === 'string' ? G.ENEMIES[look] : null;
  const name = enemy ? enemy.sprite : (CHARACTERS[look] || CHARACTERS[0]).sprite;
  const sheet = SHEETS[name] || SHEETS.haru;
  const s = enemy && enemy.scale ? enemy.scale : 1;
  const group = new THREE.Group();
  const ringBase = isMe ? 0.7 : 0.55;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.46 * s, 0.58 * s, 24),
    new THREE.MeshBasicMaterial({ color: isMe ? '#ffffff' : color, transparent: true, opacity: ringBase, depthWrite: false }),
  );
  ring.rotation.x = -PI / 2;
  ring.position.y = 0.03;
  const shadow = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.32, depthWrite: false }));
  shadow.scale.set(0.45 * s, 1, 0.32 * s);
  shadow.position.y = 0.025;
  const shield = new THREE.Mesh(shieldGeo, new THREE.MeshBasicMaterial({
    color: '#9fe8ff', transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, wireframe: true,
  }));
  shield.scale.set(0.85 * s, 1.35 * s, 0.85 * s);
  shield.position.y = 1.15 * s;
  shield.visible = false;
  group.add(ring, shadow, shield);
  scene.add(group);

  const bodyMat = spriteMat(sheetTex(name), color);
  const body = new THREE.Mesh(quadGeo, bodyMat);
  body.frustumCulled = false;
  SPR.scene.add(body);

  const av = {
    scene, group, ring, shadow, shield, body, bodyMat, sheet, s, isMe, look, charId: look, enemy: !!enemy, boss: !!(enemy && enemy.boss),
    kind: null, opacity: 1, ringBase, kick: 0, flick: 0, phase: 0, spd: 0, t: Math.random() * 10, lastX: null, lastY: 0,
    dir: 'front', flipX: 1, flash: 0, k: 1, x: 0, y: 0, z: 0, yaw: 0, tagH: 2.4 * s, bodyH: 2.1 * s,
  };
  return av;
}

export function disposeAvatar(av) {
  av.scene.remove(av.group);
  SPR.scene.remove(av.body);
  av.bodyMat.dispose();
  for (const m of [av.ring.material, av.shadow.material, av.shield.material]) m.dispose();
  av.ring.geometry.dispose();
}

// 총은 그림에 그려져 있음 (무기 종류는 화면 아래 칸에 표시)
export function setAvatarWeapon(av, kind) { av.kind = kind; }

export function setAvatarOpacity(av, o) {
  if (Math.abs(av.opacity - o) < 0.001) return;
  av.opacity = o;
  av.bodyMat.uniforms.opacity.value = o;
  av.ring.material.opacity = av.ringBase * o;
  av.shadow.material.opacity = 0.32 * o;
  const vis = o > 0.01;
  av.group.visible = vis;
  av.body.visible = vis;
}

export function setAvatarColor(av, color) {
  av.bodyMat.uniforms.silColor.value.set(color);
  if (!av.isMe) av.ring.material.color.set(color);
}

// 무적 보호막 (t: 시간 → 반짝임)
export function setAvatarShield(av, on, t = 0) {
  av.shield.visible = on;
  if (!on) return;
  av.shield.rotation.y = t * 0.0012;
  av.shield.material.opacity = 0.16 + 0.1 * Math.sin(t / 90);
}
export function setAvatarHit(av) { av.flash = 1; }
export function setAvatarSpin() {}

// 바라보는 방향(yaw)이 화면에서 어느 쪽인지 (위가 +인 화면 각도)
function screenAngle(yaw) {
  return Math.atan2(-Math.sin(yaw + CAM_AZ) * SIN_EL, Math.cos(yaw + CAM_AZ));
}

// 매 프레임: 위치/방향 + 걷기 애니메이션
export function poseAvatar(av, x, y, z, yaw, dt, { kneel = false, air = false } = {}) {
  if (!(dt > 0)) dt = 0.016;
  if (av.lastX === null) { av.lastX = x; av.lastY = y; }
  const dist = Math.hypot(x - av.lastX, y - av.lastY);
  av.lastX = x; av.lastY = y;
  const inst = dist > 2 ? 0 : Math.min(8, dist / dt);
  av.spd += (inst - av.spd) * (1 - Math.exp(-dt * 12));
  av.t += dt;
  av.kick *= Math.exp(-dt * 14);
  av.flash *= Math.exp(-dt * 12);
  av.x = x; av.y = y; av.z = z; av.yaw = yaw;
  av.group.position.set(x, z, y);

  const sh = av.sheet;
  const wpp = SPR.uniforms.worldPerPx.value || 0.02;
  // 화면에 보일 키 → 그림 1칸을 화면 몇 픽셀로 그릴지
  const k = (SPRITE_H * av.s) / wpp / sh.height;
  av.k = k;
  // 방향: 아래쪽을 겨누면 앞모습, 위쪽이면 뒷모습, 나머지는 옆모습
  const th = screenAngle(yaw);
  const sinT = Math.sin(th), cosT = Math.cos(th);
  if (sinT > 0.55) av.dir = 'back';
  else if (sinT < -0.55) av.dir = 'front';
  else av.dir = 'side';
  // 그림은 앞·옆이 오른쪽, 뒤가 왼쪽을 겨눔 → 겨누는 쪽에 맞게 뒤집음
  const right = cosT >= 0;
  av.flipX = av.dir === 'back' ? (right ? -1 : 1) : (right ? 1 : -1);
  // 프레임: 움직이면 걷기(속도에 맞춰), 멈추면 서 있는 장 + 숨쉬기
  const row = sh.rows[av.dir];
  let col, bob = 0;
  if (air) col = 0;
  else if (av.spd > 0.6) {
    av.phase += dt * (4 + av.spd * 1.3);
    col = Math.floor(av.phase) % row.n;
  } else {
    av.phase = 0;
    col = 1 % row.n;
    bob = Math.floor(av.t * 1.4) % 2 ? -1 : 0;
  }
  const bu = av.bodyMat.uniforms;
  const W = sh.cw * sh.cols, H = sh.ch * 3;
  bu.frame.value.set((col * sh.cw) / W, 1 - ((row.row + 1) * sh.ch) / H, sh.cw / W, sh.ch / H);
  bu.sizePx.value.set(sh.cw * k, sh.ch * k);
  bu.pivotPx.value.set((sh.cw / 2) * k, (sh.ch - 2) * k);
  bu.offsetPx.value.set(0, bob * Math.max(1, Math.round(k)) - (kneel ? 4 * k : 0));
  bu.flip.value = av.flipX;
  bu.anchor.value.set(x, z, y);
  bu.flash.value = av.flash;
  av.body.position.set(x, z + 1, y);
  const visH = sh.height * k * wpp;
  av.tagH = visH / COS_EL + 0.08;
  av.bodyH = (visH / COS_EL) * 0.9;
}

// 화면 오프셋(px, 위가 +)을 발밑 기준 월드 좌표로 (세로 판 위의 점)
function screenToWorld(av, rx, ry) {
  const wpp = SPR.uniforms.worldPerPx.value || 0.02;
  return [av.x + _R.x * rx * wpp, av.y + _R.z * rx * wpp, av.z + (ry * wpp) / COS_EL];
}
// 총구 위치 (그림 속 총 끝, 맵 좌표)
export function muzzleOf(av) {
  const m = av.sheet.muzzle[av.dir] || [0, 50];
  return screenToWorld(av, m[0] * av.k * av.flipX, m[1] * av.k);
}
// 탄피 배출구 위치 (총 가운데쯤)
export function ejectPointOf(av) {
  const m = av.sheet.muzzle[av.dir] || [0, 50];
  return screenToWorld(av, m[0] * 0.45 * av.k * av.flipX, m[1] * av.k);
}

// ───────────────────────── 무기 아이콘 (도트 이미지로 굽기) ─────────────────────────
export function makeBaker(renderer) {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#6a5a5a', 1.55));
  const sun = new THREE.DirectionalLight('#fff4e0', 2.3);
  sun.position.set(2.2, 4, 2.6);
  scene.add(sun);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 50);

  function bake(obj, w, h, viewW, center, dir, scale = 4) {
    const rt = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const viewH = viewW * h / w;
    Object.assign(cam, { left: -viewW / 2, right: viewW / 2, top: viewH / 2, bottom: -viewH / 2 });
    cam.updateProjectionMatrix();
    cam.position.copy(center).addScaledVector(dir, 10);
    cam.lookAt(center);
    scene.add(obj);
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearAlpha();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, cam);
    const buf = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearAlpha(prevClear);
    scene.remove(obj);
    rt.dispose();
    // 위아래 뒤집기 + 1픽셀 외곽선 → 확대한 캔버스로
    const cv = document.createElement('canvas');
    cv.width = w * scale; cv.height = h * scale;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    const img = g.createImageData(w, h);
    const A = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : buf[((h - 1 - y) * w + x) * 4 + 3]);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const si = ((h - 1 - y) * w + x) * 4, di = (y * w + x) * 4;
        if (buf[si + 3] > 40) {
          img.data[di] = buf[si]; img.data[di + 1] = buf[si + 1]; img.data[di + 2] = buf[si + 2]; img.data[di + 3] = 255;
        } else if (A(x + 1, y) > 40 || A(x - 1, y) > 40 || A(x, y + 1) > 40 || A(x, y - 1) > 40) {
          img.data[di] = 24; img.data[di + 1] = 18; img.data[di + 2] = 28; img.data[di + 3] = 255;
        }
      }
    }
    const small = document.createElement('canvas');
    small.width = w; small.height = h;
    small.getContext('2d').putImageData(img, 0, 0);
    g.drawImage(small, 0, 0, w * scale, h * scale);
    return cv.toDataURL();
  }

  return {
    weaponIcon(kind) {
      const g = buildGunGroup(kind, gunMats());
      const len = G.WEAPONS[kind].len * GUN_SCALE;
      const minX = { pistol: 0.08, smg: -0.2, shotgun: -0.32, rifle: -0.33, sniper: -0.52, gatling: -0.45 }[kind] ?? -0.4;
      const span = len - minX;
      const center = new THREE.Vector3(minX + span / 2, -0.05, 0);
      return bake(g.group, 48, 18, Math.max(span * 1.08, 0.7), center, new THREE.Vector3(0, 0, 1));
    },
  };
}
