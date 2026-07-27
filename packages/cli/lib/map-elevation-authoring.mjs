import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  compileMapSource,
  compileMapSources,
  normalizeElevationOverrides
} from "./map-compiler.mjs";
import {
  loadEngine,
  normalizeProjectFiles,
  readRawProjectFiles,
  validateProjectDir
} from "./project-loader.mjs";
import { PROJECT_SCHEMA_VERSION, validateProjectSchemas } from "./project-schema.mjs";
import { mergeValidationResults } from "./trace.mjs";

const SOURCE_FILE_LIMIT = 16 * 1024 * 1024;
const COMPILED_FILE_LIMIT = 64 * 1024 * 1024;
const MANIFEST_FILE_LIMIT = 256 * 1024;
const TOTAL_TRANSACTION_LIMIT = 128 * 1024 * 1024;
const MAX_MAP_SOURCES = 4096;
let transactionSequence = 0;

export class ElevationAuthoringError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ElevationAuthoringError";
    this.code = code;
    Object.assign(this, details);
  }
}

/** Exact-byte revision of project.json, every maps/src/*.tmj, and compiled maps aggregate. */
export function mapElevationAuthoringRevision(projectDir) {
  return readSnapshot(projectDir).revision;
}

/** Read one map's source and compiled elevation view without writing or normalizing the project. */
export function inspectMapElevations(projectDir, args = {}) {
  const snapshot = readSnapshot(projectDir);
  const mapId = requireMapId(args.mapId);
  const located = locateMapSource(snapshot, mapId);
  const compiled = snapshot.compiledMaps[mapId];
  if (!compiled || typeof compiled !== "object") {
    throw new ElevationAuthoringError("map_not_found", `Compiled map "${mapId}" was not found.`);
  }
  return {
    projectDir: snapshot.projectDir,
    mapId,
    sourceName: located.sourceName,
    revision: snapshot.revision,
    elevationOverrides: cloneJson(compiled.elevationOverrides ?? [])
  };
}

/** Build and fully validate an elevation candidate without touching the project tree. */
export async function previewMapElevations(projectDir, args) {
  const plan = await buildPlan(projectDir, args);
  return publicPlan(plan, true);
}

/**
 * Apply one previewable elevation edit through a guarded three-boundary transaction. The optional
 * hooks are for deterministic failure injection in contract tests and are not surfaced by MCP.
 */
export async function applyMapElevations(projectDir, args, internalHooks = {}) {
  const plan = await buildPlan(projectDir, args);
  if (typeof args?.ifRevision !== "string" || args.ifRevision.length === 0) {
    throw new ElevationAuthoringError(
      "revision_required",
      "applyMapElevations requires ifRevision returned by previewMapElevations."
    );
  }
  if (args.ifRevision !== plan.revision) {
    throw new ElevationAuthoringError(
      "revision_conflict",
      "Map elevation sources changed since preview; refresh and retry with the current revision.",
      { expectedRevision: args.ifRevision, actualRevision: plan.revision }
    );
  }
  if (plan.noOp) {
    assertRevision(plan.projectDir, plan.revision, args.ifRevision);
    return {
      ...publicPlan(plan, false),
      changed: false,
      written: false,
      rolledBack: false,
      previousRevision: plan.revision
    };
  }

  const writes = candidateWrites(plan);
  const staged = stageWrites(plan.projectDir, writes);
  const committed = [];
  let backup;
  try {
    assertRevision(plan.projectDir, plan.revision, args.ifRevision);
    backup = createBackup(plan.projectDir, plan.snapshot, writes);
    assertRevision(plan.projectDir, plan.revision, args.ifRevision);

    for (const write of writes) {
      assertPartialBoundary(plan, writes, committed);
      fs.renameSync(staged.get(write.relativePath), write.absolutePath);
      staged.delete(write.relativePath);
      committed.push(write);
      internalHooks.afterFileReplace?.(write.relativePath);
    }

    const post = await validateProjectDir(plan.projectDir);
    if (!post.result.ok) {
      throw new ElevationAuthoringError(
        "post_write_validation_failed",
        "The written elevation candidate failed complete project validation.",
        { validation: post.result }
      );
    }
    assertPartialBoundary(plan, writes, committed);
    const ownershipConflicts = committed.filter((write) => !fileEquals(write.absolutePath, write.bytes));
    if (ownershipConflicts.length > 0) {
      throw new ElevationAuthoringError(
        "commit_conflict",
        "An elevation transaction file changed before post-write validation completed.",
        { conflicts: ownershipConflicts.map((write) => write.relativePath) }
      );
    }

    return {
      ...publicPlan(plan, false),
      changed: true,
      written: true,
      rolledBack: false,
      previousRevision: plan.revision,
      revision: mapElevationAuthoringRevision(plan.projectDir),
      backup
    };
  } catch (error) {
    if (committed.length === 0) {
      if (error instanceof ElevationAuthoringError) {
        error.backup = backup;
        error.rolledBack = false;
        throw error;
      }
      throw new ElevationAuthoringError(
        "apply_failed",
        "The elevation transaction failed before replacing any project file.",
        { cause: error, backup, rolledBack: false }
      );
    }
    const rollback = rollbackOwnedWrites(plan, committed);
    if (!rollback.ok) {
      throw new ElevationAuthoringError(
        rollback.conflicts.length > 0 ? "rollback_conflict" : "rollback_failed",
        "The elevation transaction could not fully restore its owned files.",
        { cause: error, backup, rollback }
      );
    }
    if (error instanceof ElevationAuthoringError) {
      error.backup = backup;
      error.rolledBack = true;
      throw error;
    }
    throw new ElevationAuthoringError(
      "apply_failed",
      "The elevation transaction failed and was rolled back.",
      { cause: error, backup, rolledBack: true }
    );
  } finally {
    cleanupStaged(staged);
  }
}

async function buildPlan(projectDir, unsafeArgs) {
  const snapshot = readSnapshot(projectDir);
  const args = requireRequest(unsafeArgs);
  const mapId = requireMapId(args.mapId);
  if (args.ifRevision !== undefined && typeof args.ifRevision !== "string") {
    throw new ElevationAuthoringError("request_invalid", "ifRevision must be a string when provided.");
  }
  if (args.ifRevision !== undefined && args.ifRevision !== snapshot.revision) {
    throw new ElevationAuthoringError(
      "revision_conflict",
      "Map elevation sources changed since preview; refresh and retry with the current revision.",
      { expectedRevision: args.ifRevision, actualRevision: snapshot.revision }
    );
  }
  const rawVersion = snapshot.manifest.schemaVersion;
  if (!Number.isInteger(rawVersion) || rawVersion < 2) {
    throw new ElevationAuthoringError(
      "project_migration_required",
      "Persist the project v2 migration before authoring elevation; the narrow transaction must not skip legacy migrations."
    );
  }
  if (rawVersion > PROJECT_SCHEMA_VERSION) {
    throw new ElevationAuthoringError(
      "project_version_unsupported",
      `Project schemaVersion is newer than this authoring runtime supports (${PROJECT_SCHEMA_VERSION}).`
    );
  }

  const located = locateMapSource(snapshot, mapId);
  const compiledBefore = snapshot.compiledMaps[mapId];
  if (!compiledBefore || typeof compiledBefore !== "object") {
    throw new ElevationAuthoringError("map_not_found", `Compiled map "${mapId}" was not found.`);
  }
  const elevationOverrides = normalizeElevationOverrides(
    args.elevationOverrides,
    located.compiled.width,
    located.compiled.height,
    "elevationOverrides"
  );
  const candidateSource = cloneJson(located.source);
  writeCandidateElevationOverrides(candidateSource, elevationOverrides);
  const candidateSources = { ...snapshot.mapSources, [located.sourceName]: candidateSource };
  const compiledResult = compileMapSources(candidateSources, snapshot.rawFiles.balance?.terrainTypes ?? {});
  if (!compiledResult.ok) {
    throw new ElevationAuthoringError(
      "candidate_compile_failed",
      "The elevation candidate could not compile all authored map sources.",
      { validation: { ok: false, issues: compiledResult.issues } }
    );
  }
  const candidateMap = compiledResult.maps[mapId];
  if (!candidateMap) {
    throw new ElevationAuthoringError("map_not_found", `Map source no longer compiles as "${mapId}".`);
  }
  const manifest = cloneJson(snapshot.manifest);
  manifest.schemaVersion = PROJECT_SCHEMA_VERSION;
  const candidate = {
    manifest,
    sourceName: located.sourceName,
    source: candidateSource,
    maps: compiledResult.maps,
    elevationOverrides: cloneJson(candidateMap.elevationOverrides ?? [])
  };

  const validation = await validateCandidate(snapshot, candidate);
  if (!validation.ok) {
    throw new ElevationAuthoringError(
      "candidate_validation_failed",
      "The complete elevation candidate failed project validation.",
      { validation }
    );
  }
  const candidateSourceBytes = canonicalJson(candidateSource);
  const candidateMapsBytes = canonicalJson(candidate.maps);
  const candidateManifestBytes = canonicalJson(candidate.manifest);
  const noOp = snapshot.manifestFile.bytes.equals(candidateManifestBytes)
    && snapshot.compiledFile.bytes.equals(candidateMapsBytes)
    && located.file.bytes.equals(candidateSourceBytes);
  return { projectDir: snapshot.projectDir, snapshot, args, mapId, revision: snapshot.revision, candidate, validation, noOp };
}

function writeCandidateElevationOverrides(source, elevationOverrides) {
  const tiledProperty = Array.isArray(source.properties)
    ? source.properties.find((property) => property?.name === "elevationOverrides")
    : undefined;
  if (tiledProperty) {
    delete source.elevationOverrides;
    tiledProperty.value = typeof tiledProperty.value === "string"
      ? JSON.stringify(elevationOverrides)
      : cloneJson(elevationOverrides);
    return;
  }
  source.elevationOverrides = cloneJson(elevationOverrides);
}

async function validateCandidate(snapshot, candidate) {
  try {
    const normalized = normalizeProjectFiles({
      ...snapshot.rawFiles,
      manifest: candidate.manifest,
      maps: candidate.maps,
      mapSources: { ...snapshot.mapSources, [candidate.sourceName]: candidate.source }
    });
    const engine = await loadEngine();
    const registry = engine.createGameContentRegistry({
      balance: normalized.balance,
      maps: normalized.maps,
      worldMap: normalized.worldMap,
      scripts: normalized.scripts,
      mechanics: normalized.mechanics,
      visuals: normalized.visuals,
      storyComics: normalized.storyComics,
      battleBackgrounds: normalized.battleBackgrounds
    });
    return mergeValidationResults(
      validateProjectSchemas(normalized),
      engine.validateGameContentRegistry(registry)
    );
  } catch (error) {
    throw new ElevationAuthoringError(
      "candidate_validation_failed",
      "The complete elevation candidate could not be normalized and validated safely.",
      { cause: error }
    );
  }
}

function publicPlan(plan, dryRun) {
  return {
    projectDir: plan.projectDir,
    mapId: plan.mapId,
    sourceName: plan.candidate.sourceName,
    ok: true,
    dryRun,
    revision: plan.revision,
    candidate: {
      elevationOverrides: cloneJson(plan.candidate.elevationOverrides)
    },
    validation: plan.validation
  };
}

function candidateWrites(plan) {
  const sourceRelativePath = `maps/src/${plan.candidate.sourceName}`;
  return [
    makeWrite(plan, "project.json", canonicalJson(plan.candidate.manifest), plan.snapshot.manifestFile),
    makeWrite(plan, sourceRelativePath, canonicalJson(plan.candidate.source), plan.snapshot.sourceFiles.get(plan.candidate.sourceName)),
    makeWrite(plan, "maps/compiled/maps.json", canonicalJson(plan.candidate.maps), plan.snapshot.compiledFile)
  ];
}

function makeWrite(plan, relativePath, bytes, original) {
  return { relativePath, absolutePath: confinedExistingFile(plan.projectDir, relativePath), bytes, original };
}

function readSnapshot(projectDir) {
  const projectRoot = confinedProjectRoot(projectDir);
  const manifestFile = readRequiredFile(projectRoot, "project.json", MANIFEST_FILE_LIMIT);
  const compiledFile = readRequiredFile(projectRoot, "maps/compiled/maps.json", COMPILED_FILE_LIMIT);
  const sourceDirectory = confinedExistingDirectory(projectRoot, "maps/src");
  const entries = fs.readdirSync(sourceDirectory, { withFileTypes: true })
    .filter((entry) => entry.name.endsWith(".tmj"))
    .sort((left, right) => compareBinary(left.name, right.name));
  if (entries.length > MAX_MAP_SOURCES) {
    throw new ElevationAuthoringError("budget_exceeded", `A project may contain at most ${MAX_MAP_SOURCES} map sources.`);
  }
  const sourceFiles = new Map();
  let totalBytes = manifestFile.bytes.length + compiledFile.bytes.length;
  for (const entry of entries) {
    if (!entry.isFile()) {
      throw new ElevationAuthoringError("source_unsafe", `Map source "${entry.name}" must be a regular file, not a symlink or special entry.`);
    }
    if (!/^[a-zA-Z0-9_.-]+\.tmj$/.test(entry.name)) {
      throw new ElevationAuthoringError("source_unsafe", `Unsafe map source name "${entry.name}".`);
    }
    const file = readRequiredFile(projectRoot, `maps/src/${entry.name}`, SOURCE_FILE_LIMIT);
    sourceFiles.set(entry.name, file);
    totalBytes += file.bytes.length;
    if (totalBytes > TOTAL_TRANSACTION_LIMIT) {
      throw new ElevationAuthoringError("budget_exceeded", "Map elevation transaction sources exceed the 128 MiB aggregate limit.");
    }
  }
  const manifest = parseJsonFile(manifestFile, "project.json");
  const compiledMaps = parseJsonFile(compiledFile, "maps/compiled/maps.json");
  const mapSources = Object.create(null);
  for (const [sourceName, file] of sourceFiles) mapSources[sourceName] = parseJsonFile(file, `maps/src/${sourceName}`);
  const rawFiles = readRawProjectFiles(projectRoot);
  rawFiles.manifest = manifest;
  rawFiles.maps = compiledMaps;
  rawFiles.mapSources = mapSources;
  return {
    projectDir: projectRoot,
    manifestFile,
    compiledFile,
    sourceFiles,
    manifest,
    compiledMaps,
    mapSources,
    rawFiles,
    revision: revisionFromFiles(manifestFile, sourceFiles, compiledFile)
  };
}

function locateMapSource(snapshot, mapId) {
  const matches = [];
  for (const [sourceName, source] of Object.entries(snapshot.mapSources)) {
    let compiled;
    try {
      compiled = compileMapSource(source, sourceName, snapshot.rawFiles.balance?.terrainTypes ?? {});
    } catch (error) {
      throw new ElevationAuthoringError(
        "source_invalid",
        `Map source "${sourceName}" cannot be compiled safely: ${error.message}`,
        { cause: error }
      );
    }
    if (compiled.id === mapId) matches.push({ sourceName, source, compiled, file: snapshot.sourceFiles.get(sourceName) });
  }
  if (matches.length === 0) throw new ElevationAuthoringError("map_source_not_found", `No authored map source compiles as "${mapId}".`);
  if (matches.length > 1) throw new ElevationAuthoringError("map_source_ambiguous", `More than one map source compiles as "${mapId}".`);
  return matches[0];
}

function revisionFromFiles(manifestFile, sourceFiles, compiledFile) {
  const hash = createHash("sha256");
  updateRevision(hash, "project.json", manifestFile.bytes);
  for (const [sourceName, file] of sourceFiles) updateRevision(hash, `maps/src/${sourceName}`, file.bytes);
  updateRevision(hash, "maps/compiled/maps.json", compiledFile.bytes);
  return hash.digest("hex");
}

function updateRevision(hash, relativePath, bytes) {
  hash.update(`${relativePath}\0${bytes.length}\0`);
  hash.update(bytes);
  hash.update("\0");
}

function stageWrites(projectDir, writes) {
  const sequence = `${process.pid}.${transactionSequence++}`;
  const staged = new Map();
  try {
    for (const write of writes) {
      const temp = `${write.absolutePath}.elevation-stage.${sequence}`;
      fs.writeFileSync(temp, write.bytes, { flag: "wx" });
      staged.set(write.relativePath, temp);
    }
    return staged;
  } catch (error) {
    cleanupStaged(staged);
    throw error;
  }
}

function cleanupStaged(staged) {
  for (const temp of staged?.values?.() ?? []) fs.rmSync(temp, { force: true });
}

function createBackup(projectDir, snapshot, writes) {
  const backupRoot = confinedOrCreateDirectory(projectDir, ".towerforge/backups");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.join(backupRoot, `elevation-${stamp}-${String(transactionSequence++).padStart(6, "0")}`);
  fs.mkdirSync(directory);
  const files = {};
  for (const write of writes) {
    const backupPath = path.join(directory, write.relativePath);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, write.original.bytes);
    files[write.relativePath] = backupPath;
  }
  const backups = fs.readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("elevation-"))
    .map((entry) => entry.name)
    .sort(compareBinary);
  for (const stale of backups.slice(0, Math.max(0, backups.length - 20))) {
    fs.rmSync(path.join(backupRoot, stale), { recursive: true, force: true });
  }
  return { directory, files };
}

function rollbackOwnedWrites(plan, committed) {
  const conflicts = [];
  const failures = [];
  for (const write of [...committed].reverse()) {
    try {
      if (!fileEquals(write.absolutePath, write.bytes)) {
        conflicts.push(write.relativePath);
        continue;
      }
      writeBytesAtomic(write.absolutePath, write.original.bytes);
    } catch {
      failures.push(write.relativePath);
    }
  }
  // Only files replaced by this transaction are rollback-owned. A concurrent edit to a later,
  // still-uncommitted target must remain intact and therefore legitimately changes the composite
  // revision after our owned files have been restored.
  if (conflicts.length === 0 && failures.length === 0) {
    for (const write of committed) if (!fileEquals(write.absolutePath, write.original.bytes)) failures.push(write.relativePath);
  }
  return { ok: conflicts.length === 0 && failures.length === 0, conflicts, failures };
}

function writeBytesAtomic(filePath, bytes) {
  const temp = `${filePath}.elevation-rollback.${process.pid}.${transactionSequence++}`;
  try {
    fs.writeFileSync(temp, bytes, { flag: "wx" });
    fs.renameSync(temp, filePath);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

function assertRevision(projectDir, expected, requested) {
  const actual = mapElevationAuthoringRevision(projectDir);
  if (actual !== expected) {
    throw new ElevationAuthoringError(
      "revision_conflict",
      "Map elevation sources changed before commit; refresh and retry.",
      { expectedRevision: requested, actualRevision: actual }
    );
  }
}

function assertPartialBoundary(plan, writes, committed) {
  const committedPaths = new Set(committed.map((write) => write.relativePath));
  const writeByPath = new Map(writes.map((write) => [write.relativePath, write]));
  const expectedBytes = (relativePath, originalBytes) => {
    const write = writeByPath.get(relativePath);
    return write && committedPaths.has(relativePath) ? write.bytes : originalBytes;
  };
  const conflicts = [];
  try {
    if (!fileEquals(
      plan.snapshot.manifestFile.absolutePath,
      expectedBytes("project.json", plan.snapshot.manifestFile.bytes)
    )) conflicts.push("project.json");
    if (!fileEquals(
      plan.snapshot.compiledFile.absolutePath,
      expectedBytes("maps/compiled/maps.json", plan.snapshot.compiledFile.bytes)
    )) conflicts.push("maps/compiled/maps.json");

    const sourceDirectory = confinedExistingDirectory(plan.projectDir, "maps/src");
    const currentNames = fs.readdirSync(sourceDirectory, { withFileTypes: true })
      .filter((entry) => entry.name.endsWith(".tmj"))
      .map((entry) => entry.name)
      .sort(compareBinary);
    const expectedNames = [...plan.snapshot.sourceFiles.keys()].sort(compareBinary);
    const currentNameSet = new Set(currentNames);
    const expectedNameSet = new Set(expectedNames);
    for (const sourceName of expectedNames) {
      const relativePath = `maps/src/${sourceName}`;
      const original = plan.snapshot.sourceFiles.get(sourceName);
      if (!currentNameSet.has(sourceName) || !fileEquals(
        original.absolutePath,
        expectedBytes(relativePath, original.bytes)
      )) conflicts.push(relativePath);
    }
    for (const sourceName of currentNames) {
      if (!expectedNameSet.has(sourceName)) conflicts.push(`maps/src/${sourceName}`);
    }
  } catch {
    conflicts.push("map_elevation_boundary");
  }
  if (conflicts.length > 0) {
    throw new ElevationAuthoringError(
      "commit_conflict",
      "The map elevation authoring boundary changed during commit.",
      { conflicts: [...new Set(conflicts)].sort(compareBinary) }
    );
  }
}

function fileEquals(filePath, bytes) {
  try {
    const stat = fs.lstatSync(filePath);
    return stat.isFile() && !stat.isSymbolicLink() && fs.readFileSync(filePath).equals(bytes);
  } catch {
    return false;
  }
}

function readRequiredFile(projectDir, relativePath, byteLimit) {
  const absolutePath = confinedExistingFile(projectDir, relativePath);
  const stat = fs.lstatSync(absolutePath);
  if (stat.size > byteLimit) {
    throw new ElevationAuthoringError("budget_exceeded", `${relativePath} exceeds its elevation transaction byte limit.`);
  }
  return { relativePath, absolutePath, bytes: fs.readFileSync(absolutePath) };
}

function parseJsonFile(file, label) {
  try {
    return JSON.parse(file.bytes.toString("utf8"));
  } catch {
    throw new ElevationAuthoringError("source_invalid", `${label} must contain valid JSON.`);
  }
}

function confinedProjectRoot(projectDir) {
  try {
    const root = fs.realpathSync(path.resolve(projectDir));
    if (!fs.statSync(root).isDirectory()) throw new Error("not-directory");
    return root;
  } catch {
    throw new ElevationAuthoringError("source_unsafe", "Project directory must be an existing real directory.");
  }
}

function confinedExistingFile(projectDir, relativePath) {
  const absolutePath = confinedPath(projectDir, relativePath);
  const stat = fs.lstatSync(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new ElevationAuthoringError("source_unsafe", `${relativePath} must be a regular project file.`);
  }
  return absolutePath;
}

function confinedExistingDirectory(projectDir, relativePath) {
  const absolutePath = confinedPath(projectDir, relativePath);
  const stat = fs.lstatSync(absolutePath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new ElevationAuthoringError("source_unsafe", `${relativePath} must be a real project directory.`);
  }
  return absolutePath;
}

function confinedOrCreateDirectory(projectDir, relativePath) {
  let cursor = projectDir;
  for (const segment of relativePath.split("/")) {
    cursor = path.join(cursor, segment);
    try {
      const stat = fs.lstatSync(cursor);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("unsafe");
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw new ElevationAuthoringError("source_unsafe", `${relativePath} must stay inside real project directories.`);
      }
      fs.mkdirSync(cursor);
    }
  }
  return cursor;
}

function confinedPath(projectDir, relativePath) {
  if (typeof relativePath !== "string" || path.isAbsolute(relativePath) || relativePath.split("/").includes("..")) {
    throw new ElevationAuthoringError("source_unsafe", "Elevation transaction paths must be project-relative.");
  }
  let cursor = projectDir;
  for (const segment of relativePath.split("/")) {
    cursor = path.join(cursor, segment);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new ElevationAuthoringError("source_unsafe", `${relativePath} must not traverse symlinks.`);
  }
  const relative = path.relative(projectDir, cursor);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ElevationAuthoringError("source_unsafe", "Elevation transaction path escapes the project.");
  }
  return cursor;
}

function requireRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ElevationAuthoringError("request_invalid", "Elevation authoring request must be an object.");
  }
  return value;
}

function requireMapId(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || !/^[a-zA-Z0-9_.-]+$/.test(value)) {
    throw new ElevationAuthoringError("map_id_invalid", "mapId must be a non-empty safe identifier.");
  }
  return value;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function compareBinary(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
