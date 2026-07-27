import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as renderer from "./index.mjs";

const rendererSource = fs.readFileSync(path.resolve("packages/renderer/src/index.mjs"), "utf8");
const buildSource = fs.readFileSync(path.resolve("packages/cli/build.mjs"), "utf8");

function projector() {
  expect(renderer.projectElevationCues).toBeTypeOf("function");
  return renderer.projectElevationCues;
}

describe("R3.1 elevation presentation", () => {
  it("projects detached sorted visual-only badges from the active snapshot", () => {
    const input = {
      schemaVersion: 1,
      defaultElevation: 0,
      overrides: [
        { q: 2, r: 1, elevation: -4 },
        { q: 1, r: 0, elevation: 3 }
      ]
    };
    const before = structuredClone(input);
    expect(projector()(input)).toEqual({
      active: true,
      defaultElevation: 0,
      cues: [
        { coord: { q: 1, r: 0 }, elevation: 3, label: "+3" },
        { coord: { q: 2, r: 1 }, elevation: -4, label: "-4" }
      ]
    });
    expect(input).toEqual(before);
  });

  it("memoizes a deeply-frozen presentation by immutable section identity without reinspection", () => {
    const entries = Object.freeze([
      Object.freeze({ q: 2, r: 1, elevation: -4 }),
      Object.freeze({ q: 1, r: 0, elevation: 3 })
    ]);
    const target = Object.freeze({ schemaVersion: 1, defaultElevation: 0, overrides: entries });
    let inspections = 0;
    const section = new Proxy(target, {
      getPrototypeOf(value) { inspections += 1; return Reflect.getPrototypeOf(value); },
      ownKeys(value) { inspections += 1; return Reflect.ownKeys(value); },
      getOwnPropertyDescriptor(value, key) {
        inspections += 1;
        return Reflect.getOwnPropertyDescriptor(value, key);
      }
    });

    const first = projector()(section);
    const afterFirst = inspections;
    const second = projector()(section);
    expect(second).toBe(first);
    expect(inspections).toBe(afterFirst);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first?.cues)).toBe(true);
    expect(first?.cues.every((cue) => Object.isFrozen(cue) && Object.isFrozen(cue.coord))).toBe(true);

    const changed = Object.freeze({
      schemaVersion: 1,
      defaultElevation: 0,
      overrides: Object.freeze([Object.freeze({ q: 1, r: 0, elevation: 4 })])
    });
    const recomputed = projector()(changed);
    expect(recomputed).not.toBe(first);
    expect(recomputed?.cues).toEqual([
      { coord: { q: 1, r: 0 }, elevation: 4, label: "+4" }
    ]);

    const mutable = {
      schemaVersion: 1,
      defaultElevation: 0,
      overrides: [{ q: 1, r: 0, elevation: 2 }]
    };
    const beforeMutation = projector()(mutable);
    mutable.overrides[0].elevation = 5;
    const afterMutation = projector()(mutable);
    expect(afterMutation).not.toBe(beforeMutation);
    expect(afterMutation?.cues).toEqual([
      { coord: { q: 1, r: 0 }, elevation: 5, label: "+5" }
    ]);

    const shallowEntry = { q: 1, r: 0, elevation: 6 };
    const shallowFrozen = Object.freeze({
      schemaVersion: 1,
      defaultElevation: 0,
      overrides: [shallowEntry]
    });
    const beforeNestedMutation = projector()(shallowFrozen);
    shallowEntry.elevation = 7;
    const afterNestedMutation = projector()(shallowFrozen);
    expect(afterNestedMutation).not.toBe(beforeNestedMutation);
    expect(afterNestedMutation?.cues[0]?.elevation).toBe(7);
  });

  it("keeps absent/disabled presentation allocation-free and fails closed on unsafe data", () => {
    expect(projector()(undefined)).toEqual({ active: false, cues: [] });
    expect(projector()(null)).toEqual({ active: false, cues: [] });
    for (const value of [
      { schemaVersion: 2, defaultElevation: 0, overrides: [] },
      { schemaVersion: 1, defaultElevation: 1, overrides: [] },
      { schemaVersion: 1, defaultElevation: 0, overrides: [{ q: 0, r: 0, elevation: 0 }] },
      { schemaVersion: 1, defaultElevation: 0, overrides: [{ q: 0, r: 0, elevation: 1, extra: true }] }
    ]) expect(projector()(value)).toBeUndefined();

    let calls = 0;
    const unsafe = {};
    Object.defineProperty(unsafe, "overrides", {
      enumerable: true,
      get() { calls += 1; return []; }
    });
    expect(projector()(unsafe)).toBeUndefined();
    expect(calls).toBe(0);

    expect(projector()({
      schemaVersion: 1,
      defaultElevation: 0,
      overrides: new Array(65_537)
    })).toBeUndefined();
  });

  it("uses the same visual projector in Canvas and Phaser without gameplay calculations", () => {
    expect(rendererSource).toContain("projectElevationCues");
    expect(buildSource.match(/projectElevationCues/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(`${rendererSource}\n${buildSource}`).toMatch(/elevation.*(?:badge|contour)|(?:badge|contour).*elevation/i);
    expect(`${rendererSource}\n${buildSource}`).not.toMatch(/elevation[\s\S]{0,120}(?:damage|rangeBonus|lineOfSight|\bLoS\b)/i);
  });

  it("bounds visual cue fan-out while preserving the full authored snapshot as overflow", () => {
    const overrides = Object.freeze(Array.from({ length: 65_536 }, (_, q) => Object.freeze({
      q,
      r: 0,
      elevation: q % 2 === 0 ? 1 : -1
    })));
    const section = Object.freeze({ schemaVersion: 1, defaultElevation: 0, overrides });
    const presentation = projector()(section);
    expect(presentation).toMatchObject({ active: true, overflowCount: 65_536 - 4_096 });
    expect(presentation.cues).toHaveLength(4_096);
    expect(presentation.cues[0]).toEqual({ coord: { q: 0, r: 0 }, elevation: 1, label: "+1" });
    expect(presentation.cues.at(-1)).toEqual({ coord: { q: 4_095, r: 0 }, elevation: -1, label: "-1" });
  });
});
