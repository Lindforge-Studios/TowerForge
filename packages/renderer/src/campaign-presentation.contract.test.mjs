import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as renderer from "./index.mjs";

const sourcePath = path.resolve("packages/renderer/src/campaign-presentation.mjs");
const source = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, "utf8") : "";
const indexSource = fs.readFileSync(path.resolve("packages/renderer/src/index.mjs"), "utf8");
const buildSource = fs.readFileSync(path.resolve("packages/cli/build.mjs"), "utf8");

function projector() {
  expect(renderer.projectCampaignPresentation).toBeTypeOf("function");
  return renderer.projectCampaignPresentation;
}

function subject() {
  return {
    campaign: {
      schemaVersion: 1,
      source: "authored",
      rogueliteProfileId: "campaign_run",
      entryNodeIds: ["start"],
      nodes: [
        {
          id: "event_offer", type: "event", label: "A strange signal", regionId: "forest",
          x: 400, y: 300, difficulty: 2, nextNodeIds: []
        },
        {
          id: "start", type: "battle", missionId: "tutorial_01", regionId: "forest",
          x: 200, y: 300, difficulty: 1, nextNodeIds: ["event_offer"]
        }
      ]
    },
    run: { version: 1, seed: "seed", nodeId: "start", deck: [], artifacts: [], runResources: {} },
    availableNodeIds: ["event_offer"]
  };
}

describe("R4.4A shared campaign presentation", () => {
  it("projects detached binary-sorted nodes from authoritative campaign/run/availability inputs", () => {
    const input = subject();
    const projected = projector()(input);
    expect(projected).toEqual({
      active: true,
      profileId: "campaign_run",
      currentNodeId: "start",
      nodes: [
        {
          id: "event_offer", type: "event", label: "A strange signal", missionId: null,
          regionId: "forest", x: 400, y: 300, difficulty: 2, state: "available"
        },
        {
          id: "start", type: "battle", label: null, missionId: "tutorial_01",
          regionId: "forest", x: 200, y: 300, difficulty: 1, state: "current"
        }
      ]
    });
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.nodes)).toBe(true);
    input.campaign.nodes[0].label = "mutated";
    input.availableNodeIds.splice(0);
    expect(projected.nodes[0].label).toBe("A strange signal");
    expect(projected.nodes[0].state).toBe("available");
  });

  it("returns one frozen inactive value for absent input and fails closed on malformed/future/budget data", () => {
    const first = projector()(undefined);
    expect(first).toEqual({ active: false, profileId: null, currentNodeId: null, nodes: [] });
    expect(projector()({ campaign: null, run: null, availableNodeIds: [] })).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);

    for (const input of [
      { ...subject(), campaign: { ...subject().campaign, schemaVersion: 3 } },
      { ...subject(), run: { ...subject().run, nodeId: "missing" } },
      { ...subject(), availableNodeIds: ["missing"] },
      { ...subject(), campaign: { ...subject().campaign, nodes: subject().campaign.nodes.map((node, index) => (
        index === 0 ? { ...node, difficulty: 0 } : node
      )) } },
      { ...subject(), campaign: { ...subject().campaign, nodes: subject().campaign.nodes.map((node, index) => (
        index === 0 ? { ...node, difficulty: 6 } : node
      )) } },
      { ...subject(), campaign: { ...subject().campaign, nodes: Array.from({ length: 1_025 }, (_, index) => ({
        id: `node_${index}`, type: "event", label: "Event", regionId: "forest",
        x: 0, y: 0, difficulty: 1, nextNodeIds: []
      })) } }
    ]) expect(projector()(input)).toBeUndefined();

    let reads = 0;
    const campaign = {};
    Object.defineProperty(campaign, "schemaVersion", {
      enumerable: true,
      get() { reads += 1; throw new Error("must not invoke accessors"); }
    });
    expect(() => projector()({ campaign, run: subject().run, availableNodeIds: [] })).not.toThrow();
    expect(projector()({ campaign, run: subject().run, availableNodeIds: [] })).toBeUndefined();
    expect(reads).toBe(0);
  });

  it("is one shared Canvas/Phaser adapter and never recomputes campaign availability", () => {
    expect(source).not.toBe("");
    expect(indexSource).toMatch(/export\s+\*\s+from\s+["']\.\/campaign-presentation\.mjs["']/);
    expect(buildSource.match(/projectCampaignPresentation\s*\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(source).toMatch(/availableNodeIds/);
    expect(source).not.toMatch(/getAvailableCampaignNodeIds|recordCampaignBattleVictory|nextNodeIds[\s\S]{0,160}(?:includes|some|filter)|TowerDefenseGame|localStorage|sessionStorage/);
  });
});
