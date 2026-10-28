// House walls for the Rabbibunny-house tile set (libraries 5, 16, 20, 29, ...:
// all identical), built the way the original houses are (grids 5, 16, 29).
//
// - Back walls (open to the outside on the -x or -z side) are plaster, full
//   height, all up to the same top, with a wood trim cap.
// - Every other wall is cut away so the camera sees in: a low wall with a
//   trim cap 3 cells above the floor. Outside walls stand on a brick
//   foundation; a wall between two floor heights (a railing) is brick.
// - Where a back wall meets a front wall, the corner stays full height and
//   the trim sweeps down over the next two cells.
// - Doorways in low walls: 3 wide gets jambs, sweeping sides and an arch
//   (2 plain wall cells needed on each side); other widths are open passages.
// - Front door (3 wide, in a wall along x on the +z side): the stone door
//   between two pillars. It doesn't open; put an exit zone in front of it.
// - Stairs descend toward +x (layout 103 is the only step), one cell per
//   step, from the floor before the first step down to the floor after.
//
// Cells are (x, z), keyed "x,z"; heights are floor brick y (the surface is
// at y + 1). Map and Set keep insertion order, as the Python reference's
// dicts do: later pieces overwrite earlier ones, so the order matters.
import { type Cells, type Layout, cell } from './grid.ts';

const STEP = 103;
const PLASTER_X = 5, PLASTER_Z = 4;          // 4x8x1, 1x8x4
const BRICK = 8, FOUNDATION = 13;            // 1x2x1 each
const SOLID: [number, number] = [0, 1];      // invisible collision cell
const JAMB_X0 = 58, JAMB_Z0 = 59, JAMB_1 = 60;
const SWEEP_HI_LO: Record<string, number> = { x: 48, z: 49 };  // 2-cell sweep, high end at the low coord
const SWEEP_LO_HI: Record<string, number> = { x: 50, z: 51 };  // high end at the high coord
const FILL: Record<string, number> = { x: 52, z: 53 };          // 1x2x1 filler above a corner sweep
const FILL_TOP: Record<string, number> = { x: 63, z: 62 };
const ARCH: Record<string, number> = { x: 29, z: 30 };          // 5x4x1, 1x4x5
const DOOR = 93, PILLAR_0 = 91, PILLAR_1 = 92;
const DOOR_BASE = 10;
const DIRS: [string, number, number][] = [['W', -1, 0], ['E', 1, 0], ['N', 0, -1], ['S', 0, 1]];
const CAPS: Record<string, number> = {
  WE: 56, W: 56, E: 56, '': 56, NS: 57, N: 57, S: 57,
  ES: 18, WN: 19, EN: 16, WS: 67,
  ENS: 21, WES: 22, WEN: 20, WNS: 20, WENS: 20,
};

export const K = (x: number, z: number): string => `${x},${z}`;
export const XZ = (k: string): [number, number] => k.split(',').map(Number) as [number, number];
// Python's min(cells, key=lambda c: (c[1], c[0]))
const first = (cells: Iterable<string>): [number, number] => {
  let best: [number, number] | null = null;
  for (const k of cells) { const c = XZ(k); if (!best || c[1] < best[1] || (c[1] === best[1] && c[0] < best[0])) best = c; }
  return best!;
};

// -> straight runs of neighbouring cells, [cells in order, 'x' | 'z']
export function runs(cells: Iterable<string>): [[number, number][], string][] {
  const left = new Set(cells), out: [[number, number][], string][] = [];
  while (left.size) {
    const [x, z] = first(left);
    const ax = left.has(K(x + 1, z)) ? 'x' : 'z';
    const run: [number, number][] = [[x, z]];
    for (;;) {
      const [lx, lz] = run[run.length - 1];
      const n = ax === 'x' ? [lx + 1, lz] : [lx, lz + 1];
      if (!left.has(K(n[0], n[1]))) break;
      run.push([n[0], n[1]]);
    }
    for (const [a, b] of run) left.delete(K(a, b));
    out.push([run, ax]);
  }
  return out;
}

// outside walls where a back wall ends (they stay full height)
function cornersOf(back: Set<string>, walls: Map<string, number | null>, inside: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const k of walls.keys()) {
    if (back.has(k)) continue;
    const [x, z] = XZ(k);
    const nb = DIRS.map(([, dx, dz]) => K(x + dx, z + dz));
    if (nb.some(c => back.has(c)) && nb.some(c => !inside.has(c))) out.add(k);
  }
  return out;
}

class Stop extends Error {}

// walls: (x, z) -> plaster layout or null; doors, fdoors, stairs: sets.
// heights: (x, z) -> floor y for every floor cell (doors included); stairs
// are added. Writes cells[x][z][y].
export function build(cells: Cells, layouts: Layout[], heights: Map<string, number>, walls: Map<string, number | null>,
                      doors: Set<string>, fdoors: Set<string>, stairs: Set<string>, fy: number): void {
  const put = (lay: number, x: number, y: number, z: number, idx: number) => {
    if (y >= 0 && y < cells[x][z].length) cells[x][z][y] = cell(lay, idx);
  };
  const solid = (x: number, y: number, z: number) => put(SOLID[0], x, y, z, SOLID[1]);

  // stairs: runs along +x, stepping down from the floor before the run
  const sortedStairs = [...stairs].map(XZ).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [x, z] of sortedStairs) {
    let x0 = x;
    while (stairs.has(K(x0 - 1, z))) x0--;
    if (!heights.has(K(x0 - 1, z))) throw new Stop(`stairs at ${x0},${z}: no floor on the -x side`);
    const y = heights.get(K(x0 - 1, z))! - (x - x0);
    heights.set(K(x, z), y);
    put(STEP, x, y, z, 0);
    solid(x, y - 1, z);
  }
  for (const k of stairs) {
    const [x, z] = XZ(k);
    let x1 = x;
    while (stairs.has(K(x1 + 1, z))) x1++;
    if (heights.get(K(x1 + 1, z)) !== heights.get(K(x1, z))! - 1)
      throw new Stop(`stairs at ${x1},${z}: the floor after them should be at y=${heights.get(K(x1, z))! - 1}`);
  }

  // 3-wide doorways get an arch and count as wall (for the trim shapes); any
  // other width is an open passage where the wall just stops
  const doorRuns = runs(doors);
  const arched = new Set<string>();
  for (const [run] of doorRuns) if (run.length === 3) for (const [a, b] of run) arched.add(K(a, b));
  const wallish = new Set([...walls.keys(), ...arched, ...fdoors]);
  const inside = new Set([...heights.keys(), ...wallish]);
  const top = Math.max(...heights.values()) + 9;

  const out = (x: number, z: number) => !inside.has(K(x, z));
  const around = (x: number, z: number): number[] => {
    // floor heights next to a wall (stairs only straight across)
    const hs: number[] = [];
    for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
      const c = K(x + dx, z + dz);
      if (heights.has(c) && (!stairs.has(c) || dx === 0 || dz === 0)) hs.push(heights.get(c)!);
    }
    return hs.length ? hs : [fy];
  };
  const mask = (x: number, z: number, among: Set<string>) => DIRS.filter(([, dx, dz]) => among.has(K(x + dx, z + dz))).map(d => d[0]).join('');
  const isBack = (x: number, z: number) => (out(x - 1, z) || out(x, z - 1)) && !(out(x + 1, z) || out(x, z + 1));
  const alongOf = (m: string) => (/[WE]/.test(m) && !/[NS]/.test(m)) ? 'x' : (/[NS]/.test(m) && !/[WE]/.test(m)) ? 'z' : null;

  const back = new Set([...walls.keys()].filter(k => isBack(...XZ(k))));
  const tall = cornersOf(back, walls, inside);  // where a back wall ends at a front wall
  const capped = new Map<string, number>();     // (x, z) -> cap y; dropped where a sweep replaces the cap

  const foundation = (x: number, z: number, upto: number) => {
    // brick from the ground up to y=upto (inclusive)
    for (let y = 0; y <= upto; y++) put(y < 2 ? FOUNDATION : BRICK, x, y, z, y % 2);
  };

  for (const [k, tex] of walls) {
    const [x, z] = XZ(k);
    const hs = around(x, z);
    const hi = Math.max(...hs), lo = Math.min(...hs);
    const m = mask(x, z, wallish);
    let along = alongOf(m);
    if (back.has(k)) {
      solid(x, hi, z);
      const bm = mask(x, z, new Set([...back, ...tall]));
      along = alongOf(bm);
      if (along) {
        const lay = tex || (along === 'x' ? PLASTER_X : PLASTER_Z);
        const d = layouts[lay - 1];
        for (let y = hi + 1; y < top; y++) {
          const oy = (y - hi - 1) % d.dy;
          put(lay, x, y, z, (x % d.dx) + oy * d.dx + (z % d.dz) * d.dx * d.dy);
        }
      }
      put(CAPS[bm] ?? 56, x, top, z, 0);
      continue;
    }
    const exterior = DIRS.some(([, dx, dz]) => out(x + dx, z + dz));
    const nbBack = DIRS.filter(([, dx, dz]) => back.has(K(x + dx, z + dz))).map(d => d[0]);
    if (exterior && nbBack.length) {
      // tall corner where the back wall ends; the trim sweeps down
      foundation(x, z, top - 1);
      put(nbBack.includes('W') ? 67 : 66, x, top, z, 0);
      continue;
    }
    if (exterior) foundation(x, z, hi + 2);
    else if (lo === hi) {
      solid(x, hi, z);
      const lay = along !== 'z' ? PLASTER_X : PLASTER_Z;
      for (const oy of [0, 1])
        put(lay, x, hi + 1 + oy, z, lay === PLASTER_X ? (x % 4) + oy * 4 : oy + (z % 4) * 8);
    } else {
      solid(x, lo, z);
      for (let y = lo + 1; y < hi + 3; y++) put(BRICK, x, y, z, y % 2);
    }
    capped.set(k, hi + 3);
    put(CAPS[m] ?? 56, x, hi + 3, z, 0);
  }

  // sweeps beside tall corners
  for (const k of walls.keys()) {
    const [x, z] = XZ(k);
    if (back.has(k) || !DIRS.some(([, dx, dz]) => out(x + dx, z + dz))) continue;
    const nbBack = DIRS.filter(([, dx, dz]) => back.has(K(x + dx, z + dz))).map(d => d[0]);
    if (!nbBack.length) continue;
    // the front wall runs away from the corner, along +z (corner at the -z
    // end, back wall to its W) or along +x (back wall to its N)
    const [ax, sx, sz] = nbBack.includes('W') ? ['z', 0, 1] as const : ['x', 1, 0] as const;
    for (const j of [0, 1]) {
      const cx = x + sx * (j + 1), cz = z + sz * (j + 1), c = K(cx, cz);
      if (!walls.has(c) || !capped.has(c)) break;
      const hi = capped.get(c)! - 3;
      capped.delete(c);
      for (let oy = 0; oy < 4; oy++) {
        const idx = ax === 'x' ? j + oy * 2 : oy + j * 4;
        put(SWEEP_HI_LO[ax], cx, hi + 3 + oy, cz, idx);
      }
      for (let y = hi + 7; y < top; y++) {
        if (j === 0) put(y >= top - 2 ? FILL_TOP[ax] : FILL[ax], cx, y, cz, y >= top - 2 ? y - (top - 2) : (y - hi - 7) % 2);
        else solid(cx, y, cz);
      }
    }
  }

  // doorways
  const claimed = new Map<string, [number, number]>();
  for (const [run, ax] of doorRuns) {
    const [x0, z0] = run[0], n = run.length;
    if (n !== 3) continue;  // open passage
    const [dx, dz] = ax === 'x' ? [1, 0] : [0, 1];
    const at = (k: number): [number, number] => [x0 + dx * k, z0 + dz * k];
    for (const k of [-2, -1, 3, 4]) {
      const [cx, cz] = at(k), c = K(cx, cz);
      const m = mask(cx, cz, new Set([...walls.keys(), ...doors]));
      if (!walls.has(c) || back.has(c) || (/[WE]/.test(m) && /[NS]/.test(m)))
        throw new Stop(`doorway at ${x0},${z0} needs 2 plain low wall cells on each side (not a corner or a junction)`);
      if (claimed.has(c)) throw new Stop(`doorways at ${x0},${z0} and ${claimed.get(c)!.join(',')} are too close`);
      claimed.set(c, [x0, z0]);
    }
    const hi = heights.get(K(...run[0]))!;
    for (const [k, lay] of [[-1, ax === 'x' ? JAMB_X0 : JAMB_Z0], [3, JAMB_1]]) {
      const [cx, cz] = at(k);
      put(lay, cx, hi + 1, cz, 0);
      put(lay, cx, hi + 2, cz, 1);
    }
    for (const [ks, lay] of [[[-2, -1], SWEEP_LO_HI[ax]], [[3, 4], SWEEP_HI_LO[ax]]] as [number[], number][]) {
      ks.forEach((k, j) => {
        const [cx, cz] = at(k);
        capped.delete(K(cx, cz));
        for (let oy = 0; oy < 4; oy++) put(lay, cx, hi + 3 + oy, cz, ax === 'x' ? j + oy * 2 : oy + j * 4);
      });
    }
    for (let j = 0; j < 5; j++) {
      const [cx, cz] = at(j - 1);
      for (let oy = 0; oy < 4; oy++) put(ARCH[ax], cx, hi + 7 + oy, cz, ax === 'x' ? j + oy * 5 : oy + j * 4);
    }
  }

  // front doors
  for (const [run, ax] of runs(fdoors)) {
    const [x0, z0] = run[0], n = run.length;
    if (n !== 3 || ax !== 'x') throw new Stop(`front door at ${x0},${z0}: must be 3 wide along x`);
    const hi = Math.max(...around(x0 + 1, z0));
    for (const [k, lay, cap] of [[-1, PILLAR_0, 90], [3, PILLAR_1, 67]]) {
      const x = x0 + k;
      for (let y = 0; y <= top; y++) put(0, x, y, z0, 0);
      foundation(x, z0, hi - 2);
      for (let oy = 0; oy < 9; oy++) put(lay, x, hi - 1 + oy, z0, oy);
      put(cap, x, hi + 8, z0, 0);
      capped.delete(K(x, z0));
    }
    for (let j = 0; j < 3; j++) {
      const x = x0 + j;
      foundation(x, z0, hi - 3);
      put(DOOR_BASE, x, hi - 2, z0, 0);
      for (let oy = 0; oy < 9; oy++) put(DOOR, x, hi - 1 + oy, z0, j + oy * 3);
      put(56, x, hi + 8, z0, 0);
    }
  }
}
