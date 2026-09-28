/**
 * Build the JMI 3D Toolkit release.
 *
 *   node tools/build.mjs [--version 1.2.3] [--repo owner/name] [--install <FoundryDataDir>]
 *
 * 1. Copies module/ to dist/jmi-3d-toolkit/
 * 2. Compiles packs-src/<pack>/*.json into LevelDB compendium packs (dist/jmi-3d-toolkit/packs/<pack>)
 * 3. Writes module.json with version, manifest and download URLs (+ README/LICENSE)
 * 4. Zips it to dist/module.zip (module.json at the zip root) and copies dist/module.json
 * 5. --install: also copies the built module into <FoundryDataDir>/modules/jmi-3d-toolkit (for local testing)
 */
import { compilePack } from "@foundryvtt/foundryvtt-cli";
import AdmZip from "adm-zip";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};

const manifest = JSON.parse(fs.readFileSync(path.join(root, "module", "module.json"), "utf8"));
const version = String(arg("version", process.env.VERSION ?? manifest.version)).replace(/^v/, "");
const repo = arg("repo", process.env.GITHUB_REPOSITORY ?? "JustMoreInnovation/foundry-vtt-modules");
const dist = path.join(root, "dist");
const out = path.join(dist, manifest.id);

fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(root, "module"), out, { recursive: true });
for (const f of ["README.md", "LICENSE"]) fs.copyFileSync(path.join(root, f), path.join(out, f));

// Compendium packs
const srcPacks = path.join(root, "packs-src");
for (const pack of manifest.packs ?? []) {
  const src = path.join(srcPacks, pack.name);
  if (!fs.existsSync(src)) throw new Error(`Missing pack source: packs-src/${pack.name}`);
  await compilePack(src, path.join(out, pack.path), { log: false, recursive: true });
  console.log(`packed ${pack.name}`);
}

// Manifest
manifest.version = version;
manifest.manifest = `https://github.com/${repo}/releases/latest/download/module.json`;
manifest.download = `https://github.com/${repo}/releases/download/v${version}/module.zip`;
const json = JSON.stringify(manifest, null, 2) + "\n";
fs.writeFileSync(path.join(out, "module.json"), json);
fs.writeFileSync(path.join(dist, "module.json"), json);

// Zip (module.json at the root of the archive)
const zip = new AdmZip();
zip.addLocalFolder(out);
zip.writeZip(path.join(dist, "module.zip"));
console.log(`built ${manifest.id} v${version} -> dist/module.zip (${(fs.statSync(path.join(dist, "module.zip")).size / 1024).toFixed(0)} KB)`);

// Optional local install
const install = arg("install", process.env.FOUNDRY_DATA);
if (args.includes("--install")) {
  if (!install) throw new Error("--install needs a Foundry Data folder (or set FOUNDRY_DATA)");
  const target = path.join(install, "modules", manifest.id);
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(out, target, { recursive: true });
  console.log(`installed to ${target}`);
}
