import { describe, expect, it } from "vitest";
import { PLAYER_ACTION_DESCRIPTOR_SCHEMA_VERSION, createDefaultPlayerActionDescriptors } from "./player-actions.mjs";

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
});
