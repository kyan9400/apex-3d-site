// Turns dist/index.html into dist/apex-motors.html for publishing as a Claude artifact:
// the artifact host adds its own <html>/<head>/<body>, so we strip ours, put <title> first
// and inline the CSS. Run after `npm run build`.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
let html = readFileSync(new URL('index.html', dist), 'utf8');

const cssFile = readdirSync(new URL('assets/', dist)).find((f) => /^index-.*\.css$/.test(f));
const jsFile = readdirSync(new URL('assets/', dist)).find((f) => /^index-.*\.js$/.test(f));
const css = readFileSync(new URL(`assets/${cssFile}`, dist), 'utf8');

const fonts = html.match(/<link\s+href="https:\/\/fonts\.googleapis\.com[^>]*>/s)[0];
const body = html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script type="module"[^>]*><\/script>/, '');

const page = `<title>Apex Motors</title>
${fonts}
<style>
${css}
</style>
${body.trim()}
<script type="module" src="./assets/${jsFile}"></script>
`;

writeFileSync(new URL('apex-motors.html', dist), page);

// Artifacts don't serve .glb files, so ship the model as base64 inside a .json file
// (main.js decodes it: see loadGltf)
const glb = readFileSync(new URL('models/ferrari.glb', dist));
writeFileSync(new URL('models/ferrari.glb.json', dist), JSON.stringify({ glb: glb.toString('base64') }));
console.log(`dist/apex-motors.html  (script: assets/${jsFile})`);
