/**
 * JMI 3D Toolkit — entry point.
 * Features: lootables (loot.js), scenario checkpoints (checkpoints.js), key-locked model doors (door-keys.js).
 */
import { ID, LEGACY_MODULES, state } from "./constants.js";
import * as loot from "./loot.js";
import * as checkpoints from "./checkpoints.js";
import * as doorKeys from "./door-keys.js";
import { migrate } from "./migrate.js";

Hooks.once("socketlib.ready", () => {
  loot.registerSocket(socketlib.registerModule(ID));
});

Hooks.once("init", () => {
  game.modules.get(ID).api = {
    loot: loot.api,
    checkpoints: checkpoints.api,
    migrate,
    // shortcuts
    configure: loot.api.configure,
    saveCheckpoint: checkpoints.api.save,
    loadCheckpoint: checkpoints.api.load,
  };
  loot.init();
  doorKeys.init();
});

Hooks.once("ready", async () => {
  const active = LEGACY_MODULES.filter((id) => game.modules.get(id)?.active).map((id) => game.modules.get(id).title);
  if (active.length) {
    ui.notifications.error(`JMI 3D Toolkit replaces ${active.join(", ")}. Disable ${active.length > 1 ? "them" : "it"} in Manage Modules, then reload.`, {
      permanent: true,
    });
    return;
  }
  state.enabled = true;
  await migrate();
  await loot.ready();
  console.log(`${ID} | ready`);
});
