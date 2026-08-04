import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const tempRoots = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("mandatory TowerForge engine splash", () => {
  it.each(["canvas", "phaser"])("ships in generated %s web and single-file players", (renderer) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `towerforge-engine-splash-${renderer}-`));
    tempRoots.push(root);
    const projectDir = path.join(root, "starter.tdproj");
    fs.cpSync(path.join(repoRoot, "examples/starter.tdproj"), projectDir, { recursive: true });
    const targetsPath = path.join(projectDir, "build-targets.json");
    const targets = JSON.parse(fs.readFileSync(targetsPath, "utf8"));
    const targetId = targets.defaults.web;
    targets.targets[targetId].renderer = renderer;
    targets.targets[targetId].webDir = `dist-${renderer}`;
    fs.writeFileSync(targetsPath, `${JSON.stringify(targets, null, 2)}\n`, "utf8");

    const result = JSON.parse(execFileSync(process.execPath, [
      path.join(repoRoot, "packages/cli/build.mjs"),
      "--project", projectDir,
      "--target", targetId,
      "--single-file",
      "--json"
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
    }));

    for (const fileName of ["index.html", "index.single.html"]) {
      const html = fs.readFileSync(path.join(result.outDir, fileName), "utf8");
      expect(html.match(/id="towerforge-engine-splash"/g)).toHaveLength(1);
      expect(html).toContain('data-towerforge-system-surface="engine-splash"');
      expect(html).toContain("Made with TowerForge");
      expect(html).toContain('aria-label="Made with TowerForge"');
      expect(html).toContain('viewBox="0 0 64 64"');
    }

    const css = fs.readFileSync(path.join(result.outDir, "styles.css"), "utf8");
    const boot = fs.readFileSync(path.join(result.outDir, "boot.js"), "utf8");
    const player = fs.readFileSync(path.join(result.outDir, "player.mjs"), "utf8");
    expect(css).toContain(".towerforge-engine-splash");
    expect(css).toMatch(/prefers-reduced-motion/);
    expect(boot).toContain("__towerforgeCompleteBoot");
    expect(boot).toContain("__towerforgeSplashDismissed");
    expect(player).toContain("window.__towerforgeCompleteBoot?.()");
    expect(player).not.toMatch(/window\.__towerforgeCompleteBoot\?\.\(\);\s*window\.__towerforgeBootOk\s*=\s*true/);
  }, 90_000);
});
