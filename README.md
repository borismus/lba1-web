# Little Big Adventure in the browser

The 1994 game, running in a web page from its original engine code compiled
to WebAssembly. You bring your own copy of the game: drop its folder (or a
zip of it) onto the page, and it plays. Nothing of the game is in this
repository or on the server, and your files never leave your browser.

**Play it: https://borismus.github.io/lba1-web/** · with a mod:
[Relentless: Zoe's Adventure](https://borismus.github.io/lba1-web/?mod=mods/zoes-adventure.zip),
[The Cast](https://borismus.github.io/lba1-web/?mod=mods/the-cast.zip)

**Which copy:** GOG's [*Twinsen's Little Big Adventure
Classic*](https://www.gog.com/en/game/little_big_adventure). Its install
folder has the original 1994 DOS files (`Speedrun/Windows`), which is what
this engine reads; the page finds them in whatever you drop. Steam: untested.

See [`platform/web/README.md`](platform/web/README.md) for playing, building
and developing.

**Making a mod** (by hand or with a coding agent): start with
[`AGENTS.md`](AGENTS.md), then [`docs/MODS.md`](docs/MODS.md) and
[`docs/LEVELS.md`](docs/LEVELS.md). `tools/playtest.mjs` plays a mod
headless, and dumps original scenes to read what to change.

## Repository map

| | |
|---|---|
| `platform/web/` | the browser build: the page, loading your game files, music, saves |
| `engine/` | the 1994 game and library code, C, with the port's fixes |
| `translate/` | the original's x86 assembly modules, rewritten in C |
| `platform/sdl/` | the SDL2 layer (video, audio, input, files) the web build runs on |
| [`docs/MODS.md`](docs/MODS.md) | the mod format (draft): mods as operations on the player's own copy |

## Where the engine comes from

- [2.21]'s GPL release of the original source:
  <https://github.com/2point21/lba1-classic-community>. `engine/` is derived
  from it.
- [ds-lba](https://github.com/vs-sr-dev/ds-lba) by Samuele Voltan, which
  translated the release's assembly modules to C (`translate/`), fixed the
  engine for modern compilers, and wrote the SDL2 layer, for a Nintendo DS
  port. This repository starts from its history; the DS port itself is
  removed.

Little Big Adventure was developed by Adeline Software International in
1994 and is © [2.21]. This is a fan project, not affiliated with Adeline,
[2.21] or GOG, and ships none of their data.

## License

GPL v2, inherited from the source release. See [LICENSE](LICENSE).
