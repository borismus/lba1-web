// mod check: a clean mod passes, one with a slice of SCENE.HQR hidden in it fails.
//   node test/check.ts <game's DOS data dir> <mod folder>
import { check } from '../src/check.ts';
import { gameFiles, modFiles } from './files.ts';

const [data, modDir] = process.argv.slice(2);
const game = gameFiles(data), mod = modFiles(modDir);
let t0 = performance.now();
const clean = check(game, mod);
console.log(`${modDir}: ${clean.length} matches (${Math.round(performance.now() - t0)} ms)`);
const bad = new Map(mod);
const scene = game.get('SCENE.HQR')!;
const s = bad.get('scripts/zoe_gone.script')!;
const doctored = new Uint8Array(s.length + 202); doctored.set(s); doctored.set([10, 35], s.length); doctored.set(scene.subarray(5000, 5200), s.length + 2);
bad.set('scripts/zoe_gone.script', doctored);
t0 = performance.now();
const hits = check(game, bad);
console.log(`doctored copy: ${hits.length} matches (${Math.round(performance.now() - t0)} ms)`, hits.slice(0, 2));
process.exit(clean.length === 0 && hits.length > 0 ? 0 : 1);
