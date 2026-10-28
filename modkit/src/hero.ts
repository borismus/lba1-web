// Play as another character: a copy of the hero's five behaviour models
// (FILE3D.HQR 0-4: normal, athletic, aggressive, discreet, protopack) with
// the bodies swapped and every animation remapped to the new skeleton.
//
// LBA animations store, per frame, one (type, alpha, beta, gamma) record per
// bone, in the body's bone order (P_ANIM.C copies them over the body's bone
// records). The hero's bodies all share one 19-bone layout; another body
// plays them only if its bones come in the same order, so each animation is
// rewritten with one record per target bone, taken from the hero bone in
// `bones` (null: the bone stays at rest).
//
// Outfits: the hero's body slots normally all get the character's body;
// `outfits` gives some slots a recoloured copy (colours old -> new, dim
// colour -> factor). Voice: the hero's animations play sounds; `voice` maps
// the hero's voice samples to the character's: a sample number plays that
// one instead, a pitch (a non-integer) a copy of the hero's own pitched up
// that much (appended to SAMPLES.HQR).
import { type Bytes, u16, put16, Buf } from './bytes.ts';
import * as body from './body.ts';

const HERO_MODELS = [0, 1, 2, 3, 4];
const CMD_BODY = 1, CMD_ANIM = 3, CMD_END = 255;
// anim actions: bytes after the type byte (FICHE.C GereAnimAction)
const ACTION_SIZE: Record<number, number> = { 5: 2, 6: 3, 7: 5, 8: 12, 9: 8, 10: 5, 11: 8, 12: 12, 13: 3, 15: 1, 16: 1, 17: 1, 18: 16, 19: 16, 20: 12, 21: 12 };
const ACTION_SAMPLES = new Set([6, 7, 10]);  // sample, sample_rnd, sample_repeat: frame, sample

export interface Outfit { colours: Map<number, number>; dim: Map<number, number> }
export interface Hero {
  body: number;
  bones: (number | null)[];
  outfits?: Map<number, Outfit>;
  voice?: Map<number, number | { pitch: number }>;
}

// Python's round(): halves to the nearest even integer
export function pyRound(x: number): number {
  const f = Math.floor(x), d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

// An ANIM.HQR entry rewritten for a body whose bone i plays the hero's bone
// bones[i]. Layout: frames, groups, loop frame, 2 bytes; then per frame 8
// bytes (time, step x/y/z) and 8 bytes per group.
export function remapAnim(anim: Bytes, bones: (number | null)[]): Bytes {
  const frames = u16(anim, 0), groups = u16(anim, 2), loop = u16(anim, 4), pad = u16(anim, 6);
  const stride = 8 + groups * 8;
  const out = new Buf().w16(frames).w16(bones.length).w16(loop).w16(pad);
  const rest = new Uint8Array(8);  // rotation group, all angles 0: the body's own pose
  for (let f = 0; f < frames; f++) {
    const fr = 8 + f * stride;
    out.add(anim.subarray(fr, fr + 8));
    for (const src of bones) out.add(src === null || src >= groups ? rest : anim.subarray(fr + 8 + src * 8, fr + 16 + src * 8));
  }
  out.add(anim.subarray(8 + frames * stride));
  return out.bytes();
}

// A Creative Voice File (SAMPLES.HQR entry) played `factor` times faster:
// each sound block's rate byte (rate = 1000000 / (256 - byte)) set for the
// higher rate.
export function pitched(voc: Bytes, factor: number): Bytes {
  const out = voc.slice();
  let o = u16(voc, 20);
  while (o < out.length && out[o] !== 0) {
    const n = out[o + 1] | (out[o + 2] << 8) | (out[o + 3] << 16);
    if (out[o] === 1) {
      const rate = 1000000 / (256 - out[o + 4]) * factor;
      out[o + 4] = Math.min(255, pyRound(256 - 1000000 / rate));
    }
    o += 4 + n;
  }
  return out;
}

// Change the samples of the anim command at o (FILE3D model p)
function revoice(p: Bytes, o: number, voice: Map<number, number>): void {
  let a = o + 5;
  if (!p[a]) return;
  const nb = p[a++];
  for (let i = 0; i < nb; i++) {
    const kind = p[a];
    if (ACTION_SAMPLES.has(kind)) {
      const sample = u16(p, a + 2);
      if (voice.has(sample)) put16(p, a + 2, voice.get(sample)!);
    }
    a += 1 + ACTION_SIZE[kind];
  }
}

// Append the hero's five models, with h's body, remapped animations and
// voice, to F3D, ANIM, BODY and SAMPLES. -> FILE3D index of the new 'normal'
// model; the other four follow it.
export function addHero(h: Hero, F3D: (Bytes | null)[], ANIM: (Bytes | null)[], BODY: (Bytes | null)[], SAMPLES: (Bytes | null)[]): number {
  const voice = new Map<number, number>();
  for (const [old, nw] of h.voice ?? []) {
    if (typeof nw === 'object') { SAMPLES.push(pitched(SAMPLES[old]!, nw.pitch)); voice.set(old, SAMPLES.length - 1); }
    else voice.set(old, nw);
  }
  const outfit = new Map<number, number>();
  for (const [slot, o] of h.outfits ?? []) {
    let b = body.recolor(BODY[h.body]!, o.colours);
    for (const [colour, factor] of o.dim) b = body.dim(b, colour, factor);
    outfit.set(slot, BODY.length);
    BODY.push(b);
  }
  const remapped = new Map<number, number>();  // hero ANIM index -> new ANIM index
  const base = F3D.length;
  for (const m of HERO_MODELS) {
    const p = F3D[m]!.slice();
    let o = 0;
    while (p[o] !== CMD_END) {
      const cmd = p[o], size = p[o + 2];
      const idx = u16(p, o + 3);
      if (cmd === CMD_BODY) put16(p, o + 3, outfit.get(p[o + 1]) ?? h.body);
      else if (cmd === CMD_ANIM) {
        if (!remapped.has(idx)) { remapped.set(idx, ANIM.length); ANIM.push(remapAnim(ANIM[idx]!, h.bones)); }
        put16(p, o + 3, remapped.get(idx)!);
        revoice(p, o, voice);
      }
      o += 2 + size;
    }
    F3D.push(p);
  }
  return base;
}
