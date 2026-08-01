import { describe, expect, it } from "vitest";
import { validateRemixProvenanceV1 } from "./index.mjs";

function validProvenance() {
  return {
    schemaVersion: 1,
    parentProjectId: "tfp_0123456789abcdef0123456789abcdef",
    parentManifestDigest: "1".repeat(64),
    parentSourcePackDigest: "2".repeat(64),
    attribution: "Original TowerForge authors",
    source: { kind: "published_tdpack" }
  };
}

describe("R17.3 RemixProvenanceV1 closed data contract (RED)", () => {
  it("accepts only immutable parent publish/source provenance", () => {
    const input = validProvenance();
    const result = validateRemixProvenanceV1(input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects future versions, malformed digests, local paths, URLs and deployment metadata", () => {
    const cases = [
      { ...validProvenance(), schemaVersion: 2 },
      { ...validProvenance(), parentProjectId: "tfp_parent" },
      { ...validProvenance(), parentManifestDigest: "invalid" },
      { ...validProvenance(), parentSourcePackDigest: "invalid" },
      { ...validProvenance(), source: { kind: "published_tdpack", path: "/Users/alice/private.tdpack" } },
      { ...validProvenance(), source: { kind: "published_tdpack", url: "https://private.example" } },
      { ...validProvenance(), deployment: { provider: "github" } }
    ];
    for (const value of cases) {
      expect(() => validateRemixProvenanceV1(value))
        .toThrow(/provenance|schema|project|digest|source|unsupported|field/i);
    }
  });

  it("rejects cyclic or accessor-bearing provenance without executing accessors", () => {
    const cyclic = validProvenance();
    cyclic.self = cyclic;
    let reads = 0;
    const accessor = validProvenance();
    Object.defineProperty(accessor, "attribution", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("provenance accessor executed");
      }
    });

    expect(() => validateRemixProvenanceV1(cyclic)).toThrow(/cyclic|unsupported|field|provenance/i);
    expect(() => validateRemixProvenanceV1(accessor)).toThrow(/accessor|own data|inspect|provenance/i);
    expect(reads).toBe(0);
  });
});
