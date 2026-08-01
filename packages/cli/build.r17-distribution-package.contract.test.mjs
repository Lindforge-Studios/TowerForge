import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProject } from "./lib/create-project.mjs";

const repoRoot = path.resolve(".");
const roots = [];
const combinations = ["hex", "square"].flatMap((grid) => (
  ["canvas", "phaser"].map((renderer) => ({ grid, renderer }))
));

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("R17 opt-in player/package distribution contract (RED)", () => {
  it("ships licensed Remix and inert host monetization placeholders across Canvas/Phaser × hex/square", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r17-player-"));
    roots.push(root);
    const secret = "r17_fixture_secret_must_never_ship";

    for (const { grid, renderer } of combinations) {
      const { projectDir } = createProject({
        name: `r17_${grid}_${renderer}`,
        parentDir: root,
        templateName: "classic",
        gridKind: grid
      });
      enableDistribution(projectDir);
      addBuildTarget(projectDir, renderer);
      fs.mkdirSync(path.join(projectDir, ".towerforge", "private"), { recursive: true });
      fs.writeFileSync(path.join(projectDir, ".towerforge", "private", "token.txt"), secret, "utf8");
      fs.writeFileSync(path.join(projectDir, ".env"), `PROVIDER_TOKEN=${secret}\n`, "utf8");

      const built = build(projectDir, renderer);
      const output = textTree(built.outDir);
      expect(output, `${grid}/${renderer} remix`).toMatch(/data-towerforge-remix|towerforge-remix/i);
      expect(output, `${grid}/${renderer} source pack`).toMatch(/source\.tdpack/);
      expect(output, `${grid}/${renderer} placements`).toMatch(/data-towerforge-monetization-placement/);
      expect(output).toMatch(/support_link[\s\S]*(?:purchase_link|menu)|(?:purchase_link|menu)[\s\S]*support_link/);
      expect(output).toMatch(/between_waves_ad[\s\S]*(?:interstitial|between_waves)|(?:interstitial|between_waves)[\s\S]*between_waves_ad/);
      expect(output).not.toMatch(/paymentKey|r17_fixture_secret_must_never_ship/i);
      expect(output).not.toContain(secret);
      expect(output).not.toContain(projectDir);
      expect(fs.existsSync(path.join(built.outDir, "source.tdpack"))).toBe(true);

      const single = fs.readFileSync(path.join(built.outDir, "index.single.html"), "utf8");
      expect(single).toMatch(/towerforge-remix|data-towerforge-remix/i);
      expect(single).toMatch(/data-towerforge-monetization-placement/);
      expect(single).not.toContain(secret);
      expect(single).not.toContain(projectDir);
    }
  }, 120_000);

  it("preserves authored public strings byte-for-byte instead of scrubbing output vocabulary", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r17-public-copy-"));
    roots.push(root);
    const publicCopy = "telemetry /Users/example rewardedStarCount victoryRewarded C:\\Games\\TowerForge";
    const { projectDir } = createProject({
      name: "r17_public_copy",
      parentDir: root,
      templateName: "classic",
      gridKind: "square"
    });
    const projectPath = path.join(projectDir, "project.json");
    const project = readJson(projectPath);
    project.description = publicCopy;
    writeJson(projectPath, project);
    enableDistribution(projectDir);
    addBuildTarget(projectDir, "canvas");

    const built = build(projectDir, "canvas");
    const moduleSource = fs.readFileSync(path.join(built.outDir, "project-data.js"), "utf8");
    const emitted = JSON.parse(moduleSource.replace(/^export default\s+/, "").replace(/;\s*$/, ""));
    expect(emitted.manifest.description).toBe(publicCopy);
  }, 60_000);

  it("keeps an untouched starter build byte-surface free of R17 runtime, source pack and placeholders", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r17-legacy-"));
    roots.push(root);
    const projectDir = path.join(root, "starter.tdproj");
    fs.cpSync(path.resolve("examples/starter.tdproj"), projectDir, { recursive: true });
    const built = JSON.parse(execFileSync(process.execPath, [
      path.join(repoRoot, "packages", "cli", "build.mjs"),
      "--project", projectDir,
      "--out", "dist-r17-legacy",
      "--single-file",
      "--json"
    ], { cwd: repoRoot, encoding: "utf8", env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" } }));
    const output = textTree(built.outDir);
    expect(output).not.toMatch(/PublishManifestV1|RemixProvenanceV1|MonetizationHookV1|towerforge-remix|data-towerforge-monetization-placement/i);
    expect(fs.existsSync(path.join(built.outDir, "source.tdpack"))).toBe(false);
  }, 60_000);
});

function enableDistribution(projectDir) {
  const projectPath = path.join(projectDir, "project.json");
  const project = readJson(projectPath);
  project.schemaVersion = 4;
  writeJson(projectPath, project);
  writeJson(path.join(projectDir, "content", "distribution.json"), {
    schemaVersion: 1,
    projectId: "tfp_0123456789abcdef0123456789abcdef",
    license: { spdxId: "CC-BY-4.0", attribution: "TowerForge R17 fixture authors" },
    remix: { policy: "allowed_with_attribution", includeSource: true },
    monetization: {
      schemaVersion: 1,
      placements: [
        { id: "support_link", kind: "purchase_link", surface: "menu" },
        { id: "between_waves_ad", kind: "interstitial", surface: "between_waves" }
      ]
    }
  });
}

function addBuildTarget(projectDir, renderer) {
  const targetPath = path.join(projectDir, "build-targets.json");
  const targets = readJson(targetPath);
  const targetId = `r17-${renderer}`;
  targets.targets[targetId] = {
    ...targets.targets[targets.defaults.web],
    id: targetId,
    renderer,
    webDir: `dist-r17-${renderer}`
  };
  writeJson(targetPath, targets);
}

function build(projectDir, renderer) {
  return JSON.parse(execFileSync(process.execPath, [
    path.join(repoRoot, "packages", "cli", "build.mjs"),
    "--project", projectDir,
    "--target", `r17-${renderer}`,
    "--single-file",
    "--json"
  ], { cwd: repoRoot, encoding: "utf8", env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" } }));
}

function textTree(root) {
  const rows = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && !/\.(?:png|ico|icns|zip|woff2?|tdpack)$/i.test(entry.name)) {
        rows.push(`${path.relative(root, absolute)}\n${fs.readFileSync(absolute, "utf8")}`);
      }
    }
  };
  visit(root);
  return rows.join("\n");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
