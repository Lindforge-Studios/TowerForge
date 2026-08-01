import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  computePublishCandidateDigestV1,
  normalizeDistributionConfigV1,
  normalizePublishManifestV1,
  validateRemixProvenanceV1
} from "../../../distribution/src/index.mjs";
import { validateProjectDir, validateProjectDirWithBuiltEngine } from "../project-loader.mjs";

const FORMAT = "towerforge.tdpack";
const VERSION = 2;
const ROOT_FILES = new Set(["project.json", "build-targets.json"]);
const ROOT_DIRS = new Set(["content", "maps", "assets", "scripts"]);
const MAX_FILES = 5_000;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_PACK_BYTES = 256 * 1024 * 1024;
const validatedSourceDigests = new Set();

export async function exportRemixSourcePackV2(projectDir, outputPath, options = {}) {
  const entries = collectEntries(projectDir);
  const entriesDigest = digestEntries(entries);
  const distributionPath = path.join(projectDir, "content", "distribution.json");
  if (!fs.existsSync(distributionPath)) throw new Error("Remix source export requires content/distribution.json.");
  const distribution = normalizeDistributionConfigV1(JSON.parse(fs.readFileSync(distributionPath, "utf8")));
  assertRemixExportAllowed(distribution);
  const publishManifest = normalizePublishManifestV1(options.publishManifest);
  if (publishManifest.projectId !== distribution.projectId) throw new Error("Publish manifest project does not match remix source project.");
  if (JSON.stringify(publishManifest.license) !== JSON.stringify(distribution.license)
    || JSON.stringify(publishManifest.remixPolicy) !== JSON.stringify(distribution.remix)) {
    throw new Error("Publish manifest license/remix policy does not match the project.");
  }
  if (publishManifest.sourcePack.digest !== entriesDigest) {
    throw new Error("Publish manifest source pack digest does not match canonical source entries digest.");
  }
  if (!validatedSourceDigests.has(entriesDigest)) {
    const { result } = await validateProjectDirWithBuiltEngine(projectDir);
    if (!result.ok) throw new Error("Cannot export an invalid remix source project.");
    validatedSourceDigests.add(entriesDigest);
  }
  const envelope = {
    format: FORMAT,
    version: VERSION,
    entriesDigest,
    publishManifest,
    entries
  };
  const compressed = gzipSync(Buffer.from(JSON.stringify(envelope), "utf8"), { level: 9, mtime: 0 });
  if (compressed.length > MAX_PACK_BYTES) throw new Error(`Remix pack exceeds the ${MAX_PACK_BYTES} byte limit.`);
  const destination = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp.${process.pid}`;
  try {
    fs.writeFileSync(temporary, compressed);
    fs.renameSync(temporary, destination);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return Object.freeze({
    ok: true,
    outputPath: destination,
    format: FORMAT,
    version: VERSION,
    fileCount: entries.length,
    sourceBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
    packBytes: compressed.length,
    entriesDigest,
    sha256: sha256(compressed),
    publishManifest
  });
}

export function inspectRemixSourcePackV2(packPath) {
  const source = fs.readFileSync(packPath);
  if (source.length > MAX_PACK_BYTES) throw new Error(`Remix pack exceeds the ${MAX_PACK_BYTES} byte limit.`);
  let envelope;
  try {
    envelope = JSON.parse(gunzipSync(source, { maxOutputLength: MAX_TOTAL_BYTES * 2 }).toString("utf8"));
  } catch (error) {
    throw new Error(`Invalid or truncated remix pack: ${error instanceof Error ? error.message : String(error)}`);
  }
  const root = ownRecord(envelope, "remix pack");
  exactKeys(root, ["format", "version", "entriesDigest", "publishManifest", "entries"], "remix pack");
  if (root.format !== FORMAT || root.version !== VERSION) throw new Error(`Unsupported remix pack format/version.`);
  if (!Array.isArray(root.entries) || root.entries.length < 1 || root.entries.length > MAX_FILES) throw new Error("Invalid remix pack entry count.");
  const seen = new Set();
  let sourceBytes = 0;
  const entries = root.entries.map((input) => {
    const entry = ownRecord(input, "remix pack entry");
    exactKeys(entry, ["path", "size", "sha256", "data"], "remix pack entry");
    const relativePath = validatePath(entry.path);
    if (seen.has(relativePath)) throw new Error(`Remix pack contains duplicate path "${relativePath}".`);
    seen.add(relativePath);
    if (typeof entry.data !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(entry.data)) throw new Error(`Invalid base64 data for "${relativePath}".`);
    const bytes = Buffer.from(entry.data, "base64");
    if (bytes.toString("base64") !== entry.data) throw new Error(`Non-canonical base64 data for "${relativePath}".`);
    if (bytes.length > MAX_FILE_BYTES) throw new Error(`Remix pack entry "${relativePath}" exceeds its size limit.`);
    sourceBytes += bytes.length;
    if (sourceBytes > MAX_TOTAL_BYTES) throw new Error("Remix pack exceeds its total source size limit.");
    if (entry.size !== bytes.length || entry.sha256 !== sha256(bytes)) throw new Error(`Remix pack entry "${relativePath}" failed checksum verification.`);
    return Object.freeze({ path: relativePath, size: bytes.length, sha256: entry.sha256, bytes });
  });
  if (!seen.has("project.json") || !seen.has("content/distribution.json")) throw new Error("Remix pack is missing required project files.");
  if (root.entriesDigest !== digestEntries(entries.map((entry) => ({ ...entry, data: entry.bytes.toString("base64") })))) {
    throw new Error("Remix pack entries digest mismatch.");
  }
  const publishManifest = normalizePublishManifestV1(root.publishManifest);
  if (publishManifest.sourcePack.digest !== root.entriesDigest) {
    throw new Error("Remix pack publish manifest source digest does not match its entries digest.");
  }
  return Object.freeze({
    format: FORMAT,
    version: VERSION,
    fileCount: entries.length,
    sourceBytes,
    packBytes: source.length,
    entriesDigest: root.entriesDigest,
    sha256: sha256(source),
    parentManifestDigest: computePublishCandidateDigestV1(publishManifest),
    publishManifest,
    entries: Object.freeze(entries)
  });
}

/** Non-circular source-pack digest domain: canonical path/size/content-digest tuples only. */
export function computeRemixSourcePackDigestV2(projectDir) {
  return digestEntries(collectEntries(projectDir));
}

export async function importRemixSourcePackV2(packPath, parentDir, options = {}) {
  const pack = inspectRemixSourcePackV2(packPath);
  if (pack.publishManifest.remixPolicy.policy === "forbidden" || !pack.publishManifest.remixPolicy.includeSource) {
    throw new Error("Published project forbids remix source import.");
  }
  const name = safeName(options.name ?? "remixed-project");
  const projectId = options.projectId;
  const destination = path.resolve(parentDir, `${name}.tdproj`);
  if (fs.existsSync(destination)) throw new Error(`Destination already exists: ${destination}`);
  const temporary = `${destination}.import-${process.pid}-${Date.now()}`;
  try {
    fs.mkdirSync(temporary, { recursive: false });
    for (const entry of pack.entries) {
      const output = path.join(temporary, ...entry.path.split("/"));
      const relative = path.relative(temporary, output);
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Remix pack path escapes destination.");
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, entry.bytes, { flag: "wx" });
    }
    const distributionPath = path.join(temporary, "content", "distribution.json");
    const sourceDistribution = normalizeDistributionConfigV1(JSON.parse(fs.readFileSync(distributionPath, "utf8")));
    if (sourceDistribution.projectId !== pack.publishManifest.projectId) throw new Error("Remix source project identity does not match its publish manifest.");
    const provenance = validateRemixProvenanceV1({
      schemaVersion: 1,
      parentProjectId: pack.publishManifest.projectId,
      parentManifestDigest: pack.parentManifestDigest,
      parentSourcePackDigest: pack.sha256,
      attribution: pack.publishManifest.license.attribution,
      source: { kind: "published_tdpack" }
    });
    const nextDistribution = normalizeDistributionConfigV1({
      ...sourceDistribution,
      projectId,
      remixProvenance: provenance
    });
    writeJson(distributionPath, nextDistribution);
    const projectPath = path.join(temporary, "project.json");
    const project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
    writeJson(projectPath, { ...project, schemaVersion: 4, name });
    const { result } = await validateProjectDir(temporary);
    if (!result.ok) throw new Error("Imported remix project failed validation.");
    fs.renameSync(temporary, destination);
    return Object.freeze({
      ok: true,
      projectDir: destination,
      projectId: nextDistribution.projectId,
      parentManifestDigest: pack.parentManifestDigest,
      parentSourcePackDigest: pack.sha256,
      fileCount: pack.fileCount
    });
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

function assertRemixExportAllowed(distribution) {
  if (distribution.remix.policy === "forbidden") throw new Error("Project remix is forbidden.");
  if (!distribution.remix.includeSource) throw new Error("Project remix policy omits source.");
  if (distribution.remix.policy === "allowed_with_attribution" && distribution.license.attribution.trim() === "") {
    throw new Error("Remix source export requires attribution.");
  }
}

function collectEntries(projectDir) {
  const root = fs.realpathSync(projectDir);
  assertSafeSourceRoots(root);
  const relativePaths = [];
  for (const file of [...ROOT_FILES].sort()) if (fs.existsSync(path.join(root, file))) relativePaths.push(file);
  for (const directory of [...ROOT_DIRS].sort()) {
    const absolute = path.join(root, directory);
    if (fs.existsSync(absolute)) walk(root, absolute, relativePaths);
  }
  if (relativePaths.length > MAX_FILES) throw new Error(`Project exceeds the ${MAX_FILES} file remix limit.`);
  let total = 0;
  return relativePaths.sort().map((relativePath) => {
    const absolute = path.join(root, ...relativePath.split("/"));
    assertConfinedRealPath(root, absolute, `Remix source file "${relativePath}"`);
    const bytes = fs.readFileSync(absolute);
    if (bytes.length > MAX_FILE_BYTES) throw new Error(`Project file "${relativePath}" exceeds the size limit.`);
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES) throw new Error("Project exceeds the total remix source limit.");
    return Object.freeze({ path: relativePath, size: bytes.length, sha256: sha256(bytes), data: bytes.toString("base64") });
  });
}

function walk(root, directory, output) {
  assertConfinedRealPath(root, directory, "Remix source directory");
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    if (entry.name.startsWith(".")) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Remix source contains a symbolic link: ${path.relative(root, absolute)}`);
    if (entry.isDirectory()) walk(root, absolute, output);
    else if (entry.isFile()) output.push(path.relative(root, absolute).split(path.sep).join("/"));
  }
}

function assertSafeSourceRoots(root) {
  for (const file of ROOT_FILES) {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute)) continue;
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Remix source root file "${file}" must not be a symbolic link.`);
    if (!stat.isFile()) throw new Error(`Remix source root file "${file}" must be a regular file.`);
    assertConfinedRealPath(root, absolute, `Remix source root file "${file}"`);
  }
  for (const directory of ROOT_DIRS) {
    const absolute = path.join(root, directory);
    if (!fs.existsSync(absolute)) continue;
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Remix source root directory "${directory}" must not be a symbolic link.`);
    if (!stat.isDirectory()) throw new Error(`Remix source root directory "${directory}" must be a directory.`);
    assertConfinedRealPath(root, absolute, `Remix source root directory "${directory}"`);
  }
}

function assertConfinedRealPath(root, absolute, label) {
  const real = fs.realpathSync(absolute);
  const relative = path.relative(root, real);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${label} escapes the project root.`);
}

function validatePath(value) {
  if (typeof value !== "string" || !value || value.includes("\\") || value.includes("\0")) throw new Error("Remix pack contains an invalid path.");
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized.startsWith("../") || normalized.startsWith("/") || path.posix.isAbsolute(normalized)) throw new Error(`Unsafe remix pack path "${value}".`);
  const segments = normalized.split("/");
  if (segments.some((segment) => segment.startsWith("."))) throw new Error(`Private remix pack path "${value}" is not allowed.`);
  const [root, ...rest] = segments;
  if (!(ROOT_FILES.has(normalized) || (ROOT_DIRS.has(root) && rest.length > 0))) throw new Error(`Remix pack path is outside allowed roots: ${value}`);
  return normalized;
}

function digestEntries(entries) {
  const hash = createHash("sha256");
  for (const entry of entries) {
    hash.update(entry.path).update("\0");
    hash.update(String(entry.size)).update("\0");
    hash.update(entry.sha256).update("\0");
  }
  return hash.digest("hex");
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
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new Error(`${label} contains unsupported fields.`);
}

function safeName(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) throw new Error("Remix project name is invalid.");
  return value;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
