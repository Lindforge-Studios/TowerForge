import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const tempProjects = [];
const PROFILE_BEGIN = "// TOWERFORGE_PROFILE_RUNTIME_BEGIN";
const PROFILE_END = "// TOWERFORGE_PROFILE_RUNTIME_END";
const ENGINE_PROFILE_IMPORTS = [
  "createEmptyPlayerProfile",
  "getPlayerProfileLaunchOptions",
  "isPlayerMissionUnlocked",
  "parsePlayerProfileJson",
  "purchasePlayerMetaUpgrade",
  "recordPlayerMissionClear",
  "selectPlayerDifficulty",
  "serializePlayerProfile"
];
const LEGACY_PROFILE_TOKENS = [
  "PROGRESS_VERSION",
  "function emptyProgress",
  "function loadProgress",
  "function saveProgress",
  "function normalizeMetaBag",
  "function normalizeUpgradeLevels",
  "function addMetaResources",
  "unlockReqs",
  "rewardMissionClear",
  "newlyUnlockedBy"
];

afterEach(() => {
  for (const projectDir of tempProjects.splice(0)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

function namedImports(source, specifier) {
  const names = new Set();
  for (const match of source.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*["']([^"']+)["'];?/g)) {
    if (match[2] !== specifier) continue;
    for (const entry of match[1].split(",")) {
      const imported = entry.trim().split(/\s+as\s+/)[0];
      if (imported) names.add(imported);
    }
  }
  return names;
}

function count(source, token) {
  return source.split(token).length - 1;
}

function profileFragment(source) {
  if (count(source, PROFILE_BEGIN) !== 1 || count(source, PROFILE_END) !== 1) return undefined;
  const start = source.indexOf(PROFILE_BEGIN);
  const end = source.indexOf(PROFILE_END, start);
  if (end < start) return undefined;
  return source.slice(start, end + PROFILE_END.length);
}

function directProfileMutations(source) {
  const field = "(?:clearedMissionIds|starsByMission|metaResources|upgradeLevels|selectedDifficultyId)";
  const assignment = new RegExp(`progress\\.${field}(?:\\s*\\[[^\\]]+\\]|\\.[A-Za-z_$][\\w$]*)*\\s*(?:=|\\+=|-=|\\+\\+|--)`, "g");
  const push = new RegExp(`progress\\.${field}\\s*\\.push\\s*\\(`, "g");
  return [...source.matchAll(assignment), ...source.matchAll(push)].map((match) => match[0]);
}

function addOutputViolations(violations, result, renderer, sourceRuntime) {
  const label = renderer;
  const outputRuntimeDir = path.join(result.outDir, "player-runtime");
  for (const fileName of ["index.mjs", "player-profile-store.mjs"]) {
    const outputPath = path.join(outputRuntimeDir, fileName);
    const sourcePath = path.join(sourceRuntime, fileName);
    if (!fs.existsSync(outputPath)) {
      violations.push(`${label}: missing player-runtime/${fileName}`);
    } else if (!fs.readFileSync(outputPath).equals(fs.readFileSync(sourcePath))) {
      violations.push(`${label}: player-runtime/${fileName} differs from source bytes`);
    }
  }
  if (fs.existsSync(path.join(outputRuntimeDir, "player-profile-store.test.mjs"))) {
    violations.push(`${label}: shipped player-runtime/player-profile-store.test.mjs`);
  }

  const player = fs.readFileSync(path.join(result.outDir, "player.mjs"), "utf8");
  const runtimeImports = namedImports(player, "./player-runtime/index.mjs");
  for (const name of ["createPlayerProfileStore", "derivePlayerProfileStorageKey"]) {
    if (!runtimeImports.has(name)) violations.push(`${label}: missing runtime import ${name}`);
  }
  const engineImports = namedImports(player, "./engine/index.js");
  for (const name of ENGINE_PROFILE_IMPORTS) {
    if (!engineImports.has(name)) violations.push(`${label}: missing engine profile import ${name}`);
  }

  if (count(player, PROFILE_BEGIN) !== 1) violations.push(`${label}: expected one profile BEGIN marker`);
  if (count(player, PROFILE_END) !== 1) violations.push(`${label}: expected one profile END marker`);
  for (const token of LEGACY_PROFILE_TOKENS) {
    if (player.includes(token)) violations.push(`${label}: legacy token remains: ${token}`);
  }
  const mutations = directProfileMutations(player);
  if (mutations.length > 0) violations.push(`${label}: direct profile mutation remains: ${mutations.join(" | ")}`);
  if (player.includes("metaUpgradeLevels: progress.upgradeLevels")) {
    violations.push(`${label}: launch options bypass getPlayerProfileLaunchOptions`);
  }

  const serviceWorker = fs.readFileSync(path.join(result.outDir, "offline-sw.js"), "utf8");
  for (const asset of ["./player-runtime/index.mjs", "./player-runtime/player-profile-store.mjs"]) {
    if (!serviceWorker.includes(JSON.stringify(asset))) violations.push(`${label}: offline precache missing ${asset}`);
  }

  const singleFile = fs.readFileSync(path.join(result.outDir, "index.single.html"), "utf8");
  if (/["']\.\/player-runtime(?:\/|["'])/.test(singleFile)) {
    violations.push(`${label}: single-file contains unresolved ./player-runtime specifier`);
  }
  if (singleFile.includes("@towerforge/player-runtime")) {
    violations.push(`${label}: single-file contains unresolved @towerforge/player-runtime specifier`);
  }

  return profileFragment(player);
}

describe("generated player profile runtime integration", () => {
  it("emits one shared immutable profile integration for Canvas, Phaser, offline and plugin runtimes", () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-profile-runtime-"));
    tempProjects.push(projectDir);
    fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });

    const targetsPath = path.join(projectDir, "build-targets.json");
    const targets = JSON.parse(fs.readFileSync(targetsPath, "utf8"));
    for (const renderer of ["canvas", "phaser"]) {
      const id = `profile-${renderer}`;
      targets.targets[id] = {
        ...targets.targets["web-pwa"],
        id,
        renderer,
        webDir: `dist-${id}`
      };
    }
    fs.writeFileSync(targetsPath, `${JSON.stringify(targets, null, 2)}\n`, "utf8");

    const results = {};
    for (const renderer of ["canvas", "phaser"]) {
      const id = `profile-${renderer}`;
      const output = execFileSync(process.execPath, [
        path.join(repoRoot, "packages", "cli", "build.mjs"),
        "--project", projectDir,
        "--target", id,
        "--single-file",
        "--json"
      ], {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
      });
      results[renderer] = JSON.parse(output);
      expect(results[renderer]).toMatchObject({ ok: true, targetId: id });
    }

    const violations = [];
    const sourceRuntime = path.join(repoRoot, "packages", "player-runtime", "src");
    const fragments = ["canvas", "phaser"].map((renderer) =>
      addOutputViolations(violations, results[renderer], renderer, sourceRuntime)
    );
    if (fragments.some((fragment) => fragment === undefined)) {
      violations.push("canvas/phaser: profile fragments unavailable for byte comparison");
    } else if (fragments[0] !== fragments[1]) {
      violations.push("canvas/phaser: marker-delimited profile fragments differ");
    }

    const pluginBuild = fs.readFileSync(path.join(repoRoot, "scripts", "build-codex-plugin.mjs"), "utf8");
    if (!pluginBuild.includes('copy(path.join(root, "packages", "player-runtime"), path.join(runtime, "packages", "player-runtime"))')) {
      violations.push("plugin: build script does not mirror packages/player-runtime");
    }
    const desktopPrepare = fs.readFileSync(
      path.join(repoRoot, "packages", "desktop", "scripts", "prepare-runtime.mjs"),
      "utf8"
    );
    if (!desktopPrepare.includes('copyDir(path.join(repoRoot, "packages", "player-runtime"), path.join(runtimeRoot, "packages", "player-runtime"), runtimeFilter)')) {
      violations.push("desktop: prepare-runtime does not bundle packages/player-runtime");
    }
    for (const fileName of ["index.mjs", "player-profile-store.mjs"]) {
      const pluginPath = path.join(repoRoot, "plugins", "towerforge", "runtime", "packages", "player-runtime", "src", fileName);
      const sourcePath = path.join(sourceRuntime, fileName);
      if (!fs.existsSync(pluginPath)) {
        violations.push(`plugin: missing runtime packages/player-runtime/src/${fileName}`);
      } else if (!fs.readFileSync(pluginPath).equals(fs.readFileSync(sourcePath))) {
        violations.push(`plugin: player-runtime/src/${fileName} differs from source bytes`);
      }
    }
    if (fs.existsSync(path.join(
      repoRoot,
      "plugins",
      "towerforge",
      "runtime",
      "packages",
      "player-runtime",
      "src",
      "player-profile-store.test.mjs"
    ))) {
      violations.push("plugin: shipped packages/player-runtime/src/player-profile-store.test.mjs");
    }

    expect(violations).toEqual([]);
  }, 60_000);
});
