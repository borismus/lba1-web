// The list of known mods the page shows: this repo's mods (mods/*/mod.json,
// served next to the page as mods/<id>.zip) and the ones listed in
// mods/catalog.json (anyone's: a zip at a URL that allows downloads from
// other pages, CORS). Writes <out>/index.json.
//   node catalog.mjs <mods dir> <out dir>
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [dir, out] = process.argv.slice(2);
const pick = (m, url) => ({ id: m.id, name: m.name || m.id, version: m.version || '', description: m.description || '',
  authors: [].concat(m.authors || []), url });
const list = [];
for (const d of readdirSync(dir).sort()) {
  const f = join(dir, d, 'mod.json');
  if (existsSync(f)) list.push(pick(JSON.parse(readFileSync(f, 'utf8')), `mods/${d}.zip`));
}
const extra = JSON.parse(readFileSync(join(dir, 'catalog.json'), 'utf8'));
for (const [i, m] of extra.entries()) {
  if (!m.name || !/^https:\/\//.test(m.url || '')) throw new Error(`mods/catalog.json, entry ${i + 1}: needs a name and an https url`);
  list.push({ ...pick(m, m.url), homepage: m.homepage || '' });
}
writeFileSync(join(out, 'index.json'), JSON.stringify(list, null, 1) + '\n');
console.log(`known mods: ${list.map(m => m.name).join(', ')}`);
