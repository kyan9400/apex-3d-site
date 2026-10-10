import { defineConfig } from 'vite';

// base './' = relative paths, so the built site works from any folder or sub-path
// boot.js imports main.js only after the first paint; these hints still start downloading the big
// chunks right away (modulepreload fetches without running), so real visitors don't wait longer
const preloadMainChunks = {
  name: 'preload-main-chunks',
  transformIndexHtml: {
    order: 'post',
    handler(html, ctx) {
      if (!ctx.bundle) return; // dev server: nothing to preload
      return Object.values(ctx.bundle)
        .filter((c) => c.type === 'chunk' && /^(main|three\.core)-/.test(c.fileName.split('/').pop()))
        .map((c) => ({ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: true, href: './' + c.fileName }, injectTo: 'head' }));
    },
  },
};

export default defineConfig({
  base: './',
  plugins: [preloadMainChunks],
  build: {
    chunkSizeWarningLimit: 1000,
    // The CSS minifier deletes "old browser" fallbacks (height: 100% next to 100lvh) and rewrites
    // media queries in a newer syntax, unless it knows older browsers must work. three.js itself
    // needs Chrome/Edge 94, Firefox 93 or Safari 16.4, so the CSS is built for the same browsers.
    cssTarget: ['chrome94', 'edge94', 'firefox93', 'safari16.4', 'ios16.4'],
  },
});
