import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { projectDirectorDecisionCues } from "./director-presentation.mjs";

function snapshot(overrides = {}) {
  return {
    director: {
      schemaVersion: 1,
      profileId: "adaptive",
      decisions: []
    },
    lastEvents: [{
      type: "directorDecision",
      waveIndex: 2,
      counterId: "anti_fire",
      threatCost: 8,
      reason: {
        metric: "damage_share",
        key: "fire",
        operator: "gte",
        threshold: 0.6,
        observed: 0.85
      },
      addedGroups: [{ enemyId: "fire_guard", count: 2, spawnInterval: 0.5, startDelay: 0 }]
    }],
    ...overrides
  };
}

describe("R7 Director shared renderer projection", () => {
  it("projects bounded detached explanation cues only for an active Director v1 snapshot", () => {
    const input = snapshot();
    const cues = projectDirectorDecisionCues(input);
    expect(cues).toEqual([{
      waveIndex: 2,
      counterId: "anti_fire",
      threatCost: 8,
      metric: "damage_share",
      key: "fire",
      observed: 0.85,
      threshold: 0.6,
      addedEnemyCount: 2,
      label: "Director: anti_fire (+2)"
    }]);
    input.lastEvents[0].counterId = "mutated";
    expect(cues[0].counterId).toBe("anti_fire");
    expect(Object.isFrozen(cues)).toBe(true);
    expect(Object.isFrozen(cues[0])).toBe(true);
  });

  it("is inert for absent/future modules and fails closed on malformed or oversized event roots", () => {
    expect(projectDirectorDecisionCues({ lastEvents: snapshot().lastEvents })).toEqual([]);
    expect(projectDirectorDecisionCues(snapshot({ director: { schemaVersion: 2 } }))).toEqual([]);
    expect(projectDirectorDecisionCues(snapshot({ lastEvents: [{ type: "directorDecision", counterId: "x" }] }))).toEqual([]);
    expect(projectDirectorDecisionCues(snapshot({
      lastEvents: Array.from({ length: 65 }, () => snapshot().lastEvents[0])
    }))).toEqual([]);
  });

  it("is consumed by both generated Canvas and Phaser players", () => {
    const build = fs.readFileSync(path.resolve("packages/cli/build.mjs"), "utf8");
    expect((build.match(/projectDirectorDecisionCues/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(build).toMatch(/function playerTemplate[\s\S]*projectDirectorDecisionCues[\s\S]*function phaserPlayerTemplate/);
    expect(build).toMatch(/function phaserPlayerTemplate[\s\S]*projectDirectorDecisionCues/);
  });
});
