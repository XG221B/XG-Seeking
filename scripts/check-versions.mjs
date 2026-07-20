#!/usr/bin/env node
// Check that package.json, src-tauri/Cargo.toml, and src-tauri/tauri.conf.json have the same version.
// Optionally pass an expected tag (e.g. "v0.3.0") to verify release builds.
// Usage: node scripts/check-versions.mjs [expected-tag]

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const expectedTag = process.argv[2] || null;

async function main() {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const pkgVersion = pkg.version;

  const cargoToml = await readFile(join(root, "src-tauri", "Cargo.toml"), "utf8");
  const cargoMatch = cargoToml.match(/^version\s*=\s*"([^"]+)"/m);
  if (!cargoMatch) {
    console.error("FAIL: Could not find version in src-tauri/Cargo.toml");
    process.exit(1);
  }
  const cargoVersion = cargoMatch[1];

  const tauriConf = JSON.parse(await readFile(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
  const tauriVersion = tauriConf.version;

  const versions = [
    { file: "package.json", version: pkgVersion },
    { file: "src-tauri/Cargo.toml", version: cargoVersion },
    { file: "src-tauri/tauri.conf.json", version: tauriVersion },
  ];

  const first = versions[0].version;
  let ok = true;
  for (const v of versions) {
    if (v.version !== first) {
      console.error(`FAIL: Version mismatch: ${v.file} has "${v.version}", expected "${first}"`);
      ok = false;
    }
  }

  if (!ok) {
    console.error("");
    console.error("All three version sources must agree:");
    for (const v of versions) console.error(`  ${v.file}: ${v.version}`);
    process.exit(1);
  }

  console.log(`OK: All versions consistent at ${first}`);
  for (const v of versions) console.log(`  ${v.file}: ${v.version}`);

  if (expectedTag) {
    const expected = `v${first}`;
    if (expectedTag !== expected) {
      console.error(`FAIL: Expected tag "${expectedTag}" does not match shared version "${first}" (expected "${expected}")`);
      process.exit(1);
    }
    console.log(`OK: Tag "${expectedTag}" matches version ${first}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
