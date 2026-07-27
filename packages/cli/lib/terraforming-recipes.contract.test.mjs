import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contentRecipeContext, materializeContentRecipe } from "./content-recipes.mjs";
import { listMechanicsRecipes, materializeMechanicsRecipe } from "./mechanics-recipes.mjs";

const RECIPE_IDS = Object.freeze([
  "tagged_flood",
  "tagged_moat",
  "tagged_destructible_bridge"
]);
const DEFAULT_TRANSITIONS = Object.freeze({
  tagged_flood: "flood",
  tagged_moat: "moat",
  tagged_destructible_bridge: "destroy_bridge"
});
const PARAMETER_SCHEMA = Object.freeze({
  type: "object",
  required: Object.freeze(["sourceTerrainTag", "destinationTerrainId"]),
  additionalProperties: false,
  properties: Object.freeze({
    sourceTerrainTag: Object.freeze({ type: "string", minLength: 1, maxUtf8Bytes: 128 }),
    destinationTerrainId: Object.freeze({ type: "string", minLength: 1, maxUtf8Bytes: 128 }),
    transitionId: Object.freeze({ type: "string", minLength: 1, maxUtf8Bytes: 128 })
  })
});

function context(parameters = {}, overrides = {}) {
  return {
    terrainIds: ["terrain_z", "terrain_destination", "terrain_a"],
    terrainTags: ["z_tag", "source_tag", "a_tag"],
    parameters: {
      sourceTerrainTag: "source_tag",
      destinationTerrainId: "terrain_destination",
      ...parameters
    },
    ...overrides
  };
}

function expectParameterError(recipeId, materializationContext, pattern) {
  try {
    materializeMechanicsRecipe(recipeId, materializationContext);
    throw new Error("Expected recipe parameter validation to reject the candidate.");
  } catch (error) {
    expect(error.message).not.toMatch(/^Unknown mechanics recipe /);
    expect(error.message).toMatch(pattern);
  }
}

function captureRecipeError(run) {
  try {
    run();
    throw new Error("Expected recipe materialization to fail closed.");
  } catch (error) {
    return error;
  }
}

describe("R3.4b C5A parameterized terraforming recipes", () => {
  it("lists exactly three terraforming recipes with one closed parameter schema", () => {
    const recipes = listMechanicsRecipes().filter((recipe) => recipe.moduleId === "terraforming");

    expect(recipes.map((recipe) => recipe.id)).toEqual(RECIPE_IDS);
    for (const recipe of recipes) {
      expect(recipe).toMatchObject({
        moduleId: "terraforming",
        moduleSchemaVersion: 1,
        suggestedId: recipe.id,
        parameterSchema: PARAMETER_SCHEMA
      });
      expect(recipe).not.toHaveProperty("enabled");
      expect(recipe).not.toHaveProperty("entity");
      expect(recipe).not.toHaveProperty("towerScriptSnippet");
    }
  });

  it.each(RECIPE_IDS)("materializes %s as one inert v1 transition and one v6 action", (recipeId) => {
    const materialized = materializeMechanicsRecipe(recipeId, context());
    const transitionId = DEFAULT_TRANSITIONS[recipeId];

    expect(materialized).toMatchObject({
      id: recipeId,
      moduleId: "terraforming",
      moduleSchemaVersion: 1,
      parameterSchema: PARAMETER_SCHEMA,
      entity: {
        moduleId: "terraforming",
        moduleSchemaVersion: 1,
        profileId: recipeId,
        profile: {
          terrainTransitions: {
            [transitionId]: {
              fromTerrainTags: ["source_tag"],
              toTerrainId: "terrain_destination"
            }
          }
        }
      },
      towerScriptSnippet: {
        minimumSchemaVersion: 6,
        action: {
          action: "terraformTiles",
          operations: [{ kind: "set_terrain", target: "eventTile", transitionId }]
        }
      }
    });
    expect(materialized.entity).toEqual({
      moduleId: "terraforming",
      moduleSchemaVersion: 1,
      profileId: recipeId,
      profile: {
        terrainTransitions: {
          [transitionId]: {
            fromTerrainTags: ["source_tag"],
            toTerrainId: "terrain_destination"
          }
        }
      }
    });
    expect(materialized.entity).not.toHaveProperty("enabled");
    expect(materialized.entity).not.toHaveProperty("missionId");
    expect(materialized).not.toHaveProperty("missionPatch");
    expect(materialized).not.toHaveProperty("mapPatch");
    expect(materialized).not.toHaveProperty("scriptWrite");
  });

  it("uses an explicit transition id and is invariant to input object and catalog order", () => {
    const firstContext = context({ transitionId: "custom_transition" });
    const reorderedContext = {
      parameters: {
        transitionId: "custom_transition",
        destinationTerrainId: "terrain_destination",
        sourceTerrainTag: "source_tag"
      },
      terrainTags: ["source_tag", "a_tag", "z_tag"],
      terrainIds: ["terrain_a", "terrain_destination", "terrain_z"]
    };
    const before = structuredClone(firstContext);

    const first = materializeMechanicsRecipe("tagged_flood", firstContext);
    const reordered = materializeMechanicsRecipe("tagged_flood", reorderedContext);

    expect(reordered).toEqual(first);
    expect(first.entity.profile.terrainTransitions).toEqual({
      custom_transition: {
        fromTerrainTags: ["source_tag"],
        toTerrainId: "terrain_destination"
      }
    });
    expect(first.towerScriptSnippet.action.operations[0].transitionId).toBe("custom_transition");
    expect(firstContext).toEqual(before);
  });

  it("rejects missing, extra, non-string, empty, and overlong UTF-8 parameters", () => {
    expectParameterError("tagged_flood", context({}, { parameters: undefined }), /parameter|required|object/i);
    expectParameterError("tagged_flood", context({}, {
      parameters: { destinationTerrainId: "terrain_destination" }
    }), /sourceTerrainTag|required/i);
    expectParameterError("tagged_flood", context({}, {
      parameters: { sourceTerrainTag: "source_tag" }
    }), /destinationTerrainId|required/i);
    expectParameterError("tagged_flood", context({ extra: "forbidden" }), /extra|closed|unknown/i);
    expectParameterError("tagged_flood", context({ sourceTerrainTag: 42 }), /sourceTerrainTag|string/i);
    expectParameterError("tagged_flood", context({ destinationTerrainId: "" }), /destinationTerrainId|1\.\.128|empty/i);
    expectParameterError("tagged_flood", context({ transitionId: "я".repeat(65) }), /transitionId|128|UTF-8/i);
  });

  it("rejects source tags and destination terrain ids that are not already authored", () => {
    expectParameterError("tagged_moat", context({ sourceTerrainTag: "not_authored" }), /sourceTerrainTag|not_authored|unknown|authored/i);
    expectParameterError(
      "tagged_destructible_bridge",
      context({ destinationTerrainId: "not_authored" }),
      /destinationTerrainId|not_authored|unknown|authored/i
    );
  });

  it.each([
    ["enemies", "grunt"],
    ["towers", "sniper"],
    ["missions", "classic"],
    ["mechanics", "basic_displacement_physics"]
  ])("rejects terraforming parameters for non-terraform recipe %s/%s", (collection, recipeId) => {
    const error = captureRecipeError(() => materializeContentRecipe(collection, recipeId, {
      ...context(),
      mapIds: ["map"],
      waveSetIds: ["waves"],
      towerIds: ["tower"],
      abilityIds: ["ability"]
    }));

    expect(error).toMatchObject({ code: "terraform_recipe_parameter_invalid" });
    expect(error.message).toMatch(/parameter|does not accept/i);
  });

  it("returns stable coded errors for absent and hostile own-data parameter containers", () => {
    const absent = captureRecipeError(() => materializeMechanicsRecipe("tagged_flood", {
      terrainIds: ["terrain_destination"],
      terrainTags: ["source_tag"]
    }));
    expect(absent).toMatchObject({ code: "terraform_recipe_parameters_required" });

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const accessor = { destinationTerrainId: "terrain_destination" };
    Object.defineProperty(accessor, "sourceTerrainTag", {
      enumerable: true,
      get() { throw new Error("HOSTILE_ACCESSOR_MUST_NOT_RUN"); }
    });
    const nonEnumerable = { destinationTerrainId: "terrain_destination" };
    Object.defineProperty(nonEnumerable, "sourceTerrainTag", {
      enumerable: false,
      value: "source_tag"
    });

    for (const parameters of [revoked.proxy, accessor, nonEnumerable]) {
      const error = captureRecipeError(() => materializeMechanicsRecipe("tagged_flood", {
        terrainIds: ["terrain_destination"],
        terrainTags: ["source_tag"],
        parameters
      }));
      expect(error).toMatchObject({ code: "terraform_recipe_parameter_invalid" });
      expect(error.message).not.toMatch(/HOSTILE_ACCESSOR_MUST_NOT_RUN|revoked proxy/i);
    }
  });

  it("fails a self-revoking context TOCTOU with a stable coded error and no getter execution", () => {
    let getterExecutions = 0;
    let revocable;
    revocable = Proxy.revocable({
      parameters: {
        sourceTerrainTag: "source_tag",
        destinationTerrainId: "terrain_destination"
      },
      terrainTags: ["source_tag"],
      terrainIds: ["terrain_destination"]
    }, {
      getPrototypeOf() {
        return Object.prototype;
      },
      getOwnPropertyDescriptor(target, property) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
        if (property === "parameters") revocable.revoke();
        return descriptor;
      },
      get() {
        getterExecutions += 1;
        throw new Error("TOCTOU_CONTEXT_GETTER_MUST_NOT_RUN");
      }
    });

    const error = captureRecipeError(() => materializeMechanicsRecipe("tagged_flood", revocable.proxy));

    expect(error).toMatchObject({ code: "terraform_recipe_parameter_invalid" });
    expect(error.message).not.toMatch(/IsArray|revoked|TOCTOU_CONTEXT_GETTER_MUST_NOT_RUN/i);
    expect(getterExecutions).toBe(0);
  });

  it("adds binary-sorted terrain ids and existing tags to the shared recipe context", () => {
    const recipeContext = contentRecipeContext({
      manifest: {},
      maps: {},
      balance: {
        missions: {},
        terrainTypes: {
          zeta: { tags: ["wet", "path"] },
          Alpha: { tags: ["path", "floodable"] },
          alpha: { tags: [] }
        }
      }
    });

    expect(recipeContext.terrainIds).toEqual(["Alpha", "alpha", "zeta"]);
    expect(recipeContext.terrainTags).toEqual(["floodable", "path", "wet"]);
  });

  it("stays pure and never invents a destination, enablement, selection, map, or script write", () => {
    const source = fs.readFileSync(path.resolve("packages/cli/lib/mechanics-recipes.mjs"), "utf8");
    expect(source).not.toMatch(/from\s+["']node:fs["']|writeFile|appendFile|renameSync|applyMechanicsModule/);

    for (const [recipeId, destinationTerrainId] of [
      ["tagged_flood", "author_water_9"],
      ["tagged_moat", "author_chasm_7"],
      ["tagged_destructible_bridge", "author_rubble_5"]
    ]) {
      const materialized = materializeMechanicsRecipe(recipeId, {
        terrainIds: [destinationTerrainId],
        terrainTags: ["author_source"],
        parameters: { sourceTerrainTag: "author_source", destinationTerrainId }
      });
      const transition = Object.values(materialized.entity.profile.terrainTransitions);
      expect(transition).toEqual([{ fromTerrainTags: ["author_source"], toTerrainId: destinationTerrainId }]);
      expect(JSON.stringify(materialized)).not.toMatch(/"enabled"|missionPatch|mapPatch|scriptPath|write/i);
    }
  });
});
