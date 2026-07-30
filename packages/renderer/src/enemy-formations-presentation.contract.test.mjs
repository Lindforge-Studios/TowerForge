import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as renderer from "./index.mjs";

const INACTIVE = Object.freeze({ active: false, rows: Object.freeze([]) });

function projector() {
  expect(renderer.projectEnemyFormationsPresentation).toBeTypeOf("function");
  return renderer.projectEnemyFormationsPresentation;
}

function activeSnapshot(enemies) {
  return {
    enemyBehaviors: {
      schemaVersion: 1,
      components: {},
      formations: { schemaVersion: 1, enemies }
    }
  };
}

describe("R12.3 shared active-only formation presentation (RED)", () => {
  it("projects detached frozen binary-stable cohort/role rows from the authoritative snapshot", () => {
    const source = activeSnapshot({
      "enemy-z": { cohortId: "line", role: "support" },
      "enemy-a": { cohortId: "line", role: "vanguard" },
      "enemy-m": { cohortId: "line", role: "body" }
    });
    const result = projector()(source);
    expect(result).toEqual({
      active: true,
      rows: [
        { enemyId: "enemy-a", cohortId: "line", role: "vanguard" },
        { enemyId: "enemy-m", cohortId: "line", role: "body" },
        { enemyId: "enemy-z", cohortId: "line", role: "support" }
      ]
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.rows)).toBe(true);
    expect(result.rows.every(Object.isFrozen)).toBe(true);
    source.enemyBehaviors.formations.enemies["enemy-a"].role = "support";
    expect(result.rows[0].role).toBe("vanguard");

    expect(projector()(activeSnapshot({
      "enemy-m": { role: "body", cohortId: "line" },
      "enemy-z": { role: "support", cohortId: "line" },
      "enemy-a": { role: "vanguard", cohortId: "line" }
    }))).toEqual(result);
  });

  it("fails closed for absent, future, malformed, accessor, proxy, and over-budget input", () => {
    expect(projector()(undefined)).toEqual(INACTIVE);
    expect(projector()({})).toEqual(INACTIVE);
    expect(projector()({ enemyBehaviors: { schemaVersion: 2, components: {}, formations: { schemaVersion: 1, enemies: {} } } })).toEqual(INACTIVE);
    expect(projector()({ enemyBehaviors: { schemaVersion: 1, components: {}, formations: { schemaVersion: 2, enemies: {} } } })).toEqual(INACTIVE);
    for (const formations of [
      { schemaVersion: 1, enemies: [], extra: true },
      { schemaVersion: 1, enemies: { enemy: { cohortId: "line", role: "leader" } } },
      { schemaVersion: 1, enemies: { enemy: { cohortId: "", role: "body" } } },
      { schemaVersion: 1, enemies: { enemy: { cohortId: "line", role: "body", extra: true } } }
    ]) {
      expect(projector()({ enemyBehaviors: { schemaVersion: 1, components: {}, formations } })).toEqual(INACTIVE);
    }

    let reads = 0;
    const row = { cohortId: "line", role: "body" };
    Object.defineProperty(row, "role", { enumerable: true, get() { reads += 1; return "body"; } });
    expect(projector()(activeSnapshot({ enemy: row }))).toEqual(INACTIVE);
    expect(reads).toBe(0);

    const hostile = new Proxy({}, { ownKeys() { throw new Error("hostile keys"); } });
    expect(() => projector()(activeSnapshot(hostile))).not.toThrow();
    expect(projector()(activeSnapshot(hostile))).toEqual(INACTIVE);

    const tooMany = Object.fromEntries(Array.from({ length: 4097 }, (_, index) => [
      `enemy-${index}`, { cohortId: "line", role: "body" }
    ]));
    expect(projector()(activeSnapshot(tooMany))).toEqual(INACTIVE);
  });

  it("is shared by Canvas and generated Phaser without owning steering rules", () => {
    const sourcePath = path.resolve("packages/renderer/src/enemy-formations-presentation.mjs");
    const canvasSource = fs.readFileSync(path.resolve("packages/renderer/src/index.mjs"), "utf8");
    const buildSource = fs.readFileSync(path.resolve("packages/cli/build.mjs"), "utf8");

    expect(fs.existsSync(sourcePath)).toBe(true);
    expect(canvasSource).toMatch(/export\s+\*\s+from\s+["']\.\/enemy-formations-presentation\.mjs["']/);
    expect(canvasSource).toMatch(/projectEnemyFormationsPresentation\s*\(snapshot\)/);
    expect(canvasSource).toMatch(/drawEnemy[\s\S]*enemyFormationsByEnemyId/);
    const phaser = buildSource.slice(buildSource.indexOf("function phaserPlayerTemplate"));
    expect(phaser).toMatch(/projectEnemyFormationsPresentation/);
    expect(phaser).toMatch(/enemyFormationsByEnemyId/);

    const projectorSource = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, "utf8") : "";
    expect(projectorSource).not.toMatch(
      /content\.mechanics|dynamic_flow|navigation|neighbor|cohesion|separation|roleWeight|steering|pathProgress/
    );
  });
});
