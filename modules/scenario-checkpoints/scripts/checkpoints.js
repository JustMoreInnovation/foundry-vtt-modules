/**
 * Scenario Checkpoints (scenario-checkpoints)
 * Save the current scene + everything it depends on into an Adventure "checkpoint", and restore it later.
 *
 * Saved per checkpoint: the scene (tokens, tiles incl. loot-3d chest/lid/lock state, lights, notes...),
 * the actors of every token on it, every loot-3d / chest-loot-3d contents actor, journal entries pinned
 * as notes, and the folders they live in. Player characters are optional.
 *
 * Restoring re-imports that Adventure: documents with the same IDs are fully replaced (embedded tiles,
 * tokens and items included), documents deleted since are recreated.
 */
const ID = "scenario-checkpoints";
const PACK_NAME = "scenario-checkpoints";
const PACK_LABEL = "Scenario Checkpoints";
const LOOT_SCOPES = ["loot-3d", "chest-loot-3d"];

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

Hooks.once("init", () => {
  game.modules.get(ID).api = { save: saveCheckpoint, load: loadCheckpoint, getPack };
});

/* -------------------------------------------- */
/*  Compendium                                  */
/* -------------------------------------------- */

async function getPack({ create = true } = {}) {
  let pack = game.packs.get(`world.${PACK_NAME}`) ?? game.packs.find((p) => p.metadata.label === PACK_LABEL && p.documentName === "Adventure");
  if (!pack && create) {
    pack = await foundry.documents.collections.CompendiumCollection.createCompendium({
      name: PACK_NAME,
      label: PACK_LABEL,
      type: "Adventure",
      system: game.system.id, // required, or Foundry strips Actors/Items out of the Adventure
    });
  }
  if (pack && !pack.metadata.system) {
    ui.notifications.error(
      `Compendium "${pack.metadata.label}" isn't tied to a game system, so it can't store actors. Delete it and run Save Checkpoint again.`,
      { permanent: true },
    );
    return null;
  }
  return pack;
}

/* -------------------------------------------- */
/*  Collect                                     */
/* -------------------------------------------- */

function isPlayerCharacter(actor) {
  return actor.type === "character" || actor.hasPlayerOwner;
}

async function collect(scene, { includePCs }) {
  const actors = new Map();
  const journal = new Map();
  const addActor = (a) => {
    if (!a || a.pack || a.isToken) return; // world actors only
    if (!includePCs && isPlayerCharacter(a)) return;
    actors.set(a.id, a);
  };

  // Base actors of every token (linked tokens store their data on the actor; unlinked ones in the scene)
  for (const t of scene.tokens) addActor(game.actors.get(t.actorId));

  // Loot contents actors referenced by tiles
  for (const tile of scene.tiles) {
    for (const scope of LOOT_SCOPES) {
      const uuid = tile.flags?.[scope]?.actorUuid;
      if (uuid) addActor(fromUuidSync(uuid));
    }
  }

  // Journal entries pinned on the scene, plus the scene's own journal link
  for (const n of scene.notes) {
    const j = game.journal.get(n.entryId);
    if (j) journal.set(j.id, j);
  }
  const sj = scene.journal?.id ? game.journal.get(scene.journal.id) : null;
  if (sj) journal.set(sj.id, sj);

  // Folders (and their parents) so everything lands back where it was
  const folders = new Map();
  const addFolder = (f) => {
    while (f && !folders.has(f.id)) {
      folders.set(f.id, f);
      f = f.folder;
    }
  };
  addFolder(scene.folder);
  for (const a of actors.values()) addFolder(a.folder);
  for (const j of journal.values()) addFolder(j.folder);

  return {
    scenes: [scene.toObject()],
    actors: [...actors.values()].map((a) => a.toObject()),
    journal: [...journal.values()].map((j) => j.toObject()),
    folders: [...folders.values()].map((f) => f.toObject()),
    counts: { actors: actors.size, journal: journal.size, pcs: [...actors.values()].filter(isPlayerCharacter).length },
  };
}

/* -------------------------------------------- */
/*  Save                                        */
/* -------------------------------------------- */

async function saveCheckpoint(scene = canvas.scene) {
  if (!game.user.isGM) return ui.notifications.warn("Only the GM can save checkpoints.");
  if (!scene) return ui.notifications.warn("View a scene first.");
  const pack = await getPack();
  if (!pack) return;

  const existing = (await pack.getDocuments()).filter((a) => a.getFlag(ID, "sceneId") === scene.id);
  const stamp = new Date().toLocaleString();
  const options = existing
    .sort((a, b) => (b.getFlag(ID, "savedAt") ?? 0) - (a.getFlag(ID, "savedAt") ?? 0))
    .map((a) => `<option value="${a.id}">Overwrite: ${esc(a.name)}</option>`)
    .join("");
  const data = await foundry.applications.api.DialogV2.prompt({
    window: { title: `Save Checkpoint: ${scene.name}` },
    content: `
      <div class="form-group"><label>Name</label><input type="text" name="name" value="${esc(`${scene.name} – ${stamp}`)}" autofocus></div>
      <div class="form-group"><label>Save as</label><select name="target"><option value="">New checkpoint</option>${options}</select></div>
      <div class="form-group"><label>Include player characters</label><input type="checkbox" name="includePCs"></div>
      <p class="hint">Saves this scene (tokens, tiles, chest states), its monsters, loot containers and pinned journals.
      Player characters are only saved if ticked, so a reset normally leaves their loot and XP alone.</p>`,
    ok: { label: "Save", callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
    rejectClose: false,
  });
  if (!data) return;

  const content = await collect(scene, { includePCs: !!data.includePCs });
  const savedAt = Date.now();
  const adventureData = {
    name: data.name || `${scene.name} – ${stamp}`,
    img: scene.thumb || undefined,
    caption: `Checkpoint of ${scene.name}`,
    description: `<p>Saved ${esc(stamp)}.</p><p>${content.counts.actors} actor(s)${content.counts.pcs ? ` incl. ${content.counts.pcs} player character(s)` : ""}, ${content.counts.journal} journal entr${content.counts.journal === 1 ? "y" : "ies"}.</p>`,
    scenes: content.scenes,
    actors: content.actors,
    journal: content.journal,
    folders: content.folders,
    flags: { [ID]: { sceneId: scene.id, savedAt, includePCs: !!data.includePCs } },
  };

  if (data.target) await pack.getDocument(data.target).then((old) => old?.delete());
  const adv = await CONFIG.Adventure.documentClass.create(adventureData, { pack: pack.collection });
  ui.notifications.info(`Checkpoint saved: ${adv.name} (${content.counts.actors} actors).`);
  return adv;
}

/* -------------------------------------------- */
/*  Load                                        */
/* -------------------------------------------- */

async function loadCheckpoint() {
  if (!game.user.isGM) return ui.notifications.warn("Only the GM can load checkpoints.");
  const pack = await getPack({ create: false });
  if (!pack) return ui.notifications.warn("No checkpoints saved yet.");
  const all = (await pack.getDocuments()).sort((a, b) => (b.getFlag(ID, "savedAt") ?? 0) - (a.getFlag(ID, "savedAt") ?? 0));
  if (!all.length) return ui.notifications.warn("No checkpoints saved yet.");

  const current = canvas.scene?.id;
  const preselect = all.find((a) => a.getFlag(ID, "sceneId") === current)?.id;
  const opts = all
    .map((a) => {
      const f = a.flags?.[ID] ?? {};
      const when = f.savedAt ? new Date(f.savedAt).toLocaleString() : "";
      return `<option value="${a.id}" ${a.id === preselect ? "selected" : ""}>${esc(a.name)}${f.includePCs ? " [+PCs]" : ""}${when ? ` (${esc(when)})` : ""}</option>`;
    })
    .join("");
  const data = await foundry.applications.api.DialogV2.prompt({
    window: { title: "Load Checkpoint" },
    content: `
      <div class="form-group"><label>Checkpoint</label><select name="id">${opts}</select></div>
      <div class="form-group"><label>Reset player characters too</label><input type="checkbox" name="resetPCs"></div>
      <div class="form-group"><label>End combat on that scene</label><input type="checkbox" name="endCombat" checked></div>
      <p class="hint">Everything saved in the checkpoint is put back exactly as it was. Anything added to the scene since is removed.
      Player characters are only reset if the checkpoint included them and the box is ticked.</p>`,
    ok: { label: "Load", callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
    rejectClose: false,
  });
  if (!data?.id) return;

  const adv = all.find((a) => a.id === data.id);
  const sceneId = adv.getFlag(ID, "sceneId");

  if (data.endCombat) {
    const combats = game.combats.filter((c) => c.scene?.id === sceneId).map((c) => c.id);
    if (combats.length) await Combat.deleteDocuments(combats);
  }

  // Leave player characters alone unless asked (they may have been saved in the checkpoint).
  const skipPCs = (importData) => {
    if (data.resetPCs) return;
    for (const bucket of [importData.toCreate, importData.toUpdate]) {
      if (!bucket.Actor) continue;
      bucket.Actor = bucket.Actor.filter((a) => !(a.type === "character" || Object.entries(a.ownership ?? {}).some(([uid, lvl]) => uid !== "default" && lvl === 3 && !game.users.get(uid)?.isGM)));
      if (!bucket.Actor.length) delete bucket.Actor;
    }
  };

  const result = await adv.import({ dialog: false, preImport: [skipPCs] });
  const n = Object.values(result.created ?? {}).flat().length + Object.values(result.updated ?? {}).flat().length;
  ui.notifications.info(`Checkpoint loaded: ${adv.name} (${n} documents restored).`);

  // Redraw the restored scene; 3D Canvas may need other clients to press F5.
  const scene = game.scenes.get(sceneId);
  if (scene) {
    if (canvas.scene?.id === sceneId) await canvas.draw();
    else await scene.view();
  }
  return result;
}
