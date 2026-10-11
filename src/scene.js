/* ==========================================================================
   APEX MOTORS — the 3D layer (scroll-driven car showcase)

   The 4 ingredients of every "premium 3D website":
     1. A 3D model         -> the Apex GT, built entirely in code (src/car/)
     2. A real-time scene  -> Three.js renderer, studio environment lighting, materials
     3. Scroll animation   -> GSAP ScrollTrigger moves the camera as you scroll,
                              Lenis makes the scrolling smooth (set up in page.js)
     4. Cinematic design   -> dark background, huge type, tinted panels (style.css)

   boot.js loads this file only on devices with a real GPU, after the page has
   loaded. init(page) receives page.js (the 2D layer) and plugs the 3D into it.

   Other files:
     page.js     -> the 2D layer: loader, scrolling, buttons, launch gauge
     quality.js  -> device tiers, adaptive resolution, ?fps meter
     effects.js  -> light glows, headlight beams, road + speed streaks, brake glow, wheel blur
     ui.js       -> hero intro, split-text headlines, progress bar, cursor, magnetic buttons
   ========================================================================== */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { quality, createAdaptiveResolution, createFpsMeter } from './quality.js';
import { createEffects, createWheelBlur, createContactShadow } from './effects.js';
import { createCar } from './car/car.js';
import { filmGrain } from './ui.js';
// floor.js (the glossy reflection) is imported further down, only on the high tier

gsap.registerPlugin(ScrollTrigger);

// Let the browser handle taps and scrolls between the heavy build steps (helps INP on phones)
const yieldToMain = () => new Promise((r) => setTimeout(r, 0));

/* --------------------------------------------------------------------------
   2. RENDERER, SCENE, CAMERA
   boot.js already ran probeGPU(), so the quality tier is final here.
   -------------------------------------------------------------------------- */
export async function init(page) {
  try {
    await build(page);
  } catch (err) {
    // e.g. the GPU is blocklisted or too many WebGL pages are open
    console.error(err);
    page.showFatal('The 3D view could not start on this device. The rest of the page still works.');
  }
}

async function build(page) {
  // The shared state and helpers from the 2D layer (page.js)
  const { launch, hooks, hero, kmhAt, setLoadProgress, loaderText, prefersReducedMotion } = page;
  const canvas = document.getElementById('webgl');

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
  let needsRender = true; // render on demand: set to true whenever the picture must be redrawn

  // Studio lighting without any image download: RoomEnvironment is a built-in
  // virtual photo studio. PMREM turns it into reflections for shiny materials.
  const room = new RoomEnvironment();
  // A glowing panel: in the baked reflections it reads as a studio softbox (costs nothing per frame)
  const softbox = (w, l, power) =>
    new THREE.Mesh(
      new THREE.PlaneGeometry(w, l),
      new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar(power), side: THREE.DoubleSide })
    );
  const top = softbox(1.6, 22, 40);
  top.rotation.x = Math.PI / 2;
  top.position.set(0, 20, 0);
  room.add(top); // one long strip overhead = a clean highlight down the bonnet and roof
  for (const s of [-1, 1]) {
    const side = softbox(22, 0.8, 18); // 22 long (front to back after the turn), 0.8 tall
    side.rotation.y = (s * Math.PI) / 2;
    side.position.set(s * 13, 4, 0); // low enough that the line lands on the shoulder, not the roof edge
    room.add(side); // side strips = a crisp line along each shoulder
  }
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
  setLoadProgress(20);
  await yieldToMain();

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
    !quality.settings.reflection
      ? // no glossy floor (low + medium, so every phone): flat dark floor, ~10x cheaper per pixel (it can cover the whole screen)
        new THREE.MeshBasicMaterial({ color: 0x0a0a0d, alphaMap: fadeTex, transparent: true, depthWrite: false })
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
  // Wheels get their own finish (swapped in by installCar, so the car files stay unchanged)
  const rimMat =
    quality.tier === 'low'
      ? new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 1, roughness: 0.18 }) // weak phones: same look, cheaper shader
      : new THREE.MeshPhysicalMaterial({ color: 0xc9ccd1, metalness: 1, roughness: 0.18, clearcoat: 0.5, clearcoatRoughness: 0.06 }); // machined alloy under lacquer
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.68, metalness: 0 }); // rubber with a soft sheen so the sidewall shape shows
  // Some tyres are open shells (no inner wall) and need both faces drawn, or you see through the wheel
  const tyreMatDS = tyreMat.clone();
  tyreMatDS.side = THREE.DoubleSide;
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

  /* ------------------------------------------------------------------------
     3. THE CAR — built entirely in code (src/car/), so there is nothing to
     download and every part of it belongs to the site owner. createCar()
     returns the parts by name: main (the body group), body, glass, trim,
     lights, brakes and wheel_fl / wheel_fr / wheel_rl / wheel_rr.
     ------------------------------------------------------------------------ */
  let model = null; // the car currently on screen
  let fx = null; // the effects (created below, once the first car's light positions are known)

  // Puts a car (from createCar) on stage and wires it up. Also used by the model switcher.
  function installCar(next) {
    const replacing = !!model; // false for the first car, which is drawn when the render loop starts
    if (replacing) {
      car.remove(model);
      wheelBlur?.dispose(); // the blur discs' shared geometry/material/texture (disposeCar skips them)
      disposeCar(model);
    }
    model = next;
    wheels.length = 0;
    ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].forEach((n) => wheels.push(model.getObjectByName(n)));
    // Alloy rims and rubber tyres (only inside the wheels, so chrome trim on the body stays chrome)
    const replaced = new Set(); // the car's own wheel materials that we swap out
    for (const w of wheels)
      w.traverse((o) => {
        if (!o.isMesh || o.name === 'rim_blur') return;
        const old = o.material;
        if (o.name === 'tyre') o.material = old.side === THREE.DoubleSide ? tyreMatDS : tyreMat; // keep the car's own side setting
        else if (/^rim_/.test(o.name)) o.material = rimMat;
        if (o.material !== old) replaced.add(old);
      });
    // Free the swapped-out materials, unless they are shared or still used somewhere else on the car
    const shared = sharedMaterials();
    model.traverse((o) => o.isMesh && [].concat(o.material).forEach((m) => replaced.delete(m)));
    replaced.forEach((m) => !shared.has(m) && m.dispose());

    // Brake lights: the tail-light lenses get their own material so only they glow when braking
    const tailGlass = model.getObjectByName('brakes');
    tailMat = tailGlass.material = tailGlass.material.clone();
    tailMat.emissive.set(0xff1010);

    // Suspension: the body (not the wheels) sits in a group that tilts around the axle height
    chassis = new THREE.Group();
    chassis.position.y = model.getObjectByName('wheel_fl').position.y;
    model.add(chassis);
    chassis.attach(model.getObjectByName('main')); // attach() keeps the world position

    // Wheel motion blur discs (not on the low tier: there the spin is only capped)
    wheelBlur = quality.tier !== 'low' ? createWheelBlur(model) : null;
    if (wheelBlur) renderer.initTexture(wheelBlur.texture); // upload now, in the dark swap, not mid-launch

    car.add(model);
    fx?.setLights(model.userData.headlights, model.userData.taillights); // glows follow the new lights
    if (replacing) needsRender = true;
  }

  // Frees a removed car's GPU memory (its geometry and its own materials; the shared
  // paint / chrome / glass stay because the next car uses them too)
  const sharedMaterials = () => new Set([paint, chrome, glass, rimMat, tyreMat, tyreMatDS]);
  function disposeCar(old) {
    const shared = sharedMaterials();
    old.traverse((o) => {
      if (!o.isMesh || o.name === 'rim_blur') return; // wheelBlur.dispose() frees those
      o.geometry.dispose();
      for (const m of [].concat(o.material)) {
        if (shared.has(m)) continue;
        Object.values(m).forEach((v) => v?.isTexture && v.dispose());
        m.dispose();
      }
    });
  }

  installCar(createCar({ paint, chrome, glass, tier: quality.tier }));
  setLoadProgress(55);
  await yieldToMain();

  // Soft contact shadow under the car, drawn on a canvas (cheaper than real-time shadows).
  // It belongs to the stage, not to a car, so it stays when the model changes.
  const contactShadow = createContactShadow();
  car.add(contactShadow);

  // Light glows, headlight beams, brake glow, road and speed streaks (see effects.js),
  // placed on this car's head and tail lights
  fx = createEffects(scene, {
    streakCount: quality.settings.streaks,
    reducedMotion: prefersReducedMotion,
    brakeSpill: quality.tier !== 'low', // the red floor glow behind the car
    headlights: model.userData.headlights,
    taillights: model.userData.taillights,
  });
  setLoadProgress(75);
  await yieldToMain();

  // Glossy floor: a soft real reflection of the car on top of the dark disc (high tier only,
  // so floor.js and three's Reflector are only downloaded there)
  // Optional: if floor.js fails to download, the car still shows, just without the reflection
  const floor = quality.settings.reflection
    ? await import('./floor.js')
        .then((m) => m.createGlossyFloor(scene))
        .catch((e) => (console.warn('Glossy floor skipped:', e), null))
    : null;
  setLoadProgress(85);
  await yieldToMain();

  setLoadProgress(100);
  loaderText.textContent = 'Warming up the engine'; // the status screen readers hear (no percentages)
  // WARM-UP behind the loader: compile every shader now (compile() also visits hidden objects
  // like the road, streaks and light glows) and upload their textures, so nothing freezes the
  // first time it appears. Never wait longer than 3 s (1.2 s on low/medium: there the page opens sooner).
  [...fx.textures, wheelBlur?.texture, contactShadow.material.alphaMap].filter(Boolean).forEach((t) => renderer.initTexture(t));
  const compiled = Promise.resolve().then(() => renderer.compileAsync(scene, camera)); // a compile error becomes a rejection
  const compileCap = quality.tier === 'high' ? 3000 : 1200;
  Promise.race([compiled, new Promise((r) => setTimeout(r, compileCap))])
    .catch(() => {})
    .then(() => {
      needsRender = true; // first draw (geometry upload) happens behind the loader, during onLoaded's delay
      onLoaded();
    });

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
     5. BRAKES — the launch itself (gauge + `launch` speed) is set up in
     page.js, under LAUNCH CONTROL, so it works without WebGL too.
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
  // Keyboard alternative to dragging: the arrow buttons turn the car 30°.
  // Minus, like a drag: dragging right lowers the offset, so → spins the car the same way
  document.querySelectorAll('[data-rotate]').forEach((b) =>
    b.addEventListener('click', () => {
      gsap.to(drag, { offset: drag.offset - 30 * b.dataset.rotate, duration: prefersReducedMotion ? 0 : 0.6, ease: 'power3.out' });
    })
  );

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
  page.lenis?.on('scroll', ({ velocity }) => (wheelSpeed = velocity));

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
    // The launch road (opacity = speed * 6 in effects.js) covers the floor: fade the reflection out
    // as the road fades in (so its edges beside the road never pop), then skip its second render pass.
    // Calm mode draws no road, so there the reflection always stays.
    if (floor) {
      const strength = prefersReducedMotion ? 1 : Math.max(0, 1 - s * 6);
      floor.setStrength(strength);
      floor.mirror.visible = strength > 0;
    }
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
      floor?.fit(view.w, view.h); // half the CSS size: the blur hides it, and DPR steps no longer reallocate it
      renderer.render(scene, camera);
      lastState.set(state);
      needsRender = false;
    }
    renderedLastFrame = changed;
    fpsMeter?.({ fps: resolution.fps, dpr: resolution.dpr, rendering: changed });
  }
  renderer.setAnimationLoop(frame);
  if (import.meta.env.DEV) window.__debug = { THREE, camera, shot, intro, look, pitch, car, launch, fx, scene, renderer, resolution, lenis: page.lenis }; // inspect in devtools

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
     accent are wired in page.js, so they work without WebGL)
     ------------------------------------------------------------------------ */
  // Body-style switcher: download the car file first (often already done: page.js prefetches it
  // when the pointer or focus reaches the button), then "lights off → build in the dark → lights on"
  hooks.onModel = async (entry) => {
    const make = await entry.load();
    // build the car and compile its shaders before it is shown (no hitch at the swap)
    const buildNext = async () => {
      const next = make({ paint, chrome, glass, tier: quality.tier });
      await renderer.compileAsync(next, camera, scene).catch(() => {});
      return next;
    };
    if (prefersReducedMotion) return installCar(await buildNext()); // calm mode: a plain swap

    // 1. lights off (onInterrupt too, so a killed tween never leaves the buttons stuck)
    await new Promise((resolve) =>
      gsap.to(look, { exposure: 0.12, lights: 0, duration: 0.35, ease: 'power2.in', overwrite: 'auto', onComplete: resolve, onInterrupt: resolve })
    );
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); // the dark frame reaches the screen first
    // 2. build and swap while the stage is dark (if the build fails, bring the lights back first)
    try {
      installCar(await buildNext());
    } catch (err) {
      gsap.to(look, { exposure: 0.9, lights: 0.9, envSpin: 0, duration: 0.6, overwrite: 'auto' });
      throw err; // page.js still shows "That model could not load"
    }
    // 3. headlights flicker on while the studio lights sweep over the new car
    await new Promise((resolve) =>
      gsap
        .timeline({ onComplete: resolve, onInterrupt: resolve })
        .set(look, { envSpin: -1.4 }, 0)
        .to(look, { envSpin: 0, duration: 1.8, ease: 'power3.out', overwrite: 'auto' }, 0.1) // the light sweep
        .to(look, { lights: 1, duration: 0.07, repeat: 3, yoyo: true, ease: 'none' }, 0.12) // headlight flicker
        .to(look, { lights: 0.9, exposure: 0.9, duration: 0.6, ease: 'power2.out' }, '>')
    );
  };

  hooks.onPaint = (hex) => {
    const color = new THREE.Color(hex);
    // overwrite: a quick second click replaces the first tween instead of fighting it
    gsap.to(paint.color, { r: color.r, g: color.g, b: color.b, duration: prefersReducedMotion ? 0 : 0.8, ease: 'power2.out', overwrite: true });
    // a light pass reveals the new colour
    if (!prefersReducedMotion) gsap.fromTo(look, { envSpin: -0.9 }, { envSpin: 0, duration: 1.4, ease: 'power3.out', overwrite: 'auto' });
  };

  /* ------------------------------------------------------------------------
     After loading: lift the curtain, then "start the engine" — headlights
     flicker on, the studio lights sweep across the paint, the camera swings in.
     ------------------------------------------------------------------------ */
  let started = false;
  function onLoaded() {
    if (started) return;
    started = true;
    // 450 ms (150 ms on low/medium): the counter (already at 100) is seen landing before the curtain lifts
    setTimeout(() => {
      // false = page.js leaves the hero text to the ignition below. It returns false if the page
      // was already opened (boot.js safety timer): then the text has played, so don't replay it
      const fresh = page.openPage(false);
      if (prefersReducedMotion) return;
      ignition(0.35, fresh); // with this delay the intro starts as the lifting curtain uncovers the title
    }, quality.tier === 'high' ? 450 : 150);
  }

  // The engine start: camera swings in, headlights flicker on, studio lights sweep over the paint,
  // and the hero text + interface power on with the headlights (heroMotion in ui.js)
  function ignition(delay, withText = true) {
    const tl = gsap
      .timeline({ delay })
      .to(intro, { dist: 1, theta: 0, duration: 2.8, ease: 'power3.out' }, 0)
      .to(look, { lights: 1, duration: 0.07, repeat: 4, yoyo: true, ease: 'none' }, 0.25) // ignition flicker
      .to(look, { lights: 0.9, duration: 0.4 }, 0.65)
      .to(look, { exposure: 0.9, duration: 1.9, ease: 'power2.inOut' }, 0.5)
      .to(look, { envSpin: 0, duration: 3, ease: 'power3.out' }, 0.2); // light sweep across the body
    if (withText) tl.add(() => hero.restart(), 0.45);
    return tl;
  }

  // Replay (button at the end of the page): engine off — lights out, text gone — then ignition again
  hooks.onReplay = () => {
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
