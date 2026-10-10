/* ==========================================================================
   Apex GT — procedural car, variant C: "sculpted coupe with a closed roof"

   Everything here is made in code: no model files, no image files.

   How the painted body is made (the interesting part):
   1. FEATURE LINES. A few smooth curves along the car's length (z) describe
      the design: centre-line height, belt line, canopy width, fender crown,
      shoulder width ... They are natural cubic splines through key values,
      like the flexible battens car designers used on full-size drawings.
   2. SECTIONS. At any z those values give 11 target points of half a
      cross-section (centre line -> roof -> glass -> shoulder -> sill). A
      smooth spline through the mirrored targets gives the whole section.
   3. SURFACE. Sweeping that section along z gives ONE smooth surface
      S(z, v) that holds the hood, canopy, shoulders and haunches, so they
      flow into each other. Small "sculpt" fields push it in or out
      (side scoops, broad arch flares, ducktail), all with curvature-continuous
      falloffs so the reflections stay unbroken.
   4. TRIMMING. Wheel arches, windows, intakes, louvres, nose and tail are
      cut out of that surface with signed functions (>= 0 keeps the
      surface), like cutting shapes out of a sheet. The glass uses the same
      surface with the opposite sign, so it fits its opening exactly.

   The car faces -z, the ground is y = 0, x = 0 is the centre line.
   Most parts are built for the right half (x >= 0) and mirrored.
   ========================================================================== */

import * as THREE from 'three';

/* --------------------------------------------------------------------------
   0. SMALL MATH HELPERS
   -------------------------------------------------------------------------- */
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;

// Smooth 0 -> 1 ramp while x goes from e0 to e1 (e0 > e1 gives a falling ramp)
function smooth(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Quintic version ("smootherstep"): the curvature also fades to zero at both ends,
// so sculpted areas blend in without kinks in the reflections
function smoother(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * t * (t * (6 * t - 15) + 10);
}

// Broad bump: 1 at d = 0, falling smoothly to 0 at |d| = r (and staying flat there)
function bump(d, r) {
  const t = d / r;
  if (t * t >= 1) return 0;
  const s = 1 - t * t;
  return s * s * s;
}

// Math.min with a rounded corner of size k (no crease where the two meet)
function smin(a, b, k) {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return lerp(b, a, h) - k * h * (1 - h);
}

// Signed distance to a rounded rectangle centred on 0 (negative inside)
function roundRect(x, y, hx, hy, r) {
  const qx = Math.abs(x) - hx + r;
  const qy = Math.abs(y) - hy + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// Natural cubic spline: fills m with the second derivatives at the knots t
// (zero at both ends = "natural"). One small tridiagonal solve.
function solveSpline(t, y, m, c, d) {
  const n = t.length;
  m[0] = m[n - 1] = 0;
  c[0] = d[0] = 0;
  for (let i = 1; i < n - 1; i++) {
    const h0 = t[i] - t[i - 1];
    const h1 = t[i + 1] - t[i];
    const r = 6 * ((y[i + 1] - y[i]) / h1 - (y[i] - y[i - 1]) / h0);
    const w = 2 * (h0 + h1) - h0 * c[i - 1];
    c[i] = h1 / w;
    d[i] = (r - h0 * d[i - 1]) / w;
  }
  for (let i = n - 2; i > 0; i--) m[i] = d[i] - c[i] * m[i + 1];
}

// Index of the knot interval that holds s (clamped to the first / last interval)
function interval(t, s) {
  let lo = 0;
  let hi = t.length - 1;
  if (s <= t[0]) return 0;
  if (s >= t[hi]) return hi - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] > s) hi = mid;
    else lo = mid;
  }
  return lo;
}

// Value of the spline (t, y, m) at s, inside interval lo
function splineValue(t, y, m, s, lo) {
  const h = t[lo + 1] - t[lo];
  const a = (t[lo + 1] - s) / h;
  const b = 1 - a;
  return a * y[lo] + b * y[lo + 1] + (((a * a * a - a) * m[lo] + (b * b * b - b) * m[lo + 1]) * h * h) / 6;
}

// A 1D natural spline through [x, y] keys, as a function (straight lines past the ends)
function spline(keys) {
  const n = keys.length;
  const t = Float64Array.from(keys, (k) => k[0]);
  const y = Float64Array.from(keys, (k) => k[1]);
  const m = new Float64Array(n);
  solveSpline(t, y, m, new Float64Array(n), new Float64Array(n));
  const slope0 = (y[1] - y[0]) / (t[1] - t[0]) - ((t[1] - t[0]) * (2 * m[0] + m[1])) / 6;
  const slopeN = (y[n - 1] - y[n - 2]) / (t[n - 1] - t[n - 2]) + ((t[n - 1] - t[n - 2]) * (m[n - 2] + 2 * m[n - 1])) / 6;
  return (x) => {
    if (x <= t[0]) return y[0] + slope0 * (x - t[0]);
    if (x >= t[n - 1]) return y[n - 1] + slopeN * (x - t[n - 1]);
    return splineValue(t, y, m, x, interval(t, x));
  };
}

/* --------------------------------------------------------------------------
   1. DIMENSIONS (shared with the rest of the site, see CONTRACT.md)
   -------------------------------------------------------------------------- */
const TRACK = 0.83; // wheel centre x
const AXLE_Y = 0.36; // wheel centre height
const FRONT_Z = -1.16;
const REAR_Z = 1.5;
const RIM_R = 0.28;
const RIM_OFFSET = 0.095; // spoke face, measured out from the wheel centre
const ARCH_R = 0.41; // wheel-arch opening radius
const ARCH_Y = 0.37; // arch centre height (a hair above the axle)
const ARCH_X = 0.66; // arches only cut the body outboard of this (the tyre starts at 0.695)
const SILL = 0.135; // lowest edge of the painted body
const FLOOR_Y = 0.11; // flat underside

/* --------------------------------------------------------------------------
   2. FEATURE LINES — the design, as smooth curves along z
   (heights y and half-widths x in metres; the car faces -z)
   -------------------------------------------------------------------------- */
const F = {
  // centre-line height: nose -> hood -> windscreen -> roof -> fastback -> ducktail
  top: spline([
    [-2.45, 0.37], [-2.27, 0.43], [-2.0, 0.545], [-1.7, 0.615], [-1.4, 0.658], [-1.16, 0.682], [-0.95, 0.703],
    [-0.7, 0.8], [-0.45, 0.93], [-0.2, 1.045], [0.05, 1.118], [0.3, 1.145], [0.6, 1.13], [0.9, 1.085],
    [1.2, 1.03], [1.5, 0.985], [1.8, 0.955], [2.05, 0.948], [2.2, 0.958], [2.35, 0.97],
  ]),
  // belt line: the foot of the canopy (window sill height)
  belt: spline([[-1.6, 0.66], [-1.0, 0.7], [-0.85, 0.73], [-0.5, 0.79], [0, 0.825], [0.5, 0.86], [1.0, 0.885], [1.5, 0.9], [2.0, 0.92], [2.4, 0.95]]),
  // half-width of the central crown: hood -> canopy -> engine cover (a teardrop in plan view)
  cw: spline([[-2.4, 0.3], [-2.0, 0.42], [-1.5, 0.48], [-1.16, 0.5], [-0.9, 0.55], [-0.6, 0.6], [-0.3, 0.61], [0.1, 0.59], [0.5, 0.545], [0.9, 0.47], [1.3, 0.39], [1.7, 0.34], [2.1, 0.32], [2.4, 0.32]]),
  // channel between the crown and the fenders (x, y)
  vx: spline([[-2.4, 0.42], [-2.0, 0.5], [-1.16, 0.575], [-0.7, 0.655], [-0.2, 0.7], [0.3, 0.7], [0.8, 0.64], [1.2, 0.56], [1.6, 0.52], [2.1, 0.5], [2.4, 0.49]]),
  vy: spline([[-2.4, 0.4], [-2.0, 0.545], [-1.5, 0.665], [-1.16, 0.71], [-0.8, 0.745], [-0.4, 0.795], [0, 0.815], [0.5, 0.835], [1.0, 0.85], [1.5, 0.858], [2.0, 0.88], [2.4, 0.92]]),
  // fender crown (x, y): front wings, door shoulder, rear haunches
  fx: spline([[-2.4, 0.62], [-2.1, 0.67], [-1.7, 0.75], [-1.16, 0.795], [-0.7, 0.81], [-0.2, 0.82], [0.4, 0.82], [0.9, 0.8], [1.5, 0.8], [2.0, 0.79], [2.4, 0.76]]),
  fy: spline([[-2.4, 0.38], [-2.2, 0.47], [-1.95, 0.62], [-1.6, 0.8], [-1.2, 0.875], [-0.85, 0.86], [-0.45, 0.82], [0, 0.805], [0.45, 0.84], [0.9, 0.935], [1.3, 0.99], [1.6, 1.0], [1.95, 0.985], [2.2, 0.975], [2.4, 0.98]]),
  // widest point of the body side (half-width) and its height
  sw: spline([[-2.4, 0.7], [-2.2, 0.8], [-2.0, 0.89], [-1.75, 0.95], [-1.16, 0.985], [-0.7, 0.975], [-0.2, 0.935], [0.3, 0.93], [0.75, 0.96], [1.15, 1.0], [1.5, 1.015], [1.9, 1.005], [2.15, 0.98], [2.4, 0.95]]),
  sy: spline([[-2.4, 0.4], [-2.0, 0.47], [-1.16, 0.55], [-0.5, 0.58], [0.3, 0.6], [1.0, 0.66], [1.5, 0.69], [2.0, 0.69], [2.4, 0.68]]),
};

/* --------------------------------------------------------------------------
   3. SECTIONS AND THE BODY SURFACE S(z, v)
   v = 0 on the centre line, v = 1 under the right sill (v ~ fraction of the
   girth). w = which target point we are at (0 = centre, 3 = foot of the
   glass, 5 = fender crown, 7 = widest point ...) — handy for drawing windows.
   -------------------------------------------------------------------------- */
const NT = 11; // target points in half a section
const NK = 2 * NT - 1; // knots of the mirrored section
// Sections of the body grid's rows (evenly spaced in z), built once per car. Between two
// rows a section is blended from its neighbours instead of being rebuilt: the feature
// lines barely bend over ~3 cm, so this is accurate to a fraction of a millimetre, and it
// makes the many off-row look-ups (cut edges, part placement) cheap.
let rows = null; // { z0, dz, secs }
// the last few off-grid sections (a tiny ring cache; arrays are reused, so no garbage).
// Several slots, because a point + normal look-up alternates between z - eps, z and z + eps.
const memo = Array.from({ length: 4 }, () => ({ z: NaN, sec: null }));
let memoNext = 0;
const newSection = () => ({ t: new Float64Array(NK), x: new Float64Array(NK), y: new Float64Array(NK), mx: new Float64Array(NK), my: new Float64Array(NK), len: 0 });
const scratchC = new Float64Array(NK);
const scratchD = new Float64Array(NK);

// The 11 targets (x, y) of the right half-section at length position z
function sectionTargets(z) {
  const top = F.top(z);
  const belt = smin(top - 0.004, F.belt(z), 0.05); // the canopy never dips below the hood
  const h = Math.max(0, top - belt); // canopy height above the belt (0 on the hood)
  const cw = F.cw(z);
  const fx = F.fx(z);
  const fy = F.fy(z);
  const sw = F.sw(z);
  const sy = F.sy(z);
  const T = targetsOut;
  T[0] = 0; T[1] = top; // T0 centre line
  T[2] = 0.5 * cw; T[3] = top - 0.012 - 0.05 * h; // T1 roof / hood camber
  T[4] = 0.9 * cw; T[5] = top - 0.03 - 0.17 * h; // T2 roof edge
  T[6] = 1.04 * cw; T[7] = top - 0.035 - 0.72 * h; // T3 foot of the side glass (tumblehome)
  T[8] = F.vx(z); T[9] = F.vy(z); // T4 channel between canopy and fender
  T[10] = fx; T[11] = fy; // T5 fender crown
  T[12] = lerp(fx, sw, 0.72); T[13] = lerp(fy, sy, 0.45); // T6 shoulder roll
  T[14] = sw; T[15] = sy; // T7 widest point
  T[16] = sw - 0.012; T[17] = lerp(sy, SILL, 0.55); // T8 lower side, tucked in
  T[18] = sw - 0.055; T[19] = SILL + 0.028; // T9 sill
  T[20] = sw - 0.17; T[21] = SILL; // T10 under the sill
  return T;
}
const targetsOut = new Float64Array(2 * NT);

// A section: natural spline through the mirrored targets, parametrised by chord length
// (`into` lets us reuse an old section's arrays instead of allocating new ones)
const chord = new Float64Array(NT);
function buildSection(z, into) {
  const T = sectionTargets(z);
  const S = chord; // chord length from the centre line to each target
  S[0] = 0;
  for (let j = 1; j < NT; j++) {
    const dx = T[2 * j] - T[2 * j - 2];
    const dy = T[2 * j + 1] - T[2 * j - 1];
    S[j] = S[j - 1] + Math.max(1e-4, Math.sqrt(dx * dx + dy * dy));
  }
  const s = into || newSection();
  s.len = S[NT - 1];
  for (let k = 0; k < NK; k++) {
    const j = k - (NT - 1);
    const a = j < 0 ? -j : j;
    const sign = j < 0 ? -1 : 1;
    s.t[k] = sign * S[a];
    s.x[k] = sign * T[2 * a];
    s.y[k] = T[2 * a + 1];
  }
  solveSpline(s.t, s.x, s.mx, scratchC, scratchD);
  solveSpline(s.t, s.y, s.my, scratchC, scratchD);
  return s;
}

function blendSections(a, b, f, into) {
  const s = into || newSection();
  for (let k = 0; k < NK; k++) {
    s.t[k] = lerp(a.t[k], b.t[k], f);
    s.x[k] = lerp(a.x[k], b.x[k], f);
    s.y[k] = lerp(a.y[k], b.y[k], f);
    s.mx[k] = lerp(a.mx[k], b.mx[k], f);
    s.my[k] = lerp(a.my[k], b.my[k], f);
  }
  s.len = lerp(a.len, b.len, f);
  return s;
}

function sectionAt(z) {
  let f = -1;
  if (rows) {
    f = (z - rows.z0) / rows.dz;
    const i = Math.round(f);
    if (Math.abs(f - i) < 1e-7 && i >= 0 && i < rows.secs.length) return rows.secs[i];
  }
  for (let k = 0; k < memo.length; k++) if (memo[k].z === z) return memo[k].sec;
  const m = memo[memoNext];
  memoNext = (memoNext + 1) % memo.length;
  m.z = z;
  if (f > 0 && f < rows.secs.length - 1) {
    const i = Math.floor(f);
    m.sec = blendSections(rows.secs[i], rows.secs[i + 1], f - i, m.sec);
  } else m.sec = buildSection(z, m.sec);
  return m.sec;
}

// Point (x, y) and target index w on a section at girth fraction v
function sectionPoint(sec, v, out) {
  const s = v * sec.len;
  const lo = interval(sec.t, s);
  out.x = splineValue(sec.t, sec.x, sec.mx, s, lo);
  out.y = splineValue(sec.t, sec.y, sec.my, s, lo);
  out.w = lo - (NT - 1) + (s - sec.t[lo]) / (sec.t[lo + 1] - sec.t[lo]);
}

// Sculpt fields: local pushes that a section alone cannot describe.
// All of them use the quintic ramp and broad bumps, so the surface stays smooth
// enough (curvature-continuous) for long, unbroken clearcoat reflections.
const ARCH_FLARE = 0.016; // how far the paint swells out around each wheel opening
const ARCH_FLARE_R = 0.24; // ... and how far that swell reaches
function sculpt(P) {
  const y = P.y;
  const z = P.z;
  // ducktail: the last few centimetres of the deck kick up
  if (z > 2.0) P.y += 0.022 * smoother(2.0, 2.26, z) * smoother(0.55, 0.75, y);
  const side = smoother(0.6, 0.8, P.x); // the rest only touches the body sides
  if (side === 0) return;
  // side scoop: the door's rear half sweeps inward toward the intake ahead of the rear wheel
  if (z > -0.1 && z < 1.16 && y > 0.24 && y < 0.76) {
    P.x -= 0.08 * smoother(-0.1, 0.8, z) * smoother(1.16, 0.89, z) * smoother(0.24, 0.42, y) * smoother(0.76, 0.6, y) * side;
  }
  // arch flares: a broad, soft swell around each wheel opening
  const zc = z < 0.17 ? FRONT_Z : REAR_Z;
  const dy = y - ARCH_Y;
  const dz = z - zc;
  const d = Math.sqrt(dy * dy + dz * dz) - ARCH_R - 0.03;
  if (d < ARCH_FLARE_R) P.x += ARCH_FLARE * bump(d, ARCH_FLARE_R) * side;
}

// The body surface S(z, v). Between two grid rows the point is interpolated from the
// same v on both rows (cheap, and the same everywhere, so body and glass still match).
const rowA = { x: 0, y: 0, w: 0 };
const rowB = { x: 0, y: 0, w: 0 };
function bodyPoint(z, v, out) {
  const f = rows ? (z - rows.z0) / rows.dz : -1;
  const i = Math.floor(f);
  const u = f - i;
  if (i >= 0 && i < rows.secs.length - 1 && u > 1e-7 && u < 1 - 1e-7) {
    sectionPoint(rows.secs[i], v, rowA);
    sectionPoint(rows.secs[i + 1], v, rowB);
    out.x = lerp(rowA.x, rowB.x, u);
    out.y = lerp(rowA.y, rowB.y, u);
    out.w = lerp(rowA.w, rowB.w, u);
  } else sectionPoint(sectionAt(z), v, out);
  out.z = z;
  sculpt(out);
  return out;
}

// Point + unit normal (central differences, so sculpts are included exactly).
// Used for parts placed on the body; the big grids get their normals from neighbours.
const EPS = 1e-4;
const dA = new THREE.Vector3();
const dB = new THREE.Vector3();
const dZ = new THREE.Vector3();
const dV = new THREE.Vector3();
function bodyPN(z, v, P, Nn) {
  bodyPoint(z + EPS, v, dA);
  bodyPoint(z - EPS, v, dB);
  dZ.subVectors(dA, dB);
  bodyPoint(z, v + EPS, dA);
  bodyPoint(z, v - EPS, dB);
  dV.subVectors(dA, dB);
  Nn.crossVectors(dZ, dV).normalize(); // outward: (along z) x (down the section)
  bodyPoint(z, v, P);
}

// Inverse look-ups on the body (bisection; used to place parts on the surface)
const tmpP = new THREE.Vector3();
function solveV(z, lo, hi, f) {
  // f(P) changes sign between v = lo and v = hi (Illinois method: a few steps suffice)
  let flo = f(bodyPoint(z, lo, tmpP));
  let fhi = f(bodyPoint(z, hi, tmpP));
  if (flo * fhi > 0) return hi; // no crossing: stay at the end
  let v = lo;
  let side = 0;
  for (let i = 0; i < 30; i++) {
    v = flo === fhi ? 0.5 * (lo + hi) : clamp((lo * fhi - hi * flo) / (fhi - flo), lo, hi);
    const fv = f(bodyPoint(z, v, tmpP));
    if (Math.abs(fv) < 1e-7 || hi - lo < 1e-7) break;
    if (fv * fhi > 0) {
      hi = v;
      fhi = fv;
      if (side === -1) flo *= 0.5;
      side = -1;
    } else {
      lo = v;
      flo = fv;
      if (side === 1) fhi *= 0.5;
      side = 1;
    }
  }
  return v;
}
const crownV = (z) => {
  const s = sectionAt(z);
  return s.t[NT - 1 + 5] / s.len;
};
// v where the top surface reaches half-width x (centre line .. fender crown)
const topV = (z, x) => solveV(z, 0, crownV(z), (P) => P.x - x);
// v where the body side passes height y (fender crown .. sill)
const sideV = (z, y) => solveV(z, crownV(z), 0.97, (P) => P.y - y);
// v at target index w (e.g. w = 5 is the fender crown)
function vAtW(z, w) {
  const s = sectionAt(z);
  const k = Math.floor(w) + NT - 1;
  return lerp(s.t[k], s.t[k + 1], w - Math.floor(w)) / s.len;
}

/* --------------------------------------------------------------------------
   4. TRIM FUNCTIONS (>= 0 keeps the surface; evaluated on the right half)
   -------------------------------------------------------------------------- */
// Nose: rounded in plan view, the lower part steps back under the leading edge
const frontCutZ = (x, y) => -2.27 + 0.33 * Math.pow(Math.abs(x) / 0.95, 2.4) + 0.07 * smooth(0.42, 0.16, y);
// Tail: ducktail edge on top, rear face leaning in toward the diffuser
const rearCutZ = (x, y) => 2.25 - 0.2 * Math.pow(Math.abs(x), 2.6) - 0.05 * smooth(0.75, 0.25, y);
// Wheel arch: a cylinder around the axle that only cuts the sides
const archKeep = (P, zc) => Math.max(Math.hypot(P.y - ARCH_Y, P.z - zc) - ARCH_R, ARCH_X - P.x);

// Glass areas in surface coordinates (z, w); positive inside the glass
const wRail = (z) => 1.7 + 1.35 * smooth(-0.35, -0.86, z); // roof rail, sweeping out to the windscreen corners
function topGlass(z, w) {
  const cowl = -0.9 + 0.1 * (w / 3) * (w / 3); // windscreen base, curving back at the corners
  const tail = 0.42 + 0.12 * Math.sqrt(Math.max(0, 1 - (w / 1.75) * (w / 1.75))); // rounded rear end
  return Math.min((wRail(z) - w) * 0.25, z - cowl, tail - z);
}
function sideGlass(z, w) {
  const bottom = 3.1 - 1.05 * smooth(0, 0.62, z); // the sill line rises into a teardrop tip
  return Math.min((w - wRail(z) - 0.27) * 0.25, (w - 1.95) * 0.25, (bottom - w) * 0.25, 0.66 - z);
}
// Side intake ahead of the rear wheel (negative inside the opening)
const INTAKE = { z: 0.84, y: 0.5, hz: 0.15, hy: 0.155, r: 0.07, lean: 0.3 };
const intakeShape = (z, y) => roundRect(z - INTAKE.lean * (y - INTAKE.y) - INTAKE.z, y - INTAKE.y, INTAKE.hz, INTAKE.hy, INTAKE.r);
const intakeSDF = (P) => Math.max(intakeShape(P.z, P.y), 0.62 - P.x);
// Louvre panel on the engine cover (negative inside), in plan view
const LOUVRE = { z: 1.27, hz: 0.42, hx: 0.24, r: 0.07 };
const louvreSDF = (P) => Math.max(roundRect(P.z - LOUVRE.z, P.x, LOUVRE.hz, LOUVRE.hx, LOUVRE.r), 0.8 - P.y);

// Each cut is only evaluated in the stretch of z where it can go negative
// (outside it the term is clearly positive, so skipping it changes nothing).
function bodyKeep(z, v, P) {
  let k = archKeep(P, z < 0.17 ? FRONT_Z : REAR_Z);
  if (z < -1.6) k = Math.min(k, P.z - frontCutZ(P.x, P.y));
  if (z > 1.75) k = Math.min(k, rearCutZ(P.x, P.y) - P.z);
  if (z > -0.95 && z < 0.72) k = Math.min(k, -topGlass(z, P.w), -sideGlass(z, P.w));
  if (z > 0.55 && z < 1.15) k = Math.min(k, intakeSDF(P));
  if (z > 0.8 && z < 1.75) k = Math.min(k, louvreSDF(P));
  return k;
}

/* --------------------------------------------------------------------------
   5. GEOMETRY BUILDERS
   -------------------------------------------------------------------------- */

// Evaluate a parametric surface on a grid once (shared by every patch cut from it).
// Normals come from the neighbouring grid points (central differences), so no
// extra surface evaluations are needed. `mirrorA0` / `mirrorB0` say that the
// first row / column lies on the centre line x = 0 (its neighbour is the mirror).
// `sign` flips the normals when the (a, b) directions give an inward normal.
// `fill(grid)` may fill grid.P / grid.W itself (a faster special case); otherwise evalP is used.
function surfaceGrid(as, bs, evalP, { sign = 1, mirrorA0 = false, mirrorB0 = false, fill = null } = {}) {
  const na = as.length;
  const nb = bs.length;
  const n = na * nb;
  const P = new THREE.Vector3();
  const grid = { as, bs, evalP, P: new Float64Array(n * 3), N: new Float64Array(n * 3), W: new Float64Array(n) };
  const G = grid.P;
  if (fill) fill(grid);
  else {
    for (let i = 0; i < na; i++) {
      for (let j = 0; j < nb; j++) {
        const g = i * nb + j;
        P.w = 0;
        evalP(as[i], bs[j], P);
        G[3 * g] = P.x;
        G[3 * g + 1] = P.y;
        G[3 * g + 2] = P.z;
        grid.W[g] = P.w;
      }
    }
  }
  // neighbour differences: (next - previous) along a and along b
  const diff = (g1, g0, out, mirror) => {
    out[0] = G[3 * g1] - (mirror ? -G[3 * g1] : G[3 * g0]);
    out[1] = G[3 * g1 + 1] - (mirror ? G[3 * g1 + 1] : G[3 * g0 + 1]);
    out[2] = G[3 * g1 + 2] - (mirror ? G[3 * g1 + 2] : G[3 * g0 + 2]);
  };
  const da = [0, 0, 0];
  const db = [0, 0, 0];
  for (let i = 0; i < na; i++) {
    for (let j = 0; j < nb; j++) {
      const g = i * nb + j;
      if (i === 0) diff(g + nb, mirrorA0 ? g + nb : g, da, mirrorA0);
      else diff(i === na - 1 ? g : g + nb, g - nb, da, false);
      if (j === 0) diff(g + 1, mirrorB0 ? g + 1 : g, db, mirrorB0);
      else diff(j === nb - 1 ? g : g + 1, g - 1, db, false);
      let x = da[1] * db[2] - da[2] * db[1];
      let y = da[2] * db[0] - da[0] * db[2];
      let z = da[0] * db[1] - da[1] * db[0];
      const l = sign / (Math.sqrt(x * x + y * y + z * z) || 1);
      grid.N[3 * g] = x * l;
      grid.N[3 * g + 1] = y * l;
      grid.N[3 * g + 2] = z * l;
    }
  }
  return grid;
}

// A trimmed patch of a surface grid. Each grid triangle is kept, dropped, or
// clipped along keep() = 0 (marching triangles); cut points are found on the
// true surface by root finding, so the cut edges are clean.
//   keep(a, b, P) -> number (>= 0 keeps)   cells: [i0, i1, j0, j1] sub-range
//   offset: push along the normal          uv(a, b, P) -> [u, v] (optional)
//   mirror: also write the mirror image across x = 0 (each vertex is followed by its
//           mirrored twin), so big patches need no separate mirroring pass
function trimmedPatch(grid, { keep, cells, offset = 0, uv = null, mirror = false }) {
  const { as, bs, evalP } = grid;
  const nb = bs.length;
  const [i0, i1, j0, j1] = cells || [0, as.length - 1, 0, nb - 1];
  const P = new THREE.Vector3();
  const span = j1 - j0 + 1;
  // output buffers (typed, grown when needed)
  const M = mirror ? 2 : 1; // output vertices per patch vertex
  let vcap = M * Math.max(256, Math.ceil((i1 - i0 + 1) * span * 1.25));
  let pos = new Float32Array(vcap * 3);
  let nor = new Float32Array(vcap * 3);
  let uvs = uv ? new Float32Array(vcap * 2) : null;
  let nv = 0;
  let icap = vcap * 6;
  let idx = new Uint32Array(icap);
  let ni = 0;
  const growV = () => {
    vcap *= 2; // (counted in output vertices)
    const p2 = new Float32Array(vcap * 3);
    p2.set(pos);
    pos = p2;
    const n2 = new Float32Array(vcap * 3);
    n2.set(nor);
    nor = n2;
    if (uvs) {
      const u2 = new Float32Array(vcap * 2);
      u2.set(uvs);
      uvs = u2;
    }
  };
  const addTri = (a, b, c) => {
    if (ni + 6 > icap) {
      icap *= 2;
      const i2 = new Uint32Array(icap);
      i2.set(idx);
      idx = i2;
    }
    if (mirror) {
      idx[ni++] = 2 * a;
      idx[ni++] = 2 * b;
      idx[ni++] = 2 * c;
      idx[ni++] = 2 * a + 1; // the mirror image, wound the other way
      idx[ni++] = 2 * c + 1;
      idx[ni++] = 2 * b + 1;
    } else {
      idx[ni++] = a;
      idx[ni++] = b;
      idx[ni++] = c;
    }
  };
  // write output vertex k (and its mirrored twin)
  const put = (k, x, y, z, nx, ny, nz, u, v) => {
    const o = M * k;
    pos[3 * o] = x;
    pos[3 * o + 1] = y;
    pos[3 * o + 2] = z;
    nor[3 * o] = nx;
    nor[3 * o + 1] = ny;
    nor[3 * o + 2] = nz;
    if (uvs) {
      uvs[2 * o] = u;
      uvs[2 * o + 1] = v;
    }
    if (mirror) {
      pos[3 * o + 3] = -x;
      pos[3 * o + 4] = y;
      pos[3 * o + 5] = z;
      nor[3 * o + 3] = -nx;
      nor[3 * o + 4] = ny;
      nor[3 * o + 5] = nz;
      if (uvs) {
        uvs[2 * o + 2] = u;
        uvs[2 * o + 3] = v;
      }
    }
  };
  // position / normal of patch vertex k (the right-side copy)
  const px = (k) => pos[3 * M * k];
  const py = (k) => pos[3 * M * k + 1];
  const pz = (k) => pos[3 * M * k + 2];
  // keep() value of every grid point in the range (one pass), and each point's vertex id
  const fVal = new Float64Array((i1 - i0 + 1) * span);
  const vId = new Int32Array((i1 - i0 + 1) * span).fill(-1);
  const GP = grid.P;
  const GN = grid.N;
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const g = i * nb + j;
      P.x = GP[3 * g];
      P.y = GP[3 * g + 1];
      P.z = GP[3 * g + 2];
      P.w = grid.W[g];
      fVal[(i - i0) * span + j - j0] = keep ? keep(as[i], bs[j], P) : 1;
    }
  }
  const local = (g) => (Math.floor(g / nb) - i0) * span + (g % nb) - j0;
  const gridKeep = (g) => fVal[local(g)];
  // a grid point as an output vertex (its normal is already unit length)
  const pushGrid = (i, j) => {
    if (M * (nv + 1) > vcap) growV();
    const g = i * nb + j;
    P.x = GP[3 * g];
    P.y = GP[3 * g + 1];
    P.z = GP[3 * g + 2];
    const nx = GN[3 * g], ny = GN[3 * g + 1], nz = GN[3 * g + 2];
    const t = uv ? uv(as[i], bs[j], P) : null;
    put(nv, P.x + nx * offset, P.y + ny * offset, P.z + nz * offset, nx, ny, nz, t ? t[0] : 0, t ? t[1] : 0);
    return nv++;
  };
  const vertexAt = (i, j) => {
    const k = (i - i0) * span + j - j0;
    if (vId[k] < 0) vId[k] = pushGrid(i, j);
    return vId[k];
  };
  const push = (a, b, nx, ny, nz) => {
    if (M * (nv + 1) > vcap) growV();
    const l = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
    nx *= l;
    ny *= l;
    nz *= l;
    const t = uv ? uv(a, b, P) : null;
    put(nv, P.x + nx * offset, P.y + ny * offset, P.z + nz * offset, nx, ny, nz, t ? t[0] : 0, t ? t[1] : 0);
    return nv++;
  };
  const gridVertex = (g) => vertexAt(Math.floor(g / nb), g % nb);
  // Where keep() crosses zero on the grid edge g1-g2 (Illinois root finding)
  const cuts = new Map();
  const cutVertex = (g1, g2) => {
    const ga = Math.min(g1, g2);
    const gb = Math.max(g1, g2);
    const key = ga * 4194304 + gb;
    let id = cuts.get(key);
    if (id !== undefined) return id;
    const a0 = as[Math.floor(ga / nb)], b0 = bs[ga % nb];
    const a1 = as[Math.floor(gb / nb)], b1 = bs[gb % nb];
    let lo = 0, hi = 1, flo = gridKeep(ga), fhi = gridKeep(gb), side = 0, t = 0.5;
    for (let it = 0; it < 12; it++) {
      t = (lo * fhi - hi * flo) / (fhi - flo);
      const a = lerp(a0, a1, t), b = lerp(b0, b1, t);
      P.w = 0;
      evalP(a, b, P);
      const f = keep(a, b, P);
      if (Math.abs(f) < 5e-5 || hi - lo < 5e-4) break; // well under 0.1 mm: plenty
      if (f * fhi > 0) {
        hi = t; fhi = f;
        if (side === -1) flo *= 0.5;
        side = -1;
      } else {
        lo = t; flo = f;
        if (side === 1) fhi *= 0.5;
        side = 1;
      }
    }
    // P holds the last evaluated point; the normal is blended from the edge ends
    const N = grid.N;
    id = push(lerp(a0, a1, t), lerp(b0, b1, t), lerp(N[3 * ga], N[3 * gb], t), lerp(N[3 * ga + 1], N[3 * gb + 1], t), lerp(N[3 * ga + 2], N[3 * gb + 2], t));
    cuts.set(key, id);
    return id;
  };
  // Emit a triangle wound so its front face agrees with the surface normal
  const facing = (a, b, c) => {
    const ax = px(a), ay = py(a), az = pz(a);
    const ux = px(b) - ax, uy = py(b) - ay, uz = pz(b) - az;
    const vx = px(c) - ax, vy = py(c) - ay, vz = pz(c) - az;
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const A = 3 * M * a, B = 3 * M * b, C = 3 * M * c;
    const nx = nor[A] + nor[B] + nor[C];
    const ny = nor[A + 1] + nor[B + 1] + nor[C + 1];
    const nz = nor[A + 2] + nor[B + 2] + nor[C + 2];
    return fx * nx + fy * ny + fz * nz;
  };
  const emit = (a, b, c) => {
    if (facing(a, b, c) < 0) addTri(a, c, b);
    else addTri(a, b, c);
  };
  // Whole grid triangles all have the same orientation in (a, b), so their winding is
  // decided once (from the first one that is not degenerate)
  let flip = 0;
  const whole = (a, b, c) => {
    if (flip === 0) {
      const d = facing(a, b, c);
      if (d === 0) return addTri(a, b, c);
      flip = d > 0 ? 1 : -1;
    }
    if (flip > 0) addTri(a, b, c);
    else addTri(a, c, b);
  };
  const g3 = [0, 0, 0];
  const in3 = [false, false, false];
  const poly = [];
  const tri = (ga, gb, gc) => {
    in3[0] = gridKeep(ga) >= 0;
    in3[1] = gridKeep(gb) >= 0;
    in3[2] = gridKeep(gc) >= 0;
    if (in3[0] && in3[1] && in3[2]) return emit(gridVertex(ga), gridVertex(gb), gridVertex(gc));
    if (!in3[0] && !in3[1] && !in3[2]) return;
    g3[0] = ga;
    g3[1] = gb;
    g3[2] = gc;
    poly.length = 0;
    for (let k = 0; k < 3; k++) {
      const n = (k + 1) % 3;
      if (in3[k]) poly.push(gridVertex(g3[k]));
      if (in3[k] !== in3[n]) poly.push(cutVertex(g3[k], g3[n]));
    }
    for (let k = 1; k < poly.length - 1; k++) emit(poly[0], poly[k], poly[k + 1]);
  };
  for (let i = i0; i < i1; i++) {
    for (let j = j0; j < j1; j++) {
      const k00 = (i - i0) * span + j - j0;
      const in00 = fVal[k00] >= 0, in10 = fVal[k00 + span] >= 0, in01 = fVal[k00 + 1] >= 0, in11 = fVal[k00 + span + 1] >= 0;
      const odd = (i + j) & 1; // alternate the diagonal so thin features do not get a saw-tooth bias
      if (in00 && in10 && in01 && in11) {
        // fast path: the whole cell is kept
        const v00 = vertexAt(i, j), v10 = vertexAt(i + 1, j), v01 = vertexAt(i, j + 1), v11 = vertexAt(i + 1, j + 1);
        if (odd) {
          whole(v00, v10, v11);
          whole(v00, v11, v01);
        } else {
          whole(v00, v10, v01);
          whole(v10, v11, v01);
        }
        continue;
      }
      if (!in00 && !in10 && !in01 && !in11) continue;
      const g00 = i * nb + j, g10 = g00 + nb, g01 = g00 + 1, g11 = g10 + 1;
      if (odd) {
        tri(g00, g10, g11);
        tri(g00, g11, g01);
      } else {
        tri(g00, g10, g01);
        tri(g10, g11, g01);
      }
    }
  }
  // views on the buffers: every patch is merged into a final geometry right after
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, M * nv * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, M * nv * 3), 3));
  if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(uvs.subarray(0, M * nv * 2), 2));
  geo.setIndex(new THREE.BufferAttribute(idx.subarray(0, ni), 1));
  return geo;
}

// Grid rows/columns that cover a parameter box (for small patches of a big grid)
function cellsFor(grid, a0, a1, b0, b1) {
  const find = (arr, x, up) => {
    let k = 0;
    while (k < arr.length - 1 && arr[k + 1] <= x) k++;
    return up ? Math.min(arr.length - 1, k + 1) : k;
  };
  return [find(grid.as, a0, false), find(grid.as, a1, true), find(grid.bs, b0, false), find(grid.bs, b1, true)];
}

// Smooth vertex normals (area-weighted face normals), straight on the typed arrays.
// Same result as BufferGeometry.computeVertexNormals, but much cheaper on a cold page.
function smoothNormals(geo) {
  const p = geo.attributes.position.array;
  const n = new Float32Array(p.length);
  const idx = geo.index ? geo.index.array : null;
  const count = idx ? geo.index.count : p.length / 3;
  for (let k = 0; k < count; k += 3) {
    const a = 3 * (idx ? idx[k] : k);
    const b = 3 * (idx ? idx[k + 1] : k + 1);
    const c = 3 * (idx ? idx[k + 2] : k + 2);
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    n[a] += fx; n[a + 1] += fy; n[a + 2] += fz;
    n[b] += fx; n[b + 1] += fy; n[b + 2] += fz;
    n[c] += fx; n[c + 1] += fy; n[c + 2] += fz;
  }
  for (let k = 0; k < n.length; k += 3) {
    const l = Math.sqrt(n[k] * n[k] + n[k + 1] * n[k + 1] + n[k + 2] * n[k + 2]);
    if (l > 0) {
      n[k] /= l;
      n[k + 1] /= l;
      n[k + 2] /= l;
    }
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  return geo;
}

// Merge geometries into one indexed geometry with position + normal (+ uv when asked).
// A flat typed-array copy: much cheaper than the generic BufferGeometryUtils version,
// which matters because the car is built during page load.
function merge(list, keepUv = false) {
  let nv = 0;
  let ni = 0;
  for (const g of list) {
    if (!g.attributes.normal) smoothNormals(g);
    nv += g.attributes.position.count;
    ni += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const uv = keepUv ? new Float32Array(nv * 2) : null;
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let ov = 0;
  let oi = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, n * 3), ov * 3);
    nor.set(g.attributes.normal.array.subarray(0, n * 3), ov * 3);
    if (uv && g.attributes.uv) uv.set(g.attributes.uv.array.subarray(0, n * 2), ov * 2);
    if (g.index) {
      const a = g.index.array;
      const c = g.index.count;
      if (ov === 0) idx.set(a.subarray(0, c), oi); // nothing to add: native copy
      else for (let k = 0; k < c; k++) idx[oi + k] = a[k] + ov;
      oi += c;
    } else {
      for (let k = 0; k < n; k++) idx[oi + k] = ov + k;
      oi += n;
    }
    ov += n;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

// Right-half part(s) + their mirror image across x = 0, in one geometry (normals and
// winding fixed up). Each mesh is mirrored once, at the end, so nothing is copied twice.
function bothSides(parts, keepUv = false) {
  const list = Array.isArray(parts) ? parts : [parts];
  const g = merge([...list, ...list], keepUv);
  const n = g.attributes.position.count / 2;
  const p = g.attributes.position.array;
  const nn = g.attributes.normal.array;
  for (let k = n; k < 2 * n; k++) {
    p[3 * k] = -p[3 * k];
    nn[3 * k] = -nn[3 * k];
  }
  const idx = g.index.array;
  for (let k = idx.length / 2; k < idx.length; k += 3) {
    const t = idx[k + 1];
    idx[k + 1] = idx[k + 2];
    idx[k + 2] = t;
  }
  return g;
}

// Flip a small closed part inside out if its normals point inward (checked against its centre)
function orientOutward(geo) {
  if (!geo.attributes.normal) smoothNormals(geo);
  const p = geo.attributes.position.array;
  const n = geo.attributes.normal.array;
  const count = p.length / 3;
  let cx = 0, cy = 0, cz = 0;
  for (let k = 0; k < count; k++) {
    cx += p[3 * k];
    cy += p[3 * k + 1];
    cz += p[3 * k + 2];
  }
  cx /= count;
  cy /= count;
  cz /= count;
  let s = 0;
  for (let k = 0; k < count; k++) s += (p[3 * k] - cx) * n[3 * k] + (p[3 * k + 1] - cy) * n[3 * k + 1] + (p[3 * k + 2] - cz) * n[3 * k + 2];
  if (s >= 0) return geo;
  for (let k = 0; k < n.length; k++) n[k] = -n[k];
  const idx = geo.index.array;
  for (let k = 0; k < idx.length; k += 3) {
    const t = idx[k + 1];
    idx[k + 1] = idx[k + 2];
    idx[k + 2] = t;
  }
  return geo;
}

// A surface through a list of rows (polylines of equal length), smooth normals.
// closed: each row is a closed loop. Front faces point along (to the next row) x (along a row).
function loft(rows, closed = false) {
  const m = rows[0].length;
  const pos = new Float32Array(rows.length * m * 3);
  let o = 0;
  for (const row of rows) {
    for (const p of row) {
      pos[o++] = p.x;
      pos[o++] = p.y;
      pos[o++] = p.z;
    }
  }
  const idx = [];
  const segs = closed ? m : m - 1;
  for (let r = 0; r < rows.length - 1; r++) {
    for (let k = 0; k < segs; k++) {
      const a = r * m + k;
      const b = r * m + ((k + 1) % m);
      const c = a + m;
      const d = b + m;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  smoothNormals(geo);
  return geo;
}

// Surface of revolution around the x axis (wheels): profile = [[radius, x], ...]
// A repeated profile point makes a sharp edge (each copy keeps its own normal).
function revolveX(profile, segs, start = 0, length = Math.PI * 2) {
  const pos = [];
  const idx = [];
  const ring = segs + 1;
  for (const [r, x] of profile) {
    for (let s = 0; s <= segs; s++) {
      const a = start + (s / segs) * length;
      pos.push(x, r * Math.cos(a), r * Math.sin(a));
    }
  }
  for (let k = 0; k < profile.length - 1; k++) {
    for (let s = 0; s < segs; s++) {
      const a = k * ring + s, b = a + 1, c = a + ring, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  smoothNormals(geo);
  return geo;
}

// A quad strip between two polylines (arrays of Vector3), smooth normals
function stripBetween(a, b, closed = false) {
  const pos = [];
  const idx = [];
  for (let k = 0; k < a.length; k++) pos.push(a[k].x, a[k].y, a[k].z, b[k].x, b[k].y, b[k].z);
  const n = closed ? a.length : a.length - 1;
  for (let k = 0; k < n; k++) {
    const i = 2 * k, j = 2 * ((k + 1) % a.length);
    idx.push(i, i + 1, j, j, i + 1, j + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  smoothNormals(geo);
  return geo;
}

// A round tube along a polyline (frames carried along by parallel transport), open ends
function tube(pts, radius, radial) {
  const rows = [];
  const T = new THREE.Vector3();
  const Nn = new THREE.Vector3();
  const Bn = new THREE.Vector3();
  for (let k = 0; k < pts.length; k++) {
    T.subVectors(pts[Math.min(pts.length - 1, k + 1)], pts[Math.max(0, k - 1)]).normalize();
    if (k === 0) Nn.set(0, 1, 0).addScaledVector(T, -T.y).normalize(); // start with "up"
    else Nn.addScaledVector(T, -Nn.dot(T)).normalize(); // keep it square to the new tangent
    Bn.crossVectors(T, Nn);
    const ring = [];
    for (let i = 0; i < radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      ring.push(pts[k].clone().addScaledVector(Nn, radius * Math.cos(a)).addScaledVector(Bn, radius * Math.sin(a)));
    }
    rows.push(ring);
  }
  return orientOutward(loft(rows, true));
}

// A triangle fan closing a polyline loop (around its average point)
function fan(loop) {
  const c = new THREE.Vector3();
  loop.forEach((p) => c.add(p));
  c.multiplyScalar(1 / loop.length);
  const pos = [c.x, c.y, c.z];
  loop.forEach((p) => pos.push(p.x, p.y, p.z));
  const idx = [];
  for (let k = 0; k < loop.length; k++) idx.push(0, 1 + k, 1 + ((k + 1) % loop.length));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  smoothNormals(geo);
  return geo;
}

// Place a geometry at P, turned so its +z axis points along direction n
function placeAlong(geo, P, n, spin = 0) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n.clone().normalize());
  if (spin) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), spin));
  return geo.applyMatrix4(new THREE.Matrix4().compose(P, q, new THREE.Vector3(1, 1, 1)));
}

/* --------------------------------------------------------------------------
   6. BODY SHELL, GLASS AND THE PATCHES CUT FROM THE SAME SURFACE
   -------------------------------------------------------------------------- */
function bodySurface(tier) {
  const nz = { low: 80, medium: 112, high: 144 }[tier];
  const nv = { low: 36, medium: 48, high: 60 }[tier];
  const as = Float64Array.from({ length: nz + 1 }, (_, i) => lerp(-2.31, 2.29, i / nz));
  const bs = Float64Array.from({ length: nv + 1 }, (_, j) => j / nv);
  // sections of the grid rows are built once and shared by every patch
  rows = { z0: as[0], dz: (as[nz] - as[0]) / nz, secs: Array.from(as, (z) => buildSection(z)) };
  for (const slot of memo) slot.z = NaN;
  // the grid points: the same as bodyPoint(), walked row by row (v only grows along a row,
  // so the knot interval is found by stepping instead of searching)
  const fill = (grid) => {
    const P = { x: 0, y: 0, z: 0, w: 0 };
    let g = 0;
    for (let i = 0; i <= nz; i++) {
      const sec = rows.secs[i];
      const t = sec.t;
      let lo = NT - 1;
      for (let j = 0; j <= nv; j++, g++) {
        const s = bs[j] * sec.len;
        while (lo < NK - 2 && t[lo + 1] <= s) lo++;
        P.x = splineValue(t, sec.x, sec.mx, s, lo);
        P.y = splineValue(t, sec.y, sec.my, s, lo);
        P.w = lo - (NT - 1) + (s - t[lo]) / (t[lo + 1] - t[lo]);
        P.z = as[i];
        sculpt(P);
        grid.P[3 * g] = P.x;
        grid.P[3 * g + 1] = P.y;
        grid.P[3 * g + 2] = P.z;
        grid.W[g] = P.w;
      }
    }
  };
  return surfaceGrid(as, bs, bodyPoint, { mirrorB0: true, fill });
}

function buildGlass(grid) {
  const top = trimmedPatch(grid, { keep: (z, v, P) => topGlass(z, P.w), cells: cellsFor(grid, -1.0, 0.6, 0, 0.45), mirror: true });
  const side = trimmedPatch(grid, { keep: (z, v, P) => sideGlass(z, P.w), cells: cellsFor(grid, -0.9, 0.7, 0.15, 0.5), mirror: true });
  return merge([top, side]);
}

// Dark base under the louvres: the same surface, sunk 4 cm (both sides)
function buildLouvreBase(grid) {
  const keep = (z, v, P) => 0.03 - louvreSDF(P);
  return trimmedPatch(grid, { keep, offset: -0.04, cells: cellsFor(grid, 0.7, 1.8, 0, 0.3), mirror: true });
}

// Louvre slats: thin painted blades across the opening, tilted to the rear
function buildLouvreSlats() {
  const out = [];
  const count = 9;
  const P = new THREE.Vector3();
  const Nn = new THREE.Vector3();
  for (let k = 0; k < count; k++) {
    const z = LOUVRE.z - LOUVRE.hz + 0.04 + (k / (count - 1)) * (2 * LOUVRE.hz - 0.08);
    const front = [];
    const back = [];
    const lower = [];
    const lowerBack = [];
    for (let s = 0; s <= 12; s++) {
      const x = (s / 12) * (LOUVRE.hx + 0.02);
      bodyPN(z, topV(z, x), P, Nn);
      const d = 0.026; // blade depth along the car
      const up = Nn.clone();
      front.push(P.clone().addScaledVector(up, -0.004).add(new THREE.Vector3(0, 0, -d / 2)));
      back.push(P.clone().addScaledVector(up, -0.004).add(new THREE.Vector3(0, -0.012, d / 2)));
      lower.push(front[s].clone().addScaledVector(up, -0.03));
      lowerBack.push(back[s].clone().addScaledVector(up, -0.03));
    }
    out.push(stripBetween(back, front), stripBetween(front, lower), stripBetween(lowerBack, back));
  }
  return out; // right-half parts
}

/* --------------------------------------------------------------------------
   7. FRONT AND REAR FASCIAS — patches on the cut surfaces, filling the body outline
   -------------------------------------------------------------------------- */
// Section outlines (x, y) on the real (sculpted) body, tabulated along z.
// Each outline is closed down to the floor and back to the centre line.
function outlineTable(z0, z1, step) {
  const rows = [];
  const P = new THREE.Vector3();
  for (let z = z0; z <= z1 + 1e-9; z += step) {
    const pts = [];
    for (let k = 0; k <= 32; k++) {
      bodyPoint(z, k / 32, P);
      pts.push(P.x, P.y);
    }
    pts.push(pts[pts.length - 2], FLOOR_Y - 0.04, 0, FLOOR_Y - 0.04);
    rows.push(Float64Array.from(pts));
  }
  return { z0, step, rows };
}

// Signed distance from (x, y) to one closed outline (negative inside)
// (the closing edge on x = 0 is the mirror line, not an edge). The exact distance is only
// worked out for the edges next to the nearest corner, plus the two long closing edges.
function outlineSDF(pts, x, y) {
  const m = pts.length / 2;
  let inside = false;
  let near = Infinity;
  let kn = 0;
  for (let k = 0; k < m; k++) {
    const ax = pts[2 * k], ay = pts[2 * k + 1];
    const kb = k + 1 < m ? k + 1 : 0;
    const by = pts[2 * kb + 1];
    if (ay > y !== by > y && x < ax + ((y - ay) * (pts[2 * kb] - ax)) / (by - ay)) inside = !inside;
    const d2 = (x - ax) * (x - ax) + (y - ay) * (y - ay);
    if (d2 < near) {
      near = d2;
      kn = k;
    }
  }
  let best = near;
  const edge = (k) => {
    if (k < 0 || k >= m - 1) return;
    const ax = pts[2 * k], ay = pts[2 * k + 1];
    const ex = pts[2 * k + 2] - ax, ey = pts[2 * k + 3] - ay;
    const t = clamp(((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey || 1), 0, 1);
    const dx = x - ax - t * ex, dy = y - ay - t * ey;
    const d2 = dx * dx + dy * dy;
    if (d2 < best) best = d2;
  };
  edge(kn - 1);
  edge(kn);
  edge(m - 3);
  edge(m - 2);
  best = Math.sqrt(best);
  return inside ? -best : best;
}

const tableSDF = (table, x, y, z) => outlineSDF(table.rows[Math.round(clamp((z - table.z0) / table.step, 0, table.rows.length - 1))], x, y);

// One fascia surface: z = cut(x, y) pushed `depth` into the car.
// box = [xMax, yMin, yMax] limits it to a smaller area (same grid spacing).
function fasciaSurface(front, depth, tier, box = null) {
  const cut = front ? frontCutZ : rearCutZ;
  const dir = front ? 1 : -1;
  const evalP = (x, y, P) => P.set(x, y, cut(x, y) + dir * depth);
  const yMin0 = FLOOR_Y - 0.04;
  const yMax0 = front ? 0.72 : 1.02;
  const [x1, y0, y1] = box || [1.04, yMin0, yMax0];
  const nx = Math.max(4, Math.round(({ low: 14, medium: 18, high: 22 }[tier] * x1) / 1.04));
  const ny = Math.max(4, Math.round(({ low: 12, medium: 14, high: 18 }[tier] * (y1 - y0)) / (yMax0 - yMin0)));
  const as = Float64Array.from({ length: nx + 1 }, (_, i) => (i / nx) * x1);
  const bs = Float64Array.from({ length: ny + 1 }, (_, j) => lerp(y0, y1, j / ny));
  return surfaceGrid(as, bs, evalP, { mirrorA0: true, sign: front ? -1 : 1 });
}

// Openings in the nose: a wide centre mouth and two side intakes under the headlights
function frontOpenings(x, y) {
  const mouth = roundRect(x, y - 0.205, 0.36, 0.075, 0.045);
  const side = roundRect(x - 0.665 - 0.3 * (y - 0.255), y - 0.255, 0.165, 0.115, 0.055);
  return Math.min(mouth, side);
}
// Rear: a recessed black mesh panel with a gloss-black surround, and the diffuser opening
// (between the rear tyres, open at the bottom)
const REAR_MESH = { y: 0.555, hx: 0.72, hy: 0.15, r: 0.05, bezel: 0.018, depth: 0.11 };
const rearGrille = (x, y) => roundRect(x, y - REAR_MESH.y, REAR_MESH.hx, REAR_MESH.hy, REAR_MESH.r);
const rearDiffuser = (x, y) => roundRect(x, y - 0.19, 0.665, 0.14, 0.05);
const FRONT_DEPTH = 0.035; // the front fascia sits this far behind the nose cut
const REAR_DEPTH = 0.05; // ... and the tail panel this far in from the tail cut

// Rounded rectangle walked as a closed loop of (x, y) points, counter-clockwise.
// The straight sides get points too (about every 8 cm), so a loop laid on a curved
// panel follows the panel instead of cutting straight through it.
function roundRectLoop(cy, hx, hy, r, steps) {
  const pts = [];
  const corners = [[hx - r, hy - r], [-(hx - r), hy - r], [-(hx - r), -(hy - r)], [hx - r, -(hy - r)]];
  corners.forEach(([cx, cyy], q) => {
    for (let k = 0; k <= steps; k++) {
      const a = ((q + k / steps) * Math.PI) / 2;
      pts.push([cx + r * Math.cos(a), cy + cyy + r * Math.sin(a)]);
    }
    // the straight side from this corner's arc to the next one
    const [ex, ey] = pts[pts.length - 1];
    const [nx, nyy] = corners[(q + 1) % 4];
    const a1 = (((q + 1) % 4) * Math.PI) / 2;
    const sx = nx + r * Math.cos(a1);
    const sy = cy + nyy + r * Math.sin(a1);
    const n = Math.max(1, Math.round(Math.hypot(sx - ex, sy - ey) / 0.08));
    for (let k = 1; k < n; k++) pts.push([lerp(ex, sx, k / n), lerp(ey, sy, k / n)]);
  });
  return pts;
}

function buildFascias(tier, front, rear) {
  const inF = (x, y, z) => -tableSDF(front, x, y, z);
  const inR = (x, y, z) => -tableSDF(rear, x, y, z);
  const uvFront = (x, y) => [x * 6, y * 6];
  const uvRear = (x, y) => [x * 15, y * 15]; // finer holes on the tail panel

  const fPaint = fasciaSurface(true, FRONT_DEPTH, tier);
  const fDeep = fasciaSurface(true, 0.075, tier, [0.96, 0.09, 0.42]); // only behind the openings
  const rPaint = fasciaSurface(false, REAR_DEPTH, tier);
  const rDeep = fasciaSurface(false, REAR_MESH.depth, tier, [0.77, 0.37, 0.74]);
  const B = REAR_MESH.bezel;

  const paint = [
    trimmedPatch(fPaint, { keep: (x, y, P) => Math.min(inF(x, y, P.z), frontOpenings(x, y), y - FLOOR_Y + 0.02), mirror: true }),
    trimmedPatch(rPaint, { keep: (x, y, P) => Math.min(inR(x, y, P.z), rearGrille(x, y) - B, rearDiffuser(x, y), y - FLOOR_Y + 0.02), mirror: true }),
  ]; // both sides
  const grille = merge(
    [
      trimmedPatch(fDeep, { keep: (x, y, P) => Math.min(inF(x, y, P.z), 0.03 - frontOpenings(x, y)), uv: uvFront, mirror: true }),
      trimmedPatch(rDeep, { keep: (x, y, P) => Math.min(inR(x, y, P.z), 0.01 - rearGrille(x, y)), uv: uvRear, mirror: true }),
    ],
    true
  );
  // dark surround: a thin gloss-black bezel on the tail panel (a ring between the exact
  // offset outlines, lying a hair proud of the paint) + the matte walls of the recess
  const { y: my, hx, hy, r, depth } = REAR_MESH;
  const onPanel = (pts, d) => pts.map(([x, y]) => new THREE.Vector3(x, y, rearCutZ(x, y) - d));
  const ringOut = onPanel(roundRectLoop(my, hx + B + 0.003, hy + B + 0.003, r + B + 0.003, 6), REAR_DEPTH - 0.0015);
  const edge = roundRectLoop(my, hx, hy, r, 6);
  const bezel = loft([onPanel(edge, REAR_DEPTH - 0.0015), ringOut], true); // (row order: faces the rear)
  const recess = loft([onPanel(edge, REAR_DEPTH - 0.0015), onPanel(edge, depth + 0.004)], true); // matte, so it never mirrors the lights
  return { paint, grille, bezel, recess };
}

/* --------------------------------------------------------------------------
   8. WHEEL WELLS, FLOOR, SIDE INTAKE DUCTS
   -------------------------------------------------------------------------- */
function buildWheelWells(segs) {
  const parts = [];
  const r = ARCH_R + 0.006;
  const maxA = Math.acos((SILL - 0.02 - ARCH_Y) / r); // down to just under the sill
  for (const zc of [FRONT_Z, REAR_Z]) {
    const inner = [];
    const outer = [];
    for (let k = 0; k <= segs; k++) {
      const a = -maxA + (2 * maxA * k) / segs; // angle from the top, + toward the rear
      const y = ARCH_Y + r * Math.cos(a);
      const z = zc + r * Math.sin(a);
      const P = bodyPoint(z, sideV(z, Math.max(y, SILL + 0.005)), new THREE.Vector3());
      inner.push(new THREE.Vector3(ARCH_X, y, z));
      outer.push(new THREE.Vector3(Math.max(ARCH_X + 0.02, P.x - 0.01), y, z));
    }
    parts.push(stripBetween(inner, outer), fan([...inner, new THREE.Vector3(ARCH_X, ARCH_Y, zc)]));
  }
  return parts; // right half
}

// Flat underside: four rectangles (notched around the wheels), ending where the diffuser ramp starts
function buildFloor() {
  const w = 0.8, n = 0.6;
  const rects = [
    [w, -2.0, FRONT_Z - 0.46],
    [n, FRONT_Z - 0.46, FRONT_Z + 0.46],
    [w, FRONT_Z + 0.46, REAR_Z - 0.46],
    [n, REAR_Z - 0.46, DIFF.z0],
  ];
  const pos = [];
  const idx = [];
  for (const [hx, z0, z1] of rects) {
    const o = pos.length / 3;
    pos.push(-hx, FLOOR_Y, z0, hx, FLOOR_Y, z0, hx, FLOOR_Y, z1, -hx, FLOOR_Y, z1);
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3); // facing down
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  smoothNormals(g);
  return g;
}

// Outline of the side intake opening (as z, y pairs), walked around its rounded corners
function intakeOutline(steps = 10) {
  const { z, y, hz, hy, r, lean } = INTAKE;
  const pts = [];
  const corners = [[hz - r, hy - r, 0], [-(hz - r), hy - r, 1], [-(hz - r), -(hy - r), 2], [hz - r, -(hy - r), 3]];
  for (const [cz, cy, q] of corners) {
    for (let k = 0; k <= steps; k++) {
      const a = ((q + k / steps) * Math.PI) / 2;
      const yy = cy + r * Math.sin(a);
      pts.push([z + cz + r * Math.cos(a) + lean * yy, y + yy]);
    }
  }
  return pts;
}

function buildIntakeDucts() {
  const outer = [];
  const inner = [];
  for (const [z, y] of intakeOutline()) {
    const P = bodyPoint(z, sideV(z, y), new THREE.Vector3());
    outer.push(new THREE.Vector3(P.x + 0.004, y, z));
    inner.push(new THREE.Vector3(0.64, y, z));
  }
  return [stripBetween(outer, inner, true), fan(inner)]; // right half
}

/* --------------------------------------------------------------------------
   9. LIGHTS
   -------------------------------------------------------------------------- */
// Headlights: a dark glossy pod on each front wing with four round LED projectors
// and a thin LED line under them. Positions come from the body surface itself.
function buildHeadlights(grid) {
  const z0 = -1.93;
  const pod = (z, v, P) => {
    // pod outline in surface coordinates: a slanted capsule across the wing's nose
    const w = P.w;
    return -roundRect((z - z0 + 0.07 * (w - 5.2)) * 3.2, w - 5.2, 0.12, 0.62, 0.11);
  };
  const housing = trimmedPatch(grid, { keep: pod, offset: 0.003, cells: cellsFor(grid, -2.2, -1.7, 0.25, 0.75), mirror: true });
  const leds = [];
  const rings = [];
  const P = new THREE.Vector3();
  const Nn = new THREE.Vector3();
  const centre = new THREE.Vector3();
  for (let k = 0; k < 4; k++) {
    const w = 4.75 + k * 0.3;
    const z = z0 - 0.07 * (w - 5.2);
    bodyPN(z, vAtW(z, w), P, Nn);
    centre.add(P);
    leds.push(placeAlong(new THREE.CircleGeometry(0.021, 20), P.clone().addScaledVector(Nn, 0.006), Nn));
    rings.push(placeAlong(new THREE.TorusGeometry(0.025, 0.0045, 6, 24), P.clone().addScaledVector(Nn, 0.006), Nn));
  }
  centre.multiplyScalar(0.25);
  return { housing, leds: bothSides(leds), rings, centre }; // rings: right half
}

// Tail light: one thin glowing bar under the ducktail lip, wrapping round both corners
function buildTailLight(segs, table) {
  const pts = [];
  const xMax = 0.9;
  for (let k = 0; k <= 24; k++) {
    const x = (k / 24) * xMax;
    // top edge of the rear outline at this x, then a few cm below it
    let z = rearCutZ(x, 0.85) - 0.05;
    const row = table.rows[Math.round(clamp((z - table.z0) / table.step, 0, table.rows.length - 1))];
    let yTop = 0;
    for (let i = 0; i < row.length / 2 - 1; i++) {
      const ax = row[2 * i], bx = row[2 * i + 2];
      if ((ax - x) * (bx - x) <= 0 && ax !== bx) yTop = Math.max(yTop, lerp(row[2 * i + 1], row[2 * i + 3], (x - ax) / (bx - ax)));
    }
    const y = yTop - 0.05;
    z = rearCutZ(x, y) - 0.05 + 0.012;
    pts.push(new THREE.Vector3(x, y, z));
  }
  // wrap round the corner onto the body side
  const last = pts[pts.length - 1];
  for (let k = 1; k <= 6; k++) {
    const z = last.z - k * 0.03;
    const P = bodyPoint(z, sideV(z, last.y), new THREE.Vector3());
    pts.push(new THREE.Vector3(P.x + 0.004, last.y, z));
  }
  const full = [...pts.slice(1).reverse().map((p) => new THREE.Vector3(-p.x, p.y, p.z)), ...pts];
  const curve = new THREE.CatmullRomCurve3(full);
  return { geo: tube(curve.getPoints(segs), 0.012, 8), centre: pts[Math.round(pts.length * 0.62)] };
}

/* --------------------------------------------------------------------------
   10. WHEELS
   -------------------------------------------------------------------------- */
function buildTyre(segs) {
  // profile from the outer bead, over the tread, to the inner bead
  const p = [
    [0.286, 0.118], [0.3, 0.127], [0.318, 0.1325], [0.336, 0.132], [0.35, 0.126], [0.358, 0.114],
    [0.362, 0.095], [0.363, 0.05], [0.363, 0], [0.363, -0.05], [0.362, -0.095], [0.358, -0.114],
    [0.35, -0.126], [0.336, -0.132], [0.318, -0.1325], [0.3, -0.127], [0.286, -0.118],
  ];
  return revolveX(p, segs);
}

// Rim: lip + barrel (revolved) and five twin spokes. Local x = 0 is the spoke face.
function buildRim(segs) {
  const lip = revolveX(
    [[0.27, -0.215], [0.27, -0.006], [0.27, -0.006], [0.262, 0.004], [0.266, 0.014], [0.278, 0.019], [0.29, 0.015], [0.294, 0.005], [0.29, -0.004], [0.285, -0.008]],
    segs
  );
  const hub = revolveX(
    [[5e-4, -0.01], [0.022, -0.01], [0.03, -0.016], [0.03, -0.016], [0.036, -0.026], [0.075, -0.03], [0.08, -0.05]],
    Math.max(16, segs / 2)
  );
  const spokes = [];
  const steps = 6;
  for (let pair = 0; pair < 5; pair++) {
    for (const side of [-1, 1]) {
      const pos = [];
      for (let k = 0; k <= steps; k++) {
        const f = k / steps;
        const r = lerp(0.066, 0.271, f);
        const ang = (pair / 5) * Math.PI * 2 + side * lerp(0.2, 0.105, f);
        const halfW = lerp(0.019, 0.011, f);
        const face = -0.028 + 0.036 * Math.pow(f, 0.8); // dished: the hub sits further in
        const back = face - lerp(0.03, 0.02, f);
        const c = 0.004; // chamfered front edges catch the light
        const cs = [[face, -halfW + c], [face, halfW - c], [face - c, halfW], [back, halfW], [back, -halfW], [face - c, -halfW]];
        const ca = Math.cos(ang), sa = Math.sin(ang);
        for (const [x, w] of cs) pos.push(x, r * ca - w * sa, r * sa + w * ca);
      }
      const idx = [];
      for (let k = 0; k < steps; k++) {
        for (let e = 0; e < 6; e++) {
          const a = k * 6 + e, b = k * 6 + ((e + 1) % 6), c = a + 6, d = b + 6;
          idx.push(a, b, c, b, d, c);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      spokes.push(g.toNonIndexed());
    }
  }
  // spokes are unshared triangles, so their normals stay flat: a machined look
  return merge([lip, hub, ...spokes]);
}

function buildDisc(segs) {
  return revolveX(
    [[0.1, 0.017], [0.195, 0.017], [0.195, 0.017], [0.198, 0.0], [0.195, -0.017], [0.195, -0.017], [0.1, -0.017], [0.1, 0.017], [0.1, 0.017], [0.095, 0.04], [0.06, 0.042]],
    segs
  );
}

// Calliper: a block hugging the disc at the rear-top (it lives in `main`, so it never spins)
function buildCalliper() {
  return revolveX([[0.15, -0.03], [0.15, 0.044], [0.15, 0.044], [0.218, 0.044], [0.218, 0.044], [0.218, -0.03], [0.218, -0.03], [0.15, -0.03]], 10, 0.55, 1.15);
}

/* --------------------------------------------------------------------------
   11. CABIN, MIRRORS, AERO PARTS
   -------------------------------------------------------------------------- */
function buildCabin() {
  const parts = [];
  // tub: door panels and floor under the glass, following the body inside
  const left = [];
  const right = [];
  for (let k = 0; k <= 14; k++) {
    const z = lerp(-0.8, 0.6, k / 14);
    const vFoot = vAtW(z, 3);
    const P = bodyPoint(z, vFoot, new THREE.Vector3());
    left.push(new THREE.Vector3(P.x - 0.03, P.y - 0.01, z));
    right.push(new THREE.Vector3(P.x - 0.09, 0.24, z));
  }
  parts.push(stripBetween(left, right));
  const floorA = right.map((p) => p.clone());
  const floorB = right.map((p) => new THREE.Vector3(0, 0.24, p.z));
  parts.push(stripBetween(floorA, floorB));
  // bulkhead behind the seats: follows the inside of the canopy, then drops straight down
  const zw = 0.6;
  const vFoot = vAtW(zw, 3);
  const Q = new THREE.Vector3();
  const loop = [];
  for (let k = 0; k <= 10; k++) {
    bodyPoint(zw, (k / 10) * vFoot, Q);
    loop.push(new THREE.Vector3(Math.max(0, Q.x - 0.03), Q.y - 0.03, zw));
  }
  const foot = loop[loop.length - 1];
  loop.push(new THREE.Vector3(foot.x, 0.24, zw), new THREE.Vector3(0, 0.24, zw));
  parts.push(fan(loop));
  // dashboard: a slab under the windscreen base
  const dash = new THREE.BoxGeometry(1.0, 0.16, 0.42);
  dash.translate(0, 0.6, -0.72);
  // seats: cushion + reclined back
  const seat = (x) => {
    const cushion = new THREE.BoxGeometry(0.42, 0.1, 0.5).translate(x, 0.3, 0.05);
    const back = new THREE.BoxGeometry(0.42, 0.62, 0.1).translate(0, 0.31, 0).rotateX(-0.42).translate(x, 0.32, 0.3);
    return [cushion, back];
  };
  // steering wheel (left-hand drive)
  const wheel = new THREE.TorusGeometry(0.17, 0.018, 6, 24).rotateX(-0.35).translate(-0.31, 0.7, -0.42);
  const tunnel = new THREE.BoxGeometry(0.2, 0.16, 1.0).translate(0, 0.32, -0.1);
  return merge([bothSides(parts), dash, ...seat(0.31), ...seat(-0.31), wheel, tunnel]);
}

// Mirrors: a slim teardrop housing (fat outer end, flat glass at the back) on a thin
// dark blade arm that rises from the front-wing crown, swept back. Built for the right side.
function buildMirrors() {
  const L = 0.205; // housing length (across the car)
  const R = 0.068; // housing radius scale
  const prof = [];
  for (let k = 0; k <= 14; k++) {
    const u = k / 14;
    prof.push([Math.max(5e-4, R * Math.pow(Math.sin(Math.PI * u), 0.55) * (0.45 + 0.55 * u)), u * L]); // (no zero-size ring: keeps normals defined)
  }
  const housing = revolveX(prof, 24, Math.PI / 2); // seam at the back, under the glass
  // slim it vertically and flatten the back into the mirror face
  const FACE = 0.014;
  const p = housing.attributes.position.array;
  for (let k = 0; k < p.length; k += 3) {
    p[k + 1] *= 0.62;
    if (p[k + 2] > FACE) p[k + 2] = FACE + (p[k + 2] - FACE) * 0.12;
  }
  orientOutward(smoothNormals(housing));
  const face = new THREE.CircleGeometry(1, 20).scale(0.066, 0.024, 1).translate(0.55 * L, 0, FACE + 0.0045);
  // inner tip just outboard of the wing, outer end swept back
  const M = new THREE.Matrix4().compose(new THREE.Vector3(0.885, 0.95, -0.545), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.22, 0)), new THREE.Vector3(1, 1, 1));
  housing.applyMatrix4(M);
  face.applyMatrix4(M);
  // arm: an elliptical blade from inside the wing crown to inside the housing
  const base = new THREE.Vector3();
  const Nn = new THREE.Vector3();
  bodyPN(-0.66, vAtW(-0.66, 4.9), base, Nn);
  const A = base.addScaledVector(Nn, -0.012);
  const B = new THREE.Vector3(0.045, -0.008, -0.004).applyMatrix4(M);
  const dir = B.clone().sub(A);
  const len = dir.length();
  dir.normalize();
  const chord = new THREE.Vector3(0, 0, 1).addScaledVector(dir, -dir.z).normalize(); // blade width runs along the car
  const thick = new THREE.Vector3().crossVectors(dir, chord).normalize();
  const arm = new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1);
  arm.applyMatrix4(new THREE.Matrix4().makeBasis(thick.multiplyScalar(0.011), dir.multiplyScalar(len), chord.multiplyScalar(0.034)).setPosition(A.add(B).multiplyScalar(0.5)));
  return { housing, face, arm }; // right half
}

// Front splitter: a thin dark blade under the nose. Its rounded leading edge follows the
// nose curve about 3 cm ahead of the fascia and wraps a little way round the corners,
// ending tucked under the body side.
function buildSplitter() {
  const yTop = FLOOR_Y - 0.021; // just under the fascia's lower edge
  const yBot = yTop - 0.014;
  const P = new THREE.Vector3();
  const sideX = (z) => bodyPoint(z, 0.97, P).x; // lower body side
  const noseZ = (x) => frontCutZ(x, 0.1) + FRONT_DEPTH - 0.025; // ~2.5 cm (+ the rounded edge) ahead of the fascia
  let xc = 0.7; // corner: where the nose curve meets the body side
  for (let i = 0; i < 12; i++) xc = sideX(noseZ(xc)) + 0.012;
  let edge = [];
  for (let k = 0; k <= 16; k++) {
    const x = (k / 16) * xc;
    edge.push([x, noseZ(x)]);
  }
  const zc = noseZ(xc);
  const zEnd = zc + 0.16; // a short wrap round the corner, ending tucked under the body side
  for (let k = 1; k <= 6; k++) {
    const f = k / 6;
    const z = lerp(zc, zEnd, f);
    edge.push([sideX(z) + lerp(0.012, -0.03, f * f), z]);
  }
  // round the corner (two Chaikin passes, end points kept)
  for (let pass = 0; pass < 2; pass++) {
    const out = [edge[0]];
    for (let k = 0; k < edge.length - 1; k++) {
      const [ax, az] = edge[k];
      const [bx, bz] = edge[k + 1];
      if (k > 0) out.push([0.75 * ax + 0.25 * bx, 0.75 * az + 0.25 * bz]);
      if (k < edge.length - 2) out.push([0.25 * ax + 0.75 * bx, 0.25 * az + 0.75 * bz]);
    }
    out.push(edge[edge.length - 1]);
    edge = out;
  }
  // inner edge: 16 cm in from the leading edge (plan-view normal)
  const E = (y, grow = 0) => edge.map(([x, z], k) => {
    const [ax, az] = edge[Math.max(0, k - 1)];
    const [bx, bz] = edge[Math.min(edge.length - 1, k + 1)];
    const l = Math.hypot(bx - ax, bz - az) || 1;
    const nx = -(bz - az) / l; // inward
    const nz = (bx - ax) / l;
    return new THREE.Vector3(x - nx * grow, y, z - nz * grow);
  });
  const I = (y) => E(y, -0.16);
  const yMid = 0.5 * (yTop + yBot);
  return [
    loft([I(yTop), E(yTop)]), // top
    loft([E(yTop), E(yMid + 0.004, 0.004), E(yMid - 0.004, 0.004), E(yBot)]), // rounded leading edge
    loft([E(yBot), I(yBot)]), // underside
  ]; // right half
}

// Rear diffuser: a ramp rising from the flat floor up behind the bumper's lower opening,
// short side walls, and five thin strakes that stay above the floor line.
const DIFF = { z0: 1.72, hx: 0.655, yEnd: 0.35 };
const diffEndZ = (x) => rearCutZ(x, DIFF.yEnd) - REAR_DEPTH - 0.01; // just inside the tail panel
const diffRamp = (s) => FLOOR_Y + (DIFF.yEnd - FLOOR_Y) * s * s * (1.5 - 0.5 * s);

function diffuserFin(xf) {
  const t = 0.0035; // half thickness
  const zEnd = diffEndZ(xf) - 0.012; // trailing edge, tucked under the bumper
  const len = diffEndZ(xf) - DIFF.z0;
  const zStart = DIFF.z0 + 0.05 * len;
  const yb = FLOOR_Y + 0.004; // lower edge stays above the floor line
  const r = 0.03; // rounded lower trailing corner
  const rows = [];
  const ring = (z, yTop, yBot, w) => [
    new THREE.Vector3(xf - w, yTop, z),
    new THREE.Vector3(xf - w, yBot + 0.004, z),
    new THREE.Vector3(xf - 0.7 * w, yBot + 0.001, z),
    new THREE.Vector3(xf, yBot, z),
    new THREE.Vector3(xf + 0.7 * w, yBot + 0.001, z),
    new THREE.Vector3(xf + w, yBot + 0.004, z),
    new THREE.Vector3(xf + w, yTop, z),
  ];
  const n = 14;
  for (let k = 0; k <= n; k++) {
    const f = 1 - Math.pow(1 - k / n, 1.6); // denser toward the trailing edge
    const z = lerp(zStart, zEnd, f);
    const dz = z - (zEnd - r);
    const yBot = dz > 0 ? yb + r - Math.sqrt(Math.max(0, r * r - dz * dz)) : yb;
    rows.push(ring(z, diffRamp((z - DIFF.z0) / len) + 0.012, yBot, t));
  }
  // round off the trailing edge in plan view
  const yTopEnd = diffRamp((zEnd - DIFF.z0) / len) + 0.012;
  rows.push(ring(zEnd + 0.002, yTopEnd, yb + r, 0.7 * t), ring(zEnd + 0.0035, yTopEnd, yb + r, 0));
  return loft(rows);
}

function buildDiffuser() {
  const ns = 12;
  const nx = 10;
  const ramp = [];
  const wallLow = [];
  const wallHigh = [];
  for (let k = 0; k <= ns; k++) {
    const s = k / ns;
    const row = [];
    for (let i = 0; i <= nx; i++) {
      const x = (i / nx) * DIFF.hx;
      row.push(new THREE.Vector3(x, diffRamp(s), lerp(DIFF.z0, diffEndZ(x), s)));
    }
    ramp.push(row);
    if (k === 0) continue; // the wall has no height where the ramp leaves the floor
    const last = row[nx];
    wallLow.push(new THREE.Vector3(DIFF.hx, FLOOR_Y, last.z));
    wallHigh.push(last.clone());
  }
  return { half: [loft(ramp), loft([wallLow, wallHigh]), diffuserFin(0.235), diffuserFin(0.46)], centre: diffuserFin(0) };
}

/* --------------------------------------------------------------------------
   12. MATERIALS made here (paint, chrome and glass come from main.js)
   -------------------------------------------------------------------------- */
function grilleTexture() {
  if (typeof document === 'undefined') return null; // e.g. building in Node: no canvas
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2a2b2f';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#050506';
  // honeycomb-ish mesh: staggered rounded holes
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const x = col * 16 + (row % 2 ? 8 : 0) + 8;
      const y = row * 16 + 8;
      ctx.beginPath();
      ctx.arc(x % 64, y, 6.2, 0, Math.PI * 2);
      ctx.fill();
      if (x > 56) {
        ctx.beginPath();
        ctx.arc(x - 64, y, 6.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeMaterials() {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  return {
    tyre: std({ color: 0x111112, roughness: 0.88, metalness: 0 }),
    black: std({ color: 0x0a0a0c, roughness: 0.25, metalness: 0.4 }), // gloss black trim
    carbon: std({ color: 0x0b0c0e, roughness: 0.5, metalness: 0.15, side: THREE.DoubleSide }), // dark satin carbon aero parts
    dark: std({ color: 0x050506, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }), // wells, floor, cavities
    grille: std({ color: 0xffffff, map: grilleTexture(), roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide }),
    cabin: std({ color: 0x2a1d17, roughness: 0.8, metalness: 0, side: THREE.DoubleSide }),
    disc: std({ color: 0x6b6e73, roughness: 0.45, metalness: 0.85 }),
    calliper: std({ color: 0x9da3aa, roughness: 0.35, metalness: 0.6 }),
    housing: std({ color: 0x050608, roughness: 0.08, metalness: 0.6 }),
    head: std({ color: 0xffffff, emissive: 0xdfe9ff, emissiveIntensity: 1.6, roughness: 0.2 }),
    tail: std({ color: 0xa00d12, emissive: 0xff1010, emissiveIntensity: 0.35, roughness: 0.25, metalness: 0.1 }),
  };
}

/* --------------------------------------------------------------------------
   13. createCar — assemble everything (see CONTRACT.md for the names)
   -------------------------------------------------------------------------- */
export function createCar({ paint, chrome, glass, tier = 'high' }) {
  if (!['low', 'medium', 'high'].includes(tier)) tier = 'high';
  rows = null;
  for (const slot of memo) slot.z = NaN;
  const m = makeMaterials();
  const segs = { low: 36, medium: 48, high: 64 }[tier];

  const model = new THREE.Group();
  model.name = 'model';
  const main = new THREE.Group();
  main.name = 'main';
  model.add(main);
  const add = (name, geo, mat, parent = main) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    parent.add(mesh);
    return mesh;
  };

  // painted shell + everything cut from the same surface
  const grid = bodySurface(tier);
  // body outlines near the nose and tail (shared by the fascias and the tail light)
  const frontTable = outlineTable(-2.32, -1.85, 0.015);
  const rearTable = outlineTable(1.9, 2.3, 0.015);
  const fascias = buildFascias(tier, frontTable, rearTable);
  const mirrors = buildMirrors();
  add('body', merge([trimmedPatch(grid, { keep: bodyKeep, mirror: true }), ...fascias.paint, bothSides([...buildLouvreSlats(), mirrors.housing])]), paint);
  add('glass', buildGlass(grid), glass);

  const head = buildHeadlights(grid);
  const tail = buildTailLight(Math.round(segs * 1.25), rearTable);
  add('trim', bothSides([...head.rings, mirrors.face]), chrome);
  add('lights', head.leds, m.head);
  add('brakes', tail.geo, m.tail);
  add('headlight_housing', head.housing, m.housing);
  add('grille', fascias.grille, m.grille);
  const diffuser = buildDiffuser();
  add('aero_carbon', merge([bothSides([...buildSplitter(), ...diffuser.half]), diffuser.centre]), m.carbon);
  add('gloss_black', merge([bothSides(mirrors.arm), fascias.bezel]), m.black);
  add('underbody', merge([bothSides([...buildWheelWells(Math.round(segs / 2)), ...buildIntakeDucts()]), buildLouvreBase(grid), buildFloor(), fascias.recess]), m.dark);
  add('cabin', buildCabin(), m.cabin);

  // wheels: the groups spin (rotation.x); callipers stay in `main`
  const tyreGeo = buildTyre(segs);
  const rimGeo = buildRim(segs);
  const discGeo = buildDisc(Math.max(32, segs / 2));
  const calliper = buildCalliper();
  const callipers = [];
  for (const [id, x, z] of [['fl', -TRACK, FRONT_Z], ['fr', TRACK, FRONT_Z], ['rl', -TRACK, REAR_Z], ['rr', TRACK, REAR_Z]]) {
    const wheel = new THREE.Object3D();
    wheel.name = `wheel_${id}`;
    wheel.position.set(x, AXLE_Y, z);
    model.add(wheel);
    add('tyre', tyreGeo, m.tyre, wheel);
    const rim = add(`rim_${id}`, rimGeo, chrome, wheel);
    rim.position.x = Math.sign(x) * RIM_OFFSET; // spoke face on the outer side
    if (x < 0) rim.rotation.y = Math.PI;
    const disc = add('brake_disc', discGeo, m.disc, wheel);
    if (x < 0) disc.rotation.y = Math.PI;
    if (x > 0) callipers.push(calliper.clone().translate(x, AXLE_Y, z)); // right side; mirrored below
  }
  add('callipers', bothSides(callipers), m.calliper);

  const h = head.centre;
  const t = tail.centre;
  model.userData = {
    rimRadius: RIM_R,
    headlights: [[+h.x.toFixed(3), +h.y.toFixed(3), +h.z.toFixed(3)], [-h.x.toFixed(3), +h.y.toFixed(3), +h.z.toFixed(3)]],
    taillights: [[+t.x.toFixed(3), +t.y.toFixed(3), +t.z.toFixed(3)], [-t.x.toFixed(3), +t.y.toFixed(3), +t.z.toFixed(3)]],
  };
  rows = null; // free the caches
  for (const slot of memo) slot.z = NaN;
  return model;
}
