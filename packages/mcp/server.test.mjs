import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { TOWERFORGE_AGENT_INSTRUCTIONS } from "./agent-instructions.mjs";
import { TOOLS } from "./tools.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(dir, "server.mjs");
const STARTER = path.resolve(dir, "../../examples/starter.tdproj");

/** Run one stdio session: write raw NDJSON lines, close stdin, and collect every response frame
 *  (the server exits once stdin closes and in-flight work drains, so no timers are needed). */
function runSession(rawLines) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER, "--project", STARTER]);
    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.on("error", reject);
    child.on("close", () => {
      try {
        resolve(out.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)));
      } catch (error) {
        reject(new Error(`Server emitted a non-JSON stdout frame: ${error.message}\n${out}`));
      }
    });
    child.stdin.write(rawLines.join("\n") + "\n");
    child.stdin.end();
  });
}

function runBrokenStdoutSession() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER, "--project", STARTER]);
    let stderr = "";
    let firstChunkBytes = 0;
    let settled = false;
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      handler(value);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(reject, new Error("MCP broken-stdout session did not terminate within 5 seconds."));
    }, 5_000);

    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.on("error", () => {});
    child.stdout.once("data", (chunk) => {
      firstChunkBytes = chunk.length;
      child.stdout.destroy();
    });
    child.on("error", (error) => finish(reject, error));
    child.on("close", (code, signal) => finish(resolve, { code, signal, stderr, firstChunkBytes }));

    const requests = [
      { jsonrpc: "2.0", id: 21, method: "initialize", params: { protocolVersion: "2024-11-05" } },
      ...Array.from({ length: 8 }, (_, index) => ({
        jsonrpc: "2.0",
        id: 22 + index,
        method: "tools/list"
      }))
    ];
    child.stdin.end(`${requests.map((request) => JSON.stringify(request)).join("\n")}\n`);
  });
}

describe("mcp server JSON-RPC protocol (review fix #7)", () => {
  it("negotiates protocolVersion, answers parse/batch errors with id:null, and never replies to notifications", async () => {
    const frames = await runSession([
      // Unsupported version must be countered with ours, not echoed back.
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "9999-01-01" } }),
      // Non-JSON noise: JSON-RPC says respond with a -32700 parse error, id null.
      "{this is not json",
      // Batch arrays are unsupported: say so instead of silently dropping (a client would hang).
      JSON.stringify([{ jsonrpc: "2.0", id: 2, method: "ping" }]),
      // Notification-form request (no id): must produce NO response frame at all — replying used
      // to emit a malformed id-less frame (JSON.stringify drops the undefined id).
      JSON.stringify({ jsonrpc: "2.0", method: "tools/list" }),
      JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping" })
    ]);

    // Every emitted frame is well-formed: it carries an explicit id (possibly null), never omits it.
    for (const frame of frames) {
      expect(Object.prototype.hasOwnProperty.call(frame, "id"), JSON.stringify(frame)).toBe(true);
    }

    const init = frames.find((f) => f.id === 1);
    expect(init.result.protocolVersion).toBe("2024-11-05"); // negotiated, not echoed
    expect(init.result.instructions).toContain("universal pipeline");
    expect(init.result.instructions).toContain("TowerScript");

    const nullIdErrors = frames.filter((f) => f.id === null);
    expect(nullIdErrors.some((f) => f.error?.code === -32700)).toBe(true); // parse error
    expect(nullIdErrors.some((f) => f.error?.code === -32600)).toBe(true); // batch rejected

    expect(frames.find((f) => f.id === 3)).toBeTruthy(); // ping answered
    // The notification-form tools/list produced nothing: no frame carries a tools listing.
    expect(frames.some((f) => Array.isArray(f.result?.tools))).toBe(false);
    expect(frames).toHaveLength(4); // init + 2 null-id errors + pong, nothing else
  });

  it("echoes a supported protocolVersion back unchanged", async () => {
    const frames = await runSession([
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } })
    ]);
    expect(frames.find((f) => f.id === 1).result.protocolVersion).toBe("2024-11-05");
  });

  it("flushes complete large response frames before exiting after stdin closes", async () => {
    const frames = await runSession([
      JSON.stringify({ jsonrpc: "2.0", id: 11, method: "initialize", params: { protocolVersion: "2024-11-05" } }),
      JSON.stringify({ jsonrpc: "2.0", id: 12, method: "tools/list" })
    ]);

    expect(frames).toHaveLength(2);
    const initialize = frames.find((frame) => frame.id === 11);
    const tools = frames.find((frame) => frame.id === 12);
    const instructions = initialize?.result?.instructions;
    expect(instructions).toBe(TOWERFORGE_AGENT_INSTRUCTIONS);
    expect(instructions).toMatch(/terraforming v1/i);
    expect(instructions).toMatch(/Never expose local paths, credentials/i);
    expect(tools?.result?.tools).toEqual(TOOLS);
    expect(JSON.stringify(tools).length).toBeGreaterThan(8_192);
  });

  it("reports a late stdout EPIPE without an unhandled stream error or stack", async () => {
    const result = await runBrokenStdoutSession();

    expect(result.firstChunkBytes).toBeGreaterThan(0);
    expect(result.signal).toBeNull();
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("TowerForge MCP stdout flush failed:");
    expect(result.stderr).not.toMatch(/Unhandled 'error' event|Emitted 'error' event|node:events|\n\s+at\s/);
  }, 10_000);

  it("recognizes navigation across stdio while preserving the legacy-project migration guard", async () => {
    const frames = await runSession([
      JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "preview_mechanics_module",
          arguments: {
            moduleId: "navigation",
            moduleSchemaVersion: 1,
            profileId: "preview",
            profile: { mode: "authored_routes" }
          }
        }
      })
    ]);
    const result = frames.find((frame) => frame.id === 7)?.result;
    expect(result?.isError).toBe(true);
    expect(result?._meta?.["towerforge/errorCode"]).toBe("project_migration_required");
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: {
        code: "project_migration_required",
        message: expect.stringMatching(/migrate|schema.*v?2/i)
      }
    });
  });
});
