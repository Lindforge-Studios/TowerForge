import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function commandFailure(command, result) {
  const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
  return new Error(`${command} validation failed${detail ? `: ${detail}` : "."}`);
}

export function verifyMacosBundle({
  appPath,
  dmgPath,
  exists = fs.existsSync,
  run = (command, args) => spawnSync(command, args, { encoding: "utf8" })
}) {
  if (!appPath || !exists(appPath)) throw new Error(`macOS app bundle does not exist: ${appPath || "<missing>"}`);
  if (!dmgPath || !exists(dmgPath)) throw new Error(`macOS DMG does not exist: ${dmgPath || "<missing>"}`);

  const signature = run("codesign", ["--verify", "--deep", "--strict", "--verbose=4", appPath]);
  if (signature.error) throw signature.error;
  if (signature.status !== 0) throw commandFailure("codesign", signature);

  const diskImage = run("hdiutil", ["verify", dmgPath]);
  if (diskImage.error) throw diskImage.error;
  if (diskImage.status !== 0) throw commandFailure("hdiutil", diskImage);

  return { appPath, dmgPath };
}

function findExactlyOne(directory, predicate, label) {
  const matches = fs.readdirSync(directory, { withFileTypes: true })
    .filter(predicate)
    .map((entry) => path.join(directory, entry.name));
  if (matches.length !== 1) throw new Error(`Expected exactly one ${label} in ${directory}, found ${matches.length}.`);
  return matches[0];
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`Invalid argument near ${key || "<end>"}.`);
    values[key.slice(2)] = value;
  }
  return values;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    if (process.platform !== "darwin") throw new Error("macOS bundle verification must run on macOS.");
    const args = parseArgs(process.argv.slice(2));
    const bundleRoot = path.resolve(args["bundle-root"] || "src-tauri/target/release/bundle");
    const appPath = path.resolve(args.app || findExactlyOne(path.join(bundleRoot, "macos"), (entry) => entry.isDirectory() && entry.name.endsWith(".app"), "app bundle"));
    const dmgPath = path.resolve(args.dmg || findExactlyOne(path.join(bundleRoot, "dmg"), (entry) => entry.isFile() && entry.name.endsWith(".dmg"), "DMG"));
    const result = verifyMacosBundle({ appPath, dmgPath });
    process.stdout.write(`Verified macOS app signature and DMG: ${JSON.stringify(result)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
