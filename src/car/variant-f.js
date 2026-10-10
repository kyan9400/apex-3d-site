/*
  Apex GT — design F: "Grand tourer"
  ----------------------------------
  A front-mid-engine luxury GT: long bonnet, cabin set well back, short rear overhang, a fastback roof that runs
  into a Kamm tail with a small lip, sculpted coves behind the front wheels, slim headlights and round quad tail
  lights.

  How the body is made (everything is code, no model files):
  1. LOFT — the painted shell is one smooth surface. At every station along the car (z) we compute six key points
     of a half cross-section (rocker → shoulder → deck edge → glass base → roof edge → centre line) from simple
     z → value curves, and join them with a smooth Catmull-Rom curve. Mirroring gives the full section; stacking
     sections gives a grid of vertices.
  2. END CAPS — near the nose and the tail the sections shrink along a superellipse: this rounds the nose (which
     stops short of a point and so leaves the air-intake opening) and gives the flat, cut-off Kamm tail.
  3. FENDERS — the wheel-arch openings are the lower edge of each section following a circle round the wheel;
     fender bulges, arch-lip flares and the side coves are smooth displacements blended into the loft.
  4. GREENHOUSE — the cabin is part of the same surface (so the fastback flows into the tail). Windows are
     regions of the surface grid that are given the glass material instead of paint: the glass is flush.
  5. DETAILS — lights, grille, vents etc. are small patches projected onto the surface, plus simple parts.
*/
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------------------------
// Fixed layout (CONTRACT.md): car faces −z, ground at y = 0
const WHEEL_X = 0.83, WHEEL_Y = 0.36, WHEEL_ZF = -1.16, WHEEL_ZR = 1.5;
const TYRE_R = 0.36, TYRE_W = 0.27, RIM_R = 0.28;
const ARCH_R = 0.405; // arch opening radius: tyre + 4.5 cm clearance
const Z_NOSE = -2.27, Z_TAIL = 2.25;
const NOSE_CAP = 0.42, TAIL_CAP = 0.1; // length of the rounded end caps
const ZN0 = Z_NOSE + NOSE_CAP, ZT0 = Z_TAIL - TAIL_CAP; // where the caps start

// Window layout, in "station" units (≈ z). The side window's rear edge is slanted (see warpRho).
const RHO_COWL = -0.3; // windscreen base
const RHO_WS_TOP = 0.4; // windscreen top / roof front
const RHO_RW0 = 0.92, RHO_RW1 = 1.84; // fastback rear glass
const SIDE_END = 1.12; // side window rear edge (logical)
const CH = 0.035; // chrome window-surround width
// Positions across the section (σ: 0 = rocker, 1 shoulder, 2 deck edge, 3 glass base, 4 roof edge, 5 centre)
const S_BELT0 = 3.04, S_BELT1 = 3.1, S_TOP0 = 3.86, S_TOP1 = 3.92, S_WS = 4.08;

// ---------------------------------------------------------------------------------------------
// Small maths helpers
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const gauss = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));
const smax = (a, b, k) => 0.5 * (a + b + Math.sqrt((a - b) ** 2 + k * k)); // smooth max
const smin = (a, b, k) => 0.5 * (a + b - Math.sqrt((a - b) ** 2 + k * k)); // smooth min

// A smooth curve through [z, value] key points (monotone cubic: no overshoot between keys)
function curve(pts) {
  const n = pts.length, xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) continue;
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

// ---------------------------------------------------------------------------------------------
// The design: z → value curves (side view, plan view and section shape)

// centre line of the top: nose → bonnet → windscreen → roof → fastback → lip spoiler
const topY = curve([
  [-1.85, 0.632], [-1.6, 0.712], [-1.16, 0.778], [-0.6, 0.815], [-0.3, 0.828], [-0.05, 0.915], [0.2, 1.03],
  [0.42, 1.11], [0.62, 1.148], [0.85, 1.142], [1.15, 1.095], [1.5, 1.025], [1.85, 0.955], [2.03, 0.93], [2.15, 0.958],
]);
// half width at the shoulder (plan view), before the fender bulges are added
const baseHalfW = curve([
  [-1.85, 0.905], [-1.6, 0.945], [-1.16, 0.97], [-0.7, 0.955], [-0.1, 0.945], [0.5, 0.95], [1.0, 0.975],
  [1.5, 0.99], [1.9, 0.965], [2.15, 0.93],
]);
const shoulderY = curve([[-1.85, 0.52], [-1.16, 0.62], [-0.4, 0.635], [0.5, 0.645], [1.45, 0.7], [2.15, 0.7]]);
// deck edge: where the side rolls over into the top (fender crowns, door shoulder, rear haunch)
const deckEdgeY = curve([
  [-1.85, 0.622], [-1.6, 0.745], [-1.16, 0.84], [-0.7, 0.845], [-0.25, 0.838], [0.5, 0.845], [1.0, 0.865],
  [1.45, 0.895], [1.9, 0.895], [2.15, 0.9],
]);
const deckRoll = curve([[-1.85, 0.11], [-1.16, 0.13], [-0.3, 0.13], [0.5, 0.125], [1.45, 0.11], [2.15, 0.12]]);
// side-window sill line (kicks up towards the rear haunch)
const beltY = curve([[-0.4, 0.83], [0.4, 0.85], [1.0, 0.875], [1.5, 0.925], [1.9, 0.95]]);
// lateral position of the glass base and the roof edge
const glassX = curve([[-1.85, 0.62], [-0.3, 0.74], [0.5, 0.78], [1.2, 0.77], [1.8, 0.72], [2.15, 0.68]]);
const roofX = curve([[-1.85, 0.36], [-0.8, 0.4], [-0.3, 0.6], [0.4, 0.6], [1.0, 0.57], [1.6, 0.5], [2.15, 0.4]]);
// how much the top surface drops from the centre line to the sides (bonnet / roof crown)
const crownAmt = curve([[-1.85, 0.03], [-0.5, 0.025], [0.2, 0.1], [1.2, 0.1], [1.8, 0.08], [2.15, 0.06]]);
// lower edge of the body (sill / bumper bottoms)
const sillY = curve([[-1.85, 0.175], [-1.6, 0.175], [-0.7, 0.19], [1.0, 0.19], [1.9, 0.25], [2.15, 0.27]]);

const halfW = (z) => baseHalfW(z) + 0.022 * gauss(z, WHEEL_ZF, 0.42) + 0.024 * gauss(z, WHEEL_ZR, 0.48); // + fender bulges
const crownY = (x, z) => topY(z) - crownAmt(z) * (x / 0.9) ** 2;
const archNear = (z) => Math.max(gauss(z, WHEEL_ZF, 0.5), gauss(z, WHEEL_ZR, 0.5));

// Height of the arch opening at z (0 when outside the arch)
function archTop(z) {
  for (const wz of [WHEEL_ZF, WHEEL_ZR]) {
    const dz = z - wz;
    if (Math.abs(dz) < ARCH_R) return WHEEL_Y + Math.sqrt(ARCH_R * ARCH_R - dz * dz);
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------
// Cross-sections

// End caps. Inside a cap the section shape is frozen (the one at the cap start) and shrunk: in x along a
// superellipse (rounded plan view), and above the height `cy` towards cy (rounds the top edge over). Below cy
// nothing is scaled, so the bumper face stays vertical and the lower edge stays level.
// The nose does not shrink to a point: it stops at NOSE_MOUTH of its width, so the upper part rolls down into a
// horizontal lip and the lower part leaves an opening: the air intake (a point would pinch the reflections).
// φ runs 0 → π/2 from the cap start to the tip.
function capAt(end, phi) {
  const s = Math.sin(phi), c = Math.cos(phi);
  if (end < 0) return { z: ZN0 - NOSE_CAP * Math.pow(s, 2 / 2.1), fx: NOSE_MOUTH + (1 - NOSE_MOUTH) * Math.pow(c, 2 / 2.1), fyT: Math.pow(c, 2 / 2.6), cy: NOSE_CY };
  return { z: ZT0 + TAIL_CAP * Math.pow(s, 2 / 4), fx: Math.pow(c, 2 / 4), fyT: Math.pow(c, 2 / 7), cy: TAIL_CY };
}
const NOSE_CY = 0.34, TAIL_CY = 0.62, NOSE_MOUTH = 0.42;
const PHI_N = (rho) => (clamp((ZN0 - rho) / NOSE_CAP, 0, 1) * Math.PI) / 2;
const PHI_T = (rho) => (clamp((rho - ZT0) / TAIL_CAP, 0, 1) * Math.PI) / 2;

// Station parameter ρ (≈ z) → z position, the six half-section key points and their curve tangents
function stationKeys(rho) {
  let cap = null;
  if (rho < ZN0) cap = capAt(-1, PHI_N(rho));
  else if (rho > ZT0) cap = capAt(1, PHI_T(rho));
  const z = cap ? cap.z : rho;
  const K = baseKeys(clamp(z, ZN0, ZT0), z);
  if (cap) for (const k of K) {
    k[0] *= cap.fx;
    if (k[1] > cap.cy) k[1] = cap.cy + (k[1] - cap.cy) * cap.fyT;
  }
  return { z, K, T: sectionTangents(K) };
}

// The six half-section key points at z (zc = z clamped to the part between the caps)
function baseKeys(zc, z) {
  const W = halfW(zc);
  const yL = Math.max(sillY(zc), archTop(z));
  // the sill tucks under, more so at the front corners; the arch lips stand out
  const tuck = 0.085 - 0.065 * archNear(zc) + 0.05 * smooth(-1.45, -1.85, zc);
  const y1 = smax(shoulderY(zc), yL + 0.035, 0.02);
  const y2 = smax(deckEdgeY(zc), y1 + 0.035, 0.02);
  const x3 = glassX(zc), x4 = roofX(zc);
  const y3 = smin(crownY(x3, zc), beltY(zc), 0.025); // glass base: the belt in the cabin, on the deck elsewhere
  return [
    [W - tuck, yL], // K0 lower edge (rocker / arch edge)
    [W, y1], // K1 shoulder (widest point)
    [W - deckRoll(zc), y2], // K2 deck edge
    [x3, y3], // K3 glass base
    [x4, crownY(x4, zc)], // K4 roof edge
    [0, topY(zc)], // K5 centre line
  ];
}

// The half section is a centripetal Catmull-Rom curve through K0..K5. For each of the 5 segments we store the
// Hermite tangents (m1x, m1y, m2x, m2y) once per station, so evaluating a point is cheap.
function sectionTangents(K) {
  const T = new Float64Array(20);
  const dist = (a, b) => Math.max(Math.sqrt(Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2)), 1e-4);
  for (let i = 0; i < 5; i++) {
    const p1 = K[i], p2 = K[i + 1];
    const p0 = i === 0 ? [2 * K[0][0] - K[1][0], 2 * K[0][1] - K[1][1]] : K[i - 1]; // extrapolated before K0
    const p3 = i === 4 ? [-K[4][0], K[4][1]] : K[i + 2]; // mirrored roof edge keeps the centre line flat
    const d01 = dist(p0, p1), d12 = dist(p1, p2), d23 = dist(p2, p3);
    for (let c = 0; c < 2; c++) {
      T[i * 4 + c] = TENSION[i] * d12 * ((p1[c] - p0[c]) / d01 - (p2[c] - p0[c]) / (d01 + d12) + (p2[c] - p1[c]) / d12);
      T[i * 4 + 2 + c] = TENSION[i + 1] * d12 * ((p2[c] - p1[c]) / d12 - (p3[c] - p1[c]) / (d12 + d23) + (p3[c] - p2[c]) / d23);
    }
  }
  return T;
}
// Shorter tangents at a key point = a tighter turn there. The shoulder (K1) and the deck edge (K2) get crisp
// feature lines that catch a sharp highlight along the side; the rest stays soft.
const TENSION = [1, 0.5, 0.65, 1, 1, 1];

// Point [x, y] on the half section (x ≥ 0) of station st at σ in 0..5 (written into `out` if given)
function halfSectionPoint(st, sigma, out = [0, 0]) {
  const i = Math.min(4, Math.floor(sigma)), t = sigma - i;
  const p1 = st.K[i], p2 = st.K[i + 1], T = st.T, o = i * 4;
  const t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
  out[0] = h00 * p1[0] + h10 * T[o] + h01 * p2[0] + h11 * T[o + 2];
  out[1] = h00 * p1[1] + h10 * T[o + 1] + h01 * p2[1] + h11 * T[o + 3];
  return out;
}

// Smooth displacements that sculpt the sides (applied to |x|)
function sideSculpt(x, y, z) {
  const ax = Math.abs(x);
  if (ax < 0.6) return x;
  let d = 0;
  // cove behind the front wheel: crisp front edge, fading out along the door
  const fz = smooth(-0.74, -0.66, z) * (1 - smooth(-0.45, 0.35, z));
  const fy = smooth(0.27, 0.36, y) * (1 - smooth(0.53, 0.575, y));
  d -= 0.042 * fz * fy;
  // flared lip round each wheel arch
  const wz = Math.abs(z - WHEEL_ZF) < Math.abs(z - WHEEL_ZR) ? WHEEL_ZF : WHEEL_ZR; // nearest wheel
  const r = Math.sqrt((z - wz) ** 2 + (y - WHEEL_Y) ** 2);
  if (r < ARCH_R + 0.09 && y > 0.15) d += 0.012 * (1 - smooth(ARCH_R, ARCH_R + 0.09, r));
  const w = smooth(0.6, 0.8, ax); // only on the sides
  return Math.sign(x) * (ax + d * w);
}

// Raised centre section ("power bulge") on the bonnet
function bonnetBulge(x, y, z) {
  if (y < 0.6 || z < -1.9 || z > -0.35) return 0;
  const fx = 1 - smooth(0.2, 0.4, Math.abs(x));
  const fz = smooth(-1.85, -1.35, z) * (1 - smooth(-0.62, -0.38, z));
  return 0.016 * fx * fz;
}

// Full surface point of station st at full-section σ in 0..10 (0 = left rocker, 5 = top centre, 10 = right
// rocker), written into out[o..o+2]
const HP = [0, 0];
function surfacePoint(st, sigma, out = [0, 0, 0], o = 0) {
  const right = sigma > 5;
  const p = halfSectionPoint(st, right ? 10 - sigma : sigma, HP);
  const x = right ? p[0] : -p[0];
  out[o] = sideSculpt(x, p[1], st.z);
  out[o + 1] = p[1] + bonnetBulge(x, p[1], st.z);
  out[o + 2] = st.z;
  return out;
}

// The side window's rear edge is slanted: rows near SIDE_END are shifted along the car, more at the sill than at
// the roof, so a straight grid row follows the slanted edge (the surface itself is unchanged).
function warpRho(rho, sigma) {
  const s = sigma > 5 ? 10 - sigma : sigma;
  let w = 0;
  if (s > 2.94 && s < 4.02) {
    const wb = 0.18, wt = -0.12; // shift at the sill and at the roof edge
    if (s < S_BELT1) w = wb * smooth(2.94, S_BELT0, s);
    else if (s < S_TOP0) w = lerp(wb, wt, (s - S_BELT1) / (S_TOP0 - S_BELT1));
    else w = wt * (1 - smooth(S_TOP1, 4.02, s));
  }
  if (!w) return rho;
  const d = Math.abs(rho - (SIDE_END + CH / 2));
  const hat = d < 0.06 ? 1 : Math.max(0, 1 - (d - 0.06) / 0.4);
  return rho + w * hat;
}

// ---------------------------------------------------------------------------------------------
// Grid layout: station rows and section columns

function makeRows(q) {
  const rows = [];
  // nose cap (dense towards the tip)
  for (let i = q.cap; i >= 1; i--) rows.push(ZN0 - (NOSE_CAP * i) / q.cap);
  // main body: finer steps through the wheel arches so the arch edge is round
  let z = ZN0;
  while (z < ZT0 - 1e-6) {
    rows.push(z);
    const inArch = Math.abs(z - WHEEL_ZF) < ARCH_R + 0.03 || Math.abs(z - WHEEL_ZR) < ARCH_R + 0.03;
    z += inArch ? q.archStep : q.step;
  }
  // feature rows: arch corners, windows, cove edge
  const feats = [RHO_COWL, RHO_WS_TOP, RHO_RW0, RHO_RW1, SIDE_END, SIDE_END + CH, -0.74, -0.64, ZT0];
  for (const wz of [WHEEL_ZF, WHEEL_ZR]) {
    const c = Math.sqrt(ARCH_R ** 2 - (WHEEL_Y - sillY(wz)) ** 2);
    feats.push(wz - c, wz, wz + c);
  }
  for (let i = 1; i <= q.tailCap; i++) rows.push(ZT0 + (TAIL_CAP * i) / q.tailCap);
  const all = rows.concat(feats).sort((a, b) => a - b);
  const out = [];
  for (const r of all) {
    if (out.length && r - out[out.length - 1] < 0.006) {
      if (feats.includes(r)) out[out.length - 1] = r; // feature rows win
      continue;
    }
    out.push(r);
  }
  return out;
}

function makeCols(q) {
  const half = [];
  q.seg.forEach((n, i) => {
    for (let k = 0; k < n; k++) half.push(i + k / n);
  });
  half.push(5);
  half.push(S_BELT0, S_BELT1, S_TOP0, S_TOP1, S_WS, 2.94, 4.02);
  half.sort((a, b) => a - b);
  const h = half.filter((s, i) => i === 0 || s - half[i - 1] > 0.012);
  const full = h.slice();
  for (let i = h.length - 2; i >= 0; i--) full.push(10 - h[i]);
  return full;
}

// Material class of one grid cell (logical coordinates)
const PAINT = 0, GLASS = 1, CHROME = 2;
function cellClass(rho, sigma) {
  const s = sigma > 5 ? 10 - sigma : sigma;
  if (rho > RHO_COWL && rho < SIDE_END + CH) {
    if (s > S_BELT0 && s < S_BELT1) return CHROME;
    if (s > S_TOP0 && s < S_TOP1) return CHROME;
    if (s > S_BELT1 && s < S_TOP0) return rho < SIDE_END ? GLASS : CHROME;
  }
  if (s > S_WS && ((rho > RHO_COWL && rho < RHO_WS_TOP) || (rho > RHO_RW0 && rho < RHO_RW1))) return GLASS;
  return PAINT;
}

// Copy the first `count` triangle indices of `idx` out of a big vertex array into a compact geometry
function subGeometry(pos, nor, idx, count) {
  const map = new Int32Array(pos.length / 3).fill(-1);
  let n = 0;
  for (let k = 0; k < count; k++) if (map[idx[k]] < 0) map[idx[k]] = n++;
  const p = new Float32Array(n * 3), q = new Float32Array(n * 3), out = new Uint32Array(count);
  for (let i = 0; i < map.length; i++) {
    const j = map[i];
    if (j < 0) continue;
    for (let c = 0; c < 3; c++) {
      p[j * 3 + c] = pos[i * 3 + c];
      q[j * 3 + c] = nor[i * 3 + c];
    }
  }
  for (let k = 0; k < count; k++) out[k] = map[idx[k]];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(q, 3));
  g.setIndex(new THREE.BufferAttribute(out, 1));
  return g;
}

// Smooth vertex normals straight from the grid: cross product of the along-car and across-section directions
// (central differences). Works on the whole grid at once, so paint, glass and chrome shade as one surface.
function gridNormals(pos, nR, nC) {
  const nor = new Float32Array(pos.length);
  for (let r = 0; r < nR; r++) {
    const r0 = Math.max(0, r - 1), r1 = Math.min(nR - 1, r + 1);
    for (let c = 0; c < nC; c++) {
      const c0 = Math.max(0, c - 1), c1 = Math.min(nC - 1, c + 1);
      const A = (r0 * nC + c) * 3, B = (r1 * nC + c) * 3, C = (r * nC + c0) * 3, D = (r * nC + c1) * 3;
      const ux = pos[B] - pos[A], uy = pos[B + 1] - pos[A + 1], uz = pos[B + 2] - pos[A + 2];
      const vx = pos[D] - pos[C], vy = pos[D + 1] - pos[C + 1], vz = pos[D + 2] - pos[C + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz), o = (r * nC + c) * 3;
      if (l > 1e-10) {
        nor[o] = nx / l;
        nor[o + 1] = ny / l;
        nor[o + 2] = nz / l;
      } else if (r > 0) {
        nor[o] = nor[o - nC * 3]; // collapsed point (tail tip): borrow the previous row's normal
        nor[o + 1] = nor[o - nC * 3 + 1];
        nor[o + 2] = nor[o - nC * 3 + 2];
      } else nor[o + 2] = -1;
    }
  }
  return nor;
}

// Build the lofted shell. Paint, glass and the cabin liner share one vertex buffer (each has its own index);
// the chrome window strips are copied out so they can be merged with the other chrome parts.
function buildShell(q) {
  const rows = makeRows(q), cols = makeCols(q);
  const nR = rows.length, nC = cols.length;
  const cache = new Map(); // station key points, computed once per station
  const keysAt = (rho) => {
    let st = cache.get(rho);
    if (!st) cache.set(rho, (st = stationKeys(rho)));
    return st;
  };
  const pos = new Float32Array(nR * nC * 3);
  for (let r = 0; r < nR; r++) {
    const st = keysAt(rows[r]);
    for (let c = 0; c < nC; c++) {
      const rho = warpRho(rows[r], cols[c]); // only differs near the side window's slanted rear edge
      surfacePoint(rho === rows[r] ? st : keysAt(rho), cols[c], pos, (r * nC + c) * 3);
    }
  }
  const nor = gridNormals(pos, nR, nC);
  // two triangles per grid cell, sorted into paint / glass / chrome
  const nQ = (nR - 1) * (nC - 1);
  const lists = [new Uint32Array(nQ * 6), new Uint32Array(nQ * 6), new Uint32Array(nQ * 6)], counts = [0, 0, 0];
  for (let r = 0; r < nR - 1; r++) {
    const rho = (rows[r] + rows[r + 1]) / 2;
    for (let c = 0; c < nC - 1; c++) {
      const a = r * nC + c, b = a + 1, d = a + nC, e = d + 1;
      const cls = cellClass(rho, (cols[c] + cols[c + 1]) / 2);
      const L = lists[cls], n = counts[cls];
      // triangles (a, d, b) and (b, d, e): wound so the normals face outwards
      L[n] = a; L[n + 1] = d; L[n + 2] = b;
      L[n + 3] = b; L[n + 4] = d; L[n + 5] = e;
      counts[cls] = n + 6;
    }
  }
  // cabin liner: the inside of the shell (seen through the windows); every other row/column is plenty
  const rStep = [], cStep = [];
  for (let r = 0; r < nR; r += 2) rStep.push(r);
  if (rStep[rStep.length - 1] !== nR - 1) rStep.push(nR - 1);
  for (let c = 0; c < nC; c += 2) cStep.push(c);
  if (cStep[cStep.length - 1] !== nC - 1) cStep.push(nC - 1);
  const inner = new Uint32Array((rStep.length - 1) * (cStep.length - 1) * 6);
  let k = 0;
  for (let i = 0; i < rStep.length - 1; i++) {
    for (let j = 0; j < cStep.length - 1; j++) {
      const a = rStep[i] * nC + cStep[j], b = rStep[i] * nC + cStep[j + 1];
      const d = rStep[i + 1] * nC + cStep[j], e = rStep[i + 1] * nC + cStep[j + 1];
      inner[k++] = a; inner[k++] = d; inner[k++] = b;
      inner[k++] = b; inner[k++] = d; inner[k++] = e;
    }
  }
  const posAttr = new THREE.BufferAttribute(pos, 3), norAttr = new THREE.BufferAttribute(nor, 3);
  const shared = (idx) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', posAttr);
    g.setAttribute('normal', norAttr);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    return g;
  };
  return {
    paint: shared(lists[PAINT].slice(0, counts[PAINT])),
    glass: shared(lists[GLASS].slice(0, counts[GLASS])),
    liner: shared(inner),
    chrome: subGeometry(pos, nor, lists[CHROME], counts[CHROME]),
  };
}

// ---------------------------------------------------------------------------------------------
// Projecting details onto the nose / tail face

// The cap section is the frozen section at the cap start, scaled. So to find the surface seen straight from the
// front/rear we tabulate, once per end: that section's half width against height, and the cap scaling against φ.
const capTables = new Map();
function capTable(end) {
  let t = capTables.get(end);
  if (t) return t;
  const st = stationKeys(end < 0 ? ZN0 : ZT0);
  const poly = [];
  for (let i = 0; i <= 96; i++) poly.push(halfSectionPoint(st, (5 * i) / 96));
  const ys = poly.map((p) => p[1]);
  const y0 = Math.min(...ys), y1 = Math.max(...ys), N = 200, M = 256;
  const hw = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const y = lerp(y0, y1, i / N);
    let best = -1; // outermost crossing of the section at this height
    for (let k = 1; k < poly.length; k++) {
      const a = poly[k - 1], b = poly[k];
      if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1]) best = Math.max(best, lerp(a[0], b[0], (y - a[1]) / (b[1] - a[1])));
    }
    hw[i] = best;
  }
  const z = new Float32Array(M + 1), fx = new Float32Array(M + 1), fyT = new Float32Array(M + 1);
  for (let i = 0; i <= M; i++) {
    const c = capAt(end, ((i / M) * Math.PI) / 2);
    z[i] = c.z;
    fx[i] = c.fx;
    fyT[i] = c.fyT;
  }
  t = { y0, y1, N, hw, M, z, fx, fyT, cy: end < 0 ? NOSE_CY : TAIL_CY };
  capTables.set(end, t);
  return t;
}

// Surface point seen straight from the front (end = −1) or the rear (end = +1) at (x, y), or null
function projectEnd(x, y, end) {
  const t = capTable(end), ax = Math.abs(x);
  // how far inside the cap section (x, y) is at table step i (> 0 = inside)
  const margin = (i) => {
    if (t.fx[i] < 1e-5 || t.fyT[i] < 1e-5) return -1;
    const by = y > t.cy ? t.cy + (y - t.cy) / t.fyT[i] : y; // undo the vertical cap scaling
    if (by < t.y0 || by > t.y1) return -1;
    const f = ((by - t.y0) / (t.y1 - t.y0)) * t.N, k = Math.min(t.N - 1, Math.floor(f));
    return lerp(t.hw[k], t.hw[k + 1], f - k) * t.fx[i] - ax;
  };
  if (margin(0) <= 0) return null;
  let a = 0, b = t.M; // a inside, b outside
  while (b - a > 1) {
    const m = (a + b) >> 1;
    if (margin(m) > 0) a = m;
    else b = m;
  }
  const ma = margin(a), mb = margin(b);
  const z = lerp(t.z[a], t.z[b], ma / Math.max(1e-9, ma - mb));
  return new THREE.Vector3(x, y, z);
}

// Point and outward normal on the nose/tail face at (x, y)
function endFrame(x, y, end) {
  const p = projectEnd(x, y, end);
  const px = projectEnd(x + 0.01, y, end) || p, py = projectEnd(x, y + 0.01, end) || p;
  const n = new THREE.Vector3().subVectors(px, p).cross(new THREE.Vector3().subVectors(py, p)).normalize();
  if (n.z * end < 0 || !Number.isFinite(n.x)) n.negate();
  if (!Number.isFinite(n.x) || n.lengthSq() < 0.5) n.set(0, 0, end);
  return { p, n };
}

// Recompute normals, and flip the winding if they point into the body (dir = rough outward direction)
function orient(g, dir) {
  g.computeVertexNormals();
  const n = g.attributes.normal;
  let dot = 0;
  for (let i = 0; i < n.count; i++) dot += n.getX(i) * dir.x + n.getY(i) * dir.y + n.getZ(i) * dir.z;
  if (dot < 0) {
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.index.needsUpdate = true;
    g.computeVertexNormals();
  }
  return g;
}

// A patch draped on the nose/tail face: shape(u, v) → [x, y] in the front/rear view, raised `lift` off the paint
function projectedPatch(end, shape, nu, nv, lift) {
  const pos = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const [x, y] = shape(i / nu, j / nv);
      const p = projectEnd(x, y, end) || new THREE.Vector3(x, y, end < 0 ? ZN0 : ZT0);
      pos.push(p.x, p.y, p.z);
    }
  }
  return gridPatch(pos, nu, nv, new THREE.Vector3(0, 0, end), lift);
}

// Patch on the shell in station/section coordinates (rho0..rho1, σ0..σ1), lifted off the surface
function shellPatch(rho0, rho1, s0, s1, nu, nv, lift) {
  const pos = [];
  for (let j = 0; j <= nv; j++) {
    const st = stationKeys(lerp(rho0, rho1, j / nv));
    for (let i = 0; i <= nu; i++) pos.push(...surfacePoint(st, lerp(s0, s1, i / nu)));
  }
  const side = (s0 + s1) / 2 > 5 ? 1 : -1;
  return gridPatch(pos, nu, nv, new THREE.Vector3(side, 0, 0), lift);
}

// (nu+1) x (nv+1) grid of points → geometry facing roughly dir, lifted along its normals off the paint
function gridPatch(pos, nu, nv, dir, lift) {
  const idx = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  orient(g, dir);
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * lift, p.getY(i) + n.getY(i) * lift, p.getZ(i) + n.getZ(i) * lift);
  return g;
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers

// merge a list of geometries (drops uv so all attribute sets match)
function merge(list) {
  for (const g of list) {
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
  }
  return mergeGeometries(list, false);
}

// lathe around the x axis: pts = [[radius, x], ...]
function latheX(pts, segs) {
  const g = new THREE.LatheGeometry(pts.map(([r, x]) => new THREE.Vector2(r, x)), segs);
  g.rotateZ(-Math.PI / 2); // lathe axis y → x
  return g;
}

function mesh(geo, mat, name) {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  return m;
}

// ---------------------------------------------------------------------------------------------
// Wheels

function tyreGeometry(q) {
  const hw = TYRE_W / 2;
  // cross-section of the tyre (radius, x): bead → sidewall → tread → sidewall → bead
  const prof = [
    [0.27, -hw + 0.012], [0.3, -hw - 0.002], [0.33, -hw + 0.002], [0.35, -hw + 0.014], [TYRE_R, -hw + 0.04],
    [TYRE_R, hw - 0.04], [0.35, hw - 0.014], [0.33, hw - 0.002], [0.3, hw + 0.002], [0.27, hw - 0.012],
  ];
  return latheX(prof, q.wheelSegs);
}

// Multi-spoke rim, face pointing +x, centred on its own origin
function rimGeometry(q) {
  const parts = [];
  // outer lip
  parts.push(latheX([[0.258, -0.004], [0.27, 0.012], [0.285, 0.016], [0.292, 0.006], [0.29, -0.012]], q.wheelSegs));
  // centre hub with a domed cap
  parts.push(latheX([[0.078, -0.03], [0.078, 0.012], [0.065, 0.026], [0.04, 0.034], [0.0001, 0.037]], q.wheelSegs / 2));
  // spokes: tapered, dished blades
  const n = q.spokes;
  for (let k = 0; k < n; k++) {
    const g = new THREE.BoxGeometry(0.02, 1, 1, 1, 4, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = p.getY(i) + 0.5; // 0 at hub, 1 at lip
      const r = lerp(0.07, 0.268, t);
      const w = lerp(0.03, 0.017, t);
      const dish = 0.012 * (1 - t) - 0.004 * Math.sin(Math.PI * t); // hub stands slightly proud
      p.setXYZ(i, p.getX(i) + dish, r, p.getZ(i) * w);
    }
    g.rotateX((k / n) * Math.PI * 2);
    g.computeVertexNormals();
    parts.push(g);
  }
  return merge(parts);
}

// brake disc + the inner rim barrel (dark metal, spins with the wheel)
function discGeometry(q) {
  const disc = new THREE.CylinderGeometry(0.2, 0.2, 0.028, q.wheelSegs, 1);
  disc.rotateZ(Math.PI / 2);
  const hat = new THREE.CylinderGeometry(0.09, 0.09, 0.06, q.wheelSegs / 2, 1);
  hat.rotateZ(Math.PI / 2);
  hat.translate(0.02, 0, 0);
  // barrel seen through the spokes (normals face the axle)
  const barrel = latheX([[0.272, 0.08], [0.272, -0.12]], q.wheelSegs);
  return merge([disc, hat, barrel]);
}

// ---------------------------------------------------------------------------------------------
// The car

const TIERS = {
  low: { cap: 10, tailCap: 5, step: 0.085, archStep: 0.05, seg: [5, 4, 4, 6, 7], wheelSegs: 32, spokes: 10, light: 10, lift: 0.006 },
  medium: { cap: 14, tailCap: 6, step: 0.06, archStep: 0.034, seg: [7, 5, 5, 8, 9], wheelSegs: 40, spokes: 12, light: 14, lift: 0.004 },
  high: { cap: 18, tailCap: 8, step: 0.042, archStep: 0.024, seg: [9, 7, 7, 10, 12], wheelSegs: 56, spokes: 14, light: 20, lift: 0.0025 },
};

export function createCar({ paint, chrome, glass, tier = 'high' }) {
  const q = TIERS[tier] || TIERS.high;
  const model = new THREE.Group();
  model.name = 'model';
  const main = new THREE.Group();
  main.name = 'main';
  model.add(main);

  // materials owned by this design
  const dark = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.7, metalness: 0.1, side: THREE.DoubleSide });
  const liner = new THREE.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.9, side: THREE.BackSide });
  const leather = new THREE.MeshStandardMaterial({ color: 0x5a3a24, roughness: 0.7 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.92 });
  const discMat = new THREE.MeshStandardMaterial({ color: 0x55575c, roughness: 0.45, metalness: 0.85 });
  const calliperMat = new THREE.MeshStandardMaterial({ color: 0xa8854f, roughness: 0.35, metalness: 0.6 });
  const lensMat = new THREE.MeshStandardMaterial({ color: 0xf2f6ff, emissive: 0xcfdcff, emissiveIntensity: 0.6, roughness: 0.15 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x7a0608, emissive: 0xff1a12, emissiveIntensity: 0.15, roughness: 0.25 });

  // --- painted shell, glass, chrome window surrounds, liner
  const shell = buildShell(q);

  // --- mirrors (painted caps on short stalks)
  const mirrorParts = [], darkParts = [], trimParts = [shell.chrome];
  for (const s of [-1, 1]) {
    // teardrop pod (rounded front, flat back) on a slim painted arm rising from the door shoulder
    const cap = new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.62);
    cap.rotateX(-Math.PI / 2); // open side faces +z (backwards)
    cap.scale(0.115, 0.055, 0.1);
    cap.translate(s * 0.985, 0.94, -0.02);
    mirrorParts.push(cap);
    const arm = new THREE.BoxGeometry(0.2, 0.024, 0.07);
    arm.rotateZ(s * 0.32);
    arm.translate(s * 0.88, 0.905, -0.05);
    mirrorParts.push(arm);
    const face = new THREE.CircleGeometry(1, 18);
    face.scale(0.108, 0.05, 1);
    face.translate(s * 0.985, 0.94, 0.012);
    trimParts.push(face);
  }
  main.add(mesh(shell.paint, paint, 'body'));
  main.add(mesh(merge(mirrorParts), paint, 'mirrors'));
  main.add(mesh(shell.glass, glass, 'glass'));
  main.add(mesh(shell.liner, liner, 'cabin'));

  // --- headlights: slim strips at the nose corners (chrome housing + bright lens)
  const lightParts = [];
  const headCentres = [];
  for (const s of [-1, 1]) {
    // outline in the front view: a slim blade that sweeps up towards the corner, pointed at both ends
    const shape = (inset) => (u, v) => {
      const x = lerp(0.42, 0.8, u);
      const yMid = 0.555 + 0.035 * u * u;
      const h = Math.max(0.002, (0.024 - inset) * (1 - 0.35 * u) * Math.sin(Math.PI * clamp(0.04 + 0.92 * u, 0, 1)) ** 0.3);
      return [s * x, yMid + lerp(-h, h, v)];
    };
    trimParts.push(projectedPatch(-1, shape(0), q.light, 2, 0.003)); // chrome housing
    const lens = shape(0.008);
    lightParts.push(projectedPatch(-1, (u, v) => lens(lerp(0.03, 0.97, u), v), q.light, 2, 0.006));
    const c = projectEnd(s * 0.6, 0.56, -1);
    headCentres.push([+c.x.toFixed(3), +c.y.toFixed(3), +c.z.toFixed(3)]);
  }
  main.add(mesh(merge(lightParts), lensMat, 'lights'));

  // --- air intake: the opening left by the nose cap, closed by a recessed dark grille with one chrome blade
  {
    const back = new THREE.PlaneGeometry(0.86, 0.3);
    back.rotateY(Math.PI); // faces −z (forwards)
    back.translate(0, 0.29, Z_NOSE + 0.07);
    darkParts.push(back);
    const blade = new THREE.BoxGeometry(0.64, 0.014, 0.012);
    blade.translate(0, 0.29, Z_NOSE + 0.035);
    trimParts.push(blade);
    for (const bx of [-0.21, 0, 0.21]) { // three slim vertical struts behind the blade
      const strut = new THREE.BoxGeometry(0.012, 0.2, 0.012);
      strut.translate(bx, 0.29, Z_NOSE + 0.05);
      darkParts.push(strut);
    }
  }

  // --- tail: four round lights with chrome bezels, a dark plate recess
  const brakeParts = [];
  const tailCentres = [];
  // place a part built facing +z onto the tail face at frame f, `lift` off the paint
  const onFrame = (g, f, lift) => {
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), f.n));
    g.translate(f.p.x + f.n.x * lift, f.p.y + f.n.y * lift, f.p.z + f.n.z * lift);
    return g;
  };
  const TL_Y = 0.75;
  // slim dark band across the tail at light height (the round lamps sit in it) with a chrome strip below
  darkParts.push(projectedPatch(1, (u, v) => {
    const x = lerp(-0.85, 0.85, u), e = Math.abs(x) / 0.85;
    const h = 0.074 * (1 - 0.45 * e ** 6); // tapers towards the corners
    return [x, TL_Y + lerp(-h, h, v)];
  }, 34, 2, 0.002));
  trimParts.push(projectedPatch(1, (u, v) => [lerp(-0.72, 0.72, u), TL_Y - 0.09 + lerp(-0.0045, 0.0045, v)], 26, 1, 0.003));
  for (const s of [-1, 1]) {
    for (const lx of [0.47, 0.69]) {
      const f = endFrame(s * lx, TL_Y, 1);
      const bezel = new THREE.TorusGeometry(0.062, 0.0075, 6, 28); // chrome ring
      trimParts.push(onFrame(bezel, f, 0.007));
      const lens = new THREE.SphereGeometry(0.06, 28, 4, 0, Math.PI * 2, 0, 0.5); // shallow dome lens
      lens.rotateX(Math.PI / 2);
      lens.translate(0, 0, -0.06 * Math.cos(0.5));
      brakeParts.push(onFrame(lens, f, 0.004));
    }
    const c = projectEnd(s * 0.58, TL_Y, 1);
    tailCentres.push([+c.x.toFixed(3), +c.y.toFixed(3), +c.z.toFixed(3)]);
  }
  darkParts.push(projectedPatch(1, (u, v) => [lerp(-0.26, 0.26, u), lerp(0.475, 0.585, v)], 8, 1, 0.002)); // plate recess
  // dark lower valance across the tail (the exhausts come out of it)
  darkParts.push(projectedPatch(1, (u, v) => {
    const x = lerp(-0.8, 0.8, u), e = Math.abs(x) / 0.8;
    return [x, lerp(0.28, 0.43 - 0.06 * e ** 4, v)];
  }, 24, 2, 0.002));
  main.add(mesh(merge(brakeParts), tailMat, 'brakes'));

  // --- cove vents: three chrome strakes at the front of each side cove
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const z0 = -0.7 + k * 0.06;
      // σ window around the cove height on the lower side segment
      const left = s < 0;
      const sA = left ? 0.42 : 10 - 0.62, sB = left ? 0.62 : 10 - 0.42;
      trimParts.push(shellPatch(z0, z0 + 0.012, sA, sB, 4, 1, q.lift + 0.001));
    }
  }

  // --- panel shut lines (thin dark ribbons on the paint) and the chrome quarter-window divider
  {
    const m = (s0, s1, s) => (s < 0 ? [s0, s1] : [10 - s1, 10 - s0]); // σ range on the left / right side
    const GAP = 0.004;
    for (const s of [-1, 1]) {
      // door: front and rear cut lines from the sill up to the shoulder shelf
      for (const zd of [-0.56, 0.98]) darkParts.push(shellPatch(zd, zd + GAP, ...m(0.42, 3.02, s), 24, 1, q.lift));
      // bonnet edges, inboard of the fender crowns
      darkParts.push(shellPatch(-1.8, -0.36, ...m(2.98, 2.98 + 0.012, s), 1, 24, q.lift));
      // quarter-window divider on the glass, in line with the door's rear cut
      trimParts.push(shellPatch(0.98, 0.998, ...m(S_BELT1, S_TOP0, s), 8, 1, 0.002));
    }
    // bonnet front and rear edges across the car
    for (const zb of [-1.8, -0.36]) darkParts.push(shellPatch(zb, zb + GAP, 2.98, 10 - 2.98, 40, 1, q.lift));
  }

  // --- splitter, diffuser, floor, wheel wells, exhausts
  {
    // splitter: thin plate following the nose outline
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const rho = lerp(-1.62, Z_NOSE, i / 24);
      const st = stationKeys(rho);
      pts.push([st.K[0][0] + 0.025, st.z - 0.025 * (i / 24)]);
    }
    // top and bottom faces: strips across the car between the right outline and its mirror
    for (const [y, up] of [[0.142, 1], [0.12, -1]]) {
      const v = [];
      for (const [x, z] of pts) v.push(-x, y, z, x, y, z);
      darkParts.push(gridPatch(v, 1, pts.length - 1, new THREE.Vector3(0, up, 0), 0));
    }
    // edge all round: right side, front, left side
    const ring = pts.concat(pts.slice().reverse().map(([x, z]) => [-x, z]));
    const v = [];
    for (const [x, z] of ring) v.push(x, 0.142, z, x, 0.12, z);
    darkParts.push(gridPatch(v, 1, ring.length - 1, new THREE.Vector3(0, 0, -1), 0));
  }
  {
    // diffuser plate rising towards the tail, with fins
    const plate = new THREE.BoxGeometry(1.3, 0.02, 0.42);
    plate.rotateX(-0.22);
    plate.translate(0, 0.19, 2.03);
    darkParts.push(plate);
    for (const fx of [-0.45, -0.22, 0, 0.22, 0.45]) {
      const fin = new THREE.BoxGeometry(0.012, 0.09, 0.36);
      fin.rotateX(-0.22);
      fin.translate(fx, 0.22, 2.04);
      darkParts.push(fin);
    }
    // dark side skirts between the wheels (make the body side look slimmer)
    for (const s of [-1, 1]) {
      const skirt = new THREE.BoxGeometry(0.06, 0.05, 1.84);
      skirt.translate(s * 0.885, 0.19, 0.17);
      darkParts.push(skirt);
    }
    // floor between the wheels
    // (kept clear of the tyres: a full-length centre tray, side trays between the wheels, end trays)
    const tray = (w, d, x, z) => {
      const g = new THREE.BoxGeometry(w, 0.02, d);
      g.translate(x, 0.165, z);
      darkParts.push(g);
    };
    tray(1.3, 4.0, 0, 0.05);
    for (const s of [-1, 1]) tray(0.26, 1.8, s * 0.78, 0.17);
    tray(1.6, 0.42, 0, -1.84);
    tray(1.6, 0.3, 0, 2.05);
    // exhaust tips: two oval pipes each side
    for (const s of [-1, 1]) {
      for (const ex of [0.5, 0.64]) {
        const pipe = new THREE.CylinderGeometry(0.038, 0.038, 0.16, 20, 1, true);
        pipe.rotateX(Math.PI / 2);
        pipe.scale(1, 0.75, 1);
        pipe.translate(s * ex, 0.315, 2.2);
        trimParts.push(pipe);
      }
    }
  }
  for (const wz of [WHEEL_ZF, WHEEL_ZR]) {
    for (const s of [-1, 1]) {
      // liner over the wheel (a cone: tighter on the inboard side so it stays under the bonnet) + inner wall
      const rIn = 0.385, rOut = ARCH_R + 0.005;
      const well = new THREE.CylinderGeometry(s > 0 ? rIn : rOut, s > 0 ? rOut : rIn, 0.31, 28, 1, true, -Math.PI * 0.1, Math.PI * 1.2);
      well.rotateZ(Math.PI / 2); // axis along x; the cylinder's top end ends up at −x
      well.translate(s * 0.795, WHEEL_Y, wz);
      darkParts.push(well);
      const wall = new THREE.CircleGeometry(rIn, 28, -Math.PI * 0.1, Math.PI * 1.2); // upper part only
      wall.rotateY(Math.PI / 2);
      wall.translate(s * 0.64, WHEEL_Y, wz);
      darkParts.push(wall);
    }
  }
  main.add(mesh(merge(darkParts), dark, 'blackout'));
  main.add(mesh(merge(trimParts), chrome, 'trim'));

  // --- interior: dashboard, two seats, steering wheel (seen through the glass)
  {
    const parts = [];
    const dash = new THREE.BoxGeometry(1.3, 0.12, 0.3);
    dash.translate(0, 0.7, -0.02);
    parts.push(dash);
    for (const s of [-1, 1]) {
      const seat = new THREE.BoxGeometry(0.46, 0.1, 0.5);
      seat.translate(s * 0.36, 0.36, 0.55);
      const back = new THREE.BoxGeometry(0.46, 0.6, 0.12);
      back.rotateX(-0.3);
      back.translate(s * 0.36, 0.66, 0.84);
      parts.push(seat, back);
    }
    const wheel = new THREE.TorusGeometry(0.17, 0.018, 8, 24);
    wheel.rotateX(-0.35);
    wheel.translate(-0.36, 0.83, 0.12);
    parts.push(wheel);
    main.add(mesh(merge(parts), leather, 'interior'));
  }

  // --- wheels (spinning) and callipers (fixed, in main)
  const tyreGeo = tyreGeometry(q), rimGeo = rimGeometry(q), discGeo = discGeometry(q);
  const callipers = [];
  const RIM_OFFSET = 0.1;
  for (const [id, x, z] of [['fl', -WHEEL_X, WHEEL_ZF], ['fr', WHEEL_X, WHEEL_ZF], ['rl', -WHEEL_X, WHEEL_ZR], ['rr', WHEEL_X, WHEEL_ZR]]) {
    const s = Math.sign(x);
    const wheel = new THREE.Object3D();
    wheel.name = `wheel_${id}`;
    wheel.position.set(x, WHEEL_Y, z);
    wheel.add(mesh(tyreGeo, rubber, 'tyre'));
    const rim = mesh(rimGeo, chrome, `rim_${id}`);
    rim.position.x = s * RIM_OFFSET;
    if (s < 0) rim.rotation.y = Math.PI; // face outwards on the left side too
    wheel.add(rim);
    const disc = mesh(discGeo, discMat, 'disc');
    if (s < 0) disc.rotation.y = Math.PI;
    wheel.add(disc);
    model.add(wheel);
    // calliper: grips the disc at the top-rear, does not spin
    const cal = new THREE.BoxGeometry(0.07, 0.05, 0.14);
    cal.translate(0, 0.165, 0);
    cal.rotateX(0.55);
    cal.translate(x + s * 0.02, WHEEL_Y, z);
    callipers.push(cal);
  }
  main.add(mesh(merge(callipers), calliperMat, 'callipers'));

  model.userData = { rimRadius: RIM_R, headlights: headCentres, taillights: tailCentres };
  return model;
}
