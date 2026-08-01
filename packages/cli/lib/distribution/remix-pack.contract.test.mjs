import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  computeRemixSourcePackDigestV2,
  exportRemixSourcePackV2,
  importRemixSourcePackV2,
  inspectRemixSourcePackV2
} from "./remix-pack.mjs";

let tempDir;
let projectDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r17-remix-"));
  projectDir = path.join(tempDir, "source.tdproj");
  fs.cpSync(path.resolve("examples/starter.tdproj"), projectDir, { recursive: true });
  const projectPath = path.join(projectDir, "project.json");
  const project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  project.schemaVersion = 4;
  fs.writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, "utf8");
  writeDistribution({
    schemaVersion: 1,
    projectId: "tfp_0123456789abcdef0123456789abcdef",
    license: { spdxId: "CC-BY-4.0", attribution: "Original TowerForge authors" },
    remix: { policy: "allowed_with_attribution", includeSource: true }
  });
});

afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }));

function writeDistribution(distribution) {
  fs.mkdirSync(path.join(projectDir, "content"), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "content", "distribution.json"),
    `${JSON.stringify(distribution, null, 2)}\n`,
    "utf8"
  );
}

function publishManifest(sourcePackDigest = computeRemixSourcePackDigestV2(projectDir)) {
  return {
    schemaVersion: 1,
    format: "towerforge.publish-manifest",
    projectId: "tfp_0123456789abcdef0123456789abcdef",
    engine: { version: "towerforge-sim-v2", digest: "1".repeat(64) },
    content: { digest: "2".repeat(64) },
    bundle: { digest: "3".repeat(64) },
    capabilities: [],
    license: { spdxId: "CC-BY-4.0", attribution: "Original TowerForge authors" },
    remixPolicy: { policy: "allowed_with_attribution", includeSource: true },
    sourcePack: { digest: sourcePackDigest }
  };
}

describe("R17.3 deterministic remix .tdpack v2 contract (RED)", () => {
  it("exports byte-identical source packs independent of output path and local metadata", async () => {
    fs.mkdirSync(path.join(projectDir, ".towerforge", "cache"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, ".towerforge", "cache", "private-token.txt"), "secret", "utf8");
    fs.writeFileSync(path.join(projectDir, ".env"), "TOKEN=secret\n", "utf8");
    fs.writeFileSync(path.join(projectDir, "deployment.json"), "{\"provider\":\"private\"}\n", "utf8");
    fs.mkdirSync(path.join(projectDir, "assets", ".cache"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, "assets", ".cache", "render.bin"), "private cache", "utf8");

    const leftPath = path.join(tempDir, "left.tdpack");
    const rightPath = path.join(tempDir, "nested", "right.tdpack");
    const left = await exportRemixSourcePackV2(projectDir, leftPath, { publishManifest: publishManifest() });
    const right = await exportRemixSourcePackV2(projectDir, rightPath, { publishManifest: publishManifest() });

    expect(left.sha256).toBe(right.sha256);
    // Buffer deep-equality walks millions of enumerable byte indices in the assertion library.
    // Native byte comparison keeps this a production export regression instead of a test-runner
    // performance benchmark.
    expect(fs.readFileSync(leftPath).equals(fs.readFileSync(rightPath))).toBe(true);
    const inspected = inspectRemixSourcePackV2(leftPath);
    expect(inspected).toMatchObject({
      format: "towerforge.tdpack",
      version: 2,
      sha256: left.sha256,
      publishManifest: publishManifest()
    });
    expect(inspected).not.toHaveProperty("createdAt");
    expect(inspected.entries.map((entry) => entry.path)).not.toEqual(expect.arrayContaining([
      ".env", "deployment.json", ".towerforge/cache/private-token.txt", "assets/.cache/render.bin"
    ]));
    expect(JSON.stringify(inspected)).not.toMatch(/private-token|TOKEN=|\/Users\/|createdAt/i);
  });

  it("refuses source export when remix is forbidden, source is omitted, or attribution is required but absent", async () => {
    const output = path.join(tempDir, "forbidden.tdpack");
    const cases = [
      {
        schemaVersion: 1,
        projectId: "tfp_0123456789abcdef0123456789abcdef",
        license: { spdxId: "ARR", attribution: "Author" },
        remix: { policy: "forbidden", includeSource: false }
      },
      {
        schemaVersion: 1,
        projectId: "tfp_0123456789abcdef0123456789abcdef",
        license: { spdxId: "MIT", attribution: "Author" },
        remix: { policy: "allowed", includeSource: false }
      },
      {
        schemaVersion: 1,
        projectId: "tfp_0123456789abcdef0123456789abcdef",
        license: { spdxId: "CC-BY-4.0", attribution: "" },
        remix: { policy: "allowed_with_attribution", includeSource: true }
      }
    ];
    for (const distribution of cases) {
      writeDistribution(distribution);
      await expect(exportRemixSourcePackV2(projectDir, output, { publishManifest: publishManifest() }))
        .rejects.toThrow(/remix|source|license|attribution|forbidden/i);
      expect(fs.existsSync(output)).toBe(false);
    }
  });

  it("binds publish manifest sourcePack.digest to the canonical source entries domain", async () => {
    const expectedDigest = computeRemixSourcePackDigestV2(projectDir);
    expect(expectedDigest).toMatch(/^[a-f0-9]{64}$/);
    await expect(exportRemixSourcePackV2(projectDir, path.join(tempDir, "wrong-digest.tdpack"), {
      publishManifest: publishManifest("f".repeat(64))
    })).rejects.toThrow(/source|entries|digest|mismatch/i);

    const output = path.join(tempDir, "bound-digest.tdpack");
    await exportRemixSourcePackV2(projectDir, output, { publishManifest: publishManifest(expectedDigest) });
    const inspected = inspectRemixSourcePackV2(output);
    expect(inspected.entriesDigest).toBe(expectedDigest);
    expect(inspected.publishManifest.sourcePack.digest).toBe(expectedDigest);
  });

  it("imports into a new project ID and records immutable parent manifest/source provenance", async () => {
    const packPath = path.join(tempDir, "source.tdpack");
    const exported = await exportRemixSourcePackV2(projectDir, packPath, { publishManifest: publishManifest() });
    const imported = await importRemixSourcePackV2(packPath, tempDir, {
      name: "remixed",
      projectId: "tfp_fedcba9876543210fedcba9876543210"
    });
    expect(imported.projectDir).toBe(path.join(tempDir, "remixed.tdproj"));

    const project = JSON.parse(fs.readFileSync(
      path.join(imported.projectDir, "project.json"),
      "utf8"
    ));
    expect(project).toMatchObject({ schemaVersion: 4, name: "remixed" });
    expect(project.name).not.toBe("Starter Tower Defense");

    const distribution = JSON.parse(fs.readFileSync(
      path.join(imported.projectDir, "content", "distribution.json"),
      "utf8"
    ));
    expect(distribution.projectId).toBe("tfp_fedcba9876543210fedcba9876543210");
    expect(distribution.projectId).not.toBe(publishManifest().projectId);
    expect(distribution.remixProvenance).toEqual({
      schemaVersion: 1,
      parentProjectId: publishManifest().projectId,
      parentManifestDigest: imported.parentManifestDigest,
      parentSourcePackDigest: exported.sha256,
      attribution: "Original TowerForge authors",
      source: { kind: "published_tdpack" }
    });
    expect(imported.parentManifestDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.existsSync(path.join(imported.projectDir, ".towerforge"))).toBe(false);
    expect(fs.existsSync(path.join(imported.projectDir, "deployment.json"))).toBe(false);
  });

  it("rejects malformed/future packs before creating a destination", async () => {
    const packPath = path.join(tempDir, "source.tdpack");
    await exportRemixSourcePackV2(projectDir, packPath, { publishManifest: publishManifest() });
    const bytes = fs.readFileSync(packPath);
    fs.writeFileSync(packPath, bytes.subarray(0, Math.max(1, bytes.length - 17)));

    expect(() => inspectRemixSourcePackV2(packPath)).toThrow(/invalid|truncated|checksum|pack/i);
    await expect(importRemixSourcePackV2(packPath, tempDir, {
      name: "must-not-exist",
      projectId: "tfp_fedcba9876543210fedcba9876543210"
    })).rejects.toThrow(/invalid|truncated|checksum|pack/i);
    expect(fs.existsSync(path.join(tempDir, "must-not-exist.tdproj"))).toBe(false);
  });

  it("rejects root-level file and directory symlinks before following external bytes", async () => {
    const buildTargetsPath = path.join(projectDir, "build-targets.json");
    const originalBuildTargets = fs.readFileSync(buildTargetsPath);
    const outsideFile = path.join(tempDir, "outside-build-targets.json");
    fs.writeFileSync(outsideFile, "{\"externalSecret\":true}\n", "utf8");
    fs.rmSync(buildTargetsPath);
    fs.symlinkSync(outsideFile, buildTargetsPath);
    expect(() => computeRemixSourcePackDigestV2(projectDir)).toThrow(/symbolic|symlink|root|escape/i);
    await expect(exportRemixSourcePackV2(projectDir, path.join(tempDir, "file-link.tdpack"), {
      publishManifest: publishManifest("4".repeat(64))
    })).rejects.toThrow(/symbolic|symlink|root|escape/i);

    fs.rmSync(buildTargetsPath);
    fs.writeFileSync(buildTargetsPath, originalBuildTargets);
    const contentPath = path.join(projectDir, "content");
    const savedContentPath = path.join(projectDir, "content-safe");
    fs.renameSync(contentPath, savedContentPath);
    const outsideDir = path.join(tempDir, "outside-content");
    fs.mkdirSync(outsideDir);
    fs.symlinkSync(outsideDir, contentPath, "dir");
    expect(() => computeRemixSourcePackDigestV2(projectDir)).toThrow(/symbolic|symlink|root|escape/i);
    await expect(exportRemixSourcePackV2(projectDir, path.join(tempDir, "dir-link.tdpack"), {
      publishManifest: publishManifest("4".repeat(64))
    })).rejects.toThrow(/symbolic|symlink|root|escape/i);
  });
});
