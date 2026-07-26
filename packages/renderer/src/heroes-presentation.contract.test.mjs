import { describe, expect, it } from "vitest";
import * as Renderer from "./index.mjs";

function snapshot() {
  return {
    heroes: {
      schemaVersion: 1,
      units: [{
        id: "commander",
        definitionId: "commander",
        label: "Commander",
        coord: { q: 3, r: 1 }
      }]
    }
  };
}

function projector() {
  const project = Renderer.projectHeroesPresentation;
  expect(project, "renderer must export the shared static hero projector").toBeTypeOf("function");
  return project;
}

function revokedProxy(target) {
  const { proxy, revoke } = Proxy.revocable(target, {});
  revoke();
  return proxy;
}

describe("R5.1A shared heroes presentation", () => {
  it("projects one detached deeply frozen unit and an explicit absent sentinel", () => {
    const source = snapshot();
    const projected = projector()(source);
    expect(projected).toEqual({
      active: true,
      units: [{
        id: "commander",
        definitionId: "commander",
        label: "Commander",
        coord: { q: 3, r: 1 }
      }]
    });
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.units)).toBe(true);
    expect(Object.isFrozen(projected.units[0])).toBe(true);
    expect(Object.isFrozen(projected.units[0].coord)).toBe(true);
    source.heroes.units[0].label = "Mutated";
    source.heroes.units[0].coord.q = 0;
    expect(projected.units[0]).toMatchObject({ label: "Commander", coord: { q: 3, r: 1 } });

    expect(projector()({})).toEqual({ active: false, units: [] });
    expect(projector()(undefined)).toEqual({ active: false, units: [] });
  });

  it("fails closed on future, duplicate, multi-unit, extra-field, and accessor-backed shapes", () => {
    const project = projector();
    expect(project({ heroes: { ...snapshot().heroes, schemaVersion: 2 } })).toEqual({ active: false, units: [] });
    expect(project({ heroes: { schemaVersion: 1, units: [] } })).toEqual({ active: false, units: [] });
    expect(project({
      heroes: { schemaVersion: 1, units: [{ ...snapshot().heroes.units[0], definitionId: "other" }] }
    })).toEqual({ active: false, units: [] });
    expect(project({
      heroes: { schemaVersion: 1, units: [snapshot().heroes.units[0], snapshot().heroes.units[0]] }
    })).toEqual({ active: false, units: [] });
    expect(project({
      heroes: {
        schemaVersion: 1,
        units: [{ ...snapshot().heroes.units[0], hp: 100 }]
      }
    })).toEqual({ active: false, units: [] });

    let reads = 0;
    const hostile = Object.defineProperty({}, "label", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("SYNTHETIC_RENDERER_HERO_SECRET");
      }
    });
    expect(() => project({ heroes: { schemaVersion: 1, units: [hostile] } })).not.toThrow();
    expect(project({ heroes: { schemaVersion: 1, units: [hostile] } }))
      .toEqual({ active: false, units: [] });
    expect(reads).toBe(0);
  });

  it.each([
    ["snapshot.heroes", () => ({ heroes: revokedProxy({}) })],
    ["heroes.units", () => ({ heroes: { schemaVersion: 1, units: revokedProxy([]) } })],
    ["heroes.units[0]", () => ({
      heroes: { schemaVersion: 1, units: [revokedProxy({})] }
    })],
    ["heroes.units[0].coord", () => ({
      heroes: {
        schemaVersion: 1,
        units: [{
          id: "commander",
          definitionId: "commander",
          label: "Commander",
          coord: revokedProxy({})
        }]
      }
    })]
  ])("fails closed without throwing when %s is a revoked Proxy", (_field, makeSnapshot) => {
    const project = projector();
    const inactive = project({});
    let projected;
    expect(() => { projected = project(makeSnapshot()); }).not.toThrow();
    expect(projected).toBe(inactive);
    expect(projected).toEqual({ active: false, units: [] });
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.units)).toBe(true);
  });

  it("consumes optional visuals.bindings.heroes and otherwise has a shape fallback", () => {
    const previousImage = globalThis.Image;
    class FakeImage {
      constructor() {
        this.complete = true;
        this.naturalWidth = 32;
        this.naturalHeight = 32;
      }
      set src(value) { this._src = value; }
      get src() { return this._src; }
    }
    globalThis.Image = FakeImage;
    try {
      const drawImageCalls = [];
      const calls = [];
      const canvas = {
        width: 320,
        height: 240,
        getBoundingClientRect: () => ({ width: 320, height: 240, left: 0, top: 0 }),
        getContext: () => ({
          beginPath: () => calls.push("beginPath"),
          moveTo: () => calls.push("moveTo"),
          lineTo: () => calls.push("lineTo"),
          closePath: () => calls.push("closePath"),
          fill: () => calls.push("fill"),
          stroke: () => calls.push("stroke"),
          arc: () => calls.push("arc"),
          clearRect: () => calls.push("clearRect"),
          fillRect: () => calls.push("fillRect"),
          strokeRect: () => calls.push("strokeRect"),
          fillText: () => calls.push("fillText"),
          drawImage: (...args) => drawImageCalls.push(args),
          save: () => calls.push("save"),
          restore: () => calls.push("restore"),
          translate: () => calls.push("translate"),
          set globalAlpha(_) {},
          set fillStyle(_) {},
          set strokeStyle(_) {},
          set lineWidth(_) {},
          set font(_) {},
          set textAlign(_) {},
          set textBaseline(_) {}
        })
      };
      const renderer = Renderer.createCanvasRenderer({
        canvas,
        content: {
          towers: {},
          enemies: {},
          visuals: {
            sprites: { commander_idle: { src: "assets/commander.png" } },
            bindings: { heroes: { commander: "commander_idle" } }
          }
        }
      });
      renderer.drawSnapshot({
        mapId: "lane",
        grid: { kind: "square", adjacency: "cardinal" },
        tiles: [{ q: 3, r: 1, terrain: "buildable" }],
        temporaryWaterTiles: [],
        towers: [],
        enemies: [],
        pathCenterline: [],
        pathRoutes: [],
        spawnCoord: { q: 0, r: 1 },
        coreCoord: { q: 3, r: 1 },
        ...snapshot()
      });
      expect(drawImageCalls).toHaveLength(1);
    } finally {
      globalThis.Image = previousImage;
    }
  });

  it("does not resolve an inherited __proto__ hero binding to a tempting sprite", () => {
    const previousImage = globalThis.Image;
    class FakeImage {
      constructor() {
        this.complete = true;
        this.naturalWidth = 32;
        this.naturalHeight = 32;
      }
      set src(value) { this._src = value; }
      get src() { return this._src; }
    }
    globalThis.Image = FakeImage;
    try {
      const drawImageCalls = [];
      const calls = [];
      const canvas = {
        width: 320,
        height: 240,
        getBoundingClientRect: () => ({ width: 320, height: 240, left: 0, top: 0 }),
        getContext: () => ({
          beginPath: () => calls.push("beginPath"),
          moveTo: () => calls.push("moveTo"),
          lineTo: () => calls.push("lineTo"),
          closePath: () => calls.push("closePath"),
          fill: () => calls.push("fill"),
          stroke: () => calls.push("stroke"),
          arc: () => calls.push("arc"),
          clearRect: () => calls.push("clearRect"),
          fillRect: () => calls.push("fillRect"),
          strokeRect: () => calls.push("strokeRect"),
          fillText: (text) => calls.push(["fillText", text]),
          drawImage: (...args) => drawImageCalls.push(args),
          save: () => calls.push("save"),
          restore: () => calls.push("restore"),
          translate: () => calls.push("translate"),
          set globalAlpha(_) {},
          set fillStyle(_) {},
          set strokeStyle(_) {},
          set lineWidth(_) {},
          set font(_) {},
          set textAlign(_) {},
          set textBaseline(_) {}
        })
      };
      const renderer = Renderer.createCanvasRenderer({
        canvas,
        content: {
          towers: {},
          enemies: {},
          visuals: {
            sprites: { "[object Object]": { src: "assets/tempting-inherited-target.png" } },
            bindings: { heroes: {} }
          }
        }
      });
      renderer.drawSnapshot({
        mapId: "lane",
        grid: { kind: "square", adjacency: "cardinal" },
        tiles: [{ q: 3, r: 1, terrain: "core" }],
        temporaryWaterTiles: [],
        towers: [],
        enemies: [],
        pathCenterline: [],
        pathRoutes: [],
        spawnCoord: { q: 0, r: 1 },
        coreCoord: { q: 3, r: 1 },
        heroes: {
          schemaVersion: 1,
          units: [{
            id: "__proto__",
            definitionId: "__proto__",
            label: "Prototype Warden",
            coord: { q: 3, r: 1 }
          }]
        }
      });
      expect(drawImageCalls).toHaveLength(0);
      expect(calls).toContainEqual(["fillText", "Pr"]);
    } finally {
      globalThis.Image = previousImage;
    }
  });
});
