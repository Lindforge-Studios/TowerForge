import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MECHANICS_AUTHORING_LIMITS,
  applyMechanicsModule,
  inspectMechanicsAuthoring,
  mechanicsAuthoringRevision,
  previewMechanicsModule
} from "./mechanics-authoring.mjs";

const tempProjects = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const projectDir of tempProjects.splice(0)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fixture({ mechanics, malformedDisabled = false } = {}) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-mechanics-authoring-"));
  tempProjects.push(projectDir);
  const authoredMechanics = mechanics ?? (malformedDisabled ? {
    schemaVersion: 1,
    modules: {
      combat: {
        schemaVersion: 1,
        enabled: false,
        profiles: { shielded: { shields: { enemies: { grunt: { capacity: 0 } } } } }
      }
    }
  } : undefined);
  writeJson(path.join(projectDir, "project.json"), {
    schemaVersion: authoredMechanics === undefined ? 2 : 3,
    name: "Mechanics authoring contract",
    description: "preserve-manifest",
    engineVersion: "0.1.0",
    defaultMissionId: "basic",
    authorMetadata: { untouched: true }
  });
  writeJson(path.join(projectDir, "content", "balance.json"), {
    currencies: [{ id: "coins", label: "Coins" }],
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
    defaultMissionId: "basic",
    abilities: {},
    enemies: {
      grunt: {
        id: "grunt", label: "Grunt", maxHp: 20, speed: 0.2,
        reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
      }
    },
    towers: {
      pelter: {
        id: "pelter", label: "Pelter", cost: { coins: 1 }, footprintRadius: 0,
        range: 5, maxHp: 20,
        attack: {
          kind: "single", fireRate: 1, damagePerStack: 2,
          startingStacks: 1, maxStacks: 1, upgradeCost: 1
        }
      }
    },
    waveSets: {
      one: [{
        id: "one", label: "One",
        groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }]
      }]
    },
    missions: {
      basic: {
        id: "basic", label: "Basic", description: "preserve-mission",
        startingCoreHp: 20, startingResources: { coins: 100 }, prepTimeUnits: 0,
        mapId: "lane", waveSetId: "one", buildTowerIds: ["pelter"], abilityIds: [],
        ...(malformedDisabled ? { mechanics: { profiles: { combat: "shielded" } } } : {})
      }
    },
    authorMetadata: { untouched: true }
  });
  writeJson(path.join(projectDir, "content", "world-map.json"), {
    width: 10,
    height: 10,
    regions: [{
      id: "region", label: "Region", description: "", biome: "test", accent: "#ffffff",
      bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
    }],
    missionNodes: [{
      missionId: "basic", regionId: "region", x: 5, y: 5,
      difficulty: 1, unlockRequiresMissionIds: []
    }]
  });
  writeJson(path.join(projectDir, "maps", "compiled", "maps.json"), {
    lane: {
      id: "lane", width: 6, height: 3, defaultTerrain: "buildable",
      spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 5, r: 1 },
      pathCenterline: Array.from({ length: 6 }, (_, q) => ({ q, r: 1 })),
      pathRoutes: [], terrainOverrides: []
    }
  });
  if (authoredMechanics !== undefined) {
    writeJson(path.join(projectDir, "content", "mechanics.json"), authoredMechanics);
  }
  return projectDir;
}

function filePaths(projectDir) {
  return {
    project: path.join(projectDir, "project.json"),
    balance: path.join(projectDir, "content", "balance.json"),
    mechanics: path.join(projectDir, "content", "mechanics.json")
  };
}

function rawTransactionFiles(projectDir) {
  const paths = filePaths(projectDir);
  return {
    project: fs.readFileSync(paths.project),
    balance: fs.readFileSync(paths.balance),
    mechanicsPresent: fs.existsSync(paths.mechanics),
    mechanics: fs.existsSync(paths.mechanics) ? fs.readFileSync(paths.mechanics) : undefined
  };
}

function expectRawFiles(projectDir, expected) {
  const actual = rawTransactionFiles(projectDir);
  expect(actual.project.equals(expected.project)).toBe(true);
  expect(actual.balance.equals(expected.balance)).toBe(true);
  expect(actual.mechanicsPresent).toBe(expected.mechanicsPresent);
  if (expected.mechanics) expect(actual.mechanics?.equals(expected.mechanics)).toBe(true);
}

function validProfile() {
  return {
    shields: {
      enemies: { grunt: { capacity: 12 } },
      towers: { pelter: { capacity: 8, regeneration: { ratePerUnit: 1, delayAfterDamage: 2 } } }
    }
  };
}

function validArmorProfile() {
  return {
    damageTypes: {
      physical: { label: "Physical" },
      fire: { label: "Fire" },
      ice: { label: "Ice" }
    },
    armorTypes: {
      plated: {
        label: "Plated",
        defaultMultiplier: 1,
        multipliers: { physical: 0.6, fire: 1.25, ice: 0.8 }
      }
    },
    armorAssignments: { enemies: { grunt: "plated" } }
  };
}

function validMarksProfile() {
  return {
    marks: {
      definitions: {
        exposed: {
          label: "Exposed",
          duration: 3,
          maxStacks: 3,
          multiplier: 1.25,
          consumePolicy: "consume_one"
        }
      },
      bindings: {
        towers: { pelter: [{ markId: "exposed", stacks: 1 }] }
      }
    }
  };
}

function validReactionsProfile() {
  return {
    exposures: {
      definitions: {
        fire: { label: "Fire", duration: 4, maxStacks: 1 },
        ice: { label: "Ice", duration: 4, maxStacks: 1 }
      },
      applications: {
        damageTypes: {
          fire: [{ exposureId: "fire", stacks: 1 }],
          ice: [{ exposureId: "ice", stacks: 1 }]
        }
      }
    },
    reactions: {
      shatter_fire_into_ice: {
        label: "Shatter",
        trigger: { damageTypes: ["fire"] },
        requirements: [{ kind: "exposure", exposureId: "ice", consume: "all" }],
        suppressTriggerExposureApplications: true,
        effects: {
          critical: {
            kind: "damage",
            amount: { kind: "source_after_modifiers", multiplier: 2 },
            damageType: "physical",
            target: { kind: "primary" },
            allowReactions: false
          }
        }
      }
    }
  };
}

function authoredRoutesNavigationProfile() {
  return { mode: "authored_routes" };
}

function validDynamicNavigationProfile() {
  return {
    mode: "dynamic_flow",
    defaultMovementProfileId: "ground",
    movementProfiles: {
      air: {
        label: "Air",
        terrainMode: "ignore_walkable",
        towerOccupancy: "ignored",
        defaultTerrainCost: 1000
      },
      ground: {
        label: "Ground",
        terrainMode: "respect_walkable",
        towerOccupancy: "blocked",
        defaultTerrainCost: 1000,
        terrainCosts: { water: 2000 }
      }
    },
    enemyMovementProfiles: { grunt: "ground" }
  };
}

function enableRequest(overrides = {}) {
  return {
    moduleId: "combat",
    moduleSchemaVersion: 1,
    missionId: "basic",
    profileId: "shielded",
    profile: validProfile(),
    enabled: true,
    ...overrides
  };
}

function issueText(result) {
  return (result.validation?.issues ?? result.issues ?? [])
    .map((issue) => `${issue.fieldPath ?? ""} ${issue.message ?? ""}`)
    .join("\n");
}

describe("canonical mechanics authoring transaction", () => {
  it("derives one composite revision from exact raw bytes and mechanics presence", () => {
    const projectDir = fixture();
    const paths = filePaths(projectDir);
    const initial = mechanicsAuthoringRevision(projectDir);
    const projectBytes = fs.readFileSync(paths.project);

    fs.appendFileSync(paths.project, " ", "utf8");
    expect(mechanicsAuthoringRevision(projectDir)).not.toBe(initial);
    fs.writeFileSync(paths.project, projectBytes);
    expect(mechanicsAuthoringRevision(projectDir)).toBe(initial);

    writeJson(paths.mechanics, { schemaVersion: 1, modules: {} });
    const present = mechanicsAuthoringRevision(projectDir);
    expect(present).not.toBe(initial);
    fs.appendFileSync(paths.mechanics, " ", "utf8");
    expect(mechanicsAuthoringRevision(projectDir)).not.toBe(present);
    expect(initial).toMatch(/^[a-f0-9]{40,64}$/);
  });

  it("previews without writes, validates the full candidate, then atomically authors v3 combat data", async () => {
    const projectDir = fixture();
    const before = rawTransactionFiles(projectDir);
    const revision = mechanicsAuthoringRevision(projectDir);
    const preview = await previewMechanicsModule(projectDir, enableRequest({ ifRevision: revision }));

    expect(preview).toMatchObject({ ok: true, dryRun: true, revision });
    expect(preview.validation).toMatchObject({ ok: true, issues: [] });
    expect(preview.candidate.manifest).toMatchObject({
      schemaVersion: 3, description: "preserve-manifest", authorMetadata: { untouched: true }
    });
    expect(preview.candidate.balance).toMatchObject({
      authorMetadata: { untouched: true },
      missions: { basic: { description: "preserve-mission", mechanics: { profiles: { combat: "shielded" } } } }
    });
    expect(preview.candidate.mechanics).toEqual({
      schemaVersion: 1,
      modules: {
        combat: { schemaVersion: 1, enabled: true, profiles: { shielded: validProfile() } }
      }
    });
    expectRawFiles(projectDir, before);

    const applied = await applyMechanicsModule(projectDir, enableRequest({ ifRevision: revision }));
    expect(applied).toMatchObject({
      ok: true,
      previousRevision: revision,
      validation: { ok: true, issues: [] },
      backup: {
        files: {
          project: { existed: true },
          balance: { existed: true },
          mechanics: { existed: false }
        }
      }
    });
    expect(applied.revision).not.toBe(revision);
    expect(fs.existsSync(applied.backup.directory)).toBe(true);
    expect(JSON.parse(fs.readFileSync(filePaths(projectDir).project, "utf8"))).toEqual(preview.candidate.manifest);
    expect(JSON.parse(fs.readFileSync(filePaths(projectDir).balance, "utf8"))).toEqual(preview.candidate.balance);
    expect(JSON.parse(fs.readFileSync(filePaths(projectDir).mechanics, "utf8"))).toEqual(preview.candidate.mechanics);
  }, 30_000);

  it("previews a combat v1 to v2 armor upgrade without changing catalog/project versions or existing profiles", async () => {
    const shieldProfile = validProfile();
    const projectDir = fixture({ mechanics: {
      schemaVersion: 1,
      modules: {
        combat: {
          schemaVersion: 1,
          enabled: true,
          profiles: { shielded: shieldProfile }
        },
        navigation: { schemaVersion: 1, enabled: false, profiles: { authored: { mode: "authored_routes" } } }
      }
    } });
    const before = rawTransactionFiles(projectDir);

    const preview = await previewMechanicsModule(projectDir, {
      moduleId: "combat",
      moduleSchemaVersion: 2,
      missionId: "basic",
      profileId: "elemental_armor",
      profile: validArmorProfile(),
      enabled: true,
      ifRevision: mechanicsAuthoringRevision(projectDir)
    });

    expect(preview).toMatchObject({ ok: true, dryRun: true, validation: { ok: true, issues: [] } });
    expect(preview.candidate.manifest.schemaVersion).toBe(3);
    expect(preview.candidate.mechanics).toMatchObject({
      schemaVersion: 1,
      modules: {
        combat: {
          schemaVersion: 2,
          enabled: true,
          profiles: {
            shielded: shieldProfile,
            elemental_armor: validArmorProfile()
          }
        },
        navigation: { schemaVersion: 1, enabled: false, profiles: { authored: { mode: "authored_routes" } } }
      }
    });
    expect(preview.candidate.balance.missions.basic.mechanics.profiles.combat).toBe("elemental_armor");
    expectRawFiles(projectDir, before);
  });

  it("guardedly applies, disables, and re-enables combat v2 without losing v1 shields or armor catalogs", async () => {
    const shieldProfile = validProfile();
    const projectDir = fixture({ mechanics: {
      schemaVersion: 1,
      modules: {
        combat: { schemaVersion: 1, enabled: true, profiles: { shielded: shieldProfile } }
      }
    } });
    const request = {
      moduleId: "combat",
      moduleSchemaVersion: 2,
      missionId: "basic",
      profileId: "elemental_armor",
      profile: validArmorProfile(),
      enabled: true
    };
    const initialRevision = mechanicsAuthoringRevision(projectDir);
    const applied = await applyMechanicsModule(projectDir, { ...request, ifRevision: initialRevision });

    expect(applied).toMatchObject({
      ok: true,
      previousRevision: initialRevision,
      backup: { files: { project: { existed: true }, balance: { existed: true }, mechanics: { existed: true } } }
    });
    const authored = JSON.parse(fs.readFileSync(filePaths(projectDir).mechanics, "utf8"));
    expect(authored.modules.combat).toEqual({
      schemaVersion: 2,
      enabled: true,
      profiles: { shielded: shieldProfile, elemental_armor: validArmorProfile() }
    });

    const stale = await applyMechanicsModule(projectDir, { ...request, ifRevision: initialRevision });
    expect(stale).toMatchObject({ ok: false, conflict: true, expectedRevision: initialRevision });

    const disabled = await applyMechanicsModule(projectDir, {
      moduleId: "combat", moduleSchemaVersion: 2, missionId: "basic", enabled: false,
      ifRevision: applied.revision
    });
    expect(disabled.ok).toBe(true);
    const reenabled = await applyMechanicsModule(projectDir, {
      moduleId: "combat", moduleSchemaVersion: 2, missionId: "basic", enabled: true,
      ifRevision: disabled.revision
    });
    expect(reenabled.ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(filePaths(projectDir).mechanics, "utf8")).modules.combat).toEqual(authored.modules.combat);
  });

  it("guardedly upgrades combat v2 to v3 marks while preserving existing profiles and rollback metadata", async () => {
    const armorProfile = validArmorProfile();
    const projectDir = fixture({ mechanics: {
      schemaVersion: 1,
      modules: {
        combat: {
          schemaVersion: 2,
          enabled: true,
          profiles: { elemental_armor: armorProfile }
        }
      }
    } });
    const revision = mechanicsAuthoringRevision(projectDir);
    const request = {
      moduleId: "combat",
      moduleSchemaVersion: 3,
      missionId: "basic",
      profileId: "vulnerability_marks",
      profile: validMarksProfile(),
      enabled: true,
      ifRevision: revision
    };

    const preview = await previewMechanicsModule(projectDir, request);
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      revision,
      validation: { ok: true, issues: [] },
      candidate: {
        manifest: { schemaVersion: 3 },
        mechanics: {
          schemaVersion: 1,
          modules: {
            combat: {
              schemaVersion: 3,
              enabled: true,
              profiles: {
                elemental_armor: armorProfile,
                vulnerability_marks: validMarksProfile()
              }
            }
          }
        }
      }
    });

    const applied = await applyMechanicsModule(projectDir, request);
    expect(applied).toMatchObject({
      ok: true,
      written: true,
      previousRevision: revision,
      backup: {
        files: {
          project: { existed: true },
          balance: { existed: true },
          mechanics: { existed: true }
        }
      }
    });
    expect(JSON.parse(fs.readFileSync(filePaths(projectDir).mechanics, "utf8")))
      .toEqual(preview.candidate.mechanics);

    const stale = await applyMechanicsModule(projectDir, request);
    expect(stale).toMatchObject({ ok: false, conflict: true, expectedRevision: revision });
  }, 30_000);

  it("guardedly authors reactions v1 beside combat v3 and preserves both modules through disable/re-enable", async () => {
    const combatProfile = {
      damageTypes: {
        physical: { label: "Physical" },
        fire: { label: "Fire" },
        ice: { label: "Ice" }
      }
    };
    const projectDir = fixture({ mechanics: {
      schemaVersion: 1,
      modules: {
        combat: { schemaVersion: 3, enabled: true, profiles: { elemental: combatProfile } }
      }
    } });
    const paths = filePaths(projectDir);
    const balance = JSON.parse(fs.readFileSync(paths.balance, "utf8"));
    balance.missions.basic.mechanics = { profiles: { combat: "elemental" } };
    writeJson(paths.balance, balance);

    const request = {
      moduleId: "reactions",
      moduleSchemaVersion: 1,
      missionId: "basic",
      profileId: "elemental_shatter",
      profile: validReactionsProfile(),
      enabled: true
    };
    const before = rawTransactionFiles(projectDir);
    const revision = mechanicsAuthoringRevision(projectDir);
    const preview = await previewMechanicsModule(projectDir, { ...request, ifRevision: revision });
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      revision,
      validation: { ok: true, issues: [] },
      candidate: {
        manifest: { schemaVersion: 3 },
        mechanics: {
          schemaVersion: 1,
          modules: {
            combat: { schemaVersion: 3, enabled: true, profiles: { elemental: combatProfile } },
            reactions: {
              schemaVersion: 1,
              enabled: true,
              profiles: { elemental_shatter: validReactionsProfile() }
            }
          }
        }
      }
    });
    expect(preview.candidate.balance.missions.basic.mechanics.profiles).toEqual({
      combat: "elemental",
      reactions: "elemental_shatter"
    });
    expectRawFiles(projectDir, before);

    const applied = await applyMechanicsModule(projectDir, { ...request, ifRevision: revision });
    expect(applied).toMatchObject({ ok: true, written: true, previousRevision: revision });
    const stale = await applyMechanicsModule(projectDir, { ...request, ifRevision: revision });
    expect(stale).toMatchObject({ ok: false, conflict: true, expectedRevision: revision });

    const disabled = await applyMechanicsModule(projectDir, {
      moduleId: "reactions", moduleSchemaVersion: 1, missionId: "basic", enabled: false,
      ifRevision: applied.revision
    });
    expect(disabled.ok).toBe(true);
    const reenabled = await applyMechanicsModule(projectDir, {
      moduleId: "reactions", moduleSchemaVersion: 1, missionId: "basic", enabled: true,
      ifRevision: disabled.revision
    });
    expect(reenabled.ok).toBe(true);
    const authored = JSON.parse(fs.readFileSync(paths.mechanics, "utf8"));
    expect(authored.modules.combat).toEqual({
      schemaVersion: 3, enabled: true, profiles: { elemental: combatProfile }
    });
    expect(authored.modules.reactions).toEqual({
      schemaVersion: 1, enabled: true, profiles: { elemental_shatter: validReactionsProfile() }
    });
  });

  it("[verifier] rejects reactions v2 at the module-aware authoring boundary", async () => {
    const projectDir = fixture({ mechanics: {
      schemaVersion: 1,
      modules: {
        combat: {
          schemaVersion: 3,
          enabled: true,
          profiles: { elemental: { damageTypes: { physical: { label: "Physical" } } } }
        }
      }
    } });
    const paths = filePaths(projectDir);
    const balance = JSON.parse(fs.readFileSync(paths.balance, "utf8"));
    balance.missions.basic.mechanics = { profiles: { combat: "elemental" } };
    writeJson(paths.balance, balance);
    const before = rawTransactionFiles(projectDir);

    const result = await previewMechanicsModule(projectDir, {
      moduleId: "reactions",
      moduleSchemaVersion: 2,
      missionId: "basic",
      profileId: "future_reactions",
      profile: validReactionsProfile(),
      enabled: true,
      ifRevision: mechanicsAuthoringRevision(projectDir)
    });

    expect(result).toMatchObject({ ok: false, written: false });
    expect(result.validation.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "module_version_unsupported",
      fieldPath: "moduleSchemaVersion"
    }));
    expectRawFiles(projectDir, before);
  });

  it("rejects an explicit combat v3 to v2 downgrade without writing", async () => {
    const projectDir = fixture({ mechanics: {
      schemaVersion: 1,
      modules: {
        combat: {
          schemaVersion: 3,
          enabled: true,
          profiles: { vulnerability_marks: validMarksProfile() }
        }
      }
    } });
    const before = rawTransactionFiles(projectDir);
    const result = await previewMechanicsModule(projectDir, {
      moduleId: "combat",
      moduleSchemaVersion: 2,
      missionId: "basic",
      profileId: "elemental_armor",
      profile: validArmorProfile(),
      enabled: true,
      ifRevision: mechanicsAuthoringRevision(projectDir)
    });

    expect(result).toMatchObject({ ok: false, written: false });
    expect(result.validation.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "module_version_downgrade",
      fieldPath: "moduleSchemaVersion"
    }));
    expectRawFiles(projectDir, before);
  });

  it("rejects an explicit combat v2 to v1 downgrade in preview and apply without writing", async () => {
    const projectDir = fixture({ mechanics: {
      schemaVersion: 1,
      modules: {
        combat: {
          schemaVersion: 2,
          enabled: true,
          profiles: { elemental_armor: validArmorProfile() }
        }
      }
    } });
    const before = rawTransactionFiles(projectDir);
    const request = {
      moduleId: "combat",
      moduleSchemaVersion: 1,
      missionId: "basic",
      profileId: "shielded",
      profile: validProfile(),
      enabled: true,
      ifRevision: mechanicsAuthoringRevision(projectDir)
    };

    for (const result of [
      await previewMechanicsModule(projectDir, request),
      await applyMechanicsModule(projectDir, request)
    ]) {
      expect(result).toMatchObject({ ok: false, written: false });
      expect(result.validation.issues).toContainEqual(expect.objectContaining({
        severity: "error",
        code: "module_version_downgrade",
        fieldPath: "moduleSchemaVersion"
      }));
      expectRawFiles(projectDir, before);
    }
  });

  it("rolls back all files when a combat v2 module upgrade fails after replacement", async () => {
    const projectDir = fixture({ mechanics: {
      schemaVersion: 1,
      modules: {
        combat: { schemaVersion: 1, enabled: true, profiles: { shielded: validProfile() } }
      }
    } });
    const before = rawTransactionFiles(projectDir);
    let injected = false;

    await expect(applyMechanicsModule(projectDir, {
      moduleId: "combat",
      moduleSchemaVersion: 2,
      missionId: "basic",
      profileId: "elemental_armor",
      profile: validArmorProfile(),
      enabled: true,
      ifRevision: mechanicsAuthoringRevision(projectDir)
    }, {
      afterFileReplace(relativePath) {
        if (!injected && relativePath === "content/mechanics.json") {
          injected = true;
          throw new Error("SYNTHETIC_ARMOR_UPGRADE_FAILURE");
        }
      }
    })).rejects.toThrow(/SYNTHETIC_ARMOR_UPGRADE_FAILURE/);

    expect(injected).toBe(true);
    expectRawFiles(projectDir, before);
  });

  it.each(["project", "balance", "mechanics"])("rejects a stale revision when raw %s bytes change", async (fileKey) => {
    const projectDir = fixture({ mechanics: { schemaVersion: 1, modules: {} } });
    const paths = filePaths(projectDir);
    const revision = mechanicsAuthoringRevision(projectDir);
    fs.appendFileSync(paths[fileKey], " ", "utf8");
    const concurrentState = rawTransactionFiles(projectDir);

    const result = await applyMechanicsModule(projectDir, enableRequest({ ifRevision: revision }));

    expect(result).toMatchObject({ ok: false, conflict: true, expectedRevision: revision });
    expect(result.actualRevision).toBe(mechanicsAuthoringRevision(projectDir));
    expectRawFiles(projectDir, concurrentState);
  });

  it("disables and re-enables without deleting the profile or mission selection", async () => {
    const projectDir = fixture();
    const first = await applyMechanicsModule(projectDir, enableRequest({
      ifRevision: mechanicsAuthoringRevision(projectDir)
    }));
    expect(first.ok).toBe(true);
    const authoredBalance = JSON.parse(fs.readFileSync(filePaths(projectDir).balance, "utf8"));
    const authoredProfile = JSON.parse(fs.readFileSync(filePaths(projectDir).mechanics, "utf8"))
      .modules.combat.profiles.shielded;

    const disabled = await applyMechanicsModule(projectDir, {
      moduleId: "combat", missionId: "basic", enabled: false, ifRevision: first.revision
    });
    expect(disabled.ok).toBe(true);
    const afterDisable = JSON.parse(fs.readFileSync(filePaths(projectDir).mechanics, "utf8"));
    expect(afterDisable.modules.combat.enabled).toBe(false);
    expect(afterDisable.modules.combat.profiles.shielded).toEqual(authoredProfile);
    expect(JSON.parse(fs.readFileSync(filePaths(projectDir).balance, "utf8"))
      .missions.basic.mechanics).toEqual(authoredBalance.missions.basic.mechanics);

    const reenabled = await applyMechanicsModule(projectDir, {
      moduleId: "combat", missionId: "basic", enabled: true, ifRevision: disabled.revision
    });
    expect(reenabled.ok).toBe(true);
    const afterEnable = JSON.parse(fs.readFileSync(filePaths(projectDir).mechanics, "utf8"));
    expect(afterEnable.modules.combat).toEqual({
      schemaVersion: 1, enabled: true, profiles: { shielded: authoredProfile }
    });
  });

  it("treats an identical validated candidate as a no-op without another backup", async () => {
    const projectDir = fixture();
    const first = await applyMechanicsModule(projectDir, enableRequest({
      ifRevision: mechanicsAuthoringRevision(projectDir)
    }));
    expect(first.ok).toBe(true);
    const backupRoot = path.join(projectDir, ".towerforge", "backups");
    const backupsBefore = fs.readdirSync(backupRoot).sort();
    const bytesBefore = rawTransactionFiles(projectDir);

    const second = await applyMechanicsModule(projectDir, enableRequest({
      ifRevision: first.revision
    }));

    expect(second).toMatchObject({ ok: true, written: false, revision: first.revision });
    expect(second).not.toHaveProperty("backup");
    expect(fs.readdirSync(backupRoot).sort()).toEqual(backupsBefore);
    expectRawFiles(projectDir, bytesBefore);
  });

  it("rolls back every committed file and removes newly-created mechanics after an atomic replace failure", async () => {
    const projectDir = fixture();
    const before = rawTransactionFiles(projectDir);
    const paths = filePaths(projectDir);
    let injected = false;
    const internalHooks = {
      afterFileReplace(relativePath) {
        if (!injected && relativePath === "content/mechanics.json") {
          injected = true;
          throw new Error("SYNTHETIC_MECHANICS_COMMIT_FAILURE");
        }
      }
    };

    await expect(applyMechanicsModule(projectDir, enableRequest({
      ifRevision: mechanicsAuthoringRevision(projectDir)
    }), internalHooks)).rejects.toThrow(/SYNTHETIC_MECHANICS_COMMIT_FAILURE/);

    if (!injected) {
      // The hook is deliberately internal and exists only to make the rollback boundary
      // deterministic in tests; it must observe the final atomic replace, not staging writes.
      throw new Error("Expected content/mechanics.json to pass the afterFileReplace hook.");
    }
    expectRawFiles(projectDir, before);
    expect(fs.existsSync(paths.mechanics)).toBe(false);
  });

  it("does not clobber a concurrent third-party edit while rolling back owned writes", async () => {
    const projectDir = fixture();
    const paths = filePaths(projectDir);
    const thirdPartyManifest = `${JSON.stringify({ schemaVersion: 3, name: "third-party" }, null, 2)}\n`;
    const internalHooks = {
      afterFileReplace(relativePath) {
        if (relativePath === "content/balance.json") {
          fs.writeFileSync(paths.project, thirdPartyManifest, "utf8");
          throw new Error("SYNTHETIC_CONCURRENT_ROLLBACK_FAILURE");
        }
      }
    };

    const error = await applyMechanicsModule(projectDir, enableRequest({
      ifRevision: mechanicsAuthoringRevision(projectDir)
    }), internalHooks).then(() => null, (caught) => caught);

    expect(error).toMatchObject({ code: "rollback_conflict" });
    expect(fs.readFileSync(paths.project, "utf8")).toBe(thirdPartyManifest);
    expect(fs.existsSync(paths.mechanics)).toBe(false);
  });

  it("does not report success when a valid concurrent overwrite lands before post-validation returns", async () => {
    const projectDir = fixture();
    const paths = filePaths(projectDir);
    const thirdPartyManifest = `${JSON.stringify({
      schemaVersion: 3,
      name: "third-party-valid",
      engineVersion: "0.1.0",
      defaultMissionId: "basic"
    }, null, 2)}\n`;
    const internalHooks = {
      afterFileReplace(relativePath) {
        if (relativePath === "content/balance.json") {
          fs.writeFileSync(paths.project, thirdPartyManifest, "utf8");
        }
      }
    };

    const error = await applyMechanicsModule(projectDir, enableRequest({
      ifRevision: mechanicsAuthoringRevision(projectDir)
    }), internalHooks).then(() => null, (caught) => caught);

    expect(error).toMatchObject({ code: "rollback_conflict" });
    expect(fs.readFileSync(paths.project, "utf8")).toBe(thirdPartyManifest);
    expect(fs.existsSync(paths.mechanics)).toBe(false);
  });
});

describe("mechanics authoring validation boundaries", () => {
  it("returns bounded source/request diagnostics for malformed JSON and non-boolean enabled", async () => {
    const malformedDir = fixture({ mechanics: { schemaVersion: 1, modules: {} } });
    const malformedPaths = filePaths(malformedDir);
    fs.writeFileSync(malformedPaths.mechanics, "{broken", "utf8");
    const malformedBefore = rawTransactionFiles(malformedDir);

    const malformed = await previewMechanicsModule(malformedDir, enableRequest());

    expect(malformed).toMatchObject({ ok: false, written: false });
    expect(malformed.validation.issues).toContainEqual(expect.objectContaining({ code: "source_invalid" }));
    expectRawFiles(malformedDir, malformedBefore);

    const requestDir = fixture();
    const requestBefore = rawTransactionFiles(requestDir);
    const invalidRequest = await previewMechanicsModule(requestDir, enableRequest({ enabled: "false" }));
    expect(invalidRequest).toMatchObject({ ok: false, written: false });
    expect(invalidRequest.validation.issues).toContainEqual(expect.objectContaining({ code: "request_invalid" }));
    expectRawFiles(requestDir, requestBefore);
  });

  it("requires legacy v0/v1 projects to persist the v2 migration before the narrow v3 transaction", async () => {
    const projectDir = fixture();
    const paths = filePaths(projectDir);
    const manifest = JSON.parse(fs.readFileSync(paths.project, "utf8"));
    manifest.schemaVersion = 1;
    writeJson(paths.project, manifest);
    const before = rawTransactionFiles(projectDir);

    const preview = await previewMechanicsModule(projectDir, enableRequest());

    expect(preview).toMatchObject({ ok: false, written: false });
    expect(preview.validation.issues).toContainEqual(expect.objectContaining({
      code: "project_migration_required"
    }));
    expectRawFiles(projectDir, before);
  });

  it("does not downgrade a project schema newer than this authoring runtime", async () => {
    const projectDir = fixture();
    const paths = filePaths(projectDir);
    const manifest = JSON.parse(fs.readFileSync(paths.project, "utf8"));
    manifest.schemaVersion = 6;
    writeJson(paths.project, manifest);
    const before = rawTransactionFiles(projectDir);

    const preview = await previewMechanicsModule(projectDir, enableRequest());

    expect(preview).toMatchObject({ ok: false, written: false });
    expect(preview.validation.issues).toContainEqual(expect.objectContaining({
      code: "project_version_unsupported"
    }));
    expectRawFiles(projectDir, before);
  });

  it("rejects unknown modules, future versions, and closed-shape fields without writing", async () => {
    const unknownDir = fixture();
    const unknownBefore = rawTransactionFiles(unknownDir);
    const unknown = await previewMechanicsModule(unknownDir, enableRequest({ moduleId: "constructor" }));
    expect(unknown.ok).toBe(false);
    expect(issueText(unknown)).toMatch(/unknown|unsupported/i);
    expectRawFiles(unknownDir, unknownBefore);

    const futureDir = fixture({ mechanics: { schemaVersion: 2, modules: {} } });
    const futureBefore = rawTransactionFiles(futureDir);
    const future = await previewMechanicsModule(futureDir, enableRequest());
    expect(future.ok).toBe(false);
    expect(issueText(future)).toMatch(/schemaVersion|newer|version/i);
    expectRawFiles(futureDir, futureBefore);

    const shapeDir = fixture();
    const shapeBefore = rawTransactionFiles(shapeDir);
    const closedShape = await previewMechanicsModule(shapeDir, enableRequest({
      profile: { ...validProfile(), unexpected: true }
    }));
    expect(closedShape.ok).toBe(false);
    expect(issueText(closedShape)).toMatch(/unexpected|unsupported|closed/i);
    expectRawFiles(shapeDir, shapeBefore);
  });

  it("keeps inactive semantic defects as warnings but preview-enable promotes them to errors", async () => {
    const projectDir = fixture({ malformedDisabled: true });
    const before = rawTransactionFiles(projectDir);
    const disabled = await previewMechanicsModule(projectDir, {
      moduleId: "combat", missionId: "basic", enabled: false
    });
    expect(disabled.ok).toBe(true);
    expect(disabled.validation.issues).toContainEqual(expect.objectContaining({ severity: "warning" }));
    expect(disabled.validation.issues.some((issue) => issue.severity === "error")).toBe(false);

    const enabled = await previewMechanicsModule(projectDir, {
      moduleId: "combat", missionId: "basic", enabled: true
    });
    expect(enabled.ok).toBe(false);
    expect(enabled.validation.issues).toContainEqual(expect.objectContaining({
      severity: "error", fieldPath: expect.stringMatching(/shield|capacity/i)
    }));
    expectRawFiles(projectDir, before);
  });

  it("warns for disabled v3 mark binding references and blocks them when selected for enable", async () => {
    const projectDir = fixture({ mechanics: {
      schemaVersion: 1,
      modules: {
        combat: {
          schemaVersion: 3,
          enabled: false,
          profiles: {
            bad_marks: {
              marks: {
                definitions: {
                  exposed: {
                    label: "Exposed",
                    duration: 3,
                    maxStacks: 2,
                    multiplier: 1.25,
                    consumePolicy: "retain"
                  }
                },
                bindings: {
                  towers: { ghost_tower: [{ markId: "exposed", stacks: 1 }] }
                }
              }
            }
          }
        }
      }
    } });
    const before = rawTransactionFiles(projectDir);

    const disabled = await previewMechanicsModule(projectDir, {
      moduleId: "combat",
      moduleSchemaVersion: 3,
      missionId: "basic",
      enabled: false
    });
    expect(disabled.ok).toBe(true);
    expect(disabled.validation.issues).toContainEqual(expect.objectContaining({
      severity: "warning",
      fieldPath: expect.stringMatching(/marks.*bindings.*ghost_tower/)
    }));
    expect(disabled.validation.issues.some((issue) => issue.severity === "error")).toBe(false);

    const enabled = await previewMechanicsModule(projectDir, {
      moduleId: "combat",
      moduleSchemaVersion: 3,
      missionId: "basic",
      profileId: "bad_marks",
      enabled: true
    });
    expect(enabled.ok).toBe(false);
    expect(enabled.validation.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/marks.*bindings.*ghost_tower/)
    }));
    expectRawFiles(projectDir, before);
  });

  it("blocks active unknown references, shield bounds, and indestructible tower targets", async () => {
    const unknownDir = fixture();
    const unknownBefore = rawTransactionFiles(unknownDir);
    const unknown = await previewMechanicsModule(unknownDir, enableRequest({
      profile: { shields: { enemies: { ghost: { capacity: 1 } } } }
    }));
    expect(unknown.ok).toBe(false);
    expect(issueText(unknown)).toMatch(/ghost/);
    expectRawFiles(unknownDir, unknownBefore);

    const boundsDir = fixture();
    const boundsBefore = rawTransactionFiles(boundsDir);
    const bounds = await previewMechanicsModule(boundsDir, enableRequest({
      profile: { shields: { enemies: { grunt: { capacity: 1_000_000_000_001 } } } }
    }));
    expect(bounds.ok).toBe(false);
    expect(issueText(bounds)).toMatch(/capacity|range/i);
    expectRawFiles(boundsDir, boundsBefore);

    const towerDir = fixture();
    const towerPaths = filePaths(towerDir);
    const towerBalance = JSON.parse(fs.readFileSync(towerPaths.balance, "utf8"));
    delete towerBalance.towers.pelter.maxHp;
    writeJson(towerPaths.balance, towerBalance);
    const towerBefore = rawTransactionFiles(towerDir);
    const indestructible = await previewMechanicsModule(towerDir, enableRequest({
      profile: { shields: { towers: { pelter: { capacity: 1 } } } }
    }));
    expect(indestructible.ok).toBe(false);
    expect(issueText(indestructible)).toMatch(/maxHp|destructible/i);
    expectRawFiles(towerDir, towerBefore);
  });

  it("enforces bounded definition counts and a one-mebibyte canonical mechanics document", async () => {
    expect(MECHANICS_AUTHORING_LIMITS).toEqual({
      definitionsPerKind: 4096,
      canonicalMechanicsBytes: 1024 * 1024
    });
    const tooManyDir = fixture();
    const tooManyEnemies = Object.fromEntries(Array.from({ length: 4097 }, (_, index) => [
      `enemy_${index}`, { capacity: 1 }
    ]));
    const tooMany = await previewMechanicsModule(tooManyDir, enableRequest({
      profile: { shields: { enemies: tooManyEnemies } }
    }));
    expect(tooMany.ok).toBe(false);
    expect(issueText(tooMany)).toMatch(/4096|definition.*limit/i);

    const oversizedDir = fixture();
    const oversizedEnemies = Object.fromEntries(Array.from({ length: 4096 }, (_, index) => [
      `enemy_${String(index).padStart(4, "0")}_${"x".repeat(260)}`, { capacity: 1 }
    ]));
    const oversized = await previewMechanicsModule(oversizedDir, enableRequest({
      profile: { shields: { enemies: oversizedEnemies } }
    }));
    expect(oversized.ok).toBe(false);
    expect(issueText(oversized)).toMatch(/1.?MiB|1048576|mechanics.*size/i);
  });

  it("rejects oversized raw mechanics and request strings before unbounded parsing/canonicalization", async () => {
    const sourceDir = fixture({ mechanics: { schemaVersion: 1, modules: {} } });
    const sourcePaths = filePaths(sourceDir);
    const oversizedSource = `{"padding":"${"x".repeat(1024 * 1024)}"}\n`;
    fs.writeFileSync(sourcePaths.mechanics, oversizedSource, "utf8");
    const sourceBefore = rawTransactionFiles(sourceDir);
    const source = await previewMechanicsModule(sourceDir, enableRequest());
    expect(source).toMatchObject({ ok: false, written: false });
    expect(source.validation.issues).toContainEqual(expect.objectContaining({ code: "budget_exceeded" }));
    expectRawFiles(sourceDir, sourceBefore);

    const requestDir = fixture();
    const requestBefore = rawTransactionFiles(requestDir);
    const request = await previewMechanicsModule(requestDir, enableRequest({
      profile: { unexpected: "x".repeat(256 * 1024 + 1) }
    }));
    expect(request).toMatchObject({ ok: false, written: false });
    expect(request.validation.issues).toContainEqual(expect.objectContaining({ code: "budget_exceeded" }));
    expectRawFiles(requestDir, requestBefore);

    const keyDir = fixture();
    const oversizedKey = `field_${"x".repeat(256 * 1024 + 1)}`;
    const keyed = await previewMechanicsModule(keyDir, enableRequest({
      profile: { [oversizedKey]: true }
    }));
    expect(keyed.validation.issues[0]?.code).toBe("budget_exceeded");
    expect(keyed.validation.issues[0]?.fieldPath.length).toBeLessThan(256);

    const aggregateDir = fixture();
    const aggregate = await previewMechanicsModule(aggregateDir, enableRequest({
      profile: { chunks: Array.from({ length: 6 }, () => "x".repeat(200 * 1024)) }
    }));
    expect(aggregate.validation.issues[0]?.code).toBe("budget_exceeded");
  });

  it("supports own __proto__ profile IDs and rejects accessor-backed payloads without invoking them", async () => {
    const projectDir = fixture();
    const applied = await applyMechanicsModule(projectDir, enableRequest({
      profileId: "__proto__",
      ifRevision: mechanicsAuthoringRevision(projectDir)
    }));
    expect(applied.ok).toBe(true);
    const mechanics = JSON.parse(fs.readFileSync(filePaths(projectDir).mechanics, "utf8"));
    expect(Object.hasOwn(mechanics.modules.combat.profiles, "__proto__")).toBe(true);
    expect(mechanics.modules.combat.profiles.__proto__).toEqual(validProfile());
    const balance = JSON.parse(fs.readFileSync(filePaths(projectDir).balance, "utf8"));
    expect(balance.missions.basic.mechanics.profiles.combat).toBe("__proto__");

    const getter = vi.fn(() => {
      throw new Error("SYNTHETIC_SECRET_MECHANICS_GETTER");
    });
    const hostileProfile = {};
    Object.defineProperty(hostileProfile, "shields", { enumerable: true, get: getter });
    const before = rawTransactionFiles(projectDir);
    const rejected = await previewMechanicsModule(projectDir, enableRequest({
      profileId: "hostile",
      profile: hostileProfile,
      ifRevision: applied.revision
    }));
    expect(rejected.ok).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    expect(issueText(rejected)).not.toContain("SYNTHETIC_SECRET");
    expectRawFiles(projectDir, before);

    const lengthTrap = vi.fn(() => {
      throw new Error("SYNTHETIC_ARRAY_LENGTH_TRAP");
    });
    const hostileArray = new Proxy([], {
      get(target, property, receiver) {
        if (property === "length") return lengthTrap();
        return Reflect.get(target, property, receiver);
      }
    });
    Object.defineProperty(hostileArray, "extra", { value: true, enumerable: true });
    const arrayRejected = await previewMechanicsModule(projectDir, enableRequest({
      profileId: "hostile_array",
      profile: { shields: hostileArray },
      ifRevision: applied.revision
    }));
    expect(arrayRejected.ok).toBe(false);
    expect(arrayRejected.validation.issues).toContainEqual(expect.objectContaining({
      code: "mechanics_input_unsafe"
    }));
    expect(lengthTrap).not.toHaveBeenCalled();
  });

  it("rejects a symlinked transaction target instead of reading or writing outside the project", async () => {
    const projectDir = fixture();
    const paths = filePaths(projectDir);
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-mechanics-outside-"));
    tempProjects.push(outsideDir);
    const outside = path.join(outsideDir, "mechanics.json");
    writeJson(outside, { schemaVersion: 1, modules: {} });
    fs.symlinkSync(outside, paths.mechanics);
    const outsideBefore = fs.readFileSync(outside);

    const preview = await previewMechanicsModule(projectDir, enableRequest());

    expect(preview).toMatchObject({ ok: false, written: false });
    expect(preview.validation.issues).toContainEqual(expect.objectContaining({ code: "source_unsafe" }));
    expect(fs.readFileSync(outside).equals(outsideBefore)).toBe(true);
    expect(fs.lstatSync(paths.mechanics).isSymbolicLink()).toBe(true);
  });
});

describe("R2.1 navigation v1 mechanics authoring surface", () => {
  it("previews and guardedly applies authored_routes then dynamic_flow without changing either exact profile", async () => {
    const projectDir = fixture();
    const before = rawTransactionFiles(projectDir);
    const authoredProfile = authoredRoutesNavigationProfile();
    const authoredRequest = {
      moduleId: "navigation",
      moduleSchemaVersion: 1,
      missionId: "basic",
      profileId: "authored",
      profile: authoredProfile,
      enabled: true,
      ifRevision: mechanicsAuthoringRevision(projectDir)
    };

    const authoredPreview = await previewMechanicsModule(projectDir, authoredRequest);
    expect(authoredPreview).toMatchObject({
      ok: true,
      dryRun: true,
      written: false,
      revision: authoredRequest.ifRevision,
      migration: { required: true, from: 2, to: 3 },
      validation: { ok: true, issues: [] }
    });
    expect(authoredPreview.candidate.manifest.schemaVersion).toBe(3);
    expect(authoredPreview.candidate.mechanics.modules.navigation).toEqual({
      schemaVersion: 1,
      enabled: true,
      profiles: { authored: authoredProfile }
    });
    expect(authoredPreview.candidate.balance.missions.basic.mechanics.profiles.navigation)
      .toBe("authored");
    expectRawFiles(projectDir, before);

    const authoredApplied = await applyMechanicsModule(projectDir, authoredRequest);
    expect(authoredApplied).toMatchObject({
      ok: true,
      dryRun: false,
      written: true,
      previousRevision: authoredRequest.ifRevision,
      backup: {
        files: {
          project: { existed: true },
          balance: { existed: true },
          mechanics: { existed: false }
        }
      }
    });
    expect(JSON.parse(fs.readFileSync(filePaths(projectDir).project, "utf8")).schemaVersion).toBe(3);

    const dynamicProfile = validDynamicNavigationProfile();
    const dynamicRequest = {
      moduleId: "navigation",
      moduleSchemaVersion: 1,
      missionId: "basic",
      profileId: "maze",
      profile: dynamicProfile,
      enabled: true,
      ifRevision: authoredApplied.revision
    };
    const dynamicPreview = await previewMechanicsModule(projectDir, dynamicRequest);
    expect(dynamicPreview).toMatchObject({
      ok: true,
      dryRun: true,
      validation: { ok: true, issues: [] }
    });
    expect(dynamicPreview.candidate.mechanics.modules.navigation).toEqual({
      schemaVersion: 1,
      enabled: true,
      profiles: { authored: authoredProfile, maze: dynamicProfile }
    });
    expect(dynamicPreview.candidate.balance.missions.basic.mechanics.profiles.navigation).toBe("maze");

    const dynamicApplied = await applyMechanicsModule(projectDir, dynamicRequest);
    expect(dynamicApplied).toMatchObject({
      ok: true,
      written: true,
      previousRevision: authoredApplied.revision,
      backup: { files: { mechanics: { existed: true } } }
    });
    const persisted = JSON.parse(fs.readFileSync(filePaths(projectDir).mechanics, "utf8"));
    expect(persisted.modules.navigation.profiles).toEqual({ authored: authoredProfile, maze: dynamicProfile });

    const inspection = await inspectMechanicsAuthoring(projectDir, { missionId: "basic" });
    expect(inspection).toMatchObject({
      rawProjectSchemaVersion: 3,
      navigation: {
        authoring: { moduleId: "navigation", schemaVersion: 1, limits: expect.any(Object) },
        enabled: true,
        moduleSchemaVersion: 1,
        selectedProfileId: "maze",
        selectedProfile: dynamicProfile,
        profileIds: ["authored", "maze"]
      },
      capabilities: { navigation: { available: true, active: true, reason: "active" } }
    });
  });

  it("rejects a stale navigation apply without overwriting concurrent bytes", async () => {
    const projectDir = fixture();
    const request = {
      moduleId: "navigation",
      moduleSchemaVersion: 1,
      missionId: "basic",
      profileId: "maze",
      profile: validDynamicNavigationProfile(),
      enabled: true
    };
    const preview = await previewMechanicsModule(projectDir, request);
    expect(preview.ok).toBe(true);

    fs.appendFileSync(filePaths(projectDir).balance, " ", "utf8");
    const concurrent = rawTransactionFiles(projectDir);
    const stale = await applyMechanicsModule(projectDir, {
      ...request,
      ifRevision: preview.revision
    });

    expect(stale).toMatchObject({
      ok: false,
      written: false,
      conflict: true,
      expectedRevision: preview.revision
    });
    expectRawFiles(projectDir, concurrent);
  });

  it.each([
    [
      "future module version",
      { moduleSchemaVersion: 2, profile: authoredRoutesNavigationProfile() },
      /moduleSchemaVersion|version|supported/i
    ],
    [
      "malformed closed profile",
      { moduleSchemaVersion: 1, profile: { mode: "authored_routes", unexpected: true } },
      /unexpected|closed|unknown/i
    ],
    [
      "active broken references",
      {
        moduleSchemaVersion: 1,
        profile: {
          ...validDynamicNavigationProfile(),
          defaultMovementProfileId: "missing",
          movementProfiles: {
            ground: {
              label: "Ground",
              terrainMode: "respect_walkable",
              towerOccupancy: "blocked",
              defaultTerrainCost: 1000,
              terrainCosts: { void: 1000 }
            }
          },
          enemyMovementProfiles: { ghost: "ground", grunt: "missing" }
        }
      },
      /missing|ghost|void|unknown/i
    ]
  ])("keeps %s preview/apply validation failures completely write-free", async (_label, overrides, diagnostic) => {
    const projectDir = fixture();
    const before = rawTransactionFiles(projectDir);
    const request = {
      moduleId: "navigation",
      missionId: "basic",
      profileId: "invalid_navigation",
      enabled: true,
      ...overrides
    };

    for (const result of [
      await previewMechanicsModule(projectDir, request),
      await applyMechanicsModule(projectDir, {
        ...request,
        ifRevision: mechanicsAuthoringRevision(projectDir)
      })
    ]) {
      expect(result).toMatchObject({ ok: false, written: false });
      expect(issueText(result)).toMatch(diagnostic);
      expectRawFiles(projectDir, before);
    }
  });

  it("creates a backup and rolls back every navigation file after an injected commit failure", async () => {
    const projectDir = fixture();
    const before = rawTransactionFiles(projectDir);
    let injected = false;

    await expect(applyMechanicsModule(projectDir, {
      moduleId: "navigation",
      moduleSchemaVersion: 1,
      missionId: "basic",
      profileId: "maze",
      profile: validDynamicNavigationProfile(),
      enabled: true,
      ifRevision: mechanicsAuthoringRevision(projectDir)
    }, {
      afterFileReplace(relativePath) {
        if (!injected && relativePath === "content/mechanics.json") {
          injected = true;
          throw new Error("SYNTHETIC_NAVIGATION_COMMIT_FAILURE");
        }
      }
    })).rejects.toThrow(/SYNTHETIC_NAVIGATION_COMMIT_FAILURE/);

    expect(injected).toBe(true);
    expectRawFiles(projectDir, before);
    expect(fs.existsSync(filePaths(projectDir).mechanics)).toBe(false);
    const backupRoot = path.join(projectDir, ".towerforge", "backups");
    expect(fs.readdirSync(backupRoot).some((entry) => entry.startsWith("mechanics-"))).toBe(true);
  });
});
