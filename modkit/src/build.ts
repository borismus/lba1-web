// Building a mod (docs/MODS.md) from the player's own copy of the game.
//
// build(game, mod) -> the overlay: the game files the mod changes or adds,
// lowercased, as the engine reads them. `game` holds the player's files (the
// classic DOS data: SCENE.HQR, TEXT.HQR, ..., VOX/EN_*.VOX); `mod` the
// package's (mod.json, its .ops files, levels/, scripts/, voices/). Nothing
// is read from anywhere else.
//
// A port of the Python reference (levelkit/build_levels.py --mod), which it
// matches byte for byte: each level is appended as a new scene, 134, 135, ...
// (grid slots 120-133 hold the GRM fragments; a scene's grid has the same
// index as the scene). Level GRM fragments go after the last level's grid.
// Lines the levels say are appended to TEXT.HQR (every language) in the bank
// of the level's island, with ids from 1000 up, and spoken from the mod's
// clips (voices/index.json) in the island's English voice bank.
import { type Bytes, u16, s16, Buf, latin1 } from './bytes.ts';
import * as hqr from './hqr.ts';
import { encodeGrid, decodeLayouts, layoutOf } from './grid.ts';
import * as level from './level.ts';
import * as scene from './scene.ts';
import { assembleLife, assembleTrack } from './script.ts';
import { addHero, type Hero } from './hero.ts';
import * as voice from './voice.ts';
import { K } from './house.ts';

export const FIRST = 134;
const GRM_BASE = 120;          // OFFSET_GRM_HQR
const ZONE_Y1 = 25 * 256 - 1;
const Z_CUBE = 0, Z_CAMERA = 1, Z_GRM = 3, Z_GIVE = 4;  // T_ZONE.Type (OBJECT.C)
const ACTOR_TEMPLATE: [number, number] = [15, 10];      // a Rabbibunny in the Rabbibunny village
const MOVE_RANDOM = 7;
const TEXT_BASE = 1000;        // ids of our dialogue lines (the originals' are < 1000)
const START_FILE_ISLAND = 3, MAX_TEXT_LANG = 14;        // COMMON.H, MESSAGE.C
const TEXT_MAX = 25000;        // BufText (PERSO.C); BufOrder holds 512 ids

export type Files = Map<string, Bytes>;   // path -> content

export class BuildError extends Error {}

const text = (b: Bytes) => new TextDecoder().decode(b);
const world = (x: number, z: number): [number, number] => [x * 512, z * 512];
const box = (r: number[], y1 = ZONE_Y1): number[] => [r[0] * 512 - 256, 0, r[1] * 512 - 256, r[2] * 512 + 255, y1, r[3] * 512 + 255];
const cubeStart = (sc: Bytes): number[] => [s16(sc, scene.HEADER), s16(sc, scene.HEADER + 2), s16(sc, scene.HEADER + 4)];
const num = (t: string[], w: string): number | null => t.includes(w) ? parseInt(t[t.indexOf(w) + 1], 10) : null;
const dirname = (p: string) => p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);

// Grow a give zone over the furniture beside it: the bonus pops out of the
// zone's centre toward the hero, so it comes out of the furniture.
function overFurniture(r: number[], furniture: Set<string>): number[] {
  const [x0, z0, x1, z1] = r;
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    if (dx) {
      const x = dx < 0 ? x0 - 1 : x1 + 1;
      let all = true;
      for (let z = z0; z <= z1; z++) if (!furniture.has(K(x, z))) { all = false; break; }
      if (all) return [Math.min(x0, x), z0, Math.max(x1, x), z1];
    } else {
      const z = dz < 0 ? z0 - 1 : z1 + 1;
      let all = true;
      for (let x = x0; x <= x1; x++) if (!furniture.has(K(x, z))) { all = false; break; }
      if (all) return [x0, Math.min(z0, z), x1, Math.max(z1, z)];
    }
  }
  return r;
}

// a .script file: '== track' and '== life' sections in listing syntax
function scriptSections(src: string): Map<string, string> {
  const parts = new Map<string, string[]>();
  let cur: string | null = null;
  for (const line of src.split(/\r\n|\r|\n/)) {
    if (line.startsWith('== ')) { cur = line.slice(3).trim(); parts.set(cur, []); }
    else if (cur) parts.get(cur)!.push(line);
  }
  return new Map([...parts].map(([k, v]) => [k, v.join('\n')]));
}
// the part of a .script file after its first '== life' (hooks and patches)
const lifePart = (src: string) => { const i = src.indexOf('== life'); return i < 0 ? '' : src.slice(i + 7); };

export interface Built { files: Files; features: string[]; scenes: Map<string, number>; log: string[] }

export function build(game: Files, mod: Files): Built {
  // plain Uint8Arrays: their slice() copies (a Node Buffer's is a view, and
  // the build would then write into the game's own bytes)
  game = new Map([...game].map(([k, v]) => [k, Object.getPrototypeOf(v) === Uint8Array.prototype ? v : new Uint8Array(v)]));
  mod = new Map([...mod].map(([k, v]) => [k, Object.getPrototypeOf(v) === Uint8Array.prototype ? v : new Uint8Array(v)]));
  const log: string[] = [];
  const g = (name: string): Bytes => {
    const b = game.get(name);
    if (!b) throw new BuildError(`the game's ${name} is missing`);
    return b;
  };
  const m = (path: string): Bytes => {
    const b = mod.get(path);
    if (!b) throw new BuildError(`the mod has no ${path}`);
    return b;
  };
  const manifest = JSON.parse(text(m('mod.json')));

  // ── operations: heroes, bodies, levels ──────────────────────────────────
  const heroes = new Map<string, Hero>();
  const bodies = new Map<string, [number, Map<number, number>, Map<number, number>]>();
  const files: string[] = [], levelNames: string[] = [];
  const pairs = (words: string[], conv: (s: string) => number = s => parseInt(s, 10)) =>
    new Map(words.map(w => { const [a, b] = w.split(':'); return [parseInt(a, 10), conv(b)] as [number, number]; }));
  for (const ops of manifest.ops ?? []) {
    for (const raw of text(m(ops)).replace(/\\\n/g, ' ').split(/\r\n|\r|\n/)) {
      const t = raw.split('#', 1)[0].split(/\s+/).filter(Boolean);
      if (!t.length) continue;
      if (t[0] === 'body' && t[1] === 'copy') {           // body copy REF as @B [recolor A:B ...] [dim C:F ...]
        const k = t.map((w, i) => (w === 'recolor' || w === 'dim') ? i : -1).filter(i => i >= 0).concat([t.length]);
        const part = new Map<string, string[]>();
        for (let i = 0; i + 1 < k.length; i++) part.set(t[k[i]], t.slice(k[i] + 1, k[i + 1]));
        bodies.set(t[4], [parseInt(t[2], 10), pairs(part.get('recolor') ?? []), pairs(part.get('dim') ?? [])]);
      } else if (t[0] === 'hero') {                         // hero @NAME from file3d F body B bones ... [outfit S body @B] [voice A:B ...]
        const name = t[1].replace(/^@+/, '');
        const k = t.map((w, i) => ['bones', 'outfit', 'voice'].includes(w) ? i : -1).filter(i => i >= 0).concat([t.length]);
        const part = new Map<string, string[]>();
        for (let i = 0; i + 1 < k.length; i++) part.set(t[k[i]], t.slice(k[i] + 1, k[i + 1]));
        const h: Hero = { body: parseInt(t[t.indexOf('body') + 1], 10), bones: part.get('bones')![0].split(',').map(b => b === '-' ? null : parseInt(b, 10)) };
        if (part.has('outfit')) {
          const [slot, , ref] = part.get('outfit')!;
          const [, colours, dim] = bodies.get(ref)!;
          h.outfits = new Map([[parseInt(slot, 10), { colours, dim }]]);
        }
        if (part.has('voice'))
          h.voice = new Map(part.get('voice')!.map(w => { const [a, b] = w.split(':'); return [parseInt(a, 10), b.includes('.') ? { pitch: parseFloat(b) } : parseInt(b, 10)]; }));
        heroes.set(name, h);
      } else if (t[0] === 'level') { files.push(t[3]); levelNames.push(t[1].replace(/^@+/, '')); }  // level @NAME from PATH
      else throw new BuildError(`${ops}: unknown operation ${JSON.stringify(raw.trim())}`);
    }
  }
  const scriptOf = (levelPath: string, name: string): string => {
    const p = dirname(levelPath) + name + '.script';
    return text(mod.has(p) ? mod.get(p)! : m('scripts/' + name + '.script'));
  };

  // ── the game's archives ────────────────────────────────────────────────
  const S = hqr.read(g('SCENE.HQR')), T = hqr.read(g('TEXT.HQR'));
  const G = hqr.read(g('LBA_GRI.HQR')), B = hqr.read(g('LBA_BLL.HQR'));
  if (G.length !== FIRST || B.length !== FIRST) throw new BuildError(`unexpected LBA_GRI/LBA_BLL sizes (${G.length}, ${B.length})`);
  while (S.length < FIRST) S.push(S[0]);  // padding scenes are never entered
  const texts = new Map<number, [number, string][]>();  // text bank -> [(id, text)]

  // pass 1: parse every level, so exits can target any level's start
  type Entry = { path: string; meta: Map<string, string>; lib: number | null; lv: level.Level | null; rows: string[] | null; start: number[] };
  const built: Entry[] = [];
  for (const path of files) {
    const { meta, legend, rows } = level.parse(text(m(path)));
    if (meta.has('copy')) { built.push({ path, meta, lib: null, lv: null, rows: null, start: cubeStart(S[parseInt(meta.get('copy')!, 10)]!) }); continue; }
    const lib = parseInt(meta.get('library') ?? '2', 10);
    const lv = level.buildCells(legend, rows, decodeLayouts(B[lib]!), meta);
    const [sx, sz] = world(...lv.start!);
    built.push({ path, meta, lib, lv, rows, start: [sx, (lv.startY + 1) * 256, sz] });
  }

  const F3D = hqr.read(g('FILE3D.HQR')), ANIM = hqr.read(g('ANIM.HQR'));
  const BODY = hqr.read(g('BODY.HQR')), SAMPLES = hqr.read(g('SAMPLES.HQR'));
  const heroModels = new Map<string, number>();  // hero name -> FILE3D index of its normal model
  const heroOf = new Map<number, number>();      // scene -> that index
  // original scene -> its copy, for exits and CHANGE_CUBE inside the copies
  const copies = new Map<number, number>();
  built.forEach((b, n) => { if (b.meta.has('copy')) copies.set(parseInt(b.meta.get('copy')!, 10), FIRST + n); });

  const addText = (island: number, line: string): number => {
    let total = 0;
    for (const l of texts.values()) total += l.length;
    const id = TEXT_BASE + total, bank = START_FILE_ISLAND + island;
    if (!texts.has(bank)) texts.set(bank, []);
    texts.get(bank)!.push([id, line]);
    return id;
  };

  const frags: number[][][][] = [];
  const names = new Map<string, number>();
  built.forEach((b, n) => {
    const { path, meta } = b;
    let { lv, start } = b;
    const idx = FIRST + n;
    names.set(levelNames[n], idx);
    const heroY = start[1];
    if (meta.has('hero')) {
      const who = meta.get('hero')!.replace(/^@+/, '');
      if (!heroes.has(who)) throw new BuildError(`${path}: unknown hero ${who}`);
      if (!heroModels.has(who)) heroModels.set(who, addHero(heroes.get(who)!, F3D, ANIM, BODY, SAMPLES));
      heroOf.set(idx, heroModels.get(who)!);
    }
    if (lv === null) {
      const src = parseInt(meta.get('copy')!, 10);
      const island = S[src]![0];
      const lines = new Map<number, number>();
      for (const [k, v] of meta) if (k.startsWith('text ')) lines.set(parseInt(k.split(/\s+/)[1], 10), addText(island, v));
      const exits = new Map<number, number>();
      for (const [k, v] of meta) if (k.startsWith('exit ') && !k.startsWith('exit zone ')) exits.set(parseInt(k.split(/\s+/)[1], 10), parseInt(v.split(/\s+/)[1], 10));
      let sc = scene.patchCopy(S[src]!, copies, lines, {
        noFla: meta.has('hero'), skip: (meta.get('skip') ?? '').split(/\s+/).filter(Boolean),
        start: meta.has('start') ? meta.get('start')!.split(/\s+/).map(Number) : null,
        gameOver: meta.get('caught') === 'game over' ? src : null, exits,
      });
      const say = (line: string) => addText(island, line);
      for (const [k, v] of meta) {
        const w = k.split(/\s+/);
        if (k.startsWith('script ')) {  // script N: S (object N of the original runs S.script)
          const sec = scriptSections(scriptOf(path, v));
          const track = sec.has('track') ? assembleTrack(sec.get('track')!) : null;
          const life = sec.has('life') ? assembleLife(sec.get('life')!, say) : null;
          sc = scene.setScripts(sc, parseInt(w[1], 10), track, life);
        } else if (k.startsWith('exit zone ')) sc = scene.closeExit(sc, parseInt(w[2], 10));
        else if (k.startsWith('hook ')) {
          const src2 = lifePart(scriptOf(path, v));
          sc = scene.hookLife(sc, parseInt(w[1], 10), parseInt(w[2], 10), origin => assembleLife(src2, say, origin));
        } else if (k.startsWith('patch ')) {
          const at = parseInt(w[2], 10);
          sc = scene.patchLife(sc, parseInt(w[1], 10), at, assembleLife(lifePart(scriptOf(path, v)), say, at));
        } else if (k.startsWith('object ')) {
          const t = v.split(/\s+/).filter(Boolean);
          sc = scene.setObject(sc, parseInt(w[1], 10), {
            model: num(t, 'model'), body: num(t, 'body'), life: num(t, 'life'), armour: num(t, 'armour'),
            drops: t.includes('drops') ? [parseInt(t[t.indexOf('drops') + 1], 10), t[t.indexOf('drops') + 2]] : null,
          });
        }
      }
      const extra: Bytes[] = [];
      for (const [k, v] of meta) {
        if (!k.startsWith('add actor')) continue;  // add actor N: MODEL body B at X Y Z [facing B] [life L] [armour A] [flags HEX] [script S] [says ...]
        const s = v.indexOf(' says ');
        const spec = s < 0 ? v : v.slice(0, s), says = s < 0 ? '' : v.slice(s + 6);
        const t = spec.split(/\s+/).filter(Boolean);
        const a = t.indexOf('at');
        const xyz = t.slice(a + 1, a + 4).map(x => parseInt(x, 10));
        const body = t.includes('body') ? parseInt(t[t.indexOf('body') + 1], 10) : 0;
        let track: Bytes | null = null, life: Bytes | null = null;
        if (t.includes('script')) {
          const sec = scriptSections(scriptOf(path, t[t.indexOf('script') + 1]));
          track = sec.has('track') ? assembleTrack(sec.get('track')!) : null;
          life = sec.has('life') ? assembleLife(sec.get('life')!, say) : null;
        }
        extra.push(scene.actor(S[ACTOR_TEMPLATE[0]]!, ACTOR_TEMPLATE[1], parseInt(t[0], 10), body, xyz, {
          beta: num(t, 'facing') || 0, says: says ? addText(island, says) : null, track, life,
          points: num(t, 'life'), armour: num(t, 'armour'), flags: t.includes('flags') ? parseInt(t[t.indexOf('flags') + 1], 16) : null,
        }));
      }
      S.push(extra.length ? scene.addObjects(sc, extra) : sc);
      G.push(G[src]);
      B.push(B[src]);
      log.push(`scene ${idx}: ${meta.get('name') ?? path} (copy of scene ${src})`);
      return;
    }
    lv = lv!;
    const lib = b.lib!;
    const grm = new Map<string, number>();
    for (const name of [...lv.fragments.keys()].sort()) {
      grm.set(name, FIRST + built.length + frags.length - GRM_BASE);
      frags.push(lv.fragments.get(name)!);
    }
    const zones: number[][] = [];
    for (const [kind, args, cells] of lv.zones) {
      for (const r of level.rects(cells)) {
        let bx = box(r);
        if (kind === 'trap' || kind === 'reveal') {
          if (grm.has(kind)) zones.push([...bx, Z_GRM, grm.get(kind)!, 0, 0, 0, 0]);
          if (kind === 'reveal' && meta.has('reveal camera')) {
            const [cx, cz] = meta.get('reveal camera')!.split(/\s+/).map(Number);
            zones.push([...bx, Z_CAMERA, 0, cx, Math.floor(heroY / 256) + 1, cz, 0]);
          }
        } else if (kind === 'exit') {
          let [dest, at, below] = args as [number | string, number[] | null, boolean];
          if (typeof dest === 'string') {  // another level, by file name
            const ns = built.map(e => basename(e.path).replace(/\.[^.]*$/, ''));
            if (!ns.includes(dest)) throw new BuildError(`${path}: exit to unknown level ${dest}`);
            dest = FIRST + ns.indexOf(dest);
          }
          let dx: number, dy: number, dz: number;
          if (at) [dx, dy, dz] = at;
          else if (FIRST <= dest && dest < FIRST + built.length) [dx, dy, dz] = built[dest - FIRST].start;
          else [dx, dy, dz] = cubeStart(S[dest]!);
          // NewPos = hero - (X0, Y0, Z0) + Info: land mid-zone on dest
          const w = Math.floor((bx[3] - bx[0]) / 2), d = Math.floor((bx[5] - bx[2]) / 2);
          const h = lv.heights.get(K(r[0], r[1])) ?? lv.floorY;
          let hereY: number;
          if (below) { bx = box(r, h * 256 - 1); hereY = h * 256; }  // only once he has fallen through the floor
          else hereY = (h + 1) * 256;
          zones.push([...bx, Z_CUBE, dest, dx - w, dy - hereY, dz - d, 0]);
        } else if (kind === 'give') {
          const [what, count] = args as [number, number];
          const h = lv.heights.get(K(r[0], r[1])) ?? lv.floorY;
          const gz = box(overFurniture(r, lv.furniture), (h + 4) * 256);
          zones.push([gz[0], h * 256, ...gz.slice(2), Z_GIVE, 0, what, count, 0, 0]);
        }
      }
    }
    if (zones.length > 255) throw new BuildError(`${path}: ${zones.length} zones (max 255)`);
    const extraLayouts = new Set<number>();
    for (const f of lv.fragments.values()) for (const col of f) for (const colz of col) for (const c of colz) if (layoutOf(c)) extraLayouts.add(layoutOf(c));
    const objects: Bytes[] = [];
    const tpl0 = S[parseInt(meta.get('template') ?? String(lib), 10)]!;
    const island = tpl0[0];
    lv.actors.forEach(([ax, az, ay, f3d, body, anim, wander, says], k) => {
      const [wx, wz] = world(ax, az);
      const sid = says !== null ? addText(island, says) : null;
      objects.push(scene.actor(S[ACTOR_TEMPLATE[0]]!, ACTOR_TEMPLATE[1], f3d, body, [wx, (ay + 1) * 256, wz],
        { beta: (k * 389) % 1024, move: wander ? MOVE_RANDOM : 0, anim, says: sid }));
    });
    let tpl = tpl0;
    if (meta.has('music')) { tpl = tpl.slice(); tpl[scene.HEADER - 1] = parseInt(meta.get('music')!, 10) & 0xff; }  // CubeJingle
    S.push(scene.heroOnly(tpl, idx, start, zones, objects));
    G.push(encodeGrid(lv.cells, extraLayouts));
    B.push(B[lib]);
    log.push(`scene ${idx}: ${meta.get('name') ?? path} (${zones.length} zones)`);
  });
  for (const f of frags) G.push(encodeGrid(f));

  // ── text banks, every language ─────────────────────────────────────────
  for (const [bank, lines] of texts) {
    const langs = Math.floor(T.length / (MAX_TEXT_LANG * 2));
    for (let lang = 0; lang < langs; lang++) {
      const i = (lang * MAX_TEXT_LANG + bank) * 2;
      const o = T[i]!, t = T[i + 1]!;
      const n = o.length / 2;
      const strs: Bytes[] = [];
      for (let j = 0; j < n; j++) strs.push(t.slice(u16(t, 2 * j), u16(t, 2 * (j + 1))));
      const ids: number[] = [];
      for (let j = 0; j < n; j++) ids.push(u16(o, 2 * j));
      for (const [k, s] of lines) { ids.push(k); strs.push(new Buf().add(latin1(s)).push(0).bytes()); }
      const table: number[] = [];
      let pos = 2 * (strs.length + 1);
      for (const st of strs) { table.push(pos); pos += st.length; }
      table.push(pos);
      if (pos > TEXT_MAX || ids.length > 512) throw new BuildError(`text bank ${bank}: too much text (${pos} bytes, ${ids.length} lines)`);
      const ob = new Buf(); for (const id of ids) ob.w16(id); T[i] = ob.bytes();
      const tb = new Buf(); for (const v of table) tb.w16(v); for (const st of strs) tb.add(st); T[i + 1] = tb.bytes();
    }
  }

  // ── the mod's voices: voices/index.json maps a line's text to its clip ──
  const out: Files = new Map();
  const index = mod.has('voices/index.json') ? JSON.parse(text(mod.get('voices/index.json')!)) as Record<string, string> : {};
  for (const [bank, lines] of texts) {
    const n = T[bank * 2]!.length / 2 - lines.length;  // English: the bank before our lines
    const name = String(bank - START_FILE_ISLAND).padStart(3, '0');
    const vox = g(`VOX/EN_${name}.VOX`);
    const voices = new Map<number, Bytes>();
    lines.forEach(([, line], k) => { if (line in index) voices.set(n + k, voice.entry(voice.fromWav(m('voices/' + index[line]), index[line]))); });
    if (!voices.size) continue;  // no clips for this bank: its voices stay as they are
    out.set(`vox/en_${name}.vox`, voice.addToBank(vox, voices));
    log.push(`voices: bank ${name}, ${voices.size} of ${lines.length} lines`);
  }

  const features: string[] = manifest.requires?.features ?? [];
  out.set('text.hqr', hqr.write(T));
  out.set('features', latin1(features.map(f => f + '\n').join('')));
  out.set('scene.hqr', hqr.write(S));
  out.set('lba_gri.hqr', hqr.write(G));
  out.set('lba_bll.hqr', hqr.write(B));
  if (heroModels.size) {
    out.set('file3d.hqr', hqr.write(F3D));
    out.set('anim.hqr', hqr.write(ANIM));
    out.set('body.hqr', hqr.write(BODY));
    out.set('samples.hqr', hqr.write(SAMPLES));
  }
  const hd = new Buf();
  for (let i = 0; i < S.length; i++) hd.w16(heroOf.get(i) ?? 0);
  out.set('hero.dat', hd.bytes());
  return { files: out, features, scenes: names, log };
}

