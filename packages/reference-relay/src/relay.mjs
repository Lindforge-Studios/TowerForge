import { negotiateMatchCapabilityHandshakeV1 } from "@towerforge/engine/multiplayer";

export const REFERENCE_RELAY_LIMITS = Object.freeze({
  inviteCodeUtf8Bytes: 128,
  peerIdUtf8Bytes: 128,
  peersPerRoom: 4,
  frameBytes: 1_048_576,
  queuedFramesPerPeer: 256
});

const MAX_ROOMS = 128;
const encoder = new TextEncoder();

function utf8Bytes(value) {
  return encoder.encode(value).byteLength;
}

function requireBoundedId(value, label, maximumBytes) {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()
    || utf8Bytes(value) > maximumBytes) {
    throw new Error(`${label} must be a non-empty identifier of at most ${maximumBytes} UTF-8 bytes.`);
  }
  return value;
}

function dataProperty(record, key) {
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(record, key);
  } catch {
    throw new Error("Relay join options must be a plain own-data record.");
  }
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw new Error(`Relay join option ${key} must be an enumerable own-data property.`);
  }
  return descriptor.value;
}

function readJoinOptions(value) {
  let prototype;
  let keys;
  let symbols;
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error();
    prototype = Object.getPrototypeOf(value);
    keys = Object.keys(value);
    symbols = Object.getOwnPropertySymbols(value);
  } catch {
    throw new Error("Relay join options must be a plain own-data record.");
  }
  const expected = ["deliver", "handshake", "inviteCode", "peerId"];
  if ((prototype !== Object.prototype && prototype !== null) || symbols.length > 0
    || keys.length !== expected.length || !expected.every((key) => keys.includes(key))) {
    throw new Error("Relay join options must contain only inviteCode, peerId, handshake and deliver.");
  }
  const inviteCode = requireBoundedId(dataProperty(value, "inviteCode"), "Invite code", REFERENCE_RELAY_LIMITS.inviteCodeUtf8Bytes);
  const peerId = requireBoundedId(dataProperty(value, "peerId"), "Peer ID", REFERENCE_RELAY_LIMITS.peerIdUtf8Bytes);
  const handshake = dataProperty(value, "handshake");
  const deliver = dataProperty(value, "deliver");
  if (typeof deliver !== "function") throw new Error("Relay peer deliver callback is required.");
  return { inviteCode, peerId, handshake, deliver };
}

function detachHandshake(value) {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const capabilities = descriptors.capabilities.value;
  const detachedCapabilities = Array.from(capabilities, (_entry, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(capabilities, String(index));
    return descriptor.value;
  });
  return Object.freeze({
    schemaVersion: descriptors.schemaVersion.value,
    protocolVersion: descriptors.protocolVersion.value,
    engineVersion: descriptors.engineVersion.value,
    matchId: descriptors.matchId.value,
    contentDigest: descriptors.contentDigest.value,
    mode: descriptors.mode.value,
    capabilities: Object.freeze(detachedCapabilities)
  });
}

function cloneJsonData(value, seen, budget) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Relay frame numbers must be finite.");
    return value;
  }
  if (typeof value !== "object") throw new Error("Relay frames must contain only detached JSON or binary data.");
  if (seen.has(value)) throw new Error("Relay frames must not be cyclic.");
  seen.add(value);
  budget.count += 1;
  if (budget.count > 100_000) throw new Error("Relay frame structural limit exceeded.");
  try {
    if (value instanceof ArrayBuffer) return value.slice(0);
    if (ArrayBuffer.isView(value)) {
      if (!(value instanceof Uint8Array)) throw new Error("Relay binary frames must use Uint8Array or ArrayBuffer.");
      return new Uint8Array(value);
    }
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(descriptors).length > 0) throw new Error("Relay frame symbol keys are not supported.");
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype || Object.keys(descriptors).length !== value.length + 1) {
        throw new Error("Relay frame arrays must be dense own-data arrays.");
      }
      const output = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new Error("Relay frame arrays must be dense own-data arrays.");
        }
        output.push(cloneJsonData(descriptor.value, seen, budget));
      }
      return output;
    }
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("Relay frame records must be plain own-data objects.");
    }
    const output = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!("value" in descriptor) || !descriptor.enumerable) {
        throw new Error("Relay frame records must contain enumerable own-data properties.");
      }
      output[key] = cloneJsonData(descriptor.value, seen, budget);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

function detachFrame(value) {
  const frame = cloneJsonData(value, new Set(), { count: 0 });
  let bytes;
  if (frame instanceof ArrayBuffer) bytes = frame.byteLength;
  else if (frame instanceof Uint8Array) bytes = frame.byteLength;
  else bytes = utf8Bytes(JSON.stringify(frame));
  if (bytes > REFERENCE_RELAY_LIMITS.frameBytes) {
    throw new Error(`Relay frame byte size exceeds the ${REFERENCE_RELAY_LIMITS.frameBytes} byte limit.`);
  }
  return frame;
}

function negotiationError(result) {
  return new Error(`Relay capability handshake mismatch: ${result.code}.`);
}

export function createReferenceRelayV1() {
  const rooms = new Map();
  let closed = false;

  function removePeer(room, peer) {
    room.peers.delete(peer.peerId);
    peer.queue.length = 0;
    if (room.peers.size === 0) rooms.delete(room.inviteCode);
  }

  function join(rawOptions) {
    if (closed) throw new Error("Reference relay is closed.");
    const options = readJoinOptions(rawOptions);
    let room = rooms.get(options.inviteCode);
    if (!room) {
      if (rooms.size >= MAX_ROOMS) throw new Error(`Reference relay room limit of ${MAX_ROOMS} reached.`);
      const validation = negotiateMatchCapabilityHandshakeV1(options.handshake, options.handshake);
      if (!validation.ok) throw negotiationError(validation);
      room = {
        inviteCode: options.inviteCode,
        handshake: detachHandshake(options.handshake),
        peers: new Map()
      };
      rooms.set(options.inviteCode, room);
    } else {
      const negotiation = negotiateMatchCapabilityHandshakeV1(room.handshake, options.handshake);
      if (!negotiation.ok) throw negotiationError(negotiation);
    }
    if (room.peers.has(options.peerId)) throw new Error(`Relay peer ID ${options.peerId} already exists in room.`);
    if (room.peers.size >= REFERENCE_RELAY_LIMITS.peersPerRoom) {
      throw new Error(`Relay room is full; at most ${REFERENCE_RELAY_LIMITS.peersPerRoom} peers are allowed.`);
    }

    const peer = {
      peerId: options.peerId,
      deliver: options.deliver,
      queue: [],
      closed: false
    };
    room.peers.set(peer.peerId, peer);

    function flushPeer() {
      if (peer.closed) throw new Error("Relay peer is closed.");
      while (peer.queue.length > 0) {
        const delivered = peer.deliver(detachFrame(peer.queue[0]));
        if (delivered === false) return false;
        peer.queue.shift();
      }
      return true;
    }

    function send(frameValue) {
      if (closed || peer.closed || !room.peers.has(peer.peerId)) throw new Error("Relay peer is closed.");
      if (room.peers.size < 2) throw new Error("Relay room requires a compatible handshake peer before sending frames.");
      const frame = detachFrame(frameValue);
      const recipients = [...room.peers.values()].filter((candidate) => candidate !== peer && !candidate.closed);
      for (const recipient of recipients) {
        if (recipient.queue.length >= REFERENCE_RELAY_LIMITS.queuedFramesPerPeer) {
          throw new Error(`Relay backpressure queue limit of ${REFERENCE_RELAY_LIMITS.queuedFramesPerPeer} reached.`);
        }
      }
      for (const recipient of recipients) {
        const detached = detachFrame(frame);
        if (recipient.queue.length > 0 || recipient.deliver(detachFrame(detached)) === false) recipient.queue.push(detached);
      }
    }

    function closePeer() {
      if (peer.closed) return;
      peer.closed = true;
      removePeer(room, peer);
    }

    return Object.freeze({
      schemaVersion: 1,
      inviteCode: room.inviteCode,
      peerId: peer.peerId,
      send,
      flush: flushPeer,
      close: closePeer
    });
  }

  function close() {
    if (closed) return;
    closed = true;
    for (const room of rooms.values()) {
      for (const peer of room.peers.values()) {
        peer.closed = true;
        peer.queue.length = 0;
      }
      room.peers.clear();
    }
    rooms.clear();
  }

  return Object.freeze({ schemaVersion: 1, join, close });
}
