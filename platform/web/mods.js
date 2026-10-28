// mods.js — mods (docs/MODS.md) in the page: the player adds a mod package
// (a zip or its folder), we check it holds none of the game's own data,
// build it from the player's copy of the game (modkit, in the browser) and
// keep the result in /lba/mods/<id>/, next to the package itself (package/)
// and the mod's own saves (saves/). Playing it, the engine reads a file from
// there when the build made one (web_sys.c, Module.modDir), the game's
// otherwise; the game's own files are never changed.
'use strict';

const MODS = (() => {
  const ROOT = '/lba/mods';
  const FEATURES = ['hero-models', 'body-pool', 'end-fade'];  // what this engine has (web_sys.c PORT_Feature)
  const BUILD = 1;  // bump when modkit's output changes: stored builds are redone
  const junk = p => /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)/.test(p);
  let kit = null;
  const modkit = async () => kit || (kit = await import('./modkit/index.js'));

  const exists = (FS, p) => { try { FS.stat(p); return true; } catch (e) { return false; } };
  const mkdirs = (FS, p) => { let d = ''; for (const part of p.split('/').filter(Boolean)) { d += '/' + part; if (!exists(FS, d)) FS.mkdir(d); } };
  const walk = (FS, dir, out = [], rel = '') => {
    if (!exists(FS, dir)) return out;
    for (const n of FS.readdir(dir)) {
      if (n === '.' || n === '..') continue;
      const p = dir + '/' + n;
      if (FS.isDir(FS.stat(p).mode)) walk(FS, p, out, rel + n + '/'); else out.push(rel + n);
    }
    return out;
  };
  const rmrf = (FS, p) => {
    if (!exists(FS, p)) return;
    if (FS.isDir(FS.stat(p).mode)) {
      for (const n of FS.readdir(p)) if (n !== '.' && n !== '..') rmrf(FS, p + '/' + n);
      FS.rmdir(p);
    } else FS.unlink(p);
  };
  const json = bytes => JSON.parse(new TextDecoder().decode(bytes));

  // picks (LBA.fromDrop / fromInput) -> the package's files {path: bytes},
  // paths relative to its mod.json
  async function read(picks, progress) {
    const entries = (await LBA.collect(await picks, progress, p => !junk(p))).filter(e => !junk(e.path));
    const manifests = entries.filter(e => /(^|\/)mod\.json$/i.test(e.path))
      .sort((a, b) => a.path.split('/').length - b.path.split('/').length);
    if (!manifests.length)
      throw new Error("That isn't a mod: there's no mod.json in it. (To play the original game, use the Play button.)");
    const root = manifests[0].path.slice(0, -'mod.json'.length);
    const files = new Map();
    for (const e of entries) if (e.path.startsWith(root)) files.set(e.path.slice(root.length), await e.read());
    return files;
  }

  // the player's game files, under the names modkit asks for (SCENE.HQR, VOX/EN_000.VOX)
  function gameFiles(FS) {
    const files = new Map();
    for (const p of walk(FS, '/lba')) {
      if (p.startsWith('mods/') || !/\.(hqr|vox|lst)$/i.test(p)) continue;
      files.set(p.toUpperCase(), FS.readFile('/lba/' + p));
    }
    return files;
  }

  // what the page shows and the engine needs, from a manifest and its build
  function describe(manifest, scenes) {
    const s = manifest.start;
    let start = null;
    if (s && s.scene !== undefined) {
      const name = String(s.scene);
      const scene = name.startsWith('@') ? scenes[name.slice(1)] : /^scene:\d+$/.test(name) ? +name.slice(6) : +name;
      if (scene === undefined || Number.isNaN(scene)) throw new Error(`mod.json: start scene ${name} isn't one the mod makes.`);
      start = { scene, at: Array.isArray(s.at) && s.at.length === 3 ? s.at.map(Number) : null };
    }
    return { id: manifest.id, name: manifest.name || manifest.id, version: manifest.version || '',
             description: manifest.description || '', credits: manifest.credits || '', start, build: BUILD };
  }

  // -> the manifest, or throws an Error for the player
  function validate(files, installed) {
    let m;
    try { m = json(files.get('mod.json')); } catch (e) { throw new Error(`mod.json isn't valid JSON: ${e.message}`); }
    if (m.format !== 1) throw new Error(`This mod is in a format this page doesn't know (format ${m.format}).`);
    if (typeof m.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(m.id)) throw new Error('mod.json: its id must be lowercase letters, digits and dashes.');
    const req = m.requires || {};
    const missing = (req.features || []).filter(f => !FEATURES.includes(f));
    if (missing.length) throw new Error(`${m.name || m.id} needs engine features this page doesn't have yet (${missing.join(', ')}).`);
    const releases = req.releases || [];
    if (releases.length && installed && !releases.includes(installed.releaseId))
      m.untested = `made for ${releases.join(', ')}; your copy of the game is ${installed.release || 'one we have not tested'}`;
    return m;
  }

  // check and build a package, then store it: -> its description
  async function add(FS, files, installed, progress) {
    const m = validate(files, installed);
    const mk = await modkit();
    progress('Checking the mod has none of the game\'s own data in it…');
    await new Promise(r => setTimeout(r, 30));
    const game = gameFiles(FS);
    const hits = mk.check(game, files);
    if (hits.length) {
      const h = hits[0];
      throw new Error(`${m.name || m.id} contains data copied from the game (${h.file}, byte ${h.at}: the same as ${h.base}). Mods must not include the game's files; this one can't be used.`);
    }
    progress(`Building ${m.name || m.id} from your copy of the game…`);
    await new Promise(r => setTimeout(r, 30));
    const built = mk.build(game, files);
    const info = describe(m, Object.fromEntries(built.scenes));
    info.untested = m.untested || '';
    // one mod at a time: another mod goes (with its saves); the same mod
    // again (an update) keeps its saves
    for (const other of list(FS)) if (other.id !== m.id) rmrf(FS, `${ROOT}/${other.id}`);
    const dir = `${ROOT}/${m.id}`;
    for (const n of exists(FS, dir) ? FS.readdir(dir) : []) if (n !== '.' && n !== '..' && n !== 'saves') rmrf(FS, `${dir}/${n}`);
    for (const [path, bytes] of files) { mkdirs(FS, `${dir}/package/${path}`.replace(/\/[^/]*$/, '')); FS.writeFile(`${dir}/package/${path}`, bytes); }
    for (const [path, bytes] of built.files) { mkdirs(FS, `${dir}/${path}`.replace(/\/[^/]*$/, '')); FS.writeFile(`${dir}/${path}`, bytes); }
    FS.writeFile(`${dir}/.built`, JSON.stringify(info));
    console.log(built.log.join('\n'));
    return info;
  }

  // a stored mod built by an older modkit: built again from its package
  async function refresh(FS, info, installed, progress) {
    if (info.build === BUILD) return info;
    const files = new Map(walk(FS, `${ROOT}/${info.id}/package`).map(p => [p, FS.readFile(`${ROOT}/${info.id}/package/${p}`)]));
    return add(FS, files, installed, progress);
  }

  function list(FS) {
    const out = [];
    if (!exists(FS, ROOT)) return out;
    for (const id of FS.readdir(ROOT)) {
      if (id === '.' || id === '..') continue;
      try { out.push(json(FS.readFile(`${ROOT}/${id}/.built`))); } catch (e) { /* half-written: ignore */ }
    }
    return out;
  }

  const remove = (FS, id) => rmrf(FS, `${ROOT}/${id}`);
  const hasSaves = (FS, id) => walk(FS, `${ROOT}/${id}/saves`).some(n => /\.lba$/i.test(n));

  return { read, add, refresh, list, remove, hasSaves };
})();
