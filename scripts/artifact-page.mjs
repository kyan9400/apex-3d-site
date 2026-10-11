// Turns dist/index.html into dist/apex-motors.html for publishing as a Claude artifact:
// the artifact host adds its own <html>/<head>/<body>, so we strip ours, put <title> first
// and keep the inline <style> (the build already put the CSS into index.html, see vite.config.js).
// Run after `npm run build` (or use `npm run build:artifact`, which does both;
// `vite build` empties dist/, so this script must run again after every build).
// Every dist/assets/*.js chunk must be published with the page: page.js, scene.js and the car
// variants are separate chunks the browser loads on demand. The self-hosted fonts
// (dist/fonts/*.woff2) must be published too. index.html must keep a bare <body>.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
let html = readFileSync(new URL('index.html', dist), 'utf8');

// The entry script is the one the built page loads (other index-*.js chunks could exist)
const jsFile = html.match(/<script type="module"[^>]*src="\.\/assets\/([^"]+)"/)[1];
// The inlined CSS lives in <head>: copy the whole <style> tag as it is
const style = html.match(/<style>[\s\S]*?<\/style>/)[0];
// The headline font preload (optional: keep it if it is there)
const fontPreload = html.match(/<link rel="preload"[^>]*as="font"[^>]*>/)?.[0] ?? '';

const body = html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script type="module"[^>]*><\/script>/, '');

const page = `<title>Apex Motors</title>
${fontPreload}
${style}
${body.trim()}
<script type="module" src="./assets/${jsFile}"></script>
`;

writeFileSync(new URL('apex-motors.html', dist), page);

console.log(`dist/apex-motors.html  (script: assets/${jsFile})`);

// The lazy chunks and the fonts 404 unless they are uploaded too
const chunks = readdirSync(new URL('assets/', dist)).filter((f) => f.endsWith('.js')).map((f) => `assets/${f}`);
const fonts = readdirSync(new URL('fonts/', dist)).filter((f) => f.endsWith('.woff2')).map((f) => `fonts/${f}`);
console.log(`publish these files alongside: ${[...chunks, ...fonts].join(', ')}`);
