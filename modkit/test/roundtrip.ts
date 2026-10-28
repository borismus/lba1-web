// Every original script round-trips through the listing syntax, byte for
// byte; every original grid re-encodes to the same cells.
//   node test/roundtrip.ts <the game's DOS data dir>
import { readFileSync } from 'node:fs';
import * as hqr from '../src/hqr.ts';
import { lifeSource, trackSource, assembleLife, assembleTrack } from '../src/script.ts';
import { sceneObjects } from '../src/scene.ts';
import { decodeGrid, encodeGrid } from '../src/grid.ts';
import { equal } from '../src/bytes.ts';

const data = process.argv[2];
const S = hqr.read(readFileSync(data + '/SCENE.HQR'));
let scripts = 0, bad = 0;
S.forEach((sc, n) => {
  if (!sc) return;
  for (const ob of sceneObjects(sc)) {
    for (const [kind, code] of [['life', ob.life], ['track', ob.track]] as const) {
      if (code.length <= 1) continue;
      scripts++;
      const back = kind === 'life' ? assembleLife(lifeSource(code)) : assembleTrack(trackSource(code));
      if (!equal(back, code)) {
        bad++;
        if (bad <= 5) {
          let i = 0; while (i < code.length && back[i] === code[i]) i++;
          console.log(`scene ${n} object ${ob.index} ${kind}: differs at byte ${i} (${code.length} vs ${back.length})`);
        }
      }
    }
  }
});
console.log(`scripts: ${scripts - bad}/${scripts} round-trip byte for byte`);
const G = hqr.read(readFileSync(data + '/LBA_GRI.HQR'));
let grids = 0, gbad = 0;
G.forEach((g, n) => {
  if (!g) return;
  grids++;
  const a = decodeGrid(g), b = decodeGrid(encodeGrid(a.cells));
  if (JSON.stringify(a.cells) !== JSON.stringify(b.cells)) { gbad++; console.log(`grid ${n}: cells differ`); }
});
console.log(`grids: ${grids - gbad}/${grids} re-encode to the same cells`);
process.exit(bad || gbad ? 1 : 0);
