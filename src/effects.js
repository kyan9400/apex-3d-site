/* ==========================================================================
   EFFECTS — cheap tricks that look expensive
     · Light glows: additive sprites on the head/tail lights (fake bloom,
       no post-processing pass needed)
     · Headlight beams: a soft additive gradient on the floor
     · Road: a procedurally drawn asphalt texture that scrolls under the car
     · Speed streaks: one InstancedMesh of thin lines = a single draw call
     · Brake lights: the tail glows flare when the launch ends, plus a red
       pool of light on the floor behind the car (medium/high tier)
     · Wheel motion blur (createWheelBlur): a pre-blurred disc over each rim
       at high spin (medium/high tier)
   All textures are drawn with <canvas>, so nothing extra is downloaded.
   ========================================================================== */
import * as THREE from 'three';

// Fallback light positions (the car faces -z). main.js passes the real ones from
// the car's userData, so these only matter if a car doesn't provide them.
const DEFAULT_HEADLIGHTS = [
  [0.64, 0.61, -1.87],
  [-0.64, 0.61, -1.87],
];
const DEFAULT_TAILLIGHTS = [
  [0.7, 0.86, 2.1],
  [-0.7, 0.86, 2.1],
];

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = size[0];
  c.height = size[1];
  draw(c.getContext('2d'), c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Soft round glow used by every light sprite
const glowTexture = () =>
  canvasTexture([128, 128], (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });

export function createEffects(
  scene,
  { streakCount, reducedMotion, brakeSpill, headlights = DEFAULT_HEADLIGHTS, taillights = DEFAULT_TAILLIGHTS }
) {
  const group = new THREE.Group();
  scene.add(group);

  /* ---------------- LIGHT GLOWS ---------------- */
  const glowTex = glowTexture();
  const makeGlow = (pos, color, scale, forward) => {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false, // never clipped by the body; we hide it from behind instead (see update)
        transparent: true,
        opacity: 0,
      })
    );
    sprite.position.set(...pos);
    sprite.scale.setScalar(scale);
    sprite.userData.forward = new THREE.Vector3(0, 0, forward); // direction the light points
    sprite.userData.tail = forward > 0; // tail lights point backwards (+z) and react to the brakes
    sprite.renderOrder = 10;
    group.add(sprite);
    return sprite;
  };
  const heads = headlights.map((p) => makeGlow(p, 0xdfe9ff, 0.9, -1));
  const tails = taillights.map((p) => makeGlow(p, 0xff2a2a, 0.55, 1));
  const glows = [...heads, ...tails]; // built once, not every frame

  /* ---------------- HEADLIGHT BEAMS ON THE FLOOR ---------------- */
  const beamTex = canvasTexture([64, 256], (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, h, 0, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.filter = 'blur(10px)'; // soft edges so it reads as light, not a painted stripe
    ctx.beginPath(); // a cone: narrow at the car, wide far away
    ctx.moveTo(w * 0.42, h - 12);
    ctx.lineTo(w * 0.58, h - 12);
    ctx.lineTo(w * 0.85, 12);
    ctx.lineTo(w * 0.15, 12);
    ctx.fill();
  });
  const beamMat = new THREE.MeshBasicMaterial({
    map: beamTex,
    color: 0xcfdcff,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    opacity: 0,
  });
  const beams = headlights.map(([x, , z]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 7), beamMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x * 1.3, 0.004, z - 3.5); // starts at the headlight, reaches 7 m ahead
    m.renderOrder = 3;
    group.add(m);
    return m;
  });

  /* ---------------- BRAKE GLOW ON THE FLOOR (not on the low tier) ---------------- */
  // A red pool of light behind the bumper: the same soft glow texture, laid flat
  let spill = null;
  if (brakeSpill) {
    spill = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 1.6),
      new THREE.MeshBasicMaterial({
        map: glowTex,
        color: 0xff2020,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        opacity: 0,
      })
    );
    spill.rotation.x = -Math.PI / 2;
    spill.position.set(0, 0.005, taillights[0][2] + 0.45); // just behind the tail lights
    spill.renderOrder = 3;
    spill.visible = false;
    group.add(spill);
  }

  /* ---------------- ROAD ---------------- */
  const roadTex = canvasTexture([256, 512], (ctx, w, h) => {
    ctx.fillStyle = '#0b0b0e';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1800; i++) {
      // asphalt speckle
      const v = 14 + Math.random() * 22;
      ctx.fillStyle = `rgb(${v},${v},${v + 3})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
    }
    ctx.fillStyle = 'rgba(235,235,235,0.75)';
    ctx.fillRect(w / 2 - 3, 0, 6, h * 0.45); // dashed centre line
    ctx.fillStyle = 'rgba(235,235,235,0.35)';
    ctx.fillRect(10, 0, 4, h); // edge lines
    ctx.fillRect(w - 14, 0, 4, h);
  });
  roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping;
  roadTex.repeat.set(1, 8);
  roadTex.anisotropy = 4;
  const roadFade = canvasTexture([1, 256], (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h); // fade both ends of the road
    g.addColorStop(0, '#000');
    g.addColorStop(0.3, '#fff');
    g.addColorStop(0.7, '#fff');
    g.addColorStop(1, '#000');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  roadFade.colorSpace = THREE.NoColorSpace;
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 64),
    new THREE.MeshBasicMaterial({ map: roadTex, alphaMap: roadFade, transparent: true, opacity: 0, depthWrite: false })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.001;
  road.renderOrder = 1;
  road.visible = false;
  group.add(road);

  /* ---------------- SPEED STREAKS (one draw call) ---------------- */
  const streakMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const streaks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.022, 0.022, 1), streakMat, streakCount);
  streaks.visible = false;
  streaks.frustumCulled = false;
  const streakData = [];
  for (let i = 0; i < streakCount; i++) {
    let x, y;
    do {
      x = (Math.random() - 0.5) * 14;
      y = 0.05 + Math.random() * 3;
    } while (Math.abs(x) < 1.7 && y < 1.6); // keep them out of the car body
    streakData.push({ x, y, z: (Math.random() - 0.5) * 60, speed: 0.7 + Math.random() * 0.6 });
  }
  group.add(streaks);
  const dummy = new THREE.Object3D();

  /* ---------------- PER-FRAME UPDATE ---------------- */
  const toCam = new THREE.Vector3();
  let travel = 0;

  return {
    // Every canvas texture, so main.js can upload them to the GPU behind the loader
    textures: [glowTex, beamTex, roadTex, roadFade],
    /**
     * @param dt       seconds since last frame
     * @param camera   the camera (to hide light glows seen from behind)
     * @param lights   0..1 headlight/taillight intensity
     * @param speed    0..1 launch speed (0 = parked)
     * @param brake    0..1.6 brake lights (above 1 = the short flare when braking starts)
     */
    update(dt, camera, lights, speed, brake = 0) {
      // Glows fade out when you look at the light from behind (dot product test)
      for (const s of glows) {
        toCam.copy(camera.position).sub(s.position).normalize();
        const facing = THREE.MathUtils.smoothstep(toCam.dot(s.userData.forward), -0.1, 0.45);
        const power = s.userData.tail ? Math.max(lights, Math.min(1, brake)) : lights;
        s.material.opacity = power * facing;
        s.visible = s.material.opacity > 0.01;
        if (s.userData.tail) s.scale.setScalar(0.55 * (1 + brake * 0.6)); // brake flare = bigger glow
      }
      beamMat.opacity = lights * (0.02 + speed * 0.3);
      beams.forEach((b) => (b.visible = beamMat.opacity > 0.01));
      if (spill) {
        spill.material.opacity = Math.min(1, brake) * 0.35;
        spill.visible = spill.material.opacity > 0.01;
      }

      // Road + streaks only exist during the launch sequence
      const active = speed > 0.002 && !reducedMotion;
      road.visible = streaks.visible = active;
      if (!active) return false;

      const worldSpeed = 4 + speed * 70; // metres per second the world moves past the car
      travel += worldSpeed * dt;
      roadTex.offset.y = (travel / 8) % 1; // texture repeats every 8 m
      road.material.opacity = Math.min(1, speed * 6);

      streakMat.opacity = Math.min(0.75, speed * 1.4);
      const stretch = 0.4 + speed * 5;
      for (let i = 0; i < streakData.length; i++) {
        const d = streakData[i];
        d.z += worldSpeed * d.speed * dt;
        if (d.z > 30) d.z -= 60; // wrap around behind the camera
        dummy.position.set(d.x, d.y, d.z);
        dummy.scale.set(1, 1, stretch);
        dummy.updateMatrix();
        streaks.setMatrixAt(i, dummy.matrix);
      }
      streaks.instanceMatrix.needsUpdate = true;
      return true; // still animating → keep rendering
    },
    get travel() {
      return travel;
    },
  };
}

/* WHEEL MOTION BLUR: real cameras smear fast spokes into a disc. At high spin we fade in a
   pre-blurred disc over each wheel and hide the sharp rims. Drawn once on a canvas. */
export function createWheelBlur(model) {
  const texture = canvasTexture([256, 256], (ctx, w) => {
    const c = w / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(200,200,206,0)');
    g.addColorStop(0.3, 'rgba(200,200,206,0)'); // clear hub: the real centre cap and nuts (r ≈ 0.077 m) show
    g.addColorStop(0.34, 'rgba(190,190,196,0.9)'); // spoke roots
    g.addColorStop(0.6, 'rgba(150,150,156,0.85)'); // smeared spokes (opaque enough to hide the barrel's spokes)
    g.addColorStop(0.84, 'rgba(205,205,210,0.9)');
    g.addColorStop(0.88, 'rgba(245,245,250,1)'); // rim lip
    g.addColorStop(0.97, 'rgba(120,120,126,1)');
    g.addColorStop(1, 'rgba(120,120,126,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
    for (let i = 0; i < 16; i++) {
      // faint rings so it reads as motion, not a flat plate
      ctx.strokeStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.07})`;
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath();
      ctx.arc(c, c, c * (0.36 + Math.random() * 0.46), 0, Math.PI * 2);
      ctx.stroke();
    }
  });
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    metalness: 1,
    roughness: 0.35,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const geometry = new THREE.CircleGeometry(model.userData.rimRadius ?? 0.28, 48); // the car's rim radius
  const rims = [];
  const discs = [];
  ['fl', 'fr', 'rl', 'rr'].forEach((id) => {
    const rim = model.getObjectByName(`rim_${id}`);
    const side = Math.sign(rim.position.x); // rims sit on the outer side; a wheel's local x is its axle
    const disc = new THREE.Mesh(geometry, material);
    disc.name = 'rim_blur';
    // just outside the spoke face (half-thickness 0.016 m) and the barrel's outer face
    disc.position.set(rim.position.x + side * 0.02, rim.position.y, rim.position.z);
    disc.rotation.y = (side * Math.PI) / 2; // a circle faces +z: turn it to face out along the axle
    disc.visible = false;
    rim.parent.add(disc); // child of wheel_*: spins and moves with it
    rims.push(rim);
    discs.push(disc);
  });
  let shown = -1; // the last amount applied (set() is called every frame)
  return {
    texture,
    // 0 = sharp spokes, 1 = full blur
    set(amount) {
      if (amount === shown) return; // nothing changed: no work, no garbage
      shown = amount;
      material.opacity = amount;
      const blurred = amount > 0.01;
      const sharp = amount < 0.95;
      for (const d of discs) d.visible = blurred;
      for (const r of rims) r.visible = sharp;
    },
  };
}

/* --------------------------------------------------------------------------
   CONTACT SHADOW: a soft dark patch under the car, drawn once on a canvas.
   Real-time shadows would cost a whole extra render; this costs nothing.
   -------------------------------------------------------------------------- */
export function createContactShadow(width = 2.5, length = 5.0) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.filter = 'blur(28px)'; // soft edges
  ctx.fillStyle = '#fff'; // white = dark shadow (this is an alpha map)
  ctx.beginPath();
  ctx.roundRect(52, 60, c.width - 104, c.height - 120, 70); // the car's footprint
  ctx.fill();
  ctx.filter = 'blur(10px)';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  for (const [x, y] of [[62, 150], [194, 150], [62, 372], [194, 372]]) {
    ctx.beginPath(); // darker spots where the tyres touch the ground
    ctx.ellipse(x, y, 20, 40, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const alphaMap = new THREE.CanvasTexture(c);
  alphaMap.colorSpace = THREE.NoColorSpace;
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(width, length),
    new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap, transparent: true, opacity: 0.85, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.002;
  shadow.renderOrder = 2;
  shadow.name = 'contact_shadow';
  return shadow;
}
