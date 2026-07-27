import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createProject } from "./lib/create-project.mjs";
import { packageWeb } from "./lib/packaging.mjs";
import { exportProjectPack, inspectProjectPack } from "./lib/project-pack.mjs";

const repoRoot = path.resolve(".");
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("R5.8B ammunition supply build/package RED", () => {
  it("preserves exact opt-in v3 supply through PWA, single-file, web package, and tdpack", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r58b-supply-package-"));
    roots.push(root);
    const { projectDir } = createProject({
      name: "supply_square_phaser", parentDir: root, templateName: "classic", gridKind: "square"
    });
    setRenderer(projectDir, "supply", "phaser");
    const mechanics = enableSupply(projectDir);
    const built = JSON.parse(execFileSync(process.execPath, [
      path.join(repoRoot, "packages", "cli", "build.mjs"),
      "--project", projectDir, "--target", "supply", "--single-file", "--json"
    ], {
      cwd: repoRoot, encoding: "utf8", env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
    }));
    for (const relativePath of [
      "manifest.webmanifest", "offline-sw.js", "project-data.js",
      "renderer/logistics-power-presentation.mjs", "index.single.html"
    ]) expect(fs.existsSync(path.join(built.outDir, relativePath)), `missing ${relativePath}`).toBe(true);
    const projectModule = await import(
      `${pathToFileURL(path.join(built.outDir, "project-data.js")).href}?supply=${Date.now()}`
    );
    expect(projectModule.default.mechanics).toEqual(mechanics);
    const inline = inlineJavaScriptModules(fs.readFileSync(path.join(built.outDir, "index.single.html"), "utf8"));
    expect(inline.some((source) => source.includes("projectLogisticsPresentation"))).toBe(true);
    expect(inline.some((source) => (
      source.includes('"productionRecipes"') && source.includes('"transferInterval"')
    ))).toBe(true);

    const packPath = path.join(projectDir, ".towerforge", "exports", "supply.tdpack");
    expect((await exportProjectPack(projectDir, packPath)).ok).toBe(true);
    expect(readJsonEntry(inspectProjectPack(packPath), "content/mechanics.json")).toEqual(mechanics);
    const portable = await packageWeb(projectDir, { targetId: "supply", outDir: "web-supply" });
    expect(portable).toMatchObject({ ok: true, kind: "web", webTargetId: "supply" });
    const packagedProject = await import(
      `${pathToFileURL(path.join(portable.outDir, "game", "project-data.js")).href}?package=${Date.now()}`
    );
    expect(packagedProject.default.mechanics).toEqual(mechanics);
    expect(fs.readFileSync(portable.archive.outputPath).includes(Buffer.from("basic_factory_ammunition_supply")))
      .toBe(true);
  }, 120_000);

  it("keeps v3 supply:null and all-null projects on the legacy package path without synthesized state", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r58b-supply-legacy-"));
    roots.push(root);
    for (const mode of ["supply-null", "all-null"]) {
      const { projectDir } = createProject({
        name: mode, parentDir: root, templateName: "classic", gridKind: "hex"
      });
      const mechanics = enableSupply(projectDir, { mode });
      const before = fs.readFileSync(path.join(projectDir, "content", "mechanics.json"), "utf8");
      const packPath = path.join(projectDir, ".towerforge", "exports", `${mode}.tdpack`);
      expect((await exportProjectPack(projectDir, packPath)).ok).toBe(true);
      expect(readJsonEntry(inspectProjectPack(packPath), "content/mechanics.json")).toEqual(mechanics);
      expect(fs.readFileSync(path.join(projectDir, "content", "mechanics.json"), "utf8")).toBe(before);
    }
  }, 120_000);

  it("keeps public plugin MCP, projector, and authoring skill byte-aligned after supply support", () => {
    const pairs = [
      ["packages/mcp/agent-instructions.mjs", "plugins/towerforge/runtime/packages/mcp/agent-instructions.mjs"],
      ["packages/mcp/tools.mjs", "plugins/towerforge/runtime/packages/mcp/tools.mjs"],
      [
        "packages/renderer/src/logistics-power-presentation.mjs",
        "plugins/towerforge/runtime/packages/renderer/src/logistics-power-presentation.mjs"
      ]
    ];
    for (const [sourcePath, runtimePath] of pairs)
      expect(fs.readFileSync(path.resolve(runtimePath), "utf8")).toBe(fs.readFileSync(path.resolve(sourcePath), "utf8"));
    expect(fs.readFileSync(path.resolve(pairs[2][1]), "utf8")).toMatch(/schemaVersion[\s\S]*3[\s\S]*supply/);
    expect(fs.readFileSync(path.resolve("plugins/towerforge/skills/towerforge-authoring/SKILL.md"), "utf8"))
      .toContain("basic_factory_ammunition_supply");
  });
});

function enableSupply(projectDir, { mode = "active" } = {}) {
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);
  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = readJson(balancePath);
  const missionId = balance.defaultMissionId ?? Object.keys(balance.missions)[0];
  balance.missions[missionId].mechanics = { profiles: { logistics: "basic_factory_ammunition_supply" } };
  const sourceTower = structuredClone(Object.values(balance.towers).find((tower) => tower.attack?.kind));
  for (const [id, label] of [
    ["shell_factory", "Shell Factory"], ["shell_depot", "Shell Depot"], ["cannon_tower", "Supply Cannon"]
  ]) balance.towers[id] = { ...structuredClone(sourceTower), id, label };
  writeJson(balancePath, balance);
  const ammunition = mode === "all-null" ? null : {
    types: { shell: { label: "Shell" } },
    towerInventories: {
      cannon_tower: { ammoTypeId: "shell", capacity: 30, startingAmount: 0, consumptionPerActivation: 1 }
    }
  };
  const supply = mode === "active" ? {
    productionRecipes: {
      forge_shell: { label: "Forge shell", ammoTypeId: "shell", outputAmount: 4, interval: 1 }
    },
    producers: {
      shell_factory: {
        recipeId: "forge_shell", capacity: 120, startingAmount: 0,
        transferRadius: 4, transferAmount: 8, transferInterval: 0.4
      }
    },
    storages: {
      shell_depot: {
        ammoTypeId: "shell", capacity: 240, startingAmount: 0,
        transferRadius: 5, transferAmount: 12, transferInterval: 0.4
      }
    }
  } : null;
  const mechanics = {
    schemaVersion: 1,
    modules: {
      logistics: {
        schemaVersion: 3, enabled: true,
        profiles: { basic_factory_ammunition_supply: { power: null, ammunition, supply } }
      }
    }
  };
  writeJson(path.join(projectDir, "content", "mechanics.json"), mechanics);
  return mechanics;
}

function setRenderer(projectDir, targetId, renderer) {
  const targetsPath = path.join(projectDir, "build-targets.json");
  const targets = readJson(targetsPath);
  targets.targets[targetId] = { ...targets.targets["web-pwa"], id: targetId, renderer, webDir: "dist" };
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
