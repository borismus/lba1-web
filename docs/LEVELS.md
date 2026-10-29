# Level files

A mod's `level @name from levels/<file>.txt` (docs/MODS.md) adds one scene,
described by a level file. There are two kinds:

- a **new scene**, drawn as an ASCII map with a legend (examples:
  `mods/the-cast/levels/cast.txt`);
- a **copy of an original scene** (`copy: N`) with changes: new lines,
  characters, scripts, hooks into the original's scripts (examples:
  `mods/zoes-adventure/levels/`).

Both are text: `key: value` lines, `#` comments (after whitespace), and for
a new scene a `legend:` and a `map:`. Scenes are numbered in the order of
the `level` operations, from 134; scripts refer to them by number (the
playtest prints them: `"scenes": {"prison": 134, "yard": 135}`).

## A new scene

```
name: My first level
library: 2              # tile set (layout library, LBA_BLL.HQR index)
template: 2             # the original scene whose lighting, ambience and island it borrows
music: 9                # soundtrack track (default: the template's)
legend:
  .  floor 22           # stone paving (a 2x2 layout, tiled to the world grid)
  g  floor 50           # grass
  ~  floor 99           # water (drowns: layout 99's game code)
  #  wall 92 3          # layout 92 stacked 3 cells high
  T  object 112 on .    # layout 112, its (0,0) corner here, standing on a '.' tile
  I  barrier 3          # invisible but solid, 3 cells high (an interior's open front)
  S  start on .         # the hero's start
  b  actor 13 body 0 on .                 # 3D model 13 (a Rabbibunny), body 0
  w  actor 13 wander on .                 # walks around at random
  r  actor 13 anim 73 on .                # plays animation 73 on the spot
  t  actor 13 on . says Hello! @ A second page.   # the action key next to them: dialogue
map:
  ..........
  ..T....#..
  ....S..t..
```

Rows run along +z, columns along +x; a space is void (no floor). A world
cell is 512 units: cell (x, z) is at world (x*512, z*512); y is 256 per
cell. Which layout is what: the tile sets are the original scenes' (scene
N uses library N); The Cast mod shows every 3D model and its bodies.

**Gameplay modifiers**, after any legend entry (they make zones; no
scripts needed):

```
  x  floor 135 trap ~      # stepping on any trap cell turns them all into '~'
  o  floor 135 hint 188    # shown as layout 188 while the hero stands on a 'reveal' cell
  @  floor 243 reveal
  E  floor 238 exit 1 at 11264 256 28672   # leave for scene 1, arriving at x y z
  E  floor 238 exit cellar                 # or another level of the mod, by file name
  G  floor 22 give money 10                # action key here: 10 coins, once (money|life|magic|key|clover)
  D  floor 61 trap open exit cellar below  # a trap door: the floor opens, falling through leaves
```

Meta keys: `reveal camera: X Z` (centre the camera there while revealing),
`raise: d` (every floor one cell up on a `d` tile; `floor 99 low` stays
down, `floor 81 over ~` has `~` below), `hero: @name` (play as a hero the
mod defines, docs/MODS.md).

**Houses** (`house: yes`, tile set 16): walls get trim, a brick foundation
and cut-away fronts like the original houses:

```
house: yes
ground: 4               # ground floor y (room for the foundation)
  #  wall               # full height at the back (-x/-z), low elsewhere
  P  wall 6             # a back wall in layout 6 (a painting)
  ,  floor 1 up 4       # a floor 4 cells up
  +  door on .          # a doorway: 3 wide gets an arch, other widths are open
  >  stairs             # steps down toward +x
  D  frontdoor          # the stone front door, 3 wide, in a +z outside wall
```

Tips: a `give` zone grows over the furniture beside it and the bonus pops
out toward the hero, so leave open floor in front; keep talking characters
more than ~2 cells from it (the action key would talk instead).

## A copy of an original scene

```
name: Outside the Citadel (Zoe)
copy: 1                 # scene 1: its grid, objects, scripts, zones
hero: @zoe
start: 16127 256 31743  # the hero's start (world x y z)
skip: INC_CHAPTER       # these life instructions become NOPs
caught: game over       # the original's arrest (back into this scene) ends the game
text 9: Hi there!       # what the original's text 9 says, here (a new line, new id)
exit 3: zone 20         # its exits to scene 3 become scenario zone 20 (scripts: ZONE_OBJ(0) == 20)
exit zone 17: closed    # its zone 17 (index among its zones) is shut
object 20: model 54 body 0 life 4 armour 1 drops 1 key   # change object 20
script 12: zoe_gone     # object 12 runs scripts/zoe_gone.script instead
hook 1 19: zoe_desk_seen     # object 1's life instruction at offset 19 jumps to that script's life, appended
patch 5 31: zoe_lab_call     # that script's life written over object 5's from offset 31
add actor 4: 69 body 0 at 21500 768 7679 facing 768 life 20 armour 1 script zoe_funfrock
```

- Exits and `CHANGE_CUBE` between scenes the mod copies go to the copies.
- With a `hero:`, the original's cutscenes (`PLAY_FLA`, which star Twinsen)
  are skipped.
- `add actor N: MODEL [body B] at X Y Z [facing BETA] [life L] [armour A]
  [flags HEX] [script S] [says ...]` adds a character after the scene's own
  objects, in the order of the lines: in a scene with 13 objects (0 is the
  hero), the first added one is object 13. `N` is just a unique number in
  the file. `MODEL -1 body 255 flags 0` is an invisible, bodiless marker
  fixed in the air (a waypoint for `GOTO_POINT`-like steering).
- `hook N AT: S`: the instruction at offset AT of object N's life script
  becomes a jump to S's life section, appended to the script. S must redo
  what the replaced instruction did, and jump back with `ELSE <offset>`
  (the offset where the original goes on). The original stays as it is: the
  mod holds only the new code.
- `patch N AT: S` writes S's life section over the original from AT, in
  place, and may be no longer than the instructions it covers (so other
  scripts' offsets into it still hold). Object 0 is the hero.
- To find objects, offsets and zones, dump the scene: `node tools/playtest.mjs
  --game <dir> dump 0 scene0.txt` (offsets are the `L<n>` labels; an
  instruction's offset is the label before it plus the sizes in between,
  so hook at a labelled instruction where you can).

## Scripts

`scripts/<name>.script` (or `<name>.script` next to the level), sections
`== track` and `== life`, one instruction per line in the listing syntax a
dump prints:

```
== track
  WAIT_NB_SECOND 2
  LABEL 1
  STOP

== life
  SET_TRACK 0
  SET_COMPORTEMENT @intro
  END_COMPORTEMENT
intro:
  IF L_TRACK == 1 else @wait
  ONEIF FLAG_GAME(241) == 0 else @wait
  SET_FLAG_GAME 241 1
  MESSAGE_OBJ 0 "Twinsen's locked up in the Citadel prison. Time to break him out!"
wait:
  END_COMPORTEMENT
  END
```

- Conditions: `IF|SWIF|ONEIF|SNIF|NEVERIF|OR_IF FUNC[(arg)] TEST VALUE else
  @label`; TEST is `== > < >= <= !=`.
- `name:` defines a label, `@name` jumps to one; plain numbers are offsets
  (as in hooks: `ELSE 55`).
- `"quoted text"` wherever an instruction takes a text id: the line is added
  to the island's text bank (and voiced if `voices/index.json` has it).
  `MESSAGE` pauses the game in a dialogue box; `SAY_MESSAGE` is a bubble
  that doesn't.
- Objects, game flags and scenes are numbers for now (names are planned,
  docs/MODS.md). Use game flags 220-254 for your own state.
- Every instruction of the game's language is allowed (`modkit/src/script.ts`
  lists them with their arguments; `engine/game/GERELIFE.C` and
  `GERETRAK.C` are what they do).
