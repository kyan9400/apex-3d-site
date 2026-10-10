# How to build a website like the 3D reels

The reels ("comment FLOW", "comment HOW", "comment hero") show sites that look expensive.
Under the hood every one of them is the same **4 ingredients**:

| # | Ingredient | What it does | In this project |
|---|---|---|---|
| 1 | **3D model** | The object (car, phone, shoe…), usually a `.glb` file | The Apex GT, **built entirely in code** in `src/car/` (nothing to download, 100% owned) |
| 2 | **Real-time 3D renderer** | Draws the model in the browser with lighting and reflections | Three.js |
| 3 | **Scroll animation** | Moves the camera/model as you scroll | GSAP ScrollTrigger + Lenis |
| 4 | **Cinematic design** | Dark background, huge type, glass cards, lots of space | `src/style.css` |

Get those four right and you have "a $5k website".

---

## Route A — Code it (this project)

### Files

```
apex-3d-site/
├─ index.html              page structure: 7 <section data-scene="N"> blocks
├─ src/main.js             the 3D scene, camera shots and scroll wiring (commented step by step)
├─ src/quality.js          device tiers, GPU check, adaptive resolution, ?fps meter
├─ src/effects.js          light glows, headlight beams, road + speed streaks, brake glow, wheel blur
├─ src/ui.js               hero intro, split-text headings, progress bar, dots, cursor, film grain
├─ src/motion.js           the reduced-motion choice (OS setting + "Turn on full motion")
├─ src/floor.js            the glossy floor reflection (high tier)
├─ src/car/                the procedural car: car.js picks the design, CONTRACT.md lists the rules
├─ src/style.css           the look
├─ car-preview.html        dev-only page to look at the car from the site's camera angles
└─ scripts/artifact-page.mjs   turns the build into a single page for a Claude artifact
```

### How `src/main.js` works

1. **Smooth scroll (Lenis).** `new Lenis(...)` replaces the browser's jumpy wheel scroll with
   eased scrolling. It is hooked into GSAP's ticker so both update on the same frame:
   `lenis.on('scroll', ScrollTrigger.update)`.
2. **Renderer, scene, camera.** `THREE.WebGLRenderer` with `alpha: true` (transparent, so the CSS
   gradient shows behind), ACES filmic tone mapping (photo-like contrast), and pixel ratio capped at 2.
3. **Lighting without an image.** `RoomEnvironment` + `PMREMGenerator` = a virtual photo studio that
   gives the paint its reflections. No HDRI download needed.
4. **Ground.** A dark disc with a radial-gradient `alphaMap` so its edge fades into the background,
   which makes the car look like it's under a spotlight.
5. **Materials.** The paint is `MeshPhysicalMaterial` with `clearcoat: 1`. That clear lacquer layer
   is *the* trick that makes car paint look real.
6. **Building the car.** `createCar()` (from `src/car/`) builds the Apex GT out of code: lofted body
   surfaces, glass, lights, wheels and rims. It returns the parts by name (`body`, `glass`, `brakes`,
   `wheel_fl`…), so the rest of the code can find them with `getObjectByName()`. A soft contact shadow
   is drawn on a canvas (`createContactShadow` in `effects.js`). Nothing is downloaded, so the loader
   only waits for the shaders to compile ("Warming up the engine").
7. **Camera "shots" (`SHOTS` array).** One shot per section. Each shot is an *orbit* around the car
   (`theta` = angle around, `phi` = angle from above, `dist` = distance), so moving between shots
   sweeps around the car instead of through it. `shiftX/shiftY` use `camera.setViewOffset` to slide
   the car sideways and make room for the text card.
8. **Scroll → camera.** For each section, `gsap.fromTo(shot, SHOTS[i-1], SHOTS[i], { scrollTrigger: { scrub: true } })`.
   `scrub` ties the animation to the scrollbar: scroll down, the camera moves; scroll up, it rewinds.
   (With reduced motion there is no scrubbed orbit: the camera cuts to each section's shot.)
9. **Render loop.** Every frame it turns `shot` into a camera position, adds a little mouse parallax,
   pulls the camera back on tall phone screens (`fit`), spins the wheels faster when you scroll faster
   (Lenis `velocity`), and renders.
10. **Color picker.** Tweens `paint.color` to the new color and `setAccent()` updates three CSS
    variables (`--accent`, `--accent-hi`, `--accent-ink`), so the whole UI follows the paint.
11. **Text.** The hero text and the nav "power on" after loading (`heroMotion` in `ui.js`); anything
    with `data-reveal` fades in on scroll; `data-count` numbers count up once.

### Accessibility & performance that's already handled
- `prefers-reduced-motion`: no smooth scroll, no intro, no reveals, no idle wheel spin, and the camera
  cuts between shots instead of orbiting with the scrollbar.
- Pixel ratio capped at 2; five procedural body styles (the first ships in the main bundle, the other four download only when picked); baked shadow instead of real-time shadows.
- WebGL check with a fallback message; page still works if the model can't load or the 3D view fails to start.
- Color buttons are real `<button>`s with labels and `aria-pressed` (they work even without WebGL).
- Split headings: screen readers (and page translation) read a plain copy of each heading in an
  `.sr-only` span; the animated words are `aria-hidden`. Counting numbers also have a hidden final value.
- A **Skip to content** link is the first thing Tab reaches; the section dots come right after the header.
- Tap targets are at least 44px on touch screens; Windows contrast themes (`forced-colors`) keep the
  swatch colors and show the dots.

---

## Version 2: smooth scrolling + the "wow" layer

### Why the first version lagged (and the fixes)
| Problem | Fix |
|---|---|
| `backdrop-filter: blur()` on the text cards had to re-blur the 3D canvas every frame | Solid tinted cards (`.panel` in `style.css`) |
| `background-attachment: fixed` repainted the page on every scroll | The spotlight is now a fixed `.backdrop` layer (its own GPU layer) |
| Two layers of smoothing (Lenis 1.2 s + a 1-second scrub delay) made the camera trail the scroll | Lenis `lerp: 0.1` + `scrub: true`: one light layer, the camera follows your scroll |
| The 3D scene redrew 60×/s even when nothing moved | **Render on demand** in `frame()`: draw only when the picture changed |
| Same resolution on every device | `quality.js`: device tiers + **adaptive resolution** (fewer pixels when frames get slow) |

Add `?fps` to the URL to see the frame rate, pixel ratio and whether it's drawing. Add `?quality=low` to test the low tier.

### New effects and where they live
- **Ignition intro** (`onLoaded` in `main.js`): headlights flicker on, exposure rises, the studio lights sweep over the paint (`look.envSpin` → `scene.environmentRotation`).
- **Launch control** (`#launch` section + `kmhAt` in `main.js`): a 320vh section with a `position: sticky` HUD. Scroll progress becomes speed; `effects.js` scrolls the road texture and moves 30–120 speed streaks (one `InstancedMesh` = one draw call); the camera shakes and does a dolly zoom (see 2.1).
- **Light glows** (`effects.js`): additive sprites on the head/tail lights = fake bloom without post-processing. They fade out when seen from behind (dot-product test).
- **Drag to rotate** (`drag` in `main.js`): only in the colors section; eases back afterwards.
- **UI motion** (`ui.js`): split-text headlines, progress bar, section dots, custom cursor + magnetic buttons (mouse only), the giant outlined "APEX GT", film grain (high tier).
- **Motion setting** (`motion.js`): if the system asks for reduced motion (Windows "Animation effects" off), the page stays calm and offers a **Turn on full motion** button. The choice is remembered. `?motion=full` forces it.

---

## Version 2.1: smoother and more cinematic

### Why it still lagged (and the fixes)
| Problem | Fix |
|---|---|
| Lenis re-checks the OS "reduce motion" setting by itself, so a visitor who picked **full motion** on Windows with animations off got no smoothing: the camera jumped ~100px per wheel notch | `respectReducedMotion: false` in `new Lenis(...)` (main.js): `motion.js` already made the choice |
| Chrome, Edge and Safari hide the GPU name (`'WebKit WebGL'`), so laptops with integrated graphics ran on the highest tier | `quality.js` reads the real name from the `WEBGL_debug_renderer_info` extension; `probeGPU()` does this on a throwaway context **before** the renderer exists, so antialias is right from the start |
| Shaders compiled (and textures uploaded) the first time something appeared: a freeze at the ignition and on entering the launch section | **Warm-up** behind the loader: `renderer.compileAsync(scene, camera)` (it also visits hidden objects like the road and streaks) + `renderer.initTexture()` for the canvas textures |
| The adaptive resolution used fixed limits: a 30 Hz battery-saver screen sank to the lowest size forever, 45–55 fps was never fixed, and it could bounce up and down | `createAdaptiveResolution` learns the screen's own refresh while nothing is drawn, jumps straight to a size that fits, and stops raising after two bounces |
| The drawing buffer was sized from `window.innerWidth` (includes the Windows scrollbar = slightly blurry) and phone toolbars stretched the canvas | A `ResizeObserver` sizes it from the canvas box itself, and the canvas is `100lvh` tall so a sliding phone toolbar never resizes it |
| On weak devices the floor and the hidden cabin cost a lot of pixels and triangles | Low tier: a flat (unlit) floor and the cabin is hidden (~1/3 of the triangles); the glass uses the cheaper standard material everywhere |

### New in 2.1 and where it lives
- **Accent tokens** (`setAccent` in `main.js`, `:root` in `style.css`): `--accent` is the real paint
  (button fills), `--accent-hi` is for thin lines on black (lighter for very dark paints) and
  `--accent-ink` is the text color on top of the paint (white or near-black, whichever reads better).
  Only plain hex values go into the variables, which keeps older Safari happy.
- **Reduced motion cuts between shots** (`SHOTS` loop in `main.js`): no scroll-scrubbed orbit and no
  light sweep with scroll; each section's camera shot appears as a cut.
- **Lost GPU context** (`makeEnvironment` in `main.js`): the studio reflections are rebuilt after a
  driver reset or sleep/resume.
- **Motion choice without storage** (`applyChoice` in `motion.js`): if the browser blocks storage, the
  choice rides in the URL (`?motion=full`) instead.

### Cinematic 3D moments (2.1)
- **Dolly zoom** (`frame()` in `main.js`): during the launch the lens widens (`fov` 32 → 46) while the
  camera moves in by exactly the same amount (`dolly`), so the car keeps its size and the road and
  streaks stretch past it, like the "Vertigo" shot in films. Costs nothing on the GPU. Make it calmer
  by lowering the `14` in `32 + s * 14`.
- **Brakes** (`look.brake` + the `#design` ScrollTrigger in `main.js`): when the launch ends, the
  tail-light glass gets its own emissive (glowing) copy of the red material, flares, then glows while
  the camera swings round to the rear. Medium/high tier also gets a red pool of light on the floor
  (`spill` in `effects.js`).
- **Suspension** (`pitch` in `frame()`): the body (`chassis` group, without the wheels) squats when the
  car speeds up and dives ~1° when it brakes. A damped spring makes it overshoot once and settle.
- **Wheel motion blur** (`createWheelBlur` in `effects.js`): the 5-spoke rims repeat every 72°, so fast
  spins looked like they turned backwards (the "wagon-wheel effect"). The visible spin is now capped,
  and on medium/high tier a pre-blurred disc fades in over each rim at speed, like a camera would see.
- Reduced motion: the lens stays at 32, no tilt, no wheel spin, and the tail lights simply fade on.

### The 2D layer (2.1)
- **Loader** (`.loader` in `style.css`, `setLoadProgress` in `main.js`): the A-P-E-X letters rise from
  behind a mask and a big counter counts to 100. These are pure CSS animations of `transform`/`opacity`,
  so they keep moving while JavaScript is busy preparing the model. The progress line sits on the
  curtain's bottom edge and grows with `scaleX` (the old bar animated `width`, which re-laid out the
  page on every download event). Screen readers hear only "Loading the car" → "Warming up the engine",
  not every percentage, and everything behind the loader is `inert` (not focusable) until it lifts.
- **Hero ignition** (`heroMotion` in `ui.js`): one paused GSAP timeline that `onLoaded` plays as the
  headlights flicker: eyebrow → title lines → sub-line → nav → section dots → scroll hint. `fromTo()`
  sets the hidden states right away, behind the loader, so the title never flashes. Scrolling down
  lifts and fades `.hero__inner` (scrubbed, so it rewinds when you scroll back).
- **Launch instrument cluster** (`#launch` in `index.html`, LAUNCH CONTROL in `main.js`): ticks every
  30 km/h plus an accent mark at 100 km/h, steady Inter numerals (tabular figures don't wobble), a dark
  instrument face and a soft scrim behind the HUD (painted once, readable over the speed streaks), the
  number turns red from 300 km/h, and the 0–100 badge pulses once when you hit it. The nav and dots
  fade aside while the launch runs (still reachable with Tab: keyboard focus brings them back). The
  gauge code no longer lives inside `init()`, so it works without WebGL. Short laptop windows and
  landscape phones get a compact HUD.

---

## Version 2.2: glossy floor + replay

- **Glossy floor** (`src/floor.js`, high tier only): three's `Reflector` renders the scene a second time
  from a camera mirrored under the floor, into a texture at half the screen size. A small shader blurs it
  (5 samples), fades it out away from the car and *adds* it to the dark floor, so it reads as polished
  concrete. It's a second render pass, so only strong GPUs get it (`reflection` in `quality.js`).
  Try it on any machine with `?quality=high`. Change `strength` and `radius` in `floor.js` to tune it.
- **Replay the drive** (button at the end, `onReplay` + `ignition()` in `main.js`): Lenis glides back to the
  top in 2.6 s (the camera rewinds through every shot because it's tied to the scroll), then the engine
  turns off (lights out, hero text hidden) and the same `ignition()` timeline as the first load plays again.

---

## Version 3: the Apex GT and the model lineup

### The car is built in code
There is no `.glb` file. Every car is made of Three.js shapes in `src/car/`, and each one follows
`src/car/CONTRACT.md`: the names the page looks for (`main`, `wheel_fl`…`wheel_rr`, `rim_*`, `brakes`),
the light positions in `userData`, size and orientation. Open `car-preview.html` (via the dev server)
to look at one car on its own while you work on it.

### The 5 models
| Button | Model | File |
|---|---|---|
| Speedster | GT Speedster | `variant-a.js` (in the main bundle) |
| Coupé | GT Coupé | `variant-c.js` |
| Endurance | R Endurance | `variant-d.js` |
| Electric | E Electric | `variant-e.js` |
| Tourer | Grand Tourer | `variant-f.js` |

### How they load
`src/car/car.js` exports `MODELS`: an `id`, a `name`, a `note` and a `load()` function per car.
The Speedster is imported normally, so the page opens with it. The other four use `import()`,
so Vite puts each in its own chunk and the browser downloads it only when a visitor picks it.
(Publishing somewhere by hand? Upload every `dist/assets/*.js` file, or those picks 404.
`scripts/artifact-page.mjs` prints the list.)

### Swapping cars (`src/main.js`)
- `installCar(next)` puts a car on stage: finds the wheels, gives the tail lights their own brake
  material, builds the suspension group, adds the wheel blur discs and moves the light glows
  (`fx.setLights`) to the new car.
- `disposeCar(old)` frees the old car's geometry and its own materials. The shared paint, chrome and
  glass stay, because the next car uses them (that is why the color picker survives a swap).
- `onModel` runs the sequence: lights off (GSAP), swap, lights on. While it runs, the whole button
  group is busy and the note says "Loading…". If a chunk fails, the note says so and the old car stays.

### Add a sixth model
1. Copy a variant to `src/car/variant-g.js` and change the shapes. Keep everything `CONTRACT.md` asks for.
2. Add a line to `MODELS` in `car.js`:
   `{ id: 'roadster', name: 'GT Roadster', note: '…', load: async () => (await import('./variant-g.js')).createCar }`
3. Add a button in the `.models` group in `index.html` with the same id:
   `<button class="model-btn" type="button" data-model="roadster" aria-pressed="false">Roadster</button>`
4. `npm run build`, then pick it on the page.

---

## Make it your own

**Change the text/colors:** edit `index.html` (copy) and the `--accent` / fonts in `src/style.css`.
The color swatches are the `data-color` buttons in the `#colors` section.

**Change the camera angles:** edit the `SHOTS` array in `src/main.js`. Tip: with `npm run dev`
running, open devtools and play with `__debug.shot.theta = 200` to find angles you like.

**Change the car:** open `/car-preview.html?variant=a` while `npm run dev` runs to look at it from every
camera angle. Each design is a file in `src/car/` that follows `CONTRACT.md`; `src/car/car.js` lists the lineup
in `MODELS` (the first entry, exported as `createCar`, is the car the page opens with); see 'Version 3' above
to add or reorder models. To use a downloaded model instead, load it with `GLTFLoader` and give its parts the names
from `CONTRACT.md` (check the model's license first — see below).

**Not a car?** Same code works for a phone, sneaker, watch or bottle: swap the model and the copy.

---

## Where to get 3D models legally

- **Sketchfab** (sketchfab.com): filter by "Downloadable" + license. CC-BY means free with credit. Check each model's license before client work.
- **Build it in code** (like the Apex GT here): you own it completely and there's nothing to download.
- **Poly Haven** (polyhaven.com): CC0 (no credit needed) models, HDRIs and textures.
- **Fab** (fab.com), **CGTrader**, **TurboSquid**: paid, higher quality, commercial licenses.
- **Make your own:** Blender (free) → File → Export → glTF 2.0 (.glb).
- **For client work** always ask the client for their own product CAD/3D files first.

---

## Route B — No-code / AI tools

| Tool | Good for | Cost (approx.) | Limits |
|---|---|---|---|
| **Spline** | Design 3D scenes visually, embed in any site, simple scroll/hover events | Free tier, paid ~$12–25/mo | Heavy embeds, less control than code |
| **Framer** | Whole marketing site, animations, can embed Spline | Free tier, ~$10–30/mo per site | 3D is via embeds |
| **Webflow** | Pro sites with GSAP built in (Interactions) | ~$14–40/mo per site | Learning curve, 3D via embeds |
| **Unicorn Studio** | WebGL effects/backgrounds without code | Free tier, paid plans | Effects, not full 3D models |
| **Lovable / Bolt / v0** | AI writes the code from a prompt | Free tiers, ~$20/mo | Output still needs a model, design taste and fixing |

Prices change often, so check the sites. The AI builders write the same kind of Three.js/GSAP code
as this project, and knowing how it works (above) is what lets you fix and customize what they make.

---

## Put it online for free

```bash
npm run build
```

Then any of these:
- **Netlify Drop**: drag the `dist/` folder onto https://app.netlify.com/drop
- **Vercel**: `npx vercel` in the project folder
- **GitHub Pages**: push to GitHub, set `base: '/repo-name/'` in a `vite.config.js`, and deploy `dist/`

**As a Claude artifact:** run `npm run build:artifact`. It builds the site and then runs
`scripts/artifact-page.mjs`, which writes `dist/apex-motors.html` (one page with the CSS inlined).
`vite build` empties `dist/` every time, so after a plain `npm run build` run the script again
(`node scripts/artifact-page.mjs`).

---

## Performance checklist

- [ ] Model under ~5 MB (Draco/Meshopt compressed, textures ≤ 2K)
- [ ] `setPixelRatio(Math.min(devicePixelRatio, 2))`
- [ ] Baked shadows instead of real-time shadow maps where possible
- [ ] Test on a real phone, especially mid-range Android
- [ ] Loader with progress, plus a fallback if WebGL or the model fails
- [ ] Respect `prefers-reduced-motion`

---

## About the "comment FLOW / HOW / hero" reels

They're lead funnels. Commenting triggers an auto-DM that leads to a **course**, a **template**,
or a **paid asset library** (e.g. the HorizonX reel sells a UI kit). They can be useful, but there's no
secret framework: it's the 4 ingredients above. You now have a working version of the hard part.
