import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadEngine, readRawProjectFiles } from "../cli/lib/project-loader.mjs";
import { migrateProjectFiles, writeMigratedProjectFiles } from "../cli/lib/project-migrations.mjs";
import { TOOLS, callTool } from "./tools.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const R0A_MODULE_IDS = [
  "combat",
  "reactions",
  "navigation",
  "elevation",
  "physics",
  "ballistics",
  "weather",
  "terraforming",
  "roguelite",
  "arsenal",
  "macroEconomy",
  "heroes",
  "logistics",
  "director",
  "quests",
  "enemyBehaviors",
  "scriptingDx",
  "multiplayer"
];
const IMPLEMENTED_MODULE_IDS = [
  "combat", "reactions", "navigation", "elevation", "physics", "ballistics", "weather", "terraforming", "roguelite", "arsenal", "macroEconomy", "heroes",
  "logistics", "director", "quests", "enemyBehaviors", "multiplayer"
];
const UNAVAILABLE_MODULE_IDS = R0A_MODULE_IDS.filter(
  (moduleId) => !IMPLEMENTED_MODULE_IDS.includes(moduleId)
);

function copyStarter({ migrateToV2 = false } = {}) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-mcp-mechanics-"));
  fs.cpSync(STARTER, projectDir, { recursive: true });
  if (migrateToV2) {
    const migrated = migrateProjectFiles(readRawProjectFiles(projectDir));
    writeMigratedProjectFiles(projectDir, migrated.files);
    expect(JSON.parse(fs.readFileSync(path.join(projectDir, "project.json"), "utf8")).schemaVersion).toBe(2);
  }
  return projectDir;
}

function snapshotTree(rootDir) {
  const entries = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolutePath = path.join(dir, entry.name);
      const relativePath = path.relative(rootDir, absolutePath);
      if (entry.isDirectory()) {
        entries.push({ path: `${relativePath}/`, type: "directory" });
        visit(absolutePath);
      } else if (entry.isFile()) {
        entries.push({
          path: relativePath,
          type: "file",
          contents: fs.readFileSync(absolutePath).toString("base64")
        });
      } else {
        entries.push({ path: relativePath, type: "other" });
      }
    }
  };
  visit(rootDir);
  return entries;
}

function addNamedCombatTargets(projectDir, ids) {
  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
  const enemyTemplate = balance.enemies.basic_grunt;
  const towerTemplate = Object.values(balance.towers)[0];
  for (const id of ids) {
    Object.defineProperty(balance.enemies, id, {
      value: { ...enemyTemplate, id, label: `Enemy ${id}` },
      enumerable: true,
      configurable: true,
      writable: true
    });
    Object.defineProperty(balance.towers, id, {
      value: { ...towerTemplate, id, label: `Tower ${id}`, maxHp: 20 },
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
  fs.writeFileSync(balancePath, `${JSON.stringify(balance, null, 2)}\n`, "utf8");
}

function shieldDefinitions(ids) {
  return Object.fromEntries(ids.map((id) => [id, { capacity: 10 }]));
}

async function captureRejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected mechanics operation to reject.");
}

describe("R1 combat mechanics MCP contract", () => {
  it("describes v1 shields, v2 armor, and v3 marks with versioned snapshots and TowerScript", async () => {
    const engine = await loadEngine();
    const mechanics = await callTool("describe_schema", { domain: "mechanics" }, {});
    const combat = await callTool("describe_schema", { domain: "combat" }, {});
    expect(engine.COMBAT_MECHANICS_SCHEMA).toEqual(engine.COMBAT_SHIELD_SCHEMA);
    const combatSurface = {
      authoring: engine.COMBAT_MECHANICS_SCHEMA,
      snapshot: { field: "combat", optional: true, supportedSchemaVersions: [1, 2] },
      events: ["enemyShieldChanged", "towerShieldChanged", "enemyMarkChanged"]
    };
    const reactionsSurface = {
      authoring: engine.REACTIONS_MECHANICS_SCHEMA,
      snapshot: { field: "reactions", optional: true, supportedSchemaVersions: [1] },
      events: ["enemyExposureChanged", "enemyReactionTriggered", "reactionBudgetExceeded"]
    };
    const navigationSurface = {
      authoring: engine.NAVIGATION_MECHANICS_SCHEMA,
      analysis: {
        tool: "analyze_navigation",
        readOnly: true,
        schema: engine.NAVIGATION_ANALYSIS_SCHEMA,
        modes: ["dynamic_flow"]
      },
      snapshot: {
        field: "navigation",
        optional: true,
        supportedSchemaVersions: [1],
        modes: ["dynamic_flow"]
      },
      events: []
    };
    const elevationSurface = {
      ...engine.ELEVATION_MECHANICS_SCHEMA,
      authoring: engine.ELEVATION_MECHANICS_SCHEMA,
      analysis: {
        tool: "analyze_line_of_sight",
        readOnly: true,
        modes: ["active", "candidate"]
      },
      snapshot: { field: "elevation", optional: true, supportedSchemaVersions: [1] },
      events: []
    };
    const physicsSurface = {
      authoring: engine.PHYSICS_MECHANICS_SCHEMA,
      snapshot: { field: null, optional: true, supportedSchemaVersions: [] },
      events: ["enemyDisplacementResolved", "enemyFell"]
    };
    const terraformingSurface = {
      authoring: engine.TERRAFORMING_MECHANICS_SCHEMA,
      snapshot: { field: "terraforming", optional: true, supportedSchemaVersions: [1] },
      events: ["terrainChanged", "elevationChanged"]
    };
    const campaignInputSchema = TOOLS.find((tool) => tool.name === "preview_campaign")
      ?.inputSchema?.properties?.campaign;
    expect(campaignInputSchema).toBeTruthy();
    const rogueliteSurface = {
      authoring: engine.ROGUELITE_MECHANICS_SCHEMA,
      campaign: {
        supportedSchemaVersions: engine.WORLD_CAMPAIGN_SCHEMA.supportedSchemaVersions,
        versions: engine.WORLD_CAMPAIGN_SCHEMA.versions,
        nodeTypes: engine.WORLD_CAMPAIGN_SCHEMA.nodeTypes,
        limits: engine.WORLD_CAMPAIGN_SCHEMA.limits,
        graph: engine.WORLD_CAMPAIGN_SCHEMA,
        inputSchema: campaignInputSchema,
        handoff: {
          markerSchemaVersion: 2,
          campaignRunSchemaVersion: 2,
          prepare: "prepareCampaignBattle",
          settle: "settleCampaignBattleVictory",
          carries: ["deck", "artifacts"],
          socketPolicy: "cleared_between_battles",
          persistence: "explicit_import_export_only"
        }
      },
      snapshot: { field: "roguelite", optional: true, supportedSchemaVersions: [1, 2, 3, 4] },
      events: ["artifactDropped", "artifactSocketed", "artifactUnsocketed"],
      commands: {
        schemaVersion: 3,
        phase: "between",
        socketArtifact: {
          requiredFields: ["artifactInstanceId", "towerId", "slotId"],
          optionalFields: [],
          additionalProperties: false
        },
        unsocketArtifact: {
          requiredFields: ["artifactInstanceId", "towerId", "slotId"],
          optionalFields: [],
          additionalProperties: false
        },
        chooseDraftOption: {
          requiredFields: ["offerId", "cardId"],
          optionalFields: [],
          additionalProperties: false
        }
      }
    };
    const heroesAuthoringV5 = engine.HEROES_MECHANICS_SCHEMA.versions[5];
    const heroesSnapshotV5 = engine.HEROES_MECHANICS_SCHEMA.runtimeSnapshot.versions[5];
    const heroesSurface = {
      authoring: {
        ...engine.HEROES_MECHANICS_SCHEMA,
        versions: {
          ...engine.HEROES_MECHANICS_SCHEMA.versions,
          5: {
            ...heroesAuthoringV5,
            points: heroesAuthoringV5.skillPoints,
            node: heroesAuthoringV5.skillNode,
            effect: heroesAuthoringV5.skillEffect,
            modifier: heroesAuthoringV5.skillModifier
          }
        }
      },
      snapshot: {
        field: "heroes",
        optional: true,
        supportedSchemaVersions: [1, 2, 3, 4, 5, 6, 7],
        versions: {
          ...engine.HEROES_MECHANICS_SCHEMA.runtimeSnapshot.versions,
          5: {
            ...heroesSnapshotV5,
            skillNodeFields: [
              "id", "label", "description", "cost", "requiresSkillIds", "missingRequirementIds",
              "unlocked", "unlockable"
            ]
          }
        }
      },
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
        },
        heroAbilityUsed: {
          requiredFields: [
            "heroId", "heroDefinitionId", "abilityId", "targetEnemyId", "targetEnemyTypeId",
            "previousMana", "currentMana", "manaSpent", "cooldownApplied", "requestedDamage",
            "resolvedDamage", "shieldAbsorbed", "hpDamage"
          ],
          optionalFields: []
        },
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
      },
      commands: {
        schemaVersion: 6,
        moveHero: {
          requiredFields: ["heroId", "target"],
          optionalFields: [],
          additionalProperties: false
        },
        useHeroAbility: {
          requiredFields: ["heroId", "abilityId", "targetEnemyId"],
          optionalFields: [],
          additionalProperties: false
        },
        unlockHeroSkill: {
          requiredFields: ["heroId", "skillId"],
          optionalFields: [],
          additionalProperties: false
        }
      }
    };
    expect(engine.COMBAT_MECHANICS_SCHEMA).toMatchObject({
      schemaVersion: 3,
      supportedModuleSchemaVersions: [1, 2, 3],
      profile: {
        optionalFields: ["shields", "damageTypes", "armorTypes", "armorAssignments", "marks"]
      },
      damageTypes: expect.any(Object),
      armorTypes: expect.any(Object),
      armorAssignments: expect.any(Object),
      armorMatrix: { limits: engine.ARMOR_MATRIX_LIMITS },
      marks: { limits: engine.MARK_LIMITS }
    });

    expect(mechanics.requestedDomain).toBe("mechanics");
    expect(mechanics.availableDomains).toContain("mechanics");
    expect(mechanics.availableDomains).toContain("reactions");
    expect(mechanics.availableDomains).toContain("navigation");
    expect(mechanics.mechanics).toMatchObject({
      schemaVersion: 1,
      moduleIds: [...engine.MECHANICS_MODULE_IDS],
      implementedModuleIds: IMPLEMENTED_MODULE_IDS,
      modules: {
        combat: combatSurface,
        reactions: reactionsSurface,
        navigation: navigationSurface,
        elevation: elevationSurface,
        physics: physicsSurface,
        terraforming: terraformingSurface,
        roguelite: rogueliteSurface,
        heroes: heroesSurface
      }
    });
    const logisticsSurface = mechanics.mechanics.modules.logistics;
    expect(logisticsSurface.authoring).toMatchObject({
      schemaVersion: 3,
      moduleId: "logistics",
      supportedModuleSchemaVersions: [1, 2, 3],
      profile: {
        requiredFields: ["power", "ammunition", "supply"],
        optionalFields: [],
        additionalProperties: false
      },
      profileVersions: {
        1: { requiredFields: ["power"], optionalFields: [], additionalProperties: false },
        2: {
          requiredFields: ["power", "ammunition"],
          optionalFields: [],
          additionalProperties: false
        },
        3: {
          requiredFields: ["power", "ammunition", "supply"],
          optionalFields: [],
          additionalProperties: false
        }
      },
      power: engine.LOGISTICS_MECHANICS_SCHEMA.power,
      ammunition: engine.LOGISTICS_MECHANICS_SCHEMA.ammunition,
      supply: engine.LOGISTICS_MECHANICS_SCHEMA.supply,
      runtimeSnapshot: {
        schemaVersion: 3,
        fields: ["schemaVersion", "power", "ammunition", "supply"],
        powerFields: ["components", "nodes", "consumers"],
        ammunitionFields: ["inventories"],
        supplyFields: ["producers", "storages", "edges"]
      },
      versions: {
        1: {
          requiredFields: ["power"],
          optionalFields: [],
          additionalProperties: false,
          power: engine.LOGISTICS_MECHANICS_SCHEMA.power
        },
        2: {
          requiredFields: ["power", "ammunition"],
          optionalFields: [],
          additionalProperties: false,
          power: engine.LOGISTICS_MECHANICS_SCHEMA.power,
          ammunition: engine.LOGISTICS_MECHANICS_SCHEMA.ammunition
        },
        3: {
          requiredFields: ["power", "ammunition", "supply"],
          optionalFields: [],
          additionalProperties: false,
          power: engine.LOGISTICS_MECHANICS_SCHEMA.power,
          ammunition: engine.LOGISTICS_MECHANICS_SCHEMA.ammunition,
          supply: engine.LOGISTICS_MECHANICS_SCHEMA.supply
        }
      }
    });
    expect(logisticsSurface.authoring.limits).toMatchObject({
      power: engine.LOGISTICS_MECHANICS_SCHEMA.limits.power,
      ammunition: engine.LOGISTICS_MECHANICS_SCHEMA.limits.ammunition,
      definitionsPerRole: engine.LOGISTICS_MECHANICS_SCHEMA.limits.power.entriesPerRole,
      definitionsAcrossRoles: engine.LOGISTICS_MECHANICS_SCHEMA.limits.power.entriesTotal,
      ammunitionTypes: engine.LOGISTICS_MECHANICS_SCHEMA.limits.ammunition.types,
      authoredTowerInventories: engine.LOGISTICS_MECHANICS_SCHEMA.limits.ammunition.towerInventories,
      liveAmmunitionInventories: engine.LOGISTICS_MECHANICS_SCHEMA.limits.ammunition.liveInventories,
      supply: engine.LOGISTICS_MECHANICS_SCHEMA.limits.supply
    });
    expect(logisticsSurface).toMatchObject({
      checkpoint: {
        field: "state.logistics",
        optional: true,
        schemaVersion: 2
      },
      snapshot: { field: "logistics", optional: true, supportedSchemaVersions: [1, 2, 3] },
      commands: [],
      events: []
    });
    expect(mechanics.mechanics.moduleIds).toHaveLength(18);
    expect(mechanics.towerScript.actions.restoreEnemyShield.required).toEqual({
      target: "enemy target", amount: "expression >= 0"
    });
    expect(mechanics.towerScript.actions.restoreTowerShield.required).toEqual({
      target: "tower target", amount: "expression >= 0"
    });
    expect(mechanics).not.toHaveProperty("attackKinds");

    expect(combat.combatShields).toEqual(combatSurface);
    expect(combat.combatShields.authoring.limits).toEqual(engine.SHIELD_LIMITS);
    expect(combat.combatShields.authoring.armorMatrix.limits).toEqual(engine.ARMOR_MATRIX_LIMITS);
    expect(combat.combatShields.authoring.marks.limits).toEqual(engine.MARK_LIMITS);
    expect(combat.towerScript.actions.restoreEnemyShield).toBeTruthy();
    expect(combat.towerScript.actions.restoreTowerShield).toBeTruthy();
    expect(combat.towerScript.actions.applyEnemyMark).toBeTruthy();
    expect(combat.towerScript.actions.clearEnemyMark).toBeTruthy();
    expect(combat.towerScript.events).toContain("enemyMarkChanged");
    expect(combat.towerScript.actions).not.toHaveProperty("damageShield");
  });

  it("reads all starter capabilities without authoring mechanics or migrating project.json", async () => {
    const projectDir = copyStarter();
    try {
      const engine = await loadEngine();
      const projectJsonPath = path.join(projectDir, "project.json");
      const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
      const projectJsonBefore = fs.readFileSync(projectJsonPath, "utf8");
      const treeBefore = snapshotTree(projectDir);

      expect(fs.existsSync(mechanicsPath)).toBe(false);
      const result = await callTool("get_capabilities", { projectDir }, {});

      expect(result.missionId).toBe("tutorial_01");
      expect(Object.keys(result.capabilities)).toEqual(R0A_MODULE_IDS);
      expect(Object.values(result.capabilities)).toHaveLength(18);
      expect(result.capabilities.combat).toMatchObject({
        available: true,
        moduleEnabled: false,
        active: false,
        reason: "module_missing"
      });
      expect(result.combat.authoring).toEqual(engine.COMBAT_MECHANICS_SCHEMA);
      expect(result.capabilities.reactions).toMatchObject({
        available: true,
        moduleEnabled: false,
        active: false,
        reason: "module_missing"
      });
      expect(result.reactions).toMatchObject({
        authoring: engine.REACTIONS_MECHANICS_SCHEMA,
        enabled: false,
        profileIds: [],
        profileUses: {}
      });
      expect(result.reactions).not.toHaveProperty("selectedProfileId");
      expect(result.capabilities.navigation).toMatchObject({
        available: true,
        moduleEnabled: false,
        active: false,
        reason: "module_missing"
      });
      expect(result.navigation).toMatchObject({
        authoring: engine.NAVIGATION_MECHANICS_SCHEMA,
        enabled: false,
        profileIds: [],
        profileUses: {}
      });
      expect(result.navigation).not.toHaveProperty("selectedProfileId");
      expect(result.capabilities.elevation).toMatchObject({
        available: true,
        moduleEnabled: false,
        active: false,
        reason: "module_missing"
      });
      expect(result.elevation).toMatchObject({
        authoring: engine.ELEVATION_MECHANICS_SCHEMA,
        enabled: false,
        profileIds: [],
        profileUses: {}
      });
      expect(result.elevation).not.toHaveProperty("selectedProfileId");
      expect(result.capabilities.physics).toMatchObject({
        available: true,
        moduleEnabled: false,
        active: false,
        reason: "module_missing"
      });
      expect(result.physics).toMatchObject({
        authoring: engine.PHYSICS_MECHANICS_SCHEMA,
        enabled: false,
        profileIds: [],
        profileUses: {}
      });
      expect(result.physics).not.toHaveProperty("selectedProfileId");
      expect(result.capabilities.roguelite).toMatchObject({
        available: true,
        moduleEnabled: false,
        active: false,
        reason: "module_missing"
      });
      expect(result.roguelite).toMatchObject({
        authoring: engine.ROGUELITE_MECHANICS_SCHEMA,
        enabled: false,
        profileIds: [],
        profileUses: {},
        towerTagsByTowerId: {}
      });
      expect(result.capabilities.logistics).toMatchObject({
        available: true,
        moduleEnabled: false,
        active: false,
        reason: "module_missing"
      });
      expect(result.logistics).toMatchObject({
        authoring: engine.LOGISTICS_MECHANICS_SCHEMA,
        enabled: false,
        profileIds: [],
        profileUses: {}
      });
      expect(result.logistics).not.toHaveProperty("selectedProfileId");
      expect(UNAVAILABLE_MODULE_IDS.every((moduleId) => (
        result.capabilities[moduleId].available === false
        && result.capabilities[moduleId].active === false
      ))).toBe(true);
      expect(fs.existsSync(mechanicsPath)).toBe(false);
      expect(fs.readFileSync(projectJsonPath, "utf8")).toBe(projectJsonBefore);
      expect(snapshotTree(projectDir)).toEqual(treeBefore);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("classifies mechanics tools with explicit read/write risk", () => {
    expect(TOOLS.find((tool) => tool.name === "get_capabilities")).toMatchObject({
      riskClass: "read_only",
      sideEffect: "none"
    });
    expect(TOOLS.find((tool) => tool.name === "preview_mechanics_module")).toMatchObject({
      riskClass: "read_only",
      sideEffect: "none"
    });
    expect(TOOLS.find((tool) => tool.name === "apply_mechanics_module")).toMatchObject({
      riskClass: "write_local"
    });
    const preview = TOOLS.find((tool) => tool.name === "preview_mechanics_module");
    const apply = TOOLS.find((tool) => tool.name === "apply_mechanics_module");
    expect(preview.inputSchema.properties.enabled).toEqual({ type: "boolean", default: true });
    expect(apply.inputSchema.properties.enabled).toEqual({ type: "boolean", default: true });
    expect(preview.inputSchema.properties.moduleSchemaVersion).toMatchObject({
      type: "integer", enum: [1, 2, 3, 4, 5, 6, 7]
    });
    expect(apply.inputSchema.properties.moduleSchemaVersion).toMatchObject({
      type: "integer", enum: [1, 2, 3, 4, 5, 6, 7]
    });
    expect(apply.inputSchema.required).toContain("ifRevision");
  });

  it.each(
    ["preview_mechanics_module", "apply_mechanics_module"].flatMap((toolName) =>
      UNAVAILABLE_MODULE_IDS.map((moduleId) => [toolName, moduleId])
    )
  )("%s rejects unavailable R0A module %s without writing", async (toolName, moduleId) => {
    const projectDir = copyStarter();
    try {
      const treeBefore = snapshotTree(projectDir);
      const error = await captureRejection(callTool(toolName, {
        projectDir,
        moduleId,
        profileId: "r0a_contract",
        profile: {},
        dryRun: toolName === "preview_mechanics_module"
      }, {}));

      expect.soft(error).toMatchObject({ code: "module_unavailable" });
      expect(snapshotTree(projectDir)).toEqual(treeBefore);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("materializes basic_regenerating_shields with real project IDs and previews it without writes", async () => {
    const projectDir = copyStarter({ migrateToV2: true });
    try {
      const before = snapshotTree(projectDir);
      const listed = await callTool("list_recipes", { collection: "mechanics" }, {});
      expect(listed.recipes.map((recipe) => recipe.id)).toContain("basic_regenerating_shields");

      const materialized = await callTool("get_recipe", {
        projectDir,
        collection: "mechanics",
        recipeId: "basic_regenerating_shields"
      }, {});
      const authoring = materialized.recipe.entity;
      expect(authoring).toMatchObject({
        moduleId: "combat",
        moduleSchemaVersion: 1,
        missionId: "tutorial_01",
        profileId: "basic_regenerating_shields",
        enabled: true,
        profile: { shields: { enemies: expect.any(Object), towers: expect.any(Object) } }
      });
      const balance = JSON.parse(fs.readFileSync(path.join(projectDir, "content", "balance.json"), "utf8"));
      const enemyIds = Object.keys(authoring.profile.shields.enemies);
      const towerIds = Object.keys(authoring.profile.shields.towers);
      expect(enemyIds.length).toBeGreaterThan(0);
      expect(enemyIds.every((id) => Object.hasOwn(balance.enemies, id))).toBe(true);
      expect(towerIds.every((id) => Object.hasOwn(balance.towers, id) && balance.towers[id].maxHp > 0)).toBe(true);

      const preview = await callTool("preview_mechanics_module", { projectDir, ...authoring }, {});
      expect(preview).toMatchObject({
        ok: true,
        dryRun: true,
        migration: { required: true, from: 2, to: 3 },
        validation: { ok: true, issues: [] }
      });
      expect(typeof preview.revision).toBe("string");
      expect(snapshotTree(projectDir)).toEqual(before);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("materializes, previews, applies, validates, and re-reads the same canonical combat v2 armor candidate", async () => {
    const projectDir = copyStarter({ migrateToV2: true });
    try {
      const before = snapshotTree(projectDir);
      const materialized = await callTool("get_recipe", {
        projectDir,
        collection: "mechanics",
        recipeId: "basic_elemental_armor_matrix"
      }, {});
      const request = { projectDir, ...materialized.recipe.entity };
      expect(request).toMatchObject({
        moduleId: "combat",
        moduleSchemaVersion: 2,
        missionId: "tutorial_01",
        profileId: "basic_elemental_armor_matrix",
        profile: {
          damageTypes: expect.any(Object),
          armorTypes: expect.any(Object),
          armorAssignments: { enemies: expect.any(Object) }
        }
      });
      expect(Object.keys(request.profile.armorAssignments.enemies).length).toBeLessThanOrEqual(1);

      const preview = await callTool("preview_mechanics_module", request, {});
      expect(preview).toMatchObject({
        ok: true,
        dryRun: true,
        revision: materialized.revision,
        validation: { ok: true, issues: [] },
        candidate: {
          manifest: { schemaVersion: 3 },
          mechanics: {
            schemaVersion: 1,
            modules: {
              combat: {
                schemaVersion: 2,
                enabled: true,
                profiles: { basic_elemental_armor_matrix: request.profile }
              }
            }
          }
        }
      });
      expect(snapshotTree(projectDir)).toEqual(before);

      const applied = await callTool("apply_mechanics_module", {
        ...request,
        ifRevision: preview.revision
      }, {});
      expect(applied).toMatchObject({ ok: true, previousRevision: preview.revision });
      const persisted = JSON.parse(fs.readFileSync(path.join(projectDir, "content", "mechanics.json"), "utf8"));
      expect(persisted).toEqual(preview.candidate.mechanics);

      const capabilities = await callTool("get_capabilities", {
        projectDir, missionId: "tutorial_01"
      }, {});
      expect(capabilities).toMatchObject({
        combat: {
          enabled: true,
          moduleSchemaVersion: 2,
          selectedProfileId: "basic_elemental_armor_matrix",
          selectedProfile: request.profile
        },
        capabilities: { combat: { active: true, reason: "active" } }
      });
      const validation = await callTool("validate_project", { projectDir }, {});
      expect(validation).toMatchObject({ ok: true, issues: [] });

      const shieldRecipe = await callTool("get_recipe", {
        projectDir,
        collection: "mechanics",
        recipeId: "basic_regenerating_shields"
      }, {});
      expect(shieldRecipe.recipe.entity.moduleSchemaVersion).toBe(2);
      const shieldPreview = await callTool("preview_mechanics_module", {
        projectDir,
        ...shieldRecipe.recipe.entity
      }, {});
      expect(shieldPreview).toMatchObject({
        ok: true,
        validation: { ok: true, issues: [] },
        candidate: {
          mechanics: {
            schemaVersion: 1,
            modules: {
              combat: {
                schemaVersion: 2,
                profiles: {
                  basic_elemental_armor_matrix: request.profile,
                  basic_regenerating_shields: shieldRecipe.recipe.entity.profile
                }
              }
            }
          }
        }
      });
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("materializes, guardedly applies, validates, and re-reads the opt-in combat v3 mark recipe", async () => {
    const projectDir = copyStarter({ migrateToV2: true });
    try {
      const before = snapshotTree(projectDir);
      const materialized = await callTool("get_recipe", {
        projectDir,
        collection: "mechanics",
        recipeId: "basic_vulnerability_marks"
      }, {});
      const request = { projectDir, ...materialized.recipe.entity };
      expect(request).toMatchObject({
        moduleId: "combat",
        moduleSchemaVersion: 3,
        missionId: "tutorial_01",
        profileId: "basic_vulnerability_marks",
        profile: {
          marks: {
            definitions: { exposed: expect.any(Object) },
            bindings: { towers: expect.any(Object) }
          }
        }
      });
      expect(Object.keys(request.profile.marks.bindings.towers)).toHaveLength(1);

      const preview = await callTool("preview_mechanics_module", request, {});
      expect(preview).toMatchObject({
        ok: true,
        dryRun: true,
        revision: materialized.revision,
        validation: { ok: true, issues: [] },
        candidate: {
          manifest: { schemaVersion: 3 },
          mechanics: {
            schemaVersion: 1,
            modules: {
              combat: {
                schemaVersion: 3,
                enabled: true,
                profiles: { basic_vulnerability_marks: request.profile }
              }
            }
          }
        }
      });
      expect(snapshotTree(projectDir)).toEqual(before);

      const applied = await callTool("apply_mechanics_module", {
        ...request,
        ifRevision: preview.revision
      }, {});
      expect(applied).toMatchObject({ ok: true, previousRevision: preview.revision });

      const capabilities = await callTool("get_capabilities", {
        projectDir,
        missionId: "tutorial_01"
      }, {});
      expect(capabilities).toMatchObject({
        combat: {
          enabled: true,
          moduleSchemaVersion: 3,
          selectedProfileId: "basic_vulnerability_marks",
          selectedProfile: request.profile
        },
        capabilities: { combat: { active: true, reason: "active" } }
      });
      expect(await callTool("validate_project", { projectDir }, {}))
        .toMatchObject({ ok: true, issues: [] });
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("reports an explicit capability reason for a future combat module version without writing", async () => {
    const projectDir = copyStarter({ migrateToV2: true });
    try {
      const manifestPath = path.join(projectDir, "project.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      manifest.schemaVersion = 3;
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

      const balancePath = path.join(projectDir, "content", "balance.json");
      const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
      balance.missions.tutorial_01.mechanics = { profiles: { combat: "future" } };
      fs.writeFileSync(balancePath, `${JSON.stringify(balance, null, 2)}\n`, "utf8");
      fs.writeFileSync(path.join(projectDir, "content", "mechanics.json"), `${JSON.stringify({
        schemaVersion: 1,
        modules: { combat: { schemaVersion: 4, enabled: true, profiles: { future: {} } } }
      }, null, 2)}\n`, "utf8");
      const before = snapshotTree(projectDir);

      const capabilities = await callTool("get_capabilities", {
        projectDir, missionId: "tutorial_01"
      }, {});
      expect(capabilities.capabilities.combat).toMatchObject({
        available: true,
        moduleEnabled: true,
        active: false,
        profileId: "future",
        reason: "module_version_unsupported"
      });
      expect(capabilities.combat.moduleSchemaVersion).toBe(4);
      expect(snapshotTree(projectDir)).toEqual(before);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("returns the composite mechanics revision and mechanics-specific guarded next actions for a mechanics recipe", async () => {
    const projectDir = copyStarter({ migrateToV2: true });
    try {
      const capabilities = await callTool("get_capabilities", {
        projectDir,
        missionId: "tutorial_01"
      }, {});
      const materialized = await callTool("get_recipe", {
        projectDir,
        collection: "mechanics",
        recipeId: "basic_regenerating_shields"
      }, {});

      expect(materialized.revision).toBe(capabilities.revision);
      expect(materialized.nextValidActions.join(" ")).toMatch(/preview_mechanics_module/);
      expect(materialized.nextValidActions.join(" ")).toMatch(/apply_mechanics_module/);
      expect(materialized.nextValidActions.join(" ")).toMatch(/ifRevision/);
      expect(materialized.nextValidActions.join(" ")).not.toMatch(/upsert_entity/);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("preserves legal nested entity IDs that resemble private transaction metadata", async () => {
    const projectDir = copyStarter({ migrateToV2: true });
    const ids = ["backup", "projectDir", "backupPath"];
    try {
      addNamedCombatTargets(projectDir, ids);
      const preview = await callTool("preview_mechanics_module", {
        projectDir,
        moduleId: "combat",
        missionId: "tutorial_01",
        profileId: "metadata_named_entities",
        profile: {
          shields: {
            enemies: shieldDefinitions(ids),
            towers: shieldDefinitions(ids)
          }
        }
      }, {});

      const profile = preview.candidate.mechanics.modules.combat.profiles.metadata_named_entities;
      for (const id of ids) {
        expect(Object.hasOwn(preview.candidate.balance.enemies, id), `candidate enemy ${id}`).toBe(true);
        expect(Object.hasOwn(preview.candidate.balance.towers, id), `candidate tower ${id}`).toBe(true);
        expect(Object.hasOwn(profile.shields.enemies, id), `shield enemy ${id}`).toBe(true);
        expect(Object.hasOwn(profile.shields.towers, id), `shield tower ${id}`).toBe(true);
      }
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("round-trips __proto__ enemy and tower IDs as own data properties without prototype pollution", async () => {
    const projectDir = copyStarter({ migrateToV2: true });
    try {
      addNamedCombatTargets(projectDir, ["__proto__"]);
      const materialized = await callTool("get_recipe", {
        projectDir,
        collection: "mechanics",
        recipeId: "basic_regenerating_shields"
      }, {});
      const shields = materialized.recipe.entity.profile.shields;
      expect(Object.hasOwn(shields.enemies, "__proto__")).toBe(true);
      expect(Object.hasOwn(shields.towers, "__proto__")).toBe(true);

      const preview = await callTool("preview_mechanics_module", {
        projectDir,
        ...materialized.recipe.entity
      }, {});
      const candidateShields = preview.candidate.mechanics.modules.combat
        .profiles.basic_regenerating_shields.shields;
      expect(Object.hasOwn(candidateShields.enemies, "__proto__")).toBe(true);
      expect(Object.hasOwn(candidateShields.towers, "__proto__")).toBe(true);
      expect(Object.prototype).not.toHaveProperty("capacity");
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("returns project_migration_required for raw-v1 preview and apply without invoking the writer", async () => {
    const projectDir = copyStarter();
    try {
      const before = snapshotTree(projectDir);
      const capabilities = await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {});
      const request = {
        projectDir,
        moduleId: "combat",
        missionId: "tutorial_01",
        profileId: "raw_v1_forbidden",
        profile: { shields: { enemies: { basic_grunt: { capacity: 10 } }, towers: {} } }
      };
      for (const [toolName, extra] of [
        ["preview_mechanics_module", {}],
        ["apply_mechanics_module", { ifRevision: capabilities.revision }]
      ]) {
        const error = await captureRejection(callTool(toolName, { ...request, ...extra }, {}));
        expect(error).toMatchObject({ code: "project_migration_required" });
        expect(error.message).toMatch(/migrate|schema.*v?2/i);
        expect(snapshotTree(projectDir)).toEqual(before);
      }
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("guardedly applies, disables, and re-enables combat while preserving profile and selection", async () => {
    const projectDir = copyStarter({ migrateToV2: true });
    try {
      const materialized = await callTool("get_recipe", {
        projectDir, collection: "mechanics", recipeId: "basic_regenerating_shields"
      }, {});
      const request = { projectDir, ...materialized.recipe.entity };
      const preview = await callTool("preview_mechanics_module", request, {});
      const missingRevision = await captureRejection(callTool("apply_mechanics_module", request, {}));
      expect(missingRevision).toMatchObject({ code: "revision_required" });

      const applied = await callTool("apply_mechanics_module", {
        ...request, ifRevision: preview.revision
      }, {});
      expect(applied).toMatchObject({ ok: true, previousRevision: preview.revision });
      expect(JSON.parse(fs.readFileSync(path.join(projectDir, "project.json"), "utf8")).schemaVersion).toBe(3);
      const authored = JSON.parse(fs.readFileSync(path.join(projectDir, "content", "mechanics.json"), "utf8"));
      const balance = JSON.parse(fs.readFileSync(path.join(projectDir, "content", "balance.json"), "utf8"));
      expect(authored.modules.combat.enabled).toBe(true);
      expect(balance.missions.tutorial_01.mechanics.profiles.combat).toBe("basic_regenerating_shields");

      const disablePreview = await callTool("preview_mechanics_module", {
        projectDir, moduleId: "combat", missionId: "tutorial_01", enabled: false
      }, {});
      const disabled = await callTool("apply_mechanics_module", {
        projectDir, moduleId: "combat", missionId: "tutorial_01", enabled: false,
        ifRevision: disablePreview.revision
      }, {});
      expect(disabled.ok).toBe(true);
      const disabledCatalog = JSON.parse(fs.readFileSync(path.join(projectDir, "content", "mechanics.json"), "utf8"));
      expect(disabledCatalog.modules.combat.enabled).toBe(false);
      expect(disabledCatalog.modules.combat.profiles).toEqual(authored.modules.combat.profiles);

      const enablePreview = await callTool("preview_mechanics_module", {
        projectDir, moduleId: "combat", missionId: "tutorial_01", enabled: true
      }, {});
      const reenabled = await callTool("apply_mechanics_module", {
        projectDir, moduleId: "combat", missionId: "tutorial_01", enabled: true,
        ifRevision: enablePreview.revision
      }, {});
      expect(reenabled.ok).toBe(true);
      expect(JSON.parse(fs.readFileSync(path.join(projectDir, "content", "mechanics.json"), "utf8"))
        .modules.combat).toEqual(authored.modules.combat);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("preserves stable validation and conflict codes without overwriting concurrent edits", async () => {
    const validationDir = copyStarter({ migrateToV2: true });
    const conflictDir = copyStarter({ migrateToV2: true });
    try {
      const invalid = await captureRejection(callTool("preview_mechanics_module", {
        projectDir: validationDir,
        moduleId: "combat",
        missionId: "tutorial_01",
        profileId: "invalid",
        profile: { shields: { enemies: { basic_grunt: { capacity: 0 } } } }
      }, {}));
      expect(invalid).toMatchObject({ code: "validation" });

      const recipe = await callTool("get_recipe", {
        projectDir: conflictDir, collection: "mechanics", recipeId: "basic_regenerating_shields"
      }, {});
      const request = { projectDir: conflictDir, ...recipe.recipe.entity };
      const preview = await callTool("preview_mechanics_module", request, {});
      const balancePath = path.join(conflictDir, "content", "balance.json");
      fs.appendFileSync(balancePath, " ", "utf8");
      const concurrentBytes = fs.readFileSync(balancePath);
      const conflict = await captureRejection(callTool("apply_mechanics_module", {
        ...request, ifRevision: preview.revision
      }, {}));
      expect(conflict).toMatchObject({ code: "conflict" });
      expect(fs.readFileSync(balancePath)).toEqual(concurrentBytes);
    } finally {
      fs.rmSync(validationDir, { recursive: true, force: true });
      fs.rmSync(conflictDir, { recursive: true, force: true });
    }
  });
});
