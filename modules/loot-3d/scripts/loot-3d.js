/**
 * 3D Loot (loot-3d)
 * Turns any 3D Canvas tile into a lootable container: a chest, a pile of bones, a barrel, a corpse...
 *
 * - Contents live on a linked "contents actor" (items + currency). Only what's on that actor is lootable.
 * - Players click the tile (Token layer, token selected, within 3 squares) to open it and get a loot window.
 * - Optional lock + key item. Optional lid animation (any GLB with an opening clip). Optional auto-remove when emptied.
 * - Every transfer runs on the GM client via socketlib.
 *
 * Successor of chest-loot-3d; existing chest tiles/actors are migrated on the GM's first load.
 */
const ID = "loot-3d";
const OLD_ID = "chest-loot-3d";
const L3D = "levels-3d-preview";
const PATCHED = Symbol.for(`${ID}.patched`);
const CURRENCIES = ["pp", "gp", "ep", "sp", "cp"];
const STACKABLE = ["consumable", "loot"];

/** Model presets offered in the configure dialog. `lid` = the GLB has an opening animation. */
const PRESETS = {
  keep: { label: "Keep current model" },
  chest: { label: "Treasure chest (animated lid)", model: "assets/models/props/chest-animated.glb", lid: true, sound: "woodCreaky", name: "Treasure Chest" },
};

let socket;
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/* -------------------------------------------- */
/*  Setup                                       */
/* -------------------------------------------- */

Hooks.once("socketlib.ready", () => {
  socket = socketlib.registerModule(ID);
  socket.register("open", gmOpen);
  socket.register("setState", gmSetState);
  socket.register("getContents", gmGetContents);
  socket.register("takeItem", gmTakeItem);
  socket.register("takeCurrency", gmTakeCurrency);
  socket.register("takeAll", gmTakeAll);
  socket.register("refresh", refreshWindows);
});

Hooks.once("init", () => {
  game.modules.get(ID).api = {
    configure: configureLootable,
    configureChest: configureLootable, // old macro name keeps working
    openLootWindow,
    presets: PRESETS,
    status: () => ({ ready: !!game.Levels3DPreview, patched: isPatched() }),
  };
});

Hooks.once("ready", async () => {
  if (game.modules.get(OLD_ID)?.active) {
    ui.notifications.error("3D Loot: disable the old \"3D Chest Loot\" module, it conflicts with this one.", { permanent: true });
    return;
  }
  if (game.user === game.users.activeGM) await migrate();
  if (!game.modules.get(L3D)?.active) return;

  // 3D Canvas creates game.Levels3DPreview in its own "ready" hook, which may run after ours.
  let L = game.Levels3DPreview;
  for (let i = 0; !L && i < 600; i++) {
    await new Promise((r) => setTimeout(r, 50));
    L = game.Levels3DPreview;
  }
  if (!L) return console.error(`${ID} | 3D Canvas never initialised; loot clicks disabled`);

  // Tile3D isn't global: grab it from a live instance and patch its prototype.
  const patchFromLive = () => {
    const any = Object.values(L.tiles ?? {})[0] ?? Object.values(L.loadingTiles ?? {})[0];
    if (any) patchTile3D(any.constructor);
  };
  const origCreate = L.createTile;
  L.createTile = function (tile) {
    const r = origCreate.call(this, tile);
    const t = this.tiles?.[tile.id] ?? this.loadingTiles?.[tile.id];
    if (t) patchTile3D(t.constructor);
    return r;
  };
  patchFromLive();
  Hooks.on("3DCanvasSceneReady", patchFromLive);
  Hooks.on("canvasReady", () => setTimeout(patchFromLive, 500));
  const timer = setInterval(() => {
    patchFromLive();
    if (isPatched()) clearInterval(timer);
  }, 1000);
  console.log(`${ID} | ready`);
});

// Contents actor edited from its sheet -> refresh open loot windows everywhere.
for (const hook of ["createItem", "updateItem", "deleteItem"]) {
  Hooks.on(hook, (item) => {
    if (game.user.isGM && item.parent?.getFlag(ID, "isLootable")) socket?.executeForEveryone("refresh", item.parent.uuid);
  });
}
Hooks.on("updateActor", (actor, changes) => {
  if (game.user.isGM && actor.getFlag(ID, "isLootable") && foundry.utils.hasProperty(changes, "system.currency")) {
    socket?.executeForEveryone("refresh", actor.uuid);
  }
});
Hooks.on("updateTile", (tileDoc, changes) => {
  if (tileDoc.getFlag(ID, "actorUuid") && foundry.utils.hasProperty(changes, `flags.${L3D}.doorState`)) {
    refreshWindows(tileDoc.getFlag(ID, "actorUuid"));
  }
});
Hooks.on("deleteTile", (tileDoc) => windows.get(tileDoc.uuid)?.close());

/* -------------------------------------------- */
/*  Migration from chest-loot-3d                */
/* -------------------------------------------- */

async function migrate() {
  let tiles = 0;
  let actors = 0;
  for (const scene of game.scenes) {
    const updates = [];
    for (const tile of scene.tiles) {
      const old = tile.flags?.[OLD_ID];
      if (!old?.actorUuid || tile.flags?.[ID]?.actorUuid) continue;
      updates.push({
        _id: tile.id,
        [`flags.${ID}`]: { ...old, hasLid: old.hasLid ?? true, removeWhenEmpty: false },
        [`flags.${L3D}.sight`]: false,
      });
    }
    if (updates.length) {
      await scene.updateEmbeddedDocuments("Tile", updates);
      tiles += updates.length;
    }
  }
  for (const actor of game.actors) {
    if (actor.flags?.[OLD_ID]?.isChest && !actor.flags?.[ID]?.isLootable) {
      await actor.update({ [`flags.${ID}.isLootable`]: true });
      actors++;
    }
  }
  if (tiles || actors) {
    console.log(`${ID} | migrated ${tiles} tile(s) and ${actors} actor(s) from ${OLD_ID}`);
    ui.notifications.info(`3D Loot: migrated ${tiles} lootable tile(s) from 3D Chest Loot.`);
  }
}

/* -------------------------------------------- */
/*  3D Canvas patches                           */
/* -------------------------------------------- */

function isPatched() {
  const any = Object.values(game.Levels3DPreview?.tiles ?? {})[0];
  return !!any && !!Object.getPrototypeOf(any)[PATCHED];
}

function patchTile3D(cls) {
  const proto = cls?.prototype;
  if (!proto || proto[PATCHED]) return;
  proto[PATCHED] = true;
  console.log(`${ID} | Tile3D patched`);

  // Intercept clicks on lootable tiles on the Token layer; everything else goes to 3D Canvas.
  const origClick = proto._onClickLeft;
  proto._onClickLeft = function (e) {
    const doc = this.tile?.document;
    const onTokenLayer = canvas.activeLayer?.options?.objectClass?.embeddedName === "Token";
    if (onTokenLayer && doc?.getFlag(ID, "actorUuid")) {
      onLootClick(this, doc).catch((err) => console.error(`${ID} |`, err));
      return;
    }
    return origClick.call(this, e);
  };

  // doorStyle 5 replays the closing clip on every doorState change (e.g. closed -> locked).
  // Only animate when open/closed actually changes.
  const origAnim = proto.setupAnimations;
  proto.setupAnimations = function (...args) {
    const doc = this.tile?.document;
    if (doc?.getFlag(ID, "actorUuid")) {
      const open = Number(doc.getFlag(L3D, "doorState") ?? 0) === 1;
      if (this._currentClipAction && this._lootOpen === open) return;
      this._lootOpen = open;
    }
    return origAnim.apply(this, args);
  };
}

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

/** 0 = closed, 1 = open, 2 = locked (stored in 3D Canvas's own door flag so the lid animates). */
function doorState(tileDoc) {
  return Number(tileDoc.getFlag(L3D, "doorState") ?? 0);
}

function info(tileDoc) {
  const f = tileDoc.flags?.[ID] ?? {};
  return {
    name: f.name || "Container",
    hasLid: f.hasLid !== false,
    keyName: f.keyName || "",
    consumeKey: !!f.consumeKey,
    removeWhenEmpty: !!f.removeWhenEmpty,
    actorUuid: f.actorUuid,
  };
}

function looterActor() {
  return canvas.tokens.controlled[0]?.actor ?? game.user.character ?? null;
}

function findKey(actor, keyName) {
  if (!actor || !keyName) return null;
  const k = String(keyName).trim().toLowerCase();
  return actor.items.find((i) => i.name.trim().toLowerCase() === k) ?? null;
}

function playSound(tileDoc, interaction, broadcast = false) {
  const key = tileDoc.getFlag(L3D, "doorSound");
  if (!key && interaction !== "lock") return; // lidless things (bones) are silent unless a sound is set
  const set = CONFIG.Wall.doorSounds?.[key];
  let src = set?.[interaction];
  if (Array.isArray(src)) src = src[Math.floor(Math.random() * src.length)];
  if (!src && interaction === "lock") src = CONFIG.sounds.lock;
  if (src) foundry.audio.AudioHelper.play({ src, volume: 0.8 }, broadcast);
}

/* -------------------------------------------- */
/*  Client: clicking a lootable                 */
/* -------------------------------------------- */

async function onLootClick(tile3d, tileDoc) {
  const { name, keyName } = info(tileDoc);
  if (!game.user.isGM) {
    if (!canvas.tokens.controlled.length) return ui.notifications.warn("Select your token first.");
    if (tile3d.isToFar()) return ui.notifications.warn(`You're too far away from the ${name}.`);
  }
  const state = doorState(tileDoc);
  // Already open, or the GM (who gets the management window without changing anything).
  if (state === 1 || game.user.isGM) return openLootWindow(tileDoc);
  if (state === 2 && !findKey(looterActor(), keyName)) {
    playSound(tileDoc, "lock");
    return ui.notifications.info(`The ${name} is locked.`);
  }
  if (!game.users.activeGM) return ui.notifications.warn("A GM must be connected to loot.");
  const res = await socket.executeAsGM("open", { tileUuid: tileDoc.uuid, actorUuid: looterActor()?.uuid ?? null, userId: game.user.id });
  if (!res?.ok) return ui.notifications.warn(res?.reason ?? `The ${name} won't open.`);
  openLootWindow(tileDoc);
}

/* -------------------------------------------- */
/*  GM side                                     */
/* -------------------------------------------- */

async function getLootable(tileUuid) {
  const tileDoc = await fromUuid(tileUuid);
  const actorUuid = tileDoc?.getFlag(ID, "actorUuid");
  const source = actorUuid ? await fromUuid(actorUuid) : null;
  return { tileDoc, source };
}

function canUseActor(userId, actor) {
  const user = game.users.get(userId);
  return !!user && !!actor && (user.isGM || actor.testUserPermission(user, "OWNER"));
}

async function gmOpen({ tileUuid, actorUuid, userId }) {
  const { tileDoc } = await getLootable(tileUuid);
  if (!tileDoc) return { ok: false, reason: "Not found." };
  const { name, keyName, consumeKey } = info(tileDoc);
  const state = doorState(tileDoc);
  if (state === 1) return { ok: true };
  if (state === 2) {
    const actor = actorUuid ? await fromUuid(actorUuid) : null;
    const key = canUseActor(userId, actor) ? findKey(actor, keyName) : null;
    if (!key) return { ok: false, reason: `The ${name} is locked.` };
    let text = `<p>${esc(actor.name)} unlocks the ${esc(name)} with the <strong>${esc(key.name)}</strong>.</p>`;
    if (consumeKey) {
      const qty = Number(key.system?.quantity ?? 1);
      if (qty > 1) await key.update({ "system.quantity": qty - 1 });
      else await key.delete();
      text = text.replace("</p>", " The key stays in the lock.</p>");
    }
    playSound(tileDoc, "unlock", true);
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: text });
  }
  // Single-key update so 3D Canvas only re-runs the door/animation logic (no model reload).
  await tileDoc.setFlag(L3D, "doorState", 1);
  if (info(tileDoc).hasLid) playSound(tileDoc, "open", true);
  return { ok: true };
}

async function gmSetState({ tileUuid, state, userId }) {
  const { tileDoc } = await getLootable(tileUuid);
  if (!tileDoc) return false;
  const user = game.users.get(userId);
  const current = doorState(tileDoc);
  if (current === state) return true;
  if ((state === 2 || current === 2) && !user?.isGM) return false; // only the GM locks/unlocks this way
  await tileDoc.setFlag(L3D, "doorState", state);
  playSound(tileDoc, state === 1 ? "open" : state === 2 ? "lock" : "close", true);
  return true;
}

function lootableItems(source) {
  return source.items.filter((i) => !i.system?.container); // top-level items only
}

async function gmGetContents({ tileUuid }) {
  const { tileDoc, source } = await getLootable(tileUuid);
  if (!tileDoc || !source) {
    console.warn(`${ID} | loot data missing`, { tileUuid, actorUuid: tileDoc?.getFlag(ID, "actorUuid") });
    return null;
  }
  const cur = source.system?.currency ?? {};
  return {
    ...info(tileDoc),
    actorName: source.name,
    state: doorState(tileDoc),
    currency: CURRENCIES.map((k) => ({ key: k, value: Number(cur[k] ?? 0) })).filter((c) => c.value > 0),
    items: lootableItems(source)
      .map((i) => ({ id: i.id, name: i.name, img: i.img, type: i.type, qty: Number(i.system?.quantity ?? 1) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

async function moveItem(item, target) {
  const qty = Number(item.system?.quantity ?? 1);
  const existing = STACKABLE.includes(item.type)
    ? target.items.find((i) => i.type === item.type && i.name === item.name && !i.system?.container)
    : null;
  if (existing) {
    await existing.update({ "system.quantity": Number(existing.system?.quantity ?? 1) + qty });
  } else {
    const data = item.toObject();
    delete data._id;
    if (data.system?.container) data.system.container = null;
    if (data.system && "equipped" in data.system) data.system.equipped = false;
    await target.createEmbeddedDocuments("Item", [data]);
  }
  await item.delete();
  return `${qty > 1 ? `${qty}× ` : ""}${item.name}`;
}

async function checkTake(tileUuid, targetUuid, userId) {
  const { tileDoc, source } = await getLootable(tileUuid);
  if (!tileDoc || !source) return { error: "Not found." };
  if (doorState(tileDoc) !== 1) return { error: `The ${info(tileDoc).name} is closed.` };
  const target = targetUuid ? await fromUuid(targetUuid) : null;
  if (!canUseActor(userId, target)) return { error: "You need to control a character you own." };
  return { tileDoc, source, target };
}

async function afterTake(c, taken) {
  if (taken.length) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: c.target }),
      content: `<p>${esc(c.target.name)} takes ${taken.map(esc).join(", ")} from the ${esc(info(c.tileDoc).name)}.</p>`,
    });
  }
  const empty = !lootableItems(c.source).length && !CURRENCIES.some((k) => Number(c.source.system?.currency?.[k] ?? 0) > 0);
  if (empty && info(c.tileDoc).removeWhenEmpty) {
    await c.tileDoc.delete(); // deleteTile hook closes the windows
    return;
  }
  socket.executeForEveryone("refresh", c.source.uuid);
}

function currencyText(cur) {
  return CURRENCIES.filter((k) => cur[k] > 0).map((k) => `${cur[k]} ${k}`).join(", ");
}

async function takeCurrencyInternal(source, target) {
  const cur = source.system?.currency;
  if (!cur || !target.system?.currency) return null;
  const moved = {};
  const targetUpdate = {};
  const sourceUpdate = {};
  for (const k of CURRENCIES) {
    const v = Number(cur[k] ?? 0);
    if (v <= 0) continue;
    moved[k] = v;
    targetUpdate[`system.currency.${k}`] = Number(target.system.currency[k] ?? 0) + v;
    sourceUpdate[`system.currency.${k}`] = 0;
  }
  if (!Object.keys(moved).length) return null;
  await target.update(targetUpdate);
  await source.update(sourceUpdate);
  return currencyText(moved);
}

async function gmTakeItem({ tileUuid, itemId, targetUuid, userId }) {
  const c = await checkTake(tileUuid, targetUuid, userId);
  if (c.error) return { ok: false, reason: c.error };
  const item = c.source.items.get(itemId);
  if (!item) return { ok: false, reason: "Someone already took that." };
  await afterTake(c, [await moveItem(item, c.target)]);
  return { ok: true };
}

async function gmTakeCurrency({ tileUuid, targetUuid, userId }) {
  const c = await checkTake(tileUuid, targetUuid, userId);
  if (c.error) return { ok: false, reason: c.error };
  const text = await takeCurrencyInternal(c.source, c.target);
  await afterTake(c, text ? [text] : []);
  return { ok: true };
}

async function gmTakeAll({ tileUuid, targetUuid, userId }) {
  const c = await checkTake(tileUuid, targetUuid, userId);
  if (c.error) return { ok: false, reason: c.error };
  const taken = [];
  const money = await takeCurrencyInternal(c.source, c.target);
  if (money) taken.push(money);
  for (const item of lootableItems(c.source)) {
    if (c.source.items.get(item.id)) taken.push(await moveItem(item, c.target));
  }
  await afterTake(c, taken);
  return { ok: true };
}

/* -------------------------------------------- */
/*  Loot window                                 */
/* -------------------------------------------- */

const windows = new Map(); // tileUuid -> app

function refreshWindows(actorUuid) {
  for (const app of windows.values()) {
    if (app.actorUuid === actorUuid && app.rendered) app.render();
  }
}

function openLootWindow(tileDoc) {
  let app = windows.get(tileDoc.uuid);
  if (!app) {
    app = new LootApp(tileDoc);
    windows.set(tileDoc.uuid, app);
  }
  app.render({ force: true });
  return app;
}

const { ApplicationV2 } = foundry.applications.api;

class LootApp extends ApplicationV2 {
  constructor(tileDoc, options = {}) {
    super({ ...options, id: `${ID}-${tileDoc.id}` });
    this.tileDoc = tileDoc;
    this.actorUuid = tileDoc.getFlag(ID, "actorUuid");
  }

  static DEFAULT_OPTIONS = {
    classes: [ID],
    tag: "div",
    window: { title: "Loot", icon: "fa-solid fa-sack", resizable: false },
    position: { width: 340, height: "auto" },
    actions: {
      take: LootApp.#onTake,
      takeCurrency: LootApp.#onTakeCurrency,
      takeAll: LootApp.#onTakeAll,
      state: LootApp.#onState,
      sheet: LootApp.#onSheet,
      configure: LootApp.#onConfigure,
    },
  };

  get title() {
    return info(this.tileDoc).name;
  }

  async _prepareContext() {
    this.actorUuid = this.tileDoc.getFlag(ID, "actorUuid");
    const args = { tileUuid: this.tileDoc.uuid };
    const data = game.user.isGM ? await gmGetContents(args) : await socket.executeAsGM("getContents", args);
    return { data, isGM: game.user.isGM, looter: looterActor() };
  }

  async _renderHTML({ data, isGM, looter }) {
    if (!data) return `<p class="lt-empty">Loot data not found.</p>`;
    const open = data.state === 1;
    const canTake = open && !!looter;
    const rows = data.items
      .map(
        (i) => `<li class="lt-item">
          <img src="${esc(i.img)}" alt="">
          <span class="lt-name">${esc(i.name)}</span>
          ${i.qty > 1 ? `<span class="lt-qty">×${i.qty}</span>` : ""}
          <button type="button" data-action="take" data-item-id="${i.id}" ${canTake ? "" : "disabled"}>Take</button>
        </li>`,
      )
      .join("");
    const money = data.currency.length
      ? `<div class="lt-currency"><i class="fa-solid fa-coins"></i>
           <span>${data.currency.map((c) => `${c.value} ${c.key}`).join(", ")}</span>
           <button type="button" data-action="takeCurrency" ${canTake ? "" : "disabled"}>Take</button></div>`
      : "";
    const empty = !data.items.length && !data.currency.length;
    const status = data.state === 2 ? `Locked${isGM && data.keyName ? ` (key: ${esc(data.keyName)})` : ""}` : open ? "Open" : "Closed";
    const body =
      open || isGM
        ? empty
          ? `<p class="lt-empty">Nothing left to take.</p>`
          : `${money}<ul class="lt-list">${rows}</ul>`
        : `<p class="lt-empty">It's shut.</p>`;
    // Lid button only for things with a lid; players can close, only the GM can open from here.
    const lidBtn = !data.hasLid
      ? ""
      : open
        ? `<button type="button" data-action="state" data-state="0"><i class="fa-solid fa-box"></i> Close</button>`
        : isGM
          ? `<button type="button" data-action="state" data-state="1"><i class="fa-solid fa-box-open"></i> Open</button>`
          : "";
    const gmBtns = isGM
      ? `<div class="lt-gm">
           <button type="button" data-action="state" data-state="${data.state === 2 ? 0 : 2}"><i class="fa-solid fa-${data.state === 2 ? "unlock" : "lock"}"></i> ${data.state === 2 ? "Unlock" : "Lock"}</button>
           ${!data.hasLid && open ? `<button type="button" data-action="state" data-state="0"><i class="fa-solid fa-rotate-left"></i> Reset</button>` : ""}
           <button type="button" data-action="sheet"><i class="fa-solid fa-boxes-stacked"></i> Contents</button>
           <button type="button" data-action="configure"><i class="fa-solid fa-gear"></i></button>
         </div>`
      : "";
    return `<section class="lt-body">
      <div class="lt-status">${status}${looter ? ` · looting as <strong>${esc(looter.name)}</strong>` : ""}${isGM ? `<br>Contents actor: <strong>${esc(data.actorName)}</strong>${data.removeWhenEmpty ? " · removed when empty" : ""}` : ""}</div>
      ${body}
      <div class="lt-footer">
        <button type="button" data-action="takeAll" ${canTake && !empty ? "" : "disabled"}><i class="fa-solid fa-hand-holding"></i> Take all</button>
        ${lidBtn}
      </div>
      ${gmBtns}
    </section>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  _onClose(options) {
    windows.delete(this.tileDoc.uuid);
    super._onClose?.(options);
  }

  async #call(name, extra = {}) {
    const looter = looterActor();
    const args = { tileUuid: this.tileDoc.uuid, targetUuid: looter?.uuid ?? null, userId: game.user.id, ...extra };
    const res = await socket.executeAsGM(name, args);
    if (res && res.ok === false) ui.notifications.warn(res.reason);
    if (this.rendered && this.tileDoc.parent?.tiles.has(this.tileDoc.id)) this.render();
  }

  static async #onTake(event, target) {
    await this.#call("takeItem", { itemId: target.dataset.itemId });
  }
  static async #onTakeCurrency() {
    await this.#call("takeCurrency");
  }
  static async #onTakeAll() {
    await this.#call("takeAll");
  }
  static async #onState(event, target) {
    const state = Number(target.dataset.state);
    await socket.executeAsGM("setState", { tileUuid: this.tileDoc.uuid, state, userId: game.user.id });
    if (state === 0 && !game.user.isGM) return this.close();
    this.render();
  }
  static async #onSheet() {
    (await fromUuid(this.actorUuid))?.sheet.render(true);
  }
  static async #onConfigure() {
    await configureLootable(this.tileDoc);
    this.render();
  }
}

/* -------------------------------------------- */
/*  GM setup                                    */
/* -------------------------------------------- */

function modelHasAnimation(tileDoc) {
  const t3 = game.Levels3DPreview?.tiles?.[tileDoc.id];
  return (t3?._animationModelReference?.object?.animations?.length ?? 0) > 0;
}

async function configureLootable(tileDoc) {
  if (!game.user.isGM) return ui.notifications.warn("Only the GM can set up loot.");
  tileDoc = tileDoc?.document ?? tileDoc ?? canvas.tiles.controlled[0]?.document;
  if (!tileDoc) return ui.notifications.warn("Select a tile on the Tiles layer first.");
  const f = tileDoc.flags[ID] ?? {};
  const isNew = !f.actorUuid;
  const hasLid = f.hasLid ?? modelHasAnimation(tileDoc);
  const actorOptions = game.actors
    .filter((a) => a.type !== "character")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((a) => `<option value="${a.uuid}" ${a.uuid === f.actorUuid ? "selected" : ""}>${esc(a.name)}</option>`)
    .join("");
  const presetOptions = Object.entries(PRESETS)
    .map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`)
    .join("");
  const content = `
    <div class="form-group"><label>Name</label><input type="text" name="name" value="${esc(f.name ?? "")}" placeholder="e.g. Treasure Chest, Pile of Bones"></div>
    <div class="form-group"><label>Model</label><select name="preset">${presetOptions}</select></div>
    <div class="form-group"><label>Contents actor</label><select name="actorUuid">
      <option value="" ${f.actorUuid ? "" : "selected"}>(create a new one)</option>${actorOptions}</select></div>
    <div class="form-group"><label>Has an opening animation (lid)</label><input type="checkbox" name="hasLid" ${hasLid ? "checked" : ""}></div>
    <div class="form-group"><label>Remove tile when emptied</label><input type="checkbox" name="removeWhenEmpty" ${f.removeWhenEmpty ? "checked" : ""}></div>
    <div class="form-group"><label>Key item name</label><input type="text" name="keyName" value="${esc(f.keyName ?? "")}" placeholder="blank = no key"></div>
    <div class="form-group"><label>Locked</label><input type="checkbox" name="locked" ${doorState(tileDoc) === 2 ? "checked" : ""}></div>
    <div class="form-group"><label>Key is used up</label><input type="checkbox" name="consumeKey" ${f.consumeKey ? "checked" : ""}></div>
    <p class="hint">Only the items and currency on the contents actor can be looted.</p>`;
  const data = await foundry.applications.api.DialogV2.prompt({
    window: { title: "Configure Lootable" },
    content,
    ok: { label: "Save", callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
    rejectClose: false,
  });
  if (!data) return;

  const preset = PRESETS[data.preset] ?? PRESETS.keep;
  const name = (data.name || preset.name || "Container").trim();
  const lid = preset.model ? !!preset.lid : !!data.hasLid;

  let actor = data.actorUuid ? await fromUuid(data.actorUuid) : null;
  if (!actor) {
    let folder = game.folders.find((x) => x.type === "Actor" && x.name === "Loot");
    folder ??= await Folder.create({ name: "Loot", type: "Actor" });
    actor = await Actor.create({
      name: `Loot: ${name}`,
      type: "npc",
      img: "icons/containers/bags/sack-simple-leather-brown.webp",
      folder: folder.id,
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
      flags: { [ID]: { isLootable: true } },
    });
  } else if (!actor.getFlag(ID, "isLootable")) {
    await actor.setFlag(ID, "isLootable", true);
  }

  const current = doorState(tileDoc);
  const l3d = {
    doorType: 1, // the whole tile acts as a door: gives us lock state, hover highlight and lid animation
    doorStyle: 5, // linked to animation, reversed on close (no-op for models without an animation)
    animationOnce: true,
    enableAnim: true,
    animIndex: 0,
    sight: false, // never blocks vision; also avoids a 3D Canvas sight-worker crash
    doorSound: preset.sound ?? tileDoc.getFlag(L3D, "doorSound") ?? (lid ? "woodCreaky" : ""),
    doorState: data.locked ? 2 : current === 2 ? 0 : isNew ? 0 : current,
  };
  if (preset.model) l3d.model3d = preset.model;
  await tileDoc.update({
    flags: {
      [L3D]: l3d,
      [ID]: {
        actorUuid: actor.uuid,
        name,
        hasLid: lid,
        removeWhenEmpty: !!data.removeWhenEmpty,
        keyName: (data.keyName ?? "").trim(),
        consumeKey: !!data.consumeKey,
      },
    },
  });
  ui.notifications.info(`${name} is lootable. Contents come from "${actor.name}".`);
  return actor;
}
