import { createReferenceRelayV1 } from "./relay.mjs";

export const REFERENCE_RELAY_SERVER_DESCRIPTOR = Object.freeze({
  schemaVersion: 1,
  defaultHost: "127.0.0.1",
  accounts: false,
  matchmaking: false,
  gameplayLogic: false
});

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

function socketOn(socket, name, listener) {
  if (!socket || typeof socket.on !== "function") throw new Error("Injected relay sockets must implement on().");
  socket.on(name, listener);
}

export function createReferenceRelayServerV1(options) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("Reference relay server options are required.");
  }
  const server = options.server;
  const host = options.host ?? REFERENCE_RELAY_SERVER_DESCRIPTOR.defaultHost;
  if (!LOOPBACK_HOSTS.has(host)) throw new Error("Reference relay server host must be loopback-only.");
  if (!server || typeof server.on !== "function" || typeof server.close !== "function") {
    throw new Error("An injected server with on() and close() is required.");
  }
  const relay = options.relay ?? createReferenceRelayV1();
  let closed = false;

  function connectionListener(socket) {
    let peer;
    const messageListener = (message) => {
      if (!peer) {
        if (!message || typeof message !== "object" || message.kind !== "handshake") {
          throw new Error("Relay capability handshake is required before frames.");
        }
        peer = relay.join({
          inviteCode: message.inviteCode,
          peerId: message.peerId,
          handshake: message.handshake,
          deliver(frame) {
            if (typeof socket.send !== "function") return false;
            return socket.send({ kind: "frame", frame }) !== false;
          }
        });
        return;
      }
      if (!message || typeof message !== "object" || message.kind !== "frame") {
        throw new Error("Relay accepts only opaque frames after handshake.");
      }
      peer.send(message.frame);
    };
    const closeListener = () => peer?.close();
    socketOn(socket, "message", messageListener);
    socketOn(socket, "close", closeListener);
  }

  server.on("connection", connectionListener);

  function close() {
    if (closed) return;
    closed = true;
    if (typeof server.off === "function") server.off("connection", connectionListener);
    relay.close();
    server.close();
  }

  return Object.freeze({ schemaVersion: 1, host, close });
}
