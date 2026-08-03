import { describe, expect, it } from "vitest";
import { createHudDomRuntimeV1 } from "./hud-dom-runtime.mjs";
import { createDefaultPlayerActionDescriptors } from "../../player-runtime/src/player-actions.mjs";

function layout(width = 160, height = 44) {
  return {
    schemaVersion: 1,
    layer: "content",
    safeArea: true,
    placement: { kind: "anchor", horizontal: "left", vertical: "top", offsetX: 16, offsetY: 16 },
    size: { width, height, minWidth: 44, minHeight: 44, maxWidth: width, maxHeight: height }
  };
}

function variant(rootNodeIds, layouts) {
  return { schemaVersion: 1, designViewport: { width: 1920, height: 1080 }, rootNodeIds, layouts };
}

function node(id, type, properties = {}, actions = []) {
  return {
    schemaVersion: 1,
    id,
    type,
    childIds: [],
    properties,
    bindings: { data: [], actions },
    states: { normal: { visible: true, enabled: true } }
  };
}

function profile(commonNodes, rootNodeIds, transitions = []) {
  const layouts = Object.fromEntries(commonNodes.map((entry) => [entry.id, layout()]));
  const responsive = variant(rootNodeIds, layouts);
  return {
    schemaVersion: 1,
    label: "DOM regression HUD",
    breakpoints: { mobileMax: 767, tabletMax: 1199 },
    commonNodes,
    variants: {
      desktop: structuredClone(responsive),
      tablet: structuredClone(responsive),
      mobile: structuredClone(responsive)
    },
    screens: {
      gameplay: { schemaVersion: 1, surface: "gameplay", rootNodeIds },
      pause: { schemaVersion: 1, surface: "pause", rootNodeIds }
    },
    screenGraph: { schemaVersion: 1, initialScreenId: "gameplay", transitions },
    assetRoles: {}
  };
}

function fakeDom() {
  class FakeElement {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase();
      this.dataset = {};
      this.style = {};
      this.children = [];
      this.listeners = new Map();
      this.hidden = false;
      this.disabled = false;
      this.clientWidth = 1280;
      this.clientHeight = 720;
      this.textContent = "";
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = [...children]; }
    setAttribute(name, value) { this[name] = String(value); }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    fire(name) { this.listeners.get(name)?.({ type: name, currentTarget: this }); }
    find(nodeId) {
      if (this.dataset.hudNodeId === nodeId) return this;
      for (const child of this.children) {
        const found = child.find?.(nodeId);
        if (found) return found;
      }
      return null;
    }
  }
  return {
    document: { createElement: (tagName) => new FakeElement(tagName) },
    root: new FakeElement("main")
  };
}

function createRuntime(profileValue, runtime = {}) {
  const { document, root } = fakeDom();
  const calls = [];
  const instance = createHudDomRuntimeV1({
    document,
    root,
    catalog: { schemaVersion: 1, profiles: { main: profileValue } },
    profileId: "main",
    viewportWidth: 1280,
    viewportHeight: 720,
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    availableActions: createDefaultPlayerActionDescriptors(),
    selectorDescriptors: runtime.selectorDescriptors ?? [],
    state: runtime.state ?? { selectors: {}, nodeStates: {} },
    actionRegistry: { invoke: (actionId, payload) => calls.push({ actionId, payload }) }
  });
  return { instance, root, calls };
}

describe("R21 verifier regression: semantic HUD DOM and input bridge (RED)", () => {
  it("dispatches a screen event with the initial selector state when the state override is omitted", () => {
    const hud = profile(
      [node("pause_button", "button", { labelKey: "hud.pause" })],
      ["pause_button"],
      [{
        id: "show_pause",
        event: "pauseRequested",
        fromScreenId: "gameplay",
        targetScreenId: "pause",
        conditions: [{ selectorId: "canPause", operator: "equals", value: true }]
      }]
    );
    const { instance, root } = createRuntime(hud, {
      selectorDescriptors: [{ schemaVersion: 1, id: "canPause", valueType: "boolean", cardinality: "one" }],
      state: { selectors: { canPause: true }, nodeStates: {} }
    });
    expect(instance.render().ok).toBe(true);

    const result = instance.dispatch("pauseRequested");

    expect(result).toMatchObject({ ok: true, transitioned: true, currentScreenId: "pause" });
    expect(root.dataset.towerforgeHudScreen).toBe("pause");
  });

  it("materializes build-menu collections and exposes one input-family-neutral activation path", () => {
    const buildMenu = node(
      "build",
      "build_menu",
      { presentation: "horizontal_quickbar", selectorId: "buildOptions" },
      [{ event: "select", actionId: "selectBuildSlot", payload: {} }]
    );
    const hud = profile([buildMenu], ["build"]);
    const { instance, root, calls } = createRuntime(hud, {
      selectorDescriptors: [{ schemaVersion: 1, id: "buildOptions", valueType: "item", cardinality: "many" }],
      state: {
        selectors: {
          buildOptions: [
            { id: "cannon", labelKey: "tower.cannon", enabled: true },
            { id: "frost", labelKey: "tower.frost", enabled: true }
          ]
        },
        nodeStates: {}
      }
    });

    expect(instance.render().ok).toBe(true);
    expect(root.find("build")?.children).toHaveLength(2);
    expect(instance.activateCollectionItem).toBeTypeOf("function");
    for (const inputFamily of ["pointer", "keyboard", "gamepad", "touch"]) {
      expect(instance.activateCollectionItem({
        nodeId: "build",
        itemId: "frost",
        inputFamily
      })).toMatchObject({ ok: true });
    }
    expect(calls).toEqual(Array.from({ length: 4 }, () => ({
      actionId: "selectBuildSlot",
      payload: { slotId: "frost", index: 1 }
    })));
  });
});
