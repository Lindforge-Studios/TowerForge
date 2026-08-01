import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { normalizeDistributionConfigV1 } from "../../../distribution/src/index.mjs";
import { normalizeProjectFiles, readRawProjectFiles } from "../project-loader.mjs";
import { DISTRIBUTION_PROJECT_SCHEMA_VERSION, validateProjectSchemas } from "../project-schema.mjs";

export function readDistributionConfigV1(projectDir) {
  const raw = readRawProjectFiles(projectDir);
  return Object.freeze({
    schemaVersion: 1,
    authored: raw.distribution !== undefined,
    distribution: raw.distribution === undefined ? undefined : normalizeDistributionConfigV1(raw.distribution),
    revision: distributionRevision(raw)
  });
}

export function previewDistributionConfigV1(projectDir, candidate) {
  const raw = readRawProjectFiles(projectDir);
  const disabling = candidate === null;
  const distribution = disabling ? undefined : normalizeDistributionConfigV1(candidate);
  const manifest = disabling
    ? { ...raw.manifest }
    : { ...raw.manifest, schemaVersion: DISTRIBUTION_PROJECT_SCHEMA_VERSION };
  const candidateRaw = { ...raw, manifest, distribution };
  const validation = validateProjectSchemas(normalizeProjectFiles(candidateRaw));
  if (!validation.ok) {
    const error = new Error("Distribution candidate failed project validation.");
    error.code = "distribution_validation_failed";
    error.issues = validation.issues;
    throw error;
  }
  return Object.freeze({
    schemaVersion: 1,
    dryRun: true,
    written: false,
    disabled: disabling,
    revision: distributionRevision(raw),
    candidate: Object.freeze({ manifest: Object.freeze(manifest), distribution: distribution ?? null }),
    validation
  });
}

export function applyDistributionConfigV1(projectDir, candidate, options = {}) {
  if (typeof options.ifRevision !== "string" || options.ifRevision.length === 0) {
    const error = new Error("Distribution apply requires ifRevision from preview.");
    error.code = "revision_required";
    throw error;
  }
  const preview = previewDistributionConfigV1(projectDir, candidate);
  if (preview.revision !== options.ifRevision) {
    const error = new Error("Distribution project changed since preview.");
    error.code = "revision_conflict";
    throw error;
  }
  const manifestPath = path.join(projectDir, "project.json");
  const distributionPath = path.join(projectDir, "content", "distribution.json");
  const beforeManifest = fs.readFileSync(manifestPath);
  const beforeDistribution = fs.existsSync(distributionPath) ? fs.readFileSync(distributionPath) : null;
  const backupDir = path.join(projectDir, ".towerforge", "backups", `r17-distribution-${Date.now()}-${process.pid}`);
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(backupDir, "project.json.bak"), beforeManifest);
  if (beforeDistribution) fs.writeFileSync(path.join(backupDir, "distribution.json.bak"), beforeDistribution);
  try {
    writeJsonAtomic(manifestPath, preview.candidate.manifest);
    fs.mkdirSync(path.dirname(distributionPath), { recursive: true });
    if (preview.disabled) fs.rmSync(distributionPath, { force: true });
    else writeJsonAtomic(distributionPath, preview.candidate.distribution);
    const after = readRawProjectFiles(projectDir);
    const validation = validateProjectSchemas(normalizeProjectFiles(after));
    if (!validation.ok) throw new Error("Post-write distribution validation failed.");
    return Object.freeze({
      schemaVersion: 1,
      ok: true,
      written: true,
      disabled: preview.disabled,
      revision: distributionRevision(after),
      distribution: after.distribution === undefined ? undefined : normalizeDistributionConfigV1(after.distribution),
      validation
    });
  } catch (error) {
    fs.writeFileSync(manifestPath, beforeManifest);
    if (beforeDistribution) fs.writeFileSync(distributionPath, beforeDistribution);
    else fs.rmSync(distributionPath, { force: true });
    throw error;
  }
}

function distributionRevision(raw) {
  return createHash("sha256")
    .update(JSON.stringify(raw.manifest ?? {}))
    .update("\0")
    .update(JSON.stringify(raw.distribution ?? null))
    .digest("hex");
}

function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.tmp.${process.pid}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, filePath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
