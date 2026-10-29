// playtest.mjs — play a mod headless, the way a player would: the page
// (platform/web/build) in Chromium, your game folder in through its folder
// picker, the mod folder through "Choose mod folder" (so the page's own
// build and mod check run), then a list of steps.
//
//   node tools/playtest.mjs --game <game folder> [--mod <mod folder>] [steps...]
//
// Steps (in order; keys: up down left right space esc tab ctrl enter 1-8):
//   jump <scene | @name> [x,y,z]   go there (as a door does; x,y,z: where), then 3 s for the fade-in
//   wait <seconds>
//   hold <key> <ms>                hold a key (the engine misses presses under ~200 ms)
//   press <key>                    hold it 250 ms
//   shot <file.png>                screenshot of the game
//   state                          the hero: scene, position, life, behaviour, ...
//   flag <n>                       game flag n
//   dump <scene | @name> [file]    the scene's objects, scripts and zones as text
//                                  (the mod's build if it changed the scene; for
//                                  reading only: never copy it into a mod)
// Each step prints one JSON line. Options: --keep-saves (a mod normally starts
// fresh, at its start), --headed, --build <dir> (default platform/web/build,
// made by make -C platform/web), --url <page> (the published page instead,
// e.g. https://borismus.github.io/lba1-web/: no Emscripten needed).
//
// Things this knows so you don't have to: software GL (otherwise the canvas
// stays white), not calling the engine before its runtime has started (that
// aborts it), holding keys long enough, and a browser profile kept between
// runs (tmpdir/lba-playtest), so the game is copied in once.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, extname, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = name => { const i = args.indexOf(name); if (i >= 0) args.splice(i, 1); return i >= 0; };
const game = opt('--game'), mod = opt('--mod');
const build = resolve(opt('--build') || join(here, '../platform/web/build'));
const pageUrl = opt('--url');
const keepSaves = flag('--keep-saves'), headed = flag('--headed');
if (!game) { console.error('usage: node tools/playtest.mjs --game <game folder> [--mod <mod folder>] [steps...]'); process.exit(2); }
if (!pageUrl && !existsSync(join(build, 'index.html'))) {
  console.error(`no page at ${build}: run make -C platform/web, or use --url https://borismus.github.io/lba1-web/`); process.exit(2);
}
const out = o => console.log(JSON.stringify(o));
const fail = msg => { out({ error: msg }); process.exit(1); };
process.on('unhandledRejection', e => fail(String(e && e.message || e).split('\n')[0]));

// the page, served from build/
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.zip': 'application/zip' };
const server = createServer(async (req, res) => {
  const path = join(build, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
  try { const b = await readFile(path); res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
});
let url = pageUrl;
if (!url) {
  server.listen(0, '127.0.0.1');
  await new Promise(r => server.on('listening', r));
  url = `http://127.0.0.1:${server.address().port}/`;
}

// (one profile per page address: the game is stored per site)
const ctx = await chromium.launchPersistentContext(join(tmpdir(), 'lba-playtest-' + (pageUrl ? new URL(pageUrl).host : 'local')), {
  headless: !headed, viewport: { width: 960, height: 760 },
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const p = ctx.pages()[0] || await ctx.newPage();
p.on('pageerror', e => out({ pageerror: e.message }));
const until = async (f, seconds, arg) => {
  for (let t = 0; t < seconds * 4; t++) { const v = await p.evaluate(f, arg).catch(() => null); if (v) return v; await p.waitForTimeout(250); }
  return null;
};
const visible = id => p.evaluate(id => !document.getElementById(id).hidden, id);

// the game: copied into the page once (the profile keeps it)
await p.goto(url);
const screen = await until(() => (!document.getElementById('setup').hidden && 'setup') || (!document.getElementById('play').hidden && 'play'), 60);
if (screen === 'setup') {
  await p.setInputFiles('#dirinput', resolve(game));
  const r = await until(() => document.getElementById('error').textContent || (document.getElementById('setup').hidden && 'ok'), 300);
  if (r !== 'ok') fail(`game: ${r}`);
  await p.goto(url);  // (it started the original game: back to the Play screen)
  await until(() => !document.getElementById('play').hidden, 60);
} else if (screen !== 'play') fail('the page did not load');

// the mod, built by the page
let info = null;
if (mod) {
  await p.evaluate(() => { document.getElementById('moderror').textContent = ''; document.getElementById('modprogress').textContent = ''; });
  await p.setInputFiles('#moddirinput', resolve(mod));
  const r = await until(() => document.getElementById('moderror').textContent || (/^Built/.test(document.getElementById('modprogress').textContent) && 'ok'), 120);
  if (r !== 'ok') fail(`mod: ${r || 'no answer from the page'}`);
  info = await p.evaluate(() => MODS.list(FS)[0]);
  if (!keepSaves) await p.evaluate(id => MODS.hasSaves(FS, id) && FS.readdir(`/lba/mods/${id}/saves`).forEach(n => n.length > 2 && FS.unlink(`/lba/mods/${id}/saves/${n}`)), info.id);
  out({ mod: info.id, built: await p.textContent('#modprogress'), scenes: info.scenes });
}
// only dumps: no need to play
const STEPS = /^(jump|wait|hold|press|shot|state|flag|dump)$/;
const onlyDumps = args.filter(a => STEPS.test(a)).every(a => a === 'dump');
if (!onlyDumps) {
  if (mod) await p.click('#modplay');
  else {  // the original game: a new game, straight into the first jump's scene (or 0)
    const j = args.indexOf('jump');
    await p.goto(url + '?scene=' + (j >= 0 && /^\d+$/.test(args[j + 1]) ? args[j + 1] : 0));
    await until(() => !document.getElementById('play').hidden, 60);
    await p.click('#playbtn');
  }
  const want = info && info.start ? info.start.scene : null;
  if (!await until(w => running && Module._lba_current_scene() >= 0 && (w === null || Module._lba_current_scene() === w), 90, want))
    fail(mod ? 'the mod did not start (does mod.json have a start?)' : 'the game did not start');
  await p.waitForTimeout(1000);
  await p.focus('#canvas');
}

// the steps
const KEYS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', space: 'Space', esc: 'Escape',
  tab: 'Tab', ctrl: 'Control', enter: 'Enter' };
const key = k => KEYS[k.toLowerCase()] || k;
const scene = s => {
  if (/^@/.test(s)) { const n = info && info.scenes && info.scenes[s.slice(1)]; if (n === undefined) fail(`no scene ${s} in the mod`); return n; }
  return parseInt(s, 10);
};
for (let i = 0; i < args.length;) {
  const step = args[i++];
  if (step === 'jump') {
    const n = scene(args[i++]), at = /^-?\d+,-?\d+,-?\d+$/.test(args[i] || '') ? args[i++].split(',').map(Number) : null;
    await p.evaluate(([n, at]) => at ? Module._lba_jump_at(n, ...at) : Module._lba_jump(n), [n, at]);
    const ok = await until(n => Module._lba_current_scene() === n, 30, n);
    await p.waitForTimeout(3000);  // the scene fades in
    out({ jump: n, ok: !!ok });
  } else if (step === 'wait') { await p.waitForTimeout(1000 * parseFloat(args[i++])); }
  else if (step === 'hold' || step === 'press') {
    const k = key(args[i++]), ms = step === 'hold' ? parseInt(args[i++], 10) : 250;
    await p.keyboard.down(k); await p.waitForTimeout(ms); await p.keyboard.up(k);
  } else if (step === 'shot') {
    const f = args[i++];
    await p.locator('#canvas').screenshot({ path: f });
    out({ shot: f });
  } else if (step === 'state') {
    out(await p.evaluate(() => {
      const h = k => Module._lba_hero_info(k);
      return { scene: Module._lba_current_scene(), chapter: Module._lba_current_chapter(), x: h(0), y: h(1), z: h(2), body: h(3),
        life: h(11), magic: h(12), coins: h(10), keys: h(16), clovers: h(13), behaviour: ['normal', 'athletic', 'aggressive', 'discreet', 'protopack'][h(15)] ?? h(15) };
    }));
  } else if (step === 'flag') {
    const n = parseInt(args[i++], 10);
    out({ flag: n, value: await p.evaluate(n => Module._lba_get_flag(n), n) });
  } else if (step === 'dump') {
    const n = scene(args[i++]), file = args[i] && !STEPS.test(args[i]) ? args[i++] : null;
    const text = await p.evaluate(async ([n, dir]) => {
      const mk = await import('./modkit/index.js');
      const read = f => { try { return FS.readFile(`/lba/${dir}/${f}`); } catch (e) { return FS.readFile(`/lba/${f}`); } };
      return mk.dumpScene(read('scene.hqr'), read('text.hqr'), n);
    }, [n, info ? `mods/${info.id}` : '.']);
    if (file) { await writeFile(file, text); out({ dump: n, file }); } else process.stdout.write(text);
  } else fail(`unknown step: ${step}`);
}
await ctx.close();
if (!pageUrl) server.close();
