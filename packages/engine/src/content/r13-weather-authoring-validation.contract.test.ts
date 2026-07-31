import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "./registry.js";
import { validateGameContentRegistry } from "./validate.js";

function fixture(enabled: boolean): GameContentInput {
  const path = Array.from({ length: 4 }, (_, q) => ({ q, r: 0 }));
  return {
    balance: {
      defaultMissionId: "weather_lab",
      constants: {
        timeUnitSeconds: 1, startingCoreHp: 20, startingCoins: 100,
        startingResources: { coins: 100 }, prepTimeUnits: 0, moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5, pathWaterCooldownUnits: 1, pathWaterDurationUnits: 1,
        pathWaterRadius: 1, pathWaterGroundSpeedFactor: 0.5
      },
      abilities: {}, enemies: {}, towers: {},
      waveSets: { waves: [{ id: "wave_0", label: "Wave 1", groups: [] }] },
      missions: {
        weather_lab: {
          id: "weather_lab", label: "Weather Lab", description: "", startingCoreHp: 20,
          startingResources: { coins: 100 }, prepTimeUnits: 0, mapId: "lane", waveSetId: "waves",
          buildTowerIds: [], abilityIds: [], mechanics: { profiles: { weather: "storm_field" } }
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 4, height: 2, grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "buildable", spawnCoord: { q: 0, r: 0 }, coreCoord: { q: 3, r: 0 },
        pathCenterline: path, pathRoutes: [], terrainOverrides: []
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        weather: {
          schemaVersion: 1,
          enabled,
          profiles: {
            storm_field: {
              zones: { edge: { kind: "tiles", tiles: [{ q: 4, r: 1 }] } },
              definitions: { storm: { label: "Storm", effects: {} } },
              schedule: {
                calmWeight: 0,
                choices: { broken: { weatherId: "missing_weather", zoneId: "edge", weight: 1 } }
              }
            }
          }
        }
      }
    },
    worldMap: {
      width: 10, height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "weather_lab", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function issue(result: ReturnType<typeof validateGameContentRegistry>, severity: "error" | "warning", pattern: RegExp) {
  return result.issues.some((entry) => entry.severity === severity
    && pattern.test(`${entry.fieldPath} ${entry.message}`));
}

describe("R13.5c Weather authoring validation contract (RED)", () => {
  it("rejects active Weather cross-references and mission-map tile bounds", () => {
    const result = validateGameContentRegistry(createGameContentRegistry(fixture(true)));
    expect(result.ok).toBe(false);
    expect(issue(result, "error", /weather[\s\S]*missing_weather|missing_weather[\s\S]*weather/i)).toBe(true);
    expect(issue(result, "error", /weather[\s\S]*(?:out.?of.?bounds|map bounds)|(?:out.?of.?bounds|map bounds)[\s\S]*weather/i)).toBe(true);
  });

  it("downgrades the same disabled semantic defects to warnings without accepting them as active", () => {
    const result = validateGameContentRegistry(createGameContentRegistry(fixture(false)));
    expect(result.ok).toBe(true);
    expect(issue(result, "warning", /weather[\s\S]*missing_weather|missing_weather[\s\S]*weather/i)).toBe(true);
    expect(issue(result, "warning", /weather[\s\S]*(?:out.?of.?bounds|map bounds)|(?:out.?of.?bounds|map bounds)[\s\S]*weather/i)).toBe(true);
  });
});
