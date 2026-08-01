import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPublishManifestV1 } from "../../../distribution/src/index.mjs";
import {
  computeRemixSourcePackDigestV2,
  computePublishTreeDigestV1,
  discardPreparedPublishCandidate,
  exportRemixSourcePackV2,
  mintPublishApproval,
  preparePublishCandidate,
  previewPublishCandidate,
  publishPreparedCandidate
} from "./index.mjs";

let tempDir;
let projectDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r17-publish-"));
  projectDir = path.join(tempDir, "source.tdproj");
  fs.cpSync(path.resolve("examples/starter.tdproj"), projectDir, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function treeDigest(root) {
  const hash = createHash("sha256");
  const visit = (current) => {
    for (const name of fs.readdirSync(current).sort()) {
      const absolute = path.join(current, name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      const stat = fs.lstatSync(absolute);
      if (stat.isDirectory()) visit(absolute);
      else if (stat.isFile() && !relative.startsWith(".towerforge/")) {
        hash.update(relative).update("\0").update(fs.readFileSync(absolute));
      }
    }
  };
  visit(root);
  return hash.digest("hex");
}

function target(adapterId) {
  if (adapterId === "filesystem_v1") return { directory: path.join(tempDir, "public") };
  if (adapterId === "github_pages_v1") {
    return { owner: "lindforge", repository: "tower-game", branch: "gh-pages", pathPrefix: "" };
  }
  return { accountId: "account-public-id", projectName: "tower-game" };
}

async function fakeReproducibleBuild({ stagingDir }) {
  const bundleDir = path.join(stagingDir, "bundle");
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(path.join(bundleDir, "index.html"), "<!doctype html><title>TowerForge</title>\n", "utf8");
  return {
    bundleDir,
    engine: { version: "towerforge-sim-v2", digest: "1".repeat(64) },
    content: { digest: "2".repeat(64) },
    bundle: { digest: computePublishTreeDigestV1(bundleDir, { excludeSourcePack: true }) },
    capabilities: []
  };
}

function enableRemixDistribution() {
  const projectPath = path.join(projectDir, "project.json");
  const project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  fs.writeFileSync(projectPath, `${JSON.stringify({ ...project, schemaVersion: 4 }, null, 2)}\n`, "utf8");
  const distribution = {
    schemaVersion: 1,
    projectId: "tfp_0123456789abcdef0123456789abcdef",
    license: { spdxId: "CC-BY-4.0", attribution: "Remix fixture author" },
    remix: { policy: "allowed_with_attribution", includeSource: true }
  };
  fs.writeFileSync(path.join(projectDir, "content", "distribution.json"), `${JSON.stringify(distribution, null, 2)}\n`, "utf8");
  return distribution;
}

async function fakeRemixBuild({ stagingDir }) {
  const distribution = enableRemixDistribution();
  const bundleDir = path.join(stagingDir, "bundle");
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(path.join(bundleDir, "index.html"), "<!doctype html><title>Remix</title>\n", "utf8");
  const publishManifest = buildPublishManifestV1({
    distribution,
    engine: { version: "towerforge-sim-v2", digest: "1".repeat(64) },
    content: { digest: "2".repeat(64) },
    bundle: { digest: computePublishTreeDigestV1(bundleDir, { excludeSourcePack: true }) },
    capabilities: [],
    sourcePack: { digest: computeRemixSourcePackDigestV2(projectDir) }
  });
  await exportRemixSourcePackV2(projectDir, path.join(bundleDir, "source.tdpack"), { publishManifest });
  return { bundleDir, publishManifest };
}

describe("R17.2 provider approval/adapters contract (RED)", () => {
  it.each(["filesystem_v1", "github_pages_v1", "cloudflare_pages_v1"])(
    "previews %s without building, uploading or touching the source",
    async (adapterId) => {
      const before = treeDigest(projectDir);
      const build = vi.fn(fakeReproducibleBuild);
      const preview = await previewPublishCandidate({ projectDir, adapterId, target: target(adapterId), build });

      expect(preview).toMatchObject({
        schemaVersion: 1,
        adapterId,
        sideEffect: "none",
        requiresExplicitConfirmation: true,
        targetDigest: expect.stringMatching(/^[a-f0-9]{64}$/)
      });
      expect(build).not.toHaveBeenCalled();
      expect(treeDigest(projectDir)).toBe(before);
    }
  );

  it("prepares in private staging but refuses upload until the exact candidate/provider/target is confirmed", async () => {
    const adapterId = "filesystem_v1";
    const publishTarget = target(adapterId);
    const prepared = await preparePublishCandidate({
      projectDir,
      adapterId,
      target: publishTarget,
      build: fakeReproducibleBuild
    });
    const runtime = {
      upload: vi.fn(async () => ({ uploadId: "provider-upload" })),
      verify: vi.fn(async () => ({ remoteDigest: prepared.candidateDigest }))
    };

    await expect(publishPreparedCandidate({ prepared, adapterRuntime: runtime })).rejects.toThrow(/approval|confirm/i);
    expect(runtime.upload).not.toHaveBeenCalled();
    expect(fs.existsSync(prepared.stagingDir)).toBe(true);
    expect(() => mintPublishApproval({
      confirmed: false,
      candidateDigest: prepared.candidateDigest,
      adapterId,
      targetDigest: prepared.targetDigest
    })).toThrow(/confirm/i);

    const approval = mintPublishApproval({
      confirmed: true,
      candidateDigest: prepared.candidateDigest,
      adapterId,
      targetDigest: prepared.targetDigest
    });
    for (const mismatch of [
      { ...approval, candidateDigest: "f".repeat(64) },
      { ...approval, adapterId: "github_pages_v1" },
      { ...approval, targetDigest: "e".repeat(64) }
    ]) {
      await expect(publishPreparedCandidate({ prepared, approval: mismatch, adapterRuntime: runtime }))
        .rejects.toThrow(/approval|candidate|adapter|target|mismatch/i);
    }
    expect(runtime.upload).not.toHaveBeenCalled();
    expect(fs.existsSync(prepared.stagingDir)).toBe(true);

    await expect(publishPreparedCandidate({ prepared, approval, adapterRuntime: runtime }))
      .resolves.toMatchObject({ ok: true, verified: true, candidateDigest: prepared.candidateDigest });
    expect(runtime.upload).toHaveBeenCalledTimes(1);
    expect(runtime.verify).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(prepared.stagingDir)).toBe(false);
  });

  it("keeps credentials runtime-only and leaves the source byte-identical after failed upload", async () => {
    const before = treeDigest(projectDir);
    const prepared = await preparePublishCandidate({
      projectDir,
      adapterId: "github_pages_v1",
      target: target("github_pages_v1"),
      build: fakeReproducibleBuild
    });
    const approval = mintPublishApproval({
      confirmed: true,
      candidateDigest: prepared.candidateDigest,
      adapterId: prepared.adapterId,
      targetDigest: prepared.targetDigest
    });
    const secret = "ghp_forbidden_fixture_secret";
    const runtime = {
      credentials: { token: secret },
      upload: vi.fn(async () => { throw new Error("provider unavailable"); }),
      verify: vi.fn()
    };

    expect(JSON.stringify(prepared)).not.toContain(secret);
    await expect(publishPreparedCandidate({ prepared, approval, adapterRuntime: runtime }))
      .rejects.toThrow(/provider unavailable/);
    expect(fs.existsSync(prepared.stagingDir)).toBe(false);
    expect(treeDigest(projectDir)).toBe(before);
    expect(fs.readFileSync(path.join(projectDir, "project.json"), "utf8")).not.toContain(secret);
  });

  it("rejects a declared bundle digest that does not match the staged bytes", async () => {
    await expect(preparePublishCandidate({
      projectDir,
      adapterId: "filesystem_v1",
      target: target("filesystem_v1"),
      build: async (input) => ({
        ...await fakeReproducibleBuild(input),
        bundle: { digest: "f".repeat(64) }
      })
    })).rejects.toThrow(/bundle|digest|mismatch|staged/i);
  });

  it("verifies copied filesystem bytes independently and rolls back a tampered destination", async () => {
    const publishTarget = target("filesystem_v1");
    const prepared = await preparePublishCandidate({
      projectDir,
      adapterId: "filesystem_v1",
      target: publishTarget,
      build: fakeReproducibleBuild
    });
    const approval = mintPublishApproval({
      confirmed: true,
      candidateDigest: prepared.candidateDigest,
      adapterId: prepared.adapterId,
      targetDigest: prepared.targetDigest
    });
    fs.writeFileSync(path.join(prepared.bundleDir, "index.html"), "tampered after prepare\n", "utf8");

    await expect(publishPreparedCandidate({ prepared, approval }))
      .rejects.toThrow(/bundle|digest|verification|mismatch/i);
    expect(fs.existsSync(publishTarget.directory)).toBe(false);
    expect(fs.existsSync(prepared.stagingDir)).toBe(false);
  });

  it("consumes an exact approval before a failed upload and rejects every reuse", async () => {
    const prepared = await preparePublishCandidate({
      projectDir,
      adapterId: "github_pages_v1",
      target: target("github_pages_v1"),
      build: fakeReproducibleBuild
    });
    const approval = mintPublishApproval({
      confirmed: true,
      candidateDigest: prepared.candidateDigest,
      adapterId: prepared.adapterId,
      targetDigest: prepared.targetDigest
    });
    const runtime = {
      upload: vi.fn(async () => { throw new Error("provider failed after acceptance"); }),
      verify: vi.fn()
    };

    await expect(publishPreparedCandidate({ prepared, approval, adapterRuntime: runtime }))
      .rejects.toThrow(/provider failed/i);
    await expect(publishPreparedCandidate({ prepared, approval, adapterRuntime: runtime }))
      .rejects.toThrow(/approval|expired|missing|used/i);
    expect(runtime.upload).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(prepared.stagingDir)).toBe(false);
  });

  it("rechecks staged bundle bytes immediately before every provider upload", async () => {
    const prepared = await preparePublishCandidate({
      projectDir,
      adapterId: "github_pages_v1",
      target: target("github_pages_v1"),
      build: fakeReproducibleBuild
    });
    const approval = mintPublishApproval({
      confirmed: true,
      candidateDigest: prepared.candidateDigest,
      adapterId: prepared.adapterId,
      targetDigest: prepared.targetDigest
    });
    fs.writeFileSync(path.join(prepared.bundleDir, "index.html"), "tampered before provider call\n", "utf8");
    const runtime = { upload: vi.fn(), verify: vi.fn() };

    await expect(publishPreparedCandidate({ prepared, approval, adapterRuntime: runtime }))
      .rejects.toThrow(/bundle|digest|tamper|mismatch/i);
    expect(runtime.upload).not.toHaveBeenCalled();
    expect(runtime.verify).not.toHaveBeenCalled();
    expect(fs.existsSync(prepared.stagingDir)).toBe(false);
  });

  it("rejects an ambiguous one-file to two-file staged-tree substitution before upload", async () => {
    const prepared = await preparePublishCandidate({
      projectDir,
      adapterId: "github_pages_v1",
      target: target("github_pages_v1"),
      build: async ({ stagingDir }) => {
        const bundleDir = path.join(stagingDir, "bundle");
        fs.mkdirSync(bundleDir, { recursive: true });
        fs.writeFileSync(path.join(bundleDir, "a"), Buffer.from("Xb\0Y"));
        return {
          bundleDir,
          engine: { version: "towerforge-sim-v2", digest: "1".repeat(64) },
          content: { digest: "2".repeat(64) },
          bundle: { digest: computePublishTreeDigestV1(bundleDir, { excludeSourcePack: true }) },
          capabilities: []
        };
      }
    });
    const approval = mintPublishApproval({
      confirmed: true,
      candidateDigest: prepared.candidateDigest,
      adapterId: prepared.adapterId,
      targetDigest: prepared.targetDigest
    });
    fs.writeFileSync(path.join(prepared.bundleDir, "a"), "X");
    fs.writeFileSync(path.join(prepared.bundleDir, "b"), "Y");
    const runtime = { upload: vi.fn(), verify: vi.fn() };

    await expect(publishPreparedCandidate({ prepared, approval, adapterRuntime: runtime }))
      .rejects.toThrow(/bundle|digest|tamper|mismatch/i);
    expect(runtime.upload).not.toHaveBeenCalled();
    expect(runtime.verify).not.toHaveBeenCalled();
  });

  it("rejects replacement of the prepared bundle root with a symlink before upload", async () => {
    const prepared = await preparePublishCandidate({
      projectDir,
      adapterId: "github_pages_v1",
      target: target("github_pages_v1"),
      build: fakeReproducibleBuild
    });
    const approval = mintPublishApproval({
      confirmed: true,
      candidateDigest: prepared.candidateDigest,
      adapterId: prepared.adapterId,
      targetDigest: prepared.targetDigest
    });
    const replacement = path.join(tempDir, "replacement-bundle");
    fs.mkdirSync(replacement);
    fs.writeFileSync(path.join(replacement, "index.html"), "replacement\n");
    fs.rmSync(prepared.bundleDir, { recursive: true });
    fs.symlinkSync(replacement, prepared.bundleDir, "dir");
    const runtime = { upload: vi.fn(), verify: vi.fn() };

    await expect(publishPreparedCandidate({ prepared, approval, adapterRuntime: runtime }))
      .rejects.toThrow(/bundle|symlink|identity|staging/i);
    expect(runtime.upload).not.toHaveBeenCalled();
    expect(fs.existsSync(prepared.stagingDir)).toBe(false);
  });

  it("expires and releases abandoned prepared candidates before admitting a later one", async () => {
    const clock = vi.spyOn(Date, "now");
    clock.mockReturnValue(1_000);
    const abandoned = await preparePublishCandidate({
      projectDir,
      adapterId: "github_pages_v1",
      target: target("github_pages_v1"),
      build: fakeReproducibleBuild
    });
    expect(fs.existsSync(abandoned.stagingDir)).toBe(true);
    clock.mockReturnValue(11 * 60 * 1_000);
    const current = await preparePublishCandidate({
      projectDir,
      adapterId: "github_pages_v1",
      target: target("github_pages_v1"),
      build: fakeReproducibleBuild
    });

    expect(fs.existsSync(abandoned.stagingDir)).toBe(false);
    await expect(publishPreparedCandidate({ prepared: abandoned, approval: {} }))
      .rejects.toThrow(/unknown|discarded|expired|used/i);
    expect(discardPreparedPublishCandidate(current)).toBe(true);
  });

  it("reserves the prepared-candidate limit across concurrent in-flight builds", async () => {
    let releaseBuilds;
    const gate = new Promise((resolve) => { releaseBuilds = resolve; });
    const gatedBuild = async ({ stagingDir }) => {
      await gate;
      const bundleDir = path.join(stagingDir, "bundle");
      fs.mkdirSync(bundleDir, { recursive: true });
      fs.writeFileSync(path.join(bundleDir, "index.html"), "bounded concurrent candidate\n");
      return {
        bundleDir,
        engine: { version: "towerforge-sim-v2", digest: "1".repeat(64) },
        content: { digest: "2".repeat(64) },
        bundle: { digest: computePublishTreeDigestV1(bundleDir, { excludeSourcePack: true }) },
        capabilities: []
      };
    };
    const attempts = Array.from({ length: 33 }, () => preparePublishCandidate({
      projectDir,
      adapterId: "github_pages_v1",
      target: target("github_pages_v1"),
      build: gatedBuild
    }));
    releaseBuilds();
    const settled = await Promise.allSettled(attempts);
    const fulfilled = settled.filter((result) => result.status === "fulfilled");
    const rejected = settled.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(32);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason?.message ?? rejected[0].reason)).toMatch(/too many|limit|awaiting/i);
    for (const result of fulfilled) expect(discardPreparedPublishCandidate(result.value)).toBe(true);
    const stagingRoot = path.join(projectDir, ".towerforge", "publish-staging");
    expect(fs.readdirSync(stagingRoot)).toEqual([]);
  });

  it("binds source.tdpack separately from the canonical gameplay bundle and rejects pre-upload archive tampering", async () => {
    const prepared = await preparePublishCandidate({
      projectDir,
      adapterId: "github_pages_v1",
      target: target("github_pages_v1"),
      build: fakeRemixBuild
    });
    const approval = mintPublishApproval({
      confirmed: true,
      candidateDigest: prepared.candidateDigest,
      adapterId: prepared.adapterId,
      targetDigest: prepared.targetDigest
    });
    fs.writeFileSync(path.join(prepared.bundleDir, "source.tdpack"), "tampered archive\n", "utf8");
    const runtime = { upload: vi.fn(), verify: vi.fn() };

    await expect(publishPreparedCandidate({ prepared, approval, adapterRuntime: runtime }))
      .rejects.toThrow(/source|archive|pack|invalid|truncated|digest|mismatch/i);
    expect(runtime.upload).not.toHaveBeenCalled();
    expect(fs.existsSync(prepared.stagingDir)).toBe(false);
  });

  it("re-inspects source.tdpack after filesystem copy and rolls back a corrupted destination", async () => {
    const publishTarget = target("filesystem_v1");
    const prepared = await preparePublishCandidate({
      projectDir,
      adapterId: "filesystem_v1",
      target: publishTarget,
      build: fakeRemixBuild
    });
    const approval = mintPublishApproval({
      confirmed: true,
      candidateDigest: prepared.candidateDigest,
      adapterId: prepared.adapterId,
      targetDigest: prepared.targetDigest
    });
    const originalCopy = fs.cpSync.bind(fs);
    vi.spyOn(fs, "cpSync").mockImplementation((source, destination, options) => {
      originalCopy(source, destination, options);
      fs.writeFileSync(path.join(destination, "source.tdpack"), "corrupted after copy\n", "utf8");
    });

    await expect(publishPreparedCandidate({ prepared, approval }))
      .rejects.toThrow(/source|archive|pack|invalid|truncated|digest|mismatch/i);
    expect(fs.existsSync(publishTarget.directory)).toBe(false);
  });

  it("requires an independent non-filesystem verifier and ignores upload digest claims", async () => {
    const prepare = () => preparePublishCandidate({
      projectDir,
      adapterId: "cloudflare_pages_v1",
      target: target("cloudflare_pages_v1"),
      build: fakeReproducibleBuild
    });
    const approvalInput = (prepared) => mintPublishApproval({
      confirmed: true,
      candidateDigest: prepared.candidateDigest,
      adapterId: prepared.adapterId,
      targetDigest: prepared.targetDigest
    });
    const preparedWithoutVerifier = await prepare();
    const upload = vi.fn(async () => ({ remoteDigest: preparedWithoutVerifier.candidateDigest, uploadId: "untrusted" }));

    await expect(publishPreparedCandidate({
      prepared: preparedWithoutVerifier,
      approval: approvalInput(preparedWithoutVerifier),
      adapterRuntime: { upload }
    }))
      .rejects.toThrow(/verify|verification|provider runtime/i);
    expect(upload).not.toHaveBeenCalled();

    const preparedMismatch = await prepare();
    const verifyMismatch = vi.fn(async () => ({ remoteDigest: "f".repeat(64) }));
    await expect(publishPreparedCandidate({
      prepared: preparedMismatch,
      approval: approvalInput(preparedMismatch),
      adapterRuntime: { upload, verify: verifyMismatch }
    })).rejects.toThrow(/remote|verification|digest|mismatch/i);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(verifyMismatch).toHaveBeenCalledWith(expect.objectContaining({
      target: preparedMismatch.target,
      candidateDigest: preparedMismatch.candidateDigest,
      manifest: preparedMismatch.manifest
    }));

    const preparedSuccess = await prepare();
    const verifySuccess = vi.fn(async () => ({ remoteDigest: preparedSuccess.candidateDigest }));
    await expect(publishPreparedCandidate({
      prepared: preparedSuccess,
      approval: approvalInput(preparedSuccess),
      adapterRuntime: {
        upload: vi.fn(async () => ({ remoteDigest: "0".repeat(64), uploadId: "claim-is-ignored" })),
        verify: verifySuccess
      }
    })).resolves.toMatchObject({ ok: true, verified: true });
  });

  it("explicitly discards an abandoned prepared candidate without touching the source", async () => {
    const before = treeDigest(projectDir);
    const prepared = await preparePublishCandidate({
      projectDir,
      adapterId: "filesystem_v1",
      target: target("filesystem_v1"),
      build: fakeReproducibleBuild
    });
    expect(fs.existsSync(prepared.stagingDir)).toBe(true);
    expect(discardPreparedPublishCandidate(prepared)).toBe(true);
    expect(discardPreparedPublishCandidate(prepared)).toBe(false);
    expect(fs.existsSync(prepared.stagingDir)).toBe(false);
    expect(treeDigest(projectDir)).toBe(before);
  });

  it.runIf(process.platform !== "win32")("rejects FIFO/special bundle entries before reading them", async () => {
    await expect(preparePublishCandidate({
      projectDir,
      adapterId: "filesystem_v1",
      target: target("filesystem_v1"),
      build: async ({ stagingDir }) => {
        const bundleDir = path.join(stagingDir, "bundle");
        fs.mkdirSync(bundleDir, { recursive: true });
        execFileSync("mkfifo", [path.join(bundleDir, "blocked.pipe")]);
        return {
          bundleDir,
          engine: { version: "towerforge-sim-v2", digest: "1".repeat(64) },
          content: { digest: "2".repeat(64) },
          capabilities: []
        };
      }
    })).rejects.toThrow(/special|unsupported|bundle/i);
  });

  it("rejects a bundle deeper than the bounded digest traversal", async () => {
    await expect(preparePublishCandidate({
      projectDir,
      adapterId: "filesystem_v1",
      target: target("filesystem_v1"),
      build: async ({ stagingDir }) => {
        const bundleDir = path.join(stagingDir, "bundle");
        let cursor = bundleDir;
        for (let index = 0; index < 34; index += 1) cursor = path.join(cursor, "d");
        fs.mkdirSync(cursor, { recursive: true });
        fs.writeFileSync(path.join(cursor, "file.txt"), "bounded\n", "utf8");
        return {
          bundleDir,
          engine: { version: "towerforge-sim-v2", digest: "1".repeat(64) },
          content: { digest: "2".repeat(64) },
          capabilities: []
        };
      }
    })).rejects.toThrow(/depth|limit|bundle/i);
  });

  it("accepts one exact embedded publish manifest without rebuilding its engine/content semantics", async () => {
    const projectPath = path.join(projectDir, "project.json");
    const project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
    fs.writeFileSync(projectPath, `${JSON.stringify({ ...project, schemaVersion: 4 }, null, 2)}\n`, "utf8");
    const distribution = {
      schemaVersion: 1,
      projectId: "tfp_0123456789abcdef0123456789abcdef",
      license: { spdxId: "ARR", attribution: "Project author" },
      remix: { policy: "forbidden", includeSource: false }
    };
    fs.writeFileSync(path.join(projectDir, "content", "distribution.json"), `${JSON.stringify(distribution, null, 2)}\n`, "utf8");
    const sourceDigest = computeRemixSourcePackDigestV2(projectDir);
    let exactManifest;
    const prepared = await preparePublishCandidate({
      projectDir,
      adapterId: "filesystem_v1",
      target: target("filesystem_v1"),
      build: async (input) => {
        const built = await fakeReproducibleBuild(input);
        exactManifest = buildPublishManifestV1({
          distribution,
          engine: built.engine,
          content: built.content,
          bundle: built.bundle,
          capabilities: built.capabilities,
          sourcePack: { digest: sourceDigest }
        });
        return { bundleDir: built.bundleDir, publishManifest: exactManifest };
      }
    });
    expect(prepared.manifest).toEqual(exactManifest);
    expect(JSON.stringify(prepared.manifest)).toBe(JSON.stringify(exactManifest));
    expect(discardPreparedPublishCandidate(prepared)).toBe(true);
  });
});
