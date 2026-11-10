// 도트(픽셀아트) 렌더링: 장면을 낮은 해상도로 그린 뒤 또렷하게(최근접 보간) 확대하고,
// 물체 가장자리에 1픽셀 외곽선을 넣는다. 카메라는 픽셀 격자에 맞춰 움직여서
// 화면이 움직일 때 도트가 지글거리지 않게 하고, 남는 소수점 이동은 확대 단계에서 보정한다.
import * as THREE from 'three';

const TARGET_ROWS = 480; // 화면 세로 도트 수 목표 (1080p 화면이면 540줄 → 도트가 더 촘촘함)

export class PixelPipeline {
  // opts.pixel: 도트 한 칸 크기를 고정 (캐릭터 미리보기용)
  constructor(renderer, camera, opts = {}) {
    this.renderer = renderer;
    this.camera = camera;
    this.fixedPixel = opts.pixel || 0;
    this.pixel = 3;
    this.lw = 1; this.lh = 1;
    this.marginX = 1; this.marginY = 1;
    this.off = new THREE.Vector2();
    this.pw = 0.07;
    this.rt = null;
    this._R = new THREE.Vector3();
    this._U = new THREE.Vector3();

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        rtSize: { value: new THREE.Vector2(1, 1) },
        pixel: { value: 3 },
        margin: { value: new THREE.Vector2(1, 1) },
        off: { value: new THREE.Vector2() },
        depthRange: { value: 400 },
      },
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        uniform sampler2D tColor;
        uniform sampler2D tDepth;
        uniform vec2 rtSize;
        uniform float pixel;
        uniform vec2 margin;
        uniform vec2 off;
        uniform float depthRange;
        float dAt(vec2 p) { return texture2D(tDepth, (p + 0.5) / rtSize).x * depthRange; }
        void main() {
          vec2 p = floor(gl_FragCoord.xy / pixel + margin + off);
          vec4 c = texture2D(tColor, (p + 0.5) / rtSize);
          float d = dAt(p);
          // 이웃이 나보다 충분히 멀면 내가 물체 가장자리 → 어둡게 (1픽셀 외곽선)
          float edge = 0.0;
          edge = max(edge, dAt(p + vec2(1.0, 0.0)) - d);
          edge = max(edge, dAt(p - vec2(1.0, 0.0)) - d);
          edge = max(edge, dAt(p + vec2(0.0, 1.0)) - d);
          edge = max(edge, dAt(p - vec2(0.0, 1.0)) - d);
          if (edge > 0.35) c.rgb *= 0.32;
          gl_FragColor = vec4(c.rgb, 1.0);
          #include <colorspace_fragment>
        }`,
      depthTest: false,
      depthWrite: false,
    });
    // 캐릭터 그림(스프라이트)은 저해상도가 아니라 화면 해상도로 따로 그림.
    // 지형 깊이(저해상도)와 비교해서 벽 뒤는 실루엣으로 → 이 uniform들을 스프라이트 재질이 같이 씀
    const u = this.mat.uniforms;
    this.spriteUniforms = {
      tDepth: u.tDepth, rtSize: u.rtSize, pixel: u.pixel, margin: u.margin, off: u.off,
      screenSize: { value: new THREE.Vector2(1, 1) }, // 화면(그리기 버퍼) 픽셀 크기
      worldPerPx: { value: 0.02 },                     // 화면 1픽셀의 월드 길이
    };
    this.spriteScene = new THREE.Scene();
    this.spriteCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
  }

  // 화면 크기가 바뀌면 저해상도 버퍼를 다시 만든다
  resize() {
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    this.sw = size.x; this.sh = size.y;
    this.pixel = this.fixedPixel || Math.max(2, Math.round(this.sh / TARGET_ROWS));
    this.lw = Math.ceil(this.sw / this.pixel) + 2;
    this.lh = Math.ceil(this.sh / this.pixel) + 2;
    this.marginX = this.lw / 2 - this.sw / (2 * this.pixel);
    this.marginY = this.lh / 2 - this.sh / (2 * this.pixel);
    if (this.rt) { this.rt.depthTexture.dispose(); this.rt.dispose(); }
    this.rt = new THREE.WebGLRenderTarget(this.lw, this.lh, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(this.lw, this.lh),
    });
    const u = this.mat.uniforms;
    u.tColor.value = this.rt.texture;
    u.tDepth.value = this.rt.depthTexture;
    u.rtSize.value.set(this.lw, this.lh);
    u.pixel.value = this.pixel;
    u.margin.value.set(this.marginX, this.marginY);
  }

  // 카메라 배치: target(월드 좌표, THREE 좌표계)을 보도록 놓되 도트 격자에 맞춘다.
  // viewH = 화면 세로에 보일 월드 크기
  place(target, offset, viewH, shake = { x: 0, z: 0 }) {
    const cam = this.camera;
    this.pw = viewH / (this.sh / this.pixel);
    cam.left = -this.lw * this.pw / 2;
    cam.right = this.lw * this.pw / 2;
    cam.top = this.lh * this.pw / 2;
    cam.bottom = -this.lh * this.pw / 2;
    cam.updateProjectionMatrix();

    cam.position.set(target.x + offset.x + shake.x, target.y + offset.y, target.z + offset.z + shake.z);
    cam.lookAt(target.x + shake.x, target.y, target.z + shake.z);
    cam.updateMatrixWorld();
    const R = this._R.setFromMatrixColumn(cam.matrixWorld, 0);
    const U = this._U.setFromMatrixColumn(cam.matrixWorld, 1);
    const a = cam.position.dot(R), b = cam.position.dot(U);
    const as = Math.round(a / this.pw) * this.pw, bs = Math.round(b / this.pw) * this.pw;
    cam.position.addScaledVector(R, as - a).addScaledVector(U, bs - b);
    cam.updateMatrixWorld();
    // 격자에 맞추느라 옮긴 만큼 확대할 때 반대로 밀어서 화면은 부드럽게 움직이게 함
    this.off.set((a - as) / this.pw, (b - bs) / this.pw);
    this.mat.uniforms.off.value.copy(this.off);
    this.mat.uniforms.depthRange.value = cam.far - cam.near;
    this.spriteUniforms.screenSize.value.set(this.sw, this.sh);
    this.spriteUniforms.worldPerPx.value = this.pw / this.pixel;
    // 스프라이트 카메라: 같은 위치/방향, 시야는 화면에 실제로 보이는 부분과 똑같이
    const sc = this.spriteCam;
    sc.position.copy(cam.position);
    sc.quaternion.copy(cam.quaternion);
    sc.near = cam.near; sc.far = cam.far;
    sc.left = cam.left + (this.marginX + this.off.x) * this.pw;
    sc.right = sc.left + (this.sw / this.pixel) * this.pw;
    sc.bottom = cam.bottom + (this.marginY + this.off.y) * this.pw;
    sc.top = sc.bottom + (this.sh / this.pixel) * this.pw;
    sc.updateProjectionMatrix();
    sc.updateMatrixWorld();
  }

  render(scene) {
    const r = this.renderer;
    r.setRenderTarget(this.rt);
    r.render(scene, this.camera);
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
    if (this.spriteScene.children.length) {
      const ac = r.autoClear;
      r.autoClear = false;
      r.render(this.spriteScene, this.spriteCam);
      r.autoClear = ac;
    }
  }

  // CSS 화면 좌표 → 카메라 NDC (조준 레이캐스트용)
  screenToNdc(cssX, cssY, out) {
    const dpr = this.sw / innerWidth;
    const px = (cssX * dpr) / this.pixel + this.marginX + this.off.x;
    const py = ((innerHeight - cssY) * dpr) / this.pixel + this.marginY + this.off.y;
    return out.set((px / this.lw) * 2 - 1, (py / this.lh) * 2 - 1);
  }

  // 카메라 NDC → CSS 화면 좌표 (이름표 위치용)
  ndcToScreen(nx, ny) {
    const dpr = this.sw / innerWidth;
    const px = ((nx + 1) / 2) * this.lw - this.marginX - this.off.x;
    const py = ((ny + 1) / 2) * this.lh - this.marginY - this.off.y;
    return { x: (px * this.pixel) / dpr, y: innerHeight - (py * this.pixel) / dpr };
  }
}
