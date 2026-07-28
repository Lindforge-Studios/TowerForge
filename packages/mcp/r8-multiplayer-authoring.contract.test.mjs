import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { migrateProjectFiles, writeMigratedProjectFiles } from "../cli/lib/project-migrations.mjs";
import { loadContentRegistry, readRawProjectFiles } from "../cli/lib/project-loader.mjs";
import { callTool, TOOLS } from "./tools.mjs";
import { TOWERFORGE_AGENT_GUIDE_VERSION, TOWERFORGE_AGENT_INSTRUCTIONS } from "./agent-instructions.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r8-mcp-"));
  roots.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);
  return projectDir;
}

function sourceTree(rootDir) {
  const rows = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === ".towerforge") continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) rows.push([path.relative(rootDir, absolute), fs.readFileSync(absolute).toString("base64")]);
    }
  };
  visit(rootDir);
  return rows;
}

function tool(name) {
  return TOOLS.find((candidate) => candidate.name === name);
}

async function enableRecipe(projectDir, recipeId) {
  const materialized = await callTool("get_recipe", { projectDir, collection: "mechanics", recipeId }, {});
  const request = { projectDir, ...materialized.recipe.entity, enabled: true };
  const preview = await callTool("preview_mechanics_module", request, {});
  expect(preview).toMatchObject({ ok: true, dryRun: true, written: false });
  return callTool("apply_mechanics_module", { ...request, ifRevision: preview.revision }, {});
}

describe("R8 Multiplayer MCP authoring and analysis contracts (RED)", () => {
  it("describes v1/v2 opt-in authoring and compute-only protocol tools from the dedicated entrypoint", async () => {
    const described = await callTool("describe_schema", { domain: "multiplayer" }, {});
    expect(described).toMatchObject({
      requestedDomain: "multiplayer",
      availableDomains: expect.arrayContaining(["multiplayer"]),
      multiplayer: {
        entrypoint: "@towerforge/engine/multiplayer",
        authoring: expect.objectContaining({ moduleId: "multiplayer", supportedModuleSchemaVersions: [1, 2] }),
        versions: {
          1: expect.objectContaining({ mode: "local_coop" }),
          2: expect.objectContaining({
            mode: "asymmetric_send_vs_build",
            compatibleProfileModes: ["local_coop", "asymmetric_send_vs_build"],
            monotonicSupersetOf: 1
          })
        },
        analysis: {
          handshake: "analyze_multiplayer_handshake",
          replay: "verify_multiplayer_replay",
          desync: "diagnose_multiplayer_desync"
        },
        snapshot: {
          envelope: ["MatchSnapshotV1", "AsymmetricMatchSnapshotV1"],
          gameSnapshotField: null
        }
      }
    });
    const mechanics = await callTool("describe_schema", { domain: "mechanics" }, {});
    expect(mechanics.mechanics.modules.multiplayer).toEqual(described.multiplayer);
    for (const name of ["analyze_multiplayer_handshake", "verify_multiplayer_replay", "diagnose_multiplayer_desync"]) {
      expect(tool(name)).toMatchObject({ riskClass: "compute_only" });
      expect(JSON.stringify(tool(name))).toMatch(/@towerforge\/engine\/multiplayer/);
      expect(JSON.stringify(tool(name))).toMatch(/writes no project files/i);
    }
  });

  it("teaches agents the guarded opt-in workflow and isolated protocol entrypoint", () => {
    expect(TOWERFORGE_AGENT_GUIDE_VERSION).toBeGreaterThanOrEqual(34);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/Multiplayer is strictly opt-in/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/@towerforge\/engine\/multiplayer/);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/basic_local_coop[\s\S]*basic_asymmetric_send_vs_build/);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/analyze_multiplayer_handshake[\s\S]*verify_multiplayer_replay[\s\S]*diagnose_multiplayer_desync/);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/Future module versions are preserved read-only/i);
  });

  it.each([
    ["basic_local_coop", 1, "local_coop"],
    ["basic_partitioned_local_coop", 1, "local_coop"],
    ["basic_asymmetric_send_vs_build", 2, "asymmetric_send_vs_build"]
  ])("runs guarded recipe lifecycle for %s", async (recipeId, moduleSchemaVersion, mode) => {
    const projectDir = fixture();
    const before = sourceTree(projectDir);
    const recipes = await callTool("list_recipes", { collection: "mechanics" }, {});
    expect(recipes.recipes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: recipeId, moduleId: "multiplayer", moduleSchemaVersion })
    ]));
    const materialized = await callTool("get_recipe", { projectDir, collection: "mechanics", recipeId }, {});
    expect(materialized.recipe.entity).toMatchObject({
      moduleId: "multiplayer", moduleSchemaVersion, missionId: "tutorial_01",
      profileId: recipeId, profile: expect.objectContaining({ mode })
    });
    if (recipeId === "basic_partitioned_local_coop") {
      expect(materialized.recipe.entity.profile.ownership).toMatchObject({ resources: "partitioned", routes: "shared" });
    }
    expect(sourceTree(projectDir)).toEqual(before);

    const request = { projectDir, ...materialized.recipe.entity, enabled: true };
    const preview = await callTool("preview_mechanics_module", request, {});
    expect(preview).toMatchObject({ ok: true, dryRun: true, written: false, revision: expect.any(String) });
    const applied = await callTool("apply_mechanics_module", { ...request, ifRevision: preview.revision }, {});
    expect(applied).toMatchObject({ ok: true, written: true, rolledBack: false, backup: { directory: expect.any(String) } });
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true });
    const enabled = await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {});
    expect(enabled.capabilities.multiplayer).toMatchObject({ available: true, active: true, reason: "active", profileId: recipeId });

    const disabledPreview = await callTool("preview_mechanics_module", {
      projectDir, moduleId: "multiplayer", moduleSchemaVersion, missionId: "tutorial_01", enabled: false
    }, {});
    const disabled = await callTool("apply_mechanics_module", {
      projectDir, moduleId: "multiplayer", moduleSchemaVersion, missionId: "tutorial_01", enabled: false,
      ifRevision: disabledPreview.revision
    }, {});
    expect(disabled).toMatchObject({ ok: true, written: true });
    const inactive = await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {});
    expect(inactive.capabilities.multiplayer).toMatchObject({ active: false, reason: "module_disabled" });

    const reenablePreview = await callTool("preview_mechanics_module", request, {});
    expect(await callTool("apply_mechanics_module", { ...request, ifRevision: reenablePreview.revision }, {}))
      .toMatchObject({ ok: true, written: true });
  }, 30_000);

  it("preserves an unsupported future profile read-only and rejects guarded writes", async () => {
    const projectDir = fixture();
    const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
    fs.writeFileSync(mechanicsPath, `${JSON.stringify({
      schemaVersion: 1,
      modules: { multiplayer: { enabled: true, schemaVersion: 99, profiles: { future: { mode: "future_mesh", opaque: { retain: true } } } } }
    }, null, 2)}\n`);
    const balancePath = path.join(projectDir, "content", "balance.json");
    const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
    balance.missions.tutorial_01.mechanics = { profiles: { multiplayer: "future" } };
    fs.writeFileSync(balancePath, `${JSON.stringify(balance, null, 2)}\n`);
    const before = sourceTree(projectDir);

    const inspected = await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {});
    expect(inspected.capabilities.multiplayer).toMatchObject({ active: false, reason: "module_version_unsupported", moduleSchemaVersion: 99 });
    expect(inspected.multiplayer).toMatchObject({ moduleSchemaVersion: 99, selectedProfileId: "future", selectedProfile: { mode: "future_mesh", opaque: { retain: true } } });
    await expect(callTool("preview_mechanics_module", {
      projectDir, moduleId: "multiplayer", moduleSchemaVersion: 2, missionId: "tutorial_01", enabled: false
    }, {})).rejects.toMatchObject({ code: "module_version_unsupported" });
    expect(sourceTree(projectDir)).toEqual(before);
  });

  it("upgrades v1 to the v2 superset without deleting or invalidating saved local co-op profiles", async () => {
    const projectDir = fixture();
    expect(await enableRecipe(projectDir, "basic_local_coop")).toMatchObject({ ok: true, written: true });
    const asymmetric = await callTool("get_recipe", {
      projectDir, collection: "mechanics", recipeId: "basic_asymmetric_send_vs_build"
    }, {});
    const request = { projectDir, ...asymmetric.recipe.entity, enabled: true };
    const preview = await callTool("preview_mechanics_module", request, {});
    expect(preview).toMatchObject({ ok: true, dryRun: true, written: false });
    expect(await callTool("apply_mechanics_module", { ...request, ifRevision: preview.revision }, {}))
      .toMatchObject({ ok: true, written: true });

    const mechanics = JSON.parse(fs.readFileSync(path.join(projectDir, "content", "mechanics.json"), "utf8"));
    expect(mechanics.modules.multiplayer).toMatchObject({
      schemaVersion: 2,
      profiles: {
        basic_local_coop: { mode: "local_coop" },
        basic_asymmetric_send_vs_build: { mode: "asymmetric_send_vs_build" }
      }
    });
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true });
  }, 30_000);

  it("analyzes handshake, replay and desync without mutating source files", async () => {
    const projectDir = fixture();
    await enableRecipe(projectDir, "basic_local_coop");
    const before = sourceTree(projectDir);
    const handshake = {
      matchId: "contract-match", contentDigest: "tf-content-v1:0123456789abcdef", mode: "local_coop"
    };
    expect(await callTool("analyze_multiplayer_handshake", { projectDir, local: handshake, remote: handshake }, {}))
      .toMatchObject({ schemaVersion: 1, compatible: true, negotiation: { ok: true, protocolVersion: 1 } });
    expect(await callTool("diagnose_multiplayer_desync", {
      projectDir,
      local: { schemaVersion: 1, frames: [{ tick: 0, checksum: "tf-match-v1:0000000000000000" }, { tick: 1, checksum: "tf-match-v1:1111111111111111" }] },
      remote: { schemaVersion: 1, frames: [{ tick: 0, checksum: "tf-match-v1:0000000000000000" }, { tick: 1, checksum: "tf-match-v1:2222222222222222" }] }
    }, {})).toMatchObject({ schemaVersion: 1, divergent: true, firstDivergentTick: 1 });

    const { content } = await loadContentRegistry(projectDir);
    const multiplayer = await import(pathToFileURL(path.resolve("packages/engine/dist/multiplayer/index.js")).href);
    const session = multiplayer.MatchSession.create({
      schemaVersion: 1, mode: "local_coop", matchId: "contract-match", profileId: "basic_local_coop",
      fixedTickUnits: 1, content, missionId: "tutorial_01", seed: "r8-contract", players: [{ id: "left" }, { id: "right" }]
    });
    const journal = session.exportJournal();
    expect(await callTool("verify_multiplayer_replay", { projectDir, journal }, {})).toMatchObject({
      schemaVersion: 1, verified: true, mode: "local_coop", entriesReplayed: 0, checksum: session.getSnapshot().checksum
    });
    expect(sourceTree(projectDir)).toEqual(before);
  }, 30_000);

  it("keeps legacy projects absent and rejects stale writes without source mutation", async () => {
    const projectDir = fixture();
    const before = sourceTree(projectDir);
    const inspected = await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {});
    expect(inspected).toMatchObject({ mechanicsAuthored: false });
    expect(inspected.capabilities.multiplayer).toMatchObject({ active: false, reason: "module_missing" });
    expect(sourceTree(projectDir)).toEqual(before);
    const recipe = await callTool("get_recipe", { projectDir, collection: "mechanics", recipeId: "basic_local_coop" }, {});
    await expect(callTool("apply_mechanics_module", {
      projectDir, ...recipe.recipe.entity, enabled: true, ifRevision: "tf-mechanics-v1:stale"
    }, {})).rejects.toMatchObject({ code: "conflict" });
    expect(sourceTree(projectDir)).toEqual(before);
  });
});
