// mod check (docs/MODS.md): does a mod package contain original game data?
//
// The base's files (raw and, for HQR archives, every entry decompressed) are
// cut into 64-byte windows at every STEP-th byte; every offset of every mod
// file is looked up among them, so any run of at least 64 + STEP - 1 bytes
// that a mod shares with the game is caught. Runs of one repeated byte
// (silence, padding) don't count: everything has them. Windows are found by
// a rolling hash, then compared byte for byte.
import type { Bytes } from './bytes.ts';
import * as hqr from './hqr.ts';
import type { Files } from './build.ts';

const W = 64, STEP = 32;
const P = 0x01000193;  // the rolling hash's multiplier (odd)
let PW = 1;            // P^W, mod 2^32
for (let i = 0; i < W; i++) PW = Math.imul(PW, P);

const boring = (b: Bytes, o: number): boolean => { const v = b[o]; for (let i = 1; i < W; i++) if (b[o + i] !== v) return false; return true; };

// hashes of the windows starting at every offset (each() gets offset, hash)
function roll(b: Bytes, each: (o: number, h: number) => void): void {
  if (b.length < W) return;
  let h = 0;
  for (let i = 0; i < W; i++) h = (Math.imul(h, P) + b[i]) | 0;
  each(0, h >>> 0);
  for (let o = 1; o + W <= b.length; o++) {
    h = (Math.imul(h, P) - Math.imul(b[o - 1], PW) + b[o + W - 1]) | 0;
    each(o, h >>> 0);
  }
}

export interface Hit { file: string; at: number; base: string; baseAt: number }

const GAME = /\.(hqr|vox|lst)$/i;

export function check(game: Files, mod: Files): Hit[] {
  const blobs: Bytes[] = [], names: string[] = [];
  for (const [name, b] of game) {
    if (!GAME.test(name)) continue;
    blobs.push(b); names.push(name);
    if (/\.hqr$/i.test(name)) {
      try { hqr.read(b).forEach((e, i) => { if (e) { blobs.push(e); names.push(`${name}[${i}]`); } }); } catch { /* not an archive after all */ }
    }
  }
  // the windows, sorted by hash: parallel arrays (hash, blob, offset)
  let n = 0;
  for (const b of blobs) n += b.length >= W ? Math.floor((b.length - W) / STEP) + 1 : 0;
  const hs = new Uint32Array(n), bs = new Uint32Array(n), os = new Uint32Array(n);
  let k = 0;
  blobs.forEach((b, bi) => roll(b, (o, h) => {
    if (o % STEP || boring(b, o)) return;
    hs[k] = h; bs[k] = bi; os[k] = o; k++;
  }));
  const order = new Uint32Array(k).map((_, i) => i).sort((a, b) => hs[a] - hs[b]);
  const H = order.map(i => hs[i]), Bi = order.map(i => bs[i]), Oi = order.map(i => os[i]);
  const find = (h: number): number => {  // first index with H[i] >= h
    let lo = 0, hi = H.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (H[mid] < h) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const hits: Hit[] = [];
  for (const [file, b] of mod) {
    let skipTo = 0;
    roll(b, (o, h) => {
      if (o < skipTo) return;
      for (let i = find(h); i < H.length && H[i] === h; i++) {
        const base = blobs[Bi[i]], bo = Oi[i];
        let same = true;
        for (let j = 0; j < W; j++) if (base[bo + j] !== b[o + j]) { same = false; break; }
        if (same && !boring(b, o)) { hits.push({ file, at: o, base: names[Bi[i]], baseAt: bo }); skipTo = o + W; return; }
      }
    });
  }
  return hits;
}
