#!/usr/bin/env node
/**
 * TowerForge AI MCP server.
 *
 * A zero-dependency Model Context Protocol server (JSON-RPC 2.0 over newline-delimited stdio)
 * that exposes the .tdproj constructor toolset — validate, simulate, compile maps, build, inspect,
 * and patch balance — to any MCP-capable AI agent.
 *
 * Usage:
 *   node server.mjs [--project <path>]
 *   PROJECT_DIR=<path> node server.mjs
 *
 * IMPORTANT: stdout is the protocol channel — only JSON-RPC messages are written there.
 * Diagnostics go to stderr.
 */
import process from "node:process";
import readline from "node:readline";
import { resolveProjectDir } from "../cli/lib/project-loader.mjs";
import { TOOLS, callTool } from "./tools.mjs";
import { TOWERFORGE_AGENT_INSTRUCTIONS } from "./agent-instructions.mjs";
import { TOWERFORGE_MCP_PROTOCOL_VERSION, TOWERFORGE_MCP_SERVER_VERSION } from "./protocol.mjs";
import {
  assertProjectWithinRoots,
  createWorkspaceSession,
  sanitizeWorkspaceResult,
  workspaceToolDefinitions
} from "./workspace-session.mjs";

const PROTOCOL_VERSION = TOWERFORGE_MCP_PROTOCOL_VERSION;
// Version NEGOTIATION, not echo: we only implement 2024-11-05 semantics, so claiming whatever
// string the client sent (e.g. a newer version with batching) would make it use features we
// silently drop. Unsupported requested versions get countered with ours, per the MCP spec.
const SUPPORTED_PROTOCOL_VERSIONS = new Set([PROTOCOL_VERSION]);
const SERVER_INFO = { name: "towerforge-ai", version: TOWERFORGE_MCP_SERVER_VERSION };
const WORKSPACE_BOUND = process.env.TOWERFORGE_MCP_WORKSPACE_BOUND === "1";
const defaultProjectDir = WORKSPACE_BOUND ? null : resolveProjectDir(null, process.argv.slice(2));
const workspaceSession = createWorkspaceSession();
const exposedTools = WORKSPACE_BOUND ? workspaceToolDefinitions(TOOLS) : TOOLS;
const PROJECT_FREE_TOOLS = new Set(["describe_schema", "list_recipes", "list_theme_packs", "list_tile_presets", "explain_validation"]);
const clientRequests = new Map();
let nextClientRequestId = 1;
let clientSupportsRoots = false;

let outputQueue = Promise.resolve();
let stdoutFailure;
const stdoutFailureWaiters = new Set();

function recordStdoutFailure(error) {
  if (stdoutFailure !== undefined) return stdoutFailure;
  stdoutFailure = error instanceof Error ? error : new Error(String(error));
  process.exitCode = 1;
  process.stderr.write(`TowerForge MCP stdout flush failed: ${stdoutFailure.message}\n`);
  for (const reject of stdoutFailureWaiters) reject(stdoutFailure);
  stdoutFailureWaiters.clear();
  return stdoutFailure;
}

// stdout may emit EPIPE after an individual write callback has already run. Keep one listener for
// the protocol channel's whole lifetime; per-write listeners leave a gap where that late event
// would otherwise become an uncaught EventEmitter error.
process.stdout.on("error", recordStdoutFailure);

function writeOutputFrame(frame) {
  return new Promise((resolve, reject) => {
    if (stdoutFailure !== undefined) {
      reject(stdoutFailure);
      return;
    }
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      stdoutFailureWaiters.delete(fail);
      reject(error);
    };
    stdoutFailureWaiters.add(fail);
    try {
      process.stdout.write(frame, (error) => {
        if (settled) return;
        if (error) {
          const failure = recordStdoutFailure(error);
          fail(failure);
          return;
        }
        settled = true;
        stdoutFailureWaiters.delete(fail);
        resolve();
      });
    } catch (error) {
      const failure = recordStdoutFailure(error);
      fail(failure);
    }
  });
}

function finishStdout() {
  return new Promise((resolve, reject) => {
    if (stdoutFailure !== undefined) {
      reject(stdoutFailure);
      return;
    }
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      stdoutFailureWaiters.delete(fail);
      reject(error);
    };
    stdoutFailureWaiters.add(fail);
    try {
      process.stdout.end(() => {
        if (settled) return;
        settled = true;
        stdoutFailureWaiters.delete(fail);
        if (stdoutFailure !== undefined) reject(stdoutFailure);
        else resolve();
      });
    } catch (error) {
      const failure = recordStdoutFailure(error);
      fail(failure);
    }
  });
}

function send(message) {
  const frame = `${JSON.stringify(message)}\n`;
  outputQueue = outputQueue.then(() => writeOutputFrame(frame));
  // Keep a rejection observable by the shutdown path without letting Node treat the queued
  // protocol write as an unhandled rejection before stdin closes.
  void outputQueue.catch(() => {});
  return outputQueue;
}
function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}
function replyError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function requestClient(method, params = {}) {
  const id = `towerforge-${nextClientRequestId++}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      clientRequests.delete(id);
      reject(new Error(`Client request timed out: ${method}`));
    }, 5_000);
    timeout.unref?.();
    clientRequests.set(id, { resolve, reject, timeout });
    send({ jsonrpc: "2.0", id, method, params });
  });
}

async function refreshWorkspaceRoots() {
  if (!WORKSPACE_BOUND || !clientSupportsRoots) return;
  try {
    const result = await requestClient("roots/list");
    workspaceSession.updateRoots(result?.roots);
  } catch {
    workspaceSession.updateRoots([]);
  }
}

function toolResultContent(result) {
  const image = result?.contactSheet?.data && result.contactSheet.mimeType
    ? { type: "image", data: result.contactSheet.data, mimeType: result.contactSheet.mimeType }
    : null;
  if (!image) return [{ type: "text", text: JSON.stringify(result, null, 2) }];
  const textResult = {
    ...result,
    contactSheet: { ...result.contactSheet }
  };
  delete textResult.contactSheet.data;
  return [{ type: "text", text: JSON.stringify(textResult, null, 2) }, image];
}

function workspaceSanitize(value) {
  if (!WORKSPACE_BOUND) return value;
  return sanitizeWorkspaceResult(value, {
    projectDir: workspaceSession.selectedProjectDir,
    roots: workspaceSession.allowedRoots,
    sensitiveRoots: [process.cwd()]
  });
}

async function handleMessage(message) {
  // JSON-RPC batch arrays and non-object frames aren't supported — say so instead of silently
  // dropping them (a client that thinks batching works would otherwise hang forever on the reply).
  if (Array.isArray(message)) {
    replyError(null, -32600, "Batch requests are not supported by this server.");
    return;
  }
  if (!message || typeof message !== "object") {
    replyError(null, -32600, "Invalid request: expected a JSON-RPC object.");
    return;
  }

  const { id, method, params } = message;
  // A frame without an id is a NOTIFICATION: it must never get a response. Replying anyway would
  // emit a malformed id-less result frame (JSON.stringify drops the undefined id).
  const isRequest = id !== undefined && id !== null;

  if (method === undefined && isRequest && clientRequests.has(id)) {
    const request = clientRequests.get(id);
    clientRequests.delete(id);
    clearTimeout(request.timeout);
    if (message.error) request.reject(new Error(message.error.message ?? "Client request failed."));
    else request.resolve(message.result);
    return;
  }

  switch (method) {
    case "initialize":
      if (isRequest) {
        const requested = params?.protocolVersion;
        clientSupportsRoots = Boolean(params?.capabilities?.roots);
        reply(id, {
          protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.has(requested) ? requested : PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions: TOWERFORGE_AGENT_INSTRUCTIONS
        });
      }
      return;

    case "notifications/initialized":
    case "initialized":
      void refreshWorkspaceRoots();
      return; // notification, no response

    case "notifications/roots/list_changed":
      void refreshWorkspaceRoots();
      return;

    case "ping":
      if (isRequest) reply(id, {});
      return;

    case "tools/list":
      if (isRequest) reply(id, { tools: exposedTools });
      return;

    case "tools/call": {
      const name = params?.name;
      const args = params?.arguments ?? {};
      try {
        let result;
        if (WORKSPACE_BOUND && name === "list_workspace_projects") {
          result = workspaceSession.summary();
        } else if (WORKSPACE_BOUND && name === "select_workspace_project") {
          if (!args || typeof args !== "object" || Object.keys(args).some((key) => key !== "projectId")) {
            throw new Error("select_workspace_project accepts only projectId.");
          }
          result = workspaceSession.select(args.projectId);
        } else {
          const activeProjectDir = WORKSPACE_BOUND && !PROJECT_FREE_TOOLS.has(name)
            ? assertProjectWithinRoots(workspaceSession.selectedProjectDir, workspaceSession.allowedRoots)
            : (WORKSPACE_BOUND ? workspaceSession.selectedProjectDir : defaultProjectDir);
          result = await callTool(name, args, {
            defaultProjectDir: activeProjectDir,
            forceDefaultProject: WORKSPACE_BOUND,
            allowedProjectRoots: WORKSPACE_BOUND ? workspaceSession.allowedRoots : undefined
          });
        }
        if (isRequest) reply(id, { content: toolResultContent(workspaceSanitize(result)) });
      } catch (error) {
        const message = workspaceSanitize(String(error?.message ?? error));
        const errorCode = typeof error?.code === "string" ? error.code : undefined;
        const text = errorCode
          ? JSON.stringify({ error: { code: errorCode, message } })
          : message;
        if (isRequest) reply(id, {
          content: [{ type: "text", text }],
          isError: true,
          ...(errorCode ? { _meta: { "towerforge/errorCode": errorCode } } : {})
        });
      }
      return;
    }

    default:
      if (isRequest) replyError(id, -32601, `Method not found: ${method}`);
  }
}

let stdinClosed = false;
const pending = new Set();
let shutdownStarted = false;

function drainAndExit() {
  if (!stdinClosed || pending.size !== 0 || shutdownStarted) return;
  shutdownStarted = true;
  void outputQueue
    .then(() => finishStdout())
    .then(() => {
      if (stdoutFailure === undefined) process.exitCode = 0;
    })
    .catch((error) => {
      recordStdoutFailure(error);
      process.stdout.destroy();
    });
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const text = line.trim();
  if (!text) return;
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    replyError(null, -32700, "Parse error: invalid JSON."); // per JSON-RPC: id null on parse errors
    return;
  }
  const task = handleMessage(message)
    .catch((error) => {
      if (message && message.id !== undefined && message.id !== null) {
        replyError(message.id, -32603, String(error?.message ?? error));
      }
    })
    .finally(() => {
      pending.delete(task);
      drainAndExit();
    });
  pending.add(task);
});
rl.on("close", () => {
  stdinClosed = true;
  drainAndExit();
});

if (WORKSPACE_BOUND) {
  process.stderr.write(`TowerForge MCP ready in workspace-bound mode (${exposedTools.length} tools).\n`);
} else {
  process.stderr.write(`TowerForge AI MCP server ready.\n  Project: ${defaultProjectDir}\n  Tools: ${TOOLS.map((t) => t.name).join(", ")}\n`);
}
