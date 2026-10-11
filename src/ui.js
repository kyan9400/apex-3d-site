/* ==========================================================================
   UI MOTION — the 2D layer on top of the 3D scene
   Everything here animates only `transform` and `opacity`, the two CSS
   properties the browser can animate on the GPU without re-laying out the page.
   ========================================================================== */
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/* --------------------------------------------------------------------------
   SPLIT TEXT: wrap each word of [data-split] headings in two spans so the
   inner span can slide up from behind a mask (the outer span clips it).
   Screen readers and page translation read a plain copy of the heading
   (.sr-only); the animated words are hidden from them.
   -------------------------------------------------------------------------- */
const escapeHTML = (text) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function splitHeadings(reducedMotion) {
  document.querySelectorAll('[data-split]').forEach((el) => {
    // <br> has no text, so count it as a space ("Sculpted by air." not "Sculptedby air.")
    const label = [...el.childNodes]
      .map((n) => (n.nodeName === 'BR' ? ' ' : n.textContent))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    const parts = [];
    el.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        node.textContent
          .split(/(\s+)/)
          .filter(Boolean)
          .forEach((w) => parts.push(/\s+/.test(w) ? ' ' : `<span class="word"><span class="word__inner">${escapeHTML(w)}</span></span>`));
      } else parts.push(node.outerHTML); // keeps <br> and accent spans
    });
    el.innerHTML = `<span class="sr-only">${escapeHTML(label)}</span><span aria-hidden="true">${parts.join('')}</span>`;
    if (reducedMotion) return;
    gsap.from(el.querySelectorAll('.word__inner'), {
      yPercent: 125, // fully below the mask (it reaches 0.18em under the line for descenders)
      rotate: 4,
      duration: 1.1,
      ease: 'power4.out',
      stagger: 0.06,
      scrollTrigger: { trigger: el, start: 'top 85%', once: true },
    });
  });
}

/* --------------------------------------------------------------------------
   HERO: the intro is ONE paused timeline that scene.js plays when the loader
   lifts, in sync with the headlights. fromTo() applies the hidden states right
   now, while the curtain is down (style.css keeps them invisible until then too,
   so nothing can flash). The h1 itself is never hidden: it is the LCP. Scrolling
   away then lifts and fades the hero text (scrubbed = it rewinds on the way back).
   Rule: an element is animated EITHER by the intro OR by the scroll, never both.
   -------------------------------------------------------------------------- */
// "control." in its lit colour, as an rgb() value GSAP can tween: --accent-hi mixed with
// 20% white, the same as .accent-text in style.css (plain --accent-hi where color-mix() is missing)
function litAccentColor() {
  const hex = getComputedStyle(document.documentElement).getPropertyValue('--accent-hi').trim() || '#b3121f';
  const white = CSS.supports('color', 'color-mix(in srgb, red, red)') ? 0.2 : 0;
  const [r, g, b] = [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - white) + 255 * white));
  return `rgb(${r}, ${g}, ${b})`;
}

export function heroMotion(reducedMotion) {
  if (reducedMotion) return { play() {} }; // calm mode: everything is simply there

  const intro = gsap.timeline({ paused: true, defaults: { ease: 'power3.out' } });
  intro
    .fromTo('#hero .eyebrow', { y: 20, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.9 }, 0)
    // The h1 is never hidden or clipped: it is the page's LCP element and shows from the first paint.
    // Only its colour settles: "control." lights up with the headlights. The CSS transition is off while
    // GSAP drives the colour, and clearProps hands it back to CSS (which follows the chosen paint).
    .fromTo(
      '.hero__title .accent-text',
      { color: '#f2f1ee', transition: 'none' },
      { color: litAccentColor, duration: 1.2, ease: 'power2.out', clearProps: 'color,transition' },
      0.3
    )
    .fromTo('.hero__sub', { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 1 }, 0.55)
    .fromTo('.hero__actions, .hero__meta', { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 1, stagger: 0.1 }, 0.7)
    // then the interface 'powers on': nav slides down, dots pop in, scroll hint last.
    // clearProps hands these elements back to CSS (and to later tweens) when done.
    .fromTo(
      '.nav',
      { yPercent: -100, autoAlpha: 0 },
      { yPercent: 0, autoAlpha: 1, duration: 1, clearProps: 'transform,opacity,visibility' },
      0.75
    )
    .fromTo(
      '.dots a',
      { x: 14, autoAlpha: 0 },
      { x: 0, autoAlpha: 1, duration: 0.6, stagger: 0.05, clearProps: 'transform,opacity,visibility' },
      0.9
    )
    .fromTo('.scroll-hint', { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.8 }, 1.25);

  // A focused hero button must never stay invisible (e.g. Tab before the intro has finished)
  document.querySelectorAll('.hero__actions, .hero__meta').forEach((el) =>
    el.addEventListener('focusin', () => gsap.set(el, { y: 0, autoAlpha: 1 }))
  );

  // Scroll-out animates the PARENT .hero__inner, so it never fights the intro (which animates the children)
  gsap.fromTo(
    '.hero__inner',
    { yPercent: 0, opacity: 1 },
    {
      yPercent: -30,
      opacity: 0, // not autoAlpha: visibility:hidden would hide the page's h1 from screen readers and find-in-page
      ease: 'none',
      immediateRender: false,
      scrollTrigger: { trigger: '#hero', start: 'top top', end: 'bottom 30%', scrub: true },
    }
  );
  return intro;
}

/* --------------------------------------------------------------------------
   SCROLL PROGRESS BAR + SECTION DOTS
   -------------------------------------------------------------------------- */
export function progressUI() {
  // The looping scroll hint pauses once the hero is gone: no endless compositor work
  const hint = document.querySelector('.scroll-hint span');
  if (hint)
    ScrollTrigger.create({
      trigger: '#hero',
      start: 'bottom top',
      onEnter: () => (hint.style.animationPlayState = 'paused'),
      onLeaveBack: () => (hint.style.animationPlayState = 'running'),
    });

  const bar = document.querySelector('.progress span');
  const setBar = gsap.quickSetter(bar, 'scaleX');
  ScrollTrigger.create({
    trigger: document.documentElement,
    start: 0,
    end: 'max',
    onUpdate: (self) => setBar(self.progress),
  });

  const dots = document.querySelectorAll('.dots a');
  dots.forEach((dot) => {
    const section = document.querySelector(dot.getAttribute('href'));
    ScrollTrigger.create({
      trigger: section,
      start: 'top 55%',
      end: 'bottom 55%',
      onToggle: ({ isActive }) => {
        if (!isActive) return;
        dots.forEach((d) => d.removeAttribute('aria-current'));
        dot.setAttribute('aria-current', 'true');
        // the header link of the same section is marked too (underline in style.css)
        document.querySelectorAll('.nav__links a').forEach((a) => a.toggleAttribute('aria-current', a.getAttribute('href') === dot.getAttribute('href')));
      },
    });
  });
}

/* --------------------------------------------------------------------------
   GIANT OUTLINED WORD behind the car, drifting sideways with scroll
   -------------------------------------------------------------------------- */
export function backgroundWord(reducedMotion) {
  if (reducedMotion) return;
  gsap.fromTo(
    '.bg-word span',
    { xPercent: 8 },
    { xPercent: -42, ease: 'none', scrollTrigger: { trigger: document.documentElement, start: 0, end: 'max', scrub: true } }
  );
}

/* --------------------------------------------------------------------------
   CUSTOM CURSOR + MAGNETIC BUTTONS (mouse users only)
   -------------------------------------------------------------------------- */
export function cursorAndMagnets(reducedMotion) {
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (!finePointer || reducedMotion) return;

  const cursor = document.querySelector('.cursor');
  const label = cursor.querySelector('.cursor__label');
  document.documentElement.classList.add('has-cursor');
  // quickTo = a tween you can retarget every mousemove without creating new tweens
  const x = gsap.quickTo(cursor, 'x', { duration: 0.35, ease: 'power3' });
  const y = gsap.quickTo(cursor, 'y', { duration: 0.35, ease: 'power3' });
  window.addEventListener('pointermove', (e) => {
    x(e.clientX);
    y(e.clientY);
  });
  let hoverTarget = null;
  document.addEventListener('pointerover', (e) => {
    const target = e.target.closest('a, button, [data-cursor]');
    if (target === hoverTarget) return; // same element: nothing to change
    hoverTarget = target;
    cursor.classList.toggle('is-hover', !!target);
    label.textContent = target?.dataset.cursor || '';
  });
  document.addEventListener('pointerleave', () => cursor.classList.add('is-hidden'));
  document.addEventListener('pointerenter', () => cursor.classList.remove('is-hidden'));

  // Buttons lean towards the pointer, then spring back
  document.querySelectorAll('.btn').forEach((btn) => {
    const bx = gsap.quickTo(btn, 'x', { duration: 0.4, ease: 'power3' });
    const by = gsap.quickTo(btn, 'y', { duration: 0.4, ease: 'power3' });
    btn.addEventListener('pointermove', (e) => {
      const r = btn.getBoundingClientRect();
      bx((e.clientX - (r.left + r.width / 2)) * 0.3);
      by((e.clientY - (r.top + r.height / 2)) * 0.4);
    });
    btn.addEventListener('pointerleave', () => {
      bx(0);
      by(0);
    });
  });
}

/* --------------------------------------------------------------------------
   FILM GRAIN: one tiny noise tile, tiled by CSS. Static = costs nothing per frame.
   -------------------------------------------------------------------------- */
export function filmGrain(enabled) {
  if (!enabled) return;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const grain = document.createElement('div');
  grain.className = 'grain';
  grain.style.backgroundImage = `url(${c.toDataURL()})`;
  document.body.appendChild(grain);
}

/* --------------------------------------------------------------------------
   RESERVE DIALOG: an honest note (the car is a design study, so there is
   nothing to reserve) and a way to the configurator. No form, no personal data.
   A native <dialog>: showModal() traps focus, Esc closes it, focus returns.
   -------------------------------------------------------------------------- */
export function reserveDialog({ onOpen, onClose } = {}) {
  const open = document.getElementById('reserve-open');
  const dlg = document.getElementById('reserve-dialog');
  if (!open || !dlg) return;
  open.addEventListener('click', () => {
    dlg.showModal();
    onOpen?.();
  });
  // The Close button and the "Configure yours" link both close it. onClose runs right away
  // (the 'close' event comes a moment later), so smooth scrolling is back on before the link scrolls.
  dlg.querySelectorAll('[data-close], a').forEach((el) =>
    el.addEventListener('click', () => {
      dlg.close();
      onClose?.();
    })
  );
  dlg.addEventListener('close', () => onClose?.()); // Esc closes it too
}
