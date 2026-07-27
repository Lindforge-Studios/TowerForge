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

describe("R5.3A generated-player and package active-ability acceptance", () => {
  it("preserves active heroes v4 exactly through both renderers/grids and every web/project package", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r53a-package-"));
    tempRoots.push(root);
    const projects = [];

    for (const { grid, renderer } of combinations) {
      const { projectDir } = createProject({
        name: `ability_${grid}_${renderer}`,
        parentDir: root,
        templateName: "classic",
        gridKind: grid
      });
      projects.push({ projectDir, grid, renderer });
      const { mechanics, missionId } = enableActiveAbilityHero(projectDir);
      const targetId = `ability-${renderer}`;
      addBuildTarget(projectDir, targetId, renderer);
      const built = JSON.parse(execFileSync(process.execPath, [
        path.join(repoRoot, "packages", "cli", "build.mjs"),
        "--project", projectDir,
        "--target", targetId,
        "--single-file",
        "--json"
      ], { cwd: repoRoot, encoding: "utf8", env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" } }));
      const projectModule = await import(
        `${pathToFileURL(path.join(built.outDir, "project-data.js")).href}?ability=${grid}-${renderer}`
      );
      expect(projectModule.default.mechanics).toEqual(mechanics);
      expect(projectModule.default.balance.missions[missionId].mechanics)
        .toEqual({ profiles: { heroes: "ability_commanders" } });
      const inlineProject = inlineJavaScriptModules(
        fs.readFileSync(path.join(built.outDir, "index.single.html"), "utf8")
      ).find((source) => source.startsWith("export default ") && source.includes('"activeAbility"'));
      expect(inlineProject, `${grid}/${renderer} single-file mechanics`).toContain('"schemaVersion":4');
      expect(inlineProject).toContain('"mana":{"max":100,"starting":60,"regenerationPerUnit":5}');
      expect(inlineProject).toContain('"activeAbility":{"id":"arc_bolt","label":"Arc Bolt","target":"enemy","manaCost":20,"cooldown":3,"range":8,"damage":30}');
    }

    const reference = projects.find(({ grid, renderer }) => grid === "hex" && renderer === "canvas");
    expect(reference).toBeTruthy();
    const mechanics = readJson(path.join(reference.projectDir, "content", "mechanics.json"));
    const packPath = path.join(reference.projectDir, ".towerforge", "exports", "ability-hero.tdpack");
    expect((await exportProjectPack(reference.projectDir, packPath)).ok).toBe(true);
    const pack = inspectProjectPack(packPath);
    expect(readJsonEntry(pack, "content/mechanics.json")).toEqual(mechanics);

    const portable = await packageWeb(reference.projectDir, {
      targetId: "ability-canvas",
      outDir: "web-ability-hero"
    });
    expect(portable).toMatchObject({ ok: true, kind: "web", webTargetId: "ability-canvas" });
    const packagedProject = await import(
      `${pathToFileURL(path.join(portable.outDir, "game", "project-data.js")).href}?package=${Date.now()}`
    );
    expect(packagedProject.default.mechanics).toEqual(mechanics);
    expect(fs.readFileSync(portable.archive.outputPath).includes(Buffer.from("ability_commanders"))).toBe(true);
    expect(fs.readFileSync(portable.archive.outputPath).includes(Buffer.from("activeAbility"))).toBe(true);
  }, 120_000);
});

function enableActiveAbilityHero(projectDir) {
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);

  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = readJson(balancePath);
  const missionId = balance.defaultMissionId ?? Object.keys(balance.missions)[0];
  balance.missions[missionId].mechanics = { profiles: { heroes: "ability_commanders" } };
  writeJson(balancePath, balance);

  const mechanics = {
    schemaVersion: 1,
    modules: {
      heroes: {
        schemaVersion: 4,
        enabled: true,
        profiles: {
          ability_commanders: {
            selectedHeroId: "commander",
            definitions: {
              commander: {
                label: "Ability Commander",
                spawn: "core",
                movement: { movementProfileId: "ground", speed: 2 },
                durability: { maxHp: 120, shield: { capacity: 40 } },
                mana: { max: 100, starting: 60, regenerationPerUnit: 5 },
                activeAbility: {
                  id: "arc_bolt", label: "Arc Bolt", target: "enemy",
                  manaCost: 20, cooldown: 3, range: 8, damage: 30
                }
              }
            },
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
    ...targets.targets["web-pwa"], id: targetId, renderer, webDir: `dist-${renderer}`
  };
  writeJson(targetsPath, targets);
}

function inlineJavaScriptModules(html) {
  return [...html.matchAll(/data:text\/javascript;base64,([A-Za-z0-9+/=]+)/g)]
    .map((match) => Buffer.from(match[1], "base64").toString("utf8"));
}

function readJsonEntry(pack, entryPath) {
  const entry = pack.entries.find((candidate) => candidate.path === entryPath);
  expect(entry, `tdpack is missing ${entryPath}`).toBeTruthy();
  return JSON.parse(entry.bytes.toString("utf8"));
}

function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
function writeJson(filePath, value) { fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
