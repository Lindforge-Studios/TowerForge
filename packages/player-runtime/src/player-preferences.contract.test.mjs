import { describe, expect, it } from "vitest";
import {
  PLAYER_PREFERENCES_SCHEMA_VERSION,
  createDefaultPlayerPreferences,
  parsePlayerPreferencesV1,
  serializePlayerPreferencesV1
} from "./player-preferences.mjs";

describe("PlayerPreferencesV1 closed codec (RED)", () => {
  it("round-trips canonical immutable defaults", () => {
    expect(PLAYER_PREFERENCES_SCHEMA_VERSION).toBe(1);
    const defaults = createDefaultPlayerPreferences();
    expect(Object.isFrozen(defaults)).toBe(true);
    expect(defaults.schemaVersion).toBe(1);
    expect(parsePlayerPreferencesV1(serializePlayerPreferencesV1(defaults))).toEqual(defaults);
    expect(serializePlayerPreferencesV1(defaults)).toBe(serializePlayerPreferencesV1(defaults));
  });

  it.each([
    ["future", JSON.stringify({ ...createDefaultPlayerPreferences(), schemaVersion: 2 })],
    ["unknown field", JSON.stringify({ ...createDefaultPlayerPreferences(), accessToken: "must-not-survive" })],
    ["corrupt JSON", '{"schemaVersion":1'],
    ["non-object", "null"]
  ])("rejects %s preferences without returning a partial object", (_label, raw) => {
    expect(() => parsePlayerPreferencesV1(raw)).toThrow();
  });

  it("rejects accessor-backed input without invoking it", () => {
    let reads = 0;
    const candidate = { ...createDefaultPlayerPreferences() };
    Object.defineProperty(candidate, "locale", { enumerable: true, get() { reads += 1; return "ru"; } });
    expect(() => serializePlayerPreferencesV1(candidate)).toThrow();
    expect(reads).toBe(0);
  });
});
