# Modding Monster Feeder

Monster Feeder is built to be modded without touching engine code. A mod is
a plain folder of JSON + PNG + audio files — no build step, no tooling.
**Drop the folder (or a .zip of it) anywhere onto the game window** and it
installs instantly, persists across sessions, and its songs, characters and
foods appear in the select screens next to the built-in content.

## Quick start

1. Copy [`examples/sample-mod/`](examples/sample-mod/) somewhere and rename it.
2. Edit `mod.json`: change `id` (lowercase letters/digits/dashes) and `name`.
3. Swap in your own art, audio and charts (references below).
4. Drag the folder onto the game window (Chrome/Edge/Firefox), or zip it
   (`zip -r my-mod.zip my-mod`) and drop / pick the zip — the zip works in
   every browser via the **M** → Mods panel file picker.

If anything is wrong, the Mods panel lists every problem with the exact file
and field, e.g.

```
characters/blobby/character.json: animation 'chomp_left' missing (required: idle, chomp_left, chomp_right, chomp_up, chomp_down, perfect, splat, ko)
songs/bounce/chart.json: notes[12].dir: "diagonal" is not one of left/right/up/down
```

Fix the file and drop the folder again — **re-dropping a mod with the same
`id` replaces it**, which is the edit-test loop. Remove a mod from the Mods
panel (**M**).

Mods are stored in your browser (IndexedDB). They never leave your machine;
to share a mod, send the folder/zip itself.

## Mod layout

```
my-mod/
  mod.json                          ← the manifest (required)
  songs/bounce/
    chart.json                      ← notes + song metadata
    bounce.wav                      ← the music
  characters/blobby/
    character.json                  ← animations + voice wiring
    atlas.json                      ← spritesheet grid size
    sheet.png                       ← the spritesheet
    voice/chomp.wav …               ← voice clips
  foods/
    foods.json                      ← food definitions
    pepper.png                      ← food sprites
```

Only `mod.json` must sit at the root and have that exact name; everything
else is referenced by path, so lay files out however you like. Paths inside
`chart.json` / `character.json` / `foods.json` are relative to **that file's
own folder**.

## mod.json

```json
{
  "version": 1,
  "id": "my-cool-mod",
  "name": "My Cool Mod",
  "author": "you",
  "songs": ["songs/bounce/chart.json"],
  "characters": ["characters/blobby/character.json"],
  "foods": ["foods/foods.json"]
}
```

| field | | |
|---|---|---|
| `version` | required | must be `1` |
| `id` | required | `[a-z0-9-]+` — the install key; same id replaces |
| `name` | required | shown in the select screens and Mods panel |
| `author` | optional | |
| `songs` / `characters` / `foods` | optional | lists of entry-JSON paths from the mod root; at least one item total |

## Songs — chart.json

```json
{
  "version": 1,
  "song": {
    "title": "Bounce",
    "artist": "Sample Mod",
    "audio": "bounce.wav",
    "bpm": 120,
    "offsetMs": 0
  },
  "difficulty": "normal",
  "foods": { "down": "pepper" },
  "notes": [
    { "timeMs": 2000, "dir": "down" },
    { "timeMs": 2500, "dir": "left", "food": "pepper" },
    { "timeMs": 3000, "dir": "up", "type": "hold", "durationMs": 500 }
  ]
}
```

- `song.audio` — audio file relative to the chart. **Use `.wav` or `.mp3`**;
  `.ogg` doesn't decode in Safari.
- `song.bpm` + `song.offsetMs` drive beat-synced visuals; note times are
  **absolute milliseconds into the audio**, not beats.
- `notes[].dir` — `left` / `right` / `up` / `down` (the arrow the player hits).
- `notes[].food` — optional food id for this one note.
- `foods` — optional default food per direction. Resolution order per note:
  `note.food` → `foods[dir]` → the built-in food for that direction.
  A chart sees its **own mod's foods plus the built-ins** (cross-mod
  references aren't supported).

## Characters — character.json + atlas.json + sheet.png

A character is a spritesheet + JSON. The sheet is a uniform grid; frames are
numbered **row-major** starting at 0 (left→right, top→bottom).

`atlas.json`:

```json
{ "frameWidth": 128, "frameHeight": 128 }
```

`character.json`:

```json
{
  "id": "blobby",
  "name": "Blobby",
  "spritesheet": "sheet.png",
  "atlas": "atlas.json",
  "animations": {
    "idle":        { "frames": [0, 1, 0, 2], "fps": 4, "loop": true },
    "chomp_left":  { "frames": [3, 4], "fps": 14 },
    "chomp_right": { "frames": [5, 6], "fps": 14 },
    "chomp_up":    { "frames": [7, 8], "fps": 14 },
    "chomp_down":  { "frames": [9, 10], "fps": 14 },
    "perfect":     { "frames": [11, 12], "fps": 10 },
    "splat":       { "frames": [13, 14], "fps": 10 },
    "ko":          { "frames": [15, 16, 17], "fps": 8 }
  },
  "voice": {
    "chomp":   ["voice/chomp.wav"],
    "perfect": ["voice/yum.wav"],
    "splat":   ["voice/bleh.wav"],
    "ko":      ["voice/ko.wav"],
    "cheer":   ["voice/cheer.wav"]
  }
}
```

**Required animations** (the game plays these unconditionally):

| animation | plays when |
|---|---|
| `idle` | waiting (usually `loop: true`) |
| `chomp_left/right/up/down` | food eaten from that direction |
| `perfect` | flourish chained after a perfect chomp |
| `splat` | a miss lands on the face |
| `ko` | hunger empty — holds its last frame |

**Optional animations:** `combo_10`, `combo_25` (looping combo escalations)
and `fever` (looping, at 50+ combo).

**Voice** is optional. Keys the game uses: `chomp`, `perfect`, `splat`,
`ko`, `cheer` (song cleared). Each key lists one or more clips — one is
picked at random each time. `.wav`/`.mp3` again.

**Eyes** (optional): overlay pupils that track incoming food. Positions are
in frame pixels (origin = frame top-left):

```json
"eyes": {
  "left":  { "x": 47, "y": 62 },
  "right": { "x": 81, "y": 62 },
  "travel": 3.5,
  "pupilRadius": 4,
  "color": "#26183f",
  "hiddenDuring": ["chomp_left", "ko"]
}
```

Draw empty eye whites in frames where the overlay should show; list
animations that bake their own eye art in `hiddenDuring`.

## Foods — foods.json

```json
{
  "version": 1,
  "foods": [
    { "id": "pepper", "name": "Pepper", "color": "#ff4422", "image": "pepper.png" }
  ]
}
```

- `color` (required, `#rrggbb`) tints hit particles and face splats, and is
  the fill of the fallback circle when there's no image.
- `image` (optional) — a small PNG (~40px, transparent background) drawn at
  ~38px in game.
- Built-in food ids you can reference from any chart: `taffy` (left,
  yellow), `berry` (right, pink), `icepop` (up, blue), `lime` (down, green).
- Food ids share one namespace per mod — you can't reuse a built-in id.

## Regenerating the sample mod

`examples/sample-mod/` is generated (procedural PNG + WAV, zero deps):

```sh
node scripts/make-sample-mod.mjs
```

## Troubleshooting

- **"audio … could not be decoded"** — convert to `.wav` or `.mp3`.
- **"frame N out of range"** — an animation references a frame index past
  the end of the sheet grid (`cols × rows − 1`).
- **Nothing happens on drop** — some browsers block folder drops; zip the
  folder and use the file picker in the Mods panel (**M**).
- **Mod vanished after clearing browser data** — mods live in IndexedDB;
  keep your source folder and re-drop.
