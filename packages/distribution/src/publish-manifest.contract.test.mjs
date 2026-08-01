import { describe, expect, it } from "vitest";
import {
  buildPublishManifestV1,
  computePublishCandidateDigestV1,
  verifyPublishManifestV1
} from "./index.mjs";

const DIGESTS = {
  engine: "1".repeat(64),
  content: "2".repeat(64),
  bundle: "3".repeat(64),
  sourcePack: "4".repeat(64)
};

function manifestInput(capabilities = ["weather", "ballistics", "replay_lab"]) {
  return {
    distribution: {
      schemaVersion: 1,
      projectId: "tfp_0123456789abcdef0123456789abcdef",
      license: { spdxId: "CC-BY-4.0", attribution: "TowerForge reference authors" },
      remix: { policy: "allowed_with_attribution", includeSource: true }
    },
    engine: { version: "towerforge-sim-v2", digest: DIGESTS.engine },
    content: { digest: DIGESTS.content },
    bundle: { digest: DIGESTS.bundle },
    capabilities,
    sourcePack: { digest: DIGESTS.sourcePack }
  };
}

describe("R17.1b PublishManifestV1 reproducibility contract (RED)", () => {
  it("builds the exact data-only manifest and sorts capabilities canonically", () => {
    expect(buildPublishManifestV1(manifestInput())).toEqual({
      schemaVersion: 1,
      format: "towerforge.publish-manifest",
      projectId: "tfp_0123456789abcdef0123456789abcdef",
      engine: { version: "towerforge-sim-v2", digest: DIGESTS.engine },
      content: { digest: DIGESTS.content },
      bundle: { digest: DIGESTS.bundle },
      capabilities: ["ballistics", "replay_lab", "weather"],
      license: { spdxId: "CC-BY-4.0", attribution: "TowerForge reference authors" },
      remixPolicy: { policy: "allowed_with_attribution", includeSource: true },
      sourcePack: { digest: DIGESTS.sourcePack }
    });
  });

  it("produces identical manifest bytes and candidate digest for equivalent input order", () => {
    const left = buildPublishManifestV1(manifestInput(["weather", "ballistics", "replay_lab"]));
    const right = buildPublishManifestV1(manifestInput(["replay_lab", "weather", "ballistics"]));

    expect(JSON.stringify(left)).toBe(JSON.stringify(right));
    expect(computePublishCandidateDigestV1(left)).toBe(computePublishCandidateDigestV1(right));
    expect(computePublishCandidateDigestV1(left)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("binds the digest to engine, content, bundle, capability and source pack provenance", () => {
    const original = buildPublishManifestV1(manifestInput());
    const originalDigest = computePublishCandidateDigestV1(original);
    const changes = [
      { engine: { ...manifestInput().engine, digest: "a".repeat(64) } },
      { content: { digest: "b".repeat(64) } },
      { bundle: { digest: "c".repeat(64) } },
      { capabilities: ["weather"] },
      { sourcePack: { digest: "d".repeat(64) } }
    ];
    for (const change of changes) {
      const changed = buildPublishManifestV1({ ...manifestInput(), ...change });
      expect(computePublishCandidateDigestV1(changed)).not.toBe(originalDigest);
    }
  });

  it("contains no timestamp, credential, external URL or user-local path field", () => {
    const manifest = buildPublishManifestV1(manifestInput());
    const serialized = JSON.stringify(manifest);

    expect(serialized).not.toMatch(/createdAt|updatedAt|timestamp|credential|token|secret|api.?key/i);
    expect(serialized).not.toMatch(/\/Users\/|[A-Za-z]:\\|file:\/\/|https?:\/\//i);
    expect(Object.keys(manifest).sort()).toEqual([
      "bundle", "capabilities", "content", "engine", "format", "license", "projectId",
      "remixPolicy", "schemaVersion", "sourcePack"
    ]);
  });

  it("rejects tampering, future versions, duplicate capabilities and malformed digests", () => {
    const manifest = buildPublishManifestV1(manifestInput());
    expect(verifyPublishManifestV1(manifest, manifestInput())).toEqual(manifest);

    const tampered = structuredClone(manifest);
    tampered.bundle.digest = "f".repeat(64);
    expect(() => verifyPublishManifestV1(tampered, manifestInput())).toThrow(/bundle|digest|manifest|mismatch/i);
    expect(() => computePublishCandidateDigestV1({ ...manifest, schemaVersion: 2 })).toThrow(/schema|version|manifest/i);
    expect(() => buildPublishManifestV1(manifestInput(["weather", "weather"]))).toThrow(/duplicate|capabilit/i);
    expect(() => buildPublishManifestV1({ ...manifestInput(), content: { digest: "not-sha256" } }))
      .toThrow(/content|digest|sha/i);
  });
});
