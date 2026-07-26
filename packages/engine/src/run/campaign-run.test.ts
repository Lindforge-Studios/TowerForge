import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_RUN_LIMITS,
  CAMPAIGN_RUN_SCHEMA_VERSION,
  UnsupportedCampaignRunVersionError,
  createCampaignRun,
  decodeCampaignRun,
  exportCampaignRun,
  importCampaignRun,
  type CampaignRun,
  type CampaignRunV1
} from "../index.js";

function validRun(overrides: Partial<CampaignRunV1> = {}): CampaignRunV1 {
  return {
    version: 1,
    seed: "run-seed",
    nodeId: "node_02",
    deck: [
      { instanceId: "card_instance_02", cardId: "frost_bolt" },
      { instanceId: "card_instance_01", cardId: "frost_bolt" }
    ],
    artifacts: [
      { instanceId: "artifact_instance_02", artifactId: "range_scope" },
      { instanceId: "artifact_instance_01", artifactId: "range_scope" }
    ],
    runResources: { shards: 7.5, coins: 12 },
    ...overrides
  };
}

function expectDeeplyFrozen(run: CampaignRunV1): void {
  expect(Object.isFrozen(run)).toBe(true);
  expect(Object.isFrozen(run.deck)).toBe(true);
  expect(Object.isFrozen(run.artifacts)).toBe(true);
  expect(Object.isFrozen(run.runResources)).toBe(true);
  for (const entry of [...run.deck, ...run.artifacts]) expect(Object.isFrozen(entry)).toBe(true);
}

function ownRecord(entries: readonly (readonly [string, number])[]): Record<string, number> {
  const record: Record<string, number> = {};
  for (const [key, value] of entries) {
    Object.defineProperty(record, key, { value, enumerable: true, configurable: true, writable: true });
  }
  return record;
}

function statefulRunProxy(first: CampaignRunV1, substituted: object): {
  readonly proxy: CampaignRunV1;
  readonly descriptorPasses: () => number;
  readonly valueReads: () => number;
} {
  let descriptorPasses = 0;
  let valueReads = 0;
  let active: object = first;
  const proxy = new Proxy({ ...first }, {
    ownKeys() {
      active = descriptorPasses === 0 ? first : substituted;
      descriptorPasses += 1;
      return Reflect.ownKeys(active);
    },
    getOwnPropertyDescriptor(_target, key) {
      return Reflect.getOwnPropertyDescriptor(active, key);
    },
    get() {
      valueReads += 1;
      throw new Error("ordinary proxy value read");
    }
  }) as CampaignRunV1;
  return { proxy, descriptorPasses: () => descriptorPasses, valueReads: () => valueReads };
}

describe("CampaignRunV1 portable codec", () => {
  it("publishes the independent v1 contract and exact machine-readable limits", () => {
    const alias: CampaignRun = validRun();
    expect(alias.version).toBe(1);
    expect(CAMPAIGN_RUN_SCHEMA_VERSION).toBe(1);
    expect(CAMPAIGN_RUN_LIMITS).toEqual({
      jsonBytes: 1_048_576,
      collectionEntries: 10_000,
      identifierCodeUnits: 256,
      seedCodeUnits: 4_096,
      maxDepth: 8,
      maxNodes: 50_000
    });
    expect(Object.isFrozen(CAMPAIGN_RUN_LIMITS)).toBe(true);
  });

  it("creates the exact deeply frozen inert run without random defaults", () => {
    const run = createCampaignRun("seed");
    expect(run).toEqual({
      version: 1,
      seed: "seed",
      nodeId: null,
      deck: [],
      artifacts: [],
      runResources: {}
    });
    expectDeeplyFrozen(run);
    expect(exportCampaignRun(run)).toBe(
      '{"artifacts":[],"deck":[],"nodeId":null,"runResources":{},"seed":"seed","version":1}'
    );
    expect(createCampaignRun("").seed).toBe("");
  });

  it("round-trips populated string and numeric seeds with source metadata and no migrations", () => {
    for (const seed of ["campaign-seed", 42] as const) {
      const original = validRun({ seed });
      const decoded = importCampaignRun(exportCampaignRun(original));
      expect(decoded).toEqual({ run: original, source: "v1", migrations: [] });
      expect(decoded.run).not.toBe(original);
      expect(Object.isFrozen(decoded)).toBe(true);
      expect(Object.isFrozen(decoded.migrations)).toBe(true);
      expectDeeplyFrozen(decoded.run);
      expect(exportCampaignRun(decoded.run)).toBe(exportCampaignRun(original));
    }
  });

  it("preserves array order and duplicate definition ids while requiring instance identity only per list", () => {
    const run = decodeCampaignRun(validRun({
      deck: [
        { instanceId: "shared_instance", cardId: "same_card" },
        { instanceId: "deck_two", cardId: "same_card" }
      ],
      artifacts: [
        { instanceId: "shared_instance", artifactId: "same_artifact" },
        { instanceId: "artifact_two", artifactId: "same_artifact" }
      ]
    })).run;
    expect(run.deck.map(({ instanceId }) => instanceId)).toEqual(["shared_instance", "deck_two"]);
    expect(run.artifacts.map(({ instanceId }) => instanceId)).toEqual(["shared_instance", "artifact_two"]);

    expect(() => decodeCampaignRun(validRun({
      deck: [
        { instanceId: "duplicate", cardId: "a" },
        { instanceId: "duplicate", cardId: "b" }
      ]
    }))).toThrow(/deck|instance|duplicate/i);
    expect(() => decodeCampaignRun(validRun({
      artifacts: [
        { instanceId: "duplicate", artifactId: "a" },
        { instanceId: "duplicate", artifactId: "b" }
      ]
    }))).toThrow(/artifact|instance|duplicate/i);
  });

  it("keeps opaque references content-independent and canonicalizes resource records safely", () => {
    const input = validRun({
      nodeId: "unknown_future_node",
      deck: [{ instanceId: "unknown_card_instance", cardId: "unknown_card" }],
      artifacts: [{ instanceId: "unknown_artifact_instance", artifactId: "unknown_artifact" }],
      runResources: ownRecord([["zeta", -0], ["__proto__", 3], ["alpha", 2]])
    });
    const first = decodeCampaignRun(input).run;
    const second = decodeCampaignRun({
      ...input,
      runResources: ownRecord([["alpha", 2], ["__proto__", 3], ["zeta", 0]])
    }).run;

    expect(first.nodeId).toBe("unknown_future_node");
    expect(first.deck[0]?.cardId).toBe("unknown_card");
    expect(first.artifacts[0]?.artifactId).toBe("unknown_artifact");
    expect(Object.getPrototypeOf(first.runResources)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(first.runResources, "__proto__")).toBe(true);
    expect(Object.is(first.runResources.zeta, -0)).toBe(false);
    expect(exportCampaignRun(first)).toBe(exportCampaignRun(second));
  });

  it("detaches every accepted value before freezing it", () => {
    const input = validRun();
    const decoded = decodeCampaignRun(input).run;
    expect(decoded).not.toBe(input);
    expect(decoded.deck).not.toBe(input.deck);
    expect(decoded.deck[0]).not.toBe(input.deck[0]);
    expect(decoded.artifacts).not.toBe(input.artifacts);
    expect(decoded.runResources).not.toBe(input.runResources);
    (input.deck as unknown as { cardId: string }[])[0]!.cardId = "mutated";
    (input.runResources as Record<string, number>).coins = 999;
    expect(decoded.deck[0]?.cardId).toBe("frost_bolt");
    expect(decoded.runResources.coins).toBe(12);
  });

  it.each([
    ["missing version", (() => { const { version: _version, ...rest } = validRun(); return rest; })()],
    ["version zero", { ...validRun(), version: 0 }],
    ["negative version", { ...validRun(), version: -1 }],
    ["fractional version", { ...validRun(), version: 1.5 }],
    ["string version", { ...validRun(), version: "1" }],
    ["extra root field", { ...validRun(), future: true }]
  ])("rejects %s instead of repairing or migrating it", (_label, input) => {
    expect(() => decodeCampaignRun(input)).toThrow(/campaign|run|version|field/i);
  });

  it("fails closed on future versions with a typed detached error before nested traversal", () => {
    let nestedTouches = 0;
    const hostileDeck = new Proxy([], {
      ownKeys() {
        nestedTouches += 1;
        throw new Error("future opaque deck must not be inspected");
      }
    });
    let error: unknown;
    try {
      decodeCampaignRun({ ...validRun(), version: 2, deck: hostileDeck });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(UnsupportedCampaignRunVersionError);
    expect(error).toMatchObject({ code: "UNSUPPORTED_CAMPAIGN_RUN_VERSION", version: 2 });
    expect(nestedTouches).toBe(0);
  });

  it("rejects malformed and over-byte JSON before accepting any run", () => {
    expect(() => importCampaignRun('{"version":1')).toThrow(/json|malformed|campaign|run/i);
    const oversized = JSON.stringify({ ...validRun(), padding: "x".repeat(CAMPAIGN_RUN_LIMITS.jsonBytes + 1) });
    expect(() => importCampaignRun(oversized)).toThrow(/byte|budget|large|limit/i);
  });

  it("enforces the aggregate collection budget without per-field truncation", () => {
    const deck = Array.from({ length: CAMPAIGN_RUN_LIMITS.collectionEntries }, (_, index) => ({
      instanceId: `card_${index}`,
      cardId: "card"
    }));
    expect(() => decodeCampaignRun(validRun({ deck, runResources: { one_more: 1 } }))).toThrow(/collection|entries|budget|limit/i);
  });

  it.each([
    ["empty node", { nodeId: "" }],
    ["long node", { nodeId: "n".repeat(CAMPAIGN_RUN_LIMITS.identifierCodeUnits + 1) }],
    ["empty deck instance", { deck: [{ instanceId: "", cardId: "card" }] }],
    ["empty card", { deck: [{ instanceId: "instance", cardId: "" }] }],
    ["empty artifact instance", { artifacts: [{ instanceId: "", artifactId: "artifact" }] }],
    ["empty artifact", { artifacts: [{ instanceId: "instance", artifactId: "" }] }]
  ])("rejects %s identifiers", (_label, overrides) => {
    expect(() => decodeCampaignRun(validRun(overrides as Partial<CampaignRunV1>))).toThrow(/identifier|node|instance|card|artifact|length/i);
  });

  it.each(["s".repeat(CAMPAIGN_RUN_LIMITS.seedCodeUnits + 1), Number.NaN, Number.POSITIVE_INFINITY, 1.5])(
    "rejects invalid seed %s",
    (seed) => expect(() => createCampaignRun(seed)).toThrow(/seed|finite|integer|length/i)
  );

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, "7"])("rejects invalid run resource %s", (amount) => {
    expect(() => decodeCampaignRun(validRun({ runResources: { coins: amount as number } }))).toThrow(/resource|number|finite|negative/i);
  });

  it("rejects accessors, symbols, exotic objects, sparse arrays, cycles, and entry extra fields", () => {
    const accessor = validRun();
    Object.defineProperty(accessor, "seed", { enumerable: true, get: () => "secret" });
    const symbol = { ...validRun(), [Symbol("secret")]: true };
    const exotic = Object.assign(Object.create({ inherited: true }), validRun());
    const sparseDeck = Array(2) as CampaignRunV1["deck"];
    (sparseDeck as { [index: number]: { instanceId: string; cardId: string } })[1] = { instanceId: "one", cardId: "card" };
    const cyclic = validRun() as CampaignRunV1 & { cycle?: unknown };
    cyclic.cycle = cyclic;

    for (const unsafe of [
      accessor,
      symbol,
      exotic,
      validRun({ deck: sparseDeck }),
      cyclic,
      validRun({ deck: [{ instanceId: "one", cardId: "card", future: true } as never] })
    ]) expect(() => decodeCampaignRun(unsafe)).toThrow();
  });

  it("uses one root descriptor snapshot and never ordinary-reads a stateful proxy", () => {
    const first = validRun();
    const substituted = { ...validRun(), version: 2, secret: "injected" };
    const decodeSubject = statefulRunProxy(first, substituted);
    const decoded = decodeCampaignRun(decodeSubject.proxy).run;
    expect(decoded).toEqual(first);
    expect(decodeSubject.descriptorPasses()).toBe(1);
    expect(decodeSubject.valueReads()).toBe(0);

    const exportSubject = statefulRunProxy(first, substituted);
    expect(JSON.parse(exportCampaignRun(exportSubject.proxy))).toEqual(first);
    expect(exportSubject.descriptorPasses()).toBe(1);
    expect(exportSubject.valueReads()).toBe(0);
  });

  it("keeps canonical bytes stable across repeated import/export cycles", () => {
    let bytes = exportCampaignRun(validRun());
    for (let iteration = 0; iteration < 16; iteration += 1) {
      const next = exportCampaignRun(importCampaignRun(bytes).run);
      expect(next).toBe(bytes);
      bytes = next;
    }
  });
});
