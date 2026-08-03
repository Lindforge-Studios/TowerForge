import { describe, expect, it } from "vitest";
import {
  HUD_CATALOG_LIMITS,
  HUD_CATALOG_SCHEMA_VERSION,
  validateHudCatalogV1
} from "./hud-catalog.mjs";

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

function layoutVariant(width, height) {
  return {
    schemaVersion: 1,
    designViewport: { width, height },
    rootNodeIds: []
  };
}

function profile(label = "Main HUD") {
  return {
    schemaVersion: 1,
    label,
    breakpoints: { mobileMax: 767, tabletMax: 1199 },
    commonNodes: [],
    variants: {
      desktop: layoutVariant(1920, 1080),
      tablet: layoutVariant(1024, 768),
      mobile: layoutVariant(390, 844)
    },
    screens: {
      gameplay: { schemaVersion: 1, surface: "gameplay", rootNodeIds: [] }
    },
    screenGraph: {
      schemaVersion: 1,
      initialScreenId: "gameplay",
      transitions: []
    },
    assetRoles: {}
  };
}

function catalog(profiles = { main: profile() }) {
  return { schemaVersion: 1, profiles };
}

function richButtonNode(id = "start_wave") {
  return {
    schemaVersion: 1,
    id,
    type: "button",
    childIds: [],
    properties: {
      labelKey: "hud.start_wave",
      ariaLabelKey: "hud.start_wave"
    },
    bindings: {
      data: [],
      actions: [{ event: "activate", actionId: "startWave", payload: {} }]
    },
    states: {
      normal: { visible: true, enabled: true },
      disabled: { visible: true, enabled: false }
    }
  };
}

function screenTransition(overrides = {}) {
  return {
    id: "show_pause",
    event: "pauseRequested",
    fromScreenId: "gameplay",
    targetScreenId: "pause",
    conditions: [{ selectorId: "canPause", operator: "equals", value: true }],
    ...overrides
  };
}

describe("R21.1 HudCatalogV1 closed pure contract (RED)", () => {
  it("normalizes a valid catalog into frozen prototype-neutral detached own data", () => {
    const source = catalog();
    const result = validateHudCatalogV1(source);

    expect(HUD_CATALOG_SCHEMA_VERSION).toBe(1);
    expect(HUD_CATALOG_LIMITS).toMatchObject({
      profiles: 16,
      screensPerProfile: 32,
      nodesPerProfile: 512,
      nestingDepth: 16,
      layoutRecordsPerProfile: 1536,
      transitionsPerProfile: 256,
      conditionTermsPerTransition: 16,
      visibleRadialItems: 12,
      repeaterItemsPerScreen: 128
    });
    expect(result.ok).toBe(true);
    expect(Object.getPrototypeOf(result.catalog.profiles)).toBe(null);
    expect(Object.isFrozen(result.catalog)).toBe(true);
    expect(Object.isFrozen(result.catalog.profiles.main)).toBe(true);

    source.profiles.main.label = "mutated";
    expect(result.catalog.profiles.main.label).toBe("Main HUD");
  });

  it("preserves special JSON profile IDs without prototype mutation or inherited lookup", () => {
    const profiles = nullRecord([
      ["__proto__", profile("Proto HUD")],
      ["constructor", profile("Constructor HUD")],
      ["prototype", profile("Prototype HUD")]
    ]);
    const result = validateHudCatalogV1(catalog(profiles));

    expect(result.ok).toBe(true);
    expect(Object.keys(result.catalog.profiles)).toEqual(["__proto__", "constructor", "prototype"]);
    expect(Object.hasOwn(result.catalog.profiles, "__proto__")).toBe(true);
    expect(result.catalog.profiles.__proto__.label).toBe("Proto HUD");
    expect(Object.getPrototypeOf(result.catalog.profiles)).toBe(null);
  });

  it("normalizes the R21.2 typed component shape without executable paths or renderer state", () => {
    const value = catalog();
    value.profiles.main.commonNodes = [richButtonNode()];
    value.profiles.main.variants.desktop.rootNodeIds = ["start_wave"];
    value.profiles.main.variants.tablet.rootNodeIds = ["start_wave"];
    value.profiles.main.variants.mobile.rootNodeIds = ["start_wave"];
    value.profiles.main.screens.gameplay.rootNodeIds = ["start_wave"];

    const result = validateHudCatalogV1(value);

    expect(result.ok).toBe(true);
    expect(result.catalog.profiles.main.commonNodes[0]).toMatchObject({
      schemaVersion: 1,
      id: "start_wave",
      type: "button",
      properties: { labelKey: "hud.start_wave" }
    });
    expect(Object.isFrozen(result.catalog.profiles.main.commonNodes[0].bindings.actions)).toBe(true);
    expect(Object.getPrototypeOf(result.catalog.profiles.main.commonNodes[0].states)).toBe(null);
  });

  it("normalizes typed HUD asset presentation metadata independently from visuals sprite IDs", () => {
    const value = catalog();
    value.profiles.main.assetRoles = {
      portrait: "hero_portrait",
      command_frame: "ui_command_atlas",
      panel_frame: "ui_panel"
    };
    value.profiles.main.assetMetadata = {
      portrait: { schemaVersion: 1, kind: "image" },
      command_frame: { schemaVersion: 1, kind: "atlas_frame", atlasFrame: "command_idle" },
      panel_frame: {
        schemaVersion: 1,
        kind: "nine_slice",
        nineSlice: { top: 8, right: 12, bottom: 8, left: 12 }
      }
    };

    const result = validateHudCatalogV1(value);

    expect(result.ok).toBe(true);
    expect(result.catalog.profiles.main.assetRoles).toEqual({
      command_frame: "ui_command_atlas",
      panel_frame: "ui_panel",
      portrait: "hero_portrait"
    });
    expect(result.catalog.profiles.main.assetMetadata).toEqual({
      command_frame: { schemaVersion: 1, kind: "atlas_frame", atlasFrame: "command_idle" },
      panel_frame: {
        schemaVersion: 1,
        kind: "nine_slice",
        nineSlice: { bottom: 8, left: 12, right: 12, top: 8 }
      },
      portrait: { schemaVersion: 1, kind: "image" }
    });
    expect(Object.isFrozen(result.catalog.profiles.main.assetMetadata.panel_frame.nineSlice)).toBe(true);
  });

  it("bounds asset roles and metadata to 512 records per profile", () => {
    expect(HUD_CATALOG_LIMITS).toMatchObject({
      assetRolesPerProfile: 512,
      assetMetadataPerProfile: 512
    });
    const withinBudget = catalog();
    withinBudget.profiles.main.assetRoles = Object.fromEntries(
      Array.from({ length: 512 }, (_, index) => [`role_${index}`, `sprite_${index}`])
    );
    withinBudget.profiles.main.assetMetadata = Object.fromEntries(
      Array.from({ length: 512 }, (_, index) => [`role_${index}`, { schemaVersion: 1, kind: "image" }])
    );
    expect(validateHudCatalogV1(withinBudget).ok).toBe(true);

    const tooManyRoles = structuredClone(withinBudget);
    tooManyRoles.profiles.main.assetRoles.role_512 = "sprite_512";
    expect(validateHudCatalogV1(tooManyRoles).ok).toBe(false);

    const tooManyMetadata = structuredClone(tooManyRoles);
    tooManyMetadata.profiles.main.assetMetadata.role_512 = { schemaVersion: 1, kind: "image" };
    expect(validateHudCatalogV1(tooManyMetadata).ok).toBe(false);
  });

  it("rejects accessor and revoked-proxy asset catalogs without invoking user code", () => {
    for (const field of ["assetRoles", "assetMetadata"]) {
      const value = catalog();
      value.profiles.main.assetRoles = { frame: "ui_frame" };
      value.profiles.main.assetMetadata = { frame: { schemaVersion: 1, kind: "image" } };
      let reads = 0;
      Object.defineProperty(value.profiles.main[field], "trap", {
        enumerable: true,
        get() { reads += 1; return field === "assetRoles" ? "ui_trap" : { schemaVersion: 1, kind: "image" }; }
      });
      expect(validateHudCatalogV1(value).ok).toBe(false);
      expect(reads).toBe(0);

      const revoked = Proxy.revocable({}, {});
      revoked.revoke();
      value.profiles.main[field] = revoked.proxy;
      expect(validateHudCatalogV1(value).ok).toBe(false);
    }
  });

  it.each([
    ["metadata without a role", { ghost: { schemaVersion: 1, kind: "image" } }],
    ["future metadata", { frame: { schemaVersion: 2, kind: "image" } }],
    ["atlas without a frame", { frame: { schemaVersion: 1, kind: "atlas_frame" } }],
    ["unsafe atlas frame", { frame: { schemaVersion: 1, kind: "atlas_frame", atlasFrame: "../secret" } }],
    ["nine-slice without borders", { frame: { schemaVersion: 1, kind: "nine_slice" } }],
    ["negative nine-slice border", {
      frame: { schemaVersion: 1, kind: "nine_slice", nineSlice: { top: -1, right: 8, bottom: 8, left: 8 } }
    }]
  ])("fails closed for HUD asset %s", (_label, assetMetadata) => {
    const value = catalog();
    value.profiles.main.assetRoles = { frame: "ui_frame" };
    value.profiles.main.assetMetadata = assetMetadata;
    expect(validateHudCatalogV1(value).ok).toBe(false);
  });

  it("normalizes R21.3 ordered typed screen transitions without treating them as gameplay actions", () => {
    const value = catalog();
    value.profiles.main.screens.pause = {
      schemaVersion: 1,
      surface: "pause",
      rootNodeIds: []
    };
    value.profiles.main.screenGraph.transitions = [
      screenTransition(),
      screenTransition({
        id: "show_pause_fallback",
        fromScreenId: undefined,
        conditions: []
      })
    ];
    delete value.profiles.main.screenGraph.transitions[1].fromScreenId;

    const result = validateHudCatalogV1(value);

    expect(result.ok).toBe(true);
    expect(result.catalog.profiles.main.screenGraph.transitions).toEqual([
      {
        id: "show_pause",
        event: "pauseRequested",
        fromScreenId: "gameplay",
        targetScreenId: "pause",
        conditions: [{ selectorId: "canPause", operator: "equals", value: true }]
      },
      {
        id: "show_pause_fallback",
        event: "pauseRequested",
        targetScreenId: "pause",
        conditions: []
      }
    ]);
    expect(Object.isFrozen(result.catalog.profiles.main.screenGraph.transitions)).toBe(true);
    expect(Object.isFrozen(result.catalog.profiles.main.screenGraph.transitions[0].conditions)).toBe(true);
  });

  it.each([
    ["unknown screen event", () => screenTransition({ event: "runArbitraryCode" })],
    ["missing transition target", () => screenTransition({ targetScreenId: "missing" })],
    ["arbitrary selector path", () => screenTransition({
      conditions: [{ selectorId: "snapshot.player.hp", operator: "equals", value: 1 }]
    })],
    ["unknown condition operator", () => screenTransition({
      conditions: [{ selectorId: "canPause", operator: "execute", value: true }]
    })],
    ["sparse conditions", () => screenTransition({ conditions: new Array(1) })],
    ["over-budget conditions", () => screenTransition({
      conditions: Array.from({ length: 17 }, (_, index) => ({
        selectorId: `flag_${index}`,
        operator: "truthy",
        value: true
      }))
    })]
  ])("fails closed for an R21.3 transition with %s", (_label, makeTransition) => {
    const value = catalog();
    value.profiles.main.screens.pause = { schemaVersion: 1, surface: "pause", rootNodeIds: [] };
    value.profiles.main.screenGraph.transitions = [makeTransition()];
    expect(validateHudCatalogV1(value).ok).toBe(false);
  });

  it("reserves the built-in recovery overlay identity from authored screen graphs", () => {
    const value = catalog();
    value.profiles.main.screens.__towerforge_system_recovery__ = {
      schemaVersion: 1,
      surface: "recoverable_error",
      rootNodeIds: []
    };
    expect(validateHudCatalogV1(value).ok).toBe(false);
  });

  it.each([
    ["future component schema", () => ({ ...richButtonNode(), schemaVersion: 2 })],
    ["unknown executable component field", () => ({ ...richButtonNode(), javascript: "alert(1)" })],
    ["arbitrary object-path selector", () => {
      const node = richButtonNode();
      node.bindings.data = [{ slot: "value", selectorId: "snapshot.player.wallet.gold" }];
      return node;
    }],
    ["unsupported component state", () => {
      const node = richButtonNode();
      node.states.executing = { visible: true, enabled: true };
      return node;
    }]
  ])("fails closed for R21.2 %s", (_label, makeNode) => {
    const value = catalog();
    value.profiles.main.commonNodes = [makeNode()];
    expect(validateHudCatalogV1(value).ok).toBe(false);
  });

  it.each([
    ["unknown root field", () => ({ ...catalog(), javascript: "alert(1)" })],
    ["future catalog", () => ({ ...catalog(), schemaVersion: 2 })],
    ["unknown profile field", () => {
      const value = catalog();
      value.profiles.main.html = "<script>";
      return value;
    }],
    ["unordered breakpoints", () => {
      const value = catalog();
      value.profiles.main.breakpoints = { mobileMax: 1200, tabletMax: 900 };
      return value;
    }],
    ["missing responsive variant", () => {
      const value = catalog();
      delete value.profiles.main.variants.mobile;
      return value;
    }],
    ["sparse node array", () => {
      const value = catalog();
      value.profiles.main.commonNodes = new Array(1);
      return value;
    }],
    ["non-finite viewport", () => {
      const value = catalog();
      value.profiles.main.variants.desktop.designViewport.width = Number.POSITIVE_INFINITY;
      return value;
    }],
    ["over-budget profiles", () => catalog(Object.fromEntries(Array.from(
      { length: 17 },
      (_, index) => [`hud_${index}`, profile(`HUD ${index}`)]
    )))],
    ["over-budget screens", () => {
      const value = catalog();
      value.profiles.main.screens = Object.fromEntries(Array.from(
        { length: 33 },
        (_, index) => [`screen_${index}`, { schemaVersion: 1, surface: "gameplay", rootNodeIds: [] }]
      ));
      value.profiles.main.screenGraph.initialScreenId = "screen_0";
      return value;
    }],
    ["over-budget nodes", () => {
      const value = catalog();
      value.profiles.main.commonNodes = Array.from(
        { length: 513 },
        (_, index) => ({ id: `node_${index}`, type: "panel" })
      );
      return value;
    }]
  ])("fails closed for %s", (_label, makeValue) => {
    const result = validateHudCatalogV1(makeValue());
    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
  });

  it("rejects accessors without invoking them and fails closed for revoked proxies", () => {
    const value = catalog();
    let reads = 0;
    Object.defineProperty(value.profiles.main, "label", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("author getter must not run");
      }
    });
    const accessorResult = validateHudCatalogV1(value);
    expect(reads).toBe(0);
    expect(accessorResult.ok).toBe(false);
    expect(accessorResult.error.message).toMatch(/own data|accessor/i);

    const revoked = Proxy.revocable(catalog(), {});
    revoked.revoke();
    expect(() => validateHudCatalogV1(revoked.proxy)).not.toThrow();
    expect(validateHudCatalogV1(revoked.proxy).ok).toBe(false);
  });

  it("rejects symbol keys and cycles before normalization", () => {
    const symbolCatalog = catalog();
    symbolCatalog[Symbol("hidden executable field")] = true;
    expect(validateHudCatalogV1(symbolCatalog).ok).toBe(false);

    const cyclic = catalog();
    cyclic.profiles.main.assetRoles.loop = cyclic;
    expect(validateHudCatalogV1(cyclic).ok).toBe(false);
  });

  it("rejects a cyclic node graph even when the orphan component is absent from every screen and variant root", () => {
    const value = catalog();
    value.profiles.main.commonNodes = [
      {
        schemaVersion: 1,
        id: "orphan_a",
        type: "panel",
        childIds: ["orphan_b"],
        properties: {},
        bindings: { data: [], actions: [] },
        states: { normal: { visible: true, enabled: true } }
      },
      {
        schemaVersion: 1,
        id: "orphan_b",
        type: "panel",
        childIds: ["orphan_a"],
        properties: {},
        bindings: { data: [], actions: [] },
        states: { normal: { visible: true, enabled: true } }
      }
    ];

    const result = validateHudCatalogV1(value);

    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/cycle/i);
  });

  it("returns stable diagnostics for equivalent profile insertion orders", () => {
    const first = nullRecord([
      ["zeta", { ...profile(), executable: true }],
      ["alpha", { ...profile(), executable: true }]
    ]);
    const second = nullRecord([
      ["alpha", { ...profile(), executable: true }],
      ["zeta", { ...profile(), executable: true }]
    ]);

    const resultA = validateHudCatalogV1(catalog(first));
    const resultB = validateHudCatalogV1(catalog(second));
    expect(resultA.ok).toBe(false);
    expect(resultB.ok).toBe(false);
    expect(resultA.error.message).toBe(resultB.error.message);
  });
});
