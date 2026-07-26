import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { packageWeb } from "./lib/packaging.mjs";
import { exportProjectPack, inspectProjectPack } from "./lib/project-pack.mjs";

const buildSource = fs.readFileSync(path.resolve("packages/cli/build.mjs"), "utf8");
const repoRoot = path.resolve(".");
const tempProjects = [];

afterEach(() => {
  for (const projectDir of tempProjects.splice(0)) fs.rmSync(projectDir, { recursive: true, force: true });
});

describe("R4.1A/R4.2E generated roguelite presentation contract", () => {
  it("ships the shared projector and accessible artifact socket controls to Canvas and Phaser players", () => {
    expect(buildSource).toContain("projectRoguelitePresentation");
    expect(buildSource).toContain('id="roguelite-status"');
    expect(buildSource).toContain('id="artifact-inventory"');
    expect(buildSource).toContain("function updateRogueliteStatus(snap)");
    expect(buildSource.match(/updateRogueliteStatus\(snap\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(buildSource).toContain("panel.hidden = !presentation.active");
    expect(buildSource).toMatch(/presentation\.artifacts\.inventory|artifacts\?\.inventory/);
    expect(buildSource).not.toContain("game.socketArtifact(");
    expect(buildSource).not.toContain("game.unsocketArtifact(");
    expect(buildSource.match(/dispatchGameCommand\(game, \{/g)?.length).toBeGreaterThanOrEqual(4);
    expect(buildSource.match(/schemaVersion: 2, type: "(?:un)?socketArtifact"/g)?.length).toBeGreaterThanOrEqual(4);
    expect(buildSource).toContain("data-artifact-action");
    expect(buildSource).toContain('button.type = "button"');
  });

  it("ships the opt-in v4 draft offer and exact GameCommand v3 controls to both generated players", () => {
    expect(buildSource).toContain('id="wave-draft"');
    expect(buildSource).toMatch(/presentation\.draft\?\.pendingOffer|presentation\.draft\.pendingOffer/);
    expect(buildSource).toContain("data-draft-card-id");
    expect(buildSource).not.toContain("game.chooseDraftOption(");
    expect(buildSource.match(/schemaVersion:\s*3,\s*type:\s*"chooseDraftOption"/g)?.length)
      .toBeGreaterThanOrEqual(2);
    expect(buildSource.match(/offerId[\s\S]{0,240}cardId/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("preserves active roguelite mechanics and tower tags through PWA, single-file, web package, and tdpack", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r41a-package-"));
    tempProjects.push(projectDir);
    fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });

    const manifestPath = path.join(projectDir, "project.json");
    const manifest = readJson(manifestPath);
    manifest.schemaVersion = 3;
    writeJson(manifestPath, manifest);

    const balancePath = path.join(projectDir, "content", "balance.json");
    const balance = readJson(balancePath);
    balance.towers.arrow_tower.tags = ["elemental", "sniper"];
    balance.towers.cannon_tower.tags = ["elemental"];
    balance.missions.tutorial_01.mechanics = { profiles: { roguelite: "packaged_synergy" } };
    writeJson(balancePath, balance);
    const mechanics = {
      schemaVersion: 1,
      modules: {
        roguelite: {
          schemaVersion: 3,
          enabled: true,
          profiles: {
            packaged_synergy: {
              synergies: {
                elemental: {
                  label: "Packaged Elemental",
                  tag: "elemental",
                  tiers: [{
                    requiredCount: 2,
                    modifiers: [{ target: "damage", operation: "additive_ratio", value: 0.1 }]
                  }]
                }
              },
              artifacts: {
                definitions: {
                  boss_trophy: {
                    label: "Boss Trophy",
                    slotType: "core",
                    modifiers: [{ target: "damage", operation: "additive_ratio", value: 0.1 }]
                  }
                },
                towerSlots: {
                  arrow_tower: [{ slotId: "core", slotType: "core" }]
                },
                bossLootTables: {
                  armored_brute: {
                    rolls: 1,
                    entries: [{ artifactId: "boss_trophy", weight: 1 }]
                  }
                }
              },
              draft: packagedDraftBlock()
            }
          }
        }
      }
    };
    writeJson(path.join(projectDir, "content", "mechanics.json"), mechanics);

    const built = JSON.parse(execFileSync(process.execPath, [
      path.join(repoRoot, "packages", "cli", "build.mjs"),
      "--project", projectDir,
      "--target", "web-pwa",
      "--single-file",
      "--json"
    ], { cwd: repoRoot, encoding: "utf8", env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" } }));
    expect(built.ok).toBe(true);
    for (const relative of [
      "project-data.js",
      "renderer/roguelite-presentation.mjs",
      "offline-sw.js",
      "index.single.html"
    ]) expect(fs.existsSync(path.join(built.outDir, relative)), `missing ${relative}`).toBe(true);
    expect(fs.readFileSync(path.join(built.outDir, "project-data.js"), "utf8")).toContain('"roguelite"');
    expect(fs.readFileSync(path.join(built.outDir, "project-data.js"), "utf8")).toContain('"boss_trophy"');
    expect(fs.readFileSync(path.join(built.outDir, "project-data.js"), "utf8")).toContain('"packaged_focus"');
    expect(decodedInlineModules(fs.readFileSync(path.join(built.outDir, "index.single.html"), "utf8"))
      .some((source) => source.includes('"packaged_focus"'))).toBe(true);
    expect(fs.readFileSync(path.join(built.outDir, "offline-sw.js"), "utf8"))
      .toContain('"./renderer/roguelite-presentation.mjs"');

    const packPath = path.join(projectDir, ".towerforge", "exports", "roguelite-reference.tdpack");
    expect((await exportProjectPack(projectDir, packPath)).ok).toBe(true);
    const pack = inspectProjectPack(packPath);
    expect(readJsonEntry(pack, "content/mechanics.json")).toEqual(mechanics);
    expect(readJsonEntry(pack, "content/mechanics.json").modules.roguelite.profiles.packaged_synergy.draft)
      .toEqual(packagedDraftBlock());
    const packedBalance = readJsonEntry(pack, "content/balance.json");
    expect(packedBalance.towers.arrow_tower.tags).toEqual(["elemental", "sniper"]);
    expect(packedBalance.missions.tutorial_01.mechanics.profiles.roguelite).toBe("packaged_synergy");

    const portable = await packageWeb(projectDir, { targetId: "web-pwa", outDir: "web-roguelite" });
    expect(portable).toMatchObject({ ok: true, kind: "web", webTargetId: "web-pwa" });
    for (const relative of [
      "game/renderer/roguelite-presentation.mjs",
      "game/project-data.js",
      "game/index.single.html"
    ]) {
      expect(fs.existsSync(path.join(portable.outDir, relative)), `missing ${relative}`).toBe(true);
      expect(fs.readFileSync(portable.archive.outputPath).includes(Buffer.from(relative))).toBe(true);
    }
    expect(fs.readFileSync(path.join(portable.outDir, "game", "project-data.js"), "utf8"))
      .toContain('"packaged_focus"');
    expect(fs.readFileSync(portable.archive.outputPath).includes(Buffer.from("packaged_focus"))).toBe(true);
  }, 60_000);
});

function packagedDraftBlock() {
  return {
    definitions: Object.fromEntries([
      ["packaged_focus", "Packaged Focus"],
      ["packaged_force", "Packaged Force"],
      ["packaged_fury", "Packaged Fury"]
    ].map(([cardId, label], index) => [cardId, {
      label,
      effects: [{
        kind: "modifier",
        scope: { kind: "all_towers" },
        modifier: { target: "damage", operation: "additive_ratio", value: (index + 1) / 10 }
      }]
    }])),
    pools: {
      packaged: {
        entries: ["packaged_focus", "packaged_force", "packaged_fury"]
          .map((cardId) => ({ cardId, weight: 1 }))
      }
    },
    defaultPoolId: "packaged"
  };
}

function decodedInlineModules(html) {
  return [...html.matchAll(/data:text\/javascript;base64,([A-Za-z0-9+/=]+)/g)]
    .map((match) => Buffer.from(match[1], "base64").toString("utf8"));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJsonEntry(pack, entryPath) {
  const entry = pack.entries.find((candidate) => candidate.path === entryPath);
  expect(entry, `tdpack is missing ${entryPath}`).toBeTruthy();
  return JSON.parse(entry.bytes.toString("utf8"));
}
