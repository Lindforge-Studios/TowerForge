import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const roots = [];

afterAll(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("R18 PWA shortcut launch contract (RED)", () => {
  it("either links to the implemented root or consumes ?action=continue exactly once through the registry", () => {
    const built = buildDesktop();
    const manifest = JSON.parse(fs.readFileSync(path.join(built.outDir, "manifest.webmanifest"), "utf8"));
    const player = fs.readFileSync(path.join(built.outDir, "player.mjs"), "utf8");
    const shortcut = manifest.shortcuts?.find((entry) => /continue/i.test(`${entry.name ?? ""} ${entry.short_name ?? ""}`));
    expect(shortcut).toBeDefined();

    const parsed = new URL(shortcut.url, "https://towerforge.invalid/");
    if (parsed.searchParams.get("action") !== "continue") {
      expect(parsed.pathname).toBe("/");
      expect(parsed.search).toBe("");
      return;
    }

    expect(player).toMatch(/(?:new\s+URL\s*\([^)]*location|URLSearchParams)[\s\S]{0,320}searchParams\.get\(\s*["']action["']\s*\)/);
    const launchBlock = player.slice(player.search(/searchParams\.get\(\s*["']action["']/));
    const boundary = launchBlock.search(/(?:requestAnimationFrame\s*\(|globalThis\.__towerforgePlayerActions\s*=)/);
    const bounded = boundary > 0 ? launchBlock.slice(0, boundary) : launchBlock.slice(0, 1_200);
    const registryContinueCalls = bounded.match(/playerActionRegistry\.invoke\(\s*["'](?:continue|continueSession|loadSession)["']/g) ?? [];
    expect(registryContinueCalls).toHaveLength(1);
    expect(bounded).not.toMatch(/playerSessionStore\.loadLatest\s*\(/);
  }, 60_000);
});

function buildDesktop() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r18-shortcut-"));
  roots.push(root);
  const projectDir = path.join(root, "starter.tdproj");
  fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
  const projectPath = path.join(projectDir, "project.json");
  const project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  project.schemaVersion = 5;
  fs.writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, "utf8");
  const targetsPath = path.join(projectDir, "build-targets.json");
  const targets = JSON.parse(fs.readFileSync(targetsPath, "utf8"));
  targets.schemaVersion = 2;
  targets.targets.desktop = {
    ...targets.targets[targets.defaults.web],
    id: "desktop",
    renderer: "canvas",
    webDir: "dist-desktop",
    formFactor: "desktop",
    viewport: { fit: "contain", padding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
    quality: "balanced",
    locale: "ru",
    inputProfile: "keyboard_mouse"
  };
  fs.writeFileSync(targetsPath, `${JSON.stringify(targets, null, 2)}\n`, "utf8");
  return JSON.parse(execFileSync(process.execPath, [
    path.join(repoRoot, "packages", "cli", "build.mjs"),
    "--project", projectDir,
    "--target", "desktop",
    "--out", "dist-desktop",
    "--json"
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
  }));
}
