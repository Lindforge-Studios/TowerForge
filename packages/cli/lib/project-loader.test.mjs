import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadContentRegistry,
  loadProjectFiles,
  projectSummary,
  readRawProjectFiles,
  runMissionSmoke,
  selectBuildTarget
} from "./project-loader.mjs";

const tempProjects = [];

afterEach(() => {
  for (const projectDir of tempProjects.splice(0)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

function projectFixture({ schemaVersion, mechanics } = {}) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-mechanics-"));
  tempProjects.push(projectDir);
  fs.writeFileSync(
    path.join(projectDir, "project.json"),
    `${JSON.stringify({ schemaVersion, name: "Mechanics contract" }, null, 2)}\n`,
    "utf8"
  );
  if (mechanics !== undefined) {
    fs.mkdirSync(path.join(projectDir, "content"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "content", "mechanics.json"),
      `${JSON.stringify(mechanics, null, 2)}\n`,
      "utf8"
    );
  }
  return projectDir;
}

function navigationRuntimeProject({ catalog = true, enabled = true, selected = true, mode = "dynamic_flow" } = {}) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-navigation-runtime.tdproj-"));
  tempProjects.push(projectDir);
  const writeJson = (relativePath, value) => {
    const filePath = path.join(projectDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  };
  writeJson("project.json", {
    schemaVersion: catalog ? 3 : 2,
    name: "Navigation runtime contract",
    defaultMissionId: "navigation"
  });
  writeJson("content/balance.json", {
    defaultMissionId: "navigation",
    constants: {
      timeUnitSeconds: 1,
      startingCoreHp: 20,
      startingCoins: 100,
      startingResources: { coins: 100 },
      prepTimeUnits: 0,
      moveTowerCost: { coins: 1 },
      waterGroundSpeedFactor: 0.5,
      pathWaterCooldownUnits: 1,
      pathWaterDurationUnits: 1,
      pathWaterRadius: 1,
      pathWaterGroundSpeedFactor: 0.5
    },
    abilities: {},
    enemies: {
      grunt: {
        id: "grunt", label: "Grunt", maxHp: 10, speed: 1,
        reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
      }
    },
    towers: {
      blocker: {
        id: "blocker", label: "Blocker", cost: { coins: 1 }, footprintRadius: 0, range: 2,
        attack: {
          kind: "single", fireRate: 1, damagePerStack: 1,
          startingStacks: 1, maxStacks: 1, upgradeCost: 1
        }
      }
    },
    waveSets: {
      one: [{
        id: "wave", label: "Wave",
        groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0, routeId: "main" }]
      }]
    },
    missions: {
      navigation: {
        id: "navigation", label: "Navigation", description: "",
        startingCoreHp: 20, startingResources: { coins: 100 }, prepTimeUnits: 0,
        mapId: "lane", waveSetId: "one", buildTowerIds: ["blocker"], abilityIds: [],
        ...(selected ? { mechanics: { profiles: { navigation: "maze" } } } : {})
      }
    }
  });
  writeJson("content/world-map.json", {
    width: 10,
    height: 10,
    regions: [{
      id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
      bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
    }],
    missionNodes: [{
      missionId: "navigation", regionId: "region", x: 5, y: 5,
      difficulty: 1, unlockRequiresMissionIds: []
    }]
  });
  writeJson("maps/compiled/maps.json", {
    lane: {
      id: "lane", width: 5, height: 1,
      grid: { kind: "square", adjacency: "cardinal" },
      defaultTerrain: "buildable",
      spawnCoord: { q: 0, r: 0 }, coreCoord: { q: 4, r: 0 },
      pathCenterline: Array.from({ length: 5 }, (_, q) => ({ q, r: 0 })),
      pathRoutes: [{
        id: "main",
        pathCenterline: Array.from({ length: 5 }, (_, q) => ({ q, r: 0 }))
      }],
      terrainOverrides: []
    }
  });
  if (catalog) {
    writeJson("content/mechanics.json", {
      schemaVersion: 1,
      modules: {
        navigation: {
          schemaVersion: 1,
          enabled,
          profiles: {
            maze: mode === "authored_routes"
              ? { mode: "authored_routes" }
              : {
                  mode: "dynamic_flow",
                  defaultMovementProfileId: "ground",
                  movementProfiles: {
                    ground: {
                      label: "Ground",
                      terrainMode: "respect_walkable",
                      towerOccupancy: "blocked",
                      defaultTerrainCost: 1_000
                    }
                  },
                  enemyMovementProfiles: { grunt: "ground" }
                }
          }
        }
      }
    });
  }
  return projectDir;
}

const mechanicsCatalog = {
  schemaVersion: 1,
  modules: {
    combat: {
      schemaVersion: 1,
      enabled: true,
      profiles: {
        elemental: { damageTypes: ["fire", "ice", "lightning"] }
      }
    }
  }
};

describe("project loader", () => {
  it.each([1, 2])("loads a schema v%s legacy project without authoring mechanics", (schemaVersion) => {
    const projectDir = projectFixture({ schemaVersion });

    expect(readRawProjectFiles(projectDir).mechanics).toBeUndefined();

    const files = loadProjectFiles(projectDir);
    expect(files.manifest.schemaVersion).toBe(schemaVersion === 1 ? 2 : 2);
    expect(files.mechanics).toEqual({ schemaVersion: 1, modules: {} });
    expect(projectSummary(files).mechanics).toEqual({ schemaVersion: 1, modules: {} });
  });

  it("reads optional content/mechanics.json and exposes it to normalized project consumers", () => {
    const projectDir = projectFixture({ schemaVersion: 3, mechanics: mechanicsCatalog });

    expect(readRawProjectFiles(projectDir).mechanics).toEqual(mechanicsCatalog);

    const files = loadProjectFiles(projectDir);
    expect(files.mechanics).toEqual(mechanicsCatalog);
    expect(files.balance.missions).toEqual({});
    expect(projectSummary(files).mechanics).toEqual(mechanicsCatalog);
  });

  it("selects the canonical web build target", () => {
    const files = loadProjectFiles(path.resolve("examples/starter.tdproj"));
    const [targetId, target] = selectBuildTarget(files.buildTargets);

    expect(targetId).toBe("web-pwa");
    expect(target.platform).toBe("web");
    expect(target.webDir).toBe("dist");
    expect(target.appName).toBe("Web PWA");
    expect(target.appTitle).toBe("Starter Tower Defense");
  });

  it("returns aggregate smoke-run observability instead of final-frame events only", async () => {
    const result = await runMissionSmoke(path.resolve("examples/starter.tdproj"), "tutorial_01", 20);

    expect(result.eventCounts.waveStarted).toBeGreaterThanOrEqual(1);
    expect(result.eventTimeline.some((event) => event.type === "towerPlaced")).toBe(true);
    expect(result.milestones.length).toBeGreaterThanOrEqual(2);
    expect(result.strategy.placement).toBe("auto_nearest_path");
    expect(result.nextValidActions.length).toBeGreaterThan(0);
  });

  it("carries opt-in dynamic path validation from .tdproj files into the engine and preserves every legacy gate", async () => {
    const active = await loadContentRegistry(navigationRuntimeProject());
    const activeGame = new active.engine.TowerDefenseGame({ missionId: "navigation", content: active.content });
    expect(active.files.mechanicsAuthored).toBe(true);
    expect(active.content.missions.navigation.capabilities.navigation).toMatchObject({
      active: true,
      profileId: "maze",
      reason: "active"
    });
    expect(activeGame.canPlaceTower("blocker", { q: 2, r: 0 })).toMatchObject({
      ok: false,
      reasonKey: "reason.lastPathBlocked",
      reasonParams: { movementProfileId: "ground", routeId: "main" }
    });
    expect(activeGame.placeTower("blocker", { q: 2, r: 0 })).toMatchObject({
      ok: false,
      reasonKey: "reason.lastPathBlocked"
    });

    for (const [label, options] of [
      ["absent", { catalog: false, selected: false }],
      ["disabled", { enabled: false }],
      ["unselected", { selected: false }],
      ["authored_routes", { mode: "authored_routes" }]
    ]) {
      const loaded = await loadContentRegistry(navigationRuntimeProject(options));
      const legacyGame = new loaded.engine.TowerDefenseGame({ missionId: "navigation", content: loaded.content });
      expect(legacyGame.placeTower("blocker", { q: 2, r: 0 }), label).toEqual({ ok: true });
      expect(Object.prototype.hasOwnProperty.call(legacyGame.getSnapshot(), "navigation"), label).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(legacyGame.createCheckpoint().state, "navigation"), label).toBe(false);
    }
  });

  it("carries opt-in dynamic live movement and snapshots through the .tdproj loader without leaking keys into legacy gates", async () => {
    const active = await loadContentRegistry(navigationRuntimeProject());
    const activeGame = new active.engine.TowerDefenseGame({ missionId: "navigation", content: active.content });

    expect(activeGame.startNextWave()).toEqual({ ok: true });
    activeGame.tick(0);
    activeGame.tick(0.2);

    const activeSnapshot = activeGame.getSnapshot();
    expect(activeSnapshot.enemies).toHaveLength(1);
    expect(activeSnapshot.enemies[0]).toMatchObject({
      routeId: "main",
      pathProgress: 0.2,
      navigation: {
        schemaVersion: 1,
        movementProfileId: "ground",
        currentCoord: { q: 0, r: 0 },
        nextCoord: { q: 1, r: 0 },
        edgeProgress: 0.2,
        stepsEntered: 0
      }
    });
    expect(activeSnapshot.navigation).toMatchObject({
      schemaVersion: 1,
      mode: "dynamic_flow",
      fields: [{
        movementProfileId: "ground",
        goal: { q: 4, r: 0 },
        routeIds: ["main"],
        reachableRouteIds: ["main"],
        unreachableRouteIds: []
      }],
      stalledEnemyIds: []
    });

    const legacySnapshots = [];
    for (const [label, options] of [
      ["absent", { catalog: false, selected: false }],
      ["disabled", { enabled: false }],
      ["unselected", { selected: false }],
      ["authored_routes", { mode: "authored_routes" }]
    ]) {
      const loaded = await loadContentRegistry(navigationRuntimeProject(options));
      const legacyGame = new loaded.engine.TowerDefenseGame({ missionId: "navigation", content: loaded.content });
      expect(legacyGame.startNextWave(), label).toEqual({ ok: true });
      legacyGame.tick(0);
      legacyGame.tick(0.2);
      const snapshot = legacyGame.getSnapshot();
      expect(snapshot.enemies, label).toHaveLength(1);
      expect(Object.prototype.hasOwnProperty.call(snapshot, "navigation"), label).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(snapshot.enemies[0], "navigation"), label).toBe(false);
      legacySnapshots.push(snapshot);
    }
    for (const snapshot of legacySnapshots.slice(1)) {
      expect(snapshot).toEqual(legacySnapshots[0]);
    }
  });

  it("round-trips dynamic checkpoint and replay through the Node loader while disable and re-enable stay isolated", async () => {
    const jsonRoundTrip = (value) => JSON.parse(JSON.stringify(value));
    const activeProject = navigationRuntimeProject();
    const active = await loadContentRegistry(activeProject);
    const activeGame = new active.engine.TowerDefenseGame({ missionId: "navigation", content: active.content });
    expect(activeGame.startNextWave()).toEqual({ ok: true });
    activeGame.tick(0);
    activeGame.tick(0.125);

    const checkpoint = jsonRoundTrip(activeGame.createCheckpoint());
    expect(checkpoint.schemaVersion).toBe(1);
    expect(checkpoint.engineVersion).toBe("towerforge-sim-v2");
    expect(Object.prototype.hasOwnProperty.call(checkpoint.state, "navigation")).toBe(false);
    expect(checkpoint.state.enemies[0].navigation).toEqual(activeGame.getSnapshot().enemies[0].navigation);
    const restored = active.engine.TowerDefenseGame.fromCheckpoint({ content: active.content, checkpoint });
    expect(restored.getSnapshot()).toEqual(activeGame.getSnapshot());
    expect(restored.getStateDigest()).toBe(activeGame.getStateDigest());

    const activeSession = new active.engine.JournaledGameSession(activeGame);
    expect(activeSession.dispatch({ schemaVersion: 1, type: "tick", units: 0.2 })).toEqual({ ok: true });
    const journal = jsonRoundTrip(activeSession.exportJournal());
    expect(journal.schemaVersion).toBe(1);
    expect(journal.engineVersion).toBe("towerforge-sim-v2");
    expect(journal.entries[0].command.schemaVersion).toBe(1);
    expect(journal.initialCheckpoint.state.enemies[0].navigation).toBeDefined();
    const replayed = active.engine.replayGameCommandJournal({ content: active.content, journal });
    expect(replayed.game.getSnapshot()).toEqual(activeGame.getSnapshot());
    expect(replayed.stateDigest).toBe(activeGame.getStateDigest());

    for (const [label, options] of [
      ["absent", { catalog: false, selected: false }],
      ["disabled", { enabled: false }],
      ["unselected", { selected: false }],
      ["authored_routes", { mode: "authored_routes" }]
    ]) {
      const loaded = await loadContentRegistry(navigationRuntimeProject(options));
      const legacyGame = new loaded.engine.TowerDefenseGame({ missionId: "navigation", content: loaded.content });
      expect(legacyGame.startNextWave(), label).toEqual({ ok: true });
      legacyGame.tick(0);
      legacyGame.tick(0.125);
      const legacyCheckpoint = jsonRoundTrip(legacyGame.createCheckpoint());
      expect(Object.prototype.hasOwnProperty.call(legacyCheckpoint.state, "navigation"), label).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(legacyCheckpoint.state.enemies[0], "navigation"), label).toBe(false);
      const legacyRestored = loaded.engine.TowerDefenseGame.fromCheckpoint({
        content: loaded.content,
        checkpoint: legacyCheckpoint
      });
      expect(legacyRestored.getSnapshot(), label).toEqual(legacyGame.getSnapshot());

      const legacySession = new loaded.engine.JournaledGameSession(legacyGame);
      expect(legacySession.dispatch({ schemaVersion: 1, type: "tick", units: 0.2 }), label).toEqual({ ok: true });
      const legacyJournal = jsonRoundTrip(legacySession.exportJournal());
      const legacyReplay = loaded.engine.replayGameCommandJournal({ content: loaded.content, journal: legacyJournal });
      expect(legacyReplay.game.getSnapshot(), label).toEqual(legacyGame.getSnapshot());
      expect(Object.prototype.hasOwnProperty.call(legacyReplay.game.getSnapshot(), "navigation"), label).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(legacyReplay.game.getSnapshot().enemies[0], "navigation"), label).toBe(false);
    }

    const mechanicsPath = path.join(activeProject, "content", "mechanics.json");
    const authored = JSON.parse(fs.readFileSync(mechanicsPath, "utf8"));
    authored.modules.navigation.enabled = false;
    fs.writeFileSync(mechanicsPath, `${JSON.stringify(authored, null, 2)}\n`, "utf8");
    const disabledReload = await loadContentRegistry(activeProject);
    expect(disabledReload.content.missions.navigation.capabilities.navigation).toMatchObject({ active: false });
    const disabledGame = new disabledReload.engine.TowerDefenseGame({ missionId: "navigation", content: disabledReload.content });
    expect(disabledGame.startNextWave()).toEqual({ ok: true });
    disabledGame.tick(0);
    expect(Object.prototype.hasOwnProperty.call(disabledGame.getSnapshot(), "navigation")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(disabledGame.getSnapshot().enemies[0], "navigation")).toBe(false);

    authored.modules.navigation.enabled = true;
    fs.writeFileSync(mechanicsPath, `${JSON.stringify(authored, null, 2)}\n`, "utf8");
    const reenabledReload = await loadContentRegistry(activeProject);
    expect(reenabledReload.content.missions.navigation.capabilities.navigation).toMatchObject({
      active: true,
      profileId: "maze",
      reason: "active"
    });
    const reenabledGame = new reenabledReload.engine.TowerDefenseGame({ missionId: "navigation", content: reenabledReload.content });
    expect(reenabledGame.startNextWave()).toEqual({ ok: true });
    reenabledGame.tick(0);
    expect(reenabledGame.getSnapshot().enemies[0].navigation).toBeDefined();
    expect(reenabledGame.getSnapshot().navigation).toBeDefined();
  });
});
