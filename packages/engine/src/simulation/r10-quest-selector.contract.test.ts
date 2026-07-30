import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import { SeededRng } from "./rng.js";

type QuestSourceKind = "tower" | "ability" | "tower_script" | "status" | "reaction";

interface QuestProfileV1Contract {
  readonly selectionCount: number;
  readonly definitions: Readonly<Record<string, {
    readonly label: string;
    readonly weight: number;
    readonly objective:
      | {
          readonly kind: "kill_with_source";
          readonly count: number;
          readonly source: { readonly kind: QuestSourceKind; readonly id: string };
        }
      | {
          readonly kind: "preserve_shield";
          readonly waves: number;
          readonly scope: "tower" | "hero" | "any";
        };
  }>>;
}

interface QuestSelectionRequestV1Contract {
  readonly seed: string | number;
  readonly eligibleDefinitionIds?: readonly string[];
}

interface QuestSelectionV1Contract {
  readonly questId: string;
  readonly definition: QuestProfileV1Contract["definitions"][string];
}

function selectProceduralQuestsV1(
  profile: QuestProfileV1Contract,
  request: QuestSelectionRequestV1Contract
): readonly QuestSelectionV1Contract[] {
  const select = (Engine as unknown as {
    selectProceduralQuestsV1?: (
      value: QuestProfileV1Contract,
      input: QuestSelectionRequestV1Contract
    ) => readonly QuestSelectionV1Contract[];
  }).selectProceduralQuestsV1;
  expect(select, "R10 must export the pure seeded quest selector").toBeTypeOf("function");
  return select!(profile, request);
}

function definition(
  id: string,
  weight: number,
  sourceId = id
): QuestProfileV1Contract["definitions"][string] {
  return {
    label: id,
    weight,
    objective: {
      kind: "kill_with_source",
      count: 2,
      source: { kind: "ability", id: sourceId }
    }
  };
}

function profile(order: "forward" | "reverse" = "forward"): QuestProfileV1Contract {
  const entries = [
    ["common", definition("common", 100, "lava_burst")],
    ["uncommon", definition("uncommon", 10, "ice_burst")],
    ["rare", definition("rare", 1, "shock_burst")]
  ] as const;
  return {
    selectionCount: 2,
    definitions: Object.fromEntries(order === "forward" ? entries : [...entries].reverse())
  };
}

describe("R10 pure procedural quest selector contract (RED)", () => {
  it("selects a deterministic weighted set without replacement in canonical quest-id order", () => {
    const selected = selectProceduralQuestsV1(profile(), { seed: "weighted-seed" });
    const repeated = selectProceduralQuestsV1(profile(), { seed: "weighted-seed" });

    expect(repeated).toEqual(selected);
    expect(selected).toHaveLength(2);
    expect(new Set(selected.map((entry) => entry.questId)).size).toBe(2);
    expect(selected.map((entry) => entry.questId)).toEqual(selected.map((entry) => entry.questId).sort());
    expect(selected.every((entry) => ["common", "uncommon", "rare"].includes(entry.questId))).toBe(true);
    expect(Object.isFrozen(selected)).toBe(true);
    expect(selected.every(Object.isFrozen)).toBe(true);
    expect(selected.every((entry) => Object.isFrozen(entry.definition))).toBe(true);
  });

  it("is independent of definition and eligible-id input order and never calls Math.random", () => {
    const forward = selectProceduralQuestsV1(profile("forward"), {
      seed: "order-seed",
      eligibleDefinitionIds: ["rare", "common", "uncommon"]
    });
    const reversed = selectProceduralQuestsV1(profile("reverse"), {
      seed: "order-seed",
      eligibleDefinitionIds: ["uncommon", "common", "rare"]
    });
    expect(reversed).toEqual(forward);

    const originalRandom = Math.random;
    Math.random = () => { throw new Error("quest selection must not call Math.random"); };
    try {
      expect(selectProceduralQuestsV1(profile("reverse"), {
        seed: "order-seed",
        eligibleDefinitionIds: ["common", "rare", "uncommon"]
      })).toEqual(forward);
    } finally {
      Math.random = originalRandom;
    }
  });

  it("uses its own seeded RNG and leaves an unrelated simulation RNG state untouched", () => {
    const root = new SeededRng("domain-seed");
    root.nextUint32();
    const rootBefore = root.exportState();
    const selected = selectProceduralQuestsV1(profile(), { seed: "domain-seed" });

    expect(root.exportState()).toEqual(rootBefore);
    expect(selected).toHaveLength(2);
  });

  it("selects only from the canonical eligibility allowlist and returns all when fewer are eligible than selectionCount", () => {
    const selected = selectProceduralQuestsV1(profile(), {
      seed: "eligibility-seed",
      eligibleDefinitionIds: ["rare"]
    });
    expect(selected.map((entry) => entry.questId)).toEqual(["rare"]);
    expect(() => selectProceduralQuestsV1(profile(), {
      seed: "eligibility-seed",
      eligibleDefinitionIds: ["rare", "not_authored"]
    })).toThrow(/eligible|unknown|not_authored/i);
  });

  it("honors authored integer weights across a deterministic seed corpus", () => {
    const weighted: QuestProfileV1Contract = {
      selectionCount: 1,
      definitions: {
        heavy: definition("heavy", 1_000_000, "lava_burst"),
        light: definition("light", 1, "lava_burst")
      }
    };
    let heavy = 0;
    let light = 0;
    for (let index = 0; index < 64; index += 1) {
      const id = selectProceduralQuestsV1(weighted, { seed: `weight-${index}` })[0]?.questId;
      if (id === "heavy") heavy += 1;
      if (id === "light") light += 1;
    }
    expect(heavy).toBeGreaterThan(light);
    expect(heavy + light).toBe(64);
  });

  it("rejects non-closed selector requests", () => {
    expect(() => selectProceduralQuestsV1(profile(), {
      seed: "closed-request",
      hostHook: true
    } as QuestSelectionRequestV1Contract)).toThrow(/hostHook|closed|unsupported|field/i);

  });

  it("rejects accessor-backed selector requests without invoking accessors", () => {
    let reads = 0;
    const accessorRequest = {} as QuestSelectionRequestV1Contract;
    Object.defineProperty(accessorRequest, "seed", {
      enumerable: true,
      get() { reads += 1; return "accessor-seed"; }
    });
    expect(() => selectProceduralQuestsV1(profile(), accessorRequest))
      .toThrow(/seed|accessor|data|request/i);
    expect(reads).toBe(0);
  });
});
