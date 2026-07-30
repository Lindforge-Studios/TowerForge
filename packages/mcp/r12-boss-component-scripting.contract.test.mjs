import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateProjectFiles, writeMigratedProjectFiles } from "../cli/lib/project-migrations.mjs";
import { readRawProjectFiles } from "../cli/lib/project-loader.mjs";
import { callTool } from "./tools.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
let projectDir;

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r12-component-script-mcp-"));
  fs.cpSync(STARTER, projectDir, {
    recursive: true,
    filter: (source) => !source.split(path.sep).includes(".towerforge")
  });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);

  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
  balance.missions.tutorial_01.mechanics = { profiles: { enemyBehaviors: "targetable_grunt" } };
  writeJson(balancePath, balance);
  writeJson(path.join(projectDir, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: {
      enemyBehaviors: {
        schemaVersion: 1,
        enabled: true,
        profiles: {
          targetable_grunt: {
            bosses: {
              basic_grunt: {
                components: {
                  core: {
                    maxHp: 10,
                    hitRegion: { kind: "circle", offsetX: 0, offsetY: 0, radius: 0.25 },
                    tags: ["core"]
                  }
                }
              }
            },
            targeting: { towers: { arrow_tower: { priorityTags: ["core"] } } }
          }
        }
      }
    }
  });
  writeJson(path.join(projectDir, "scripts", "gameplay", "r12-component-phase.tower.json"), {
    schemaVersion: 7,
    id: "r12_component_phase",
    bindings: [],
    handlers: {},
    stateMachines: [{
      schemaVersion: 1,
      id: "component_phase",
      bindings: [{ scope: "global" }],
      initial: "intact",
      states: [
        {
          id: "intact",
          transitions: [{
            id: "component_took_damage",
            event: "bossComponentDamaged",
            target: "/damaged",
            when: { $op: "lt", args: [{ $get: "component.hpRatio" }, 1] }
          }]
        },
        {
          id: "damaged",
          entryActions: [{ action: "setState", key: "componentId", value: { $get: "component.id" } }]
        }
      ]
    }]
  });
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe("R12.2 component scripting MCP/AI surface (RED)", () => {
  it("describes component events, schema gates, and HFSM context through describe_schema(scripts)", async () => {
    const described = await callTool("describe_schema", { domain: "scripts" }, {});
    const events = described.towerScript.completion.catalog.events;

    expect(described.towerScript.stateMachines.componentContext).toMatchObject({
      schemaVersion: 1,
      availableForEvents: ["bossComponentDamaged", "bossComponentDestroyed"],
      fields: [
        "schemaVersion", "enemyId", "enemyTypeId", "id", "label", "hp", "maxHp", "hpRatio",
        "destroyed", "tags", "disablesAbilities", "shield"
      ],
      shieldFields: ["current", "capacity", "ratio"]
    });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "bossComponentDamaged", minimumSchemaVersion: 7 }),
      expect.objectContaining({ name: "bossComponentDestroyed", minimumSchemaVersion: 7 })
    ]));
  });

  it("returns component event -> HFSM transition provenance from compute-only preview trace", async () => {
    const before = fs.readFileSync(path.join(projectDir, "content", "mechanics.json"));
    const localStateExistedBefore = fs.existsSync(path.join(projectDir, ".towerforge"));
    const traced = await callTool("preview_tower_script_trace", {
      projectDir,
      missionId: "tutorial_01",
      seed: "r12-component-trace",
      commands: [
        { schemaVersion: 1, type: "placeTower", towerTypeId: "arrow_tower", coord: { q: 5, r: 1 } },
        { schemaVersion: 1, type: "startWave" },
        { schemaVersion: 1, type: "tick", units: 0.01 }
      ],
      stepMode: "transition",
      stepSequence: 0
    }, {});

    const event = traced.trace.entries.find((entry) => (
      entry.phase === "event" && entry.eventName === "bossComponentDamaged"
    ));
    const transition = traced.trace.entries.find((entry) => (
      entry.phase === "transition" && entry.transitionId === "component_took_damage"
    ));
    expect(event).toMatchObject({
      phase: "event",
      eventName: "bossComponentDamaged",
      event: {
        type: "bossComponentDamaged",
        enemyTypeId: "basic_grunt",
        componentId: "core",
        sourceKind: "tower",
        previousHp: 10,
        currentHp: 7,
        maxHp: 10,
        hpDamage: 3
      }
    });
    expect(transition).toMatchObject({
      phase: "transition",
      eventName: "bossComponentDamaged",
      scriptId: "r12_component_phase",
      machineId: "component_phase",
      transitionId: "component_took_damage",
      fromStatePath: "/intact",
      toStatePath: "/damaged",
      parentSequence: event.sequence
    });
    expect(traced.live.snapshot.scriptState.values.r12_component_phase["global:global"])
      .toMatchObject({ componentId: "core" });
    expect(fs.readFileSync(path.join(projectDir, "content", "mechanics.json"))).toEqual(before);
    expect(fs.existsSync(path.join(projectDir, ".towerforge"))).toBe(localStateExistedBefore);
  }, 30_000);
});
