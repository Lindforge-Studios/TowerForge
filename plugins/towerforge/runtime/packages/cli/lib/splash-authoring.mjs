import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { normalizeProjectFiles, readRawProjectFiles } from "./project-loader.mjs";
import { validateProjectSchemas } from "./project-schema.mjs";
import {
  compileSplashPlaylistPlanV1,
  validateSplashCatalogV1
} from "../../player-runtime/src/splash-catalog.mjs";

const REVISION_SOURCES = Object.freeze([
  "project.json",
  "build-targets.json",
  "content/splashes.json",
  "content/visuals.json"
]);

export const SPLASH_AUTHORING_SCHEMA_V1 = deepFreeze({
  schemaVersion: 1,
  projectSchemaVersion: 5,
  buildTargetsSchemaVersion: 2,
  splashCatalogSchemaVersion: 1,
  revisionSources: REVISION_SOURCES,
  imageMimeTypes: ["image/png", "image/jpeg", "image/webp"],
  authoringTransaction: {
    read: "get_splash_playlists",
    recipe: "get_splash_playlist_recipe",
    preview: "preview_splash_playlist",
    apply: "apply_splash_playlist",
    revisionGuard: "ifRevision"
  }
});

export const SPLASH_PLAYLIST_RECIPE_IDS = Object.freeze(["single_brand_splash"]);
const MAX_SPLASH_ASSET_BYTES = 32 * 1024 * 1024;

export function getSplashPlaylistRecipe(recipeId, playlistId, options) {
  if (!SPLASH_PLAYLIST_RECIPE_IDS.includes(recipeId)) {
    throw new Error(`Unknown splash playlist recipe "${String(recipeId)}".`);
  }
  assertId(playlistId, "playlistId");
  const input = ownClone(options, "splashRecipeOptions");
  assertExactKeys(input, ["spriteId", "accessibleLabel", "caption", "backgroundColor"], "splashRecipeOptions");
  assertId(input.spriteId, "splashRecipeOptions.spriteId");
  assertPlainText(input.accessibleLabel, "splashRecipeOptions.accessibleLabel", 512);
  if (input.caption !== undefined) assertPlainText(input.caption, "splashRecipeOptions.caption", 2_048);
  const backgroundColor = input.backgroundColor ?? "#0b0f0d";
  if (typeof backgroundColor !== "string" || !/^#[0-9a-f]{6}$/iu.test(backgroundColor)) {
    throw new Error("splashRecipeOptions.backgroundColor must use six-digit hexadecimal notation.");
  }
  const item = {
    id: "brand",
    spriteId: input.spriteId,
    accessibleLabel: input.accessibleLabel,
    ...(input.caption === undefined ? {} : { caption: input.caption }),
    backgroundColor,
    fit: "contain",
    transition: "fade_scale",
    displayMs: 1_800,
    minimumMs: 600,
    transitionMs: 220
  };
  const playlist = {
    schemaVersion: 1,
    label: `${input.accessibleLabel.slice(0, 243)} introduction`,
    items: [item]
  };
  requireValidCatalog({ schemaVersion: 1, playlists: { [playlistId]: playlist } });
  return deepFreeze({ recipeId, playlistId, detached: true, written: false, playlist });
}

export function getSplashPlaylists(projectDir) {
  const projectRoot = assertOwnedSources(projectDir);
  const raw = readRawProjectFiles(projectRoot);
  const catalog = raw.splashes === undefined ? emptyCatalog() : requireValidCatalog(raw.splashes);
  return deepFreeze({
    schemaVersion: 1,
    projectSchemaVersion: raw.manifest?.schemaVersion ?? 1,
    buildTargetsSchemaVersion: raw.buildTargets?.schemaVersion ?? 1,
    splashCatalogSchemaVersion: catalog.schemaVersion,
    revision: splashRevision(projectRoot),
    playlists: ownClone(catalog.playlists, "playlists"),
    bindings: collectBindings(raw.buildTargets)
  });
}

export function previewSplashPlaylist(projectDir, args) {
  const projectRoot = assertOwnedSources(projectDir);
  const revision = splashRevision(projectRoot);
  try {
    const candidate = createCandidate(readRawProjectFiles(projectRoot), args);
    const normalized = normalizeProjectFiles(candidate.raw);
    const projectValidation = validateProjectSchemas(normalized);
    const timeline = createTimeline(projectRoot, normalized, candidate.summary.playlistId);
    const validation = timeline.issues.length === 0
      ? projectValidation
      : {
          ok: false,
          issues: [...projectValidation.issues, ...timeline.issues]
        };
    return deepFreeze({
      ok: validation.ok,
      dryRun: true,
      written: false,
      revision,
      projectSchemaVersion: normalized.manifest.schemaVersion,
      buildTargetsSchemaVersion: normalized.buildTargets.schemaVersion,
      splashCatalogSchemaVersion: normalized.splashes?.schemaVersion ?? 1,
      validation,
      timeline: timeline.value,
      candidate: candidate.summary
    });
  } catch (error) {
    return failurePreview(revision, error);
  }
}

export function applySplashPlaylist(projectDir, args) {
  if (typeof args?.ifRevision !== "string" || !/^[a-f0-9]{64}$/u.test(args.ifRevision)) {
    throw new Error("Splash playlist apply requires the exact ifRevision from preview.");
  }
  const projectRoot = assertOwnedSources(projectDir);
  const previousRevision = splashRevision(projectRoot);
  if (previousRevision !== args.ifRevision) return conflict(args.ifRevision, previousRevision);

  const preview = previewSplashPlaylist(projectRoot, args);
  if (!preview.ok) return deepFreeze({ ...preview, dryRun: false });

  assertOwnedSources(projectRoot);
  const currentRevision = splashRevision(projectRoot);
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
    writeJsonAtomic(sources.splashes, candidate.splashes);
    writeBytesAtomic(sources.visuals, before.visuals);

    const afterRaw = readRawProjectFiles(projectRoot);
    const validation = validateProjectSchemas(normalizeProjectFiles(afterRaw));
    if (!validation.ok) throw new Error("Post-write splash playlist validation failed.");
    return deepFreeze({
      ok: true,
      written: true,
      rolledBack: false,
      previousRevision,
      revision: splashRevision(projectRoot),
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
      error: error instanceof Error ? error.message : "Splash authoring transaction failed.",
      validation: { ok: false }
    });
  }
}

function createCandidate(raw, args) {
  const request = ownClone(args, "splashPlaylistRequest");
  assertExactKeys(request, ["playlistId", "playlist", "binding", "ifRevision"], "splashPlaylistRequest");
  assertId(request.playlistId, "playlistId");
  const binding = ownClone(request.binding, "binding");
  assertExactKeys(binding, ["targetId", "enabled"], "binding", true);
  assertId(binding.targetId, "binding.targetId");
  if (typeof binding.enabled !== "boolean") throw new Error("binding.enabled must be boolean.");

  const existing = raw.splashes === undefined ? emptyCatalog() : requireValidCatalog(raw.splashes);
  const playlists = ownClone(existing.playlists, "splashes.playlists");
  if (binding.enabled) {
    defineOwn(playlists, request.playlistId, ownClone(request.playlist, "playlist"));
  } else if (!Object.hasOwn(playlists, request.playlistId)) {
    throw new Error(`Cannot disable missing splash playlist "${request.playlistId}".`);
  }
  const splashes = { schemaVersion: 1, playlists };
  requireValidCatalog(splashes);

  const manifest = ownClone(raw.manifest, "project.json");
  manifest.schemaVersion = 5;
  const buildTargets = ownClone(raw.buildTargets, "build-targets.json");
  buildTargets.schemaVersion = 2;
  if (!isOwnRecord(buildTargets.targets)) throw new Error("build-targets.json targets must be an own-data object.");
  const target = ownValue(buildTargets.targets, binding.targetId);
  if (!isOwnRecord(target)) throw new Error(`Build target "${binding.targetId}" does not exist.`);
  if (binding.enabled) defineOwn(target, "splashPlaylistId", request.playlistId);
  else delete target.splashPlaylistId;

  return {
    raw: {
      ...raw,
      manifest,
      buildTargets,
      splashes,
      splashesAuthored: true,
      visuals: ownClone(raw.visuals, "content/visuals.json")
    },
    summary: {
      playlistId: request.playlistId,
      playlist: ownClone(request.playlist, "playlist"),
      binding: { targetId: binding.targetId, enabled: binding.enabled }
    }
  };
}

function createTimeline(projectRoot, normalized, playlistId) {
  const plan = compileSplashPlaylistPlanV1(normalized.splashes, playlistId, { reducedMotion: false });
  const issues = [];
  const items = plan.items.map((item, index) => {
    const sprite = normalized.visuals?.sprites?.[item.spriteId];
    let assetReady = false;
    try {
      const assetPath = confinedAsset(projectRoot, sprite?.src);
      assetReady = matchesImageSignature(assetPath, splashImageMimeType(sprite));
    } catch {
      assetReady = false;
    }
    if (!assetReady) {
      issues.push({
        severity: "error",
        entityKind: "splashes",
        entityId: playlistId,
        fieldPath: `playlists.${playlistId}.items.${index}.spriteId`,
        code: "SPLASH_ASSET_NOT_READY",
        message: `Splash sprite "${item.spriteId}" is missing or its file signature does not match its PNG, JPEG, or WebP MIME type.`
      });
    }
    return { ...item, assetReady };
  });
  return {
    issues,
    value: {
      playlistId,
      itemCount: items.length,
      totalPlaybackMs: items.reduce((sum, item) => sum + item.displayMs + item.transitionMs, 0),
      items
    }
  };
}

function collectBindings(buildTargets) {
  const bindings = Object.create(null);
  const targets = buildTargets?.targets;
  if (!isOwnRecord(targets)) return bindings;
  for (const targetId of Object.keys(targets).sort()) {
    const target = ownValue(targets, targetId);
    const playlistId = ownValue(target, "splashPlaylistId");
    if (isOwnRecord(target) && typeof playlistId === "string") defineOwn(bindings, targetId, playlistId);
  }
  return bindings;
}

function requireValidCatalog(value) {
  const result = validateSplashCatalogV1(value);
  if (!result.ok) throw new Error(`${result.error?.fieldPath ?? "splashes"}: ${result.error?.message ?? "Splash catalog validation failed."}`);
  return result.catalog;
}

function emptyCatalog() {
  return { schemaVersion: 1, playlists: Object.create(null) };
}

function failurePreview(revision, error) {
  const closed = error instanceof Error ? error : new Error("Splash authoring preview failed closed.");
  return deepFreeze({
    ok: false,
    dryRun: true,
    written: false,
    revision,
    validation: {
      ok: false,
      issues: [{ severity: "error", fieldPath: closed.fieldPath ?? "splashPlaylist", message: closed.message }]
    }
  });
}

function conflict(expectedRevision, actualRevision) {
  return deepFreeze({ ok: false, conflict: true, written: false, expectedRevision, actualRevision });
}

function splashRevision(projectRoot) {
  const sources = sourcePaths(projectRoot);
  const hash = createHash("sha256");
  for (const [relative, absolute] of [
    ["project.json", sources.project],
    ["build-targets.json", sources.targets],
    ["content/splashes.json", sources.splashes],
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
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Splash authoring project root must be a real directory.");
  requiredFile(root, "project.json");
  requiredFile(root, "build-targets.json");
  requiredFile(root, "content/visuals.json");
  optionalFile(root, "content/splashes.json");
  return root;
}

function sourcePaths(root) {
  return {
    project: confinedPath(root, "project.json"),
    targets: confinedPath(root, "build-targets.json"),
    splashes: confinedPath(root, "content/splashes.json"),
    visuals: confinedPath(root, "content/visuals.json")
  };
}

function requiredFile(root, relative) {
  const target = confinedPath(root, relative);
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Splash authoring requires regular source ${relative}.`);
  return target;
}

function optionalFile(root, relative) {
  const target = confinedPath(root, relative);
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Splash authoring requires regular source ${relative}.`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return target;
}

function confinedPath(projectRoot, relative) {
  if (typeof relative !== "string" || path.isAbsolute(relative) || relative.split(/[\\/]/u).includes("..")) {
    throw new Error("Splash authoring path escaped project.");
  }
  const root = path.resolve(projectRoot);
  let cursor = root;
  const segments = relative.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    cursor = path.join(cursor, segments[index]);
    try {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink()) throw new Error(`Splash authoring rejects symbolic link traversal: ${relative}.`);
      if (index < segments.length - 1 && !stat.isDirectory()) throw new Error(`Splash authoring parent must be a directory: ${relative}.`);
    } catch (error) {
      if (error?.code !== "ENOENT" || index < segments.length - 1) throw error;
    }
  }
  const rel = path.relative(root, cursor);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Splash authoring path escaped project.");
  return cursor;
}

function confinedAsset(projectRoot, relative) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/u).includes("..")) {
    throw new Error("Splash asset must use a safe project-relative path.");
  }
  const asset = confinedPath(projectRoot, relative);
  const stat = fs.lstatSync(asset);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Splash asset must be a regular file.");
  if (stat.size < 1 || stat.size > MAX_SPLASH_ASSET_BYTES) {
    throw new Error(`Splash asset must be from 1 byte through ${MAX_SPLASH_ASSET_BYTES} bytes (32 MiB).`);
  }
  return asset;
}

function matchesImageSignature(filePath, mimeType) {
  const file = fs.openSync(filePath, "r");
  const buffer = Buffer.alloc(12);
  let length = 0;
  try {
    length = fs.readSync(file, buffer, 0, buffer.length, 0);
  } finally {
    fs.closeSync(file);
  }
  const bytes = buffer.subarray(0, length);
  if (mimeType === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/webp") return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  return false;
}

function splashImageMimeType(sprite) {
  if (typeof sprite?.mimeType === "string") return sprite.mimeType;
  const extension = path.extname(typeof sprite?.src === "string" ? sprite.src : "").toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return undefined;
}

function createBackupDirectory(projectRoot) {
  let cursor = projectRoot;
  for (const segment of [".towerforge", "backups"]) {
    cursor = path.join(cursor, segment);
    try {
      const stat = fs.lstatSync(cursor);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Splash backup path must use real project directories.");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      fs.mkdirSync(cursor, { mode: 0o700 });
    }
  }
  const backup = path.join(cursor, `r22-splash-${Date.now()}-${process.pid}`);
  fs.mkdirSync(backup, { mode: 0o700 });
  return backup;
}

function readOwnedBytes(sources) {
  return {
    project: fs.readFileSync(sources.project),
    targets: fs.readFileSync(sources.targets),
    splashes: fs.existsSync(sources.splashes) ? fs.readFileSync(sources.splashes) : null,
    visuals: fs.readFileSync(sources.visuals)
  };
}

function writeBackups(backupDir, before) {
  fs.writeFileSync(path.join(backupDir, "project.json.bak"), before.project);
  fs.writeFileSync(path.join(backupDir, "build-targets.json.bak"), before.targets);
  if (before.splashes === null) fs.writeFileSync(path.join(backupDir, "splashes.json.absent"), "absent\n", "utf8");
  else fs.writeFileSync(path.join(backupDir, "splashes.json.bak"), before.splashes);
  fs.writeFileSync(path.join(backupDir, "visuals.json.bak"), before.visuals);
}

function rollbackSources(sources, before) {
  fs.writeFileSync(sources.project, before.project);
  fs.writeFileSync(sources.targets, before.targets);
  if (before.splashes === null) {
    try { fs.unlinkSync(sources.splashes); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  } else fs.writeFileSync(sources.splashes, before.splashes);
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
  if (Reflect.ownKeys(descriptors).some((key) => typeof key === "symbol")) throw new Error(`${field} cannot contain symbol keys.`);
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
  if (!isOwnRecord(record)) return undefined;
  let descriptor;
  try { descriptor = Object.getOwnPropertyDescriptor(record, key); } catch { return undefined; }
  return descriptor?.enumerable && "value" in descriptor ? descriptor.value : undefined;
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

function assertPlainText(value, field, maximum) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${field} must be bounded plain text.`);
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
