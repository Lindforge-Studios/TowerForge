import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";

const exported = Engine as unknown as Record<string, unknown>;

describe("R3.4a physics authoring descriptor contract", () => {
  it("exports the independent physics v1 module and exact bounded limits", () => {
    expect(Engine.IMPLEMENTED_MECHANICS_MODULE_IDS).toContain("physics");
    expect(exported.PHYSICS_LIMITS).toEqual({
      displacementDistance: 8,
      displacementEffectsPerSource: 8,
      displacementTargetsPerActivation: 64,
      immuneEnemyTypeIds: 4_096,
      fallHazardTerrainTags: 64,
      idOrTagUtf8Bytes: 128,
      stepsPerEffectApplication: 8,
      stepAttemptsPerActivation: 4_096,
      stepAttemptsPerTick: 32_768
    });
    expect(exported.PHYSICS_MECHANICS_SCHEMA).toMatchObject({
      moduleId: "physics",
      schemaVersion: 1,
      supportedModuleSchemaVersions: [1],
      profile: {
        requiredFields: [],
        optionalFields: [
          "displacementImmuneEnemyTypeIds",
          "fallImmuneEnemyTypeIds",
          "fallHazardTerrainTags"
        ],
        additionalProperties: false
      },
      displacementEffect: {
        requiredFields: ["kind", "mode", "distance", "stopAtBlocker"],
        optionalFields: [],
        additionalProperties: false,
        kinds: ["displacement"],
        modes: ["push", "pull"]
      },
      limits: exported.PHYSICS_LIMITS
    });
  });

  it("advertises displacement in pipeline and ability effects without changing TowerScript", () => {
    expect(Engine.TOWER_PIPELINE_SCHEMA.effects).toMatchObject({
      displacement: {
        kind: "displacement",
        mode: "push | pull",
        distance: "positive safe integer <= 8",
        stopAtBlocker: "boolean"
      }
    });
    expect(Engine.ABILITY_EFFECT_SCHEMA).toMatchObject({
      displacement: {
        kind: "displacement",
        mode: "push | pull",
        distance: "positive safe integer <= 8",
        stopAtBlocker: "boolean"
      }
    });
    expect(Engine.TOWER_SCRIPT_SCHEMA.actions).not.toHaveProperty("displaceEnemy");
    expect(Engine.TOWER_SCRIPT_SCHEMA.events).not.toContain("enemyDisplacementResolved");
    expect(Engine.TOWER_SCRIPT_SCHEMA.events).not.toContain("enemyFell");
  });
});
