// loader.js — the player's own copy of LBA1, into the browser.
//
// Whatever the player gives us (a zip, the game's folder, GOG's Mac app,
// which is a folder too, or loose files) becomes a flat list of entries
// {path, size, read()}. In it we look for the DOS data: the folder with the
// game's 14 HQR archives and SETUP.LST (GOG: Speedrun/Windows), plus, if
// there, the English (or LBA.CFG's language) voices, VOX/*.VOX, and GOG's
// rendered soundtrack, LBA1-NN.mp3. install() writes them, lowercased, into
// /lba, where the engine reads them (web_sys.c lowercases its paths too).
// Nothing leaves the browser.
'use strict';

const LBA = (() => {
  const HQRS = ['anim', 'body', 'file3d', 'invobj', 'lba_bll', 'lba_brk', 'lba_gri',
    'midi_mi', 'midi_sb', 'ress', 'samples', 'scene', 'sprites', 'text'];
  const REQUIRED = HQRS.map(n => n + '.hqr').concat(['setup.lst']);
  // a mod build's own files, next to the game's (docs/MODS.md): the engine
  // features it asks for, and its heroes' models per scene. Until the page
  // builds mods itself, a folder built by levelkit can be dropped in whole.
  const OPTIONAL = ['features', 'hero.dat'];
  const VOX_LANG = { english: 'en', 'français': 'fr', francais: 'fr', deutsch: 'de' };

  // Copies of the game we've tested: the classic DOS files' SHA-256s (a few
  // of them identify a release). GOG's "Twinsen's Little Big Adventure
  // Classic" has two versions of the game: a modern Windows one (TLBA1C.exe;
  // its data in Common/, CommonClassic/) and the original DOS one
  // (Speedrun/Windows), which this engine, the 1994 source, needs.
  const RELEASES = [
    { name: "GOG: Twinsen's Little Big Adventure Classic", files: {
      'ress.hqr': '40fda5776f3f0da976595d47722aed5a8cf25d8536b1064c9851a8f5f0631267',
      'scene.hqr': 'a320c359fd41ef2b1be93f885a840615c316c83be50e5e81e90f93dbb647c859',
      'text.hqr': 'ec60aa7323a2e8daa270bda71db9db1dff4062b2048c37dc7ff9f6c641667cd2' } },
  ];
  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  // -> the release's name, or null: a copy we haven't tested (we try anyway)
  async function identify(game) {
    const sums = {};
    for (const n of ['ress.hqr', 'scene.hqr', 'text.hqr'])
      sums[n] = hex(await crypto.subtle.digest('SHA-256', await game.data[n].read()));
    const r = RELEASES.find(r => Object.entries(r.files).every(([n, h]) => sums[n] === h));
    return r ? r.name : null;
  }

  const base = p => p.slice(p.lastIndexOf('/') + 1).toLowerCase();
  const dir = p => p.slice(0, p.lastIndexOf('/') + 1);
  // which entries we might need: the game's files, its voices, the music
  const wanted = p => {
    const b = base(p);
    return REQUIRED.includes(b) || OPTIONAL.includes(b) || b === 'lba.cfg' || /\.vox$/.test(b) || /^lba1-\d\d\.mp3$/.test(b);
  };

  // ── sources ─────────────────────────────────────────────────────────────
  const fromFile = (f, path) => ({ path, size: f.size, read: async () => new Uint8Array(await f.arrayBuffer()) });

  // a zip, read in place: its directory (at the end), then only the entries
  // we need, so a whole zipped install (GOG's is 700 MB) never sits in memory
  async function fromZip(file, progress) {
    progress(`Opening ${file.name}…`);
    const slice = async (at, n) => new DataView(await file.slice(at, at + n).arrayBuffer());
    const tail = Math.min(file.size, 65536 + 22);
    const end = await slice(file.size - tail, tail);
    let eocd = -1;
    for (let i = tail - 22; i >= 0; i--) if (end.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error(`${file.name} doesn't look like a zip file.`);
    let count = end.getUint16(eocd + 10, true), cdSize = end.getUint32(eocd + 12, true), cdAt = end.getUint32(eocd + 16, true);
    if (cdAt === 0xffffffff || count === 0xffff) {           // zip64: the real values are in its own record
      const loc = eocd - 20;
      if (loc < 0 || end.getUint32(loc, true) !== 0x07064b50) throw new Error(`${file.name}: unsupported zip.`);
      const rec = await slice(Number(end.getBigUint64(loc + 8, true)), 56);
      count = Number(rec.getBigUint64(32, true)); cdSize = Number(rec.getBigUint64(40, true)); cdAt = Number(rec.getBigUint64(48, true));
    }
    const cd = await slice(cdAt, cdSize);
    const utf8 = new TextDecoder();
    const out = [];
    for (let p = 0, k = 0; k < count && p + 46 <= cdSize; k++) {
      if (cd.getUint32(p, true) !== 0x02014b50) break;
      const method = cd.getUint16(p + 10, true);
      let csize = cd.getUint32(p + 20, true), size = cd.getUint32(p + 24, true), at = cd.getUint32(p + 42, true);
      const nlen = cd.getUint16(p + 28, true), xlen = cd.getUint16(p + 30, true), clen = cd.getUint16(p + 32, true);
      const name = utf8.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen));
      for (let x = p + 46 + nlen; x + 4 <= p + 46 + nlen + xlen;) {    // zip64 sizes/offset
        const id = cd.getUint16(x, true), len = cd.getUint16(x + 2, true);
        if (id === 1) {
          let q = x + 4;
          if (size === 0xffffffff) { size = Number(cd.getBigUint64(q, true)); q += 8; }
          if (csize === 0xffffffff) { csize = Number(cd.getBigUint64(q, true)); q += 8; }
          if (at === 0xffffffff) at = Number(cd.getBigUint64(q, true));
        }
        x += 4 + len;
      }
      p += 46 + nlen + xlen + clen;
      if (name.endsWith('/') || !wanted(name)) continue;
      out.push({ path: file.name + '/' + name, size, read: async () => {
        const h = await slice(at, 30);
        const start = at + 30 + h.getUint16(26, true) + h.getUint16(28, true);
        const raw = file.slice(start, start + csize);
        if (method === 0) return new Uint8Array(await raw.arrayBuffer());
        if (method !== 8) throw new Error(`${name}: compressed in a way this page can't unpack (method ${method}).`);
        if (typeof DecompressionStream !== 'undefined')
          return new Uint8Array(await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
        return fflate.inflateSync(new Uint8Array(await raw.arrayBuffer()), { out: new Uint8Array(size) });
      } });
    }
    return out;
  }

  // dropped items: files and whole folders (DataTransferItem.webkitGetAsEntry)
  async function fromDrop(items) {
    const out = [];
    const walk = async (entry, path) => {
      if (entry.isFile) {
        if (wanted(path) || /\.zip$/i.test(path))
          out.push({ path, file: await new Promise((ok, fail) => entry.file(ok, fail)) });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        for (;;) {
          const batch = await new Promise((ok, fail) => reader.readEntries(ok, fail));
          if (!batch.length) break;
          for (const e of batch) await walk(e, path + '/' + e.name);
        }
      }
    };
    for (const it of [...items]) {
      const e = it.webkitGetAsEntry && it.webkitGetAsEntry();
      if (e) await walk(e, e.name);
    }
    return out;
  }

  // a file input (multiple files, or a folder with webkitdirectory)
  const fromInput = files => [...files].map(f => ({ path: f.webkitRelativePath || f.name, file: f }));

  // raw {path, file} picks (zips among them unpacked) -> entries
  async function collect(picks, progress) {
    const entries = [];
    for (const { path, file } of picks) {
      if (/\.zip$/i.test(path)) entries.push(...await fromZip(file, progress));
      else if (wanted(path)) entries.push(fromFile(file, path));
    }
    return entries;
  }

  // ── finding the game ────────────────────────────────────────────────────
  // -> {data: {name: entry}, vox: [entry], music: {NN: entry}} or throws an
  // Error whose message is meant for the player
  function find(entries) {
    const dirs = {};
    for (const e of entries) {
      const d = dir(e.path), b = base(e.path);
      (dirs[d] = dirs[d] || {})[b] = e;
    }
    const complete = Object.keys(dirs).filter(d => REQUIRED.every(n => dirs[d][n]));
    if (!complete.length) {
      // GOG's Original Edition add-on (Common/, CommonRetro/) installs into
      // the main game's folder: on its own it's not the whole game
      if (entries.some(e => /(^|\/)commonretro\//i.test(e.path)) && !entries.some(e => /\/speedrun\//i.test(e.path)))
        throw new Error("That's GOG's Original Edition add-on on its own. Drop the main game's install folder instead (Twinsen's Little Big Adventure Classic): it has the original DOS files this needs.");
      const exe = entries.length === 0;
      const best = Object.keys(dirs).sort((a, b) =>
        REQUIRED.filter(n => dirs[b][n]).length - REQUIRED.filter(n => dirs[a][n]).length)[0];
      const missing = best ? REQUIRED.filter(n => !dirs[best][n]) : REQUIRED;
      throw new Error(exe
        ? "That doesn't contain Little Big Adventure's game files. If it's an installer, install the game first, then drop the folder it installed to."
        : `That's not the whole game: ${missing.length} file${missing.length > 1 ? 's are' : ' is'} missing (${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '…' : ''}). Drop the folder the game is installed in.`);
    }
    // the classic DOS data has its LBA.CFG next to it; prefer that copy
    const d = complete.find(x => dirs[x]['lba.cfg']) || complete[0];
    const data = dirs[d];
    const vox = entries.filter(e => dir(e.path).toLowerCase() === (d + 'vox/').toLowerCase() && /\.vox$/i.test(e.path));
    const music = {};
    for (const e of entries) {
      const m = /^lba1-(\d\d)\.mp3$/.exec(base(e.path));
      if (m && !music[m[1]]) music[m[1]] = e;
    }
    return { dir: d, data, vox, music };
  }

  // LBA.CFG for the browser: the player's own (its language, volumes), with
  // the mixer off (the SDL shim does the mixing) and DOS 8.3 save names
  function config(text) {
    const lines = (text || [
      'Language: English', 'LanguageCD: English', 'FlagKeepVoice: ON', 'FlagDisplayText: ON',
      'WaveRate: 22000', 'WaveVolume: 163', 'MusicVolume: 236', 'MasterVolume: 195',
    ].join('\n')).replace(/\r/g, '').split('\n');
    let seen = false;
    const out = lines.map(l => {
      const k = l.split(':')[0].trim();
      if (k === 'MixerDriver') return 'MixerDriver: NoMixer';
      if (k === 'WindowsFilenameSaving') { seen = true; return 'WindowsFilenameSaving: OFF'; }
      return l;
    });
    if (!seen) out.push('WindowsFilenameSaving: OFF');
    return out.join('\r\n') + '\r\n';
  }
  const latin1 = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return s; };
  const fromLatin1 = s => Uint8Array.from(s, c => c.charCodeAt(0) & 0xff);

  // ── installing ──────────────────────────────────────────────────────────
  async function install(FS, game, progress) {
    const put = (path, bytes) => FS.writeFile('/lba/' + path, bytes);
    for (const d of ['/lba/vox', '/lba/music']) try { FS.mkdir(d); } catch (e) {}
    const names = REQUIRED;
    let i = 0;
    for (const n of names) {
      progress(`Copying the game files… ${Math.round(100 * i++ / names.length)}%`);
      put(n, await game.data[n].read());
    }
    for (const n of OPTIONAL) if (game.data[n]) put(n, await game.data[n].read());
    const cfg = game.data['lba.cfg'] ? latin1(await game.data['lba.cfg'].read()) : null;
    const text = config(cfg);
    put('lba.cfg', fromLatin1(text));
    // voices in the voice language (LanguageCD), as the engine opens them
    const lang = (/LanguageCD:\s*(\S+)/i.exec(text) || [])[1] || 'English';
    const prefix = (VOX_LANG[lang.toLowerCase()] || 'en') + '_';
    const vox = game.vox.filter(e => base(e.path).startsWith(prefix));
    for (const e of vox) {
      progress(`Copying the voices… ${base(e.path)}`);
      put('vox/' + base(e.path), await e.read());
    }
    const tracks = Object.keys(game.music);
    for (const nn of tracks) {
      progress(`Copying the music… ${nn}`);
      put('music/' + nn + '.mp3', await game.music[nn].read());
    }
    const release = await identify(game);
    put('.installed', fromLatin1(JSON.stringify({ release, voices: vox.length, music: tracks.length, at: Date.now() })));
    return { release, voices: vox.length, music: tracks.length };
  }

  const installed = FS => { try { return JSON.parse(latin1(FS.readFile('/lba/.installed'))); } catch (e) { return null; } };

  // everything under /lba, saves included
  function forget(FS) {
    const rm = p => {
      for (const n of FS.readdir(p)) {
        if (n === '.' || n === '..') continue;
        const q = p + '/' + n;
        if (FS.isDir(FS.stat(q).mode)) { rm(q); FS.rmdir(q); } else FS.unlink(q);
      }
    };
    rm('/lba');
  }

  return { fromDrop, fromInput, collect, find, install, installed, forget, REQUIRED, RELEASES };
})();
