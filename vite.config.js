import { defineConfig } from 'vite';

// base './' = relative paths, so the built site works from any folder or sub-path
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1000 },
});
