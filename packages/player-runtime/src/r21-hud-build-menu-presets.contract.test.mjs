import { describe, expect, it } from "vitest";
import { createDefaultPlayerActionDescriptors } from "./player-actions.mjs";
import {
  HUD_BUILD_MENU_LIMITS,
  HUD_BUILD_MENU_PRESET_IDS,
  HUD_BUILD_MENU_SCHEMA_VERSION,
  HUD_INPUT_FAMILIES,
  compileHudBuildMenuPlanV1,
  createHudBuildMenuPresetRecipesV1,
  resolveHudBuildMenuIntentV1
} from "./hud-build-menu-presets.mjs";

const PRESETS = Object.freeze([
  "desktop_horizontal_quickbar",
  "vertical_edge_dock",
  "category_catalog_drawer",
  "radial_wheel",
  "contextual_tile_popover",
  "mobile_bottom_sheet",
  "keyboard_command_palette"
]);

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

function availability(overrides = {}) {
  return {
    inputFamilies: ["pointer", "keyboard", "gamepad", "touch"],
    formFactors: ["desktop", "tablet", "mobile"],
    phases: ["setup", "live", "between_wave"],
    requiredCapabilities: [],
    ...overrides
  };
}

function menu(id, presetId, overrides = {}) {
  return {
    schemaVersion: 1,
    id,
    presetId,
    selectorId: "buildOptions",
    actionId: "selectBuildSlot",
    availability: availability(),
    visibleItemLimit: presetId === "radial_wheel" ? 12 : 128,
    ...overrides
  };
}

function definitions() {
  return PRESETS.map((presetId, index) => menu(`menu_${index}`, presetId));
}

function selectorDescriptors() {
  return [{ schemaVersion: 1, id: "buildOptions", valueType: "item", cardinality: "many" }];
}

function buildItems(count = 3) {
  return Array.from({ length: count }, (_, index) => ({
    id: ["cannon", "frost", "support"][index] ?? `tower_${index}`,
    labelKey: `tower.${["cannon", "frost", "support"][index] ?? `tower_${index}`}`,
    categoryId: index === 2 ? "support" : "damage",
    enabled: true
  }));
}

function state(items = buildItems()) {
  return { selectors: { buildOptions: items } };
}

function context(overrides = {}) {
  return {
    inputFamily: "pointer",
    formFactor: "desktop",
    phase: "setup",
    capabilities: [],
    selectedTileId: null,
    ...overrides
  };
}

function compile(menuDefinitions = definitions(), overrides = {}) {
  return compileHudBuildMenuPlanV1(menuDefinitions, {
    availableActions: createDefaultPlayerActionDescriptors(),
    selectorDescriptors: selectorDescriptors(),
    state: state(),
    context: context(),
    ...overrides
  });
}

describe("R21.4 pure build-menu presets and input parity contract (RED)", () => {
  it("publishes exactly seven data-only preset recipes built from the shared HUD primitives", () => {
    expect(HUD_BUILD_MENU_SCHEMA_VERSION).toBe(1);
    expect(HUD_BUILD_MENU_PRESET_IDS).toEqual(PRESETS);
    expect(HUD_INPUT_FAMILIES).toEqual(["pointer", "keyboard", "gamepad", "touch"]);
    expect(HUD_BUILD_MENU_LIMITS).toEqual({
      menus: 32,
      itemsPerMenu: 128,
      availabilityEntries: 16,
      visibleRadialItems: 12
    });

    const recipes = createHudBuildMenuPresetRecipesV1();
    expect(recipes.map((recipe) => recipe.id)).toEqual(PRESETS);
    expect(Object.fromEntries(recipes.map((recipe) => [recipe.id, recipe.primitiveTypes]))).toEqual({
      desktop_horizontal_quickbar: ["dock", "stack", "button"],
      vertical_edge_dock: ["dock", "stack", "button"],
      category_catalog_drawer: ["drawer", "grid", "button"],
      radial_wheel: ["radial_menu", "button"],
      contextual_tile_popover: ["tile_popover", "grid", "button"],
      mobile_bottom_sheet: ["drawer", "grid", "button"],
      keyboard_command_palette: ["modal", "repeater", "button"]
    });
    expect(Object.isFrozen(recipes)).toBe(true);
    expect(recipes.every((recipe) => Object.isFrozen(recipe.primitiveTypes))).toBe(true);
  });

  it("compiles every preset into a frozen detached plan while preserving authored menu and item order", () => {
    const source = definitions();
    const sourceItems = buildItems();
    const result = compile(source, { state: state(sourceItems) });

    expect(result.ok).toBe(true);
    expect(result.plan.schemaVersion).toBe(1);
    expect(result.plan.menus.map((entry) => entry.presetId)).toEqual(PRESETS);
    expect(result.plan.menus.every((entry) => entry.items.map((item) => item.id).join(",") === "cannon,frost,support")).toBe(true);
    expect(Object.isFrozen(result.plan)).toBe(true);
    expect(Object.isFrozen(result.plan.menus)).toBe(true);
    expect(Object.isFrozen(result.plan.menus[0].items[0])).toBe(true);

    source[0].id = "mutated";
    sourceItems[0].labelKey = "mutated";
    expect(result.plan.menus[0].id).toBe("menu_0");
    expect(result.plan.menus[0].items[0].labelKey).toBe("tower.cannon");
  });

  it("filters independently by input family, form factor, phase and every required capability", () => {
    const source = [
      menu("desktop", "desktop_horizontal_quickbar", {
        availability: availability({
          inputFamilies: ["pointer", "keyboard"],
          formFactors: ["desktop"],
          phases: ["setup", "between_wave"],
          requiredCapabilities: ["arsenal", "roguelite"]
        })
      }),
      menu("mobile", "mobile_bottom_sheet", {
        availability: availability({
          inputFamilies: ["touch"],
          formFactors: ["mobile"],
          phases: ["live"],
          requiredCapabilities: []
        })
      })
    ];

    expect(compile(source, { context: context({ capabilities: ["roguelite", "arsenal"] }) }).plan.menus.map((entry) => entry.id)).toEqual(["desktop"]);
    expect(compile(source, { context: context({ capabilities: ["arsenal"] }) }).plan.menus).toEqual([]);
    expect(compile(source, { context: context({ phase: "live", capabilities: ["arsenal", "roguelite"] }) }).plan.menus).toEqual([]);
    expect(compile(source, { context: context({
      inputFamily: "touch",
      formFactor: "mobile",
      phase: "live"
    }) }).plan.menus.map((entry) => entry.id)).toEqual(["mobile"]);
  });

  it("emits the same PlayerActionDescriptorV1 intent for pointer, keyboard, gamepad and touch activation", () => {
    const controls = {
      pointer: "primary",
      keyboard: "Enter",
      gamepad: "south",
      touch: "tap"
    };
    const intents = [];
    for (const inputFamily of HUD_INPUT_FAMILIES) {
      const result = compile([menu("quick", "desktop_horizontal_quickbar")], {
        context: context({ inputFamily })
      });
      expect(result.ok).toBe(true);
      const resolved = resolveHudBuildMenuIntentV1(result.plan, {
        schemaVersion: 1,
        inputFamily,
        control: controls[inputFamily],
        menuId: "quick",
        itemId: "cannon"
      });
      expect(resolved.ok).toBe(true);
      intents.push(resolved.intent);
    }
    expect(intents).toEqual(Array.from({ length: 4 }, () => ({
      schemaVersion: 1,
      actionId: "selectBuildSlot",
      payload: { slotId: "cannon" }
    })));
  });

  it("bounds radial visibility at twelve without losing deterministic overflow information", () => {
    const radial = menu("wheel", "radial_wheel", { visibleItemLimit: 12 });
    const result = compile([radial], { state: state(buildItems(20)) });
    expect(result.ok).toBe(true);
    expect(result.plan.menus[0].items).toHaveLength(12);
    expect(result.plan.menus[0].overflowItemCount).toBe(8);

    const invalid = menu("wheel", "radial_wheel", { visibleItemLimit: 13 });
    expect(compile([invalid]).ok).toBe(false);
  });

  it("is invariant to record and capability insertion order but keeps authored array order meaningful", () => {
    const first = menu("quick", "desktop_horizontal_quickbar", {
      availability: availability({ requiredCapabilities: ["arsenal", "roguelite"] })
    });
    const second = nullRecord(Object.entries(structuredClone(first)).reverse());
    second.availability = nullRecord(Object.entries(second.availability).reverse());
    second.availability.requiredCapabilities.reverse();
    const a = compile([first], { context: context({ capabilities: ["arsenal", "roguelite"] }) });
    const b = compile([second], { context: context({ capabilities: ["roguelite", "arsenal"] }) });
    expect(a).toEqual(b);

    const ordered = compile([
      menu("quick", "desktop_horizontal_quickbar"),
      menu("dock", "vertical_edge_dock")
    ]);
    const reversed = compile([
      menu("dock", "vertical_edge_dock"),
      menu("quick", "desktop_horizontal_quickbar")
    ]);
    expect(ordered.plan.menus.map((entry) => entry.id)).toEqual(["quick", "dock"]);
    expect(reversed.plan.menus.map((entry) => entry.id)).toEqual(["dock", "quick"]);
  });

  it.each([
    ["future menu schema", () => [menu("future", "desktop_horizontal_quickbar", { schemaVersion: 2 })], {}],
    ["unknown preset", () => [menu("unknown", "freeform_html")], {}],
    ["unknown action", () => [menu("unknown", "desktop_horizontal_quickbar", { actionId: "runCode" })], {}],
    ["unknown input family", () => [menu("bad", "desktop_horizontal_quickbar", {
      availability: availability({ inputFamilies: ["voice"] })
    })], {}],
    ["sparse menu list", () => new Array(1), {}],
    ["over-budget menus", () => Array.from({ length: 33 }, (_, index) => menu(
      `menu_${index}`, "desktop_horizontal_quickbar"
    )), {}],
    ["over-budget item collection", () => definitions(), { state: state(buildItems(129)) }],
    ["cyclic item data", () => definitions(), { state: (() => {
      const item = { id: "cycle", labelKey: "tower.cycle", enabled: true };
      item.self = item;
      return state([item]);
    })() }]
  ])("fails closed for %s", (_label, makeDefinitions, overrides) => {
    const result = compile(makeDefinitions(), overrides);
    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
  });

  it("rejects accessors, symbols and revoked proxies without invoking authored code or touching DOM/gameplay", () => {
    const accessor = menu("unsafe", "desktop_horizontal_quickbar");
    let reads = 0;
    Object.defineProperty(accessor, "presetId", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("must not run");
      }
    });
    expect(compile([accessor]).ok).toBe(false);
    expect(reads).toBe(0);

    const symbol = menu("symbol", "desktop_horizontal_quickbar");
    symbol[Symbol("javascript")] = "alert(1)";
    expect(compile([symbol]).ok).toBe(false);

    const revoked = Proxy.revocable({
      availableActions: createDefaultPlayerActionDescriptors(),
      selectorDescriptors: selectorDescriptors(),
      state: state(),
      context: context()
    }, {});
    revoked.revoke();
    expect(() => compileHudBuildMenuPlanV1(definitions(), revoked.proxy)).not.toThrow();
    expect(compileHudBuildMenuPlanV1(definitions(), revoked.proxy).ok).toBe(false);
    expect(String(compileHudBuildMenuPlanV1)).not.toMatch(/document|window|HTMLElement|Phaser|GameCommand|emitSignal/);
  });
});
