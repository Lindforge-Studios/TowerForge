import { describe, expect, it } from "vitest";
import {
  PLAYER_ACTION_DESCRIPTOR_SCHEMA_VERSION,
  createDefaultPlayerActionDescriptors,
  createPlayerActionRegistry
} from "./player-actions.mjs";

function descriptor(id = "pause", overrides = {}) {
  return {
    schemaVersion: 1,
    id,
    labelKey: `player.action.${id}`,
    kind: "ui",
    ...overrides
  };
}

describe("Player action descriptor registry v1 (RED)", () => {
  it("provides one immutable descriptor for every desktop-shell and engine action", () => {
    expect(PLAYER_ACTION_DESCRIPTOR_SCHEMA_VERSION).toBe(1);
    const descriptors = createDefaultPlayerActionDescriptors();
    expect(Object.isFrozen(descriptors)).toBe(true);
    expect(descriptors.every(Object.isFrozen)).toBe(true);
    const ids = descriptors.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([
      "pause", "cameraPan", "cameraZoom", "cameraReset", "fullscreen",
      "startWave", "placeTower", "upgradeTower", "sellTower", "setTargetMode",
      "useAbility", "useHeroAbility", "socketArtifact", "unsocketArtifact", "configureTowerModules"
    ]));
    expect(descriptors.every((entry) => entry.schemaVersion === 1 && typeof entry.labelKey === "string")).toBe(true);
  });

  it("rejects inherited descriptor ids and never resolves Object.prototype handlers", () => {
    const inherited = Object.create({ id: "constructor" });
    Object.assign(inherited, {
      schemaVersion: 1,
      labelKey: "player.action.constructor",
      kind: "ui"
    });

    expect(() => createPlayerActionRegistry({ descriptors: [inherited], handlers: {} }))
      .toThrow(/own data|descriptor|id/i);
  });

  it("rejects descriptor and handler accessors without invoking either getter", () => {
    let descriptorReads = 0;
    const accessorDescriptor = descriptor();
    Object.defineProperty(accessorDescriptor, "id", {
      enumerable: true,
      get() { descriptorReads += 1; return "pause"; }
    });
    expect(() => createPlayerActionRegistry({
      descriptors: [accessorDescriptor],
      handlers: { pause: () => ({ ok: true }) }
    })).toThrow(/own data|accessor|descriptor/i);
    expect(descriptorReads).toBe(0);

    let handlerReads = 0;
    const accessorHandlers = {};
    Object.defineProperty(accessorHandlers, "pause", {
      enumerable: true,
      get() { handlerReads += 1; return () => ({ ok: true }); }
    });
    expect(() => createPlayerActionRegistry({
      descriptors: [descriptor()],
      handlers: accessorHandlers
    })).toThrow(/own data|accessor|handler/i);
    expect(handlerReads).toBe(0);
  });

  it("fails closed for revoked descriptor and handler proxies", () => {
    const descriptorProxy = Proxy.revocable(descriptor(), {});
    descriptorProxy.revoke();
    expect(() => createPlayerActionRegistry({
      descriptors: [descriptorProxy.proxy],
      handlers: { pause: () => ({ ok: true }) }
    })).toThrow();

    const handlerProxy = Proxy.revocable({ pause: () => ({ ok: true }) }, {});
    handlerProxy.revoke();
    expect(() => createPlayerActionRegistry({
      descriptors: [descriptor()],
      handlers: handlerProxy.proxy
    })).toThrow();
  });

  it.each([
    ["unknown descriptor field", [descriptor("pause", { surprise: true })], { pause: () => ({ ok: true }) }],
    ["future descriptor schema", [descriptor("pause", { schemaVersion: 2 })], { pause: () => ({ ok: true }) }],
    ["invalid descriptor kind", [descriptor("pause", { kind: "javascript" })], { pause: () => ({ ok: true }) }],
    ["duplicate descriptor id", [descriptor("pause"), descriptor("pause")], { pause: () => ({ ok: true }) }],
    ["unknown handler", [descriptor("pause")], { pause: () => ({ ok: true }), constructor: () => ({ ok: false }) }]
  ])("rejects %s", (_label, descriptors, handlers) => {
    expect(() => createPlayerActionRegistry({ descriptors, handlers })).toThrow();
  });

  it("detaches the own-data handler map before invoking a registered action", () => {
    const calls = [];
    const handlers = {
      pause(payload) { calls.push(["original", payload]); return Object.freeze({ ok: true, source: "original" }); }
    };
    const registry = createPlayerActionRegistry({ descriptors: [descriptor()], handlers });
    handlers.pause = (payload) => { calls.push(["mutated", payload]); return { ok: false, source: "mutated" }; };

    expect(registry.invoke("pause", { source: "test" })).toEqual({ ok: true, source: "original" });
    expect(calls).toEqual([["original", { source: "test" }]]);
    expect(registry.invoke("constructor")).toEqual({ ok: false, code: "unsupported_player_action" });
  });
});
