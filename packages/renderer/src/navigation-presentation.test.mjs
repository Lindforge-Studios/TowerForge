import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as renderer from "./index.mjs";

const rendererSource = fs.readFileSync(path.resolve("packages/renderer/src/index.mjs"), "utf8");
const buildSource = fs.readFileSync(path.resolve("packages/cli/build.mjs"), "utf8");

function projector() {
  const value = renderer.projectNavigationPlacementCues;
  expect(value, "renderer must export the shared navigation presentation projector").toBeTypeOf("function");
  return value;
}

function enemyPointProjector() {
  const value = renderer.projectEnemyNavigationPoint;
  expect(value, "renderer must export the shared enemy navigation point projector").toBeTypeOf("function");
  return value;
}

describe("R2.5 shared navigation presentation and generated players", () => {
  it("projects canonical placement rows without calculating gameplay rules", () => {
    const analysis = {
      schemaVersion: 1,
      mode: "dynamic_flow",
      profileId: "maze",
      fields: [],
      placementRows: [
        {
          coord: { q: 2, r: 1 },
          ok: false,
          reasonKey: "reason.lastPathBlocked",
          blockingPair: { movementProfileId: "ground", routeId: "main" }
        },
        { coord: { q: 1, r: 0 }, ok: true }
      ]
    };
    const before = structuredClone(analysis);
    expect(projector()(analysis)).toEqual({
      active: true,
      cues: [
        { coord: { q: 1, r: 0 }, state: "allowed" },
        {
          coord: { q: 2, r: 1 },
          state: "blocked",
          reasonKey: "reason.lastPathBlocked",
          blockingPair: { movementProfileId: "ground", routeId: "main" }
        }
      ]
    });
    expect(analysis).toEqual(before);
  });

  it("keeps absent, disabled, and authored-route presentation exactly overlay-free", () => {
    for (const value of [undefined, null]) {
      expect(projector()(value)).toEqual({ active: false, cues: [] });
    }
  });

  it("interpolates dynamic enemy points from currentCoord to nextCoord and keeps legacy fallback detached", () => {
    const enemy = {
      navigation: {
        schemaVersion: 1,
        movementProfileId: "ground",
        currentCoord: { q: 1, r: 3 },
        nextCoord: { q: 5, r: 7 },
        edgeProgress: 0.25,
        stepsEntered: 2
      }
    };
    const legacyPoint = Object.freeze({ x: 91, y: 92 });
    const coordToPoint = ({ q, r }) => ({ x: q * 10, y: r * 20 });
    const before = structuredClone(enemy);

    expect(enemyPointProjector()(enemy, legacyPoint, coordToPoint)).toEqual({ x: 20, y: 80 });
    const legacy = enemyPointProjector()({ id: "legacy" }, legacyPoint, coordToPoint);
    expect(legacy).toEqual(legacyPoint);
    expect(legacy).not.toBe(legacyPoint);
    expect(enemy).toEqual(before);
  });

  it("fails closed on future, malformed, extra, or accessor-backed navigation state", () => {
    const base = {
      schemaVersion: 1,
      movementProfileId: "ground",
      currentCoord: { q: 1, r: 2 },
      nextCoord: { q: 2, r: 2 },
      edgeProgress: 0.5,
      stepsEntered: 1
    };
    const legacyPoint = { x: 9, y: 10 };
    const project = enemyPointProjector();
    for (const navigation of [
      { ...base, schemaVersion: 2 },
      { ...base, edgeProgress: 1.1 },
      { ...base, currentCoord: { q: 1.5, r: 2 } },
      { ...base, unexpected: true }
    ]) {
      expect(project({ navigation }, legacyPoint)).toBeUndefined();
    }

    let getterCalls = 0;
    const accessorEnemy = {};
    Object.defineProperty(accessorEnemy, "navigation", {
      enumerable: true,
      get() { getterCalls += 1; return base; }
    });
    expect(project(accessorEnemy, legacyPoint)).toBeUndefined();
    expect(getterCalls).toBe(0);
  });

  it("fails closed when edge progress and coordinates violate checkpoint coherence", () => {
    const project = enemyPointProjector();
    const legacyPoint = { x: 90, y: 91 };
    const base = {
      schemaVersion: 1,
      movementProfileId: "ground",
      currentCoord: { q: 1, r: 2 },
      edgeProgress: 0,
      stepsEntered: 1
    };
    const coordToPoint = ({ q, r }) => ({ x: q * 10, y: r * 10 });

    expect(project({ navigation: { ...base, edgeProgress: 0.25 } }, legacyPoint, coordToPoint)).toBeUndefined();
    expect(project({
      navigation: { ...base, nextCoord: { ...base.currentCoord }, edgeProgress: 0.25 }
    }, legacyPoint, coordToPoint)).toBeUndefined();
    expect(project({ navigation: base }, legacyPoint, coordToPoint)).toEqual({ x: 10, y: 20 });
  });

  it("uses navigation coordinates and the same projector in Canvas and Phaser", () => {
    expect(rendererSource).toContain("projectNavigationPlacementCues");
    expect(rendererSource).toMatch(/enemy\.navigation/);
    expect(rendererSource).toMatch(/navigationOverlay|navigationCues/);
    expect(buildSource).toMatch(/projectNavigationPlacementCues/);
    expect(buildSource).toMatch(/en\.navigation|enemy\.navigation/);
    expect(buildSource.match(/projectNavigationPlacementCues/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(buildSource.match(/analyzeNavigation/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("shares enemy navigation interpolation between Canvas and Phaser without local duplicates", () => {
    expect(rendererSource).toContain("projectEnemyNavigationPoint");
    expect(rendererSource).not.toMatch(/enemy\.navigation\.(?:currentCoord|nextCoord|edgeProgress)/);
    const phaserSource = buildSource.slice(buildSource.indexOf("function phaserPlayerTemplate"));
    expect(phaserSource).toContain("projectEnemyNavigationPoint");
    expect(phaserSource).not.toMatch(/enemy\.navigation\.(?:currentCoord|nextCoord|edgeProgress)/);
  });

  it("preflights pointer and touch placement before mutation and clears or recomputes overlays", () => {
    expect(buildSource.match(/canPlaceTower/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(buildSource.match(/placeTower/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    const canvasCan = buildSource.indexOf("canPlaceTower", buildSource.indexOf("function playerTemplate"));
    const canvasPlace = buildSource.indexOf("placeTower", canvasCan);
    const phaserStart = buildSource.indexOf("function phaserPlayerTemplate");
    const phaserCan = buildSource.indexOf("canPlaceTower", phaserStart);
    const phaserPlace = buildSource.indexOf("placeTower", phaserCan);
    expect(canvasCan).toBeGreaterThanOrEqual(0);
    expect(canvasPlace).toBeGreaterThan(canvasCan);
    expect(phaserCan).toBeGreaterThanOrEqual(0);
    expect(phaserPlace).toBeGreaterThan(phaserCan);
    expect(buildSource).toMatch(/pointer(?:down|move)/);
    expect(buildSource).toMatch(/touch-action/);
    expect(buildSource.match(/refreshNavigationOverlay/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(buildSource.match(/clearNavigationOverlay/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(buildSource).toMatch(/reason\.lastPathBlocked/);
  });

  it("invalidates stationary placement cues from tower placement state in both generated players", () => {
    const canvasStart = buildSource.indexOf("function playerTemplate");
    const phaserStart = buildSource.indexOf("function phaserPlayerTemplate");
    expect(canvasStart).toBeGreaterThanOrEqual(0);
    expect(phaserStart).toBeGreaterThan(canvasStart);
    const templates = {
      Canvas: buildSource.slice(canvasStart, phaserStart),
      Phaser: buildSource.slice(phaserStart)
    };

    for (const [name, template] of Object.entries(templates)) {
      const revisionStart = template.indexOf("function navigationSnapshotRevision");
      const refreshStart = template.indexOf("function refreshNavigationOverlay", revisionStart);
      const cacheContract = template.slice(revisionStart, refreshStart);
      expect(revisionStart, `${name} must expose a deterministic navigation overlay cache key`).toBeGreaterThanOrEqual(0);
      expect(refreshStart, `${name} must refresh from that cache key`).toBeGreaterThan(revisionStart);
      expect(cacheContract, `${name} cache invalidation must include tower placement state even when flow-field revisions stay stable`)
        .toMatch(/snapshot\.(?:towers|towerStates)[\s\S]{0,500}(?:typeId|towerTypeId)[\s\S]{0,500}(?:coord|\.q|\.r)/);
    }
  });

  it("keeps Canvas and Phaser per-frame overlay checks allocation-free and exact", () => {
    const canvasStart = buildSource.indexOf("function playerTemplate");
    const phaserStart = buildSource.indexOf("function phaserPlayerTemplate");
    const templates = {
      Canvas: buildSource.slice(canvasStart, phaserStart),
      Phaser: buildSource.slice(phaserStart)
    };

    for (const [name, template] of Object.entries(templates)) {
      const revisionStart = template.indexOf("function navigationSnapshotRevision");
      const syncStart = template.indexOf("function syncNavigationOverlaySnapshot", revisionStart);
      const refreshStart = template.indexOf("function refreshNavigationOverlay", syncStart);
      const fingerprint = template.slice(revisionStart, syncStart);
      const perFrameCheck = template.slice(revisionStart, refreshStart);
      const legacyExit = fingerprint.search(/navigation[^\n]*dynamic_flow[^\n]*return\s+["']{2}/);
      const towerRead = fingerprint.search(/snapshot\.(?:towers|towerStates)/);

      expect(legacyExit, `${name} must retain an early absent/disabled/authored-routes exit`).toBeGreaterThanOrEqual(0);
      expect(towerRead).toBeGreaterThan(legacyExit);
      expect(fingerprint, `${name} must not allocate/sort/serialize every tower on each animation-frame snapshot`)
        .not.toMatch(/\.sort\s*\(|JSON\.stringify|snapshot\.(?:towers|towerStates)\s*\.map\s*\(/);
      expect(perFrameCheck, `${name} must not build a variable-size concatenated tower key every frame`)
        .not.toMatch(/(?:let|var)\s+[A-Za-z_$][\w$]*(?:State|Key|Fingerprint)\s*=\s*["']{2}|for\s*\([^)]*(?:tower|towers)[^)]*\)\s*\{[\s\S]{0,1200}\+=/);

      const usesEnginePlacementRevision = /(?:tower|placement)[A-Za-z]*Revision/.test(perFrameCheck);
      if (!usesEnginePlacementRevision) {
        const retainedState = template.match(/(?:let|var)\s+(navigation(?:Overlay)?(?:Tower)?PlacementState)\b/)?.[1];
        expect(retainedState, `${name} must retain placement state captured only when the overlay refreshes`).toBeTruthy();
        expect(perFrameCheck, `${name} retained-state comparison must read every exact placement field`)
          .toMatch(/tower\.id[\s\S]{0,1000}tower\.typeId[\s\S]{0,1000}tower\.coord\.q[\s\S]{0,1000}tower\.coord\.r/);
        expect(perFrameCheck.match(/(?:===|!==|Object\.is)/g)?.length ?? 0,
          `${name} must compare id/type/q/r rather than use a collision-prone aggregate hash`).toBeGreaterThanOrEqual(4);
        const retainedCapture = new RegExp(`${retainedState}\\s*=|capture[A-Za-z]*(?:Tower|Placement)[A-Za-z]*State`);
        expect(template.slice(refreshStart, refreshStart + 2500), `${name} may allocate the retained exact state only on overlay refresh`)
          .toMatch(retainedCapture);
      }
    }
  });
});
