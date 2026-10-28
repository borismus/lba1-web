// 3D bodies (BODY.HQR entries): find and change polygon colours.
//
// Layout (translate/p_ob_iso.c AffObjetIso, AnimNuage, RotateNuage):
// header (flags word, bounding box, then a word at 14: size of the info block
// that follows), points (count + 6 bytes each), for animated bodies the bones
// (count + 38 bytes each), normals (count + 8 bytes each), then polygons:
// a word (material in the low byte, point count in the high byte), the colour
// word, then per point:
//   material >= 9 (Gouraud): normal index + point offset (4 bytes)
//   material 7-8 (flat):     one normal index word, then point offsets (2 bytes)
//   otherwise:               point offsets (2 bytes)
// then lines and spheres (count + 8 bytes each: material/colour words, ...).
// A colour is a palette index; Gouraud and flat shading add a light level
// (0-15) to it, so a colour is the start of a 16-entry ramp.
import { type Bytes, u16, s16, put16, Buf, concat } from './bytes.ts';

const INFO_ANIM = 2;
const MAT_FLAT = 7, MAT_GOURAUD = 9;

const skipCounted = (d: Bytes, o: number, size: number) => o + 2 + u16(d, o) * size;

// -> [offset of the colour word, material, point indices] per polygon, and
// the offsets of the line and sphere colour words
export function polygons(d: Bytes): { polys: [number, number, number[]][]; others: number[]; end: number } {
  const flags = u16(d, 0);
  let o = u16(d, 14) + 16;
  o = skipCounted(d, o, 6);                       // points
  if (flags & INFO_ANIM) o = skipCounted(d, o, 38);  // bones
  o = skipCounted(d, o, 8);                       // normals
  const n = u16(d, o); o += 2;
  const polys: [number, number, number[]][] = [];
  for (let i = 0; i < n; i++) {
    const w0 = u16(d, o), mat = w0 & 0xff, npt = w0 >> 8, col = o + 2;
    const pts: number[] = [];
    if (mat >= MAT_GOURAUD) { o += 4; for (let k = 0; k < npt; k++) pts.push(Math.floor(u16(d, o + 4 * k + 2) / 6)); o += 4 * npt; }
    else if (mat >= MAT_FLAT) { o += 6; for (let k = 0; k < npt; k++) pts.push(Math.floor(u16(d, o + 2 * k) / 6)); o += 2 * npt; }
    else { o += 4; for (let k = 0; k < npt; k++) pts.push(Math.floor(u16(d, o + 2 * k) / 6)); o += 2 * npt; }
    polys.push([col, mat, pts]);
  }
  const others: number[] = [];
  for (let k = 0; k < 2; k++) {                   // lines, spheres
    const m = u16(d, o); o += 2;
    for (let i = 0; i < m; i++) others.push(o + 8 * i + 2);
    o += 8 * m;
  }
  return { polys, others, end: o };
}

// Body with colours changed (low byte of each colour word, old -> new)
export function recolor(d: Bytes, mapping: Map<number, number>): Bytes {
  const { polys, others } = polygons(d);
  const out = d.slice();
  for (const [col] of polys) if (mapping.has(out[col])) out[col] = mapping.get(out[col])!;
  for (const col of others) if (mapping.has(out[col])) out[col] = mapping.get(out[col])!;
  return out;
}

// Body whose polygons of `colour` take a factor-th of the light: their
// normals' divisor (the word after x, y, z) is multiplied by factor. Normals
// those polygons share with others are copied first, into the same bone
// (each bone's 38-byte record has its normal count at 18; normals are
// stored bone by bone).
export function dim(d: Bytes, colour: number, factor: number): Bytes {
  const flags = u16(d, 0);
  let o = u16(d, 14) + 16;
  o = skipCounted(d, o, 6);
  const bones: number[] = [];  // offsets of the bones' normal counts
  if (flags & INFO_ANIM) {
    const nb = u16(d, o);
    for (let i = 0; i < nb; i++) bones.push(o + 2 + 38 * i + 18);
    o += 2 + 38 * nb;
  }
  const atNormals = o;
  const nn = u16(d, o);
  const normals: number[][] = [];
  for (let i = 0; i < nn; i++) { const p = o + 2 + 8 * i; normals.push([s16(d, p), s16(d, p + 2), s16(d, p + 4), s16(d, p + 6)]); }
  const atPolys = o + 2 + 8 * nn;
  const refs: [number, number][] = [];  // (offset of a normal index, colour)
  o = atPolys;
  const n = u16(d, o); o += 2;
  for (let i = 0; i < n; i++) {
    const w0 = u16(d, o), col = u16(d, o + 2);
    const mat = w0 & 0xff, npt = w0 >> 8;
    o += 4;
    if (mat >= MAT_GOURAUD) { for (let k = 0; k < npt; k++) refs.push([o + 4 * k, col & 0xff]); o += 4 * npt; }
    else if (mat >= MAT_FLAT) { refs.push([o, col & 0xff]); o += 2 + 2 * npt; }
    else o += 2 * npt;
  }
  const users = new Map<number, Set<boolean>>();
  for (const [at, col] of refs) {
    const k = u16(d, at);
    if (!users.has(k)) users.set(k, new Set());
    users.get(k)!.add(col === colour);
  }
  const mine = new Set([...users].filter(([, u]) => u.has(true)).map(([i]) => i));
  const shared = new Set([...mine].filter(i => users.get(i)!.size > 1));
  // new normal order: each bone's own, then copies of its shared ones
  const counts = bones.length ? bones.map(b => u16(d, b)) : [nn];
  const fresh: number[][] = [], moved = new Map<number, number>(), copy = new Map<number, number>();
  let i = 0;
  counts.forEach((cnt, b) => {
    for (let k = i; k < i + cnt; k++) { moved.set(k, fresh.length); fresh.push([...normals[k]]); }
    let extra = 0;
    for (let k = i; k < i + cnt; k++) if (shared.has(k)) { copy.set(k, fresh.length); fresh.push([...normals[k]]); extra++; }
    counts[b] = cnt + extra;
    i += cnt;
  });
  for (const k of mine) fresh[copy.get(k) ?? moved.get(k)!][3] *= factor;
  const head = new Buf().add(d.subarray(0, atNormals)).w16(fresh.length);
  for (const v of fresh) for (const x of v) head.w16(x & 0xffff);
  const shift = head.length - atPolys;
  const out = concat([head.bytes(), d.subarray(atPolys)]);
  bones.forEach((b, j) => put16(out, b, counts[j]));
  for (const [at, col] of refs) {
    const k = u16(d, at);
    put16(out, at + shift, col === colour && copy.has(k) ? copy.get(k)! : moved.get(k)!);
  }
  return out;
}
