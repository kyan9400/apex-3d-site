/* ==========================================================================
   GLOSSY FLOOR — a real reflection of the car (high quality tier only)

   three's Reflector renders the scene a second time from a camera mirrored
   under the floor, into a texture. We draw that texture on the floor with:
     · half resolution + a 5-tap blur  -> soft, like polished concrete, not a mirror
     · a radial fade                   -> the reflection dies out away from the car
     · additive blending               -> it only adds light to the dark floor
   A second render pass costs GPU time, which is why only the "high" tier gets
   it. Render-on-demand (main.js) also skips this pass whenever nothing moves.
   ========================================================================== */
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

const GlossyFloorShader = {
  name: 'GlossyFloorShader',
  uniforms: {
    color: { value: null }, // Reflector expects these three
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    strength: { value: 0.32 }, // how bright the reflection is
    texel: { value: new THREE.Vector2(1 / 512, 1 / 512) }, // one pixel of the reflection texture
    radius: { value: 6 }, // where the reflection has faded out completely
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec2 vLocal;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0); // where this floor point lands in the mirror image
      vLocal = position.xy; // distance from the centre, for the fade
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float strength;
    uniform vec2 texel;
    uniform float radius;
    varying vec4 vUv;
    varying vec2 vLocal;
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      vec2 uv = vUv.xy / vUv.w;
      // centre + 4 diagonal samples = a cheap blur
      vec3 c = texture2D(tDiffuse, uv).rgb * 0.36;
      c += texture2D(tDiffuse, uv + texel * vec2( 2.0,  2.0)).rgb * 0.16;
      c += texture2D(tDiffuse, uv + texel * vec2(-2.0,  2.0)).rgb * 0.16;
      c += texture2D(tDiffuse, uv + texel * vec2( 2.0, -2.0)).rgb * 0.16;
      c += texture2D(tDiffuse, uv + texel * vec2(-2.0, -2.0)).rgb * 0.16;
      float fade = 1.0 - smoothstep(radius * 0.12, radius, length(vLocal));
      gl_FragColor = vec4(c * strength * fade, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

export function createGlossyFloor(scene) {
  const mirror = new Reflector(new THREE.CircleGeometry(GlossyFloorShader.uniforms.radius.value, 64), {
    shader: GlossyFloorShader,
    textureWidth: 512, // resized to half the screen by fit()
    textureHeight: 512,
    clipBias: 0.003,
    multisample: 0, // no anti-aliasing needed: we blur it anyway
  });
  const mat = mirror.material;
  mat.blending = THREE.AdditiveBlending;
  mat.transparent = true;
  mat.depthWrite = false;
  mirror.rotation.x = -Math.PI / 2;
  mirror.position.y = 0.0005; // just above the dark ground disc
  mirror.renderOrder = 0.5; // after the ground, before the road and the baked shadow
  scene.add(mirror);

  let w = 0;
  let h = 0;
  return {
    mirror,
    // Keep the reflection texture at half the drawing size (called every frame, cheap when unchanged)
    fit(bufferW, bufferH) {
      const nw = Math.max(64, Math.round(bufferW * 0.5));
      const nh = Math.max(64, Math.round(bufferH * 0.5));
      if (nw === w && nh === h) return;
      w = nw;
      h = nh;
      mirror.getRenderTarget().setSize(w, h);
      mat.uniforms.texel.value.set(1 / w, 1 / h);
    },
  };
}
