/* Entry point: decides which layers to load.
   page.js  = the 2D page (headline, scrolling, buttons), small, loaded straight away
   scene.js = the 3D car (three.js), loaded only with a real GPU, after the page has loaded */
import { probeGPU, quality } from './quality.js';

// The 2D page first: small, and it runs right away (the headline, scrolling, buttons)
const page = import('./page.js');

// Last resort: if page.js itself fails to download (bad network, or an old cached index.html
// after a new deploy), lift the curtain with plain CSS classes so the page is not frozen
page.catch((e) => {
  console.error(e);
  document.body.classList.remove('is-loading');
  document.getElementById('loader')?.classList.add('is-done'); // style.css then shows the nav and hero buttons
  document.documentElement.classList.add('no-webgl'); // the poster instead of an empty canvas
});

// The 3D only with a real GPU, after window load + idle (rule: the headline paints first)
const gpu = probeGPU(); // checks for WebGL 2 and reads the GPU name, so the quality tier is final
if (!gpu || (quality.software && !quality.forced)) {
  document.documentElement.classList.add('no-webgl'); // the poster image starts downloading now
  // no GPU: a still of the car instead of a slideshow drawn by the CPU
  page.then((p) => (gpu ? p.showPoster() : p.showFatal('Your browser does not support WebGL 2, so the 3D car is hidden. The rest of the page still works.')));
} else {
  const go = () => {
    // Safety net: if the 3D download hangs (it never fails, it just never arrives), open the
    // page after 12 s anyway. The car still drives in if it arrives later (openPage runs once).
    const safety = setTimeout(() => page.then((p) => p.openPage()), 12000);
    return Promise.all([page, import('./scene.js')])
      // init() is async: returning its promise lets the .catch below see errors from any build step
      .then(([p, s]) => s.init(p))
      // e.g. the 3D file failed to download or the build failed: say so and open the page anyway
      .catch((e) => {
        console.error(e);
        page.then((p) => p.showFatal('The 3D view could not start on this device. The rest of the page still works.'));
      })
      .finally(() => clearTimeout(safety)); // init is done (or failed): the safety net is no longer needed
  };
  const idle = () => ('requestIdleCallback' in window ? requestIdleCallback(go, { timeout: 1500 }) : setTimeout(go, 200));
  if (document.readyState === 'complete') idle();
  else addEventListener('load', idle, { once: true });
}
