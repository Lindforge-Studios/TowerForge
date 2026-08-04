import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("R22.2 generated project splash lifecycle (RED)", () => {
  it.each(["canvas", "phaser"])("ships the selected playlist after the locked TowerForge splash in %s and single-file players", (renderer) => {
    const projectDir = activeProject(`active-${renderer}`, renderer);
    const built = build(projectDir, "intro-web", true);

    const html = read(path.join(built.outDir, "index.html"));
    const single = read(path.join(built.outDir, "index.single.html"));
    const css = read(path.join(built.outDir, "styles.css"));
    const boot = read(path.join(built.outDir, "boot.js"));
    const projectData = read(path.join(built.outDir, "project-data.js"));

    for (const document of [html, single]) {
      expect(document.match(/id="towerforge-project-splash"/g)).toHaveLength(1);
      expect(document).toContain('data-towerforge-project-splash="intro"');
      expect(document).toContain('id="towerforge-project-splash-image"');
      expect(document).toContain('id="towerforge-project-splash-caption"');
      expect(document).toContain('id="towerforge-project-splash-skip"');
      expect(document.indexOf('data-towerforge-system-surface="engine-splash"'))
        .toBeLessThan(document.indexOf('data-towerforge-project-splash="intro"'));
    }

    expect(projectData).toMatch(/"splashes"\s*:\s*\{[\s\S]*"intro"[\s\S]*"studio_logo"[\s\S]*"publisher_logo"/);
    expect(projectData).toMatch(/"splashPlaylistId"\s*:\s*"intro"/);
    expect(css).toContain(".towerforge-project-splash");
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*towerforge-project-splash/);
    expect(boot).toContain("__towerforgeProjectSplashDismissed");
    expect(boot).toContain("__towerforgeCompleteBoot");
    expect(boot).toMatch(/Escape/);
    expect(boot).toMatch(/(?:Space|event\.code\s*===\s*["']Space["'])/);
    expect(boot).toMatch(/(?:Enter|event\.key\s*===\s*["']Enter["'])/);
    expect(boot).toMatch(/SPLASH_IMAGE_PRELOAD_TIMEOUT_MS\s*=\s*\d+/);
    expect(boot).toMatch(/addEventListener\("keydown",[\s\S]*?,\s*true\)/);
    expect(boot).toContain("stopImmediatePropagation");
    expect(boot).toMatch(/setTimeout\(\(\) => \{\s*if \(!runtimeReady\) reveal\("The game did not finish starting\."\);\s*\}, 5000\)/);
    expect(fs.existsSync(path.join(built.outDir, "assets/splashes/studio.png"))).toBe(true);
    expect(fs.existsSync(path.join(built.outDir, "assets/splashes/publisher.png"))).toBe(true);
    expect(single).toMatch(/"studio_logo"[\s\S]{0,300}"src":"data:image\/png;base64,/);
    expect(single).toMatch(/"publisher_logo"[\s\S]{0,300}"src":"data:image\/png;base64,/);
  }, 90_000);

  it("does not parse or ship project splash bytes for an unbound target", () => {
    const projectDir = unboundProject("unbound-malformed");
    const built = build(projectDir, "plain-web", true);

    for (const fileName of ["index.html", "index.single.html", "styles.css", "boot.js", "project-data.js"]) {
      const output = read(path.join(built.outDir, fileName));
      expect(output).not.toContain("towerforge-project-splash");
      expect(output).not.toContain("__towerforgeProjectSplash");
      expect(output).not.toContain("deliberately invalid splash catalog");
    }
  }, 60_000);
});

function activeProject(label, renderer) {
  const projectDir = copyStarter(label);
  const projectPath = path.join(projectDir, "project.json");
  writeJson(projectPath, { ...readJson(projectPath), schemaVersion: 5 });
  const visualsPath = path.join(projectDir, "content", "visuals.json");
  const visuals = readJson(visualsPath);
  writeJson(visualsPath, {
    ...visuals,
    sprites: {
      ...visuals.sprites,
      studio_logo: { src: "assets/splashes/studio.png" },
      publisher_logo: { src: "assets/splashes/publisher.png" }
    }
  });
  fs.mkdirSync(path.join(projectDir, "assets", "splashes"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "assets", "splashes", "studio.png"), PNG);
  fs.writeFileSync(path.join(projectDir, "assets", "splashes", "publisher.png"), PNG);
  writeJson(path.join(projectDir, "content", "splashes.json"), splashCatalog());
  writeJson(path.join(projectDir, "build-targets.json"), {
    schemaVersion: 2,
    defaults: { web: "intro-web" },
    targets: {
      "intro-web": {
        id: "intro-web", platform: "web", renderer, webDir: `dist-${renderer}`,
        formFactor: "desktop",
        viewport: { fit: "contain", padding: 24, minZoom: 0.5, maxZoom: 4, initialZoom: 1 },
        quality: "high", locale: "en", inputProfile: "keyboard_mouse",
        splashPlaylistId: "intro"
      }
    }
  });
  return projectDir;
}

function unboundProject(label) {
  const projectDir = copyStarter(label);
  const projectPath = path.join(projectDir, "project.json");
  writeJson(projectPath, { ...readJson(projectPath), schemaVersion: 5 });
  writeJson(path.join(projectDir, "build-targets.json"), {
    schemaVersion: 2,
    defaults: { web: "plain-web" },
    targets: {
      "plain-web": {
        id: "plain-web", platform: "web", renderer: "canvas", webDir: "dist-unbound",
        formFactor: "desktop",
        viewport: { fit: "contain", padding: 24, minZoom: 0.5, maxZoom: 4, initialZoom: 1 },
        quality: "high", locale: "en", inputProfile: "keyboard_mouse"
      }
    }
  });
  fs.writeFileSync(path.join(projectDir, "content", "splashes.json"), "{ deliberately invalid splash catalog", "utf8");
  return projectDir;
}

function splashCatalog() {
  return {
    schemaVersion: 1,
    playlists: {
      intro: {
        schemaVersion: 1,
        label: "Studio and publisher",
        items: [
          {
            id: "studio", spriteId: "studio_logo", accessibleLabel: "Example Studio logo",
            caption: "Example Studio", backgroundColor: "#111722", fit: "contain",
            transition: "fade_scale", displayMs: 700, minimumMs: 300, transitionMs: 120
          },
          {
            id: "publisher", spriteId: "publisher_logo", accessibleLabel: "Example Publisher logo",
            backgroundColor: "#12110f", fit: "cover",
            transition: "cut", displayMs: 700, minimumMs: 300, transitionMs: 0
          }
        ]
      }
    }
  };
}

function copyStarter(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `towerforge-r22-boot-${label}-`));
  roots.push(root);
  const projectDir = path.join(root, "starter.tdproj");
  fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
  return projectDir;
}

function build(projectDir, targetId, singleFile = false) {
  return JSON.parse(execFileSync(process.execPath, [
    path.join(repoRoot, "packages", "cli", "build.mjs"),
    "--project", projectDir,
    "--target", targetId,
    ...(singleFile ? ["--single-file"] : []),
    "--json"
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
  }));
}

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function readJson(filePath) {
  return JSON.parse(read(filePath));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
