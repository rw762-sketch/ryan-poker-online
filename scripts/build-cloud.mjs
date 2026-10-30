import { build } from 'esbuild';
import { readFile, writeFile, mkdir, readdir, cp } from 'node:fs/promises';
const types = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8' };
const assets = {};
for (const entry of await readdir('.')) {
  if (!/\.(html|css|js)$/.test(entry)) continue;
  assets['/' + entry] = { type: types[entry.split('.').pop()], content: await readFile('./' + entry, 'utf8') };
}
// Fonts are self-hosted (Google Fonts is blocked in some regions); embed them as base64.
for (const entry of await readdir('fonts')) {
  if (entry.endsWith('.woff2')) assets['/fonts/' + entry] = { type: 'font/woff2', base64: (await readFile('fonts/' + entry)).toString('base64') };
}
for (const entry of await readdir('vendor')) {
  assets['/vendor/' + entry] = { type: entry.endsWith('.js') ? types.js : 'text/plain', content: await readFile('vendor/' + entry, 'utf8') };
}
await writeFile('server/assets.generated.mjs', 'export default ' + JSON.stringify(assets) + ';\n');
await mkdir('dist/server', { recursive: true });
await build({ entryPoints: ['server/cloud-worker.mjs'], outfile: 'dist/server/index.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true });
await mkdir('dist/.openai', { recursive: true });
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
await cp('drizzle', 'dist/.openai/drizzle', { recursive: true });
console.log('Built shared multiplayer Worker and embedded public pages.');
