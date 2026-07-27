import fs from "node:fs";
import os from "node:os";
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
  createMountDirectory = () => fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-dmg-")),
  listApps = (directory) => fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
    .map((entry) => entry.name),
  cleanupDirectory = (directory) => fs.rmSync(directory, { recursive: true, force: true }),
  run = (command, args) => spawnSync(command, args, { encoding: "utf8" })
}) {
  if (!dmgPath || !exists(dmgPath)) throw new Error(`macOS DMG does not exist: ${dmgPath || "<missing>"}`);

  const diskImage = run("hdiutil", ["verify", dmgPath]);
  if (diskImage.error) throw diskImage.error;
  if (diskImage.status !== 0) throw commandFailure("hdiutil", diskImage);

  if (appPath && exists(appPath)) {
    const signature = run("codesign", ["--verify", "--deep", "--strict", "--verbose=4", appPath]);
    if (signature.error) throw signature.error;
    if (signature.status !== 0) throw commandFailure("codesign", signature);
    return { appPath, dmgPath };
  }

  const mountDirectory = createMountDirectory();
  let mounted = false;
  let resolvedAppPath;
  let failure;
  try {
    const attach = run("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mountDirectory, dmgPath]);
    if (attach.error) throw attach.error;
    if (attach.status !== 0) throw commandFailure("hdiutil attach", attach);
    mounted = true;
    const apps = listApps(mountDirectory);
    if (apps.length !== 1) throw new Error(`Expected exactly one app bundle in mounted DMG, found ${apps.length}.`);
    resolvedAppPath = path.join(mountDirectory, apps[0]);
    const signature = run("codesign", ["--verify", "--deep", "--strict", "--verbose=4", resolvedAppPath]);
    if (signature.error) throw signature.error;
    if (signature.status !== 0) throw commandFailure("codesign", signature);
  } catch (error) {
    failure = error;
  }

  if (mounted) {
    const detach = run("hdiutil", ["detach", mountDirectory]);
    if (!failure && detach.error) failure = detach.error;
    if (!failure && detach.status !== 0) failure = commandFailure("hdiutil detach", detach);
  }
  try {
    cleanupDirectory(mountDirectory);
  } catch (error) {
    if (!failure) failure = error;
  }
  if (failure) throw failure;
  return { appPath: resolvedAppPath, dmgPath };
}

function findExactlyOne(directory, predicate, label) {
  const matches = fs.readdirSync(directory, { withFileTypes: true })
    .filter(predicate)
    .map((entry) => path.join(directory, entry.name));
  if (matches.length !== 1) throw new Error(`Expected exactly one ${label} in ${directory}, found ${matches.length}.`);
  return matches[0];
}

function findOptionalOne(directory, predicate, label) {
  if (!fs.existsSync(directory)) return undefined;
  const matches = fs.readdirSync(directory, { withFileTypes: true })
    .filter(predicate)
    .map((entry) => path.join(directory, entry.name));
  if (matches.length > 1) throw new Error(`Expected at most one ${label} in ${directory}, found ${matches.length}.`);
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
    const discoveredApp = args.app || findOptionalOne(path.join(bundleRoot, "macos"), (entry) => entry.isDirectory() && entry.name.endsWith(".app"), "app bundle");
    const appPath = discoveredApp ? path.resolve(discoveredApp) : undefined;
    const dmgPath = path.resolve(args.dmg || findExactlyOne(path.join(bundleRoot, "dmg"), (entry) => entry.isFile() && entry.name.endsWith(".dmg"), "DMG"));
    const result = verifyMacosBundle({ appPath, dmgPath });
    process.stdout.write(`Verified macOS app signature and DMG: ${JSON.stringify(result)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
