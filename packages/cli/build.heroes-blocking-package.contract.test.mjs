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

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("R5.6A generated-player and package dynamic hero-blocking acceptance", () => {
  it("preserves exact opt-in heroes v7 plus navigation through every web artifact", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r56a-package-"));
    tempRoots.push(root);
    const { projectDir } = createProject({
      name: "hero_blocking_hex_canvas",
      parentDir: root,
      templateName: "classic",
      gridKind: "hex"
    });
    const mechanics = enableHeroBlocking(projectDir);
    const built = JSON.parse(execFileSync(process.execPath, [
      path.join(repoRoot, "packages", "cli", "build.mjs"),
      "--project", projectDir,
      "--target", "web-pwa",
      "--single-file",
      "--json"
    ], { cwd: repoRoot, encoding: "utf8", env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" } }));

    expect(fs.existsSync(path.join(built.outDir, "manifest.webmanifest"))).toBe(true);
    const projectModule = await import(
      `${pathToFileURL(path.join(built.outDir, "project-data.js")).href}?blocking=${Date.now()}`
    );
    expect(projectModule.default.mechanics).toEqual(mechanics);
    const single = fs.readFileSync(path.join(built.outDir, "index.single.html"), "utf8");
    const inlineProject = inlineJavaScriptModules(single)
      .find((source) => source.startsWith("export default ") && source.includes('"blocking"'));
    expect(inlineProject).toContain('"schemaVersion":7');
    expect(inlineProject).toContain('"blockCapacity":2');
    expect(inlineProject).toContain('"dynamic_flow"');

    const packPath = path.join(projectDir, ".towerforge", "exports", "hero-blocking.tdpack");
    expect((await exportProjectPack(projectDir, packPath)).ok).toBe(true);
    expect(readJsonEntry(inspectProjectPack(packPath), "content/mechanics.json")).toEqual(mechanics);

    const portable = await packageWeb(projectDir, {
      targetId: "web-pwa", outDir: "web-hero-blocking"
    });
    expect(portable).toMatchObject({ ok: true, kind: "web", webTargetId: "web-pwa" });
    const packagedProject = await import(
      `${pathToFileURL(path.join(portable.outDir, "game", "project-data.js")).href}?package=${Date.now()}`
    );
    expect(packagedProject.default.mechanics).toEqual(mechanics);
    expect(fs.readFileSync(portable.archive.outputPath).includes(Buffer.from("blockCapacity")))
      .toBe(true);
  }, 120_000);

  it("keeps an untouched starter literal and free of synthesized mechanics during build", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r56a-legacy-package-"));
    tempRoots.push(root);
    const { projectDir } = createProject({
      name: "legacy_square_phaser",
      parentDir: root,
      templateName: "classic",
      gridKind: "square"
    });
    const beforeProject = fs.readFileSync(path.join(projectDir, "project.json"), "utf8");
    expect(fs.existsSync(path.join(projectDir, "content", "mechanics.json"))).toBe(false);

    const built = JSON.parse(execFileSync(process.execPath, [
      path.join(repoRoot, "packages", "cli", "build.mjs"),
      "--project", projectDir,
      "--target", "web-pwa",
      "--json"
    ], { cwd: repoRoot, encoding: "utf8", env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" } }));
    const projectModule = await import(
      `${pathToFileURL(path.join(built.outDir, "project-data.js")).href}?legacy=${Date.now()}`
    );
    expect(projectModule.default.mechanics).toBeUndefined();
    expect(fs.existsSync(path.join(projectDir, "content", "mechanics.json"))).toBe(false);
    expect(fs.readFileSync(path.join(projectDir, "project.json"), "utf8")).toBe(beforeProject);
  }, 120_000);
});

function enableHeroBlocking(projectDir) {
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);

  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = readJson(balancePath);
  const missionId = balance.defaultMissionId ?? Object.keys(balance.missions)[0];
  balance.missions[missionId].mechanics = {
    profiles: { navigation: "dynamic", heroes: "blocker_commanders" }
  };
  const enemyMovementProfiles = Object.fromEntries(
    Object.keys(balance.enemies).sort().map((enemyId) => [enemyId, "ground"])
  );
  writeJson(balancePath, balance);

  const mechanics = {
    schemaVersion: 1,
    modules: {
      navigation: {
        schemaVersion: 1,
        enabled: true,
        profiles: {
          dynamic: {
            mode: "dynamic_flow",
            defaultMovementProfileId: "ground",
            movementProfiles: {
              ground: {
                label: "Ground", terrainMode: "respect_walkable",
                towerOccupancy: "blocked", defaultTerrainCost: 1_000
              }
            },
            enemyMovementProfiles
          }
        }
      },
      heroes: {
        schemaVersion: 7,
        enabled: true,
        profiles: {
          blocker_commanders: {
            selectedHeroId: "commander",
            definitions: {
              commander: {
                label: "Blocking Commander",
                spawn: "core",
                movement: { movementProfileId: "hero_ground", speed: 2 },
                durability: { maxHp: 100, shield: { capacity: 25 } },
                mana: { max: 100, starting: 60, regenerationPerUnit: 5 },
                activeAbility: {
                  id: "arc_bolt", label: "Arc Bolt", target: "enemy",
                  manaCost: 20, cooldown: 3, range: 6, damage: 30
                },
                skillTree: null,
                passiveAura: null,
                blocking: { blockCapacity: 2, movementProfileIds: ["ground"] }
              }
            },
            movementProfiles: {
              hero_ground: {
                label: "Hero Ground", terrainMode: "respect_walkable",
                towerOccupancy: "blocked", defaultTerrainCost: 1_000
              }
            }
          }
        }
      }
    }
  };
  writeJson(path.join(projectDir, "content", "mechanics.json"), mechanics);
  return mechanics;
}

function readJsonEntry(pack, entryPath) {
  const entry = pack.entries.find((candidate) => candidate.path === entryPath);
  expect(entry, `tdpack is missing ${entryPath}`).toBeTruthy();
  return JSON.parse(entry.bytes.toString("utf8"));
}

function inlineJavaScriptModules(html) {
  return [...html.matchAll(/data:text\/javascript;base64,([A-Za-z0-9+/=]+)/g)]
    .map((match) => Buffer.from(match[1], "base64").toString("utf8"));
}

function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
