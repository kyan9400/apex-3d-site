/* ==========================================================================
   APEX MOTORS — scroll-driven 3D car showcase

   The 4 ingredients of every "premium 3D website":
     1. A 3D model         -> a .glb file loaded with GLTFLoader (+ Draco compression)
     2. A real-time scene  -> Three.js renderer, studio environment lighting, materials
     3. Scroll animation   -> GSAP ScrollTrigger moves the camera as you scroll,
                              Lenis makes the scrolling smooth
     4. Cinematic design   -> dark background, huge type, glass panels (style.css)
   ========================================================================== */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import WebGL from 'three/addons/capabilities/WebGL.js';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* --------------------------------------------------------------------------
   MODEL SOURCES
   The car is the free Ferrari 458 model from the three.js examples (CC-BY,
   credit in the footer). It ships with the site in /public/models and the
   loader tries each source in order until one works. To use your own car,
   put a .glb in /public/models and change the first line.
   -------------------------------------------------------------------------- */
const MODEL_SOURCES = [
  `${import.meta.env.BASE_URL}models/ferrari.glb`,
  // Same model as base64 text, for hosts that refuse .glb files (made by scripts/artifact-page.mjs)
  `${import.meta.env.BASE_URL}models/ferrari.glb.json`,
  'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r186/examples/models/gltf/ferrari.glb',
  'https://threejs.org/examples/models/gltf/ferrari.glb',
];
const MODEL_BYTES = 1681572; // used for the progress bar when the CDN doesn't send a size

/* --------------------------------------------------------------------------
   DOM
   -------------------------------------------------------------------------- */
const canvas = document.getElementById('webgl');
const loaderEl = document.getElementById('loader');
const loaderBar = document.getElementById('loader-bar');
const loaderText = document.getElementById('loader-text');
document.body.classList.add('is-loading');
history.scrollRestoration = 'manual'; // always start at the top so the intro plays
window.scrollTo(0, 0);

/* --------------------------------------------------------------------------
   1. SMOOTH SCROLL (Lenis) wired into GSAP's ticker so ScrollTrigger
      and Lenis update on the same frame. Skipped for reduced motion.
   -------------------------------------------------------------------------- */
let lenis = null;
if (!prefersReducedMotion) {
  lenis = new Lenis({ duration: 1.2, anchors: true, autoRaf: false });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  lenis.stop(); // locked until the loader finishes
}

/* --------------------------------------------------------------------------
   2. RENDERER, SCENE, CAMERA
   -------------------------------------------------------------------------- */
if (!WebGL.isWebGL2Available()) {
  showFatal('Your browser does not support WebGL 2, so the 3D car is hidden. The rest of the page still works.');
} else {
  init();
}

function init() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // cap: 3x screens would cost 2.25x more pixels for no visible gain
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; // filmic contrast, like a photo
  renderer.toneMappingExposure = 0.9;

  const scene = new THREE.Scene();

  // Studio lighting without any image download: RoomEnvironment is a built-in
  // virtual photo studio. PMREM turns it into reflections for shiny materials.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.1, 100);

  /* ------------------------------------------------------------------------
     GROUND: a dark glossy disc whose edges fade out (alphaMap from a canvas
     gradient), so the car seems to float in a spotlight.
     ------------------------------------------------------------------------ */
  const fade = document.createElement('canvas');
  fade.width = fade.height = 256;
  const fctx = fade.getContext('2d');
  const grad = fctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(0.45, '#888');
  grad.addColorStop(1, '#000');
  fctx.fillStyle = grad;
  fctx.fillRect(0, 0, 256, 256);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(9, 64),
    new THREE.MeshStandardMaterial({
      color: 0x060608,
      roughness: 0.6,
      metalness: 0,
      envMapIntensity: 0.12, // keep the floor dark; full reflections turn it grey
      alphaMap: new THREE.CanvasTexture(fade),
      transparent: true,
      depthWrite: false,
    })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  /* ------------------------------------------------------------------------
     MATERIALS: the paint is a MeshPhysicalMaterial with a clearcoat layer,
     which is what makes car paint look wet and expensive.
     ------------------------------------------------------------------------ */
  const paint = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#b3121f'),
    metalness: 0.9,
    roughness: 0.45,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
  });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.35 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x111111,
    metalness: 0.2,
    roughness: 0.02,
    transparent: true,
    opacity: 0.75,
  });

  const car = new THREE.Group();
  scene.add(car);
  const wheels = [];

  /* ------------------------------------------------------------------------
     3. LOAD THE MODEL (GLTFLoader + DRACOLoader). Draco = compressed geometry;
     the decoder files live in /public/draco (copied from three's package).
     ------------------------------------------------------------------------ */
  const draco = new DRACOLoader();
  draco.setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(draco);
  const textureLoader = new THREE.TextureLoader();

  // A .json source holds the .glb bytes as base64: decode them, then let GLTFLoader parse the bytes
  function loadGltf(url, onLoad, onProgress, onError) {
    if (!url.endsWith('.json')) return gltfLoader.load(url, onLoad, onProgress, onError);
    const fileLoader = new THREE.FileLoader();
    fileLoader.setResponseType('json');
    fileLoader.load(
      url,
      ({ glb }) => {
        const binary = atob(glb);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        gltfLoader.parse(bytes.buffer, '', onLoad, onError);
      },
      onProgress,
      onError
    );
  }

  loadModel(0);

  function loadModel(sourceIndex) {
    const url = MODEL_SOURCES[sourceIndex];
    const base = url.slice(0, url.lastIndexOf('/') + 1); // folder that also holds ferrari_ao.png
    loadGltf(
      url,
      (gltf) => {
        const model = gltf.scene.children[0];
        // Part names come from the model file (open it in https://gltf-viewer.donmccurdy.com to see yours)
        model.getObjectByName('body').material = paint;
        ['rim_fl', 'rim_fr', 'rim_rr', 'rim_rl', 'trim'].forEach((n) => (model.getObjectByName(n).material = chrome));
        model.getObjectByName('glass').material = glass;
        ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].forEach((n) => wheels.push(model.getObjectByName(n)));

        // Baked contact shadow: a pre-rendered dark smudge under the car (cheaper than real-time shadows)
        textureLoader.load(base + 'ferrari_ao.png', (aoTexture) => {
          const shadow = new THREE.Mesh(
            new THREE.PlaneGeometry(0.655 * 4, 1.3 * 4),
            new THREE.MeshBasicMaterial({
              map: aoTexture,
              blending: THREE.MultiplyBlending,
              toneMapped: false,
              transparent: true,
              premultipliedAlpha: true,
              depthWrite: false,
            })
          );
          shadow.rotation.x = -Math.PI / 2;
          shadow.position.y = 0.002;
          shadow.renderOrder = 2;
          model.add(shadow);
        });

        car.add(model);
        draco.dispose();
        onLoaded();
      },
      (xhr) => {
        const total = xhr.total || MODEL_BYTES;
        const pct = Math.min(99, Math.round((xhr.loaded / total) * 100));
        loaderBar.style.width = `${pct}%`;
        loaderText.textContent = `Loading ${pct}%`;
      },
      () => {
        if (sourceIndex + 1 < MODEL_SOURCES.length) loadModel(sourceIndex + 1);
        else {
          loaderText.textContent = 'The 3D model could not load. Showing the page without it.';
          setTimeout(onLoaded, 1800);
        }
      }
    );
  }

  /* ------------------------------------------------------------------------
     4. CAMERA "SHOTS" — one per section. Instead of x/y/z positions we orbit
     around the car (angle around it, angle from above, distance), so moving
     between shots sweeps AROUND the car instead of through it.
       theta: degrees around the car (this model faces -z, so 180 = front,
              90 = right side, 0 = rear)
       phi:   degrees from straight above (90 = eye level with the ground)
       dist:  distance from the car
       shiftX/shiftY: slide the car left/right/up on screen to make room for text
     ------------------------------------------------------------------------ */
  const SHOTS = [
    { theta: 140, phi: 76, dist: 9.5, ty: 0.5, shiftX: 0.2, shiftY: 0.08 }, // hero: front 3/4
    { theta: 92, phi: 84, dist: 10.5, ty: 0.5, shiftX: 0.2, shiftY: 0.0 }, // performance: side (text left)
    { theta: -35, phi: 80, dist: 9, ty: 0.5, shiftX: -0.22, shiftY: 0.0 }, // design: rear 3/4 (text right)
    { theta: -110, phi: 45, dist: 9.5, ty: 0.3, shiftX: 0.2, shiftY: 0.0 }, // colors: from above (text left)
    { theta: -170, phi: 86, dist: 9.5, ty: 0.6, shiftX: -0.24, shiftY: 0.0 }, // specs: low front (text right)
    { theta: -220, phi: 72, dist: 11, ty: 0.4, shiftX: 0.0, shiftY: 0.16 }, // CTA: wide, a full lap from the hero
  ];

  // `shot` is the live camera state. GSAP tweens these numbers; render() reads them.
  const shot = { ...SHOTS[0] };

  const sections = gsap.utils.toArray('[data-scene]');
  sections.forEach((section, i) => {
    if (i === 0) return;
    gsap.fromTo(shot, { ...SHOTS[i - 1] }, {
      ...SHOTS[i],
      ease: 'power1.inOut',
      immediateRender: false, // don't jump the camera when the tween is created
      scrollTrigger: {
        trigger: section,
        start: 'top bottom', // when this section starts entering the screen...
        end: 'top top', //       ...until it fills the screen
        scrub: prefersReducedMotion ? true : 1, // tie progress to the scrollbar (1s catch-up = smooth)
      },
    });
  });

  // Intro: the camera starts further out and swings in after loading
  const intro = { dist: prefersReducedMotion ? 1 : 1.5, theta: prefersReducedMotion ? 0 : -40 };

  // Subtle parallax: the camera follows the mouse a little (desktop only)
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  if (!prefersReducedMotion && window.matchMedia('(pointer: fine)').matches) {
    window.addEventListener('pointermove', (e) => {
      pointer.x = e.clientX / window.innerWidth - 0.5;
      pointer.y = e.clientY / window.innerHeight - 0.5;
    });
  }

  // Wheels spin with scroll speed (Lenis gives us velocity)
  let wheelSpeed = 0;
  lenis?.on('scroll', ({ velocity }) => (wheelSpeed = velocity));

  /* ------------------------------------------------------------------------
     RENDER LOOP (runs every frame)
     ------------------------------------------------------------------------ */
  const target = new THREE.Vector3();
  const spherical = new THREE.Spherical();
  const DEG = Math.PI / 180;

  function render() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const aspect = w / h;
    const isPortrait = aspect < 1;

    pointer.sx += (pointer.x - pointer.sx) * 0.05;
    pointer.sy += (pointer.y - pointer.sy) * 0.05;

    // On tall phone screens pull the camera back so the whole car fits
    const fit = isPortrait ? 1 + (1 - aspect) * 2.2 : 1;

    target.set(0, shot.ty, 0);
    spherical.set(
      shot.dist * fit * intro.dist,
      (shot.phi + pointer.sy * 4) * DEG,
      (shot.theta + intro.theta + pointer.sx * 6) * DEG
    );
    camera.position.setFromSpherical(spherical).add(target);
    camera.lookAt(target);

    // Phones: text is at the bottom, so push the car up instead of sideways
    const shiftX = isPortrait ? 0 : shot.shiftX;
    const shiftY = isPortrait ? 0.17 : shot.shiftY;
    camera.aspect = aspect;
    camera.setViewOffset(w, h, -shiftX * w, shiftY * h, w, h);

    // Wheels
    const spin = prefersReducedMotion ? 0 : 0.02 + wheelSpeed * 0.01;
    wheels.forEach((wheel) => (wheel.rotation.x -= spin));
    wheelSpeed *= 0.92;

    renderer.render(scene, camera);
  }
  renderer.setAnimationLoop(render);
  if (import.meta.env.DEV) window.__debug = { THREE, camera, shot, intro, car }; // inspect in devtools

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  });

  /* ------------------------------------------------------------------------
     5. COLOR PICKER: tween the paint color in 3D and the UI accent in CSS
     ------------------------------------------------------------------------ */
  const swatches = document.querySelectorAll('.swatch');
  const swatchName = document.getElementById('swatch-name');
  swatches.forEach((btn) => {
    btn.addEventListener('click', () => {
      const color = new THREE.Color(btn.dataset.color);
      gsap.to(paint.color, { r: color.r, g: color.g, b: color.b, duration: prefersReducedMotion ? 0 : 0.8, ease: 'power2.out' });
      setAccent(btn.dataset.color);
      swatches.forEach((s) => s.setAttribute('aria-pressed', String(s === btn)));
      swatchName.textContent = btn.dataset.name;
    });
  });

  /* ------------------------------------------------------------------------
     After loading: hide the loader, play the intro, unlock scrolling
     ------------------------------------------------------------------------ */
  let started = false;
  function onLoaded() {
    if (started) return;
    started = true;
    loaderBar.style.width = '100%';
    loaderText.textContent = 'Ready';
    setTimeout(() => {
      loaderEl.classList.add('is-done');
      document.body.classList.remove('is-loading');
      lenis?.start();
      gsap.to(intro, { dist: 1, theta: 0, duration: 2.4, ease: 'power3.out' });
      playIntroText();
      ScrollTrigger.refresh();
    }, 300);
  }
}

/* ==========================================================================
   TEXT ANIMATIONS
   ========================================================================== */
function playIntroText() {
  if (prefersReducedMotion) return;
  gsap.from('[data-hero-line]', { yPercent: 110, duration: 1.3, ease: 'power4.out', stagger: 0.12, delay: 0.2 });
}

if (!prefersReducedMotion) {
  // Reveal on scroll: anything with data-reveal fades/slides up once it enters
  gsap.utils.toArray('[data-reveal]').forEach((el) => {
    gsap.from(el, {
      y: 40,
      opacity: 0,
      duration: 1,
      ease: 'power3.out',
      scrollTrigger: { trigger: el, start: 'top 88%' },
    });
  });
}

// Counting numbers (0 -> 710 etc.)
document.querySelectorAll('[data-count]').forEach((el) => {
  const end = parseFloat(el.dataset.count);
  const decimals = parseInt(el.dataset.decimals || '0', 10);
  if (prefersReducedMotion) {
    el.textContent = end.toFixed(decimals);
    return;
  }
  const counter = { v: 0 };
  gsap.to(counter, {
    v: end,
    duration: 2,
    ease: 'power2.out',
    scrollTrigger: { trigger: el, start: 'top 85%', once: true },
    onUpdate: () => (el.textContent = counter.v.toFixed(decimals)),
  });
});

/* ==========================================================================
   HELPERS
   ========================================================================== */

// Sets the UI accent color; dark paints get a lighter UI tint so text stays readable
function setAccent(hex) {
  const c = new THREE.Color(hex); // linear values
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const ui = lum < 0.06 ? `color-mix(in srgb, ${hex} 55%, white)` : hex;
  const root = document.documentElement.style;
  root.setProperty('--accent', ui);
  root.setProperty('--accent-ink', lum > 0.35 ? '#111' : '#fff');
}

function showFatal(message) {
  loaderText.textContent = message;
  setTimeout(() => {
    loaderEl.classList.add('is-done');
    document.body.classList.remove('is-loading');
    lenis?.start();
  }, 2500);
}
