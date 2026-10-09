/* ==========================================================================
   APEX MOTORS — scroll-driven 3D car showcase

   The 4 ingredients of every "premium 3D website":
     1. A 3D model         -> a .glb file loaded with GLTFLoader (+ Draco compression)
     2. A real-time scene  -> Three.js renderer, studio environment lighting, materials
     3. Scroll animation   -> GSAP ScrollTrigger moves the camera as you scroll,
                              Lenis makes the scrolling smooth
     4. Cinematic design   -> dark background, huge type, tinted panels (style.css)

   Other files:
     quality.js  -> device tiers, adaptive resolution, ?fps meter
     effects.js  -> light glows, headlight beams, road + speed streaks, brake glow, wheel blur
     ui.js       -> hero intro, split-text headlines, progress bar, cursor, magnetic buttons
   ========================================================================== */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { quality, probeGPU, createAdaptiveResolution, createFpsMeter } from './quality.js';
import { createEffects, createWheelBlur } from './effects.js';
import { splitHeadings, progressUI, backgroundWord, cursorAndMagnets, filmGrain, heroMotion } from './ui.js';
import { reducedMotion as prefersReducedMotion, motionControls } from './motion.js';
import { createGlossyFloor } from './floor.js';

gsap.registerPlugin(ScrollTrigger);

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
const MODEL_BYTES = 1681572; // used for the progress bar when the server doesn't send a size

/* --------------------------------------------------------------------------
   DOM
   -------------------------------------------------------------------------- */
const canvas = document.getElementById('webgl');
const loaderEl = document.getElementById('loader');
const loaderBar = document.getElementById('loader-bar');
const loaderText = document.getElementById('loader-text');
const loaderCount = document.getElementById('loader-count');
document.body.classList.add('is-loading');
history.scrollRestoration = 'manual'; // always start at the top so the intro plays
window.scrollTo(0, 0);

// Loader progress: the bar scales (transform = cheap) and the big counter eases to the new value.
// Only the counter changes per download event; the status text (read by screen readers) does not.
const loadShown = { pct: 0 };
function setLoadProgress(pct) {
  loaderBar.style.transform = `scaleX(${pct / 100})`;
  gsap.to(loadShown, {
    pct,
    duration: prefersReducedMotion ? 0 : 0.4,
    ease: 'power2.out',
    overwrite: true, // a new value replaces the running count
    onUpdate: () => (loaderCount.textContent = Math.round(loadShown.pct)),
  });
}

// While the loader covers the page, nothing behind it can be tabbed to (inert = not focusable, not clickable)
const behindLoader = document.querySelectorAll('.skip-link, header, main, .dots, .motion-toast');
function setBehindLoaderInert(on) {
  behindLoader.forEach((el) => (el.inert = on));
}
setBehindLoaderInert(true);

/* --------------------------------------------------------------------------
   1. SMOOTH SCROLL (Lenis) wired into GSAP's ticker so ScrollTrigger and
      Lenis update on the same frame. `lerp: 0.1` = light smoothing. The
      camera follows Lenis directly (scrub: true below), so there is only ONE
      layer of smoothing — two layers made the old version feel laggy.
   -------------------------------------------------------------------------- */
let lenis = null;
if (!prefersReducedMotion) {
  // respectReducedMotion: false -> motion.js already made the choice; without this Lenis
  // re-checks the OS setting and turns smoothing off even for 'full motion' visitors
  lenis = new Lenis({ lerp: 0.1, anchors: true, autoRaf: false, respectReducedMotion: false });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  lenis.stop(); // locked until the loader finishes
}

/* --------------------------------------------------------------------------
   2D UI (works even without WebGL)
   -------------------------------------------------------------------------- */
motionControls();
document.fonts?.ready.then(() => ScrollTrigger.refresh()); // web fonts change text sizes → re-measure
splitHeadings(prefersReducedMotion);
progressUI();
backgroundWord(prefersReducedMotion);
cursorAndMagnets(prefersReducedMotion);
const hero = heroMotion(prefersReducedMotion); // hidden states now, played after loading

// Color picker UI works even without WebGL; init() plugs the 3D paint tween into onPaint
let onPaint = null;
const swatches = document.querySelectorAll('.swatch');
const swatchName = document.getElementById('swatch-name');
swatches.forEach((btn) =>
  btn.addEventListener('click', () => {
    setAccent(btn.dataset.color);
    swatches.forEach((s) => s.setAttribute('aria-pressed', String(s === btn)));
    swatchName.textContent = btn.dataset.name;
    onPaint?.(btn.dataset.color);
  })
);

// REPLAY THE DRIVE: glide back to the top (the camera rewinds through every shot on the way),
// then init() turns the engine off and on again. Without WebGL it just scrolls up.
let onReplay = null;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
document.getElementById('replay').addEventListener('click', () => {
  const arrived = () => {
    const title = document.querySelector('.hero__title');
    title.setAttribute('tabindex', '-1'); // keyboard users continue from the top too
    title.focus({ preventScroll: true });
    onReplay?.();
  };
  if (lenis) lenis.scrollTo(0, { duration: 2.6, easing: easeInOutCubic, lock: true, force: true, onComplete: arrived });
  else {
    window.scrollTo(0, 0);
    arrived();
  }
});

// Skip link: Lenis scrolls there; this moves keyboard focus too (to <main>, so the hero's h1 is read first)
document.querySelector('.skip-link').addEventListener('click', () => {
  const target = document.getElementById('story');
  target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
});

/* --------------------------------------------------------------------------
   LAUNCH CONTROL — the #launch section is 320vh tall with a sticky HUD.
   Scroll progress through it (0..1) becomes speed: 0 → 330 km/h, hitting
   100 km/h after the same share of scroll as the real 2.9 s launch.
   The gauge is plain HTML/SVG, so it works even without WebGL; the 3D
   scene (frame() in init) reads `launch` for the road, streaks and lens.
   -------------------------------------------------------------------------- */
const launch = { progress: 0, speed: 0 };
const speedEl = document.getElementById('launch-speed');
const timeEl = document.getElementById('launch-time');
const gaugeWrap = document.getElementById('gauge');
const gaugeEl = document.getElementById('gauge-fill');
const badgeEl = document.getElementById('launch-badge');
const hintEl = document.getElementById('launch-hint');
const GAUGE_LENGTH = 405.3; // length of the 270° arc in the SVG (see style.css)
const kmhAt = (p) => (330 * (1 - Math.exp(-3.2 * p))) / (1 - Math.exp(-3.2)); // fast at first, then levels off
let shownKmh = -1;
let shownTenths = -1;

// Speedometer ticks every 30 km/h plus an accent mark at 100 km/h (the svg is rotated 135° in CSS,
// so 0° here is where the arc starts). Drawn once.
const tick = (kmh, cls = '') => `<line class="${cls}" x1="172" y1="100" x2="179" y2="100" transform="rotate(${(kmh / 330) * 270} 100 100)" />`;
let ticks = tick(100, 'gauge__mark');
for (let kmh = 0; kmh <= 330; kmh += 30) ticks += tick(kmh);
document.querySelector('.gauge__ticks').innerHTML = ticks;

ScrollTrigger.create({
  trigger: '#launch',
  start: 'top top',
  end: 'bottom bottom',
  onUpdate: ({ progress }) => {
    launch.progress = progress;
    // The clock has its own check: km/h barely changes near the top, the time keeps ticking
    const tenths = Math.round(progress * 270); // elapsed time in 0.1 s steps (27 s for the whole launch)
    if (tenths !== shownTenths) {
      shownTenths = tenths;
      timeEl.textContent = (tenths / 10).toFixed(1);
    }
    const kmh = Math.round(kmhAt(progress));
    if (kmh === shownKmh) return; // only touch the gauge when the number changes
    shownKmh = kmh;
    speedEl.textContent = kmh;
    gaugeEl.style.strokeDashoffset = GAUGE_LENGTH * (1 - kmh / 330);
    badgeEl.classList.toggle('is-hit', kmh >= 100);
    gaugeWrap.classList.toggle('is-redline', kmh >= 300);
    hintEl.style.opacity = progress > 0.06 ? 0 : 1;
  },
});

// Launch is a full-screen moment: the nav and section dots step aside while it runs.
// GSAP owns these properties (no CSS transition on them). We fade `opacity`, not autoAlpha:
// autoAlpha would add visibility:hidden, and then Tab and screen readers could not reach them.
// Hidden chrome ignores clicks, and keyboard focus inside brings it back (both in style.css).
ScrollTrigger.create({
  trigger: '#launch',
  start: 'top top',
  end: 'bottom bottom',
  onToggle: ({ isActive }) => {
    document.documentElement.classList.toggle('chrome-tucked', isActive);
    gsap.to('.nav', { yPercent: isActive && !prefersReducedMotion ? -100 : 0, opacity: isActive ? 0 : 1, duration: 0.5, ease: 'power2.out', overwrite: 'auto' });
    gsap.to('.dots', { opacity: isActive ? 0 : 1, duration: 0.4, overwrite: 'auto' }); // opacity only: .dots uses transform to centre itself
  },
});

/* --------------------------------------------------------------------------
   2. RENDERER, SCENE, CAMERA
   -------------------------------------------------------------------------- */
// probeGPU() checks for WebGL 2 and reads the GPU name, so the quality tier is final
// before the renderer is created
if (!probeGPU()) {
  showFatal('Your browser does not support WebGL 2, so the 3D car is hidden. The rest of the page still works.');
} else {
  try {
    init();
  } catch (err) {
    // e.g. the GPU is blocklisted or too many WebGL pages are open
    console.error(err);
    showFatal('The 3D view could not start on this device. The rest of the page still works.');
  }
}

function init() {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: quality.settings.antialias,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.debug.checkShaderErrors = import.meta.env.DEV; // the error check stalls on every new shader; keep it for development only
  const resolution = createAdaptiveResolution(renderer); // sets the pixel ratio and adapts it later
  // the canvas box itself (innerWidth includes the scrollbar); the window size is only a fallback
  const view = { w: canvas.clientWidth || window.innerWidth, h: canvas.clientHeight || window.innerHeight };
  renderer.setSize(view.w, view.h, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; // filmic contrast, like a photo
  filmGrain(quality.settings.grain && !prefersReducedMotion);
  const fpsMeter = createFpsMeter();

  const scene = new THREE.Scene();

  // Studio lighting without any image download: RoomEnvironment is a built-in
  // virtual photo studio. PMREM turns it into reflections for shiny materials.
  const room = new RoomEnvironment();
  let envTarget = null;
  // Studio reflections live only on the GPU, so they are rebuilt if the GPU context is lost
  // (driver reset, sleep/resume); otherwise the paint would turn almost black
  function makeEnvironment() {
    const pmrem = new THREE.PMREMGenerator(renderer);
    envTarget?.dispose();
    envTarget = pmrem.fromScene(room, 0.04);
    scene.environment = envTarget.texture;
    pmrem.dispose();
  }
  makeEnvironment();
  canvas.addEventListener('webglcontextrestored', () => {
    makeEnvironment();
    needsRender = true;
  });

  const camera = new THREE.PerspectiveCamera(32, view.w / view.h, 0.1, 100);

  /* ------------------------------------------------------------------------
     GROUND: a dark disc whose edges fade out (alphaMap from a canvas
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

  const fadeTex = new THREE.CanvasTexture(fade);
  const groundMat =
    quality.tier === 'low'
      ? // low tier: flat dark floor, ~10x cheaper per pixel (it can cover the whole screen)
        new THREE.MeshBasicMaterial({ color: 0x08080b, alphaMap: fadeTex, transparent: true, depthWrite: false })
      : new THREE.MeshStandardMaterial({
          color: 0x060608,
          roughness: 0.6,
          metalness: 0,
          envMapIntensity: 0.12, // keep the floor dark; full reflections turn it grey
          alphaMap: fadeTex,
          transparent: true,
          depthWrite: false,
        });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(9, 64), groundMat);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // Glossy floor: a soft real reflection of the car on top of the dark disc (floor.js, high tier only)
  const floor = quality.settings.reflection ? createGlossyFloor(scene) : null;

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
  // Glass needs no physical-only feature, so the standard material looks the same here with a cheaper shader
  const glass = new THREE.MeshStandardMaterial({
    color: 0x111111,
    metalness: 0.2,
    roughness: 0.02,
    transparent: true,
    opacity: 0.75,
  });

  const car = new THREE.Group();
  scene.add(car);
  const wheels = [];
  let tailMat = null; // the tail-light glass (glows when braking)
  let chassis = null; // the body without the wheels (tilts on the suspension)
  const pitch = { x: 0, v: 0 }; // body tilt (radians) and how fast it is tilting
  let lastSpeed = 0;
  let wheelBlur = null; // motion-blur discs on the wheels (medium/high tier)

  // Light glows, headlight beams, brake glow, road and speed streaks (see effects.js)
  const fx = createEffects(scene, {
    streakCount: quality.settings.streaks,
    reducedMotion: prefersReducedMotion,
    brakeSpill: quality.tier !== 'low', // the red floor glow behind the car
  });

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
      (data) => {
        try {
          const binary = atob(data.glb);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          gltfLoader.parse(bytes.buffer, '', onLoad, onError);
        } catch (err) {
          onError(err); // broken file: move on to the next source
        }
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

        // Low tier: hide the barely visible cabin (~1/3 of the triangles) and darken the glass to match
        if (quality.tier === 'low') {
          ['leather', 'interior_light', 'interior_dark', 'carpet', 'steering_wheel'].forEach((n) => {
            const part = model.getObjectByName(n);
            if (part) part.visible = false;
          });
          glass.opacity = 0.92;
        }

        // Brake lights + suspension (cosmetic: if this model lacks these parts, skip it, keep the car)
        try {
          // The red glass material is shared with other red parts: the tail lights get their own copy
          const tailGlass = model.getObjectByName('brakes');
          tailMat = tailGlass.material = tailGlass.material.clone();
          tailMat.emissive.set(0xff1010);
          // Suspension: the body (not the wheels) goes in a group that tilts around the axle height
          chassis = new THREE.Group();
          chassis.position.y = 0.36; // wheel-centre height (the wheel_* nodes sit at y ≈ 0.36)
          model.add(chassis);
          chassis.attach(model.getObjectByName('main')); // attach() keeps the world position
          const steering = model.getObjectByName('steering_wheel'); // optional: some cars keep it inside 'main'
          if (steering) chassis.attach(steering);
        } catch (err) {
          console.warn('Brake/suspension effect skipped:', err);
        }

        // Wheel motion blur discs (not on the low tier: there the spin is only capped)
        if (quality.tier !== 'low') {
          try {
            wheelBlur = createWheelBlur(model);
          } catch (err) {
            console.warn('Wheel blur skipped:', err);
          }
        }

        // Baked contact shadow: a pre-rendered dark smudge under the car (cheaper than real-time shadows)
        textureLoader.load(
          base + 'ferrari_ao.png',
          (aoTexture) => {
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
            // upload the image and compile the shader before adding it, so it never causes a hitch
            renderer.initTexture(aoTexture);
            renderer
              .compileAsync(shadow, camera, scene)
              .catch(() => {})
              .then(() => {
                model.add(shadow);
                needsRender = true;
              });
          },
          undefined,
          () => (needsRender = true) // no shadow image: draw the car anyway
        );

        car.add(model);
        draco.dispose();
        setLoadProgress(100);
        loaderText.textContent = 'Warming up the engine'; // the status screen readers hear (no percentages)
        // WARM-UP behind the loader: compile every shader now (compile() also visits hidden objects
        // like the road, streaks and light glows) and upload their textures, so nothing freezes the
        // first time it appears. Never wait longer than 3 s.
        [...fx.textures, wheelBlur?.texture].filter(Boolean).forEach((t) => renderer.initTexture(t));
        const compiled = Promise.resolve().then(() => renderer.compileAsync(scene, camera)); // a compile error becomes a rejection
        Promise.race([compiled, new Promise((r) => setTimeout(r, 3000))])
          .catch(() => {})
          .then(() => {
            needsRender = true; // first draw (geometry upload) happens behind the loader, during onLoaded's delay
            onLoaded();
          });
      },
      (xhr) => setLoadProgress(Math.min(99, Math.round((xhr.loaded / (xhr.total || MODEL_BYTES)) * 100))),
      () => {
        if (sourceIndex + 1 < MODEL_SOURCES.length) loadModel(sourceIndex + 1);
        else {
          loaderEl.classList.add('is-error'); // hide the counter and line: nothing reached 100%
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
    { theta: 158, phi: 85.5, dist: 9, ty: 0.55, shiftX: 0.2, shiftY: 0.03 }, // launch: low front, road ahead
    { theta: -35, phi: 80, dist: 9, ty: 0.5, shiftX: -0.22, shiftY: 0.0 }, // design: rear 3/4 (text right)
    { theta: -110, phi: 45, dist: 9.5, ty: 0.3, shiftX: 0.2, shiftY: 0.0 }, // colors: from above (text left)
    { theta: -170, phi: 86, dist: 9.5, ty: 0.6, shiftX: -0.24, shiftY: 0.0 }, // specs: low front (text right)
    { theta: -220, phi: 72, dist: 11, ty: 0.4, shiftX: 0.0, shiftY: 0.16 }, // CTA: wide, a full lap from the hero
  ];

  // `shot` is the live camera state. GSAP tweens these numbers; render() reads them.
  const shot = { ...SHOTS[0] };

  gsap.utils.toArray('[data-scene]').forEach((section, i) => {
    if (prefersReducedMotion) {
      // Calm mode: no orbit tied to the scrollbar; the camera simply cuts to each section's shot
      ScrollTrigger.create({
        trigger: section,
        start: 'top 55%',
        end: 'bottom 55%',
        onToggle: ({ isActive }) => isActive && Object.assign(shot, SHOTS[i]),
      });
      return;
    }
    if (i === 0) return;
    gsap.fromTo(shot, { ...SHOTS[i - 1] }, {
      ...SHOTS[i],
      ease: 'power1.inOut',
      immediateRender: false, // don't jump the camera when the tween is created
      scrollTrigger: {
        trigger: section,
        start: 'top bottom', // when this section starts entering the screen...
        end: 'top top', //       ...until it fills the screen
        scrub: true, // follow the (already smoothed) scroll exactly — no extra delay
      },
    });
  });

  // `look` holds the mood of the scene: brightness, light glows, and how far the
  // studio lights have rotated around the car (the moving reflections on the paint)
  const look = {
    exposure: prefersReducedMotion ? 0.9 : 0.1,
    lights: prefersReducedMotion ? 0.9 : 0,
    envSpin: prefersReducedMotion ? 0 : -1.8,
    brake: 0, // tail lights when braking (above 1 = the short flare)
  };
  let pageProgress = 0;
  ScrollTrigger.create({ start: 0, end: 'max', onUpdate: (self) => (pageProgress = self.progress) });

  // Intro: the camera starts further out and swings in after loading
  const intro = { dist: prefersReducedMotion ? 1 : 1.5, theta: prefersReducedMotion ? 0 : -40 };

  /* ------------------------------------------------------------------------
     5. BRAKES — the launch itself (gauge + `launch` speed) is set up at the
     top of this file, under LAUNCH CONTROL, so it works without WebGL too.
     ------------------------------------------------------------------------ */
  // Launch ends -> brakes: the tail lights flare, then glow while the camera swings round to the rear.
  // (overwrite 'auto', not true, so the ignition tweens on `look` are never killed)
  ScrollTrigger.create({
    trigger: '#design',
    start: 'top bottom',
    end: 'top top',
    onEnter: () =>
      gsap.fromTo(
        look,
        { brake: prefersReducedMotion ? 0 : 1.6 }, // calm mode: no flare, the lights just fade on
        { brake: 0.8, duration: 0.6, ease: 'power2.out', overwrite: 'auto' }
      ),
    onLeave: () => gsap.to(look, { brake: 0, duration: 1, overwrite: 'auto' }),
    onEnterBack: () => gsap.to(look, { brake: 0.8, duration: 0.3, overwrite: 'auto' }),
    onLeaveBack: () => gsap.to(look, { brake: 0, duration: 0.3, overwrite: 'auto' }),
  });

  /* ------------------------------------------------------------------------
     6. DRAG TO ROTATE in the colors section (with inertia). Outside that
     section the extra angle eases back to 0 so the scroll shots stay correct.
     ------------------------------------------------------------------------ */
  const drag = { offset: 0, velocity: 0, active: false, lastX: 0, lastMove: 0, enabled: false };
  const dragZone = document.querySelector('.drag-zone');
  dragZone.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || e.button !== 0) return; // left button / first finger only
    drag.active = true;
    drag.lastX = e.clientX;
    drag.lastMove = e.timeStamp;
    dragZone.setPointerCapture(e.pointerId);
  });
  dragZone.addEventListener('pointermove', (e) => {
    if (!drag.active || !e.isPrimary) return; // a second finger must not make the car jump
    const dx = (e.clientX - drag.lastX) * 0.35; // pixels → degrees
    drag.lastX = e.clientX;
    drag.lastMove = e.timeStamp;
    drag.offset -= dx;
    drag.velocity = -dx;
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((type) =>
    dragZone.addEventListener(type, (e) => {
      if (!drag.active) return;
      if (e.timeStamp - drag.lastMove > 80) drag.velocity = 0; // held still before letting go: no flick
      drag.active = false;
    })
  );
  ScrollTrigger.create({
    trigger: '#colors',
    start: 'top 60%',
    end: 'bottom 40%',
    onToggle: ({ isActive }) => (drag.enabled = isActive),
  });

  // Subtle parallax: the camera follows the mouse a little (desktop only)
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  if (!prefersReducedMotion && window.matchMedia('(pointer: fine)').matches) {
    window.addEventListener('pointermove', (e) => {
      pointer.x = e.clientX / view.w - 0.5;
      pointer.y = e.clientY / view.h - 0.5;
    });
  }

  // Wheels spin with scroll speed (Lenis gives us velocity)
  let wheelSpeed = 0;
  lenis?.on('scroll', ({ velocity }) => (wheelSpeed = velocity));

  /* ------------------------------------------------------------------------
     RENDER LOOP — "render on demand": we update everything every frame, but
     only ask the GPU to draw when something visible changed. When you stop
     scrolling the GPU rests, and the adaptive resolution only measures frames
     that were actually drawn.
     ------------------------------------------------------------------------ */
  const target = new THREE.Vector3();
  const spherical = new THREE.Spherical();
  const DEG = Math.PI / 180;
  const state = new Float32Array(20); // numbers that describe the current picture (unused slots stay 0)
  const lastState = new Float32Array(20);
  let needsRender = true;
  let renderedLastFrame = false;
  let lastTime = 0;

  function frame(time) {
    const deltaMs = Math.max(0, time - lastTime); // never negative (extra draws from the resize observer)
    const dt = Math.min(0.05, deltaMs / 1000 || 0.016);
    lastTime = time;
    // Drawn frames measure the GPU; skipped frames teach it the screen's refresh rate
    if (renderedLastFrame) resolution.frame(deltaMs, time);
    else resolution.idle(deltaMs);

    const aspect = view.w / view.h;
    const isPortrait = aspect < 1;

    // Ease pointer parallax and the launch speed towards their targets
    const ease = 1 - Math.exp(-dt * 3); // frame-rate independent smoothing
    pointer.sx += (pointer.x - pointer.sx) * ease;
    pointer.sy += (pointer.y - pointer.sy) * ease;
    if (Math.abs(pointer.x - pointer.sx) < 2e-3) pointer.sx = pointer.x; // close enough: stop the invisible tail
    if (Math.abs(pointer.y - pointer.sy) < 2e-3) pointer.sy = pointer.y;
    const inLaunch = launch.progress > 0 && launch.progress < 1;
    const targetSpeed = inLaunch ? kmhAt(launch.progress) / 330 : 0;
    launch.speed += (targetSpeed - launch.speed) * (1 - Math.exp(-dt * 6));
    if (launch.speed < 0.0005) launch.speed = 0;

    // Drag inertia, then ease back to 0 when you leave the colors section
    if (!drag.active) {
      drag.offset += drag.velocity;
      drag.velocity *= Math.exp(-dt * 4);
      if (Math.abs(drag.velocity) < 0.01) drag.velocity = 0;
      if (!drag.enabled && drag.offset !== 0) {
        drag.offset = ((((drag.offset + 180) % 360) + 360) % 360) - 180; // shortest way back
        drag.offset *= Math.exp(-dt * 5);
        if (Math.abs(drag.offset) < 0.01) drag.offset = 0;
      }
    }

    // On tall phone screens pull the camera back so the whole car fits
    const fit = isPortrait ? 1 + (1 - aspect) * 2.2 : 1;

    // Launch 'dolly zoom' (the Vertigo shot): the lens widens while the camera moves in by exactly
    // the same amount, so the car keeps its size but the road and streaks stretch past it
    const s = launch.speed;
    const fov = prefersReducedMotion ? 32 : 32 + s * 14; // tuning knob: the 14 (try 10 if phones look too wide)
    const dolly = Math.tan(16 * DEG) / Math.tan((fov / 2) * DEG); // 1 when parked, ~0.68 at top speed

    // Suspension: the body squats when the car speeds up and dives when it brakes.
    // A damped spring (stiffness 120, damping 5) overshoots once, then settles.
    const accel = (s - lastSpeed) / dt;
    lastSpeed = s;
    const pitchTarget = prefersReducedMotion ? 0 : THREE.MathUtils.clamp(accel * 0.006, -0.02, 0.012);
    pitch.v += ((pitchTarget - pitch.x) * 120 - pitch.v * 5) * dt;
    pitch.x += pitch.v * dt;
    if (Math.abs(pitch.x) < 1e-4 && Math.abs(pitch.v) < 1e-3) pitch.x = pitch.v = 0; // < 0.01°: stop the invisible tail
    if (chassis) chassis.rotation.x = pitch.x; // + = nose up (the car faces -z)
    if (tailMat) tailMat.emissiveIntensity = look.lights * 0.4 + look.brake * 3;

    target.set(0, shot.ty, 0);
    spherical.set(
      shot.dist * fit * intro.dist * dolly * (1 + pitch.x * 2.5), // the camera dips in a little with the body
      (shot.phi + pointer.sy * 4) * DEG,
      (shot.theta + intro.theta + pointer.sx * 6 + drag.offset) * DEG
    );
    camera.position.setFromSpherical(spherical).add(target);
    camera.lookAt(target);

    // Launch: a little camera shake as the speed climbs (the wider lens is the dolly zoom above)
    if (s > 0 && !prefersReducedMotion) {
      const amp = s * s * 0.03;
      camera.position.x += Math.sin(time * 0.041) * amp;
      camera.position.y += Math.sin(time * 0.057 + 1) * amp * 0.6;
    }
    camera.fov = fov;

    // Phones: text is at the bottom, so push the car up instead of sideways
    const shiftX = isPortrait ? 0 : shot.shiftX;
    const shiftY = isPortrait ? 0.17 : shot.shiftY;
    camera.aspect = aspect;
    camera.setViewOffset(view.w, view.h, -shiftX * view.w, shiftY * view.h, view.w, view.h); // also updates the projection

    // Scene mood: exposure, and studio lights orbiting with page scroll + launch travel
    renderer.toneMappingExposure = look.exposure;
    // (calm mode: the reflections do not sweep with scroll)
    scene.environmentRotation.y = look.envSpin + (prefersReducedMotion ? 0 : pageProgress * Math.PI * 1.5 + fx.travel * 0.015);

    // Wheels: scroll velocity + launch speed. Our 5-spoke rims repeat every 72°, so faster than 36°
    // per drawn frame they would seem to spin BACKWARDS: cap the visible spin at 0.45 rad (26°)
    const spinRate = prefersReducedMotion ? 0 : wheelSpeed * 0.01 + s * 0.9; // radians per 60-fps frame
    const rawSpin = spinRate * dt * 60; // this frame's turn (longer frame = bigger turn)
    const spin = THREE.MathUtils.clamp(rawSpin, -0.45, 0.45);
    // ...and from ~0.2 rad per frame fade in the blurred discs (what a real camera would see).
    // The blur follows the speed, not this frame's length, so it never flickers when frame times wobble
    const blur = THREE.MathUtils.smoothstep(Math.abs(spinRate), 0.2, 0.42);
    wheelBlur?.set(blur);
    if (spin) wheels.forEach((wheel) => (wheel.rotation.x -= spin));
    wheelSpeed *= Math.exp(-dt * 5);
    if (Math.abs(wheelSpeed) < 0.3) wheelSpeed = 0; // < 0.2° of wheel turn per frame: invisible

    const fxAnimating = fx.update(dt, camera, look.lights, s, look.brake);

    // Did anything visible change since the last drawn frame?
    state[0] = camera.position.x;
    state[1] = camera.position.y;
    state[2] = camera.position.z;
    state[3] = camera.fov;
    state[4] = shiftX;
    state[5] = shiftY;
    state[6] = paint.color.r;
    state[7] = paint.color.g;
    state[8] = paint.color.b;
    state[9] = look.exposure;
    state[10] = look.lights;
    state[11] = scene.environmentRotation.y;
    state[12] = view.w;
    state[13] = view.h;
    state[14] = resolution.dpr;
    state[15] = blur;
    state[16] = look.brake;
    state[17] = pitch.x;
    let changed = needsRender || fxAnimating || spin !== 0;
    for (let i = 0; i < state.length && !changed; i++) changed = Math.abs(state[i] - lastState[i]) > 1e-5;

    if (changed) {
      floor?.fit(view.w * resolution.dpr, view.h * resolution.dpr); // reflection texture = half the drawing size
      renderer.render(scene, camera);
      lastState.set(state);
      needsRender = false;
    }
    renderedLastFrame = changed;
    fpsMeter?.({ fps: resolution.fps, dpr: resolution.dpr, rendering: changed });
  }
  renderer.setAnimationLoop(frame);
  if (import.meta.env.DEV) window.__debug = { THREE, camera, shot, intro, look, pitch, car, launch, fx, scene, renderer, resolution, lenis }; // inspect in devtools

  // Watch the canvas box itself: it changes when the window is resized, but not when the
  // scrollbar appears after loading (scrollbar-gutter in style.css) or when a phone's toolbar
  // slides in and out (100lvh in style.css)
  new ResizeObserver(() => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h || (w === view.w && h === view.h)) return;
    view.w = w;
    view.h = h;
    renderer.setSize(w, h, false);
    resolution.reset();
    needsRender = true;
    frame(performance.now()); // draw now: setSize cleared the canvas and this runs after this frame's draw
  }).observe(canvas);

  // A window dragged to a screen with another pixel density keeps its CSS size, so the
  // ResizeObserver stays quiet: watch the density itself and start the resolution over
  (function watchDensity() {
    matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
      'change',
      () => {
        resolution.reset(); // dpr = the cap for the new screen
        needsRender = true;
        watchDensity(); // that query was for the old density: make a new one
      },
      { once: true }
    );
  })();

  /* ------------------------------------------------------------------------
     7. COLOR PICKER: tween the paint color in 3D (the buttons and the CSS
     accent are wired at the top of this file, so they work without WebGL)
     ------------------------------------------------------------------------ */
  onPaint = (hex) => {
    const color = new THREE.Color(hex);
    gsap.to(paint.color, { r: color.r, g: color.g, b: color.b, duration: prefersReducedMotion ? 0 : 0.8, ease: 'power2.out' });
  };

  /* ------------------------------------------------------------------------
     After loading: lift the curtain, then "start the engine" — headlights
     flicker on, the studio lights sweep across the paint, the camera swings in.
     ------------------------------------------------------------------------ */
  let started = false;
  function onLoaded() {
    if (started) return;
    started = true;
    // 450 ms: the counter (already at 100) is seen landing before the curtain lifts
    setTimeout(() => {
      loaderEl.classList.add('is-done');
      document.body.classList.remove('is-loading');
      setBehindLoaderInert(false); // the page can be tabbed to again
      lenis?.start();
      ScrollTrigger.refresh();
      if (prefersReducedMotion) return;
      ignition(0.35); // with this delay the intro starts as the lifting curtain uncovers the title
    }, 450);
  }

  // The engine start: camera swings in, headlights flicker on, studio lights sweep over the paint,
  // and the hero text + interface power on with the headlights (heroMotion in ui.js)
  function ignition(delay) {
    return gsap
      .timeline({ delay })
      .to(intro, { dist: 1, theta: 0, duration: 2.8, ease: 'power3.out' }, 0)
      .to(look, { lights: 1, duration: 0.07, repeat: 4, yoyo: true, ease: 'none' }, 0.25) // ignition flicker
      .to(look, { lights: 0.9, duration: 0.4 }, 0.65)
      .to(look, { exposure: 0.9, duration: 1.9, ease: 'power2.inOut' }, 0.5)
      .to(look, { envSpin: 0, duration: 3, ease: 'power3.out' }, 0.2) // light sweep across the body
      .add(() => hero.restart(), 0.45);
  }

  // Replay (button at the end of the page): engine off — lights out, text gone — then ignition again
  onReplay = () => {
    if (prefersReducedMotion) return; // calm mode: arriving at the top is enough
    gsap
      .timeline()
      .to(look, { lights: 0, exposure: 0.1, duration: 0.35, ease: 'power2.in', overwrite: 'auto' })
      .add(() => hero.pause(0), 0.1) // back to the intro's hidden starting point
      .set(intro, { dist: 1.5, theta: -40 }) // move the camera out while it is dark
      .set(look, { envSpin: -1.8 })
      .add(() => ignition(0.25));
  };
}

/* ==========================================================================
   TEXT ANIMATIONS (the hero intro lives in ui.js → heroMotion)
   ========================================================================== */
if (!prefersReducedMotion) {
  // Reveal on scroll: anything with data-reveal fades/slides up once it enters
  gsap.utils.toArray('[data-reveal]').forEach((el) => {
    const tween = gsap.from(el, {
      y: 40,
      opacity: 0,
      duration: 1,
      ease: 'power3.out',
      scrollTrigger: { trigger: el, start: 'top 88%', once: true },
    });
    el.addEventListener('focusin', () => tween.progress(1), { once: true }); // a focused control must never be invisible
  });
}

// Counting numbers (0 -> 710 etc.)
document.querySelectorAll('[data-count]').forEach((el) => {
  const end = parseFloat(el.dataset.count);
  const decimals = parseInt(el.dataset.decimals || '0', 10);
  el.setAttribute('aria-hidden', 'true');
  el.insertAdjacentHTML('afterend', `<span class="sr-only">${end.toFixed(decimals)}</span>`); // screen readers get the final number
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

// UI colors follow the paint. Only plain hex values go into the CSS variables
// (color-mix() inside a variable breaks older Safari):
//   --accent     the real paint: button, badge and loader fills
//   --accent-hi  thin lines and small marks on black; very dark paints get a lighter tint
//   --accent-ink text on top of --accent, picked from the color that is really painted
function luminance(hex) {
  const c = new THREE.Color(hex); // THREE.Color is linear = WCAG relative luminance
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}
function mixWithWhite(hex, t) {
  const channels = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16);
    return Math.round(v + (255 - v) * t).toString(16).padStart(2, '0');
  });
  return '#' + channels.join('');
}
function setAccent(hex) {
  const lum = luminance(hex);
  const root = document.documentElement.style;
  root.setProperty('--accent', hex);
  root.setProperty('--accent-hi', lum < 0.06 ? mixWithWhite(hex, 0.5) : hex);
  root.setProperty('--accent-ink', lum > 0.19 ? '#111' : '#fff'); // 0.19 = where white and #111 give equal contrast
}

function showFatal(message) {
  loaderEl.classList.add('is-error'); // no "0%" next to the error message
  loaderText.textContent = message;
  setTimeout(() => {
    loaderEl.classList.add('is-done');
    document.body.classList.remove('is-loading');
    setBehindLoaderInert(false);
    lenis?.start();
    ScrollTrigger.refresh(); // the scrollbar just appeared
    hero.play(); // no 3D, but the hero text and the nav still power on
  }, 2500);
}
