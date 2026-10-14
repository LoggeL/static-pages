#!/usr/bin/env node
// Native import maps keep cached modules current without bundling the demo.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../../public/bodycam-demo/', import.meta.url));
async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await files(name));
    else if (entry.name.endsWith('.js')) result.push(name);
  }
  return result;
}
const htmlFile = path.join(root, 'index.html');
let html = await readFile(htmlFile, 'utf8');
const pattern = /(<script type="importmap">\s*)([\s\S]*?)(\s*<\/script>)/;
const match = html.match(pattern);
if (!match) throw new Error('Bodycam import map not found');
const map = JSON.parse(match[2]);
for (const key of Object.keys(map.imports)) if (key.startsWith('./js/')) delete map.imports[key];
for (const file of (await files(path.join(root, 'js'))).sort()) {
  const name = `./${path.relative(root, file).split(path.sep).join('/')}`;
  const hash = createHash('sha256').update(await readFile(file)).digest('hex').slice(0, 12);
  map.imports[name] = `${name}?v=${hash}`;
}
html = html.replace(pattern, (_, start, _json, end) => `${start}${JSON.stringify(map, null, 2).replaceAll('\n', '\n    ')}${end}`);
html = html.replace(/src="\.\/js\/main\.js(?:\?[^\"]*)?"/, `src="${map.imports['./js/main.js']}"`);
const cssHash = createHash('sha256').update(await readFile(path.join(root, 'styles.css'))).digest('hex').slice(0, 12);
html = html.replace(/href="\.\/styles\.css(?:\?[^\"]*)?"/, `href="./styles.css?v=${cssHash}"`);
await writeFile(htmlFile, html);
console.log(`Versioned ${Object.keys(map.imports).filter(key => key.startsWith('./js/')).length} native modules.`);
