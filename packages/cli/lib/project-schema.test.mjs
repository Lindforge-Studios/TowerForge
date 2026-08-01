import { describe, expect, it } from "vitest";
import {
  PROJECT_SCHEMA_VERSION,
  listVisualAssetPaths,
  normalizeVisuals,
  validateProjectSchemas,
  validateSafeAssetPath
} from "./project-schema.mjs";

function mechanicsSchemaFiles(schemaVersion, mechanics) {
  return {
    manifest: { schemaVersion },
    balance: { missions: {} },
    maps: {},
    mapSources: {},
    mechanics,
    visuals: normalizeVisuals({}),
    storyComics: { seenStoragePrefix: "story_seen_", comics: {} },
    battleBackgrounds: { fallbackMissionId: "", placeholderMissionIds: [], definitions: {} },
    buildTargets: { schemaVersion: 1, targets: {} }
  };
}

describe("project schema", () => {
  it("supports project schema v4 while keeping v1/v2 projects without mechanics valid", () => {
    expect(PROJECT_SCHEMA_VERSION).toBe(4);

    for (const schemaVersion of [1, 2]) {
      const result = validateProjectSchemas(mechanicsSchemaFiles(schemaVersion, undefined));
      expect(result.issues.filter((issue) => issue.entityKind === "mechanics")).toEqual([]);
      expect(result.issues.some((issue) => issue.entityKind === "project" && issue.fieldPath === "schemaVersion")).toBe(false);
    }
  });

  it("requires project schema v3 whenever content/mechanics.json is authored, even if all modules are disabled", () => {
    const mechanics = {
      schemaVersion: 1,
      modules: {
        combat: { schemaVersion: 1, enabled: false, profiles: {} }
      }
    };

    for (const schemaVersion of [1, 2]) {
      const legacyResult = validateProjectSchemas(mechanicsSchemaFiles(schemaVersion, mechanics));
      expect(legacyResult.ok).toBe(false);
      expect(legacyResult.issues).toContainEqual(expect.objectContaining({
        severity: "error",
        entityKind: "project",
        fieldPath: "schemaVersion"
      }));
    }

    const v3Result = validateProjectSchemas(mechanicsSchemaFiles(3, mechanics));
    expect(v3Result.issues.filter((issue) => issue.entityKind === "mechanics")).toEqual([]);
    expect(v3Result.issues.some((issue) => issue.entityKind === "project" && issue.fieldPath === "schemaVersion")).toBe(false);
  });

  it("accepts heroes v7 independently and rejects future heroes v8", () => {
    const valid = mechanicsSchemaFiles(3, {
      schemaVersion: 1,
      modules: {
        heroes: { schemaVersion: 7, enabled: false, profiles: {} }
      }
    });
    expect(validateProjectSchemas(valid).issues.filter((issue) => (
      issue.entityKind === "mechanics" && issue.fieldPath === "modules.heroes.schemaVersion"
    ))).toEqual([]);

    const future = structuredClone(valid);
    future.mechanics.modules.heroes.schemaVersion = 8;
    expect(validateProjectSchemas(future).issues).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "mechanics",
      fieldPath: "modules.heroes.schemaVersion",
      message: expect.stringMatching(/newer|supported|must be.*7/i)
    }));
  });

  it("versions shields, armor, and marks independently from the project and mechanics catalog", () => {
    const armorProfile = {
      damageTypes: {
        physical: { label: "Physical" },
        fire: { label: "Fire" }
      },
      armorTypes: {
        plated: {
          label: "Plated",
          defaultMultiplier: 1,
          multipliers: { physical: 0.6, fire: 1.25 }
        }
      },
      armorAssignments: { enemies: {} }
    };

    const markProfile = {
      marks: {
        definitions: {
          exposed: {
            label: "Exposed",
            duration: 3,
            maxStacks: 2,
            multiplier: 1.25,
            consumePolicy: "consume_one"
          }
        }
      }
    };

    for (const moduleSchemaVersion of [1, 2, 3]) {
      const profile = moduleSchemaVersion === 1
        ? { shields: { enemies: {}, towers: {} } }
        : moduleSchemaVersion === 2 ? armorProfile : markProfile;
      const result = validateProjectSchemas(mechanicsSchemaFiles(3, {
        schemaVersion: 1,
        modules: {
          combat: { schemaVersion: moduleSchemaVersion, enabled: true, profiles: { combat: profile } }
        }
      }));
      expect(result.issues.filter((issue) => issue.entityKind === "mechanics"), `combat v${moduleSchemaVersion}`).toEqual([]);
    }

    const future = validateProjectSchemas(mechanicsSchemaFiles(3, {
      schemaVersion: 1,
      modules: {
        combat: { schemaVersion: 4, enabled: false, profiles: {} }
      }
    }));
    expect(future.ok).toBe(false);
    expect(future.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "mechanics",
      fieldPath: "modules.combat.schemaVersion",
      message: expect.stringMatching(/newer|supported|1|2|3/i)
    }));
  });

  it("validates reactions v1 against the mission-selected combat profile without requiring combat v4", () => {
    const files = mechanicsSchemaFiles(3, {
      schemaVersion: 1,
      modules: {
        combat: {
          schemaVersion: 3,
          enabled: true,
          profiles: {
            elemental: {
              damageTypes: {
                physical: { label: "Physical" },
                fire: { label: "Fire" },
                ice: { label: "Ice" }
              }
            }
          }
        },
        reactions: {
          schemaVersion: 1,
          enabled: true,
          profiles: {
            shatter: {
              exposures: {
                definitions: {
                  fire: { label: "Fire", duration: 4, maxStacks: 1 },
                  ice: { label: "Ice", duration: 4, maxStacks: 1 }
                },
                applications: {
                  damageTypes: {
                    fire: [{ exposureId: "fire" }],
                    ice: [{ exposureId: "ice" }]
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
                      target: { kind: "primary" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });
    files.balance.missions = {
      mission: {
        id: "mission",
        mechanics: { profiles: { combat: "elemental", reactions: "shatter" } }
      }
    };

    const valid = validateProjectSchemas(files);
    expect(valid.issues.filter((issue) => issue.severity === "error" && (
      issue.fieldPath?.includes("reactions") || issue.message?.includes("reaction")
    ))).toEqual([]);

    const missingDependency = structuredClone(files);
    delete missingDependency.balance.missions.mission.mechanics.profiles.combat;
    const missingResult = validateProjectSchemas(missingDependency);
    expect(missingResult.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      entityId: "mission",
      message: expect.stringMatching(/reaction.*combat|combat.*reaction|dependency/i)
    }));

    const disabledBroken = structuredClone(files);
    disabledBroken.mechanics.modules.reactions.enabled = false;
    disabledBroken.mechanics.modules.reactions.profiles.shatter.reactions
      .shatter_fire_into_ice.effects.critical.damageType = "unknown";
    const disabledResult = validateProjectSchemas(disabledBroken);
    expect(disabledResult.issues).toContainEqual(expect.objectContaining({
      severity: "warning",
      message: expect.stringMatching(/unknown|damage type|reaction/i)
    }));

    delete disabledBroken.balance.missions.mission.mechanics.profiles.combat;
    const disabledWithoutCombat = validateProjectSchemas(disabledBroken);
    expect(disabledWithoutCombat.ok).toBe(true);
    expect(disabledWithoutCombat.issues).not.toContainEqual(expect.objectContaining({
      severity: "error",
      code: "dependency_missing"
    }));
  });

  it("accepts only terraforming v1 in project v3 and leaves legacy projects absent", () => {
    const profile = {
      terrainTransitions: {
        flood: { fromTerrainTags: ["path"], toTerrainId: "water" }
      }
    };
    const valid = mechanicsSchemaFiles(3, {
      schemaVersion: 1,
      modules: {
        terraforming: { schemaVersion: 1, enabled: true, profiles: { mutable: profile } }
      }
    });
    valid.balance.terrainTypes = {
      path: { label: "Path", buildable: false, walkable: true, groundSpeedMultiplier: 1, tags: ["path"] },
      water: { label: "Water", buildable: false, walkable: true, groundSpeedMultiplier: 0.5, tags: ["water"] }
    };
    valid.balance.missions.mission = {
      id: "mission",
      mechanics: { profiles: { terraforming: "mutable" } }
    };

    expect(validateProjectSchemas(valid).issues.filter((issue) => (
      issue.entityKind === "mechanics" || issue.fieldPath?.includes("terraforming")
    ))).toEqual([]);

    const future = structuredClone(valid);
    future.mechanics.modules.terraforming.schemaVersion = 2;
    expect(validateProjectSchemas(future).issues).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "mechanics",
      fieldPath: "modules.terraforming.schemaVersion",
      message: expect.stringMatching(/newer|supported|must be.*1/i)
    }));

    for (const schemaVersion of [1, 2]) {
      const legacy = validateProjectSchemas(mechanicsSchemaFiles(schemaVersion, undefined));
      expect(legacy.issues.some((issue) => issue.fieldPath?.includes("terraforming"))).toBe(false);
    }
  });

  it("rejects a future mechanics schema instead of silently ignoring it", () => {
    const result = validateProjectSchemas(mechanicsSchemaFiles(3, {
      schemaVersion: 2,
      modules: {}
    }));

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "mechanics",
      fieldPath: "schemaVersion",
      message: expect.stringMatching(/newer|unsupported/i)
    }));
  });

  it("structurally rejects non-allowlisted module ids and malformed module profiles", () => {
    const result = validateProjectSchemas(mechanicsSchemaFiles(3, {
      schemaVersion: 1,
      modules: {
        weather_magic: { schemaVersion: 1, enabled: true, profiles: {} },
        combat: { schemaVersion: 1, enabled: true, profiles: { bad: 42 } }
      }
    }));

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "mechanics",
      fieldPath: "modules.weather_magic"
    }));
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "mechanics",
      fieldPath: "modules.combat.profiles.bad"
    }));
  });

  it("errors on enabled missing profiles but only warns for disabled selections", () => {
    const files = mechanicsSchemaFiles(3, {
      schemaVersion: 1,
      modules: {
        combat: { schemaVersion: 1, enabled: true, profiles: {} },
        navigation: { schemaVersion: 1, enabled: false, profiles: {} }
      }
    });
    files.balance.missions = {
      enabled_missing: { id: "enabled_missing", mechanics: { profiles: { combat: "ghost" } } },
      disabled_missing: { id: "disabled_missing", mechanics: { profiles: { navigation: "ghost" } } }
    };

    const result = validateProjectSchemas(files);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "mission",
      entityId: "enabled_missing",
      fieldPath: "mechanics.profiles.combat"
    }));
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "warning",
      entityKind: "mission",
      entityId: "disabled_missing",
      fieldPath: "mechanics.profiles.navigation"
    }));
  });

  it("validates mission mechanics selections even when the optional catalog is absent", () => {
    const missingCatalog = mechanicsSchemaFiles(2, undefined);
    missingCatalog.balance.missions = {
      selected: { id: "selected", mechanics: { profiles: { combat: "ghost" } } }
    };
    const missingResult = validateProjectSchemas(missingCatalog);
    expect(missingResult.ok).toBe(true);
    expect(missingResult.issues).toContainEqual(expect.objectContaining({
      severity: "warning",
      entityKind: "mission",
      entityId: "selected",
      fieldPath: "mechanics.profiles.combat"
    }));

    const malformedCatalog = mechanicsSchemaFiles(2, undefined);
    malformedCatalog.balance.missions = {
      malformed: { id: "malformed", mechanics: { profiles: 42 } }
    };
    const malformedResult = validateProjectSchemas(malformedCatalog);
    expect(malformedResult.ok).toBe(false);
    expect(malformedResult.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "mission",
      entityId: "malformed",
      fieldPath: "mechanics.profiles"
    }));
  });

  it("validates authored theme palettes before a renderer consumes them", () => {
    const result = validateProjectSchemas({
      manifest: { schemaVersion: 1 },
      balance: { missions: {} },
      maps: {}, mapSources: {},
      visuals: { ...normalizeVisuals({}), theme: { ui: { accent: "url(evil)" }, renderer: { path: "#806247" } } },
      storyComics: { seenStoragePrefix: "story_seen_", comics: {} },
      battleBackgrounds: { fallbackMissionId: "", placeholderMissionIds: [], definitions: {} },
      buildTargets: { targets: {} }
    });
    expect(result.issues).toContainEqual(expect.objectContaining({ fieldPath: "theme.ui.accent", severity: "error" }));
  });
  it("normalizes legacy visuals into catalog v2", () => {
    const visuals = normalizeVisuals({ atlases: { creatures: { src: "/assets/generated/sprite-atlas.png" } } });

    expect(visuals.schemaVersion).toBe(2);
    expect(visuals.assetsRoot).toBe("assets");
    expect(visuals.atlases.creatures.src).toBe("assets/generated/sprite-atlas.png");
    expect(visuals.bindings.towers).toEqual({});
    expect(visuals.bindings.tileSets).toEqual({ grids: {}, maps: {} });
  });

  it("normalizes sound and music catalogs and lists their assets for the build copy", () => {
    const visuals = normalizeVisuals({ audio: {
      sounds: { shoot: { src: "/assets/sfx/shoot.wav" } },
      events: { towerFired: "shoot" },
      musicTracks: { frontier: { src: "/assets/music/frontier.ogg", volume: 0.6 } },
      musicByMission: { intro: "frontier" }
    } });
    expect(visuals.audio.sounds.shoot.src).toBe("assets/sfx/shoot.wav");
    expect(visuals.audio.events.towerFired).toBe("shoot");
    expect(visuals.audio.musicTracks.frontier.src).toBe("assets/music/frontier.ogg");
    expect(visuals.audio.musicByMission.intro).toBe("frontier");
    const paths = listVisualAssetPaths(visuals);
    expect(paths.some((p) => p.kind === "sound" && p.path === "assets/sfx/shoot.wav")).toBe(true);
    expect(paths.some((p) => p.kind === "music" && p.path === "assets/music/frontier.ogg")).toBe(true);
  });

  it("flags unsafe sound paths and bindings to unknown sounds", () => {
    const result = validateProjectSchemas({
      manifest: { schemaVersion: 1 },
      maps: {},
      mapSources: {},
      visuals: { assetsRoot: "assets", atlases: {}, sprites: {}, bindings: {}, audio: { sounds: { bad: { src: "../evil.wav" } }, events: { defeat: "ghost" } } },
      buildTargets: { targets: {} }
    });
    expect(result.issues.some((i) => i.fieldPath === "audio.sounds.bad.src")).toBe(true);
    expect(result.issues.some((i) => i.fieldPath === "audio.events.defeat" && i.severity === "warning")).toBe(true);
  });

  it("validates music paths, volume, mission bindings, and track bindings", () => {
    const result = validateProjectSchemas({
      manifest: { schemaVersion: 1 },
      balance: { missions: { intro: { id: "intro" } } },
      maps: {},
      mapSources: {},
      visuals: {
        assetsRoot: "assets",
        atlases: {},
        sprites: {},
        bindings: {},
        audio: {
          sounds: {},
          events: {},
          musicTracks: { bad: { src: "../outside.ogg", volume: 2 } },
          musicByMission: { intro: "missing", removed_mission: "bad" }
        }
      },
      buildTargets: { targets: {} }
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.fieldPath === "audio.musicTracks.bad.src")).toBe(true);
    expect(result.issues.some((issue) => issue.fieldPath === "audio.musicTracks.bad.volume")).toBe(true);
    expect(result.issues.some((issue) => issue.fieldPath === "audio.musicByMission.intro" && issue.message.includes("unknown music track"))).toBe(true);
    expect(result.issues.some((issue) => issue.fieldPath === "audio.musicByMission.removed_mission" && issue.message.includes("unknown mission"))).toBe(true);
  });

  it("accepts an atlas-frame sprite that references an existing atlas", () => {
    const result = validateProjectSchemas({
      manifest: { schemaVersion: 1 },
      maps: {},
      mapSources: {},
      visuals: {
        assetsRoot: "assets",
        atlases: { sheet: { src: "assets/sheet.png" } },
        sprites: { hero: { atlas: "sheet", frame: { x: 0, y: 32, w: 32, h: 32 } } },
        bindings: {}
      },
      buildTargets: { targets: {} }
    });
    expect(result.issues.some((i) => i.fieldPath.startsWith("sprites.hero"))).toBe(false);
  });

  it("flags atlas-frame sprites with an unknown atlas or a degenerate frame", () => {
    const result = validateProjectSchemas({
      manifest: { schemaVersion: 1 },
      maps: {},
      mapSources: {},
      visuals: {
        assetsRoot: "assets",
        atlases: { sheet: { src: "assets/sheet.png" } },
        sprites: {
          ghost: { atlas: "missing", frame: { x: 0, y: 0, w: 16, h: 16 } },
          bad: { atlas: "sheet", frame: { x: -1, y: 0, w: 0, h: 16 } }
        },
        bindings: {}
      },
      buildTargets: { targets: {} }
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.fieldPath === "sprites.ghost.atlas")).toBe(true);
    expect(result.issues.some((i) => i.fieldPath === "sprites.bad.frame.x")).toBe(true);
    expect(result.issues.some((i) => i.fieldPath === "sprites.bad.frame.w")).toBe(true);
  });

  it("rejects a sprite that sets both src and atlas/frame, and still validates the frame", () => {
    const result = validateProjectSchemas({
      manifest: { schemaVersion: 1 },
      maps: {},
      mapSources: {},
      visuals: {
        assetsRoot: "assets",
        atlases: { sheet: { src: "assets/sheet.png" } },
        // The renderer prefers the atlas/frame branch, so a stale `src` alongside a bad frame must
        // not let the malformed frame slip through unvalidated.
        sprites: { mixed: { src: "assets/mixed.png", atlas: "sheet", frame: { x: -5, y: 0, w: 0, h: 8 } } },
        bindings: {}
      },
      buildTargets: { targets: {} }
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.fieldPath === "sprites.mixed")).toBe(true);
    expect(result.issues.some((i) => i.fieldPath === "sprites.mixed.frame.x")).toBe(true);
    expect(result.issues.some((i) => i.fieldPath === "sprites.mixed.frame.w")).toBe(true);
  });

  it("rejects unsafe asset paths", () => {
    expect(validateSafeAssetPath("assets/sprite.png")).toBe(null);
    expect(validateSafeAssetPath("../secrets.txt")).toContain("..");
    expect(validateSafeAssetPath("https://example.com/a.png")).toContain("external URL");
    expect(validateSafeAssetPath("/tmp/a.png")).toContain("absolute path");
  });

  it("validates mission and sprite references in narrative content", () => {
    const result = validateProjectSchemas({
      manifest: { schemaVersion: 1 },
      balance: { missions: { intro: { id: "intro" } } },
      maps: {},
      mapSources: {},
      visuals: { assetsRoot: "assets", atlases: {}, sprites: { scene: { src: "assets/scene.png" } }, bindings: {} },
      storyComics: {
        seenStoragePrefix: "seen_",
        comics: { good: { missionId: "intro", panels: [{ text: "Ready.", spriteId: "scene" }] }, bad: { missionId: "missing", panels: [] } }
      },
      battleBackgrounds: {
        fallbackMissionId: "intro",
        placeholderMissionIds: [],
        definitions: { intro: { color: "green", spriteId: "missing" } }
      },
      buildTargets: { targets: {} }
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.fieldPath === "comics.bad.missionId")).toBe(true);
    expect(result.issues.some((issue) => issue.fieldPath === "comics.bad.panels")).toBe(true);
    expect(result.issues.some((issue) => issue.fieldPath === "definitions.intro.color")).toBe(true);
    expect(result.issues.some((issue) => issue.fieldPath === "definitions.intro.spriteId")).toBe(true);
  });

  it("validates .tdproj schema-level files alongside engine checks", () => {
    const result = validateProjectSchemas({
      manifest: { schemaVersion: 999 },
      maps: {},
      mapSources: { "map.tmj": { orientation: "orthogonal", width: 2, height: 2 } },
      visuals: { assetsRoot: "assets", atlases: { bad: { src: "../bad.png" } }, sprites: {}, bindings: {} },
      buildTargets: { targets: { web: { platform: "web", webDir: "../dist" } } }
    });

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.fieldPath === "schemaVersion")).toBe(true);
    expect(result.issues.some((issue) => issue.fieldPath === "atlases.bad.src")).toBe(true);
    expect(result.issues.some((issue) => issue.fieldPath === "targets.web.webDir")).toBe(true);
  });
});
