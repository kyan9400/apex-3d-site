// =====================================================================================
// Apex GT — design E: "Electric monolith"
//
// A calm, minimal electric hypercar. The painted body is ONE continuous loft:
//   * the car is cut into ~200 cross-sections ("stations") along z,
//   * every section is built from superellipses (rounded-box curves) whose size and
//     roundness come from smooth spline profiles (width, shoulder height, belt line …),
//   * the glass canopy is a smooth bump added on top of the same surface, so glass, frit
//     and trim are generated from exactly the same maths and blend seamlessly,
//   * the wheel arches are cut by stopping each section at a "lip" that follows the arch
//     curve, so the arch edge is one clean row of vertices.
// The shell floats on a dark base (skirts, chin, diffuser) which keeps it visually light.
// Everything is generated in code (no files). See CONTRACT.md for the rules.
// =====================================================================================
import * as THREE from 'three';

// ---------- fixed dimensions (CONTRACT.md) ----------
const Z_NOSE = -2.27; // front tip — the car faces -z
const Z_TAIL = 2.25; // rear tip
const WHEEL_X = 0.83, WHEEL_Y = 0.36, WHEEL_ZF = -1.16, WHEEL_ZR = 1.5;
const RIM_R = 0.28;

// ---------- quality tiers (segment counts) ----------
const TIERS = {
  low: { stations: 110, na: 24, nb: 12, gRows: 36, gCols: 12, lift: 1.8, tyreSeg: 40, discSeg: 32, rimPer: 6, rimWin: 2, bandRows: 3 },
  medium: { stations: 156, na: 32, nb: 16, gRows: 50, gCols: 14, lift: 1.3, tyreSeg: 52, discSeg: 40, rimPer: 8, rimWin: 3, bandRows: 5 },
  high: { stations: 184, na: 40, nb: 20, gRows: 66, gCols: 18, lift: 1, tyreSeg: 64, discSeg: 48, rimPer: 10, rimWin: 4, bandRows: 5 },
};

// ---------- small maths helpers ----------
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
// cosine bump: 1 at t = 0, falls smoothly to 0 at |t| = 1
const bump = (t) => (Math.abs(t) >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * t));
// superellipse "rounded corner" falloff: 1 at s <= 0, 0 at s = 1
const roundEnd = (s, n) => (s <= 0 ? 1 : s >= 1 ? 0 : Math.pow(1 - Math.pow(s, n), 1 / n));

// Natural cubic spline through [x, y] keys. C2-smooth, so the clearcoat reflections flow
// without kinks. Outside the keys it holds the end value (keys extend beyond the car).
function spline(keys) {
  const n = keys.length;
  const xs = keys.map((k) => k[0]);
  const ys = keys.map((k) => k[1]);
  const m = new Float64Array(n); // second derivatives (0 at both ends = "natural")
  const k = n - 2, a = [], b = [], c = [], d = [];
  for (let i = 1; i < n - 1; i++) {
    const h0 = xs[i] - xs[i - 1], h1 = xs[i + 1] - xs[i];
    a.push(h0); b.push(2 * (h0 + h1)); c.push(h1);
    d.push(6 * ((ys[i + 1] - ys[i]) / h1 - (ys[i] - ys[i - 1]) / h0));
  }
  for (let i = 1; i < k; i++) { // tridiagonal solve (Thomas algorithm)
    const w = a[i] / b[i - 1];
    b[i] -= w * c[i - 1];
    d[i] -= w * d[i - 1];
  }
  m[k] = d[k - 1] / b[k - 1];
  for (let i = k - 2; i >= 0; i--) m[i + 1] = (d[i] - c[i] * m[i + 2]) / b[i];
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] > x) hi = mid; else lo = mid; }
    const h = xs[hi] - xs[lo], t = (x - xs[lo]) / h, u = 1 - t;
    return u * ys[lo] + t * ys[hi] + ((u * u * u - u) * m[lo] + (t * t * t - t) * m[hi]) * (h * h) / 6;
  };
}

// =====================================================================================
// 1. The design: spline profiles along the car (z → value). Tune the look here.
// =====================================================================================
const P = {
  // half-width at the widest point of each section (before the nose/tail rounding)
  halfW: spline([[-2.5, 0.88], [-2.0, 0.935], [-1.55, 0.975], [-1.16, 0.99], [-0.75, 0.968], [-0.2, 0.95],
    [0.4, 0.96], [0.95, 0.997], [1.5, 1.025], [1.95, 1.008], [2.5, 0.96]]),
  // height of the shoulder crown (top of the section, without canopy and valley)
  yTop: spline([[-2.5, 0.35], [-2.27, 0.445], [-2.0, 0.558], [-1.6, 0.712], [-1.16, 0.796], [-0.7, 0.812],
    [-0.2, 0.8], [0.4, 0.815], [1.0, 0.86], [1.5, 0.895], [1.95, 0.885], [2.15, 0.876], [2.27, 0.835], [2.5, 0.8]]),
  // how much lower the centre line is than the fender crowns (hood / deck valley)
  valley: spline([[-2.5, 0.0], [-2.1, 0.02], [-1.6, 0.05], [-1.16, 0.06], [-0.8, 0.045], [-0.4, 0.028],
    [0.2, 0.025], [1.0, 0.04], [1.5, 0.05], [2.0, 0.035], [2.5, 0.015]]),
  // belt line = height of the widest point; high over the wheels (haunches), low at the doors
  yBelt: spline([[-2.5, 0.32], [-2.27, 0.355], [-1.95, 0.47], [-1.55, 0.685], [-1.16, 0.745], [-0.75, 0.67],
    [-0.3, 0.582], [0.3, 0.572], [0.85, 0.638], [1.5, 0.75], [1.95, 0.722], [2.27, 0.662], [2.5, 0.64]]),
  // bottom edge of the painted shell (the dark base shows below it)
  ySill: spline([[-2.5, 0.19], [-2.27, 0.185], [-1.9, 0.19], [-1.4, 0.2], [-0.6, 0.205], [0.6, 0.205],
    [1.5, 0.215], [1.9, 0.27], [2.1, 0.38], [2.27, 0.5], [2.5, 0.55]]),
  // how far the lower side tucks in under the car
  tuck: spline([[-2.5, 0.05], [-1.16, 0.05], [-0.3, 0.07], [0.6, 0.07], [1.5, 0.05], [2.5, 0.05]]),
  // superellipse exponent of the upper section: 2 = round, higher = squarer shoulders
  nUp: spline([[-2.5, 2.6], [-1.16, 2.7], [0.0, 2.8], [1.5, 2.7], [2.5, 2.8]]),
  // half-width of the glass canopy at its base
  canopyW: spline([[-1.5, 0.56], [-1.1, 0.62], [-0.6, 0.68], [0.0, 0.69], [0.6, 0.64], [1.2, 0.52],
    [1.7, 0.38], [2.2, 0.25]]),
};

const LOW_M = 2.6; // superellipse exponent of the lower side
const VALLEY_K = 0.62; // valley width as a fraction of the half-width
const THETA_S = (40 * Math.PI) / 180; // shoulder point that splits the ring into "top" and "side"

// Plan-view rounding of nose and tail: the width falls to 0 along a superellipse.
const END_F = { len: 0.52, n: 3.0 };
const END_R = { len: 0.3, n: 3.6 };
function endFactor(z, nose = Z_NOSE) {
  return roundEnd((nose + END_F.len - z) / END_F.len, END_F.n) * roundEnd((z - (Z_TAIL - END_R.len)) / END_R.len, END_R.n);
}

// The canopy: a smooth bump on top of the body. It rises from just above the front axle
// (cab-forward, very raked windscreen) to the roof, then a long teardrop melts into the tail.
const CANOPY = { z0: -1.25, zPeak: -0.08, z1: 2.05, roof: 1.115, b: 1.7 };
const canopyMax = CANOPY.roof - (P.yTop(CANOPY.zPeak) - P.valley(CANOPY.zPeak));
function canopyH(z) {
  if (z <= CANOPY.z0 || z >= CANOPY.z1) return 0;
  if (z < CANOPY.zPeak) {
    const s = (CANOPY.zPeak - z) / (CANOPY.zPeak - CANOPY.z0);
    return canopyMax * Math.pow(1 - s * s, 1.7);
  }
  const s = (z - CANOPY.zPeak) / (CANOPY.z1 - CANOPY.zPeak);
  return canopyMax * Math.pow(1 - s * s, 2.3);
}

// Wheel arches: the lowest point of the body side follows this curve over each wheel.
const ARCHES = [{ z: WHEEL_ZF, rz: 0.5 }, { z: WHEEL_ZR, rz: 0.52 }];
const ARCH_TOP = 0.755, ARCH_P = 3.4;
function lipHeight(z, yS) {
  let y = yS;
  for (const a of ARCHES) {
    const s = Math.abs(z - a.z) / a.rz;
    if (s < 1) y = Math.max(y, yS + (ARCH_TOP - yS) * (1 - Math.pow(s, ARCH_P)));
  }
  return y;
}

// Side intake: a smooth scoop pressed into the flank ahead of the rear wheel.
const INTAKE = { z: 0.68, y: 0.455, hzF: 0.34, hzR: 0.2, hy: 0.15, depth: 0.045 };
function dent(z, y) {
  const tz = (z - INTAKE.z) / (z < INTAKE.z ? INTAKE.hzF : INTAKE.hzR), ty = (y - INTAKE.y) / INTAKE.hy;
  if (tz <= -1 || tz >= 1 || ty <= -1 || ty >= 1) return 0;
  return INTAKE.depth * bump(tz) * bump(ty);
}

// =====================================================================================
// 2. One cross-section ("station") and exact points on the surface
// =====================================================================================
let stationCache = new Map(); // many details sample the same z again and again
function station(z) {
  let st = stationCache.get(z);
  if (st) return st;
  const W = Math.max(0, P.halfW(z) * endFactor(z));
  const yT = P.yTop(z);
  const yB = Math.min(P.yBelt(z), yT - 0.03);
  const yS = Math.min(P.ySill(z), yB - 0.03);
  st = {
    z, W, yT, yB, yS,
    V: P.valley(z), n: P.nUp(z), a: Math.min(P.tuck(z), 0.45 * W),
    Hc: canopyH(z), Wc: P.canopyW(z), lip: lipHeight(z, yS),
  };
  stationCache.set(z, st);
  return st;
}

// valley + canopy, added to the top of the section (functions of |x|)
function topExtra(st, ax) {
  let d = 0;
  const kv = ax / (VALLEY_K * Math.max(st.W, 1e-9));
  if (kv < 1) d -= st.V * (1 - kv * kv) ** 2;
  if (st.Hc > 0) {
    const kc = ax / st.Wc;
    if (kc < 1) d += st.Hc * Math.pow(1 - kc * kc * kc, CANOPY.b); // kc³: canopy section exponent 3
  }
  return d;
}

// The top of the body is a height field y(x): superellipse shoulder + valley + canopy.
function upperY(st, x) {
  const ax = Math.abs(x);
  const u = Math.min(ax / Math.max(st.W, 1e-9), 1);
  return st.yB + (st.yT - st.yB) * Math.pow(1 - Math.pow(u, st.n), 1 / st.n) + topExtra(st, ax);
}

// x of the outer side at height y (right side) — the exact inverse of the section curves.
function sideXAt(st, y) {
  if (y <= st.yB) {
    const t = clamp((st.yB - y) / Math.max(1e-9, st.yB - st.yS), 0, 1);
    const s = Math.pow(t, LOW_M / 2);
    return st.W - st.a + st.a * Math.pow(Math.max(0, 1 - s * s), 1 / LOW_M);
  }
  const f = clamp((y - st.yB) / Math.max(1e-9, st.yT - st.yB), 0, 1);
  return st.W * Math.pow(1 - Math.pow(f, st.n), 1 / st.n);
}
const sideX = (z, y) => Math.max(0, sideXAt(station(z), y) - dent(z, y));

// Point on the flank at (z, y), pushed `off` metres out along the surface normal.
function sidePoint(z, y, off, sgn) {
  const h = 0.0015;
  const x = sideX(z, y);
  const xy = (sideX(z, y + h) - sideX(z, y - h)) / (2 * h);
  const za = Math.max(Z_NOSE, z - h), zb = Math.min(Z_TAIL, z + h);
  const xz = (sideX(zb, y) - sideX(za, y)) / (zb - za);
  const l = Math.sqrt(1 + xy * xy + xz * xz);
  return [sgn * (x + off / l), y - (xy * off) / l, z - (xz * off) / l];
}

// Dense polyline of the right half-section: centre line → shoulder S → belt → sill.
const DENSE_TOP = 24, DENSE_SH = 12, DENSE_LOW = 16, DENSE_N = DENSE_TOP + DENSE_SH + DENSE_LOW + 1;
const dxs = new Float64Array(DENSE_N), dys = new Float64Array(DENSE_N);
function halfOutline(st) {
  const { W, yB, yT, n, a, yS } = st;
  const xS = W * Math.pow(Math.cos(THETA_S), 2 / n);
  let o = 0;
  for (let i = 0; i <= DENSE_TOP; i++) { // top: height field from x = 0 to the shoulder point
    const x = (xS * i) / DENSE_TOP;
    dxs[o] = x; dys[o++] = upperY(st, x);
  }
  for (let i = 1; i <= DENSE_SH; i++) { // shoulder: superellipse angle down to the belt line
    const th = THETA_S * (1 - i / DENSE_SH);
    const x = W * Math.pow(Math.cos(th), 2 / n);
    dxs[o] = x; dys[o++] = yB + (yT - yB) * Math.pow(Math.sin(th), 2 / n) + topExtra(st, x);
  }
  for (let i = 1; i <= DENSE_LOW; i++) { // lower side tucking under to the sill
    const ph = ((Math.PI / 2) * i) / DENSE_LOW;
    dxs[o] = W - a + a * Math.pow(Math.cos(ph), 2 / LOW_M);
    dys[o++] = yB - (yB - yS) * Math.pow(Math.sin(ph), 2 / LOW_M);
  }
  return DENSE_TOP; // index of the shoulder point S
}

// Resample part of a polyline into `count` steps, evenly by length plus extra density on
// bends (lambda = metres of "length" added per radian of turning). Writes into out[].
let cumBuf = new Float64Array(DENSE_N);
function resample(xs, ys, i0, i1, count, lambda, out) {
  const nSeg = i1 - i0;
  if (cumBuf.length < nSeg + 1) cumBuf = new Float64Array(nSeg + 1);
  cumBuf[0] = 0;
  let pdx = 0, pdy = 0, plen = 0;
  for (let s = 0; s < nSeg; s++) {
    const k = i0 + s, dx = xs[k + 1] - xs[k], dy = ys[k + 1] - ys[k], len = Math.sqrt(dx * dx + dy * dy);
    let bend = 0;
    if (s > 0 && len > 1e-12 && plen > 1e-12) bend = Math.abs(pdx * dy - pdy * dx) / (plen * len); // ≈ turn angle
    cumBuf[s + 1] = cumBuf[s] + len + lambda * bend;
    pdx = dx; pdy = dy; plen = len;
  }
  let s = 0;
  for (let j = 0; j <= count; j++) {
    const t = (cumBuf[nSeg] * j) / count;
    while (s < nSeg - 1 && cumBuf[s + 1] < t) s++;
    const span = cumBuf[s + 1] - cumBuf[s];
    const f = span > 0 ? clamp((t - cumBuf[s]) / span, 0, 1) : 0;
    const k = i0 + s;
    out.push(xs[k] + (xs[k + 1] - xs[k]) * f, ys[k] + (ys[k + 1] - ys[k]) * f);
  }
}

// Final right half-section as a flat [x0, y0, x1, y1, …] list: NA steps over the top, NB down
// the side to the lip, then a short flange that rolls the lip inwards (gives arches a thickness).
function halfSection(st, NA, NB) {
  const iS = halfOutline(st);
  const pts = [];
  resample(dxs, dys, 0, iS, NA, 0.03, pts);
  for (let i = 0; i <= NA; i++) pts[2 * i + 1] = upperY(st, pts[2 * i]); // snap exactly onto the top
  // side: heights spread over the whole flank (shoulder → sill) …
  const side = [];
  resample(dxs, dys, iS, DENSE_N - 1, NB, 0.03, side);
  // … then, inside a wheel arch, the heights are scaled linearly into [lip, shoulder] and the
  // points snapped exactly onto the flank. Points near the shoulder hardly move from section
  // to section, so the curved shoulder keeps clean reflections; the last point is the lip.
  const lip = Math.min(st.lip, dys[iS] - 0.004);
  const yTopB = side[1], ySillB = side[2 * NB + 1];
  const w = smooth(0, 0.02, lip - ySillB), scale = (yTopB - lip) / Math.max(1e-9, yTopB - ySillB);
  for (let k = 1; k <= NB; k++) {
    const y0 = side[2 * k + 1];
    if (lip <= ySillB) { pts.push(side[2 * k], y0); continue; }
    const y = k === NB ? lip : lip + (y0 - ySillB) * scale;
    pts.push(side[2 * k] + w * (sideXAt(st, y) - side[2 * k]), y);
  }
  const lx = pts[pts.length - 2], ly = pts[pts.length - 1];
  pts.push(Math.max(0, lx - 0.01), ly + 0.004, Math.max(0, lx - 0.05), ly + 0.008);
  return pts;
}

// Station positions along z: evenly spaced by plan-view arc length (so the rounded nose and
// tail get enough sections), with extra sections where the arch lip moves quickly.
function stationList(count) {
  const G = 1200, zs = new Float64Array(G + 1), cum = new Float64Array(G + 1);
  const L = Z_TAIL - Z_NOSE;
  let pw = 0, pl = 0;
  for (let i = 0; i <= G; i++) {
    const u = i / G;
    const z = Z_NOSE + L * (u - Math.sin(2 * Math.PI * u) / (2 * Math.PI)); // fine near both tips
    zs[i] = z;
    const w = P.halfW(z) * endFactor(z), lip = lipHeight(z, P.ySill(z));
    if (i > 0) {
      const dz = z - zs[i - 1], dw = w - pw, dl = lip - pl;
      cum[i] = cum[i - 1] + Math.sqrt(dz * dz + dw * dw + 0.6 * dl * dl);
    }
    pw = w; pl = lip;
  }
  const out = [];
  let k = 0;
  for (let j = 0; j < count; j++) {
    const t = (cum[G] * j) / (count - 1);
    while (k < G - 1 && cum[k + 1] < t) k++;
    const span = cum[k + 1] - cum[k];
    out.push(zs[k] + (zs[k + 1] - zs[k]) * (span > 0 ? clamp((t - cum[k]) / span, 0, 1) : 0));
  }
  out[0] = Z_NOSE;
  out[count - 1] = Z_TAIL;
  return out;
}

// =====================================================================================
// 3. Geometry helpers
// =====================================================================================

// Make triangles face `dir(x, y, z)` (checked on a sample of triangles, before normals).
function orientIndex(pos, idx, dir) {
  let s = 0;
  const step = Math.max(1, Math.floor(idx.length / 3 / 1500)) * 3;
  for (let t = 0; t < idx.length; t += step) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const d = dir(pos[a], pos[a + 1], pos[a + 2]);
    s += (uy * vz - uz * vy) * d[0] + (uz * vx - ux * vz) * d[1] + (ux * vy - uy * vx) * d[2];
  }
  if (s < 0) for (let t = 0; t < idx.length; t += 3) { const q = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = q; }
}

// Smooth vertex normals: add up the (area-weighted) normal of every triangle at its three
// corners, then normalise. Same result as three's computeVertexNormals, just leaner.
// (Plain Math.sqrt is used everywhere instead of Math.hypot, which is much slower.)
function smoothNormals(pos, idx) {
  const n = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    n[a] += nx; n[a + 1] += ny; n[a + 2] += nz;
    n[b] += nx; n[b + 1] += ny; n[b + 2] += nz;
    n[c] += nx; n[c + 1] += ny; n[c + 2] += nz;
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.sqrt(n[i] * n[i] + n[i + 1] * n[i + 1] + n[i + 2] * n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

function makeGeo(pos, idx, dir) {
  if (dir) orientIndex(pos, idx, dir);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(smoothNormals(pos, idx), 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

// Grid surface: rows × cols points from fn(i, j) → [x, y, z], smooth normals.
function gridGeo(rows, cols, fn, dir) {
  const pos = new Float32Array(rows * cols * 3);
  let o = 0;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const p = fn(i, j);
      pos[o++] = p[0]; pos[o++] = p[1]; pos[o++] = p[2];
    }
  }
  return makeGeo(pos, gridIndex(rows, cols), dir);
}
function gridIndex(rows, cols) {
  const idx = new Uint32Array((rows - 1) * (cols - 1) * 6);
  let o = 0;
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j, b = a + 1, d = a + cols, c = d + 1;
      idx[o++] = a; idx[o++] = d; idx[o++] = b; idx[o++] = b; idx[o++] = d; idx[o++] = c;
    }
  }
  return idx;
}

// Push every vertex `off` metres along its normal (for layers that sit on the body).
function offsetAlongNormals(g, off) {
  const p = g.attributes.position.array, n = g.attributes.normal.array;
  for (let i = 0; i < p.length; i++) p[i] += n[i] * off;
  return g;
}

// Merge geometries that share a material into one draw call: concatenate the position and
// normal arrays and shift each part's triangle indices (non-indexed parts get 0,1,2,…).
function merge(list) {
  let nv = 0, ni = 0;
  for (const g of list) {
    nv += g.attributes.position.count;
    ni += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const g of list) {
    const count = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, count * 3), vo * 3);
    nor.set(g.attributes.normal.array.subarray(0, count * 3), vo * 3);
    if (g.index) { const s = g.index.array; for (let i = 0; i < g.index.count; i++) idx[io++] = s[i] + vo; }
    else for (let i = 0; i < count; i++) idx[io++] = vo + i;
    vo += count;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  m.setIndex(new THREE.BufferAttribute(idx, 1));
  return m;
}

// Mirror an (indexed) geometry across x = 0 for the left side, keeping faces pointing out.
function mirrorX(g) {
  const p = g.attributes.position.array.slice(), n = g.attributes.normal.array.slice();
  const idx = g.index.array.slice();
  for (let i = 0; i < p.length; i += 3) { p[i] = -p[i]; n[i] = -n[i]; }
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(p, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  m.setIndex(new THREE.BufferAttribute(idx, 1));
  return m;
}

// Closed grids repeat their first column at the end; average the normals of the two copies
// so no shading seam shows where the surface wraps around.
function weldSeam(g, rows, cols) {
  const n = g.attributes.normal.array;
  for (let i = 0; i < rows; i++) {
    const a = i * cols * 3, b = (i * cols + cols - 1) * 3;
    for (let c = 0; c < 3; c++) n[a + c] = n[b + c] = (n[a + c] + n[b + c]) / 2;
  }
  return g;
}

// Loft: one cross-section `ring(i)` (a list of [x, y, z] points, same length each row) per
// row. A closed ring repeats its first point at the end and gets its seam welded.
function loft(rows, ring, closed, dir) {
  let ci = -1, cur;
  const cols = ring(0).length;
  const g = gridGeo(rows, cols, (i, j) => {
    if (i !== ci) { ci = i; cur = ring(i); }
    return cur[j];
  }, dir);
  return closed ? weldSeam(g, rows, cols) : g;
}

// Lathe around the x axis from [radius, x] pairs (tyres, discs, barrels).
function latheX(profile, seg) {
  const g = gridGeo(profile.length, seg + 1, (i, j) => {
    const [r, x] = profile[i], t = (2 * Math.PI * j) / seg;
    return [x, r * Math.cos(t), r * Math.sin(t)];
  });
  return weldSeam(g, profile.length, seg + 1);
}

// Ellipsoid (radii rx, ry, rz) at c; `shape(z)` can taper it along z (teardrop).
function ellipsoid(c, rx, ry, rz, latSeg, lonSeg, shape = () => 1) {
  const g = gridGeo(latSeg + 1, lonSeg + 1, (i, j) => {
    const th = (Math.PI * i) / latSeg, ph = (2 * Math.PI * j) / lonSeg;
    const z = -Math.cos(th), k = shape(z);
    return [c[0] + rx * k * Math.sin(th) * Math.cos(ph), c[1] + ry * k * Math.sin(th) * Math.sin(ph), c[2] + rz * z];
  }, (x, y, z) => [x - c[0], y - c[1], z - c[2]]);
  return weldSeam(g, latSeg + 1, lonSeg + 1);
}

// =====================================================================================
// 4. The painted shell
// =====================================================================================
function buildShell(zs, Q) {
  const NA = Q.na, NB = Q.nb, N1 = NA + NB + 1, R = 2 * N1 + 3, M = zs.length;
  const pos = new Float32Array(M * R * 3);
  let o = 0;
  for (let i = 0; i < M; i++) {
    const st = station(zs[i]);
    const pts = halfSection(st, NA, NB);
    const last = pts.length / 2 - 1;
    for (let j = last; j >= 1; j--) { pos[o++] = -pts[2 * j]; pos[o++] = pts[2 * j + 1]; pos[o++] = st.z; }
    for (let j = 0; j <= last; j++) { pos[o++] = pts[2 * j]; pos[o++] = pts[2 * j + 1]; pos[o++] = st.z; }
  }
  // press the side intakes into the flanks
  for (let v = 0; v < M * R; v++) {
    const x = pos[v * 3];
    if (Math.abs(x) > 0.3) pos[v * 3] = x - Math.sign(x) * dent(pos[v * 3 + 2], pos[v * 3 + 1]);
  }
  const g = makeGeo(pos, gridIndex(M, R), (x, y, z) => [x, y - 0.45, z * 0.3]);
  // the nose and tail tips are a vertical seam where left and right halves meet:
  // make their normals symmetric so no crease shows
  const n = g.attributes.normal;
  for (const i of [0, M - 1]) {
    for (let j = 0; j < R; j++) {
      const v = i * R + j;
      const ny = n.getY(v), nz = n.getZ(v), l = Math.sqrt(ny * ny + nz * nz) || 1;
      n.setXYZ(v, 0, ny / l, nz / l);
    }
  }
  return g;
}

// =====================================================================================
// 5. Glass canopy, black frit underneath, thin chrome outline (all on the canopy surface)
// =====================================================================================
const GLASS = { z0: -1.12, z1: 1.62, frac: 0.86, lf: 0.3, nf: 2.3, lr: 1.2, nr: 1.8 };
function glassHalf(z, grow) {
  const z0 = GLASS.z0 - grow, z1 = GLASS.z1 + grow;
  if (z <= z0 || z >= z1) return 0;
  return (GLASS.frac * P.canopyW(z) + grow) *
    roundEnd((z0 + GLASS.lf - z) / GLASS.lf, GLASS.nf) * roundEnd((z - (z1 - GLASS.lr)) / GLASS.lr, GLASS.nr);
}

// A layer on the top surface between z0 and z1 (rows denser at both ends). rangeAt(z) gives
// [xa, xb] for each row; the columns are spread evenly by arc length across the section, so
// the steep canopy sides get as many points as the flat roof. Lifted `off` m along the normal.
function topPatch(z0, z1, rows, cols, rangeAt, off) {
  const N = 32, cx = new Float64Array(N + 1), cl = new Float64Array(N + 1), xs = new Float64Array(cols);
  let cache = -1, st;
  const g = gridGeo(rows, cols, (i, j) => {
    if (i !== cache) {
      cache = i;
      st = station(z0 + ((z1 - z0) * (1 - Math.cos((Math.PI * i) / (rows - 1)))) / 2);
      const [xa, xb] = rangeAt(st.z);
      let py = 0;
      for (let k = 0; k <= N; k++) { // fine polyline across the section → cumulative length
        cx[k] = xa + ((xb - xa) * k) / N;
        const y = upperY(st, cx[k]);
        const dx = cx[k] - (k ? cx[k - 1] : cx[k]), dy = y - py;
        cl[k] = k ? cl[k - 1] + Math.sqrt(dx * dx + dy * dy) : 0;
        py = y;
      }
      for (let c = 0, k = 0; c < cols; c++) {
        const t = (cl[N] * c) / (cols - 1);
        while (k < N - 1 && cl[k + 1] < t) k++;
        const span = cl[k + 1] - cl[k];
        xs[c] = cx[k] + (cx[k + 1] - cx[k]) * (span > 0 ? clamp((t - cl[k]) / span, 0, 1) : 0);
      }
    }
    return [xs[j], upperY(st, xs[j]), st.z];
  }, () => [0, 1, 0]);
  return offsetAlongNormals(g, off);
}

function buildCanopy(Q) {
  const C = Q.gCols, rows = Q.gRows, L = Q.lift; // coarser tiers lift the layers a bit more
  const G1 = 0.012, G2 = 0.019;
  const glassGeo = topPatch(GLASS.z0, GLASS.z1, rows, 2 * C + 1, (z) => { const w = glassHalf(z, 0); return [-w, w]; }, 0.0045 * L);
  const fritGeo = topPatch(GLASS.z0 - G1, GLASS.z1 + G1, rows, 2 * C + 1, (z) => { const w = glassHalf(z, G1); return [-w, w]; }, 0.002 * L);
  // chrome ring between the frit edge and a slightly larger outline
  const ring = (sgn) => topPatch(GLASS.z0 - G2, GLASS.z1 + G2, rows + 10, 3, (z) => {
    const a = sgn * glassHalf(z, G1), b = sgn * glassHalf(z, G2);
    return [a, b];
  }, 0.0025 * L);
  return { glassGeo, fritGeo, trimGeo: merge([ring(1), ring(-1)]) };
}

// =====================================================================================
// 6. Light blades (front: white, rear: red) wrapped across the nose and tail
// =====================================================================================
function bandGeo(zsBody, tipZ, len, yc, height, off, bulge, rowsAcross) {
  const zs = zsBody.filter((z) => Math.abs(z - tipZ) <= len + 1e-9)
    .sort((a, b) => Math.abs(a - tipZ) - Math.abs(b - tipZ));
  const path = [];
  for (let k = zs.length - 1; k >= 1; k--) path.push([zs[k], -1]);
  for (let k = 0; k < zs.length; k++) path.push([zs[k], 1]);
  const dirZ = tipZ < 0 ? -1 : 1;
  return gridGeo(path.length, rowsAcross, (i, j) => {
    const [z, sgn] = path[i];
    const d = Math.abs(z - tipZ) / len;
    const cap = d < 0.6 ? 1 : Math.sqrt(Math.max(0, 1 - ((d - 0.6) / 0.4) ** 2)); // rounded ends
    const v = (2 * j) / (rowsAcross - 1) - 1;
    const y = yc + v * (height / 2) * cap;
    return sidePoint(z, y, off + bulge * (1 - v * v) * cap, sgn);
  }, (x, y, z) => [x, 0, dirZ * Math.max(0.2, Math.abs(z) - 1.6)]);
}

// =====================================================================================
// 7. Flank details: door shut line, intake insert, mirrors
// =====================================================================================
function doorLine(sgn) {
  const zc = -0.115, yc = 0.448, hz = 0.425, hy = 0.255, n = 5, K = 140, w = 0.0025;
  const N = 400, xs = new Float64Array(N + 1), ys = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) { // dense superellipse loop in the (z, y) side plane
    const t = (2 * Math.PI * i) / N, c = Math.cos(t), s = Math.sin(t);
    xs[i] = zc + hz * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    ys[i] = yc + hy * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
  }
  const loop = [];
  resample(xs, ys, 0, N, K, 0, loop); // even spacing along the loop
  const P2 = (i) => [loop[2 * (i % K)], loop[2 * (i % K) + 1]];
  return gridGeo(K + 1, 2, (i, j) => {
    const p = P2(i), q = P2(i + 1), r = P2(i + K - 1);
    let tz = q[0] - r[0], ty = q[1] - r[1];
    const l = Math.sqrt(tz * tz + ty * ty) || 1;
    tz /= l; ty /= l;
    const side = j === 0 ? -w : w; // offset across the line in the side plane
    return sidePoint(p[0] - ty * side, p[1] + tz * side, 0.0014, sgn);
  }, () => [sgn, 0, 0]);
}

// rounded slot on the flank (z, y centre; half sizes) — used for the intake insert
function flankDisc(sgn, zc, yc, hz, hy, n, off, rings, seg) {
  return gridGeo(rings + 1, seg + 1, (i, j) => {
    const r = i / rings, t = (2 * Math.PI * j) / seg, c = Math.cos(t), s = Math.sin(t);
    const z = zc + r * hz * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    const y = yc + r * hy * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
    return sidePoint(z, y, off, sgn);
  }, () => [sgn, 0, 0]);
}

// Slim camera "mirrors": a painted teardrop pod on a painted blade, dark lens at the back.
function mirrorPods() {
  const body = [], dark = [];
  const PZ = -0.8, PY = 0.835, PX = 1.012;
  for (const sgn of [1, -1]) {
    // teardrop: full at the front (z < 0), tapered towards the back
    body.push(ellipsoid([sgn * PX, PY, PZ], 0.06, 0.042, 0.14, 12, 24, (z) => (z > 0 ? 1 - 0.4 * z * z : 1)));
    // flat blade from the shoulder to the pod: an ellipse swept along a straight line
    const z = PZ + 0.02, y0 = 0.715;
    const a = new THREE.Vector3(sgn * (sideX(z, y0) - 0.015), y0, z);
    const b = new THREE.Vector3(sgn * (PX - 0.02), PY - 0.008, PZ + 0.01);
    const axis = b.clone().sub(a).normalize();
    const e1 = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 0, 1)).normalize();
    const e2 = new THREE.Vector3().crossVectors(e1, axis);
    body.push(loft(2, (i) => {
      const c = i ? b : a, ring = [];
      for (let j = 0; j <= 12; j++) {
        const t = (2 * Math.PI * j) / 12, r1 = 0.012, r2 = 0.036;
        ring.push([c.x + e1.x * r1 * Math.cos(t) + e2.x * r2 * Math.sin(t), c.y + e1.y * r1 * Math.cos(t) + e2.y * r2 * Math.sin(t),
          c.z + e1.z * r1 * Math.cos(t) + e2.z * r2 * Math.sin(t)]);
      }
      return ring;
    }, true, (x, y, zz) => [x - (a.x + b.x) / 2, y - (a.y + b.y) / 2, zz - (a.z + b.z) / 2]));
    dark.push(ellipsoid([sgn * PX, PY, PZ + 0.118], 0.024, 0.016, 0.01, 6, 12)); // camera lens
  }
  return { body, dark };
}

// =====================================================================================
// 8. Dark base: wheel-arch liners, floor with side skirts, splitter, diffuser with fins
// =====================================================================================
function liner(wz, rz, sgn) {
  const rows = 44;
  return gridGeo(rows, 3, (i, j) => {
    const z = wz - rz + (2 * rz * i) / (rows - 1);
    const st = station(z);
    // stay inside the skin: above the belt line the side curls inwards right above the lip
    const ly = st.lip + 0.012, lx = Math.min(sideXAt(st, st.lip) - 0.035, sideXAt(st, ly + 0.012) - 0.015);
    const p = j === 0 ? [0.585, 0.1] : j === 1 ? [0.585, ly] : [Math.max(0.6, lx), ly];
    return [sgn * p[0], p[1], z];
  });
}

// x of the bottom edge of the painted shell (where the lower side has tucked in)
const shellBottomX = (z) => { const st = station(z); return st.W - st.a; };

// Floor slab: its sides show under the shell as a dark skirt; notched around the wheels.
// Built as a loft of U-shaped sections (sides + bottom; the top is hidden inside the body).
function uSection(z, half, yTop, yBot) {
  const r = 0.02 * Math.min(1, half / 0.05);
  return [[-half, yTop, z], [-half, yBot + r, z], [-half + 0.3 * r, yBot + 0.3 * r, z], [-half + r, yBot, z],
    [half - r, yBot, z], [half - 0.3 * r, yBot + 0.3 * r, z], [half, yBot + r, z], [half, yTop, z]];
}
function floorSlab() {
  const half = (z) => {
    for (const a of ARCHES) if (Math.abs(z - a.z) < a.rz + 0.01) return 0.575;
    return Math.max(0, shellBottomX(z) - 0.008);
  };
  const zs = [Z_NOSE];
  for (let z = Z_NOSE + 0.0005; z < Z_NOSE + 0.03; z += 0.004) zs.push(z); // rounded nose
  for (let z = Z_NOSE + 0.03; z < 1.36; z += 0.03) zs.push(z);
  for (const a of ARCHES) for (const b of [a.z - a.rz - 0.01, a.z + a.rz + 0.01]) zs.push(b - 1e-4, b + 1e-4); // notch steps
  zs.push(1.36);
  zs.sort((a, b) => a - b);
  return loft(zs.length, (i) => uSection(zs[i], half(zs[i]), 0.3, 0.1), false);
}

// Splitter: a thin plate peeking 1–2 cm out under the nose (closed rounded section).
function splitter() {
  const nose = Z_NOSE - 0.022, n = 30;
  return loft(n + 1, (i) => {
    const z = nose + (-1.7 - nose) * (1 - Math.cos((Math.PI / 2) * (i / n)));
    const st = station(clamp(z, Z_NOSE, 0));
    const h = Math.max(0, (P.halfW(z) - st.a + 0.006) * endFactor(z, nose)), e = Math.min(0.005, h);
    return [[-h, 0.122, z], [-h - e, 0.111, z], [-h, 0.1, z], [h, 0.1, z], [h + e, 0.111, z], [h, 0.122, z], [-h, 0.122, z]];
  }, true);
}

const diffY = (z) => 0.1 + 0.205 * smooth(1.32, 2.22, z);

function diffuser(zsBody) {
  const zs = [1.3, ...zsBody.filter((z) => z > 1.31)];
  return gridGeo(zs.length, 8, (i, j) => {
    const z = zs[i], st = station(z);
    const xe = 0.575 + (Math.max(0, shellBottomX(z) - 0.008) - 0.575) * smooth(1.99, 2.05, z);
    const yd = diffY(z);
    const yw = Math.max(yd + 0.004, z < 2.0 ? 0.3 : Math.max(0.3, st.yS + 0.03));
    const r = 0.02 * Math.min(1, xe / 0.05);
    const prof = [[-xe, yw], [-xe, yd + r], [-xe + 0.3 * r, yd + 0.3 * r], [-xe + r, yd],
      [xe - r, yd], [xe - 0.3 * r, yd + 0.3 * r], [xe, yd + r], [xe, yw]];
    return [prof[j][0], prof[j][1], z];
  });
}

// Diffuser fins: thin vertical plates hanging from the diffuser ramp.
function fins() {
  const out = [];
  for (const fx of [0, -0.21, 0.21, -0.42, 0.42]) {
    let zEnd = Z_TAIL - 0.01;
    while (zEnd > 2.0 && shellBottomX(zEnd) < Math.abs(fx) + 0.04) zEnd -= 0.005;
    const z0 = 1.55, t = 0.004, n = 16;
    out.push(loft(n + 1, (i) => {
      const z = z0 + ((zEnd - z0) * i) / n, top = diffY(z) + 0.01, bot = Math.min(top, 0.105 + 0.1 * smooth(z0, zEnd, z));
      return [[fx - t, bot, z], [fx - t, top, z], [fx + t, top, z], [fx + t, bot, z], [fx - t, bot, z]];
    }, true));
  }
  return out;
}

// =====================================================================================
// 9. Wheels: tyre, aero rim (turbine-swept spokes with open slots), disc, calliper
// =====================================================================================
function tyreGeo(seg) {
  const half = [[0.287, 0.113], [0.293, 0.124], [0.305, 0.131], [0.32, 0.1345], [0.335, 0.1335], [0.346, 0.129],
    [0.354, 0.12], [0.3585, 0.105], [0.36, 0.085], [0.36, 0.05], [0.3565, 0.045], [0.3565, 0.034], [0.36, 0.029], [0.36, 0]];
  return latheX([...half.map(([r, x]) => [r, -x]), ...half.slice(0, -1).reverse()], seg);
}

// Rim face in the wheel plane, facing +x. A polar grid with ten slots cut out along grid
// lines (crisp edges); the spokes are crowned and swept like a turbine for an aero look.
function rimGeo(Q) {
  const K = 10, S = Q.rimPer, SW = Q.rimWin, NA = K * S, cols = NA + 1;
  // [radius, depth] rings: small domed cap, deep dish, rolled outer lip
  const rings = [[0, 0.008], [0.018, 0.007], [0.032, 0.003], [0.042, -0.004], [0.048, -0.014], [0.06, -0.02],
    [0.08, -0.024], [0.1, -0.024], [0.118, -0.022], [0.145, -0.018], [0.172, -0.014], [0.2, -0.01],
    [0.226, -0.006], [0.242, -0.003], [0.254, 0.0], [0.264, 0.005], [0.272, 0.008], [0.279, 0.006], [0.2845, -0.002]];
  const W0 = 7, W1 = 13; // slots between rings[7] (r 0.10) and rings[13] (r 0.242)
  const TWIST = 0.26;
  const vert = (k, j) => {
    const [r, d] = rings[k];
    const local = j % S; // position inside one spoke period
    let crown = 0;
    if (local > SW) crown = 0.006 * Math.sin((Math.PI * (local - SW)) / (S - SW)) * smooth(0.05, 0.1, r) * (1 - smooth(0.24, 0.262, r));
    const th = (2 * Math.PI * j) / NA + TWIST * smooth(0.08, 0.26, r);
    return [d + crown, r * Math.cos(th), r * Math.sin(th)];
  };
  const pos = new Float32Array(rings.length * cols * 3);
  let o = 0;
  for (let k = 0; k < rings.length; k++) for (let j = 0; j < cols; j++) { const v = vert(k, j); pos[o++] = v[0]; pos[o++] = v[1]; pos[o++] = v[2]; }
  const all = gridIndex(rings.length, cols), keep = [];
  for (let t = 0; t < all.length; t += 6) { // drop the quads inside the slots
    const k = Math.floor(all[t] / cols), j = all[t] % cols;
    if (!(k >= W0 && k < W1 && j % S < SW)) for (let q = 0; q < 6; q++) keep.push(all[t + q]);
  }
  const face = weldSeam(makeGeo(pos, Uint32Array.from(keep), () => [1, 0, 0]), rings.length, cols);
  // slot side walls: own vertices so the face keeps its smooth shading
  const WD = 0.014, wp = [], wi = [];
  for (let p = 0; p < K; p++) {
    const j0 = p * S, j1 = j0 + SW, c = vert((W0 + W1) >> 1, (j0 + j1) / 2);
    const edges = [];
    for (let j = j0; j < j1; j++) edges.push([W0, j, W0, j + 1], [W1, j, W1, j + 1]);
    for (let k = W0; k < W1; k++) edges.push([k, j0, k + 1, j0], [k, j1, k + 1, j1]);
    for (const [k0, ja, k1, jb] of edges) {
      const A = vert(k0, ja), B = vert(k1, jb), base = wp.length / 3;
      wp.push(...A, ...B, B[0] - WD, B[1], B[2], A[0] - WD, A[1], A[2]);
      // the wall must face into the slot: compare its normal with the direction to the slot centre
      const ny = (B[2] - A[2]) * -WD, nz = -(B[1] - A[1]) * -WD; // normal of (B-A) × (down) in the wheel plane
      const into = ny * (c[1] - A[1]) + nz * (c[2] - A[2]) > 0;
      wi.push(...(into ? [base, base + 1, base + 2, base, base + 2, base + 3] : [base, base + 2, base + 1, base, base + 3, base + 2]));
    }
  }
  const walls = makeGeo(new Float32Array(wp), new Uint32Array(wi));
  return merge([face, walls]);
}

function discGeo(seg) {
  const disc = latheX([[0.105, 0.031], [0.195, 0.031], [0.197, 0.018], [0.195, 0.005], [0.105, 0.005], [0.105, 0.031]], seg);
  const hat = latheX([[0, 0.05], [0.07, 0.05], [0.1, 0.044], [0.106, 0.03], [0.106, 0.012]], seg);
  const barrel = latheX([[0, -0.1], [0.283, -0.1], [0.283, 0.075]], seg); // inner barrel + back plate
  return merge([disc, hat, barrel]);
}

// Calliper: a rounded block swept along an arc around the disc edge, with flat end caps.
// alpha = angle of its centre in the wheel plane (from +z towards +y); sgn = side (+1 right).
function calliperGeo(alpha, cx, cy, cz, sgn) {
  const span = 0.42, n = 10, r0 = 0.13, r1 = 0.214, x0 = -0.018, x1 = 0.044, c = 0.008;
  const sec = [[r0 + c, x0], [r1 - c, x0], [r1, x0 + c], [r1, x1 - c], [r1 - c, x1], [r0 + c, x1], [r0, x1 - c], [r0, x0 + c], [r0 + c, x0]];
  const at = (r, x, t) => [cx + sgn * x, cy + r * Math.sin(t), cz + r * Math.cos(t)];
  const tOf = (i) => alpha - span / 2 + (span * i) / n;
  const out = (x, y, z) => [sgn * (x - cx) * 0.2, y - cy, z - cz]; // roughly away from the axle
  const body = loft(n + 1, (i) => sec.map(([r, x]) => at(r, x, tOf(i))), true, out);
  const caps = [];
  for (const [i, sign] of [[0, -1], [n, 1]]) { // fan-triangulated end caps
    const t = tOf(i), pts = sec.slice(0, -1).map(([r, x]) => at(r, x, t));
    const centre = at((r0 + r1) / 2, (x0 + x1) / 2, t);
    const pos = new Float32Array([...centre, ...pts.flat()]), idx = [];
    for (let k = 0; k < pts.length; k++) idx.push(0, 1 + k, 1 + ((k + 1) % pts.length));
    const tangent = [0, sign * Math.cos(t), -sign * Math.sin(t)]; // along the arc, outwards
    caps.push(makeGeo(pos, new Uint32Array(idx), () => tangent));
  }
  return merge([body, ...caps]);
}

// =====================================================================================
// 10. Assemble the car
// =====================================================================================
export function createCar({ paint, chrome, glass, tier = 'high' } = {}) {
  const Q = TIERS[tier] || TIERS.high;
  stationCache = new Map();
  const model = new THREE.Group();
  model.name = 'model';
  const main = new THREE.Group();
  main.name = 'main';
  model.add(main);

  // materials made here (paint / chrome / glass come from main.js)
  const glossBlack = new THREE.MeshStandardMaterial({ color: 0x050507, roughness: 0.18, metalness: 0.4, side: THREE.DoubleSide });
  const satinBlack = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.55, metalness: 0.2, side: THREE.DoubleSide });
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe6f2ff, emissiveIntensity: 2.4, roughness: 0.25 });
  const brakeMat = new THREE.MeshStandardMaterial({ color: 0x40000a, emissive: 0xff1428, emissiveIntensity: 1.4, roughness: 0.3 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  const discMat = new THREE.MeshStandardMaterial({ color: 0x3c3f44, roughness: 0.45, metalness: 0.85, side: THREE.DoubleSide });
  const calliperMat = new THREE.MeshStandardMaterial({ color: 0xaab0b8, roughness: 0.32, metalness: 0.75 });

  const add = (geo, material, name, parent = main) => {
    const m = new THREE.Mesh(geo, material);
    m.name = name;
    parent.add(m);
    return m;
  };

  // --- body (shell + mirror pods) ---
  const zs = stationList(Q.stations);
  const pods = mirrorPods();
  add(merge([buildShell(zs, Q), ...pods.body]), paint, 'body');

  // --- canopy glass, frit and chrome outline ---
  const canopy = buildCanopy(Q);
  add(canopy.glassGeo, glass, 'glass');
  add(canopy.trimGeo, chrome, 'trim');

  // --- light blades ---
  const FRONT = { y: 0.4, len: 0.42 }, REAR = { y: 0.772, len: 0.28 };
  add(bandGeo(zs, Z_NOSE, FRONT.len, FRONT.y, 0.022, 0.0042, 0.0015, Q.bandRows), lightMat, 'lights');
  add(bandGeo(zs, Z_TAIL, REAR.len, REAR.y, 0.028, 0.0042, 0.0015, Q.bandRows), brakeMat, 'brakes');

  // --- gloss black details: frit, light surrounds, rear fascia, door lines, intake inserts, lenses ---
  const gloss = [canopy.fritGeo,
    bandGeo(zs, Z_NOSE, FRONT.len + 0.03, FRONT.y, 0.046, 0.0022, 0, 3),
    bandGeo(zs, Z_TAIL, REAR.len + 0.03, REAR.y, 0.06, 0.0022, 0, 3),
    bandGeo(zs, Z_TAIL, 0.25, 0.635, 0.19, 0.0016, 0, 7), // black glass rear fascia
    ...pods.dark];
  for (const sgn of [1, -1]) gloss.push(doorLine(sgn), flankDisc(sgn, 0.77, 0.465, 0.13, 0.068, 4, 0.004, 6, 40));
  add(merge(gloss), glossBlack, 'details');

  // --- dark base (satin): liners, floor + skirts, splitter, diffuser, fins ---
  const base = [floorSlab(), splitter(), diffuser(zs), ...fins()];
  for (const a of ARCHES) for (const sgn of [1, -1]) base.push(liner(a.z, a.rz, sgn));
  add(merge(base), satinBlack, 'underbody');

  // --- wheels (+ callipers, which must not spin, so they live in main) ---
  const calls = [];
  const tyre = tyreGeo(Q.tyreSeg);
  const rimR = rimGeo(Q), rimL = mirrorX(rimR);
  const discR = discGeo(Q.discSeg), discL = mirrorX(discR);
  const RIM_OFF = 0.088;
  for (const [key, x, z] of [['fl', -WHEEL_X, WHEEL_ZF], ['fr', WHEEL_X, WHEEL_ZF], ['rl', -WHEEL_X, WHEEL_ZR], ['rr', WHEEL_X, WHEEL_ZR]]) {
    const right = x > 0;
    const w = new THREE.Object3D();
    w.name = `wheel_${key}`;
    w.position.set(x, WHEEL_Y, z);
    model.add(w);
    add(tyre, rubber, 'tyre', w);
    const rim = add(right ? rimR : rimL, chrome, `rim_${key}`, w);
    rim.position.x = right ? RIM_OFF : -RIM_OFF;
    add(right ? discR : discL, discMat, `disc_${key}`, w);
    // front: behind the axle, rear: ahead of it
    calls.push(calliperGeo(z < 0 ? 0.62 : Math.PI - 0.62, x, WHEEL_Y, z, right ? 1 : -1));
  }
  add(merge(calls), calliperMat, 'callipers');

  // --- userData for effects.js ---
  const lampAt = (tipZ, len, y, targetX) => { // point on a light blade at |x| ≈ targetX
    let best = null;
    for (const z of zs) {
      if (Math.abs(z - tipZ) > len) continue;
      const x = sideX(z, y);
      if (!best || Math.abs(x - targetX) < Math.abs(best[0] - targetX)) best = [x, y, z];
    }
    return best;
  };
  const hl = lampAt(Z_NOSE, FRONT.len, FRONT.y, 0.62), tl = lampAt(Z_TAIL, REAR.len, REAR.y, 0.68);
  const r3 = (v) => Math.round(v * 1000) / 1000;
  model.userData = {
    rimRadius: RIM_R,
    headlights: [[r3(hl[0]), r3(hl[1]), r3(hl[2] - 0.01)], [r3(-hl[0]), r3(hl[1]), r3(hl[2] - 0.01)]],
    taillights: [[r3(tl[0]), r3(tl[1]), r3(tl[2] + 0.01)], [r3(-tl[0]), r3(tl[1]), r3(tl[2] + 0.01)]],
  };
  stationCache = new Map(); // free the cache
  return model;
}
