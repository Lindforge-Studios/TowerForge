import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateProjectFiles, writeMigratedProjectFiles } from "../cli/lib/project-migrations.mjs";
import { readRawProjectFiles } from "../cli/lib/project-loader.mjs";
import { mechanicsAuthoringRevision } from "../cli/lib/mechanics-authoring.mjs";
import { callTool, TOOLS } from "./tools.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const tempProjects = [];

afterEach(() => {
  for (const projectDir of tempProjects.splice(0)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r32-los-mcp-"));
  tempProjects.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);

  const manifestPath = path.join(projectDir, "project.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);

  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
  balance.missions.tutorial_01.mechanics = { profiles: { elevation: "deterministic_los" } };
  writeJson(balancePath, balance);
  writeJson(path.join(projectDir, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: {
      elevation: {
        schemaVersion: 2,
        enabled: true,
        profiles: {
          deterministic_los: { lineOfSight: { terrainBlockerTags: [] } }
        }
      }
    }
  });
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
      } else entries.push({ path: relativePath, type: "other" });
    }
  };
  visit(rootDir);
  return entries;
}

const source = Object.freeze({ q: 0, r: 0 });
const targets = Object.freeze([Object.freeze({ q: 2, r: 0 })]);

describe("R3.2 MCP elevation line-of-sight surface", () => {
  it("describes elevation v3 authoring with v2 LoS, engine analysis, schema-v1 snapshots, and direct capabilities", async () => {
    const projectDir = fixture();
    const elevation = await callTool("describe_schema", { domain: "elevation" }, {});
    const mechanics = await callTool("describe_schema", { domain: "mechanics" }, {});

    expect(elevation.elevation).toMatchObject({
      authoring: {
        moduleId: "elevation",
        schemaVersion: 3,
        supportedModuleSchemaVersions: [1, 2, 3]
      },
      analysis: {
        tool: "analyze_line_of_sight",
        readOnly: true,
        modes: ["active", "candidate"]
      },
      snapshot: { field: "elevation", optional: true, supportedSchemaVersions: [1] },
      events: []
    });
    expect(elevation.elevation.snapshot.supportedSchemaVersions).toEqual([1]);
    expect(mechanics.mechanics.modules.elevation).toEqual(elevation.elevation);

    const capabilities = await callTool("get_capabilities", {
      projectDir,
      missionId: "tutorial_01"
    }, {});
    expect(capabilities).toMatchObject({
      revision: expect.any(String),
      capabilities: {
        elevation: {
          available: true,
          active: true,
          reason: "active",
          moduleSchemaVersion: 2,
          profileId: "deterministic_los"
        }
      },
      elevation: {
        authoring: { supportedModuleSchemaVersions: [1, 2, 3] },
        enabled: true,
        moduleSchemaVersion: 2,
        selectedProfileId: "deterministic_los",
        selectedProfile: { lineOfSight: { terrainBlockerTags: [] } }
      }
    });
  });

  it("advertises a strict compute-only analyzer and analyzes active/candidate profiles at one revision without writes", async () => {
    const projectDir = fixture();
    const capability = await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {});
    const before = snapshotTree(projectDir);
    const tool = TOOLS.find((candidate) => candidate.name === "analyze_line_of_sight");

    expect(tool).toMatchObject({
      riskClass: "compute_only",
      sideEffect: expect.stringMatching(/no project files|writes no project/i),
      inputSchema: {
        properties: {
          projectDir: expect.any(Object),
          missionId: expect.any(Object),
          source: expect.objectContaining({ type: "object", additionalProperties: false }),
          targets: expect.objectContaining({ type: "array" }),
          candidate: expect.objectContaining({
            type: "object",
            required: ["moduleSchemaVersion", "profileId", "profile"],
            additionalProperties: false
          }),
          ifRevision: expect.any(Object)
        },
        required: ["source", "targets", "ifRevision"],
        additionalProperties: false
      }
    });

    const active = await callTool("analyze_line_of_sight", {
      projectDir,
      missionId: "tutorial_01",
      source,
      targets,
      ifRevision: capability.revision
    }, {});
    expect(active).toMatchObject({
      active: true,
      basis: "active",
      reason: "active",
      revision: capability.revision,
      missionId: "tutorial_01",
      mapId: "tutorial_map",
      analysis: {
        schemaVersion: 1,
        profileId: "deterministic_los",
        source,
        rows: [expect.objectContaining({ target: targets[0], visible: expect.any(Boolean) })]
      }
    });

    const candidate = await callTool("analyze_line_of_sight", {
      projectDir,
      missionId: "tutorial_01",
      source,
      targets,
      candidate: {
        moduleSchemaVersion: 2,
        profileId: "candidate_los",
        profile: { lineOfSight: { terrainBlockerTags: [] } }
      },
      ifRevision: capability.revision
    }, {});
    expect(candidate).toMatchObject({
      active: true,
      basis: "candidate",
      reason: "active",
      revision: capability.revision,
      analysis: { schemaVersion: 1, profileId: "candidate_los" }
    });
    expect(snapshotTree(projectDir)).toEqual(before);
  });

  it("rejects a stale analysis revision and returns a stable inactive reason without writes", async () => {
    const projectDir = fixture();
    const first = await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {});
    const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
    const mechanics = JSON.parse(fs.readFileSync(mechanicsPath, "utf8"));
    mechanics.modules.elevation.enabled = false;
    writeJson(mechanicsPath, mechanics);
    const current = await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {});
    const before = snapshotTree(projectDir);

    await expect(callTool("analyze_line_of_sight", {
      projectDir,
      missionId: "tutorial_01",
      source,
      targets,
      ifRevision: first.revision
    }, {})).rejects.toThrow(/revision|stale|conflict/i);
    expect(snapshotTree(projectDir)).toEqual(before);

    const inactive = await callTool("analyze_line_of_sight", {
      projectDir,
      missionId: "tutorial_01",
      source,
      targets,
      ifRevision: current.revision
    }, {});
    expect(inactive).toMatchObject({
      active: false,
      analysis: null,
      basis: "active",
      reason: "module_disabled",
      revision: current.revision
    });
    expect(snapshotTree(projectDir)).toEqual(before);
  });

  it("rejects an active profile with an unknown terrain blocker tag before analysis", async () => {
    const projectDir = fixture();
    const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
    const mechanics = JSON.parse(fs.readFileSync(mechanicsPath, "utf8"));
    mechanics.modules.elevation.profiles.deterministic_los.lineOfSight.terrainBlockerTags = ["verifier_unknown_tag"];
    writeJson(mechanicsPath, mechanics);
    const revision = mechanicsAuthoringRevision(projectDir);
    const before = snapshotTree(projectDir);

    await expect(callTool("analyze_line_of_sight", {
      projectDir,
      missionId: "tutorial_01",
      // Deliberately invalid for simulation: semantic project validation must win first.
      source: { q: 999, r: 999 },
      targets,
      ifRevision: revision
    }, {})).rejects.toThrow(/project validation|unknown.*terrain|terrain.*unknown|verifier_unknown_tag/i);
    expect(snapshotTree(projectDir)).toEqual(before);
  });
});
