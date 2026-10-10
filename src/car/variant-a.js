/* ==========================================================================
   APEX GT — procedural car, variant A: "LOFTED SCULPTURE"

   The painted shell is ONE smooth surface made by lofting: we cut the car
   into slices along its length (z) and give every slice the shape of a
   SUPERELLIPSE — a rounded rectangle, |x/a|^n + |y/b|^n = 1 (n = 2 is an
   ellipse, a bigger n is boxier). Neighbouring slices are stitched into
   triangles. Every slice parameter (width, heights, squareness, …) is a
   smooth spline of z, so the surface flows without creases and the
   clearcoat reflections glide along it.
     · wheel arches: each slice is cut by an ellipse drawn around the wheel
     · cockpit: the top of the slices is cut away around the seats
     · fenders, haunches, roll-hoop fairings, side scoops, character line:
       smooth bumps added to the slice shape
   Glass, lights, intakes, interior and wheels are built with the same
   tools and placed ON the shell by projecting onto it.

   The car faces -z, the ground is y = 0 (see CONTRACT.md).
   ========================================================================== */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* --------------------------------------------------------------------------
   1. SMALL MATH HELPERS
   -------------------------------------------------------------------------- */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
// smootherstep: 0 before a, 1 after b, flat slope AND curvature at both ends
function smooth(a, b, v) {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}
// soft bell: 1 at t = 0, 0 for |t| >= 1, smooth everywhere
const bell = (t) => (t <= -1 || t >= 1 ? 0 : (1 - t * t) ** 3);
// broad hump with a rounded, almost flat top (used for the roll-hoop fairings)
const hump = (t) => 1 - smooth(0.2, 1, Math.abs(t));
// power that keeps the sign: spow(-8, 1/3) = -2
const spow = (v, e) => (v < 0 ? -((-v) ** e) : v ** e);

// Natural cubic spline through [z, value] points: continuous slope AND
// curvature, which keeps the reflections on the paint from wobbling.
function spline(points) {
  const n = points.length;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const m = new Float64Array(n); // second derivative at each point
  const c = new Float64Array(n);
  const d = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) {
    const h0 = xs[i] - xs[i - 1];
    const h1 = xs[i + 1] - xs[i];
    const r = (ys[i + 1] - ys[i]) / h1 - (ys[i] - ys[i - 1]) / h0;
    const denom = (h0 + h1) / 3 - (h0 / 6) * c[i - 1]; // tridiagonal solve, forward sweep
    c[i] = h1 / 6 / denom;
    d[i] = (r - (h0 / 6) * d[i - 1]) / denom;
  }
  for (let i = n - 2; i >= 1; i--) m[i] = d[i] - c[i] * m[i + 1];
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const A = (xs[i + 1] - x) / h;
    const B = 1 - A;
    return A * ys[i] + B * ys[i + 1] + (((A * A * A - A) * m[i] + (B * B * B - B) * m[i + 1]) * h * h) / 6;
  };
}

/* --------------------------------------------------------------------------
   2. THE DESIGN — every number that shapes the car lives here
   -------------------------------------------------------------------------- */
// Fixed by the contract
const Z_FRONT = -2.27; // nose tip
const Z_REAR = 2.25; // tail
const AXLES = [-1.16, 1.5]; // front / rear axle z
const TRACK_X = 0.83; // wheel centre x
const WHEEL_Y = 0.36; // wheel centre height
const TYRE_W = 0.27;
const RIM_R = 0.28;
const RIM_OFFSET = 0.085; // spoke face: this far out from the wheel centre (tyre sidewall at 0.135)

// Plan view: half-width of each slice at its widest point
const W = spline([
  [-2.27, 0.8], [-2.0, 0.89], [-1.6, 0.975], [-1.16, 1.008], [-0.75, 0.985], [-0.3, 0.955],
  [0.15, 0.95], [0.6, 0.975], [1.0, 1.012], [1.45, 1.03], [1.85, 1.02], [2.25, 0.975],
]);
// Side view: height of each slice's widest point, its top (the fender/shoulder line) and its floor
const YC = spline([[-2.27, 0.3], [-1.95, 0.4], [-1.45, 0.58], [-1.16, 0.625], [-0.75, 0.59], [-0.2, 0.52], [0.6, 0.55], [1.2, 0.64], [1.6, 0.66], [2.25, 0.65]]);
const YTOP = spline([
  [-2.27, 0.43], [-2.0, 0.555], [-1.6, 0.73], [-1.16, 0.84], [-0.75, 0.845], [-0.3, 0.83],
  [0.2, 0.84], [0.8, 0.9], [1.45, 0.975], [1.95, 0.975], [2.25, 0.985],
]);
const YBOT = spline([[-2.27, 0.14], [-1.95, 0.135], [-1.2, 0.13], [0.0, 0.12], [1.2, 0.13], [1.75, 0.165], [2.25, 0.34]]);
// Squareness of the upper and lower half of each slice (2 = ellipse, 5 = boxy)
const NT = spline([[-2.27, 3.0], [-1.7, 3.9], [-1.16, 5.4], [-0.6, 4.3], [0.2, 3.5], [1.0, 4.5], [1.5, 5.2], [2.25, 4.8]]);
const NB = spline([[-2.27, 4.4], [-1.6, 4.0], [0.0, 4.2], [1.5, 3.8], [2.25, 4.0]]);
// The hood / engine deck sits lower than the fenders: depth and width (fraction of w) of that valley
const VALLEY = spline([
  [-2.27, 0.03], [-2.0, 0.05], [-1.6, 0.085], [-1.16, 0.1], [-0.85, 0.03], [-0.3, 0.0],
  [0.6, 0.04], [1.45, 0.075], [2.0, 0.06], [2.25, 0.05],
]);
const VALLEY_W = spline([[-2.27, 0.55], [-1.16, 0.62], [-0.6, 0.6], [0.6, 0.66], [2.25, 0.7]]);
// Nose and tail: the slices shrink to a point over these lengths and exponents
// (w = plan view, t = upper half in side view, b = lower half: short, so the fascia stands upright)
const CAP = {
  front: { w: 0.5, pw: 2.6, t: 0.2, pt: 2.2, b: 0.09, pb: 2.4 },
  rear: { w: 0.3, pw: 3.0, t: 0.1, pt: 5, b: 0.1, pb: 4 },
};

// Roll-hoop fairings: two broad humps behind the seats that flow back into the deck
const HOOP = { x: 0.3, halfWidth: 0.26, height: 0.24 };
const hoopHeight = (z) => HOOP.height * smooth(0.28, 0.62, z) * (1 - smooth(0.66, 2.05, z));
// Side scoop that feeds the intake in front of each rear wheel
const SCOOP = { y: 0.44, halfHeight: 0.22, depth: 0.14 };
const scoopDepth = (z) => SCOOP.depth * smooth(-0.5, 0.82, z) * (1 - smooth(0.86, 0.99, z));
// Character line: a fine ridge along the flank, rising from the front fender to the haunch
const ridgeHeight = (z) => 0.012 * smooth(-1.75, -1.35, z) * (1 - smooth(0.75, 1.05, z));
const ridgeY = (z) => lerp(0.6, 0.71, smooth(-1.6, 0.9, z));
// Cockpit opening (plan view): a rounded rectangle cut out of the top of the slices
const COCKPIT = { z0: -0.66, z1: 0.36, half: 0.52, p: 3.5, floor: 0.3 };
function cockpitHalf(z) {
  const mid = (COCKPIT.z0 + COCKPIT.z1) / 2;
  const t = Math.abs((z - mid) / ((COCKPIT.z1 - COCKPIT.z0) / 2));
  return t >= 1 ? 0 : COCKPIT.half * (1 - t ** COCKPIT.p) ** (1 / COCKPIT.p);
}
// Wheel arch: an ellipse around each wheel; its centre sits low so the sides run down to the sill
const ARCH = { rz: 0.47, y0: 0.1, ry: 0.665 }; // arch top = 0.765 (tyre top = 0.72)
const WELL_X = 0.62; // inner wall of the wheel wells (tyre inner face is at 0.695)
function archCut(z) {
  let cut = -1;
  for (const az of AXLES) {
    const t = (z - az) / ARCH.rz;
    if (t > -1 && t < 1) cut = Math.max(cut, ARCH.y0 + ARCH.ry * Math.sqrt(1 - t * t));
  }
  return cut;
}

// Nose/tail rounding: 1 along the body, falling to 0 at the tips
function cap1(t, p) {
  return t <= 0 ? 1 : t >= 1 ? 0 : (1 - t ** p) ** (1 / p);
}
const capOf = (z, lf, pf, lr, pr) => cap1((Z_FRONT + lf - z) / lf, pf) * cap1((z - Z_REAR + lr) / lr, pr);
const capW = (z) => capOf(z, CAP.front.w, CAP.front.pw, CAP.rear.w, CAP.rear.pw);
const capT = (z) => capOf(z, CAP.front.t, CAP.front.pt, CAP.rear.t, CAP.rear.pt);
const capB = (z) => capOf(z, CAP.front.b, CAP.front.pb, CAP.rear.b, CAP.rear.pb);

// All the numbers that describe the slice at z
function sectionParams(z) {
  const cw = capW(z);
  const ch = capT(z);
  const yc = YC(z);
  const top = YTOP(z);
  const bot = YBOT(z);
  return {
    w: W(z) * cw,
    yc,
    ht: (top - yc) * ch,
    hb: (yc - bot) * capB(z),
    nt: NT(z),
    nb: NB(z),
    size: W(z) * cw + (top - bot) * ch,
    valley: VALLEY(z) * ch,
    valleyW: VALLEY_W(z),
    hoop: hoopHeight(z) * ch,
    scoop: scoopDepth(z),
    ridge: ridgeHeight(z),
    ridgeY: ridgeY(z),
  };
}

/* --------------------------------------------------------------------------
   3. ONE SLICE: the outline of the right half (x >= 0), from the top centre,
   over the shoulder, down the side, to the bottom centre. Returned as a
   dense polyline plus "u" (0..1, how far along the outline each point is,
   weighted so corners get more points than flat areas).
   -------------------------------------------------------------------------- */
const angleTables = new Map(); // per K: sin, cos and their logs for the K+1 directions
function anglesFor(K) {
  let t = angleTables.get(K);
  if (!t) {
    t = { sin: new Float64Array(K + 1), cos: new Float64Array(K + 1), ls: new Float64Array(K + 1), lc: new Float64Array(K + 1) };
    for (let k = 0; k <= K; k++) {
      const a = (k / K) * Math.PI;
      t.sin[k] = Math.sin(a);
      t.cos[k] = Math.cos(a);
      t.ls[k] = Math.log(Math.abs(t.sin[k]));
      t.lc[k] = Math.log(Math.abs(t.cos[k]));
    }
    angleTables.set(K, t);
  }
  return t;
}

function outline(z, K) {
  const s = sectionParams(z);
  const T = anglesFor(K);
  const x = new Float64Array(K + 1);
  const y = new Float64Array(K + 1);
  const u = new Float64Array(K + 1);
  const floorW = new Float64Array(K + 1);
  for (let k = 0; k <= K; k++) {
    // a direction from the slice centre, projected onto the superellipse:
    // r = (|dx|^n + |dy|^n)^(-1/n), written with exp/log (faster than pow)
    const dx = T.sin[k];
    const dy = T.cos[k];
    const upper = dy >= 0;
    const n = upper ? s.nt : s.nb;
    const r = Math.exp(-Math.log(Math.exp(n * T.ls[k]) + Math.exp(n * T.lc[k])) / n);
    const xn = r * dx; // 0 at the centre line, 1 at the widest point
    const ynk = r * dy; // 1 at the top, -1 at the floor
    let px = s.w * xn;
    let py = s.yc + (upper ? s.ht : s.hb) * ynk;
    // sculpting on the upper surface (fades out towards the widest point)
    if (ynk > 0) {
      const top = smooth(0, 0.35, ynk);
      const valley = s.valley * (1 - smooth(s.valleyW * 0.3, s.valleyW, xn));
      const hoop = s.hoop > 0 ? s.hoop * hump((px - HOOP.x) / HOOP.halfWidth) : 0;
      py += top * (hoop - valley);
    }
    // flank: the scoop pushes it in, the character line pushes a fine ridge out
    if (s.scoop > 0) px -= s.scoop * bell((py - SCOOP.y) / SCOOP.halfHeight);
    if (s.ridge > 0) px += s.ridge * bell((py - s.ridgeY) / 0.035) * (s.w > 0.5 ? 1 : 0);
    x[k] = px;
    y[k] = py;
    floorW[k] = 1 - 0.7 * smooth(-0.55, -0.9, ynk);
  }
  // u: arc length + a bonus for turning (more points in tight curves),
  // and the flat floor counts less (nobody looks at it)
  let total = 0;
  const bend = 0.06 * s.size;
  let pxv = 0;
  let pyv = 0;
  let pl = 0;
  for (let k = 1; k <= K; k++) {
    const ex = x[k] - x[k - 1];
    const ey = y[k] - y[k - 1];
    const l = Math.sqrt(ex * ex + ey * ey);
    let wgt = l;
    if (k >= 2 && l * pl > 1e-12) wgt += bend * Math.sqrt(Math.max(0, 2 - (2 * (pxv * ex + pyv * ey)) / (l * pl))); // ~ turning angle
    total += wgt * floorW[k];
    u[k] = total;
    pxv = ex;
    pyv = ey;
    pl = l;
  }
  for (let k = 0; k <= K; k++) u[k] = total > 1e-9 ? u[k] / total : k / K;
  return { x, y, u, K, s };
}

// point on the outline at a given u
function atU(o, uu) {
  let lo = 0;
  let hi = o.K;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (o.u[mid] <= uu) lo = mid;
    else hi = mid;
  }
  const span = o.u[hi] - o.u[lo];
  const t = span > 0 ? clamp((uu - o.u[lo]) / span, 0, 1) : 0;
  return [lerp(o.x[lo], o.x[hi], t), lerp(o.y[lo], o.y[hi], t)];
}
// u where the outline (walking out from the top centre) reaches x = xt
function uAtX(o, xt) {
  for (let k = 1; k <= o.K; k++) {
    if (o.x[k] >= xt) return lerp(o.u[k - 1], o.u[k], (xt - o.x[k - 1]) / (o.x[k] - o.x[k - 1] || 1));
  }
  return 1;
}
// u where the outline (walking up from the bottom centre) reaches y = yt
function uAtYFromBottom(o, yt) {
  for (let k = o.K; k >= 1; k--) {
    if (o.y[k - 1] >= yt) return lerp(o.u[k], o.u[k - 1], (yt - o.y[k]) / (o.y[k - 1] - o.y[k] || 1));
  }
  return 0;
}

/* --------------------------------------------------------------------------
   4. SURFACE QUERIES — used to put parts exactly ON the shell.
   They read the shell's own slices (the triangles you actually see), not the
   ideal curved surface, so a part lifted a few millimetres off the paint is
   really a few millimetres off everywhere: no paint poking through, at any tier.
   -------------------------------------------------------------------------- */
function shellSurface(rows) {
  const R = rows.length;
  const zs = rows.map((row) => row[0][2]);
  // the two slices around z, and how far z is between them
  function bracket(z) {
    let lo = 0;
    let hi = R - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (zs[m] <= z) lo = m;
      else hi = m;
    }
    return [lo, hi, clamp((z - zs[lo]) / (zs[hi] - zs[lo] || 1), 0, 1)];
  }
  // one slice: height of the top at x (walking out from the centre line)
  function rowTop(row, x) {
    for (let j = 1; j < row.length; j++) {
      if (row[j][0] >= x) return lerp(row[j - 1][1], row[j][1], clamp((x - row[j - 1][0]) / (row[j][0] - row[j - 1][0] || 1), 0, 1));
    }
    return row[row.length - 1][1];
  }
  // one slice: outer x of the flank at height y (walking up from the floor)
  function rowSide(row, y) {
    for (let j = row.length - 1; j >= 1; j--) {
      if (row[j - 1][1] >= y) return lerp(row[j][0], row[j - 1][0], clamp((y - row[j][1]) / (row[j - 1][1] - row[j][1] || 1), 0, 1));
    }
    return row[0][0];
  }
  // one slice: signed distance from (x, y) to its outline, > 0 inside. The half outline is closed by
  // the centre line, which a ray towards +x from x >= 0 never crosses, so it is simply left out.
  function rowDist(row, x, y) {
    let best = Infinity;
    let inside = false;
    for (let j = 0; j < row.length - 1; j++) {
      const a = row[j];
      const b = row[j + 1];
      if (a[1] > y !== b[1] > y && x < a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0])) inside = !inside;
      const ex = b[0] - a[0];
      const ey = b[1] - a[1];
      const t = clamp(((x - a[0]) * ex + (y - a[1]) * ey) / (ex * ex + ey * ey || 1), 0, 1);
      const dx = x - a[0] - ex * t;
      const dy = y - a[1] - ey * t;
      best = Math.min(best, dx * dx + dy * dy);
    }
    best = Math.sqrt(best);
    return inside ? best : -best;
  }
  return {
    topY(z, x) {
      const [a, b, t] = bracket(z);
      return lerp(rowTop(rows[a], Math.abs(x)), rowTop(rows[b], Math.abs(x)), t);
    },
    sideX(z, y) {
      const [a, b, t] = bracket(z);
      return lerp(rowSide(rows[a], y), rowSide(rows[b], y), t);
    },
    // project along z onto the nose (dir = -1) or the tail (dir = +1): (x, y) -> surface z
    projector(dir) {
      const tip = dir < 0 ? 0 : R - 1;
      const step = dir < 0 ? 1 : -1; // walking inwards from the tip
      let last = tip + step;
      return (x, y) => {
        const ax = Math.abs(x);
        let k = last;
        let dk = rowDist(rows[k], ax, y);
        if (dk >= 0) {
          // inside this slice: walk towards the tip until we leave the body
          while (k !== tip) {
            const kp = k - step;
            const dp = rowDist(rows[kp], ax, y);
            if (dp < 0) {
              last = k;
              return lerp(zs[kp], zs[k], -dp / (dk - dp));
            }
            k = kp;
            dk = dp;
          }
          return zs[tip];
        }
        // outside: walk inwards until we enter the body
        for (;;) {
          const kn = k + step;
          if (kn < 0 || kn >= R) return zs[k];
          const dn = rowDist(rows[kn], ax, y);
          if (dn >= 0) {
            last = kn;
            return lerp(zs[k], zs[kn], -dk / (dn - dk));
          }
          k = kn;
          dk = dn;
        }
      };
    },
  };
}

/* --------------------------------------------------------------------------
   5. GEOMETRY HELPERS
   -------------------------------------------------------------------------- */
const _v = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
// A grid of points (rows x columns) -> indexed triangles. Zero-area triangles
// (where cut-away points collapse onto the cut edge) are dropped.
function gridGeometry(rows, { flip = false, wrap = false, uv = null } = {}) {
  const R = rows.length;
  const C = rows[0].length;
  const pos = new Float32Array(R * C * 3);
  let o = 0;
  for (let i = 0; i < R; i++) {
    for (let j = 0; j < C; j++) {
      const q = rows[i][j];
      pos[o++] = q[0];
      pos[o++] = q[1];
      pos[o++] = q[2];
    }
  }
  const cols = wrap ? C : C - 1;
  const idx = new Uint32Array(Math.max(0, R - 1) * cols * 6);
  let n = 0;
  const tri = (a, b, c) => {
    const a3 = a * 3;
    const b3 = b * 3;
    const c3 = c * 3;
    const ux = pos[b3] - pos[a3], uy = pos[b3 + 1] - pos[a3 + 1], uz = pos[b3 + 2] - pos[a3 + 2];
    const vx = pos[c3] - pos[a3], vy = pos[c3 + 1] - pos[a3 + 1], vz = pos[c3 + 2] - pos[a3 + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * cx + cy * cy + cz * cz < 1e-16) return; // degenerate
    idx[n++] = a;
    idx[n++] = flip ? c : b;
    idx[n++] = flip ? b : c;
  };
  for (let i = 0; i < R - 1; i++) {
    for (let j = 0; j < cols; j++) {
      const j1 = (j + 1) % C;
      tri(i * C + j, (i + 1) * C + j, i * C + j1);
      tri((i + 1) * C + j, (i + 1) * C + j1, i * C + j1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (uv) {
    const uvs = new Float32Array(R * C * 2);
    for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) uvs.set(uv(i / (R - 1), j / (C - 1)), (i * C + j) * 2);
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }
  g.setIndex(new THREE.BufferAttribute(idx.slice(0, n), 1));
  return g;
}

// Smooth vertex normals (area-weighted face normals), straight on the typed arrays
function fastNormals(g) {
  const p = g.attributes.position.array;
  const idx = g.index.array;
  const nr = new Float32Array(p.length);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3;
    const b = idx[i + 1] * 3;
    const c = idx[i + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    nr[a] += cx; nr[a + 1] += cy; nr[a + 2] += cz;
    nr[b] += cx; nr[b + 1] += cy; nr[b + 2] += cz;
    nr[c] += cx; nr[c + 1] += cy; nr[c + 2] += cz;
  }
  for (let i = 0; i < nr.length; i += 3) {
    const l = Math.sqrt(nr[i] * nr[i] + nr[i + 1] * nr[i + 1] + nr[i + 2] * nr[i + 2]);
    if (l > 0) {
      nr[i] /= l;
      nr[i + 1] /= l;
      nr[i + 2] /= l;
    }
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nr, 3));
  return g;
}

function flipFaces(g) {
  const idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = t;
  }
  g.index.needsUpdate = true;
  return g;
}

// Mirror a right-side geometry to the left (x -> -x), keeping faces outward
function mirrorX(geo) {
  const g = geo.clone();
  const p = g.attributes.position;
  const n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    p.setX(i, -p.getX(i));
    if (n) n.setX(i, -n.getX(i));
  }
  return flipFaces(g);
}

// Right half + its mirror image, with normals made exactly symmetric on the centre line
function symmetric(rightHalf) {
  fastNormals(rightHalf);
  const p = rightHalf.attributes.position.array;
  const n = rightHalf.attributes.normal.array;
  const idx = rightHalf.index.array;
  const V = p.length / 3;
  for (let i = 0; i < p.length; i += 3) {
    if (Math.abs(p[i]) < 1e-6) {
      const l = Math.sqrt(n[i + 1] * n[i + 1] + n[i + 2] * n[i + 2]) || 1;
      n[i] = 0;
      n[i + 1] /= l;
      n[i + 2] /= l;
    }
  }
  // second half = mirror image: x and the normal's x flip, triangles wind the other way
  const P = new Float32Array(p.length * 2);
  const N = new Float32Array(p.length * 2);
  P.set(p);
  N.set(n);
  for (let i = 0; i < p.length; i += 3) {
    P[p.length + i] = -p[i];
    P[p.length + i + 1] = p[i + 1];
    P[p.length + i + 2] = p[i + 2];
    N[p.length + i] = -n[i];
    N[p.length + i + 1] = n[i + 1];
    N[p.length + i + 2] = n[i + 2];
  }
  const I = new Uint32Array(idx.length * 2);
  I.set(idx);
  for (let i = 0; i < idx.length; i += 3) {
    I[idx.length + i] = idx[i] + V;
    I[idx.length + i + 1] = idx[i + 2] + V;
    I[idx.length + i + 2] = idx[i + 1] + V;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setIndex(new THREE.BufferAttribute(I, 1));
  return g;
}

// Keep only position + normal (+ uv when asked) and make sure there is an index, so parts can be merged
function clean(g, keepUv = false) {
  if (!g.index) g.setIndex(Array.from({ length: g.attributes.position.count }, (_, i) => i));
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && !(keepUv && name === 'uv')) g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (keepUv && !g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return g;
}
const merge = (list, keepUv = false) => mergeGeometries(list.filter(Boolean).map((g) => clean(g, keepUv)));
const both = (g) => [g, mirrorX(g)]; // a right-side part and its left twin

// Superellipsoid ("pebble" / rounded box): radii rx, ry, rz and squareness n
function superellipsoid(rx, ry, rz, n = 3, seg = 16, rings = 10) {
  const e = 2 / n;
  const rows = [];
  for (let i = 0; i <= rings; i++) {
    const v = -Math.PI / 2 + (i / rings) * Math.PI;
    const cv = Math.cos(v);
    const sv = Math.sin(v);
    const row = [];
    for (let j = 0; j < seg; j++) {
      const u = (j / seg) * Math.PI * 2;
      row.push([rx * spow(cv, e) * spow(Math.cos(u), e), ry * spow(sv, e), rz * spow(cv, e) * spow(Math.sin(u), e)]);
    }
    rows.push(row);
  }
  const g = fastNormals(gridGeometry(rows, { wrap: true, flip: true }));
  // poles: straight down / up
  const p = g.attributes.position;
  const nn = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    if (i < seg) nn.setXYZ(i, 0, -1, 0);
    else if (i >= rings * seg) nn.setXYZ(i, 0, 1, 0);
  }
  return g;
}
// place a part: rotation (x, y, z) then position
function place(g, [px, py, pz], [rx = 0, ry = 0, rz = 0] = []) {
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  return g.translate(px, py, pz);
}

// A tube along a list of points
function tube(points, radius, closed, seg, radial) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed, 'centripetal');
  return new THREE.TubeGeometry(curve, seg, radius, radial, closed);
}

// A panel lying on the body: rows of points ON the surface are lifted along the surface
// normal; optional side walls make it read as a separate raised part (lights, blades).
function panel(rows, { lift = 0.004, wall = 0, dir = null, uv = null } = {}) {
  const g = gridGeometry(rows, { uv });
  fastNormals(g);
  const p = g.attributes.position;
  const n = g.attributes.normal;
  if (dir) {
    // make sure the panel faces outwards
    let dot = 0;
    for (let i = 0; i < n.count; i++) dot += n.getX(i) * dir[0] + n.getY(i) * dir[1] + n.getZ(i) * dir[2];
    if (dot < 0) {
      flipFaces(g);
      fastNormals(g);
    }
  }
  const base = p.array.slice();
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * lift, p.getY(i) + n.getY(i) * lift, p.getZ(i) + n.getZ(i) * lift);
  if (!wall) return g;
  // walls: around the border, from the lifted edge down into the body
  const R = rows.length;
  const C = rows[0].length;
  const loop = [];
  for (let j = 0; j < C; j++) loop.push(j);
  for (let i = 1; i < R; i++) loop.push(i * C + C - 1);
  for (let j = C - 2; j >= 0; j--) loop.push((R - 1) * C + j);
  for (let i = R - 2; i >= 0; i--) loop.push(i * C);
  const top = loop.map((v) => [p.getX(v), p.getY(v), p.getZ(v)]);
  const bottom = loop.map((v) => [base[v * 3] - n.getX(v) * wall, base[v * 3 + 1] - n.getY(v) * wall, base[v * 3 + 2] - n.getZ(v) * wall]);
  const w = gridGeometry([top, bottom]);
  fastNormals(w);
  // walls must face away from the panel's centre
  const centre = new THREE.Vector3();
  top.forEach((t) => centre.add(_v.fromArray(t)));
  centre.divideScalar(top.length);
  let out = 0;
  const wp = w.attributes.position;
  const wn = w.attributes.normal;
  for (let i = 0; i < top.length; i++) out += _v.fromBufferAttribute(wp, i).sub(centre).dot(_e1.fromBufferAttribute(wn, i));
  if (out < 0) {
    flipFaces(w);
    fastNormals(w);
  }
  return merge([g, w], !!uv);
}

// Canvas textures (only in the browser; in Node the parts simply stay plain)
function canvasTexture(w, h, draw) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
// honeycomb mesh for the intakes and the rear grille
const honeycomb = () =>
  canvasTexture(128, 128, (ctx, w) => {
    ctx.fillStyle = '#020203';
    ctx.fillRect(0, 0, w, w);
    ctx.strokeStyle = '#3a3a40';
    ctx.lineWidth = 3;
    const r = w / 6;
    const hgt = r * Math.sqrt(3);
    for (let row = -1; row < 4; row++) {
      for (let col = -1; col < 5; col++) {
        const cx = col * r * 1.5;
        const cy = row * hgt + (col % 2 ? hgt / 2 : 0);
        ctx.beginPath();
        for (let k = 0; k <= 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          ctx.lineTo(cx + Math.cos(a) * r * 0.92, cy + Math.sin(a) * r * 0.92);
        }
        ctx.stroke();
      }
    }
  });

/* --------------------------------------------------------------------------
   6. THE SHELL (painted body) + wheel wells + cockpit tub
   -------------------------------------------------------------------------- */
// Slices along z: more of them where the shape changes quickly
function makeStations(N) {
  const features = [
    [Z_FRONT, 0.05, 8], [Z_FRONT, 0.3, 2.5], [Z_REAR, 0.03, 8], [Z_REAR, 0.14, 3],
    ...AXLES.flatMap((a) => [[a - ARCH.rz, 0.05, 3], [a + ARCH.rz, 0.05, 3], [a, 0.45, 0.8]]),
    [COCKPIT.z0, 0.04, 3], [COCKPIT.z1, 0.05, 3], [0.45, 0.14, 1.2], [0.93, 0.07, 1.5],
  ];
  const density = (z) => {
    let d = 1;
    for (const [c, w, a] of features) d += a * Math.exp(-(((z - c) / w) ** 2));
    return d;
  };
  const S = 800;
  const cum = new Float64Array(S + 1);
  for (let i = 1; i <= S; i++) cum[i] = cum[i - 1] + density(lerp(Z_FRONT, Z_REAR, (i - 0.5) / S));
  const out = [];
  let k = 0;
  for (let i = 0; i < N; i++) {
    const target = (cum[S] * i) / (N - 1);
    while (k < S - 1 && cum[k + 1] < target) k++;
    const t = clamp((target - cum[k]) / (cum[k + 1] - cum[k] || 1), 0, 1);
    out.push(lerp(Z_FRONT, Z_REAR, (k + t) / S));
  }
  out[0] = Z_FRONT;
  out[N - 1] = Z_REAR;
  // the cockpit ends get an exact slice so the opening closes cleanly
  for (const zc of [COCKPIT.z0, COCKPIT.z1]) {
    let best = 0;
    out.forEach((z, i) => (Math.abs(z - zc) < Math.abs(out[best] - zc) ? (best = i) : 0));
    out[best] = zc;
  }
  return out;
}

function buildShell(q) {
  const stations = makeStations(q.stations);
  const rows = [];
  const slices = []; // per slice: where the cockpit lip and the arch cut are
  for (const z of stations) {
    const o = outline(z, q.dense);
    const c = cockpitHalf(z);
    const uLip = c > 0 ? uAtX(o, c) : 0;
    const cut = archCut(z);
    const bottomY = o.y[o.K];
    const uCut = cut > bottomY ? uAtYFromBottom(o, cut) : 1;
    const row = [];
    // columns outside [uLip, uCut] collapse onto the cockpit lip / arch edge,
    // so those edges are exact curves and the cut-away part disappears
    for (let j = 0; j <= q.cols; j++) {
      const [x, y] = atU(o, clamp(j / q.cols, uLip, uCut));
      row.push([x, y, z]);
    }
    rows.push(row);
    slices.push({ z, lip: c > 0 ? atU(o, uLip) : [0, o.y[0]], cut: cut > bottomY ? atU(o, uCut) : null, bottomY });
  }
  const body = symmetric(gridGeometry(rows));
  // nose and tail tips: the surface faces straight forward / back there
  const n = body.attributes.normal;
  const p = body.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(p.getZ(i) - Z_FRONT) < 1e-6) n.setXYZ(i, 0, 0, -1);
    if (Math.abs(p.getZ(i) - Z_REAR) < 1e-6) n.setXYZ(i, 0, 0, 1);
  }
  return { body, slices, surf: shellSurface(rows) };
}

// Wheel wells: ceiling under the fender, inner wall, and a floor plate (matte black)
function buildWells(slices) {
  const parts = [];
  for (const az of AXLES) {
    const rows = [];
    for (const s of slices) {
      if (Math.abs(s.z - az) >= ARCH.rz || !s.cut) continue;
      const [x0, y0] = s.cut;
      const xw = Math.min(WELL_X, x0);
      const yf = Math.min(y0, s.bottomY + 0.004);
      // duplicated corner points keep the corners crisp
      rows.push([[x0, y0, s.z], [xw, y0, s.z], [xw, y0, s.z], [xw, yf, s.z], [xw, yf, s.z], [0, yf, s.z]]);
    }
    if (rows.length > 1) parts.push(gridGeometry(rows));
  }
  return symmetric(mergeGeometries(parts));
}

// Cockpit tub: from the lip down the inner wall to the floor (dark interior)
function buildCockpitTub(slices) {
  const rows = [];
  const lip = []; // the opening's edge, for the leather roll around it
  for (const s of slices) {
    if (s.z < COCKPIT.z0 - 1e-6 || s.z > COCKPIT.z1 + 1e-6) continue;
    const [c, yl] = s.lip;
    const fl = COCKPIT.floor;
    lip.push([c, yl, s.z]);
    rows.push([
      [c, yl, s.z],
      [c - Math.min(0.012, c * 0.2), yl - 0.03, s.z],
      [c - Math.min(0.03, c * 0.5), lerp(yl, fl, 0.6), s.z],
      [c - Math.min(0.045, c * 0.7), fl + 0.03, s.z],
      [c - Math.min(0.08, c * 0.85), fl, s.z],
      [0, fl, s.z],
    ]);
  }
  return { tub: symmetric(gridGeometry(rows, { flip: true })), lip };
}

/* --------------------------------------------------------------------------
   7. DETAILS ON THE BODY
   -------------------------------------------------------------------------- */
// Front: slim LED headlight strips in a dark recess, lower intake, corner intakes, hood vents, splitter
function buildFront(q, surf) {
  const proj = surf.projector(-1);
  const onNose = (x, y) => [x, y, proj(x, y)];
  // headlight path (right side): runs along the top of the fascia and sweeps up into the fender
  const hx = (s) => lerp(0.3, 0.88, s);
  const hy = (s) => 0.405 + 0.06 * spow(s, 1.5);
  const strip = (h, ext) => {
    const rows = [];
    for (let i = 0; i <= 18; i++) {
      const s = lerp(-ext, 1 + ext * 0.3, i / 18);
      const row = [];
      for (let j = 0; j <= 2; j++) row.push(onNose(hx(s), hy(s) + lerp(h, -h, j / 2)));
      rows.push(row);
    }
    return rows;
  };
  const lens = panel(strip(0.013, 0), { lift: 0.009, wall: 0.014, dir: [0, 0, -1] });
  const housing = panel(strip(0.03, 0.05), { lift: 0.004, wall: 0.012, dir: [0, 0, -1] });
  const lightCentre = onNose(hx(0.5), hy(0.5));
  lightCentre[2] -= 0.01;

  // lower intake: a wide mouth in the upright fascia, its top edge curving down at the sides
  const mouthRows = [];
  for (let i = 0; i <= 6; i++) {
    const v = i / 6;
    const row = [];
    for (let j = 0; j <= 26; j++) {
      const s = lerp(-1, 1, j / 26);
      row.push(onNose(s * lerp(0.56, 0.63, v), lerp(0.19, 0.345 - 0.03 * s * s, v)));
    }
    mouthRows.push(row);
  }
  const mouth = panel(mouthRows, { lift: 0.004, wall: 0.008, dir: [0, 0, -1], uv: (v, u) => [u * 13, v * 1.7] });
  // corner intakes (air curtains) at the outer edges of the fascia
  const cornerRows = [];
  for (let i = 0; i <= 5; i++) {
    const v = i / 5;
    const row = [];
    for (let j = 0; j <= 4; j++) row.push(onNose(lerp(0.72, 0.82, j / 4) + v * 0.015, lerp(0.27, 0.36, v)));
    cornerRows.push(row);
  }
  const corner = panel(cornerRows, { lift: 0.004, wall: 0.008, dir: [0, 0, -1], uv: (v, u) => [u * 2, v * 2] });
  // hood vents: heat extractors just behind the headlights
  const ventRows = [];
  for (let i = 0; i <= 6; i++) {
    const z = lerp(-1.8, -1.5, i / 6);
    const row = [];
    for (let j = 0; j <= 6; j++) {
      const x = lerp(0.3, 0.5, j / 6) + (i / 6) * 0.03;
      row.push([x, surf.topY(z, x), z]);
    }
    ventRows.push(row);
  }
  const vent = panel(ventRows, { lift: 0.004, wall: 0.008, dir: [0, 1, 0], uv: (v, u) => [u * 3, v * 4] });

  // splitter: a thin carbon plate that follows the nose and sticks out a little
  const shape = new THREE.Shape();
  shape.moveTo(-0.84, 1.62);
  for (let i = 0; i <= 20; i++) {
    const x = lerp(-0.8, 0.8, i / 20);
    shape.lineTo(x * 1.04, -(proj(x, 0.2) - 0.02 - 0.03 * Math.abs(x))); // shape y = -z
  }
  shape.lineTo(0.84, 1.62);
  shape.closePath();
  const splitter = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.008, bevelSegments: 2, curveSegments: 4 });
  splitter.rotateX(-Math.PI / 2); // shape plane -> ground plane (shape y -> -z, thickness -> up)
  splitter.translate(0, 0.104, 0);

  return {
    lights: merge(both(lens)),
    housing: merge(both(housing)),
    grille: merge([mouth, ...both(corner), ...both(vent)], true),
    splitter, // matte black: a shiny plate would mirror the bright floor
    headlights: [lightCentre, [-lightCentre[0], lightCentre[1], lightCentre[2]]],
  };
}

// Rear: full-width LED bar, dark grille, twin exhausts, carbon lip spoiler and diffuser
function buildRear(q, surf) {
  const proj = surf.projector(1);
  const onTail = (x, y) => [x, y, proj(x, y)];
  // light bar across the rear face, just under the deck edge, wrapping round the corners
  const barY = (s) => 0.84 + 0.012 * s * s;
  const bar = (h, halfW) => {
    const rows = [];
    for (let i = 0; i <= 2; i++) {
      const row = [];
      for (let j = 0; j <= 44; j++) {
        const s = lerp(-1, 1, j / 44);
        row.push(onTail(s * halfW, barY(s) + lerp(h, -h, i / 2)));
      }
      rows.push(row);
    }
    return rows;
  };
  const lens = panel(bar(0.024, 0.9), { lift: 0.009, wall: 0.014, dir: [0, 0, 1] });
  const housing = panel(bar(0.05, 0.93), { lift: 0.004, wall: 0.01, dir: [0, 0, 1] });
  const tailY = barY(0.7 / 0.9);
  const tailZ = proj(0.7, tailY) + 0.01;

  // dark grille between the light bar and the diffuser
  const gRows = [];
  for (let i = 0; i <= 5; i++) {
    const v = i / 5;
    const row = [];
    for (let j = 0; j <= 24; j++) {
      const s = lerp(-1, 1, j / 24);
      row.push(onTail(s * lerp(0.62, 0.52, v), lerp(0.71, 0.39, v)));
    }
    gRows.push(row);
  }
  const grille = panel(gRows, { lift: 0.004, wall: 0.008, dir: [0, 0, 1], uv: (v, u) => [u * 13, v * 3.2] });

  // twin exhaust tips poking out of the grille
  const tips = [];
  const holes = [];
  for (const x of [-0.17, 0.17]) {
    const y = 0.47;
    const z = proj(x, y);
    const ring = latheX([[0.046, -0.06], [0.052, -0.06], [0.056, 0.0], [0.056, 0.036], [0.051, 0.042], [0.045, 0.037], [0.045, -0.06]], q.detail ? 28 : 18);
    ring.rotateY(-Math.PI / 2); // axis x -> z (points backwards)
    tips.push(ring.translate(x, y, z - 0.018));
    holes.push(new THREE.CircleGeometry(0.046, q.detail ? 24 : 16).translate(x, y, z + 0.004));
  }

  // carbon lip spoiler along the deck's rear edge: a crisp edge where deck meets tail
  const lipRows = [];
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    const row = [];
    for (let j = 0; j <= 30; j++) {
      const x = lerp(-0.88, 0.88, j / 30);
      const zEdge = proj(x, 0.9);
      const z = Math.min(zEdge - 0.12 + 0.15 * t, Z_REAR + 0.02);
      row.push([x, surf.topY(Math.min(z, zEdge - 0.03), x) + 0.003 + 0.028 * t * t, z]);
    }
    lipRows.push(row);
  }
  const lip = panel(lipRows, { lift: 0.0, wall: 0.016, dir: [0, 1, 0] });

  // diffuser: a carbon ramp under the tail with vertical fins
  const parts = [];
  const halfW = (z) => Math.min(0.74, 0.85 * sectionParams(z).w);
  const rampY = (t) => 0.125 + 0.2 * smooth(0, 1, t);
  const dRows = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const z = lerp(1.78, 2.21, t);
    const w = halfW(z);
    dRows.push([[-w, rampY(t), z], [-w * 0.33, rampY(t), z], [w * 0.33, rampY(t), z], [w, rampY(t), z]]);
  }
  parts.push(gridGeometry(dRows, { flip: true }));
  for (const fx of [-0.56, -0.34, -0.12, 0.12, 0.34, 0.56]) {
    const fin = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const z = lerp(1.82, 2.235, t);
      fin.push([[fx, 0.118, z], [fx, Math.max(0.124, rampY(t * 1.05 - 0.05)), z]]);
    }
    const g = gridGeometry(fin);
    parts.push(g, flipFaces(g.clone()));
  }
  // dark back wall of the diffuser tunnels
  const back = new THREE.PlaneGeometry(1.24, 0.24).translate(0, 0.235, 2.16);
  return {
    brakes: lens,
    housing: merge([housing, ...holes]),
    grille,
    trim: merge(tips),
    carbon: merge([lip, ...parts]),
    matte: back,
    taillights: [[0.7, tailY, tailZ], [-0.7, tailY, tailZ]],
  };
}

// Flanks: intake at the back of each side scoop, carbon sill blades, mirrors, engine-cover louvres
function buildSides(q, surf) {
  // intake grille on the rear wall of the scoop (right side, then mirrored)
  const iRows = [];
  for (let i = 0; i <= 8; i++) {
    const z = lerp(0.84, 0.985, i / 8);
    const row = [];
    for (let j = 0; j <= 6; j++) {
      const y = lerp(0.6, 0.29, j / 6);
      row.push([surf.sideX(z, y), y, z]);
    }
    iRows.push(row);
  }
  const intake = panel(iRows, { lift: 0.004, wall: 0.008, dir: [0.6, 0, -0.8], uv: (v, u) => [v * 2.2, u * 4] });
  // sill blade between the wheels
  const sRows = [];
  for (let i = 0; i <= 14; i++) {
    const z = lerp(-0.64, 0.99, i / 14);
    const flare = smooth(-0.64, -0.4, z) * (1 - smooth(0.8, 0.99, z));
    sRows.push([[surf.sideX(z, 0.215), 0.215, z], [surf.sideX(z, 0.165) + 0.012 * flare, 0.165, z], [surf.sideX(z, 0.135) + 0.03 * flare, 0.128, z]]);
  }
  const sill = panel(sRows, { lift: 0.004, wall: 0.008, dir: [1, 0, 0] });

  // mirrors: painted housing on a short carbon stalk, mirror glass facing back
  const zm = -0.52;
  const base = [0.8, surf.topY(zm, 0.8) - 0.01, zm];
  const head = [0.985, base[1] + 0.085, zm - 0.04];
  const housing = place(superellipsoid(0.085, 0.044, 0.068, 3, q.detail ? 18 : 12, q.detail ? 10 : 8), head, [0, -0.1, 0.04]);
  const stalk = tube([base, [0.86, base[1] + 0.05, zm - 0.02], [head[0] - 0.06, head[1] - 0.005, head[2]]], 0.013, false, 8, 6);
  const glassFace = place(superellipsoid(0.074, 0.034, 0.008, 3, 14, 6), [head[0] + 0.006, head[1], head[2] + 0.064], [0, -0.1, 0.04]);

  // engine-cover louvres between the roll-hoop fairings: thin slats over a dark vent
  const slats = [];
  for (let k = 0; k < 9; k++) {
    const z = lerp(0.99, 1.67, k / 8);
    slats.push(new THREE.BoxGeometry(0.19, 0.012, 0.024).translate(0, surf.topY(z, 0) + 0.011, z));
  }
  const ventRows = [];
  for (let i = 0; i <= 8; i++) {
    const z = lerp(0.95, 1.71, i / 8);
    const row = [];
    for (let j = 0; j <= 4; j++) {
      const x = lerp(-0.11, 0.11, j / 4);
      row.push([x, surf.topY(z, x), z]);
    }
    ventRows.push(row);
  }
  const ventBase = panel(ventRows, { lift: 0.004, wall: 0.008, dir: [0, 1, 0] });
  return {
    grille: merge(both(intake), true),
    carbon: merge([...both(sill), ...both(stalk), ...slats]),
    housing: ventBase,
    paint: merge(both(housing)),
    trim: merge(both(glassFace)),
  };
}

// Windscreen: a low wraparound visor that sits on the cowl, with a bright frame on top
function buildWindscreen(q, surf) {
  const nS = q.detail ? 24 : 14;
  const nT = q.detail ? 8 : 5;
  const base = (s) => {
    const x = 0.7 * s;
    const z = -0.87 + 0.27 * s * s;
    return [x, surf.topY(z, x) - 0.004, z];
  };
  const header = (s) => [0.6 * s, 1.045 - 0.1 * s ** 4, -0.5 + 0.15 * s * s];
  const rows = [];
  for (let i = 0; i <= nT; i++) {
    const t = i / nT;
    const row = [];
    for (let j = 0; j <= nS; j++) {
      const s = lerp(-1, 1, j / nS);
      const b = base(s);
      const h = header(s);
      const bulge = t * (1 - t) * 0.06; // gently curved glass, bowed forwards
      row.push([lerp(b[0], h[0], t) * (1 + bulge * 0.4), lerp(b[1], h[1], t) + bulge * 0.4, lerp(b[2], h[2], t) - bulge * 0.9]);
    }
    rows.push(row);
  }
  const front = fastNormals(gridGeometry(rows));
  let dot = 0;
  for (let i = 0; i < front.attributes.normal.count; i++) dot += front.attributes.normal.getZ(i);
  if (dot > 0) fastNormals(flipFaces(front));
  // glass is seen from both sides: add a back face with flipped normals
  const backFace = flipFaces(front.clone());
  const bn = backFace.attributes.normal;
  for (let i = 0; i < bn.count; i++) bn.setXYZ(i, -bn.getX(i), -bn.getY(i), -bn.getZ(i));
  // frame along the top and down the sides
  const framePts = [base(-1), header(-1.0), header(-0.5), header(0), header(0.5), header(1.0), base(1)];
  framePts[0][1] += 0.01;
  framePts[6][1] += 0.01;
  const frame = tube(framePts, 0.009, false, q.detail ? 36 : 20, 6);
  return { glass: merge([front, backFace]), trim: frame };
}

// Interior: seats with headrests, dashboard, steering wheel, centre console
function buildInterior(q) {
  const seg = q.detail ? 18 : 12;
  const rings = q.detail ? 10 : 8;
  const seats = [];
  const dark = [];
  const fl = COCKPIT.floor;
  for (const sx of [-0.27, 0.27]) {
    const tilt = 0.3; // seat back leans back
    seats.push(place(superellipsoid(0.19, 0.055, 0.2, 3, seg, rings), [sx, fl + 0.075, 0.07], [-0.06, 0, 0]));
    seats.push(place(superellipsoid(0.19, 0.27, 0.05, 3, seg, rings), [sx, fl + 0.36, 0.27], [tilt, 0, 0]));
    for (const bx of [-1, 1]) {
      seats.push(place(superellipsoid(0.045, 0.22, 0.075, 3, 12, 8), [sx + bx * 0.165, fl + 0.32, 0.235], [tilt, 0, bx * -0.08]));
      seats.push(place(superellipsoid(0.04, 0.05, 0.18, 3, 12, 6), [sx + bx * 0.17, fl + 0.12, 0.06], [-0.06, 0, 0]));
    }
    // headrest pad in front of the hoop fairing
    seats.push(place(superellipsoid(0.105, 0.08, 0.045, 3, seg, rings), [sx, fl + 0.68, 0.36], [tilt, 0, 0]));
  }
  // dashboard across the front of the cockpit, with the instrument cowl on the driver's side (left)
  dark.push(place(superellipsoid(0.54, 0.11, 0.17, 3.5, 24, 10), [0, 0.7, -0.66]));
  dark.push(place(superellipsoid(0.15, 0.05, 0.08, 3, 14, 8), [-0.27, 0.8, -0.55], [0.2, 0, 0]));
  // steering wheel: rim, three spokes, hub and column
  const wheel = [];
  const wheelPos = [-0.27, 0.73, -0.38];
  wheel.push(new THREE.TorusGeometry(0.155, 0.016, 8, q.detail ? 28 : 18));
  for (const a of [0, Math.PI * 0.85, -Math.PI * 0.85]) {
    const spoke = new THREE.BoxGeometry(0.02, 0.14, 0.012);
    spoke.translate(0, -0.075, 0);
    spoke.rotateZ(a + Math.PI);
    wheel.push(spoke);
  }
  wheel.push(superellipsoid(0.045, 0.045, 0.02, 3, 12, 6));
  const column = new THREE.CylinderGeometry(0.022, 0.026, 0.3, 10);
  column.rotateX(Math.PI / 2);
  column.translate(0, 0, -0.16);
  wheel.push(column);
  const wheelGeo = merge(wheel);
  wheelGeo.rotateX(-0.42);
  wheelGeo.translate(...wheelPos);
  dark.push(wheelGeo);
  // centre console between the seats
  const tunnel = place(superellipsoid(0.08, 0.1, 0.38, 4, 12, 8), [0, fl + 0.08, -0.16]);
  return { seats: merge(seats), cabin: merge(dark), carbon: tunnel };
}

/* --------------------------------------------------------------------------
   8. WHEELS
   -------------------------------------------------------------------------- */
// Lathe around the x axis: profile points are [radius, x]
function latheX(profile, seg, phiStart = 0, phiLength = Math.PI * 2) {
  const g = new THREE.LatheGeometry(profile.map(([r, x]) => new THREE.Vector2(r, x)), seg, phiStart, phiLength);
  g.rotateZ(-Math.PI / 2); // lathe axis y -> x
  return g;
}

function buildTyre(seg) {
  const h = TYRE_W / 2;
  const profile = [
    [0.286, -h + 0.025], [0.3, -h + 0.006], [0.322, -h], [0.342, -h + 0.006], [0.354, -h + 0.02],
    [0.36, -h + 0.04], [0.36, -0.03], [0.3565, -0.024], [0.3565, -0.012], [0.36, -0.006],
    [0.36, 0.006], [0.3565, 0.012], [0.3565, 0.024], [0.36, 0.03], [0.36, h - 0.04],
    [0.354, h - 0.02], [0.342, h - 0.006], [0.322, h], [0.3, h - 0.006], [0.286, h - 0.025],
  ];
  return clean(latheX(profile, seg));
}

// Rim: lip + barrel + 5 twin spokes + hub, built facing +x (outwards); x = 0 is the spoke face
function buildRim(seg, detail) {
  const parts = [];
  // outer lip and the barrel behind it
  parts.push(latheX([[0.235, 0.004], [0.262, 0.012], [0.279, 0.014], [0.287, 0.006], [0.287, -0.008], [0.272, -0.02], [0.268, -0.06], [0.266, -0.2]], seg));
  // hub + centre cap
  parts.push(latheX([[0.0, 0.022], [0.03, 0.021], [0.045, 0.016], [0.05, 0.008], [0.07, 0.0], [0.082, -0.012], [0.084, -0.05]], Math.max(20, seg / 2)));
  // lug nuts
  if (detail > 0) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + Math.PI / 5;
      const nut = new THREE.CylinderGeometry(0.009, 0.009, 0.014, 8);
      nut.rotateZ(Math.PI / 2);
      nut.translate(0.012, Math.cos(a) * 0.058, Math.sin(a) * 0.058);
      parts.push(nut);
    }
  }
  // spokes: each is a small loft of rounded-rectangle sections from hub to lip
  const stations = detail > 0 ? 7 : 5;
  const around = detail > 0 ? 10 : 8;
  for (let i = 0; i < 5; i++) {
    for (const side of [-1, 1]) {
      const rows = [];
      for (let k = 0; k <= stations; k++) {
        const t = k / stations;
        const r = lerp(0.066, 0.268, t);
        const ang = (i / 5) * Math.PI * 2 + side * lerp(0.05, 0.15, t); // twin spokes split towards the lip
        const face = lerp(-0.028, 0.008, Math.sqrt(t)); // concave: the hub sits deeper than the lip
        const hw = lerp(0.019, 0.012, t); // half width (tangential)
        const hd = lerp(0.02, 0.011, t); // half depth (axial)
        const cy = Math.cos(ang) * r;
        const cz = Math.sin(ang) * r;
        const ty = -Math.sin(ang);
        const tz = Math.cos(ang);
        const row = [];
        for (let m = 0; m < around; m++) {
          const a = (m / around) * Math.PI * 2;
          const ox = spow(Math.cos(a), 0.6) * hd; // axial
          const ot = spow(Math.sin(a), 0.6) * hw; // tangential
          row.push([face - hd + ox, cy + ty * ot, cz + tz * ot]);
        }
        rows.push(row);
      }
      parts.push(fastNormals(gridGeometry(rows, { wrap: true, flip: true })));
    }
  }
  return merge(parts);
}

// Brake disc (spins with the wheel) and calliper (stays put, lives in `main`)
const buildDisc = (seg) => latheX([[0.105, -0.014], [0.2, -0.014], [0.203, -0.01], [0.203, 0.01], [0.2, 0.014], [0.105, 0.014], [0.1, 0.0], [0.105, -0.014]], seg);
function buildCaliper(angle, seg) {
  // an arc-shaped block hugging the top of the disc; angle: where it sits (0 = towards the rear)
  // (r, x) outline of the block; its outer face stays 1 cm inside the spinning spokes
  const prof = [[0.145, -0.026], [0.232, -0.026], [0.24, -0.016], [0.24, 0.026], [0.232, 0.036], [0.152, 0.036], [0.145, 0.026], [0.138, -0.016], [0.145, -0.026]];
  const span = 0.84;
  const phi0 = -angle - span / 2; // after latheX's turn, lathe angle phi points along (y, z) = (-sin phi, cos phi)
  const g = latheX(prof, seg, phi0, span);
  // close both ends of the arc with flat caps, each facing away from the arc
  const caps = [phi0, phi0 + span].map((phi, k) => {
    const at = ([r, x]) => [x, -r * Math.sin(phi), r * Math.cos(phi)];
    const cap = fastNormals(gridGeometry([prof.slice(0, 5).map(at), prof.slice(4, 9).reverse().map(at)]));
    const out = k === 0 ? [Math.cos(phi), Math.sin(phi)] : [-Math.cos(phi), -Math.sin(phi)]; // (y, z)
    const nn = cap.attributes.normal;
    return nn.getY(0) * out[0] + nn.getZ(0) * out[1] < 0 ? fastNormals(flipFaces(cap)) : cap;
  });
  return merge([g, ...caps]);
}

/* --------------------------------------------------------------------------
   9. createCar — assemble everything with the names main.js expects
   -------------------------------------------------------------------------- */
const TIERS = {
  low: { stations: 96, cols: 44, dense: 90, wheel: 36, detail: 0 },
  medium: { stations: 140, cols: 60, dense: 120, wheel: 48, detail: 1 },
  high: { stations: 165, cols: 80, dense: 132, wheel: 64, detail: 2 },
};

export function createCar({ paint, chrome, glass, tier = 'high' }) {
  const q = TIERS[tier] || TIERS.high;

  // Materials made here (main.js owns paint, chrome and glass)
  const matte = new THREE.MeshStandardMaterial({ color: 0x060607, roughness: 0.9, metalness: 0 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x121215, roughness: 0.35, metalness: 0.4 });
  const decal = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }; // drawn a hair in front
  const gloss = new THREE.MeshStandardMaterial({ color: 0x040405, roughness: 0.12, metalness: 0.6, ...decal });
  const mesh = honeycomb();
  const grilleMat = new THREE.MeshStandardMaterial({ color: mesh ? 0xffffff : 0x0a0a0c, map: mesh, roughness: 0.6, metalness: 0.3, ...decal });
  const cabin = new THREE.MeshStandardMaterial({ color: 0x1c1b1b, roughness: 0.72, metalness: 0.05 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x6b3c20, roughness: 0.55, metalness: 0.0 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.85, metalness: 0 });
  const discMat = new THREE.MeshStandardMaterial({ color: 0x7a7c80, roughness: 0.45, metalness: 0.85 });
  const caliperMat = new THREE.MeshStandardMaterial({ color: 0xd8a11c, roughness: 0.35, metalness: 0.25 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdfe9ff, emissiveIntensity: 1.6, roughness: 0.2 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xb0121a, emissive: 0xff1010, emissiveIntensity: 0.45, roughness: 0.2, metalness: 0.1 });

  const model = new THREE.Group();
  model.name = 'model';
  const main = new THREE.Group();
  main.name = 'main';
  model.add(main);
  const add = (name, geometry, material, parent = main) => {
    const m = new THREE.Mesh(geometry, material);
    m.name = name;
    parent.add(m);
    return m;
  };

  // --- the sculpture and the parts that sit on it
  const { body, slices, surf } = buildShell(q);
  const { tub, lip } = buildCockpitTub(slices);
  const front = buildFront(q, surf);
  const rear = buildRear(q, surf);
  const sides = buildSides(q, surf);
  const screen = buildWindscreen(q, surf);
  const interior = buildInterior(q);
  const lipRoll = tube(lip.concat(lip.slice().reverse().map(([x, y, z]) => [-x, y, z])), 0.013, true, q.detail ? 80 : 48, 6);

  add('body', merge([body, sides.paint]), paint);
  add('glass', screen.glass, glass);
  add('trim', merge([screen.trim, rear.trim, sides.trim]), chrome);
  add('lights', front.lights, headMat);
  add('brakes', rear.brakes, tailMat);
  add('wells', merge([buildWells(slices), rear.matte, front.splitter]), matte);
  add('cockpit', merge([tub, interior.cabin, lipRoll]), cabin);
  add('seats', interior.seats, leather);
  add('carbon', merge([rear.carbon, sides.carbon, interior.carbon]), carbon);
  add('housings', merge([front.housing, rear.housing, sides.housing]), gloss);
  add('grilles', merge([front.grille, rear.grille, sides.grille], true), grilleMat);

  // --- wheels (spin) + callipers (stay in `main`, so they don't spin)
  const tyreGeo = buildTyre(q.wheel);
  const rimRight = buildRim(q.wheel, q.detail);
  const rimLeft = mirrorX(rimRight);
  const discGeo = clean(buildDisc(q.wheel));
  const calipers = [];
  for (const [id, x, z] of [['fl', -TRACK_X, AXLES[0]], ['fr', TRACK_X, AXLES[0]], ['rl', -TRACK_X, AXLES[1]], ['rr', TRACK_X, AXLES[1]]]) {
    const side = Math.sign(x);
    const wheel = new THREE.Object3D();
    wheel.name = `wheel_${id}`;
    wheel.position.set(x, WHEEL_Y, z);
    model.add(wheel);
    add('tyre', tyreGeo, rubber, wheel);
    const rim = add(`rim_${id}`, side > 0 ? rimRight : rimLeft, chrome, wheel);
    rim.position.x = side * RIM_OFFSET;
    add('disc', discGeo, discMat, wheel);
    const cal = buildCaliper(id[0] === 'f' ? 0.5 : Math.PI - 0.5, Math.max(8, q.wheel / 6));
    calipers.push((side > 0 ? cal : mirrorX(cal)).translate(x, WHEEL_Y, z));
  }
  add('calipers', merge(calipers), caliperMat);

  model.userData = {
    rimRadius: RIM_R,
    headlights: front.headlights.map((p) => p.map((v) => +v.toFixed(3))),
    taillights: rear.taillights.map((p) => p.map((v) => +v.toFixed(3))),
  };
  return model;
}
