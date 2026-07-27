import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseTowerScriptSource,
  readTowerScriptFiles,
  resolveTowerScriptPath,
  scriptFileRevision,
  writeTowerScriptAtomic
} from "./project-scripts.mjs";
import { createScriptDirectory, deleteScriptEntry, listProjectTree, readProjectTextFile, renameScriptEntry } from "./project-tree.mjs";

let projectDir;

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-scripts-"));
  fs.writeFileSync(path.join(projectDir, "project.json"), "{}\n");
  fs.mkdirSync(path.join(projectDir, "scripts"));
});
afterEach(() => fs.rmSync(projectDir, { recursive: true, force: true }));

const source = JSON.stringify({
  schemaVersion: 1,
  id: "rules",
  bindings: [{ scope: "global" }],
  handlers: { waveStarted: [{ actions: [{ action: "incrementState", key: "waves" }] }] }
});

describe("TowerScript project files", () => {
  it("reads nested scripts and guards writes with a file revision", () => {
    createScriptDirectory(projectDir, "scripts/gameplay");
    const first = writeTowerScriptAtomic(projectDir, "scripts/gameplay/rules.tower.json", source, { ifRevision: "missing" });
    expect(first).toMatchObject({ ok: true, previousRevision: "missing" });
    expect(writeTowerScriptAtomic(projectDir, "scripts/gameplay/rules.tower.json", source, { ifRevision: "stale" })).toMatchObject({ ok: false, conflict: true });
    const catalog = readTowerScriptFiles(projectDir);
    expect(catalog.scripts.rules.id).toBe("rules");
    expect(catalog.files["scripts/gameplay/rules.tower.json"].source).toContain('"rules"');
    expect(scriptFileRevision(resolveTowerScriptPath(projectDir, "scripts/gameplay/rules.tower.json", { mustExist: true }))).toBe(first.revision);
  });

  it("does not perform a fallible revision read after committing a script rename", () => {
    const scriptPath = "scripts/rules.tower.json";
    writeTowerScriptAtomic(projectDir, scriptPath, source, { ifRevision: "missing" });
    const absolutePath = resolveTowerScriptPath(projectDir, scriptPath, { mustExist: true });
    const changed = JSON.stringify({
      ...JSON.parse(source),
      description: "committed without a post-rename read"
    });
    const originalRead = fs.readFileSync.bind(fs);
    let revisionReads = 0;
    const readSpy = vi.spyOn(fs, "readFileSync").mockImplementation((file, ...args) => {
      if (path.resolve(String(file)) === absolutePath && new Error().stack?.includes("scriptFileRevision")) {
        revisionReads += 1;
        if (revisionReads > 1) throw new Error("injected post-rename revision read failure");
      }
      return originalRead(file, ...args);
    });
    let result;
    try {
      result = writeTowerScriptAtomic(projectDir, scriptPath, changed);
    } finally {
      readSpy.mockRestore();
    }

    expect(result).toMatchObject({ ok: true, revision: expect.stringMatching(/^[a-f0-9]{20}$/) });
    expect(revisionReads).toBe(1);
    expect(JSON.parse(fs.readFileSync(absolutePath, "utf8")).description).toBe("committed without a post-rename read");
    expect(scriptFileRevision(absolutePath)).toBe(result.revision);
  });

  it("rejects traversal, malformed JSON, and non-script suffixes", () => {
    expect(() => resolveTowerScriptPath(projectDir, "../outside.tower.json")).toThrow(/scripts/);
    expect(() => resolveTowerScriptPath(projectDir, "scripts/rules.js")).toThrow(/\.tower\.json/);
    expect(() => parseTowerScriptSource("{broken")).toThrow(/Invalid TowerScript JSON/);
  });

  it("lists the full tree but confines management to scripts", () => {
    fs.mkdirSync(path.join(projectDir, "content"));
    fs.writeFileSync(path.join(projectDir, "content", "balance.json"), "{}\n");
    fs.mkdirSync(path.join(projectDir, "dist"));
    fs.mkdirSync(path.join(projectDir, "mobile"));
    writeTowerScriptAtomic(projectDir, "scripts/rules.tower.json", source);
    const tree = listProjectTree(projectDir);
    expect(tree.nodes.find((node) => node.name === "content")?.manageable).toBe(false);
    expect(tree.nodes.some((node) => ["dist", "mobile"].includes(node.name))).toBe(false);
    expect(readProjectTextFile(projectDir, "scripts/rules.tower.json")).toMatchObject({ editable: true });
    expect(() => deleteScriptEntry(projectDir, "content/balance.json")).toThrow(/confined/);
    expect(renameScriptEntry(projectDir, "scripts/rules.tower.json", "scripts/game-rules.tower.json")).toMatchObject({ ok: true });
    expect(deleteScriptEntry(projectDir, "scripts/game-rules.tower.json")).toMatchObject({ ok: true });
  });

  it("stops scanning an excessively deep script tree", () => {
    const deep = path.join(projectDir, "scripts", ...Array.from({ length: 34 }, (_, index) => `level-${index}`));
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(deep, "rules.tower.json"), source);
    const catalog = readTowerScriptFiles(projectDir);
    expect(catalog.issues).toContainEqual(expect.objectContaining({ message: expect.stringContaining("levels deep") }));
    expect(catalog.scripts).toEqual({});
  });
});
