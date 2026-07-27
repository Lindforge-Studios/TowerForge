import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as renderer from "./index.mjs";

const presentationPath = path.resolve("packages/renderer/src/line-of-sight-presentation.mjs");
const presentationSource = fs.existsSync(presentationPath)
  ? fs.readFileSync(presentationPath, "utf8")
  : "";
const indexSource = fs.readFileSync(path.resolve("packages/renderer/src/index.mjs"), "utf8");

function projector() {
  expect(renderer.projectLineOfSightAnalysis).toBeTypeOf("function");
  return renderer.projectLineOfSightAnalysis;
}

const engineAnalysis = Object.freeze({
  schemaVersion: 1,
  profileId: "deterministic_los",
  source: Object.freeze({ q: 0, r: 0 }),
  rows: Object.freeze([
    Object.freeze({ target: Object.freeze({ q: 1, r: 0 }), visible: true, reason: "clear" }),
    Object.freeze({
      target: Object.freeze({ q: 2, r: 0 }),
      visible: false,
      reason: "elevation",
      blocker: Object.freeze({
        coord: Object.freeze({ q: 1, r: 0 }),
        terrainId: "path",
        elevation: 2
      })
    })
  ]),
  coverage: Object.freeze({
    requestedTargets: 2,
    analyzedTargets: 2,
    cellInspections: 1,
    budgetExceeded: false
  })
});

describe("R3.2 renderer line-of-sight presentation contract", () => {
  it("projects only detached engine-authored analysis rows without changing their verdicts", () => {
    const before = structuredClone(engineAnalysis);
    const presentation = projector()(engineAnalysis);

    expect(presentation).toEqual({
      active: true,
      profileId: "deterministic_los",
      source: { q: 0, r: 0 },
      rows: [
        { target: { q: 1, r: 0 }, visible: true, reason: "clear" },
        {
          target: { q: 2, r: 0 },
          visible: false,
          reason: "elevation",
          blocker: { coord: { q: 1, r: 0 }, terrainId: "path", elevation: 2 }
        }
      ],
      coverage: {
        requestedTargets: 2,
        analyzedTargets: 2,
        cellInspections: 1,
        budgetExceeded: false
      }
    });
    expect(engineAnalysis).toEqual(before);
    expect(presentation).not.toBe(engineAnalysis);
  });

  it("keeps elevation presentation on runtime snapshot schema v1 and rejects profiles/snapshots as LoS analysis", () => {
    const elevationV1 = {
      schemaVersion: 1,
      defaultElevation: 0,
      overrides: [{ q: 1, r: 0, elevation: 2 }]
    };
    expect(renderer.projectElevationCues(elevationV1)).toMatchObject({ active: true });
    expect(renderer.projectElevationCues({ ...elevationV1, schemaVersion: 2 })).toBeUndefined();
    expect(projector()({ lineOfSight: { terrainBlockerTags: ["opaque"] } })).toBeUndefined();
    expect(projector()(elevationV1)).toBeUndefined();
    expect(projector()({ ...engineAnalysis, schemaVersion: 2 })).toBeUndefined();
  });

  it("exports one fail-closed projector without topology, elevation, or blocker recomputation", () => {
    expect(presentationSource).not.toBe("");
    expect(indexSource).toMatch(/export\s*\{[^}]*projectLineOfSightAnalysis[^}]*\}/s);
    expect(presentationSource).not.toMatch(
      /terrainBlockerTags|elevationAt|map\s*\.\s*line|maximumRayDistance|rayHeight|traceLineOfSight|analyzeLineOfSightTargets/
    );
  });

  it("returns undefined for hostile rows Array proxies without leaking reflection trap errors", () => {
    for (const hostileRows of [
      new Proxy([...engineAnalysis.rows], {
        ownKeys() { throw new Error("verifier-renderer-ownKeys-secret"); }
      }),
      new Proxy([...engineAnalysis.rows], {
        getPrototypeOf() { throw new Error("verifier-renderer-getPrototypeOf-secret"); }
      })
    ]) {
      let result;
      expect(() => { result = projector()({ ...engineAnalysis, rows: hostileRows }); }).not.toThrow();
      expect(result).toBeUndefined();
    }
  });
});
