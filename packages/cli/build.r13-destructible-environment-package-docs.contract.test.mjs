import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const buildSource = read("packages/cli/build.mjs");
const rendererIndex = read("packages/renderer/src/index.mjs");
const packagingSource = read("packages/cli/lib/packaging.mjs");
const projectPackSource = read("packages/cli/lib/project-pack.mjs");

describe("R13.4 destructible-environment generated package and documentation contract", () => {
  it("uses one presentation-only adapter in Canvas/Phaser across hex/square generated paths", () => {
    const projectorPath = "packages/renderer/src/destructible-environment-presentation.mjs";
    expect(exists(projectorPath), projectorPath).toBe(true);
    const projector = read(projectorPath);
    const canvasTemplate = section(buildSource, "function playerTemplate", "function phaserPlayerTemplate");
    const phaserTemplate = section(buildSource, "function phaserPlayerTemplate", "function serviceWorkerTemplate");

    expect(rendererIndex).toContain('from "./destructible-environment-presentation.mjs"');
    expect(rendererIndex).toContain("projectDestructibleEnvironmentPresentation(");
    expect(canvasTemplate).toContain("createCanvasRenderer");
    expect(phaserTemplate).toContain("projectDestructibleEnvironmentPresentation");

    for (const grid of ["hex", "square"]) {
      for (const renderer of ["canvas", "phaser"]) {
        const generatedPath = renderer === "canvas" ? `${rendererIndex}\n${canvasTemplate}` : phaserTemplate;
        expect(generatedPath, `${renderer}/${grid}`).toContain("projectDestructibleEnvironmentPresentation");
        expect(buildSource, `${renderer}/${grid}`).toContain(
          'project.maps?.[mapId]?.grid?.kind === "square" ? "square" : "hex"'
        );
      }
    }

    expect(projector).not.toMatch(
      /DamageResolver|TowerDefenseGame|content\.mechanics|collision|navigation|lineOfSight|terrainTransition|targeting/
    );
  });

  it("keeps runtime presentation active-only while preserving authored data in every carrier", () => {
    const projectorPath = "packages/renderer/src/destructible-environment-presentation.mjs";
    expect(exists(projectorPath), projectorPath).toBe(true);
    const projector = read(projectorPath);

    expect(projector).toContain("schemaVersion");
    expect(projector).toContain("destructibles");
    expect(projector).toMatch(/active\s*:\s*false/);
    expect(buildSource.match(/files\.mechanicsAuthored\s*\?\s*\{ mechanics: files\.mechanics \}\s*:\s*\{\}/g)?.length).toBe(2);

    expect(buildSource).toContain('path.join(outDir, "manifest.webmanifest")');
    expect(buildSource).toContain('path.join(outDir, "offline-sw.js")');
    expect(buildSource).toContain('path.join(outDir, "index.single.html")');
    expect(packagingSource).toContain('kind === "web"');
    expect(packagingSource).toContain("writeDirectoryZip");
    expect(projectPackSource).toContain('const ROOT_DIRS = new Set(["content", "maps", "assets", "scripts"])');
  });

  it("leaves the canonical starter source free of R13.4 opt-in data", () => {
    expect(exists("examples/starter.tdproj/content/mechanics.json")).toBe(false);
    const canonicalStarterFiles = [
      "examples/starter.tdproj/project.json",
      "examples/starter.tdproj/content/balance.json",
      "examples/starter.tdproj/maps/compiled/maps.json",
      "examples/starter.tdproj/maps/src/tutorial_map.tmj"
    ];
    const starter = canonicalStarterFiles.map(read).join("\n");
    expect(starter).not.toContain("basic_destructible_environment");
    expect(starter).not.toContain("destructibleObjects");
  });

  it("ships and documents one complete opt-in destructible-environment reference fixture", () => {
    const fixture = "docs/examples/opt-in-destructible-environment";
    const expectedFiles = ["README.md", "mechanics.json", "mission-selection.json", "map-source.fragment.json"];
    for (const file of expectedFiles) expect(exists(`${fixture}/${file}`), `${fixture}/${file}`).toBe(true);

    const mechanics = readJson(`${fixture}/mechanics.json`);
    const selection = readJson(`${fixture}/mission-selection.json`);
    const mapSource = readJson(`${fixture}/map-source.fragment.json`);
    const profile = mechanics.modules.ballistics.profiles.basic_destructible_environment;

    expect(mechanics).toMatchObject({ schemaVersion: 1, modules: { ballistics: { schemaVersion: 1, enabled: true } } });
    expect(profile.projectiles.towers).toEqual({});
    expect(Object.keys(profile.projectiles.destructibles.definitions)).toHaveLength(1);
    expect(selection).toEqual({ mechanics: { profiles: { ballistics: "basic_destructible_environment" } } });
    expect(mapSource).toEqual({
      destructibleObjects: [{ id: "basic_crate_1", definitionId: "basic_crate", coord: { q: 6, r: 2 } }]
    });

    const fixtureReadme = read(`${fixture}/README.md`);
    const roadmap = read("docs/ROADMAP.md");
    const runbook = read("docs/runbook.md");
    const adr = read("docs/adr/0054-r13-deterministic-2-5d-ballistics.md");
    const docs = `${fixtureReadme}\n${roadmap}\n${runbook}\n${adr}`;

    for (const marker of [
      "R13.4",
      "basic_destructible_environment",
      "preview_destructible_environment",
      "apply_destructible_environment",
      "destructibleObjectDamaged",
      "destructibleObjectDestroyed",
      "Canvas",
      "Phaser",
      "PWA",
      "single-file",
      "web package",
      ".tdpack",
      "backup",
      "rollback",
      "absent",
      "disabled",
      "unselected"
    ]) expect(docs, marker).toContain(marker);

    expect(docs).toMatch(/snapshot[^\n]*ballistics[^\n]*v2|ballistics[^\n]*snapshot[^\n]*v2/i);
    expect(docs).toMatch(/checkpoint[^\n]*v4/i);
    expect(docs).toMatch(/five[- ]file|five files|5 files/i);
    expect(docs).toMatch(/TowerScript[^\n]*(?:not|no|without|excluded)|(?:not|no|without|excluded)[^\n]*TowerScript/i);
    expect(docs).toMatch(/broad[^\n]*write[^\n]*(?:not|no|without|forbidden|excluded)|(?:not|no|without|forbidden|excluded)[^\n]*broad[^\n]*write/i);
  });
});

function exists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex, start).toBeGreaterThanOrEqual(0);
  expect(endIndex, end).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}
