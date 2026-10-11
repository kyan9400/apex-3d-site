/* ==========================================================================
   APEX MOTORS — the 2D page layer (no three.js in this file)
   Everything that works without the 3D car lives here: the loader, smooth
   scrolling, the hero intro, the configurator buttons, the launch gauge,
   reveals and counters. boot.js loads this first; scene.js (the 3D layer)
   loads later, only on devices with a real GPU, and plugs into `hooks`.
   ========================================================================== */

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { splitHeadings, progressUI, backgroundWord, cursorAndMagnets, heroMotion, reserveDialog } from './ui.js';
import { reducedMotion, motionControls } from './motion.js';
import { MODELS } from './car/models.js';

gsap.registerPlugin(ScrollTrigger);

// Exported so scene.js uses the visitor's motion choice too
export const prefersReducedMotion = reducedMotion;

// The 3D scene fills these in once it is running (until then the buttons only change the 2D UI)
export const hooks = { onModel: null, onPaint: null, onReplay: null };

/* --------------------------------------------------------------------------
   DOM
   -------------------------------------------------------------------------- */
// Exported so the 3D scene can lift the curtain and show its status text when it is ready
export const loaderEl = document.getElementById('loader');
export const loaderText = document.getElementById('loader-text');
const loaderBar = document.getElementById('loader-bar');
const loaderCount = document.getElementById('loader-count');
document.body.classList.add('is-loading');
history.scrollRestoration = 'manual'; // always start at the top so the intro plays
window.scrollTo(0, 0);

// Loader progress: the bar scales (transform = cheap) and the big counter eases to the new value.
// Only the counter changes per download event; the status text (read by screen readers) does not.
// Exported: the 3D scene reports its build steps here.
const loadShown = { pct: 0 };
export function setLoadProgress(pct) {
  loaderBar.style.transform = `scaleX(${pct / 100})`;
  gsap.to(loadShown, {
    pct,
    duration: prefersReducedMotion ? 0 : 0.4,
    ease: 'power2.out',
    overwrite: true, // a new value replaces the running count
    onUpdate: () => (loaderCount.textContent = Math.round(loadShown.pct)),
  });
}

// While the loader covers the page, the chrome behind it can't be tabbed to (inert = not focusable,
// not clickable). <main> stays usable: the hero headline shows above the curtain from the first paint.
const behindLoader = document.querySelectorAll('.skip-link, header, .dots, .motion-toast');
// Exported: the 3D scene unlocks the page when the curtain lifts
export function setBehindLoaderInert(on) {
  behindLoader.forEach((el) => (el.inert = on));
}
setBehindLoaderInert(true);

/* --------------------------------------------------------------------------
   1. SMOOTH SCROLL (Lenis) wired into GSAP's ticker so ScrollTrigger and
      Lenis update on the same frame. `lerp: 0.1` = light smoothing. The
      camera follows Lenis directly (scrub: true in scene.js), so there is only
      ONE layer of smoothing — two layers made an old version feel laggy.
   -------------------------------------------------------------------------- */
// Exported: the 3D scene spins the wheels with Lenis's scroll velocity
export let lenis = null;
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
// Exported: the 3D scene plays the hero intro in sync with the headlights
export const hero = heroMotion(prefersReducedMotion); // hidden states now, played after loading
// The reserve dialog: the page behind it must not scroll while it is open
reserveDialog({ onOpen: () => lenis?.stop(), onClose: () => lenis?.start() });

// Body-style buttons: scene.js plugs the actual car swap into hooks.onModel (returns a promise)
const modelButtons = document.querySelectorAll('.model-btn[data-model]');
const modelNote = document.getElementById('model-note');
const modelGroup = document.querySelector('.models');
let switching = false;
// With a GPU, start downloading a car's file as soon as the pointer or keyboard focus reaches
// its button, so the swap after the click is quicker
const canPrefetch = !document.documentElement.classList.contains('no-webgl');
modelButtons.forEach((btn) => {
  if (canPrefetch) {
    const warm = () => MODELS.find((m) => m.id === btn.dataset.model)?.load().catch(() => {}); // a failed prefetch retries on click
    btn.addEventListener('pointerenter', warm, { once: true });
    btn.addEventListener('focus', warm, { once: true });
  }
  btn.addEventListener('click', async () => {
    if (switching || !hooks.onModel || btn.getAttribute('aria-pressed') === 'true') return;
    const entry = MODELS.find((m) => m.id === btn.dataset.model);
    switching = true;
    // the whole group is busy: every button announces it can't be used until the swap ends
    btn.setAttribute('aria-busy', 'true');
    modelGroup?.setAttribute('aria-busy', 'true');
    modelButtons.forEach((b) => b.setAttribute('aria-disabled', 'true'));
    modelNote.textContent = `Loading ${entry.name}…`; // the polite live region announces the wait
    try {
      await hooks.onModel(entry);
      modelButtons.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      modelNote.textContent = `${entry.name} · ${entry.note}`;
    } catch (err) {
      console.error('Model switch failed:', err);
      modelNote.textContent = 'That model could not load. Please try again.';
    } finally {
      btn.removeAttribute('aria-busy');
      modelGroup?.removeAttribute('aria-busy');
      modelButtons.forEach((b) => b.removeAttribute('aria-disabled'));
      switching = false;
    }
  });
});

// Color picker UI works even without WebGL; scene.js plugs the 3D paint tween into hooks.onPaint
const swatches = document.querySelectorAll('.swatch');
const swatchName = document.getElementById('swatch-name');
swatches.forEach((btn) =>
  btn.addEventListener('click', () => {
    setAccent(btn.dataset.color);
    swatches.forEach((s) => s.setAttribute('aria-pressed', String(s === btn)));
    swatchName.textContent = btn.dataset.name;
    hooks.onPaint?.(btn.dataset.color);
  })
);

// REPLAY THE DRIVE: glide back to the top (the camera rewinds through every shot on the way),
// then scene.js turns the engine off and on again. Without WebGL it just scrolls up.
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
document.getElementById('replay').addEventListener('click', () => {
  const arrived = () => {
    const title = document.querySelector('.hero__title');
    title.setAttribute('tabindex', '-1'); // keyboard users continue from the top too
    title.focus({ preventScroll: true });
    hooks.onReplay?.();
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
   scene (frame() in scene.js) reads `launch` for the road, streaks and lens.
   -------------------------------------------------------------------------- */
// Exported: the 3D scene reads the launch progress and writes the smoothed speed
export const launch = { progress: 0, speed: 0 };
const speedEl = document.getElementById('launch-speed');
const timeEl = document.getElementById('launch-time');
const gaugeWrap = document.getElementById('gauge');
const gaugeEl = document.getElementById('gauge-fill');
const badgeEl = document.getElementById('launch-badge');
const hintEl = document.getElementById('launch-hint');
const GAUGE_LENGTH = 405.3; // length of the 270° arc in the SVG (see style.css)
// Exported: the 3D scene uses the same speed curve. Fast at first, then levels off.
export const kmhAt = (p) => (330 * (1 - Math.exp(-3.2 * p))) / (1 - Math.exp(-3.2));
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
  // sRGB (0..255) → linear light: the WCAG relative-luminance formula
  const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
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

// Opens the page: curtain up, scrolling on, hero text and nav power on.
// Runs only once (a safety timer, the 3D scene and an error can all ask for it).
// playHero = false: the caller (the 3D ignition) plays the hero text itself.
// Returns true if this call opened the page, false if it was already open.
let opened = false;
export function openPage(playHero = true) {
  if (opened) return false;
  opened = true;
  loaderEl.classList.add('is-done');
  document.body.classList.remove('is-loading');
  setBehindLoaderInert(false);
  lenis?.start();
  ScrollTrigger.refresh(); // the scrollbar just appeared
  if (playHero) hero.play();
  return true;
}

// No GPU: show the still poster (style.css .poster) and open the page straight away
export function showPoster() {
  document.documentElement.classList.add('no-webgl'); // hides the body-style switcher, shows the poster
  openPage();
}

// Exported: the 3D scene calls it too when it fails to start
export function showFatal(message) {
  document.documentElement.classList.add('no-webgl'); // hides the body-style switcher
  loaderEl.classList.add('is-error'); // no "0%" next to the error message
  loaderText.textContent = message;
  setTimeout(() => openPage(), 2500); // no 3D, but the hero text and the nav still power on (skipped if already open)
}
