import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { normalizeProjectFiles, readRawProjectFiles } from "./project-loader.mjs";
import { validateProjectSchemas } from "./project-schema.mjs";
import { resolveCameraProfileV1, validateCameraProfileCatalogV1 } from "../../renderer/src/camera-projector.mjs";
import { createCameraRenderSpaceV1 } from "../../renderer/src/camera-renderer-integration.mjs";
import { projectCameraViewAssetCoverageV1, resolveCameraViewVariantV1 } from "../../renderer/src/camera-view-assets.mjs";

export const CAMERA_AUTHORING_SCHEMA_V1 = Object.freeze({
  schemaVersion: 1,
  visualsSchemaVersion: 4,
  mechanicsRequired: false,
  presentationOnly: true,
  projections: Object.freeze(["top_down", "isometric_2_1", "dimetric_oblique"]),
  orientations: Object.freeze(["north", "east", "south", "west"]),
  allowedBindings: Object.freeze(["maps", "missions"]),
  resolutionPrecedence: Object.freeze(["mission", "map", "build_target", "top_down_fallback"]),
  authoringTransaction: Object.freeze({
    read: "get_camera_profiles",
    recipe: "get_camera_profile_recipe",
    preview: "preview_camera_profile",
    apply: "apply_camera_profile",
    revisionGuard: "ifRevision",
    viewVariantPreview: "preview_camera_view_variant",
    viewVariantApply: "apply_camera_view_variant"
  })
});

const DEFAULTS = Object.freeze({
  top_down: Object.freeze({ elevationScale: 0, fitPadding: 32 }),
  isometric_2_1: Object.freeze({ elevationScale: 1.5, fitPadding: 48 }),
  dimetric_oblique: Object.freeze({ elevationScale: 1.2, fitPadding: 40 })
});

export function getCameraProfileRecipe(recipeId, orientation, profileId) {
  if (!CAMERA_AUTHORING_SCHEMA_V1.projections.includes(recipeId)) throw new Error(`Unknown camera profile recipe "${String(recipeId)}".`);
  if (!CAMERA_AUTHORING_SCHEMA_V1.orientations.includes(orientation)) throw new Error(`Unsupported camera orientation "${String(orientation)}".`);
  assertId(profileId, "profileId");
  const profile = Object.freeze({
    schemaVersion: 1,
    projection: recipeId,
    orientation,
    elevationScale: DEFAULTS[recipeId].elevationScale,
    fitPadding: DEFAULTS[recipeId].fitPadding,
    minZoom: 0.5,
    maxZoom: 3,
    initialZoom: 1,
    panPadding: 64
  });
  return Object.freeze({ recipeId, profileId, detached: true, written: false, profile });
}

export function getCameraProfiles(projectDir) {
  const projectRoot = assertCameraOwnedSources(projectDir);
  const raw = readRawProjectFiles(projectRoot);
  return Object.freeze({
    schemaVersion: 1,
    projectSchemaVersion: raw.manifest?.schemaVersion ?? 1,
    visualsSchemaVersion: raw.visuals?.schemaVersion ?? 2,
    revision: cameraRevision(raw),
    cameraProfiles: deepFreeze(clone(raw.visuals?.cameraProfiles ?? emptyCatalog()))
  });
}

export function previewCameraProfile(projectDir, args) {
  const projectRoot = assertCameraOwnedSources(projectDir);
  const raw = readRawProjectFiles(projectRoot);
  const revision = cameraRevision(raw);
  let candidate;
  try {
    candidate = cameraCandidate(raw, args);
  } catch (error) {
    return deepFreeze({ ok: false, dryRun: true, written: false, revision, validation: { ok: false, issues: [{ severity: "error", fieldPath: "cameraProfile", message: error.message }] } });
  }
  const normalized = normalizeProjectFiles(candidate.raw);
  const validation = validateProjectSchemas(normalized);
  let context;
  let resolution;
  let presentation;
  try {
    context = previewContext(normalized, safeOwnClone(args?.context ?? {}, "context"));
    resolution = args?.binding === undefined
      ? Object.freeze({ profileId: args.profileId, source: "candidate", profile: clone(args.profile) })
      : resolveCameraProfileV1(candidate.catalog, context.resolution);
    presentation = cameraPresentationPreview(normalized, resolution, context);
  } catch (error) {
    return deepFreeze({ ok: false, dryRun: true, written: false, revision, validation: { ok: false, issues: [...validation.issues, { severity: "error", fieldPath: "cameraPreview", message: error.message }] } });
  }
  const coverageIssues = presentation.diagnostics.assetCoverage.missingRequired.map((entry) => ({
    severity: "error",
    entityKind: "visuals",
    entityId: entry.id,
    fieldPath: `viewVariants.tileSets.${entry.id}`,
    code: "CAMERA_VIEW_MATERIAL_MISSING",
    message: `Camera view is missing required tileset material coverage for "${entry.id}".`
  }));
  const previewValidation = coverageIssues.length === 0 ? validation : { ok: false, issues: [...validation.issues, ...coverageIssues] };
  return deepFreeze({
    ok: previewValidation.ok,
    dryRun: true,
    written: false,
    revision,
    validation: previewValidation,
    resolution,
    preview: presentation,
    candidate: { profileId: args.profileId, profile: clone(args.profile), binding: args.binding ? clone(args.binding) : null }
  });
}

export function applyCameraProfile(projectDir, args) {
  if (typeof args?.ifRevision !== "string" || !args.ifRevision) throw new Error("Camera profile apply requires ifRevision from preview.");
  const projectRoot = assertCameraOwnedSources(projectDir);
  const beforeRaw = readRawProjectFiles(projectRoot);
  const previousRevision = cameraRevision(beforeRaw);
  if (previousRevision !== args.ifRevision) return deepFreeze({ ok: false, conflict: true, written: false, expectedRevision: args.ifRevision, actualRevision: previousRevision });
  const preview = previewCameraProfile(projectRoot, args);
  if (!preview.ok) return deepFreeze({ ...preview, dryRun: false });
  assertCameraOwnedSources(projectRoot);
  const currentRaw = readRawProjectFiles(projectRoot);
  const currentRevision = cameraRevision(currentRaw);
  if (currentRevision !== previousRevision) return deepFreeze({ ok: false, conflict: true, written: false, expectedRevision: previousRevision, actualRevision: currentRevision });
  const candidate = cameraCandidate(beforeRaw, args).raw;
  const projectPath = confinedFile(projectRoot, "project.json");
  const visualsPath = confinedFile(projectRoot, "content/visuals.json");
  const beforeProject = fs.readFileSync(projectPath);
  const beforeVisuals = fs.readFileSync(visualsPath);
  const backupDir = confinedBackupDirectory(projectRoot);
  fs.writeFileSync(path.join(backupDir, "project.json.bak"), beforeProject);
  fs.writeFileSync(path.join(backupDir, "visuals.json.bak"), beforeVisuals);
  try {
    writeJsonAtomic(projectPath, candidate.manifest);
    writeJsonAtomic(visualsPath, candidate.visuals);
    const afterRaw = readRawProjectFiles(projectRoot);
    const validation = validateProjectSchemas(normalizeProjectFiles(afterRaw));
    if (!validation.ok) throw new Error("Post-write camera profile validation failed.");
    return deepFreeze({
      ok: true,
      written: true,
      rolledBack: false,
      previousRevision,
      revision: cameraRevision(afterRaw),
      validation,
      backup: { directory: path.relative(projectRoot, backupDir).split(path.sep).join("/") }
    });
  } catch (error) {
    if (confinedFile(projectRoot, "project.json") === projectPath) fs.writeFileSync(projectPath, beforeProject);
    if (confinedFile(projectRoot, "content/visuals.json") === visualsPath) fs.writeFileSync(visualsPath, beforeVisuals);
    return deepFreeze({ ok: false, written: false, rolledBack: true, error: error.message, validation: { ok: false } });
  }
}

export function previewCameraViewVariant(projectDir, args) {
  const projectRoot = assertCameraOwnedSources(projectDir);
  const raw = readRawProjectFiles(projectRoot);
  const revision = cameraRevision(raw);
  let request;
  let candidate;
  try {
    request = cameraViewVariantRequest(args);
    candidate = cameraViewVariantCandidate(raw, request);
  } catch (error) {
    return cameraVariantFailure(revision, error);
  }
  const normalized = normalizeProjectFiles(candidate.raw);
  const validation = validateProjectSchemas(normalized);
  if (!validation.ok) {
    return deepFreeze({ ok: false, dryRun: true, written: false, revision, candidate: candidate.summary, validation });
  }
  try {
    const asset = candidate.kind === "sprite" ? request.variant : request.variant.atlas;
    const assetPath = confinedCameraAsset(projectRoot, asset?.src);
    assertCameraAssetSignature(assetPath, asset?.mimeType);
    const resolved = resolveCameraViewVariantV1({
      visuals: normalized.visuals,
      projection: candidate.projection,
      orientation: candidate.orientation,
      kind: candidate.kind,
      id: candidate.resourceId
    });
    const materialIds = candidate.kind === "tileSet"
      ? Object.keys(normalized.visuals?.tileSets?.[candidate.resourceId]?.materials ?? {})
      : [];
    const projected = projectCameraViewAssetCoverageV1({
      visuals: normalized.visuals,
      projection: candidate.projection,
      orientation: candidate.orientation,
      spriteIds: candidate.kind === "sprite" ? [candidate.resourceId] : [],
      tileSets: candidate.kind === "tileSet" ? [{ tileSetId: candidate.resourceId, materialIds }] : []
    });
    return deepFreeze({
      ok: projected.ok && resolved.status === "exact",
      dryRun: true,
      written: false,
      revision,
      candidate: candidate.summary,
      validation,
      coverage: {
        status: resolved.status,
        entries: projected.entries,
        warnings: projected.warnings,
        missingRequired: projected.errors
      }
    });
  } catch (error) {
    return cameraVariantFailure(revision, error, validation, candidate.summary);
  }
}

export function applyCameraViewVariant(projectDir, args) {
  const request = cameraViewVariantRequest(args, { apply: true });
  if (typeof request.ifRevision !== "string" || !request.ifRevision) throw new Error("Camera view variant apply requires ifRevision from preview.");
  const projectRoot = assertCameraOwnedSources(projectDir);
  const beforeRaw = readRawProjectFiles(projectRoot);
  const previousRevision = cameraRevision(beforeRaw);
  if (previousRevision !== request.ifRevision) {
    return deepFreeze({ ok: false, conflict: true, written: false, expectedRevision: request.ifRevision, actualRevision: previousRevision });
  }
  const { ifRevision: _ifRevision, ...previewRequest } = request;
  const preview = previewCameraViewVariant(projectRoot, previewRequest);
  if (!preview.ok) return deepFreeze({ ...preview, dryRun: false });
  const currentRaw = readRawProjectFiles(projectRoot);
  const currentRevision = cameraRevision(currentRaw);
  if (currentRevision !== previousRevision) {
    return deepFreeze({ ok: false, conflict: true, written: false, expectedRevision: previousRevision, actualRevision: currentRevision });
  }
  const candidate = cameraViewVariantCandidate(beforeRaw, request).raw;
  const projectPath = confinedFile(projectRoot, "project.json");
  const visualsPath = confinedFile(projectRoot, "content/visuals.json");
  const beforeProject = fs.readFileSync(projectPath);
  const beforeVisuals = fs.readFileSync(visualsPath);
  const backupDir = confinedBackupDirectory(projectRoot);
  fs.writeFileSync(path.join(backupDir, "project.json.bak"), beforeProject);
  fs.writeFileSync(path.join(backupDir, "visuals.json.bak"), beforeVisuals);
  try {
    writeJsonAtomic(projectPath, candidate.manifest);
    writeJsonAtomic(visualsPath, candidate.visuals);
    const afterRaw = readRawProjectFiles(projectRoot);
    const validation = validateProjectSchemas(normalizeProjectFiles(afterRaw));
    if (!validation.ok) throw new Error("Post-write camera view variant validation failed.");
    return deepFreeze({
      ok: true,
      written: true,
      rolledBack: false,
      previousRevision,
      revision: cameraRevision(afterRaw),
      validation,
      candidate: preview.candidate,
      coverage: preview.coverage,
      backup: { directory: path.relative(projectRoot, backupDir).split(path.sep).join("/") }
    });
  } catch (error) {
    fs.writeFileSync(projectPath, beforeProject);
    fs.writeFileSync(visualsPath, beforeVisuals);
    return deepFreeze({ ok: false, written: false, rolledBack: true, error: error.message, validation: { ok: false } });
  }
}

function cameraViewVariantRequest(args, { apply = false } = {}) {
  const request = safeOwnClone(args, "cameraViewVariantRequest");
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Camera view variant request must be a plain own-data object.");
  const allowed = new Set(["kind", "resourceId", "projection", "orientation", "variant", ...(apply ? ["ifRevision"] : [])]);
  for (const key of Object.keys(request)) if (!allowed.has(key)) throw new Error(`cameraViewVariantRequest.${key} is not supported.`);
  return request;
}

function cameraViewVariantCandidate(raw, args) {
  const kind = args?.kind;
  if (kind !== "sprite" && kind !== "tileSet") throw new Error("kind must be sprite or tileSet.");
  assertId(args?.resourceId, "resourceId");
  if (!CAMERA_AUTHORING_SCHEMA_V1.projections.includes(args?.projection)) throw new Error("projection must be a supported camera projection.");
  if (!CAMERA_AUTHORING_SCHEMA_V1.orientations.includes(args?.orientation)) throw new Error("orientation must be a supported camera orientation.");
  const variant = safeOwnClone(args?.variant, "variant");
  if (!variant || typeof variant !== "object" || Array.isArray(variant)) throw new Error("variant must be a plain own-data object.");
  const viewKey = `${args.projection}:${args.orientation}`;
  const visuals = clone(raw.visuals ?? {});
  const manifest = { ...clone(raw.manifest ?? {}), schemaVersion: 5 };
  const existing = visuals.viewVariants ?? { schemaVersion: 1, sprites: {}, tileSets: {} };
  if (Number.isInteger(visuals.schemaVersion) && visuals.schemaVersion > 4) throw new Error("Future visuals schemas cannot be downgraded by camera authoring.");
  if (existing.schemaVersion !== 1) throw new Error("Future or malformed viewVariants catalogs cannot be downgraded.");
  if (kind === "tileSet" && !Object.hasOwn(visuals.tileSets ?? {}, args.resourceId)) throw new Error(`Unknown authored tileset "${args.resourceId}".`);
  const groupName = kind === "sprite" ? "sprites" : "tileSets";
  visuals.schemaVersion = 4;
  visuals.viewVariants = {
    schemaVersion: 1,
    sprites: clone(existing.sprites ?? {}),
    tileSets: clone(existing.tileSets ?? {})
  };
  visuals.viewVariants[groupName][args.resourceId] = {
    ...(clone(visuals.viewVariants[groupName][args.resourceId] ?? {})),
    [viewKey]: variant
  };
  return {
    kind,
    resourceId: args.resourceId,
    projection: args.projection,
    orientation: args.orientation,
    summary: { kind, resourceId: args.resourceId, viewKey },
    raw: { ...raw, manifest, visuals }
  };
}

function cameraVariantFailure(revision, error, validation = { ok: false, issues: [] }, candidate = undefined) {
  return deepFreeze({
    ok: false,
    dryRun: true,
    written: false,
    revision,
    ...(candidate ? { candidate } : {}),
    validation: {
      ok: false,
      issues: [...(validation.issues ?? []), { severity: "error", fieldPath: "viewVariants", message: error.message }]
    }
  });
}

function confinedCameraAsset(projectDir, relative) {
  if (typeof relative !== "string" || !relative.startsWith("assets/")) throw new Error("Camera view variant must reference a project-local asset path.");
  return confinedFile(projectDir, relative);
}

function assertCameraAssetSignature(filePath, mimeType) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.size < 4 || stat.size > 32 * 1024 * 1024) throw new Error("Camera view variant image must be a bounded regular file.");
  const handle = fs.openSync(filePath, "r");
  const header = Buffer.alloc(12);
  try { fs.readSync(handle, header, 0, header.length, 0); }
  finally { fs.closeSync(handle); }
  const png = header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const webp = header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP";
  if (!({ "image/png": png, "image/jpeg": jpeg, "image/webp": webp })[mimeType]) throw new Error("Camera view variant MIME does not match the image signature.");
}

function cameraCandidate(raw, args) {
  assertId(args?.profileId, "profileId");
  const profile = safeOwnClone(args?.profile, "profile");
  const visuals = clone(raw.visuals ?? {});
  const manifest = { ...clone(raw.manifest ?? {}), schemaVersion: 5 };
  const existing = visuals.cameraProfiles ?? emptyCatalog();
  const catalog = {
    schemaVersion: 1,
    profiles: { ...(clone(existing.profiles ?? {})), [args.profileId]: profile },
    bindings: { maps: { ...(clone(existing.bindings?.maps ?? {})) }, missions: { ...(clone(existing.bindings?.missions ?? {})) } }
  };
  const binding = args?.binding === undefined ? undefined : safeOwnClone(args.binding, "binding");
  if (binding !== undefined) {
    if (!binding || typeof binding !== "object" || !["map", "mission"].includes(binding.scope)) throw new Error("binding.scope must be map or mission.");
    assertId(binding.id, "binding.id");
    const bindings = catalog.bindings[binding.scope === "map" ? "maps" : "missions"];
    if (binding.enabled === false) delete bindings[binding.id];
    else bindings[binding.id] = args.profileId;
  }
  const catalogValidation = validateCameraProfileCatalogV1(catalog);
  if (!catalogValidation.ok) throw catalogValidation.error;
  visuals.schemaVersion = 4;
  visuals.cameraProfiles = catalog;
  return { catalog, raw: { ...raw, manifest, visuals } };
}

function previewContext(files, unsafe) {
  const context = unsafe && typeof unsafe === "object" ? unsafe : {};
  const missionId = typeof context.missionId === "string" ? context.missionId : undefined;
  const mapId = typeof context.mapId === "string" ? context.mapId : files.balance?.missions?.[missionId]?.mapId;
  const target = typeof context.buildTargetId === "string" ? files.buildTargets?.targets?.[context.buildTargetId] : undefined;
  const viewport = context.viewport && Number.isFinite(context.viewport.width) && Number.isFinite(context.viewport.height)
    ? { width: context.viewport.width, height: context.viewport.height }
    : { width: 1440, height: 900 };
  const authoredViewport = target?.viewport ?? {};
  const viewportProfile = {
    padding: Number.isFinite(authoredViewport.padding) ? authoredViewport.padding : 0,
    minZoom: Number.isFinite(authoredViewport.minZoom) ? authoredViewport.minZoom : 0.5,
    maxZoom: Number.isFinite(authoredViewport.maxZoom) ? authoredViewport.maxZoom : 4,
    initialZoom: Number.isFinite(authoredViewport.initialZoom) ? authoredViewport.initialZoom : 1
  };
  return { missionId, mapId, viewport, viewportProfile, resolution: { missionId, mapId, buildTargetCameraProfileId: target?.cameraProfileId } };
}

function cameraPresentationPreview(files, resolution, context) {
  const map = files.maps?.[context.mapId] ?? Object.values(files.maps ?? {})[0];
  const tiles = previewMapPoints(map);
  const geometry = previewMapGeometry(tiles, map?.grid, context.viewport);
  const worldPoints = tiles.map((tile) => ({
    ...previewWorldCenter(tile, geometry),
    elevation: Number(tile.elevation) || 0
  }));
  const renderSpace = createCameraRenderSpaceV1({
    cameraProfile: resolution.profile,
    worldPoints,
    viewport: context.viewport,
    viewportProfile: context.viewportProfile
  });
  const points = worldPoints.map((point) => renderSpace.projector.worldToScreen(point));
  const screenPoints = worldPoints.map((point) => renderSpace.worldToScreen(point));
  const { minX, minY, maxX, maxY } = renderSpace.projectedBounds;
  const spriteIds = [...new Set(Object.values(files.visuals?.bindings ?? {}).flatMap((group) => group && typeof group === "object" && !Array.isArray(group) ? Object.values(group).filter((value) => typeof value === "string") : []))];
  const tileSets = Object.entries(files.visuals?.tileSets ?? {}).map(([tileSetId, tileSet]) => ({ tileSetId, materialIds: Object.keys(tileSet?.materials ?? {}) }));
  const coverage = projectCameraViewAssetCoverageV1({
    visuals: files.visuals,
    projection: resolution.profile.projection,
    orientation: resolution.profile.orientation,
    spriteIds,
    tileSets
  });
  const projectedBounds = { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  const paddedWidth = projectedBounds.width * resolution.profile.initialZoom + resolution.profile.fitPadding * 2;
  const paddedHeight = projectedBounds.height * resolution.profile.initialZoom + resolution.profile.fitPadding * 2;
  return {
    projectedBounds,
    projectedPoints: points,
    screenPoints,
    diagnostics: {
      clipping: {
        viewport: context.viewport,
        clipped: paddedWidth > context.viewport.width || paddedHeight > context.viewport.height,
        paddedWidth,
        paddedHeight,
        screenBounds: boundsOf(screenPoints)
      },
      depth: { stable: true, comparator: "projected_y_elevation_entity_id" },
      assetCoverage: {
        exact: coverage.entries.filter((entry) => entry.status === "exact"),
        fallback: coverage.entries.filter((entry) => entry.status === "fallback"),
        missingRequired: coverage.errors
      }
    }
  };
}

function emptyCatalog() { return { schemaVersion: 1, profiles: {}, bindings: { maps: {}, missions: {} } }; }
function assertId(value, field) { if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error(`${field} must be a bounded ID.`); }
function clone(value) { return value === undefined ? undefined : structuredClone(value); }
function safeOwnClone(value, field, state = { active: new WeakSet(), nodes: 0, depth: 0 }) {
  if (value === null || typeof value !== "object") {
    if (["string", "number", "boolean", "undefined"].includes(typeof value) && (typeof value !== "number" || Number.isFinite(value))) return value;
    throw new Error(`${field} must contain bounded own-data values.`);
  }
  if (state.depth > 16 || state.nodes++ > 4096) throw new Error(`${field} exceeds the bounded own-data budget.`);
  if (state.active.has(value)) throw new Error(`${field} must not contain cyclic own-data.`);
  let prototype; let descriptors; let symbols;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
    symbols = Object.getOwnPropertySymbols(value);
  } catch {
    throw new Error(`${field} must be an inspectable own-data object.`);
  }
  if (symbols.length !== 0 || (Array.isArray(value) ? prototype !== Array.prototype : prototype !== Object.prototype)) throw new Error(`${field} must be a plain own-data object.`);
  state.active.add(value);
  const next = { ...state, depth: state.depth + 1 };
  try {
    if (Array.isArray(value)) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > 4096 || Object.keys(descriptors).length !== length + 1) throw new Error(`${field} must be a dense own-data array.`);
      const output = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor?.enumerable || !("value" in descriptor)) throw new Error(`${field}[${index}] must be an enumerable own-data value.`);
        output.push(safeOwnClone(descriptor.value, `${field}[${index}]`, next));
      }
      return output;
    }
    const output = {};
    for (const key of Object.keys(descriptors).sort()) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !("value" in descriptor)) throw new Error(`${field}.${key} must be an enumerable own-data value; accessors are forbidden.`);
      output[key] = safeOwnClone(descriptor.value, `${field}.${key}`, next);
    }
    return output;
  } finally {
    state.active.delete(value);
  }
}
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; for (const item of Object.values(value)) deepFreeze(item); return Object.freeze(value); }
function cameraRevision(raw) { return createHash("sha256").update(JSON.stringify({ manifest: raw.manifest, visuals: raw.visuals, buildTargets: raw.buildTargets })).digest("hex").slice(0, 12); }
function previewMapPoints(map) {
  if (!map || typeof map !== "object") return [{ q: 0, r: 0, elevation: 0 }];
  const points = new Map();
  const width = Number.isInteger(map.width) && map.width > 0 ? map.width : 1;
  const height = Number.isInteger(map.height) && map.height > 0 ? map.height : 1;
  const upsert = (point, authoritativeElevation = false) => {
    if (!Number.isFinite(point?.q) || !Number.isFinite(point?.r)) return;
    const q = Number(point.q), r = Number(point.r), key = `${q},${r}`;
    const previous = points.get(key);
    points.set(key, {
      q,
      r,
      elevation: authoritativeElevation || previous === undefined
        ? Number(point.elevation) || 0
        : previous.elevation
    });
  };
  for (const [q, r] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]]) upsert({ q, r, elevation: 0 });
  for (const collection of [map.terrainOverrides, map.pathCenterline]) {
    if (!Array.isArray(collection)) continue;
    for (const point of collection.slice(0, 4096)) upsert(point);
  }
  if (Array.isArray(map.elevationOverrides)) {
    for (const point of map.elevationOverrides.slice(0, 4096)) upsert(point, true);
  }
  return [...points.values()]
    .sort((left, right) => left.q - right.q || left.r - right.r)
    .slice(0, 4096);
}
function previewMapGeometry(points, grid, viewport) {
  let maxQ = 1;
  let maxR = 1;
  for (const point of points) {
    if (point.q > maxQ) maxQ = point.q;
    if (point.r > maxR) maxR = point.r;
  }
  if (grid?.kind === "square") {
    const cell = Math.min(viewport.width / (maxQ + 2), viewport.height / (maxR + 2));
    return { grid, radius: cell / 2, ox: cell, oy: cell };
  }
  const radius = Math.min(viewport.width / ((maxQ + 2) * 1.65), viewport.height / ((maxR + 2) * 1.45));
  return { grid: grid ?? { kind: "hex", layout: "odd-r" }, radius, ox: radius * 1.5, oy: radius * 1.5 };
}
function previewWorldCenter(coord, geometry) {
  if (geometry.grid.kind === "square") {
    return { x: geometry.ox + coord.q * geometry.radius * 2, y: geometry.oy + coord.r * geometry.radius * 2 };
  }
  return {
    x: geometry.ox + coord.q * geometry.radius * 1.48 + (coord.r % 2) * geometry.radius * 0.74,
    y: geometry.oy + coord.r * geometry.radius * 1.28
  };
}
function boundsOf(points) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
function assertCameraOwnedSources(projectDir) {
  const root = path.resolve(projectDir);
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Camera authoring project root must be a real directory, not a symbolic link.");
  confinedFile(root, "project.json");
  confinedFile(root, "content/visuals.json");
  confinedFile(root, "build-targets.json");
  return root;
}
function confinedFile(projectDir, relative) {
  if (typeof relative !== "string" || path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) throw new Error("Camera authoring path escaped project.");
  const root = path.resolve(projectDir);
  let target = root;
  for (const segment of relative.split("/")) {
    target = path.join(target, segment);
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) throw new Error(`Camera authoring rejects symbolic link traversal: ${relative}.`);
  }
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Camera authoring path escaped project.");
  const stat = fs.lstatSync(target);
  if (!stat.isFile()) throw new Error("Camera authoring requires regular project files.");
  return target;
}
function confinedBackupDirectory(projectDir) {
  let cursor = path.resolve(projectDir);
  for (const segment of [".towerforge", "backups"]) {
    cursor = path.join(cursor, segment);
    try {
      const stat = fs.lstatSync(cursor);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Camera backup path must use real project directories.");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      fs.mkdirSync(cursor, { mode: 0o700 });
    }
  }
  const backup = path.join(cursor, `r20-camera-${Date.now()}-${process.pid}`);
  fs.mkdirSync(backup, { mode: 0o700 });
  return backup;
}
function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    fs.renameSync(temporary, filePath);
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
  }
}
