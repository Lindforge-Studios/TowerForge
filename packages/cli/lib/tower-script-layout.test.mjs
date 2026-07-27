import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readTowerScriptLayout,
  resolveTowerScriptLayoutPath,
  restoreTowerScriptLayoutWrite,
  towerScriptGraphRevision,
  validateTowerScriptLayout,
  writeTowerScriptLayoutAtomic
} from "./tower-script-layout.mjs";

const SCRIPT_PATH = "scripts/gameplay/rules.tower.json";
const SCRIPT_SOURCE = `${JSON.stringify({
  schemaVersion: 6,
  id: "rules",
  bindings: [{ scope: "global" }],
  handlers: { tick: [{ actions: [{ action: "incrementState", key: "ticks" }] }] }
}, null, 2)}\n`;
const LAYOUT = {
  schemaVersion: 1,
  nodes: {
    "00:script": { x: 20, y: 30 },
    "10:/handlers/tick/0": { x: 240, y: 30 }
  },
  viewport: { x: 4, y: 8, zoom: 1.25 }
};

let projectDir;

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-layout-"));
  fs.mkdirSync(path.join(projectDir, "scripts", "gameplay"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, ...SCRIPT_PATH.split("/")), SCRIPT_SOURCE);
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe("R6C TowerScript local graph layout codec", () => {
  it("maps one confined script to .towerforge/towerscript-layouts without materializing a read", () => {
    const resolved = resolveTowerScriptLayoutPath(projectDir, SCRIPT_PATH);
    expect(resolved).toBe(path.join(
      projectDir,
      ".towerforge",
      "towerscript-layouts",
      "scripts",
      "gameplay",
      "rules.tower.json.layout.json"
    ));

    const read = readTowerScriptLayout(projectDir, SCRIPT_PATH);
    expect(read).toMatchObject({
      scriptPath: SCRIPT_PATH,
      layout: null,
      layoutRevision: "missing",
      revision: expect.stringMatching(/^[a-f0-9]{20}$/)
    });
    expect(read.revision).toBe(towerScriptGraphRevision(projectDir, SCRIPT_PATH));
    expect(fs.existsSync(path.join(projectDir, ".towerforge"))).toBe(false);
  });

  it("writes canonical detached layout behind the composite script+layout revision", () => {
    const before = readTowerScriptLayout(projectDir, SCRIPT_PATH);
    const written = writeTowerScriptLayoutAtomic(projectDir, SCRIPT_PATH, LAYOUT, {
      ifRevision: before.revision
    });

    expect(written).toMatchObject({
      ok: true,
      written: true,
      previousRevision: before.revision,
      revision: expect.stringMatching(/^[a-f0-9]{20}$/),
      layoutRevision: expect.stringMatching(/^[a-f0-9]{20}$/),
      backup: { existed: false, path: null }
    });
    expect(written.revision).not.toBe(before.revision);
    const read = readTowerScriptLayout(projectDir, SCRIPT_PATH);
    expect(read.layout).toEqual(LAYOUT);
    expect(read.layout).not.toBe(LAYOUT);
    expect(read.revision).toBe(written.revision);

    read.layout.nodes["00:script"].x = 999;
    expect(readTowerScriptLayout(projectDir, SCRIPT_PATH).layout).toEqual(LAYOUT);

    fs.writeFileSync(path.join(projectDir, ...SCRIPT_PATH.split("/")), SCRIPT_SOURCE.replace("ticks", "executions"));
    expect(towerScriptGraphRevision(projectDir, SCRIPT_PATH)).not.toBe(written.revision);
  });

  it("requires the preview revision and rejects a stale composite revision without creating layout bytes", () => {
    expect(() => writeTowerScriptLayoutAtomic(projectDir, SCRIPT_PATH, LAYOUT, {}))
      .toThrow(/revision.*required|ifRevision/i);
    expect(fs.existsSync(path.join(projectDir, ".towerforge"))).toBe(false);

    const preview = readTowerScriptLayout(projectDir, SCRIPT_PATH);
    fs.writeFileSync(path.join(projectDir, ...SCRIPT_PATH.split("/")), `${SCRIPT_SOURCE}\n`);
    const stale = writeTowerScriptLayoutAtomic(projectDir, SCRIPT_PATH, LAYOUT, {
      ifRevision: preview.revision
    });

    expect(stale).toMatchObject({
      ok: false,
      conflict: true,
      written: false,
      expectedRevision: preview.revision,
      actualRevision: expect.stringMatching(/^[a-f0-9]{20}$/)
    });
    expect(fs.existsSync(resolveTowerScriptLayoutPath(projectDir, SCRIPT_PATH))).toBe(false);
  });

  it("backs up an existing layout and restores its exact bytes only behind the written revision", () => {
    const first = writeTowerScriptLayoutAtomic(projectDir, SCRIPT_PATH, LAYOUT, {
      ifRevision: towerScriptGraphRevision(projectDir, SCRIPT_PATH)
    });
    const layoutPath = resolveTowerScriptLayoutPath(projectDir, SCRIPT_PATH);
    const originalBytes = fs.readFileSync(layoutPath);
    const changed = {
      ...LAYOUT,
      nodes: { ...LAYOUT.nodes, "00:script": { x: 500, y: 600 } }
    };
    const second = writeTowerScriptLayoutAtomic(projectDir, SCRIPT_PATH, changed, {
      ifRevision: first.revision
    });

    expect(second).toMatchObject({
      ok: true,
      backup: {
        existed: true,
        path: expect.stringContaining(`${path.sep}.towerforge${path.sep}backups${path.sep}`)
      }
    });
    expect(fs.readFileSync(layoutPath)).not.toEqual(originalBytes);

    const restored = restoreTowerScriptLayoutWrite(projectDir, SCRIPT_PATH, second.backup, {
      ifRevision: second.revision
    });
    expect(restored).toMatchObject({ ok: true, restored: true });
    expect(fs.readFileSync(layoutPath)).toEqual(originalBytes);

    const staleRestore = restoreTowerScriptLayoutWrite(projectDir, SCRIPT_PATH, second.backup, {
      ifRevision: second.revision
    });
    expect(staleRestore).toMatchObject({ ok: false, conflict: true, restored: false });
  });

  it("rejects traversal, absolute/non-script paths, and symlink escapes", () => {
    for (const unsafe of [
      "../rules.tower.json",
      path.join(projectDir, SCRIPT_PATH),
      "scripts/../rules.tower.json",
      "scripts/gameplay/rules.json"
    ]) {
      expect(() => resolveTowerScriptLayoutPath(projectDir, unsafe)).toThrow(/script|path|confined|suffix|escape/i);
    }

    if (process.platform !== "win32") {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-layout-outside-"));
      try {
        fs.symlinkSync(outside, path.join(projectDir, ".towerforge"), "dir");
        expect(() => writeTowerScriptLayoutAtomic(projectDir, SCRIPT_PATH, LAYOUT, {
          ifRevision: towerScriptGraphRevision(projectDir, SCRIPT_PATH)
        })).toThrow(/symbolic|symlink|confined|escape/i);
        expect(fs.readdirSync(outside)).toEqual([]);
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    }
  });

  it("rejects layouts over the byte budget during preview validation", () => {
    const nodes = Object.fromEntries(Array.from({ length: 600 }, (_, index) => [
      `${String(index).padStart(4, "0")}:${"x".repeat(990)}`,
      { x: index, y: index }
    ]));
    expect(() => validateTowerScriptLayout({
      schemaVersion: 1,
      nodes,
      viewport: { x: 0, y: 0, zoom: 1 }
    })).toThrow(/exceeds|bytes|524288/i);
  });

  it("does not read the committed layout to construct its write result", () => {
    const revision = towerScriptGraphRevision(projectDir, SCRIPT_PATH);
    const layoutPath = resolveTowerScriptLayoutPath(projectDir, SCRIPT_PATH);
    const originalRead = fs.readFileSync.bind(fs);
    const readSpy = vi.spyOn(fs, "readFileSync").mockImplementation((file, ...args) => {
      if (path.resolve(String(file)) === layoutPath && fs.existsSync(layoutPath)) {
        throw new Error("injected post-rename layout read failure");
      }
      return originalRead(file, ...args);
    });
    let result;
    try {
      result = writeTowerScriptLayoutAtomic(projectDir, SCRIPT_PATH, LAYOUT, { ifRevision: revision });
    } finally {
      readSpy.mockRestore();
    }

    expect(result).toMatchObject({
      ok: true,
      layoutRevision: expect.stringMatching(/^[a-f0-9]{20}$/),
      revision: expect.stringMatching(/^[a-f0-9]{20}$/)
    });
    expect(fs.existsSync(layoutPath)).toBe(true);
  });

  it("keeps the current layout intact when restoring its backup fails before rename", () => {
    const first = writeTowerScriptLayoutAtomic(projectDir, SCRIPT_PATH, LAYOUT, {
      ifRevision: towerScriptGraphRevision(projectDir, SCRIPT_PATH)
    });
    const changed = { ...LAYOUT, viewport: { x: 99, y: 88, zoom: 2 } };
    const second = writeTowerScriptLayoutAtomic(projectDir, SCRIPT_PATH, changed, {
      ifRevision: first.revision
    });
    const layoutPath = resolveTowerScriptLayoutPath(projectDir, SCRIPT_PATH);
    const currentBytes = fs.readFileSync(layoutPath);
    const originalWrite = fs.writeFileSync.bind(fs);
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation((destination, ...args) => {
      if (String(destination).startsWith(`${layoutPath}.restore.`)) {
        originalWrite(destination, "partial rollback bytes");
        throw new Error("injected rollback write failure");
      }
      return originalWrite(destination, ...args);
    });
    try {
      expect(() => restoreTowerScriptLayoutWrite(projectDir, SCRIPT_PATH, second.backup, {
        ifRevision: second.revision
      })).toThrow(/injected rollback/i);
    } finally {
      writeSpy.mockRestore();
    }
    expect(fs.readFileSync(layoutPath)).toEqual(currentBytes);
    expect(originalWrite).toBeTypeOf("function");
  });
});
