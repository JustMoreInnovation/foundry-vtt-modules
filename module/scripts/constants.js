export const ID = "jmi-3d-toolkit";
export const L3D = "levels-3d-preview";
export const MODULE_PATH = `modules/${ID}`;

/** Standalone modules this toolkit replaces. They must be disabled; their data is migrated. */
export const LEGACY_MODULES = ["loot-3d", "chest-loot-3d", "scenario-checkpoints", "door-keys-3d"];

/** Set true once main.js has confirmed no legacy module is active. Features stay inert until then. */
export const state = { enabled: false };

export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
