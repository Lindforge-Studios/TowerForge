import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateProjectFiles, writeMigratedProjectFiles } from "../cli/lib/project-migrations.mjs";
import { readRawProjectFiles } from "../cli/lib/project-loader.mjs";
import { callTool } from "./tools.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const projects = [];
const profile = {
  bosses: {
    basic_grunt: {
      components: {
        core: {
          maxHp: 20,
          hitRegion: { kind: "circle", offsetX: 0, offsetY: 0, radius: 0.25 },
          tags: ["core"]
        }
      }
    }
  },
  targeting: { towers: { arrow_tower: { priorityTags: ["core"] } } }
};

afterEach(() => {
  for (const projectDir of projects.splice(0)) fs.rmSync(projectDir, { recursive: true, force: true });
});

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r12-enemy-behaviors-mcp-"));
  projects.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);
  return projectDir;
}

function request(projectDir) {
  return {
    projectDir,
    moduleId: "enemyBehaviors",
    moduleSchemaVersion: 1,
    missionId: "tutorial_01",
    profileId: "targetable_boss",
    profile,
    enabled: true
  };
}

async function rejection(promise) {
  try { await promise; } catch (error) { return error; }
  throw new Error("Expected operation to reject.");
}

describe("R12.1d enemyBehaviors MCP/AI authoring contract (RED)", () => {
  it("describes enemyBehaviors v1 directly and through the mechanics catalog", async () => {
    const described = await callTool("describe_schema", { domain: "enemyBehaviors" }, {});
    const mechanics = await callTool("describe_schema", { domain: "mechanics" }, {});

    expect(described).toMatchObject({
      requestedDomain: "enemyBehaviors",
      enemyBehaviors: {
        authoring: { moduleId: "enemyBehaviors", supportedModuleSchemaVersions: [1] },
        snapshot: { field: "enemyBehaviors", optional: true, supportedSchemaVersions: [1] },
        checkpoint: { field: "state.enemyBehaviors", optional: true, supportedSchemaVersions: [1] },
        commands: []
      }
    });
    expect(mechanics.mechanics.implementedModuleIds).toContain("enemyBehaviors");
    expect(mechanics.mechanics.modules.enemyBehaviors).toEqual(described.enemyBehaviors);
  });

  it("reads the inactive capability without creating mechanics.json", async () => {
    const projectDir = fixture();
    const before = fs.existsSync(path.join(projectDir, "content", "mechanics.json"));

    const result = await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {});

    expect(result.capabilities.enemyBehaviors).toMatchObject({
      available: true, active: false, reason: "module_missing"
    });
    expect(result.enemyBehaviors).toMatchObject({
      authoring: { moduleId: "enemyBehaviors", supportedModuleSchemaVersions: [1] },
      enabled: false,
      profileIds: []
    });
    expect(fs.existsSync(path.join(projectDir, "content", "mechanics.json"))).toBe(before);
  });

  it("runs preview, guarded apply and validation, then rejects the stale revision", async () => {
    const projectDir = fixture();
    const preview = await callTool("preview_mechanics_module", request(projectDir), {});
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      candidate: {
        manifest: { schemaVersion: 3 },
        mechanics: { modules: { enemyBehaviors: { schemaVersion: 1, enabled: true } } },
        balance: { missions: { tutorial_01: { mechanics: { profiles: { enemyBehaviors: "targetable_boss" } } } } }
      }
    });

    const applied = await callTool("apply_mechanics_module", {
      ...request(projectDir), ifRevision: preview.revision
    }, {});
    expect(applied).toMatchObject({ ok: true, written: true, previousRevision: preview.revision });
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true });

    const stale = await rejection(callTool("apply_mechanics_module", {
      ...request(projectDir), ifRevision: preview.revision
    }, {}));
    expect(stale).toMatchObject({ code: "conflict" });
  }, 20_000);
});
