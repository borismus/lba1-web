// The TypeScript builder against the Python reference: build a mod from the
// game folder and compare every file with the reference build's.
//   node test/same.ts <game's DOS data dir> <mod folder> <reference build dir>
import { readFileSync, existsSync } from 'node:fs';
import { build } from '../src/build.ts';
import { equal } from '../src/bytes.ts';
import { gameFiles, modFiles } from './files.ts';

const [data, modDir, ref] = process.argv.slice(2);
const t0 = performance.now();
const out = build(gameFiles(data), modFiles(modDir));
const ms = performance.now() - t0;
let bad = 0;
for (const [name, bytes] of out.files) {
  const p = ref + '/' + name;
  if (!existsSync(p)) { console.log(`${name}: not in the reference build`); bad++; continue; }
  const want = readFileSync(p);
  if (equal(bytes, want)) console.log(`${name}: identical (${bytes.length} bytes)`);
  else {
    let i = 0; while (i < bytes.length && bytes[i] === want[i]) i++;
    console.log(`${name}: DIFFERS at byte ${i} (${bytes.length} vs ${want.length} bytes)`); bad++;
  }
}
console.log(out.log.join('\n'));
console.log(`built in ${Math.round(ms)} ms; ${out.files.size - bad}/${out.files.size} files identical`);
process.exit(bad ? 1 : 0);
