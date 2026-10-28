// Little-endian reads and writes on Uint8Array, as Python's struct does.

export type Bytes = Uint8Array;

export const u8 = (b: Bytes, o: number): number => b[o];
export const u16 = (b: Bytes, o: number): number => b[o] | (b[o + 1] << 8);
export const s16 = (b: Bytes, o: number): number => (u16(b, o) << 16) >> 16;
export const u32 = (b: Bytes, o: number): number => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
export const s8 = (b: Bytes, o: number): number => (b[o] << 24) >> 24;

export function put16(b: Bytes, o: number, v: number): void { b[o] = v & 0xff; b[o + 1] = (v >> 8) & 0xff; }
export function put32(b: Bytes, o: number, v: number): void {
  b[o] = v & 0xff; b[o + 1] = (v >> 8) & 0xff; b[o + 2] = (v >> 16) & 0xff; b[o + 3] = (v >>> 24) & 0xff;
}

export const le16 = (v: number): Bytes => { const b = new Uint8Array(2); put16(b, 0, v); return b; };
export const le32 = (v: number): Bytes => { const b = new Uint8Array(4); put32(b, 0, v); return b; };

export function concat(parts: Bytes[]): Bytes {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function equal(a: Bytes, b: Bytes): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// a Map key for byte content (identical content, identical key)
export function key(b: Bytes): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000) as unknown as number[]);
  return s;
}

// a growable byte buffer
export class Buf {
  data = new Uint8Array(256);
  length = 0;
  private room(n: number): void {
    if (this.length + n <= this.data.length) return;
    let m = this.data.length * 2;
    while (m < this.length + n) m *= 2;
    const d = new Uint8Array(m); d.set(this.data.subarray(0, this.length)); this.data = d;
  }
  push(...v: number[]): this { this.room(v.length); for (const x of v) this.data[this.length++] = x & 0xff; return this; }
  add(b: Bytes): this { this.room(b.length); this.data.set(b, this.length); this.length += b.length; return this; }
  w16(v: number): this { this.room(2); put16(this.data, this.length, v); this.length += 2; return this; }
  w32(v: number): this { this.room(4); put32(this.data, this.length, v); this.length += 4; return this; }
  bytes(): Bytes { return this.data.slice(0, this.length); }
}

export const latin1 = (s: string): Bytes => Uint8Array.from(s, c => c.charCodeAt(0) & 0xff);
export const fromLatin1 = (b: Bytes): string => key(b);
