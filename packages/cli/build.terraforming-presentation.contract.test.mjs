import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { packageWeb } from "./lib/packaging.mjs";
import { exportProjectPack, inspectProjectPack } from "./lib/project-pack.mjs";

const repoRoot = path.resolve(".");
const tempProjects = [];

afterEach(() => {
  for (const projectDir of tempProjects.splice(0)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runBuild(projectDir, targetId) {
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

function count(source, token) {
  return source.split(token).length - 1;
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

function configureActiveTerraforming(projectDir) {
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);

  const selection = {
    mechanics: {
      profiles: {
        elevation: "authored_elevation",
        terraforming: "mutable_terrain"
      }
    }
  };
  const mechanics = {
    schemaVersion: 1,
    modules: {
      elevation: {
        schemaVersion: 1,
        enabled: true,
        profiles: { authored_elevation: {} }
      },
      terraforming: {
        schemaVersion: 1,
        enabled: true,
        profiles: {
          mutable_terrain: {
            terrainTransitions: {
              flood: { fromTerrainTags: ["ground"], toTerrainId: "water" }
            },
            elevation: { minimum: -3, maximum: 5, maximumDeltaPerOperation: 2 }
          }
        }
      }
    }
  };
  writeJson(path.join(projectDir, "content", "mechanics.json"), mechanics);

  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = readJson(balancePath);
  balance.missions.tutorial_01.mechanics = selection.mechanics;
  balance.missions.tutorial_square = {
    ...balance.missions.tutorial_01,
    id: "tutorial_square",
    label: "Terraforming Square",
    mapId: "tutorial_square_map"
  };
  balance.missions.tutorial_unselected = {
    ...balance.missions.tutorial_01,
    id: "tutorial_unselected",
    label: "Legacy Unselected",
    mechanics: undefined
  };
  writeJson(balancePath, balance);

  const mapsPath = path.join(projectDir, "maps", "compiled", "maps.json");
  const maps = readJson(mapsPath);
  maps.tutorial_map.elevationOverrides = [];
  maps.tutorial_square_map = {
    ...maps.tutorial_map,
    id: "tutorial_square_map",
    label: "Terraforming Square",
    grid: { kind: "square", adjacency: "cardinal" }
  };
  writeJson(mapsPath, maps);

  const scriptPath = path.join(projectDir, "scripts", "gameplay", "starter-gameplay.tower.json");
  const script = readJson(scriptPath);
  script.schemaVersion = 6;
  script.handlers.waveStarted[0].actions.push({
    action: "terraformTiles",
    duration: 2,
    operations: [
      { kind: "set_terrain", target: { q: 1, r: 1 }, transitionId: "flood" },
      { kind: "set_elevation", target: { q: 4, r: 1 }, elevation: 2 }
    ]
  });
  writeJson(scriptPath, script);

  const worldMapPath = path.join(projectDir, "content", "world-map.json");
  const worldMap = readJson(worldMapPath);
  worldMap.missionNodes.push(
    { ...worldMap.missionNodes[0], missionId: "tutorial_square", x: worldMap.missionNodes[0].x + 50 },
    { ...worldMap.missionNodes[0], missionId: "tutorial_unselected", x: worldMap.missionNodes[0].x + 100 }
  );
  writeJson(worldMapPath, worldMap);

  const targetsPath = path.join(projectDir, "build-targets.json");
  const targets = readJson(targetsPath);
  for (const renderer of ["canvas", "phaser"]) {
    targets.targets[`terraforming-${renderer}`] = {
      ...targets.targets["web-pwa"],
      id: `terraforming-${renderer}`,
      renderer,
      webDir: `dist-terraforming-${renderer}`
    };
  }
  writeJson(targetsPath, targets);
  return { mechanics, selection, script };
}

function terraformingSnapshot(source = "script") {
  return {
    terraforming: {
      schemaVersion: 1,
      pendingExpiryGroups: [{
        sequence: 1,
        remaining: 1.25,
        targets: [
          { layer: "terrain", q: 1, r: 1 },
          { layer: "elevation", q: 4, r: 1 }
        ]
      }]
    },
    elevation: {
      schemaVersion: 1,
      defaultElevation: 0,
      overrides: [{ q: 4, r: 1, elevation: 2 }]
    },
    lastEvents: [
      {
        type: "terrainChanged",
        coord: { q: 1, r: 1 },
        fromTerrain: "buildable",
        toTerrain: "water",
        terrainMetadata: {},
        source
      },
      {
        type: "elevationChanged",
        coord: { q: 4, r: 1 },
        fromElevation: 0,
        toElevation: 2,
        source: source === "restore" ? "restore" : "script"
      }
    ]
  };
}

describe("R3.4b C6B generated terraforming presentation shipping", () => {
  it("ships one shared runtime through Canvas, Phaser, both grids, PWA, single-file, web archive, and tdpack", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-c6b-build-"));
    tempProjects.push(projectDir);
    fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });

    // An ordinary schema-v1 starter remains mechanics-free even though the renderer knows how to
    // project optional terraforming snapshots. Studio playtest and build must not force opt-in.
    const legacy = runBuild(projectDir, "web-pwa");
    const legacyProject = (await import(
      `${pathToFileURL(path.join(legacy.outDir, "project-data.js")).href}?legacy=${Date.now()}`
    )).default;
    expect(legacyProject).not.toHaveProperty("mechanics");
    const legacyRenderer = await import(
      `${pathToFileURL(path.join(legacy.outDir, "renderer", "index.mjs")).href}?legacy-renderer=${Date.now()}`
    );
    expect(legacyRenderer.projectTerraformingPresentation({})).toEqual({
      active: false,
      terrainInvalidations: [],
      elevationInvalidations: []
    });

    const { mechanics, selection, script } = configureActiveTerraforming(projectDir);
    const sourcePresentation = fs.readFileSync(
      path.join(repoRoot, "packages", "renderer", "src", "terraforming-presentation.mjs")
    );
    const sourceAutotile = fs.readFileSync(path.join(repoRoot, "packages", "renderer", "src", "autotile.mjs"));
    const results = {};
    for (const renderer of ["canvas", "phaser"]) {
      const result = runBuild(projectDir, `terraforming-${renderer}`);
      results[renderer] = result;
      expect(result).toMatchObject({ ok: true, targetId: `terraforming-${renderer}` });
      const runtimeDir = path.join(result.outDir, "renderer");
      expect(fs.readFileSync(path.join(runtimeDir, "terraforming-presentation.mjs"))).toEqual(sourcePresentation);
      expect(fs.readFileSync(path.join(runtimeDir, "autotile.mjs"))).toEqual(sourceAutotile);

      const serviceWorker = fs.readFileSync(path.join(result.outDir, "offline-sw.js"), "utf8");
      expect(serviceWorker).toContain('"./renderer/terraforming-presentation.mjs"');
      expect(serviceWorker).toContain('"./renderer/autotile.mjs"');
      const singleFile = fs.readFileSync(path.join(result.outDir, "index.single.html"), "utf8");
      expect(singleFile).not.toMatch(/["']\.\/renderer\/(?:terraforming-presentation|autotile)\.mjs["']/);
      const inlined = inlineJavaScriptModules(singleFile).join("\n");
      expect(inlined).toContain("function projectTerraformingPresentation");
      expect(inlined).toContain("function expandAutotileInvalidations");

      const projectData = (await import(
        `${pathToFileURL(path.join(result.outDir, "project-data.js")).href}?project=${renderer}-${Date.now()}`
      )).default;
      expect(projectData.mechanics).toEqual(mechanics);
      expect(projectData.balance.missions.tutorial_01.mechanics).toEqual(selection.mechanics);
      expect(projectData.balance.missions.tutorial_square.mechanics).toEqual(selection.mechanics);
      expect(projectData.balance.missions.tutorial_unselected).not.toHaveProperty("mechanics");

      const bundledEngine = await import(
        `${pathToFileURL(path.join(result.outDir, "engine", "index.js")).href}?engine=${renderer}-${Date.now()}`
      );
      const content = bundledEngine.createGameContentRegistry(projectData);
      for (const [missionId, gridKind] of [["tutorial_01", "hex"], ["tutorial_square", "square"]]) {
        const game = new bundledEngine.TowerDefenseGame({ missionId, content, seed: `c6b-${renderer}-${gridKind}` });
        expect(game.getSnapshot()).toMatchObject({
          grid: { kind: gridKind },
          terraforming: { schemaVersion: 1, pendingExpiryGroups: [] }
        });
      }
      const unselected = new bundledEngine.TowerDefenseGame({
        missionId: "tutorial_unselected", content, seed: `c6b-${renderer}-unselected`
      });
      expect(unselected.getSnapshot()).not.toHaveProperty("terraforming");
      const disabledData = structuredClone(projectData);
      disabledData.mechanics.modules.terraforming.enabled = false;
      const disabledContent = bundledEngine.createGameContentRegistry(disabledData);
      const disabled = new bundledEngine.TowerDefenseGame({
        missionId: "tutorial_01", content: disabledContent, seed: `c6b-${renderer}-disabled`
      });
      expect(disabled.getSnapshot()).not.toHaveProperty("terraforming");

      const bundledRenderer = await import(
        `${pathToFileURL(path.join(runtimeDir, "index.mjs")).href}?renderer=${renderer}-${Date.now()}`
      );
      const set = bundledRenderer.projectTerraformingPresentation(terraformingSnapshot());
      expect(set).toEqual({
        active: true,
        terrainInvalidations: [{ q: 1, r: 1 }],
        elevationInvalidations: [{ q: 4, r: 1 }],
        elevationPresentation: {
          active: true,
          defaultElevation: 0,
          cues: [{ coord: { q: 4, r: 1 }, elevation: 2, label: "+2" }]
        }
      });
      const restoredSnapshot = terraformingSnapshot("restore");
      restoredSnapshot.terraforming.pendingExpiryGroups = [];
      restoredSnapshot.elevation.overrides = [];
      restoredSnapshot.lastEvents[0].fromTerrain = "water";
      restoredSnapshot.lastEvents[0].toTerrain = "buildable";
      restoredSnapshot.lastEvents[1].fromElevation = 2;
      restoredSnapshot.lastEvents[1].toElevation = 0;
      expect(bundledRenderer.projectTerraformingPresentation(restoredSnapshot)).toEqual({
        active: true,
        terrainInvalidations: [{ q: 1, r: 1 }],
        elevationInvalidations: [{ q: 4, r: 1 }],
        elevationPresentation: { active: true, defaultElevation: 0, cues: [] }
      });

      const tiles = Array.from({ length: 3 }, (_, r) => Array.from({ length: 3 }, (_, q) => ({ q, r }))).flat();
      for (const gridType of ["square", "hex"]) {
        const expanded = bundledRenderer.expandAutotileInvalidations({
          gridType,
          // (0,0) models the authoritative snapshot diff; (1,1) models the current event hint.
          coordinates: [{ q: 0, r: 0 }, ...set.terrainInvalidations],
          tiles
        });
        expect(expanded).toContainEqual({ q: 0, r: 0 });
        expect(expanded).toContainEqual({ q: 1, r: 1 });
        expect(expanded).toContainEqual({ q: 2, r: 1 });
        expect(Object.isFrozen(expanded)).toBe(true);
      }

      const canvasSource = fs.readFileSync(path.join(runtimeDir, "index.mjs"), "utf8");
      const playerSource = fs.readFileSync(path.join(result.outDir, "player.mjs"), "utf8");
      if (renderer === "canvas") {
        expect(count(canvasSource, "projectTerraformingPresentation(snapshot)")).toBe(1);
        expect(canvasSource).toContain("mergeAutotileRoots(changedRoots, terraformingPresentation?.terrainInvalidations)");
        expect(canvasSource).toMatch(/roots === null[\s\S]{0,500}clearRect[\s\S]{0,500}for \(const tile of tiles\) this\.drawTile/);
        expect(canvasSource).toContain("terraformingPresentation?.elevationPresentation ?? projectElevationCues(snapshot.elevation)");
      } else {
        expect(count(playerSource, "projectTerraformingPresentation(presentationSnapshot)")).toBe(1);
        expect(playerSource).toContain("this.mergeAutotileRoots(changedRoots, terraformingPresentation?.terrainInvalidations)");
        expect(playerSource).toMatch(/roots === null \|\| expanded === undefined[\s\S]{0,220}snap\.tiles\.map/);
        expect(playerSource).toMatch(/terraformingPresentation\?\.elevationPresentation\s*\|\|\s*projectElevationCues\(snap\.elevation\)/);
      }
    }

    const packPath = path.join(projectDir, ".towerforge", "exports", "terraforming-reference.tdpack");
    expect((await exportProjectPack(projectDir, packPath)).ok).toBe(true);
    const pack = inspectProjectPack(packPath);
    expect(readJsonEntry(pack, "content/mechanics.json")).toEqual(mechanics);
    expect(readJsonEntry(pack, "scripts/gameplay/starter-gameplay.tower.json")).toEqual(script);

    const portable = await packageWeb(projectDir, {
      targetId: "terraforming-canvas",
      outDir: "web-terraforming"
    });
    expect(portable).toMatchObject({ ok: true, kind: "web", webTargetId: "terraforming-canvas" });
    for (const relative of [
      "game/renderer/terraforming-presentation.mjs",
      "game/renderer/autotile.mjs",
      "game/index.single.html"
    ]) {
      expect(fs.existsSync(path.join(portable.outDir, relative))).toBe(true);
      expect(fs.readFileSync(portable.archive.outputPath).includes(Buffer.from(relative))).toBe(true);
    }
  }, 90_000);

  it("keeps the public opt-in reference fixture explicit and inert", () => {
    const fixtureDir = path.join(repoRoot, "docs", "examples", "opt-in-transactional-terraforming");
    for (const fileName of ["README.md", "mechanics.json", "mission-selection.json", "towerscript.fragment.json"]) {
      expect(fs.existsSync(path.join(fixtureDir, fileName)), `missing ${fileName}`).toBe(true);
    }
    const mechanics = readJson(path.join(fixtureDir, "mechanics.json"));
    const selection = readJson(path.join(fixtureDir, "mission-selection.json"));
    const script = readJson(path.join(fixtureDir, "towerscript.fragment.json"));
    expect(mechanics).toMatchObject({
      schemaVersion: 1,
      modules: {
        terraforming: { schemaVersion: 1, enabled: true, profiles: expect.any(Object) }
      }
    });
    expect(selection).toMatchObject({ mechanics: { profiles: { terraforming: expect.any(String) } } });
    expect(script).toMatchObject({
      minimumSchemaVersion: 6,
      snippet: { action: "terraformTiles", operations: expect.any(Array) }
    });
    // A recipe/reference may describe all separate authoring pieces, but it must never smuggle a
    // mission selection into mechanics.json or a guarded write into the snippet itself.
    expect(mechanics).not.toHaveProperty("mission");
    expect(script).not.toHaveProperty("commit");
    expect(script).not.toHaveProperty("revision");
  });

  it("keeps the generated Codex runtime byte-identical to the renderer source", () => {
    for (const fileName of ["terraforming-presentation.mjs", "autotile.mjs", "index.mjs"]) {
      const source = path.join(repoRoot, "packages", "renderer", "src", fileName);
      const plugin = path.join(repoRoot, "plugins", "towerforge", "runtime", "packages", "renderer", "src", fileName);
      expect(fs.existsSync(plugin), `plugin runtime is missing ${fileName}`).toBe(true);
      expect(fs.readFileSync(plugin)).toEqual(fs.readFileSync(source));
    }
  });
});

function readJsonEntry(pack, entryPath) {
  const entry = pack.entries.find((candidate) => candidate.path === entryPath);
  expect(entry, `tdpack is missing ${entryPath}`).toBeTruthy();
  return JSON.parse(entry.bytes.toString("utf8"));
}
