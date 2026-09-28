/**
 * Door keys: unlocks a locked 3D Canvas *model door* (mesh with isDoor + doorId) when a token whose actor
 * carries the matching key item moves next to it. The key name comes from the door mesh's `keyName`
 * custom property (set in Blender, exported as glTF extras).
 */
import { ID, L3D, state, esc } from "./constants.js";

const REACH = 1.2; // grid squares from the door's centre (covers orthogonal + diagonal neighbours)

export function init() {
  Hooks.on("updateToken", (tokenDoc, changes) => {
    if (!state.enabled) return;
    if (!("x" in changes) && !("y" in changes)) return;
    if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return; // only one GM client acts
    tryUnlock(tokenDoc).catch((err) => console.error(`${ID} | door-keys`, err));
  });
}

async function tryUnlock(tokenDoc) {
  const L = game.Levels3DPreview;
  if (!L?._active || tokenDoc.parent?.id !== canvas.scene?.id) return; // GM must have this scene open in 3D
  const actor = tokenDoc.actor;
  if (!actor) return;
  const size = canvas.dimensions.size;
  const tx = tokenDoc.x + (tokenDoc.width * size) / 2;
  const ty = tokenDoc.y + (tokenDoc.height * size) / 2;

  for (const tile3d of Object.values(L.tiles ?? {})) {
    const tileDoc = tile3d?.tile?.document;
    const doors = tile3d?._doors;
    if (!tileDoc || !doors) continue;
    for (const [doorId, mesh] of Object.entries(doors)) {
      const keyName = mesh.userData?.keyName;
      if (!keyName) continue;
      if (Number(tileDoc.getFlag(L3D, `modelDoors.${doorId}`)?.ds) !== 2) continue; // only locked doors

      const V = mesh.position.constructor;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      mesh.updateWorldMatrix(true, false);
      const centre = mesh.localToWorld(mesh.geometry.boundingBox.getCenter(new V()));
      if (Math.hypot(centre.x * L.factor - tx, centre.z * L.factor - ty) / size > REACH) continue;

      const wanted = String(keyName).trim().toLowerCase();
      const key = actor.items.find((i) => i.name.trim().toLowerCase() === wanted);
      if (!key) continue;

      await tileDoc.setFlag(L3D, `modelDoors.${doorId}.ds`, 0);
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<p>${esc(actor.name)} unlocks the door with the <strong>${esc(key.name)}</strong>.</p>`,
      });
    }
  }
}
