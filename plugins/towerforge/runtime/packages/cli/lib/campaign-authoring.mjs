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

const TRANSACTION_FILES = Object.freeze([
  { key: "project", relativePath: "project.json", candidateKey: "manifest", limit: 256 * 1024 },
  { key: "worldMap", relativePath: "content/world-map.json", candidateKey: "worldMap", limit: 16 * 1024 * 1024 },
  { key: "balance", relativePath: "content/balance.json", candidateKey: "balance", limit: 16 * 1024 * 1024 },
  { key: "mechanics", relativePath: "content/mechanics.json", candidateKey: "mechanics", limit: 1024 * 1024 }
]);
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_REQUEST_DEPTH = 32;
const MAX_REQUEST_NODES = 100_000;
let transactionSequence = 0;

const CAMPAIGN_ID_SCHEMA = Object.freeze({
  type: "string",
  minLength: 1,
  maxLength: 128,
  description: "Non-empty identifier; the runtime additionally enforces the exact 128 UTF-8 byte budget."
});
const CAMPAIGN_NODE_BASE_PROPERTIES = Object.freeze({
  id: CAMPAIGN_ID_SCHEMA,
  regionId: CAMPAIGN_ID_SCHEMA,
  x: Object.freeze({ type: "number" }),
  y: Object.freeze({ type: "number" }),
  difficulty: Object.freeze({ type: "integer", minimum: 1, maximum: 5 }),
  nextNodeIds: Object.freeze({
    type: "array",
    maxItems: 8_192,
    uniqueItems: true,
    items: CAMPAIGN_ID_SCHEMA,
    description: "Outgoing node identifiers; the complete graph has an 8192 edge budget."
  })
});
const CAMPAIGN_BATTLE_NODE_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({
    ...CAMPAIGN_NODE_BASE_PROPERTIES,
    type: Object.freeze({ type: "string", enum: Object.freeze(["battle", "elite", "boss"]) }),
    missionId: CAMPAIGN_ID_SCHEMA
  }),
  required: Object.freeze(["id", "type", "missionId", "regionId", "x", "y", "difficulty", "nextNodeIds"]),
  additionalProperties: false
});
const CAMPAIGN_STRUCTURAL_NODE_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({
    ...CAMPAIGN_NODE_BASE_PROPERTIES,
    type: Object.freeze({ type: "string", enum: Object.freeze(["merchant", "event"]) }),
    label: Object.freeze({
      type: "string",
      minLength: 1,
      maxLength: 256,
      description: "Presentation label; the runtime additionally enforces the exact 256 UTF-8 byte budget."
    })
  }),
  required: Object.freeze(["id", "type", "label", "regionId", "x", "y", "difficulty", "nextNodeIds"]),
  additionalProperties: false
});

const CAMPAIGN_RUN_RESOURCE_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({
    label: Object.freeze({ type: "string", minLength: 1, maxLength: 256 })
  }),
  required: Object.freeze(["label"]),
  additionalProperties: false
});
const CAMPAIGN_RESOURCE_BAG_SCHEMA = Object.freeze({
  type: "object",
  maxProperties: 16,
  propertyNames: CAMPAIGN_ID_SCHEMA,
  additionalProperties: Object.freeze({ type: "integer", minimum: 0, maximum: 1_000_000_000 })
});
const CAMPAIGN_STRUCTURAL_CHOICE_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({
    id: CAMPAIGN_ID_SCHEMA,
    label: Object.freeze({ type: "string", minLength: 1, maxLength: 256 }),
    costs: CAMPAIGN_RESOURCE_BAG_SCHEMA,
    grants: CAMPAIGN_RESOURCE_BAG_SCHEMA
  }),
  required: Object.freeze(["id", "label", "costs", "grants"]),
  additionalProperties: false
});
const CAMPAIGN_STRUCTURAL_NODE_V2_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({
    ...CAMPAIGN_NODE_BASE_PROPERTIES,
    type: Object.freeze({ type: "string", enum: Object.freeze(["merchant", "event"]) }),
    label: Object.freeze({
      type: "string",
      minLength: 1,
      maxLength: 256,
      description: "Presentation label; the runtime additionally enforces the exact 256 UTF-8 byte budget."
    }),
    choices: Object.freeze({
      type: "array",
      minItems: 1,
      maxItems: 16,
      items: CAMPAIGN_STRUCTURAL_CHOICE_SCHEMA
    })
  }),
  required: Object.freeze(["id", "type", "label", "regionId", "x", "y", "difficulty", "nextNodeIds", "choices"]),
  additionalProperties: false
});

const CAMPAIGN_GRAPH_V1_INPUT_SCHEMA = Object.freeze({
  type: "object",
  description: "Exact bounded WorldCampaign v1 graph.",
  properties: Object.freeze({
    schemaVersion: Object.freeze({ type: "integer", const: 1 }),
    rogueliteProfileId: CAMPAIGN_ID_SCHEMA,
    entryNodeIds: Object.freeze({
      type: "array",
      minItems: 1,
      maxItems: 64,
      uniqueItems: true,
      items: CAMPAIGN_ID_SCHEMA
    }),
    nodes: Object.freeze({
      type: "array",
      minItems: 1,
      maxItems: 1_024,
      items: Object.freeze({ oneOf: Object.freeze([CAMPAIGN_BATTLE_NODE_SCHEMA, CAMPAIGN_STRUCTURAL_NODE_SCHEMA]) })
    })
  }),
  required: Object.freeze(["schemaVersion", "rogueliteProfileId", "entryNodeIds", "nodes"]),
  additionalProperties: false
});

const CAMPAIGN_GRAPH_V2_INPUT_SCHEMA = Object.freeze({
  type: "object",
  description: "Exact bounded WorldCampaign v2 graph with declared run resources and atomic structural choices.",
  properties: Object.freeze({
    schemaVersion: Object.freeze({ type: "integer", const: 2 }),
    rogueliteProfileId: CAMPAIGN_ID_SCHEMA,
    runResources: Object.freeze({
      type: "object",
      maxProperties: 256,
      propertyNames: CAMPAIGN_ID_SCHEMA,
      additionalProperties: CAMPAIGN_RUN_RESOURCE_SCHEMA
    }),
    entryNodeIds: Object.freeze({
      type: "array",
      minItems: 1,
      maxItems: 64,
      uniqueItems: true,
      items: CAMPAIGN_ID_SCHEMA
    }),
    nodes: Object.freeze({
      type: "array",
      minItems: 1,
      maxItems: 1_024,
      items: Object.freeze({ oneOf: Object.freeze([CAMPAIGN_BATTLE_NODE_SCHEMA, CAMPAIGN_STRUCTURAL_NODE_V2_SCHEMA]) })
    })
  }),
  required: Object.freeze(["schemaVersion", "rogueliteProfileId", "runResources", "entryNodeIds", "nodes"]),
  additionalProperties: false
});

/** Exact closed MCP/CLI input schema for authored WorldCampaign v1/v2 graphs. */
export const CAMPAIGN_GRAPH_INPUT_SCHEMA = Object.freeze({
  description: "Exact bounded WorldCampaign v1/v2 graph; semantic references, DAG reachability, structural resources, total edges and UTF-8 budgets are validated before write.",
  oneOf: Object.freeze([CAMPAIGN_GRAPH_V1_INPUT_SCHEMA, CAMPAIGN_GRAPH_V2_INPUT_SCHEMA])
});

export class CampaignAuthoringError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CampaignAuthoringError";
    this.code = code;
    Object.assign(this, details);
  }
}

/** Raw-byte revision over every source owned by the campaign authoring transaction. */
export function campaignAuthoringRevision(projectDir) {
  return readSnapshot(projectDir).revision;
}

/** Read the authored campaign and its opt-in state without normalizing or writing project files. */
export async function inspectCampaignAuthoring(projectDir) {
  const snapshot = readSnapshot(projectDir);
  const raw = snapshot.rawFiles;
  const campaign = ownValue(ownRecord(raw.worldMap), "campaign");
  const campaignAuthored = campaign !== undefined;
  const profileId = campaignAuthored && typeof campaign?.rogueliteProfileId === "string"
    ? campaign.rogueliteProfileId
    : undefined;
  const module = ownValue(ownRecord(ownValue(ownRecord(raw.mechanics), "modules")), "roguelite");
  const profile = profileId
    ? ownValue(ownRecord(ownValue(ownRecord(module), "profiles")), profileId)
    : undefined;
  const campaignMarker = ownValue(ownRecord(profile), "campaign");
  let active = Boolean(
    campaignAuthored
    && module?.enabled === true
    && module?.schemaVersion === 4
    && campaignMarker?.schemaVersion === 1
  );
  if (active) {
    try {
      const files = normalizeProjectFiles(raw);
      const engine = await loadEngine();
      const content = engine.createGameContentRegistry({
        balance: files.balance,
        maps: files.maps,
        worldMap: files.worldMap,
        scripts: files.scripts,
        mechanics: files.mechanics,
        visuals: files.visuals,
        storyComics: files.storyComics,
        battleBackgrounds: files.battleBackgrounds
      });
      active = engine.resolveWorldCampaign(content) !== undefined;
    } catch {
      active = false;
    }
  }
  return {
    schemaVersion: 1,
    projectDir: snapshot.projectDir,
    revision: snapshot.revision,
    rawProjectSchemaVersion: raw.manifest?.schemaVersion,
    campaignAuthored,
    active,
    ...(profileId ? { profileId } : {}),
    ...(campaignAuthored ? { campaign: cloneJson(campaign) } : {})
  };
}

/** Build and fully validate the exact four-file candidate without touching the project tree. */
export async function previewCampaignAuthoring(projectDir, args) {
  const plan = await buildPlan(projectDir, args);
  return publicPlan(plan, true);
}

/** Apply a previewed campaign candidate with revision guard, backup, validation and rollback. */
export async function applyCampaignAuthoring(projectDir, args, internalHooks = {}) {
  const plan = await buildPlan(projectDir, args);
  if (plan.conflict || !plan.validation.ok) return publicPlan(plan, false);
  if (typeof plan.request.ifRevision !== "string" || plan.request.ifRevision.length === 0) {
    return invalidResult(plan, "revision_required", "ifRevision", "Campaign apply requires the revision returned by preview.", false);
  }
  if (plan.noOp) {
    assertRevision(plan.projectDir, plan.revision);
    return {
      ...publicPlan(plan, false),
      written: false,
      rolledBack: false,
      previousRevision: plan.revision,
      revision: plan.revision
    };
  }

  const payloads = Object.fromEntries(TRANSACTION_FILES.map((entry) => [
    entry.key,
    canonicalJson(plan.candidate[entry.candidateKey])
  ]));
  const directoryBindings = bindTransactionDirectories(plan.projectDir);
  const staged = stagePayloads(plan.projectDir, payloads, directoryBindings);
  const committedKeys = [];
  let backup;
  try {
    assertRevision(plan.projectDir, plan.revision);
    backup = createBackup(plan.projectDir, plan.snapshot);
    assertRevision(plan.projectDir, plan.revision);

    for (const entry of TRANSACTION_FILES) {
      assertPartialOwnership(plan, payloads, committedKeys, directoryBindings);
      assertBoundTransactionParent(entry, directoryBindings);
      fs.renameSync(staged[entry.key], path.join(plan.projectDir, entry.relativePath));
      staged[entry.key] = null;
      committedKeys.push(entry.key);
      internalHooks.afterFileReplace?.(entry.relativePath);
    }

    const post = await validateProjectDir(plan.projectDir);
    if (!post.result.ok) {
      throw new CampaignAuthoringError(
        "post_write_validation_failed",
        "The committed campaign candidate failed complete project validation.",
        { validation: post.result }
      );
    }
    assertPartialOwnership(plan, payloads, committedKeys, directoryBindings);
    return {
      ...publicPlan(plan, false),
      written: true,
      rolledBack: false,
      previousRevision: plan.revision,
      revision: campaignAuthoringRevision(plan.projectDir),
      backup
    };
  } catch (error) {
    const rollback = rollbackOwnedWrites(plan, payloads, committedKeys, directoryBindings);
    if (!rollback.ok) {
      throw new CampaignAuthoringError(
        rollback.conflicts.length > 0 ? "rollback_conflict" : "rollback_failed",
        "Campaign authoring could not fully restore its owned files.",
        { cause: error, backup, rollback }
      );
    }
    if (error instanceof CampaignAuthoringError) {
      error.backup = backup;
      error.rolledBack = committedKeys.length > 0;
      throw error;
    }
    throw error;
  } finally {
    cleanupStaged(staged, directoryBindings);
  }
}

async function buildPlan(projectDir, unsafeArgs) {
  const snapshot = readSnapshot(projectDir);
  let request;
  try {
    request = detachJson(unsafeArgs, "request");
  } catch (error) {
    return invalidPlan(snapshot, error.code ?? "campaign_input_unsafe", error.fieldPath ?? "request", error.message);
  }
  if (!ownRecord(request)) {
    return invalidPlan(snapshot, "invalid_request", "request", "Campaign authoring request must be an object.", {});
  }
  const allowed = new Set(["profileId", "campaign", "enabled", "ifRevision"]);
  const unknown = Object.keys(request).find((key) => !allowed.has(key));
  if (unknown) return invalidPlan(snapshot, "invalid_request", unknown, `Unknown campaign request field "${unknown}".`, request);
  if (typeof request.profileId !== "string" || request.profileId.length === 0 || Buffer.byteLength(request.profileId) > 128) {
    return invalidPlan(snapshot, "invalid_request", "profileId", "profileId must be a non-empty string up to 128 UTF-8 bytes.", request);
  }
  if (request.enabled !== undefined && typeof request.enabled !== "boolean") {
    return invalidPlan(snapshot, "invalid_request", "enabled", "enabled must be a boolean when provided.", request);
  }
  if (request.ifRevision !== undefined && typeof request.ifRevision !== "string") {
    return invalidPlan(snapshot, "invalid_request", "ifRevision", "ifRevision must be a string when provided.", request);
  }
  if (request.ifRevision !== undefined && request.ifRevision !== snapshot.revision) {
    return {
      projectDir: snapshot.projectDir,
      snapshot,
      request,
      revision: snapshot.revision,
      conflict: true,
      expectedRevision: request.ifRevision,
      actualRevision: snapshot.revision,
      validation: { ok: false, issues: [] }
    };
  }
  const rawVersion = snapshot.rawFiles.manifest?.schemaVersion;
  if (!Number.isSafeInteger(rawVersion) || rawVersion < 2) {
    return invalidPlan(snapshot, "project_migration_required", "project.json.schemaVersion", "Persist the normal schema v2 migration before authoring a campaign.", request);
  }
  if (rawVersion > PROJECT_SCHEMA_VERSION) {
    return invalidPlan(snapshot, "project_version_unsupported", "project.json.schemaVersion", `Project schemaVersion is newer than this runtime supports (${PROJECT_SCHEMA_VERSION}).`, request);
  }
  const enabled = request.enabled ?? true;
  if (enabled && request.campaign === undefined) {
    return invalidPlan(snapshot, "campaign_required", "campaign", "Enabling a campaign requires an authored campaign graph.", request);
  }

  let candidate;
  try {
    candidate = createCandidate(snapshot.rawFiles, { ...request, enabled });
  } catch (error) {
    return invalidPlan(snapshot, error.code ?? "candidate_invalid", error.fieldPath ?? "campaign", error.message, request);
  }
  const validation = await validateCandidate(snapshot.rawFiles, candidate);
  const noOp = TRANSACTION_FILES.every((entry) => (
    JSON.stringify(snapshot.rawFiles[entry.candidateKey]) === JSON.stringify(candidate[entry.candidateKey])
  ));
  return {
    projectDir: snapshot.projectDir,
    snapshot,
    request,
    revision: snapshot.revision,
    candidate,
    validation,
    noOp
  };
}

function createCandidate(rawFiles, request) {
  const manifest = cloneJson(rawFiles.manifest);
  const worldMap = cloneJson(rawFiles.worldMap);
  const balance = cloneJson(rawFiles.balance);
  let mechanics = rawFiles.mechanics === undefined ? undefined : cloneJson(rawFiles.mechanics);
  if (![manifest, worldMap, balance].every(ownRecord) || (mechanics !== undefined && !ownRecord(mechanics))) {
    throw inputError("candidate_invalid", "project", "Campaign transaction files must contain JSON objects.");
  }
  if (request.enabled === false && mechanics === undefined) {
    return { manifest, worldMap, balance, mechanics };
  }
  mechanics ??= { schemaVersion: 1, modules: {} };
  const modules = ownRecord(ownValue(mechanics, "modules"));
  if (!modules) {
    throw inputError("mechanics_modules_invalid", "mechanics.modules", "Mechanics modules must be an object.");
  }
  const existingModule = ownValue(modules, "roguelite");
  if (existingModule !== undefined && !ownRecord(existingModule)) {
    throw inputError("roguelite_module_invalid", "mechanics.modules.roguelite", "The roguelite module must be an object.");
  }
  if (existingModule?.schemaVersion !== undefined
    && (!Number.isSafeInteger(existingModule.schemaVersion) || existingModule.schemaVersion < 1 || existingModule.schemaVersion > 4)) {
    throw inputError("module_version_unsupported", "mechanics.modules.roguelite.schemaVersion", "Campaign authoring supports roguelite module versions 1 through 4.");
  }

  if (request.enabled === false) {
    const existingProfiles = ownRecord(ownValue(ownRecord(existingModule), "profiles"));
    if (existingModule?.schemaVersion === 4 && existingProfiles) {
      const profile = ownValue(existingProfiles, request.profileId);
      if (ownRecord(profile)) delete profile.campaign;
    }
    return { manifest, worldMap, balance, mechanics };
  }

  manifest.schemaVersion = 3;
  if (!ownRecord(request.campaign)) {
    throw inputError("campaign_invalid", "campaign", "campaign must be an object.");
  }
  if (request.campaign.rogueliteProfileId !== request.profileId) {
    throw inputError("campaign_profile_mismatch", "campaign.rogueliteProfileId", "campaign.rogueliteProfileId must equal profileId.");
  }
  defineOwnData(worldMap, "campaign", cloneJson(request.campaign));
  const module = existingModule ?? { schemaVersion: 4, enabled: true, profiles: {} };
  const profiles = ownRecord(ownValue(module, "profiles"));
  if (!profiles) {
    throw inputError("roguelite_profiles_invalid", "mechanics.modules.roguelite.profiles", "Roguelite profiles must be an object.");
  }
  module.schemaVersion = 4;
  module.enabled = true;
  const existingProfile = ownValue(profiles, request.profileId);
  if (existingProfile !== undefined && !ownRecord(existingProfile)) {
    throw inputError("roguelite_profile_invalid", `mechanics.modules.roguelite.profiles.${request.profileId}`, "The selected roguelite profile must be an object.");
  }
  const profile = existingProfile ?? { synergies: {} };
  defineOwnData(profile, "campaign", { schemaVersion: 1 });
  defineOwnData(profiles, request.profileId, profile);
  defineOwnData(modules, "roguelite", module);

  const missions = ownRecord(ownValue(balance, "missions"));
  if (!missions) {
    throw inputError("missions_invalid", "balance.missions", "Balance missions must be an object.");
  }
  for (const missionId of campaignMissionIds(request.campaign)) {
    const mission = ownValue(missions, missionId);
    if (!ownRecord(mission)) {
      throw inputError("mission_not_found", `campaign.nodes.${missionId}.missionId`, `Campaign mission "${missionId}" was not found.`);
    }
    let missionMechanics = ownRecord(ownValue(mission, "mechanics"));
    if (!missionMechanics) {
      missionMechanics = { profiles: {} };
      defineOwnData(mission, "mechanics", missionMechanics);
    }
    let missionProfiles = ownRecord(ownValue(missionMechanics, "profiles"));
    if (!missionProfiles) {
      missionProfiles = {};
      defineOwnData(missionMechanics, "profiles", missionProfiles);
    }
    defineOwnData(missionProfiles, "roguelite", request.profileId);
  }
  return { manifest, worldMap, balance, mechanics };
}

function campaignMissionIds(campaign) {
  if (!Array.isArray(campaign.nodes)) return [];
  return [...new Set(campaign.nodes
    .filter((node) => ownRecord(node) && ["battle", "elite", "boss"].includes(node.type))
    .map((node) => node.missionId)
    .filter((id) => typeof id === "string"))].sort(compareBinary);
}

async function validateCandidate(rawFiles, candidate) {
  try {
    const files = normalizeProjectFiles({
      ...rawFiles,
      manifest: candidate.manifest,
      worldMap: candidate.worldMap,
      balance: candidate.balance,
      mechanics: candidate.mechanics
    });
    const engine = await loadEngine();
    const content = engine.createGameContentRegistry({
      balance: files.balance,
      maps: files.maps,
      worldMap: files.worldMap,
      scripts: files.scripts,
      mechanics: files.mechanics,
      visuals: files.visuals,
      storyComics: files.storyComics,
      battleBackgrounds: files.battleBackgrounds
    });
    return mergeValidationResults(validateProjectSchemas(files), engine.validateGameContentRegistry(content));
  } catch (error) {
    return {
      ok: false,
      issues: [issue("candidate_validation_failed", "campaign", error instanceof Error ? error.message : "Campaign candidate could not be validated.")]
    };
  }
}

function readSnapshot(projectDir) {
  const projectRoot = confinedProjectRoot(projectDir);
  const files = {};
  for (const entry of TRANSACTION_FILES) {
    const absolutePath = path.join(projectRoot, entry.relativePath);
    const stat = safeFileStat(projectRoot, entry.relativePath, entry.key !== "mechanics");
    if (stat && stat.size > entry.limit) {
      throw new CampaignAuthoringError("budget_exceeded", `${entry.relativePath} exceeds its campaign authoring source budget.`);
    }
    files[entry.key] = stat
      ? { existed: true, bytes: fs.readFileSync(absolutePath), absolutePath }
      : { existed: false, bytes: null, absolutePath };
  }
  const rawFiles = readRawProjectFiles(projectRoot);
  for (const entry of TRANSACTION_FILES) {
    rawFiles[entry.candidateKey] = files[entry.key].existed
      ? JSON.parse(files[entry.key].bytes.toString("utf8"))
      : undefined;
  }
  return { projectDir: projectRoot, files, rawFiles, revision: revisionFromFiles(files) };
}

function revisionFromFiles(files) {
  const hash = createHash("sha256");
  for (const entry of TRANSACTION_FILES) {
    const source = files[entry.key];
    hash.update(`${entry.relativePath}\0${source.existed ? "present" : "absent"}\0`);
    if (source.bytes) hash.update(source.bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function stagePayloads(projectDir, payloads, directoryBindings) {
  const staged = {};
  const suffix = `${process.pid}.${transactionSequence++}`;
  try {
    for (const entry of TRANSACTION_FILES) {
      const target = path.join(projectDir, entry.relativePath);
      assertBoundTransactionParent(entry, directoryBindings);
      const temp = `${target}.campaign-stage.${suffix}`;
      fs.writeFileSync(temp, payloads[entry.key], { encoding: "utf8", flag: "wx" });
      staged[entry.key] = temp;
    }
    return staged;
  } catch (error) {
    cleanupStaged(staged, directoryBindings);
    throw error;
  }
}

function createBackup(projectDir, snapshot) {
  const backupRoot = ensureConfinedDirectory(projectDir, path.join(".towerforge", "backups"));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.join(backupRoot, `campaign-${stamp}-${transactionSequence++}`);
  fs.mkdirSync(directory);
  for (const entry of TRANSACTION_FILES) {
    const original = snapshot.files[entry.key];
    if (!original.existed) continue;
    const target = path.join(directory, entry.relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, original.bytes);
  }
  const backups = fs.readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("campaign-"))
    .map((entry) => entry.name).sort();
  for (const stale of backups.slice(0, Math.max(0, backups.length - 20))) {
    fs.rmSync(path.join(backupRoot, stale), { recursive: true, force: true });
  }
  return { directory };
}

function rollbackOwnedWrites(plan, payloads, committedKeys, directoryBindings) {
  const conflicts = [];
  const failures = [];
  const committed = new Set(committedKeys);
  for (const entry of [...TRANSACTION_FILES].reverse()) {
    if (!committed.has(entry.key)) continue;
    const target = path.join(plan.projectDir, entry.relativePath);
    const expected = Buffer.from(payloads[entry.key]);
    try {
      assertBoundTransactionParent(entry, directoryBindings);
      const current = fs.readFileSync(target);
      if (!current.equals(expected)) {
        conflicts.push(entry.relativePath);
        continue;
      }
      const original = plan.snapshot.files[entry.key];
      if (!original.existed) fs.rmSync(target, { force: true });
      else writeBytesAtomic(target, original.bytes);
    } catch {
      failures.push(entry.relativePath);
    }
  }
  return { ok: conflicts.length === 0 && failures.length === 0, conflicts, failures };
}

function assertPartialOwnership(plan, payloads, committedKeys, directoryBindings) {
  for (const entry of TRANSACTION_FILES) {
    assertBoundTransactionParent(entry, directoryBindings);
    const target = path.join(plan.projectDir, entry.relativePath);
    const expected = committedKeys.includes(entry.key)
      ? Buffer.from(payloads[entry.key])
      : plan.snapshot.files[entry.key].bytes;
    const exists = fs.existsSync(target);
    if ((expected === null && exists) || (expected !== null && (!exists || !fs.readFileSync(target).equals(expected)))) {
      throw new CampaignAuthoringError("commit_conflict", `Campaign transaction source changed: ${entry.relativePath}.`);
    }
  }
}

function assertRevision(projectDir, expected) {
  const actual = campaignAuthoringRevision(projectDir);
  if (actual !== expected) {
    throw new CampaignAuthoringError("revision_conflict", "Campaign sources changed since preview.", { expectedRevision: expected, actualRevision: actual });
  }
}

function publicPlan(plan, dryRun) {
  if (plan.conflict) {
    return {
      projectDir: plan.projectDir,
      ok: false,
      dryRun,
      written: false,
      conflict: true,
      expectedRevision: plan.expectedRevision,
      actualRevision: plan.actualRevision,
      revision: plan.actualRevision
    };
  }
  return {
    projectDir: plan.projectDir,
    ok: plan.validation.ok,
    dryRun,
    written: false,
    revision: plan.revision,
    ...(plan.candidate ? { candidate: cloneJson(plan.candidate) } : {}),
    validation: plan.validation
  };
}

function invalidPlan(snapshot, code, fieldPath, message, request = {}) {
  return {
    projectDir: snapshot.projectDir,
    snapshot,
    request,
    revision: snapshot.revision,
    validation: { ok: false, issues: [issue(code, fieldPath, message)] }
  };
}

function invalidResult(plan, code, fieldPath, message, dryRun) {
  return {
    projectDir: plan.projectDir,
    ok: false,
    dryRun,
    written: false,
    revision: plan.revision,
    validation: { ok: false, issues: [issue(code, fieldPath, message)] }
  };
}

function issue(code, fieldPath, message) {
  return { severity: "error", entityKind: "campaign", entityId: "world", fieldPath, message, code };
}

function inputError(code, fieldPath, message) {
  return new CampaignAuthoringError(code, message, { fieldPath });
}

function detachJson(value, fieldPath) {
  const state = { bytes: 0, nodes: 0, ancestors: new WeakSet() };
  const visit = (current, currentPath, depth) => {
    state.nodes += 1;
    if (state.nodes > MAX_REQUEST_NODES || depth > MAX_REQUEST_DEPTH) throw inputError("budget_exceeded", currentPath, "Campaign request exceeds its structural budget.");
    if (current === null || typeof current === "boolean") return current;
    if (typeof current === "string") {
      state.bytes += Buffer.byteLength(current);
      if (state.bytes > MAX_REQUEST_BYTES) throw inputError("budget_exceeded", currentPath, "Campaign request exceeds its 1 MiB budget.");
      return current;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw inputError("campaign_input_unsafe", currentPath, "Campaign request numbers must be finite.");
      return Object.is(current, -0) ? 0 : current;
    }
    if (typeof current !== "object" || state.ancestors.has(current)) throw inputError("campaign_input_unsafe", currentPath, "Campaign request must be acyclic JSON data.");
    let descriptors;
    let prototype;
    try {
      descriptors = Object.getOwnPropertyDescriptors(current);
      prototype = Object.getPrototypeOf(current);
    } catch {
      throw inputError("campaign_input_unsafe", currentPath, "Campaign request could not be inspected safely.");
    }
    if (Object.getOwnPropertySymbols(descriptors).length > 0) throw inputError("campaign_input_unsafe", currentPath, "Campaign request rejects symbol fields.");
    state.ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        if (prototype !== Array.prototype) throw inputError("campaign_input_unsafe", currentPath, "Campaign arrays must be plain arrays.");
        const length = descriptors.length?.value;
        if (!Number.isSafeInteger(length) || Object.keys(descriptors).length !== length + 1) throw inputError("campaign_input_unsafe", currentPath, "Campaign arrays must be dense and contain no extra fields.");
        return Array.from({ length }, (_, index) => {
          const descriptor = descriptors[String(index)];
          if (!descriptor?.enumerable || !("value" in descriptor)) throw inputError("campaign_input_unsafe", `${currentPath}[${index}]`, "Campaign arrays reject accessors.");
          return visit(descriptor.value, `${currentPath}[${index}]`, depth + 1);
        });
      }
      if (prototype !== Object.prototype && prototype !== null) throw inputError("campaign_input_unsafe", currentPath, "Campaign objects must be plain objects.");
      const result = {};
      for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !("value" in descriptor)) throw inputError("campaign_input_unsafe", `${currentPath}.${key}`, "Campaign objects reject accessors.");
        Object.defineProperty(result, key, { value: visit(descriptor.value, `${currentPath}.${key}`, depth + 1), enumerable: true, configurable: true, writable: true });
      }
      return result;
    } finally {
      state.ancestors.delete(current);
    }
  };
  return visit(value, fieldPath, 0);
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function ownRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function ownValue(record, key) {
  return record && Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function defineOwnData(record, key, value) {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true
  });
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function compareBinary(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cleanupStaged(staged, directoryBindings) {
  for (const entry of TRANSACTION_FILES) {
    const temp = staged?.[entry.key];
    if (!temp) continue;
    try {
      assertBoundTransactionParent(entry, directoryBindings);
      fs.rmSync(temp, { force: true });
    } catch {
      // The bound directory may have been moved after staging. Never follow its replacement.
    }
  }
}

function writeBytesAtomic(filePath, bytes) {
  const temp = `${filePath}.campaign-rollback.${process.pid}.${transactionSequence++}`;
  try {
    fs.writeFileSync(temp, bytes, { flag: "wx" });
    fs.renameSync(temp, filePath);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

function confinedProjectRoot(projectDir) {
  try {
    const root = fs.realpathSync(path.resolve(projectDir));
    if (!fs.statSync(root).isDirectory()) throw new Error("not a directory");
    return root;
  } catch {
    throw new CampaignAuthoringError("source_unsafe", "Campaign project root is not a safe directory.");
  }
}

function safeFileStat(projectDir, relativePath, required) {
  let cursor = projectDir;
  for (const segment of relativePath.split("/").slice(0, -1)) {
    cursor = path.join(cursor, segment);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new CampaignAuthoringError("source_unsafe", `Unsafe campaign path: ${relativePath}.`);
  }
  try {
    const stat = fs.lstatSync(path.join(projectDir, relativePath));
    if (stat.isSymbolicLink() || !stat.isFile()) throw new CampaignAuthoringError("source_unsafe", `Unsafe campaign source: ${relativePath}.`);
    return stat;
  } catch (error) {
    if (!required && error?.code === "ENOENT") return null;
    throw error;
  }
}

function ensureConfinedDirectory(projectDir, relativePath) {
  let cursor = projectDir;
  for (const segment of relativePath.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    try {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new CampaignAuthoringError("source_unsafe", `Unsafe campaign directory: ${relativePath}.`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      fs.mkdirSync(cursor);
    }
  }
  return cursor;
}

function bindTransactionDirectories(projectDir) {
  const bindings = new Map();
  for (const entry of TRANSACTION_FILES) {
    const relativeDirectory = path.dirname(entry.relativePath);
    if (bindings.has(relativeDirectory)) continue;
    const absolutePath = ensureConfinedDirectory(projectDir, relativeDirectory);
    let stat;
    let realPath;
    try {
      stat = fs.lstatSync(absolutePath);
      realPath = fs.realpathSync(absolutePath);
    } catch {
      throw new CampaignAuthoringError("source_unsafe", `Campaign transaction directory could not be bound: ${relativeDirectory}.`);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory() || realPath !== absolutePath) {
      throw new CampaignAuthoringError("source_unsafe", `Unsafe campaign transaction directory: ${relativeDirectory}.`);
    }
    bindings.set(relativeDirectory, Object.freeze({ absolutePath, realPath, dev: stat.dev, ino: stat.ino }));
  }
  return bindings;
}

function assertBoundTransactionParent(entry, bindings) {
  const relativeDirectory = path.dirname(entry.relativePath);
  const binding = bindings?.get(relativeDirectory);
  if (!binding) {
    throw new CampaignAuthoringError("source_unsafe", `Campaign transaction directory is not bound: ${relativeDirectory}.`);
  }
  try {
    const stat = fs.lstatSync(binding.absolutePath);
    const realPath = fs.realpathSync(binding.absolutePath);
    if (stat.isSymbolicLink() || !stat.isDirectory() || stat.dev !== binding.dev || stat.ino !== binding.ino
      || realPath !== binding.realPath) {
      throw new Error("directory identity changed");
    }
  } catch {
    throw new CampaignAuthoringError("source_unsafe", `Campaign transaction directory changed: ${relativeDirectory}.`);
  }
}
