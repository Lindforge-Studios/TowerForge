import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPublishManifestV1, computePublishCandidateDigestV1 } from "../../../distribution/src/index.mjs";
import { createCloudflarePagesRuntimeV1, createGitHubPagesRuntimeV1 } from "./provider-runtimes.mjs";

let tempDir;
let bundleDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r17-provider-runtime-"));
  bundleDir = path.join(tempDir, "bundle");
  fs.mkdirSync(bundleDir);
  fs.writeFileSync(path.join(bundleDir, "index.html"), "<!doctype html><title>Runtime</title>\n", "utf8");
});

afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }));

function manifest() {
  return buildPublishManifestV1({
    distribution: {
      schemaVersion: 1,
      projectId: "tfp_0123456789abcdef0123456789abcdef",
      license: { spdxId: "ARR", attribution: "Runtime author" },
      remix: { policy: "forbidden", includeSource: false }
    },
    engine: { version: "towerforge-sim-v2", digest: "1".repeat(64) },
    content: { digest: "2".repeat(64) },
    bundle: { digest: "3".repeat(64) },
    capabilities: [],
    sourcePack: { digest: "4".repeat(64) }
  });
}

function jsonResponse(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => value };
}

function bytesResponse(bytes, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  };
}

function gitBlobSha(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

describe("R17 concrete provider runtimes", () => {
  it("uploads GitHub git objects and independently reads the committed authenticated marker", async () => {
    fs.mkdirSync(path.join(bundleDir, "assets"));
    fs.writeFileSync(path.join(bundleDir, "assets", "icon.txt"), "nested asset\n", "utf8");
    const publishManifest = manifest();
    const candidateDigest = computePublishCandidateDigestV1(publishManifest);
    let committedTree = [];
    let createdTreeBody;
    const fetch = vi.fn(async (url, init = {}) => {
      expect(init.headers?.Authorization).toBe("Bearer github-runtime-secret");
      if (url.endsWith("/git/blobs")) {
        const body = JSON.parse(init.body);
        const bytes = Buffer.from(body.content, "base64");
        return jsonResponse({ sha: gitBlobSha(bytes) });
      }
      if (url.includes("/git/ref/heads/")) return jsonResponse({ object: { sha: "parent-sha" } });
      if (url.endsWith("/git/commits/parent-sha")) return jsonResponse({ tree: { sha: "base-tree" } });
      if (url.includes("/git/trees/base-tree")) return jsonResponse({ truncated: false, tree: [
        { path: "outside/keep.txt", type: "blob", sha: "outside-sha" },
        { path: "demo", type: "tree", sha: "demo-tree-sha" },
        { path: "demo/assets", type: "tree", sha: "assets-tree-sha" },
        { path: "demo/stale.txt", type: "blob", sha: "stale-sha" }
      ] });
      if (url.endsWith("/git/trees")) {
        createdTreeBody = JSON.parse(init.body);
        committedTree = createdTreeBody.tree.filter((entry) => entry.sha !== null);
        return jsonResponse({ sha: "tree-sha" });
      }
      if (url.endsWith("/git/commits")) return jsonResponse({ sha: "commit-sha" });
      if (url.includes("/git/refs/heads/")) return jsonResponse({ object: { sha: "commit-sha" } });
      if (url.endsWith("/git/commits/commit-sha")) return jsonResponse({ tree: { sha: "tree-sha" } });
      if (url.includes("/git/trees/tree-sha")) return jsonResponse({ truncated: false, tree: [
        { path: "demo", type: "tree", sha: "demo-tree-sha" },
        { path: "demo/assets", type: "tree", sha: "assets-tree-sha" },
        ...committedTree
      ] });
      throw new Error(`unexpected GitHub request ${url}`);
    });
    const runtime = createGitHubPagesRuntimeV1({ fetch, token: "github-runtime-secret" });
    const request = {
      target: { owner: "lindforge", repository: "game", branch: "gh-pages", pathPrefix: "demo" },
      bundleDir,
      candidateDigest,
      manifest: publishManifest
    };
    const receipt = await runtime.upload(request);
    expect(receipt).toEqual({ provider: "github_pages_v1", commitSha: "commit-sha" });
    expect(createdTreeBody.base_tree).toBe("base-tree");
    expect(createdTreeBody.tree).toContainEqual({ path: "demo/stale.txt", mode: "100644", type: "blob", sha: null });
    expect(createdTreeBody.tree.some((entry) => entry.path === "demo" && entry.sha === null)).toBe(false);
    expect(createdTreeBody.tree.some((entry) => entry.path === "demo/assets" && entry.sha === null)).toBe(false);
    expect(createdTreeBody.tree.some((entry) => entry.path === "outside/keep.txt")).toBe(false);
    await expect(runtime.verify({ ...request, receipt })).resolves.toEqual({ remoteDigest: candidateDigest });
    expect(JSON.stringify(receipt)).not.toContain("github-runtime-secret");
    expect(fetch.mock.calls.some(([url]) => String(url).includes("/git/commits/commit-sha"))).toBe(true);
    expect(fetch.mock.calls.some(([url]) => String(url).includes("/git/trees/tree-sha"))).toBe(true);
  });

  it.each(["corrupted", "missing"])("rejects a %s GitHub asset instead of trusting the marker", async (mode) => {
    const publishManifest = manifest();
    const candidateDigest = computePublishCandidateDigestV1(publishManifest);
    const indexBytes = fs.readFileSync(path.join(bundleDir, "index.html"));
    const markerBytes = Buffer.from(`${JSON.stringify({ schemaVersion: 1, candidateDigest, manifest: publishManifest })}\n`, "utf8");
    const tree = [
      ...(mode === "missing" ? [] : [{ path: "demo/index.html", type: "blob", sha: "f".repeat(40) }]),
      { path: "demo/towerforge-publish-manifest.json", type: "blob", sha: gitBlobSha(markerBytes) }
    ];
    const fetch = vi.fn(async (url, init = {}) => {
      expect(init.headers?.Authorization).toBe("Bearer github-runtime-secret");
      if (String(url).includes("/git/commits/commit-sha")) return jsonResponse({ tree: { sha: "tree-sha" } });
      if (String(url).includes("/git/trees/tree-sha")) return jsonResponse({ truncated: false, tree });
      throw new Error(`unexpected GitHub request ${url}`);
    });
    const runtime = createGitHubPagesRuntimeV1({ fetch, token: "github-runtime-secret" });
    await expect(runtime.verify({
      target: { owner: "lindforge", repository: "game", branch: "gh-pages", pathPrefix: "demo" },
      bundleDir,
      candidateDigest,
      manifest: publishManifest,
      receipt: { commitSha: "commit-sha" }
    })).rejects.toThrow(/asset|missing|mismatch|stale/i);
    expect(gitBlobSha(indexBytes)).not.toBe("f".repeat(40));
  });

  it("uses Cloudflare direct upload and a separate authenticated pages.dev marker read", async () => {
    const publishManifest = manifest();
    const candidateDigest = computePublishCandidateDigestV1(publishManifest);
    const markerBytes = Buffer.from(`${JSON.stringify({ schemaVersion: 1, candidateDigest, manifest: publishManifest })}\n`, "utf8");
    const indexBytes = fs.readFileSync(path.join(bundleDir, "index.html"));
    const fetch = vi.fn(async (url, init = {}) => {
      if (String(url).includes("api.cloudflare.com")) {
        expect(init.headers?.Authorization).toBe("Bearer cloudflare-runtime-secret");
        expect(init.method).toBe("POST");
        expect(init.body).toBeInstanceOf(FormData);
        return jsonResponse({ result: { id: "deployment-id", url: "https://deployment.game.pages.dev" } });
      }
      expect(init.headers?.Authorization).toBeUndefined();
      if (url === "https://deployment.game.pages.dev/index.html") return bytesResponse(indexBytes);
      if (url === "https://deployment.game.pages.dev/towerforge-publish-manifest.json") return bytesResponse(markerBytes);
      throw new Error(`unexpected Cloudflare request ${url}`);
    });
    const runtime = createCloudflarePagesRuntimeV1({ fetch, token: "cloudflare-runtime-secret" });
    const request = {
      target: { accountId: "account-id", projectName: "game" },
      bundleDir,
      candidateDigest,
      manifest: publishManifest
    };
    const receipt = await runtime.upload(request);
    expect(receipt).toEqual({
      provider: "cloudflare_pages_v1",
      deploymentId: "deployment-id",
      deploymentUrl: "https://deployment.game.pages.dev"
    });
    await expect(runtime.verify({ ...request, receipt })).resolves.toEqual({ remoteDigest: candidateDigest });
    expect(JSON.stringify(receipt)).not.toContain("cloudflare-runtime-secret");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("rejects a corrupted Cloudflare asset and never sends the provider token to pages.dev", async () => {
    const publishManifest = manifest();
    const candidateDigest = computePublishCandidateDigestV1(publishManifest);
    const markerBytes = Buffer.from(`${JSON.stringify({ schemaVersion: 1, candidateDigest, manifest: publishManifest })}\n`, "utf8");
    const fetch = vi.fn(async (url, init = {}) => {
      if (String(url).includes("api.cloudflare.com")) {
        expect(init.headers?.Authorization).toBe("Bearer cloudflare-runtime-secret");
        return jsonResponse({ result: { id: "deployment-id", url: "https://deployment.game.pages.dev" } });
      }
      expect(init.headers?.Authorization).toBeUndefined();
      if (url === "https://deployment.game.pages.dev/index.html") return bytesResponse(Buffer.from("corrupted"));
      return bytesResponse(markerBytes);
    });
    const runtime = createCloudflarePagesRuntimeV1({ fetch, token: "cloudflare-runtime-secret" });
    const request = {
      target: { accountId: "account-id", projectName: "game" }, bundleDir, candidateDigest, manifest: publishManifest
    };
    const receipt = await runtime.upload(request);
    await expect(runtime.verify({ ...request, receipt })).rejects.toThrow(/asset|digest|mismatch/i);
  });
});
import { createHash } from "node:crypto";
