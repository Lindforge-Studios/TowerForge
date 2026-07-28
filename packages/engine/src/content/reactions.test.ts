import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import {
  IMPLEMENTED_MECHANICS_MODULE_IDS,
  resolveCapabilitySet,
  type MechanicsCatalog
} from "./mechanics.js";
import { createGameContentRegistry, type GameContentInput } from "./registry.js";
import { validateGameContentRegistry } from "./validate.js";

const REACTION_LIMITS_V1 = Object.freeze({
  exposureDefinitions: 256,
  damageTypeApplicationBindings: 256,
  applicationsPerDamageType: 16,
  totalExposureApplications: 4096,
  reactionDefinitions: 256,
  requirementsPerReaction: 8,
  effectsPerReaction: 8,
  totalReactionEffects: 2048,
  runtimeExposureApplications: 16_384,
  labelLength: 128,
  idTagUtf8Bytes: 128,
  duration: 1_000_000_000,
  maxStacks: 256,
  flatDamage: 1_000_000_000_000,
  sourceMultiplier: 1_000_000,
  radius: 64,
  targetsPerEffect: 64,
  maxDepth: 4,
  secondaryPacketsPerRoot: 256
});

function reactionsCatalog(options: {
  enabled?: boolean;
  schemaVersion?: number;
  includeProfile?: boolean;
} = {}): MechanicsCatalog {
  return {
    schemaVersion: 1,
    modules: {
      combat: {
        schemaVersion: 3,
        enabled: true,
        profiles: { elemental: {} }
      },
      reactions: {
        schemaVersion: options.schemaVersion ?? 1,
        enabled: options.enabled ?? true,
        profiles: options.includeProfile === false ? {} : { elemental: {} }
      }
    }
  } as unknown as MechanicsCatalog;
}

type ReactionsProfileFixture = Record<string, unknown>;

function validReactionsProfile(): ReactionsProfileFixture {
  return {
    exposures: {
      definitions: {
        fire: { label: "Fire", duration: 4, maxStacks: 1 },
        ice: { label: "Ice", duration: 4, maxStacks: 1 }
      },
      applications: {
        damageTypes: {
          fire: [{ exposureId: "fire" }],
          ice: [{ exposureId: "ice", stacks: 1 }]
        }
      }
    },
    reactions: {
      fire_then_ice: {
        label: "Shatter",
        trigger: { damageTypes: ["ice"] },
        requirements: [{ kind: "exposure", exposureId: "fire", minStacks: 1, consume: "all" }],
        suppressTriggerExposureApplications: true,
        effects: {
          paired_damage: {
            kind: "damage",
            amount: { kind: "source_after_modifiers", multiplier: 2 },
            damageType: "physical",
            target: { kind: "primary" },
            allowReactions: false
          }
        }
      },
      wet_lightning: {
        label: "Chain Shock",
        trigger: { damageTypes: ["lightning"] },
        requirements: [{ kind: "terrain_tag", tag: "wet" }],
        effects: {
          chain: {
            kind: "damage",
            amount: { kind: "source_after_modifiers", multiplier: 0.5 },
            damageType: "lightning",
            target: { kind: "terrain_tag", tag: "wet", maxTargets: 32 }
          }
        }
      },
      poison_fire: {
        label: "Combustion",
        trigger: { damageTypes: ["fire"] },
        requirements: [{ kind: "status", statusId: "poison", consume: "clear" }],
        effects: {
          burst: {
            kind: "damage",
            amount: { kind: "source_after_modifiers", multiplier: 1 },
            damageType: "fire",
            target: { kind: "radius", radius: 2, maxTargets: 32 }
          }
        }
      }
    }
  };
}

function reactionInput(options: {
  profile?: ReactionsProfileFixture;
  reactionsEnabled?: boolean;
  selectCombat?: boolean;
  selectReactions?: boolean;
  reactionsVersion?: number;
  combatVersion?: number;
} = {}): GameContentInput {
  const profiles: Record<string, string> = {};
  if (options.selectCombat ?? true) profiles.combat = "elemental";
  if (options.selectReactions ?? true) profiles.reactions = "elemental";
  return {
    balance: {
      defaultMissionId: "reactions",
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
        path: {
          id: "path",
          label: "Wet path",
          buildable: false,
          walkable: true,
          groundSpeedMultiplier: 1,
          tags: ["path", "wet"]
        }
      },
      abilities: {},
      enemies: {
        grunt: {
          id: "grunt",
          label: "Grunt",
          maxHp: 100,
          speed: 0.01,
          reward: { coins: 1 },
          coinReward: 1,
          coreDamage: 1,
          color: 1
        }
      },
      towers: {
        probe: {
          id: "probe",
          label: "Probe",
          cost: { coins: 1 },
          footprintRadius: 0,
          range: 2,
          attack: {
            kind: "single",
            fireRate: 1,
            damagePerStack: 1,
            startingStacks: 1,
            maxStacks: 1,
            upgradeCost: 1
          }
        }
      },
      waveSets: {
        one: [{
          id: "one",
          label: "One",
          groups: [{ enemyId: "grunt", count: 1, spawnInterval: 0, startDelay: 0 }]
        }]
      },
      missions: {
        reactions: {
          id: "reactions",
          label: "Reactions",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 100 },
          prepTimeUnits: 0,
          mapId: "lane",
          waveSetId: "one",
          buildTowerIds: ["probe"],
          abilityIds: [],
          ...(Object.keys(profiles).length === 0 ? {} : { mechanics: { profiles } })
        }
      }
    },
    maps: {
      lane: {
        id: "lane",
        width: 8,
        height: 3,
        defaultTerrain: "path",
        spawnCoord: { q: 0, r: 1 },
        coreCoord: { q: 7, r: 1 },
        pathCenterline: Array.from({ length: 8 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [],
        terrainOverrides: []
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        combat: {
          schemaVersion: options.combatVersion ?? 3,
          enabled: true,
          profiles: {
            elemental: {
              damageTypes: {
                physical: { label: "Physical" },
                fire: { label: "Fire" },
                ice: { label: "Ice" },
                lightning: { label: "Lightning" }
              },
              armorTypes: {},
              armorAssignments: {},
              ...((options.combatVersion ?? 3) === 3
                ? { marks: { definitions: {} } }
                : {})
            }
          }
        },
        reactions: {
          schemaVersion: options.reactionsVersion ?? 1,
          enabled: options.reactionsEnabled ?? true,
          profiles: { elemental: options.profile ?? validReactionsProfile() }
        }
      }
    } as unknown as GameContentInput["mechanics"],
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region",
        label: "Region",
        description: "",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        accent: "#fff",
        biome: "test",
        connections: []
      }],
      missionNodes: [{
        missionId: "reactions",
        regionId: "region",
        x: 5,
        y: 5,
        difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    }
  };
}

function validateReactions(options: Parameters<typeof reactionInput>[0] = {}) {
  return validateGameContentRegistry(createGameContentRegistry(reactionInput(options)));
}

function issue(
  result: ReturnType<typeof validateGameContentRegistry>,
  severity: "error" | "warning",
  path: RegExp,
  message: RegExp
): boolean {
  return result.issues.some((candidate) => (
    candidate.severity === severity
    && path.test(candidate.fieldPath)
    && message.test(candidate.message)
  ));
}

describe("R1.5 reactions module capability and public schema", () => {
  it("implements reactions v1 alongside navigation while leaving combat pinned to v3", () => {
    expect(IMPLEMENTED_MECHANICS_MODULE_IDS).toEqual([
      "combat", "reactions", "navigation", "elevation", "physics", "terraforming", "roguelite", "heroes",
      "logistics", "director"
    ]);

    const capabilities = resolveCapabilitySet(reactionsCatalog(), {
      profiles: { combat: "elemental", reactions: "elemental" }
    });
    expect(capabilities.combat).toMatchObject({
      available: true,
      active: true,
      profileId: "elemental",
      reason: "active"
    });
    expect(capabilities.reactions).toEqual({
      moduleId: "reactions",
      available: true,
      moduleEnabled: true,
      active: true,
      profileId: "elemental",
      reason: "active"
    });

    expect((Engine.COMBAT_MECHANICS_SCHEMA as { schemaVersion: number }).schemaVersion).toBe(3);
    expect((Engine.COMBAT_MECHANICS_SCHEMA as { supportedModuleSchemaVersions: readonly number[] })
      .supportedModuleSchemaVersions).toEqual([1, 2, 3]);
  });

  it("keeps absent, disabled, unselected, missing-profile, and future reactions inactive", () => {
    const absent = resolveCapabilitySet({ schemaVersion: 1, modules: {} }, {});
    expect(absent.reactions).toMatchObject({
      available: true,
      active: false,
      reason: "module_missing"
    });

    const disabled = resolveCapabilitySet(reactionsCatalog({ enabled: false }), {
      profiles: { reactions: "elemental" }
    });
    expect(disabled.reactions).toMatchObject({ active: false, reason: "module_disabled" });

    const unselected = resolveCapabilitySet(reactionsCatalog(), {});
    expect(unselected.reactions).toMatchObject({ active: false, reason: "not_selected" });

    const missing = resolveCapabilitySet(reactionsCatalog({ includeProfile: false }), {
      profiles: { reactions: "elemental" }
    });
    expect(missing.reactions).toMatchObject({ active: false, reason: "profile_missing" });

    const future = resolveCapabilitySet(reactionsCatalog({ schemaVersion: 2 }), {
      profiles: { reactions: "elemental" }
    });
    expect(future.reactions).toMatchObject({
      available: true,
      active: false,
      profileId: "elemental",
      reason: "module_version_unsupported"
    });
  });

  it("[verifier] reports dependency_missing when reactions are selected without an active combat selection", () => {
    const capabilities = resolveCapabilitySet(reactionsCatalog(), {
      profiles: { reactions: "elemental" }
    });

    expect(capabilities.reactions).toMatchObject({
      available: true,
      active: false,
      profileId: "elemental",
      reason: "dependency_missing"
    });

    const withoutRuntimeCombat = resolveCapabilitySet(
      reactionsCatalog(),
      { profiles: { combat: "elemental", reactions: "elemental" } },
      ["reactions"]
    );
    expect(withoutRuntimeCombat.reactions).toMatchObject({
      available: true,
      active: false,
      reason: "dependency_missing"
    });
  });

  it("publishes one closed bounded reactions v1 descriptor and the post-HP reaction hook", () => {
    const exports = Engine as unknown as {
      REACTION_LIMITS?: unknown;
      REACTIONS_MECHANICS_SCHEMA?: unknown;
    };
    expect(exports.REACTION_LIMITS).toEqual(REACTION_LIMITS_V1);
    expect(exports.REACTIONS_MECHANICS_SCHEMA).toMatchObject({
      schemaVersion: 1,
      moduleId: "reactions",
      supportedModuleSchemaVersions: [1],
      dependency: {
        moduleId: "combat",
        supportedModuleSchemaVersions: [2, 3]
      },
      profile: {
        additionalProperties: false,
        requiredFields: ["reactions"],
        optionalFields: ["exposures"]
      },
      limits: REACTION_LIMITS_V1,
      runtimeSnapshot: {
        path: "snapshot.reactions",
        schemaVersion: 1,
        optionalUnlessActive: true
      },
      towerScript: { minimumSchemaVersion: 5 }
    });

    expect(Engine.DAMAGE_PACKET_SCHEMA.pipelineOrder).toEqual([
      "modifiers",
      "marks",
      "armor_matrix",
      "entity_resistance",
      "legacy_pierce_only",
      "shield",
      "entity_hp",
      "reactions"
    ]);
  });
});

describe("R1.5 reactions v1 validation", () => {
  it("accepts the closed active profile against the mission-selected combat catalog", () => {
    expect(validateReactions()).toMatchObject({ ok: true, issues: [] });
  });

  it("requires an active combat v2/v3 dependency and rejects future reactions v2", () => {
    const noCombatSelection = validateReactions({ selectCombat: false });
    expect(noCombatSelection.ok).toBe(false);
    expect(issue(
      noCombatSelection,
      "error",
      /mechanics|profiles\.reactions|dependency/i,
      /dependency_missing|combat|v2|v3/i
    )).toBe(true);

    const combatV1 = validateReactions({ combatVersion: 1 });
    expect(combatV1.ok).toBe(false);
    expect(issue(combatV1, "error", /reactions|combat|dependency/i, /combat|v2|v3|dependency/i)).toBe(true);

    const future = validateReactions({ reactionsVersion: 2 });
    expect(future.ok).toBe(false);
    expect(issue(future, "error", /reactions.*schemaVersion|schemaVersion/i, /future|supported|version|1/i)).toBe(true);
  });

  it("keeps inactive semantic defects as warnings but structural defects and budgets as errors", () => {
    const broken = validReactionsProfile();
    const reaction = (broken.reactions as Record<string, Record<string, unknown>>).fire_then_ice!;
    (reaction.effects as Record<string, Record<string, unknown>>).paired_damage!.damageType = "void";
    const inactive = validateReactions({
      profile: broken,
      reactionsEnabled: false,
      selectReactions: true
    });
    expect(inactive.ok).toBe(true);
    expect(issue(inactive, "warning", /damageType|paired_damage|reactions/i, /void|unknown|inactive/i)).toBe(true);
    expect(inactive.issues.some((candidate) => candidate.severity === "error")).toBe(false);

    const overflow = validReactionsProfile();
    overflow.reactions = Object.fromEntries(Array.from({ length: 257 }, (_, index) => [
      `reaction_${index}`,
      {
        label: `Reaction ${index}`,
        trigger: { damageTypes: ["fire"] },
        effects: {
          damage: {
            kind: "damage",
            amount: { kind: "flat", value: 1 },
            damageType: "fire",
            target: { kind: "primary" }
          }
        }
      }
    ]));
    const inactiveOverflow = validateReactions({
      profile: overflow,
      reactionsEnabled: false,
      selectReactions: false
    });
    expect(inactiveOverflow.ok).toBe(false);
    expect(issue(inactiveOverflow, "error", /reactions/, /256|budget|limit|maximum/i)).toBe(true);
  });

  it("[verifier] rejects an inactive exposure binding budget overflow through canonical validation", () => {
    const profile = validReactionsProfile();
    const exposures = profile.exposures as {
      applications: { damageTypes: Record<string, unknown[]> };
    };
    exposures.applications.damageTypes = Object.fromEntries(
      Array.from({ length: 257 }, (_, index) => [`unknown_${index}`, []])
    );

    const result = validateReactions({
      profile,
      reactionsEnabled: false,
      selectReactions: false
    });

    expect(result.ok).toBe(false);
    expect(issue(
      result,
      "error",
      /exposures\.applications\.damageTypes|damage type applications/i,
      /256|binding|budget|limit|maximum/i
    )).toBe(true);
  });

  it.each([
    ["symbol", (values: string[]) => { (values as unknown as Record<PropertyKey, unknown>)[Symbol("hidden")] = true; }],
    ["non-index", (values: string[]) => { (values as unknown as Record<string, unknown>).extra = true; }]
  ] as const)("[verifier] rejects an inactive authored array with a %s field through canonical validation", (_label, mutate) => {
    const profile = validReactionsProfile();
    const reaction = (profile.reactions as Record<string, Record<string, unknown>>).fire_then_ice!;
    const trigger = reaction.trigger as { damageTypes: string[] };
    mutate(trigger.damageTypes);

    const result = validateReactions({
      profile,
      reactionsEnabled: false,
      selectReactions: false
    });

    expect(result.ok).toBe(false);
    expect(issue(
      result,
      "error",
      /trigger\.damageTypes|damageTypes/i,
      /array|symbol|field|json|unsupported/i
    )).toBe(true);
  });

  it.each([
    ["exposure id", (profile: ReactionsProfileFixture) => {
      const exposures = profile.exposures as {
        definitions: Record<string, unknown>;
        applications: { damageTypes: { fire: Array<{ exposureId: string }> } };
      };
      const longId = "x".repeat(129);
      exposures.definitions[longId] = exposures.definitions.fire;
      delete exposures.definitions.fire;
      exposures.applications.damageTypes.fire[0]!.exposureId = longId;
    }],
    ["reaction id", (profile: ReactionsProfileFixture) => {
      const reactions = profile.reactions as Record<string, unknown>;
      reactions["x".repeat(129)] = reactions.fire_then_ice;
      delete reactions.fire_then_ice;
    }],
    ["effect id", (profile: ReactionsProfileFixture) => {
      const reaction = (profile.reactions as Record<string, Record<string, unknown>>).fire_then_ice!;
      const effects = reaction.effects as Record<string, unknown>;
      effects["x".repeat(129)] = effects.paired_damage;
      delete effects.paired_damage;
    }],
    ["terrain tag", (profile: ReactionsProfileFixture) => {
      const reaction = (profile.reactions as Record<string, Record<string, unknown>>).wet_lightning!;
      reaction.requirements = [{ kind: "terrain_tag", tag: "🔥".repeat(33) }];
    }],
    ["target terrain tag", (profile: ReactionsProfileFixture) => {
      const reaction = (profile.reactions as Record<string, Record<string, unknown>>).wet_lightning!;
      const effect = (reaction.effects as Record<string, Record<string, unknown>>).chain!;
      effect.target = { kind: "terrain_tag", tag: "🔥".repeat(33), maxTargets: 1 };
    }],
    ["trigger list", (profile: ReactionsProfileFixture) => {
      const reaction = (profile.reactions as Record<string, Record<string, unknown>>).fire_then_ice!;
      reaction.trigger = {
        damageTypes: Array.from({ length: 257 }, (_, index) => `unknown_${index}`)
      };
    }]
  ] as const)("[verifier] enforces inactive authored bounds for %s through canonical validation", (_label, mutate) => {
    const profile = validReactionsProfile();
    mutate(profile);

    const result = validateReactions({
      profile,
      reactionsEnabled: false,
      selectReactions: false
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "mechanics",
      message: expect.stringMatching(/128|byte|bound|limit|maximum|array/i)
    }));
  });

  it("rejects duplicate triggers and requirements, unsafe fields, and invalid numeric bounds", () => {
    const malformed = validReactionsProfile();
    const reaction = (malformed.reactions as Record<string, Record<string, unknown>>).fire_then_ice!;
    reaction.trigger = { damageTypes: ["ice", "ice"] };
    reaction.requirements = [
      { kind: "exposure", exposureId: "fire", consume: "one" },
      { kind: "exposure", exposureId: "fire", consume: "all" }
    ];
    reaction.extra = true;
    const exposure = ((malformed.exposures as Record<string, unknown>).definitions as Record<string, Record<string, unknown>>).fire!;
    exposure.duration = 0;
    exposure.maxStacks = 1.5;

    const result = validateReactions({ profile: malformed });
    expect(result.ok).toBe(false);
    expect(issue(result, "error", /trigger.*damageTypes|damageTypes/, /duplicate|unique|ice/i)).toBe(true);
    expect(issue(result, "error", /requirements/, /duplicate|exposure|fire/i)).toBe(true);
    expect(issue(result, "error", /extra/, /unknown|unsupported|closed/i)).toBe(true);
    expect(issue(result, "error", /duration|maxStacks/, /range|positive|integer|duration|stack/i)).toBe(true);
  });

  it.each([
    ["a non-boolean suppression flag", (profile: ReactionsProfileFixture) => {
      const reaction = (profile.reactions as Record<string, Record<string, unknown>>).fire_then_ice!;
      reaction.suppressTriggerExposureApplications = "yes";
    }],
    ["a fractional topology radius", (profile: ReactionsProfileFixture) => {
      const reaction = (profile.reactions as Record<string, Record<string, unknown>>).poison_fire!;
      const effect = (reaction.effects as Record<string, Record<string, unknown>>).burst!;
      effect.target = { kind: "radius", radius: 1.5, maxTargets: 32 };
    }],
    ["a profile without the required reactions record", (profile: ReactionsProfileFixture) => {
      delete profile.reactions;
    }],
    ["an invalid exposure application stack count", (profile: ReactionsProfileFixture) => {
      const exposures = profile.exposures as { applications: { damageTypes: Record<string, Array<Record<string, unknown>>> } };
      exposures.applications.damageTypes.fire![0]!.stacks = 0;
    }],
    ["an unsupported status requirement", (profile: ReactionsProfileFixture) => {
      const reaction = (profile.reactions as Record<string, Record<string, unknown>>).poison_fire!;
      reaction.requirements = [{ kind: "status", statusId: "bleed", consume: "clear" }];
    }],
    ["an unknown reaction effect kind", (profile: ReactionsProfileFixture) => {
      const reaction = (profile.reactions as Record<string, Record<string, unknown>>).fire_then_ice!;
      const effect = (reaction.effects as Record<string, Record<string, unknown>>).paired_damage!;
      effect.kind = "heal";
    }],
    ["a zero source multiplier", (profile: ReactionsProfileFixture) => {
      const reaction = (profile.reactions as Record<string, Record<string, unknown>>).fire_then_ice!;
      const effect = (reaction.effects as Record<string, Record<string, unknown>>).paired_damage!;
      effect.amount = { kind: "source_after_modifiers", multiplier: 0 };
    }],
    ["a zero fan-out target budget", (profile: ReactionsProfileFixture) => {
      const reaction = (profile.reactions as Record<string, Record<string, unknown>>).poison_fire!;
      const effect = (reaction.effects as Record<string, Record<string, unknown>>).burst!;
      effect.target = { kind: "radius", radius: 2, maxTargets: 0 };
    }],
    ["a non-boolean allowReactions flag", (profile: ReactionsProfileFixture) => {
      const reaction = (profile.reactions as Record<string, Record<string, unknown>>).fire_then_ice!;
      const effect = (reaction.effects as Record<string, Record<string, unknown>>).paired_damage!;
      effect.allowReactions = "yes";
    }],
    ["an unknown target selector", (profile: ReactionsProfileFixture) => {
      const reaction = (profile.reactions as Record<string, Record<string, unknown>>).poison_fire!;
      const effect = (reaction.effects as Record<string, Record<string, unknown>>).burst!;
      effect.target = { kind: "global" };
    }]
  ] as const)("[verifier] rejects %s through canonical content validation", (_label, mutate) => {
    const profile = validReactionsProfile();
    mutate(profile);

    const result = validateReactions({ profile });
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: "error", entityKind: "mechanics" }));
  });

  it("rejects accessor-backed reaction data without invocation or secret leakage", () => {
    let getterCalls = 0;
    const hostile = validReactionsProfile();
    const reaction = (hostile.reactions as Record<string, Record<string, unknown>>).fire_then_ice!;
    Object.defineProperty(reaction, "effects", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("SYNTHETIC_REACTION_SECRET");
      }
    });

    let result: ReturnType<typeof validateReactions> | undefined;
    let caught: unknown;
    try {
      result = validateReactions({ profile: hostile });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeUndefined();
    expect(getterCalls).toBe(0);
    expect(result?.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_REACTION_SECRET");
  });
});
