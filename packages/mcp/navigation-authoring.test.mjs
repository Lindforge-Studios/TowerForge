import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadEngine, readRawProjectFiles } from "../cli/lib/project-loader.mjs";
import { migrateProjectFiles, writeMigratedProjectFiles } from "../cli/lib/project-migrations.mjs";
import { TOWERFORGE_AGENT_INSTRUCTIONS } from "./agent-instructions.mjs";
import { callTool, TOOLS } from "./tools.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const tempProjects = [];

afterEach(() => {
  for (const projectDir of tempProjects.splice(0)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

function copyStarter({ migrateToV2 = false } = {}) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-mcp-navigation-"));
  tempProjects.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  if (migrateToV2) {
    const migrated = migrateProjectFiles(readRawProjectFiles(projectDir));
    writeMigratedProjectFiles(projectDir, migrated.files);
    expect(JSON.parse(fs.readFileSync(path.join(projectDir, "project.json"), "utf8")).schemaVersion).toBe(2);
  }
  return projectDir;
}

function snapshotTree(rootDir) {
  const entries = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((left, right) => (
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    ))) {
      const absolutePath = path.join(dir, entry.name);
      const relativePath = path.relative(rootDir, absolutePath);
      if (entry.isDirectory()) {
        entries.push({ path: `${relativePath}/`, type: "directory" });
        visit(absolutePath);
      } else if (entry.isFile()) {
        entries.push({
          path: relativePath,
          type: "file",
          contents: fs.readFileSync(absolutePath).toString("base64")
        });
      } else {
        entries.push({ path: relativePath, type: "other" });
      }
    }
  };
  visit(rootDir);
  return entries;
}

function authoredRoutesProfile() {
  return { mode: "authored_routes" };
}

function dynamicFlowProfile() {
  return {
    mode: "dynamic_flow",
    defaultMovementProfileId: "ground",
    movementProfiles: {
      air: {
        label: "Air",
        terrainMode: "ignore_walkable",
        towerOccupancy: "ignored",
        defaultTerrainCost: 1000
      },
      ground: {
        label: "Ground",
        terrainMode: "respect_walkable",
        towerOccupancy: "blocked",
        defaultTerrainCost: 1000,
        terrainCosts: { water: 2000 }
      }
    },
    enemyMovementProfiles: { basic_grunt: "ground" }
  };
}

function expandTutorialMapBeyondImplicitAnalysisBudget(projectDir) {
  const mapsPath = path.join(projectDir, "maps", "compiled", "maps.json");
  const maps = JSON.parse(fs.readFileSync(mapsPath, "utf8"));
  const pathCenterline = Array.from({ length: 65 }, (_, r) => ({ q: 32, r }));
  maps.tutorial_map = {
    ...maps.tutorial_map,
    width: 65,
    height: 65,
    spawnCoord: { q: 32, r: 0 },
    coreCoord: { q: 32, r: 64 },
    pathCenterline,
    pathRoutes: [{ id: "main", pathCenterline }],
    terrainOverrides: pathCenterline.map((coord, index) => ({
      ...coord,
      terrain: index === 0 ? "spawn" : index === pathCenterline.length - 1 ? "core" : "path"
    }))
  };
  fs.writeFileSync(mapsPath, `${JSON.stringify(maps, null, 2)}\n`, "utf8");
}

async function applyNavigationProfile(projectDir, profileId, profile) {
  const request = {
    projectDir,
    moduleId: "navigation",
    moduleSchemaVersion: 1,
    missionId: "tutorial_01",
    profileId,
    profile,
    enabled: true
  };
  const preview = await callTool("preview_mechanics_module", request, {});
  return callTool("apply_mechanics_module", {
    ...request,
    ifRevision: preview.revision
  }, {});
}

async function captureRejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected navigation mechanics operation to reject.");
}

describe("R2.1 navigation v1 MCP authoring surface", () => {
  it("describes the engine-owned navigation descriptor and reads starter as available but inactive without writes", async () => {
    const engine = await loadEngine();
    const navigation = await callTool("describe_schema", { domain: "navigation" }, {});
    const mechanics = await callTool("describe_schema", { domain: "mechanics" }, {});

    expect(navigation).toMatchObject({
      requestedDomain: "navigation",
      navigation: {
        authoring: engine.NAVIGATION_MECHANICS_SCHEMA,
        snapshot: {
          field: "navigation",
          optional: true,
          supportedSchemaVersions: [1],
          modes: ["dynamic_flow"]
        },
        events: []
      }
    });
    expect(navigation.navigation.authoring.limits).toEqual(engine.NAVIGATION_LIMITS);
    expect(mechanics.availableDomains).toContain("navigation");
    expect(mechanics.mechanics.implementedModuleIds).toEqual(["combat", "reactions", "navigation", "elevation", "physics", "terraforming", "roguelite", "heroes", "logistics", "director", "multiplayer"]);
    expect(mechanics.mechanics.modules.navigation).toEqual(navigation.navigation);

    const projectDir = copyStarter();
    const before = snapshotTree(projectDir);
    const capabilities = await callTool("get_capabilities", {
      projectDir,
      missionId: "tutorial_01"
    }, {});
    expect(capabilities).toMatchObject({
      rawProjectSchemaVersion: 1,
      mechanicsAuthored: false,
      capabilities: {
        navigation: {
          available: true,
          moduleEnabled: false,
          active: false,
          reason: "module_missing"
        }
      },
      navigation: {
        authoring: engine.NAVIGATION_MECHANICS_SCHEMA,
        enabled: false,
        profileIds: [],
        profileUses: {}
      }
    });
    expect(capabilities.navigation).not.toHaveProperty("selectedProfileId");
    expect(snapshotTree(projectDir)).toEqual(before);
  });

  it("exposes compute-only navigation analysis through compact schema and agent discovery without writes", async () => {
    const projectDir = copyStarter({ migrateToV2: true });
    const profile = dynamicFlowProfile();
    const preview = await callTool("preview_mechanics_module", {
      projectDir,
      moduleId: "navigation",
      moduleSchemaVersion: 1,
      missionId: "tutorial_01",
      profileId: "maze",
      profile,
      enabled: true
    }, {});
    await callTool("apply_mechanics_module", {
      projectDir,
      moduleId: "navigation",
      moduleSchemaVersion: 1,
      missionId: "tutorial_01",
      profileId: "maze",
      profile,
      enabled: true,
      ifRevision: preview.revision
    }, {});
    const before = snapshotTree(projectDir);
    const tool = TOOLS.find((candidate) => candidate.name === "analyze_navigation");
    expect(tool).toMatchObject({
      riskClass: "compute_only",
      sideEffect: "builds engine dist if stale; writes no project files",
      inputSchema: {
        properties: {
          projectDir: expect.any(Object),
          missionId: expect.any(Object),
          towerTypeId: expect.any(Object),
          compact: { type: "boolean" }
        },
        additionalProperties: false
      }
    });
    const schema = await callTool("describe_schema", { domain: "navigation" }, {});
    expect(schema.navigation.analysis).toMatchObject({
      tool: "analyze_navigation",
      readOnly: true,
      modes: ["dynamic_flow"]
    });
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /get_capabilities[\s\S]*analyze_navigation[\s\S]*(?:preview_mechanics_module|validate_project)/i
    );

    const analysis = await callTool("analyze_navigation", {
      projectDir,
      missionId: "tutorial_01",
      towerTypeId: "arrow_tower",
      compact: true
    }, {});
    expect(analysis).toMatchObject({
      active: true,
      mode: "dynamic_flow",
      missionId: "tutorial_01",
      mapId: "tutorial_map",
      profileId: "maze",
      fields: expect.arrayContaining([expect.objectContaining({
        routeId: expect.any(String),
        movementProfileId: "ground",
        reachable: expect.any(Boolean),
        goal: expect.objectContaining({ q: expect.any(Number), r: expect.any(Number) })
      })]),
      placementRows: expect.arrayContaining([expect.objectContaining({
        coord: expect.objectContaining({ q: expect.any(Number), r: expect.any(Number) }),
        ok: expect.any(Boolean)
      })])
    });
    expect(analysis.fields.every((field) => !Object.hasOwn(field, "cells"))).toBe(true);
    expect(snapshotTree(projectDir)).toEqual(before);
  });

  it.each([
    ["absent", "module_missing"],
    ["authored_routes", "authored_routes"]
  ])("does not expand implicit placement coordinates for %s navigation on a valid 65x65 map", async (state, reason) => {
    const projectDir = copyStarter({ migrateToV2: state === "authored_routes" });
    expandTutorialMapBeyondImplicitAnalysisBudget(projectDir);
    if (state === "authored_routes") {
      await applyNavigationProfile(projectDir, "authored", authoredRoutesProfile());
    }
    const before = snapshotTree(projectDir);

    const result = await callTool("analyze_navigation", {
      projectDir,
      missionId: "tutorial_01",
      towerTypeId: "arrow_tower",
      compact: true
    }, {});

    expect(result).toEqual({ active: false, analysis: null, reason });
    expect(snapshotTree(projectDir)).toEqual(before);
  });

  it("requires an explicit <=4096 coordinate subset for active dynamic_flow on a valid 65x65 map", async () => {
    const projectDir = copyStarter({ migrateToV2: true });
    expandTutorialMapBeyondImplicitAnalysisBudget(projectDir);
    await applyNavigationProfile(projectDir, "maze", dynamicFlowProfile());
    const before = snapshotTree(projectDir);

    const error = await captureRejection(callTool("analyze_navigation", {
      projectDir,
      missionId: "tutorial_01",
      towerTypeId: "arrow_tower",
      compact: true
    }, {}));

    expect(error.message).toMatch(/explicit coordinates subset[\s\S]*4096/i);
    expect(snapshotTree(projectDir)).toEqual(before);
  });

  it.each([
    ["absent", () => copyStarter()],
    ["disabled", () => {
      const projectDir = copyStarter({ migrateToV2: true });
      return { projectDir, enabled: false, profile: dynamicFlowProfile() };
    }],
    ["authored_routes", () => {
      const projectDir = copyStarter({ migrateToV2: true });
      return { projectDir, enabled: true, profile: authoredRoutesProfile() };
    }]
  ])("returns explicit inactive analysis for %s navigation without project writes", async (_label, arrange) => {
    const arranged = arrange();
    const projectDir = typeof arranged === "string" ? arranged : arranged.projectDir;
    if (typeof arranged !== "string") {
      const applyState = async (enabled) => {
        const preview = await callTool("preview_mechanics_module", {
          projectDir,
          moduleId: "navigation",
          moduleSchemaVersion: 1,
          missionId: "tutorial_01",
          profileId: "mode",
          profile: arranged.profile,
          enabled
        }, {});
        await callTool("apply_mechanics_module", {
          projectDir,
          moduleId: "navigation",
          moduleSchemaVersion: 1,
          missionId: "tutorial_01",
          profileId: "mode",
          profile: arranged.profile,
          enabled,
          ifRevision: preview.revision
        }, {});
      };
      if (!arranged.enabled) {
        await applyState(true);
      }
      await applyState(arranged.enabled);
    }
    const before = snapshotTree(projectDir);
    const result = await callTool("analyze_navigation", {
      projectDir,
      missionId: "tutorial_01",
      compact: true
    }, {});
    expect(result).toMatchObject({ active: false, analysis: null, reason: expect.any(String) });
    expect(result.routes ?? []).toHaveLength(0);
    expect(snapshotTree(projectDir)).toEqual(before);
  });

  it("previews and guardedly applies exact authored_routes and dynamic_flow profiles through project v3", async () => {
    const projectDir = copyStarter({ migrateToV2: true });
    const before = snapshotTree(projectDir);
    const authoredProfile = authoredRoutesProfile();
    const authoredRequest = {
      projectDir,
      moduleId: "navigation",
      moduleSchemaVersion: 1,
      missionId: "tutorial_01",
      profileId: "authored",
      profile: authoredProfile,
      enabled: true
    };

    const authoredPreview = await callTool("preview_mechanics_module", authoredRequest, {});
    expect(authoredPreview).toMatchObject({
      ok: true,
      dryRun: true,
      written: false,
      migration: { required: true, from: 2, to: 3 },
      validation: { ok: true, issues: [] }
    });
    expect(authoredPreview.candidate.mechanics.modules.navigation).toEqual({
      schemaVersion: 1,
      enabled: true,
      profiles: { authored: authoredProfile }
    });
    expect(authoredPreview.candidate.balance.missions.tutorial_01.mechanics.profiles.navigation)
      .toBe("authored");
    expect(snapshotTree(projectDir)).toEqual(before);

    const authoredApplied = await callTool("apply_mechanics_module", {
      ...authoredRequest,
      ifRevision: authoredPreview.revision
    }, {});
    expect(authoredApplied).toMatchObject({
      ok: true,
      written: true,
      previousRevision: authoredPreview.revision
    });
    expect(authoredApplied).toMatchObject({ backup: { directory: expect.any(String) } });
    expect(JSON.parse(fs.readFileSync(path.join(projectDir, "project.json"), "utf8")).schemaVersion).toBe(3);

    const dynamicProfile = dynamicFlowProfile();
    const dynamicRequest = {
      projectDir,
      moduleId: "navigation",
      moduleSchemaVersion: 1,
      missionId: "tutorial_01",
      profileId: "maze",
      profile: dynamicProfile,
      enabled: true
    };
    const dynamicPreview = await callTool("preview_mechanics_module", dynamicRequest, {});
    expect(dynamicPreview).toMatchObject({ ok: true, validation: { ok: true, issues: [] } });
    expect(dynamicPreview.candidate.mechanics.modules.navigation.profiles).toEqual({
      authored: authoredProfile,
      maze: dynamicProfile
    });

    const dynamicApplied = await callTool("apply_mechanics_module", {
      ...dynamicRequest,
      ifRevision: dynamicPreview.revision
    }, {});
    expect(dynamicApplied).toMatchObject({
      ok: true,
      written: true,
      previousRevision: dynamicPreview.revision
    });
    const capabilities = await callTool("get_capabilities", {
      projectDir,
      missionId: "tutorial_01"
    }, {});
    expect(capabilities).toMatchObject({
      navigation: {
        enabled: true,
        moduleSchemaVersion: 1,
        selectedProfileId: "maze",
        selectedProfile: dynamicProfile,
        profileIds: ["authored", "maze"]
      },
      capabilities: { navigation: { available: true, active: true, reason: "active" } }
    });
    expect(await callTool("validate_project", { projectDir }, {}))
      .toMatchObject({ ok: true, issues: [] });

    const disablePreview = await callTool("preview_mechanics_module", {
      projectDir,
      moduleId: "navigation",
      missionId: "tutorial_01",
      enabled: false
    }, {});
    const disabled = await callTool("apply_mechanics_module", {
      projectDir,
      moduleId: "navigation",
      missionId: "tutorial_01",
      enabled: false,
      ifRevision: disablePreview.revision
    }, {});
    expect(disabled).toMatchObject({ ok: true, written: true });
    expect(JSON.parse(fs.readFileSync(path.join(projectDir, "content", "mechanics.json"), "utf8")))
      .toMatchObject({ modules: { navigation: { enabled: false, profiles: { maze: dynamicProfile } } } });
    expect(await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {}))
      .toMatchObject({
        navigation: { selectedProfileId: "maze", selectedProfile: dynamicProfile },
        capabilities: { navigation: { active: false, reason: "module_disabled" } }
      });

    const reenablePreview = await callTool("preview_mechanics_module", {
      projectDir,
      moduleId: "navigation",
      missionId: "tutorial_01",
      enabled: true
    }, {});
    const reenabled = await callTool("apply_mechanics_module", {
      projectDir,
      moduleId: "navigation",
      missionId: "tutorial_01",
      enabled: true,
      ifRevision: reenablePreview.revision
    }, {});
    expect(reenabled).toMatchObject({ ok: true, written: true });
    expect(await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {}))
      .toMatchObject({
        navigation: { enabled: true, selectedProfileId: "maze", selectedProfile: dynamicProfile },
        capabilities: { navigation: { active: true, reason: "active" } }
      });
    expect(await callTool("validate_project", { projectDir }, {}))
      .toMatchObject({ ok: true, issues: [] });
  });

  it("rejects stale revision without overwriting the concurrent edit", async () => {
    const projectDir = copyStarter({ migrateToV2: true });
    const request = {
      projectDir,
      moduleId: "navigation",
      moduleSchemaVersion: 1,
      missionId: "tutorial_01",
      profileId: "maze",
      profile: dynamicFlowProfile(),
      enabled: true
    };
    const preview = await callTool("preview_mechanics_module", request, {});
    const balancePath = path.join(projectDir, "content", "balance.json");
    fs.appendFileSync(balancePath, " ", "utf8");
    const concurrent = snapshotTree(projectDir);

    const stale = await captureRejection(callTool("apply_mechanics_module", {
      ...request,
      ifRevision: preview.revision
    }, {}));
    expect(stale).toMatchObject({ code: "conflict" });
    expect(snapshotTree(projectDir)).toEqual(concurrent);
  });

  it.each([
    [
      "malformed profile",
      { moduleSchemaVersion: 1, profile: { mode: "authored_routes", unexpected: true } },
      "validation"
    ],
    [
      "future module version",
      { moduleSchemaVersion: 2, profile: authoredRoutesProfile() },
      "module_version_unsupported"
    ],
    [
      "active broken references",
      {
        moduleSchemaVersion: 1,
        profile: {
          ...dynamicFlowProfile(),
          defaultMovementProfileId: "missing",
          movementProfiles: {
            ground: {
              label: "Ground",
              terrainMode: "respect_walkable",
              towerOccupancy: "blocked",
              defaultTerrainCost: 1000,
              terrainCosts: { void: 1000 }
            }
          },
          enemyMovementProfiles: { ghost: "ground", basic_grunt: "missing" }
        }
      },
      "validation"
    ]
  ])("keeps %s preview/apply errors write-free with a stable code", async (_label, overrides, code) => {
    const projectDir = copyStarter({ migrateToV2: true });
    const before = snapshotTree(projectDir);
    const capabilities = await callTool("get_capabilities", {
      projectDir,
      missionId: "tutorial_01"
    }, {});
    const request = {
      projectDir,
      moduleId: "navigation",
      missionId: "tutorial_01",
      profileId: "invalid_navigation",
      enabled: true,
      ...overrides
    };

    for (const operation of [
      () => callTool("preview_mechanics_module", request, {}),
      () => callTool("apply_mechanics_module", { ...request, ifRevision: capabilities.revision }, {})
    ]) {
      const error = await captureRejection(operation());
      expect(error).toMatchObject({ code });
      expect(snapshotTree(projectDir)).toEqual(before);
    }
  });
});
