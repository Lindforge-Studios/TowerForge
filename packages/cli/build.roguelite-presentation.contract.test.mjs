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

describe("R4.1A generated roguelite presentation contract", () => {
  it("ships the shared projector to Canvas and Phaser players without a legacy-only panel", () => {
    expect(buildSource).toContain("projectRoguelitePresentation");
    expect(buildSource).toContain('id="roguelite-status"');
    expect(buildSource).toContain("function updateRogueliteStatus(snap)");
    expect(buildSource.match(/updateRogueliteStatus\(snap\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(buildSource).toContain("panel.hidden = !presentation.active");
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
          schemaVersion: 1,
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
              }
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
    expect(fs.readFileSync(path.join(built.outDir, "offline-sw.js"), "utf8"))
      .toContain('"./renderer/roguelite-presentation.mjs"');

    const packPath = path.join(projectDir, ".towerforge", "exports", "roguelite-reference.tdpack");
    expect((await exportProjectPack(projectDir, packPath)).ok).toBe(true);
    const pack = inspectProjectPack(packPath);
    expect(readJsonEntry(pack, "content/mechanics.json")).toEqual(mechanics);
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
  }, 60_000);
});

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
