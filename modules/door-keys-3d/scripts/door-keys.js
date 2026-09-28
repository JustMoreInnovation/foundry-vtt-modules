const MODULE_ID = "door-keys-3d";
const REACH = 1.2; // grid squares from the door's centre (covers orthogonal + diagonal neighbours)

Hooks.once("ready", () => console.log(`${MODULE_ID} | ready`));

Hooks.on("updateToken", (tokenDoc, changes) => {
  if (!("x" in changes) && !("y" in changes)) return;
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return; // only one GM client acts
  tryUnlock(tokenDoc).catch((err) => console.error(`${MODULE_ID} |`, err));
});

async function tryUnlock(tokenDoc) {
  const L = game.Levels3DPreview;
  if (!L?._active || tokenDoc.parent?.id !== canvas.scene?.id) {
    return; // GM must have this scene open in 3D view
  }
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
      const state = tileDoc.getFlag("levels-3d-preview", `modelDoors.${doorId}`)?.ds;
      if (Number(state) !== 2) continue; // only act on locked doors

      const V = mesh.position.constructor;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      mesh.updateWorldMatrix(true, false);
      const centre = mesh.localToWorld(mesh.geometry.boundingBox.getCenter(new V()));
      const dist = Math.hypot(centre.x * L.factor - tx, centre.z * L.factor - ty) / size;
      if (dist > REACH) continue;

      const wanted = String(keyName).trim().toLowerCase();
      const key = actor.items.find((i) => i.name.trim().toLowerCase() === wanted);
      if (!key) continue;

      await tileDoc.setFlag("levels-3d-preview", `modelDoors.${doorId}.ds`, 0);
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<p>${actor.name} unlocks the door with the <strong>${key.name}</strong>.</p>`,
      });
    }
  }
}
