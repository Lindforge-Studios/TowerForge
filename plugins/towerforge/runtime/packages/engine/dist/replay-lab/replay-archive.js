import { SIMULATION_ENGINE_VERSION } from "../simulation/checkpoint.js";
import { decodeGameCommandJournal } from "../simulation/journal.js";
import { canonicalStringify, getSimulationContentDigest } from "../simulation/stable-digest.js";
export const REPLAY_ARCHIVE_SCHEMA_VERSION = 1;
export const REPLAY_ARCHIVE_MAGIC = Object.freeze([0x54, 0x46, 0x52, 0x50]);
export const REPLAY_ARCHIVE_HEADER_BYTES = 20;
export const REPLAY_ARCHIVE_LIMITS = Object.freeze({
    maximumBytes: 72 * 1_024 * 1_024,
    maximumPayloadBytes: 72 * 1_024 * 1_024 - REPLAY_ARCHIVE_HEADER_BYTES
});
const ARCHIVE_FLAGS_V1 = 0;
const FNV1A_64_OFFSET = 0xcbf29ce484222325n;
const FNV1A_64_PRIME = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;
const CHECKSUM_DOMAIN = "towerforge:replay-archive:v1:checksum\u0000";
const ARCHIVE_DIGEST_DOMAIN = "towerforge:replay-archive:v1:digest\u0000";
const CAPABILITY_DIGEST_DOMAIN = "towerforge:replay-capabilities:v1\u0000";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")?.get;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")?.get;
const typedArrayByteOffsetGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")?.get;
const decodedArchiveContent = new WeakMap();
function deepFreezeJson(value) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
        for (const child of Object.values(value))
            deepFreezeJson(child);
        Object.freeze(value);
    }
    return value;
}
/** Package-internal decoded-archive brand and content lookup for Ghost/What-If runtimes. */
export function replayArchiveContentV1(archive) {
    return archive !== null && typeof archive === "object" ? decodedArchiveContent.get(archive) : undefined;
}
function consumeHashBytes(hash, bytes) {
    let current = hash;
    for (const byte of bytes) {
        current ^= BigInt(byte);
        current = (current * FNV1A_64_PRIME) & UINT64_MASK;
    }
    return current;
}
function domainHash(domain, bytes) {
    return consumeHashBytes(consumeHashBytes(FNV1A_64_OFFSET, textEncoder.encode(domain)), bytes);
}
function domainDigest(prefix, domain, bytes) {
    return `${prefix}:${domainHash(domain, bytes).toString(16).padStart(16, "0")}`;
}
/** Package-internal domain-separated digest primitive shared by Replay Lab codecs. */
export function replayLabDomainDigestV1(prefix, domain, canonicalPayload) {
    return domainDigest(prefix, domain, textEncoder.encode(canonicalPayload));
}
function checksumBytes(payload) {
    const output = new Uint8Array(8);
    new DataView(output.buffer).setBigUint64(0, domainHash(CHECKSUM_DOMAIN, payload), false);
    return output;
}
function equalBytes(left, right) {
    if (left.byteLength !== right.byteLength)
        return false;
    let difference = 0;
    for (let index = 0; index < left.byteLength; index += 1) {
        difference |= left[index] ^ right[index];
    }
    return difference === 0;
}
function ownedArchiveBytes(value) {
    // ArrayBuffer.isView does not unwrap proxies and therefore rejects a hostile
    // proxy before any of its traps can run. The prototype check also excludes
    // DataView, Buffer, typed-array subclasses and every non-byte view.
    if (!ArrayBuffer.isView(value)) {
        throw new Error("Replay archive bytes must be a genuine Uint8Array.");
    }
    if (Object.getPrototypeOf(value) !== Uint8Array.prototype
        || !typedArrayBufferGetter || !typedArrayByteLengthGetter || !typedArrayByteOffsetGetter) {
        throw new Error("Replay archive bytes must be a direct Uint8Array view.");
    }
    const buffer = typedArrayBufferGetter.call(value);
    if (typeof SharedArrayBuffer !== "undefined" && buffer instanceof SharedArrayBuffer) {
        throw new Error("Replay archive rejects SharedArrayBuffer-backed input.");
    }
    if (!(buffer instanceof ArrayBuffer)) {
        throw new Error("Replay archive has an unsupported backing buffer.");
    }
    const byteLength = typedArrayByteLengthGetter.call(value);
    const byteOffset = typedArrayByteOffsetGetter.call(value);
    if (byteLength > REPLAY_ARCHIVE_LIMITS.maximumBytes) {
        throw new Error("Replay archive exceeds the byte limit.");
    }
    return new Uint8Array(new Uint8Array(buffer, byteOffset, byteLength));
}
function plainObjectDescriptors(value, context) {
    if (value === null || typeof value !== "object" || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype) {
        throw new Error(`${context} must be a plain object.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        throw new Error(`${context} rejects symbol fields.`);
    }
    for (const descriptor of Object.values(descriptors)) {
        if (!("value" in descriptor) || !descriptor.enumerable) {
            throw new Error(`${context} fields must be enumerable data properties.`);
        }
    }
    return descriptors;
}
function exactDataFields(value, expected, context) {
    const descriptors = plainObjectDescriptors(value, context);
    const keys = Object.keys(descriptors).sort();
    const expectedKeys = [...expected].sort();
    if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
        throw new Error(`${context} contains missing or unsupported fields.`);
    }
    return descriptors;
}
function dataValue(descriptors, key) {
    return descriptors[key]?.value;
}
function missionIdFromJournal(journal) {
    return journal.initialCheckpoint.identity.missionId;
}
export function computeReplayCapabilityDigestV1(options) {
    const mission = Object.prototype.hasOwnProperty.call(options.content.missions, options.missionId)
        ? options.content.missions[options.missionId]
        : undefined;
    if (!mission) {
        throw new Error(`Replay capability mission "${options.missionId}" does not exist.`);
    }
    const canonical = canonicalStringify({
        schemaVersion: 1,
        missionId: options.missionId,
        capabilities: mission.capabilities
    });
    return domainDigest("tf-capabilities-v1", CAPABILITY_DIGEST_DOMAIN, textEncoder.encode(canonical));
}
export function encodeReplayArchiveV1(options) {
    // The existing decoder is the sole journal contract. It validates closed own
    // data, version/budgets/checkpoint provenance and returns a detached copy.
    const journal = decodeGameCommandJournal({ content: options.content, journal: options.journal });
    const missionId = missionIdFromJournal(journal);
    const envelope = {
        schemaVersion: REPLAY_ARCHIVE_SCHEMA_VERSION,
        engineVersion: SIMULATION_ENGINE_VERSION,
        payloadKind: "game_command_journal",
        contentDigest: journal.contentDigest,
        capabilityDigest: computeReplayCapabilityDigestV1({ content: options.content, missionId }),
        missionId,
        journal
    };
    const payloadText = canonicalStringify(envelope, {
        maxBytes: REPLAY_ARCHIVE_LIMITS.maximumPayloadBytes,
        maxNodes: 6_600_000
    });
    const payload = textEncoder.encode(payloadText);
    const totalLength = REPLAY_ARCHIVE_HEADER_BYTES + payload.byteLength;
    if (totalLength > REPLAY_ARCHIVE_LIMITS.maximumBytes) {
        throw new Error("Replay archive exceeds the byte limit.");
    }
    const bytes = new Uint8Array(totalLength);
    bytes.set(REPLAY_ARCHIVE_MAGIC, 0);
    bytes[4] = REPLAY_ARCHIVE_SCHEMA_VERSION;
    bytes[5] = ARCHIVE_FLAGS_V1;
    const view = new DataView(bytes.buffer);
    view.setUint16(6, REPLAY_ARCHIVE_HEADER_BYTES, false);
    view.setUint32(8, payload.byteLength, false);
    bytes.set(checksumBytes(payload), 12);
    bytes.set(payload, REPLAY_ARCHIVE_HEADER_BYTES);
    return bytes;
}
export function decodeReplayArchiveV1(options) {
    const bytes = ownedArchiveBytes(options.bytes);
    if (bytes.byteLength < REPLAY_ARCHIVE_HEADER_BYTES) {
        throw new Error("Replay archive is truncated before its header.");
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let index = 0; index < REPLAY_ARCHIVE_MAGIC.length; index += 1) {
        if (bytes[index] !== REPLAY_ARCHIVE_MAGIC[index])
            throw new Error("Replay archive magic is invalid.");
    }
    if (bytes[4] !== REPLAY_ARCHIVE_SCHEMA_VERSION)
        throw new Error("Replay archive version is unsupported.");
    if (bytes[5] !== ARCHIVE_FLAGS_V1)
        throw new Error("Replay archive flags are unsupported.");
    if (view.getUint16(6, false) !== REPLAY_ARCHIVE_HEADER_BYTES) {
        throw new Error("Replay archive header length is invalid.");
    }
    const declaredPayloadLength = view.getUint32(8, false);
    if (declaredPayloadLength !== bytes.byteLength - REPLAY_ARCHIVE_HEADER_BYTES) {
        throw new Error("Replay archive payload length is truncated or has trailing bytes.");
    }
    const payload = bytes.subarray(REPLAY_ARCHIVE_HEADER_BYTES);
    if (!equalBytes(bytes.subarray(12, REPLAY_ARCHIVE_HEADER_BYTES), checksumBytes(payload))) {
        throw new Error("Replay archive checksum mismatch.");
    }
    let payloadText;
    let parsed;
    try {
        payloadText = textDecoder.decode(payload);
        parsed = JSON.parse(payloadText);
    }
    catch {
        throw new Error("Replay archive payload is not valid canonical UTF-8 JSON.");
    }
    let canonical;
    try {
        canonical = canonicalStringify(parsed, {
            maxBytes: REPLAY_ARCHIVE_LIMITS.maximumPayloadBytes,
            maxNodes: 6_600_000
        });
    }
    catch {
        throw new Error("Replay archive payload exceeds canonical JSON bounds.");
    }
    if (canonical !== payloadText) {
        throw new Error("Replay archive payload is not canonical JSON.");
    }
    const descriptors = exactDataFields(parsed, [
        "schemaVersion",
        "engineVersion",
        "payloadKind",
        "contentDigest",
        "capabilityDigest",
        "missionId",
        "journal"
    ], "Replay archive payload");
    if (dataValue(descriptors, "schemaVersion") !== REPLAY_ARCHIVE_SCHEMA_VERSION) {
        throw new Error("Replay archive payload schema version is unsupported.");
    }
    if (dataValue(descriptors, "engineVersion") !== SIMULATION_ENGINE_VERSION) {
        throw new Error("Replay archive payload engine version is unsupported.");
    }
    if (dataValue(descriptors, "payloadKind") !== "game_command_journal") {
        throw new Error("Replay archive payload kind is unsupported.");
    }
    const contentDigest = dataValue(descriptors, "contentDigest");
    if (typeof contentDigest !== "string" || contentDigest !== getSimulationContentDigest(options.content)) {
        throw new Error("Replay archive content digest mismatch.");
    }
    const missionId = dataValue(descriptors, "missionId");
    if (typeof missionId !== "string" || missionId.length === 0) {
        throw new Error("Replay archive mission id is invalid.");
    }
    const capabilityDigest = dataValue(descriptors, "capabilityDigest");
    const expectedCapabilityDigest = computeReplayCapabilityDigestV1({ content: options.content, missionId });
    if (capabilityDigest !== expectedCapabilityDigest) {
        throw new Error("Replay archive capability digest mismatch.");
    }
    const journal = decodeGameCommandJournal({
        content: options.content,
        journal: dataValue(descriptors, "journal")
    });
    if (journal.contentDigest !== contentDigest || missionIdFromJournal(journal) !== missionId) {
        throw new Error("Replay archive journal identity mismatch.");
    }
    const archive = Object.freeze({
        schemaVersion: REPLAY_ARCHIVE_SCHEMA_VERSION,
        engineVersion: SIMULATION_ENGINE_VERSION,
        payloadKind: "game_command_journal",
        contentDigest,
        capabilityDigest: expectedCapabilityDigest,
        missionId,
        archiveDigest: domainDigest("tf-replay-v1", ARCHIVE_DIGEST_DOMAIN, bytes),
        journal: deepFreezeJson(journal)
    });
    decodedArchiveContent.set(archive, options.content);
    return archive;
}
