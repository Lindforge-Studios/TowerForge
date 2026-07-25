import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  loadEngine,
  normalizeProjectFiles,
  readRawProjectFiles,
  validateProjectDir
} from "./project-loader.mjs";
import { PROJECT_SCHEMA_VERSION, validateProjectSchemas } from "./project-schema.mjs";
import { mergeValidationResults } from "./trace.mjs";

export const MECHANICS_AUTHORING_LIMITS = Object.freeze({
  definitionsPerKind: 4096,
  canonicalMechanicsBytes: 1024 * 1024
});

const TRANSACTION_FILES = Object.freeze([
  { key: "project", relativePath: "project.json", candidateKey: "manifest" },
  { key: "mechanics", relativePath: "content/mechanics.json", candidateKey: "mechanics" },
  { key: "balance", relativePath: "content/balance.json", candidateKey: "balance" }
]);
const MAX_INPUT_DEPTH = 64;
const MAX_INPUT_NODES = 100_000;
const MAX_INPUT_STRING_BYTES = 256 * 1024;
const MAX_INPUT_KEY_BYTES = 1024;
const MAX_INPUT_TOTAL_BYTES = 1024 * 1024;
const COMBAT_MODULE_SCHEMA_VERSIONS = Object.freeze([1, 2, 3]);
const MECHANICS_MODULE_SCHEMA_VERSIONS = Object.freeze({
  combat: COMBAT_MODULE_SCHEMA_VERSIONS,
  reactions: Object.freeze([1]),
  navigation: Object.freeze([1]),
  elevation: Object.freeze([1, 2, 3]),
  physics: Object.freeze([1])
});
const SOURCE_BYTE_LIMITS = Object.freeze({
  project: 256 * 1024,
  mechanics: MECHANICS_AUTHORING_LIMITS.canonicalMechanicsBytes,
  balance: 16 * 1024 * 1024
});
let transactionSequence = 0;

/**
 * A raw-byte revision for the complete mechanics authoring boundary. Formatting changes count,
 * and an absent mechanics file is intentionally distinct from an authored empty catalog.
 */
export function mechanicsAuthoringRevision(projectDir) {
  return readTransactionSnapshot(projectDir).revision;
}

/**
 * Read the complete mission-specific mechanics authoring view from one raw-byte transaction
 * snapshot. This function never creates mechanics.json and never persists a project migration.
 */
export async function inspectMechanicsAuthoring(projectDir, options = {}) {
  const snapshot = readTransactionSnapshot(projectDir);
  const request = cloneJsonData(options, "options", {
    depth: 0,
    nodes: 0,
    bytes: 0,
    maxBytes: MAX_INPUT_TOTAL_BYTES,
    maxStringBytes: MAX_INPUT_STRING_BYTES,
    maxKeyBytes: MAX_INPUT_KEY_BYTES
  });
  if (!isRecord(request) || (request.missionId !== undefined && typeof request.missionId !== "string")) {
    throw new MechanicsAuthoringError("request_invalid", "missionId must be a string when provided.");
  }

  const files = normalizeProjectFiles(snapshot.rawFiles);
  const engine = await loadEngine();
  const missionId = request.missionId ?? files.balance.defaultMissionId ?? files.manifest.defaultMissionId;
  const mission = typeof missionId === "string" ? ownValue(files.balance.missions, missionId) : undefined;
  if (typeof missionId !== "string" || !isRecord(mission)) {
    throw new MechanicsAuthoringError("mission_not_found", `Mission "${String(missionId)}" was not found.`);
  }

  const capabilities = engine.resolveCapabilitySet(files.mechanics, mission.mechanics);
  const combat = moduleAuthoringView(files, mission, "combat", engine.COMBAT_MECHANICS_SCHEMA);
  const reactions = moduleAuthoringView(files, mission, "reactions", engine.REACTIONS_MECHANICS_SCHEMA);
  const navigation = moduleAuthoringView(files, mission, "navigation", engine.NAVIGATION_MECHANICS_SCHEMA);
  const elevation = moduleAuthoringView(files, mission, "elevation", engine.ELEVATION_MECHANICS_SCHEMA);
  const physics = moduleAuthoringView(files, mission, "physics", engine.PHYSICS_MECHANICS_SCHEMA);

  const rawProjectSchemaVersion = snapshot.rawFiles.manifest?.schemaVersion;
  const authoring = authoringAvailability(rawProjectSchemaVersion);
  return {
    schemaVersion: 1,
    revision: snapshot.revision,
    rawProjectSchemaVersion,
    mechanicsAuthored: snapshot.files.mechanics.existed,
    missionId,
    mission: {
      id: missionId,
      ...(typeof mission.label === "string" ? { label: mission.label } : {})
    },
    authoring,
    capabilities,
    combat,
    reactions,
    navigation,
    elevation,
    physics
  };
}

function moduleAuthoringView(files, mission, moduleId, authoring) {
  const module = ownValue(files.mechanics?.modules, moduleId);
  const profiles = isRecord(module) && isRecord(module.profiles) ? module.profiles : {};
  const profileIds = Object.keys(profiles).sort(compareBinary);
  const selectedProfileId = isRecord(mission.mechanics) && isRecord(mission.mechanics.profiles)
    && typeof ownValue(mission.mechanics.profiles, moduleId) === "string"
    ? ownValue(mission.mechanics.profiles, moduleId)
    : undefined;
  const selectedProfile = typeof selectedProfileId === "string" && Object.hasOwn(profiles, selectedProfileId)
    ? cloneJsonData(profiles[selectedProfileId], `modules.${moduleId}.profiles.${selectedProfileId}`)
    : undefined;
  const profileUses = safeRecord();
  for (const profileId of profileIds) defineOwn(profileUses, profileId, []);
  for (const candidateMissionId of Object.keys(files.balance.missions ?? {}).sort(compareBinary)) {
    const candidate = files.balance.missions[candidateMissionId];
    const selected = isRecord(candidate?.mechanics) && isRecord(candidate.mechanics.profiles)
      ? ownValue(candidate.mechanics.profiles, moduleId)
      : undefined;
    if (typeof selected === "string") {
      if (!Object.hasOwn(profileUses, selected)) defineOwn(profileUses, selected, []);
      profileUses[selected].push(candidateMissionId);
    }
  }
  return {
    authoring,
    enabled: isRecord(module) && module.enabled === true,
    ...(isRecord(module) && Number.isInteger(module.schemaVersion)
      ? { moduleSchemaVersion: module.schemaVersion }
      : {}),
    ...(typeof selectedProfileId === "string" ? { selectedProfileId } : {}),
    profileIds,
    ...(selectedProfile === undefined ? {} : { selectedProfile }),
    profileUses
  };
}

/** Build and fully validate the exact three-file candidate without touching the project. */
export async function previewMechanicsModule(projectDir, args) {
  const plan = await buildPlan(projectDir, args);
  return publicPlan(plan);
}

/**
 * Apply a previewable mechanics change through one guarded three-file transaction.
 * `internalHooks` is deliberately not exposed by Studio/MCP; it exists for deterministic failure
 * injection at the atomic-replace boundary in the contract suite.
 */
export async function applyMechanicsModule(projectDir, args, internalHooks = {}) {
  const plan = await buildPlan(projectDir, args);
  if (plan.conflict || !plan.validation.ok) {
    return { ...publicPlan(plan), dryRun: false, written: false };
  }
  if (typeof plan.request.ifRevision !== "string" || plan.request.ifRevision.length === 0) {
    return invalidPublicResult(plan.projectDir, plan.revision, validationIssue(
      "revision_required",
      "ifRevision",
      "applyMechanicsModule requires the composite revision returned by preview."
    ), false);
  }
  if (plan.noOp) {
    return {
      projectDir: plan.projectDir,
      ok: true,
      dryRun: false,
      written: false,
      rolledBack: false,
      previousRevision: plan.revision,
      revision: plan.revision,
      candidate: plan.candidate,
      validation: plan.validation
    };
  }

  const payloads = Object.fromEntries(TRANSACTION_FILES.map((entry) => [
    entry.key,
    canonicalJson(plan.candidate[entry.candidateKey])
  ]));
  const staged = stagePayloads(plan.projectDir, payloads);
  let backup;
  const committedKeys = [];
  try {
    const beforeBackupRevision = mechanicsAuthoringRevision(plan.projectDir);
    if (beforeBackupRevision !== plan.revision) {
      return conflictResult(plan.projectDir, plan.revision, beforeBackupRevision, false);
    }

    backup = createBackup(plan.projectDir, plan.snapshot);
    const beforeCommitRevision = mechanicsAuthoringRevision(plan.projectDir);
    if (beforeCommitRevision !== plan.revision) {
      return conflictResult(plan.projectDir, plan.revision, beforeCommitRevision, false, backup);
    }

    for (const entry of TRANSACTION_FILES) {
      fs.renameSync(staged[entry.key], path.join(plan.projectDir, entry.relativePath));
      staged[entry.key] = null;
      committedKeys.push(entry.key);
      internalHooks.afterFileReplace?.(entry.relativePath);
    }

    const post = await validateProjectDir(plan.projectDir);
    if (!post.result.ok) {
      throw new PostWriteValidationError(post.result);
    }
    const ownershipConflicts = findOwnershipConflicts(plan.projectDir, payloads, committedKeys);
    if (ownershipConflicts.length > 0) {
      throw new MechanicsAuthoringError(
        "commit_conflict",
        "Mechanics source files changed before post-write validation completed.",
        { conflicts: ownershipConflicts }
      );
    }

    return {
      projectDir: plan.projectDir,
      ok: true,
      dryRun: false,
      written: true,
      rolledBack: false,
      previousRevision: plan.revision,
      revision: mechanicsAuthoringRevision(plan.projectDir),
      candidate: plan.candidate,
      validation: post.result,
      backup
    };
  } catch (error) {
    const rollback = rollbackOwnedWrites(plan.projectDir, plan.snapshot, payloads, committedKeys);
    if (!rollback.ok) {
      throw new MechanicsAuthoringError(
        rollback.conflicts.length > 0 ? "rollback_conflict" : "rollback_failed",
        "Mechanics authoring could not fully roll back because a committed file changed outside this transaction.",
        { cause: error, backup, rollback }
      );
    }
    if (error instanceof PostWriteValidationError) {
      return {
        projectDir: plan.projectDir,
        ok: false,
        dryRun: false,
        written: false,
        rolledBack: true,
        revision: plan.revision,
        candidate: plan.candidate,
        validation: error.validation,
        backup
      };
    }
    throw error;
  } finally {
    cleanupStaged(staged);
  }
}

async function buildPlan(projectDir, unsafeArgs) {
  const resolvedProjectDir = path.resolve(projectDir);
  let snapshot;
  try {
    snapshot = readTransactionSnapshot(resolvedProjectDir);
  } catch (error) {
    return {
      projectDir: resolvedProjectDir,
      request: {},
      revision: null,
      validation: {
        ok: false,
        issues: [error instanceof SourceBudgetError
          ? validationIssue("budget_exceeded", error.fieldPath, "A mechanics transaction source exceeds its byte budget.")
          : error instanceof SourceSafetyError
            ? validationIssue("source_unsafe", "project", "Mechanics transaction sources must be confined regular project files.")
            : validationIssue("source_invalid", "project", "Mechanics transaction sources must contain valid project JSON.")]
      }
    };
  }
  let request;
  try {
    request = cloneJsonData(unsafeArgs, "request", {
      depth: 0,
      nodes: 0,
      bytes: 0,
      maxBytes: MAX_INPUT_TOTAL_BYTES,
      maxStringBytes: MAX_INPUT_STRING_BYTES,
      maxKeyBytes: MAX_INPUT_KEY_BYTES
    });
  } catch (error) {
    return invalidPlan(resolvedProjectDir, snapshot, validationIssue(
      error instanceof SafeInputError ? error.code : "mechanics_input_unsafe",
      error instanceof SafeInputError ? error.fieldPath : "request",
      error instanceof SafeInputError && error.code === "budget_exceeded"
        ? "Mechanics input exceeds its 1 MiB aggregate, 256 KiB string, 1 KiB key, node, or depth budget."
        : "Mechanics input must contain only bounded JSON data properties."
    ));
  }
  if (!isRecord(request)) {
    return invalidPlan(resolvedProjectDir, snapshot, validationIssue(
      "mechanics_input_invalid", "request", "Mechanics authoring request must be an object."
    ));
  }
  if (request.enabled !== undefined && typeof request.enabled !== "boolean") {
    return invalidPlan(resolvedProjectDir, snapshot, validationIssue(
      "request_invalid", "enabled", "enabled must be a boolean when provided."
    ), request);
  }
  if (request.ifRevision !== undefined && typeof request.ifRevision !== "string") {
    return invalidPlan(resolvedProjectDir, snapshot, validationIssue(
      "request_invalid", "ifRevision", "ifRevision must be a string when provided."
    ), request);
  }
  if (request.ifRevision !== undefined && request.ifRevision !== snapshot.revision) {
    return {
      projectDir: resolvedProjectDir,
      snapshot,
      request,
      revision: snapshot.revision,
      conflict: true,
      expectedRevision: request.ifRevision,
      actualRevision: snapshot.revision,
      validation: { ok: false, issues: [] }
    };
  }

  const rawSchemaVersion = snapshot.rawFiles.manifest?.schemaVersion;
  if (!Number.isInteger(rawSchemaVersion) || rawSchemaVersion < 2) {
    return invalidPlan(resolvedProjectDir, snapshot, validationIssue(
      "project_migration_required",
      "project.json.schemaVersion",
      "Persist the project v2 migration before enabling mechanics; the narrow v3 transaction must not skip legacy content migrations."
    ), request);
  }
  if (rawSchemaVersion > PROJECT_SCHEMA_VERSION) {
    return invalidPlan(resolvedProjectDir, snapshot, validationIssue(
      "project_version_unsupported",
      "project.json.schemaVersion",
      `Project schemaVersion is newer than this authoring runtime supports (${PROJECT_SCHEMA_VERSION}).`
    ), request);
  }

  const engine = await loadEngine();
  if (typeof request.moduleId !== "string" || !engine.MECHANICS_MODULE_IDS.includes(request.moduleId)) {
    return invalidPlan(resolvedProjectDir, snapshot, validationIssue(
      "module_unknown", "moduleId", `Unknown or unsupported mechanics module "${String(request.moduleId)}".`
    ), request);
  }
  if (!engine.IMPLEMENTED_MECHANICS_MODULE_IDS.includes(request.moduleId)) {
    return invalidPlan(resolvedProjectDir, snapshot, validationIssue(
      "module_unavailable", "moduleId", `Mechanics module "${request.moduleId}" is not implemented by this engine version.`
    ), request);
  }
  const supportedModuleVersions = MECHANICS_MODULE_SCHEMA_VERSIONS[request.moduleId] ?? Object.freeze([]);
  if (request.moduleSchemaVersion !== undefined
    && (!Number.isInteger(request.moduleSchemaVersion)
      || !supportedModuleVersions.includes(request.moduleSchemaVersion))) {
    return invalidPlan(resolvedProjectDir, snapshot, validationIssue(
      "module_version_unsupported",
      "moduleSchemaVersion",
      `${request.moduleId} moduleSchemaVersion must be one of ${supportedModuleVersions.join(", ")}.`
    ), request);
  }

  let candidate;
  try {
    candidate = createCandidate(snapshot.rawFiles, request);
  } catch (error) {
    if (!(error instanceof CandidateInputError)) throw error;
    return invalidPlan(resolvedProjectDir, snapshot, validationIssue(error.code, error.fieldPath, error.message), request);
  }

  const budgetIssues = validateBudgets(candidate.mechanics);
  if (budgetIssues.length > 0) {
    return {
      projectDir: resolvedProjectDir,
      snapshot,
      request,
      revision: snapshot.revision,
      candidate,
      validation: { ok: false, issues: budgetIssues }
    };
  }

  const validation = await validateCandidate(snapshot.rawFiles, candidate, engine);
  const noOp = snapshot.files.mechanics.existed && TRANSACTION_FILES.every((entry) => (
    canonicalJson(snapshot.rawFiles[entry.candidateKey]) === canonicalJson(candidate[entry.candidateKey])
  ));
  return {
    projectDir: resolvedProjectDir,
    snapshot,
    request,
    revision: snapshot.revision,
    candidate,
    noOp,
    validation
  };
}

function createCandidate(rawFiles, request) {
  const manifest = cloneJsonData(rawFiles.manifest, "project.json");
  const balance = cloneJsonData(rawFiles.balance, "content/balance.json");
  const mechanics = rawFiles.mechanics === undefined
    ? { schemaVersion: 1, modules: {} }
    : cloneJsonData(rawFiles.mechanics, "content/mechanics.json");
  if (!isRecord(manifest) || !isRecord(balance) || !isRecord(mechanics)) {
    throw new CandidateInputError("mechanics_candidate_invalid", "root", "Project transaction files must contain JSON objects.");
  }
  manifest.schemaVersion = 3;

  if (!isRecord(mechanics.modules)) {
    throw new CandidateInputError("mechanics_modules_invalid", "modules", "Mechanics modules must be an object before a module can be edited.");
  }
  const existingModule = ownValue(mechanics.modules, request.moduleId);
  if (existingModule !== undefined && !isRecord(existingModule)) {
    throw new CandidateInputError("mechanics_module_invalid", `modules.${request.moduleId}`, "The mechanics module must be an object.");
  }
  const existingVersion = isRecord(existingModule) ? existingModule.schemaVersion : undefined;
  const supportedModuleVersions = MECHANICS_MODULE_SCHEMA_VERSIONS[request.moduleId] ?? [];
  if (existingModule !== undefined
    && (!Number.isInteger(existingVersion) || !supportedModuleVersions.includes(existingVersion))) {
    throw new CandidateInputError(
      "module_version_unsupported",
      `modules.${request.moduleId}.schemaVersion`,
      `The authored ${request.moduleId} module schemaVersion is not supported; expected one of ${supportedModuleVersions.join(", ")}.`
    );
  }
  const targetVersion = request.moduleSchemaVersion ?? existingVersion ?? 1;
  if (existingVersion !== undefined && targetVersion < existingVersion) {
    throw new CandidateInputError(
      "module_version_downgrade",
      "moduleSchemaVersion",
      `${request.moduleId} module schemaVersion ${existingVersion} cannot be downgraded to ${targetVersion}.`
    );
  }
  if (request.moduleId === "combat"
    && existingVersion !== undefined
    && targetVersion > existingVersion
    && targetVersion !== 2
    && targetVersion !== 3) {
    throw new CandidateInputError(
      "module_version_upgrade_unsupported",
      "moduleSchemaVersion",
      "Combat module schemaVersion can only be upgraded monotonically from v1/v2 to v2/v3."
    );
  }
  if (request.enabled === false) {
    if (!isRecord(existingModule)) {
      throw new CandidateInputError("module_missing", `modules.${request.moduleId}`, "A missing mechanics module cannot be disabled without synthesizing content.");
    }
    if (targetVersion !== existingVersion) {
      throw new CandidateInputError(
        "module_version_change_requires_enable",
        "moduleSchemaVersion",
        "Disable operations preserve the authored module schemaVersion; preview the version upgrade while enabling a profile."
      );
    }
    existingModule.enabled = false;
    return { manifest, balance, mechanics };
  }

  const missionId = resolveMissionId(request, balance, manifest);
  if (!isRecord(balance.missions) || !Object.hasOwn(balance.missions, missionId) || !isRecord(balance.missions[missionId])) {
    throw new CandidateInputError("mission_not_found", `missions.${missionId}`, `Mission "${missionId}" was not found.`);
  }
  const mission = balance.missions[missionId];
  const module = existingModule ?? { schemaVersion: targetVersion, enabled: true, profiles: {} };
  if (!isRecord(module.profiles)) {
    throw new CandidateInputError("mechanics_profiles_invalid", `modules.${request.moduleId}.profiles`, "Mechanics profiles must be an object before a profile can be edited.");
  }
  if (existingModule === undefined) defineOwn(mechanics.modules, request.moduleId, module);
  module.schemaVersion = targetVersion;

  const existingSelection = isRecord(mission.mechanics) && isRecord(mission.mechanics.profiles)
    ? ownValue(mission.mechanics.profiles, request.moduleId)
    : undefined;
  const profileId = typeof request.profileId === "string" && request.profileId.length > 0
    ? request.profileId
    : typeof existingSelection === "string" && existingSelection.length > 0
      ? existingSelection
      : undefined;
  if (!profileId) {
    throw new CandidateInputError("profile_required", "profileId", "Enabling mechanics requires a profileId or an existing mission selection.");
  }

  let profile;
  if (Object.hasOwn(request, "profile")) {
    profile = request.profile;
  } else {
    profile = ownValue(module.profiles, profileId);
  }
  if (!isRecord(profile)) {
    throw new CandidateInputError("profile_required", `modules.${request.moduleId}.profiles.${profileId}`, "The selected mechanics profile does not exist and no profile payload was provided.");
  }
  defineOwn(module.profiles, profileId, profile);
  module.enabled = true;

  if (mission.mechanics !== undefined && !isRecord(mission.mechanics)) {
    throw new CandidateInputError("mission_mechanics_invalid", `missions.${missionId}.mechanics`, "Mission mechanics must be an object.");
  }
  mission.mechanics ??= {};
  if (mission.mechanics.profiles !== undefined && !isRecord(mission.mechanics.profiles)) {
    throw new CandidateInputError("mission_mechanics_invalid", `missions.${missionId}.mechanics.profiles`, "Mission mechanics profiles must be an object.");
  }
  mission.mechanics.profiles ??= {};
  defineOwn(mission.mechanics.profiles, request.moduleId, profileId);
  return { manifest, balance, mechanics };
}

async function validateCandidate(rawFiles, candidate, engine) {
  try {
    const normalized = normalizeProjectFiles({
      ...rawFiles,
      manifest: candidate.manifest,
      balance: candidate.balance,
      mechanics: candidate.mechanics
    });
    const content = engine.createGameContentRegistry({
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
      engine.validateGameContentRegistry(content)
    );
  } catch {
    return {
      ok: false,
      issues: [validationIssue(
        "mechanics_candidate_invalid", "root", "The complete mechanics candidate could not be normalized and validated safely."
      )]
    };
  }
}

function validateBudgets(mechanics) {
  const issues = [];
  const profiles = mechanics?.modules?.combat?.profiles;
  if (isRecord(profiles)) {
    for (const profileId of Object.keys(profiles)) {
      const shields = profiles[profileId]?.shields;
      if (!isRecord(shields)) continue;
      for (const kind of ["enemies", "towers"]) {
        const definitions = shields[kind];
        if (isRecord(definitions) && Object.keys(definitions).length > MECHANICS_AUTHORING_LIMITS.definitionsPerKind) {
          issues.push(validationIssue(
            "mechanics_definition_limit",
            `modules.combat.profiles.${profileId}.shields.${kind}`,
            `Shield definitions exceed the ${MECHANICS_AUTHORING_LIMITS.definitionsPerKind} definition limit for ${kind}.`
          ));
        }
      }
    }
  }
  const byteLength = Buffer.byteLength(canonicalJson(mechanics));
  if (byteLength > MECHANICS_AUTHORING_LIMITS.canonicalMechanicsBytes) {
    issues.push(validationIssue(
      "mechanics_size_limit",
      "content/mechanics.json",
      `Canonical mechanics content exceeds the 1 MiB (${MECHANICS_AUTHORING_LIMITS.canonicalMechanicsBytes} byte) limit.`
    ));
  }
  return issues;
}

function readTransactionSnapshot(projectDir) {
  const resolvedProjectDir = confinedProjectRoot(projectDir);
  const files = {};
  for (const entry of TRANSACTION_FILES) {
    const filePath = path.join(resolvedProjectDir, entry.relativePath);
    const stat = assertSafeTransactionPath(resolvedProjectDir, entry.relativePath, entry.key !== "mechanics");
    if (stat && stat.size > SOURCE_BYTE_LIMITS[entry.key]) throw new SourceBudgetError(entry.relativePath);
    if (entry.key === "mechanics") {
      try {
        files[entry.key] = { existed: true, bytes: fs.readFileSync(filePath), filePath };
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        files[entry.key] = { existed: false, bytes: null, filePath };
      }
    } else {
      files[entry.key] = { existed: true, bytes: fs.readFileSync(filePath), filePath };
    }
  }
  const rawFiles = readRawProjectFiles(resolvedProjectDir);
  rawFiles.manifest = JSON.parse(files.project.bytes.toString("utf8"));
  rawFiles.balance = JSON.parse(files.balance.bytes.toString("utf8"));
  rawFiles.mechanics = files.mechanics.existed
    ? JSON.parse(files.mechanics.bytes.toString("utf8"))
    : undefined;
  return {
    projectDir: resolvedProjectDir,
    files,
    rawFiles,
    revision: revisionFromFiles(files)
  };
}

function revisionFromFiles(files) {
  const hash = createHash("sha256");
  for (const entry of TRANSACTION_FILES) {
    const file = files[entry.key];
    hash.update(`${entry.relativePath}\0${file.existed ? "present" : "absent"}\0`);
    if (file.bytes) {
      hash.update(String(file.bytes.length));
      hash.update("\0");
      hash.update(file.bytes);
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}

function stagePayloads(projectDir, payloads) {
  const sequence = `${process.pid}.${transactionSequence++}`;
  const staged = {};
  try {
    for (const entry of TRANSACTION_FILES) {
      const target = path.join(projectDir, entry.relativePath);
      ensureConfinedDirectory(projectDir, path.dirname(entry.relativePath));
      const temp = `${target}.mechanics-stage.${sequence}`;
      fs.writeFileSync(temp, payloads[entry.key], { encoding: "utf8", flag: "wx" });
      staged[entry.key] = temp;
    }
    return staged;
  } catch (error) {
    cleanupStaged(staged);
    throw error;
  }
}

function cleanupStaged(staged) {
  for (const temp of Object.values(staged ?? {})) {
    if (temp) fs.rmSync(temp, { force: true });
  }
}

function createBackup(projectDir, snapshot) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = ensureConfinedDirectory(projectDir, path.join(".towerforge", "backups"));
  const directory = path.join(backupRoot, `mechanics-${stamp}-${String(transactionSequence++).padStart(6, "0")}`);
  fs.mkdirSync(directory);
  const files = {};
  for (const entry of TRANSACTION_FILES) {
    const original = snapshot.files[entry.key];
    const backupPath = path.join(directory, entry.relativePath);
    files[entry.key] = { existed: original.existed, path: original.existed ? backupPath : null };
    if (!original.existed) continue;
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, original.bytes);
  }
  const transactions = fs.readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("mechanics-"))
    .map((entry) => entry.name)
    .sort();
  for (const stale of transactions.slice(0, Math.max(0, transactions.length - 20))) {
    fs.rmSync(path.join(backupRoot, stale), { recursive: true, force: true });
  }
  return { directory, files };
}

function rollbackOwnedWrites(projectDir, snapshot, payloads, committedKeys) {
  const conflicts = [];
  const failures = [];
  const committed = new Set(committedKeys);
  for (const entry of [...TRANSACTION_FILES].reverse()) {
    if (!committed.has(entry.key)) continue;
    const original = snapshot.files[entry.key];
    const target = path.join(projectDir, entry.relativePath);
    try {
      const stat = fs.lstatSync(target);
      const current = stat.isFile() && !stat.isSymbolicLink() ? fs.readFileSync(target) : null;
      const ownedBytes = Buffer.from(payloads[entry.key], "utf8");
      if (!current || !current.equals(ownedBytes)) {
        conflicts.push(entry.relativePath);
        continue;
      }
      if (!original.existed) {
        fs.rmSync(target, { force: true });
        continue;
      }
      writeBytesAtomic(target, original.bytes);
    } catch (error) {
      if (error?.code === "ENOENT") conflicts.push(entry.relativePath);
      else failures.push(entry.relativePath);
    }
  }
  if (conflicts.length === 0 && failures.length === 0) {
    try {
      if (mechanicsAuthoringRevision(projectDir) !== snapshot.revision) failures.push("revision");
    } catch {
      failures.push("revision");
    }
  }
  return { ok: conflicts.length === 0 && failures.length === 0, conflicts, failures };
}

function findOwnershipConflicts(projectDir, payloads, committedKeys) {
  const conflicts = [];
  for (const entry of TRANSACTION_FILES) {
    if (!committedKeys.includes(entry.key)) continue;
    const target = path.join(projectDir, entry.relativePath);
    try {
      const stat = fs.lstatSync(target);
      const current = stat.isFile() && !stat.isSymbolicLink() ? fs.readFileSync(target) : null;
      if (!current || !current.equals(Buffer.from(payloads[entry.key], "utf8"))) {
        conflicts.push(entry.relativePath);
      }
    } catch {
      conflicts.push(entry.relativePath);
    }
  }
  return conflicts;
}

function writeBytesAtomic(filePath, bytes) {
  const temp = `${filePath}.mechanics-rollback.${process.pid}.${transactionSequence++}`;
  try {
    fs.writeFileSync(temp, bytes, { flag: "wx" });
    fs.renameSync(temp, filePath);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

function confinedProjectRoot(projectDir) {
  let root;
  try {
    root = fs.realpathSync(path.resolve(projectDir));
    if (!fs.statSync(root).isDirectory()) throw new Error("not-directory");
  } catch {
    throw new SourceSafetyError();
  }
  return root;
}

function assertSafeTransactionPath(projectDir, relativePath, required) {
  const segments = relativePath.split("/");
  let cursor = projectDir;
  for (const segment of segments.slice(0, -1)) {
    cursor = path.join(cursor, segment);
    let stat;
    try {
      stat = fs.lstatSync(cursor);
    } catch {
      throw new SourceSafetyError();
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new SourceSafetyError();
  }
  const target = path.join(projectDir, relativePath);
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new SourceSafetyError();
    return stat;
  } catch (error) {
    if (!required && error?.code === "ENOENT") return null;
    if (error instanceof SourceSafetyError) throw error;
    throw new SourceSafetyError();
  }
}

function ensureConfinedDirectory(projectDir, relativePath) {
  let cursor = projectDir;
  for (const segment of relativePath.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    try {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new SourceSafetyError();
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      fs.mkdirSync(cursor);
    }
  }
  return cursor;
}

function publicPlan(plan) {
  if (plan.conflict) {
    return conflictResult(
      plan.projectDir,
      plan.expectedRevision,
      plan.actualRevision,
      true
    );
  }
  return {
    projectDir: plan.projectDir,
    ok: plan.validation.ok,
    dryRun: true,
    written: false,
    revision: plan.revision,
    ...(plan.snapshot?.rawFiles?.manifest?.schemaVersion === 2
      ? { migration: { required: true, from: 2, to: PROJECT_SCHEMA_VERSION } }
      : {}),
    ...(plan.candidate ? { candidate: plan.candidate } : {}),
    validation: plan.validation
  };
}

function invalidPlan(projectDir, snapshot, issue, request = {}) {
  return {
    projectDir,
    snapshot,
    request,
    revision: snapshot.revision,
    validation: { ok: false, issues: [issue] }
  };
}

function invalidPublicResult(projectDir, revision, issue, dryRun) {
  return {
    projectDir,
    ok: false,
    dryRun,
    written: false,
    revision,
    validation: { ok: false, issues: [issue] }
  };
}

function conflictResult(projectDir, expectedRevision, actualRevision, dryRun, backup) {
  return {
    projectDir,
    ok: false,
    dryRun,
    written: false,
    conflict: true,
    expectedRevision,
    actualRevision,
    ...(backup ? { backup } : {})
  };
}

function validationIssue(code, fieldPath, message) {
  return {
    severity: "error",
    entityKind: "mechanics",
    entityId: "combat",
    fieldPath,
    message,
    code
  };
}

function resolveMissionId(request, balance, manifest) {
  const missionId = request.missionId ?? balance.defaultMissionId ?? manifest.defaultMissionId;
  if (typeof missionId !== "string" || missionId.length === 0) {
    throw new CandidateInputError("mission_required", "missionId", "Mechanics authoring requires a missionId or project default mission.");
  }
  return missionId;
}

function ownValue(record, key) {
  return isRecord(record) && Object.hasOwn(record, key) ? record[key] : undefined;
}

function authoringAvailability(rawProjectSchemaVersion) {
  if (!Number.isInteger(rawProjectSchemaVersion) || rawProjectSchemaVersion < 2) {
    return {
      writable: false,
      code: "project_migration_required",
      message: "Persist the project v2 migration before enabling mechanics."
    };
  }
  if (rawProjectSchemaVersion > PROJECT_SCHEMA_VERSION) {
    return {
      writable: false,
      code: "project_version_unsupported",
      message: `Project schemaVersion is newer than this authoring runtime supports (${PROJECT_SCHEMA_VERSION}).`
    };
  }
  return { writable: true };
}

function compareBinary(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeRecord() {
  return Object.create(null);
}

function defineOwn(record, key, value) {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true
  });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function cloneJsonData(value, fieldPath, state = {
  depth: 0,
  nodes: 0,
  bytes: 0,
  maxBytes: Number.POSITIVE_INFINITY,
  maxStringBytes: Number.POSITIVE_INFINITY,
  maxKeyBytes: Number.POSITIVE_INFINITY
}) {
  state.nodes += 1;
  if (state.nodes > MAX_INPUT_NODES || state.depth > MAX_INPUT_DEPTH) {
    throw new SafeInputError(fieldPath, "budget_exceeded");
  }
  if (value === null) {
    consumeInputBytes(state, 4, fieldPath);
    return value;
  }
  if (typeof value === "boolean") {
    consumeInputBytes(state, value ? 4 : 5, fieldPath);
    return value;
  }
  if (typeof value === "string") {
    const bytes = Buffer.byteLength(value, "utf8");
    if (bytes > state.maxStringBytes) {
      throw new SafeInputError(fieldPath, "budget_exceeded");
    }
    consumeInputBytes(state, bytes, fieldPath);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new SafeInputError(fieldPath);
    consumeInputBytes(state, Math.max(8, String(value).length), fieldPath);
    return value;
  }
  if (typeof value !== "object") throw new SafeInputError(fieldPath);

  let descriptors;
  let prototype;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
    prototype = Object.getPrototypeOf(value);
  } catch {
    throw new SafeInputError(fieldPath);
  }
  if (Object.getOwnPropertySymbols(descriptors).length > 0) throw new SafeInputError(fieldPath);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) throw new SafeInputError(fieldPath);
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor || !("value" in lengthDescriptor) || !Number.isInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 0 || lengthDescriptor.value > MAX_INPUT_NODES - state.nodes) {
      throw new SafeInputError(fieldPath, "budget_exceeded");
    }
    const length = lengthDescriptor.value;
    for (const key of Object.keys(descriptors)) {
      if (key === "length") continue;
      const keyBytes = Buffer.byteLength(key, "utf8");
      if (keyBytes > state.maxKeyBytes) throw new SafeInputError(fieldPath, "budget_exceeded");
      consumeInputBytes(state, keyBytes, fieldPath);
      if (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length) {
        throw new SafeInputError(`${fieldPath}.${key}`);
      }
    }
    const result = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new SafeInputError(`${fieldPath}[${index}]`);
      }
      const childState = {
        depth: state.depth + 1,
        nodes: state.nodes,
        bytes: state.bytes,
        maxBytes: state.maxBytes,
        maxStringBytes: state.maxStringBytes,
        maxKeyBytes: state.maxKeyBytes
      };
      result.push(cloneJsonData(descriptor.value, `${fieldPath}[${index}]`, childState));
      state.nodes = childState.nodes;
      state.bytes = childState.bytes;
    }
    return result;
  }
  if (prototype !== Object.prototype && prototype !== null) throw new SafeInputError(fieldPath);
  const result = {};
  for (const key of Object.keys(descriptors)) {
    const keyBytes = Buffer.byteLength(key, "utf8");
    if (keyBytes > state.maxKeyBytes) throw new SafeInputError(fieldPath, "budget_exceeded");
    consumeInputBytes(state, keyBytes, fieldPath);
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new SafeInputError(`${fieldPath}.${key}`);
    }
    const childState = {
      depth: state.depth + 1,
      nodes: state.nodes,
      bytes: state.bytes,
      maxBytes: state.maxBytes,
      maxStringBytes: state.maxStringBytes,
      maxKeyBytes: state.maxKeyBytes
    };
    const cloned = cloneJsonData(descriptor.value, `${fieldPath}.${key}`, childState);
    state.nodes = childState.nodes;
    state.bytes = childState.bytes;
    defineOwn(result, key, cloned);
  }
  return result;
}

function consumeInputBytes(state, bytes, fieldPath) {
  state.bytes += bytes;
  if (state.bytes > state.maxBytes) throw new SafeInputError(fieldPath, "budget_exceeded");
}

class SafeInputError extends Error {
  constructor(fieldPath, code = "mechanics_input_unsafe") {
    super("Unsafe mechanics input.");
    this.fieldPath = fieldPath;
    this.code = code;
  }
}

class CandidateInputError extends Error {
  constructor(code, fieldPath, message) {
    super(message);
    this.code = code;
    this.fieldPath = fieldPath;
  }
}

class PostWriteValidationError extends Error {
  constructor(validation) {
    super("The committed mechanics candidate failed post-write validation.");
    this.validation = validation;
  }
}

export class MechanicsAuthoringError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "MechanicsAuthoringError";
    this.code = code;
    Object.assign(this, details);
  }
}

class SourceSafetyError extends MechanicsAuthoringError {
  constructor() {
    super("source_unsafe", "Mechanics transaction sources are unsafe.");
  }
}

class SourceBudgetError extends MechanicsAuthoringError {
  constructor(fieldPath) {
    super("budget_exceeded", "Mechanics transaction source budget exceeded.");
    this.fieldPath = fieldPath;
  }
}
