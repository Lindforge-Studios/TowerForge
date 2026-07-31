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
const sourceKinds = ["tower", "ability", "tower_script", "status", "reaction", "enemy"];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("R12.4 vanguard protection generated-player and package contract", () => {
  it("preserves exact opt-in protection through Canvas/Phaser, hex/square, PWA and single-file", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r12-protection-package-"));
    tempRoots.push(root);
    const projects = [];

    for (const { grid, renderer } of combinations) {
      const { projectDir } = createProject({
        name: `protection_${grid}_${renderer}`,
        parentDir: root,
        templateName: "classic",
        gridKind: grid
      });
      const { mechanics, selection, missionId } = enableVanguardProtection(projectDir);
      const targetId = `protection-${grid}-${renderer}`;
      addBuildTarget(projectDir, targetId, renderer);
      const built = build(projectDir, targetId);
      projects.push({ projectDir, targetId, mechanics });

      expect(built).toMatchObject({ ok: true, targetId });
      expect(fs.existsSync(path.join(built.outDir, "manifest.webmanifest"))).toBe(true);
      expect(fs.existsSync(path.join(built.outDir, "offline-sw.js"))).toBe(true);
      expect(fs.existsSync(path.join(built.outDir, "index.single.html"))).toBe(true);
      expect(fs.existsSync(path.join(built.outDir, "renderer", "vanguard-protection-presentation.mjs"))).toBe(true);

      const projectData = (await import(
        `${pathToFileURL(path.join(built.outDir, "project-data.js")).href}?r12=${grid}-${renderer}-${Date.now()}`
      )).default;
      expect(projectData.mechanics).toEqual(mechanics);
      expect(projectData.balance.missions[missionId].mechanics).toEqual(selection);

      const bundledEngine = await import(
        `${pathToFileURL(path.join(built.outDir, "engine", "index.js")).href}?r12-engine=${grid}-${renderer}-${Date.now()}`
      );
      const content = bundledEngine.createGameContentRegistry(projectData);
      const game = new bundledEngine.TowerDefenseGame({
        missionId,
        content,
        seed: `r12-protection-${grid}-${renderer}`
      });
      expect(game.getSnapshot()).toMatchObject({
        grid: { kind: grid },
        enemyBehaviors: {
          schemaVersion: 1,
          formations: {
            schemaVersion: 1,
            protection: {
              schemaVersion: 1,
              cohorts: { shield_wall: { radius: 2, sourceKinds } }
            }
          }
        }
      });

      const bundledRenderer = await import(
        `${pathToFileURL(path.join(built.outDir, "renderer", "index.mjs")).href}?r12-renderer=${grid}-${renderer}-${Date.now()}`
      );
      expect(bundledRenderer.projectVanguardProtectionPresentation(game.getSnapshot())).toEqual({
        active: true,
        cohorts: [{ cohortId: "shield_wall", radius: 2, sourceKinds }],
        cues: []
      });
      const player = fs.readFileSync(path.join(built.outDir, "player.mjs"), "utf8");
      if (renderer === "phaser") expect(player).toContain("projectVanguardProtectionPresentation");
      const inlined = inlineJavaScriptModules(
        fs.readFileSync(path.join(built.outDir, "index.single.html"), "utf8")
      ).join("\n");
      expect(inlined).toContain('"protection":{"radius":2,"sourceKinds"');
      expect(inlined).toContain("projectVanguardProtectionPresentation");
    }

    const reference = projects[0];
    const portable = await packageWeb(reference.projectDir, {
      targetId: reference.targetId,
      outDir: "web-r12-vanguard-protection"
    });
    expect(portable).toMatchObject({ ok: true, kind: "web", webTargetId: reference.targetId });
    const packagedProject = (await import(
      `${pathToFileURL(path.join(portable.outDir, "game", "project-data.js")).href}?r12-package=${Date.now()}`
    )).default;
    expect(packagedProject.mechanics).toEqual(reference.mechanics);
    expect(fs.readFileSync(portable.archive.outputPath).includes(Buffer.from("shield_wall"))).toBe(true);
    expect(fs.readFileSync(portable.archive.outputPath).includes(Buffer.from("vanguard-protection-presentation.mjs"))).toBe(true);

    const packPath = path.join(reference.projectDir, ".towerforge", "exports", "r12-vanguard-protection.tdpack");
    expect((await exportProjectPack(reference.projectDir, packPath)).ok).toBe(true);
    expect(readJsonEntry(inspectProjectPack(packPath), "content/mechanics.json")).toEqual(reference.mechanics);
  }, 180_000);

  it("does not synthesize protection mechanics or runtime metadata into an untouched starter output", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r12-protection-legacy-"));
    tempRoots.push(root);
    const projectDir = path.join(root, "starter.tdproj");
    fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });

    const built = build(projectDir, "web-pwa");
    const projectData = (await import(
      `${pathToFileURL(path.join(built.outDir, "project-data.js")).href}?r12-legacy=${Date.now()}`
    )).default;
    expect(projectData).not.toHaveProperty("mechanics");

    const bundledEngine = await import(
      `${pathToFileURL(path.join(built.outDir, "engine", "index.js")).href}?r12-legacy-engine=${Date.now()}`
    );
    const game = new bundledEngine.TowerDefenseGame({
      missionId: "tutorial_01",
      content: bundledEngine.createGameContentRegistry(projectData),
      seed: "r12-protection-legacy"
    });
    expect(game.getSnapshot()).not.toHaveProperty("enemyBehaviors");
    expect(game.createCheckpoint().state).not.toHaveProperty("enemyBehaviors");

    const bundledRenderer = await import(
      `${pathToFileURL(path.join(built.outDir, "renderer", "index.mjs")).href}?r12-legacy-renderer=${Date.now()}`
    );
    expect(bundledRenderer.projectVanguardProtectionPresentation(game.getSnapshot())).toEqual({
      active: false,
      cohorts: [],
      cues: []
    });
  }, 60_000);
});

function enableVanguardProtection(projectDir) {
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);

  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = readJson(balancePath);
  const missionId = balance.defaultMissionId ?? Object.keys(balance.missions)[0];
  const [vanguardId, bodyId, supportId] = Object.keys(balance.enemies);
  const selection = {
    profiles: {
      navigation: "dynamic_flow",
      combat: "shielded_vanguard",
      enemyBehaviors: "protected_formation"
    }
  };
  const mechanics = {
    schemaVersion: 1,
    modules: {
      navigation: {
        schemaVersion: 1,
        enabled: true,
        profiles: {
          dynamic_flow: {
            mode: "dynamic_flow",
            defaultMovementProfileId: "ground",
            movementProfiles: {
              ground: {
                label: "Ground",
                terrainMode: "respect_walkable",
                towerOccupancy: "blocked",
                defaultTerrainCost: 1_000
              }
            }
          }
        }
      },
      combat: {
        schemaVersion: 1,
        enabled: true,
        profiles: {
          shielded_vanguard: {
            shields: { enemies: { [vanguardId]: { capacity: 50 } } }
          }
        }
      },
      enemyBehaviors: {
        schemaVersion: 1,
        enabled: true,
        profiles: {
          protected_formation: {
            formations: {
              cohorts: {
                shield_wall: {
                  members: {
                    [vanguardId]: "vanguard",
                    [bodyId]: "body",
                    [supportId]: "support"
                  },
                  steering: {
                    neighborRadius: 2,
                    cohesionWeight: 600,
                    separationWeight: 800,
                    roleWeight: 400
                  },
                  protection: { radius: 2, sourceKinds }
                }
              }
            }
          }
        }
      }
    }
  };
  writeJson(path.join(projectDir, "content", "mechanics.json"), mechanics);

  balance.missions[missionId].mechanics = selection;
  writeJson(balancePath, balance);
  return { mechanics, selection, missionId };
}

function addBuildTarget(projectDir, targetId, renderer) {
  const targetsPath = path.join(projectDir, "build-targets.json");
  const targets = readJson(targetsPath);
  targets.targets[targetId] = {
    ...targets.targets[targets.defaults.web],
    id: targetId,
    renderer,
    webDir: `dist-${targetId}`
  };
  writeJson(targetsPath, targets);
}

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

function inlineJavaScriptModules(html) {
  const queue = [html];
  const decoded = [];
  const seen = new Set();
  while (queue.length > 0) {
    const source = queue.shift();
    for (const match of source.matchAll(/data:text\/javascript;base64,([A-Za-z0-9+/=]+)/g)) {
      if (seen.has(match[1])) continue;
      seen.add(match[1]);
      const moduleSource = Buffer.from(match[1], "base64").toString("utf8");
      decoded.push(moduleSource);
      queue.push(moduleSource);
    }
  }
  return decoded;
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
