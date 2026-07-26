import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import {
  createGameContentRegistry,
  type GameContentInput,
  type GameContentRegistry
} from "./registry.js";
import { validateGameContentRegistry } from "./validate.js";

const EXPECTED_LIMITS = Object.freeze({
  towerTypesWithTags: 4_096,
  tagsPerTower: 16,
  totalTowerTagRefs: 16_384,
  tagUtf8Bytes: 128,
  synergyDefinitions: 32,
  synergyIdUtf8Bytes: 128,
  labelUtf8Bytes: 256,
  tiersPerSynergy: 8,
  requiredCount: 65_536,
  modifiersPerTier: 4,
  totalProfileModifiers: 32,
  flatAbsoluteValue: 1_000_000_000_000,
  additiveRatioMinimum: -1,
  additiveRatioMaximum: 1_000,
  multiplierMinimum: 0,
  multiplierMaximum: 1_000
});

type RogueliteMode = "absent" | "disabled" | "unselected" | "active" | "future";

function synergyProfile(): Record<string, unknown> {
  return {
    synergies: {
      tech_network: {
        label: "Tech Network",
        tag: "tech",
        tiers: [
          {
            requiredCount: 1,
            modifiers: [{ target: "damage", operation: "multiplier", value: 1.25 }]
          },
          {
            requiredCount: 2,
            modifiers: [{ target: "damage", operation: "additive_ratio", value: 0.5 }]
          }
        ]
      }
    }
  };
}

function rogueliteInput(
  mode: RogueliteMode = "active",
  profile: Record<string, unknown> = synergyProfile()
): GameContentInput {
  const towerWithTags = {
    id: "pulse",
    label: "Pulse",
    tags: ["tech", "elemental"],
    cost: { coins: 1 },
    footprintRadius: 0,
    range: 4,
    attack: {
      kind: "pulse" as const,
      pulseRate: 1,
      pulseDamage: 10,
      dotDamagePerUnit: 2,
      dotDuration: 2
    }
  };
  return {
    balance: {
      defaultMissionId: "rogue",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 100,
        startingResources: { coins: 100 },
        prepTimeUnits: 0,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 1,
        pathWaterDurationUnits: 1,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      terrainTypes: {
        floor: {
          id: "floor", label: "Floor", buildable: true, walkable: true,
          groundSpeedMultiplier: 1, tags: []
        }
      },
      abilities: {},
      enemies: {
        target: {
          id: "target", label: "Target", maxHp: 1_000, speed: 0.01,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        }
      },
      towers: { pulse: towerWithTags },
      waveSets: {
        one: [{
          id: "one", label: "One",
          groups: [{ enemyId: "target", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        rogue: {
          id: "rogue", label: "Rogue", description: "",
          startingCoreHp: 20, startingResources: { coins: 100 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "one", buildTowerIds: ["pulse"], abilityIds: [],
          ...(mode === "unselected" || mode === "absent"
            ? {}
            : { mechanics: { profiles: { roguelite: "core" } } })
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 6, height: 3,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "floor",
        spawnCoord: { q: 0, r: 0 }, coreCoord: { q: 5, r: 0 },
        pathCenterline: Array.from({ length: 6 }, (_, q) => ({ q, r: 0 })),
        pathRoutes: [], terrainOverrides: []
      }
    },
    ...(mode === "absent" ? {} : {
      mechanics: {
        schemaVersion: 1,
        modules: {
          roguelite: {
            schemaVersion: mode === "future" ? 2 : 1,
            enabled: mode !== "disabled",
            profiles: { core: profile }
          }
        }
      }
    }),
    worldMap: {
      width: 10, height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "rogue", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function content(mode: RogueliteMode = "active", profile = synergyProfile()): GameContentRegistry {
  return createGameContentRegistry(rogueliteInput(mode, profile));
}

function activeProfile(subject: GameContentRegistry): unknown {
  const resolver = (Engine as unknown as {
    resolveActiveRogueliteMechanics?: (content: GameContentRegistry, missionId: string) => unknown;
  }).resolveActiveRogueliteMechanics;
  expect(resolver, "R4.1A must export the defensive active-profile resolver").toBeTypeOf("function");
  return resolver?.(subject, "rogue");
}

describe("R4.1A roguelite v1 schema and capability", () => {
  it("publishes the exact frozen limits and closed authoring descriptor", () => {
    const exports = Engine as unknown as Record<string, unknown>;
    expect(exports.ROGUELITE_SYNERGY_LIMITS).toEqual(EXPECTED_LIMITS);
    expect(Object.isFrozen(exports.ROGUELITE_SYNERGY_LIMITS)).toBe(true);

    const schema = exports.ROGUELITE_MECHANICS_SCHEMA as Record<string, unknown> | undefined;
    expect(schema).toBeDefined();
    expect(Object.keys(schema ?? {})).toEqual([
      "schemaVersion",
      "moduleId",
      "supportedModuleSchemaVersions",
      "profile",
      "towerTags",
      "synergy",
      "tiers",
      "modifier",
      "limits",
      "runtimeSnapshot"
    ]);
    expect(schema).toMatchObject({
      schemaVersion: 1,
      moduleId: "roguelite",
      supportedModuleSchemaVersions: [1],
      profile: {
        requiredFields: ["synergies"], optionalFields: [], additionalProperties: false
      },
      towerTags: { field: "tags", optional: true, itemType: "string", uniqueItems: true },
      synergy: {
        requiredFields: ["label", "tag", "tiers"],
        optionalFields: ["tierMode"],
        additionalProperties: false,
        tierModes: ["highest", "cumulative"]
      },
      tiers: {
        requiredFields: ["requiredCount", "modifiers"], optionalFields: [], additionalProperties: false
      },
      modifier: {
        requiredFields: ["target", "operation", "value"],
        optionalFields: [],
        additionalProperties: false,
        targets: ["damage"],
        operations: ["flat", "additive_ratio", "multiplier"],
        stage: "run"
      },
      limits: EXPECTED_LIMITS,
      runtimeSnapshot: {
        path: "snapshot.roguelite",
        schemaVersion: 1,
        optionalUnlessActive: true,
        fields: ["schemaVersion", "synergies"]
      }
    });
    expect(Object.isFrozen(schema)).toBe(true);
    expect(Engine.IMPLEMENTED_MECHANICS_MODULE_IDS).toEqual([
      "combat", "reactions", "navigation", "elevation", "physics", "terraforming", "roguelite"
    ]);
  });

  it("accepts tower tags plus a closed valid profile and returns detached frozen active data", () => {
    const subject = content();
    expect(validateGameContentRegistry(subject).ok).toBe(true);
    const resolved = activeProfile(subject) as Record<string, unknown> | undefined;
    expect(resolved).toMatchObject({ schemaVersion: 1, profileId: "core" });
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(JSON.stringify(resolved)).toContain("tech_network");
  });

  it("distinguishes absent, disabled, unselected, future and active capability states", () => {
    const cases = [
      ["absent", "module_missing", false],
      ["disabled", "module_disabled", false],
      ["unselected", "not_selected", false],
      ["future", "module_version_unsupported", false],
      ["active", "active", true]
    ] as const;
    for (const [mode, reason, active] of cases) {
      const subject = content(mode);
      expect(subject.missions.rogue!.capabilities.roguelite).toMatchObject({
        available: true,
        active,
        reason
      });
      expect(activeProfile(subject) !== undefined).toBe(active);
    }
  });

  it.each([
    ["too many tags", Array.from({ length: EXPECTED_LIMITS.tagsPerTower + 1 }, (_, i) => `tag_${i}`)],
    ["overlong UTF-8 tag", ["🔥".repeat(33)]]
  ])("rejects tower authoring with %s", (_label, tags) => {
    const input = rogueliteInput();
    (input.balance.towers.pulse as unknown as Record<string, unknown>).tags = tags;
    const result = validateGameContentRegistry(createGameContentRegistry(input));
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/towers.*pulse.*tags/i)
    }));
  });

  it("fails closed when untrusted tower tag descriptor inspection throws", () => {
    const subject = content();
    const tower = subject.towers.pulse!;
    subject.towers.pulse = new Proxy(tower, {
      getOwnPropertyDescriptor(target, property) {
        if (property === "tags") throw new Error("R41A_TAG_DESCRIPTOR_TRAP");
        return Reflect.getOwnPropertyDescriptor(target, property);
      }
    });

    let result: ReturnType<typeof validateGameContentRegistry> | undefined;
    expect(() => { result = validateGameContentRegistry(subject); }).not.toThrow();
    expect(result?.ok).toBe(false);
    expect(result?.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: "towers.pulse.tags"
    }));
  });

  it.each([
    ["extra profile field", { ...synergyProfile(), inventory: {} }],
    ["empty synergy id", { synergies: { "": (synergyProfile().synergies as Record<string, unknown>).tech_network } }],
    ["unknown tier mode", { synergies: { x: { label: "X", tag: "tech", tierMode: "all", tiers: [] } } }],
    ["zero required count", { synergies: { x: { label: "X", tag: "tech", tiers: [{ requiredCount: 0, modifiers: [] }] } } }],
    ["too many tiers", {
      synergies: {
        x: {
          label: "X", tag: "tech",
          tiers: Array.from({ length: EXPECTED_LIMITS.tiersPerSynergy + 1 }, (_, index) => ({
            requiredCount: index + 1, modifiers: []
          }))
        }
      }
    }],
    ["flat overflow", {
      synergies: {
        x: {
          label: "X", tag: "tech",
          tiers: [{
            requiredCount: 1,
            modifiers: [{ target: "damage", operation: "flat", value: EXPECTED_LIMITS.flatAbsoluteValue + 1 }]
          }]
        }
      }
    }],
    ["additive ratio below minimum", {
      synergies: {
        x: {
          label: "X", tag: "tech",
          tiers: [{
            requiredCount: 1,
            modifiers: [{ target: "damage", operation: "additive_ratio", value: -1.001 }]
          }]
        }
      }
    }],
    ["multiplier above maximum", {
      synergies: {
        x: {
          label: "X", tag: "tech",
          tiers: [{
            requiredCount: 1,
            modifiers: [{ target: "damage", operation: "multiplier", value: 1_001 }]
          }]
        }
      }
    }]
  ])("rejects %s through canonical content validation", (_label, profile) => {
    const result = validateGameContentRegistry(content("active", profile));
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/roguelite|synerg/i)
    }));
  });
});
