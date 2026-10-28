// HQR archives (LBA1): a table of ULONG offsets, then entries of
// [ULONG size, ULONG compressed size, UWORD method] + data.
// Method 0 = stored, 1 = LZS (see engine/LIB_SYS/EXPAND.C).
import { type Bytes, u16, u32, Buf, key } from './bytes.ts';

export function expand(src: Bytes, size: number): Bytes {
  const out = new Uint8Array(size);
  let n = 0, i = 0;
  while (n < size) {
    let flags = src[i++];
    for (let k = 0; k < 8 && n < size; k++) {
      if (flags & 1) out[n++] = src[i++];
      else {
        const ax = src[i] | (src[i + 1] << 8);
        i += 2;
        const length = (ax & 0x0f) + 2, offset = (ax >> 4) + 1;
        for (let j = 0; j < length && n < size; j++) { out[n] = out[n - offset]; n++; }
      }
      flags >>= 1;
    }
  }
  return out;
}

// Entries as bytes; null for empty slots (offset 0).
export function read(data: Bytes): (Bytes | null)[] {
  const count = u32(data, 0) / 4;
  const entries: (Bytes | null)[] = [];
  for (let k = 0; k < count; k++) {
    const off = u32(data, k * 4);
    if (off === 0 || off >= data.length) { entries.push(null); continue; }
    const size = u32(data, off), csize = u32(data, off + 4), method = u16(data, off + 8);
    const body = data.subarray(off + 10, off + 10 + csize);
    entries.push(method === 0 ? body.slice() : expand(body, size));
  }
  if (entries.length && entries[entries.length - 1] === null) entries.pop();  // end-of-file sentinel offset
  return entries;
}

// Writes entries uncompressed; identical entries share one copy.
export function write(entries: (Bytes | null)[]): Bytes {
  const count = entries.length;
  const table: number[] = [];
  const blob = new Buf();
  const seen = new Map<string, number>();
  const base = 4 * count;  // adjusted for the sentinel slot below
  for (const e of entries) {
    if (e === null) { table.push(0); continue; }
    const k = key(e);
    if (!seen.has(k)) {
      seen.set(k, base + blob.length);
      blob.w32(e.length).w32(e.length).w16(0).add(e);
    }
    table.push(seen.get(k)!);
  }
  // original archives end the table with a sentinel = file size
  const out = new Buf();
  for (const t of table) out.w32(t ? t + 4 : 0);
  out.w32(4 * (count + 1) + blob.length);
  out.add(blob.bytes());
  return out.bytes();
}
