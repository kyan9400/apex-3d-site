/*
  Apex GT — design D: "Endurance hypercar"
  ----------------------------------------
  A road-legal racer in the spirit of endurance-racing prototypes in general (not any specific car):
  a bubble canopy set well forward, a shark-fin spine running back to a wide two-element rear wing on
  swan-neck mounts, front fenders that are separate "pontoons" arching over the front wheels with a low
  nose keel between them, deep side pods with a big intake in front of each rear wheel, slim light bars.

  How it is made (everything is code, no model files):
  1. TUB — the central body is a LOFT: at every station z along the car we compute six key points of a
     half cross-section (sill → side → pod shoulder → valley → tub edge → centre line) from simple z → value
     curves and join them with a smooth Catmull-Rom curve. Mirroring gives the full section; stacking the
     sections gives a smooth grid of vertices (one surface = smooth clearcoat reflections).
  2. PONTOONS — each front fender is its own loft with an upside-down "U" section (a superellipse top on two
     walls). The lower edge of the outer wall follows the wheel-arch circle, and behind the wheel it stays
     high, so the fender floats over an open exit. A dark liner inside hides the hollow shell.
  3. CANOPY — a separate lofted bubble; windows are regions of its grid that get the glass material.
  4. FIN and WING — the fin is a thin loft; the wings are airfoil profiles extruded (swept) across the car;
     endplates and swan necks are flat 2D shapes extruded to a thickness.
  5. DETAILS — lights, louvres and grilles are small patches that follow the surfaces, plus simple parts.
*/
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------------------------
// Fixed layout (CONTRACT.md): the car faces −z, ground at y = 0
const WHEEL_X = 0.83, WHEEL_Y = 0.36, WHEEL_ZF = -1.16, WHEEL_ZR = 1.5;
const TYRE_R = 0.36, TYRE_W = 0.27, RIM_R = 0.28;
const ARCH_R = 0.42; // wheel-arch opening radius (6 cm clearance round the tyre)
const Z_NOSE = -2.27, Z_TAIL = 2.24;
const SILL = 0.17; // lower edge of the bodywork

// ---------------------------------------------------------------------------------------------
// Small maths helpers
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const smax = (a, b, k) => 0.5 * (a + b + Math.sqrt((a - b) ** 2 + k * k)); // smooth maximum

// A smooth curve through [z, value] keys (monotone cubic: never overshoots between keys)
function curve(keys) {
  const n = keys.length, xs = keys.map((k) => k[0]), ys = keys.map((k) => k[1]);
  const d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
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

// Station list along an axis: [from, to, spacing] segments (+ extra exact values), sorted, no duplicates
function stations(segs, extra, k) {
  const out = [...extra];
  for (const [a, b, step] of segs) {
    const n = Math.max(1, Math.round((b - a) / (step * k)));
    for (let i = 0; i <= n; i++) out.push(a + ((b - a) * i) / n);
  }
  out.sort((p, q) => p - q);
  return out.filter((v, i) => i === 0 || v - out[i - 1] > 1e-4);
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers

// A surface from a grid of points (rows × cols). point(i, j, v) writes vertex (i, j) into v.
// group(i, j) names the material group of quad (i, j) (null = leave a hole). Normals are computed on the
// whole grid first (so the shading flows across group borders), then each group becomes its own geometry.
// offset pushes every vertex along its normal (used for decals that sit just above a surface).
function buildGrid(rows, cols, point, { group = null, flip = false, offset = 0 } = {}) {
  const nv = rows * cols, pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), v = new THREE.Vector3();
  for (let i = 0, k = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++, k += 3) {
      point(i, j, v);
      pos[k] = v.x; pos[k + 1] = v.y; pos[k + 2] = v.z;
    }
  }
  // two triangles per quad; flip reverses the winding (= which side faces out)
  const nq = (rows - 1) * (cols - 1), tris = new Uint32Array(nq * 6);
  for (let i = 0, q = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols - 1; j++, q += 6) {
      const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
      if (flip) { tris[q] = a; tris[q + 1] = b; tris[q + 2] = c; tris[q + 3] = b; tris[q + 4] = d; tris[q + 5] = c; }
      else { tris[q] = a; tris[q + 1] = c; tris[q + 2] = b; tris[q + 3] = b; tris[q + 4] = c; tris[q + 5] = d; }
    }
  }
  // smooth normals: add up the (area-weighted) face normals at each vertex, then normalise
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const wx = pos[c] - pos[a], wy = pos[c + 1] - pos[a + 1], wz = pos[c + 2] - pos[a + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    nor[a] += nx; nor[a + 1] += ny; nor[a + 2] += nz;
    nor[b] += nx; nor[b + 1] += ny; nor[b + 2] += nz;
    nor[c] += nx; nor[c + 1] += ny; nor[c + 2] += nz;
  }
  for (let k = 0; k < nor.length; k += 3) {
    const l = Math.hypot(nor[k], nor[k + 1], nor[k + 2]);
    if (l > 0) { nor[k] /= l; nor[k + 1] /= l; nor[k + 2] /= l; }
  }
  // a vertex on a collapsed row (the tip of a cap) may only touch flat triangles: borrow the next row's normal
  for (let k = 0; k < nor.length; k += 3) {
    if (nor[k] || nor[k + 1] || nor[k + 2]) continue;
    const r = Math.floor(k / 3 / cols), o = (r < rows - 1 ? cols : -cols) * 3;
    nor[k] = nor[k + o]; nor[k + 1] = nor[k + o + 1]; nor[k + 2] = nor[k + o + 2];
  }
  if (offset) for (let k = 0; k < pos.length; k++) pos[k] += nor[k] * offset;
  // one material: the whole grid is the geometry
  if (!group) return { main: makeGeometry(pos, nor, nv > 65535 ? tris : new Uint16Array(tris)) };
  // several materials: sort the quads into their groups
  const names = [], gid = new Int8Array(nq);
  for (let i = 0, q = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols - 1; j++, q++) {
      const g = group(i, j);
      if (g == null) { gid[q] = -1; continue; }
      let n = names.indexOf(g);
      if (n < 0) n = names.push(g) - 1;
      gid[q] = n;
    }
  }
  const out = {};
  names.forEach((name, n) => { out[name] = compact(pos, nor, tris, gid, n); });
  return out;
}

function makeGeometry(P, N, I) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setIndex(new THREE.BufferAttribute(I, 1));
  return g;
}

// One geometry from the quads of group n, keeping only the vertices they use
function compact(pos, nor, tris, gid, n) {
  const remap = new Int32Array(pos.length / 3).fill(-1);
  let nTri = 0, nv = 0;
  for (let q = 0; q < gid.length; q++) {
    if (gid[q] !== n) continue;
    nTri += 2;
    for (let e = 0; e < 6; e++) { const k = tris[q * 6 + e]; if (remap[k] < 0) remap[k] = nv++; }
  }
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3);
  const I = nv > 65535 ? new Uint32Array(nTri * 3) : new Uint16Array(nTri * 3);
  for (let k = 0; k < remap.length; k++) {
    const m = remap[k];
    if (m < 0) continue;
    P[m * 3] = pos[k * 3]; P[m * 3 + 1] = pos[k * 3 + 1]; P[m * 3 + 2] = pos[k * 3 + 2];
    N[m * 3] = nor[k * 3]; N[m * 3 + 1] = nor[k * 3 + 1]; N[m * 3 + 2] = nor[k * 3 + 2];
  }
  for (let q = 0, w = 0; q < gid.length; q++) {
    if (gid[q] !== n) continue;
    for (let e = 0; e < 6; e++) I[w++] = remap[tris[q * 6 + e]];
  }
  return makeGeometry(P, N, I);
}

// Make any geometry mergeable: indexed, only position + normal
function prep(g) {
  if (!g.index) g.setIndex([...Array(g.getAttribute('position').count).keys()]);
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  return g;
}

// Mirror a geometry to the other side of the car (x → −x) and fix the triangle winding
function mirrorX(g) {
  const m = prep(g.clone());
  m.scale(-1, 1, 1);
  const idx = m.index.array;
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  m.index.needsUpdate = true;
  return m;
}
const both = (g) => [prep(g), mirrorX(g)];

// A lathe (surface of revolution) around the x axis; profile = [[radius, x], ...]
// (order the profile so the surface runs "up" the outside: then the normals face outwards)
function latheX(profile, segs) {
  const g = new THREE.LatheGeometry(profile.map(([r, x]) => new THREE.Vector2(r, x)), segs);
  g.rotateZ(-Math.PI / 2); // lathe axis (y) → x
  return prep(g);
}

// A flat 2D shape drawn in the side view (shape x = world z, shape y = world y), given a thickness along x
function sideShape(points, thick, x0, bevel = 0) {
  const s = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(s, {
    depth: thick, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 4,
  });
  g.rotateY(-Math.PI / 2); // extrusion axis → −x
  g.translate(x0 + thick / 2, 0, 0); // centred on x0
  return prep(g);
}

// A strip of quads between point rows; orient = expected outward direction to fix the winding
function strip(rowsPts, orient) {
  const rows = rowsPts.length, cols = rowsPts[0].length;
  // normal of the first quad with the default winding (a, c, b): (c − a) × (b − a)
  const a = rowsPts[0][0], b = rowsPts[0][1], c = rowsPts[1][0];
  const n = new THREE.Vector3().subVectors(c, a).cross(new THREE.Vector3().subVectors(b, a));
  return buildGrid(rows, cols, (i, j, v) => v.copy(rowsPts[i][j]), { flip: n.dot(orient) < 0 }).main;
}

// ---------------------------------------------------------------------------------------------
// 1. TUB — key points of the half cross-section as functions of z.
//    P0 sill, P1 lower side, P2 pod shoulder, P3 valley, P4 tub edge, P5 centre line.
//    In the nose these points describe a narrow keel; behind the front wheels the side pods grow out.
const TUB = {
  x0: curve([[-2.27, 0.24], [-1.6, 0.27], [-1.16, 0.3], [-0.75, 0.38], [-0.6, 0.46], [-0.46, 0.82], [-0.25, 0.93], [0.4, 0.95], [1.0, 0.97], [1.5, 0.99], [2.0, 0.95], [2.24, 0.92]]),
  y0: curve([[-2.27, 0.19], [-1.8, 0.175], [-1.2, 0.165], [-0.6, SILL], [1.7, SILL], [2.0, 0.24], [2.24, 0.27]]),
  x1: curve([[-2.27, 0.29], [-1.6, 0.32], [-1.16, 0.35], [-0.75, 0.45], [-0.6, 0.55], [-0.46, 0.9], [-0.25, 0.985], [0.4, 1.0], [1.0, 1.01], [1.5, 1.02], [2.0, 0.985], [2.24, 0.945]]),
  y1: curve([[-2.27, 0.2], [-1.6, 0.235], [-1.16, 0.26], [-0.75, 0.29], [-0.45, 0.32], [0.4, 0.35], [1.0, 0.4], [1.5, 0.48], [2.0, 0.46], [2.24, 0.45]]),
  x2: curve([[-2.27, 0.29], [-1.6, 0.32], [-1.16, 0.35], [-0.75, 0.47], [-0.6, 0.57], [-0.46, 0.88], [-0.25, 0.965], [0.4, 0.98], [1.0, 1.0], [1.5, 1.0], [2.0, 0.965], [2.24, 0.925]]),
  y2: curve([[-2.27, 0.25], [-1.6, 0.34], [-1.16, 0.41], [-0.75, 0.5], [-0.45, 0.56], [-0.2, 0.61], [0.4, 0.64], [1.0, 0.76], [1.5, 0.865], [2.0, 0.845], [2.24, 0.82]]),
  x3: curve([[-2.27, 0.25], [-1.6, 0.285], [-1.16, 0.315], [-0.75, 0.43], [-0.55, 0.55], [-0.3, 0.72], [0.4, 0.76], [1.0, 0.75], [1.5, 0.72], [2.0, 0.7], [2.24, 0.68]]),
  y3: curve([[-2.27, 0.3], [-1.6, 0.41], [-1.16, 0.49], [-0.75, 0.575], [-0.45, 0.6], [0.4, 0.605], [1.0, 0.72], [1.5, 0.8], [2.0, 0.815], [2.24, 0.8]]),
  x4: curve([[-2.27, 0.15], [-1.6, 0.18], [-1.16, 0.2], [-0.75, 0.32], [-0.4, 0.5], [0.0, 0.555], [0.5, 0.555], [1.0, 0.48], [1.5, 0.42], [2.0, 0.4], [2.24, 0.38]]),
  y4: curve([[-2.27, 0.335], [-1.6, 0.448], [-1.16, 0.532], [-0.75, 0.615], [-0.4, 0.66], [0.0, 0.69], [0.5, 0.71], [1.0, 0.83], [1.5, 0.88], [2.0, 0.87], [2.24, 0.85]]),
  y5: curve([[-2.27, 0.34], [-1.6, 0.462], [-1.16, 0.557], [-0.75, 0.625], [-0.4, 0.665], [0.0, 0.695], [0.5, 0.715], [1.0, 0.86], [1.5, 0.9], [2.0, 0.89], [2.24, 0.86]]),
};
const NOSE_CAP = 0.42; // length of the wedge-shaped nose tip

// Depth of the side-intake cove in front of each rear wheel (the surface dives in, then the open mouth)
const COVE_Z0 = 0.15, COVE_Z1 = 0.93, COVE_END = 1.0;
const coveDepth = (z) => 0.15 * smooth(COVE_Z0, COVE_Z1 - 0.03, z) * (1 - smooth(COVE_Z1, COVE_END, z));

// The six key points at station z, ordered from the centre line down to the sill
function tubKeys(z) {
  const k = [
    { x: 0, y: TUB.y5(z) }, { x: TUB.x4(z), y: TUB.y4(z) }, { x: TUB.x3(z), y: TUB.y3(z) },
    { x: TUB.x2(z), y: TUB.y2(z) }, { x: TUB.x1(z), y: TUB.y1(z) }, { x: TUB.x0(z), y: TUB.y0(z) },
  ];
  // side intake: the lower side is pulled in under the pod shoulder
  const d = coveDepth(z);
  k[4].x -= d; k[5].x -= 0.8 * d; k[3].x -= 0.12 * d;
  // rear wheel arch: the lower edge follows a circle round the wheel, with a small lip flare
  const dz = z - WHEEL_ZR;
  if (Math.abs(dz) < ARCH_R) {
    const ya = WHEEL_Y + Math.sqrt(ARCH_R * ARCH_R - dz * dz);
    if (ya > k[5].y) { k[5].y = ya; k[5].x += 0.012; }
    k[4].y = Math.max(k[4].y, k[5].y + 0.3 * (k[3].y - k[5].y));
  }
  // nose tip: a wedge — round in plan, while the top slopes down to a thin leading edge
  if (z < Z_NOSE + NOSE_CAP) {
    const t = clamp((Z_NOSE + NOSE_CAP - z) / NOSE_CAP, 0, 1), f = Math.pow(1 - Math.pow(t, 2.6), 1 / 2.6);
    const y0 = k[5].y, g = 1 - 0.84 * Math.pow(t, 1.25);
    for (const p of k) { p.x *= Math.pow(f, 0.55); p.y = y0 + (p.y - y0) * g; }
  }
  // tail: a slight roll-under of the cut-off rear edge
  if (z > Z_TAIL - 0.05) {
    const t = (z - (Z_TAIL - 0.05)) / 0.05, s = 1 - 0.045 * t * t;
    for (const p of k) { p.x *= s; p.y = 0.55 + (p.y - 0.55) * s; }
  }
  return k;
}

// Centripetal Catmull-Rom through the key points (G = keys with a ghost point at each end), u ∈ [0, 5]
function crEval(G, u, out) {
  const k = Math.min(4, Math.max(0, Math.floor(u))), t = u - k;
  const p0 = G[k], p1 = G[k + 1], p2 = G[k + 2], p3 = G[k + 3];
  const t1 = Math.max(1e-4, Math.sqrt(Math.hypot(p1.x - p0.x, p1.y - p0.y)));
  const t2 = t1 + Math.max(1e-4, Math.sqrt(Math.hypot(p2.x - p1.x, p2.y - p1.y)));
  const t3 = t2 + Math.max(1e-4, Math.sqrt(Math.hypot(p3.x - p2.x, p3.y - p2.y)));
  const T = t1 + (t2 - t1) * t;
  // Barry-Goldman pyramid: three blends, then two, then one
  const w1 = T / t1, w2 = (T - t1) / (t2 - t1), w3 = (T - t2) / (t3 - t2), w4 = T / t2, w5 = (T - t1) / (t3 - t1);
  const a1x = p0.x + (p1.x - p0.x) * w1, a1y = p0.y + (p1.y - p0.y) * w1;
  const a2x = p1.x + (p2.x - p1.x) * w2, a2y = p1.y + (p2.y - p1.y) * w2;
  const a3x = p2.x + (p3.x - p2.x) * w3, a3y = p2.y + (p3.y - p2.y) * w3;
  const b1x = a1x + (a2x - a1x) * w4, b1y = a1y + (a2y - a1y) * w4;
  const b2x = a2x + (a3x - a2x) * w5, b2y = a2y + (a3y - a2y) * w5;
  out.x = b1x + (b2x - b1x) * w2; out.y = b1y + (b2y - b1y) * w2;
  return out;
}
const withGhosts = (k) => [{ x: -k[1].x, y: k[1].y }, ...k, { x: 2 * k[5].x - k[4].x, y: 2 * k[5].y - k[4].y }];

// Point on the tub surface: s ∈ [−5, 5] runs from the left sill over the centre line to the right sill
const _p = { x: 0, y: 0 };
function tubPoint(z, s, out, G = withGhosts(tubKeys(z))) {
  crEval(G, Math.abs(s), _p);
  return out.set(Math.sign(s) * _p.x, _p.y, z);
}

// ---------------------------------------------------------------------------------------------
// 2. PONTOON front fenders (right one; the left is the same with x mirrored)
const PON = {
  yt: curve([[-2.25, 0.34], [-2.08, 0.48], [-1.85, 0.63], [-1.55, 0.78], [-1.2, 0.858], [-0.9, 0.845], [-0.6, 0.79], [-0.35, 0.72], [-0.1, 0.645], [0.15, 0.57]]),
  a: curve([[-2.25, 0.15], [-1.9, 0.175], [-1.4, 0.197], [-0.9, 0.195], [-0.5, 0.17], [-0.1, 0.13], [0.15, 0.1]]),
  xc: curve([[-2.25, 0.79], [-1.6, 0.825], [-1.16, 0.83], [-0.6, 0.84], [0.15, 0.85]]),
};
const PON_Z0 = -2.25, PON_Z1 = 0.15, PON_N = 3.2;

// Lower edge of the outer wall: closed in front of the wheel, the arch circle, then a high "cutaway"
function ponBottomOuter(z) {
  const dz = z - WHEEL_ZF;
  const circ = dz * dz < ARCH_R * ARCH_R ? WHEEL_Y + Math.sqrt(ARCH_R * ARCH_R - dz * dz) : -1;
  if (dz < 0) return circ > 0 ? circ : 0.19;
  return smax(circ, 0.5 + 0.07 * smooth(-0.8, -0.3, z), 0.05);
}

function ponParams(z, inset) {
  const p = { xc: PON.xc(z), a: PON.a(z) - inset, yt: PON.yt(z) - inset, ybo: ponBottomOuter(z) };
  // end caps: a rounded bullnose at the front, a taper into the side pod at the back
  let f = 1, fx = 1;
  if (z < -2.06) { const t = clamp((-2.06 - z) / 0.19, 0, 1); f = Math.pow(1 - Math.pow(t, 2.2), 1 / 2.2); fx = Math.pow(f, 0.75); }
  if (z > -0.1) { const t = clamp((z + 0.1) / 0.25, 0, 1); f = fx = Math.sqrt(1 - t * t); }
  p.fx = fx; p.fy = f; p.cy = SILL + 0.5 * (p.yt - SILL);
  return p;
}

// The upside-down U: one superellipse from the outer foot (τ = −1) over the top (τ = 0) to the inner
// foot (τ = +1). Near the floor the sides are almost vertical; higher up they tuck in slightly.
function ponLocal(p, tau) {
  const th = (Math.PI / 2) * (1 + tau), c = Math.cos(th), s = Math.sin(th);
  return [p.xc + p.a * Math.sign(c) * Math.pow(Math.abs(c), 2 / PON_N), SILL + (p.yt - SILL) * Math.pow(Math.abs(s), 2 / PON_N)];
}
// τ where the outer side reaches height yb (so the side can stop at the arch / cutaway line)
function tauOuter(p, yb) {
  const q = clamp((yb - SILL) / (p.yt - SILL), 0, 1);
  return (2 * Math.asin(Math.pow(q, PON_N / 2))) / Math.PI - 1;
}
function ponPoint(z, tau, side, out, p = ponParams(z, 0)) {
  const [x, y] = ponLocal(p, tau);
  return out.set(side * (p.xc + (x - p.xc) * p.fx), p.cy + (y - p.cy) * p.fy, z);
}
// Is (x, y) inside the right pontoon's section at z? (used to find its front face for the lights)
function ponInside(z, x, y) {
  const p = ponParams(z, 0);
  if (p.fx < 1e-4 || p.fy < 1e-4) return false;
  const xu = p.xc + (x - p.xc) / p.fx, yu = p.cy + (y - p.cy) / p.fy, dx = Math.abs(xu - p.xc) / p.a;
  if (dx > 1 || yu < SILL) return false;
  return (yu - SILL) / (p.yt - SILL) <= Math.pow(1 - Math.pow(dx, PON_N), 1 / PON_N);
}
function ponFrontZ(x, y) {
  let lo = PON_Z0, hi = -1.85;
  if (!ponInside(hi, x, y)) return -1.85;
  for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (ponInside(m, x, y)) hi = m; else lo = m; }
  return hi;
}

// ---------------------------------------------------------------------------------------------
// 3. CANOPY bubble: superellipse sections (half width w, top yt, base yb); |t| > 1 runs below the base
const CAN = {
  yt: curve([[-0.98, 0.6], [-0.86, 0.74], [-0.6, 0.92], [-0.3, 1.05], [-0.05, 1.1], [0.2, 1.108], [0.45, 1.09], [0.7, 1.045], [0.95, 0.985], [1.15, 0.93], [1.3, 0.86]]),
  w: curve([[-0.98, 0.3], [-0.86, 0.42], [-0.6, 0.515], [-0.3, 0.55], [0.0, 0.56], [0.3, 0.55], [0.6, 0.49], [0.9, 0.36], [1.15, 0.24], [1.3, 0.17]]),
  yb: curve([[-0.98, 0.55], [-0.5, 0.6], [0.0, 0.63], [0.5, 0.66], [0.9, 0.75], [1.3, 0.8]]),
};
const CAN_N = 2.6, CAN_Z0 = -0.98, CAN_Z1 = 1.3;
function canopyDims(z) {
  let w = CAN.w(z), yt = CAN.yt(z);
  const yb = CAN.yb(z);
  if (z < -0.88) { const t = clamp((-0.88 - z) / 0.1, 0, 1), f = Math.sqrt(1 - t * t); w *= f; yt = yb + (yt - yb) * f; }
  return { w, yt, yb };
}
function canopyPoint(z, t, out) {
  const { w, yt, yb } = canopyDims(z), a = Math.abs(t);
  let x, y;
  if (a <= 1) {
    const th = (Math.PI / 2) * (1 - a);
    x = w * Math.pow(Math.cos(th), 2 / CAN_N);
    y = yb + (yt - yb) * Math.pow(Math.sin(th), 2 / CAN_N);
  } else { x = w; y = yb - (a - 1) * 0.4; }
  return out.set(Math.sign(t) * x, y, z);
}
// Half width of the canopy at height y (for the interior floor)
function canopyHalfWidthAt(z, y) {
  const { w, yt, yb } = canopyDims(z);
  const q = clamp((y - yb) / (yt - yb), 0, 1), s = Math.pow(q, CAN_N / 2);
  return w * Math.pow(Math.sqrt(1 - s * s), 2 / CAN_N);
}
// Window layout on the canopy grid (z, |t|): windscreen and side windows, each with a black seal
const WS = [-0.86, -0.17], SW = [-0.06, 0.5], T_TOP = 0.36, T_LOW = 0.78, SEAL_Z = 0.025, SEAL_T = 0.03;
function canopyGroup(z, t) {
  const a = Math.abs(t);
  if (z > WS[0] && z < WS[1] && a < T_LOW) return 'glass';
  if (z > SW[0] && z < SW[1] && a > T_TOP && a < T_LOW) return 'glass';
  if (z > WS[0] - SEAL_Z && z < WS[1] + SEAL_Z && a < T_LOW + SEAL_T) return 'void';
  if (z > SW[0] - SEAL_Z && z < SW[1] + SEAL_Z && a > T_TOP - SEAL_T && a < T_LOW + SEAL_T) return 'void';
  return 'paint';
}

// ---------------------------------------------------------------------------------------------
// 4. FIN: a thin loft rising out of the canopy roof and running back to the wing
const FIN = {
  top: curve([[0.15, 1.07], [0.35, 1.112], [0.7, 1.108], [1.2, 1.092], [1.6, 1.078], [1.985, 1.066]]),
  tw: curve([[0.15, 0.02], [0.6, 0.016], [1.85, 0.013], [1.985, 0.0008]]),
};
function finPoint(z, t, out) {
  const top = FIN.top(z), tw = FIN.tw(z);
  const bottom = Math.max(CAN.yt(z), TUB.y5(z)) - 0.05;
  const hh = Math.min(tw * 1.6, (top - bottom) * 0.5), a = Math.abs(t);
  let x, y;
  if (a <= 1) {
    const th = (Math.PI / 2) * (1 - a);
    x = tw * Math.sqrt(Math.cos(th));
    y = top - hh + hh * Math.sqrt(Math.sin(th));
  } else { x = tw; y = lerp(top - hh, bottom, Math.min(1, (a - 1) / 0.4)); }
  return out.set(Math.sign(t) * x, y, z);
}

// ---------------------------------------------------------------------------------------------
// 5. WING: an inverted cambered airfoil (NACA-style maths), points from the trailing edge along the top to
//    the leading edge and back along the bottom, in chord units
function airfoil(nHalf, thick, camber, pos) {
  const up = [], lo = [];
  for (let i = 0; i <= nHalf; i++) {
    const c = 0.5 * (1 - Math.cos((Math.PI * i) / nHalf)); // cosine spacing: more points at the nose
    const yt = 5 * thick * (0.2969 * Math.sqrt(c) - 0.126 * c - 0.3516 * c * c + 0.2843 * c ** 3 - 0.1036 * c ** 4);
    const yc = c < pos ? (camber / (pos * pos)) * (2 * pos * c - c * c) : (camber / (1 - pos) ** 2) * (1 - 2 * pos + 2 * pos * c - c * c);
    up.push([c, -yc + yt]); // inverted (downforce): camber points down
    lo.push([c, -yc - yt]);
  }
  return [...up.reverse(), ...lo.slice(1)];
}
// Sweep a profile across the car (x from x0 to x1); profile in chord units, placed at a leading edge,
// chord length and angle of attack (positive = trailing edge up)
function wingGeometry(prof, x0, x1, le, chord, aoa) {
  const ca = Math.cos(aoa), sa = Math.sin(aoa);
  return buildGrid(2, prof.length, (i, j, v) => {
    const [c, y] = prof[j];
    v.set(i ? x1 : x0, le[1] + chord * (c * sa + y * ca), le[0] + chord * (c * ca - y * sa));
  }).main;
}

// ---------------------------------------------------------------------------------------------
// Wheels: tyre, chrome rim (spoked face on the outer side), dark hub (barrel, disc, bell)

// One spoke from the hub out to the rim lip; angles in the wheel plane (y = r·sin a, z = r·cos a)
function spoke(aHub, aRim, n) {
  const F = [], B = [], S1 = [], S2 = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, r = lerp(0.068, 0.262, t), ang = lerp(aHub, aRim, t), w = lerp(0.034, 0.021, t) / 2;
    const xf = -0.034 + 0.03 * Math.sin((t * Math.PI) / 2); // dished face: the hub sits deeper
    const xb = xf - lerp(0.032, 0.02, t);
    const cy = r * Math.sin(ang), cz = r * Math.cos(ang), ty = Math.cos(ang), tz = -Math.sin(ang);
    const p = (x, sgn) => new THREE.Vector3(x, cy + ty * w * sgn, cz + tz * w * sgn);
    F.push([p(xf, -1), p(xf, 1)]); B.push([p(xb, -1), p(xb, 1)]);
    S1.push([p(xf, -1), p(xb, -1)]); S2.push([p(xf, 1), p(xb, 1)]);
  }
  const am = lerp(aHub, aRim, 0.5), side = new THREE.Vector3(0, Math.cos(am), -Math.sin(am)); // tangential
  return [
    strip(F, new THREE.Vector3(1, 0, 0)), strip(B, new THREE.Vector3(-1, 0, 0)),
    strip(S1, side.clone().negate()), strip(S2, side),
  ];
}

// Rim for a right wheel, in its own frame: x = outwards, face plane at x = 0
function rimGeometry(q) {
  const segs = Math.round(64 * q), parts = [];
  // lip: rounded outer edge of the rim
  parts.push(latheX([[0.287, -0.035], [0.291, -0.012], [0.288, -0.001], [0.279, 0.004], [0.262, 0.003], [0.255, -0.006], [0.254, -0.03]], segs));
  // five twin spokes (10 spokes)
  for (let k = 0; k < 5; k++) {
    const a = (k * 2 * Math.PI) / 5;
    parts.push(...spoke(a - 0.05, a - 0.13, 5), ...spoke(a + 0.05, a + 0.13, 5));
  }
  // hub dome and a centre-lock nut (a racing touch)
  parts.push(latheX([[0.082, -0.05], [0.08, -0.03], [0.066, -0.016], [0.04, -0.008], [0.0, -0.006]], Math.round(32 * q)));
  const nut = new THREE.CylinderGeometry(0.03, 0.033, 0.03, 6);
  nut.rotateZ(-Math.PI / 2);
  nut.translate(0.004, 0, 0);
  parts.push(prep(nut));
  return mergeGeometries(parts.map(prep));
}

// Dark metal parts that spin with the wheel (right wheel, wheel frame: x = outwards from the wheel centre):
// rim barrel (seen through the spokes), brake disc and its bell
function hubGeometry(q) {
  const segs = Math.round(48 * q), parts = [];
  // barrel: inside face of the rim, normals point at the axle
  parts.push(latheX([[0.272, 0.095], [0.272, -0.12]], segs));
  // disc (a closed ring section) and its bell
  parts.push(latheX([[0.1, -0.024], [0.205, -0.024], [0.205, 0.004], [0.1, 0.004], [0.1, -0.024]], segs));
  parts.push(latheX([[0.1, 0.004], [0.1, 0.036], [0.0, 0.036]], Math.round(24 * q)));
  return mergeGeometries(parts.map(prep));
}

// A curved block round the axle (x0..x1 thick, radii r0..r1, angles a0..a1): brake calliper
function arcBlock(r0, r1, a0, a1, x0, x1, n) {
  const P = (r, a, x) => new THREE.Vector3(x, r * Math.sin(a), r * Math.cos(a));
  const rows = (f) => Array.from({ length: n + 1 }, (_, i) => f(lerp(a0, a1, i / n)));
  const am = (a0 + a1) / 2, radial = new THREE.Vector3(0, Math.sin(am), Math.cos(am));
  const g = [
    strip(rows((a) => [P(r1, a, x0), P(r1, a, x1)]), radial),
    strip(rows((a) => [P(r0, a, x0), P(r0, a, x1)]), radial.clone().negate()),
    strip(rows((a) => [P(r0, a, x1), P(r1, a, x1)]), new THREE.Vector3(1, 0, 0)),
    strip(rows((a) => [P(r0, a, x0), P(r1, a, x0)]), new THREE.Vector3(-1, 0, 0)),
  ];
  for (const a of [a0, a1]) {
    const tdir = new THREE.Vector3(0, Math.cos(a), -Math.sin(a)).multiplyScalar(a === a0 ? -1 : 1);
    g.push(strip([[P(r0, a, x0), P(r0, a, x1)], [P(r1, a, x0), P(r1, a, x1)]], tdir));
  }
  return mergeGeometries(g.map(prep));
}

// ---------------------------------------------------------------------------------------------
export function createCar({ paint, chrome, glass, tier = 'high' }) {
  const q = { low: 0.55, medium: 0.8, high: 1 }[tier] ?? 0.8; // detail level
  const k = 1 / q; // station spacing factor
  const V = () => new THREE.Vector3();

  // Materials made here (paint, chrome and glass come from main.js)
  const carbon = new THREE.MeshPhysicalMaterial({ color: 0x141518, roughness: 0.42, metalness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.18 });
  const voidMat = new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide }); // openings: pure black
  const interiorMat = new THREE.MeshStandardMaterial({ color: 0x24242a, roughness: 0.75 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x17171a, roughness: 0.88 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x55575d, metalness: 0.85, roughness: 0.42 });
  const caliperMat = new THREE.MeshStandardMaterial({ color: 0xd6a51e, metalness: 0.3, roughness: 0.38 });
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdde8ff, emissiveIntensity: 2.2, roughness: 0.25 });
  const brakeMat = new THREE.MeshStandardMaterial({ color: 0xa00010, emissive: 0x2a0000, roughness: 0.3, metalness: 0.1 });

  // Parts are collected per material and merged at the end (few draw calls)
  const P = { paint: [], glass: [], trim: [], lights: [], brakes: [], carbon: [], void: [], hole: [], interior: [], caliper: [] };
  const add = (key, ...gs) => { for (const g of gs) if (g) P[key].push(prep(g)); };
  const addGroups = (groups) => { for (const key in groups) add(key, groups[key]); };

  // ---- 1. Tub -------------------------------------------------------------------------------
  {
    const Z = stations(
      [[Z_NOSE, -1.85, 0.018], [-1.85, -0.62, 0.045], [-0.62, -0.42, 0.016], [-0.42, 0.88, 0.04], [0.88, 1.06, 0.012], [1.06, 1.94, 0.028], [1.94, Z_TAIL, 0.02]],
      [-0.6, -0.45, COVE_Z1, COVE_END, WHEEL_ZR - ARCH_R - 0.004, WHEEL_ZR - ARCH_R + 0.0005, WHEEL_ZR + ARCH_R - 0.0005, WHEEL_ZR + ARCH_R + 0.004],
      k,
    );
    // section samples: per key-point segment (centre→tub edge, →valley, →shoulder, →lower side, →sill)
    const half = [0];
    [7, 4, 5, 6, 5].forEach((cnt, seg) => {
      const c = Math.max(2, Math.round(cnt * q));
      for (let i = 1; i <= c; i++) half.push(seg + i / c);
    });
    const S = [...half.slice(1).reverse().map((u) => -u), ...half];
    const G = Z.map((z) => withGhosts(tubKeys(z)));
    addGroups(buildGrid(Z.length, S.length, (i, j, v) => tubPoint(Z[i], S[j], v, G[i]), {
      group: (i, j) => {
        const z = (Z[i] + Z[i + 1]) / 2, u = (Math.abs(S[j]) + Math.abs(S[j + 1])) / 2;
        if (z > -0.6 && z < -0.45 && u > 3.05) return 'hole'; // forward-facing pod intake
        if (z > COVE_Z1 && z < COVE_END && u > 3.2) return 'hole'; // side intake mouth
        return 'paint';
      },
    }));

    // Rear face: the open end of the tub, filled with a dark panel (the racing "exit")
    const outline = S.map((s) => tubPoint(Z_TAIL, s, V()));
    const face = new THREE.ShapeGeometry(new THREE.Shape(outline.map((p) => new THREE.Vector2(p.x, p.y))));
    face.translate(0, 0, Z_TAIL - 0.001);
    add('void', face);
    // two big exit vents in the rear panel, either side of the exhausts
    for (const sgn of [1, -1]) {
      const vent = new THREE.Shape(), x0 = 0.2, x1 = 0.72, y0 = 0.36, y1 = 0.6, r = 0.05;
      vent.moveTo(x0 + r, y0); vent.lineTo(x1 - r, y0); vent.quadraticCurveTo(x1, y0, x1, y0 + r);
      vent.lineTo(x1, y1 - r); vent.quadraticCurveTo(x1, y1, x1 - r, y1); vent.lineTo(x0 + r, y1);
      vent.quadraticCurveTo(x0, y1, x0, y1 - r); vent.lineTo(x0, y0 + r); vent.quadraticCurveTo(x0, y0, x0 + r, y0);
      const g = new THREE.ShapeGeometry(vent, 3);
      if (sgn < 0) g.scale(-1, 1, 1);
      g.translate(0, 0, Z_TAIL + 0.002);
      add('hole', g);
    }

    // Full-width tail-light bar following the top of the rear outline
    const n = Math.round(70 * q), A = [], B = [], ds = 0.004;
    for (let i = 0; i <= n; i++) {
      const s = lerp(-3.25, 3.25, i / n);
      const p = tubPoint(Z_TAIL, s, V()), p2 = tubPoint(Z_TAIL, s + ds, V());
      const tx = p2.x - p.x, ty = p2.y - p.y, l = Math.hypot(tx, ty) || 1;
      const nx = ty / l, ny = -tx / l; // inward normal of the outline
      A.push(new THREE.Vector3(p.x + nx * 0.022, p.y + ny * 0.022, Z_TAIL + 0.004));
      B.push(new THREE.Vector3(p.x + nx * 0.046, p.y + ny * 0.046, Z_TAIL + 0.004));
    }
    add('brakes', strip([A, B], new THREE.Vector3(0, 0, 1)));
    // racing-style rain light in the middle of the tail
    const rain = new THREE.PlaneGeometry(0.07, 0.07);
    rain.translate(0, 0.66, Z_TAIL + 0.004);
    add('brakes', rain);

    // Louvres on top of the rear haunches (dark slots that follow the surface)
    for (const sgn of [1, -1]) {
      for (let l = 0; l < 6; l++) {
        const z0 = 1.5 + l * 0.055, z1 = z0 + 0.026;
        const s0 = sgn * 2.15, s1 = sgn * 2.85, nS = 6;
        add('hole', buildGrid(2, nS + 1, (i, j, v) => tubPoint(i ? z1 : z0, lerp(Math.min(s0, s1), Math.max(s0, s1), j / nS), v), { offset: 0.003 }).main);
      }
    }

    // Side intakes: the deep end of each cove is a big dark mouth with a swept front edge
    for (const sgn of [1, -1]) {
      const nU = Math.round(10 * q), nV = Math.round(10 * q), u0 = 3.3, u1 = 4.9;
      add('hole', buildGrid(nV + 1, nU + 1, (i, j, v) => {
        const u = sgn > 0 ? lerp(u0, u1, j / nU) : lerp(u1, u0, j / nU);
        const zStart = 0.66 + 0.16 * ((u - u0) / (u1 - u0)) ** 2;
        return tubPoint(lerp(zStart, COVE_Z1 + 0.01, i / nV), sgn * u, v);
      }, { offset: 0.003 }).main);
    }

    // A dark intake lip round the lower front of the nose wedge
    for (const sgn of [1, -1]) {
      add('hole', buildGrid(5, 7, (i, j, v) => tubPoint(lerp(Z_NOSE + 0.004, -2.09, i / 4), sgn * (sgn > 0 ? lerp(3.6, 5, j / 6) : lerp(5, 3.6, j / 6)), v), { offset: 0.003 }).main);
    }

    // Radiator exit on top of the nose keel: a big duct ahead of the windscreen and three slots before it
    add('hole', buildGrid(6, 11, (i, j, v) => tubPoint(lerp(-1.28, -0.95, i / 5), lerp(-1.45, 1.45, j / 10), v), { offset: 0.003 }).main);
    for (let l = 0; l < 3; l++) {
      const z0 = -1.56 + l * 0.075;
      add('hole', buildGrid(2, 9, (i, j, v) => tubPoint(z0 + i * 0.03, lerp(-1.25, 1.25, j / 8), v), { offset: 0.003 }).main);
    }
  }

  // ---- 2. Pontoon front fenders ------------------------------------------------------------
  const headlights = [], taillights = [];
  {
    const Z = stations(
      [[PON_Z0, -2.06, 0.012], [-2.06, -1.6, 0.04], [-1.6, -0.72, 0.03], [-0.72, PON_Z1, 0.04]],
      [WHEEL_ZF - ARCH_R - 0.004, WHEEL_ZF - ARCH_R + 0.0005],
      k,
    );
    const nOut = Math.max(3, Math.round(8 * q)), nIn = Math.max(10, Math.round(26 * q));
    // columns: the first nOut run from the arch / cutaway edge up to τ = −0.3, the rest are fixed
    const tauCol = (p, j) => {
      p.ts ??= Math.min(-0.31, tauOuter(p, p.ybo));
      return j <= nOut ? lerp(p.ts, -0.3, j / nOut) : lerp(-0.3, 1, (j - nOut) / nIn);
    };
    for (const side of [1, -1]) {
      const shell = Z.map((z) => ponParams(z, 0)), liner = Z.map((z) => ponParams(z, 0.014));
      for (const [prm, key] of [[shell, 'paint'], [liner, 'hole']]) {
        add(key, buildGrid(Z.length, nOut + nIn + 1, (i, j, v) => ponPoint(Z[i], tauCol(prm[i], j), side, v, prm[i]), { flip: side > 0 }).main);
      }
      // a thin painted lip joins the shell to the liner along the arch edge, so the fender looks solid
      const lip = Z.map((z, i) => [ponPoint(z, tauCol(shell[i], 0), side, V(), shell[i]), ponPoint(z, tauCol(liner[i], 0), side, V(), liner[i])]);
      add('paint', strip(lip, new THREE.Vector3(side * 0.3, -1, 0)));
      // exit louvres on the fender top, behind the wheel
      for (let l = 0; l < 5; l++) {
        const z0 = -0.98 + l * 0.065, z1 = z0 + 0.03;
        add('hole', buildGrid(2, 9, (i, j, v) => ponPoint(i ? z1 : z0, lerp(-0.22, 0.22, j / 8), side, v), { flip: side > 0, offset: 0.003 }).main);
      }
    }

    // Slim headlight bars on the front of each pontoon (projected onto its rounded nose)
    const xc = PON.xc(-2.0);
    const bar = (y0, y1, hw) => {
      const rows = [y0, y1].map((y) => Array.from({ length: 13 }, (_, j) => {
        const x = xc + lerp(-hw, hw, j / 12);
        return new THREE.Vector3(x, y, ponFrontZ(x, y) - 0.005);
      }));
      return strip(rows, new THREE.Vector3(0, 0, -1));
    };
    const yb = SILL + 0.62 * (PON.yt(-2.0) - SILL);
    add('lights', ...both(bar(yb, yb + 0.03, 0.12)), ...both(bar(yb - 0.044, yb - 0.032, 0.095)));
    // dark lamp housing behind the bars, so they read as a light unit
    const housing = bar(yb - 0.062, yb + 0.05, 0.142);
    housing.translate(0, 0, 0.003);
    add('hole', ...both(housing));
    const hz = ponFrontZ(xc, yb + 0.013);
    headlights.push([xc, yb + 0.013, hz - 0.01], [-xc, yb + 0.013, hz - 0.01]);

    // Canards on the outer front corners
    for (const [y, z, len] of [[0.3, -1.86, 0.13], [0.4, -1.8, 0.11]]) {
      const s = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0, len), new THREE.Vector2(0.065, 0.02)]);
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: false });
      g.rotateX(-Math.PI / 2); // shape (outwards, forwards) → horizontal plate
      g.rotateZ(0.12);
      g.translate(PON.xc(z) + PON.a(z) - 0.012, y, z);
      add('carbon', ...both(g));
    }
  }

  // ---- 3. Canopy, interior --------------------------------------------------------------------
  {
    const Z = stations([[CAN_Z0, -0.86, 0.02], [-0.86, CAN_Z1, 0.035]],
      [WS[0], WS[1], WS[0] - SEAL_Z, WS[1] + SEAL_Z, SW[0], SW[1], SW[0] - SEAL_Z, SW[1] + SEAL_Z], k);
    const tHalf = stations([[0, 1.2, 0.06]], [T_TOP, T_TOP - SEAL_T, T_LOW, T_LOW + SEAL_T, 1], k);
    const T = [...tHalf.slice(1).reverse().map((t) => -t), ...tHalf];
    addGroups(buildGrid(Z.length, T.length, (i, j, v) => canopyPoint(Z[i], T[j], v), {
      group: (i, j) => canopyGroup((Z[i] + Z[i + 1]) / 2, (T[j] + T[j + 1]) / 2),
    }));

    // Interior: a dark floor under the bubble, two seats, a dash and a steering wheel
    const y = 0.722, zs = stations([[-0.62, 0.42, 0.08]], [], 1), pts = [];
    zs.forEach((z) => pts.push(new THREE.Vector2(canopyHalfWidthAt(z, y) * 0.96, -z)));
    zs.slice().reverse().forEach((z) => pts.push(new THREE.Vector2(-canopyHalfWidthAt(z, y) * 0.96, -z)));
    const floor = new THREE.ShapeGeometry(new THREE.Shape(pts));
    floor.rotateX(-Math.PI / 2);
    floor.translate(0, y, 0);
    add('interior', floor);
    for (const sx of [-0.21, 0.21]) {
      // rounded bucket seats (flattened capsules)
      const cushion = new THREE.CapsuleGeometry(0.06, 0.18, 3, 10);
      cushion.rotateX(Math.PI / 2);
      cushion.scale(2.3, 1, 1);
      cushion.translate(sx, 0.765, 0.1);
      const back = new THREE.CapsuleGeometry(0.13, 0.16, 4, 12);
      back.scale(1.15, 0.75, 0.4);
      back.rotateX(-0.3);
      back.translate(sx, 0.89, 0.33);
      add('interior', cushion, back);
    }
    // a curved dash across the cockpit
    const dash = new THREE.CylinderGeometry(0.1, 0.1, 0.76, 12, 1, false, 0, Math.PI);
    dash.rotateZ(Math.PI / 2);
    dash.translate(0, 0.78, -0.42);
    const wheel = new THREE.TorusGeometry(0.11, 0.014, 6, Math.round(20 * q));
    wheel.rotateX(0.35);
    wheel.translate(-0.21, 0.9, -0.24);
    add('interior', dash, wheel);
  }

  // ---- 4. Fin --------------------------------------------------------------------------------
  {
    const Z = stations([[0.15, 1.9, 0.04], [1.9, 1.985, 0.012]], [], k);
    const T = [-1.4, -1.2, -1, -0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.4];
    add('paint', buildGrid(Z.length, T.length, (i, j, v) => finPoint(Z[i], T[j], v)).main);
  }

  // ---- 5. Rear wing on swan necks ------------------------------------------------------------
  {
    const prof = airfoil(Math.round(20 * q), 0.12, 0.06, 0.42);
    add('carbon', wingGeometry(prof, -0.955, 0.955, [1.84, 1.045], 0.29, 0.12)); // main plane
    add('carbon', wingGeometry(airfoil(Math.round(14 * q), 0.1, 0.05, 0.4), -0.955, 0.955, [2.085, 1.088], 0.14, 0.35)); // flap
    // endplates
    const ep = [[1.86, 1.02], [2.17, 0.995], [2.25, 1.02], [2.255, 1.152], [2.13, 1.162], [1.92, 1.135], [1.85, 1.075]];
    add('paint', sideShape(ep, 0.012, 0.961, 0.002), sideShape(ep, 0.012, -0.961, 0.002));
    // swan necks: rise from the deck, arc over the wing and hook down onto its top surface
    const path = new THREE.CatmullRomCurve3([[1.56, 0.8], [1.63, 0.96], [1.71, 1.075], [1.8, 1.126], [1.89, 1.128], [1.955, 1.098], [1.98, 1.06]].map(([z, y]) => new THREE.Vector3(z, y, 0)));
    const pts = path.getPoints(28), L = [], R = [];
    pts.forEach((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const tx = b.x - a.x, ty = b.y - a.y, l = Math.hypot(tx, ty), hw = lerp(0.04, 0.016, i / (pts.length - 1));
      L.push([p.x - (ty / l) * hw, p.y + (tx / l) * hw]);
      R.push([p.x + (ty / l) * hw, p.y - (tx / l) * hw]);
    });
    const neck = [...L, ...R.reverse()];
    add('carbon', sideShape(neck, 0.018, 0.3, 0.003), sideShape(neck, 0.018, -0.3, 0.003));
  }

  // ---- 6. Floor, splitter, diffuser, exhaust -----------------------------------------------
  {
    // one dark slab: a splitter blade under the nose, notches round the wheels, floor edges under the pods
    const right = [];
    const push = (x, z) => right.push([x, z]);
    push(0.0, -2.3); push(0.2, -2.29); push(0.36, -2.24); push(0.5, -2.12); push(0.62, -1.95); push(0.64, -1.63);
    push(0.6, -1.63); push(0.6, WHEEL_ZF + 0.47);
    for (let z = WHEEL_ZF + 0.47; z <= WHEEL_ZR - 0.47; z += 0.05) push(Math.max(0.6, TUB.x0(z) - 0.03), z);
    push(0.6, WHEEL_ZR - 0.47); push(0.6, 2.0); push(0.0, 2.0);
    const pts = [...right.map(([x, z]) => new THREE.Vector2(x, -z)), ...right.slice(1, -1).reverse().map(([x, z]) => new THREE.Vector2(-x, -z))];
    const slab = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 0.025, bevelEnabled: false });
    slab.rotateX(-Math.PI / 2);
    slab.translate(0, 0.075, 0);
    add('void', slab);

    // diffuser: a ramp rising to the tail with vertical strakes
    const ramp = strip([
      [new THREE.Vector3(-0.8, 0.095, 1.62), new THREE.Vector3(0.8, 0.095, 1.62)],
      [new THREE.Vector3(-0.8, 0.27, 2.25), new THREE.Vector3(0.8, 0.27, 2.25)],
    ], new THREE.Vector3(0, -1, 0));
    add('carbon', ramp);
    for (const x of [-0.62, -0.31, 0, 0.31, 0.62]) add('carbon', sideShape([[1.74, 0.1], [2.25, 0.09], [2.25, 0.27], [1.74, 0.11]], 0.01, x));

    // rear wheel wells: a dark liner round the top of each tyre and a wall on the inboard side
    {
      const r = ARCH_R + 0.006, a0 = -0.47, a1 = Math.PI + 0.47, n = Math.round(24 * q);
      const ring = (x) => Array.from({ length: n + 1 }, (_, i) => {
        const a = lerp(a0, a1, i / n);
        return new THREE.Vector3(x, WHEEL_Y + r * Math.sin(a), WHEEL_ZR + r * Math.cos(a));
      });
      const liner = strip([ring(0.6), ring(0.99)], new THREE.Vector3(0, -1, 0));
      const wall = new THREE.ShapeGeometry(new THREE.Shape([...ring(0).map((p) => new THREE.Vector2(p.z, p.y)),
        new THREE.Vector2(WHEEL_ZR - r * Math.cos(a0), 0.1), new THREE.Vector2(WHEEL_ZR + r * Math.cos(a0), 0.1)]));
      wall.rotateY(-Math.PI / 2); // shape (z, y) → the plane x = 0
      wall.translate(0.6, 0, 0);
      add('hole', ...both(liner), ...both(wall));
    }

    // twin centre exhaust tips
    for (const x of [-0.085, 0.085]) {
      const tip = new THREE.TorusGeometry(0.046, 0.011, 8, Math.round(24 * q));
      tip.translate(x, 0.5, Z_TAIL + 0.006);
      add('trim', tip);
      const hole = new THREE.CircleGeometry(0.046, Math.round(20 * q));
      hole.translate(x, 0.5, Z_TAIL + 0.002);
      add('hole', hole);
    }
  }

  // ---- 7. Mirrors on the fender tops --------------------------------------------------------
  {
    const housing = new THREE.SphereGeometry(1, Math.round(18 * q), Math.round(8 * q), 0, Math.PI * 2, 0, Math.PI / 2);
    housing.rotateX(-Math.PI / 2); // pole → forwards: a half ellipsoid with a flat back
    housing.scale(0.085, 0.042, 0.1);
    housing.translate(1.02, 0.885, -0.5);
    add('paint', ...both(housing));
    const face = new THREE.CircleGeometry(1, Math.round(18 * q));
    face.scale(0.08, 0.038, 1);
    face.translate(1.02, 0.885, -0.499);
    add('trim', ...both(face));
    const stalk = new THREE.BoxGeometry(0.022, 0.15, 0.05);
    stalk.rotateZ(-0.75);
    stalk.translate(0.93, 0.82, -0.49);
    add('carbon', ...both(stalk));
  }

  // ---- Assemble ------------------------------------------------------------------------------
  const model = new THREE.Group();
  model.name = 'model';
  const main = new THREE.Group();
  main.name = 'main';
  model.add(main);
  const mesh = (name, key, mat) => {
    if (!P[key].length) return;
    const m = new THREE.Mesh(mergeGeometries(P[key]), mat);
    m.name = name;
    main.add(m);
  };

  // ---- 8. Wheels (+ callipers, which stay still, in main) ----------------------------------
  const rimR = rimGeometry(q), rimL = rimR.clone().rotateY(Math.PI);
  const hubR = hubGeometry(q), hubL = hubR.clone().rotateY(Math.PI);
  // tyre: bead → bulging sidewall → rounded shoulder → flat tread → and back (radius, x) in the wheel frame
  const R = TYRE_R, W = TYRE_W / 2;
  const tyreSide = [[0.275, 0.83], [0.3, 0.94], [0.33, 0.99], [R - 0.01, 0.95], [R - 0.002, 0.85], [R, 0.67]];
  const tyre = latheX([...tyreSide.map(([r, f]) => [r, -f * W]), ...tyreSide.reverse().map(([r, f]) => [r, f * W])], Math.round(72 * q));
  const caliperR = arcBlock(0.165, 0.232, 0.25, 0.95, -0.052, 0.03, 6);
  for (const [name, x, z] of [['fl', -WHEEL_X, WHEEL_ZF], ['fr', WHEEL_X, WHEEL_ZF], ['rl', -WHEEL_X, WHEEL_ZR], ['rr', WHEEL_X, WHEEL_ZR]]) {
    const right = x > 0;
    const w = new THREE.Object3D();
    w.name = `wheel_${name}`;
    w.position.set(x, WHEEL_Y, z);
    const t = new THREE.Mesh(tyre, rubber);
    t.name = 'tyre';
    const rim = new THREE.Mesh(right ? rimR : rimL, chrome);
    rim.name = `rim_${name}`;
    rim.position.x = right ? 0.105 : -0.105;
    const hub = new THREE.Mesh(right ? hubR : hubL, darkMetal);
    hub.name = `hub_${name}`;
    w.add(t, rim, hub);
    model.add(w);
    // calliper: grips the disc on the rear-upper side; lives in main so it does not spin
    const c = right ? caliperR.clone() : mirrorX(caliperR);
    c.translate(x, WHEEL_Y, z);
    add('caliper', c);
  }

  // tail-light centres (on the light bar near the shoulders)
  const tl = tubPoint(Z_TAIL, 2.6, V());
  taillights.push([tl.x - 0.03, tl.y - 0.03, Z_TAIL + 0.01], [-(tl.x - 0.03), tl.y - 0.03, Z_TAIL + 0.01]);

  mesh('body', 'paint', paint);
  mesh('glass', 'glass', glass);
  mesh('trim', 'trim', chrome);
  mesh('lights', 'lights', lightMat);
  mesh('brakes', 'brakes', brakeMat);
  mesh('carbon', 'carbon', carbon);
  mesh('voids', 'void', voidMat);
  mesh('openings', 'hole', holeMat);
  mesh('interior', 'interior', interiorMat);
  mesh('calipers', 'caliper', caliperMat);

  model.userData = { rimRadius: RIM_R, headlights, taillights };
  return model;
}
