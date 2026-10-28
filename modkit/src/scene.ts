// LBA1 scene entries (SCENE.HQR). Layout per engine/game/DISKFUNC.C LoadScene:
// island, game-over scene (bytes), 2 words, light alpha/beta, 4 x (sample,
// repeat, random) ambience, second min/range, jingle byte, hero start xyz,
// hero track + life scripts (size-prefixed), objects, zones, tracks.
import { type Bytes, u16, s16, put16, Buf, concat } from './bytes.ts';
import { life as lifeIns, lifeSize, LIFE_OP } from './script.ts';

export const HEADER = 2 + 2 + 2 + 4 + 12 * 2 + 4 + 1;  // island .. CubeJingle

// Bytes up to and including the jingle.
export const headerFrom = (template: Bytes): Bytes => template.slice(0, HEADER);

export type Zone = number[];  // 12 words: x0 y0 z0 x1 y1 z1 type num info0..3 (T_ZONE)

export function heroOnly(template: Bytes, ownIndex: number, start: number[], zones: Zone[] = [], objects: Bytes[] = []): Bytes {
  const head = headerFrom(template);
  head[1] = ownIndex & 0xff;  // game over -> restart in this scene
  const out = new Buf().add(head);
  for (const v of start) out.w16(v & 0xffff);
  out.w16(1).push(0);  // hero track: TM_END
  out.w16(1).push(0);  // hero life: LM_END
  out.w16(1 + objects.length);  // NbObjets: hero + objects
  for (const r of objects) out.add(r);
  out.w16(zones.length);
  for (const z of zones) for (const v of z) out.w16(v & 0xffff);
  out.w16(0);  // tracks
  return out.bytes();
}

// -> [start, end) byte ranges of each non-hero object record
export function objectRecords(sc: Bytes): [number, number][] {
  let o = HEADER + 6;
  for (let k = 0; k < 2; k++) o += 2 + u16(sc, o);  // hero track, life
  const n = s16(sc, o);
  o += 2;
  const out: [number, number][] = [];
  for (let i = 1; i < n; i++) {
    const st = o;
    o += 2 + 2 + 1 + 1 + 2 + 6 + 1 + 2 + 2 + 2 + 2 + 8 + 4;
    for (let k = 0; k < 2; k++) o += 2 + u16(sc, o);
    out.push([st, o]);
  }
  return out;
}

export const Z_SCE = 2;  // scenario zone (T_ZONE.Type, OBJECT.C)

// field offsets inside an object record (DISKFUNC.C LoadScene)
export const O_FILE3D = 2, O_BODY = 4, O_ANIM = 5, O_POS = 8, O_BETA = 17, O_MOVE = 21, O_INFO = 23;
export const O_OPTIONS = 15, O_NB_BONUS = 31, O_ARMOUR = 33, O_LIFE = 34;
export const CLOSED_EXIT = 99;  // scenario zone number of a closed exit (closeExit)
// what an object drops when it dies (OptionFlags bits, COMMON.H EXTRA_GIVE_*)
export const BONUS: Record<string, number> = { coins: 16, hearts: 32, magic: 64, key: 128, clover: 256 };
export const O_SCRIPTS = 35;

export interface SceneObject {
  index: number; flags?: number; f3d: number; body?: number; anim?: number;
  pos?: [number, number, number]; move?: number;
  track: Bytes; life: Bytes; trackAt: number; lifeAt: number;
}

// -> the hero (index 0) and every object, with its scripts (and their
// offsets in the scene: trackAt, lifeAt)
export function sceneObjects(sc: Bytes): SceneObject[] {
  let o = HEADER + 6;
  const block = (o: number): [Bytes, number] => { const n = u16(sc, o); return [sc.slice(o + 2, o + 2 + n), o + 2 + n]; };
  let trackAt = o + 2, tr: Bytes, lf: Bytes;
  [tr, o] = block(o);
  let lifeAt = o + 2;
  [lf, o] = block(o);
  const objs: SceneObject[] = [{ index: 0, f3d: -1, track: tr, life: lf, trackAt, lifeAt }];
  const n = s16(sc, o); o += 2;
  for (let i = 1; i < n; i++) {
    const flags = u16(sc, o), f3d = s16(sc, o + 2), body = sc[o + 4], anim = sc[o + 5];
    const pos: [number, number, number] = [s16(sc, o + 8), s16(sc, o + 10), s16(sc, o + 12)];
    const move = s16(sc, o + 21);
    o += 35;
    trackAt = o + 2;
    [tr, o] = block(o);
    lifeAt = o + 2;
    [lf, o] = block(o);
    objs.push({ index: i, flags, f3d, body, anim, pos, move, track: tr, life: lf, trackAt, lifeAt });
  }
  return objs;
}

// offset of the zone count, after the last object
export function zonesAt(sc: Bytes): number {
  let o = HEADER + 6;
  for (let k = 0; k < 2; k++) o += 2 + u16(sc, o);
  const n = s16(sc, o); o += 2;
  for (let i = 1; i < n; i++) { o += 35; for (let k = 0; k < 2; k++) o += 2 + u16(sc, o); }
  return o;
}

// life script opcodes (engine/game/COMMON.H, GERELIFE.C)
const LM_END = 0, LM_RETURN = 11, LM_IF = 12, LM_MESSAGE = 25;
const LF_DISTANCE = 2, LF_ACTION = 14, LT_EQUAL = 0, LT_LESS = 2;
const TALK_DISTANCE = 1200;

// Every frame: if the hero is close and presses the action key, say textId.
export function talkLife(textId: number): Bytes {
  const end = 8 + 6 + 3;  // IF distance (8 bytes), IF action (6), MESSAGE (3)
  return new Buf().push(LM_IF, LF_DISTANCE, 0, LT_LESS).w16(TALK_DISTANCE).w16(end)
    .push(LM_IF, LF_ACTION, LT_EQUAL, 1).w16(end)
    .push(LM_MESSAGE).w16(textId).push(LM_RETURN).bytes();
}

export interface ActorOpts {
  beta?: number; move?: number; anim?: number; says?: number | null;
  track?: Bytes | null; life?: Bytes | null; points?: number | null; armour?: number | null; flags?: number | null;
}

// An object record cloned from object `index` (1-based) of an original
// scene, with its model, body, position and movement replaced and its track
// script emptied (it stands or wanders).
export function actor(template: Bytes, index: number, file3d: number, body: number, xyz: number[], opt: ActorOpts = {}): Bytes {
  const [st] = objectRecords(template)[index - 1];
  const rec = template.slice(st, st + O_SCRIPTS);
  if (opt.points != null) rec[O_LIFE] = opt.points;
  if (opt.armour != null) rec[O_ARMOUR] = opt.armour;
  if (opt.flags != null) put16(rec, 0, opt.flags);
  put16(rec, O_FILE3D, file3d & 0xffff);
  rec[O_BODY] = body;
  rec[O_ANIM] = opt.anim ?? 0;
  xyz.forEach((v, k) => put16(rec, O_POS + 2 * k, v & 0xffff));
  put16(rec, O_BETA, (opt.beta ?? 0) & 0xffff);
  put16(rec, O_MOVE, (opt.move ?? 0) & 0xffff);
  [0, 0, -1, -1].forEach((v, k) => put16(rec, O_INFO + 2 * k, v & 0xffff));
  const track = opt.track ?? new Uint8Array([0]);  // TM_END
  const life = opt.life ?? (opt.says != null ? talkLife(opt.says) : new Uint8Array([LM_END]));
  return new Buf().add(rec).w16(track.length).add(track).w16(life.length).add(life).bytes();
}

export interface CopyOpts {
  noFla?: boolean; skip?: string[]; start?: number[] | null; gameOver?: number | null; exits?: Map<number, number> | null;
}

// A copy of an original scene, patched in place (scripts keep their size,
// so every jump offset stays valid): change-cube zones and CHANGE_CUBE go
// to cubes[n] instead of scene n, MESSAGE-like lines say texts[id] instead
// of text id, life instructions named in skip become NOPs, as does every
// PLAY_FLA with noFla. start: a new hero start xyz. gameOver: a scene
// number; CHANGE_CUBE to it becomes GAME_OVER. exits: {scene: n}, change-
// cube zones to that scene become scenario zone n instead.
export function patchCopy(sc: Bytes, cubes: Map<number, number>, texts: Map<number, number>, opt: CopyOpts = {}): Bytes {
  const out = sc.slice();
  const skip = new Set(opt.skip ?? []);
  if (opt.start) opt.start.forEach((v, k) => put16(out, HEADER + 2 * k, v & 0xffff));
  for (const ob of sceneObjects(sc)) {
    const base = ob.lifeAt;
    for (const { at, name, args } of ob.life.length > 1 ? lifeIns(ob.life) : []) {
      const o = base + at;
      if (name === 'CHANGE_CUBE' && args[0] === opt.gameOver) { out[o] = LIFE_OP.GAME_OVER; out[o + 1] = LIFE_OP.NOP; }
      else if (name === 'CHANGE_CUBE' && cubes.has(args[0] as number)) out[o + 1] = cubes.get(args[0] as number)!;
      else if ((name === 'MESSAGE' || name === 'SAY_MESSAGE' || name === 'BIG_MESSAGE') && texts.has(args[0] as number)) put16(out, o + 1, texts.get(args[0] as number)!);
      else if ((name === 'MESSAGE_OBJ' || name === 'SAY_MESSAGE_OBJ') && texts.has(args[1] as number)) put16(out, o + 2, texts.get(args[1] as number)!);
      else if ((name === 'PLAY_FLA' && opt.noFla) || skip.has(name)) {
        const n = lifeSize(ob.life, at);
        out.fill(LIFE_OP.NOP, o, o + n);
      }
    }
  }
  const o = zonesAt(sc);
  const nz = s16(sc, o);
  for (let i = 0; i < nz; i++) {
    const z = o + 2 + 24 * i;
    const kind = s16(sc, z + 12), num = s16(sc, z + 14);
    if (kind === 0 && opt.exits && opt.exits.has(num)) { put16(out, z + 12, Z_SCE); put16(out, z + 14, opt.exits.get(num)!); }
    else if (kind === 0 && cubes.has(num)) put16(out, z + 14, cubes.get(num)!);
  }
  return out;
}

// sc with object `index` (1-based) running new scripts (null keeps that one)
export function setScripts(sc: Bytes, index: number, track: Bytes | null = null, life: Bytes | null = null): Bytes {
  const [st, end] = objectRecords(sc)[index - 1];
  let o = st + O_SCRIPTS;
  const old: Bytes[] = [];
  for (let k = 0; k < 2; k++) { const n = u16(sc, o); old.push(sc.slice(o + 2, o + 2 + n)); o += 2 + n; }
  const t = track ?? old[0], l = life ?? old[1];
  return concat([sc.subarray(0, st + O_SCRIPTS), new Buf().w16(t.length).add(t).w16(l.length).add(l).bytes(), sc.subarray(end)]);
}

// sc with code (assembled at origin `at`) over object `index`'s life script
// (0: the hero's) from offset at, the rest of the last instruction it covers
// filled with NOPs, so every other offset stays valid
export function patchLife(sc: Bytes, index: number, at: number, code: Bytes): Bytes {
  const ob = sceneObjects(sc)[index];
  const life = ob.life;
  const starts = lifeIns(life).map(i => i.at).concat([life.length]);
  if (!starts.includes(at)) throw new Error(`object ${index}: no instruction at ${at}`);
  const end = starts.find(a => a >= at + code.length);
  if (end === undefined || end > life.length - 1) throw new Error(`object ${index}: patch at ${at} runs past the script`);
  const padded = new Uint8Array(end - at).fill(LIFE_OP.NOP);
  padded.set(code);
  const out = sc.slice();
  out.set(padded, ob.lifeAt + at);
  return out;
}

// sc with object `index`'s (1-based) life script hooked at offset at: the
// instruction there becomes a jump (ELSE) to new code appended to the
// script. assemble(origin) -> the new code, assembled at that origin.
export function hookLife(sc: Bytes, index: number, at: number, assemble: (origin: number) => Bytes): Bytes {
  const ob = sceneObjects(sc)[index];
  const life = ob.life.slice();
  const starts = lifeIns(life).map(i => i.at).concat([life.length]);
  if (!starts.includes(at)) throw new Error(`object ${index}: no instruction at ${at}`);
  const end = starts.find(a => a > at)!;
  if (end - at < 3 || end > life.length - 1) throw new Error(`object ${index}: the instruction at ${at} is too short to hook`);
  const origin = life.length;
  life.fill(LIFE_OP.NOP, at, end);
  life[at] = LIFE_OP.ELSE;
  put16(life, at + 1, origin);
  return setScripts(sc, index, null, concat([life, assemble(origin)]));
}

// sc with change-cube zone `zone` (index in the scene's zones) shut
export function closeExit(sc: Bytes, zone: number): Bytes {
  const z = zonesAt(sc) + 2 + 24 * zone;
  const kind = s16(sc, z + 12);
  if (kind !== 0) throw new Error(`zone ${zone} is not an exit (type ${kind})`);
  const out = sc.slice();
  put16(out, z + 12, Z_SCE);
  put16(out, z + 14, CLOSED_EXIT);
  return out;
}

export interface ObjectChange { model?: number | null; body?: number | null; life?: number | null; armour?: number | null; drops?: [number, string] | null }

// sc with object `index` (1-based) changed (null keeps a field)
export function setObject(sc: Bytes, index: number, ch: ObjectChange): Bytes {
  const [st] = objectRecords(sc)[index - 1];
  const out = sc.slice();
  if (ch.model != null) put16(out, st + O_FILE3D, ch.model & 0xffff);
  if (ch.body != null) out[st + O_BODY] = ch.body;
  if (ch.life != null) out[st + O_LIFE] = ch.life;
  if (ch.armour != null) out[st + O_ARMOUR] = ch.armour;
  if (ch.drops != null) {
    const [count, kind] = ch.drops;
    const all = Object.values(BONUS).reduce((a, b) => a + b, 0);
    const flags = u16(out, st + O_OPTIONS) & ~all;
    put16(out, st + O_OPTIONS, (flags | BONUS[kind]) & 0xffff);
    out[st + O_NB_BONUS] = count;
  }
  return out;
}

// sc with object records (see actor) appended after its last object
export function addObjects(sc: Bytes, records: Bytes[]): Bytes {
  let o = HEADER + 6;
  for (let k = 0; k < 2; k++) o += 2 + u16(sc, o);
  const n = s16(sc, o);
  const end = zonesAt(sc);
  const out = concat([sc.subarray(0, end), ...records, sc.subarray(end)]);
  put16(out, o, (n + records.length) & 0xffff);
  return out;
}
