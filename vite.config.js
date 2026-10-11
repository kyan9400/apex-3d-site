import { defineConfig } from 'vite';

// Puts the built CSS straight into index.html as a <style> tag, so the browser
// does not wait for a separate stylesheet before the first paint (build only).
const inlineCss = {
  name: 'inline-css',
  apply: 'build', // only for `npm run build`, not the dev server
  enforce: 'post', // after Vite has written its own HTML and CSS
  generateBundle(_options, bundle) {
    // the page and its one stylesheet
    const html = Object.values(bundle).find((f) => f.fileName === 'index.html');
    const css = Object.values(bundle).filter((f) => f.fileName.endsWith('.css'));
    if (!html || css.length !== 1) return; // nothing to do (or more than one file: leave them alone)
    // the CSS lived in assets/, the page lives one folder up: ../poster.webp becomes ./poster.webp
    const code = String(css[0].source).replace(/url\(\.\.\//g, 'url(./');
    // swap the <link rel="stylesheet"> for the CSS itself
    html.source = String(html.source).replace(/<link rel="stylesheet"[^>]*>/, () => `<style>${code}</style>`);
    // the separate .css file is no longer needed
    delete bundle[css[0].fileName];
  },
};

// base './' = relative paths, so the built site works from any folder or sub-path
export default defineConfig({
  base: './',
  plugins: [inlineCss],
  build: {
    chunkSizeWarningLimit: 1000,
    // The CSS minifier deletes "old browser" fallbacks (height: 100% next to 100lvh) and rewrites
    // media queries in a newer syntax, unless it knows older browsers must work. three.js itself
    // needs Chrome/Edge 94, Firefox 93 or Safari 16.4, so the CSS is built for the same browsers.
    cssTarget: ['chrome94', 'edge94', 'firefox93', 'safari16.4', 'ios16.4'],
    rolldownOptions: {
      output: {
        // The animation code both layers share (GSAP, Lenis, ui.js, motion.js) goes in one chunk
        // named "ui", so the network panel says what it is (left alone it was named after models.js)
        codeSplitting: {
          groups: [{ name: 'ui', test: /node_modules[\\/](gsap|lenis)[\\/]|src[\\/](ui|motion)\.js$/ }],
        },
      },
    },
  },
});
