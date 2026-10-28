# LBA1 in the browser

The 1994 Little Big Adventure engine (this repository's C translation of
the original source), compiled to WebAssembly. The player brings their own
copy of the game: nothing of the game is in this repository or on the
server.

## Playing

Open the page and drop in your copy of the game. Any of these works:

- the folder the game is installed in (GOG: the whole install folder);
- a zip of that folder;
- on a Mac, GOG's app (drag the `.app` onto the page);
- or the "Choose folder…" / "Choose zip…" buttons.

The page finds the classic DOS data in what you give it (the 14 `.HQR`
archives and `SETUP.LST`; GOG: `Speedrun/Windows`), plus the voices
(`VOX/`, in the language `LBA.CFG` asks for) and GOG's rendered soundtrack
(`Common/Midi/LBA1-NN.mp3`) when they're there. It copies them into the
browser's own storage (IndexedDB), which keeps them and your saves for next
time: later visits show a Play button. "Use different game files" removes
them. Nothing is uploaded.

**Which release:** GOG's *Twinsen's Little Big Adventure Classic*
(installer 3.2.3.2). Its install folder holds two versions of the game: a
modern Windows one (`TLBA1C.exe`, data in `Common/` and `CommonClassic/`)
and the original 1994 DOS one (`Speedrun/Windows/`, which GOG starts as
"Speedrun - DOS Windows Version"). This engine is the 1994 source, so it
uses the DOS files; drop the whole install folder and the page finds them.
`loader.js` recognises that release by its files' SHA-256s (`RELEASES`);
another copy with the same files still loads, with a note that it's
untested. GOG's *Original Edition* add-on (a DLC of Classic, its own
installer) installs into the main game's folder and is not a whole game on
its own. Steam: untested.

Controls: arrows to walk, Space for the behaviour's action, Tab or Ctrl for
the behaviour menu, 5–8 to switch behaviour directly, Esc for the menu.

## Building

Needs [Emscripten](https://emscripten.org).

```sh
cd platform/web
make            # build/index.html, index.js, index.wasm: the engine, no game data
make serve      # http://localhost:8080/
```

Deploy `build/` (without `build/obj/`) to any static host.

## Developing

- `?dev=1` shows a side panel: scene jumps, chapter, give all items, and a
  recorder (the game's picture and sound to a video file).
- `?scene=N[&at=x,y,z][&chapter=C][&items=all][&flags=F,F...][&body=B][&logo=1][&rec=1]`
  starts a new game in scene N (see `web_debug.c`).
- `loader.js`: finding and installing the game files; `shell.html`: the
  page; `web_music.c`: the soundtrack; `web_sys.c`: file system glue;
  `web_hooks.c`: yielding to the browser inside the engine's busy-waits.
- `vendor/fflate.js` (MIT, fflate 0.8.2): inflating zips in browsers
  without `DecompressionStream`.
- `scenes.json`: scene names from github.com/LBALab/metadata.

Little Big Adventure © [2.21]. This is a fan project, not affiliated with
them; the engine source is GPLv2.
