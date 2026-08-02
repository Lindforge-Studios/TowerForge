import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadContentRegistry } from "../../cli/lib/project-loader.mjs";
import {
  FIXED_SIMULATION_HZ,
  createFixedSimulationClockV1
} from "./fixed-simulation-clock.mjs";

const repoRoot = path.resolve(".");
const projectDir = path.join(repoRoot, "examples", "starter.tdproj");

describe("R18 fixed simulation clock", () => {
  it("produces one state digest for low, balanced, auto and high presentation frame rates", async () => {
    const loaded = await loadContentRegistry(projectDir);
    const qualities = Object.freeze({ low: 24, balanced: 30, auto: 45, high: 60, fastDisplay: 120 });
    const results = [];

    for (const [quality, presentationFps] of Object.entries(qualities)) {
      const game = new loaded.engine.TowerDefenseGame({
        missionId: loaded.content.defaultMissionId,
        content: loaded.content,
        seed: "r18-fixed-clock"
      });
      expect(game.startNextWave(), quality).toEqual({ ok: true });

      const clock = createFixedSimulationClockV1({
        timeUnitSeconds: loaded.content.constants.timeUnitSeconds
      });
      let fixedSteps = 0;
      for (const elapsedMilliseconds of frameSchedule(12_000, presentationFps)) {
        const advanced = clock.advance(elapsedMilliseconds, 1, (units) => game.tick(units));
        fixedSteps += advanced.fixedSteps;
      }

      results.push({
        quality,
        fixedSteps,
        digest: game.getStateDigest(),
        snapshot: game.getSnapshot()
      });
    }

    expect(results.map((result) => result.fixedSteps)).toEqual(
      results.map(() => 12 * FIXED_SIMULATION_HZ)
    );
    expect(new Set(results.map((result) => result.digest)).size).toBe(1);
    expect(results.map((result) => result.snapshot)).toEqual(
      results.map(() => results[0].snapshot)
    );
  });

  it("bounds frame catch-up and engine tick units without leaking paused or malformed time", () => {
    const units = [];
    const clock = createFixedSimulationClockV1({ timeUnitSeconds: 0.1 });

    expect(clock.advance(1000, 99, (value) => units.push(value))).toMatchObject({
      schemaVersion: 1,
      fixedSteps: 3,
      engineTicks: 12
    });
    expect(units).toHaveLength(12);
    expect(units.every((value) => value > 0 && value <= 0.2)).toBe(true);

    const before = clock.read();
    expect(clock.advance(Number.NaN, 1, () => { throw new Error("must not tick"); })).toMatchObject({ fixedSteps: 0 });
    expect(clock.advance(16, 0, () => { throw new Error("must not tick"); })).toMatchObject({ fixedSteps: 0 });
    expect(clock.read()).toEqual(before);

    clock.reset();
    expect(clock.read()).toEqual({ schemaVersion: 1, fixedHz: 60, pendingMilliseconds: 0 });
    expect(() => createFixedSimulationClockV1({ timeUnitSeconds: 0 })).toThrow(/finite positive/);
    expect(() => clock.advance(20, 1, null)).toThrow(/tick must be a function/);
  });
});

function frameSchedule(durationMilliseconds, fps) {
  const frameMilliseconds = 1000 / fps;
  const schedule = [];
  let elapsed = 0;
  while (elapsed + frameMilliseconds < durationMilliseconds) {
    schedule.push(frameMilliseconds);
    elapsed += frameMilliseconds;
  }
  schedule.push(durationMilliseconds - elapsed);
  return schedule;
}
