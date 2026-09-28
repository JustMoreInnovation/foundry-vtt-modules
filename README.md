# Foundry VTT 3D modules and assets

Custom modules, macros and 3D models for [Foundry VTT](https://foundryvtt.com) v13–v14 with the
[3D Canvas](https://foundryvtt.com/packages/levels-3d-preview) module (`levels-3d-preview`). Built and tested with the D&D 5e system 5.3.

| Closed | Opened |
|---|---|
| ![Chest closed](docs/images/chest-closed.png) | ![Chest opened](docs/images/chest-looted.png) |

## Modules (`modules/`)

| Module | What it does | Requires |
|---|---|---|
| **loot-3d** (3D Loot) | Any 3D tile becomes lootable: a chest, a bone pile, a barrel. Players click it, can need a key, and see a loot window with Take / Take all. Supports a lid animation, locks and keys, and removing the tile when it's empty. Contents come from a linked "contents actor". | levels-3d-preview, socketlib |
| **scenario-checkpoints** | Saves the current scene plus its monsters, loot actors and pinned journals as an Adventure "checkpoint", and restores it later so a scenario can be reset or replayed. | – |
| **door-keys-3d** | Unlocks a locked 3D-model door when a token carrying the matching key item (`keyName` on the door mesh) moves next to it. | levels-3d-preview |

### Install
Copy (or symlink/junction) a module folder into your Foundry `Data/modules/` folder, then enable it in **Manage Modules**.

Macros:
```js
game.modules.get("loot-3d").api.configure();          // select a tile first (Tiles layer)
game.modules.get("scenario-checkpoints").api.save();
game.modules.get("scenario-checkpoints").api.load();
```

## 3D assets
- `foundry-assets/models/`: ready-to-use GLBs. Copy this to `Data/assets/models/`, because the modules expect `assets/models/props/chest-animated.glb`.
  - `props/chest-animated.glb`: a treasure chest with an `Open` lid clip (used by loot-3d's chest preset). About 950 triangles, 3 materials.
  - `props/chest-closed.glb` / `chest-looted.glb`: static versions, for use with `macros/toggle-chest-static.js`.
  - `two-room-dungeon.glb`: an 18×12-square test dungeon with a lockable door. 3D Canvas sight and collision come from mesh tags.
- `blender/`: the Blender 5.2 source files, with textures linked by relative paths.

### Blender → 3D Canvas conventions
- 1 Blender unit = 1 grid square (5 ft). 3D Canvas drops models at true scale.
- Mesh tags are Object custom properties, which export as glTF extras: `collision`, `sight`, `isDoor`, `doorId`, `keyName`. Export with **Include → Custom Properties** on.
- For a door or any other mesh whose position matters, parent an Empty to it. 3D Canvas bakes the transforms of childless meshes in non-animated models.
- A prop that opens should be one GLB whose rest pose is closed and that has an opening clip. loot-3d drives it through 3D Canvas's "door linked to animation" (door style 5).

## License
MIT. See [LICENSE](LICENSE).
