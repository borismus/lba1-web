# AGENTS.md

LBA1 (Little Big Adventure, 1994) in the browser: the original engine as
WebAssembly, the player's own copy of the game (GOG), and **mods**: zip
packages the page builds from the player's game files. Most work here is
making a mod. Read this first, then `docs/MODS.md` (the format) and
`docs/LEVELS.md` (level files and scripts).

## Rules that are not negotiable

- **No game data in the repo or in a mod, ever.** That includes the GOG
  files, anything extracted or converted from them (models, sprites, grids,
  sounds, music, text), and dumps of original scripts. A mod is made of
  text you wrote and media you made or have the rights to. Ask the user
  where their game is installed; never copy it into the repo.
- **Change originals by hooking, not copying.** To alter what an original
  character does, `hook` or `patch` its script (docs/LEVELS.md); don't
  transcribe the original script into your mod. `mod check` catches copied
  bytes; a transcription it can't catch, so it's on you.
- **`mod check` must pass**: the page refuses a mod that shares any 64-byte
  run with the game's files.
- **The engine stays the original** unless a mod needs an engine feature
  (`requires.features`, docs/MODS.md); a new feature is an engine change
  for the maintainers, and must leave the engine exactly as it was while off.

## Layout

```
mods/<id>/            mods: mod.json, *.ops, levels/, scripts/, voices/
  zoes-adventure/     the worked example: a copy of the prison and yard, played as Zoe
  the-cast/           a new scene: every 3D model in the game (talk to one: its number, bodies)
  catalog.json        other people's mods, listed on the page (docs/MODS.md, "Listing a mod")
docs/MODS.md          the mod format
docs/LEVELS.md        level files and the script syntax
tools/playtest.mjs    play a mod headless: screenshots, hero state, scene dumps
modkit/               the mod builder (TypeScript; the page runs it) and mod check
platform/web/         the page (shell.html, loader.js, mods.js) and the engine glue
engine/               the 1994 engine source (C)
```

## Making a mod: the loop

1. Start from a copy of `mods/the-cast` (a new scene) or
   `mods/zoes-adventure` (changing original scenes). Give it its own `id`
   (lowercase, dashes) in `mod.json`.
2. Find what to change: dump the original scene you're working on, with its
   objects, scripts (with offsets) and zones, and the lines they say:
   ```sh
   node tools/playtest.mjs --game <GOG install folder> dump 0 /tmp/scene0.txt
   ```
   The dump is for reading. Don't put it, or pieces of it, in the mod.
   `platform/web/scenes.json` names every original scene.
3. Edit the mod's files.
4. Playtest it: the page builds it (and runs mod check) exactly as for a
   player, then the steps run in order:
   ```sh
   node tools/playtest.mjs --game <GOG install folder> --mod mods/<id> \
     state shot /tmp/start.png hold up 1500 state jump @prison shot /tmp/prison.png
   ```
   Each step prints a JSON line; a build or mod check error is
   `{"error": "mod: ..."}` with the page's own message. Steps: `jump <n|@name>
   [x,y,z]`, `wait <s>`, `hold <key> <ms>`, `press <key>`, `shot <png>`,
   `state`, `flag <n>`, `dump <n|@name> [file]`. Look at the screenshots.
5. Repeat. When it works, the user tries it: open the page, drop the mod
   folder (or its zip) on the Play screen.

Setup for the playtest: `cd tools && npm install && npx playwright install
chromium`. It uses the local build (`make -C platform/web`, needs
Emscripten and Node 22.13+); without Emscripten, add `--url
https://borismus.github.io/lba1-web/` to use the published page. The first
run copies the game into a browser profile (in the temp folder); later runs
reuse it.

## Pitfalls (learned the hard way)

- **Object numbers in a copied scene**: the scene's own objects come first
  (0 is the hero), then `add actor` lines in order. Scripts refer to them by
  number (`MESSAGE_OBJ 0`, `LIFE_POINT_OBJ(4)`); recount when you add one.
- **Hooks** must redo what the replaced instruction did and jump back with
  `ELSE <offset>`; a **patch** may be no longer than what it covers. Get
  offsets from the dump, not by guessing.
- **The hero's lines** in original scenes are Twinsen's recorded voice. As
  someone else, reword them (`text ID: ...`) so they're new lines.
- **`MESSAGE` stops the game** for a dialogue box; a guard who greets the
  hero mid-walk should use `SAY_MESSAGE` (a bubble).
- **Characters get stuck** on scenery when steered across a scene: give
  long walks waypoints (invisible `add actor N: -1 body 255 ... flags 0`
  markers) and `BRICK_COL 0` while far from the hero.
- **Keys** must be held ~200 ms or more for the engine to see them
  (`hold`, not a tap).
- **Game flags 220-254** are free for mods; lower ones are the original's.
- **Saves**: a mod's saves are its own. The playtest clears them so the mod
  starts at its `start`; `--keep-saves` keeps them.

## Voices (optional)

`voices/index.json` maps a line's exact text to a WAV file in `voices/`.
Any PCM WAV works (8- or 16-bit, mono or stereo, any rate): the page
converts it when it builds the mod. A line without a clip is text only. Make
clips however you like (a TTS service with the user's own key, macOS `say`,
recordings); their license is the mod's responsibility: credit it in
`mod.json` (`credits`).

## Working on the engine or modkit

- `make -C platform/web` builds the page into `platform/web/build/`; push to
  the `web` branch deploys it to GitHub Pages.
- modkit's tests: `node modkit/test/roundtrip.ts <data>` (every original
  script and grid round-trips) and `node modkit/test/check.ts <data> <mod>`,
  where `<data>` is the folder with the game's `SCENE.HQR` (GOG:
  `Speedrun/Windows`).
- C engine files keep their original style; mark changes with `/* PORT: */`
  and keep them under `#ifdef __EMSCRIPTEN__` where the original differs.
