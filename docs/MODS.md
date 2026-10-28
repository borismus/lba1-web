# Mod format (draft, format version 1)

A mod changes or adds to Little Big Adventure: new places, characters,
dialogue, a story, a different hero. This document defines what a mod
package contains and how the page builds it. It is a draft: written against
one real mod (Little Big Rescue, the example at the end) and meant to be
checked against more before it's frozen.

## Principles

1. **A mod contains no bytes of the original game.** It holds *operations*
   on the player's own copy ("copy scene 0", "give object 4 this script",
   "add this line of dialogue") and the modder's *own content* (scripts,
   text, voices, images). Anything derived from the original, such as an
   edited copy of a scene, is made on the player's machine, from the files
   they dropped in. `mod check` (below) enforces this mechanically.
2. **Mods are data, not code.** Scripts are in the game's own script
   language (life and track scripts); there is no general-purpose code in a
   mod. Building a mod can't do anything but produce game files.
3. **The original stays untouched.** A build writes the mod's files next to
   the original ones; the plain game is always one click away.
4. **Engine changes are opt-in.** A mod that needs more than the original
   engine does (playing as someone other than Twinsen, say) declares a
   *feature*; without a loaded mod asking for it, the engine behaves exactly
   like the original.
5. **Mods stack.** Several mods can be loaded at once, in order. Mods refer
   to what they create by name, never by number, so they don't collide;
   when two mods change the same thing, the build reports it.
6. **Builds are deterministic.** The same copy of the game and the same
   mods, in the same order, give the same files, byte for byte.

Out of scope, deliberately: mods made of replacement game files (the old
way: modified `.HQR` archives copied over the originals), binary diffs
against the original files, and executable code of any kind.

## Words

- **Base:** the player's copy of the game, as the page found it. Its
  **release** (e.g. GOG's *Twinsen's Little Big Adventure Classic*) is
  recognised by the SHA-256 of a few of its files; the page keeps the list.
- **Mod:** a package, below. **Mod set:** the mods loaded together, in order.
- **Build:** applying a mod set to the base. Its output is the **overlay**:
  the game files the mod set changes or adds, which the engine reads in
  place of (or as well as) the base's.
- **Entry:** one item of a game archive (`.HQR`): a scene, a 3D model, a
  text bank. Archives are addressed by name (`scene`, `file3d`, `body`,
  `anim`, `samples`, `text`, `lba_gri`, `lba_bll`, `vox/en_000`…).

## The package

A zip (or a folder) with a manifest and the mod's files:

```
little-big-rescue/
  mod.json              the manifest
  mod.ops               the operations, applied in order (more .ops files may be listed)
  levels/*.txt          level files (the high-level form of operations)
  scripts/*.script      life and track scripts
  voices/*.wav          spoken lines
  art/*.png             images (future: see Open questions)
```

Paths inside the package are case-sensitive, `/`-separated and relative.
Nothing outside the package is read, apart from the base.

### `mod.json`

```json
{
  "format": 1,
  "id": "little-big-rescue",
  "name": "Little Big Rescue",
  "version": "1.0.0",
  "authors": ["Boris Smus"],
  "description": "Zoe breaks Twinsen out of the Citadel.",
  "license": "CC BY-NC 4.0",
  "credits": ["Voices: ElevenLabs"],
  "requires": {
    "releases": ["gog-classic"],
    "features": ["hero-models", "end-fade"]
  },
  "after": [],
  "ops": ["mod.ops"],
  "start": { "scene": "@yard", "at": [16127, 256, 31743] }
}
```

- `format`: this document's version. A loader refuses formats it doesn't
  know.
- `id`: lowercase letters, digits and `-`; unique among mods. It is also the
  namespace of everything the mod names (`@yard` is `little-big-rescue.yard`).
- `version`: semantic versioning (`major.minor.patch`).
- `license`: of the mod's own content. Original game content is never part
  of a mod, so this covers only what the modder made.
- `credits`: shown where the mod is listed; e.g. a voice service's
  attribution terms.
- `requires.releases`: the base releases the mod was made and tested
  against (ids from the loader's list). Another release with identical
  files is the same release; anything else is refused, unless the player
  overrides it.
- `requires.features`: engine features, below.
- `after`: ids of mods this one must be applied after (it may change what
  they made). Order is otherwise the player's.
- `ops`: the operation files, applied in this order.
- `start`: where "Play" puts the hero: a scene, optionally a position
  (`at`), game flags to set (`flags`, by name), the hero's outfit (`body`).
  Without it, Play starts a new game as usual.

## Names

A mod never writes a number for something it creates: scenes, objects,
texts, models, game flags and the like get **names**, and the build assigns
the numbers. `@yard` is the mod's own name `yard`; `@other-mod.yard` is
another mod's (which must be in `after`). Things that exist in the base are
referred to by their number in the base: `scene:0`, `file3d:69`,
`text:3:4` (text 4 of bank 3).

What the build allocates, and from where:

| Kind | Range | Notes |
|---|---|---|
| scene | 134–254 | the base has 0–133 (120–133 are grid fragments); `CHANGE_CUBE` takes one byte, so 254 is the last. A scene's grid and tile library use the same number. |
| object (in a scene) | after the scene's own | at most 100 per scene, the hero included |
| text | 1000 and up, per bank | a bank is an island's dialogue |
| voice | the slot of its text | at most 511 slots per bank |
| file3d, body, anim, sample | after the base's last entry | |
| game flag | 220–254 | the flags the original's scripts and engine don't use; saved with the game |
| cube flag | any free in the scene | per scene, not saved across scenes |

Names are resolved in scripts too (below), so `SET_DIR 2 @funfrock` and
`IF FLAG_GAME(@freed) == 1` work whatever numbers the build chose.

## Operations

Operations come in three layers. Each layer is defined by the one below it:
a level file *is* a list of layer-2 operations, and every layer-2 operation
is a list of layer-1 ones. A loader implements all three; a modder writes
whichever suits.

`.ops` files are line-oriented: `#` starts a comment, a trailing `\`
continues a line, strings are in double quotes.

### Layer 1: archives

```
entry append <archive> @name from <file>         # the mod's own data, as a new entry
entry copy   <archive> <ref> as @name            # a copy of an entry of the base (or an earlier op's)
entry replace <archive> <ref> from <file>        # an entry, replaced whole by the mod's own data
entry patch  <archive> <ref> at <offset> expect <sha256> set <hex bytes>
```

- `entry copy` is how a mod gets an edited copy of original data without
  containing it: the copy is made from the player's files.
- `entry patch` changes at most 256 bytes. `expect` is the SHA-256 of the
  bytes being replaced, *in the base*, so a patch can only apply to the data
  it was written for. The bytes it sets are the mod's own.
- `entry replace` and `entry append` take files in the archive's own entry
  format. `mod check` refuses them if they contain original data.

### Layer 2: game objects

Scenes:

```
scene copy <ref> as @name                         # a copy of a base scene: grid, tiles, objects, scripts
scene @s start <x> <y> <z>                        # the hero's start (when the scene is entered by Play or CHANGE_CUBE)
scene @s music <track>
scene @s no-cutscenes                             # PLAY_FLA in the copy's scripts becomes NOP
scene @s skip <OP>                                # every instruction <OP> in the copy's scripts becomes NOP
scene @s caught game-over                         # the copy's CHANGE_CUBE to itself (the arrest) becomes GAME_OVER
scene @s exits <ref> to @other                    # exits to base scene <ref> lead to @other instead
scene @s exit-zone <n> closed                     # change-cube zone n leads nowhere
scene @s exits <ref> become zone @z               # exits to <ref> become a scenario zone scripts can test
scene @s object <n> set [model <m>] [body <b>] [life <l>] [armour <a>] [drops <count> <kind>]
scene @s object <n> script <file.script>          # new life and/or track script
scene @s object <n> patch life at <offset> with <file.script>   # same-size patch, so other scripts' offsets into it hold
scene @s add @name model <m> [body <b>] at <x> <y> <z> [facing <beta>] \
         [life <l>] [armour <a>] [flags <hex>] [script <file.script>] [says "…"]
```

`<n>` is an object's number in the base scene (0: the hero). `model -1`
adds an object with no body: nothing to see or bump into, for script
markers and waypoints.

Dialogue and voices:

```
text <bank> add @name "…"                          # a new line in a bank
text @s reword <id> as @name "…"                   # in scene @s's scripts, a base line is replaced by a new one
voice @text from voices/<file>.wav                 # the spoken line of a text; any rate, mono or stereo (the build converts)
```

A line written in quotes in a script (`MESSAGE "…"`) is a `text add` in the
scene's island bank; its voice, if any, is given with `voice`.

Models:

```
body copy <ref> as @b [recolor <from>:<to> …] [dim <colour>:<factor> …]
hero @name from file3d <ref> body <ref> bones <b0,b1,…> \
     [outfit <slot> body @b] [voice <sample>:<sample or pitch> …]
```

`hero` makes the five behaviour models (normal, athletic, aggressive,
discreet, protopack) of another character, with the hero's animations
remapped to that character's skeleton (`bones`: for each of its bones,
the hero bone it moves like, or `-` for none). `scene @s hero @name` plays
that scene as them (feature `hero-models`).

### Layer 3: level files

```
level @name from levels/<file>.txt
```

A level file describes a scene in text: a map of tiles drawn as characters,
a legend, characters, zones and doors, or (with `copy: <scene>`) a copy of a
base scene with changes. Its syntax is documented with the level builder;
each of its lines is one of the operations above.

## Scripts

Life and track scripts are written in the listing syntax of the game's
script language (one instruction per line, as the disassembler prints
them), with:

- labels: `name:` defines one, `@name` jumps to it; track labels can be
  used from the same object's life script (`SET_TRACK @walk`);
- names: `@funfrock` (an object), `@freed` (a game flag), `@yard` (a scene)
  wherever the instruction takes a number;
- `"quoted text"` wherever an instruction takes a text id;
- plain numbers for the base's own things (object 4, track offset 46).

Every instruction of the game's language is allowed, nothing else. The
assembler round-trips all 2041 original scripts byte for byte.

## Engine features

Declared in `requires.features`; a loaded mod set turns on the union.

| Feature | What it does |
|---|---|
| `hero-models` | a scene can be played as another character (`hero`): the engine loads the hero's five models from the scene's entry in a table the build writes |
| `body-pool` | room for more 3D models in one scene than the original's 400 KB (e.g. a scene that shows every model) |
| `end-fade` | `THE_END` fades to black before the credits (the original cuts) |

The list grows as mods need more. A feature is only added when a mod can't
do without it, and it must leave the engine exactly as it was while off.

## Building

Input: the base, the mod set in order. For each mod, in order: check its
`requires`, then apply its operation files in order, resolving names as
they're defined. A name used before it's defined, a missing base entry, a
failed `expect`, or two mods replacing the same thing (the same entry,
object, or text, without one being `after` the other) stop the build with a
message naming the mod and the line.

Output: the overlay (the changed and added game files) and a small index:
the mod set, the allocated numbers for each name, the features. The page
keeps the overlay in the browser, keyed by the base's release, each mod's
SHA-256 and the builder's version, so a mod set is built once.

The engine reads the overlay's files in place of the base's: the build
writes whole archives (an archive with a changed entry is rewritten), and
the page points the engine at a folder holding the overlay's archives and
the base's untouched ones.

Saves belong to a mod set: each has its own save folder, so a mod never
loads a save made without it (or with a different one).

## `mod check`

A package is acceptable if:

1. `mod.json` is valid and its operation files parse;
2. it contains no executable code and nothing outside the layout above;
3. **no file in it contains original data**: every file is scanned for any
   run of 64 bytes that also occurs in the release's files (or in their
   decompressed entries); media are checked after conversion as well;
4. every `entry patch` sets at most 256 bytes.

The page runs the same check before building, so a package that fails is
never loaded, wherever it came from.

## Example: Little Big Rescue

```
# mod.ops
hero zoe from file3d 22 body 48 bones 0,1,2,3,4,5,6,7,8,9,11,12,14,15,16,-,-,-,17 \
         outfit 4 body @coat voice 30:32 22:1.6 0:1.5 99:1.5 101:1.5
body copy 48 as @coat recolor 224:250 dim 250:3

level @outside from levels/zoe_outside.txt
level @prison  from levels/zoe_prison.txt      # copy: 0 (the Citadel prison), with Zoe, the robot guard, the coat…
level @yard    from levels/zoe_yard.txt        # copy: 1 (the yard), with Funfrock and the walk-off
```

```
# levels/zoe_prison.txt (excerpt)
copy: 0
hero: @zoe
caught: game over
text 4: Hellooooo nurse... I mean, colleague!
object 20: model 54 body 0 life 4 armour 1 drops 1 key
script 20: zoe_guard
add actor @twinsen: 0 body 3 at 26880 768 26750 script zoe_twinsen
```

```
# scripts/zoe_funfrock.script (excerpt)
== life
start:
  IF FLAG_GAME(@freed) == 1 else @gone
  SET_TRACK @arrive
  SET_COMPORTEMENT @waiting
  END_COMPORTEMENT
```

## Open questions

- **New art.** Recolouring and reusing the base's models covers a lot;
  genuinely new models, sprites or tiles need an import path from ordinary
  formats (PNG for sprites and bricks, a mesh format for models). Not in v1.
- **New music.** The base's tracks can be chosen per scene; new music
  (OGG/MP3 in the mod) needs a small engine hook.
- **Translations.** A fan translation is a mod that rewords every line of a
  bank; `text … reword` covers it, but a whole-bank form may be clearer.
- **Other releases.** Steam's, and the original CD release, once tested.
- **The loader's release list** lives with the page; mods name releases by
  id. Who maintains it, and how a mod asks for a new one.
