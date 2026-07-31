import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  MechanicsRecipeParameterError,
  listMechanicsRecipes,
  materializeMechanicsRecipe
} from "./mechanics-recipes.mjs";

const RECIPE_ID = "basic_targetable_boss_components";

function context(overrides = {}) {
  return {
    defaultMissionId: "boss_arena",
    missionIds: ["side_route", "boss_arena"],
    enemyIds: ["boss_zeta", "boss_alpha"],
    towerIds: ["tower_zeta", "tower_alpha"],
    ...overrides
  };
}

describe("R12.1 targetable boss components recipe contract (RED)", () => {
  it("lists one explicit opt-in enemyBehaviors v1 recipe", () => {
    expect(listMechanicsRecipes()).toContainEqual(expect.objectContaining({
      id: RECIPE_ID,
      moduleId: "enemyBehaviors",
      moduleSchemaVersion: 1,
      suggestedId: RECIPE_ID
    }));
  });

  it("materializes a deterministic project-bound component and tower targeting profile", () => {
    const firstContext = context();
    const reorderedContext = context({
      missionIds: [...firstContext.missionIds].reverse(),
      enemyIds: [...firstContext.enemyIds].reverse(),
      towerIds: [...firstContext.towerIds].reverse()
    });

    const first = materializeMechanicsRecipe(RECIPE_ID, firstContext);
    const reordered = materializeMechanicsRecipe(RECIPE_ID, reorderedContext);

    expect(reordered).toEqual(first);
    expect(first).toMatchObject({
      id: RECIPE_ID,
      moduleId: "enemyBehaviors",
      moduleSchemaVersion: 1,
      entity: {
        moduleId: "enemyBehaviors",
        moduleSchemaVersion: 1,
        missionId: "boss_arena",
        profileId: RECIPE_ID,
        profile: {
          bosses: {
            boss_alpha: {
              components: {
                core: {
                  maxHp: 20,
                  hitRegion: { kind: "circle", offsetX: 0, offsetY: 0, radius: 0.25 },
                  tags: ["core"]
                }
              }
            }
          },
          targeting: {
            towers: {
              tower_alpha: { priorityTags: ["core"] }
            }
          }
        }
      }
    });
    expect(first.entity).not.toHaveProperty("enabled");
    expect(first).not.toHaveProperty("missionPatch");
  });

  it("rejects materialization when the project has no authored enemy context", () => {
    let thrown;
    try {
      materializeMechanicsRecipe(RECIPE_ID, context({ enemyIds: [] }));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MechanicsRecipeParameterError);
    expect(thrown).toMatchObject({ code: "enemy_behaviors_recipe_context_required" });
    expect(thrown.message).toMatch(/authored enemy/i);
  });

  it("returns detached materializations without mutating or retaining caller data", () => {
    const input = context();
    const before = structuredClone(input);
    const first = materializeMechanicsRecipe(RECIPE_ID, input);

    first.entity.profile.bosses.boss_alpha.components.core.tags.push("mutated");
    first.entity.profile.targeting.towers.tower_alpha.priorityTags.push("mutated");
    input.enemyIds.push("boss_late");
    input.towerIds.push("tower_late");

    const second = materializeMechanicsRecipe(RECIPE_ID, context());
    expect(second.entity.profile.bosses.boss_alpha.components.core.tags).toEqual(["core"]);
    expect(second.entity.profile.targeting.towers.tower_alpha.priorityTags).toEqual(["core"]);
    expect(before).toEqual(context());
  });

  it.each(["defaultMissionId", "missionIds", "enemyIds", "towerIds"])(
    "rejects an accessor-backed %s context field without executing authored code",
    (field) => {
      const canonical = materializeMechanicsRecipe(RECIPE_ID, context());
      const hostile = context();
      const authoredValue = hostile[field];
      let getterCalls = 0;
      Object.defineProperty(hostile, field, {
        enumerable: true,
        configurable: true,
        get() {
          getterCalls += 1;
          return authoredValue;
        }
      });

      let thrown;
      try {
        materializeMechanicsRecipe(RECIPE_ID, hostile);
      } catch (error) {
        thrown = error;
      }

      expect(getterCalls).toBe(0);
      expect(thrown).toBeInstanceOf(MechanicsRecipeParameterError);
      expect(thrown).toMatchObject({ code: "mechanics_recipe_context_invalid" });
      expect(thrown.message).toMatch(new RegExp(`${field}.*own data|own data.*${field}|${field}.*accessor`, "i"));
      expect(materializeMechanicsRecipe(RECIPE_ID, context())).toEqual(canonical);
    }
  );

  it.each([
    ["missionIds", "accessor index"],
    ["missionIds", "throwing proxy"],
    ["missionIds", "revoked proxy"],
    ["missionIds", "sparse array"],
    ["enemyIds", "accessor index"],
    ["enemyIds", "throwing proxy"],
    ["enemyIds", "revoked proxy"],
    ["enemyIds", "sparse array"],
    ["towerIds", "accessor index"],
    ["towerIds", "throwing proxy"],
    ["towerIds", "revoked proxy"],
    ["towerIds", "sparse array"]
  ])("rejects hostile nested %s data (%s) without executing authored code", (field, kind) => {
    const canonical = materializeMechanicsRecipe(RECIPE_ID, context());
    const authored = [...context()[field]];
    let getterCalls = 0;
    let hostile;

    if (kind === "accessor index") {
      hostile = [...authored];
      Object.defineProperty(hostile, "0", {
        enumerable: true,
        configurable: true,
        get() {
          getterCalls += 1;
          return authored[0];
        }
      });
    } else if (kind === "throwing proxy") {
      hostile = new Proxy([...authored], {
        get(target, key, receiver) {
          if (key === "0") {
            getterCalls += 1;
            throw new Error("SECRET_R12_RECIPE_ARRAY_TRAP");
          }
          return Reflect.get(target, key, receiver);
        }
      });
    } else if (kind === "revoked proxy") {
      const revocable = Proxy.revocable([...authored], {});
      hostile = revocable.proxy;
      revocable.revoke();
    } else {
      hostile = new Array(authored.length + 1);
      hostile[1] = authored[0];
    }

    let thrown;
    try {
      materializeMechanicsRecipe(RECIPE_ID, context({ [field]: hostile }));
    } catch (error) {
      thrown = error;
    }

    expect(getterCalls).toBe(0);
    expect(thrown).toBeInstanceOf(MechanicsRecipeParameterError);
    expect(thrown).toMatchObject({ code: "mechanics_recipe_context_invalid" });
    expect(thrown.message).toMatch(new RegExp(`${field}.*(?:own data|accessor|dense|array|inspect|context)|(?:own data|accessor|dense|array|inspect|context).*${field}`, "i"));
    expect(thrown.message).not.toContain("SECRET_R12_RECIPE_ARRAY_TRAP");
    expect(materializeMechanicsRecipe(RECIPE_ID, context())).toEqual(canonical);
  });

  it("keeps the canonical starter fixture equal to the project-bound recipe", () => {
    const fixtureDir = path.resolve("docs/examples/opt-in-targetable-boss-components");
    const mechanics = JSON.parse(fs.readFileSync(path.join(fixtureDir, "mechanics.json"), "utf8"));
    const missionSelection = JSON.parse(fs.readFileSync(path.join(fixtureDir, "mission-selection.json"), "utf8"));
    const recipe = materializeMechanicsRecipe(RECIPE_ID, {
      defaultMissionId: "tutorial_01",
      missionIds: ["tutorial_01"],
      enemyIds: ["swift_runner", "basic_grunt", "armored_brute"],
      towerIds: ["cannon_tower", "arrow_tower"]
    });

    expect(mechanics.modules.enemyBehaviors).toEqual({
      schemaVersion: recipe.entity.moduleSchemaVersion,
      enabled: true,
      profiles: { [recipe.entity.profileId]: recipe.entity.profile }
    });
    expect(missionSelection.mechanics.profiles.enemyBehaviors).toBe(recipe.entity.profileId);
  });
});
