import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MAX_GENERATED_ASSET_BYTES = 32 * 1024 * 1024;
const LICENSE_IDS = new Set(["CC0-1.0", "CC-BY-4.0", "proprietary-owned"]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const WEBP_RIFF_SIGNATURE = Buffer.from("RIFF", "ascii");
const WEBP_FORMAT_SIGNATURE = Buffer.from("WEBP", "ascii");

function plain(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label} must be a plain object.`);
  }
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!("value" in descriptor) || !descriptor.enumerable) throw new Error(`${label}.${key} must be an enumerable data property.`);
  }
  return value;
}

function assertClosed(record, keys, label) {
  const expected = [...keys].sort();
  const actual = Object.keys(record).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} metadata is malformed or has unsupported fields.`);
  }
}

function assertRealDirectory(directory, label) {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symlink.`);
  if (!stat.isDirectory()) throw new Error(`${label} must be a real directory.`);
}

function assertRealFile(filePath, label) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symlink.`);
  if (!stat.isFile()) throw new Error(`${label} must be a regular file.`);
}

function stageRoot(projectDir, create = false) {
  const root = path.resolve(projectDir);
  assertRealDirectory(root, "Generated asset project root");
  const towerforge = path.join(root, ".towerforge");
  const staging = path.join(towerforge, "generated-assets");
  for (const [candidate, label] of [[towerforge, "Generated asset state directory"], [staging, "Generated asset staging root"]]) {
    if (fs.existsSync(candidate)) assertRealDirectory(candidate, label);
  }
  if (create) {
    fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
    assertRealDirectory(towerforge, "Generated asset state directory");
    assertRealDirectory(staging, "Generated asset staging root");
  }
  return staging;
}

function signatureMime(bytes) {
  if (bytes.length >= PNG_SIGNATURE.length && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return "image/png";
  if (bytes.length >= JPEG_SIGNATURE.length && bytes.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) return "image/jpeg";
  if (bytes.length >= 12 && bytes.subarray(0, 4).equals(WEBP_RIFF_SIGNATURE) && bytes.subarray(8, 12).equals(WEBP_FORMAT_SIGNATURE)) return "image/webp";
  return undefined;
}

function validateRequest(input) {
  const request = plain(input, "Generated asset request");
  if (!Buffer.isBuffer(request.bytes) || request.bytes.length === 0 || request.bytes.length > MAX_GENERATED_ASSET_BYTES) {
    throw new Error(`Generated asset bytes must be a non-empty Buffer up to ${MAX_GENERATED_ASSET_BYTES} bytes.`);
  }
  const detected = signatureMime(request.bytes);
  if (!detected || detected !== request.declaredMimeType) throw new Error("Generated asset MIME/signature mismatch.");
  if (typeof request.fileName !== "string" || request.fileName !== path.basename(request.fileName)
    || !/^[^/\\\0]{1,255}$/.test(request.fileName)) throw new Error("Generated asset fileName must be a safe basename.");
  const license = plain(request.license, "Generated asset license");
  if (!LICENSE_IDS.has(license.id) || (license.attribution !== null && typeof license.attribution !== "string")) {
    throw new Error("Generated asset license is missing or unsupported.");
  }
  const provenance = plain(request.provenance, "Generated asset provenance");
  for (const key of ["generator", "provider", "model", "generatedAt"]) {
    if (typeof provenance[key] !== "string" || !provenance[key] || provenance[key].length > 1024) throw new Error(`Generated asset provenance.${key} is required.`);
  }
  if (!Number.isFinite(Date.parse(provenance.generatedAt))) throw new Error("Generated asset provenance.generatedAt must be an ISO timestamp.");
  return {
    bytes: request.bytes,
    mimeType: detected,
    fileName: request.fileName,
    license: { id: license.id, attribution: license.attribution },
    provenance: {
      generator: provenance.generator,
      provider: provenance.provider,
      model: provenance.model,
      generatedAt: provenance.generatedAt
    }
  };
}

function resolveHandle(projectDir, handle) {
  if (typeof handle !== "string" || !/^staged_[A-Za-z0-9_-]{16,}$/.test(handle)) throw new Error("Generated asset handle is invalid.");
  const root = stageRoot(projectDir);
  const directory = path.join(root, handle);
  if (path.dirname(directory) !== root) throw new Error("Generated asset handle escapes staging.");
  if (fs.existsSync(directory)) assertRealDirectory(directory, "Generated asset handle directory");
  return directory;
}

function validateStoredMetadata(value, expectedHandle) {
  const metadata = plain(value, "Generated asset metadata");
  assertClosed(metadata, ["schemaVersion", "handle", "mimeType", "size", "fileName", "license", "provenance"], "Generated asset");
  if (metadata.schemaVersion !== 1 || metadata.handle !== expectedHandle) {
    throw new Error("Generated asset metadata handle or schema version was tampered with.");
  }
  if (!["image/png", "image/jpeg", "image/webp"].includes(metadata.mimeType)) {
    throw new Error("Generated asset metadata MIME is unsupported.");
  }
  if (!Number.isSafeInteger(metadata.size) || metadata.size < 1 || metadata.size > MAX_GENERATED_ASSET_BYTES) {
    throw new Error("Generated asset metadata size is invalid.");
  }
  if (typeof metadata.fileName !== "string" || metadata.fileName !== path.basename(metadata.fileName)
    || !/^[^/\\\0]{1,255}$/.test(metadata.fileName)) throw new Error("Generated asset metadata fileName is invalid.");
  const license = plain(metadata.license, "Generated asset metadata license");
  assertClosed(license, ["id", "attribution"], "Generated asset license");
  if (!LICENSE_IDS.has(license.id) || (license.attribution !== null && typeof license.attribution !== "string")) {
    throw new Error("Generated asset metadata license is unsupported.");
  }
  const provenance = plain(metadata.provenance, "Generated asset metadata provenance");
  assertClosed(provenance, ["generator", "provider", "model", "generatedAt"], "Generated asset provenance");
  for (const key of ["generator", "provider", "model", "generatedAt"]) {
    if (typeof provenance[key] !== "string" || !provenance[key] || provenance[key].length > 1024) {
      throw new Error(`Generated asset metadata provenance.${key} is invalid.`);
    }
  }
  if (!Number.isFinite(Date.parse(provenance.generatedAt))) throw new Error("Generated asset metadata provenance timestamp is invalid.");
  return metadata;
}

export function stageGeneratedAsset(projectDir, input) {
  const validated = validateRequest(input);
  const handle = `staged_${crypto.randomBytes(18).toString("base64url")}`;
  stageRoot(projectDir, true);
  const directory = resolveHandle(projectDir, handle);
  fs.mkdirSync(directory, { mode: 0o700 });
  const dataPath = path.join(directory, "payload.bin");
  const metadataPath = path.join(directory, "metadata.json");
  try {
    fs.writeFileSync(dataPath, validated.bytes, { mode: 0o600, flag: "wx" });
    fs.writeFileSync(metadataPath, `${JSON.stringify({
      schemaVersion: 1,
      handle,
      mimeType: validated.mimeType,
      size: validated.bytes.length,
      fileName: validated.fileName,
      license: validated.license,
      provenance: validated.provenance
    }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return Object.freeze({ schemaVersion: 1, handle, mimeType: validated.mimeType, size: validated.bytes.length, readyForPreview: true });
}

function readValidatedStagedAsset(projectDir, handle) {
  const directory = resolveHandle(projectDir, handle);
  const metadataPath = path.join(directory, "metadata.json");
  const dataPath = path.join(directory, "payload.bin");
  assertRealFile(metadataPath, "Generated asset metadata");
  assertRealFile(dataPath, "Generated asset payload");
  const metadata = validateStoredMetadata(JSON.parse(fs.readFileSync(metadataPath, "utf8")), handle);
  const bytes = fs.readFileSync(dataPath);
  const detected = signatureMime(bytes);
  if (detected !== metadata.mimeType || bytes.length !== metadata.size) throw new Error("Staged generated asset no longer matches its signature or size metadata.");
  return {
    bytes,
    inspection: Object.freeze({
      schemaVersion: 1,
      handle,
      mimeType: metadata.mimeType,
      signatureValid: true,
      size: metadata.size,
      fileName: metadata.fileName,
      license: Object.freeze({ ...metadata.license }),
      provenance: Object.freeze({ ...metadata.provenance })
    })
  };
}

export function inspectStagedAsset(projectDir, handle) {
  return readValidatedStagedAsset(projectDir, handle).inspection;
}

export function readStagedAssetForCommit(projectDir, handle) {
  const { inspection: inspected, bytes } = readValidatedStagedAsset(projectDir, handle);
  return { inspected, bytes };
}

export function discardStagedAsset(projectDir, handle) {
  const directory = resolveHandle(projectDir, handle);
  fs.rmSync(directory, { recursive: true, force: true });
  return { ok: true, discarded: true, handle };
}
