import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProject, TEMPLATE_NAMES } from "./create-project.mjs";

const repoRoot = path.resolve(".");
const combinations = TEMPLATE_NAMES.flatMap((template) =>
  ["hex", "square"].flatMap((grid) => ["canvas", "phaser"].map((renderer) => ({ template, grid, renderer })))
);
let tempDir;

beforeAll(() => { tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-conformance-")); });
afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }));

describe("template x renderer conformance matrix", () => {
  it.each(combinations)("builds $template/$grid with $renderer and emits the complete product contract", ({ template, grid, renderer }) => {
    const name = `${template}_${grid}_${renderer}`;
    const { projectDir } = createProject({ name, parentDir: tempDir, templateName: template, gridKind: grid });
    const targetsPath = path.join(projectDir, "build-targets.json");
    const targets = JSON.parse(fs.readFileSync(targetsPath, "utf8"));
    targets.targets[renderer] = {
      ...targets.targets["web-pwa"],
      id: renderer,
      renderer,
      webDir: `dist-${renderer}`
    };
    fs.writeFileSync(targetsPath, `${JSON.stringify(targets, null, 2)}\n`);

    const output = execFileSync(process.execPath, [
      path.join(repoRoot, "packages/cli/build.mjs"), "--project", projectDir, "--target", renderer, "--json"
    ], { cwd: repoRoot, encoding: "utf8", env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" } });
    const result = JSON.parse(output);
    expect(result).toMatchObject({ ok: true, targetId: renderer, missingAssets: [], invalidAssets: [] });

    const player = fs.readFileSync(path.join(result.outDir, "player.mjs"), "utf8");
    const html = fs.readFileSync(path.join(result.outDir, "index.html"), "utf8");
    const projectData = fs.readFileSync(path.join(result.outDir, "project-data.js"), "utf8");
    expect(html).toContain('id="playfield" tabindex="0"');
    const battlefieldKind = grid === "square" ? "Square" : "Hex";
    expect(html).toContain(`aria-label="${battlefieldKind} battlefield.`);
    expect(player).toMatch(/grid\.kind\s*===\s*["']square["']\s*\?[\s\S]{0,160}["']Square battlefield/);
    expect(player).toMatch(/grid\.kind\s*===\s*["']square["']\s*\?[\s\S]{0,240}["']Hex battlefield/);
    expect(html).toContain('id="difficulty-select"');
    expect(player).toContain("window.__towerforgeBootOk = true");
    expect(player).toMatch(
      /window\.__towerforgeBootOk\s*=\s*true;[\s\S]{0,240}(?:getElementById\(["']boot-error["']\)|\$\(["']boot-error["']\))[\s\S]{0,120}hidden\s*=\s*true/
    );
    expect(player).toContain("moveKeyboardCursor");
    expect(player).toContain("getPlayerProfileLaunchOptions");
    expect(player).toContain("currentPlayerLaunchOptions");
    expect(player).not.toContain("metaUpgradeLevels: progress.upgradeLevels");
    expect(projectData).toContain('"difficulties"');
    expect(projectData).toContain('"metaProgression"');
    expect(projectData).toContain('"starter_gameplay"');
    if (renderer === "canvas") {
      expect(player).toContain("createCanvasRenderer");
      expect(player).not.toContain("new Phaser.Game");
      const canvasRenderer = fs.readFileSync(path.join(result.outDir, "renderer", "index.mjs"), "utf8");
      expect(canvasRenderer).toContain("resolveMarkPresentation(snapshot, enemy.id)");
      expect(canvasRenderer).toContain("projectMarkPresentationCues(snapshot)");
    } else {
      expect(player).toContain("new Phaser.Game");
      expect(fs.existsSync(path.join(result.outDir, "vendor/phaser.min.js"))).toBe(true);
      expect(player).toContain("resolveMarkPresentation(snap, en.id)");
      expect(player).toContain("projectMarkPresentationCues(presentationSnapshot)");
    }
  }, 30_000);
});

describe("generated player initial battlefield accessibility", () => {
  it.each([
    { label: "absent", manifestDefaultMissionId: undefined },
    { label: "different", manifestDefaultMissionId: "legacy_hex" },
    { label: "stale", manifestDefaultMissionId: "removed_mission" }
  ])("uses the validated balance default when the manifest default is $label", ({ label, manifestDefaultMissionId }) => {
    const name = `initial_grid_${label}`;
    const { projectDir } = createProject({
      name,
      parentDir: tempDir,
      templateName: "classic",
      gridKind: "square"
    });

    const balancePath = path.join(projectDir, "content", "balance.json");
    const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
    const squareDefaultMission = balance.missions[balance.defaultMissionId];
    balance.missions = {
      legacy_hex: {
        ...squareDefaultMission,
        id: "legacy_hex",
        label: "Legacy Hex",
        mapId: "legacy_hex_map"
      },
      ...balance.missions
    };
    fs.writeFileSync(balancePath, `${JSON.stringify(balance, null, 2)}\n`, "utf8");

    const mapsPath = path.join(projectDir, "maps", "compiled", "maps.json");
    const maps = JSON.parse(fs.readFileSync(mapsPath, "utf8"));
    const squareDefaultMap = maps[squareDefaultMission.mapId];
    maps.legacy_hex_map = {
      ...squareDefaultMap,
      id: "legacy_hex_map",
      label: "Legacy Hex",
      grid: { kind: "hex", layout: "odd-r" }
    };
    fs.writeFileSync(mapsPath, `${JSON.stringify(maps, null, 2)}\n`, "utf8");

    if (manifestDefaultMissionId !== undefined) {
      const manifestPath = path.join(projectDir, "project.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      manifest.defaultMissionId = manifestDefaultMissionId;
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    }

    const output = execFileSync(process.execPath, [
      path.join(repoRoot, "packages/cli/build.mjs"),
      "--project", projectDir,
      "--target", "web-pwa",
      "--single-file",
      "--json"
    ], { cwd: repoRoot, encoding: "utf8", env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" } });
    const result = JSON.parse(output);
    expect(result).toMatchObject({ ok: true, targetId: "web-pwa" });

    for (const fileName of ["index.html", "index.single.html"]) {
      const html = fs.readFileSync(path.join(result.outDir, fileName), "utf8");
      expect.soft(
        html.includes('aria-label="Square battlefield.'),
        `${fileName} must describe the balance default mission's square grid`
      ).toBe(true);
    }
  }, 30_000);
});
