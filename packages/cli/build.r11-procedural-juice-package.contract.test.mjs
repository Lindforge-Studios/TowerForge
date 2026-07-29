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
const tempRoots = [];
const combinations = ["hex", "square"].flatMap((grid) => (
  ["canvas", "phaser"].map((renderer) => ({ grid, renderer }))
));

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("R11 Procedural Juice package integration", () => {
  it("preserves the opt-in catalog through Canvas/Phaser, hex/square, PWA, single-file, web package and tdpack", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r11-package-"));
    tempRoots.push(root);
    const projects = [];
    for (const { grid, renderer } of combinations) {
      const { projectDir } = createProject({ name: `juice_${grid}_${renderer}`, parentDir: root, templateName: "classic", gridKind: grid });
      const proceduralJuice = enableProceduralJuice(projectDir);
      const targetId = `juice-${renderer}`;
      addBuildTarget(projectDir, targetId, renderer);
      const built = build(projectDir, targetId);
      projects.push({ projectDir, targetId, proceduralJuice, built });
      expect(built).toMatchObject({ ok: true });
      for (const relative of [
        "renderer/procedural-juice-presentation.mjs",
        "renderer/procedural-juice-runtime.mjs",
        "renderer/audio.mjs",
        "offline-sw.js",
        "index.single.html"
      ]) expect(fs.existsSync(path.join(built.outDir, relative)), `${grid}/${renderer}: ${relative}`).toBe(true);
      const projectModule = await import(`${pathToFileURL(path.join(built.outDir, "project-data.js")).href}?r11=${grid}-${renderer}`);
      expect(projectModule.default.visuals).toMatchObject({ schemaVersion: 3, proceduralJuice });
      const player = fs.readFileSync(path.join(built.outDir, "player.mjs"), "utf8");
      expect(player).toContain("projectProceduralJuicePresentation");
      expect(player).toContain("proceduralCues");
      expect(player).toContain("window.render_game_to_text");
      expect(player).toContain("disposeProceduralVoices");
      if (renderer === "phaser") {
        expect(player).toContain("createProceduralJuicePresentationRuntime");
        expect(player).toContain("createProceduralJuiceWorldSnapshotBuffer");
        expect(player).toContain("proceduralJuiceWorldSnapshots?.select");
        expect(player).toMatch(/proceduralJuiceEnabled\s*\?\s*this\.add\.graphics\(\)\s*:\s*null/);
      } else {
        expect(player).toContain("resetProceduralJuicePresentation");
      }
      const single = decodedSingleFileModules(fs.readFileSync(path.join(built.outDir, "index.single.html"), "utf8"));
      expect(single).toContain('"proceduralJuice":{"schemaVersion":1');
      expect(single).toContain("projectProceduralJuicePresentation");
    }

    const reference = projects[0];
    const packPath = path.join(reference.projectDir, ".towerforge", "exports", "r11-juice.tdpack");
    expect((await exportProjectPack(reference.projectDir, packPath)).ok).toBe(true);
    const pack = inspectProjectPack(packPath);
    expect(readJsonEntry(pack, "content/visuals.json").proceduralJuice).toEqual(reference.proceduralJuice);

    const portable = await packageWeb(reference.projectDir, { targetId: reference.targetId, outDir: "web-r11-juice" });
    expect(portable).toMatchObject({ ok: true, kind: "web", webTargetId: reference.targetId });
    for (const relative of [
      "game/project-data.js",
      "game/renderer/procedural-juice-presentation.mjs",
      "game/renderer/procedural-juice-runtime.mjs",
      "game/index.single.html"
    ]) {
      expect(fs.existsSync(path.join(portable.outDir, relative)), `web package: ${relative}`).toBe(true);
      expect(fs.readFileSync(portable.archive.outputPath).includes(Buffer.from(relative))).toBe(true);
    }
  }, 120_000);

  it("does not synthesize the opt-in catalog into an untouched legacy build", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r11-legacy-"));
    tempRoots.push(root);
    const projectDir = path.join(root, "starter.tdproj");
    fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
    const built = JSON.parse(execFileSync(process.execPath, [
      path.join(repoRoot, "packages", "cli", "build.mjs"), "--project", projectDir,
      "--out", "dist-r11-legacy", "--json"
    ], { cwd: repoRoot, encoding: "utf8", env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" } }));
    const projectModule = await import(`${pathToFileURL(path.join(built.outDir, "project-data.js")).href}?legacy=${Date.now()}`);
    expect(projectModule.default.visuals).not.toHaveProperty("proceduralJuice");
  }, 60_000);
});

function build(projectDir, targetId) {
  return JSON.parse(execFileSync(process.execPath, [
    path.join(repoRoot, "packages", "cli", "build.mjs"), "--project", projectDir,
    "--target", targetId, "--single-file", "--json"
  ], { cwd: repoRoot, encoding: "utf8", env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" } }));
}

function enableProceduralJuice(projectDir) {
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);
  const visualsPath = path.join(projectDir, "content", "visuals.json");
  const visuals = readJson(visualsPath);
  const missionId = readJson(path.join(projectDir, "content", "balance.json")).defaultMissionId;
  const proceduralJuice = {
    schemaVersion: 1,
    particleEmitters: {
      hit: {
        maxParticles: 4, lifetimeMs: { min: 60, max: 120 }, speedPxPerSecond: { min: 20, max: 80 },
        angleDegrees: { min: 0, max: 360 }, sizePx: { min: 1, max: 2 }, color: "#ffd166", blendMode: "additive"
      }
    },
    audioCues: { hit: { waveform: "triangle", baseFrequencyHz: 220, durationMs: 80, gain: 0.2 } },
    cameraCues: { finish: { shake: { durationMs: 100, intensity: 0.3 }, hitStop: { durationMs: 100, timeScale: 0.25 } } },
    eventBindings: {
      hit: { event: "enemyHit", missionIds: [missionId], particleEmitterIds: ["hit"], audioCueIds: ["hit"] },
      finish: { event: "enemyKilled", missionIds: [missionId], cameraCueIds: ["finish"] }
    }
  };
  visuals.schemaVersion = 3;
  visuals.proceduralJuice = proceduralJuice;
  writeJson(visualsPath, visuals);
  return proceduralJuice;
}

function addBuildTarget(projectDir, targetId, renderer) {
  const targetPath = path.join(projectDir, "build-targets.json");
  const targets = readJson(targetPath);
  targets.targets[targetId] = { ...targets.targets[targets.defaults.web], id: targetId, renderer, webDir: `dist-${renderer}` };
  writeJson(targetPath, targets);
}

function decodedSingleFileModules(html) {
  return [...html.matchAll(/data:text\/javascript;base64,([A-Za-z0-9+/=]+)/g)]
    .map((match) => Buffer.from(match[1], "base64").toString("utf8")).join("\n");
}

function readJsonEntry(pack, entryPath) {
  const entry = pack.entries.find((candidate) => candidate.path === entryPath);
  expect(entry, `tdpack is missing ${entryPath}`).toBeTruthy();
  return JSON.parse(entry.bytes.toString("utf8"));
}

function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
function writeJson(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
