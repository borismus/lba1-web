// LBA1 grids (LBA_GRI.HQR) and layout libraries (LBA_BLL.HQR).
//
// Grid: 64*64 UWORD offsets (index x + z*64) to RLE columns of 25 cells, then a
// 32-byte bitmask of the layouts used (bit i, MSB first = layout i, 1..255).
// A cell is (layout 1-based, brick index inside the layout); layout 0 = empty.
// Column: count byte, then runs: flag byte (low 6 bits = n-1;
// 0x00 empty, 0x40 n literal cells, 0x80 one cell repeated n times).
// (engine/game/GRILLE.C, GRILLE_A.C DecompColonne)
//
// Layout library: ULONG offset table (count = first/4); a layout is
// dx, dy, dz bytes then dx*dy*dz entries of [shape, sound, UWORD brick+1].
//
// A cell is a number here: layout << 8 | index. CLEAR (for GRM fragments) is
// a cell that overwrites the map with nothing: plain 0 means 'leave the map
// as is' there, and (0, n) is not empty either (WorldColBrick reads n as an
// invisible collision shape).
import { type Bytes, u16, u32, put16, Buf, key } from './bytes.ts';

export const SX = 64, SY = 25, SZ = 64;
export const CLEAR = -1;
export const cell = (layout: number, index: number): number => (layout << 8) | index;
export const layoutOf = (c: number): number => c === CLEAR ? 0 : c >> 8;
export const indexOf = (c: number): number => c === CLEAR ? 0 : c & 0xff;

export type Cells = number[][][];  // cells[x][z][y]

export function emptyCells(): Cells {
  return Array.from({ length: SX }, () => Array.from({ length: SZ }, () => new Array(SY).fill(0)));
}

// -> cells[x][z][y], plus the used-layout bitmask
export function decodeGrid(data: Bytes): { cells: Cells; mask: Bytes } {
  const cells = emptyCells();
  for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) {
    let p = u16(data, (x + z * SX) * 2);
    const runs = data[p++];
    let y = 0;
    for (let r = 0; r < runs; r++) {
      const flag = data[p++], n = (flag & 0x3f) + 1;
      if ((flag & 0xc0) === 0) y += n;
      else if (flag & 0x40) for (let k = 0; k < n; k++) { cells[x][z][y++] = cell(data[p], data[p + 1]); p += 2; }
      else { const c = cell(data[p], data[p + 1]); p += 2; for (let k = 0; k < n; k++) cells[x][z][y++] = c; }
    }
  }
  return { cells, mask: data.slice(data.length - 32) };
}

// extraLayouts: also mark these used (layouts only in GRM fragments: the
// engine loads bricks for the main grid's used layouts only)
export function encodeGrid(cells: Cells, extraLayouts: Iterable<number> = []): Bytes {
  const cols: Bytes[] = [];
  const used = new Set<number>();
  for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) {
    const col = cells[x][z];
    const runs = new Buf();
    let nruns = 0, y = 0;
    while (y < SY) {
      const c = col[y];
      let n = 1;
      while (y + n < SY && col[y + n] === c && n < 64) n++;
      if (c === 0) runs.push(n - 1);
      else {
        // (0, n) cells are not drawn but are kept: the original grids use them under the floor
        if (layoutOf(c)) used.add(layoutOf(c));
        runs.push(0x80 | (n - 1), layoutOf(c), indexOf(c));
      }
      nruns++;
      y += n;
    }
    // keep the trailing empty run: DecompColonne only writes the cells a
    // column lists, so a short column leaves the previous scene's bricks in
    // the cube buffer
    cols.push(new Buf().push(nruns).add(runs.bytes()).bytes());
  }
  const out = new Uint8Array(SX * SZ * 2);
  const blob = new Buf();
  const index = new Map<string, number>();
  const base = out.length;
  cols.forEach((c, i) => {
    const k = key(c);
    if (!index.has(k)) { index.set(k, base + blob.length); blob.add(c); }
    put16(out, i * 2, index.get(k)!);
  });
  const mask = new Uint8Array(32);
  for (const b of new Set([...used, ...extraLayouts])) mask[b >> 3] |= 1 << (7 - (b & 7));
  return new Buf().add(out).add(blob.bytes()).add(mask).bytes();
}

export interface Layout { dx: number; dy: number; dz: number; bricks: [number, number, number][] }

// -> list of layouts (index 0 = layout 1): dx, dy, dz, bricks [shape, sound, brick]
export function decodeLayouts(data: Bytes): Layout[] {
  const count = u32(data, 0) / 4;
  const out: Layout[] = [];
  for (let i = 0; i < count; i++) {
    const off = u32(data, i * 4);
    const dx = data[off], dy = data[off + 1], dz = data[off + 2];
    const bricks: [number, number, number][] = [];
    for (let j = 0; j < dx * dy * dz; j++) {
      const o = off + 3 + j * 4;
      bricks.push([data[o], data[o + 1], u16(data, o + 2)]);
    }
    out.push({ dx, dy, dz, bricks });
  }
  return out;
}
