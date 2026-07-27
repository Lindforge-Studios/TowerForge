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

function verifyBundledNode(appPath, run) {
  const nodePath = path.join(appPath, "Contents", "MacOS", "node");
  const result = run(nodePath, ["-e", "process.stdout.write('towerforge-node-ready')"]);
  if (result.error) throw result.error;
  if (result.status !== 0 || result.stdout !== "towerforge-node-ready") {
    throw commandFailure("Bundled Node sidecar", result);
  }
}

function verifyAppArchitecture(appPath, expectedArchitecture, run) {
  const executable = path.join(appPath, "Contents", "MacOS", "towerforge_desktop");
  const result = run("lipo", ["-archs", executable]);
  if (result.error) throw result.error;
  if (result.status !== 0) throw commandFailure("macOS architecture", result);
  const architectures = String(result.stdout || "").trim().split(/\s+/).filter(Boolean);
  if (!architectures.includes(expectedArchitecture)) {
    throw new Error(`macOS app architecture mismatch: expected ${expectedArchitecture}, got ${architectures.join(", ") || "<none>"}.`);
  }
}

function detachDiskImage(mountDirectory, run) {
  const attempts = [
    ["detach", mountDirectory],
    ["detach", mountDirectory],
    ["detach", "-force", mountDirectory]
  ];
  let result;
  for (const args of attempts) {
    result = run("hdiutil", args);
    if (!result.error && result.status === 0) return result;
  }
  if (result?.error) throw result.error;
  throw commandFailure("hdiutil detach", result || {});
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
  run = (command, args) => spawnSync(command, args, { encoding: "utf8" }),
  expectedArchitecture = "arm64"
}) {
  if (!dmgPath || !exists(dmgPath)) throw new Error(`macOS DMG does not exist: ${dmgPath || "<missing>"}`);

  const diskImage = run("hdiutil", ["verify", dmgPath]);
  if (diskImage.error) throw diskImage.error;
  if (diskImage.status !== 0) throw commandFailure("hdiutil", diskImage);

  if (appPath && exists(appPath)) {
    const signature = run("codesign", ["--verify", "--deep", "--strict", "--verbose=4", appPath]);
    if (signature.error) throw signature.error;
    if (signature.status !== 0) throw commandFailure("codesign", signature);
    verifyAppArchitecture(appPath, expectedArchitecture, run);
    verifyBundledNode(appPath, run);
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
    verifyAppArchitecture(resolvedAppPath, expectedArchitecture, run);
    verifyBundledNode(resolvedAppPath, run);
  } catch (error) {
    failure = error;
  }

  if (mounted) {
    try {
      detachDiskImage(mountDirectory, run);
    } catch (error) {
      if (!failure) failure = error;
    }
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
