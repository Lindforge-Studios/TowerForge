import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  buildPublishManifestV1,
  computePublishCandidateDigestV1,
  normalizeDistributionConfigV1,
  normalizePublishManifestV1
} from "../../../distribution/src/index.mjs";
import { loadProjectFiles } from "../project-loader.mjs";
import {
  computeRemixSourcePackDigestV2,
  exportRemixSourcePackV2,
  importRemixSourcePackV2,
  inspectRemixSourcePackV2
} from "./remix-pack.mjs";

export { computeRemixSourcePackDigestV2, exportRemixSourcePackV2, importRemixSourcePackV2, inspectRemixSourcePackV2 };
export { createCloudflarePagesRuntimeV1, createGitHubPagesRuntimeV1 } from "./provider-runtimes.mjs";
export {
  applyDistributionConfigV1,
  previewDistributionConfigV1,
  readDistributionConfigV1
} from "./project-authoring.mjs";

const ADAPTERS = new Set(["filesystem_v1", "github_pages_v1", "cloudflare_pages_v1"]);
const APPROVAL_TTL_MS = 10 * 60 * 1000;
const PREPARED_TTL_MS = 10 * 60 * 1000;
const MAX_APPROVALS = 256;
const MAX_PREPARED = 32;
const APPROVALS = new Map();
const PREPARED = new Map();
let PREPARED_IN_FLIGHT = 0;
const SHA256 = /^[a-f0-9]{64}$/;
const SOURCE_PACK_NAME = "source.tdpack";
const BUNDLE_LIMITS = Object.freeze({ maximumDepth: 32, maximumFiles: 5_000, maximumFileBytes: 100 * 1024 * 1024, maximumTotalBytes: 512 * 1024 * 1024 });

export async function previewPublishCandidate({ projectDir, adapterId, target }) {
  requireProjectDirectory(projectDir);
  const normalizedTarget = normalizeTarget(adapterId, target);
  return Object.freeze({
    schemaVersion: 1,
    adapterId,
    sideEffect: "none",
    requiresExplicitConfirmation: true,
    targetDigest: digestCanonical(normalizedTarget)
  });
}

export async function preparePublishCandidate({ projectDir, adapterId, target, build }) {
  if (typeof build !== "function") throw new Error("A reproducible publish build adapter is required.");
  prunePrepared();
  if (PREPARED.size + PREPARED_IN_FLIGHT >= MAX_PREPARED) throw new Error("Too many prepared publish candidates are awaiting confirmation.");
  PREPARED_IN_FLIGHT += 1;
  try {
    return await prepareReservedPublishCandidate({ projectDir, adapterId, target, build });
  } finally {
    PREPARED_IN_FLIGHT -= 1;
  }
}

async function prepareReservedPublishCandidate({ projectDir, adapterId, target, build }) {
  const preview = await previewPublishCandidate({ projectDir, adapterId, target });
  const stagingRoot = confinedStagingRoot(projectDir);
  fs.mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
  const stagingDir = fs.mkdtempSync(path.join(stagingRoot, "candidate-"));
  try { fs.chmodSync(stagingDir, 0o700); } catch { /* best effort on platforms without POSIX modes */ }
  let built;
  try {
    built = await build({ projectDir: path.resolve(projectDir), stagingDir });
    const bundleDir = requireBundleDirectory(stagingDir, built?.bundleDir);
    const bundleDigest = digestTree(bundleDir);
    const declaredBundleDigest = built?.bundle?.digest;
    if (declaredBundleDigest !== undefined && !SHA256.test(declaredBundleDigest)) {
      throw new Error("Publish build returned a malformed bundle digest.");
    }
    if (declaredBundleDigest !== undefined && declaredBundleDigest !== bundleDigest) {
      throw new Error("Publish build declared bundle digest does not match staged bundle bytes.");
    }
    const files = loadProjectFiles(projectDir);
    const distribution = files.distributionAuthored
      ? normalizeDistributionConfigV1(files.distribution)
      : ephemeralDistribution(files, projectDir);
    const stagedSourcePack = inspectOptionalSourcePack(bundleDir);
    const embeddedInput = built?.publishManifest ?? built?.manifest ?? stagedSourcePack?.publishManifest;
    if (built?.publishManifest !== undefined && built?.manifest !== undefined
      && JSON.stringify(built.publishManifest) !== JSON.stringify(built.manifest)) {
      throw new Error("Publish build returned conflicting embedded manifests.");
    }
    const sourceEntriesDigest = computeRemixSourcePackDigestV2(projectDir);
    const manifest = embeddedInput === undefined
      ? buildPublishManifestV1({
        distribution,
        engine: requireEngineDescriptor(built?.engine),
        content: requireDigestDescriptor(built?.content, "content"),
        bundle: { digest: bundleDigest },
        capabilities: Array.isArray(built?.capabilities) ? built.capabilities : [],
        sourcePack: resolveSourcePackDescriptor(built?.sourcePack, sourceEntriesDigest)
      })
      : validateEmbeddedManifest(embeddedInput, distribution, bundleDigest, sourceEntriesDigest);
    validateBundleSourcePack(bundleDir, manifest, stagedSourcePack);
    const candidateDigest = computePublishCandidateDigestV1(manifest);
    const prepared = Object.freeze({
      schemaVersion: 1,
      adapterId,
      target: normalizeTarget(adapterId, target),
      targetDigest: preview.targetDigest,
      candidateDigest,
      manifest,
      bundleDir,
      stagingDir
    });
    PREPARED.set(stagingDir, {
      candidateDigest,
      bundleDir,
      stagingRealPath: fs.realpathSync(stagingDir),
      stagingIdentity: directoryIdentity(stagingDir),
      bundleRealPath: fs.realpathSync(bundleDir),
      bundleIdentity: directoryIdentity(bundleDir),
      expiresAt: Date.now() + PREPARED_TTL_MS
    });
    return prepared;
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

export function mintPublishApproval({ confirmed, candidateDigest, adapterId, targetDigest }) {
  if (confirmed !== true) throw new Error("Explicit publish confirmation is required before minting approval.");
  requireDigest(candidateDigest, "candidate");
  requireAdapterId(adapterId);
  requireDigest(targetDigest, "target");
  pruneApprovals();
  if (APPROVALS.size >= MAX_APPROVALS) throw new Error("Too many publish approvals are awaiting use.");
  const token = randomUUID();
  const approval = Object.freeze({
    schemaVersion: 1,
    token,
    candidateDigest,
    adapterId,
    targetDigest
  });
  APPROVALS.set(token, {
    candidateDigest,
    adapterId,
    targetDigest,
    expiresAt: Date.now() + APPROVAL_TTL_MS
  });
  return approval;
}

export async function publishPreparedCandidate({ prepared, approval, adapterRuntime }) {
  let candidate;
  try {
    candidate = requirePrepared(prepared);
  } catch (error) {
    if (typeof approval?.token === "string") APPROVALS.delete(approval.token);
    discardPreparedPublishCandidate(prepared);
    throw error;
  }
  const granted = requireApproval(approval, candidate);
  // An accepted human confirmation authorizes exactly one upload attempt, not one successful
  // upload. Consume before crossing the provider boundary so retries after partial/failing remote
  // work always require a fresh explicit confirmation.
  APPROVALS.delete(granted.token);
  const runtime = adapterRuntime ?? {};
  try {
    if (digestTree(candidate.bundleDir) !== candidate.manifest.bundle.digest) {
      throw new Error("Prepared publish bundle digest mismatch; staged bytes changed after preparation.");
    }
    validateBundleSourcePack(candidate.bundleDir, candidate.manifest);
    let verification;
    if (typeof runtime.upload === "function") {
      if (typeof runtime.verify !== "function") {
        throw new Error(`Provider runtime for ${candidate.adapterId} requires an independent verify callback.`);
      }
      const request = {
        adapterId: candidate.adapterId,
        target: candidate.target,
        candidateDigest: candidate.candidateDigest,
        manifest: candidate.manifest,
        bundleDir: candidate.bundleDir
      };
      const receipt = await runtime.upload(request);
      verification = await runtime.verify({ ...request, receipt });
    } else if (candidate.adapterId === "filesystem_v1") {
      verification = await publishFilesystem(candidate);
    } else {
      throw new Error(`Provider runtime for ${candidate.adapterId} is unavailable or not authenticated.`);
    }
    if (verification?.remoteDigest !== candidate.candidateDigest) {
      throw new Error("Remote publish verification digest mismatch.");
    }
    return Object.freeze({
      ok: true,
      verified: true,
      adapterId: candidate.adapterId,
      candidateDigest: candidate.candidateDigest,
      remoteDigest: verification.remoteDigest
    });
  } finally {
    discardPreparedPublishCandidate(candidate);
  }
}

export function discardPreparedPublishCandidate(prepared) {
  if (!prepared || typeof prepared !== "object" || typeof prepared.candidateDigest !== "string") return false;
  const registered = PREPARED.get(prepared.stagingDir);
  if (!registered || registered.candidateDigest !== prepared.candidateDigest || registered.bundleDir !== prepared.bundleDir) return false;
  PREPARED.delete(prepared.stagingDir);
  fs.rmSync(prepared.stagingDir, { recursive: true, force: true });
  return true;
}

function requireApproval(approval, candidate) {
  if (!approval || typeof approval !== "object") throw new Error("Publish approval is required.");
  pruneApprovals();
  const stored = typeof approval.token === "string" ? APPROVALS.get(approval.token) : undefined;
  if (!stored || stored.expiresAt < Date.now()) throw new Error("Publish approval is missing or expired.");
  if (approval.candidateDigest !== candidate.candidateDigest || stored.candidateDigest !== candidate.candidateDigest) {
    throw new Error("Publish approval candidate mismatch.");
  }
  if (approval.adapterId !== candidate.adapterId || stored.adapterId !== candidate.adapterId) {
    throw new Error("Publish approval adapter mismatch.");
  }
  if (approval.targetDigest !== candidate.targetDigest || stored.targetDigest !== candidate.targetDigest) {
    throw new Error("Publish approval target mismatch.");
  }
  return { token: approval.token, ...stored };
}

function requirePrepared(value) {
  if (!value || typeof value !== "object") throw new Error("Prepared publish candidate is required.");
  requireAdapterId(value.adapterId);
  requireDigest(value.candidateDigest, "candidate");
  requireDigest(value.targetDigest, "target");
  prunePrepared();
  const registered = PREPARED.get(value.stagingDir);
  if (!registered || registered.candidateDigest !== value.candidateDigest || registered.bundleDir !== value.bundleDir) throw new Error("Prepared publish candidate is unknown, discarded, or already used.");
  assertRegisteredDirectory(value.stagingDir, registered.stagingRealPath, registered.stagingIdentity, "staging");
  assertRegisteredDirectory(value.bundleDir, registered.bundleRealPath, registered.bundleIdentity, "bundle");
  if (digestCanonical(normalizeTarget(value.adapterId, value.target)) !== value.targetDigest) throw new Error("Prepared publish target digest mismatch.");
  if (computePublishCandidateDigestV1(value.manifest) !== value.candidateDigest) throw new Error("Prepared publish candidate digest mismatch.");
  return value;
}

async function publishFilesystem(candidate) {
  const destination = path.resolve(candidate.target.directory);
  const source = fs.realpathSync(candidate.bundleDir);
  if (destination === source || destination.startsWith(`${source}${path.sep}`) || source.startsWith(`${destination}${path.sep}`)) {
    throw new Error("Filesystem publish destination overlaps private staging.");
  }
  const temporary = `${destination}.towerforge-upload-${process.pid}-${Date.now()}`;
  if (fs.existsSync(destination)) throw new Error("Filesystem publish destination already exists.");
  let published = false;
  try {
    fs.cpSync(source, temporary, { recursive: true, errorOnExist: true, force: false });
    fs.renameSync(temporary, destination);
    published = true;
    const remoteBundleDigest = digestTree(destination);
    if (remoteBundleDigest !== candidate.manifest.bundle.digest) {
      throw new Error("Filesystem publish bundle verification digest mismatch.");
    }
    validateBundleSourcePack(destination, candidate.manifest);
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    if (published) fs.rmSync(destination, { recursive: true, force: true });
    throw error;
  }
  return { remoteDigest: candidate.candidateDigest };
}

function normalizeTarget(adapterId, target) {
  requireAdapterId(adapterId);
  const value = ownRecord(target, "publish target");
  if (adapterId === "filesystem_v1") {
    exactKeys(value, ["directory"], "filesystem publish target");
    if (typeof value.directory !== "string" || value.directory.length === 0 || Buffer.byteLength(value.directory, "utf8") > 4096) {
      throw new Error("Filesystem publish target directory is invalid.");
    }
    return Object.freeze({ directory: path.resolve(value.directory) });
  }
  if (adapterId === "github_pages_v1") {
    exactKeys(value, ["owner", "repository", "branch", "pathPrefix"], "GitHub Pages publish target");
    for (const key of ["owner", "repository", "branch"]) requireSlug(value[key], `GitHub Pages ${key}`);
    const pathPrefix = normalizePrefix(value.pathPrefix);
    return Object.freeze({ owner: value.owner, repository: value.repository, branch: value.branch, pathPrefix });
  }
  exactKeys(value, ["accountId", "projectName"], "Cloudflare Pages publish target");
  requireSlug(value.accountId, "Cloudflare accountId");
  requireSlug(value.projectName, "Cloudflare projectName");
  return Object.freeze({ accountId: value.accountId, projectName: value.projectName });
}

function ownRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!("value" in descriptor)) throw new Error(`${label} must contain only own data properties.`);
    result[key] = descriptor.value;
  }
  return result;
}

function exactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} contains unsupported fields.`);
}

function requireSlug(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(value)) throw new Error(`${label} is invalid.`);
}

function normalizePrefix(value) {
  if (typeof value !== "string" || value.includes("\\") || value.includes("\0")) throw new Error("GitHub Pages pathPrefix is invalid.");
  if (value === "") return "";
  const normalized = path.posix.normalize(value).replace(/^\.\//, "").replace(/\/$/, "");
  if (!normalized || normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/")) throw new Error("GitHub Pages pathPrefix is unsafe.");
  return normalized;
}

function requireProjectDirectory(projectDir) {
  const resolved = path.resolve(projectDir);
  if (!fs.statSync(resolved).isDirectory() || !fs.statSync(path.join(resolved, "project.json")).isFile()) {
    throw new Error("Publish source must be a .tdproj directory.");
  }
}

function confinedStagingRoot(projectDir) {
  const projectRoot = fs.realpathSync(projectDir);
  const staging = path.join(projectRoot, ".towerforge", "publish-staging");
  const relative = path.relative(projectRoot, staging);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Publish staging escapes the project.");
  return staging;
}

function requireBundleDirectory(stagingDir, bundleDir) {
  if (typeof bundleDir !== "string" || !fs.existsSync(bundleDir)) throw new Error("Publish build did not return a bundle directory.");
  const stat = fs.lstatSync(bundleDir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Publish bundle root must be a real directory inside private staging.");
  const root = fs.realpathSync(stagingDir);
  const bundle = fs.realpathSync(bundleDir);
  const relative = path.relative(root, bundle);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Publish bundle must remain inside private staging.");
  return bundle;
}

function ephemeralDistribution(files, projectDir) {
  const projectId = `tfp_${createHash("sha256")
    .update(JSON.stringify(files.manifest ?? {}))
    .update("\0")
    .update(path.basename(projectDir))
    .digest("hex").slice(0, 32)}`;
  return normalizeDistributionConfigV1({
    schemaVersion: 1,
    projectId,
    license: { spdxId: "ARR", attribution: String(files.manifest?.author ?? files.manifest?.name ?? "") },
    remix: { policy: "forbidden", includeSource: false }
  });
}

function requireEngineDescriptor(value) {
  const record = ownRecord(value, "publish engine descriptor");
  exactKeys(record, ["version", "digest"], "publish engine descriptor");
  if (typeof record.version !== "string" || record.version.length === 0) throw new Error("Publish engine version is invalid.");
  requireDigest(record.digest, "engine");
  return { version: record.version, digest: record.digest };
}

function validateEmbeddedManifest(input, distribution, bundleDigest, sourceEntriesDigest) {
  const manifest = normalizePublishManifestV1(input);
  if (manifest.projectId !== distribution.projectId
    || JSON.stringify(manifest.license) !== JSON.stringify(distribution.license)
    || JSON.stringify(manifest.remixPolicy) !== JSON.stringify(distribution.remix)) {
    throw new Error("Embedded publish manifest project/license/remix identity mismatch.");
  }
  if (manifest.bundle.digest !== bundleDigest) throw new Error("Embedded publish manifest bundle digest mismatch.");
  if (manifest.sourcePack.digest !== sourceEntriesDigest) throw new Error("Embedded publish manifest source pack digest mismatch.");
  return manifest;
}

function inspectOptionalSourcePack(bundleDir) {
  const archivePath = path.join(bundleDir, SOURCE_PACK_NAME);
  if (!fs.existsSync(archivePath)) return undefined;
  const stat = fs.lstatSync(archivePath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Publish source.tdpack must be a regular file.");
  return inspectRemixSourcePackV2(archivePath);
}

function validateBundleSourcePack(bundleDir, manifest, inspected = inspectOptionalSourcePack(bundleDir)) {
  if (!manifest.remixPolicy.includeSource) {
    if (inspected) throw new Error("Publish bundle contains source.tdpack while source remix is disabled.");
    return;
  }
  if (!inspected) throw new Error("Remix-enabled publish bundle is missing source.tdpack.");
  if (inspected.entriesDigest !== manifest.sourcePack.digest) {
    throw new Error("Publish source.tdpack entries digest mismatch.");
  }
  if (JSON.stringify(inspected.publishManifest) !== JSON.stringify(manifest)
    || inspected.parentManifestDigest !== computePublishCandidateDigestV1(manifest)) {
    throw new Error("Publish source.tdpack embedded manifest does not match the publish candidate.");
  }
}

function requireDigestDescriptor(value, label) {
  const record = ownRecord(value, `publish ${label} descriptor`);
  exactKeys(record, ["digest"], `publish ${label} descriptor`);
  requireDigest(record.digest, label);
  return { digest: record.digest };
}

function resolveSourcePackDescriptor(value, sourceEntriesDigest) {
  const descriptor = requireDigestDescriptor(value ?? { digest: sourceEntriesDigest }, "source pack");
  if (descriptor.digest !== sourceEntriesDigest) {
    throw new Error("Publish source pack digest does not match canonical source entries digest.");
  }
  return descriptor;
}

function requireAdapterId(value) {
  if (!ADAPTERS.has(value)) throw new Error(`Unsupported publish adapter "${String(value)}".`);
}

function requireDigest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`Publish ${label} digest is invalid.`);
}

function digestCanonical(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function computePublishTreeDigestV1(root, options = {}) {
  const excludeSourcePack = options.excludeSourcePack === true;
  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("Publish bundle root must be a real directory, not a symbolic link or special entry.");
  const hash = createHash("sha256");
  hash.update("towerforge.publish-tree.v1\0", "utf8");
  const state = { files: 0, totalBytes: 0 };
  const walk = (directory, depth) => {
    if (depth > BUNDLE_LIMITS.maximumDepth) throw new Error(`Publish bundle exceeds the ${BUNDLE_LIMITS.maximumDepth} directory depth limit.`);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (excludeSourcePack && depth === 0 && entry.name === SOURCE_PACK_NAME) continue;
      if (entry.isSymbolicLink()) throw new Error("Publish bundles must not contain symbolic links.");
      if (entry.isDirectory()) walk(absolute, depth + 1);
      else if (entry.isFile()) {
        const stat = fs.lstatSync(absolute);
        if (stat.size > BUNDLE_LIMITS.maximumFileBytes) throw new Error("Publish bundle file exceeds its size limit.");
        state.files += 1;
        state.totalBytes += stat.size;
        if (state.files > BUNDLE_LIMITS.maximumFiles) throw new Error("Publish bundle exceeds its file-count limit.");
        if (state.totalBytes > BUNDLE_LIMITS.maximumTotalBytes) throw new Error("Publish bundle exceeds its total byte limit.");
        const relativeBytes = Buffer.from(relative, "utf8");
        const pathLength = Buffer.allocUnsafe(4);
        pathLength.writeUInt32BE(relativeBytes.length);
        const contentLength = Buffer.allocUnsafe(8);
        contentLength.writeBigUInt64BE(BigInt(stat.size));
        const contentDigest = createHash("sha256").update(fs.readFileSync(absolute)).digest();
        hash.update(Buffer.from([1])).update(pathLength).update(relativeBytes).update(contentLength).update(contentDigest);
      } else {
        throw new Error(`Publish bundle contains unsupported special entry "${entry.name}".`);
      }
    }
  };
  walk(root, 0);
  const fileCount = Buffer.allocUnsafe(4);
  fileCount.writeUInt32BE(state.files);
  hash.update(Buffer.from([0])).update(fileCount);
  return hash.digest("hex");
}

function digestTree(root) {
  return computePublishTreeDigestV1(root, { excludeSourcePack: true });
}

function pruneApprovals() {
  const now = Date.now();
  for (const [token, approval] of APPROVALS) if (approval.expiresAt < now) APPROVALS.delete(token);
}

function prunePrepared() {
  const now = Date.now();
  for (const [stagingDir, prepared] of PREPARED) {
    if (prepared.expiresAt <= now || !fs.existsSync(stagingDir)) {
      PREPARED.delete(stagingDir);
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
  }
}

function directoryIdentity(directory) {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Publish directory identity requires a real directory.");
  return `${String(stat.dev)}:${String(stat.ino)}`;
}

function assertRegisteredDirectory(directory, expectedRealPath, expectedIdentity, label) {
  if (typeof directory !== "string" || !fs.existsSync(directory)) throw new Error(`Prepared publish ${label} directory is missing.`);
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Prepared publish ${label} directory was replaced by a symbolic link or special entry.`);
  if (fs.realpathSync(directory) !== expectedRealPath || `${String(stat.dev)}:${String(stat.ino)}` !== expectedIdentity) {
    throw new Error(`Prepared publish ${label} directory identity changed after preparation.`);
  }
}
