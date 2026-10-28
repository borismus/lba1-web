// Spoken lines: a mod's clips (WAV) into the island's voice bank
// (VOX/EN_<bank>.VOX).
//
// A VOX bank is an HQR whose entry i is the voice of the bank's i-th text
// line (MESSAGE.C Speak), so the voice of a line appended to a bank goes in
// the matching slot. Each entry is [ULONG size, ULONG compressed size, UWORD
// method] + a Creative Voice File whose first byte says whether another part
// follows it (1: PlaySpeakVoc reads the next entry from where this one ends;
// 0: last). Those continuation parts are not in the offset table, so the
// original entries are kept byte for byte and only their offsets move.
import { type Bytes, u16, u32, Buf, latin1 } from './bytes.ts';
import { pyRound } from './hero.ts';

export const RATE_BYTE = 166;                  // 1000000 / (256 - 166) = 11111 Hz, as the game's voices
export const RATE = Math.floor(1000000 / (256 - RATE_BYTE));
export const PART = 200 * 1024;                // PCM per part: BufSpeak holds 256 KB (PERSO.C)
export const MAX_SLOTS = 511;                  // InitFileNar refuses a table over 2048 bytes

// 16-bit signed PCM at rate -> 8-bit unsigned at RATE (linear), peak at 90%
// of full scale (at most 4x louder), as 8 bits hiss when quiet.
export function resample(a: Int16Array, rate: number): Bytes {
  let peak = 1;
  for (const v of a) { const m = Math.abs(v); if (m > peak) peak = m; }
  const gain = Math.min(4.0, 0.9 * 32767 / Math.max(1, peak));
  const step = rate / RATE;
  const n = Math.trunc(a.length / step);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * step, j = Math.trunc(x), k = Math.min(j + 1, a.length - 1);
    const v = (a[j] + (a[k] - a[j]) * (x - j)) * gain;
    out[i] = Math.max(0, Math.min(255, pyRound(v / 256) + 128));
  }
  return out;
}

// a mod's clip (WAV: 8 or 16-bit PCM, mono or stereo, any rate) -> 8-bit
// unsigned mono PCM at RATE
export function fromWav(wav: Bytes, name = 'clip'): Bytes {
  const tag = (o: number) => String.fromCharCode(wav[o], wav[o + 1], wav[o + 2], wav[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error(`${name}: not a WAV file`);
  let rate = 0, width = 0, ch = 0, data: Bytes | null = null;
  for (let o = 12; o + 8 <= wav.length;) {
    const id = tag(o), size = u32(wav, o + 4);
    if (id === 'fmt ') {
      if (u16(wav, o + 8) !== 1) throw new Error(`${name}: not PCM`);
      ch = u16(wav, o + 10); rate = u32(wav, o + 12); width = u16(wav, o + 22) / 8;
    } else if (id === 'data') data = wav.subarray(o + 8, o + 8 + size);
    o += 8 + size + (size & 1);
  }
  if (!data || !rate) throw new Error(`${name}: no audio`);
  let a: Int16Array;
  if (width === 1) a = Int16Array.from(data, b => (b - 128) << 8);
  else if (width === 2) a = new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + (data.length & ~1)));
  else throw new Error(`${name}: ${width * 8}-bit WAV (8 or 16 only)`);
  if (ch > 1) {
    const m = new Int16Array(Math.floor(a.length / ch) + (a.length % ch ? 1 : 0));
    for (let i = 0, k = 0; i < a.length; i += ch, k++) {
      let s = 0;
      for (let c = 0; c < ch && i + c < a.length; c++) s += a[i + c];
      m[k] = Math.floor(s / ch);
    }
    a = m;
  }
  return resample(a, rate);
}

// A Creative Voice File of pcm (one sound block), first byte the VOX
// continuation flag.
export function voc(pcm: Bytes, more: boolean): Bytes {
  const n = pcm.length + 2;
  return new Buf().push(more ? 1 : 0).add(latin1('reative Voice File\x1a')).w16(26).w16(0x010a).w16(0x1129)
    .push(1, n & 0xff, (n >> 8) & 0xff, n >> 16).push(RATE_BYTE, 0).add(pcm).push(0).bytes();
}

// A VOX entry: the line in parts, each stored (method 0) after the previous one.
export function entry(pcm: Bytes): Bytes {
  const parts: Bytes[] = [];
  for (let i = 0; i < pcm.length; i += PART) parts.push(pcm.subarray(i, i + PART));
  if (!parts.length) parts.push(new Uint8Array([0x80]));
  const out = new Buf();
  parts.forEach((p, k) => { const v = voc(p, k < parts.length - 1); out.w32(v.length).w32(v.length).w16(0).add(v); });
  return out.bytes();
}

// vox with voices (slot -> VOX entry bytes) added; slots past the end of its
// table extend it (slots in between get no voice).
export function addToBank(vox: Bytes, voices: Map<number, Bytes>): Bytes {
  let first = 0;
  for (let i = 0; i < 512; i++) { const v = u32(vox, 4 * i); if (v) { first = v; break; } }
  const count = first / 4 - 1;  // slots; the last table word is the end of the file
  const old: number[] = [];
  for (let i = 0; i < count; i++) old.push(u32(vox, 4 * i));
  const slots = Math.max(count, Math.max(...voices.keys()) + 1);
  if (slots > MAX_SLOTS) throw new Error(`voice bank: ${slots} lines (max ${MAX_SLOTS})`);
  const shift = 4 * (slots - count);
  const table = old.map(o => o ? o + shift : 0).concat(new Array(slots - count).fill(0));
  const body = new Buf().add(vox.subarray(first));
  let pos = 4 * (slots + 1) + body.length;
  for (const slot of [...voices.keys()].sort((a, b) => a - b)) {
    const e = voices.get(slot)!;
    table[slot] = pos;
    body.add(e);
    pos += e.length;
  }
  const out = new Buf();
  for (const t of table) out.w32(t);
  out.w32(pos);
  return out.add(body.bytes()).bytes();
}
