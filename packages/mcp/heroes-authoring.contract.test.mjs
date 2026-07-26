import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateProjectFiles, writeMigratedProjectFiles } from "../cli/lib/project-migrations.mjs";
import { readRawProjectFiles } from "../cli/lib/project-loader.mjs";
import { callTool, TOOLS } from "./tools.mjs";
import { TOWERFORGE_AGENT_GUIDE_VERSION, TOWERFORGE_AGENT_INSTRUCTIONS } from "./agent-instructions.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const PLUGIN_SKILL = path.resolve("plugins/towerforge/skills/towerforge-authoring/SKILL.md");
const projects = [];

afterEach(() => {
  for (const projectDir of projects.splice(0)) fs.rmSync(projectDir, { recursive: true, force: true });
});

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r51a-heroes-mcp-"));
  projects.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);
  return projectDir;
}

async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected operation to reject.");
}

describe("R5.1A MCP/AI static hero authoring", () => {
  it("describes the closed roster, optional snapshot, and v3 durability events", async () => {
    const heroes = await callTool("describe_schema", { domain: "heroes" }, {});
    const mechanics = await callTool("describe_schema", { domain: "mechanics" }, {});

    expect(heroes).toMatchObject({
      requestedDomain: "heroes",
      heroes: {
        authoring: {
          moduleId: "heroes",
          schemaVersion: 7,
          supportedModuleSchemaVersions: [1, 2, 3, 4, 5, 6, 7],
          limits: { definitions: 32, idUtf8Bytes: 128, labelUtf8Bytes: 128 }
        },
        snapshot: { field: "heroes", optional: true, supportedSchemaVersions: [1, 2, 3, 4, 5, 6, 7] },
        events: {
          heroShieldChanged: {
            requiredFields: ["heroId", "previous", "current", "capacity", "cause", "amount"],
            optionalFields: ["overflowDamage"],
            causeValues: ["damage"]
          },
          heroAttacked: {
            requiredFields: ["enemyId", "enemyTypeId", "heroId", "damage", "shieldAbsorbed", "hpDamage"],
            optionalFields: []
          },
          heroDefeated: {
            requiredFields: ["heroId", "heroDefinitionId", "enemyId"],
            optionalFields: []
          }
        }
      }
    });
    expect(heroes.availableDomains).toContain("heroes");
    expect(heroes.heroes.commands).toHaveProperty("moveHero");
    expect(heroes.heroes).not.toHaveProperty("abilities");
    expect(heroes.heroes).not.toHaveProperty("towerScript");
    expect(mechanics.mechanics.implementedModuleIds).toContain("heroes");
    expect(mechanics.mechanics.modules.heroes).toEqual(heroes.heroes);
    expect(TOOLS.map((tool) => tool.name)).not.toContain("analyze_heroes");
  });

  it("runs describe -> read -> recipe -> preview -> guarded apply -> validate", async () => {
    const projectDir = fixture();
    const described = await callTool("describe_schema", { domain: "heroes" }, {});
    expect(described.heroes.authoring.moduleId).toBe("heroes");

    const before = await callTool("get_capabilities", {
      projectDir,
      missionId: "tutorial_01"
    }, {});
    expect(before.capabilities.heroes).toMatchObject({
      available: true, active: false, reason: "module_missing"
    });

    const materialized = await callTool("get_recipe", {
      projectDir,
      collection: "mechanics",
      recipeId: "basic_commander_hero"
    }, {});
    expect(materialized.recipe).toMatchObject({
      id: "basic_commander_hero",
      moduleId: "heroes",
      moduleSchemaVersion: 1,
      entity: {
        moduleId: "heroes",
        moduleSchemaVersion: 1,
        missionId: "tutorial_01",
        profileId: "basic_commander_hero",
        profile: {
          selectedHeroId: "commander",
          definitions: { commander: { label: "Commander", spawn: "core" } }
        }
      }
    });

    const request = {
      projectDir,
      ...materialized.recipe.entity,
      enabled: true
    };
    const preview = await callTool("preview_mechanics_module", request, {});
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      revision: materialized.revision,
      validation: { ok: true, issues: [] },
      candidate: {
        manifest: { schemaVersion: 3 },
        mechanics: { modules: { heroes: { schemaVersion: 1, enabled: true } } },
        balance: {
          missions: {
            tutorial_01: { mechanics: { profiles: { heroes: "basic_commander_hero" } } }
          }
        }
      }
    });

    const applied = await callTool("apply_mechanics_module", {
      ...request,
      ifRevision: preview.revision
    }, {});
    expect(applied).toMatchObject({ ok: true, previousRevision: preview.revision });
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true });
    expect(await callTool("get_capabilities", {
      projectDir,
      missionId: "tutorial_01"
    }, {})).toMatchObject({
      capabilities: {
        heroes: {
          available: true,
          active: true,
          moduleSchemaVersion: 1,
          profileId: "basic_commander_hero"
        }
      }
    });

    const stale = await rejection(callTool("apply_mechanics_module", {
      ...request,
      ifRevision: preview.revision
    }, {}));
    expect(stale).toMatchObject({ code: "conflict" });
  });

  it("rejects inherited __proto__ as a sprite definition instead of accepting Object.prototype", async () => {
    const projectDir = fixture();
    await applyHeroesProfile(projectDir, "commanders", {
      selectedHeroId: "commander",
      definitions: { commander: { label: "Commander", spawn: "core" } }
    });
    const visualsPath = path.join(projectDir, "content", "visuals.json");
    const before = fs.readFileSync(visualsPath, "utf8");

    const error = await rejection(callTool("bind_sprite", {
      projectDir,
      kind: "heroes",
      entityId: "commander",
      spriteId: "__proto__"
    }, {}));
    expect(error).toMatchObject({ message: expect.stringMatching(/sprite|not found|unknown/i) });
    expect(fs.readFileSync(visualsPath, "utf8")).toBe(before);
  });

  it("round-trips own __proto__ hero and sprite IDs through bind and own-safe removal", async () => {
    const projectDir = fixture();
    const profile = JSON.parse(`{
      "selectedHeroId": "__proto__",
      "definitions": {
        "__proto__": { "label": "Prototype Warden", "spawn": "core" }
      }
    }`);
    await applyHeroesProfile(projectDir, "prototype_commanders", profile);

    const visualsPath = path.join(projectDir, "content", "visuals.json");
    const visuals = JSON.parse(fs.readFileSync(visualsPath, "utf8"));
    Object.defineProperty(visuals.sprites, "__proto__", {
      value: { src: "assets/prototype-warden.png" },
      enumerable: true,
      configurable: true,
      writable: true
    });
    fs.writeFileSync(visualsPath, `${JSON.stringify(visuals, null, 2)}\n`, "utf8");

    const bound = await callTool("bind_sprite", {
      projectDir,
      kind: "heroes",
      entityId: "__proto__",
      spriteId: "__proto__"
    }, {});
    expect(bound).toMatchObject({ ok: true, written: true });
    let persisted = JSON.parse(fs.readFileSync(visualsPath, "utf8"));
    expect(Object.hasOwn(persisted.sprites, "__proto__")).toBe(true);
    expect(Object.hasOwn(persisted.bindings, "heroes")).toBe(true);
    expect(Object.hasOwn(persisted.bindings.heroes, "__proto__")).toBe(true);
    expect(persisted.bindings.heroes.__proto__).toBe("__proto__");

    const removed = await callTool("bind_sprite", {
      projectDir,
      kind: "heroes",
      entityId: "__proto__",
      spriteId: "",
      ifRevision: bound.revision
    }, {});
    expect(removed).toMatchObject({ ok: true, written: true });
    persisted = JSON.parse(fs.readFileSync(visualsPath, "utf8"));
    expect(Object.hasOwn(persisted.bindings.heroes, "__proto__")).toBe(false);
    expect(Object.getPrototypeOf(persisted.bindings.heroes)).toBe(Object.prototype);
  });
});

describe("R5.1B MCP/AI deterministic hero movement", () => {
  it("advertises heroes v2, snapshot v2, and the exact GameCommand v4 moveHero surface", async () => {
    const described = await callTool("describe_schema", { domain: "heroes" }, {});

    expect(described.heroes).toMatchObject({
      authoring: {
        moduleId: "heroes",
        schemaVersion: 7,
        supportedModuleSchemaVersions: [1, 2, 3, 4, 5, 6, 7],
        versions: {
          2: {
            movementProfile: {
              requiredFields: ["label", "terrainMode", "towerOccupancy", "defaultTerrainCost"],
              optionalFields: ["terrainCosts"],
              terrainModeValues: ["respect_walkable", "ignore_walkable"],
              towerOccupancyValues: ["blocked", "ignored"],
              defaultTerrainCost: { integer: true, minimum: 1, maximum: 1_000_000, nullable: true },
              terrainCosts: {
                maximumEntries: 256,
                values: { integer: true, minimum: 1, maximum: 1_000_000, nullable: true }
              }
            }
          }
        }
      },
      snapshot: { field: "heroes", optional: true, supportedSchemaVersions: [1, 2, 3, 4, 5, 6, 7] },
      commands: {
        schemaVersion: 6,
        moveHero: {
          requiredFields: ["heroId", "target"],
          optionalFields: [],
          additionalProperties: false
        }
      }
    });
    expect(described.heroes.events).toMatchObject({
      heroShieldChanged: {
        requiredFields: ["heroId", "previous", "current", "capacity", "cause", "amount"],
        optionalFields: ["overflowDamage"],
        causeValues: ["damage"]
      },
      heroAttacked: {
        requiredFields: ["enemyId", "enemyTypeId", "heroId", "damage", "shieldAbsorbed", "hpDamage"],
        optionalFields: []
      },
      heroDefeated: {
        requiredFields: ["heroId", "heroDefinitionId", "enemyId"],
        optionalFields: []
      }
    });
    expect(described.heroes).not.toHaveProperty("towerScript");
  });

  it("materializes an inert heroes-owned movement recipe without enabling navigation", async () => {
    const projectDir = fixture();
    const materialized = await callTool("get_recipe", {
      projectDir,
      collection: "mechanics",
      recipeId: "basic_mobile_commander_hero"
    }, {});

    expect(materialized.recipe).toMatchObject({
      id: "basic_mobile_commander_hero",
      moduleId: "heroes",
      moduleSchemaVersion: 2,
      entity: {
        moduleId: "heroes",
        moduleSchemaVersion: 2,
        missionId: "tutorial_01",
        profileId: "basic_mobile_commander_hero",
        profile: {
          selectedHeroId: "commander",
          definitions: {
            commander: {
              label: "Commander",
              spawn: "core",
              movement: { movementProfileId: "ground", speed: 1 }
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
      }
    });
    expect(materialized.recipe.entity).not.toHaveProperty("enabled");
    expect(materialized.recipe.entity).not.toHaveProperty("navigation");
    expect(materialized.recipe.entity.profile).not.toHaveProperty("navigation");

    const raw = readRawProjectFiles(projectDir);
    expect(raw.mechanics?.modules?.heroes).toBeUndefined();
    expect(raw.mechanics?.modules?.navigation).toBeUndefined();
    expect(raw.balance.missions.tutorial_01.mechanics?.profiles).toBeUndefined();
  });

  it("runs the complete guarded v2 AI flow and keeps navigation absent", async () => {
    const projectDir = fixture();
    const described = await callTool("describe_schema", { domain: "heroes" }, {});
    expect(described.heroes.authoring.versions[2].movementProfile).toMatchObject({
      terrainModeValues: ["respect_walkable", "ignore_walkable"],
      towerOccupancyValues: ["blocked", "ignored"]
    });

    const before = await callTool("get_capabilities", {
      projectDir,
      missionId: "tutorial_01"
    }, {});
    expect(before.capabilities.heroes).toMatchObject({ available: true, active: false });
    expect(before.capabilities.navigation.active).toBe(false);

    const materialized = await callTool("get_recipe", {
      projectDir,
      collection: "mechanics",
      recipeId: "basic_mobile_commander_hero"
    }, {});
    const request = {
      projectDir,
      ...materialized.recipe.entity,
      enabled: true
    };
    const preview = await callTool("preview_mechanics_module", request, {});
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      revision: materialized.revision,
      validation: { ok: true, issues: [] },
      candidate: {
        manifest: { schemaVersion: 3 },
        mechanics: { modules: { heroes: { schemaVersion: 2, enabled: true } } },
        balance: {
          missions: {
            tutorial_01: { mechanics: { profiles: { heroes: "basic_mobile_commander_hero" } } }
          }
        }
      }
    });
    expect(preview.candidate.mechanics.modules.navigation).toBeUndefined();

    const applied = await callTool("apply_mechanics_module", {
      ...request,
      ifRevision: preview.revision
    }, {});
    expect(applied).toMatchObject({ ok: true, previousRevision: preview.revision });
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true });
    const active = await callTool("get_capabilities", {
      projectDir,
      missionId: "tutorial_01"
    }, {});
    expect(active.capabilities.heroes).toMatchObject({
      available: true,
      active: true,
      moduleSchemaVersion: 2,
      profileId: "basic_mobile_commander_hero"
    });
    expect(active.capabilities.navigation.active).toBe(false);

    const stale = await rejection(callTool("apply_mechanics_module", {
      ...request,
      ifRevision: preview.revision
    }, {}));
    expect(stale).toMatchObject({ code: "conflict" });
  });

  it("teaches agents the guarded independent v2 flow instead of inventing direct runtime mutation", () => {
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/Heroes v2[\s\S]*independent[\s\S]*navigation/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/GameCommand v4[\s\S]*moveHero/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/snapshot[\s\S]*never (?:mutate|write)/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/basic_mobile_commander_hero[\s\S]*(?:never|does not)[\s\S]*(?:enable|select)/i);
  });
});

describe("R5.2A MCP/AI durable hero authoring", () => {
  it("describes v3 durability and completes the inert guarded recipe flow", async () => {
    const described = await callTool("describe_schema", { domain: "heroes" }, {});
    expect(described.heroes).toMatchObject({
      authoring: {
        schemaVersion: 7,
        supportedModuleSchemaVersions: [1, 2, 3, 4, 5, 6, 7],
        versions: {
          3: {
            durability: {
              requiredFields: ["maxHp", "shield"],
              additionalProperties: false
            },
            shield: {
              nullable: true,
              requiredFields: ["capacity"],
              additionalProperties: false
            }
          }
        }
      },
      snapshot: { field: "heroes", optional: true, supportedSchemaVersions: [1, 2, 3, 4, 5, 6, 7] }
    });

    const projectDir = fixture();
    const before = await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {});
    expect(before.capabilities.heroes).toMatchObject({ available: true, active: false });

    const materialized = await callTool("get_recipe", {
      projectDir,
      collection: "mechanics",
      recipeId: "basic_durable_commander_hero"
    }, {});
    expect(materialized.recipe).toMatchObject({
      moduleId: "heroes",
      moduleSchemaVersion: 3,
      entity: {
        moduleId: "heroes",
        moduleSchemaVersion: 3,
        missionId: "tutorial_01",
        profileId: "basic_durable_commander_hero",
        profile: {
          definitions: {
            commander: { durability: { maxHp: 100, shield: { capacity: 25 } } }
          }
        }
      }
    });
    expect(materialized.recipe.entity).not.toHaveProperty("enabled");

    const request = { projectDir, ...materialized.recipe.entity, enabled: true };
    const preview = await callTool("preview_mechanics_module", request, {});
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      revision: materialized.revision,
      validation: { ok: true, issues: [] },
      candidate: { mechanics: { modules: { heroes: { schemaVersion: 3, enabled: true } } } }
    });
    expect(preview.candidate.mechanics.modules.navigation).toBeUndefined();

    const applied = await callTool("apply_mechanics_module", {
      ...request,
      ifRevision: preview.revision
    }, {});
    expect(applied).toMatchObject({ ok: true, previousRevision: preview.revision });
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true });

    const active = await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {});
    expect(active.capabilities.heroes).toMatchObject({
      active: true,
      moduleSchemaVersion: 3,
      profileId: "basic_durable_commander_hero"
    });
    expect(active.capabilities.navigation.active).toBe(false);
  });

  it("teaches agents to read durability only from authoritative state", () => {
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/Heroes v3[\s\S]*durability[\s\S]*maxHp[\s\S]*shield/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/basic_durable_commander_hero[\s\S]*(?:never|do not)[\s\S]*(?:enable|select)/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/HP[\s\S]*shield[\s\S]*snapshot[\s\S]*never (?:mutate|write)/i);
    for (const eventType of ["heroShieldChanged", "heroAttacked", "heroDefeated"]) {
      expect(TOWERFORGE_AGENT_INSTRUCTIONS).toContain(eventType);
    }
  });
});

describe("R5.3A MCP/AI targeted hero ability authoring", () => {
  it("describes exact v4 authoring, snapshot, GameCommand v5, and event contracts", async () => {
    const described = await callTool("describe_schema", { domain: "heroes" }, {});
    expect(described.heroes).toMatchObject({
      authoring: {
        schemaVersion: 7,
        supportedModuleSchemaVersions: [1, 2, 3, 4, 5, 6, 7],
        versions: {
          4: {
            definition: {
              requiredFields: ["label", "spawn", "movement", "durability", "mana", "activeAbility"],
              optionalFields: [],
              additionalProperties: false
            },
            mana: {
              requiredFields: ["max", "starting", "regenerationPerUnit"],
              optionalFields: [],
              additionalProperties: false
            },
            activeAbility: {
              requiredFields: ["id", "label", "target", "manaCost", "cooldown", "range", "damage"],
              optionalFields: [],
              additionalProperties: false,
              targetValues: ["enemy"]
            }
          }
        }
      },
      snapshot: {
        field: "heroes",
        optional: true,
        supportedSchemaVersions: [1, 2, 3, 4, 5, 6, 7],
        versions: {
          4: {
            unitFields: [
              "id", "definitionId", "label", "coord", "movement", "durability", "mana", "activeAbility"
            ],
            movementFields: ["targetCoord", "nextCoord", "edgeProgress"],
            durabilityFields: ["hp", "maxHp", "shield", "defeated"],
            manaFields: ["current", "max", "regenerationPerUnit"],
            activeAbilityFields: [
              "id", "label", "target", "manaCost", "cooldown", "cooldownRemaining", "range", "damage", "ready"
            ]
          }
        }
      },
      commands: {
        schemaVersion: 6,
        useHeroAbility: {
          requiredFields: ["heroId", "abilityId", "targetEnemyId"],
          optionalFields: [],
          additionalProperties: false
        }
      },
      events: {
        heroAbilityUsed: {
          requiredFields: [
            "heroId", "heroDefinitionId", "abilityId", "targetEnemyId", "targetEnemyTypeId",
            "previousMana", "currentMana", "manaSpent", "cooldownApplied", "requestedDamage",
            "resolvedDamage", "shieldAbsorbed", "hpDamage"
          ],
          optionalFields: []
        }
      }
    });
    expect(described.heroes).not.toHaveProperty("towerScript");
    expect(TOOLS.map((tool) => tool.name)).not.toContain("analyze_heroes");
  });

  it("runs the inert recipe through guarded preview/apply without enabling adjacent modules", async () => {
    const projectDir = fixture();
    const before = await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {});
    expect(before.capabilities.heroes).toMatchObject({
      available: true, active: false, reason: "module_missing"
    });
    const materialized = await callTool("get_recipe", {
      projectDir, collection: "mechanics", recipeId: "basic_targeted_hero_ability"
    }, {});
    expect(materialized.recipe).toMatchObject({
      id: "basic_targeted_hero_ability",
      moduleId: "heroes",
      moduleSchemaVersion: 4,
      entity: {
        moduleId: "heroes",
        moduleSchemaVersion: 4,
        missionId: "tutorial_01",
        profileId: "basic_targeted_hero_ability",
        profile: {
          definitions: {
            commander: {
              mana: { max: 100, starting: 60, regenerationPerUnit: 5 },
              activeAbility: {
                id: "arc_bolt", label: "Arc Bolt", target: "enemy",
                manaCost: 20, cooldown: 3, range: 6, damage: 30
              }
            }
          }
        }
      }
    });
    expect(materialized.recipe.entity).not.toHaveProperty("enabled");

    const request = { projectDir, ...materialized.recipe.entity, enabled: true };
    const preview = await callTool("preview_mechanics_module", request, {});
    expect(preview).toMatchObject({
      ok: true, dryRun: true, revision: materialized.revision,
      validation: { ok: true, issues: [] },
      candidate: { mechanics: { modules: { heroes: { schemaVersion: 4, enabled: true } } } }
    });
    for (const adjacent of ["navigation", "combat", "logistics"]) {
      expect(preview.candidate.mechanics.modules[adjacent]).toBeUndefined();
    }
    const applied = await callTool("apply_mechanics_module", {
      ...request, ifRevision: preview.revision
    }, {});
    expect(applied).toMatchObject({ ok: true, previousRevision: preview.revision });
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true });
    expect(await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {}))
      .toMatchObject({
        capabilities: {
          heroes: {
            available: true,
            active: true,
            moduleSchemaVersion: 4,
            profileId: "basic_targeted_hero_ability"
          }
        }
      });
    const stale = await rejection(callTool("apply_mechanics_module", {
      ...request, ifRevision: preview.revision
    }, {}));
    expect(stale).toMatchObject({ code: "conflict" });
  });

  it("teaches the exact guarded v4 flow and authoritative runtime surfaces", () => {
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/Heroes v4[\s\S]*mana[\s\S]*activeAbility/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/basic_targeted_hero_ability[\s\S]*(?:never|does not)[\s\S]*(?:enable|select)/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/GameCommand v5[\s\S]*useHeroAbility[\s\S]*targetEnemyId/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/heroAbilityUsed/);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/snapshot[\s\S]*never (?:mutate|write)/i);
  });

  it("keeps the public Codex authoring skill aligned with the v4 AI contract", () => {
    const skill = fs.readFileSync(PLUGIN_SKILL, "utf8");
    expect(skill).toMatch(/Heroes v4[\s\S]*mana[\s\S]*activeAbility/i);
    expect(skill).toMatch(/basic_targeted_hero_ability[\s\S]*preview_mechanics_module[\s\S]*apply_mechanics_module/i);
    expect(skill).toMatch(/GameCommandV?5[\s\S]*useHeroAbility[\s\S]*targetEnemyId/i);
    expect(skill).toMatch(/heroAbilityUsed/);
    expect(skill).not.toMatch(/Heroes v1[\s\S]{0,900}no movement,[\s\S]{0,200}abilities/i);
  });
});

describe("R5.4A MCP/AI battle-local hero skill-tree authoring", () => {
  it("describes exact v5 authoring, snapshot v5, GameCommand v6, and skill events", async () => {
    const described = await callTool("describe_schema", { domain: "heroes" }, {});
    expect(described.heroes).toMatchObject({
      authoring: {
        schemaVersion: 7,
        supportedModuleSchemaVersions: [1, 2, 3, 4, 5, 6, 7],
        versions: {
          5: {
            definition: {
              requiredFields: [
                "label", "spawn", "movement", "durability", "mana", "activeAbility", "skillTree"
              ],
              optionalFields: [],
              additionalProperties: false
            },
            skillTree: {
              nullable: true,
              requiredFields: ["points", "nodes"],
              optionalFields: [],
              additionalProperties: false
            },
            points: {
              requiredFields: ["starting", "perInterwave"],
              optionalFields: [],
              additionalProperties: false
            },
            node: {
              requiredFields: ["label", "description", "cost", "requires", "effects"],
              optionalFields: [],
              additionalProperties: false
            },
            effect: {
              requiredFields: ["kind", "scope", "modifier"],
              optionalFields: [],
              additionalProperties: false,
              kindValues: ["modifier"],
              scopeValues: ["hero_ability_damage"]
            },
            modifier: {
              requiredFields: ["target", "operation", "value"],
              optionalFields: [],
              additionalProperties: false,
              targetValues: ["damage"],
              operationValues: ["flat", "additive_ratio", "multiplier"]
            }
          }
        }
      },
      snapshot: {
        field: "heroes",
        optional: true,
        supportedSchemaVersions: [1, 2, 3, 4, 5, 6, 7],
        versions: {
          5: {
            unitFields: [
              "id", "definitionId", "label", "coord", "movement", "durability", "mana", "activeAbility", "skills"
            ],
            skillsFields: [
              "availablePoints", "startingPoints", "pointsPerInterwave", "maximumEarnablePoints",
              "managementAvailable", "nodes"
            ],
            skillNodeFields: [
              "id", "label", "description", "cost", "requiresSkillIds", "missingRequirementIds",
              "unlocked", "unlockable"
            ]
          }
        }
      },
      commands: {
        schemaVersion: 6,
        unlockHeroSkill: {
          requiredFields: ["heroId", "skillId"],
          optionalFields: [],
          additionalProperties: false
        }
      },
      events: {
        heroSkillPointsGranted: {
          requiredFields: [
            "type", "heroId", "heroDefinitionId", "waveIndex", "previousPoints", "currentPoints", "amount"
          ],
          optionalFields: []
        },
        heroSkillUnlocked: {
          requiredFields: [
            "type", "heroId", "heroDefinitionId", "skillId", "cost", "previousPoints", "currentPoints"
          ],
          optionalFields: []
        }
      }
    });
    expect(described.heroes).not.toHaveProperty("towerScript");
    expect(TOOLS.map((tool) => tool.name)).not.toContain("analyze_heroes");
  });

  it("runs the inert v5 recipe through preview, guarded apply, validation, and stale rejection", async () => {
    const projectDir = fixture();
    const before = await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {});
    expect(before.capabilities.heroes).toMatchObject({ active: false, reason: "module_missing" });

    const materialized = await callTool("get_recipe", {
      projectDir,
      collection: "mechanics",
      recipeId: "basic_hero_skill_tree"
    }, {});
    expect(materialized.recipe).toMatchObject({
      id: "basic_hero_skill_tree",
      moduleId: "heroes",
      moduleSchemaVersion: 5,
      entity: {
        moduleId: "heroes",
        moduleSchemaVersion: 5,
        missionId: "tutorial_01",
        profileId: "basic_hero_skill_tree",
        profile: {
          definitions: {
            commander: {
              skillTree: {
                points: { starting: expect.any(Number), perInterwave: expect.any(Number) },
                nodes: expect.any(Object)
              }
            }
          }
        }
      }
    });
    expect(materialized.recipe.entity).not.toHaveProperty("enabled");

    const request = { projectDir, ...materialized.recipe.entity, enabled: true };
    const preview = await callTool("preview_mechanics_module", request, {});
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      revision: materialized.revision,
      validation: { ok: true, issues: [] },
      candidate: { mechanics: { modules: { heroes: { schemaVersion: 5, enabled: true } } } }
    });
    for (const adjacent of ["navigation", "combat", "roguelite", "logistics"]) {
      expect(preview.candidate.mechanics.modules[adjacent]).toBeUndefined();
    }
    const applied = await callTool("apply_mechanics_module", {
      ...request,
      ifRevision: preview.revision
    }, {});
    expect(applied).toMatchObject({ ok: true, previousRevision: preview.revision });
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true });
    expect(await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {}))
      .toMatchObject({
        capabilities: {
          heroes: { active: true, moduleSchemaVersion: 5, profileId: "basic_hero_skill_tree" }
        }
      });

    const stale = await rejection(callTool("apply_mechanics_module", {
      ...request,
      ifRevision: preview.revision
    }, {}));
    expect(stale).toMatchObject({ code: "conflict" });
  });

  it("keeps the guarded tree flow in guide v28 with the authoritative v6 command contract", () => {
    expect(TOWERFORGE_AGENT_GUIDE_VERSION).toBe(28);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/Heroes v5[\s\S]*skillTree[\s\S]*basic_hero_skill_tree/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /get_capabilities[\s\S]*get_recipe[\s\S]*preview_mechanics_module[\s\S]*apply_mechanics_module[\s\S]*ifRevision/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/GameCommand v6[\s\S]*unlockHeroSkill[\s\S]*heroId[\s\S]*skillId/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/heroSkillPointsGranted[\s\S]*heroSkillUnlocked/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/between[- ]wave|interwave/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/snapshot[\s\S]*never (?:mutate|write)/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/battle[- ]local|resets? between campaign battles/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).not.toMatch(/skillTree[\s\S]{0,400}(?:aura|blocking|logistics|TowerScript)/i);
  });

  it("keeps the public Codex authoring skill aligned with the complete v5 AI contract", () => {
    const skill = fs.readFileSync(PLUGIN_SKILL, "utf8");
    expect(skill).toMatch(/Heroes v5[\s\S]*skillTree/i);
    expect(skill).toMatch(/(?:required nullable[\s\S]{0,80}skillTree|skillTree[\s\S]{0,80}required nullable)/i);
    expect(skill).toMatch(
      /basic_hero_skill_tree[\s\S]*preview_mechanics_module[\s\S]*apply_mechanics_module[\s\S]*ifRevision/i
    );
    expect(skill).toMatch(/GameCommandV?6[\s\S]*unlockHeroSkill[\s\S]*heroId[\s\S]*skillId/i);
    expect(skill).toMatch(/snapshot[\s\S]*(?:available skill points|unlockability)/i);
    expect(skill).toMatch(/heroSkillPointsGranted[\s\S]*heroSkillUnlocked/i);
    expect(skill).toMatch(/battle[- ]local[\s\S]*(?:reset|no carry|does not carry|campaign)/i);
    expect(skill).not.toMatch(/no (?:multiple abilities, )?skill trees/i);
  });
});

describe("R5.5A MCP/AI passive hero damage-aura authoring", () => {
  it("describes exact heroes v6 authoring and authoritative snapshot without adding runtime actions", async () => {
    const described = await callTool("describe_schema", { domain: "heroes" }, {});
    expect(described.heroes).toMatchObject({
      authoring: {
        schemaVersion: 7,
        supportedModuleSchemaVersions: [1, 2, 3, 4, 5, 6, 7],
        versions: {
          6: {
            definition: {
              requiredFields: [
                "label", "spawn", "movement", "durability", "mana", "activeAbility",
                "skillTree", "passiveAura"
              ],
              optionalFields: [],
              additionalProperties: false
            },
            passiveAura: {
              nullable: true,
              requiredFields: ["id", "label", "radius", "effects"],
              optionalFields: [],
              additionalProperties: false
            },
            passiveAuraEffect: {
              requiredFields: ["kind", "scope", "modifier"],
              optionalFields: [],
              additionalProperties: false,
              kindValues: ["modifier"],
              scopeValues: ["tower_damage"]
            },
            passiveAuraModifier: {
              requiredFields: ["target", "operation", "value"],
              optionalFields: [],
              additionalProperties: false,
              targetValues: ["damage"],
              operationValues: ["flat", "additive_ratio", "multiplier"]
            }
          }
        }
      },
      snapshot: {
        field: "heroes",
        optional: true,
        supportedSchemaVersions: [1, 2, 3, 4, 5, 6, 7],
        versions: {
          6: {
            unitFields: [
              "id", "definitionId", "label", "coord", "movement", "durability", "mana",
              "activeAbility", "skills", "passiveAura"
            ],
            skillsNullable: true,
            passiveAuraFields: ["id", "label", "radius", "active", "affectedTowerIds"]
          }
        }
      },
      commands: { schemaVersion: 6 }
    });
    expect(described.heroes.commands).not.toHaveProperty("toggleHeroAura");
    expect(described.heroes.events).not.toHaveProperty("heroAuraChanged");
    expect(described.heroes).not.toHaveProperty("towerScript");
    expect(TOOLS.map((tool) => tool.name)).not.toContain("analyze_heroes");
  });

  it("runs the inert v6 recipe through preview, guarded apply, validation, and stale rejection", async () => {
    const projectDir = fixture();
    const materialized = await callTool("get_recipe", {
      projectDir,
      collection: "mechanics",
      recipeId: "basic_passive_hero_aura"
    }, {});
    expect(materialized.recipe).toMatchObject({
      id: "basic_passive_hero_aura",
      moduleId: "heroes",
      moduleSchemaVersion: 6,
      entity: {
        moduleId: "heroes",
        moduleSchemaVersion: 6,
        missionId: "tutorial_01",
        profileId: "basic_passive_hero_aura",
        profile: {
          definitions: {
            commander: {
              skillTree: null,
              passiveAura: {
                radius: expect.any(Number),
                effects: [{
                  kind: "modifier",
                  scope: "tower_damage",
                  modifier: { target: "damage" }
                }]
              }
            }
          }
        }
      }
    });
    expect(materialized.recipe.entity).not.toHaveProperty("enabled");

    const request = { projectDir, ...materialized.recipe.entity, enabled: true };
    const preview = await callTool("preview_mechanics_module", request, {});
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      revision: materialized.revision,
      validation: { ok: true, issues: [] },
      candidate: { mechanics: { modules: { heroes: { schemaVersion: 6, enabled: true } } } }
    });
    for (const adjacent of ["navigation", "elevation", "combat", "roguelite", "logistics"]) {
      expect(preview.candidate.mechanics.modules[adjacent]).toBeUndefined();
    }
    const applied = await callTool("apply_mechanics_module", {
      ...request,
      ifRevision: preview.revision
    }, {});
    expect(applied).toMatchObject({ ok: true, previousRevision: preview.revision });
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true });

    const stale = await rejection(callTool("apply_mechanics_module", {
      ...request,
      ifRevision: preview.revision
    }, {}));
    expect(stale).toMatchObject({ code: "conflict" });
  }, 30_000);

  it("uses the shared guarded transaction to promote every existing v5 profile atomically", async () => {
    const projectDir = fixture();
    const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
    const balancePath = path.join(projectDir, "content", "balance.json");
    const movementProfiles = {
      ground: {
        label: "Ground", terrainMode: "respect_walkable",
        towerOccupancy: "blocked", defaultTerrainCost: 1000
      }
    };
    const definition = (label) => ({
      label, spawn: "core",
      movement: { movementProfileId: "ground", speed: 1 },
      durability: { maxHp: 100, shield: null },
      mana: { max: 100, starting: 60, regenerationPerUnit: 5 },
      activeAbility: {
        id: "arc_bolt", label: "Arc Bolt", target: "enemy",
        manaCost: 20, cooldown: 3, range: 6, damage: 30
      },
      skillTree: null
    });
    const alpha = {
      selectedHeroId: "commander",
      definitions: { commander: definition("Alpha") },
      movementProfiles
    };
    const beta = {
      selectedHeroId: "warden",
      definitions: { warden: definition("Beta") },
      movementProfiles
    };
    fs.writeFileSync(mechanicsPath, `${JSON.stringify({
      schemaVersion: 1,
      modules: { heroes: { schemaVersion: 5, enabled: true, profiles: { alpha, beta } } }
    }, null, 2)}\n`, "utf8");
    const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
    balance.missions.tutorial_01.mechanics = balance.missions.tutorial_01.mechanics ?? {};
    balance.missions.tutorial_01.mechanics.profiles = {
      ...(balance.missions.tutorial_01.mechanics.profiles ?? {}), heroes: "alpha"
    };
    fs.writeFileSync(balancePath, `${JSON.stringify(balance, null, 2)}\n`, "utf8");

    const selected = structuredClone(alpha);
    selected.definitions.commander.passiveAura = {
      id: "command_link", label: "Command Link", radius: 3,
      effects: [{
        kind: "modifier", scope: "tower_damage",
        modifier: { target: "damage", operation: "additive_ratio", value: 0.2 }
      }]
    };
    const request = {
      projectDir, moduleId: "heroes", moduleSchemaVersion: 6,
      missionId: "tutorial_01", enabled: true, profileId: "alpha", profile: selected
    };
    const preview = await callTool("preview_mechanics_module", request, {});
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      candidate: {
        mechanics: {
          modules: {
            heroes: {
              schemaVersion: 6,
              profiles: { beta: { definitions: { warden: { passiveAura: null } } } }
            }
          }
        }
      }
    });
    expect(preview.candidate.mechanics.modules.heroes.profiles.beta).toEqual({
      ...beta,
      definitions: { warden: { ...beta.definitions.warden, passiveAura: null } }
    });

    const applied = await callTool("apply_mechanics_module", {
      ...request,
      ifRevision: preview.revision
    }, {});
    expect(applied).toMatchObject({ ok: true, written: true, previousRevision: preview.revision });
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true });
  }, 30_000);

  it("keeps explicit aura promotion and membership in guide v28", () => {
    expect(TOWERFORGE_AGENT_GUIDE_VERSION).toBe(28);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /Heroes v6[\s\S]*passiveAura[\s\S]*basic_passive_hero_aura/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /v5[\s\S]*(?:promot|upgrade)[\s\S]*every definition[\s\S]*passiveAura\s*:\s*null/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /affectedTowerIds[\s\S]*(?:authoritative|engine)[\s\S]*(?:never|do not)[\s\S]*(?:recompute|derive)/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/no (?:new )?(?:command|event)|adds no (?:gameplay )?command/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/CampaignRun[\s\S]*(?:no carry|does not carry|not persisted)/i);
  });

  it("keeps the public Codex skill aligned with the complete v6 AI contract", () => {
    const skill = fs.readFileSync(PLUGIN_SKILL, "utf8");
    expect(skill).toMatch(/Heroes v6[\s\S]*passiveAura/i);
    expect(skill).toMatch(/passiveAura\s*:\s*null[\s\S]*(?:opt-out|preserve|legacy)/i);
    expect(skill).toMatch(
      /basic_passive_hero_aura[\s\S]*preview_mechanics_module[\s\S]*apply_mechanics_module[\s\S]*ifRevision/i
    );
    expect(skill).toMatch(/affectedTowerIds[\s\S]*(?:authoritative|engine)/i);
    expect(skill).toMatch(/(?:no command|adds no command|does not add a command)/i);
    expect(skill).not.toMatch(/(?:dispatch|send).{0,80}(?:aura|toggle)/i);
  });
});

describe("R5.6A MCP/AI dynamic-navigation hero blocking authoring", () => {
  it("describes exact v7 authoring and authoritative snapshot without a new command or event", async () => {
    const described = await callTool("describe_schema", { domain: "heroes" }, {});
    expect(described.heroes).toMatchObject({
      authoring: {
        schemaVersion: 7,
        supportedModuleSchemaVersions: [1, 2, 3, 4, 5, 6, 7],
        versions: {
          7: {
            definition: {
              requiredFields: [
                "label", "spawn", "movement", "durability", "mana", "activeAbility",
                "skillTree", "passiveAura", "blocking"
              ],
              optionalFields: [],
              additionalProperties: false
            },
            blocking: {
              nullable: true,
              requiredFields: ["blockCapacity", "movementProfileIds"],
              optionalFields: [],
              additionalProperties: false
            }
          }
        }
      },
      snapshot: {
        field: "heroes",
        optional: true,
        supportedSchemaVersions: [1, 2, 3, 4, 5, 6, 7],
        versions: {
          7: {
            unitFields: [
              "id", "definitionId", "label", "coord", "movement", "durability", "mana",
              "activeAbility", "skills", "passiveAura", "blocking"
            ],
            skillsNullable: true,
            passiveAuraNullable: true,
            blockingFields: ["blockCapacity", "active", "blockedEnemyIds"]
          }
        }
      },
      commands: { schemaVersion: 6 }
    });
    expect(described.heroes.authoring.versions[7]).toMatchObject({
      limits: {
        blockCapacity: { minimum: 1, maximum: 64 },
        movementProfileIds: 32
      }
    });
    expect(described.heroes.commands).not.toHaveProperty("assignHeroBlock");
    expect(described.heroes.events).not.toHaveProperty("heroBlockingChanged");
    expect(TOOLS.map((tool) => tool.name)).not.toContain("analyze_heroes");
  });

  it("keeps the recipe inert, rejects missing navigation, then completes the guarded AI flow", async () => {
    const projectDir = fixture();
    expect((await callTool("get_capabilities", {
      projectDir, missionId: "tutorial_01"
    }, {})).capabilities.heroes).toMatchObject({ active: false, reason: "module_missing" });

    const materialized = await callTool("get_recipe", {
      projectDir,
      collection: "mechanics",
      recipeId: "basic_dynamic_hero_blocking"
    }, {});
    expect(materialized.recipe).toMatchObject({
      id: "basic_dynamic_hero_blocking",
      moduleId: "heroes",
      moduleSchemaVersion: 7,
      entity: {
        moduleId: "heroes",
        moduleSchemaVersion: 7,
        missionId: "tutorial_01",
        profileId: "basic_dynamic_hero_blocking",
        profile: {
          definitions: {
            commander: {
              skillTree: null,
              passiveAura: null,
              blocking: { blockCapacity: 2, movementProfileIds: ["ground"] }
            }
          }
        }
      }
    });
    expect(materialized.recipe.entity).not.toHaveProperty("enabled");
    expect(materialized.recipe.entity).not.toHaveProperty("navigation");

    const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
    const beforeMissingNavigation = fs.existsSync(mechanicsPath)
      ? fs.readFileSync(mechanicsPath, "utf8")
      : null;
    const heroRequest = { projectDir, ...materialized.recipe.entity, enabled: true };
    const rejected = await callTool("preview_mechanics_module", heroRequest, {});
    expect(rejected.ok).toBe(false);
    expect(rejected.validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "error",
        fieldPath: expect.stringMatching(/heroes|blocking|navigation/i),
        message: expect.stringMatching(/dynamic.flow|navigation/i)
      })
    ]));
    expect(fs.existsSync(mechanicsPath) ? fs.readFileSync(mechanicsPath, "utf8") : null)
      .toBe(beforeMissingNavigation);

    const navigationRecipe = await callTool("get_recipe", {
      projectDir,
      collection: "mechanics",
      recipeId: "basic_dynamic_navigation"
    }, {});
    const navigationEntity = structuredClone(navigationRecipe.recipe.entity);
    navigationEntity.profile.enemyMovementProfiles = {
      basic_grunt: "ground", armored_brute: "ground", swift_runner: "ground"
    };
    const navigationPreview = await callTool("preview_mechanics_module", {
      projectDir, ...navigationEntity, enabled: true
    }, {});
    expect(navigationPreview).toMatchObject({ ok: true, validation: { ok: true } });
    await callTool("apply_mechanics_module", {
      projectDir, ...navigationEntity, enabled: true, ifRevision: navigationPreview.revision
    }, {});
    const navigationBeforeHeroes = structuredClone(
      JSON.parse(fs.readFileSync(mechanicsPath, "utf8")).modules.navigation
    );

    const preview = await callTool("preview_mechanics_module", heroRequest, {});
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      validation: { ok: true, issues: [] },
      candidate: {
        mechanics: {
          modules: {
            heroes: { schemaVersion: 7, enabled: true },
            navigation: navigationBeforeHeroes
          }
        }
      }
    });
    expect(preview.candidate.mechanics.modules.navigation).toEqual(navigationBeforeHeroes);
    const applied = await callTool("apply_mechanics_module", {
      ...heroRequest,
      ifRevision: preview.revision
    }, {});
    expect(applied).toMatchObject({ ok: true, previousRevision: preview.revision });
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true });
    expect((await callTool("get_capabilities", {
      projectDir, missionId: "tutorial_01"
    }, {})).capabilities).toMatchObject({
      heroes: {
        active: true, moduleSchemaVersion: 7, profileId: "basic_dynamic_hero_blocking"
      },
      navigation: { active: true, moduleSchemaVersion: 1 }
    });
    expect(await rejection(callTool("apply_mechanics_module", {
      ...heroRequest,
      ifRevision: preview.revision
    }, {}))).toMatchObject({ code: "conflict" });
  }, 30_000);

  it("publishes guide v28 with explicit dependency, promotion, and snapshot-only presentation", () => {
    expect(TOWERFORGE_AGENT_GUIDE_VERSION).toBe(28);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /Heroes v7[\s\S]*blocking[\s\S]*basic_dynamic_hero_blocking/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /v6[\s\S]*(?:promot|upgrade)[\s\S]*every definition[\s\S]*blocking\s*:\s*null/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /dynamic_flow[\s\S]*(?:required|requires)[\s\S]*(?:never|does not)[\s\S]*(?:enable|select)/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /blockedEnemyIds[\s\S]*(?:authoritative|engine)[\s\S]*(?:never|do not)[\s\S]*(?:recompute|derive)/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/no (?:new )?(?:command|input|event)|adds no (?:gameplay )?command/i);

    const skill = fs.readFileSync(PLUGIN_SKILL, "utf8");
    expect(skill).toMatch(/Heroes v7[\s\S]*blocking/i);
    expect(skill).toMatch(/blocking\s*:\s*null[\s\S]*(?:opt-out|preserve|legacy)/i);
    expect(skill).toMatch(
      /basic_dynamic_hero_blocking[\s\S]*preview_mechanics_module[\s\S]*apply_mechanics_module[\s\S]*ifRevision/i
    );
    expect(skill).toMatch(/dynamic_flow[\s\S]*(?:required|requires)/i);
    expect(skill).toMatch(/blockedEnemyIds[\s\S]*(?:authoritative|engine)/i);
  });
});

async function applyHeroesProfile(projectDir, profileId, profile) {
  const request = {
    projectDir,
    moduleId: "heroes",
    moduleSchemaVersion: 1,
    missionId: "tutorial_01",
    enabled: true,
    profileId,
    profile
  };
  const preview = await callTool("preview_mechanics_module", request, {});
  expect(preview).toMatchObject({ ok: true, dryRun: true });
  const applied = await callTool("apply_mechanics_module", {
    ...request,
    ifRevision: preview.revision
  }, {});
  expect(applied).toMatchObject({ ok: true });
  return applied;
}
