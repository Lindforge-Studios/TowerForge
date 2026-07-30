import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(".");
const CLI = path.join(ROOT, "packages", "cli", "bin", "towerforge.mjs");
const STARTER = path.join(ROOT, "examples", "starter.tdproj");

describe("R10 persona QA CLI contract (RED)", () => {
  it("runs a bounded evidence-only persona matrix as canonical JSON", () => {
    const result = spawnSync(process.execPath, [
      CLI, "persona-qa", "--project", STARTER,
      "--mission", "tutorial_01", "--seed", "cli-seed",
      "--persona", "aggressive_rush", "--seconds", "1", "--tick-step", "0.2",
      "--no-cache", "--json"
    ], { cwd: ROOT, encoding: "utf8", timeout: 20_000 });
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({
      ok: true,
      schemaVersion: 1,
      status: "completed",
      missionIds: ["tutorial_01"],
      seeds: ["cli-seed"],
      personaIds: ["aggressive_rush"],
      completedRuns: 1
    });
    expect(report.runs).toHaveLength(1);
    expect(report.runs[0]).toMatchObject({ stateDigest: expect.any(String), personaId: "aggressive_rush" });
  }, 20_000);

  it("documents the persona-qa command in CLI help", () => {
    const result = spawnSync(process.execPath, [CLI, "--help"], { cwd: ROOT, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/persona-qa[\s\S]*(?:evidence|persona)/i);
  });
});
