import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_RUN_SCHEMA_VERSION,
  UnsupportedCampaignRunVersionError,
  createCampaignRun,
  decodeCampaignRun,
  exportCampaignRun,
  importCampaignRun,
  type CampaignRunV1,
  type CampaignRunV2
} from "../index.js";

function legacyRun(): CampaignRunV1 {
  return {
    version: 1,
    seed: "legacy-seed",
    nodeId: "battle_1",
    deck: [{ instanceId: "card_instance", cardId: "focus" }],
    artifacts: [{ instanceId: "gem_instance", artifactId: "ruby_t1" }],
    runResources: { coins: 7 }
  };
}

describe("R14.0 CampaignRunV2 migration contract (RED)", () => {
  it("creates a deeply frozen v2 run with an empty independent arsenal inventory", () => {
    expect(CAMPAIGN_RUN_SCHEMA_VERSION).toBe(2);
    const run = createCampaignRun("r14-seed") as CampaignRunV2;
    expect(run).toEqual({
      version: 2,
      seed: "r14-seed",
      nodeId: null,
      deck: [],
      artifacts: [],
      runResources: {},
      arsenal: { moduleInventory: [] }
    });
    expect(Object.isFrozen(run)).toBe(true);
    expect(Object.isFrozen(run.arsenal)).toBe(true);
    expect(Object.isFrozen(run.arsenal.moduleInventory)).toBe(true);
  });

  it("imports v1 as v2 without changing legacy progress and records one explicit migration", () => {
    const decoded = decodeCampaignRun(legacyRun());
    expect(decoded.source).toBe("v1");
    expect(decoded.migrations).toEqual([{
      id: "campaign-run-v1-to-v2",
      description: "Add an empty campaign-scoped arsenal module inventory."
    }]);
    expect(decoded.run).toEqual({
      ...legacyRun(),
      version: 2,
      arsenal: { moduleInventory: [] }
    });
    expect(importCampaignRun(JSON.stringify(legacyRun()))).toEqual(decoded);
  });

  it("round-trips canonical v2 module inventory in binary id order without reordering authored ownership", () => {
    const run: CampaignRunV2 = {
      ...createCampaignRun("arsenal-seed"),
      arsenal: {
        moduleInventory: [
          { instanceId: "module_b", moduleId: "barrel_frost" },
          { instanceId: "module_a", moduleId: "base_stone" }
        ]
      }
    };
    const bytes = exportCampaignRun(run);
    const decoded = importCampaignRun(bytes);
    expect(decoded.source).toBe("v2");
    expect(decoded.migrations).toEqual([]);
    expect(decoded.run.arsenal.moduleInventory.map((entry) => entry.instanceId))
      .toEqual(["module_b", "module_a"]);
    expect(exportCampaignRun(decoded.run)).toBe(bytes);
  });

  it("rejects duplicate module instances, unknown fields, sparse input and cross-collection aggregate overflow", () => {
    const base = createCampaignRun("invalid") as CampaignRunV2;
    expect(() => decodeCampaignRun({
      ...base,
      arsenal: {
        moduleInventory: [
          { instanceId: "duplicate", moduleId: "base" },
          { instanceId: "duplicate", moduleId: "barrel" }
        ]
      }
    })).toThrow(/duplicate.*instance/i);
    expect(() => decodeCampaignRun({ ...base, arsenal: { moduleInventory: [], hidden: true } }))
      .toThrow(/unsupported|field/i);
    const sparse = Array(2) as CampaignRunV2["arsenal"]["moduleInventory"];
    expect(() => decodeCampaignRun({ ...base, arsenal: { moduleInventory: sparse } }))
      .toThrow(/sparse|array|entry/i);
  });

  it("detects future v3 before reading a hostile nested arsenal", () => {
    let reads = 0;
    const hostile = Object.defineProperty({}, "moduleInventory", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("must not read");
      }
    });
    expect(() => decodeCampaignRun({ ...legacyRun(), version: 3, arsenal: hostile }))
      .toThrow(UnsupportedCampaignRunVersionError);
    expect(reads).toBe(0);
  });
});
