import { describe, expect, it } from "vitest";
import {
  HUD_SCREEN_CONDITION_OPERATORS,
  HUD_SCREEN_EVENTS,
  HUD_SCREEN_GRAPH_SCHEMA_VERSION,
  HUD_SYSTEM_RECOVERY_SCREEN_ID,
  createHudScreenGraphSessionV1
} from "./hud-screen-graph.mjs";

const SURFACES = [
  "title", "profile_selection", "loading", "mission_selection", "campaign_selection", "story",
  "setup", "gameplay", "between_wave", "draft", "pause", "settings", "victory", "defeat",
  "result", "recoverable_error"
];

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
  return { schemaVersion: 1, designViewport: { width, height }, rootNodeIds: [] };
}

function transition(id, event, targetScreenId, overrides = {}) {
  return {
    id,
    event,
    targetScreenId,
    conditions: [],
    ...overrides
  };
}

function profile(overrides = {}) {
  const screens = Object.fromEntries(SURFACES.map((surface) => [surface, {
    schemaVersion: 1,
    surface,
    rootNodeIds: []
  }]));
  return {
    schemaVersion: 1,
    label: "Full shell",
    breakpoints: { mobileMax: 767, tabletMax: 1199 },
    commonNodes: [],
    variants: {
      desktop: layoutVariant(1920, 1080),
      tablet: layoutVariant(1024, 768),
      mobile: layoutVariant(390, 844)
    },
    screens,
    screenGraph: {
      schemaVersion: 1,
      initialScreenId: "title",
      transitions: [
        transition("title_profile", "profileSelected", "profile_selection", { fromScreenId: "title" }),
        transition("profile_loading", "contentLoaded", "loading", { fromScreenId: "profile_selection" }),
        transition("loading_mission", "missionSelected", "mission_selection", { fromScreenId: "loading" }),
        transition("mission_campaign", "campaignSelected", "campaign_selection", { fromScreenId: "mission_selection" }),
        transition("campaign_story", "storyStarted", "story", { fromScreenId: "campaign_selection" }),
        transition("story_setup", "storyCompleted", "setup", { fromScreenId: "story" }),
        transition("setup_gameplay", "waveStarted", "gameplay", { fromScreenId: "setup" }),
        transition("gameplay_between", "waveEnded", "between_wave", { fromScreenId: "gameplay" }),
        transition("between_draft", "draftRequired", "draft", { fromScreenId: "between_wave" }),
        transition("draft_gameplay", "draftCompleted", "gameplay", { fromScreenId: "draft" }),
        transition("gameplay_pause", "pauseRequested", "pause", { fromScreenId: "gameplay" }),
        transition("pause_settings", "settingsRequested", "settings", { fromScreenId: "pause" }),
        transition("settings_pause", "settingsClosed", "pause", { fromScreenId: "settings" }),
        transition("pause_gameplay", "resumeRequested", "gameplay", { fromScreenId: "pause" }),
        transition("gameplay_victory", "victory", "victory", { fromScreenId: "gameplay" }),
        transition("gameplay_defeat", "defeat", "defeat", { fromScreenId: "gameplay" }),
        transition("victory_result", "resultRequested", "result", { fromScreenId: "victory" }),
        transition("defeat_result", "resultRequested", "result", { fromScreenId: "defeat" }),
        transition("recoverable_error", "recoverableError", "recoverable_error")
      ]
    },
    assetRoles: {},
    ...overrides
  };
}

function selectorDescriptors() {
  return [
    { schemaVersion: 1, id: "canPause", valueType: "boolean", cardinality: "one" },
    { schemaVersion: 1, id: "coreHp", valueType: "number", cardinality: "one" },
    { schemaVersion: 1, id: "phase", valueType: "string", cardinality: "one" }
  ];
}

function state(overrides = {}) {
  return {
    selectors: {
      canPause: true,
      coreHp: 100,
      phase: "management",
      ...overrides
    }
  };
}

function create(value = profile(), overrides = {}) {
  return createHudScreenGraphSessionV1(value, {
    selectorDescriptors: selectorDescriptors(),
    state: state(),
    ...overrides
  });
}

function expectScreen(session, screenId) {
  const snapshot = session.snapshot();
  expect(snapshot.currentScreenId).toBe(screenId);
  expect(Object.isFrozen(snapshot)).toBe(true);
  return snapshot;
}

describe("R21.3 pure HUD screen graph and mandatory recovery contract (RED)", () => {
  it("publishes the closed v1 event/operator catalogs and an always-available built-in recovery overlay", () => {
    expect(HUD_SCREEN_GRAPH_SCHEMA_VERSION).toBe(1);
    expect(HUD_SCREEN_EVENTS).toEqual(expect.arrayContaining([
      "profileSelected", "contentLoaded", "missionSelected", "campaignSelected", "storyStarted",
      "storyCompleted", "waveStarted", "waveEnded", "draftRequired", "draftCompleted",
      "pauseRequested", "settingsRequested", "settingsClosed", "resumeRequested", "victory",
      "defeat", "resultRequested", "recoverableError"
    ]));
    expect(HUD_SCREEN_CONDITION_OPERATORS).toEqual([
      "equals", "not_equals", "less_than", "less_than_or_equal", "greater_than",
      "greater_than_or_equal", "truthy", "falsy"
    ]);

    const session = create();
    expect(session.ok).toBe(true);
    expect(session.systemRecovery).toEqual({
      schemaVersion: 1,
      screenId: HUD_SYSTEM_RECOVERY_SCREEN_ID,
      surface: "recoverable_error",
      builtIn: true,
      removable: false
    });
    expect(Object.isFrozen(session.systemRecovery)).toBe(true);
    expectScreen(session, "title");
  });

  it("navigates all authored shell surfaces while each dispatch performs at most one transition", () => {
    const session = create();
    const path = [
      ["profileSelected", "profile_selection"], ["contentLoaded", "loading"],
      ["missionSelected", "mission_selection"], ["campaignSelected", "campaign_selection"],
      ["storyStarted", "story"], ["storyCompleted", "setup"], ["waveStarted", "gameplay"],
      ["waveEnded", "between_wave"], ["draftRequired", "draft"], ["draftCompleted", "gameplay"],
      ["pauseRequested", "pause"], ["settingsRequested", "settings"], ["settingsClosed", "pause"],
      ["resumeRequested", "gameplay"], ["victory", "victory"], ["resultRequested", "result"],
      ["recoverableError", "recoverable_error"]
    ];
    for (const [event, target] of path) {
      const result = session.dispatch(event);
      expect(result).toMatchObject({ ok: true, transitioned: true, currentScreenId: target });
      expectScreen(session, target);
    }
  });

  it("uses AND conditions and authored first-match order without recursively following cycles", () => {
    const value = profile();
    value.screenGraph.initialScreenId = "gameplay";
    value.screenGraph.transitions = [
      transition("boss_result", "victory", "result", {
        fromScreenId: "gameplay",
        conditions: [
          { selectorId: "coreHp", operator: "greater_than", value: 0 },
          { selectorId: "phase", operator: "equals", value: "boss" }
        ]
      }),
      transition("ordinary_victory", "victory", "victory", { fromScreenId: "gameplay" }),
      transition("cycle_back", "victory", "gameplay", { fromScreenId: "result" })
    ];
    const session = create(value, { state: state({ phase: "boss" }) });

    expect(session.dispatch("victory")).toMatchObject({
      transitioned: true,
      transitionId: "boss_result",
      previousScreenId: "gameplay",
      currentScreenId: "result"
    });
    expectScreen(session, "result");
    expect(session.dispatch("victory")).toMatchObject({
      transitioned: true,
      transitionId: "cycle_back",
      currentScreenId: "gameplay"
    });
  });

  it("preserves authored transition order but ignores screen/selector record insertion order", () => {
    const first = profile();
    first.screenGraph.initialScreenId = "gameplay";
    first.screenGraph.transitions = [
      transition("first", "victory", "victory", { fromScreenId: "gameplay" }),
      transition("second", "victory", "result", { fromScreenId: "gameplay" })
    ];
    const second = structuredClone(first);
    second.screens = nullRecord(Object.entries(second.screens).reverse());
    const descriptors = [...selectorDescriptors()].reverse();
    const runtime = { selectors: nullRecord(Object.entries(state().selectors).reverse()) };

    const a = create(first);
    const b = create(second, { selectorDescriptors: descriptors, state: runtime });
    expect(a.dispatch("victory").transitionId).toBe("first");
    expect(b.dispatch("victory").transitionId).toBe("first");
    expect(a.snapshot()).toEqual(b.snapshot());

    const reversed = structuredClone(first);
    reversed.screenGraph.transitions.reverse();
    expect(create(reversed).dispatch("victory").transitionId).toBe("second");
  });

  it("supports all scalar comparison operators and leaves the screen unchanged when none match", () => {
    const cases = [
      ["equals", "phase", "boss", "boss"],
      ["not_equals", "phase", "setup", "boss"],
      ["less_than", "coreHp", 20, 10],
      ["less_than_or_equal", "coreHp", 10, 10],
      ["greater_than", "coreHp", 90, 100],
      ["greater_than_or_equal", "coreHp", 100, 100],
      ["truthy", "canPause", true, true],
      ["falsy", "canPause", false, false]
    ];
    for (const [operator, selectorId, expected, actual] of cases) {
      const value = profile();
      value.screenGraph.initialScreenId = "gameplay";
      value.screenGraph.transitions = [transition(operator, "pauseRequested", "pause", {
        fromScreenId: "gameplay",
        conditions: [{ selectorId, operator, value: expected }]
      })];
      const session = create(value);
      expect(session.dispatch("pauseRequested", state({ [selectorId]: actual }))).toMatchObject({
        ok: true,
        transitioned: true,
        currentScreenId: "pause"
      });
    }

    const unmatched = profile();
    unmatched.screenGraph.initialScreenId = "gameplay";
    unmatched.screenGraph.transitions = [transition("lt", "pauseRequested", "pause", {
      fromScreenId: "gameplay",
      conditions: [{ selectorId: "coreHp", operator: "less_than", value: 20 }]
    })];
    expect(create(unmatched).dispatch("pauseRequested", state({ coreHp: 25 }))).toMatchObject({
      ok: true,
      transitioned: false,
      currentScreenId: "gameplay"
    });
  });

  it("detaches selector state and rejects selectors absent from the descriptor registry", () => {
    const value = profile();
    value.screenGraph.initialScreenId = "gameplay";
    value.screenGraph.transitions = [transition("pause", "pauseRequested", "pause", {
      fromScreenId: "gameplay",
      conditions: [{ selectorId: "canPause", operator: "truthy", value: true }]
    })];
    const initialState = state({ canPause: false });
    const session = create(value, { state: initialState });
    initialState.selectors.canPause = true;
    expect(session.dispatch("pauseRequested")).toMatchObject({ transitioned: false });
    expect(session.dispatch("pauseRequested", state({ canPause: true }))).toMatchObject({ transitioned: true });

    const unknown = structuredClone(value);
    unknown.screenGraph.transitions[0].conditions[0].selectorId = "unknownFlag";
    const invalid = create(unknown);
    expect(invalid.ok).toBe(false);
    expect(expectScreen(invalid, HUD_SYSTEM_RECOVERY_SCREEN_ID)).toMatchObject({ recoveryActive: true });
  });

  it.each([
    ["future graph", (value) => { value.screenGraph.schemaVersion = 2; }],
    ["unknown target", (value) => { value.screenGraph.transitions[0].targetScreenId = "missing"; }],
    ["unknown event", (value) => { value.screenGraph.transitions[0].event = "executeCode"; }],
    ["sparse transition list", (value) => { value.screenGraph.transitions = new Array(1); }],
    ["over-budget transition list", (value) => {
      value.screenGraph.transitions = Array.from({ length: 257 }, (_, index) => transition(
        `transition_${index}`, "victory", "victory"
      ));
    }],
    ["over-budget condition list", (value) => {
      value.screenGraph.transitions[0].conditions = Array.from({ length: 17 }, () => ({
        selectorId: "canPause", operator: "truthy", value: true
      }));
    }]
  ])("enters the built-in recovery overlay for %s instead of partially running", (_label, mutate) => {
    const value = profile();
    value.screenGraph.transitions = [transition("victory", "victory", "victory")];
    mutate(value);
    const session = create(value);
    expect(session.ok).toBe(false);
    expect(expectScreen(session, HUD_SYSTEM_RECOVERY_SCREEN_ID)).toMatchObject({ recoveryActive: true });
    expect(session.dispatch("victory")).toMatchObject({
      ok: false,
      transitioned: false,
      currentScreenId: HUD_SYSTEM_RECOVERY_SCREEN_ID
    });
  });

  it("fails into mandatory recovery for accessors, symbols, proxies and sparse runtime descriptors without invoking code", () => {
    const accessor = profile();
    let reads = 0;
    Object.defineProperty(accessor.screenGraph.transitions, "0", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("must not execute");
      }
    });
    expect(create(accessor).ok).toBe(false);
    expect(reads).toBe(0);

    const symbolState = state();
    symbolState.selectors[Symbol("hidden")] = true;
    expect(create(profile(), { state: symbolState }).ok).toBe(false);

    const sparseDescriptors = new Array(1);
    expect(create(profile(), { selectorDescriptors: sparseDescriptors }).ok).toBe(false);

    const revoked = Proxy.revocable({ selectorDescriptors: selectorDescriptors(), state: state() }, {});
    revoked.revoke();
    expect(() => createHudScreenGraphSessionV1(profile(), revoked.proxy)).not.toThrow();
    expect(createHudScreenGraphSessionV1(profile(), revoked.proxy).ok).toBe(false);
  });

  it("is pure and DOM-free and never exposes gameplay mutation actions from navigation", () => {
    const session = create();
    expect(String(createHudScreenGraphSessionV1)).not.toMatch(/document|window|HTMLElement|Phaser|GameCommand|emitSignal/);
    expect(session.dispatch("unknownEvent")).toMatchObject({
      ok: false,
      transitioned: false,
      currentScreenId: HUD_SYSTEM_RECOVERY_SCREEN_ID
    });
    expect(session.systemRecovery.removable).toBe(false);
  });
});
