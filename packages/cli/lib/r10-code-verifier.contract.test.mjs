import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { materializeMechanicsRecipe } from "./mechanics-recipes.mjs";
import { runPersonaQaWorkerBatch } from "./persona-qa-worker.mjs";

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r10-verifier-"));
  roots.push(projectDir);
  fs.cpSync(path.resolve("examples/starter.tdproj"), projectDir, { recursive: true });
  return projectDir;
}

const request = {
  schemaVersion: 1,
  missionIds: ["tutorial_01"],
  seeds: ["verifier-seed"],
  personaIds: ["aggressive_rush"],
  simSeconds: 0.05,
  tickStep: 0.05
};

describe("R10 independent code-verifier regressions", () => {
  it("does not materialize impossible quest objectives for a mission without damaging sources", () => {
    expect(() => materializeMechanicsRecipe("basic_procedural_quests", {
      defaultMissionId: "support_only",
      missionIds: ["support_only"],
      missionTowerIds: ["support"],
      missionAbilityIds: [],
      missionDamagingTowerIds: [],
      missionDamagingAbilityIds: []
    })).toThrow(/quest|damage|source|tower|ability/i);
  });

  it("materializes only an available damaging ability objective when no damaging tower exists", () => {
    const recipe = materializeMechanicsRecipe("basic_procedural_quests", {
      defaultMissionId: "ability_only",
      missionIds: ["ability_only"],
      missionTowerIds: ["support"],
      missionAbilityIds: ["strike"],
      missionDamagingTowerIds: [],
      missionDamagingAbilityIds: ["strike"]
    });
    expect(recipe.entity.profile).toEqual({
      selectionCount: 1,
      definitions: {
        ability_finisher: {
          label: "Ability finisher",
          weight: 1,
          objective: {
            kind: "kill_with_source",
            count: 5,
            source: { kind: "ability", id: "strike" }
          }
        }
      }
    });
  });

  it("does not accept a locally forged completed cache result as persona evidence", async () => {
    const projectDir = fixture();
    const first = await runPersonaQaWorkerBatch(projectDir, request, { concurrency: 1 });
    const cacheFile = path.join(
      projectDir,
      ".towerforge",
      "cache",
      "persona-qa",
      "v1",
      `${first.requestDigest}.json`
    );
    const envelope = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    envelope.result.missionIds = ["forged_mission"];
    envelope.result.runs[0].missionId = "forged_mission";
    fs.writeFileSync(cacheFile, `${JSON.stringify(envelope)}\n`, "utf8");

    const repeated = await runPersonaQaWorkerBatch(projectDir, request, { concurrency: 1 });
    expect(repeated.missionIds).toEqual(["tutorial_01"]);
    expect(repeated.runs.map((run) => run.missionId)).toEqual(["tutorial_01"]);
  }, 20_000);

  it("rejects oversized authored maps before starting persona workers", async () => {
    const projectDir = fixture();
    const mapsFile = path.join(projectDir, "maps", "compiled", "maps.json");
    const maps = JSON.parse(fs.readFileSync(mapsFile, "utf8"));
    maps.tutorial_map.width = 257;
    maps.tutorial_map.height = 256;
    fs.writeFileSync(mapsFile, `${JSON.stringify(maps, null, 2)}\n`, "utf8");

    await expect(runPersonaQaWorkerBatch(projectDir, request, { concurrency: 1, cache: false }))
      .rejects.toThrow(/map.*cell|cell.*budget|oversized/i);
  });
});
