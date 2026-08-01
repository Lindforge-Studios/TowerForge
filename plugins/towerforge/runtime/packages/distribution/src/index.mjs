export const DISTRIBUTION_SCHEMA_VERSION = 1;
export const DISTRIBUTION_LIMITS = Object.freeze({
  maximumPlacements: 16,
  maximumAttributionBytes: 65_536,
  maximumIdBytes: 128
});

const LICENSES = new Set(["ARR", "MIT", "Apache-2.0", "CC0-1.0", "CC-BY-4.0", "CC-BY-SA-4.0"]);
const REMIX_POLICIES = new Set(["forbidden", "allowed", "allowed_with_attribution"]);
const PLACEMENT_KINDS = new Set(["banner", "interstitial", "purchase_link"]);
const PLACEMENT_SURFACES = new Set(["top", "bottom", "menu", "between_waves"]);
const PROJECT_ID = /^tfp_[a-f0-9]{32}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CAPABILITY_ID = /^[a-z][a-z0-9_]{0,127}$/;

export function normalizeDistributionConfigV1(value) {
  const root = captureRecord(value, "distribution", [
    "schemaVersion", "projectId", "license", "remix", "monetization", "remixProvenance"
  ]);
  if (root.schemaVersion !== DISTRIBUTION_SCHEMA_VERSION) fail("Distribution schemaVersion must be 1.");
  requireProjectId(root.projectId, "Distribution projectId");
  const license = normalizeLicense(root.license);
  const remix = normalizeRemix(root.remix, license);
  const normalized = {
    schemaVersion: 1,
    projectId: root.projectId,
    license,
    remix,
    ...(root.monetization === undefined ? {} : { monetization: validateMonetizationHookV1(root.monetization) }),
    ...(root.remixProvenance === undefined ? {} : { remixProvenance: validateRemixProvenanceV1(root.remixProvenance) })
  };
  return deepFreeze(normalized);
}

export function validateDistributionConfigV1(value) {
  return normalizeDistributionConfigV1(value);
}

export function validateMonetizationHookV1(value) {
  const root = captureRecord(value, "monetization", ["schemaVersion", "placements"]);
  if (root.schemaVersion !== 1) fail("Monetization schemaVersion must be 1.");
  const placementsInput = captureDenseArray(root.placements, "Monetization placements", DISTRIBUTION_LIMITS.maximumPlacements);
  const ids = new Set();
  const placements = placementsInput.map((input, index) => {
    const item = captureRecord(input, `Monetization placement ${index}`, ["id", "kind", "surface"]);
    requireId(item.id, `Monetization placement ${index} id`);
    if (ids.has(item.id)) fail(`Duplicate monetization placement id "${item.id}".`);
    ids.add(item.id);
    if (!PLACEMENT_KINDS.has(item.kind)) fail(`Unsupported monetization placement kind "${String(item.kind)}".`);
    if (!PLACEMENT_SURFACES.has(item.surface)) fail(`Unsupported monetization placement surface "${String(item.surface)}".`);
    return { id: item.id, kind: item.kind, surface: item.surface };
  });
  return deepFreeze({ schemaVersion: 1, placements });
}

export function validateRemixProvenanceV1(value) {
  const root = captureRecord(value, "remix provenance", [
    "schemaVersion", "parentProjectId", "parentManifestDigest", "parentSourcePackDigest", "attribution", "source"
  ]);
  if (root.schemaVersion !== 1) fail("Remix provenance schemaVersion must be 1.");
  requireProjectId(root.parentProjectId, "Remix provenance parentProjectId");
  requireDigest(root.parentManifestDigest, "Remix provenance parentManifestDigest");
  requireDigest(root.parentSourcePackDigest, "Remix provenance parentSourcePackDigest");
  requireBoundedString(root.attribution, "Remix provenance attribution", DISTRIBUTION_LIMITS.maximumAttributionBytes, true);
  const source = captureRecord(root.source, "Remix provenance source", ["kind"]);
  if (source.kind !== "published_tdpack") fail("Remix provenance source kind must be published_tdpack.");
  return deepFreeze({
    schemaVersion: 1,
    parentProjectId: root.parentProjectId,
    parentManifestDigest: root.parentManifestDigest,
    parentSourcePackDigest: root.parentSourcePackDigest,
    attribution: root.attribution,
    source: { kind: "published_tdpack" }
  });
}

export function buildPublishManifestV1(input) {
  const root = captureRecord(input, "publish manifest input", [
    "distribution", "engine", "content", "bundle", "capabilities", "sourcePack"
  ]);
  const distribution = normalizeDistributionConfigV1(root.distribution);
  const engine = captureRecord(root.engine, "publish manifest engine", ["version", "digest"]);
  requireBoundedString(engine.version, "Publish manifest engine version", 128, true);
  requireDigest(engine.digest, "Publish manifest engine digest");
  const content = digestRecord(root.content, "content");
  const bundle = digestRecord(root.bundle, "bundle");
  const sourcePack = digestRecord(root.sourcePack, "source pack");
  const capabilitiesInput = captureDenseArray(root.capabilities, "Publish manifest capabilities", 256);
  const seen = new Set();
  const capabilities = capabilitiesInput.map((capability) => {
    if (typeof capability !== "string" || !CAPABILITY_ID.test(capability)) fail("Publish manifest capability is invalid.");
    if (seen.has(capability)) fail(`Duplicate publish capability "${capability}".`);
    seen.add(capability);
    return capability;
  }).sort(binaryCompare);
  return deepFreeze({
    schemaVersion: 1,
    format: "towerforge.publish-manifest",
    projectId: distribution.projectId,
    engine: { version: engine.version, digest: engine.digest },
    content,
    bundle,
    capabilities,
    license: { ...distribution.license },
    remixPolicy: { ...distribution.remix },
    sourcePack,
  });
}

export function computePublishCandidateDigestV1(manifest) {
  const normalized = normalizePublishManifestV1(manifest);
  return sha256(utf8Bytes(JSON.stringify(normalized)));
}

export function verifyPublishManifestV1(manifest, input) {
  const actual = normalizePublishManifestV1(manifest);
  const expected = buildPublishManifestV1(input);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail("Publish manifest digest or provenance mismatch.");
  return actual;
}

export function normalizePublishManifestV1(value) {
  const root = captureRecord(value, "publish manifest", [
    "schemaVersion", "format", "projectId", "engine", "content", "bundle", "capabilities", "license", "remixPolicy", "sourcePack"
  ]);
  if (root.schemaVersion !== 1 || root.format !== "towerforge.publish-manifest") fail("Unsupported publish manifest schema/version.");
  return buildPublishManifestV1({
    distribution: {
      schemaVersion: 1,
      projectId: root.projectId,
      license: root.license,
      remix: root.remixPolicy
    },
    engine: root.engine,
    content: root.content,
    bundle: root.bundle,
    capabilities: root.capabilities,
    sourcePack: root.sourcePack
  });
}

export function canonicalJsonBytes(value) {
  return utf8Bytes(JSON.stringify(value));
}

function normalizeLicense(value) {
  const record = captureRecord(value, "distribution license", ["spdxId", "attribution"]);
  if (!LICENSES.has(record.spdxId)) fail(`Unsupported distribution license "${String(record.spdxId)}".`);
  requireBoundedString(record.attribution, "Distribution license attribution", DISTRIBUTION_LIMITS.maximumAttributionBytes, false);
  return { spdxId: record.spdxId, attribution: record.attribution };
}

function normalizeRemix(value, license) {
  const record = captureRecord(value, "distribution remix", ["policy", "includeSource"]);
  if (!REMIX_POLICIES.has(record.policy)) fail(`Unsupported distribution remix policy "${String(record.policy)}".`);
  if (typeof record.includeSource !== "boolean") fail("Distribution remix includeSource must be boolean.");
  if (record.policy === "forbidden" && record.includeSource) fail("Forbidden remix policy cannot include source.");
  if (record.policy !== "forbidden" && !record.includeSource) fail("Allowed remix policy requires source inclusion.");
  if (license.spdxId === "ARR" && (record.policy !== "forbidden" || record.includeSource !== false)) {
    fail("ARR license requires remix policy forbidden with includeSource false.");
  }
  if (record.policy === "allowed_with_attribution" && license.attribution.trim().length === 0) {
    fail("Attribution is required for allowed_with_attribution remix.");
  }
  return { policy: record.policy, includeSource: record.includeSource };
}

function digestRecord(value, label) {
  const record = captureRecord(value, `publish manifest ${label}`, ["digest"]);
  requireDigest(record.digest, `Publish manifest ${label} digest`);
  return { digest: record.digest };
}

function captureRecord(value, label, allowedKeys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(value); }
  catch { fail(`Could not inspect ${label}.`); }
  const allowed = new Set(allowedKeys);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!allowed.has(key)) fail(`Unsupported field "${key}" in ${label}.`);
    if (!("value" in descriptor)) fail(`${label}.${key} must be an own data property; accessors are not supported.`);
  }
  const result = {};
  for (const key of allowedKeys) if (Object.prototype.hasOwnProperty.call(descriptors, key)) result[key] = descriptors[key].value;
  return result;
}

function captureDenseArray(value, label, maximum) {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const lengthDescriptor = descriptors.length;
  if (!("value" in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) fail(`${label} has an invalid length.`);
  if (lengthDescriptor.value > maximum) fail(`${label} exceeds the ${maximum} item limit.`);
  const result = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor) fail(`${label} must not be sparse.`);
    if (!("value" in descriptor)) fail(`${label} entries must be own data properties; accessors are not supported.`);
    result.push(descriptor.value);
  }
  for (const key of Object.keys(descriptors)) {
    if (key !== "length" && !/^(0|[1-9][0-9]*)$/.test(key)) fail(`${label} has unsupported array fields.`);
  }
  return result;
}

function requireProjectId(value, label) {
  if (typeof value !== "string" || !PROJECT_ID.test(value)) fail(`${label} is invalid.`);
}

function requireId(value, label) {
  requireBoundedString(value, label, DISTRIBUTION_LIMITS.maximumIdBytes, true);
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(value)) fail(`${label} is invalid.`);
}

function requireDigest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(`${label} must be a lowercase SHA-256 digest.`);
}

function requireBoundedString(value, label, maximumBytes, nonEmpty) {
  if (typeof value !== "string" || (nonEmpty && value.trim().length === 0)) fail(`${label} must be a string${nonEmpty ? " and must not be empty" : ""}.`);
  if (utf8Bytes(value).byteLength > maximumBytes) fail(`${label} exceeds the ${maximumBytes} byte limit.`);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

function sha256(bytes) {
  const bitLength = bytes.byteLength * 8;
  const paddedLength = Math.ceil((bytes.byteLength + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.byteLength] = 0x80;
  const view = new DataView(padded.buffer);
  const high = Math.floor(bitLength / 0x1_0000_0000);
  const low = bitLength >>> 0;
  view.setUint32(paddedLength - 8, high, false);
  view.setUint32(paddedLength - 4, low, false);

  const constants = SHA256_CONSTANTS;
  const words = new Uint32Array(64);
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const w15 = words[index - 15];
      const w2 = words[index - 2];
      const s0 = rotateRight(w15, 7) ^ rotateRight(w15, 18) ^ (w15 >>> 3);
      const s1 = rotateRight(w2, 17) ^ rotateRight(w2, 19) ^ (w2 >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choose + constants[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((word) => word.toString(16).padStart(8, "0")).join("");
}

function utf8Bytes(value) {
  return new TextEncoder().encode(value);
}

function rotateRight(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function binaryCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(message) {
  throw new Error(message);
}
