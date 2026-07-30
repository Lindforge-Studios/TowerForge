import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createProject } from "./lib/create-project.mjs";
import { packageWeb } from "./lib/packaging.mjs";
import { exportProjectPack, inspectProjectPack } from "./lib/project-pack.mjs";

const repoRoot = path.resolve(".");
const tempRoots = [];
const combinations = ["hex", "square"].flatMap((grid) => (
  ["canvas", "phaser"].map((renderer) => ({ grid, renderer }))
));

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("R10 procedural quests constructor integration", () => {
  it("preserves active quests through both renderers/grids, PWA, single-file, web package, and tdpack", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r10-package-"));
    tempRoots.push(root);
    const projects = [];

    for (const { grid, renderer } of combinations) {
      const { projectDir } = createProject({
        name: `quests_${grid}_${renderer}`,
        parentDir: root,
        templateName: "classic",
        gridKind: grid
      });
      const { mechanics, missionId } = enableQuests(projectDir);
      const targetId = `quests-${renderer}`;
      addBuildTarget(projectDir, targetId, renderer);
      const built = build(projectDir, targetId);
      projects.push({ projectDir, grid, renderer, targetId });

      expect(built).toMatchObject({ ok: true });
      for (const relative of [
        "project-data.js",
        "renderer/quest-presentation.mjs",
        "offline-sw.js",
        "index.single.html"
      ]) expect(fs.existsSync(path.join(built.outDir, relative)), `${grid}/${renderer}: ${relative}`).toBe(true);

      const projectModule = await import(
        `${pathToFileURL(path.join(built.outDir, "project-data.js")).href}?acceptance=${grid}-${renderer}`
      );
      expect(projectModule.default.mechanics).toEqual(mechanics);
      expect(projectModule.default.balance.missions[missionId].mechanics)
        .toEqual({ profiles: { quests: "r10_challenges" } });
      const player = fs.readFileSync(path.join(built.outDir, "player.mjs"), "utf8");
      expect(player).toContain("projectQuestPresentation");
      expect(player).toContain("quest-status");
      const singleModules = decodedSingleFileModules(
        fs.readFileSync(path.join(built.outDir, "index.single.html"), "utf8")
      );
      expect(singleModules).toContain('"quests":{"schemaVersion":1');
      expect(singleModules).toContain('"r10_challenges"');
      expect(singleModules).toContain("projectQuestPresentation");
    }

    const reference = projects.find(({ grid, renderer }) => grid === "hex" && renderer === "canvas");
    expect(reference).toBeTruthy();
    const mechanics = readJson(path.join(reference.projectDir, "content", "mechanics.json"));
    const packPath = path.join(reference.projectDir, ".towerforge", "exports", "r10-quests.tdpack");
    expect((await exportProjectPack(reference.projectDir, packPath)).ok).toBe(true);
    const pack = inspectProjectPack(packPath);
    expect(readJsonEntry(pack, "content/mechanics.json")).toEqual(mechanics);
    const packedBalance = readJsonEntry(pack, "content/balance.json");
    expect(packedBalance.missions[packedBalance.defaultMissionId].mechanics)
      .toEqual({ profiles: { quests: "r10_challenges" } });

    const portable = await packageWeb(reference.projectDir, {
      targetId: reference.targetId,
      outDir: "web-r10-quests"
    });
    expect(portable).toMatchObject({ ok: true, kind: "web", webTargetId: reference.targetId });
    for (const relative of [
      "game/project-data.js",
      "game/renderer/quest-presentation.mjs",
      "game/index.single.html"
    ]) {
      expect(fs.existsSync(path.join(portable.outDir, relative)), `web package: ${relative}`).toBe(true);
      expect(fs.readFileSync(portable.archive.outputPath).includes(Buffer.from(relative))).toBe(true);
    }
    const packagedProject = await import(
      `${pathToFileURL(path.join(portable.outDir, "game", "project-data.js")).href}?package=${Date.now()}`
    );
    expect(packagedProject.default.mechanics).toEqual(mechanics);
  }, 120_000);

  it("does not synthesize quests into an untouched legacy starter build", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r10-legacy-"));
    tempRoots.push(root);
    const projectDir = path.join(root, "starter.tdproj");
    fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
    const built = JSON.parse(execFileSync(process.execPath, [
      path.join(repoRoot, "packages", "cli", "build.mjs"),
      "--project", projectDir,
      "--out", "dist-r10-legacy",
      "--json"
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
    }));
    const projectModule = await import(
      `${pathToFileURL(path.join(built.outDir, "project-data.js")).href}?legacy=${Date.now()}`
    );
    expect(projectModule.default).not.toHaveProperty("mechanics");
    expect(projectModule.default.balance.missions.tutorial_01).not.toHaveProperty("mechanics");
  }, 60_000);
});

function build(projectDir, targetId) {
  return JSON.parse(execFileSync(process.execPath, [
    path.join(repoRoot, "packages", "cli", "build.mjs"),
    "--project", projectDir,
    "--target", targetId,
    "--single-file",
    "--json"
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
  }));
}

function enableQuests(projectDir) {
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);

  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = readJson(balancePath);
  const missionId = balance.defaultMissionId ?? Object.keys(balance.missions)[0];
  const towerId = balance.missions[missionId].buildTowerIds[0];
  balance.missions[missionId].mechanics = { profiles: { quests: "r10_challenges" } };
  writeJson(balancePath, balance);

  const mechanics = {
    schemaVersion: 1,
    modules: {
      quests: {
        schemaVersion: 1,
        enabled: true,
        profiles: {
          r10_challenges: {
            selectionCount: 1,
            definitions: {
              arrow_finish: {
                label: "Arrow finishers",
                weight: 1,
                objective: {
                  kind: "kill_with_source",
                  count: 1,
                  source: { kind: "tower", id: towerId }
                }
              }
            }
          }
        }
      }
    }
  };
  writeJson(path.join(projectDir, "content", "mechanics.json"), mechanics);
  return { mechanics, missionId };
}

function addBuildTarget(projectDir, targetId, renderer) {
  const targetsPath = path.join(projectDir, "build-targets.json");
  const targets = readJson(targetsPath);
  targets.targets[targetId] = {
    ...targets.targets[targets.defaults.web],
    id: targetId,
    renderer,
    webDir: `dist-${renderer}`
  };
  writeJson(targetsPath, targets);
}

function decodedSingleFileModules(html) {
  return [...html.matchAll(/data:text\/javascript;base64,([A-Za-z0-9+/=]+)/g)]
    .map((match) => Buffer.from(match[1], "base64").toString("utf8"))
    .join("\n");
}

function readJsonEntry(pack, entryPath) {
  const entry = pack.entries.find((candidate) => candidate.path === entryPath);
  expect(entry, `tdpack is missing ${entryPath}`).toBeTruthy();
  return JSON.parse(entry.bytes.toString("utf8"));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
