// Toggle Chest (3D Canvas): closed <-> looted.
// GM macro. On the Tiles layer, select one or more chest tiles, then run.
// Swaps the tile's GLB and resizes the tile so the chest keeps its scale and position.
const DIR = "assets/models/props/";
// Model bounding boxes in Blender units (1 unit = 1 grid square): w = X, h = Y (canvas N-S), d = Z (height)
const V = {
  closed: { file: DIR + "chest-closed.glb", w: 0.653, h: 0.454, d: 0.398 },
  looted: { file: DIR + "chest-looted.glb", w: 0.653, h: 0.648, d: 0.7128 },
};
const F = "levels-3d-preview";
const tiles = canvas.tiles.controlled.filter((t) => /chest-(closed|looted)\.glb$/i.test(t.document.getFlag(F, "model3d") ?? ""));
if (!tiles.length) return ui.notifications.warn("Select a chest tile on the Tiles layer first.");
const updates = tiles.map((t) => {
  const doc = t.document;
  const looted = /chest-looted/i.test(doc.getFlag(F, "model3d"));
  const from = looted ? V.looted : V.closed, to = looted ? V.closed : V.looted;
  const s = doc.width / from.w; // canvas px per Blender unit for this tile (keeps any custom scale)
  const cx = doc.x + doc.width / 2, cy = doc.y + doc.height / 2; // model origin sits at the tile centre
  const w = Math.round(to.w * s), h = Math.round(to.h * s);
  return {
    _id: doc.id, x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), width: w, height: h,
    [`flags.${F}.model3d`]: to.file,
    [`flags.${F}.depth`]: Math.round(to.d * s),
    [`flags.${F}.autoCenter`]: false,
  };
});
await canvas.scene.updateEmbeddedDocuments("Tile", updates);
ui.notifications.info(`Chest ${updates.length > 1 ? "tiles" : "tile"} toggled.`);
