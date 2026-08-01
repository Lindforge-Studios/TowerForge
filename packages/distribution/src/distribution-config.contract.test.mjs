import { describe, expect, it } from "vitest";
import {
  DISTRIBUTION_LIMITS,
  DISTRIBUTION_SCHEMA_VERSION,
  normalizeDistributionConfigV1,
  validateDistributionConfigV1
} from "./index.mjs";

function validConfig() {
  return {
    schemaVersion: 1,
    projectId: "tfp_0123456789abcdef0123456789abcdef",
    license: { spdxId: "MIT", attribution: "TowerForge reference authors" },
    remix: { policy: "allowed_with_attribution", includeSource: true }
  };
}

describe("R17.1a DistributionConfigV1 closed data contract (RED)", () => {
  it("publishes schema v1 and bounded authoring limits", () => {
    expect(DISTRIBUTION_SCHEMA_VERSION).toBe(1);
    expect(DISTRIBUTION_LIMITS).toMatchObject({ maximumPlacements: 16 });
  });

  it("normalizes only the closed project/license/remix contract without mutation", () => {
    const input = validConfig();
    const before = structuredClone(input);
    const normalized = normalizeDistributionConfigV1(input);

    expect(normalized).toEqual(input);
    expect(normalized).not.toBe(input);
    expect(input).toEqual(before);
    expect(validateDistributionConfigV1(input)).toEqual(normalized);
    expect(Object.isFrozen(normalized)).toBe(true);
  });

  it.each(["ARR", "MIT", "Apache-2.0", "CC0-1.0", "CC-BY-4.0", "CC-BY-SA-4.0"])(
    "accepts the allowlisted %s license",
    (spdxId) => {
      expect(() => normalizeDistributionConfigV1({
        ...validConfig(),
        license: { spdxId, attribution: "Author" },
        ...(spdxId === "ARR" ? { remix: { policy: "forbidden", includeSource: false } } : {})
      })).not.toThrow();
    }
  );

  it("enforces ARR as an all-rights-reserved non-remix policy", () => {
    expect(() => normalizeDistributionConfigV1({
      ...validConfig(),
      license: { spdxId: "ARR", attribution: "Author" }
    })).toThrow(/ARR|license|remix|forbidden/i);
  });

  it("rejects malformed IDs, unknown/future fields and unsafe remix/license combinations", () => {
    const cases = [
      { ...validConfig(), schemaVersion: 2 },
      { ...validConfig(), projectId: "project-local" },
      { ...validConfig(), projectId: "tfp_ABCDEF0123456789abcdef0123456789" },
      { ...validConfig(), license: { spdxId: "GPL-3.0", attribution: "Author" } },
      { ...validConfig(), remix: { policy: "allowed", includeSource: false } },
      { ...validConfig(), extra: true }
    ];
    for (const value of cases) {
      expect(() => normalizeDistributionConfigV1(value)).toThrow(/distribution|schema|project|license|remix|unsupported|source/i);
    }
  });

  it("does not execute accessors or proxy get traps", () => {
    let accessorReads = 0;
    const accessor = validConfig();
    Object.defineProperty(accessor, "projectId", {
      enumerable: true,
      get() {
        accessorReads += 1;
        throw new Error("distribution accessor executed");
      }
    });
    expect(() => normalizeDistributionConfigV1(accessor)).toThrow(/accessor|own data|inspect|distribution/i);
    expect(accessorReads).toBe(0);

    let proxyReads = 0;
    const proxy = new Proxy(validConfig(), {
      get(target, key, receiver) {
        proxyReads += 1;
        return Reflect.get(target, key, receiver);
      }
    });
    expect(() => normalizeDistributionConfigV1(proxy)).not.toThrow();
    expect(proxyReads).toBe(0);
  });

  it("rejects sparse, cyclic and oversized values before canonicalization", () => {
    const sparse = validConfig();
    sparse.monetization = { schemaVersion: 1, placements: new Array(1) };
    const cyclic = validConfig();
    cyclic.self = cyclic;
    const oversized = validConfig();
    oversized.license.attribution = "a".repeat(65_537);

    expect(() => normalizeDistributionConfigV1(sparse)).toThrow(/sparse|placement|array/i);
    expect(() => normalizeDistributionConfigV1(cyclic)).toThrow(/cyclic|unsupported|field|distribution/i);
    expect(() => normalizeDistributionConfigV1(oversized)).toThrow(/attribution|byte|length|limit/i);
  });
});
