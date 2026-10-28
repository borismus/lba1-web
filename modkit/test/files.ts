// Reading a game folder and a mod folder into Files (path -> bytes), as the
// page gives them to build(). Game paths are the names the build asks for
// (SCENE.HQR, VOX/EN_000.VOX); mod paths are the package's own.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Files } from '../src/build.ts';

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

export function gameFiles(dir: string): Files {
  const files: Files = new Map();
  for (const p of walk(dir)) {
    const r = relative(dir, p);
    if (/\.(hqr|vox)$/i.test(r)) files.set(r.toUpperCase(), readFileSync(p));
  }
  return files;
}

export function modFiles(dir: string): Files {
  const files: Files = new Map();
  for (const p of walk(dir)) files.set(relative(dir, p).split('\\').join('/'), readFileSync(p));
  return files;
}
