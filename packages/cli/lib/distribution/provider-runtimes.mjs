import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { computePublishCandidateDigestV1, normalizePublishManifestV1 } from "../../../distribution/src/index.mjs";

const MARKER_NAME = "towerforge-publish-manifest.json";
const MAX_FILES = 5_000;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_DEPTH = 32;

export function createGitHubPagesRuntimeV1(options = {}) {
  const fetchImpl = requireFetch(options.fetch);
  const token = requireToken(options.token);
  const headers = () => ({
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28"
  });
  return Object.freeze({
    async upload(request) {
      const target = requireGitHubTarget(request.target);
      const base = `https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repository)}`;
      const files = expectedPublishedFiles(request);
      files.sort((left, right) => binaryCompare(left.path, right.path));
      const refUrl = `${base}/git/ref/heads/${encodeURIComponent(target.branch)}`;
      const refResponse = await fetchImpl(refUrl, { method: "GET", headers: headers() });
      let parentSha;
      let baseTreeSha;
      let parentTree = [];
      if (refResponse.status !== 404) {
        const ref = await responseJson(refResponse, "GitHub branch read");
        parentSha = ref?.object?.sha;
        requireProviderId(parentSha, "GitHub parent commit sha");
        const parentCommit = await jsonRequest(fetchImpl, `${base}/git/commits/${encodeURIComponent(parentSha)}`, {
          method: "GET", headers: headers()
        }, "GitHub parent commit read");
        baseTreeSha = parentCommit?.tree?.sha;
        requireProviderId(baseTreeSha, "GitHub base tree sha");
        parentTree = await readGitHubTree(fetchImpl, base, baseTreeSha, headers());
      }
      const tree = [];
      for (const file of files) {
        const blob = await jsonRequest(fetchImpl, `${base}/git/blobs`, {
          method: "POST",
          headers: { ...headers(), "Content-Type": "application/json" },
          body: JSON.stringify({ content: file.bytes.toString("base64"), encoding: "base64" })
        }, "GitHub blob upload");
        requireProviderId(blob.sha, "GitHub blob sha");
        const expectedSha = gitBlobSha(file.bytes);
        if (blob.sha !== expectedSha) throw new Error("GitHub blob content-address verification mismatch.");
        tree.push({ path: prefixedPath(target.pathPrefix, file.path), mode: "100644", type: "blob", sha: expectedSha });
      }
      const desired = new Set(tree.map((entry) => entry.path));
      for (const entry of parentTree) {
        if (entry.type !== "tree" && pathBelongsToPrefix(entry.path, target.pathPrefix) && !desired.has(entry.path)) {
          tree.push({
            path: entry.path,
            mode: entry.mode ?? (entry.type === "commit" ? "160000" : "100644"),
            type: entry.type,
            sha: null
          });
        }
      }
      const treeResult = await jsonRequest(fetchImpl, `${base}/git/trees`, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ ...(baseTreeSha ? { base_tree: baseTreeSha } : {}), tree })
      }, "GitHub tree upload");
      requireProviderId(treeResult.sha, "GitHub tree sha");
      const commit = await jsonRequest(fetchImpl, `${base}/git/commits`, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `TowerForge publish ${request.candidateDigest}`,
          tree: treeResult.sha,
          parents: parentSha ? [parentSha] : []
        })
      }, "GitHub commit upload");
      requireProviderId(commit.sha, "GitHub commit sha");
      if (parentSha) {
        await jsonRequest(fetchImpl, `${base}/git/refs/heads/${encodeURIComponent(target.branch)}`, {
          method: "PATCH",
          headers: { ...headers(), "Content-Type": "application/json" },
          body: JSON.stringify({ sha: commit.sha, force: false })
        }, "GitHub branch update");
      } else {
        await jsonRequest(fetchImpl, `${base}/git/refs`, {
          method: "POST",
          headers: { ...headers(), "Content-Type": "application/json" },
          body: JSON.stringify({ ref: `refs/heads/${target.branch}`, sha: commit.sha })
        }, "GitHub branch creation");
      }
      return Object.freeze({ provider: "github_pages_v1", commitSha: commit.sha });
    },
    async verify(request) {
      const target = requireGitHubTarget(request.target);
      const commitSha = request.receipt?.commitSha;
      requireProviderId(commitSha, "GitHub verification commit sha");
      const base = `https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repository)}`;
      const commit = await jsonRequest(fetchImpl, `${base}/git/commits/${encodeURIComponent(commitSha)}`, {
        method: "GET", headers: headers()
      }, "GitHub committed tree verification");
      const treeSha = commit?.tree?.sha;
      requireProviderId(treeSha, "GitHub verification tree sha");
      const remoteTree = await readGitHubTree(fetchImpl, base, treeSha, headers());
      const expected = expectedPublishedFiles(request).map((file) => ({
        path: prefixedPath(target.pathPrefix, file.path),
        sha: gitBlobSha(file.bytes),
        bytes: file.bytes
      })).sort((left, right) => binaryCompare(left.path, right.path));
      const actual = remoteTree
        .filter((entry) => entry.type !== "tree" && pathBelongsToPrefix(entry.path, target.pathPrefix))
        .sort((left, right) => binaryCompare(left.path, right.path));
      if (actual.length !== expected.length) throw new Error("GitHub remote asset set is missing files or contains stale files.");
      for (let index = 0; index < expected.length; index += 1) {
        if (actual[index].path !== expected[index].path || actual[index].type !== "blob" || actual[index].sha !== expected[index].sha) {
          throw new Error(`GitHub remote asset verification mismatch at "${expected[index].path}".`);
        }
      }
      const marker = expected.find((entry) => entry.path === prefixedPath(target.pathPrefix, MARKER_NAME));
      return verifyMarker(marker.bytes, request);
    }
  });
}

export function createCloudflarePagesRuntimeV1(options = {}) {
  const fetchImpl = requireFetch(options.fetch);
  const token = requireToken(options.token);
  const authHeaders = () => ({ Authorization: `Bearer ${token}` });
  return Object.freeze({
    async upload(request) {
      const target = requireCloudflareTarget(request.target);
      const files = expectedPublishedFiles(request);
      files.sort((left, right) => binaryCompare(left.path, right.path));
      const form = new FormData();
      const manifest = {};
      for (const file of files) {
        manifest[`/${file.path}`] = file.digest;
        form.append(file.digest, new Blob([file.bytes]), file.path);
      }
      form.append("manifest", JSON.stringify(manifest));
      const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(target.accountId)}/pages/projects/${encodeURIComponent(target.projectName)}/deployments`;
      const response = await jsonRequest(fetchImpl, endpoint, {
        method: "POST",
        headers: authHeaders(),
        body: form
      }, "Cloudflare Pages upload");
      const deployment = response.result ?? response;
      requireProviderId(deployment.id, "Cloudflare deployment id");
      const deploymentUrl = requirePagesUrl(deployment.url);
      return Object.freeze({ provider: "cloudflare_pages_v1", deploymentId: deployment.id, deploymentUrl });
    },
    async verify(request) {
      const deploymentUrl = requirePagesUrl(request.receipt?.deploymentUrl);
      const files = expectedPublishedFiles(request).sort((left, right) => binaryCompare(left.path, right.path));
      let markerBytes;
      for (const file of files) {
        const remoteUrl = new URL(file.path.split("/").map(encodeURIComponent).join("/"), `${deploymentUrl}/`).href;
        // The deployment hostname is public content. Provider API credentials must never cross
        // from api.cloudflare.com to pages.dev.
        const response = await fetchImpl(remoteUrl, { method: "GET" });
        if (!response?.ok) throw new Error(`Cloudflare remote asset verification failed for "${file.path}" (${String(response?.status)}).`);
        const bytes = Buffer.from(new Uint8Array(await response.arrayBuffer()));
        if (sha256(bytes) !== file.digest) throw new Error(`Cloudflare remote asset digest mismatch for "${file.path}".`);
        if (file.path === MARKER_NAME) markerBytes = bytes;
      }
      return verifyMarker(markerBytes, request);
    }
  });
}

function markerFile(candidateDigest, manifest) {
  const bytes = Buffer.from(`${JSON.stringify({ schemaVersion: 1, candidateDigest, manifest })}\n`, "utf8");
  return { path: MARKER_NAME, bytes, digest: sha256(bytes) };
}

function expectedPublishedFiles(request) {
  const files = collectBundleFiles(request.bundleDir);
  if (files.some((file) => file.path === MARKER_NAME)) throw new Error(`Publish bundle uses reserved path "${MARKER_NAME}".`);
  files.push(markerFile(request.candidateDigest, request.manifest));
  return files;
}

function verifyMarker(bytes, request) {
  let marker;
  try { marker = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("Remote TowerForge publish marker is malformed."); }
  if (marker?.schemaVersion !== 1 || marker?.candidateDigest !== request.candidateDigest) throw new Error("Remote TowerForge publish marker candidate mismatch.");
  const manifest = normalizePublishManifestV1(marker.manifest);
  if (computePublishCandidateDigestV1(manifest) !== request.candidateDigest
    || JSON.stringify(manifest) !== JSON.stringify(request.manifest)) {
    throw new Error("Remote TowerForge publish manifest verification mismatch.");
  }
  return Object.freeze({ remoteDigest: request.candidateDigest });
}

function collectBundleFiles(root) {
  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("Provider bundle root must be a real directory, not a symbolic link or special entry.");
  const resolved = fs.realpathSync(root);
  const output = [];
  let total = 0;
  const walk = (directory, depth) => {
    if (depth > MAX_DEPTH) throw new Error("Provider bundle exceeds directory-depth limit.");
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => binaryCompare(a.name, b.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Provider bundle must not contain symbolic links.");
      if (entry.isDirectory()) walk(absolute, depth + 1);
      else if (entry.isFile()) {
        const stat = fs.lstatSync(absolute);
        if (stat.size > MAX_FILE_BYTES) throw new Error("Provider bundle file exceeds size limit.");
        if (output.length + 1 > MAX_FILES) throw new Error("Provider bundle exceeds file-count limit.");
        total += stat.size;
        if (total > MAX_TOTAL_BYTES) throw new Error("Provider bundle exceeds total-byte limit.");
        const bytes = fs.readFileSync(absolute);
        output.push({
          path: path.relative(resolved, absolute).split(path.sep).join("/"),
          bytes,
          digest: sha256(bytes)
        });
      } else throw new Error("Provider bundle contains a special filesystem entry.");
    }
  };
  walk(resolved, 0);
  return output;
}

async function readGitHubTree(fetchImpl, base, treeSha, headers) {
  const response = await jsonRequest(fetchImpl, `${base}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`, {
    method: "GET", headers
  }, "GitHub tree read");
  if (response.truncated === true || !Array.isArray(response.tree)) throw new Error("GitHub tree read is truncated or malformed.");
  const seen = new Set();
  const output = [];
  for (const input of response.tree) {
    if (!input || typeof input.path !== "string" || typeof input.type !== "string" || typeof input.sha !== "string") {
      throw new Error("GitHub tree contains a malformed entry.");
    }
    if (seen.has(input.path)) throw new Error("GitHub tree contains duplicate paths.");
    seen.add(input.path);
    if (!new Set(["blob", "tree", "commit"]).has(input.type)) throw new Error("GitHub tree contains an unsupported entry type.");
    if (input.mode !== undefined && typeof input.mode !== "string") throw new Error("GitHub tree contains a malformed mode.");
    output.push({ path: input.path, type: input.type, sha: input.sha, ...(input.mode ? { mode: input.mode } : {}) });
  }
  return output.sort((left, right) => binaryCompare(left.path, right.path));
}

function pathBelongsToPrefix(value, prefix) {
  return prefix === "" || value === prefix || value.startsWith(`${prefix}/`);
}

function gitBlobSha(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function prefixedPath(prefix, relative) {
  return prefix ? `${prefix}/${relative}` : relative;
}

function requireGitHubTarget(value) {
  if (!value || typeof value !== "object") throw new Error("GitHub Pages target is invalid.");
  return value;
}

function requireCloudflareTarget(value) {
  if (!value || typeof value !== "object") throw new Error("Cloudflare Pages target is invalid.");
  return value;
}

function requireFetch(value) {
  if (typeof value !== "function") throw new Error("Provider runtime requires an injected fetch implementation.");
  return value;
}

function requireToken(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 16_384) throw new Error("Provider runtime token is unavailable.");
  return value;
}

function requireProviderId(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,256}$/.test(value)) throw new Error(`${label} is invalid.`);
}

function requirePagesUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Cloudflare deployment URL is invalid."); }
  if (url.protocol !== "https:" || !(url.hostname === "pages.dev" || url.hostname.endsWith(".pages.dev")) || url.username || url.password || url.port) {
    throw new Error("Cloudflare deployment URL is outside the pages.dev boundary.");
  }
  return url.href.replace(/\/$/, "");
}

async function jsonRequest(fetchImpl, url, init, label) {
  return responseJson(await fetchImpl(url, init), label);
}

async function responseJson(response, label) {
  if (!response?.ok) throw new Error(`${label} failed (${String(response?.status)}).`);
  try { return await response.json(); }
  catch { throw new Error(`${label} returned invalid JSON.`); }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function binaryCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
