import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateProjectFiles, writeMigratedProjectFiles } from "../cli/lib/project-migrations.mjs";
import { readRawProjectFiles } from "../cli/lib/project-loader.mjs";
import { callTool } from "./tools.mjs";
import { TOWERFORGE_AGENT_INSTRUCTIONS } from "./agent-instructions.mjs";

const projects = [];
afterEach(() => {
  for (const projectDir of projects.splice(0)) fs.rmSync(projectDir, { recursive: true, force: true });
});

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r15-mcp-"));
  projects.push(projectDir);
  fs.cpSync(path.resolve("examples/starter.tdproj"), projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);
  return projectDir;
}

async function rejection(promise) {
  try { await promise; } catch (error) { return error; }
  throw new Error("Expected operation to reject.");
}

describe("R15 macro-economy AI authoring surface", () => {
  it("describes v1, v8 commands, and an inert guarded recipe", async () => {
    const descriptor = await callTool("describe_schema", { domain: "macroEconomy" }, {});
    expect(descriptor.macroEconomy.authoring).toMatchObject({ schemaVersion: 1, moduleId: "macroEconomy" });
    expect(descriptor.macroEconomy.commands).toMatchObject({
      schemaVersion: 8,
      buyCommodity: { phase: "setup_or_between" },
      openDeposit: { phase: "setup_or_between" },
      performRitual: { phase: "while_playing" }
    });
    expect(descriptor.macroEconomy.snapshot.engineOwnedFields).toContain("ritualAllowed");
    expect(descriptor.macroEconomy.recipes).toContain("basic_local_market");
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/Macro-Economy v1[\s\S]*preview_mechanics_module[\s\S]*apply_mechanics_module/);
  }, 20_000);

  it("runs describe -> recipe -> preview -> guarded apply -> validate and rejects stale writes", async () => {
    const projectDir = fixture();
    const before = fs.existsSync(path.join(projectDir, "content", "mechanics.json"));
    const capabilities = await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {});
    expect(capabilities.capabilities.macroEconomy).toMatchObject({ available: true, active: false, reason: "module_missing" });
    expect(fs.existsSync(path.join(projectDir, "content", "mechanics.json"))).toBe(before);

    const materialized = await callTool("get_recipe", { projectDir, collection: "mechanics", recipeId: "basic_local_market" }, {});
    const entity = materialized.recipe.entity;
    expect(entity).toMatchObject({ moduleId: "macroEconomy", moduleSchemaVersion: 1, missionId: "tutorial_01", profileId: "basic_local_market" });
    expect(fs.existsSync(path.join(projectDir, "content", "mechanics.json"))).toBe(before);

    const request = { projectDir, ...entity, enabled: true };
    const preview = await callTool("preview_mechanics_module", request, {});
    expect(preview).toMatchObject({ ok: true, dryRun: true, candidate: { manifest: { schemaVersion: 3 } } });
    const applied = await callTool("apply_mechanics_module", { ...request, ifRevision: preview.revision }, {});
    expect(applied).toMatchObject({ ok: true, written: true, previousRevision: preview.revision });
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true });

    const stale = await rejection(callTool("apply_mechanics_module", { ...request, ifRevision: preview.revision }, {}));
    expect(stale).toMatchObject({ code: "conflict" });
    const after = fs.readFileSync(path.join(projectDir, "content", "mechanics.json"), "utf8");
    const invalid = await rejection(callTool("preview_mechanics_module", {
      ...request,
      profile: { ...entity.profile, quoteCurrencyId: "missing_currency" }
    }, {}));
    expect(invalid).toMatchObject({ code: "validation" });
    expect(fs.readFileSync(path.join(projectDir, "content", "mechanics.json"), "utf8")).toBe(after);
  }, 30_000);
});
