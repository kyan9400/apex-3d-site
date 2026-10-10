# Procedural car contract (Apex GT)

The site's car must be **100% made in code**, owned by Alhassan Alfarran — no downloaded models, no textures from the
internet, no real brand shapes or logos (it must not read as a copy of any real car). Fictional brand: **Apex Motors**,
model **Apex GT** — a mid-engine roadster/spider supercar.

## Module API

```js
import * as THREE from 'three';
export function createCar({ paint, chrome, glass, tier }) // tier: 'low' | 'medium' | 'high'
// returns THREE.Group (the "model")
```

`paint`, `chrome`, `glass` are materials created by main.js (paint = MeshPhysicalMaterial with clearcoat, colour is
changed live by the colour picker; chrome = metal MeshStandardMaterial; glass = dark transparent MeshStandardMaterial).
Use them for the parts below; create any other materials yourself (tyre rubber, dark trim, interior, light lenses …).

## Required scene graph (names are used by main.js / effects.js)

```
model (Group)
├─ main (Group)            everything that is NOT a wheel: body, glass, trim, lights, interior, aero parts
│   ├─ body   (Mesh)       the painted shell — material: paint (may be several meshes merged into one)
│   ├─ glass  (Mesh)       windscreen/side glass — material: glass
│   ├─ trim   (Mesh)       chrome/brightwork accents — material: chrome
│   ├─ lights (Mesh)       headlight lenses (emissive-looking, white/cool)
│   ├─ brakes (Mesh)       tail-light lenses — MeshStandardMaterial, red; main.js clones it and drives .emissive
│   └─ …                   anything else (interior, intakes, diffuser, mirrors…), any names
├─ wheel_fl / wheel_fr / wheel_rl / wheel_rr (Object3D)
│      positioned at the axle centre; main.js spins them with rotation.x
│      ├─ tyre   (Mesh)
│      ├─ rim_fl / rim_fr / rim_rl / rim_rr (Mesh, material: chrome) — the spoked face, on the OUTER side:
│      │      rim.position.x = +offset for right wheels (x > 0), −offset for left wheels; y = z = 0
│      └─ brake disc + calliper (optional; callipers must NOT spin → see note)
```

Note: callipers would spin with the wheel group; either skip them or put them in `main` at the wheel position.

## Dimensions (match the old model so camera shots, shadows and effects still fit)

- The car faces **−z**. Ground is y = 0. Centred on x = 0, z ≈ 0.
- Length ≈ 4.5 m (z from ≈ −2.27 front to ≈ +2.25 rear), width ≈ 1.95–2.05 m body (≈ 2.2 incl. mirrors), height ≈ 1.15 m.
- Wheels: centres at x = ±0.83, y = 0.36, front z = −1.16, rear z = +1.50. Tyre outer radius ≈ 0.36, width ≈ 0.27.
  Rim radius ≈ 0.28 (put it in `model.userData.rimRadius`).
- Wheel arches must clear the tyres; the wheels must sit visibly inside the arches (no floating, no intersection).

## userData (read by effects.js)

```js
model.userData = {
  rimRadius: 0.28,
  headlights: [[x, y, z], [-x, y, z]],   // centre of each headlight, for the glow sprites
  taillights: [[x, y, z], [-x, y, z]],   // centre of each tail light
}
```

## Quality and performance

- Total ≤ 120k triangles on 'high', ≤ 60k on 'low' (use `tier` to choose segment counts).
- Few draw calls: merge static parts that share a material (`BufferGeometryUtils.mergeGeometries` from
  'three/addons/utils/BufferGeometryUtils.js'). Target ≤ 40 meshes total.
- Smooth normals on the painted shell (computeVertexNormals on a well-formed surface) so the clearcoat reflections flow.
- No textures from files. Small canvas-generated textures are fine (e.g. tyre sidewall, grille mesh, light LED pattern).
- Build time < 100 ms on a laptop (it runs during page load).

## Look

Premium, sleek, modern hypercar/roadster proportions: low nose, long flowing shoulders, a cab-forward cockpit,
pronounced rear haunches over the rear wheels, side intakes in front of the rear wheels, a full-width LED tail bar or
slim tail lights, slim headlight strips, front splitter, rear diffuser, 5- or 10-spoke rims with visible brake discs.
It must look good from every angle used on the site: front ¾, side, rear ¾, top-down ¾, low front, wide ¾.
