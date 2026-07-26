import { describe, expect, it } from "vitest";
import { projectCampaignPresentation } from "./index.mjs";

function subject() {
  return {
    campaign: {
      schemaVersion: 1,
      source: "authored",
      rogueliteProfileId: "campaign_run",
      entryNodeIds: ["start"],
      nodes: [{
        id: "start", type: "battle", missionId: "tutorial_01", regionId: "forest",
        x: 1, y: 1, difficulty: 1, nextNodeIds: []
      }]
    },
    run: {
      version: 1,
      seed: "seed",
      nodeId: null,
      deck: [
        { instanceId: "card_2", cardId: "frost" },
        { instanceId: "card_1", cardId: "ember" }
      ],
      artifacts: [
        { instanceId: "artifact_2", artifactId: "lens" },
        { instanceId: "artifact_1", artifactId: "scope" }
      ],
      runResources: {}
    },
    availableNodeIds: ["start"]
  };
}

describe("R4.4C campaign carry presentation", () => {
  it("projects a detached, frozen and ordered CampaignRun loadout for the shared renderer surface", () => {
    const input = subject();
    const projected = projectCampaignPresentation(input);
    expect(projected).toMatchObject({
      active: true,
      loadout: {
        deck: [
          { instanceId: "card_2", cardId: "frost" },
          { instanceId: "card_1", cardId: "ember" }
        ],
        artifacts: [
          { instanceId: "artifact_2", artifactId: "lens" },
          { instanceId: "artifact_1", artifactId: "scope" }
        ]
      }
    });
    expect(Object.isFrozen(projected.loadout)).toBe(true);
    expect(Object.isFrozen(projected.loadout.deck)).toBe(true);
    expect(Object.isFrozen(projected.loadout.artifacts)).toBe(true);
    expect(Object.isFrozen(projected.loadout.deck[0])).toBe(true);
    input.run.deck[0].cardId = "mutated";
    input.run.artifacts.splice(0);
    expect(projected.loadout.deck[0].cardId).toBe("frost");
    expect(projected.loadout.artifacts).toHaveLength(2);
  });

  it("keeps the marker-v1/empty-loadout presentation compatible", () => {
    const input = subject();
    input.run.deck = [];
    input.run.artifacts = [];
    expect(projectCampaignPresentation(input)).toMatchObject({
      active: true,
      loadout: { deck: [], artifacts: [] }
    });
  });

  it("fails closed on duplicate, accessor-backed, or over-budget carry entries", () => {
    const duplicate = subject();
    duplicate.run.deck[1].instanceId = "card_2";
    expect(projectCampaignPresentation(duplicate)).toBeUndefined();

    const accessor = subject();
    Object.defineProperty(accessor.run.artifacts[0], "artifactId", {
      enumerable: true,
      get() { throw new Error("must not run"); }
    });
    expect(() => projectCampaignPresentation(accessor)).not.toThrow();
    expect(projectCampaignPresentation(accessor)).toBeUndefined();

    const overBudget = subject();
    overBudget.run.deck = Array.from({ length: 10_001 }, (_, index) => ({
      instanceId: `card_${index}`,
      cardId: "ember"
    }));
    expect(projectCampaignPresentation(overBudget)).toBeUndefined();
  });

  it("does not add loadout fields to the shared absent-campaign sentinel", () => {
    expect(projectCampaignPresentation(undefined)).toEqual({
      active: false,
      profileId: null,
      currentNodeId: null,
      nodes: []
    });
    expect(projectCampaignPresentation(undefined)).not.toHaveProperty("loadout");
  });
});
