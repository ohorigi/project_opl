// 시야 가림: 건물 안에 있으면 창문/문으로 직접 보이는 곳 말고는 어둡게 그린다.
// (밖에서 창문 가까이 가면 그 건물 안도 창문으로 보이는 만큼만 밝게)
// 모든 툰 재질에 같은 uniform을 붙여서, 지도 크기의 흑백 마스크 텍스처 한 장으로 처리한다.
import * as THREE from 'three';

const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
white.needsUpdate = true;

export const FOG = {
  tex: { value: white },
  on: { value: 0 },
  size: { value: new THREE.Vector2(1, 1) },
  roofH: { value: 2.7 },   // 이 높이보다 위(지붕, 옥상)는
  roofLit: { value: 1 },   // 1이면 항상 밝게 (밖에서 볼 때)
  dark: { value: 0.24 },   // 안 보이는 곳 밝기
};

export function patchFog(mat) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      fogTex: FOG.tex, fogOn: FOG.on, fogSize: FOG.size, fogRoofH: FOG.roofH, fogRoofLit: FOG.roofLit, fogDark: FOG.dark,
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFogW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvFogW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vFogW;
uniform sampler2D fogTex;
uniform float fogOn;
uniform vec2 fogSize;
uniform float fogRoofH;
uniform float fogRoofLit;
uniform float fogDark;`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
if (fogOn > 0.5) {
  float fm = texture2D(fogTex, vFogW.xz / fogSize).r;
  if (vFogW.y > fogRoofH) fm = max(fm, fogRoofLit);
  gl_FragColor.rgb *= mix(fogDark, 1.0, fm);
}`);
  };
  mat.customProgramCacheKey = () => 'oplfog';
  return mat;
}
