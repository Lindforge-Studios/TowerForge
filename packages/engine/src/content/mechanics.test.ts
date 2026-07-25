import { describe, expect, it, vi } from "vitest";
import {
  IMPLEMENTED_MECHANICS_MODULE_IDS,
  MECHANICS_MODULE_IDS,
  resolveCapabilitySet,
  type CapabilitySet,
  type MechanicsCatalog,
  type MissionMechanicsSelection
} from "../index.js";

const SUPPORTED_MODULE_IDS = [
  "combat",
  "reactions",
  "navigation",
  "elevation",
  "physics",
  "terraforming",
  "roguelite",
  "heroes",
  "logistics",
  "director",
  "scriptingDx",
  "multiplayer"
] as const;

function catalogFixture(): MechanicsCatalog {
  return {
    schemaVersion: 1,
    modules: {
      combat: {
        schemaVersion: 1,
        enabled: true,
        profiles: {
          elemental: { damageTypes: ["fire", "ice"] }
        }
      },
      reactions: {
        schemaVersion: 1,
        enabled: true,
        profiles: {
          bounded: { maxDepth: 1, maxFanOut: 4 }
        }
      },
      navigation: {
        schemaVersion: 1,
        enabled: false,
        profiles: {
          flow: { mode: "dynamic_flow" }
        }
      },
      elevation: {
        schemaVersion: 1,
        enabled: true,
        profiles: {
          authored: {}
        }
      }
    }
  };
}

describe("mechanics capability resolution", () => {
  it("publishes the stable module id order used by Studio and MCP", () => {
    expect(MECHANICS_MODULE_IDS).toEqual([...SUPPORTED_MODULE_IDS]);
  });

  it("implements the shipped mechanics while leaving later modules unavailable", () => {
    expect(IMPLEMENTED_MECHANICS_MODULE_IDS).toEqual([
      "combat", "reactions", "navigation", "elevation", "physics", "terraforming"
    ]);

    const capabilities = resolveCapabilitySet(
      catalogFixture(),
      { profiles: { combat: "elemental", elevation: "authored" } }
    );

    expect(capabilities.combat).toEqual({
      moduleId: "combat",
      available: true,
      moduleEnabled: true,
      active: true,
      profileId: "elemental",
      reason: "active"
    });
    expect(capabilities.elevation).toEqual({
      moduleId: "elevation",
      available: true,
      moduleEnabled: true,
      active: true,
      profileId: "authored",
      reason: "active"
    });
  });

  it("activates combat schema v3 and keeps an unsupported schema v4 inactive", () => {
    const marksCatalog = {
      schemaVersion: 1,
      modules: {
        combat: {
          schemaVersion: 3,
          enabled: true,
          profiles: { marked: { marks: { definitions: {} } } }
        }
      }
    } as unknown as MechanicsCatalog;
    expect(resolveCapabilitySet(marksCatalog, { profiles: { combat: "marked" } }).combat).toMatchObject({
      available: true,
      active: true,
      profileId: "marked",
      reason: "active"
    });

    const futureCatalog = {
      schemaVersion: 1,
      modules: {
        combat: {
          schemaVersion: 4,
          enabled: true,
          profiles: { future: {} }
        }
      }
    } as unknown as MechanicsCatalog;

    expect(resolveCapabilitySet(futureCatalog, { profiles: { combat: "future" } }).combat).toEqual({
      moduleId: "combat",
      available: true,
      moduleEnabled: true,
      active: false,
      profileId: "future",
      reason: "module_version_unsupported"
    });
  });

  it("activates only an available, enabled module selected by an existing mission profile", () => {
    const selection: MissionMechanicsSelection = {
      profiles: {
        combat: "elemental",
        navigation: "flow",
        elevation: "missing_profile",
        heroes: "field_commander"
      }
    };
    const capabilities: CapabilitySet = resolveCapabilitySet(
      catalogFixture(),
      selection,
      [...SUPPORTED_MODULE_IDS]
    );

    expect(Object.keys(capabilities)).toEqual([...SUPPORTED_MODULE_IDS]);
    expect(capabilities.combat).toEqual({
      moduleId: "combat",
      available: true,
      moduleEnabled: true,
      active: true,
      profileId: "elemental",
      reason: "active"
    });
    expect(capabilities.navigation).toMatchObject({
      available: true,
      moduleEnabled: false,
      active: false,
      profileId: "flow",
      reason: "module_disabled"
    });
    expect(capabilities.elevation).toMatchObject({
      available: true,
      moduleEnabled: true,
      active: false,
      profileId: "missing_profile",
      reason: "profile_missing"
    });
    expect(capabilities.heroes).toMatchObject({
      available: true,
      moduleEnabled: false,
      active: false,
      profileId: "field_commander",
      reason: "module_missing"
    });
    expect(capabilities.reactions).toMatchObject({
      available: true,
      moduleEnabled: true,
      active: false,
      reason: "not_selected"
    });
    expect(capabilities.reactions.profileId).toBeUndefined();

    expect(JSON.parse(JSON.stringify(capabilities))).toEqual(capabilities);

    // CapabilitySet is an engine-owned read-only view; consumers must not mutate resolution.
    // @ts-expect-error active is readonly
    capabilities.combat.active = false;
    // @ts-expect-error capability entries are readonly
    capabilities.combat = capabilities.navigation;
  });

  it("keeps absent mechanics fully inactive and serializable", () => {
    const capabilities = resolveCapabilitySet(
      { schemaVersion: 1, modules: {} },
      {},
      [...SUPPORTED_MODULE_IDS]
    );

    expect(Object.values(capabilities).every((state) => state.active === false)).toBe(true);
    expect(Object.values(capabilities).every((state) => state.reason === "module_missing")).toBe(true);
  });

  it.each(["own accessor", "inherited accessor", "non-enumerable data"] as const)(
    "does not treat an %s combat module as authored data",
    (kind) => {
      const getter = vi.fn(() => {
        throw new Error("SYNTHETIC_SECRET_MODULE_GETTER");
      });
      const modules: Record<string, unknown> = kind === "inherited accessor"
        ? Object.create(Object.defineProperty({}, "combat", { enumerable: true, get: getter }))
        : {};
      if (kind === "own accessor") {
        Object.defineProperty(modules, "combat", { enumerable: true, get: getter });
      } else if (kind === "non-enumerable data") {
        Object.defineProperty(modules, "combat", {
          enumerable: false,
          value: catalogFixture().modules.combat
        });
      }

      let capabilities: CapabilitySet | undefined;
      let caught: unknown;
      try {
        capabilities = resolveCapabilitySet({ schemaVersion: 1, modules } as MechanicsCatalog);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeUndefined();
      expect(getter).not.toHaveBeenCalled();
      expect(capabilities?.combat).toMatchObject({ active: false, reason: "module_missing" });
    }
  );

  it.each(["own accessor", "inherited accessor", "non-enumerable data"] as const)(
    "does not treat an %s combat mission selection as authored data",
    (kind) => {
      const getter = vi.fn(() => {
        throw new Error("SYNTHETIC_SECRET_SELECTION_GETTER");
      });
      const profiles: Record<string, unknown> = kind === "inherited accessor"
        ? Object.create(Object.defineProperty({}, "combat", { enumerable: true, get: getter }))
        : {};
      if (kind === "own accessor") {
        Object.defineProperty(profiles, "combat", { enumerable: true, get: getter });
      } else if (kind === "non-enumerable data") {
        Object.defineProperty(profiles, "combat", { enumerable: false, value: "elemental" });
      }

      let capabilities: CapabilitySet | undefined;
      let caught: unknown;
      try {
        capabilities = resolveCapabilitySet(
          catalogFixture(),
          { profiles } as MissionMechanicsSelection
        );
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeUndefined();
      expect(getter).not.toHaveBeenCalled();
      expect(capabilities?.combat).toMatchObject({ active: false, reason: "not_selected" });
      expect(capabilities?.combat.profileId).toBeUndefined();
    }
  );
});
