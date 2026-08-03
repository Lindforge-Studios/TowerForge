import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProject } from "./lib/create-project.mjs";
import { packageProject } from "./lib/packaging.mjs";
import { exportProjectPack, inspectProjectPack } from "./lib/project-pack.mjs";

const repoRoot = path.resolve(".");
const HUD_MODULES = [
  "player-runtime/hud-catalog.mjs",
  "player-runtime/hud-layout.mjs",
  "player-runtime/hud-screen-graph.mjs",
  "player-runtime/hud-build-menu-presets.mjs",
  "player-shell/hud-dom-runtime.mjs"
];
let root;
let projectDir;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r21-hud-package-"));
  ({ projectDir } = createProject({ name: "hud_parity", parentDir: root, templateName: "classic", gridKind: "square" }));
  configureActiveHud(projectDir);
});

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe("R21.6 conditional HUD runtime and package parity (RED)", () => {
  it("includes the browser shell source in the generated Codex plugin runtime", () => {
    const builder = fs.readFileSync(path.join(repoRoot, "scripts", "build-codex-plugin.mjs"), "utf8");
    expect(builder).toMatch(/packages["'],\s*["']player-shell["']/);
  });

  it("ships one shared DOM HUD runtime and selected profile through Canvas and Phaser PWA builds", () => {
    const { canvasBuild, phaserBuild } = activeBuilds();
    for (const built of [canvasBuild, phaserBuild]) {
      for (const relative of HUD_MODULES) {
        expect(fs.existsSync(path.join(built.outDir, relative)), `${built.targetId}: ${relative}`).toBe(true);
        expect(fs.readFileSync(path.join(built.outDir, "offline-sw.js"), "utf8")).toContain(`./${relative}`);
      }
      expect(fs.readFileSync(path.join(built.outDir, "index.html"), "utf8"))
        .toContain('data-towerforge-hud-profile="main"');
      expect(fs.readFileSync(path.join(built.outDir, "project-data.js"), "utf8"))
        .toMatch(/"hud"\s*:\s*\{[\s\S]*"main"/);
    }
    expect(fs.readFileSync(path.join(canvasBuild.outDir, "player-shell/hud-dom-runtime.mjs")))
      .toEqual(fs.readFileSync(path.join(phaserBuild.outDir, "player-shell/hud-dom-runtime.mjs")));
  });

  it("embeds the same selected HUD in both single-file players without unresolved runtime imports", () => {
    const { canvasBuild, phaserBuild } = activeBuilds();
    for (const built of [canvasBuild, phaserBuild]) {
      const single = fs.readFileSync(path.join(built.outDir, "index.single.html"), "utf8");
      expect(single).toContain('data-towerforge-hud-profile="main"');
      expect(single).toMatch(/HudCatalogV1|createHudDomRuntimeV1|createHudScreenGraphSessionV1/);
      expect(single).not.toMatch(/(?:from\s*|import\s*\()["']\.\/(?:player-runtime|player-shell)\//);
    }
  });

  it("preserves the active HUD through portable web, native desktop and source tdpack", async () => {
    const portable = await packageProject(projectDir, {
      kind: "web", targetId: "hud-canvas", outDir: "portable-hud"
    });
    const native = await packageProject(projectDir, {
      kind: "desktop", targetId: "hud-canvas", outDir: "native-hud"
    });
    expect(portable.ok).toBe(true);
    expect(native.ok).toBe(true);
    for (const outDir of [path.join(portable.outDir, "game"), path.join(native.outDir, "dist")]) {
      expect(fs.readFileSync(path.join(outDir, "index.html"), "utf8"))
        .toContain('data-towerforge-hud-profile="main"');
      for (const relative of HUD_MODULES) expect(fs.existsSync(path.join(outDir, relative)), relative).toBe(true);
    }
    const packPath = path.join(root, "hud-parity.tdpack");
    await exportProjectPack(projectDir, packPath);
    const pack = inspectProjectPack(packPath);
    const hudEntry = pack.entries.find((entry) => entry.path === "content/hud.json");
    expect(hudEntry).toBeDefined();
    expect(hudEntry.bytes.toString("utf8")).toMatch(/"main"[\s\S]*"gameplay"/);
  }, 120_000);

  it("does not read or ship HUD data for BuildTargets v1 even when an invalid hud.json is present", () => {
    const legacy = copyStarter("legacy-invalid-hud");
    fs.writeFileSync(path.join(legacy, "content", "hud.json"), "{ deliberately invalid HUD bytes", "utf8");
    const built = build(legacy, undefined, "dist-legacy-hud-pruning");
    assertHudPruned(built.outDir);
  }, 60_000);

  it("does not read or ship HUD data for an unbound BuildTargets v2 large-screen target", () => {
    const unbound = copyStarter("unbound-invalid-hud");
    const projectPath = path.join(unbound, "project.json");
    writeJson(projectPath, { ...readJson(projectPath), schemaVersion: 5 });
    const targetsPath = path.join(unbound, "build-targets.json");
    const targets = readJson(targetsPath);
    const base = targets.targets[targets.defaults.web];
    writeJson(targetsPath, {
      schemaVersion: 2,
      defaults: { web: "desktop-unbound" },
      targets: {
        "desktop-unbound": {
          ...base, id: "desktop-unbound", renderer: "canvas", webDir: "dist-unbound",
          formFactor: "desktop",
          viewport: { fit: "contain", padding: 24, minZoom: 0.5, maxZoom: 4, initialZoom: 1 },
          quality: "high", locale: "en", inputProfile: "keyboard_mouse"
        }
      }
    });
    fs.writeFileSync(path.join(unbound, "content", "hud.json"), "{ deliberately invalid HUD bytes", "utf8");
    const built = build(unbound, "desktop-unbound", "dist-unbound");
    assertHudPruned(built.outDir);
  }, 60_000);
});

function configureActiveHud(dir) {
  const projectPath = path.join(dir, "project.json");
  writeJson(projectPath, { ...readJson(projectPath), schemaVersion: 5 });
  const targetsPath = path.join(dir, "build-targets.json");
  writeJson(targetsPath, {
    schemaVersion: 2,
    defaults: { web: "hud-canvas" },
    targets: Object.fromEntries(["canvas", "phaser"].map((renderer) => {
      const id = `hud-${renderer}`;
      return [id, {
        id, platform: "web", renderer, webDir: `dist-hud-${renderer}`,
        formFactor: renderer === "canvas" ? "desktop" : "responsive",
        viewport: { fit: "contain", padding: 24, minZoom: 0.5, maxZoom: 4, initialZoom: 1 },
        quality: "high", locale: "en", inputProfile: "keyboard_mouse", hudProfileId: "main"
      }];
    }))
  });
  writeJson(path.join(dir, "content", "hud.json"), {
    schemaVersion: 1,
    profiles: {
      main: {
        schemaVersion: 1, label: "Package parity HUD",
        breakpoints: { mobileMax: 767, tabletMax: 1199 }, commonNodes: [],
        variants: {
          desktop: variant(1920, 1080), tablet: variant(1024, 768), mobile: variant(390, 844)
        },
        screens: { gameplay: { schemaVersion: 1, surface: "gameplay", rootNodeIds: [] } },
        screenGraph: { schemaVersion: 1, initialScreenId: "gameplay", transitions: [] },
        assetRoles: {}
      }
    }
  });
}

function activeBuilds() {
  return {
    canvasBuild: build(projectDir, "hud-canvas", "dist-hud-canvas"),
    phaserBuild: build(projectDir, "hud-phaser", "dist-hud-phaser")
  };
}

function variant(width, height) {
  return { schemaVersion: 1, designViewport: { width, height }, rootNodeIds: [] };
}

function build(dir, targetId, out) {
  const args = [
    path.join(repoRoot, "packages/cli/build.mjs"), "--project", dir, "--out", out,
    "--single-file", "--json"
  ];
  if (targetId) args.push("--target", targetId);
  const result = JSON.parse(execFileSync(process.execPath, args, {
    cwd: repoRoot, encoding: "utf8", env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
  }));
  return { ...result, targetId: targetId ?? "legacy" };
}

function assertHudPruned(outDir) {
  for (const relative of HUD_MODULES) expect(fs.existsSync(path.join(outDir, relative)), relative).toBe(false);
  const source = ["index.html", "player.mjs", "project-data.js", "offline-sw.js"]
    .filter((relative) => fs.existsSync(path.join(outDir, relative)))
    .map((relative) => fs.readFileSync(path.join(outDir, relative), "utf8"))
    .join("\n");
  expect(source).not.toMatch(/hudProfileId|HudCatalogV1|hud-dom-runtime|content\/hud\.json|"hud"\s*:/);
}

function copyStarter(label) {
  const project = path.join(root, `${label}.tdproj`);
  fs.cpSync(path.join(repoRoot, "examples/starter.tdproj"), project, { recursive: true });
  return project;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
