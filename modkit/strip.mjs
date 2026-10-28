// modkit's TypeScript as plain ES modules for the page: types stripped
// (Node's own stripTypeScriptTypes, no other tools), './x.ts' -> './x.js'.
//   node modkit/strip.mjs <out dir>
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = join(dirname(fileURLToPath(import.meta.url)), 'src');
const out = process.argv[2];
mkdirSync(out, { recursive: true });
for (const f of readdirSync(src).filter(f => f.endsWith('.ts'))) {
  const js = stripTypeScriptTypes(readFileSync(join(src, f), 'utf8'))
    .replace(/(from\s+['"]\.\/[^'"]+)\.ts(['"])/g, '$1.js$2');
  writeFileSync(join(out, f.replace(/\.ts$/, '.js')), js);
}
