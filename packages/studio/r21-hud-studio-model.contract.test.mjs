import { describe, expect, it } from "vitest";
import {
  HUD_COMPONENT_STATES,
  HUD_COMPONENT_TYPES,
  HUD_LAYOUT_LAYERS,
  validateHudCatalogV1
} from "../player-runtime/src/hud-catalog.mjs";

const model = await import("./public/hud-studio-model.mjs").catch(() => null);

function helper(name) {
  expect(model?.[name], `${name} must be exported by the browser-safe Studio model`).toBeTypeOf("function");
  return model[name];
}

function layoutVariant(width, height) {
  return {
    schemaVersion: 1,
    designViewport: { width, height },
    rootNodeIds: ["root", "child"],
    layouts: {
      root: {
        schemaVersion: 1,
        layer: "content",
        safeArea: true,
        placement: { kind: "anchor", horizontal: "left", vertical: "top", offsetX: 0, offsetY: 0 },
        size: { width: 240, height: 96, minWidth: 44, minHeight: 44, maxWidth: 240, maxHeight: 96 }
      },
      child: {
        schemaVersion: 1,
        layer: "content",
        safeArea: true,
        placement: { kind: "anchor", horizontal: "left", vertical: "top", offsetX: 0, offsetY: 0 },
        size: { width: 44, height: 44, minWidth: 44, minHeight: 44, maxWidth: 44, maxHeight: 44 }
      }
    }
  };
}

function node(id, type = "panel") {
  return {
    schemaVersion: 1,
    id,
    type,
    childIds: [],
    properties: {},
    bindings: { data: [], actions: [] },
    states: { normal: { visible: true, enabled: true } }
  };
}

function profile() {
  return {
    schemaVersion: 1,
    label: "HUD model contract",
    breakpoints: { mobileMax: 767, tabletMax: 1199 },
    commonNodes: [node("root"), node("child", "icon")],
    variants: {
      desktop: layoutVariant(1920, 1080),
      tablet: layoutVariant(1024, 768),
      mobile: layoutVariant(390, 844)
    },
    screens: {
      gameplay: { schemaVersion: 1, surface: "gameplay", rootNodeIds: ["root", "child"] },
      pause: { schemaVersion: 1, surface: "pause", rootNodeIds: ["root"] }
    },
    screenGraph: {
      schemaVersion: 1,
      initialScreenId: "gameplay",
      transitions: [{
        id: "show_pause",
        event: "pauseRequested",
        fromScreenId: "gameplay",
        targetScreenId: "pause",
        conditions: []
      }]
    },
    assetRoles: {}
  };
}

describe("R21 verifier regression: browser-safe HUD Studio semantic model (RED)", () => {
  it("creates a detached descriptor model containing the complete authoring catalogs", () => {
    const create = helper("createHudStudioDescriptorModel");
    const descriptor = create({
      components: [...HUD_COMPONENT_TYPES],
      states: [...HUD_COMPONENT_STATES],
      layers: [...HUD_LAYOUT_LAYERS],
      selectors: { playerGold: { valueType: "number", cardinality: "one" } },
      actions: { startWave: { kind: "game_command" } }
    });
    expect(descriptor.components).toEqual([...HUD_COMPONENT_TYPES]);
    expect(descriptor.states).toEqual([...HUD_COMPONENT_STATES]);
    expect(descriptor.layers).toEqual([...HUD_LAYOUT_LAYERS]);
    expect(Object.isFrozen(descriptor)).toBe(true);
  });

  it("applies complete component semantics and layout constraints without mutating the source", () => {
    const apply = helper("applyHudStudioComponentDraft");
    const source = profile();
    const next = apply(source, {
      nodeId: "root",
      component: {
        ...node("root", "radial_menu"),
        childIds: ["child"],
        properties: { selectorId: "buildOptions", itemTemplateNodeId: "child", maxVisibleItems: 8 },
        bindings: {
          data: [{ slot: "items", selectorId: "buildOptions" }],
          actions: [{ event: "select", actionId: "selectBuildSlot", payload: { source: "radial" } }]
        },
        states: {
          normal: { visible: true, enabled: true },
          disabled: { visible: true, enabled: false }
        }
      },
      variantId: "desktop",
      layout: {
        ...source.variants.desktop.layouts.root,
        layer: "overlay",
        safeArea: false
      }
    });
    expect(next).not.toBe(source);
    expect(source.commonNodes[0].type).toBe("panel");
    expect(next.commonNodes[0]).toMatchObject({
      type: "radial_menu",
      childIds: ["child"],
      properties: { selectorId: "buildOptions", itemTemplateNodeId: "child", maxVisibleItems: 8 },
      bindings: { actions: [{ event: "select", actionId: "selectBuildSlot", payload: { source: "radial" } }] },
      states: { disabled: { visible: true, enabled: false } }
    });
    expect(next.variants.desktop.layouts.root).toMatchObject({ layer: "overlay", safeArea: false });
    expect(validateHudCatalogV1({ schemaVersion: 1, profiles: { main: next } }).ok).toBe(true);
  });

  it("adds, updates and removes one ordered typed transition condition", () => {
    const upsert = helper("upsertHudStudioTransitionCondition");
    const remove = helper("removeHudStudioTransitionCondition");
    const source = profile();
    const added = upsert(source, {
      transitionId: "show_pause",
      index: 0,
      condition: { selectorId: "canPause", operator: "equals", value: true }
    });
    expect(added.screenGraph.transitions[0].conditions).toEqual([
      { selectorId: "canPause", operator: "equals", value: true }
    ]);
    const updated = upsert(added, {
      transitionId: "show_pause",
      index: 0,
      condition: { selectorId: "coreHp", operator: "less_than", value: 20 }
    });
    expect(updated.screenGraph.transitions[0].conditions[0]).toEqual({
      selectorId: "coreHp", operator: "less_than", value: 20
    });
    const removed = remove(updated, { transitionId: "show_pause", index: 0 });
    expect(removed.screenGraph.transitions[0].conditions).toEqual([]);
    expect(source.screenGraph.transitions[0].conditions).toEqual([]);
  });

  it("round-trips a visuals role plus typed atlas/nine-slice metadata into a valid profile", () => {
    const upsert = helper("upsertHudStudioAssetRole");
    const source = profile();
    const atlas = upsert(source, {
      roleId: "command_frame",
      spriteId: "ui_command_atlas",
      metadata: { schemaVersion: 1, kind: "atlas_frame", atlasFrame: "command_idle" }
    });
    const next = upsert(atlas, {
      roleId: "panel_frame",
      spriteId: "ui_panel",
      metadata: {
        schemaVersion: 1,
        kind: "nine_slice",
        nineSlice: { top: 8, right: 12, bottom: 8, left: 12 }
      }
    });
    expect(next.assetRoles).toEqual({ command_frame: "ui_command_atlas", panel_frame: "ui_panel" });
    expect(next.assetMetadata).toMatchObject({
      command_frame: { kind: "atlas_frame", atlasFrame: "command_idle" },
      panel_frame: { kind: "nine_slice", nineSlice: { top: 8, right: 12, bottom: 8, left: 12 } }
    });
    expect(validateHudCatalogV1({ schemaVersion: 1, profiles: { main: next } }).ok).toBe(true);
    expect(source.assetRoles).toEqual({});
  });
});
