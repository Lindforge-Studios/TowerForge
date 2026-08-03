import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { normalizeProjectFiles, readRawProjectFiles } from "./project-loader.mjs";
import { validateProjectSchemas } from "./project-schema.mjs";
import { validateHudCatalogV1 } from "../../player-runtime/src/hud-catalog.mjs";

const REVISION_SOURCES = Object.freeze([
  "project.json",
  "build-targets.json",
  "content/hud.json",
  "content/visuals.json"
]);

export const HUD_AUTHORING_SCHEMA_V1 = deepFreeze({
  schemaVersion: 1,
  projectSchemaVersion: 5,
  buildTargetsSchemaVersion: 2,
  hudCatalogSchemaVersion: 1,
  revisionSources: REVISION_SOURCES,
  authoringTransaction: {
    read: "get_hud_profiles",
    recipe: "get_hud_profile_recipe",
    preview: "preview_hud_profile",
    apply: "apply_hud_profile",
    revisionGuard: "ifRevision"
  }
});

export function getHudProfileRecipe(recipeId, profileId) {
  if (recipeId !== "desktop_quickbar") throw new Error(`Unknown HUD profile recipe "${String(recipeId)}".`);
  assertId(profileId, "profileId");
  return deepFreeze({
    recipeId,
    profileId,
    detached: true,
    written: false,
    profile: emptyProfile("Desktop quickbar")
  });
}

export function getHudProfiles(projectDir) {
  const projectRoot = assertOwnedSources(projectDir);
  const raw = readRawProjectFiles(projectRoot);
  const catalog = raw.hud === undefined ? emptyCatalog() : requireValidCatalog(raw.hud);
  return deepFreeze({
    schemaVersion: 1,
    projectSchemaVersion: raw.manifest?.schemaVersion ?? 1,
    buildTargetsSchemaVersion: raw.buildTargets?.schemaVersion ?? 1,
    hudCatalogSchemaVersion: catalog.schemaVersion,
    revision: hudRevision(projectRoot),
    profiles: ownClone(catalog.profiles, "profiles"),
    bindings: collectBindings(raw.buildTargets)
  });
}

export function previewHudProfile(projectDir, args) {
  const projectRoot = assertOwnedSources(projectDir);
  const revision = hudRevision(projectRoot);
  let candidate;
  try {
    const raw = readRawProjectFiles(projectRoot);
    candidate = createCandidate(raw, args);
    const normalized = normalizeProjectFiles(candidate.raw);
    const validation = validateProjectSchemas(normalized);
    return deepFreeze({
      ok: validation.ok,
      dryRun: true,
      written: false,
      revision,
      projectSchemaVersion: normalized.manifest.schemaVersion,
      buildTargetsSchemaVersion: normalized.buildTargets.schemaVersion,
      hudCatalogSchemaVersion: normalized.hud?.schemaVersion ?? 1,
      validation,
      candidate: candidate.summary
    });
  } catch (error) {
    return failurePreview(revision, error);
  }
}

export function applyHudProfile(projectDir, args) {
  if (typeof args?.ifRevision !== "string" || !/^[a-f0-9]{64}$/.test(args.ifRevision)) {
    throw new Error("HUD profile apply requires the exact ifRevision from preview.");
  }
  const projectRoot = assertOwnedSources(projectDir);
  const previousRevision = hudRevision(projectRoot);
  if (previousRevision !== args.ifRevision) return conflict(args.ifRevision, previousRevision);

  const preview = previewHudProfile(projectRoot, args);
  if (!preview.ok) return deepFreeze({ ...preview, dryRun: false });

  // Re-read and re-hash immediately before deriving any bytes to commit. This closes the
  // preview/apply and validation/write races without widening the transaction's ownership.
  assertOwnedSources(projectRoot);
  const currentRevision = hudRevision(projectRoot);
  if (currentRevision !== previousRevision) return conflict(previousRevision, currentRevision);
  const beforeRaw = readRawProjectFiles(projectRoot);
  const candidate = createCandidate(beforeRaw, args).raw;
  const candidateValidation = validateProjectSchemas(normalizeProjectFiles(candidate));
  if (!candidateValidation.ok) {
    return deepFreeze({ ok: false, written: false, dryRun: false, validation: candidateValidation });
  }

  const sources = sourcePaths(projectRoot);
  const before = readOwnedBytes(sources);
  const backupDir = createBackupDirectory(projectRoot);
  writeBackups(backupDir, before);

  try {
    writeJsonAtomic(sources.project, candidate.manifest);
    writeJsonAtomic(sources.targets, candidate.buildTargets);
    writeJsonAtomic(sources.hud, candidate.hud);
    writeBytesAtomic(sources.visuals, before.visuals);

    const afterRaw = readRawProjectFiles(projectRoot);
    const validation = validateProjectSchemas(normalizeProjectFiles(afterRaw));
    if (!validation.ok) throw new Error("Post-write HUD profile validation failed.");
    return deepFreeze({
      ok: true,
      written: true,
      rolledBack: false,
      previousRevision,
      revision: hudRevision(projectRoot),
      validation,
      backup: { directory: portableRelative(projectRoot, backupDir) }
    });
  } catch (error) {
    rollbackSources(sources, before);
    cleanupTemporaryFiles(sources);
    return deepFreeze({
      ok: false,
      written: false,
      rolledBack: true,
      error: error instanceof Error ? error.message : "HUD authoring transaction failed.",
      validation: { ok: false }
    });
  }
}

function createCandidate(raw, args) {
  const request = ownClone(args, "hudProfileRequest");
  assertExactKeys(request, ["profileId", "profile", "binding", "ifRevision"], "hudProfileRequest");
  assertId(request.profileId, "profileId");
  const binding = ownClone(request.binding, "binding");
  assertExactKeys(binding, ["targetId", "enabled"], "binding", true);
  assertId(binding.targetId, "binding.targetId");
  if (typeof binding.enabled !== "boolean") throw new Error("binding.enabled must be boolean.");

  const existingCatalog = raw.hud === undefined ? emptyCatalog() : requireValidCatalog(raw.hud);
  const profiles = ownClone(existingCatalog.profiles, "hud.profiles");
  defineOwn(profiles, request.profileId, ownClone(request.profile, "profile"));
  const hud = { schemaVersion: 1, profiles };
  requireValidCatalog(hud);

  const manifest = ownClone(raw.manifest, "project.json");
  manifest.schemaVersion = 5;
  const buildTargets = ownClone(raw.buildTargets, "build-targets.json");
  buildTargets.schemaVersion = 2;
  if (!isOwnRecord(buildTargets.targets)) throw new Error("build-targets.json targets must be an own-data object.");
  const target = ownValue(buildTargets.targets, binding.targetId);
  if (!isOwnRecord(target)) throw new Error(`Build target "${binding.targetId}" does not exist.`);
  if (binding.enabled) defineOwn(target, "hudProfileId", request.profileId);
  else delete target.hudProfileId;

  return {
    raw: {
      ...raw,
      manifest,
      buildTargets,
      hud,
      hudAuthored: true,
      visuals: ownClone(raw.visuals, "content/visuals.json")
    },
    summary: {
      profileId: request.profileId,
      profile: ownClone(request.profile, "profile"),
      binding: { targetId: binding.targetId, enabled: binding.enabled }
    }
  };
}

function collectBindings(buildTargets) {
  const bindings = Object.create(null);
  const targets = buildTargets?.targets;
  if (!isOwnRecord(targets)) return bindings;
  for (const targetId of Object.keys(targets).sort()) {
    const target = ownValue(targets, targetId);
    if (!isOwnRecord(target) || typeof ownValue(target, "hudProfileId") !== "string") continue;
    defineOwn(bindings, targetId, target.hudProfileId);
  }
  return bindings;
}

function requireValidCatalog(value) {
  const result = validateHudCatalogV1(value);
  if (!result.ok) throw result.error ?? new Error("HUD catalog validation failed.");
  return result.catalog;
}

function emptyCatalog() {
  return { schemaVersion: 1, profiles: Object.create(null) };
}

function emptyProfile(label) {
  const variant = (width, height) => ({ schemaVersion: 1, designViewport: { width, height }, rootNodeIds: [] });
  return {
    schemaVersion: 1,
    label,
    breakpoints: { mobileMax: 767, tabletMax: 1199 },
    commonNodes: [],
    variants: {
      desktop: variant(1920, 1080),
      tablet: variant(1024, 768),
      mobile: variant(390, 844)
    },
    screens: { gameplay: { schemaVersion: 1, surface: "gameplay", rootNodeIds: [] } },
    screenGraph: { schemaVersion: 1, initialScreenId: "gameplay", transitions: [] },
    assetRoles: {}
  };
}

function failurePreview(revision, error) {
  const closed = error instanceof Error ? error : new Error("HUD authoring preview failed closed.");
  return deepFreeze({
    ok: false,
    dryRun: true,
    written: false,
    revision,
    validation: {
      ok: false,
      issues: [{ severity: "error", fieldPath: closed.fieldPath ?? "hudProfile", message: closed.message }]
    }
  });
}

function conflict(expectedRevision, actualRevision) {
  return deepFreeze({ ok: false, conflict: true, written: false, expectedRevision, actualRevision });
}

function hudRevision(projectRoot) {
  const sources = sourcePaths(projectRoot);
  const hash = createHash("sha256");
  for (const [relative, absolute] of [
    ["project.json", sources.project],
    ["build-targets.json", sources.targets],
    ["content/hud.json", sources.hud],
    ["content/visuals.json", sources.visuals]
  ]) {
    const bytes = fs.existsSync(absolute) ? fs.readFileSync(absolute) : Buffer.from("<absent>", "utf8");
    hash.update(Buffer.from(`${relative}\0${bytes.length}\0`, "utf8"));
    hash.update(bytes);
  }
  return hash.digest("hex");
}

function assertOwnedSources(projectDir) {
  const root = path.resolve(projectDir);
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("HUD authoring project root must be a real directory.");
  requiredFile(root, "project.json");
  requiredFile(root, "build-targets.json");
  requiredFile(root, "content/visuals.json");
  optionalFile(root, "content/hud.json");
  return root;
}

function sourcePaths(root) {
  return {
    project: confinedPath(root, "project.json"),
    targets: confinedPath(root, "build-targets.json"),
    hud: confinedPath(root, "content/hud.json"),
    visuals: confinedPath(root, "content/visuals.json")
  };
}

function requiredFile(root, relative) {
  const target = confinedPath(root, relative);
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`HUD authoring requires regular source ${relative}.`);
  return target;
}

function optionalFile(root, relative) {
  const target = confinedPath(root, relative);
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`HUD authoring requires regular source ${relative}.`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return target;
}

function confinedPath(projectRoot, relative) {
  if (typeof relative !== "string" || path.isAbsolute(relative) || relative.split(/[\\/]/u).includes("..")) {
    throw new Error("HUD authoring path escaped project.");
  }
  const root = path.resolve(projectRoot);
  let cursor = root;
  const segments = relative.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    cursor = path.join(cursor, segments[index]);
    try {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink()) throw new Error(`HUD authoring rejects symbolic link traversal: ${relative}.`);
      if (index < segments.length - 1 && !stat.isDirectory()) throw new Error(`HUD authoring parent must be a directory: ${relative}.`);
    } catch (error) {
      if (error?.code !== "ENOENT" || index < segments.length - 1) throw error;
    }
  }
  const rel = path.relative(root, cursor);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("HUD authoring path escaped project.");
  return cursor;
}

function createBackupDirectory(projectRoot) {
  let cursor = projectRoot;
  for (const segment of [".towerforge", "backups"]) {
    cursor = path.join(cursor, segment);
    try {
      const stat = fs.lstatSync(cursor);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("HUD backup path must use real project directories.");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      fs.mkdirSync(cursor, { mode: 0o700 });
    }
  }
  const backup = path.join(cursor, `r21-hud-${Date.now()}-${process.pid}`);
  fs.mkdirSync(backup, { mode: 0o700 });
  return backup;
}

function readOwnedBytes(sources) {
  return {
    project: fs.readFileSync(sources.project),
    targets: fs.readFileSync(sources.targets),
    hud: fs.existsSync(sources.hud) ? fs.readFileSync(sources.hud) : null,
    visuals: fs.readFileSync(sources.visuals)
  };
}

function writeBackups(backupDir, before) {
  fs.writeFileSync(path.join(backupDir, "project.json.bak"), before.project);
  fs.writeFileSync(path.join(backupDir, "build-targets.json.bak"), before.targets);
  if (before.hud === null) fs.writeFileSync(path.join(backupDir, "hud.json.absent"), "absent\n", "utf8");
  else fs.writeFileSync(path.join(backupDir, "hud.json.bak"), before.hud);
  fs.writeFileSync(path.join(backupDir, "visuals.json.bak"), before.visuals);
}

function rollbackSources(sources, before) {
  fs.writeFileSync(sources.project, before.project);
  fs.writeFileSync(sources.targets, before.targets);
  if (before.hud === null) {
    try { fs.unlinkSync(sources.hud); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  } else fs.writeFileSync(sources.hud, before.hud);
  fs.writeFileSync(sources.visuals, before.visuals);
}

function writeJsonAtomic(filePath, value) {
  writeBytesAtomic(filePath, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"));
}

function writeBytesAtomic(filePath, bytes) {
  const temporary = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.trunc(performance.now() * 1000)}`;
  try {
    fs.writeFileSync(temporary, bytes, { flag: "wx" });
    fs.renameSync(temporary, filePath);
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
  }
}

function cleanupTemporaryFiles(sources) {
  for (const filePath of Object.values(sources)) {
    const directory = path.dirname(filePath);
    const prefix = `${path.basename(filePath)}.tmp.`;
    try {
      for (const entry of fs.readdirSync(directory)) if (entry.startsWith(prefix)) fs.unlinkSync(path.join(directory, entry));
    } catch {}
  }
}

function ownClone(value, field, tracker = { active: new WeakSet(), nodes: 0 }, depth = 0) {
  if (value === null || typeof value !== "object") {
    if (["string", "number", "boolean", "undefined"].includes(typeof value) && (typeof value !== "number" || Number.isFinite(value))) return value;
    throw new Error(`${field} must contain bounded own-data values.`);
  }
  if (depth > 20 || tracker.nodes++ >= 8192) throw new Error(`${field} exceeds the bounded own-data budget.`);
  if (tracker.active.has(value)) throw new Error(`${field} must not contain cycles.`);
  let prototype; let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new Error(`${field} must be inspectable own data.`);
  }
  if (Object.getOwnPropertySymbols(descriptors).length > 0) throw new Error(`${field} cannot contain symbol keys.`);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) throw new Error(`${field} must be a plain array.`);
  } else if (prototype !== Object.prototype && prototype !== null) throw new Error(`${field} must be a plain object.`);
  tracker.active.add(value);
  try {
    if (Array.isArray(value)) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length > 8192 || Object.keys(descriptors).length !== length + 1) throw new Error(`${field} must be a dense array.`);
      const result = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor?.enumerable || !("value" in descriptor)) throw new Error(`${field}[${index}] must be enumerable own data.`);
        result.push(ownClone(descriptor.value, `${field}[${index}]`, tracker, depth + 1));
      }
      return result;
    }
    const result = Object.create(null);
    for (const key of Object.keys(descriptors).sort()) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !("value" in descriptor)) throw new Error(`${field}.${key} must be enumerable own data; accessors are forbidden.`);
      defineOwn(result, key, ownClone(descriptor.value, `${field}.${key}`, tracker, depth + 1));
    }
    return result;
  } finally {
    tracker.active.delete(value);
  }
}

function isOwnRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch { return false; }
}

function ownValue(record, key) {
  return isOwnRecord(record) && Object.hasOwn(record, key) ? record[key] : undefined;
}

function defineOwn(record, key, value) {
  Object.defineProperty(record, key, { value, enumerable: true, configurable: true, writable: true });
}

function assertExactKeys(value, allowed, field, required = false) {
  if (!isOwnRecord(value)) throw new Error(`${field} must be an own-data object.`);
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) if (!allowedSet.has(key)) throw new Error(`${field}.${key} is not allowed.`);
  if (required) for (const key of allowed) if (!Object.hasOwn(value, key)) throw new Error(`${field}.${key} is required.`);
}

function assertId(value, field) {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${field} must be a non-empty bounded JSON identifier.`);
  }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}

function portableRelative(root, target) {
  return path.relative(root, target).split(path.sep).join("/");
}
