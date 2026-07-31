import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as renderer from "./index.mjs";

const INACTIVE = Object.freeze({
  active: false,
  cohorts: Object.freeze([]),
  cues: Object.freeze([])
});
const SOURCE_KINDS = ["tower", "ability", "tower_script", "status", "reaction", "enemy"];

function projector() {
  expect(renderer.projectVanguardProtectionPresentation).toBeTypeOf("function");
  return renderer.projectVanguardProtectionPresentation;
}

function activeSnapshot(overrides = {}) {
  return {
    enemyBehaviors: {
      schemaVersion: 1,
      components: {},
      formations: {
        schemaVersion: 1,
        enemies: {
          "enemy-guard": { cohortId: "alpha", role: "vanguard" },
          "enemy-body": { cohortId: "alpha", role: "body" }
        },
        protection: {
          schemaVersion: 1,
          cohorts: {
            alpha: { radius: 2, sourceKinds: SOURCE_KINDS }
          }
        }
      }
    },
    lastEvents: [{
      type: "vanguardDamageIntercepted",
      cohortId: "alpha",
      protectedEnemyId: "enemy-body",
      protectedEnemyTypeId: "grunt",
      vanguardEnemyId: "enemy-guard",
      vanguardEnemyTypeId: "guard",
      sourceKind: "tower",
      requestedAmount: 20,
      originalComponentId: "weakpoint"
    }],
    ...overrides
  };
}

describe("R12.4c shared active-only vanguard protection presentation (RED)", () => {
  it("projects detached frozen binary-stable cohorts and interception cues", () => {
    const source = activeSnapshot();
    source.enemyBehaviors.formations.protection.cohorts.zeta = {
      radius: 1,
      sourceKinds: ["enemy", "tower"]
    };
    const result = projector()(source);
    expect(result).toEqual({
      active: true,
      cohorts: [
        { cohortId: "alpha", radius: 2, sourceKinds: SOURCE_KINDS },
        { cohortId: "zeta", radius: 1, sourceKinds: ["tower", "enemy"] }
      ],
      cues: [{
        cohortId: "alpha",
        protectedEnemyId: "enemy-body",
        protectedEnemyTypeId: "grunt",
        vanguardEnemyId: "enemy-guard",
        vanguardEnemyTypeId: "guard",
        sourceKind: "tower",
        requestedAmount: 20,
        originalComponentId: "weakpoint"
      }]
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.cohorts)).toBe(true);
    expect(Object.isFrozen(result.cues)).toBe(true);
    expect(result.cohorts.every(Object.isFrozen)).toBe(true);
    expect(result.cues.every(Object.isFrozen)).toBe(true);
    source.enemyBehaviors.formations.protection.cohorts.alpha.radius = 4;
    source.lastEvents[0].requestedAmount = 99;
    expect(result.cohorts[0].radius).toBe(2);
    expect(result.cues[0].requestedAmount).toBe(20);
  });

  it("is inactive without authoritative protection and fails closed on hostile or over-budget data", () => {
    expect(projector()(undefined)).toEqual(INACTIVE);
    expect(projector()({})).toEqual(INACTIVE);
    const absent = activeSnapshot();
    delete absent.enemyBehaviors.formations.protection;
    expect(projector()(absent)).toEqual(INACTIVE);
    expect(projector()({ enemyBehaviors: {
      schemaVersion: 2, components: {}, formations: { schemaVersion: 1, enemies: {}, protection: {} }
    } })).toEqual(INACTIVE);

    for (const protection of [
      { schemaVersion: 2, cohorts: {} },
      { schemaVersion: 1, cohorts: [], extra: true },
      { schemaVersion: 1, cohorts: { alpha: { radius: 0, sourceKinds: ["tower"] } } },
      { schemaVersion: 1, cohorts: { alpha: { radius: 2, sourceKinds: ["leak"] } } }
    ]) {
      const source = activeSnapshot();
      source.enemyBehaviors.formations.protection = protection;
      expect(projector()(source)).toEqual(INACTIVE);
    }

    let reads = 0;
    const cohort = { radius: 2, sourceKinds: ["tower"] };
    Object.defineProperty(cohort, "radius", {
      enumerable: true,
      get() { reads += 1; return 2; }
    });
    const accessor = activeSnapshot();
    accessor.enemyBehaviors.formations.protection.cohorts = { alpha: cohort };
    expect(projector()(accessor)).toEqual(INACTIVE);
    expect(reads).toBe(0);

    const hostile = activeSnapshot();
    hostile.enemyBehaviors.formations.protection.cohorts = new Proxy({}, {
      ownKeys() { throw new Error("hostile keys"); }
    });
    expect(() => projector()(hostile)).not.toThrow();
    expect(projector()(hostile)).toEqual(INACTIVE);

    const tooMany = activeSnapshot();
    tooMany.enemyBehaviors.formations.protection.cohorts = Object.fromEntries(
      Array.from({ length: 65 }, (_, index) => [
        `cohort-${index}`, { radius: 1, sourceKinds: ["tower"] }
      ])
    );
    expect(projector()(tooMany)).toEqual(INACTIVE);
  });

  it.each([
    ["sparse", () => {
      const value = new Array(2);
      value[0] = "tower";
      return { value };
    }],
    ["cyclic", () => {
      const value = [];
      value.push(value);
      return { value };
    }],
    ["extra-key", () => ({ value: Object.assign(["tower"], { extra: true }) })],
    ["symbol", () => {
      const value = ["tower"];
      value[Symbol("hostile")] = true;
      return { value };
    }],
    ["accessor", () => {
      const value = ["tower"];
      let reads = 0;
      Object.defineProperty(value, "0", {
        enumerable: true,
        get() { reads += 1; return "tower"; }
      });
      return { value, assertUnread: () => expect(reads).toBe(0) };
    }]
  ])("fails closed for %s sourceKinds arrays", (_name, makeValue) => {
    const source = activeSnapshot();
    const { value, assertUnread } = makeValue();
    source.enemyBehaviors.formations.protection.cohorts.alpha.sourceKinds = value;
    expect(projector()(source)).toEqual(INACTIVE);
    assertUnread?.();
  });

  it.each([
    ["sparse", (event) => {
      const value = new Array(2);
      value[0] = event;
      return { value };
    }],
    ["cyclic", (event) => {
      const value = [event];
      value.push(value);
      return { value };
    }],
    ["extra-key", (event) => ({ value: Object.assign([event], { extra: true }) })],
    ["symbol", (event) => {
      const value = [event];
      value[Symbol("hostile")] = true;
      return { value };
    }],
    ["accessor", () => {
      const value = new Array(1);
      let reads = 0;
      Object.defineProperty(value, "0", {
        enumerable: true,
        get() { reads += 1; return { type: "ignored" }; }
      });
      return { value, assertUnread: () => expect(reads).toBe(0) };
    }]
  ])("fails closed for %s lastEvents arrays", (_name, makeValue) => {
    const source = activeSnapshot();
    const { value, assertUnread } = makeValue(source.lastEvents[0]);
    source.lastEvents = value;
    expect(projector()(source)).toEqual(INACTIVE);
    assertUnread?.();
  });

  it("rejects over-budget lastEvents before reading the first out-of-budget element", () => {
    const source = activeSnapshot();
    const events = Array.from({ length: 4_097 }, () => ({ type: "ignored" }));
    let tailReads = 0;
    Object.defineProperty(events, "4096", {
      enumerable: true,
      get() { tailReads += 1; throw new Error("tail must not be read"); }
    });
    source.lastEvents = events;
    expect(() => projector()(source)).not.toThrow();
    expect(projector()(source)).toEqual(INACTIVE);
    expect(tailReads).toBe(0);
  });

  it("is shared by Canvas and generated Phaser without owning interception rules", () => {
    const sourcePath = path.resolve("packages/renderer/src/vanguard-protection-presentation.mjs");
    const canvasSource = fs.readFileSync(path.resolve("packages/renderer/src/index.mjs"), "utf8");
    const buildSource = fs.readFileSync(path.resolve("packages/cli/build.mjs"), "utf8");

    expect(fs.existsSync(sourcePath)).toBe(true);
    expect(canvasSource).toMatch(/export\s+\*\s+from\s+["']\.\/vanguard-protection-presentation\.mjs["']/);
    expect(canvasSource).toMatch(/projectVanguardProtectionPresentation\s*\(snapshot\)/);
    const phaser = buildSource.slice(buildSource.indexOf("function phaserPlayerTemplate"));
    expect(phaser).toMatch(/projectVanguardProtectionPresentation/);
    expect(phaser).toMatch(/vanguardDamageIntercepted/);

    const projectorSource = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, "utf8") : "";
    expect(projectorSource).not.toMatch(
      /DamageResolver|resolveDamage|dynamic_flow|navigation|topology|distanceBetween|nearestVanguard|shield\.current\s*[-+=]/
    );
  });
});
