import { describe, expect, it } from "vitest";
import { createDefaultPlayerActionDescriptors } from "./player-actions.mjs";
import { validateHudCatalogV1 } from "./hud-catalog.mjs";
import {
  HUD_LAYOUT_SCHEMA_VERSION,
  HUD_SELECTOR_DESCRIPTOR_SCHEMA_VERSION,
  compileHudLayoutV1
} from "./hud-layout.mjs";

function nullRecord(entries = []) {
  const record = Object.create(null);
  for (const [key, value] of entries) {
    Object.defineProperty(record, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
  return record;
}

function node(id, type, properties = {}, childIds = [], bindings = { data: [], actions: [] }) {
  return {
    schemaVersion: 1,
    id,
    type,
    childIds,
    properties,
    bindings,
    states: {
      normal: { visible: true, enabled: true },
      disabled: { visible: true, enabled: false },
      selected: { visible: true, enabled: true }
    }
  };
}

function size(width, height, overrides = {}) {
  return {
    width,
    height,
    minWidth: Math.min(width, 44),
    minHeight: Math.min(height, 44),
    maxWidth: Math.max(width, 44),
    maxHeight: Math.max(height, 44),
    ...overrides
  };
}

function anchorLayout(width, height, overrides = {}) {
  return {
    schemaVersion: 1,
    layer: "content",
    safeArea: true,
    placement: {
      kind: "anchor",
      horizontal: "left",
      vertical: "top",
      offsetX: 0,
      offsetY: 0
    },
    size: size(width, height),
    ...overrides
  };
}

function flowLayout(width, height, order) {
  return {
    schemaVersion: 1,
    layer: "content",
    safeArea: true,
    placement: { kind: "flow", order, grow: 0 },
    size: size(width, height)
  };
}

function layoutVariant(width, height, layouts, rootNodeIds = ["root"]) {
  return {
    schemaVersion: 1,
    designViewport: { width, height },
    rootNodeIds,
    layouts
  };
}

function selectors() {
  return [
    { schemaVersion: 1, id: "playerGold", valueType: "number", cardinality: "one" },
    { schemaVersion: 1, id: "waveProgress", valueType: "number", cardinality: "one" },
    { schemaVersion: 1, id: "buildOptions", valueType: "item", cardinality: "many" },
    { schemaVersion: 1, id: "questItems", valueType: "item", cardinality: "many" }
  ];
}

function runtimeState(overrides = {}) {
  return {
    selectors: {
      playerGold: 500,
      waveProgress: 0.25,
      buildOptions: [
        { id: "cannon", labelKey: "tower.cannon", enabled: true },
        { id: "frost", labelKey: "tower.frost", enabled: true }
      ],
      questItems: [{ id: "quest_1", labelKey: "quest.one", enabled: true }]
    },
    nodeStates: {},
    ...overrides
  };
}

function hudProfile() {
  const commonNodes = [
    node("root", "stack", { axis: "horizontal", gap: 8, align: "center" }, [
      "title", "gold", "progress", "start", "build", "radial", "quests"
    ]),
    node("title", "localized_text", { messageId: "hud.wave" }),
    node("gold", "counter", { format: "integer" }, [], {
      data: [{ slot: "value", selectorId: "playerGold" }],
      actions: []
    }),
    node("progress", "progress_bar", { min: 0, max: 1 }, [], {
      data: [{ slot: "value", selectorId: "waveProgress" }],
      actions: []
    }),
    node("start", "button", { labelKey: "hud.start_wave", ariaLabelKey: "hud.start_wave" }, [], {
      data: [],
      actions: [{ event: "activate", actionId: "startWave", payload: {} }]
    }),
    node("build", "build_menu", { presentation: "horizontal_quickbar", selectorId: "buildOptions" }),
    node("radial", "radial_menu", { selectorId: "buildOptions", maxVisibleItems: 8 }),
    node("quests", "repeater", { selectorId: "questItems", maxItems: 16, itemTemplateNodeId: "quest_label" }),
    node("quest_label", "text", { text: "Quest" })
  ];
  const layouts = {
    root: anchorLayout(680, 72, {
      placement: {
        kind: "anchor",
        horizontal: "right",
        vertical: "bottom",
        offsetX: 16,
        offsetY: 12
      }
    }),
    title: flowLayout(72, 44, 0),
    gold: flowLayout(72, 44, 1),
    progress: flowLayout(96, 44, 2),
    start: flowLayout(96, 44, 3),
    build: flowLayout(112, 44, 4),
    radial: flowLayout(72, 44, 5),
    quests: flowLayout(72, 44, 6),
    quest_label: flowLayout(72, 44, 0)
  };
  return {
    schemaVersion: 1,
    label: "Main HUD",
    breakpoints: { mobileMax: 767, tabletMax: 1199 },
    commonNodes,
    variants: {
      desktop: layoutVariant(1920, 1080, structuredClone(layouts)),
      tablet: layoutVariant(1024, 768, structuredClone(layouts)),
      mobile: layoutVariant(390, 844, structuredClone(layouts))
    },
    screens: {
      gameplay: { schemaVersion: 1, surface: "gameplay", rootNodeIds: ["root"] }
    },
    screenGraph: { schemaVersion: 1, initialScreenId: "gameplay", transitions: [] },
    assetRoles: {}
  };
}

function compile(profile = hudProfile(), overrides = {}) {
  return compileHudLayoutV1(profile, {
    viewportWidth: 1280,
    viewportHeight: 800,
    safeArea: { top: 10, right: 20, bottom: 30, left: 40 },
    availableActions: createDefaultPlayerActionDescriptors(),
    selectorDescriptors: selectors(),
    state: runtimeState(),
    ...overrides
  });
}

describe("R21.2 pure responsive HUD layout and binding compiler (RED)", () => {
  it("compiles a detached frozen stable desktop plan with exact safe-area anchoring", () => {
    expect(HUD_LAYOUT_SCHEMA_VERSION).toBe(1);
    expect(HUD_SELECTOR_DESCRIPTOR_SCHEMA_VERSION).toBe(1);

    const result = compile();

    expect(result.ok).toBe(true);
    expect(result.plan.schemaVersion).toBe(1);
    expect(result.plan.variantId).toBe("desktop");
    expect(result.plan.safeRect).toEqual({ x: 40, y: 10, width: 1220, height: 760 });
    expect(result.plan.nodes.map((entry) => entry.id)).toEqual([
      "root", "title", "gold", "progress", "start", "build", "radial", "quests", "quest_label"
    ]);
    expect(result.plan.nodes.find((entry) => entry.id === "root").rect).toEqual({
      x: 564,
      y: 686,
      width: 680,
      height: 72
    });
    expect(result.plan.nodes.find((entry) => entry.id === "gold").data.value).toBe(500);
    expect(result.plan.nodes.find((entry) => entry.id === "start").actions).toEqual([
      { event: "activate", actionId: "startWave", payload: {} }
    ]);
    expect(Object.isFrozen(result.plan)).toBe(true);
    expect(Object.isFrozen(result.plan.nodes)).toBe(true);
  });

  it.each([
    [767, "mobile"],
    [768, "tablet"],
    [1199, "tablet"],
    [1200, "desktop"]
  ])("selects the responsive variant deterministically at width %i", (viewportWidth, expected) => {
    const result = compile(hudProfile(), { viewportWidth });
    expect(result.ok).toBe(true);
    expect(result.plan.variantId).toBe(expected);
  });

  it("applies authored dock edges and grid cells instead of overlapping container fallbacks", () => {
    const profile = hudProfile();
    profile.commonNodes = [
      node("grid_root", "grid", { columns: 2, rows: 2, gap: 10 }, ["cell"]),
      node("cell", "button", { labelKey: "cell" })
    ];
    profile.screens.gameplay.rootNodeIds = ["grid_root"];
    for (const variantId of ["desktop", "tablet", "mobile"]) {
      profile.variants[variantId].rootNodeIds = ["grid_root"];
      profile.variants[variantId].layouts = {
        grid_root: {
          ...anchorLayout(400, 220),
          placement: { kind: "dock", edge: "bottom", offset: 20, order: 0 }
        },
        cell: {
          ...anchorLayout(80, 44),
          placement: { kind: "grid", row: 1, column: 1, rowSpan: 1, columnSpan: 1 }
        }
      };
    }

    const result = compile(profile);

    expect(result.ok).toBe(true);
    expect(result.plan.nodes.find((entry) => entry.id === "grid_root").rect).toEqual({
      x: 40, y: 530, width: 400, height: 220
    });
    expect(result.plan.nodes.find((entry) => entry.id === "cell").rect).toEqual({
      x: 245, y: 645, width: 195, height: 105
    });
  });

  it("uses authored child/root order but ignores common-node and record insertion order", () => {
    const first = hudProfile();
    const second = hudProfile();
    second.commonNodes = [...second.commonNodes].reverse();
    for (const variantId of ["desktop", "tablet", "mobile"]) {
      second.variants[variantId].layouts = nullRecord(
        Object.entries(second.variants[variantId].layouts).reverse()
      );
    }
    const a = compile(first);
    const b = compile(second);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(b.plan).toEqual(a.plan);
  });

  it("rejects action and selector bindings not present in their descriptor registries", () => {
    const missingAction = hudProfile();
    missingAction.commonNodes.find((entry) => entry.id === "start").bindings.actions[0].actionId = "runArbitraryCode";
    const missingSelector = hudProfile();
    missingSelector.commonNodes.find((entry) => entry.id === "gold").bindings.data[0].selectorId = "snapshot.player.wallet.gold";

    expect(compile(missingAction).ok).toBe(false);
    expect(compile(missingSelector).ok).toBe(false);
  });

  it("publishes deterministic accessibility diagnostics for interactive targets below 44px", () => {
    const value = hudProfile();
    for (const variant of Object.values(value.variants)) {
      variant.layouts.start.size = size(43, 43, { minWidth: 1, minHeight: 1 });
    }
    const result = compile(value);

    expect(result.ok).toBe(true);
    expect(result.plan.diagnostics).toContainEqual({
      severity: "error",
      code: "interactive_target_below_44",
      nodeId: "start"
    });
  });

  it("selects only allowlisted component states supplied by detached runtime state", () => {
    const result = compile(hudProfile(), {
      state: runtimeState({ nodeStates: { start: "disabled" } })
    });
    expect(result.ok).toBe(true);
    expect(result.plan.nodes.find((entry) => entry.id === "start").state).toBe("disabled");

    const invalid = compile(hudProfile(), {
      state: runtimeState({ nodeStates: { start: "executing" } })
    });
    expect(invalid.ok).toBe(false);
  });

  it("enforces radial and repeater budgets before materializing runtime collections", () => {
    const radial = hudProfile();
    radial.commonNodes.find((entry) => entry.id === "radial").properties.maxVisibleItems = 13;
    expect(compile(radial).ok).toBe(false);

    const repeater = hudProfile();
    const questItems = Array.from(
      { length: 129 },
      (_, index) => ({ id: `quest_${index}`, labelKey: "quest.item", enabled: true })
    );
    expect(compile(repeater, { state: runtimeState({
      selectors: { ...runtimeState().selectors, questItems }
    }) }).ok).toBe(false);
  });

  it.each([
    ["unknown component", (value) => { value.commonNodes[0].type = "iframe"; }],
    ["future node", (value) => { value.commonNodes[0].schemaVersion = 2; }],
    ["unknown CSS field", (value) => { value.variants.desktop.layouts.root.css = "position:fixed"; }],
    ["unknown layer", (value) => { value.variants.desktop.layouts.root.layer = "999999"; }],
    ["unbounded offset", (value) => { value.variants.desktop.layouts.root.placement.offsetX = 1_000_000; }],
    ["sparse child list", (value) => { value.commonNodes[0].childIds = new Array(1); }],
    ["cyclic child graph", (value) => { value.commonNodes.at(-1).childIds = ["root"]; }]
  ])("fails closed for %s", (_label, mutate) => {
    const value = hudProfile();
    mutate(value);
    expect(compile(value).ok).toBe(false);
  });

  it("rejects accessors and symbols without invoking authored code", () => {
    const accessor = hudProfile();
    let reads = 0;
    Object.defineProperty(accessor.commonNodes[0].properties, "axis", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("must not run");
      }
    });
    expect(compile(accessor).ok).toBe(false);
    expect(reads).toBe(0);

    const symbol = hudProfile();
    symbol.variants.desktop.layouts.root[Symbol("css")] = "position:fixed";
    expect(compile(symbol).ok).toBe(false);
  });

  it("fails closed without throwing for revoked option proxies and sparse runtime collections", () => {
    const revoked = Proxy.revocable({
      viewportWidth: 1280,
      viewportHeight: 800,
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      availableActions: createDefaultPlayerActionDescriptors(),
      selectorDescriptors: selectors(),
      state: runtimeState()
    }, {});
    revoked.revoke();
    expect(() => compileHudLayoutV1(hudProfile(), revoked.proxy)).not.toThrow();
    expect(compileHudLayoutV1(hudProfile(), revoked.proxy).ok).toBe(false);

    const sparse = runtimeState();
    sparse.selectors.questItems = new Array(1);
    expect(compile(hudProfile(), { state: sparse }).ok).toBe(false);
  });

  it("keeps catalog validation and compilation DOM-free and rejects a future layout schema", () => {
    const value = hudProfile();
    value.variants.desktop.layouts.root.schemaVersion = 2;
    const validation = validateHudCatalogV1({ schemaVersion: 1, profiles: { main: value } });
    expect(validation.ok).toBe(false);
    expect(compile(value).ok).toBe(false);

    expect(String(compileHudLayoutV1)).not.toMatch(/document|window|HTMLElement|Phaser/);
  });
});
