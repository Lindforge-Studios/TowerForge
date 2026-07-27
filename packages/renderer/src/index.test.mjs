import { describe, expect, it } from "vitest";
import * as rendererModule from "./index.mjs";

const { createCanvasRenderer, MAX_BACKBUFFER_PX } = rendererModule;

describe("canvas renderer backbuffer cap (mobile hardening)", () => {
  function sizedCanvas(cssW, cssH) {
    return { width: 0, height: 0, getBoundingClientRect: () => ({ width: cssW, height: cssH, left: 0, top: 0 }), getContext: () => ({}) };
  }

  it("caps the backbuffer on a high-DPR phone so cheap GPUs don't OOM", () => {
    const prev = globalThis.devicePixelRatio;
    globalThis.devicePixelRatio = 3; // e.g. a 412x915 CSS viewport at dpr 3 = ~3.4M px uncapped
    try {
      const canvas = sizedCanvas(412, 915);
      createCanvasRenderer({ canvas, content: { towers: {}, enemies: {} } }).resize();
      expect(canvas.width * canvas.height).toBeLessThanOrEqual(MAX_BACKBUFFER_PX + 4000);
      // ...but never below the CSS resolution (scale >= 1), so it's never blurrier than 1:1.
      expect(canvas.width).toBeGreaterThanOrEqual(412);
      expect(canvas.height).toBeGreaterThanOrEqual(915);
    } finally {
      globalThis.devicePixelRatio = prev;
    }
  });

  it("keeps full device-pixel-ratio when the backbuffer already fits under the cap", () => {
    const prev = globalThis.devicePixelRatio;
    globalThis.devicePixelRatio = 2; // 600x400 CSS * dpr 2 = 960k px < cap
    try {
      const canvas = sizedCanvas(600, 400);
      createCanvasRenderer({ canvas, content: { towers: {}, enemies: {} } }).resize();
      expect(canvas.width).toBe(1200);
      expect(canvas.height).toBe(800);
    } finally {
      globalThis.devicePixelRatio = prev;
    }
  });

  it("picks the tile under the CSS pointer when the effective DPR is capped", () => {
    const prev = globalThis.devicePixelRatio;
    globalThis.devicePixelRatio = 3;
    try {
      const cssW = 1000;
      const cssH = 800;
      const canvas = sizedCanvas(cssW, cssH);
      const renderer = createCanvasRenderer({ canvas, content: { towers: {}, enemies: {} } });
      renderer.resize();

      const tiles = Array.from({ length: 6 }, (_, q) => ({ q, r: 0 }));
      const target = tiles[4];
      const center = renderer.center(target, renderer.geometry(tiles));
      const event = {
        clientX: center.x / (canvas.width / cssW),
        clientY: center.y / (canvas.height / cssH)
      };

      expect(canvas.width / cssW).toBeLessThan(globalThis.devicePixelRatio);
      expect(renderer.pickTile(event, tiles)).toEqual({ q: 4, r: 0 });
    } finally {
      globalThis.devicePixelRatio = prev;
    }
  });
});

describe("canvas renderer contract", () => {
  it("draws a render snapshot without owning simulation state", () => {
    const calls = [];
    const canvas = {
      width: 320,
      height: 240,
      getBoundingClientRect: () => ({ width: 320, height: 240, left: 0, top: 0 }),
      getContext: () => fakeContext(calls)
    };
    const renderer = createCanvasRenderer({
      canvas,
      content: {
        towers: { arrow: { label: "Arrow" } },
        enemies: { crawler: { color: 0x88aa66 } }
      }
    });

    renderer.resize();
    renderer.drawSnapshot({
      tiles: [{ q: 0, r: 0, terrain: "buildable" }, { q: 1, r: 0, terrain: "path" }],
      temporaryWaterTiles: [],
      towers: [{ coord: { q: 0, r: 0 }, typeId: "arrow" }],
      enemies: [{ typeId: "crawler", hp: 3, maxHp: 5, pathProgress: 0 }],
      pathCenterline: [{ q: 1, r: 0 }, { q: 1, r: 1 }],
      pathRoutes: [],
      spawnCoord: { q: 1, r: 0 }
    });

    expect(calls).toContain("fillRect");
    expect(calls).toContain("arc");
    expect(calls).toContain("fillText");
  });

  it("draws an atlas-frame sprite as a sub-rectangle of the atlas image", () => {
    const prevImage = globalThis.Image;
    class FakeImage {
      constructor() { this.complete = true; this.naturalWidth = 64; this.naturalHeight = 64; }
      set src(v) { this._src = v; }
      get src() { return this._src; }
    }
    globalThis.Image = FakeImage;
    try {
      const drawImageCalls = [];
      const canvas = {
        width: 320,
        height: 240,
        getBoundingClientRect: () => ({ width: 320, height: 240, left: 0, top: 0 }),
        getContext: () => ({ ...fakeContext([]), drawImage: (...args) => drawImageCalls.push(args) })
      };
      const renderer = createCanvasRenderer({
        assetBase: "/project-file/",
        canvas,
        content: {
          towers: { arrow: { label: "Arrow" } },
          enemies: {},
          visuals: {
            atlases: { sheet: { src: "assets/sheet.png" } },
            sprites: { hero: { atlas: "sheet", frame: { x: 16, y: 32, w: 8, h: 8 } } },
            bindings: { towers: { arrow: "hero" } }
          }
        }
      });

      renderer.resize();
      renderer.drawSnapshot({
        tiles: [{ q: 0, r: 0, terrain: "buildable" }],
        temporaryWaterTiles: [],
        towers: [{ coord: { q: 0, r: 0 }, typeId: "arrow" }],
        enemies: [],
        pathCenterline: [],
        pathRoutes: [],
        spawnCoord: { q: 0, r: 0 }
      });

      const frameDraw = drawImageCalls.find((a) => a.length === 9);
      expect(frameDraw).toBeTruthy();
      expect(frameDraw.slice(1, 5)).toEqual([16, 32, 8, 8]);
    } finally {
      globalThis.Image = prevImage;
    }
  });

  it("never feeds a negative or non-finite frame offset into drawImage", () => {
    const prevImage = globalThis.Image;
    class FakeImage {
      constructor() { this.complete = true; this.naturalWidth = 64; this.naturalHeight = 64; }
      set src(v) { this._src = v; }
      get src() { return this._src; }
    }
    globalThis.Image = FakeImage;
    try {
      const drawImageCalls = [];
      const canvas = {
        width: 320,
        height: 240,
        getBoundingClientRect: () => ({ width: 320, height: 240, left: 0, top: 0 }),
        getContext: () => ({ ...fakeContext([]), drawImage: (...args) => drawImageCalls.push(args) })
      };
      const renderer = createCanvasRenderer({
        assetBase: "/project-file/",
        canvas,
        content: {
          towers: { arrow: { label: "Arrow" } },
          enemies: {},
          visuals: {
            atlases: { sheet: { src: "assets/sheet.png" } },
            sprites: { bad: { atlas: "sheet", frame: { x: -8, y: 0, w: 16, h: 16 } } },
            bindings: { towers: { arrow: "bad" } }
          }
        }
      });

      renderer.resize();
      renderer.drawSnapshot({
        tiles: [{ q: 0, r: 0, terrain: "buildable" }],
        temporaryWaterTiles: [],
        towers: [{ coord: { q: 0, r: 0 }, typeId: "arrow" }],
        enemies: [],
        pathCenterline: [],
        pathRoutes: [],
        spawnCoord: { q: 0, r: 0 }
      });

      // A negative frame offset resolves to null → shape fallback, so no 9-arg sub-rect draw happens.
      expect(drawImageCalls.some((a) => a.length === 9)).toBe(false);
    } finally {
      globalThis.Image = prevImage;
    }
  });
});

describe("opt-in shield presentation contract", () => {
  const shieldSnapshot = (combat) => ({
    tiles: [{ q: 0, r: 0, terrain: "buildable" }, { q: 1, r: 0, terrain: "path" }],
    temporaryWaterTiles: [],
    towers: [{ id: "tower-1", coord: { q: 0, r: 0 }, typeId: "arrow" }],
    enemies: [{ id: "enemy-1", typeId: "crawler", hp: 3, maxHp: 5, pathProgress: 0 }],
    pathCenterline: [{ q: 1, r: 0 }, { q: 1, r: 1 }],
    pathRoutes: [],
    spawnCoord: { q: 1, r: 0 },
    ...(combat === undefined ? {} : { combat })
  });

  const combat = (enemies = {}, towers = {}) => ({
    schemaVersion: 1,
    shields: { enemies, towers }
  });

  const state = (current, capacity, regenerationDelayRemaining = 0) => ({
    current,
    capacity,
    regenerationDelayRemaining
  });

  const malformedTerminalCoordinates = [
    ["fractional", { q: 0.5, r: 1 }],
    ["unsafe integer", { q: Number.MAX_SAFE_INTEGER + 1, r: 1 }],
    ["over presentation budget", { q: 1_000_001, r: 1 }]
  ];

  function drawCalls(snapshot) {
    const calls = [];
    const canvas = {
      width: 320,
      height: 240,
      getBoundingClientRect: () => ({ width: 320, height: 240, left: 0, top: 0 }),
      getContext: () => fakeContext(calls)
    };
    const renderer = createCanvasRenderer({
      canvas,
      content: {
        towers: { arrow: { label: "Arrow" } },
        enemies: { crawler: { color: 0x88aa66 } }
      }
    });
    renderer.drawSnapshot(snapshot);
    return calls;
  }

  function rendererHarness() {
    const canvas = {
      width: 320,
      height: 240,
      getBoundingClientRect: () => ({ width: 320, height: 240, left: 0, top: 0 }),
      getContext: () => fakeContext([])
    };
    return createCanvasRenderer({
      canvas,
      content: {
        towers: { arrow: { label: "Arrow" } },
        enemies: { crawler: { color: 0x88aa66 } }
      }
    });
  }

  it("resolves enemy and tower shield state from the optional combat snapshot only", () => {
    const snapshot = shieldSnapshot(combat(
      { "enemy-1": state(5, 10, 2) },
      { "tower-1": state(12, 20) }
    ));

    expect(rendererModule.resolveShieldPresentation(snapshot, "enemy", "enemy-1")).toEqual({
      current: 5,
      capacity: 10,
      ratio: 0.5,
      regenerationDelayRemaining: 2
    });
    expect(rendererModule.resolveShieldPresentation(snapshot, "tower", "tower-1")).toEqual({
      current: 12,
      capacity: 20,
      ratio: 0.6,
      regenerationDelayRemaining: 0
    });
    expect(rendererModule.resolveShieldPresentation(snapshot, "enemy", "missing")).toBeNull();
    expect(rendererModule.resolveShieldPresentation(shieldSnapshot(), "enemy", "enemy-1")).toBeNull();
  });

  it("clamps presentation ratios and fails closed for malformed snapshot data", () => {
    expect(rendererModule.resolveShieldPresentation(
      shieldSnapshot(combat({ "enemy-1": state(15, 10) })), "enemy", "enemy-1"
    )?.ratio).toBe(1);
    expect(rendererModule.resolveShieldPresentation(
      shieldSnapshot(combat({ "enemy-1": state(-5, 10) })), "enemy", "enemy-1"
    )?.ratio).toBe(0);

    for (const malformed of [
      null,
      state(Number.NaN, 10),
      state(5, 0),
      state(5, Number.POSITIVE_INFINITY),
      { current: 5, capacity: 10, regenerationDelayRemaining: -1 }
    ]) {
      const snapshot = shieldSnapshot(combat({ "enemy-1": malformed }));
      expect(() => rendererModule.resolveShieldPresentation(snapshot, "enemy", "enemy-1")).not.toThrow();
      expect(rendererModule.resolveShieldPresentation(snapshot, "enemy", "enemy-1")).toBeNull();
    }

    const accessorRecord = {};
    Object.defineProperty(accessorRecord, "enemy-1", {
      enumerable: true,
      get() { throw new Error("renderer must not invoke snapshot accessors"); }
    });
    expect(() => rendererModule.resolveShieldPresentation(
      shieldSnapshot(combat(accessorRecord)), "enemy", "enemy-1"
    )).not.toThrow();
    expect(rendererModule.resolveShieldPresentation(
      shieldSnapshot(combat(accessorRecord)), "enemy", "enemy-1"
    )).toBeNull();
  });

  it("uses own prototype-safe entity IDs", () => {
    const enemies = Object.create(null);
    Object.defineProperty(enemies, "__proto__", {
      value: state(4, 8), enumerable: true, configurable: true, writable: true
    });
    const inherited = Object.create({ inherited: state(7, 9) });

    expect(rendererModule.resolveShieldPresentation(
      shieldSnapshot(combat(enemies)), "enemy", "__proto__"
    )?.ratio).toBe(0.5);
    expect(rendererModule.resolveShieldPresentation(
      shieldSnapshot(combat(inherited)), "enemy", "inherited"
    )).toBeNull();
  });

  it("draws each present shield while preserving the exact legacy no-shield draw path", () => {
    const legacy = drawCalls(shieldSnapshot());
    const explicitEmpty = drawCalls(shieldSnapshot(combat()));
    const enemyShield = drawCalls(shieldSnapshot(combat({ "enemy-1": state(5, 10) })));
    const bothShields = drawCalls(shieldSnapshot(combat(
      { "enemy-1": state(5, 10) },
      { "tower-1": state(8, 10) }
    )));

    expect(explicitEmpty).toEqual(legacy);
    expect(enemyShield.length).toBeGreaterThan(legacy.length);
    expect(bothShields.length).toBeGreaterThan(enemyShield.length);
  });

  it("retains enemy and tower break cues for one frame after both entities leave the snapshot", () => {
    const canvas = {
      width: 320,
      height: 240,
      getBoundingClientRect: () => ({ width: 320, height: 240, left: 0, top: 0 }),
      getContext: () => fakeContext([])
    };
    const renderer = createCanvasRenderer({
      canvas,
      content: {
        towers: { arrow: { label: "Arrow" } },
        enemies: { crawler: { color: 0x88aa66 } }
      }
    });
    renderer.drawSnapshot(shieldSnapshot(combat(
      { "enemy-1": state(5, 10) },
      { "tower-1": state(8, 10) }
    )));

    renderer.drawSnapshot({
      ...shieldSnapshot(),
      enemies: [],
      towers: [],
      lastEvents: [
        {
          type: "enemyShieldChanged",
          enemyId: "enemy-1",
          enemyTypeId: "crawler",
          cause: "damage",
          previous: 5,
          current: 0,
          capacity: 10,
          amount: 5
        },
        {
          type: "towerShieldChanged",
          towerId: "tower-1",
          towerTypeId: "arrow",
          cause: "damage",
          previous: 8,
          current: 0,
          capacity: 10,
          amount: 8
        }
      ]
    });

    expect(renderer.effects.filter((effect) => effect.kind === "shield").map((effect) => effect.cause)).toEqual([
      "break",
      "break"
    ]);
  });

  it("places a terminal enemy shield break at spawn on the first frame without combat or entities", () => {
    const renderer = rendererHarness();
    const terminal = {
      ...shieldSnapshot(),
      enemies: [],
      towers: [],
      lastEvents: [{
        type: "enemyShieldChanged",
        enemyId: "removed-enemy",
        enemyTypeId: "crawler",
        cause: "damage",
        previous: 5,
        current: 0,
        capacity: 10,
        amount: 5
      }]
    };
    renderer.drawSnapshot(terminal);

    const expected = renderer.center(terminal.spawnCoord, renderer.geometry(terminal.tiles));
    const effects = renderer.effects.filter((effect) => effect.kind === "shield");
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({ cause: "break" });
    expect(effects[0].x).toBeCloseTo(expected.x);
    expect(effects[0].y).toBeCloseTo(expected.y);
  });

  it("places a terminal tower shield break at its safely projected towerPlaced coordinate", () => {
    const renderer = rendererHarness();
    const placementCoord = { q: 0, r: 0 };
    const terminal = {
      ...shieldSnapshot(),
      enemies: [],
      towers: [],
      lastEvents: [
        { type: "towerPlaced", towerId: "removed-tower", coord: placementCoord },
        {
          type: "towerShieldChanged",
          towerId: "removed-tower",
          towerTypeId: "arrow",
          cause: "damage",
          previous: 8,
          current: 0,
          capacity: 10,
          amount: 8
        }
      ]
    };
    renderer.drawSnapshot(terminal);

    const expected = renderer.center(placementCoord, renderer.geometry(terminal.tiles));
    const effects = renderer.effects.filter((effect) => effect.kind === "shield");
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({ cause: "break" });
    expect(effects[0].x).toBeCloseTo(expected.x);
    expect(effects[0].y).toBeCloseTo(expected.y);
  });

  it.each(malformedTerminalCoordinates)("fails closed for a %s terminal spawn coordinate", (_label, malformedCoord) => {
    const enemyRenderer = rendererHarness();
    const enemyTerminal = {
      ...shieldSnapshot(),
      spawnCoord: malformedCoord,
      enemies: [],
      towers: [],
      lastEvents: [{
        type: "enemyShieldChanged",
        enemyId: "removed-enemy",
        cause: "damage",
        previous: 5,
        current: 0,
        capacity: 10,
        amount: 5
      }]
    };
    expect(() => enemyRenderer.drawSnapshot(enemyTerminal)).not.toThrow();
    expect(enemyRenderer.effects.some((effect) => effect.kind === "shield")).toBe(false);
  });

  it.each(malformedTerminalCoordinates)("fails closed for a %s terminal tower placement", (_label, malformedCoord) => {
    const towerRenderer = rendererHarness();
    const towerTerminal = {
      ...shieldSnapshot(),
      enemies: [],
      towers: [],
      lastEvents: [
        { type: "towerPlaced", towerId: "removed-tower", coord: malformedCoord },
        {
          type: "towerShieldChanged",
          towerId: "removed-tower",
          cause: "damage",
          previous: 8,
          current: 0,
          capacity: 10,
          amount: 8
        }
      ]
    };
    expect(() => towerRenderer.drawSnapshot(towerTerminal)).not.toThrow();
    expect(towerRenderer.effects.some((effect) => effect.kind === "shield")).toBe(false);
  });

  it("does not invoke coordinate accessors for malformed terminal fallbacks", () => {
    let accessorReads = 0;
    const malformedCoord = { r: 1 };
    Object.defineProperty(malformedCoord, "q", {
      enumerable: true,
      get() {
        accessorReads += 1;
        throw new Error("Canvas must not invoke terminal coordinate accessors");
      }
    });

    const enemyRenderer = rendererHarness();
    const enemyTerminal = {
      ...shieldSnapshot(),
      spawnCoord: malformedCoord,
      enemies: [],
      towers: [],
      lastEvents: [{
        type: "enemyShieldChanged",
        enemyId: "removed-enemy",
        cause: "damage",
        previous: 5,
        current: 0,
        capacity: 10,
        amount: 5
      }]
    };
    expect(() => enemyRenderer.drawSnapshot(enemyTerminal)).not.toThrow();
    expect(enemyRenderer.effects.some((effect) => effect.kind === "shield")).toBe(false);

    const towerRenderer = rendererHarness();
    const towerTerminal = {
      ...shieldSnapshot(),
      enemies: [],
      towers: [],
      lastEvents: [
        { type: "towerPlaced", towerId: "removed-tower", coord: malformedCoord },
        {
          type: "towerShieldChanged",
          towerId: "removed-tower",
          cause: "damage",
          previous: 8,
          current: 0,
          capacity: 10,
          amount: 8
        }
      ]
    };
    expect(() => towerRenderer.drawSnapshot(towerTerminal)).not.toThrow();
    expect(towerRenderer.effects.some((effect) => effect.kind === "shield")).toBe(false);
    expect(accessorReads).toBe(0);
  });
});

function fakeContext(calls) {
  return {
    beginPath: () => calls.push("beginPath"),
    moveTo: () => calls.push("moveTo"),
    lineTo: () => calls.push("lineTo"),
    closePath: () => calls.push("closePath"),
    fill: () => calls.push("fill"),
    stroke: () => calls.push("stroke"),
    arc: () => calls.push("arc"),
    clearRect: () => calls.push("clearRect"),
    fillRect: () => calls.push("fillRect"),
    fillText: () => calls.push("fillText"),
    drawImage: () => calls.push("drawImage"),
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    translate: () => calls.push("translate"),
    set globalAlpha(_) {},
    set fillStyle(_) {},
    set strokeStyle(_) {},
    set font(_) {},
    set textAlign(_) {},
    set textBaseline(_) {}
  };
}
