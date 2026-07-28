import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import { validateGameContentRegistry } from "../content/validate.js";

type Profile = Readonly<Record<string, unknown>>;

function validProfile(): Profile {
  return {
    mode: "local_coop",
    fixedTickUnits: 0.25,
    maxPlayers: 2,
    ownership: {
      towerControl: "owner_only",
      resources: "shared",
      routes: "shared"
    }
  };
}

function multiplayerInput(options: {
  readonly enabled?: boolean;
  readonly selected?: boolean;
  readonly moduleSchemaVersion?: number;
  readonly profile?: Profile;
} = {}): GameContentInput {
  return {
    balance: {
      defaultMissionId: "coop",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 40,
        startingResources: { coins: 40 },
        prepTimeUnits: 2,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 5,
        pathWaterDurationUnits: 3,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      abilities: {},
      enemies: {
        grunt: {
          id: "grunt", label: "Grunt", maxHp: 10, speed: 0.5,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 0x778899
        }
      },
      towers: {
        pelter: {
          id: "pelter", label: "Pelter", cost: { coins: 5 }, footprintRadius: 0, range: 5,
          attack: {
            kind: "single", fireRate: 1, damagePerStack: 2,
            startingStacks: 1, maxStacks: 2, upgradeCost: 2
          }
        }
      },
      waveSets: {
        one: [{
          id: "wave_1", label: "Wave 1",
          groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        coop: {
          id: "coop", label: "Co-op", description: "",
          startingCoreHp: 20, startingResources: { coins: 40 }, prepTimeUnits: 2,
          mapId: "lane", waveSetId: "one", buildTowerIds: ["pelter"], abilityIds: [],
          ...(options.selected === false ? {} : {
            mechanics: { profiles: { multiplayer: "local_coop" } }
          })
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 7, height: 3,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 6, r: 1 },
        pathCenterline: Array.from({ length: 7 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [], terrainOverrides: []
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        multiplayer: {
          schemaVersion: (options.moduleSchemaVersion ?? 1) as 1,
          enabled: options.enabled ?? true,
          profiles: { local_coop: options.profile ?? validProfile() }
        }
      }
    },
    worldMap: {
      width: 100,
      height: 100,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#778899",
        bounds: { x: 0, y: 0, width: 100, height: 100 }, connections: []
      }],
      missionNodes: [{
        missionId: "coop", regionId: "region", x: 50, y: 50,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  };
}

function issues(options: Parameters<typeof multiplayerInput>[0] = {}) {
  return validateGameContentRegistry(createGameContentRegistry(multiplayerInput(options))).issues;
}

describe("R8.1 multiplayer mechanics v1 contract (RED)", () => {
  it("publishes multiplayer v1 as implemented and activates a valid selected local_coop profile", async () => {
    expect(Engine.IMPLEMENTED_MECHANICS_MODULE_IDS).toContain("multiplayer");
    expect(Engine).not.toHaveProperty("MatchSession");
    await expect(import("./index.js")).resolves.toMatchObject({
      MULTIPLAYER_MECHANICS_SCHEMA: {
        schemaVersion: 1,
        profilesByModuleVersion: {
          1: { modes: ["local_coop"] },
          2: {
            modes: ["local_coop", "asymmetric_send_vs_build"],
            requiredFieldsByMode: {
              asymmetric_send_vs_build: ["mode", "fixedTickUnits", "maxPlayers", "ownership", "sendPool"]
            },
            sendDefinition: {
              requiredFields: ["enemyTypeId", "cost", "income", "spawnDelayUnits"],
              optionalFields: ["routeId"]
            }
          }
        },
        profile: {
          requiredFields: ["mode", "fixedTickUnits", "maxPlayers", "ownership"],
          modes: ["local_coop"]
        }
      }
    });

    const content = createGameContentRegistry(multiplayerInput());
    expect(content.missions.coop!.capabilities.multiplayer).toMatchObject({
      available: true,
      moduleEnabled: true,
      active: true,
      profileId: "local_coop",
      reason: "active"
    });
    expect(validateGameContentRegistry(content)).toEqual({ ok: true, issues: [] });
  });

  it.each([
    ["zero fixed tick", { ...validProfile(), fixedTickUnits: 0 }, /fixedTickUnits/i],
    ["too many players", { ...validProfile(), maxPlayers: 65 }, /maxPlayers/i],
    ["unknown mode", { ...validProfile(), mode: "hosted_ranked" }, /mode/i],
    ["unknown ownership", {
      ...validProfile(),
      ownership: { towerControl: "anyone", resources: "shared", routes: "shared" }
    }, /towerControl/i],
    ["extra field", { ...validProfile(), hostedLobby: true }, /hostedLobby/i]
  ] as const)("rejects an active invalid profile: %s", (_label, profile, field) => {
    const result = issues({ profile });
    expect(result.some((issue) => issue.severity === "error" && field.test(issue.fieldPath))).toBe(true);
  });

  it("keeps a disabled invalid profile non-active and reports semantic defects as warnings", () => {
    const content = createGameContentRegistry(multiplayerInput({
      enabled: false,
      profile: { ...validProfile(), fixedTickUnits: 0 }
    }));
    const validation = validateGameContentRegistry(content);

    expect(content.missions.coop!.capabilities.multiplayer).toMatchObject({
      available: true,
      moduleEnabled: false,
      active: false,
      reason: "module_disabled"
    });
    expect(validation.ok).toBe(true);
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "warning", fieldPath: expect.stringMatching(/fixedTickUnits/) })
    ]));
  });

  it("keeps an unselected valid module inert without adding multiplayer snapshot state", () => {
    const content = createGameContentRegistry(multiplayerInput({ selected: false }));
    expect(content.missions.coop!.capabilities.multiplayer).toMatchObject({
      available: true,
      active: false,
      reason: "not_selected"
    });
    expect(validateGameContentRegistry(content)).toEqual({ ok: true, issues: [] });
  });

  it("recomputes authored activation instead of trusting tampered derived capabilities", async () => {
    const multiplayer = await import("./index.js");
    for (const content of [
      createGameContentRegistry(multiplayerInput({ enabled: false })),
      createGameContentRegistry(multiplayerInput({ selected: false }))
    ]) {
      Object.assign(content.missions.coop!.capabilities.multiplayer, {
        active: true,
        profileId: "local_coop",
        reason: "active"
      });
      expect(multiplayer.resolveActiveMultiplayerMechanics(content, "coop")).toBeUndefined();
    }
  });

  it("keeps local_coop profiles valid after a monotonic module v2 upgrade", async () => {
    const content = createGameContentRegistry(multiplayerInput({ moduleSchemaVersion: 2 }));
    expect(validateGameContentRegistry(content)).toEqual({ ok: true, issues: [] });
    expect(content.missions.coop!.capabilities.multiplayer).toMatchObject({ active: true });
    const multiplayer = await import("./index.js");
    expect(multiplayer.resolveActiveMultiplayerMechanics(content, "coop")).toMatchObject({
      schemaVersion: 2,
      mode: "local_coop",
      profileId: "local_coop"
    });
  });

  it("retains local partitioned-route cardinality validation after a module v2 upgrade", () => {
    const profile = {
      ...validProfile(),
      ownership: { towerControl: "owner_only", resources: "partitioned", routes: "partitioned" }
    };
    expect(issues({ moduleSchemaVersion: 2, profile })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "error",
        fieldPath: expect.stringMatching(/ownership\.routes/),
        message: expect.stringMatching(/at least 2 authored routes/i)
      })
    ]));
  });

  it("fails closed on future multiplayer module versions", () => {
    const content = createGameContentRegistry(multiplayerInput({ moduleSchemaVersion: 3 }));
    expect(content.missions.coop!.capabilities.multiplayer).toMatchObject({
      available: true,
      active: false,
      reason: "module_version_unsupported"
    });
    expect(validateGameContentRegistry(content).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "error", fieldPath: expect.stringMatching(/schemaVersion/) })
    ]));
  });

});
