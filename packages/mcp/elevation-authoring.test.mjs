import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { callTool, TOOLS } from "./tools.mjs";
import { TOWERFORGE_AGENT_INSTRUCTIONS } from "./agent-instructions.mjs";

const projects = [];
afterEach(() => {
  for (const project of projects.splice(0)) fs.rmSync(project, { recursive: true, force: true });
});

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-elevation-mcp-"));
  projects.push(projectDir);
  fs.cpSync(path.resolve("examples/starter.tdproj"), projectDir, { recursive: true });
  const projectPath = path.join(projectDir, "project.json");
  const manifest = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  manifest.schemaVersion = 3;
  fs.writeFileSync(projectPath, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(projectDir, "content", "mechanics.json"), `${JSON.stringify({
    schemaVersion: 1,
    modules: { elevation: { schemaVersion: 1, enabled: true, profiles: { authored: {} } } }
  }, null, 2)}\n`);
  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
  balance.missions.tutorial_01.mechanics = { profiles: { elevation: "authored" } };
  fs.writeFileSync(balancePath, `${JSON.stringify(balance, null, 2)}\n`);
  return projectDir;
}

function mapsBytes(projectDir) {
  return fs.readFileSync(path.join(projectDir, "maps", "compiled", "maps.json"));
}

describe("R3.1 MCP elevation authoring", () => {
  it("advertises granular guarded map tools and capability-aware guidance", async () => {
    expect(TOOLS.find((tool) => tool.name === "preview_map_elevations")).toMatchObject({
      riskClass: "read_only",
      sideEffect: "none"
    });
    expect(TOOLS.find((tool) => tool.name === "apply_map_elevations")).toMatchObject({
      riskClass: "write_local",
      sideEffect: expect.stringMatching(/revision|validation|backup|rollback/i)
    });
    const schema = await callTool("describe_schema", { domain: "elevation" }, {});
    expect(schema.elevation).toMatchObject({
      moduleId: "elevation",
      map: { field: "elevationOverrides", coordinateField: "elevation" }
    });
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /elevation[\s\S]*get_capabilities[\s\S]*preview_map_elevations[\s\S]*apply_map_elevations[\s\S]*ifRevision/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/elevation[\s\S]*(?:never|must not|does not)[\s\S]*auto[- ]?enable/i);
  });

  it("previews without writes, applies canonically with backup, and rejects stale revisions", async () => {
    const projectDir = fixture();
    const before = mapsBytes(projectDir);
    const request = {
      projectDir,
      mapId: "tutorial_map",
      elevationOverrides: [
        { q: 2, r: 1, elevation: -2 },
        { q: 1, r: 0, elevation: 4 },
        { q: 0, r: 0, elevation: 0 }
      ]
    };
    const preview = await callTool("preview_map_elevations", request, {});
    expect(mapsBytes(projectDir).equals(before)).toBe(true);
    expect(preview).toMatchObject({
      mapId: "tutorial_map",
      candidate: {
        elevationOverrides: [
          { q: 1, r: 0, elevation: 4 },
          { q: 2, r: 1, elevation: -2 }
        ]
      },
      revision: expect.any(String)
    });
    const applied = await callTool("apply_map_elevations", { ...request, ifRevision: preview.revision }, {});
    expect(applied).toMatchObject({
      changed: true,
      backup: expect.any(Object)
    });
    const maps = JSON.parse(mapsBytes(projectDir));
    expect(maps.tutorial_map.elevationOverrides).toEqual(preview.candidate.elevationOverrides);
    await expect(callTool("apply_map_elevations", { ...request, ifRevision: preview.revision }, {}))
      .rejects.toThrow(/revision|stale|changed|conflict/i);
  });

  it("rejects malformed data without writing project files", async () => {
    const projectDir = fixture();
    const before = mapsBytes(projectDir);
    await expect(callTool("preview_map_elevations", {
      projectDir,
      mapId: "tutorial_map",
      elevationOverrides: [{ q: 1, r: 0, elevation: Number.NaN }]
    }, {})).rejects.toThrow(/elevation|finite|integer|validation/i);
    expect(mapsBytes(projectDir).equals(before)).toBe(true);
  });
});
