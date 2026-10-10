/* Entry point. The loader is plain HTML + CSS; let the browser paint it before the big
   animation/3D bundle (main.js) is parsed and run, so the first screen appears straight away. */
requestAnimationFrame(() => setTimeout(() => import('./main.js'), 0));
