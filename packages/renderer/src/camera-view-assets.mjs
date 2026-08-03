const PROJECTIONS = new Set(["top_down", "isometric_2_1", "dimetric_oblique"]);
const ORIENTATIONS = new Set(["north", "east", "south", "west"]);

function binaryCompare(a, b) {
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function viewKey(projection, orientation) {
  if (!PROJECTIONS.has(projection) || !ORIENTATIONS.has(orientation)) {
    throw new Error("Camera view requires a supported projection and orientation.");
  }
  return `${projection}:${orientation}`;
}

function own(record, key) {
  if (!record || typeof record !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && "value" in descriptor && descriptor.enumerable ? descriptor.value : undefined;
}

function detached(value) {
  if (value === undefined || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(detached);
  const output = {};
  for (const key of Object.keys(value).sort(binaryCompare)) output[key] = detached(own(value, key));
  return output;
}

function frozen(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) frozen(item);
  return Object.freeze(value);
}

export function resolveCameraViewVariantV1(input) {
  const key = viewKey(input?.projection, input?.orientation);
  const visuals = input?.visuals;
  const kind = input?.kind;
  const id = input?.id;
  if (kind !== "sprite" && kind !== "tileSet") throw new Error("Camera view asset kind must be sprite or tileSet.");
  if (typeof id !== "string" || !id) throw new Error("Camera view asset id is required.");
  const catalog = own(visuals, "viewVariants");
  const group = own(catalog, kind === "sprite" ? "sprites" : "tileSets");
  const variants = own(group, id);
  const exact = own(variants, key);
  if (exact !== undefined) return frozen({ status: "exact", key, kind, id, asset: detached(exact) });
  if (kind === "sprite") {
    const fallback = own(own(visuals, "sprites"), id);
    if (fallback !== undefined) return frozen({ status: "fallback", key, kind, id, asset: detached(fallback) });
  }
  return frozen({ status: "missing", key, kind, id, asset: null });
}

export function projectCameraViewAssetCoverageV1(input) {
  const projection = input?.projection;
  const orientation = input?.orientation;
  viewKey(projection, orientation);
  const entries = [];
  const spriteIds = [...new Set(Array.isArray(input?.spriteIds) ? input.spriteIds : [])].sort(binaryCompare);
  for (const id of spriteIds) {
    const resolved = resolveCameraViewVariantV1({ visuals: input.visuals, kind: "sprite", id, projection, orientation });
    entries.push(frozen({ kind: "sprite", id, status: resolved.status, asset: resolved.asset }));
  }
  const tileSets = Array.isArray(input?.tileSets) ? input.tileSets : [];
  const materialRows = [];
  for (const tileSet of tileSets) {
    for (const materialId of Array.isArray(tileSet?.materialIds) ? tileSet.materialIds : []) {
      materialRows.push({ tileSetId: tileSet?.tileSetId, materialId });
    }
  }
  materialRows.sort((a, b) => binaryCompare(`${a.tileSetId}:${a.materialId}`, `${b.tileSetId}:${b.materialId}`));
  for (const { tileSetId, materialId } of materialRows) {
    const resolved = resolveCameraViewVariantV1({ visuals: input.visuals, kind: "tileSet", id: tileSetId, projection, orientation });
    const material = own(own(resolved.asset, "materials"), materialId);
    entries.push(frozen({
      kind: "tileSetMaterial",
      id: `${tileSetId}:${materialId}`,
      status: resolved.status === "exact" && material !== undefined ? "exact" : "missing",
      asset: material === undefined ? null : detached(material)
    }));
  }
  const warnings = entries.filter((entry) => entry.kind === "sprite" && entry.status !== "exact").map(detached);
  const errors = entries.filter((entry) => entry.kind === "tileSetMaterial" && entry.status === "missing").map(detached);
  return frozen({ schemaVersion: 1, ok: errors.length === 0, projection, orientation, entries, warnings, errors });
}

export const CAMERA_VIEW_ASSET_PROJECTIONS = Object.freeze([...PROJECTIONS]);
export const CAMERA_VIEW_ASSET_ORIENTATIONS = Object.freeze([...ORIENTATIONS]);
