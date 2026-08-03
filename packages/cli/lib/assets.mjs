import fs from "node:fs";
import path from "node:path";
import { listVisualAssetPaths, validateSafeAssetPath } from "./project-schema.mjs";

export function importProjectAsset(projectDir, visuals, request) {
  const plan = planProjectAssetImport(projectDir, visuals, request);
  commitProjectAssetImport(plan);
  return { visuals: plan.visuals, asset: plan.asset };
}

/** Build the registry update and confined copy paths without touching disk. */
export function planProjectAssetImport(projectDir, visuals, request) {
  const assetsRoot = visuals.assetsRoot || "assets";
  const sourceRel = request?.sourcePath;
  const targetRel = request?.targetPath || path.basename(sourceRel || "");
  const sourceIssue = validateSafeAssetPath(sourceRel, "sourcePath");
  if (sourceIssue) throw new Error(sourceIssue);
  const targetIssue = validateSafeAssetPath(targetRel, "targetPath");
  if (targetIssue) throw new Error(targetIssue);

  const sourcePath = resolveInsideProject(projectDir, sourceRel);
  const sourceFile = inspectConfinedSourceFile(projectDir, sourcePath, sourceRel);
  if (sourceFile.missing) {
    throw new Error(`Asset source not found: ${sourceRel}`);
  }
  if (sourceFile.reason) throw new Error(sourceFile.reason);

  const assetRelPath = path.posix.join(assetsRoot, toPosix(targetRel));
  const destPath = resolveInsideProject(projectDir, assetRelPath);
  const copyRequired = path.resolve(sourcePath) !== path.resolve(destPath);

  const updatedVisuals = JSON.parse(JSON.stringify(visuals));
  updatedVisuals.assetsRoot ??= assetsRoot;
  updatedVisuals.sprites ??= {};
  updatedVisuals.atlases ??= {};
  updatedVisuals.bindings ??= { towers: {}, enemies: {}, tiles: {}, ui: {} };
  updatedVisuals.audio ??= { sounds: {}, events: {} };
  updatedVisuals.audio.sounds ??= {};
  updatedVisuals.audio.events ??= {};
  updatedVisuals.audio.musicTracks ??= {};
  updatedVisuals.audio.musicByMission ??= {};

  const kind = request?.kind || "sprite";
  if (!["sprite", "atlas", "sound", "music"].includes(kind)) throw new Error("Asset kind must be sprite, atlas, sound, or music.");
  const collection = kind === "atlas"
    ? updatedVisuals.atlases
    : kind === "sound"
      ? updatedVisuals.audio.sounds
      : kind === "music"
        ? updatedVisuals.audio.musicTracks
        : updatedVisuals.sprites;
  // Auto-derive an id from the filename when none is given. Sanitizing a fully non-ASCII basename
  // (e.g. Cyrillic "герой.png") used to collapse to "_", so a second such import silently
  // overwrote the first entry. Fall back to "asset" for an empty result and uniquify on collision
  // (unless it's the same file being re-imported, which should update in place).
  let id;
  if (request?.id) {
    id = request.id;
  } else {
    const base = path.basename(targetRel, path.extname(targetRel))
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "asset";
    id = uniqueAssetId(base, collection, assetRelPath);
  }
  if (kind === "atlas") {
    updatedVisuals.atlases[id] = {
      ...(updatedVisuals.atlases[id] ?? {}),
      src: assetRelPath,
      columns: Number(request?.columns ?? updatedVisuals.atlases[id]?.columns ?? 1),
      rows: Number(request?.rows ?? updatedVisuals.atlases[id]?.rows ?? 1)
    };
  } else if (kind === "sound") {
    updatedVisuals.audio.sounds[id] = {
      ...(updatedVisuals.audio.sounds[id] ?? {}),
      src: assetRelPath
    };
  } else if (kind === "music") {
    updatedVisuals.audio.musicTracks[id] = {
      ...(updatedVisuals.audio.musicTracks[id] ?? {}),
      src: assetRelPath,
      volume: Number.isFinite(Number(request?.volume)) ? Math.max(0, Math.min(1, Number(request.volume))) : (updatedVisuals.audio.musicTracks[id]?.volume ?? 0.6)
    };
  } else {
    updatedVisuals.sprites[id] = {
      ...(updatedVisuals.sprites[id] ?? {}),
      src: assetRelPath
    };
  }

  return {
    visuals: updatedVisuals,
    asset: { id, kind, path: assetRelPath },
    sourcePath,
    destPath,
    copyRequired
  };
}

/** Execute a previously validated plan with an atomic destination replace. */
export function commitProjectAssetImport(plan, verifiedSourceBytes) {
  if (!plan?.copyRequired) return;
  fs.mkdirSync(path.dirname(plan.destPath), { recursive: true });
  const tmp = `${plan.destPath}.tmp.${process.pid}`;
  try {
    if (verifiedSourceBytes !== undefined) {
      if (!Buffer.isBuffer(verifiedSourceBytes)) throw new Error("Verified asset source bytes must be a Buffer.");
      fs.writeFileSync(tmp, verifiedSourceBytes, { flag: "wx" });
    } else {
      fs.copyFileSync(plan.sourcePath, tmp);
    }
    fs.renameSync(tmp, plan.destPath);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Return `base` if it's free in `collection` (or already points at `newSrc`, i.e. a re-import of
 *  the same file), otherwise the first free `base-2`, `base-3`, … so distinct files never clobber. */
function uniqueAssetId(base, collection, newSrc) {
  const taken = (id) => Object.prototype.hasOwnProperty.call(collection, id) && collection[id]?.src !== newSrc;
  if (!taken(base)) return base;
  let n = 2;
  while (taken(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

const MAX_CAMERA_ASSET_BYTES = 32 * 1024 * 1024;

export function copyVisualAssets(projectDir, outDir, visuals, _options = {}) {
  const copied = [];
  const missing = [];
  const invalid = [];
  for (const item of listVisualAssetPaths(visuals)) {
    const safeIssue = validateSafeAssetPath(item.path, item.id);
    if (safeIssue) {
      invalid.push({ ...item, reason: safeIssue });
      continue;
    }
    const sourcePath = resolveInsideProject(projectDir, item.path);
    const sourceFile = inspectConfinedSourceFile(projectDir, sourcePath, item.path);
    if (sourceFile.missing) {
      missing.push(item);
      continue;
    }
    if (sourceFile.reason) {
      invalid.push({ ...item, reason: sourceFile.reason });
      continue;
    }
    if (item.mimeType) {
      const size = sourceFile.stat.size;
      if (size < 1 || size > MAX_CAMERA_ASSET_BYTES) {
        invalid.push({ ...item, reason: `Camera asset size must be from 1 byte through ${MAX_CAMERA_ASSET_BYTES} bytes (32 MiB).` });
        continue;
      }
      const bytes = fs.readFileSync(sourcePath);
      const detected = imageSignatureMime(bytes);
      if (detected !== item.mimeType) {
        invalid.push({ ...item, reason: `Camera asset MIME/signature mismatch: declared ${item.mimeType}, detected ${detected ?? "unknown"}.` });
        continue;
      }
    }
    const destPath = path.join(outDir, item.path);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(sourcePath, destPath);
    copied.push(item);
  }
  return { copied, missing, invalid };
}

function imageSignatureMime(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return undefined;
}

/**
 * Validate an existing asset source without following symbolic links. Checking every
 * path component is intentional: lstat on the leaf alone would still allow an
 * `assets/linked-dir/file.png` escape through a symlinked parent directory.
 */
function inspectConfinedSourceFile(projectDir, sourcePath, relPath) {
  const projectRoot = path.resolve(projectDir);
  const relative = path.relative(projectRoot, sourcePath);
  const parts = relative.split(path.sep).filter(Boolean);
  let current = projectRoot;

  for (const part of parts) {
    current = path.join(current, part);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return { missing: true };
      return { reason: `Asset source could not be inspected: ${relPath}` };
    }
    if (stat.isSymbolicLink()) {
      return { reason: `Asset source must not contain symbolic links: ${relPath}` };
    }
    if (current !== sourcePath && !stat.isDirectory()) {
      return { reason: `Asset source parent must be a directory: ${relPath}` };
    }
    if (current === sourcePath && !stat.isFile()) {
      return { reason: `Asset source must be a regular file: ${relPath}` };
    }
  }

  let realProjectRoot;
  let realSourcePath;
  try {
    realProjectRoot = fs.realpathSync(projectRoot);
    realSourcePath = fs.realpathSync(sourcePath);
  } catch {
    return { missing: true };
  }
  const realRelative = path.relative(realProjectRoot, realSourcePath);
  if (!realRelative || realRelative === "." || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    return { reason: `Asset source resolves outside the project directory: ${relPath}` };
  }

  return { stat: fs.lstatSync(sourcePath) };
}

function resolveInsideProject(projectDir, relPath) {
  const fullPath = path.resolve(projectDir, relPath);
  const rel = path.relative(projectDir, fullPath);
  if (!rel || rel === "." || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes project directory: ${relPath}`);
  }
  return fullPath;
}

function toPosix(value) {
  return String(value).replace(/\\/g, "/").replace(/^\/+/, "");
}
