import { describe, expect, it } from "vitest";
import { projectCampaignPresentation } from "./index.mjs";

function subject() {
  return {
    campaign: {
      schemaVersion: 2,
      source: "authored",
      rogueliteProfileId: "campaign_run",
      runResources: {
        relics: { label: "Relics" },
        coins: { label: "Coins" }
      },
      entryNodeIds: ["start"],
      nodes: [
        {
          id: "merchant", type: "merchant", label: "Field merchant", regionId: "forest",
          x: 400, y: 300, difficulty: 2, nextNodeIds: [],
          choices: [
            { id: "relic", label: "Buy relic", costs: { coins: 3 }, grants: { relics: 1 } },
            { id: "cache", label: "Take cache", costs: {}, grants: { coins: 5 } }
          ]
        },
        {
          id: "start", type: "battle", missionId: "tutorial_01", regionId: "forest",
          x: 200, y: 300, difficulty: 1, nextNodeIds: ["merchant"]
        }
      ]
    },
    run: { version: 1, seed: "seed", nodeId: "start", deck: [], artifacts: [], runResources: { coins: 2 } },
    availableNodeIds: ["merchant"]
  };
}

describe("R4.4B shared structural campaign presentation", () => {
  it("projects detached binary-sorted v2 resources and immutable structural choices", () => {
    const input = subject();
    const projected = projectCampaignPresentation(input);
    expect(projected).toEqual({
      active: true,
      profileId: "campaign_run",
      currentNodeId: "start",
      runResources: [
        { id: "coins", label: "Coins", amount: 2 },
        { id: "relics", label: "Relics", amount: 0 }
      ],
      nodes: [
        {
          id: "merchant", type: "merchant", label: "Field merchant", missionId: null,
          regionId: "forest", x: 400, y: 300, difficulty: 2, state: "available",
          choices: [
            {
              id: "cache", label: "Take cache", costs: [],
              grants: [{ resourceId: "coins", amount: 5 }]
            },
            {
              id: "relic", label: "Buy relic",
              costs: [{ resourceId: "coins", amount: 3 }],
              grants: [{ resourceId: "relics", amount: 1 }]
            }
          ]
        },
        {
          id: "start", type: "battle", label: null, missionId: "tutorial_01",
          regionId: "forest", x: 200, y: 300, difficulty: 1, state: "current",
          choices: []
        }
      ]
    });
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.runResources)).toBe(true);
    expect(Object.isFrozen(projected.nodes[0].choices)).toBe(true);
    expect(Object.isFrozen(projected.nodes[0].choices[0].grants[0])).toBe(true);
    input.campaign.nodes[0].choices[0].label = "mutated";
    input.run.runResources.coins = 999;
    expect(projected.nodes[0].choices[1].label).toBe("Buy relic");
    expect(projected.runResources[0].amount).toBe(2);
  });

  it("keeps v1 output byte-compatible and fails closed on unknown resources or malformed choices", () => {
    const v1 = subject();
    v1.campaign.schemaVersion = 1;
    delete v1.campaign.runResources;
    delete v1.campaign.nodes[0].choices;
    const projectedV1 = projectCampaignPresentation(v1);
    expect(projectedV1).not.toHaveProperty("runResources");
    for (const node of projectedV1.nodes) expect(node).not.toHaveProperty("choices");

    const unknownBalance = subject();
    unknownBalance.run.runResources = { missing: 1 };
    expect(projectCampaignPresentation(unknownBalance)).toBeUndefined();
    const unknownEffect = subject();
    unknownEffect.campaign.nodes[0].choices[0].grants = { missing: 1 };
    expect(projectCampaignPresentation(unknownEffect)).toBeUndefined();
    const future = subject();
    future.campaign.schemaVersion = 3;
    expect(projectCampaignPresentation(future)).toBeUndefined();
  });
});
