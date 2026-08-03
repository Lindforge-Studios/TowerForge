const PROJECTIONS = new Set(["top_down", "isometric_2_1", "dimetric_oblique"]);
const ORIENTATIONS = new Set(["north", "east", "south", "west"]);
const VIEW_KEYS = new Set([...PROJECTIONS].flatMap((projection) => (
  [...ORIENTATIONS].map((orientation) => `${projection}:${orientation}`)
)));

export const CAMERA_VIEW_ASSET_LIMITS_V1 = Object.freeze({
  spriteVariantRecords: 4096,
  tileSetVariantRecords: 256,
  ownDataNodes: 262_144,
  ownDataDepth: 32
});

function binaryCompare(a, b) {
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function viewKey(projection, orientation) {
  if (!PROJECTIONS.has(projection) || !ORIENTATIONS.has(orientation)) {
    throw new Error("Camera view requires a supported projection and orientation.");
  }
  return `${projection}:${orientation}`;
}

function ownDescriptors(value, field) {
  if (value === null || typeof value !== "object") {
    throw new TypeError(`${field} must be a plain own-data object.`);
  }
  try {
    if (Array.isArray(value)) throw new Error("array");
    const prototype = Object.getPrototypeOf(value);
    const symbols = Object.getOwnPropertySymbols(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error("prototype");
    if (symbols.length !== 0) throw new Error("symbols");
    return descriptors;
  } catch {
    throw new TypeError(`${field} must be an inspectable plain own-data object.`);
  }
}

function ownValue(value, key, field) {
  const descriptors = ownDescriptors(value, field);
  const descriptor = Object.hasOwn(descriptors, key) ? descriptors[key] : undefined;
  if (!descriptor) return undefined;
  if (!descriptor.enumerable || !("value" in descriptor)) {
    throw new TypeError(`${field}.${key} must be an enumerable own-data property; accessors are not allowed.`);
  }
  return descriptor.value;
}

function defineOwn(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true
  });
}

function ownRecordValue(record, key) {
  return record !== null && typeof record === "object" && Object.hasOwn(record, key)
    ? record[key]
    : undefined;
}

function cloneOwnData(value, field, state = undefined, depth = 0) {
  if (value === null) return null;
  if (typeof value !== "object") {
    if (["string", "boolean", "undefined"].includes(typeof value)) return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    throw new TypeError(`${field} must contain finite JSON-compatible own-data values.`);
  }
  const tracker = state ?? { active: new WeakSet(), nodes: 0 };
  tracker.nodes += 1;
  if (tracker.nodes > CAMERA_VIEW_ASSET_LIMITS_V1.ownDataNodes || depth > CAMERA_VIEW_ASSET_LIMITS_V1.ownDataDepth) {
    throw new RangeError(`${field} exceeds the bounded own-data budget.`);
  }
  if (tracker.active.has(value)) throw new TypeError(`${field} contains cyclic own-data.`);
  let descriptors;
  let prototype;
  let symbols;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
    prototype = Object.getPrototypeOf(value);
    symbols = Object.getOwnPropertySymbols(value);
  } catch {
    throw new TypeError(`${field} must be inspectable own-data.`);
  }
  const isArray = Array.isArray(value);
  if (symbols.length !== 0 || (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)) {
    throw new TypeError(`${field} must be plain own-data.`);
  }
  tracker.active.add(value);
  try {
    if (isArray) {
      const lengthDescriptor = descriptors.length;
      const length = lengthDescriptor?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > CAMERA_VIEW_ASSET_LIMITS_V1.ownDataNodes) {
        throw new RangeError(`${field} exceeds the bounded own-data array budget.`);
      }
      const output = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          throw new TypeError(`${field}[${index}] must be a dense enumerable own-data property.`);
        }
        output.push(cloneOwnData(descriptor.value, `${field}[${index}]`, tracker, depth + 1));
      }
      const extras = Object.keys(descriptors).filter((key) => key !== "length" && !/^(?:0|[1-9]\d*)$/.test(key));
      if (extras.length !== 0) throw new TypeError(`${field}.${extras[0]} is not supported by the closed own-data contract.`);
      return output;
    }
    const output = {};
    for (const [key, descriptor] of Object.entries(descriptors).sort(([left], [right]) => binaryCompare(left, right))) {
      if (!descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError(`${field}.${key} must be an enumerable own-data property; accessors are not allowed.`);
      }
      defineOwn(output, key, cloneOwnData(descriptor.value, `${field}.${key}`, tracker, depth + 1));
    }
    return output;
  } finally {
    tracker.active.delete(value);
  }
}

function assertClosed(record, field, allowedKeys) {
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) throw new TypeError(`${field}.${key} is not supported by the closed own-data contract.`);
  }
}

function compileViewVariants(visuals) {
  const unsafeCatalog = ownValue(visuals, "viewVariants", "visuals");
  if (unsafeCatalog === undefined) return { sprites: {}, tileSets: {} };
  const catalog = cloneOwnData(unsafeCatalog, "viewVariants");
  assertClosed(catalog, "viewVariants", new Set(["schemaVersion", "sprites", "tileSets"]));
  if (ownRecordValue(catalog, "schemaVersion") !== 1) throw new TypeError("viewVariants.schemaVersion must be supported version 1.");
  const sprites = ownRecordValue(catalog, "sprites");
  const tileSets = ownRecordValue(catalog, "tileSets");
  if (!sprites || typeof sprites !== "object" || Array.isArray(sprites)) throw new TypeError("viewVariants.sprites must be a plain own-data catalog.");
  if (!tileSets || typeof tileSets !== "object" || Array.isArray(tileSets)) throw new TypeError("viewVariants.tileSets must be a plain own-data catalog.");

  let spriteVariantRecords = 0;
  for (const [spriteId, variants] of Object.entries(sprites)) {
    if (!variants || typeof variants !== "object" || Array.isArray(variants)) {
      throw new TypeError(`viewVariants.sprites.${spriteId} must be a plain own-data catalog.`);
    }
    for (const key of Object.keys(variants)) {
      if (!VIEW_KEYS.has(key)) throw new TypeError(`viewVariants.sprites.${spriteId}.${key} is not a supported camera view.`);
      spriteVariantRecords += 1;
      if (spriteVariantRecords > CAMERA_VIEW_ASSET_LIMITS_V1.spriteVariantRecords) {
        throw new RangeError(`viewVariants.sprites exceeds the ${CAMERA_VIEW_ASSET_LIMITS_V1.spriteVariantRecords}-record budget.`);
      }
    }
  }

  let tileSetVariantRecords = 0;
  for (const [tileSetId, variants] of Object.entries(tileSets)) {
    if (!variants || typeof variants !== "object" || Array.isArray(variants)) {
      throw new TypeError(`viewVariants.tileSets.${tileSetId} must be a plain own-data catalog.`);
    }
    for (const key of Object.keys(variants)) {
      if (!VIEW_KEYS.has(key)) throw new TypeError(`viewVariants.tileSets.${tileSetId}.${key} is not a supported camera view.`);
      tileSetVariantRecords += 1;
      if (tileSetVariantRecords > CAMERA_VIEW_ASSET_LIMITS_V1.tileSetVariantRecords) {
        throw new RangeError(`viewVariants.tileSets exceeds the ${CAMERA_VIEW_ASSET_LIMITS_V1.tileSetVariantRecords}-record budget.`);
      }
    }
  }
  return { sprites, tileSets };
}

function frozen(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) frozen(item);
  return Object.freeze(value);
}

function resolveCompiledCameraViewVariantV1(input, compiled, key) {
  const visuals = input.visuals;
  const kind = input.kind;
  const id = input.id;
  const group = kind === "sprite" ? compiled.sprites : compiled.tileSets;
  const variants = ownRecordValue(group, id);
  const exact = ownRecordValue(variants, key);
  if (exact !== undefined) {
    const asset = cloneOwnData(exact, `viewVariants.${kind === "sprite" ? "sprites" : "tileSets"}.${id}.${key}`);
    if (kind === "sprite" && ownRecordValue(asset, "anchor") === undefined) defineOwn(asset, "anchor", { x: 0.5, y: 1 });
    return frozen({ status: "exact", key, kind, id, asset });
  }
  if (kind === "sprite") {
    const unsafeSprites = ownValue(visuals, "sprites", "visuals");
    const fallback = unsafeSprites === undefined ? undefined : ownValue(unsafeSprites, id, "visuals.sprites");
    if (fallback !== undefined) {
      const asset = cloneOwnData(fallback, `visuals.sprites.${id}`);
      if (ownRecordValue(asset, "anchor") === undefined) defineOwn(asset, "anchor", { x: 0.5, y: 1 });
      return frozen({ status: "fallback", key, kind, id, asset });
    }
  }
  return frozen({ status: "missing", key, kind, id, asset: null });
}

export function resolveCameraViewVariantV1(input) {
  const key = viewKey(input?.projection, input?.orientation);
  const kind = input?.kind;
  const id = input?.id;
  if (kind !== "sprite" && kind !== "tileSet") throw new Error("Camera view asset kind must be sprite or tileSet.");
  if (typeof id !== "string" || !id) throw new Error("Camera view asset id is required.");
  const compiled = compileViewVariants(input?.visuals);
  return resolveCompiledCameraViewVariantV1(input, compiled, key);
}

export function projectCameraViewAssetCoverageV1(input) {
  const projection = input?.projection;
  const orientation = input?.orientation;
  const key = viewKey(projection, orientation);
  const compiled = compileViewVariants(input?.visuals);
  const entries = [];
  const spriteIds = [...new Set(Array.isArray(input?.spriteIds) ? input.spriteIds : [])].sort(binaryCompare);
  for (const id of spriteIds) {
    const resolved = resolveCompiledCameraViewVariantV1({ visuals: input.visuals, kind: "sprite", id }, compiled, key);
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
    const resolved = resolveCompiledCameraViewVariantV1({ visuals: input.visuals, kind: "tileSet", id: tileSetId }, compiled, key);
    const materials = resolved.asset && typeof resolved.asset === "object"
      ? ownRecordValue(resolved.asset, "materials")
      : undefined;
    const material = ownRecordValue(materials, materialId);
    entries.push(frozen({
      kind: "tileSetMaterial",
      id: `${tileSetId}:${materialId}`,
      status: resolved.status === "exact" && material !== undefined ? "exact" : "missing",
      asset: material === undefined ? null : cloneOwnData(material, `viewVariants.tileSets.${tileSetId}.${key}.materials.${materialId}`)
    }));
  }
  const warnings = entries.filter((entry) => entry.kind === "sprite" && entry.status !== "exact").map((entry) => cloneOwnData(entry, "cameraViewWarning"));
  const errors = entries.filter((entry) => entry.kind === "tileSetMaterial" && entry.status === "missing").map((entry) => cloneOwnData(entry, "cameraViewError"));
  return frozen({ schemaVersion: 1, ok: errors.length === 0, projection, orientation, entries, warnings, errors });
}

export const CAMERA_VIEW_ASSET_PROJECTIONS = Object.freeze([...PROJECTIONS]);
export const CAMERA_VIEW_ASSET_ORIENTATIONS = Object.freeze([...ORIENTATIONS]);
