import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { callTool, TOOLS } from "./tools.mjs";

const projects = [];

afterEach(() => {
  for (const projectDir of projects.splice(0)) fs.rmSync(projectDir, { recursive: true, force: true });
});

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r17-mcp-"));
  projects.push(projectDir);
  fs.cpSync(path.resolve("examples/starter.tdproj"), projectDir, { recursive: true });
  return projectDir;
}

function config(attribution = "TowerForge AI-authored reference") {
  return {
    schemaVersion: 1,
    projectId: "tfp_0123456789abcdef0123456789abcdef",
    license: { spdxId: "CC-BY-4.0", attribution },
    remix: { policy: "allowed_with_attribution", includeSource: true },
    monetization: {
      schemaVersion: 1,
      placements: [{ id: "support_link", kind: "purchase_link", surface: "menu" }]
    }
  };
}

function tool(name) {
  const result = TOOLS.find((entry) => entry.name === name);
  expect(result, `${name} must be registered`).toBeDefined();
  return result;
}

describe("R17 AI distribution authoring acceptance (RED)", () => {
  it("describes read → preview → guarded apply while keeping external publication unavailable", async () => {
    const described = await callTool("describe_schema", { domain: "distribution" }, {});
    expect(described).toMatchObject({
      requestedDomain: "distribution",
      distribution: {
        schemaVersion: 1,
        projectSchemaVersion: 4,
        authoringTransaction: {
          read: "read_distribution_config",
          preview: "preview_distribution_config",
          apply: "apply_distribution_config",
          revisionGuard: "ifRevision",
          file: "content/distribution.json"
        },
        publish: {
          preview: "preview_publish_candidate",
          externalUploadAvailableToAgents: false
        }
      }
    });

    expect(tool("read_distribution_config")).toMatchObject({ riskClass: "read_only", sideEffect: "none" });
    expect(tool("preview_distribution_config")).toMatchObject({ riskClass: "compute_only", sideEffect: "none" });
    expect(tool("apply_distribution_config")).toMatchObject({
      riskClass: "write_local",
      sideEffect: expect.stringMatching(/revision.*backup.*rollback/i),
      inputSchema: { required: expect.arrayContaining(["projectDir", "ifRevision"]) }
    });
    expect(tool("preview_publish_candidate")).toMatchObject({ riskClass: "compute_only", sideEffect: "none" });
    expect(TOOLS.map((entry) => entry.name)).not.toEqual(expect.arrayContaining([
      "publish_project", "upload_project", "deploy_project", "mint_publish_approval"
    ]));
  }, 30_000);

  it("runs absent read → preview → guarded apply → validate, rejects stale revision, and disables cleanly", async () => {
    const projectDir = fixture();
    const initial = await callTool("read_distribution_config", { projectDir }, {});
    expect(initial).toMatchObject({ authored: false, distribution: null, revision: expect.any(String) });
    expect(fs.existsSync(path.join(projectDir, "content", "distribution.json"))).toBe(false);

    const preview = await callTool("preview_distribution_config", { projectDir, distribution: config() }, {});
    expect(preview).toMatchObject({
      ok: true, dryRun: true, written: false, revision: initial.revision,
      projectSchemaVersion: 4,
      validation: { ok: true, issues: [] }
    });
    expect(fs.existsSync(path.join(projectDir, "content", "distribution.json"))).toBe(false);

    const applied = await callTool("apply_distribution_config", {
      projectDir, distribution: config(), ifRevision: preview.revision
    }, {});
    expect(applied).toMatchObject({
      ok: true, written: true, previousRevision: preview.revision,
      backup: { directory: expect.stringMatching(/^\.towerforge\/backups\//) }
    });
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true });
    expect(JSON.parse(fs.readFileSync(path.join(projectDir, "project.json"), "utf8")).schemaVersion).toBe(4);

    const stale = await callTool("apply_distribution_config", {
      projectDir, distribution: config("stale"), ifRevision: preview.revision
    }, {});
    expect(stale).toMatchObject({ ok: false, conflict: true, written: false });

    const current = await callTool("read_distribution_config", { projectDir }, {});
    const disablePreview = await callTool("preview_distribution_config", { projectDir, distribution: null }, {});
    expect(disablePreview).toMatchObject({ ok: true, dryRun: true, written: false, revision: current.revision });
    const disabled = await callTool("apply_distribution_config", {
      projectDir, distribution: null, ifRevision: disablePreview.revision
    }, {});
    expect(disabled).toMatchObject({ ok: true, written: true });
    expect(fs.existsSync(path.join(projectDir, "content", "distribution.json"))).toBe(false);
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true });
  }, 30_000);
});
