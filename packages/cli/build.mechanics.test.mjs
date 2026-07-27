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

function inlineJavaScriptModules(html) {
  return [...html.matchAll(/data:text\/javascript;base64,([A-Za-z0-9+/=]+)/g)]
    .map((match) => Buffer.from(match[1], "base64").toString("utf8"));
}

afterEach(() => {
  for (const projectDir of tempProjects.splice(0)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

describe("generated player mechanics contract", () => {
  it("preserves opt-in combat, reactions, elevation, and physics through Canvas/Phaser, both grids, single-file, web, and tdpack outputs", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-build-mechanics-"));
    tempProjects.push(projectDir);
    fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });

    const manifestPath = path.join(projectDir, "project.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.schemaVersion = 3;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const balancePath = path.join(projectDir, "content", "balance.json");
    const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
    const missionSelection = JSON.parse(fs.readFileSync(
      path.join(repoRoot, "docs", "examples", "opt-in-elemental-armor-matrix", "mission-selection.json"),
      "utf8"
    ));
    missionSelection.mechanics.profiles.reactions = "elemental_shatter";
    missionSelection.mechanics.profiles.elevation = "basic_elevation_line_of_sight";
    missionSelection.mechanics.profiles.physics = "basic_displacement_physics";
    balance.terrainTypes = {
      ...(balance.terrainTypes ?? {}),
      blocked: {
        label: "Blocked",
        buildable: false,
        walkable: false,
        groundSpeedMultiplier: 1,
        tags: ["opaque"]
      }
    };
    balance.missions.tutorial_01.mechanics = missionSelection.mechanics;
    balance.towers.physics_puller = {
      id: "physics_puller",
      label: "Physics Puller",
      cost: { coins: 1 },
      footprintRadius: 0,
      range: 10,
      attack: {
        kind: "pipeline",
        interval: 1,
        targeting: { classes: ["ground"], mode: "first", maxTargets: 1 },
        delivery: { kind: "single" },
        effects: [{ kind: "displacement", mode: "pull", distance: 1, stopAtBlocker: true }],
        upgradeCosts: []
      }
    };
    balance.abilities.gravity_pull = {
      id: "gravity_pull",
      label: "Gravity Pull",
      cooldown: 0,
      duration: 0.1,
      radius: 10,
      effects: [{ kind: "displacement", mode: "pull", distance: 1, stopAtBlocker: true }]
    };
    balance.missions.tutorial_01.buildTowerIds = [
      ...balance.missions.tutorial_01.buildTowerIds,
      "physics_puller"
    ];
    balance.missions.tutorial_01.abilityIds = [
      ...balance.missions.tutorial_01.abilityIds,
      "gravity_pull"
    ];
    balance.missions.tutorial_square = {
      ...balance.missions.tutorial_01,
      id: "tutorial_square",
      label: "Tutorial Square",
      mapId: "tutorial_square_map",
      mechanics: missionSelection.mechanics
    };
    fs.writeFileSync(balancePath, `${JSON.stringify(balance, null, 2)}\n`, "utf8");

    const mechanics = JSON.parse(fs.readFileSync(
      path.join(repoRoot, "docs", "examples", "opt-in-elemental-armor-matrix", "mechanics.json"),
      "utf8"
    ));
    mechanics.modules.combat.schemaVersion = 3;
    mechanics.modules.combat.profiles.basic_elemental_armor_matrix.marks = {
      definitions: {
        exposed: {
          label: "Exposed",
          duration: 3,
          maxStacks: 3,
          multiplier: 1.25,
          consumePolicy: "consume_one"
        }
      },
      bindings: {
        towers: {
          arrow_tower: [{ markId: "exposed", stacks: 1 }]
        }
      }
    };
    mechanics.modules.reactions = {
      schemaVersion: 1,
      enabled: true,
      profiles: {
        elemental_shatter: {
          exposures: {
            definitions: {
              fire: { label: "Fire", duration: 4, maxStacks: 1 },
              ice: { label: "Ice", duration: 4, maxStacks: 1 }
            },
            applications: {
              damageTypes: {
                fire: [{ exposureId: "fire", stacks: 1 }],
                ice: [{ exposureId: "ice", stacks: 1 }]
              }
            }
          },
          reactions: {
            shatter_fire_into_ice: {
              label: "Shatter",
              trigger: { damageTypes: ["fire"] },
              requirements: [{ kind: "exposure", exposureId: "ice", consume: "all" }],
              suppressTriggerExposureApplications: true,
              effects: {
                critical: {
                  kind: "damage",
                  amount: { kind: "source_after_modifiers", multiplier: 2 },
                  damageType: "physical",
                  target: { kind: "primary" },
                  allowReactions: false
                }
              }
            },
            shatter_ice_into_fire: {
              label: "Shatter",
              trigger: { damageTypes: ["ice"] },
              requirements: [{ kind: "exposure", exposureId: "fire", consume: "all" }],
              suppressTriggerExposureApplications: true,
              effects: {
                critical: {
                  kind: "damage",
                  amount: { kind: "source_after_modifiers", multiplier: 2 },
                  damageType: "physical",
                  target: { kind: "primary" },
                  allowReactions: false
                }
              }
            }
          }
        }
      }
    };
    mechanics.modules.elevation = {
      schemaVersion: 3,
      enabled: true,
      profiles: {
        basic_elevation_line_of_sight: {
          lineOfSight: { terrainBlockerTags: ["opaque"] },
          highGround: {
            maximumEffectiveElevationDelta: 3,
            rangeBonusPerElevation: 1,
            damageBonusBasisPointsPerElevation: 1_000
          }
        }
      }
    };
    mechanics.modules.physics = {
      schemaVersion: 1,
      enabled: true,
      profiles: {
        basic_displacement_physics: {}
      }
    };
    fs.writeFileSync(
      path.join(projectDir, "content", "mechanics.json"),
      `${JSON.stringify(mechanics, null, 2)}\n`,
      "utf8"
    );

    const mapsPath = path.join(projectDir, "maps", "compiled", "maps.json");
    const maps = JSON.parse(fs.readFileSync(mapsPath, "utf8"));
    maps.tutorial_map.elevationOverrides = [
      { q: 1, r: 0, elevation: 2 },
      { q: 5, r: 1, elevation: 3 }
    ];
    maps.tutorial_square_map = {
      ...maps.tutorial_map,
      id: "tutorial_square_map",
      grid: { kind: "square" }
    };
    fs.writeFileSync(mapsPath, `${JSON.stringify(maps, null, 2)}\n`, "utf8");
    const sourceMapPath = path.join(projectDir, "maps", "src", "tutorial_map.tmj");
    const sourceMap = JSON.parse(fs.readFileSync(sourceMapPath, "utf8"));
    sourceMap.elevationOverrides = [
      { q: 1, r: 0, elevation: 2 },
      { q: 5, r: 1, elevation: 3 }
    ];
    fs.writeFileSync(sourceMapPath, `${JSON.stringify(sourceMap, null, 2)}\n`, "utf8");

    const worldMapPath = path.join(projectDir, "content", "world-map.json");
    const worldMap = JSON.parse(fs.readFileSync(worldMapPath, "utf8"));
    worldMap.missionNodes.push({
      ...worldMap.missionNodes[0],
      missionId: "tutorial_square",
      x: worldMap.missionNodes[0].x + 60
    });
    fs.writeFileSync(worldMapPath, `${JSON.stringify(worldMap, null, 2)}\n`, "utf8");

    const buildTargetsPath = path.join(projectDir, "build-targets.json");
    const buildTargets = JSON.parse(fs.readFileSync(buildTargetsPath, "utf8"));
    for (const renderer of ["canvas", "phaser"]) {
      buildTargets.targets[`mechanics-${renderer}`] = {
        ...buildTargets.targets["web-pwa"],
        id: `mechanics-${renderer}`,
        renderer,
        webDir: `dist-mechanics-${renderer}`
      };
    }
    fs.writeFileSync(buildTargetsPath, `${JSON.stringify(buildTargets, null, 2)}\n`, "utf8");

    for (const renderer of ["canvas", "phaser"]) {
      const output = execFileSync(process.execPath, [
        path.join(repoRoot, "packages", "cli", "build.mjs"),
        "--project", projectDir,
        "--target", `mechanics-${renderer}`,
        "--single-file",
        "--json"
      ], {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
      });
      const result = JSON.parse(output);
      expect(result).toMatchObject({ ok: true, targetId: `mechanics-${renderer}` });
      expect(fs.existsSync(path.join(result.outDir, "offline-sw.js"))).toBe(true);
      expect(fs.existsSync(path.join(result.outDir, "manifest.webmanifest"))).toBe(true);

      const projectDataPath = path.join(result.outDir, "project-data.js");
      const projectData = (await import(`${pathToFileURL(projectDataPath).href}?test=${renderer}-${Date.now()}`)).default;
      expect(projectData.mechanics).toEqual(mechanics);
      for (const [missionId, gridKind] of [["tutorial_01", "hex"], ["tutorial_square", "square"]]) {
        expect(projectData.balance.missions[missionId].mechanics).toEqual(missionSelection.mechanics);
        expect(projectData.balance.missions[missionId].buildTowerIds).toContain("physics_puller");
        expect(projectData.balance.missions[missionId].abilityIds).toContain("gravity_pull");
        const mapId = projectData.balance.missions[missionId].mapId;
        expect(projectData.maps[mapId].grid.kind).toBe(gridKind);
      }
      expect(projectData.balance.towers.physics_puller.attack.effects).toEqual([
        { kind: "displacement", mode: "pull", distance: 1, stopAtBlocker: true }
      ]);
      expect(projectData.balance.abilities.gravity_pull.effects).toEqual([
        { kind: "displacement", mode: "pull", distance: 1, stopAtBlocker: true }
      ]);

      const bundledEngine = await import(
        `${pathToFileURL(path.join(result.outDir, "engine", "index.js")).href}?engine=${renderer}-${Date.now()}`
      );
      expect(bundledEngine.COMBAT_MECHANICS_SCHEMA).toMatchObject({
        schemaVersion: 3,
        supportedModuleSchemaVersions: [1, 2, 3],
        profile: { optionalFields: ["shields", "damageTypes", "armorTypes", "armorAssignments", "marks"] }
      });
      expect(bundledEngine.REACTION_LIMITS).toMatchObject({
        exposureDefinitions: 256,
        reactionDefinitions: 256,
        runtimeExposureApplications: 16384,
        targetsPerEffect: 64,
        maxDepth: 4,
        secondaryPacketsPerRoot: 256
      });
      expect(bundledEngine.REACTIONS_MECHANICS_SCHEMA).toMatchObject({
        moduleId: "reactions",
        schemaVersion: 1,
        supportedModuleSchemaVersions: [1],
        limits: bundledEngine.REACTION_LIMITS
      });
      expect(bundledEngine.ELEVATION_MECHANICS_SCHEMA).toMatchObject({
        moduleId: "elevation",
        schemaVersion: 3,
        supportedModuleSchemaVersions: [1, 2, 3],
        runtimeSnapshot: { schemaVersion: 1 }
      });
      expect(bundledEngine.PHYSICS_LIMITS).toEqual({
        displacementDistance: 8,
        immuneEnemyTypeIds: 4_096,
        fallHazardTerrainTags: 64,
        idOrTagUtf8Bytes: 128,
        stepsPerEffectApplication: 8,
        displacementEffectsPerSource: 8,
        displacementTargetsPerActivation: 64,
        stepAttemptsPerActivation: 4_096,
        stepAttemptsPerTick: 32_768
      });
      expect(bundledEngine.PHYSICS_MECHANICS_SCHEMA).toMatchObject({
        moduleId: "physics",
        schemaVersion: 1,
        supportedModuleSchemaVersions: [1],
        limits: bundledEngine.PHYSICS_LIMITS,
        runtimeSnapshot: null
      });
      expect(bundledEngine.DAMAGE_PACKET_SCHEMA.pipelineOrder).toContain("armor_matrix");
      expect(bundledEngine.DAMAGE_PACKET_SCHEMA.pipelineOrder).toEqual(expect.arrayContaining([
        "shield", "entity_hp", "reactions"
      ]));
      const bundledContent = bundledEngine.createGameContentRegistry(projectData);
      expect(bundledEngine.validateGameContentRegistry(bundledContent)).toMatchObject({ ok: true, issues: [] });
      for (const [missionId, gridKind] of [["tutorial_01", "hex"], ["tutorial_square", "square"]]) {
        const game = new bundledEngine.TowerDefenseGame({
          missionId,
          content: bundledContent,
          seed: `armor-build-${renderer}-${gridKind}`
        });
        expect(game.startNextWave().ok).toBe(true);
        game.tick(0.01);
        expect(game.getSnapshot().grid.kind).toBe(gridKind);
        expect(game.getSnapshot().reactions).toBeUndefined();
        expect(game.getSnapshot().elevation).toMatchObject({
          schemaVersion: 1,
          overrides: [
            { q: 1, r: 0, elevation: 2 },
            { q: 5, r: 1, elevation: 3 }
          ]
        });
        expect(game.getSnapshot()).not.toHaveProperty("highGround");
        expect(game.analyzeLineOfSight({
          source: { q: 0, r: 0 },
          targets: [{ q: 2, r: 0 }]
        })).toMatchObject({
          schemaVersion: 1,
          profileId: "basic_elevation_line_of_sight",
          rows: [{ visible: false, reason: "elevation" }]
        });

        // Pin geometry to the base topology's real stable neighbor order. Odd-r hex needs the
        // source southeast of spawn so NW/NE/W/E/SW are not closer; square cardinal needs the
        // source southwest so N/E are not closer. In both cases the first strictly closer
        // neighbor is the unique adjacent authored-route tile (7,1), leaving no slide fallback.
        const pipelineSourceCoord = gridKind === "hex" ? { q: 8, r: 2 } : { q: 6, r: 3 };
        const pipelineFrom = { q: 7, r: 0 };
        const runtimeMapId = projectData.balance.missions[missionId].mapId;
        const topology = bundledEngine.createGridTopology(projectData.maps[runtimeMapId].grid);
        const firstStrictPullNeighbor = topology.neighbors(pipelineFrom).find((candidate) => (
          topology.distance(candidate, pipelineSourceCoord) < topology.distance(pipelineFrom, pipelineSourceCoord)
        ));
        expect(firstStrictPullNeighbor).toEqual({ q: 7, r: 1 });
        const pipelineGame = new bundledEngine.TowerDefenseGame({
          missionId,
          content: bundledContent,
          seed: `physics-pipeline-${renderer}-${gridKind}`
        });
        expect(pipelineGame.placeTower("physics_puller", pipelineSourceCoord).ok).toBe(true);
        expect(pipelineGame.startNextWave().ok).toBe(true);
        pipelineGame.tick(0.01);
        expect(pipelineGame.getSnapshot().lastEvents).toContainEqual(expect.objectContaining({
          type: "enemyDisplacementResolved",
          sourceKind: "tower",
          sourceId: expect.any(String),
          sourceCoord: pipelineSourceCoord,
          mode: "pull",
          requestedDistance: 1,
          movedDistance: 1,
          from: { q: 7, r: 0 },
          to: { q: 7, r: 1 },
          stopReason: "completed"
        }));
        expect(pipelineGame.getSnapshot()).not.toHaveProperty("physics");

        const abilityGame = new bundledEngine.TowerDefenseGame({
          missionId,
          content: bundledContent,
          seed: `physics-ability-${renderer}-${gridKind}`
        });
        expect(abilityGame.startNextWave().ok).toBe(true);
        for (let step = 0; step < 5; step += 1) abilityGame.tick(0.2);
        expect(abilityGame.useAbility("gravity_pull", { q: 7, r: 0 }).ok).toBe(true);
        expect(abilityGame.getSnapshot().lastEvents).toContainEqual(expect.objectContaining({
          type: "enemyDisplacementResolved",
          sourceKind: "ability",
          sourceId: "gravity_pull",
          sourceCoord: { q: 7, r: 0 },
          mode: "pull",
          requestedDistance: 1,
          movedDistance: 1,
          from: { q: 7, r: 1 },
          to: { q: 7, r: 0 },
          stopReason: "completed"
        }));

        const legacyData = structuredClone(projectData);
        delete legacyData.mechanics.modules.elevation.profiles.basic_elevation_line_of_sight.highGround;
        const legacyContent = bundledEngine.createGameContentRegistry(legacyData);
        const legacyGame = new bundledEngine.TowerDefenseGame({
          missionId,
          content: legacyContent,
          seed: `high-ground-build-${renderer}-${gridKind}`
        });
        const highGroundGame = new bundledEngine.TowerDefenseGame({
          missionId,
          content: bundledContent,
          seed: `high-ground-build-${renderer}-${gridKind}`
        });
        for (const subject of [legacyGame, highGroundGame]) {
          expect(subject.placeTower("arrow_tower", { q: 5, r: 1 }).ok).toBe(true);
          expect(subject.startNextWave().ok).toBe(true);
          subject.tick(0.01);
        }
        expect(highGroundGame.enemies[0].hp).toBeLessThan(legacyGame.enemies[0].hp);
      }

      const singleFile = fs.readFileSync(path.join(result.outDir, "index.single.html"), "utf8");
      const embeddedProject = inlineJavaScriptModules(singleFile).find((source) =>
        source.startsWith("export default ") && source.includes('"mechanics"')
      );
      expect(embeddedProject, `${renderer} single-file must embed project mechanics`).toBeTruthy();
      expect(embeddedProject?.includes('"mechanics":{"schemaVersion":1')).toBe(true);
      expect(embeddedProject?.includes('"combat":"basic_elemental_armor_matrix"')).toBe(true);
      expect(embeddedProject?.includes('"reactions":"elemental_shatter"')).toBe(true);
      expect(embeddedProject?.includes('"elevation":"basic_elevation_line_of_sight"')).toBe(true);
      expect(embeddedProject?.includes('"physics":"basic_displacement_physics"')).toBe(true);
      expect(embeddedProject?.includes('"kind":"displacement","mode":"pull","distance":1,"stopAtBlocker":true')).toBe(true);

      const rendererSources = fs.readdirSync(path.join(result.outDir, "renderer"))
        .filter((fileName) => /\.(?:mjs|js)$/.test(fileName))
        .map((fileName) => fs.readFileSync(path.join(result.outDir, "renderer", fileName), "utf8"))
        .join("\n");
      expect(rendererSources).not.toMatch(/\b(?:armorTypes|armorAssignments|armor_matrix)\b/);
      expect(rendererSources).toMatch(/resolveExposurePresentation|projectReactionPresentationCues/);
      expect(rendererSources).not.toMatch(/suppressTriggerExposureApplications|source_after_modifiers/);
      expect(rendererSources).toMatch(/projectLineOfSightAnalysis/);
      expect(rendererSources).toMatch(/projectPhysicsPresentationCues/);
      expect(rendererSources).not.toMatch(/terrainBlockerTags|traceLineOfSight|maximumRayDistance/);
      expect(rendererSources).not.toMatch(/highGround|maximumEffectiveElevationDelta|rangeBonusPerElevation|damageBonusBasisPointsPerElevation/);
      expect(rendererSources).not.toMatch(
        /planTileDisplacement|fallHazardTerrainTags|displacementImmuneEnemyTypeIds|fallImmuneEnemyTypeIds|stepAttemptsPer(?:Activation|Tick)/
      );
      const playerSource = fs.readFileSync(path.join(result.outDir, "player.mjs"), "utf8");
      execFileSync(process.execPath, ["--check", path.join(result.outDir, "player.mjs")], {
        cwd: repoRoot,
        stdio: "pipe"
      });
      expect(playerSource).not.toMatch(/\b(?:armorTypes|armorAssignments|armor_matrix)\b/);
      expect(playerSource).not.toMatch(/suppressTriggerExposureApplications|source_after_modifiers/);
      expect(playerSource).not.toMatch(/(?:snap|presentationSnapshot)\.?reactions\??\.exposures/);
      expect(playerSource).not.toMatch(/terrainBlockerTags|traceLineOfSight|maximumRayDistance/);
      expect(playerSource).not.toMatch(/highGround|maximumEffectiveElevationDelta|rangeBonusPerElevation|damageBonusBasisPointsPerElevation/);
      expect(playerSource).toMatch(/projectPhysicsPresentationCues\((?:snap|presentationSnapshot)\)/);
      expect(playerSource).not.toMatch(
        /planTileDisplacement|fallHazardTerrainTags|displacementImmuneEnemyTypeIds|fallImmuneEnemyTypeIds|stepAttemptsPer(?:Activation|Tick)/
      );
    }

    const phaserPlayer = fs.readFileSync(path.join(projectDir, "dist-mechanics-phaser", "player.mjs"), "utf8");
    expect(phaserPlayer).toMatch(
      /import\s*\{[^}]*resolveShieldPresentation[^}]*\}\s*from\s*["']\.\/renderer\/index\.mjs["']/s
    );
    expect(phaserPlayer).toMatch(
      /import\s*\{[^}]*projectLegacyPresentationEvents[^}]*\}\s*from\s*["']\.\/renderer\/index\.mjs["']/s
    );
    expect(phaserPlayer).toMatch(/projectLegacyPresentationEvents\(presentationSnapshot\)/);
    expect(phaserPlayer).not.toMatch(/for\s*\(const ev of events\)/);
    expect(phaserPlayer).not.toMatch(/\bevents\.find\([^)]*towerPlaced/);
    expect(phaserPlayer).toMatch(/resolveShieldPresentation\(snap,\s*["']tower["'],\s*tw\.id\)/);
    expect(phaserPlayer).toMatch(/resolveShieldPresentation\(snap,\s*["']enemy["'],\s*en\.id\)/);
    expect(phaserPlayer).toMatch(
      /import\s*\{[^}]*projectMarkPresentationCues[^}]*resolveMarkPresentation[^}]*\}\s*from\s*["']\.\/renderer\/index\.mjs["']/s
    );
    expect(phaserPlayer).toMatch(/projectMarkPresentationCues\(presentationSnapshot\)/);
    expect(phaserPlayer).toMatch(/resolveMarkPresentation\(snap,\s*en\.id\)/);
    expect(phaserPlayer).not.toMatch(/\b(?:consumePolicy|damageTypes|multiplier|maxStacks)\b/);
    expect(phaserPlayer).not.toMatch(/(?:snap|presentationSnapshot)\.?combat\??\.marks/);
    expect(phaserPlayer).toMatch(
      /import\s*\{[^}]*projectReactionPresentationCues[^}]*resolveExposurePresentation[^}]*\}\s*from\s*["']\.\/renderer\/index\.mjs["']/s
    );
    expect(phaserPlayer).toMatch(/projectReactionPresentationCues\(presentationSnapshot\)/);
    expect(phaserPlayer).toMatch(
      /import\s*\{[^}]*projectPhysicsPresentationCues[^}]*\}\s*from\s*["']\.\/renderer\/index\.mjs["']/s
    );
    expect(phaserPlayer).toMatch(/projectPhysicsPresentationCues\(presentationSnapshot\)/);
    expect(phaserPlayer).toMatch(/resolveExposurePresentation\(snap,\s*en\.id\)/);
    expect(phaserPlayer).not.toMatch(/(?:snap|presentationSnapshot)\.?reactions\??\.exposures/);
    expect(phaserPlayer).toMatch(/this\.(?:prev|previous|last)\w*(?:Combat|Shield)\w*/i);
    expect(phaserPlayer).toMatch(/this\.(?:prev|previous|last)\w*(?:Position|Coord)\w*/i);
    expect(phaserPlayer).toMatch(/cue\.kind\s*===\s*["']enemy["'][\s\S]{0,900}(?:snap\.)?spawnCoord/);
    expect(phaserPlayer).toMatch(
      /projectLegacyPresentationEvents\(presentationSnapshot\)[\s\S]{0,1800}towerPlaced/
    );

    const packPath = path.join(projectDir, ".towerforge", "exports", "armor-reference.tdpack");
    const exported = await exportProjectPack(projectDir, packPath);
    expect(exported.ok).toBe(true);
    const packedMechanics = inspectProjectPack(packPath).entries.find((entry) => entry.path === "content/mechanics.json");
    expect(JSON.parse(packedMechanics.bytes.toString("utf8"))).toEqual(mechanics);
    const packedBalance = inspectProjectPack(packPath).entries.find((entry) => entry.path === "content/balance.json");
    expect(JSON.parse(packedBalance.bytes.toString("utf8")).missions.tutorial_square.mechanics)
      .toEqual(missionSelection.mechanics);
    expect(JSON.parse(packedBalance.bytes.toString("utf8")).towers.physics_puller.attack.effects)
      .toEqual([{ kind: "displacement", mode: "pull", distance: 1, stopAtBlocker: true }]);
    expect(JSON.parse(packedBalance.bytes.toString("utf8")).abilities.gravity_pull.effects)
      .toEqual([{ kind: "displacement", mode: "pull", distance: 1, stopAtBlocker: true }]);
    const packedMaps = inspectProjectPack(packPath).entries.find((entry) => entry.path === "maps/compiled/maps.json");
    expect(JSON.parse(packedMaps.bytes.toString("utf8")).tutorial_square_map.grid.kind).toBe("square");
    expect(JSON.parse(packedMaps.bytes.toString("utf8")).tutorial_square_map.elevationOverrides)
      .toEqual([
        { q: 1, r: 0, elevation: 2 },
        { q: 5, r: 1, elevation: 3 }
      ]);

    const portable = await packageWeb(projectDir, {
      targetId: "mechanics-canvas",
      outDir: "web-mechanics"
    });
    expect(portable).toMatchObject({ ok: true, kind: "web", webTargetId: "mechanics-canvas" });
    expect(fs.existsSync(path.join(portable.outDir, "game", "index.single.html"))).toBe(true);
    expect(fs.existsSync(portable.archive.outputPath)).toBe(true);
    const packagedProject = await import(
      `${pathToFileURL(path.join(portable.outDir, "game", "project-data.js")).href}?package=${Date.now()}`
    );
    expect(packagedProject.default.mechanics).toEqual(mechanics);
    expect(packagedProject.default.balance.missions.tutorial_square.mechanics).toEqual(missionSelection.mechanics);
    expect(packagedProject.default.balance.towers.physics_puller.attack.effects)
      .toEqual([{ kind: "displacement", mode: "pull", distance: 1, stopAtBlocker: true }]);
    expect(packagedProject.default.balance.abilities.gravity_pull.effects)
      .toEqual([{ kind: "displacement", mode: "pull", distance: 1, stopAtBlocker: true }]);
  }, 60_000);
});
