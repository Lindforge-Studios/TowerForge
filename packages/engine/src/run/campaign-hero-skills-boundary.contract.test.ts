import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_RUN_SCHEMA_VERSION,
  createCampaignRun,
  decodeCampaignRun,
  exportCampaignRun
} from "../index.js";

describe("R5.4A CampaignRun hero-skill no-carry boundary", () => {
  it("keeps CampaignRun v1 byte shape unchanged and rejects battle-local skill state", () => {
    expect(CAMPAIGN_RUN_SCHEMA_VERSION).toBe(1);
    const run = createCampaignRun("hero-skill-campaign");
    expect(Object.keys(run)).toEqual([
      "version", "seed", "nodeId", "deck", "artifacts", "runResources"
    ]);
    expect(exportCampaignRun(run)).toBe(
      '{"artifacts":[],"deck":[],"nodeId":null,"runResources":{},"seed":"hero-skill-campaign","version":1}'
    );
    expect(decodeCampaignRun(JSON.parse(exportCampaignRun(run)))).toEqual({
      run,
      source: "v1",
      migrations: []
    });

    expect(() => decodeCampaignRun({
      ...JSON.parse(exportCampaignRun(run)),
      heroSkills: { commander: { skillPoints: 0, unlockedSkillIds: ["arc"] } }
    })).toThrow(/unsupported|field|shape/i);
  });
});
