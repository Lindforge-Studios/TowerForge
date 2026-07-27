import { describe, expect, it } from "vitest";
import { normalizeVisuals, validateProjectSchemas } from "./project-schema.mjs";

function files(bindings, sprites = { hero_idle: { src: "assets/hero-idle.png" } }) {
  return {
    manifest: { schemaVersion: 3 },
    balance: {
      defaultMissionId: "mission",
      missions: {
        mission: {
          id: "mission",
          mapId: "lane",
          mechanics: { profiles: { heroes: "commanders" } }
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 2, height: 1,
        defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 0 }, coreCoord: { q: 1, r: 0 },
        pathCenterline: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
        pathRoutes: [], terrainOverrides: []
      }
    },
    mapSources: {},
    mechanicsAuthored: true,
    mechanics: {
      schemaVersion: 1,
      modules: {
        heroes: {
          schemaVersion: 1,
          enabled: true,
          profiles: {
            commanders: {
              selectedHeroId: "commander",
              definitions: { commander: { label: "Commander", spawn: "core" } }
            }
          }
        }
      }
    },
    visuals: normalizeVisuals({
      sprites,
      bindings: { heroes: bindings }
    }),
    storyComics: { seenStoragePrefix: "story_seen_", comics: {} },
    battleBackgrounds: { fallbackMissionId: "", placeholderMissionIds: [], definitions: {} },
    buildTargets: { targets: {} }
  };
}

describe("R5.1A optional visuals.bindings.heroes", () => {
  it("preserves explicitly authored hero bindings without synthesizing them for legacy visuals", () => {
    const legacy = normalizeVisuals({});
    expect(Object.prototype.hasOwnProperty.call(legacy.bindings, "heroes")).toBe(false);

    const authored = normalizeVisuals({
      bindings: { heroes: { commander: "hero_idle" } }
    });
    expect(authored.bindings.heroes).toEqual({ commander: "hero_idle" });
  });

  it("validates hero binding keys against authored definitions and values against sprites", () => {
    expect(validateProjectSchemas(files({ commander: "hero_idle" })).issues)
      .not.toEqual(expect.arrayContaining([
        expect.objectContaining({ severity: "error", fieldPath: expect.stringMatching(/bindings\.heroes/i) })
      ]));

    const unknownHero = validateProjectSchemas(files({ ghost: "hero_idle" }));
    expect(unknownHero.ok).toBe(false);
    expect(unknownHero.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: "bindings.heroes.ghost",
      message: expect.stringMatching(/unknown hero|definition|ghost/i)
    }));

    const unknownSprite = validateProjectSchemas(files({ commander: "missing_sprite" }));
    expect(unknownSprite.ok).toBe(false);
    expect(unknownSprite.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: "bindings.heroes.commander",
      message: expect.stringMatching(/unknown sprite|missing_sprite/i)
    }));
  });

  it("requires an own sprite definition for prototype-named hero bindings", () => {
    const inheritedPrototypeSprite = validateProjectSchemas(files({ commander: "__proto__" }));
    expect(inheritedPrototypeSprite.ok).toBe(false);
    expect(inheritedPrototypeSprite.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: "bindings.heroes.commander",
      message: expect.stringMatching(/unknown sprite|__proto__/i)
    }));

    const ownPrototypeSprite = JSON.parse(`{
      "__proto__": { "src": "assets/prototype-hero.png" }
    }`);
    expect(Object.hasOwn(ownPrototypeSprite, "__proto__")).toBe(true);
    const own = validateProjectSchemas(files({ commander: "__proto__" }, ownPrototypeSprite));
    expect(own.issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "error", fieldPath: "bindings.heroes.commander" })
    ]));
  });
});
