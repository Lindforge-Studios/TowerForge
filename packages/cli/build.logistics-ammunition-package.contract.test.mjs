import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createProject, TEMPLATE_NAMES } from "./lib/create-project.mjs";
import { packageWeb } from "./lib/packaging.mjs";
import { exportProjectPack, inspectProjectPack } from "./lib/project-pack.mjs";

const repoRoot = path.resolve(".");
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("R5.8A ammunition build/package RED", () => {
  it("preserves exact opt-in v2 ammunition through PWA, single-file, web package, and tdpack", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r58a-ammo-package-"));
    roots.push(root);
    const { projectDir } = createProject({
      name: "ammo_square_phaser", parentDir: root, templateName: "classic", gridKind: "square"
    });
    setRenderer(projectDir, "ammo", "phaser");
    const mechanics = enableAmmunition(projectDir);
    const built = JSON.parse(execFileSync(process.execPath, [
      path.join(repoRoot, "packages", "cli", "build.mjs"),
      "--project", projectDir,
      "--target", "ammo",
      "--single-file",
      "--json"
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
    }));

    for (const relativePath of [
      "manifest.webmanifest", "offline-sw.js", "project-data.js",
      "renderer/logistics-power-presentation.mjs", "index.single.html"
    ]) expect(fs.existsSync(path.join(built.outDir, relativePath)), `missing ${relativePath}`).toBe(true);
    const projectModule = await import(
      `${pathToFileURL(path.join(built.outDir, "project-data.js")).href}?ammo=${Date.now()}`
    );
    expect(projectModule.default.mechanics).toEqual(mechanics);
    const inline = inlineJavaScriptModules(fs.readFileSync(path.join(built.outDir, "index.single.html"), "utf8"));
    expect(inline.some((source) => source.includes("projectLogisticsPresentation"))).toBe(true);
    expect(inline.some((source) => source.includes('"towerInventories"') && source.includes('"startingAmount"')))
      .toBe(true);

    const packPath = path.join(projectDir, ".towerforge", "exports", "ammunition.tdpack");
    expect((await exportProjectPack(projectDir, packPath)).ok).toBe(true);
    expect(readJsonEntry(inspectProjectPack(packPath), "content/mechanics.json")).toEqual(mechanics);

    const portable = await packageWeb(projectDir, { targetId: "ammo", outDir: "web-ammunition" });
    expect(portable).toMatchObject({ ok: true, kind: "web", webTargetId: "ammo" });
    const packagedProject = await import(
      `${pathToFileURL(path.join(portable.outDir, "game", "project-data.js")).href}?package=${Date.now()}`
    );
    expect(packagedProject.default.mechanics).toEqual(mechanics);
    expect(fs.readFileSync(portable.archive.outputPath).includes(Buffer.from("basic_local_ammunition"))).toBe(true);
  }, 120_000);

  it("keeps all four untouched templates on hex/square free of synthesized ammunition", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r58a-ammo-legacy-"));
    roots.push(root);
    for (const templateName of TEMPLATE_NAMES) {
      for (const gridKind of ["hex", "square"]) {
        const { projectDir } = createProject({
          name: `${templateName}_${gridKind}_legacy`, parentDir: root, templateName, gridKind
        });
        const manifestBefore = fs.readFileSync(path.join(projectDir, "project.json"), "utf8");
        expect(fs.existsSync(path.join(projectDir, "content", "mechanics.json"))).toBe(false);
        const packPath = path.join(projectDir, ".towerforge", "exports", "legacy.tdpack");
        expect((await exportProjectPack(projectDir, packPath)).ok).toBe(true);
        expect(inspectProjectPack(packPath).entries.some((entry) => entry.path === "content/mechanics.json"))
          .toBe(false);
        expect(fs.readFileSync(path.join(projectDir, "project.json"), "utf8")).toBe(manifestBefore);
      }
    }
  }, 120_000);

  it("keeps the public plugin runtime byte-aligned with source after ammunition support", () => {
    const pairs = [
      ["packages/mcp/agent-instructions.mjs", "plugins/towerforge/runtime/packages/mcp/agent-instructions.mjs"],
      ["packages/mcp/tools.mjs", "plugins/towerforge/runtime/packages/mcp/tools.mjs"],
      [
        "packages/renderer/src/logistics-power-presentation.mjs",
        "plugins/towerforge/runtime/packages/renderer/src/logistics-power-presentation.mjs"
      ]
    ];
    for (const [sourcePath, runtimePath] of pairs) {
      const source = fs.readFileSync(path.resolve(sourcePath), "utf8");
      const runtime = fs.readFileSync(path.resolve(runtimePath), "utf8");
      expect(runtime).toBe(source);
    }
    expect(fs.readFileSync(path.resolve(pairs[2][1]), "utf8")).toMatch(/ammunition[\s\S]*inventories/);
    expect(fs.readFileSync(
      path.resolve("plugins/towerforge/skills/towerforge-authoring/SKILL.md"), "utf8"
    )).toContain("basic_local_ammunition");
  });
});

function enableAmmunition(projectDir) {
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);
  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = readJson(balancePath);
  const missionId = balance.defaultMissionId ?? Object.keys(balance.missions)[0];
  balance.missions[missionId].mechanics = { profiles: { logistics: "basic_local_ammunition" } };
  writeJson(balancePath, balance);
  const mechanics = {
    schemaVersion: 1,
    modules: {
      logistics: {
        schemaVersion: 2,
        enabled: true,
        profiles: {
          basic_local_ammunition: {
            power: null,
            ammunition: {
              types: { shell: { label: "Shell" } },
              towerInventories: {
                cannon: {
                  ammoTypeId: "shell", capacity: 30, startingAmount: 12, consumptionPerActivation: 1
                }
              }
            }
          }
        }
      }
    }
  };
  writeJson(path.join(projectDir, "content", "mechanics.json"), mechanics);
  return mechanics;
}

function setRenderer(projectDir, targetId, renderer) {
  const targetsPath = path.join(projectDir, "build-targets.json");
  const targets = readJson(targetsPath);
  targets.targets[targetId] = {
    ...targets.targets["web-pwa"], id: targetId, renderer, webDir: "dist"
  };
  writeJson(targetsPath, targets);
}

function readJsonEntry(pack, entryPath) {
  const entry = pack.entries.find((candidate) => candidate.path === entryPath);
  expect(entry, `tdpack is missing ${entryPath}`).toBeTruthy();
  return JSON.parse(entry.bytes.toString("utf8"));
}

function inlineJavaScriptModules(html) {
  return [...html.matchAll(/data:text\/javascript;base64,([A-Za-z0-9+/=]+)/g)]
    .map((match) => Buffer.from(match[1], "base64").toString("utf8"));
}

function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
function writeJson(filePath, value) { fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
