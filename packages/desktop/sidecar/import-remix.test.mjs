import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeRemixSourcePackDigestV2, exportRemixSourcePackV2 } from "../../cli/lib/distribution/index.mjs";

let tempDir;
let sourceDir;
let packPath;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-desktop-remix-"));
  sourceDir = path.join(tempDir, "source.tdproj");
  fs.cpSync(path.resolve("examples/starter.tdproj"), sourceDir, { recursive: true });
  const projectPath = path.join(sourceDir, "project.json");
  const project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  fs.writeFileSync(projectPath, `${JSON.stringify({ ...project, schemaVersion: 4 }, null, 2)}\n`, "utf8");
  const distribution = {
    schemaVersion: 1,
    projectId: "tfp_0123456789abcdef0123456789abcdef",
    license: { spdxId: "CC-BY-4.0", attribution: "TowerForge test authors" },
    remix: { policy: "allowed_with_attribution", includeSource: true }
  };
  fs.writeFileSync(path.join(sourceDir, "content", "distribution.json"), `${JSON.stringify(distribution, null, 2)}\n`, "utf8");
  packPath = path.join(tempDir, "source.tdpack");
  await exportRemixSourcePackV2(sourceDir, packPath, {
    publishManifest: {
      schemaVersion: 1,
      format: "towerforge.publish-manifest",
      projectId: distribution.projectId,
      engine: { version: "towerforge-sim-v2", digest: "1".repeat(64) },
      content: { digest: "2".repeat(64) },
      bundle: { digest: "3".repeat(64) },
      capabilities: [],
      license: distribution.license,
      remixPolicy: distribution.remix,
      sourcePack: { digest: computeRemixSourcePackDigestV2(sourceDir) }
    }
  });
});

afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }));

function runImport({ name = "safe-remix", projectId = "tfp_fedcba9876543210fedcba9876543210" } = {}) {
  return spawnSync(process.execPath, [
    path.resolve("packages/desktop/sidecar/import-remix.mjs"),
    "--pack", packPath,
    "--parent", tempDir,
    "--name", name,
    "--project-id", projectId
  ], { encoding: "utf8" });
}

describe("desktop remix import sidecar", () => {
  it("delegates v2 decoding to the CLI importer and creates a new project without overwrite", () => {
    const first = runImport();
    expect(first.status, first.stderr).toBe(0);
    const payload = JSON.parse(first.stdout);
    expect(payload).toEqual({ ok: true, projectDir: path.join(tempDir, "safe-remix.tdproj") });
    const distribution = JSON.parse(fs.readFileSync(path.join(payload.projectDir, "content", "distribution.json"), "utf8"));
    expect(distribution.projectId).toBe("tfp_fedcba9876543210fedcba9876543210");

    const second = runImport();
    expect(second.status).not.toBe(0);
    expect(second.stderr).toMatch(/already exists/i);
  });

  it("rejects unsafe names and malformed project IDs before creating a destination", () => {
    const unsafeName = runImport({ name: "../escape" });
    expect(unsafeName.status).not.toBe(0);
    expect(fs.existsSync(path.join(tempDir, "escape.tdproj"))).toBe(false);

    const invalidId = runImport({ projectId: "tfp_not-valid" });
    expect(invalidId.status).not.toBe(0);
    expect(fs.existsSync(path.join(tempDir, "safe-remix.tdproj"))).toBe(false);
  });
});
