import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TOWERFORGE_AGENT_GUIDE_VERSION, TOWERFORGE_AGENT_INSTRUCTIONS } from "./agent-instructions.mjs";
import { callTool, TOOLS } from "./tools.mjs";

const projects = [];
const PROJECTIONS = ["top_down", "isometric_2_1", "dimetric_oblique"];
const ORIENTATIONS = ["north", "east", "south", "west"];

afterEach(() => {
  for (const projectDir of projects.splice(0)) fs.rmSync(projectDir, { recursive: true, force: true });
});

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r20-camera-mcp-"));
  projects.push(projectDir);
  fs.cpSync(path.resolve("examples/starter.tdproj"), projectDir, { recursive: true });
  const projectPath = path.join(projectDir, "project.json");
  const visualsPath = path.join(projectDir, "content", "visuals.json");
  const project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  const visuals = JSON.parse(fs.readFileSync(visualsPath, "utf8"));
  fs.writeFileSync(projectPath, `${JSON.stringify({ ...project, schemaVersion: 5 }, null, 2)}\n`);
  fs.writeFileSync(visualsPath, `${JSON.stringify({
    ...visuals,
    schemaVersion: 4,
    proceduralJuice: { schemaVersion: 1, particleEmitters: {}, audioCues: {}, cameraCues: {}, eventBindings: {} },
    viewVariants: { schemaVersion: 1, sprites: {}, tileSets: {} }
  }, null, 2)}\n`);
  return projectDir;
}

function authoredBytes(projectDir) {
  return {
    project: fs.readFileSync(path.join(projectDir, "project.json"), "utf8"),
    visuals: fs.readFileSync(path.join(projectDir, "content", "visuals.json"), "utf8"),
    targets: fs.readFileSync(path.join(projectDir, "build-targets.json"), "utf8")
  };
}

function tool(name) {
  const result = TOOLS.find((entry) => entry.name === name);
  expect(result, `${name} must be registered`).toBeDefined();
  return result;
}

describe("R20.4 Camera Studio MCP/AI contract (RED)", () => {
  it("describes one narrow presentation-only workflow with the four-step resolver", async () => {
    expect(await callTool("describe_schema", { domain: "camera" }, {})).toMatchObject({
      requestedDomain: "camera",
      availableDomains: expect.arrayContaining(["camera"]),
      camera: {
        schemaVersion: 1,
        visualsSchemaVersion: 4,
        mechanicsRequired: false,
        presentationOnly: true,
        projections: PROJECTIONS,
        orientations: ORIENTATIONS,
        allowedBindings: ["maps", "missions"],
        resolutionPrecedence: ["mission", "map", "build_target", "top_down_fallback"],
        authoringTransaction: {
          read: "get_camera_profiles",
          recipe: "get_camera_profile_recipe",
          preview: "preview_camera_profile",
          apply: "apply_camera_profile",
          revisionGuard: "ifRevision"
        }
      }
    });
    expect(tool("get_camera_profiles")).toMatchObject({ riskClass: "read_only", sideEffect: "none" });
    expect(tool("get_camera_profile_recipe")).toMatchObject({ riskClass: "read_only", sideEffect: "none" });
    expect(tool("preview_camera_profile")).toMatchObject({
      riskClass: "compute_only",
      sideEffect: expect.stringMatching(/none|writes no project files/i),
      inputSchema: expect.objectContaining({ additionalProperties: false })
    });
    expect(tool("apply_camera_profile")).toMatchObject({
      riskClass: "write_local",
      sideEffect: expect.stringMatching(/revision.*validation.*backup.*rollback/i),
      inputSchema: expect.objectContaining({
        required: expect.arrayContaining(["projectDir", "profileId", "profile", "ifRevision"]),
        additionalProperties: false
      })
    });
    expect(TOOLS.map((entry) => entry.name)).not.toEqual(expect.arrayContaining([
      "replace_camera_catalog", "write_camera_catalog", "replace_visuals"
    ]));
  });

  it("provides detached recipes for all 3 projections x 4 orientations", async () => {
    for (const projection of PROJECTIONS) for (const orientation of ORIENTATIONS) {
      const recipe = await callTool("get_camera_profile_recipe", {
        recipeId: projection, orientation, profileId: `${projection}-${orientation}`
      }, {});
      expect(recipe).toMatchObject({
        recipeId: projection,
        profileId: `${projection}-${orientation}`,
        detached: true,
        written: false,
        profile: { schemaVersion: 1, projection, orientation }
      });
    }
  });

  it("computes resolution, bounds, diagnostics and coverage without writing", async () => {
    const projectDir = fixture();
    const before = authoredBytes(projectDir);
    const recipe = await callTool("get_camera_profile_recipe", {
      recipeId: "isometric_2_1", orientation: "east", profileId: "iso-east"
    }, {});
    const candidate = {
      projectDir,
      profileId: recipe.profileId,
      profile: recipe.profile,
      binding: { scope: "mission", id: "tutorial_01" }
    };
    const preview = await callTool("preview_camera_profile", {
      ...candidate,
      context: {
        missionId: "tutorial_01", mapId: "tutorial_map", buildTargetId: "web-pwa",
        viewport: { width: 1440, height: 900 }
      }
    }, {});
    expect(preview).toMatchObject({
      ok: true, dryRun: true, written: false, revision: expect.any(String),
      resolution: {
        profileId: "iso-east", source: "mission",
        profile: { projection: "isometric_2_1", orientation: "east" }
      },
      preview: {
        projectedBounds: {
          minX: expect.any(Number), minY: expect.any(Number), maxX: expect.any(Number),
          maxY: expect.any(Number), width: expect.any(Number), height: expect.any(Number)
        },
        diagnostics: {
          clipping: expect.any(Object), depth: expect.any(Object),
          assetCoverage: {
            exact: expect.any(Array), fallback: expect.any(Array), missingRequired: expect.any(Array)
          }
        }
      }
    });
    expect(authoredBytes(projectDir)).toEqual(before);

    const fallback = await callTool("preview_camera_profile", {
      projectDir,
      profileId: recipe.profileId,
      profile: recipe.profile,
      context: { missionId: "tutorial_01", mapId: "tutorial_map", buildTargetId: "web-pwa", viewport: { width: 1440, height: 900 } }
    }, {});
    expect(fallback.resolution).toMatchObject({ source: "top_down_fallback", profileId: null });
  }, 30_000);

  it("guardedly upserts one profile, preserves adjacent visuals, and rejects stale reuse", async () => {
    const projectDir = fixture();
    const recipe = await callTool("get_camera_profile_recipe", {
      recipeId: "dimetric_oblique", orientation: "south", profileId: "tactical-south"
    }, {});
    const candidate = {
      projectDir, profileId: recipe.profileId, profile: recipe.profile,
      binding: { scope: "mission", id: "tutorial_01" }
    };
    const preview = await callTool("preview_camera_profile", candidate, {});
    const applied = await callTool("apply_camera_profile", { ...candidate, ifRevision: preview.revision }, {});
    expect(applied).toMatchObject({
      ok: true, written: true, rolledBack: false, previousRevision: preview.revision,
      backup: { directory: expect.stringMatching(/^\.towerforge\/backups\//) }
    });
    const committed = authoredBytes(projectDir);
    const visuals = JSON.parse(committed.visuals);
    expect(visuals.proceduralJuice).toMatchObject({ schemaVersion: 1 });
    expect(visuals.viewVariants).toEqual({ schemaVersion: 1, sprites: {}, tileSets: {} });
    expect(visuals.cameraProfiles.profiles[recipe.profileId]).toEqual(recipe.profile);
    expect(visuals.cameraProfiles.bindings).not.toHaveProperty("defaultProfileId");
    expect(visuals.cameraProfiles.bindings.missions.tutorial_01).toBe(recipe.profileId);

    expect(await callTool("apply_camera_profile", {
      ...candidate, profile: { ...recipe.profile, orientation: "west" }, ifRevision: preview.revision
    }, {})).toMatchObject({ ok: false, conflict: true, written: false });
    expect(authoredBytes(projectDir)).toEqual(committed);
  }, 30_000);

  it("disables and re-enables one binding without deleting its reusable profile", async () => {
    const projectDir = fixture();
    const recipe = await callTool("get_camera_profile_recipe", {
      recipeId: "isometric_2_1", orientation: "west", profileId: "toggle-west"
    }, {});
    const candidate = {
      projectDir, profileId: recipe.profileId, profile: recipe.profile,
      binding: { scope: "mission", id: "tutorial_01" }
    };
    let preview = await callTool("preview_camera_profile", candidate, {});
    await callTool("apply_camera_profile", { ...candidate, ifRevision: preview.revision }, {});
    preview = await callTool("preview_camera_profile", {
      ...candidate, binding: { ...candidate.binding, enabled: false },
      context: { missionId: "tutorial_01", mapId: "tutorial_map" }
    }, {});
    expect(preview.resolution).toMatchObject({ source: "top_down_fallback", profileId: null });
    const disabled = await callTool("apply_camera_profile", {
      ...candidate, binding: { ...candidate.binding, enabled: false }, ifRevision: preview.revision
    }, {});
    expect(disabled.ok).toBe(true);
    const disabledCatalog = JSON.parse(authoredBytes(projectDir).visuals).cameraProfiles;
    expect(disabledCatalog.profiles[recipe.profileId]).toEqual(recipe.profile);
    expect(disabledCatalog.bindings.missions).toEqual({});
    preview = await callTool("preview_camera_profile", candidate, {});
    await callTool("apply_camera_profile", { ...candidate, ifRevision: preview.revision }, {});
    expect(JSON.parse(authoredBytes(projectDir).visuals).cameraProfiles.bindings.missions.tutorial_01).toBe(recipe.profileId);
  }, 30_000);

  it("rejects symlink traversal in owned sources and backup directories", async () => {
    const projectDir = fixture();
    const revision = (await callTool("get_camera_profiles", { projectDir }, {})).revision;
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r20-camera-outside-"));
    projects.push(outside);
    fs.mkdirSync(path.join(outside, "content"));
    fs.copyFileSync(path.join(projectDir, "content", "visuals.json"), path.join(outside, "content", "visuals.json"));
    fs.renameSync(path.join(projectDir, "content"), path.join(projectDir, "content-real"));
    fs.symlinkSync(path.join(outside, "content"), path.join(projectDir, "content"), "dir");
    const recipe = await callTool("get_camera_profile_recipe", {
      recipeId: "isometric_2_1", orientation: "north", profileId: "unsafe"
    }, {});
    await expect(callTool("apply_camera_profile", {
      projectDir, profileId: recipe.profileId, profile: recipe.profile,
      ifRevision: revision
    }, {})).rejects.toThrow(/symbolic link|symlink|unsafe/i);
    expect(JSON.parse(fs.readFileSync(path.join(outside, "content", "visuals.json"), "utf8"))).not.toHaveProperty("cameraProfiles");
  });

  it("teaches agents the descriptor-driven guarded workflow", () => {
    expect(TOWERFORGE_AGENT_GUIDE_VERSION).toBeGreaterThanOrEqual(53);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /describe_schema[\s\S]{0,120}camera[\s\S]*get_camera_profiles[\s\S]*get_camera_profile_recipe[\s\S]*preview_camera_profile[\s\S]*apply_camera_profile[\s\S]*ifRevision[\s\S]*validate_project/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /presentation-only[\s\S]*(?:does not|never)[\s\S]*(?:engine|gameplay|checkpoint|replay)/i
    );
  });
});
