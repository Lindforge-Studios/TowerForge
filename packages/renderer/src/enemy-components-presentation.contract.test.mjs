import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as renderer from "./index.mjs";

const INACTIVE = Object.freeze({ active: false, rows: Object.freeze([]) });

function projector() {
  expect(
    renderer.projectEnemyComponentsPresentation,
    "R12.1d must export one shared enemy-component projector"
  ).toBeTypeOf("function");
  return renderer.projectEnemyComponentsPresentation;
}

function component(hp, maxHp, shield) {
  return {
    hp,
    maxHp,
    ...(shield === undefined ? {} : { shield })
  };
}

function activeSnapshot(components) {
  return {
    enemyBehaviors: {
      schemaVersion: 1,
      components
    }
  };
}

describe("R12.1d shared boss-component presentation contract (RED)", () => {
  it("projects binary-stable detached rows from the authoritative active snapshot", () => {
    const source = activeSnapshot({
      "enemy-z": {
        shield_core: component(0, 20, {
          current: 0,
          capacity: 15,
          regenerationDelayRemaining: 2
        }),
        cannon: component(30, 40)
      },
      "enemy-a": {
        core: component(75, 100, {
          current: 5,
          capacity: 10,
          regenerationDelayRemaining: 0
        })
      }
    });

    const projected = projector()(source);
    expect(projected).toEqual({
      active: true,
      rows: [
        {
          enemyId: "enemy-a",
          componentId: "core",
          hp: 75,
          maxHp: 100,
          hpRatio: 0.75,
          destroyed: false,
          shield: {
            current: 5,
            capacity: 10,
            regenerationDelayRemaining: 0,
            ratio: 0.5
          }
        },
        {
          enemyId: "enemy-z",
          componentId: "cannon",
          hp: 30,
          maxHp: 40,
          hpRatio: 0.75,
          destroyed: false,
          shield: null
        },
        {
          enemyId: "enemy-z",
          componentId: "shield_core",
          hp: 0,
          maxHp: 20,
          hpRatio: 0,
          destroyed: true,
          shield: {
            current: 0,
            capacity: 15,
            regenerationDelayRemaining: 2,
            ratio: 0
          }
        }
      ]
    });
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.rows)).toBe(true);
    expect(projected.rows.every((row) => Object.isFrozen(row))).toBe(true);
    expect(Object.isFrozen(projected.rows[0].shield)).toBe(true);

    source.enemyBehaviors.components["enemy-a"].core.hp = 1;
    source.enemyBehaviors.components["enemy-a"].core.shield.current = 0;
    expect(projected.rows[0]).toMatchObject({
      hp: 75,
      shield: { current: 5 }
    });

    const reordered = activeSnapshot({
      "enemy-a": {
        core: component(75, 100, {
          current: 5,
          capacity: 10,
          regenerationDelayRemaining: 0
        })
      },
      "enemy-z": {
        cannon: component(30, 40),
        shield_core: component(0, 20, {
          current: 0,
          capacity: 15,
          regenerationDelayRemaining: 2
        })
      }
    });
    expect(projector()(reordered)).toEqual(projected);
  });

  it("fails closed for absent, future, and malformed component state", () => {
    expect(projector()(undefined)).toEqual(INACTIVE);
    expect(projector()({})).toEqual(INACTIVE);
    expect(projector()({ enemyBehaviors: { schemaVersion: 2, components: {} } })).toEqual(INACTIVE);

    for (const malformed of [
      { schemaVersion: 1, components: [], extra: true },
      { schemaVersion: 1, components: { boss: { core: component(-1, 10) } } },
      { schemaVersion: 1, components: { boss: { core: component(11, 10) } } },
      { schemaVersion: 1, components: { boss: { core: component(1, 0) } } },
      { schemaVersion: 1, components: { boss: { core: component(1, 10, null) } } },
      { schemaVersion: 1, components: { boss: { core: component(1, 10, {
        current: 6, capacity: 5, regenerationDelayRemaining: 0
      }) } } },
      { schemaVersion: 1, components: { boss: { core: {
        ...component(1, 10), unexpected: true
      } } } }
    ]) {
      expect(projector()({ enemyBehaviors: malformed })).toEqual(INACTIVE);
    }
  });

  it("never invokes accessors and contains hostile proxies", () => {
    let reads = 0;
    const accessorState = component(5, 10);
    Object.defineProperty(accessorState, "hp", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("component state accessor executed");
      }
    });
    expect(projector()(activeSnapshot({ boss: { core: accessorState } }))).toEqual(INACTIVE);
    expect(reads).toBe(0);

    const hostileComponents = new Proxy({ boss: { core: component(5, 10) } }, {
      getOwnPropertyDescriptor() { throw new Error("hostile component record"); },
      ownKeys() { throw new Error("hostile component keys"); }
    });
    const hostile = activeSnapshot(hostileComponents);
    expect(() => projector()(hostile)).not.toThrow();
    expect(projector()(hostile)).toEqual(INACTIVE);
  });

  it("rejects a root with more than the engine-authored 32 component states", () => {
    const tooMany = Object.fromEntries(Array.from({ length: 33 }, (_, index) => [
      `component-${String(index).padStart(2, "0")}`,
      component(10, 10)
    ]));
    expect(projector()(activeSnapshot({ boss: tooMany }))).toEqual(INACTIVE);
  });

  it("is one shared presentation source consumed by Canvas and generated Phaser", () => {
    const sourcePath = path.resolve("packages/renderer/src/enemy-components-presentation.mjs");
    const canvasSource = fs.readFileSync(path.resolve("packages/renderer/src/index.mjs"), "utf8");
    const buildSource = fs.readFileSync(path.resolve("packages/cli/build.mjs"), "utf8");

    expect(fs.existsSync(sourcePath)).toBe(true);
    expect(canvasSource).toMatch(
      /export\s+\*\s+from\s+["']\.\/enemy-components-presentation\.mjs["']/
    );
    expect(canvasSource).toMatch(/projectEnemyComponentsPresentation\s*\(snapshot\)/);
    expect(canvasSource).toMatch(/drawEnemy[\s\S]*enemyComponentsByEnemyId/);
    const phaser = buildSource.slice(buildSource.indexOf("function phaserPlayerTemplate"));
    expect(phaser).toMatch(/projectEnemyComponentsPresentation/);
    expect(phaser.match(/projectEnemyComponentsPresentation\s*\(/g)?.length ?? 0).toBeGreaterThanOrEqual(1);

    const projectorSource = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, "utf8") : "";
    expect(projectorSource).not.toMatch(
      /content\.mechanics|DamageResolver|TowerDefenseGame|navigation|pathProgress|target(?:ing|Mode)/
    );
  });
});
