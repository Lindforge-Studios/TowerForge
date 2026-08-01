import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProject } from "./lib/create-project.mjs";
import { packageWeb } from "./lib/packaging.mjs";
import { exportProjectPack, inspectProjectPack } from "./lib/project-pack.mjs";

const repoRoot = path.resolve(".");
const tempRoots = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("R15 generated player/package parity", () => {
  it("ships active Macro-Economy through Canvas/Phaser x hex/square and every portable carrier", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r15-package-"));
    tempRoots.push(root);
    const projects = [];
    for (const gridKind of ["hex", "square"]) {
      for (const renderer of ["canvas", "phaser"]) {
        const { projectDir } = createProject({ name: `macro_${gridKind}_${renderer}`, parentDir: root, templateName: "classic", gridKind });
        const { mechanics, missionId } = enableMacroEconomy(projectDir);
        const targetId = `macro-${renderer}`;
        addBuildTarget(projectDir, targetId, renderer);
        const built = build(projectDir, targetId);
        projects.push({ projectDir, targetId, mechanics });
        expect(built).toMatchObject({ ok: true });
        const player = fs.readFileSync(path.join(built.outDir, "player.mjs"), "utf8");
        const html = fs.readFileSync(path.join(built.outDir, "index.html"), "utf8");
        expect(player).toContain("projectMacroEconomyPresentation");
        expect(player).toContain('schemaVersion: 8, type: "openDeposit"');
        expect(html).toContain('id="macro-economy-status"');
        expect(fs.readFileSync(path.join(built.outDir, "index.single.html"), "utf8")).toContain('id="macro-economy-status"');
        expect(JSON.parse(fs.readFileSync(path.join(projectDir, "content", "balance.json"), "utf8")).missions[missionId].mechanics)
          .toEqual({ profiles: { macroEconomy: "basic_local_market" } });
      }
    }

    const reference = projects[0];
    const packPath = path.join(reference.projectDir, ".towerforge", "exports", "r15-macro.tdpack");
    expect((await exportProjectPack(reference.projectDir, packPath)).ok).toBe(true);
    const pack = inspectProjectPack(packPath);
    expect(readJsonEntry(pack, "content/mechanics.json")).toEqual(reference.mechanics);
    const portable = await packageWeb(reference.projectDir, { targetId: reference.targetId, outDir: "web-r15-macro" });
    expect(portable).toMatchObject({ ok: true, kind: "web", webTargetId: reference.targetId });
    expect(fs.readFileSync(path.join(portable.outDir, "game", "player.mjs"), "utf8")).toContain("projectMacroEconomyPresentation");
  }, 120_000);

  it("omits Macro-Economy UI/runtime from an untouched legacy starter player", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r15-legacy-"));
    tempRoots.push(root);
    const projectDir = path.join(root, "starter.tdproj");
    fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
    const built = build(projectDir, undefined);
    expect(fs.readFileSync(path.join(built.outDir, "player.mjs"), "utf8")).not.toContain("projectMacroEconomyPresentation");
    expect(fs.readFileSync(path.join(built.outDir, "index.html"), "utf8")).not.toContain('id="macro-economy-status"');
    expect(fs.existsSync(path.join(built.outDir, "renderer", "macro-economy-presentation.mjs"))).toBe(false);
    expect(fs.existsSync(path.join(built.outDir, "engine", "content", "macro-economy-mechanics.js"))).toBe(false);
    expect(fs.readFileSync(path.join(built.outDir, "offline-sw.js"), "utf8")).not.toContain("macro-economy");
    expect(fs.readFileSync(path.join(built.outDir, "engine", "content", "mechanics.js"), "utf8")).not.toContain("macroEconomy");
    expect(fs.readFileSync(path.join(built.outDir, "engine", "simulation", "TowerDefenseGame.js"), "utf8")).not.toMatch(/macroEconomy|buyCommodity|performRitual|ritualTemporary|commodityTraded|marketPricesAdvanced|depositOpened|depositMatured|ritualPerformed/);
    expect(fs.readFileSync(path.join(built.outDir, "engine", "simulation", "command-internal.js"), "utf8")).not.toMatch(/buyCommodity|sellCommodity|openDeposit|performRitual/);
    expect(fs.existsSync(path.join(built.outDir, "engine", "content", "optional-mechanics-disabled.js"))).toBe(false);
    expect(fs.readFileSync(path.join(built.outDir, "index.single.html"), "utf8")).not.toContain("MACRO_ECONOMY_MECHANICS_SCHEMA");
  }, 60_000);
});

function enableMacroEconomy(projectDir) {
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);
  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = readJson(balancePath);
  const missionId = balance.defaultMissionId ?? Object.keys(balance.missions)[0];
  const towerTypeId = balance.missions[missionId].buildTowerIds[0];
  balance.missions[missionId].mechanics = { profiles: { macroEconomy: "basic_local_market" } };
  writeJson(balancePath, balance);
  const mechanics = {
    schemaVersion: 1,
    modules: {
      macroEconomy: {
        schemaVersion: 1,
        enabled: true,
        profiles: {
          basic_local_market: {
            quoteCurrencyId: "coins",
            commodities: { ore: { label: "Ore", basePrice: 10, minPrice: 5, maxPrice: 25, trendPerWave: 0.1, volatility: 0.08, demandElasticity: 0.05 } },
            deposits: { short_term: { label: "Short term", currencyId: "coins", durationClearedWaves: 2, interestBasisPoints: 500, minAmount: 10, maxAmount: 1000 } },
            altars: { exchange: { label: "Exchange", coord: { q: 0, r: 0 }, radius: 2, minTowers: 1, maxTowers: 1, towerTypeIds: [towerTypeId], effects: [{ kind: "grant_resource", resourceId: "coins", amount: 25 }] } }
          }
        }
      }
    }
  };
  writeJson(path.join(projectDir, "content", "mechanics.json"), mechanics);
  return { mechanics, missionId };
}

function addBuildTarget(projectDir, targetId, renderer) {
  const targetPath = path.join(projectDir, "build-targets.json");
  const targets = readJson(targetPath);
  targets.targets[targetId] = { ...targets.targets[targets.defaults.web], id: targetId, renderer, webDir: `dist-${renderer}` };
  writeJson(targetPath, targets);
}

function build(projectDir, targetId) {
  const args = [path.join(repoRoot, "packages", "cli", "build.mjs"), "--project", projectDir, "--single-file", "--json"];
  if (targetId) args.push("--target", targetId);
  return JSON.parse(execFileSync(process.execPath, args, { cwd: repoRoot, encoding: "utf8", env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" } }));
}

function readJsonEntry(pack, entryPath) {
  const entry = pack.entries.find((candidate) => candidate.path === entryPath);
  expect(entry, `tdpack is missing ${entryPath}`).toBeTruthy();
  return JSON.parse(entry.bytes.toString("utf8"));
}

function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
