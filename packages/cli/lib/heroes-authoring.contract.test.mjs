import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadEngine, readRawProjectFiles } from "./project-loader.mjs";
import { migrateProjectFiles, writeMigratedProjectFiles } from "./project-migrations.mjs";
import {
  applyMechanicsModule,
  inspectMechanicsAuthoring,
  previewMechanicsModule
} from "./mechanics-authoring.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const projects = [];

afterEach(() => {
  for (const projectDir of projects.splice(0)) fs.rmSync(projectDir, { recursive: true, force: true });
});

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r51a-heroes-cli-"));
  projects.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);
  return projectDir;
}

function transactionBytes(projectDir) {
  return ["project.json", "content/mechanics.json", "content/balance.json"].map((relativePath) => {
    const filePath = path.join(projectDir, relativePath);
    return fs.existsSync(filePath) ? fs.readFileSync(filePath).toString("base64") : null;
  });
}

function request(overrides = {}) {
  return {
    moduleId: "heroes",
    moduleSchemaVersion: 1,
    missionId: "tutorial_01",
    profileId: "field_commander",
    profile: {
      selectedHeroId: "commander",
      definitions: {
        commander: { label: "Commander", spawn: "core" }
      }
    },
    enabled: true,
    ...overrides
  };
}

describe("R5.1A CLI heroes inspect and guarded authoring", () => {
  it("inspects an absent heroes module through the engine descriptor without writing", async () => {
    const projectDir = fixture();
    const before = transactionBytes(projectDir);
    const engine = await loadEngine();
    const view = await inspectMechanicsAuthoring(projectDir, { missionId: "tutorial_01" });

    expect(view.capabilities.heroes).toMatchObject({
      moduleId: "heroes", available: true, active: false, reason: "module_missing"
    });
    expect(view.heroes).toEqual({
      authoring: engine.HEROES_MECHANICS_SCHEMA,
      enabled: false,
      profileIds: [],
      profileUses: {}
    });
    expect(transactionBytes(projectDir)).toEqual(before);
  }, 15_000);

  it("previews and applies the exact profile through the generic three-file transaction", async () => {
    const projectDir = fixture();
    const before = transactionBytes(projectDir);
    const preview = await previewMechanicsModule(projectDir, request());

    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      validation: { ok: true, issues: [] },
      candidate: {
        manifest: { schemaVersion: 3 },
        mechanics: {
          schemaVersion: 1,
          modules: {
            heroes: {
              schemaVersion: 1,
              enabled: true,
              profiles: { field_commander: request().profile }
            }
          }
        },
        balance: {
          missions: {
            tutorial_01: { mechanics: { profiles: { heroes: "field_commander" } } }
          }
        }
      }
    });
    expect(transactionBytes(projectDir)).toEqual(before);

    const applied = await applyMechanicsModule(projectDir, {
      ...request(),
      ifRevision: preview.revision
    });
    expect(applied).toMatchObject({
      ok: true,
      written: true,
      previousRevision: preview.revision,
      backup: {
        files: {
          project: { existed: true },
          balance: { existed: true },
          mechanics: { existed: false }
        }
      }
    });
    expect(JSON.parse(fs.readFileSync(path.join(projectDir, "content", "mechanics.json"), "utf8")))
      .toEqual(preview.candidate.mechanics);

    const reread = await inspectMechanicsAuthoring(projectDir, { missionId: "tutorial_01" });
    expect(reread.heroes).toMatchObject({
      enabled: true,
      moduleSchemaVersion: 1,
      selectedProfileId: "field_commander",
      selectedProfile: request().profile,
      profileIds: ["field_commander"],
      profileUses: { field_commander: ["tutorial_01"] }
    });
    expect(reread.capabilities.heroes).toMatchObject({
      available: true, active: true, profileId: "field_commander", reason: "active"
    });
  }, 15_000);

  it("rejects stale apply and malformed rosters without changing any transaction bytes", async () => {
    const projectDir = fixture();
    const preview = await previewMechanicsModule(projectDir, request());
    expect(preview.ok).toBe(true);
    fs.appendFileSync(path.join(projectDir, "content", "balance.json"), " ", "utf8");
    const concurrent = transactionBytes(projectDir);
    const stale = await applyMechanicsModule(projectDir, {
      ...request(),
      ifRevision: preview.revision
    });
    expect(stale).toMatchObject({ ok: false, conflict: true, expectedRevision: preview.revision });
    expect(transactionBytes(projectDir)).toEqual(concurrent);

    const malformed = await previewMechanicsModule(projectDir, request({
      profile: {
        selectedHeroId: "ghost",
        definitions: { commander: { label: "Commander", spawn: "spawn" } }
      }
    }));
    expect(malformed.ok).toBe(false);
    expect(malformed.validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "error",
        fieldPath: expect.stringMatching(/heroes|selectedHeroId|spawn/i)
      })
    ]));
    expect(transactionBytes(projectDir)).toEqual(concurrent);
  }, 15_000);
});

describe("R5.2A CLI durable hero authoring", () => {
  it("previews and applies an exact heroes v3 profile through the existing guarded transaction", async () => {
    const projectDir = fixture();
    const durable = request({
      moduleSchemaVersion: 3,
      profileId: "durable_commander",
      profile: {
        selectedHeroId: "commander",
        definitions: {
          commander: {
            label: "Commander",
            spawn: "core",
            movement: { movementProfileId: "ground", speed: 1 },
            durability: { maxHp: 100, shield: { capacity: 25 } }
          }
        },
        movementProfiles: {
          ground: {
            label: "Ground",
            terrainMode: "respect_walkable",
            towerOccupancy: "blocked",
            defaultTerrainCost: 1000
          }
        }
      }
    });

    const preview = await previewMechanicsModule(projectDir, durable);
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      validation: { ok: true, issues: [] },
      candidate: {
        mechanics: { modules: { heroes: { schemaVersion: 3, enabled: true } } },
        balance: {
          missions: {
            tutorial_01: { mechanics: { profiles: { heroes: "durable_commander" } } }
          }
        }
      }
    });
    expect(preview.candidate.mechanics.modules.navigation).toBeUndefined();

    const applied = await applyMechanicsModule(projectDir, {
      ...durable,
      ifRevision: preview.revision
    });
    expect(applied).toMatchObject({ ok: true, written: true, previousRevision: preview.revision });

    const reread = await inspectMechanicsAuthoring(projectDir, { missionId: "tutorial_01" });
    expect(reread.heroes).toMatchObject({
      enabled: true,
      moduleSchemaVersion: 3,
      selectedProfileId: "durable_commander",
      selectedProfile: durable.profile
    });
    expect(reread.capabilities.navigation.active).toBe(false);
  }, 15_000);
});

describe("R5.3A CLI targeted hero ability authoring", () => {
  const activeHero = () => request({
    moduleSchemaVersion: 4,
    profileId: "active_commander",
    profile: {
      selectedHeroId: "commander",
      definitions: {
        commander: {
          label: "Commander",
          spawn: "core",
          movement: { movementProfileId: "ground", speed: 1 },
          durability: { maxHp: 100, shield: { capacity: 25 } },
          mana: { max: 100, starting: 60, regenerationPerUnit: 5 },
          activeAbility: {
            id: "arc_bolt", label: "Arc Bolt", target: "enemy",
            manaCost: 20, cooldown: 3, range: 6, damage: 30
          }
        }
      },
      movementProfiles: {
        ground: {
          label: "Ground", terrainMode: "respect_walkable",
          towerOccupancy: "blocked", defaultTerrainCost: 1000
        }
      }
    }
  });

  it("previews, guardedly applies, and rereads one exact v4 profile", async () => {
    const projectDir = fixture();
    const before = transactionBytes(projectDir);
    const authored = activeHero();
    const preview = await previewMechanicsModule(projectDir, authored);
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      validation: { ok: true, issues: [] },
      candidate: {
        mechanics: { modules: { heroes: { schemaVersion: 4, enabled: true } } },
        balance: { missions: { tutorial_01: { mechanics: { profiles: { heroes: "active_commander" } } } } }
      }
    });
    expect(transactionBytes(projectDir)).toEqual(before);
    expect(preview.candidate.mechanics.modules.navigation).toBeUndefined();

    const applied = await applyMechanicsModule(projectDir, { ...authored, ifRevision: preview.revision });
    expect(applied).toMatchObject({ ok: true, written: true, previousRevision: preview.revision });
    const reread = await inspectMechanicsAuthoring(projectDir, { missionId: "tutorial_01" });
    expect(reread.heroes).toMatchObject({
      enabled: true,
      moduleSchemaVersion: 4,
      selectedProfileId: "active_commander",
      selectedProfile: authored.profile
    });
    expect(reread.capabilities.navigation.active).toBe(false);
  }, 15_000);

  it("rejects invalid visible-number equivalents without repairing or writing them", async () => {
    const projectDir = fixture();
    const before = transactionBytes(projectDir);
    for (const mutate of [
      (profile) => { profile.definitions.commander.mana.max = 0; },
      (profile) => { profile.definitions.commander.mana.starting = 101; },
      (profile) => { profile.definitions.commander.mana.regenerationPerUnit = -1; },
      (profile) => { profile.definitions.commander.activeAbility.manaCost = 0; },
      (profile) => { profile.definitions.commander.activeAbility.cooldown = -1; },
      (profile) => { profile.definitions.commander.activeAbility.range = 1.5; },
      (profile) => { profile.definitions.commander.activeAbility.damage = 0; }
    ]) {
      const malformed = activeHero();
      mutate(malformed.profile);
      const preview = await previewMechanicsModule(projectDir, malformed);
      expect(preview.ok).toBe(false);
      expect(preview.validation.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ severity: "error", fieldPath: expect.stringMatching(/mana|activeAbility/i) })
      ]));
      expect(transactionBytes(projectDir)).toEqual(before);
    }
  }, 15_000);
});

describe("R5.4A CLI battle-local hero skill-tree authoring", () => {
  const skilledHero = (skillTree = {
    points: { starting: 1, perInterwave: 1 },
    nodes: {
      focused_cast: {
        label: "Focused Cast",
        description: "Increase active ability damage.",
        cost: 1,
        requires: [],
        effects: [{
          kind: "modifier",
          scope: "hero_ability_damage",
          modifier: { target: "damage", operation: "multiplier", value: 1.25 }
        }]
      },
      overcharge: {
        label: "Overcharge",
        description: "Further increase active ability damage.",
        cost: 2,
        requires: ["focused_cast"],
        effects: [{
          kind: "modifier",
          scope: "hero_ability_damage",
          modifier: { target: "damage", operation: "additive_ratio", value: 0.5 }
        }]
      }
    }
  }) => request({
    moduleSchemaVersion: 5,
    profileId: "skilled_commander",
    profile: {
      selectedHeroId: "commander",
      definitions: {
        commander: {
          label: "Commander",
          spawn: "core",
          movement: { movementProfileId: "ground", speed: 1 },
          durability: { maxHp: 100, shield: { capacity: 25 } },
          mana: { max: 100, starting: 60, regenerationPerUnit: 5 },
          activeAbility: {
            id: "arc_bolt", label: "Arc Bolt", target: "enemy",
            manaCost: 20, cooldown: 3, range: 6, damage: 30
          },
          skillTree
        }
      },
      movementProfiles: {
        ground: {
          label: "Ground", terrainMode: "respect_walkable",
          towerOccupancy: "blocked", defaultTerrainCost: 1000
        }
      }
    }
  });

  it("previews, guardedly applies, and rereads the exact required nullable v5 tree", async () => {
    for (const skillTree of [null, undefined]) {
      const projectDir = fixture();
      const before = transactionBytes(projectDir);
      const authored = skilledHero(skillTree === undefined ? undefined : skillTree);
      const preview = await previewMechanicsModule(projectDir, authored);

      expect(preview).toMatchObject({
        ok: true,
        dryRun: true,
        validation: { ok: true, issues: [] },
        candidate: {
          mechanics: { modules: { heroes: { schemaVersion: 5, enabled: true } } },
          balance: { missions: { tutorial_01: { mechanics: { profiles: { heroes: "skilled_commander" } } } } }
        }
      });
      expect(preview.candidate.mechanics.modules.navigation).toBeUndefined();
      expect(transactionBytes(projectDir)).toEqual(before);

      const applied = await applyMechanicsModule(projectDir, {
        ...authored,
        ifRevision: preview.revision
      });
      expect(applied).toMatchObject({ ok: true, written: true, previousRevision: preview.revision });
      const reread = await inspectMechanicsAuthoring(projectDir, { missionId: "tutorial_01" });
      expect(reread.heroes).toMatchObject({
        enabled: true,
        moduleSchemaVersion: 5,
        selectedProfileId: "skilled_commander",
        selectedProfile: authored.profile
      });
      expect(reread.capabilities.navigation.active).toBe(false);
    }
  }, 30_000);

  it("rejects a malformed v5 tree without silently repairing or writing it", async () => {
    const projectDir = fixture();
    const before = transactionBytes(projectDir);
    const malformed = skilledHero();
    malformed.profile.definitions.commander.skillTree.nodes.overcharge.requires = ["ghost"];

    const preview = await previewMechanicsModule(projectDir, malformed);
    expect(preview.ok).toBe(false);
    expect(preview.validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "error",
        fieldPath: expect.stringMatching(/skillTree|overcharge|requires|ghost/i)
      })
    ]));
    expect(transactionBytes(projectDir)).toEqual(before);
  }, 15_000);
});

describe("R5.5A CLI passive hero damage-aura authoring", () => {
  const abilityDefinition = (passiveAura) => ({
    label: "Commander",
    spawn: "core",
    movement: { movementProfileId: "ground", speed: 1 },
    durability: { maxHp: 100, shield: { capacity: 25 } },
    mana: { max: 100, starting: 60, regenerationPerUnit: 5 },
    activeAbility: {
      id: "arc_bolt", label: "Arc Bolt", target: "enemy",
      manaCost: 20, cooldown: 3, range: 6, damage: 30
    },
    skillTree: null,
    passiveAura
  });
  const movementProfiles = {
    ground: {
      label: "Ground", terrainMode: "respect_walkable",
      towerOccupancy: "blocked", defaultTerrainCost: 1000
    }
  };
  const aura = {
    id: "command_link",
    label: "Command Link",
    radius: 3,
    effects: [{
      kind: "modifier",
      scope: "tower_damage",
      modifier: { target: "damage", operation: "additive_ratio", value: 0.2 }
    }]
  };
  const v5Definition = (label, skillTree = null) => {
    const { passiveAura: _passiveAura, ...definition } = abilityDefinition(null);
    return { ...definition, label, skillTree };
  };
  const seedV5Profiles = (projectDir) => {
    const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
    const balancePath = path.join(projectDir, "content", "balance.json");
    const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
    const mission = balance.missions.tutorial_01;
    mission.mechanics = mission.mechanics ?? {};
    mission.mechanics.profiles = { ...(mission.mechanics.profiles ?? {}), heroes: "alpha" };
    const profiles = {
      alpha: {
        selectedHeroId: "commander",
        definitions: {
          commander: v5Definition("Alpha Commander"),
          sentinel: v5Definition("Alpha Sentinel")
        },
        movementProfiles
      },
      beta: {
        selectedHeroId: "warden",
        definitions: {
          warden: v5Definition("Beta Warden", {
            points: { starting: 1, perInterwave: 0 },
            nodes: {
              focus: {
                label: "Focus", description: "Preserved beta tree.", cost: 1, requires: [],
                effects: [{
                  kind: "modifier", scope: "hero_ability_damage",
                  modifier: { target: "damage", operation: "flat", value: 3 }
                }]
              }
            }
          })
        },
        movementProfiles
      }
    };
    fs.writeFileSync(mechanicsPath, `${JSON.stringify({
      schemaVersion: 1,
      modules: { heroes: { schemaVersion: 5, enabled: true, profiles } }
    }, null, 2)}\n`, "utf8");
    fs.writeFileSync(balancePath, `${JSON.stringify(balance, null, 2)}\n`, "utf8");
    return profiles;
  };

  it("previews, guardedly applies, and rereads an explicit multi-definition v5-to-v6 promotion", async () => {
    const projectDir = fixture();
    const before = transactionBytes(projectDir);
    const authored = request({
      moduleSchemaVersion: 6,
      profileId: "aura_commanders",
      profile: {
        selectedHeroId: "commander",
        definitions: {
          commander: abilityDefinition(aura),
          warden: { ...abilityDefinition(null), label: "Warden" }
        },
        movementProfiles
      }
    });

    const preview = await previewMechanicsModule(projectDir, authored);
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      validation: { ok: true, issues: [] },
      candidate: {
        mechanics: {
          modules: {
            heroes: {
              schemaVersion: 6,
              enabled: true,
              profiles: {
                aura_commanders: {
                  definitions: {
                    commander: { passiveAura: aura },
                    warden: { passiveAura: null }
                  }
                }
              }
            }
          }
        }
      }
    });
    expect(transactionBytes(projectDir)).toEqual(before);

    const applied = await applyMechanicsModule(projectDir, {
      ...authored,
      ifRevision: preview.revision
    });
    expect(applied).toMatchObject({ ok: true, written: true, previousRevision: preview.revision });
    const reread = await inspectMechanicsAuthoring(projectDir, { missionId: "tutorial_01" });
    expect(reread.heroes).toMatchObject({
      enabled: true,
      moduleSchemaVersion: 6,
      selectedProfileId: "aura_commanders",
      selectedProfile: authored.profile
    });
    expect(reread.capabilities.navigation.active).toBe(false);
    expect(reread.capabilities.elevation.active).toBe(false);
  }, 30_000);

  it("atomically promotes every existing v5 profile when one selected profile upgrades to v6", async () => {
    const projectDir = fixture();
    const originalProfiles = seedV5Profiles(projectDir);
    const selectedProfile = structuredClone(originalProfiles.alpha);
    selectedProfile.definitions.commander.passiveAura = structuredClone(aura);
    selectedProfile.definitions.sentinel.passiveAura = null;
    const upgrade = request({
      moduleSchemaVersion: 6,
      profileId: "alpha",
      profile: selectedProfile
    });

    const before = transactionBytes(projectDir);
    const preview = await previewMechanicsModule(projectDir, upgrade);
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      candidate: {
        mechanics: {
          modules: {
            heroes: {
              schemaVersion: 6,
              profiles: {
                alpha: { definitions: { commander: { passiveAura: aura }, sentinel: { passiveAura: null } } },
                beta: { definitions: { warden: { passiveAura: null } } }
              }
            }
          }
        }
      }
    });
    expect(preview.candidate.mechanics.modules.heroes.profiles.beta).toEqual({
      ...originalProfiles.beta,
      definitions: {
        warden: { ...originalProfiles.beta.definitions.warden, passiveAura: null }
      }
    });
    expect(transactionBytes(projectDir)).toEqual(before);

    const applied = await applyMechanicsModule(projectDir, { ...upgrade, ifRevision: preview.revision });
    expect(applied).toMatchObject({ ok: true, written: true, previousRevision: preview.revision });
    expect(JSON.parse(fs.readFileSync(path.join(projectDir, "content", "mechanics.json"), "utf8")))
      .toEqual(preview.candidate.mechanics);
  }, 30_000);

  it("keeps multi-profile promotion atomic for invalid selected data and future modules", async () => {
    const projectDir = fixture();
    const originalProfiles = seedV5Profiles(projectDir);
    const selectedProfile = structuredClone(originalProfiles.alpha);
    selectedProfile.definitions.commander.passiveAura = { ...structuredClone(aura), radius: 65_537 };
    selectedProfile.definitions.sentinel.passiveAura = null;
    const before = transactionBytes(projectDir);

    const invalid = await previewMechanicsModule(projectDir, request({
      moduleSchemaVersion: 6,
      profileId: "alpha",
      profile: selectedProfile
    }));
    expect(invalid.ok).toBe(false);
    expect(invalid.validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "error", fieldPath: expect.stringMatching(/passiveAura|radius/i) })
    ]));
    expect(transactionBytes(projectDir)).toEqual(before);

    const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
    const future = JSON.parse(fs.readFileSync(mechanicsPath, "utf8"));
    future.modules.heroes.schemaVersion = 8;
    fs.writeFileSync(mechanicsPath, `${JSON.stringify(future, null, 2)}\n`, "utf8");
    const futureBefore = transactionBytes(projectDir);
    const rejected = await previewMechanicsModule(projectDir, request({
      moduleSchemaVersion: 6,
      profileId: "alpha",
      profile: selectedProfile
    }));
    expect(rejected.ok).toBe(false);
    expect(rejected.validation.issues).toContainEqual(expect.objectContaining({
      code: "module_version_unsupported",
      fieldPath: expect.stringMatching(/heroes.*schemaVersion/i)
    }));
    expect(transactionBytes(projectDir)).toEqual(futureBefore);
  }, 30_000);

  it("rejects omitted promotion nulls and malformed aura values without writing", async () => {
    const projectDir = fixture();
    const before = transactionBytes(projectDir);
    const missingNull = request({
      moduleSchemaVersion: 6,
      profileId: "missing_null",
      profile: {
        selectedHeroId: "commander",
        definitions: {
          commander: abilityDefinition(aura),
          warden: { ...abilityDefinition(null), label: "Warden" }
        },
        movementProfiles
      }
    });
    delete missingNull.profile.definitions.warden.passiveAura;

    const missingPreview = await previewMechanicsModule(projectDir, missingNull);
    expect(missingPreview.ok).toBe(false);
    expect(missingPreview.validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "error", fieldPath: expect.stringMatching(/warden.*passiveAura/i) })
    ]));

    const malformed = structuredClone(missingNull);
    malformed.profile.definitions.warden.passiveAura = structuredClone(aura);
    malformed.profile.definitions.warden.passiveAura.effects[0].scope = "hero_ability_damage";
    const malformedPreview = await previewMechanicsModule(projectDir, malformed);
    expect(malformedPreview.ok).toBe(false);
    expect(malformedPreview.validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "error", fieldPath: expect.stringMatching(/passiveAura|scope/i) })
    ]));
    expect(transactionBytes(projectDir)).toEqual(before);
  }, 20_000);
});
