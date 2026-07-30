import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOOLS, callTool } from "./tools.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const SCRIPT_PATH = "scripts/gameplay/starter-gameplay.tower.json";
let projectDir;

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-mcp-dx-"));
  fs.cpSync(STARTER, projectDir, {
    recursive: true,
    filter: (source) => !source.split(path.sep).includes(".towerforge")
  });
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

function tool(name) {
  return TOOLS.find((candidate) => candidate.name === name);
}

function changedGraph(read, amount = 2) {
  const graph = structuredClone(read.graph);
  const action = graph.nodes.find((node) => node.kind === "action");
  if (!action) throw new Error("Fixture graph needs an action node.");
  action.raw.amount = amount;
  return graph;
}

describe("R6 TowerScript DX MCP/AI authoring contract", () => {
  it("publishes graph, debugger, and descriptor-derived completion through describe_schema(scripts)", async () => {
    const schema = await callTool("describe_schema", { domain: "scripts" }, {});

    expect(schema.towerScript.graph).toMatchObject({
      schemaVersion: 2,
      canonicalAst: true,
      unknownNodes: "raw_lossless",
      layoutStorage: ".towerforge/towerscript-layouts"
    });
    expect(schema.towerScript.debug).toMatchObject({
      schemaVersion: 2,
      stepModes: ["tick", "event", "handler", "action", "behavior", "transition"],
      actionStepping: "checkpoint_replay_to_cursor",
      rewind: { bounded: true }
    });
    expect(schema.towerScript.debug.analysis).toMatchObject({
      tool: "preview_tower_script_trace",
      computeOnly: true,
      maxCommands: 128
    });
    expect(schema.towerScript.completion).toMatchObject({
      source: "engine_schema_descriptor",
      catalog: {
        events: expect.arrayContaining([expect.objectContaining({ name: "tick" })]),
        actions: expect.arrayContaining([expect.objectContaining({ name: "incrementState" })]),
        operators: expect.arrayContaining([expect.objectContaining({ name: "eq" })]),
        scopes: expect.arrayContaining([expect.objectContaining({ name: "global" })])
      }
    });
    expect(schema.towerScript.controllerRecipes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "boss_finisher_targeting",
        controller: "behavior_tree",
        schemaVersion: 1,
        parameters: { towerTypeId: "existing attacking tower type id" }
      }),
      expect.objectContaining({
        id: "multi_phase_boss",
        controller: "state_machine",
        schemaVersion: 1,
        parameters: { enemyTypeId: "existing enemy type id" }
      })
    ]));
  });

  it("advertises granular read/preview/apply tools with mandatory guarded write metadata", () => {
    expect(tool("get_tower_script_graph")).toMatchObject({
      riskClass: "read_only",
      sideEffect: "none"
    });
    expect(tool("preview_tower_script_graph")).toMatchObject({
      riskClass: "compute_only",
      sideEffect: "none"
    });
    expect(tool("preview_tower_script_trace")).toMatchObject({
      riskClass: "compute_only",
      sideEffect: expect.stringMatching(/writes no project files/i)
    });
    const apply = tool("apply_tower_script_graph");
    expect(apply).toMatchObject({ riskClass: "write_local" });
    expect(apply.sideEffect).toMatch(/revision|validation|backup|rollback/i);
    expect(apply.inputSchema.required).toEqual(expect.arrayContaining(["path", "graph", "ifRevision"]));
  });

  it("reads a canonical graph and optional local layout without creating editor state", async () => {
    const editorState = path.join(projectDir, ".towerforge");
    expect(fs.existsSync(editorState)).toBe(false);

    const read = await callTool("get_tower_script_graph", {
      projectDir,
      scriptId: "starter_gameplay"
    }, {});

    expect(read).toMatchObject({
      path: SCRIPT_PATH,
      scriptId: "starter_gameplay",
      script: { id: "starter_gameplay" },
      graph: { schemaVersion: 2, scriptId: "starter_gameplay" },
      layout: null,
      revision: expect.stringMatching(/^[a-f0-9]{20}$/)
    });
    expect(fs.existsSync(editorState)).toBe(false);
  });

  it("computes a bounded deterministic trace and historical replay frame without project writes", async () => {
    const projectBefore = fs.readFileSync(path.join(projectDir, "content", "balance.json"));
    const request = {
      projectDir,
      missionId: "tutorial_01",
      seed: "r6-mcp-trace",
      commands: [{ schemaVersion: 1, type: "startWave" }],
      stepMode: "action",
      stepSequence: 0
    };

    const first = await callTool("preview_tower_script_trace", request, {});
    const second = await callTool("preview_tower_script_trace", request, {});

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      ok: true,
      computeOnly: true,
      missionId: "tutorial_01",
      commandCount: 1,
      trace: {
        schemaVersion: 2,
        entries: expect.arrayContaining([expect.objectContaining({
          phase: "action",
          scriptId: "starter_gameplay"
        })])
      },
      frame: {
        mode: "action",
        cursor: { sequence: 0 },
        snapshot: {
          scriptState: {
            values: { starter_gameplay: { "global:global": { wavesStarted: 1 } } }
          }
        }
      },
      live: { stateDigest: expect.stringMatching(/^tf-state-v1:[a-f0-9]+$/) }
    });
    expect(first.frame.stateDigest).toBe(first.live.stateDigest);
    expect(fs.readFileSync(path.join(projectDir, "content", "balance.json"))).toEqual(projectBefore);
    expect(fs.existsSync(path.join(projectDir, ".towerforge"))).toBe(false);

    await expect(callTool("preview_tower_script_trace", {
      projectDir,
      commands: Array.from({ length: 129 }, () => ({ schemaVersion: 1, type: "tick", units: 0.1 }))
    }, {})).rejects.toThrow(/128|command.*limit|too many/i);
  });

  it("previews without writes and applies canonical AST plus optional layout behind the preview revision", async () => {
    const read = await callTool("get_tower_script_graph", {
      projectDir,
      path: SCRIPT_PATH
    }, {});
    const graph = changedGraph(read, 2);
    const nodeId = graph.nodes[0].id;
    const layout = {
      schemaVersion: 1,
      nodes: { [nodeId]: { x: 20, y: 30 } },
      viewport: { x: 0, y: 0, zoom: 1 }
    };
    const sourcePath = path.join(projectDir, ...SCRIPT_PATH.split("/"));
    const before = fs.readFileSync(sourcePath);
    const request = { projectDir, path: SCRIPT_PATH, graph, layout };

    const preview = await callTool("preview_tower_script_graph", request, {});
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      written: false,
      revision: read.revision,
      canonicalAst: {
        handlers: { waveStarted: [{ actions: [{ amount: 2 }] }] }
      },
      validation: { ok: true }
    });
    expect(fs.readFileSync(sourcePath)).toEqual(before);
    expect(fs.existsSync(path.join(projectDir, ".towerforge"))).toBe(false);

    await expect(callTool("apply_tower_script_graph", request, {}))
      .rejects.toThrow(/ifRevision|revision.*required/i);
    expect(fs.readFileSync(sourcePath)).toEqual(before);

    const applied = await callTool("apply_tower_script_graph", {
      ...request,
      ifRevision: preview.revision
    }, {});
    expect(applied).toMatchObject({
      ok: true,
      written: true,
      previousRevision: preview.revision,
      revision: expect.stringMatching(/^[a-f0-9]{20}$/),
      backupCreated: true,
      validation: { ok: true }
    });
    expect(JSON.parse(fs.readFileSync(sourcePath, "utf8"))
      .handlers.waveStarted[0].actions[0].amount).toBe(2);
    const reloaded = await callTool("get_tower_script_graph", {
      projectDir,
      path: SCRIPT_PATH
    }, {});
    expect(reloaded.layout).toEqual(layout);
    expect(reloaded.revision).toBe(applied.revision);
  });

  it("rejects invalid previews and stale apply without changing script or layout bytes", async () => {
    const read = await callTool("get_tower_script_graph", { projectDir, path: SCRIPT_PATH }, {});
    const invalid = structuredClone(read.graph);
    invalid.nodes[1].id = invalid.nodes[0].id;
    const sourcePath = path.join(projectDir, ...SCRIPT_PATH.split("/"));
    const beforeInvalid = fs.readFileSync(sourcePath);

    const invalidPreview = await callTool("preview_tower_script_graph", {
      projectDir,
      path: SCRIPT_PATH,
      graph: invalid
    }, {});
    expect(invalidPreview).toMatchObject({
      ok: false,
      dryRun: true,
      written: false,
      validation: {
        ok: false,
        issues: expect.arrayContaining([expect.objectContaining({ message: expect.stringMatching(/duplicate|node/i) })])
      }
    });
    expect(fs.readFileSync(sourcePath)).toEqual(beforeInvalid);
    expect(fs.existsSync(path.join(projectDir, ".towerforge"))).toBe(false);

    const validGraph = changedGraph(read, 2);
    const preview = await callTool("preview_tower_script_graph", {
      projectDir,
      path: SCRIPT_PATH,
      graph: validGraph
    }, {});
    await callTool("apply_tower_script_graph", {
      projectDir,
      path: SCRIPT_PATH,
      graph: validGraph,
      ifRevision: preview.revision
    }, {});
    const afterFirstApply = fs.readFileSync(sourcePath);

    const stale = await callTool("apply_tower_script_graph", {
      projectDir,
      path: SCRIPT_PATH,
      graph: changedGraph(read, 3),
      ifRevision: preview.revision
    }, {});
    expect(stale).toMatchObject({
      ok: false,
      conflict: true,
      written: false,
      expectedRevision: preview.revision,
      actualRevision: expect.stringMatching(/^[a-f0-9]{20}$/)
    });
    expect(fs.readFileSync(sourcePath)).toEqual(afterFirstApply);
  });

  it("rechecks the composite revision after preview before a no-layout write", async () => {
    const read = await callTool("get_tower_script_graph", { projectDir, path: SCRIPT_PATH }, {});
    const graph = changedGraph(read, 2);
    const preview = await callTool("preview_tower_script_graph", { projectDir, path: SCRIPT_PATH, graph }, {});
    const sourcePath = path.join(projectDir, ...SCRIPT_PATH.split("/"));
    const external = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
    external.description = "concurrent external edit";
    const originalRead = fs.readFileSync.bind(fs);
    let injected = false;
    const readSpy = vi.spyOn(fs, "readFileSync").mockImplementation((file, ...args) => {
      if (!injected && path.resolve(String(file)) === sourcePath && new Error().stack?.includes("scriptFileRevision")) {
        injected = true;
        fs.writeFileSync(sourcePath, `${JSON.stringify(external, null, 2)}\n`);
      }
      return originalRead(file, ...args);
    });
    let applied;
    try {
      applied = await callTool("apply_tower_script_graph", {
        projectDir, path: SCRIPT_PATH, graph, ifRevision: preview.revision
      }, {});
    } finally {
      readSpy.mockRestore();
    }

    expect(injected).toBe(true);
    expect(applied).toMatchObject({
      ok: false,
      conflict: true,
      written: false,
      expectedRevision: preview.revision,
      actualRevision: expect.stringMatching(/^[a-f0-9]{20}$/)
    });
    expect(JSON.parse(fs.readFileSync(sourcePath, "utf8")).description).toBe("concurrent external edit");
  });

  it("rolls a staged local layout back when a concurrent script edit wins the file guard", async () => {
    const read = await callTool("get_tower_script_graph", { projectDir, path: SCRIPT_PATH }, {});
    const graph = changedGraph(read, 2);
    const layout = {
      schemaVersion: 1,
      nodes: { [graph.nodes[0].id]: { x: 20, y: 30 } },
      viewport: { x: 0, y: 0, zoom: 1 }
    };
    const preview = await callTool("preview_tower_script_graph", { projectDir, path: SCRIPT_PATH, graph, layout }, {});
    const sourcePath = path.join(projectDir, ...SCRIPT_PATH.split("/"));
    const layoutPath = path.join(projectDir, ".towerforge", "towerscript-layouts", `${SCRIPT_PATH}.layout.json`);
    const external = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
    external.description = "concurrent edit after layout stage";
    const originalRead = fs.readFileSync.bind(fs);
    let revisionReads = 0;
    const readSpy = vi.spyOn(fs, "readFileSync").mockImplementation((file, ...args) => {
      if (path.resolve(String(file)) === sourcePath && new Error().stack?.includes("scriptFileRevision")) {
        revisionReads += 1;
        if (revisionReads === 2) fs.writeFileSync(sourcePath, `${JSON.stringify(external, null, 2)}\n`);
      }
      return originalRead(file, ...args);
    });
    let applied;
    try {
      applied = await callTool("apply_tower_script_graph", {
        projectDir, path: SCRIPT_PATH, graph, layout, ifRevision: preview.revision
      }, {});
    } finally {
      readSpy.mockRestore();
    }

    expect(revisionReads).toBeGreaterThanOrEqual(2);
    expect(applied).toMatchObject({ ok: false, conflict: true, written: false });
    expect(JSON.parse(fs.readFileSync(sourcePath, "utf8")).description).toBe("concurrent edit after layout stage");
    expect(fs.existsSync(layoutPath)).toBe(false);
  });

  it("rolls a staged local layout back when the script write throws before commit", async () => {
    const read = await callTool("get_tower_script_graph", { projectDir, path: SCRIPT_PATH }, {});
    const graph = changedGraph(read, 2);
    const layout = {
      schemaVersion: 1,
      nodes: { [graph.nodes[0].id]: { x: 12, y: 34 } },
      viewport: { x: 0, y: 0, zoom: 1 }
    };
    const preview = await callTool("preview_tower_script_graph", {
      projectDir, path: SCRIPT_PATH, graph, layout
    }, {});
    const sourcePath = path.join(projectDir, ...SCRIPT_PATH.split("/"));
    const layoutPath = path.join(projectDir, ".towerforge", "towerscript-layouts", `${SCRIPT_PATH}.layout.json`);
    const sourceBefore = fs.readFileSync(sourcePath);
    const originalWrite = fs.writeFileSync.bind(fs);
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation((file, ...args) => {
      if (String(file).startsWith(`${sourcePath}.tmp.`)) throw new Error("injected script write failure");
      return originalWrite(file, ...args);
    });
    try {
      await expect(callTool("apply_tower_script_graph", {
        projectDir, path: SCRIPT_PATH, graph, layout, ifRevision: preview.revision
      }, {})).rejects.toThrow(/injected script write failure/i);
    } finally {
      writeSpy.mockRestore();
    }

    expect(fs.readFileSync(sourcePath)).toEqual(sourceBefore);
    expect(fs.existsSync(layoutPath)).toBe(false);
  });

  it("attempts layout rollback even when the independent script rollback throws", async () => {
    const read = await callTool("get_tower_script_graph", { projectDir, path: SCRIPT_PATH }, {});
    const graph = changedGraph(read, 9);
    const layout = {
      schemaVersion: 1,
      nodes: { [graph.nodes[0].id]: { x: 91, y: 19 } },
      viewport: { x: 0, y: 0, zoom: 1 }
    };
    const preview = await callTool("preview_tower_script_graph", {
      projectDir, path: SCRIPT_PATH, graph, layout
    }, {});
    const sourcePath = path.join(projectDir, ...SCRIPT_PATH.split("/"));
    const layoutPath = path.join(projectDir, ".towerforge", "towerscript-layouts", `${SCRIPT_PATH}.layout.json`);
    const originalRead = fs.readFileSync.bind(fs);
    const originalWrite = fs.writeFileSync.bind(fs);
    let validationFailureInjected = false;
    let rollbackFailureInjected = false;
    const readSpy = vi.spyOn(fs, "readFileSync").mockImplementation((file, ...args) => {
      if (!validationFailureInjected && path.resolve(String(file)) === sourcePath && fs.existsSync(layoutPath)) {
        const value = originalRead(file, ...args);
        if (String(value).includes('"amount": 9')) {
          validationFailureInjected = true;
          throw new Error("injected post-write validation read failure");
        }
        return value;
      }
      return originalRead(file, ...args);
    });
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation((destination, ...args) => {
      if (!rollbackFailureInjected && String(destination).startsWith(`${sourcePath}.restore.`)) {
        rollbackFailureInjected = true;
        throw new Error("injected script rollback write failure");
      }
      return originalWrite(destination, ...args);
    });
    let result;
    try {
      result = await callTool("apply_tower_script_graph", {
        projectDir, path: SCRIPT_PATH, graph, layout, ifRevision: preview.revision
      }, {});
    } finally {
      writeSpy.mockRestore();
      readSpy.mockRestore();
    }

    expect(validationFailureInjected).toBe(true);
    expect(rollbackFailureInjected).toBe(true);
    expect(result).toMatchObject({
      ok: false,
      written: false,
      rolledBack: false,
      rollbackFailures: [expect.objectContaining({ target: "script", error: expect.stringMatching(/rollback write failure/i) })]
    });
    expect(fs.existsSync(layoutPath)).toBe(false);
  });

  it("rejects an oversized local layout during preview instead of deferring the same error to apply", async () => {
    const read = await callTool("get_tower_script_graph", { projectDir, path: SCRIPT_PATH }, {});
    const nodes = Object.fromEntries(Array.from({ length: 600 }, (_, index) => [
      `${String(index).padStart(4, "0")}:${"x".repeat(990)}`,
      { x: index, y: index }
    ]));
    const preview = await callTool("preview_tower_script_graph", {
      projectDir,
      path: SCRIPT_PATH,
      graph: read.graph,
      layout: { schemaVersion: 1, nodes, viewport: { x: 0, y: 0, zoom: 1 } }
    }, {});

    expect(preview).toMatchObject({
      ok: false,
      written: false,
      validation: {
        ok: false,
        issues: expect.arrayContaining([expect.objectContaining({ message: expect.stringMatching(/exceeds|bytes|524288/i) })])
      }
    });
    expect(fs.existsSync(path.join(projectDir, ".towerforge"))).toBe(false);
  });

  it("supports the complete AI describe/read/preview/guarded-apply/validate/trace flow for schema v7", async () => {
    const described = await callTool("describe_schema", { domain: "scripts" }, {});
    expect(described.towerScript).toMatchObject({
      schemaVersion: 7,
      behaviorTrees: { schemaVersion: 1 },
      stateMachines: { schemaVersion: 1 },
      graph: { schemaVersion: 2 },
      debug: { schemaVersion: 2 }
    });
    const summary = await callTool("get_project_summary", { projectDir }, {});
    const scriptPath = "scripts/gameplay/r9-dx3.tower.json";
    const script = {
      schemaVersion: 7,
      id: "r9_dx3",
      bindings: [],
      handlers: {},
      behaviorTrees: [{
        schemaVersion: 1,
        id: "weakest",
        bindings: [{ scope: "tower", ids: ["arrow_tower"] }],
        root: { id: "select", type: "action", action: "select_targets", mode: "weakest" }
      }],
      stateMachines: [{
        schemaVersion: 1,
        id: "encounter",
        bindings: [{ scope: "global" }],
        initial: "waiting",
        states: [
          { id: "waiting", transitions: [{ id: "begin", event: "waveStarted", target: "/combat" }] },
          { id: "combat", entryActions: [{ action: "setState", key: "phase", value: "combat" }] }
        ]
      }]
    };
    const upsertPreview = await callTool("upsert_tower_script", {
      projectDir,
      path: scriptPath,
      script,
      dryRun: true,
      ifRevision: summary.revisions.scripts
    }, {});
    expect(upsertPreview).toMatchObject({ ok: true, dryRun: true, written: false });
    const upsert = await callTool("upsert_tower_script", {
      projectDir,
      path: scriptPath,
      script,
      ifRevision: upsertPreview.revision
    }, {});
    expect(upsert).toMatchObject({ ok: true, written: true });

    const read = await callTool("get_tower_script_graph", { projectDir, scriptId: "r9_dx3" }, {});
    expect(read).toMatchObject({
      graph: {
        schemaVersion: 2,
        nodes: expect.arrayContaining([
          expect.objectContaining({ kind: "behavior_tree" }),
          expect.objectContaining({ kind: "state_machine" }),
          expect.objectContaining({ kind: "transition" })
        ])
      },
      nodeCatalog: { schemaVersion: 2 }
    });
    const graphPreview = await callTool("preview_tower_script_graph", {
      projectDir,
      path: scriptPath,
      graph: read.graph,
      ifRevision: read.revision
    }, {});
    expect(graphPreview).toMatchObject({ ok: true, dryRun: true, written: false });
    const applied = await callTool("apply_tower_script_graph", {
      projectDir,
      path: scriptPath,
      graph: read.graph,
      ifRevision: graphPreview.revision
    }, {});
    expect(applied).toMatchObject({ ok: true, written: true });
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true });

    const traced = await callTool("preview_tower_script_trace", {
      projectDir,
      missionId: "tutorial_01",
      seed: "r9-mcp",
      commands: [{ schemaVersion: 1, type: "startWave" }],
      stepMode: "transition",
      stepSequence: 0
    }, {});
    expect(traced).toMatchObject({
      trace: { schemaVersion: 2, entries: expect.arrayContaining([expect.objectContaining({ phase: "transition" })]) },
      frame: {
        schemaVersion: 2,
        mode: "transition",
        traceEntry: { transitionId: "begin", toStatePath: "/combat" }
      }
    });
  });
});
