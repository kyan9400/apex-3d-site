# How to build a website like the 3D reels

The reels ("comment FLOW", "comment HOW", "comment hero") show sites that look expensive.
Under the hood every one of them is the same **4 ingredients**:

| # | Ingredient | What it does | In this project |
|---|---|---|---|
| 1 | **3D model** | The object (car, phone, shoe…) as a `.glb` file | `ferrari.glb`, loaded from a CDN |
| 2 | **Real-time 3D renderer** | Draws the model in the browser with lighting and reflections | Three.js |
| 3 | **Scroll animation** | Moves the camera/model as you scroll | GSAP ScrollTrigger + Lenis |
| 4 | **Cinematic design** | Dark background, huge type, glass cards, lots of space | `src/style.css` |

Get those four right and you have "a $5k website".

---

## Route A — Code it (this project)

### Files

```
apex-3d-site/
├─ index.html        page structure: 6 <section data-scene="N"> blocks
├─ src/main.js       all the 3D + animation (commented step by step)
├─ src/style.css     the look
└─ public/draco/     decoder for compressed 3D models (copied from three)
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
6. **Loading the model.** `GLTFLoader` + `DRACOLoader`. Parts are found by name
   (`getObjectByName('body')`) and given new materials. A baked shadow image sits under the car.
   The progress callback drives the loader bar; if the first CDN fails it tries the second.
7. **Camera "shots" (`SHOTS` array).** One shot per section. Each shot is an *orbit* around the car
   (`theta` = angle around, `phi` = angle from above, `dist` = distance), so moving between shots
   sweeps around the car instead of through it. `shiftX/shiftY` use `camera.setViewOffset` to slide
   the car sideways and make room for the text card.
8. **Scroll → camera.** For each section, `gsap.fromTo(shot, SHOTS[i-1], SHOTS[i], { scrollTrigger: { scrub: 1 } })`.
   `scrub` ties the animation to the scrollbar: scroll down, the camera moves; scroll up, it rewinds.
9. **Render loop.** Every frame it turns `shot` into a camera position, adds a little mouse parallax,
   pulls the camera back on tall phone screens (`fit`), spins the wheels faster when you scroll faster
   (Lenis `velocity`), and renders.
10. **Color picker.** Tweens `paint.color` to the new color and updates the CSS `--accent` variable,
    so the whole UI follows the paint.
11. **Text.** Headline lines slide up after loading; anything with `data-reveal` fades in on scroll;
    `data-count` numbers count up once.

### Accessibility & performance that's already handled
- `prefers-reduced-motion`: no smooth scroll, no intro, no reveals, no idle wheel spin.
- Pixel ratio capped at 2; one model (1.7 MB); baked shadow instead of real-time shadows.
- WebGL check with a fallback message; page still works if the model can't load.
- Color buttons are real `<button>`s with labels and `aria-pressed`.

---

## Make it your own

**Change the text/colors:** edit `index.html` (copy) and the `--accent` / fonts in `src/style.css`.
The color swatches are the `data-color` buttons in the `#colors` section.

**Change the camera angles:** edit the `SHOTS` array in `src/main.js`. Tip: with `npm run dev`
running, open devtools and play with `__debug.shot.theta = 200` to find angles you like.

**Use a different model:**
1. Get a `.glb` (see below). Shrink it at https://gltf.report (Draco compression, resize textures to 2K).
2. Put it in `public/models/your-car.glb` and change `MODEL_BASES` / `MODEL_FILE` in `main.js`.
3. Open it in https://gltf-viewer.donmccurdy.com to see the part names, and update the
   `getObjectByName('body')` / wheel names (or remove those lines to keep the model's own materials).
4. Adjust `SHOTS` distances if your model is a different size.

**Not a car?** Same code works for a phone, sneaker, watch or bottle: swap the model and the copy.

---

## Where to get 3D models legally

- **Sketchfab** (sketchfab.com): filter by "Downloadable" + license. CC-BY means free with credit (like the footer here). Check each model's license before client work.
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
