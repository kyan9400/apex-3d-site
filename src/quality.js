/* ==========================================================================
   QUALITY MANAGER
   Keeps scrolling smooth on every device:
     1. Picks a quality tier (low / medium / high) from the device's hardware.
     2. Watches the real frame time and lowers the 3D resolution when frames
        get slow, then raises it again when there is headroom ("adaptive DPR").
     3. Optional FPS meter: add ?fps to the URL. Force a tier with ?quality=low
   ========================================================================== */

const params = new URLSearchParams(window.location.search);

const TIERS = {
  // dprCap: max pixel ratio · antialias: MSAA edges · streaks: speed lines in the launch scene
  high: { dprCap: 2, antialias: true, streaks: 120, grain: true },
  medium: { dprCap: 1.5, antialias: true, streaks: 70, grain: false },
  low: { dprCap: 1, antialias: false, streaks: 30, grain: false },
};

// Hardware hints the browser gives us. They are rough, so the frame-time
// watcher below is the real safety net.
function guessTier() {
  const forced = params.get('quality');
  if (forced in TIERS) return forced;
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4; // GB, Chrome only
  const saveData = navigator.connection && navigator.connection.saveData;
  const touch = window.matchMedia('(pointer: coarse)').matches;
  if (saveData || cores <= 2 || memory <= 2) return 'low';
  if (touch || cores <= 4 || memory <= 4) return 'medium';
  return 'high';
}

export const quality = {
  tier: guessTier(),
  gpu: '', // GPU name, shown by the ?fps meter
  get settings() {
    return TIERS[this.tier];
  },
};

// Chrome/Edge/Safari answer gl.RENDERER with a generic 'WebKit WebGL'; the real GPU name
// comes from a debug extension. Firefox already puts it in RENDERER (and warns if we ask).
function gpuName(gl) {
  const name = String(gl.getParameter(gl.RENDERER) || '');
  if (!/^webkit/i.test(name)) return name;
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || name) : name;
}

// Once we can read the GPU name, step down for software renderers (no GPU)
// and integrated laptop / phone graphics.
export function refineTierFromGPU(gl) {
  quality.gpu = gpuName(gl);
  if (params.get('quality') in TIERS) return;
  if (/swiftshader|llvmpipe|software|basic render/i.test(quality.gpu)) quality.tier = 'low';
  else if (/intel|uhd|iris|mali|adreno|powervr|radeon\(tm\) graphics/i.test(quality.gpu) && quality.tier === 'high')
    quality.tier = 'medium';
}

// One throwaway WebGL2 context: tells us whether 3D works at all AND which GPU this is,
// so the renderer can be created with the right settings (antialias) from the start.
export function probeGPU() {
  // ask for the same GPU the renderer will use (laptops with two GPUs)
  const gl = document.createElement('canvas').getContext('webgl2', { powerPreference: 'high-performance' });
  if (!gl) return false;
  refineTierFromGPU(gl);
  gl.getExtension('WEBGL_lose_context')?.loseContext(); // free it right away
  return true;
}

/* --------------------------------------------------------------------------
   ADAPTIVE RESOLUTION
   Frame times are compared with the SCREEN's own refresh (learned while
   nothing is drawn), so a 30 Hz battery-saver screen is not mistaken for a
   slow GPU. When drawn frames get clearly slower than the screen we jump
   straight to a pixel ratio that should fit; after 2 s of fast frames we
   step back up. A raise that has to be undone twice stops further raises,
   so the resolution never keeps bouncing (each change reallocates the canvas).
     frame(deltaMs, now) -> after a frame that was drawn
     idle(deltaMs)       -> after a frame that was skipped (render on demand)
   -------------------------------------------------------------------------- */
export function createAdaptiveResolution(renderer) {
  const cap = () => Math.min(window.devicePixelRatio || 1, quality.settings.dprCap);
  const floor = () => Math.min(1, cap()) * 0.75;
  let dpr = cap();
  let avg = 16.7; // smoothed time of DRAWN frames (ms)
  let screenMs = 16.7; // the screen's own frame interval, learned while idle (60 Hz = 16.7, 30 Hz cap = 33.3)
  let settleUntil = 0; // ignore frames right after a change
  let calmSince = 0; // when frames became fast
  let lastRaise = -1e9;
  let bounces = 0; // raises that had to be undone; after 2 we stop raising
  let lastDevicePR = window.devicePixelRatio;
  renderer.setPixelRatio(dpr);

  function apply(value, now) {
    dpr = value;
    renderer.setPixelRatio(dpr);
    settleUntil = now + 600;
    calmSince = 0;
    avg = screenMs; // start measuring the new size fresh
  }

  return {
    get dpr() {
      return dpr;
    },
    get fps() {
      return 1000 / avg;
    },
    // Only start over when the pixel density really changed (zoom, other monitor)
    reset() {
      if (window.devicePixelRatio === lastDevicePR) return;
      lastDevicePR = window.devicePixelRatio;
      bounces = 0;
      dpr = cap();
      renderer.setPixelRatio(dpr);
    },
    // Nothing was drawn, so this interval is the screen's refresh. The minimum ignores
    // hiccups; the 1% drift lets it discover a slower (30 Hz battery-saver) screen.
    idle(deltaMs) {
      if (deltaMs > 4 && deltaMs < 100) screenMs = Math.min(screenMs * 1.01, deltaMs);
    },
    frame(deltaMs, now) {
      if (deltaMs < 4 || deltaMs > 100) return; // extra draw or long pause: ignore
      avg += (deltaMs - avg) * 0.1;
      if (now < settleUntil) return;
      const slowMs = Math.max(21, screenMs * 1.25); // below ~48 fps on a 60 Hz screen
      const fastMs = Math.max(17.5, screenMs * 1.1);
      if (avg > slowMs && dpr > floor()) {
        if (now - lastRaise < 3000) bounces++; // the last raise was too much
        // pixel count grows with dpr squared, so jump straight to the size that should fit
        apply(Math.max(floor(), Math.min(dpr - 0.25, dpr * Math.sqrt(fastMs / avg))), now);
      } else if (avg < fastMs && dpr < cap() && bounces < 2) {
        if (!calmSince) calmSince = now;
        if (now - calmSince > 2000) {
          apply(Math.min(cap(), dpr + 0.25), now);
          lastRaise = now;
        }
      } else calmSince = 0;
    },
  };
}

/* --------------------------------------------------------------------------
   FPS METER (only with ?fps in the URL)
   -------------------------------------------------------------------------- */
export function createFpsMeter() {
  if (!params.has('fps')) return null;
  const el = document.createElement('div');
  el.className = 'fps-meter';
  document.body.appendChild(el);
  let last = 0;
  return (info) => {
    const now = performance.now();
    if (now - last < 500) return;
    last = now;
    el.textContent = `${Math.round(info.fps)} fps · dpr ${info.dpr.toFixed(2)} · ${quality.tier} · ${info.rendering ? 'rendering' : 'idle'} · ${quality.gpu.slice(0, 40)}`;
  };
}
