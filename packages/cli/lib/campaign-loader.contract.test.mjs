import { describe, expect, it } from "vitest";
import { normalizeProjectFiles } from "./project-loader.mjs";

function raw(worldMap) {
  return {
    projectDir: "/detached/campaign-fixture.tdproj",
    manifest: { schemaVersion: 3, name: "Campaign fixture" },
    balance: {},
    worldMap,
    maps: {},
    mapSources: {},
    mechanics: undefined,
    visuals: {},
    storyComics: {},
    battleBackgrounds: {},
    buildTargets: {},
    scripts: {},
    scriptFiles: {},
    scriptIssues: []
  };
}

describe("R4.4A project-loader campaign boundary", () => {
  it("preserves authored worldMap.campaign verbatim but never materializes it into a legacy project", () => {
    const legacyMap = {
      width: 100,
      height: 100,
      regions: [],
      missionNodes: [{
        missionId: "start", regionId: "region", x: 1, y: 2,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    };
    const authoredCampaign = {
      schemaVersion: 1,
      rogueliteProfileId: "run",
      entryNodeIds: ["start"],
      nodes: [{
        id: "start", type: "battle", missionId: "start", regionId: "region",
        x: 1, y: 2, difficulty: 1, nextNodeIds: []
      }]
    };
    const authoredMap = { ...legacyMap, campaign: authoredCampaign };
    const authoredBefore = structuredClone(authoredMap);
    const legacyBefore = structuredClone(legacyMap);

    expect(normalizeProjectFiles(raw(authoredMap)).worldMap.campaign).toEqual(authoredCampaign);
    expect(normalizeProjectFiles(raw(legacyMap)).worldMap).not.toHaveProperty("campaign");
    expect(authoredMap).toEqual(authoredBefore);
    expect(legacyMap).toEqual(legacyBefore);
  });
});
