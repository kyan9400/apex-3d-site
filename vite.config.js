import { defineConfig } from 'vite';

// base './' = relative paths, so the built site works from any folder or sub-path
export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 1000,
    // The CSS minifier deletes "old browser" fallbacks (height: 100% next to 100lvh) and rewrites
    // media queries in a newer syntax, unless it knows older browsers must work. three.js itself
    // needs Chrome/Edge 94, Firefox 93 or Safari 16.4, so the CSS is built for the same browsers.
    cssTarget: ['chrome94', 'edge94', 'firefox93', 'safari16.4', 'ios16.4'],
  },
});
