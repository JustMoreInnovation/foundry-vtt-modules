/**
 * One-way, idempotent migration from the standalone modules (loot-3d, chest-loot-3d, scenario-checkpoints)
 * and from world-level asset paths to the copies shipped inside this module. Runs on the active GM client.
 * Old flags are left in place (harmless) so switching back is possible.
 */
import { ID, L3D, MODULE_PATH } from "./constants.js";

/** Asset paths that used to live in Data/assets and now ship with the module. */
const MOVED_MODELS = Object.fromEntries(
  [
    "props/chest-animated.glb",
    "props/chest-closed.glb",
    "props/chest-looted.glb",
    "two-room-dungeon.glb",
    "two-room-dungeon-nodoor.glb",
  ].map((p) => [`assets/models/${p}`, `${MODULE_PATH}/assets/models/${p}`]),
);

function lootFlagsFrom(tile) {
  if (tile.flags?.[ID]?.actorUuid) return null; // already migrated
  const v2 = tile.flags?.["loot-3d"];
  if (v2?.actorUuid) return { ...v2 };
  const v1 = tile.flags?.["chest-loot-3d"];
  if (v1?.actorUuid) return { ...v1, hasLid: v1.hasLid ?? true, removeWhenEmpty: false };
  return null;
}

export async function migrate() {
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
  const counts = { tiles: 0, models: 0, actors: 0 };

  for (const scene of game.scenes) {
    const updates = [];
    for (const tile of scene.tiles) {
      const update = { _id: tile.id };
      const loot = lootFlagsFrom(tile);
      if (loot) {
        update[`flags.${ID}`] = loot;
        update[`flags.${L3D}.sight`] = false;
        counts.tiles++;
      }
      const model = tile.flags?.[L3D]?.model3d;
      const moved = model && MOVED_MODELS[model.replace(/^\/+/, "")];
      if (moved) {
        update[`flags.${L3D}.model3d`] = moved;
        counts.models++;
      }
      if (Object.keys(update).length > 1) updates.push(update);
    }
    if (updates.length) await scene.updateEmbeddedDocuments("Tile", updates);
  }

  for (const actor of game.actors) {
    const legacy = actor.flags?.["loot-3d"]?.isLootable || actor.flags?.["chest-loot-3d"]?.isChest;
    if (legacy && !actor.flags?.[ID]?.isLootable) {
      await actor.update({ [`flags.${ID}.isLootable`]: true });
      counts.actors++;
    }
  }

  if (counts.tiles || counts.models || counts.actors) {
    console.log(`${ID} | migration`, counts);
    ui.notifications.info(
      `3D Toolkit: migrated ${counts.tiles} lootable tile(s), ${counts.actors} contents actor(s) and ${counts.models} model path(s).`,
    );
  }
  return counts;
}
