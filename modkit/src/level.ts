// Text level format -> LBA1 grid + scene. The format is documented in the
// Python reference (levelkit/level.py): a level file has meta lines
// ('key: value'), a legend (a symbol, then what it is) and a map (rows along
// +z, columns along +x; ' ' is void).
import { type Cells, type Layout, SX, SY, SZ, CLEAR, cell, emptyCells } from './grid.ts';
import { build as buildHouse, K } from './house.ts';

const FLOOR_Y = 0;
const GIVE: Record<string, number> = { money: 0x10, life: 0x20, magic: 0x40, key: 0x80, clover: 0x100 };
const MODS: Record<string, number> = { trap: 1, hint: 1, reveal: 0, exit: 1, at: 3, give: 2, low: 0, over: 1, up: 1, below: 0 };

// ['floor', '135', 'trap', '~'] -> [['floor', '135'], {trap: ['~']}]
export function splitMods(spec: string[]): [string[], Map<string, string[]>] {
  for (let i = 0; i < spec.length; i++) {
    if (spec[i] in MODS) {
      const base = spec.slice(0, i), mods = new Map<string, string[]>();
      let j = i;
      while (j < spec.length) {
        const k = spec[j];
        if (!(k in MODS)) throw new Error(`unknown modifier ${k} in ${spec.join(' ')}`);
        mods.set(k, spec.slice(j + 1, j + 1 + MODS[k]));
        j += 1 + MODS[k];
      }
      return [base, mods];
    }
  }
  return [spec, new Map()];
}

export interface Parsed { meta: Map<string, string>; legend: Map<string, string[]>; rows: string[] }

// Comments: '# ...' after whitespace on meta and legend lines (a legend
// line's first character is its symbol, so '#' can be a symbol).
export function parse(text: string): Parsed {
  const meta = new Map<string, string>(), legend = new Map<string, string[]>(), rows: string[] = [];
  let section: string | null = null;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    if (section === 'map') { rows.push(raw.startsWith('  ') ? raw.slice(2) : raw); continue; }
    if (!raw.trim() || raw.startsWith('#')) continue;
    if (!raw.startsWith(' ')) {
      const c = raw.indexOf(':');
      const key = (c < 0 ? raw : raw.slice(0, c)).trim(), value = c < 0 ? '' : raw.slice(c + 1);
      if (key === 'legend' || key === 'map') section = key;
      else meta.set(key, value.split(' #', 1)[0].trim());
      continue;
    }
    if (section === 'legend') {
      let body = raw.trim(), said: string | null = null;
      const s = body.indexOf(' says ');
      if (s >= 0) { said = body.slice(s + 6); body = body.slice(0, s); }  // the rest of the line is dialogue
      const tokens: string[] = [];
      for (const t of body.slice(1).split(/\s+/).filter(Boolean)) { if (t.startsWith('#')) break; tokens.push(t); }
      if (said !== null) tokens.push('says', said.trim());
      legend.set(body[0], tokens);
    }
  }
  while (rows.length && !rows[rows.length - 1].trim()) rows.pop();
  return { meta, legend, rows };
}

export type ZoneArgs = unknown[];
export interface Level {
  cells: Cells; fragments: Map<string, Cells>; start: [number, number] | null; startY: number;
  actors: [number, number, number, number, number, number, boolean, string | null][];
  floorY: number; heights: Map<string, number>; furniture: Set<string>;
  zones: [string, ZoneArgs, Set<string>][];
}

export function buildCells(legend: Map<string, string[]>, rows: string[], layouts: Layout[], meta: Map<string, string> = new Map()): Level {
  const cells = emptyCells();
  const lv: Level = { cells, fragments: new Map(), start: null, startY: 0, actors: [], floorY: 0, heights: new Map(), furniture: new Set(), zones: [] };
  const raiseSym = meta.get('raise');
  const fy = lv.floorY = raiseSym ? 1 : parseInt(meta.get('ground') ?? String(FLOOR_Y), 10);
  const heights = lv.heights;  // (x, z) -> floor brick y
  const isHouse = (meta.get('house') ?? 'no') === 'yes';
  const hwalls = new Map<string, number | null>(), hdoors = new Set<string>(), hfdoors = new Set<string>(), hstairs = new Set<string>();
  const groups = new Map<string, { kind: string; args: ZoneArgs; cells: Set<string> }>();  // (kind, args) -> cells
  const group = (kind: string, args: ZoneArgs, x: number, z: number) => {
    const k = JSON.stringify([kind, args]);
    if (!groups.has(k)) groups.set(k, { kind, args, cells: new Set() });
    groups.get(k)!.cells.add(K(x, z));
  };

  const put = (lay: number, x: number, y: number, z: number, ox = 0, oy = 0, oz = 0, into: Cells | null = null) => {
    const d = layouts[lay - 1];
    if (x >= 0 && x < SX && y >= 0 && y < SY && z >= 0 && z < SZ)
      (into ?? cells)[x][z][y] = cell(lay, ox + oy * d.dx + oz * d.dx * d.dy);
  };
  const floor = (lay: number, x: number, z: number, into: Cells | null = null, y: number | null = null) => {
    const d = layouts[lay - 1];
    put(lay, x, y === null ? fy : y, z, x % d.dx, 0, z % d.dz, into);
  };
  const floorOfLow = (sym: string, x: number, z: number, into: Cells | null = null) => {
    const [spec] = splitMods(legend.get(sym)!);
    floor(parseInt(spec[1], 10), x, z, into, 0);
  };
  // sym's floor at (x, z): raised floors get their 'over' (or the level's
  // raise tile) underneath; 'low' floors clear the raised cell
  const floorOf = (sym: string, x: number, z: number, into: Cells | null = null) => {
    const [spec, mods] = splitMods(legend.get(sym)!);
    if (spec[0] !== 'floor') return;
    if (!raiseSym) {
      const y = fy + parseInt((mods.get('up') ?? ['0'])[0], 10);
      floor(parseInt(spec[1], 10), x, z, into, y);
      if (into === null) heights.set(K(x, z), y);
      return;
    }
    if (mods.has('low')) {
      floor(parseInt(spec[1], 10), x, z, into, 0);
      if (into !== null) into[x][z][fy] = CLEAR;  // removes the raised cell
      if (into === null) heights.set(K(x, z), 0);
      return;
    }
    floor(parseInt(spec[1], 10), x, z, into);
    if (into === null) heights.set(K(x, z), fy);
    const under = mods.has('over') ? mods.get('over')![0] : raiseSym;
    floorOfLow(under, x, z, into);
  };
  const frag = (name: string): Cells => {
    if (!lv.fragments.has(name)) lv.fragments.set(name, emptyCells());
    return lv.fragments.get(name)!;
  };

  rows.forEach((row, z) => {
    [...row].forEach((sym, x) => {
      if (sym === ' ') return;
      if (!legend.has(sym)) throw new Error(`unknown symbol ${JSON.stringify(sym)} at row ${z} col ${x}`);
      const [spec, mods] = splitMods(legend.get(sym)!);
      const kind = spec[0];
      if (kind === 'floor') floorOf(sym, x, z);
      else if (isHouse && ['wall', 'door', 'frontdoor', 'stairs'].includes(kind)) {
        if (kind === 'wall') hwalls.set(K(x, z), spec.length > 1 ? parseInt(spec[1], 10) : null);
        else if (kind === 'door') {
          if (spec.length < 3 || spec[1] !== 'on') throw new Error('door: needs "on <floor>"');
          floorOf(spec[2], x, z);
          hdoors.add(K(x, z));
        } else (kind === 'frontdoor' ? hfdoors : hstairs).add(K(x, z));
      } else if (kind === 'wall') {
        const lay = parseInt(spec[1], 10), height = spec.length > 2 ? parseInt(spec[2], 10) : 0;
        const d = layouts[lay - 1];
        if (spec.length > 3 && spec[3] === 'on') floorOf(spec[4], x, z);
        let y = fy;
        for (;;) {
          for (let oy = 0; oy < d.dy; oy++) put(lay, x, y + oy, z, x % d.dx, oy, z % d.dz);
          y += d.dy;
          if (y >= fy + height) break;
        }
      } else if (kind === 'object') {
        const lay = parseInt(spec[1], 10);
        if (spec.length >= 3 && spec[2] === 'on') floorOf(spec[3], x, z);
        const d = layouts[lay - 1];
        const base = (heights.get(K(x, z)) ?? fy) + 1;
        for (let oy = 0; oy < d.dy; oy++) for (let oz = 0; oz < d.dz; oz++) for (let ox = 0; ox < d.dx; ox++)
          put(lay, x + ox, base + oy, z + oz, ox, oy, oz);
        for (let ox = 0; ox < d.dx; ox++) for (let oz = 0; oz < d.dz; oz++) lv.furniture.add(K(x + ox, z + oz));
      } else if (kind === 'barrier') {
        const h = spec.length > 1 ? parseInt(spec[1], 10) : 3;
        for (let y = fy; y < fy + h; y++) if (y < SY) cells[x][z][y] = cell(0, 1);
      } else if (kind === 'actor') {
        // actor F3D [body B] [anim A] [wander] [on C] [says ...]
        const f3d = parseInt(spec[1], 10);
        let body = 0, anim = 0, wander = false, on: string | null = null, says: string | null = null;
        for (let i = 2; i < spec.length;) {
          if (spec[i] === 'body') { body = parseInt(spec[i + 1], 10); i += 2; }
          else if (spec[i] === 'says') { says = spec[i + 1]; i += 2; }
          else if (spec[i] === 'anim') { anim = parseInt(spec[i + 1], 10); i += 2; }
          else if (spec[i] === 'wander') { wander = true; i += 1; }
          else if (spec[i] === 'on') { on = spec[i + 1]; i += 2; }
          else throw new Error(`actor: unknown ${spec[i]}`);
        }
        if (on) floorOf(on, x, z);
        lv.actors.push([x, z, heights.get(K(x, z)) ?? fy, f3d, body, anim, wander, says]);
      } else if (kind === 'start') {
        if (spec.length >= 3 && spec[1] === 'on') floorOf(spec[2], x, z);
        lv.start = [x, z];
        lv.startY = heights.get(K(x, z)) ?? fy;
      } else throw new Error(`unknown legend kind ${kind}`);

      if (mods.has('trap')) {
        if (mods.get('trap')![0] === 'open') frag('trap')[x][z][heights.get(K(x, z)) ?? fy] = CLEAR;  // a trap door: the floor goes
        else floorOf(mods.get('trap')![0], x, z, frag('trap'));
        group('trap', [], x, z);
      }
      if (mods.has('hint')) floor(parseInt(mods.get('hint')![0], 10), x, z, frag('reveal'));
      if (mods.has('reveal')) group('reveal', [], x, z);
      if (mods.has('exit')) {
        const dest = mods.get('exit')![0];
        const at = mods.has('at') ? mods.get('at')!.map(Number) : null;
        group('exit', [/^\d+$/.test(dest) ? parseInt(dest, 10) : dest, at, mods.has('below')], x, z);
      }
      if (mods.has('give')) {
        const [what, n] = mods.get('give')!;
        if (!(what in GIVE)) throw new Error(`give: unknown ${what} (${Object.keys(GIVE).join('|')})`);
        group('give', [GIVE[what], parseInt(n, 10)], x, z);
      }
    });
  });
  if (isHouse) buildHouse(cells, layouts, heights, hwalls, hdoors, hfdoors, hstairs, fy);
  if (lv.start === null) throw new Error('level has no start (S) tile');
  if (lv.fragments.has('reveal') && !groups.has(JSON.stringify(['reveal', []])))
    throw new Error("level has 'hint' cells but no 'reveal' cell to show them");
  lv.zones = [...groups.values()].map(g => [g.kind, g.args, g.cells]);
  return lv;
}

// Cover a set of (x, z) cells with few axis-aligned rectangles (greedy: grow
// along x, then along z). -> [x0, z0, x1, z1] inclusive.
export function rects(cellSet: Set<string>): [number, number, number, number][] {
  const left = new Set(cellSet), out: [number, number, number, number][] = [];
  while (left.size) {
    let x0 = 0, z0 = 0, have = false;
    for (const k of left) {
      const [x, z] = k.split(',').map(Number);
      if (!have || z < z0 || (z === z0 && x < x0)) { x0 = x; z0 = z; have = true; }
    }
    let x1 = x0;
    while (left.has(K(x1 + 1, z0))) x1++;
    let z1 = z0;
    for (;;) {
      let all = true;
      for (let x = x0; x <= x1; x++) if (!left.has(K(x, z1 + 1))) { all = false; break; }
      if (!all) break;
      z1++;
    }
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) left.delete(K(x, z));
    out.push([x0, z0, x1, z1]);
  }
  return out;
}
