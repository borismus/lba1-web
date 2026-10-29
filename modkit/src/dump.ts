// A scene as text, for reading (not for copying into a mod): its objects
// with their track and life scripts in the listing syntax mods use, the
// lines they say, and its zones. What a mod's hooks need to know: which
// object, which instruction (offsets: L<n> labels), which zone.
import { type Bytes, s16, u16 } from './bytes.ts';
import * as hqr from './hqr.ts';
import { HEADER, sceneObjects, zonesAt } from './scene.ts';
import { lifeSource, trackSource } from './script.ts';

const START_FILE_ISLAND = 3, MAX_TEXT_LANG = 14;  // COMMON.H, MESSAGE.C
const ZONE_TYPES = ['exit', 'camera', 'scenario', 'fragment', 'give', 'text', 'ladder'];  // T_ZONE.Type (OBJECT.C)
const SAYS = /^\s*(MESSAGE|SAY_MESSAGE|BIG_MESSAGE|MESSAGE_OBJ|SAY_MESSAGE_OBJ)\b.*?(\d+)\s*$/;

// the English lines of a text bank: id -> text
function bank(text: Bytes, island: number): Map<number, string> {
  const T = hqr.read(text), b = START_FILE_ISLAND + island;
  const ids = T[b * 2]!, strs = T[b * 2 + 1]!, out = new Map<number, string>();
  for (let j = 0; j < ids.length / 2; j++) {
    const s = strs.subarray(u16(strs, 2 * j), u16(strs, 2 * (j + 1)) - 1);
    out.set(u16(ids, 2 * j), String.fromCharCode(...s));
  }
  return out;
}

// scene n of a SCENE.HQR as text; text: the matching TEXT.HQR (for the lines)
export function dumpScene(scenes: Bytes, text: Bytes, n: number): string {
  const sc = hqr.read(scenes)[n];
  if (!sc) throw new Error(`no scene ${n}`);
  const island = sc[0], lines = bank(text, island);
  const say = (src: string) => src.split('\n').map(l => {
    const m = SAYS.exec(l), t = m && lines.get(+m[2]);
    return t ? `${l}   # "${t}"` : l;
  }).join('\n');
  const out = [`# scene ${n} (island ${island}, music ${sc[HEADER - 1]}): hero starts at ${s16(sc, HEADER)} ${s16(sc, HEADER + 2)} ${s16(sc, HEADER + 4)}`];
  for (const o of sceneObjects(sc)) {
    out.push('', o.index === 0
      ? '== object 0: the hero'
      : `== object ${o.index}: model ${o.f3d} body ${o.body} anim ${o.anim} at ${o.pos!.join(' ')} flags 0x${o.flags!.toString(16)} move ${o.move}`);
    if (o.track.length > 1) out.push('-- track', trackSource(o.track));
    if (o.life.length > 1) out.push('-- life', say(lifeSource(o.life)));
  }
  let at = zonesAt(sc);
  const nz = u16(sc, at);
  if (nz) out.push('', '== zones (x0 y0 z0 x1 y1 z1, type, number, info)');
  for (let i = 0; i < nz; i++) {
    const w = Array.from({ length: 12 }, (_, k) => s16(sc, at + 2 + 24 * i + 2 * k));
    out.push(`  ${i}: ${w.slice(0, 6).join(' ')}  ${ZONE_TYPES[w[6]] ?? w[6]} ${w[7]}  ${w.slice(8).join(' ')}`);
  }
  return out.join('\n') + '\n';
}
