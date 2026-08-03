import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { packageDesktop } from "./packaging.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dir, "../../..");
let fixtureRoot;
let nativeDir;
let authoredLocalBundle;

function currentPlatformBundle() {
  if (process.platform === "darwin") return "dmg";
  if (process.platform === "win32") return "msi";
  return "deb";
}

beforeAll(async () => {
  if (!fs.existsSync(path.join(repoRoot, "packages/engine/dist/index.js"))) {
    execFileSync("npm", ["run", "build:engine"], { cwd: repoRoot, stdio: "ignore" });
  }
  authoredLocalBundle = currentPlatformBundle();
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r19-verifier-release-"));
  execFileSync(process.execPath, [path.join(repoRoot, "packages/cli/create.mjs"), "game", "--dir", fixtureRoot, "--template", "classic"], { stdio: "ignore" });
  const projectDir = path.join(fixtureRoot, "game.tdproj");
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.schemaVersion = 5;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const icon = new PNG({ width: 1024, height: 1024 });
  icon.data.fill(0x28);
  fs.mkdirSync(path.join(projectDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "assets", "app-icon.png"), PNG.sync.write(icon));
  fs.writeFileSync(path.join(projectDir, "build-targets.json"), `${JSON.stringify({
    schemaVersion: 2,
    defaults: { desktop: "native-desktop" },
    targets: {
      "native-desktop": {
        id: "native-desktop",
        platform: "desktop",
        renderer: "canvas",
        appId: "com.example.releaseverifier",
        appName: "Release Verifier",
        appVersion: "1.2.3",
        formFactor: "desktop",
        viewport: { fit: "contain", padding: 24, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
        quality: "balanced",
        locale: "auto",
        inputProfile: "keyboard_mouse",
        window: { width: 1280, height: 720, minWidth: 1024, minHeight: 720, fullscreen: false, resizable: true },
        bundle: { iconSource: "assets/app-icon.png", targets: [authoredLocalBundle] }
      }
    }
  }, null, 2)}\n`, "utf8");
  const result = await packageDesktop(projectDir, { targetId: "native-desktop", outDir: "native" });
  expect(result.ok, result.error).toBe(true);
  nativeDir = path.join(projectDir, "native");
}, 60_000);

afterAll(() => {
  if (fixtureRoot) fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

function workflowText() {
  return fs.readFileSync(path.join(nativeDir, ".github", "workflows", "towerforge-desktop-release.yml"), "utf8");
}

describe("R19 verifier generated release workflow", () => {
  it("recursively assembles artifacts and fails before publication when the installer set or checksum file is empty", () => {
    const script = path.join(nativeDir, "scripts", "assemble-release.mjs");
    const root = path.join(fixtureRoot, "assembler-acceptance");
    const artifacts = path.join(root, "artifacts");
    const nested = path.join(artifacts, "nested", "runner");
    const release = path.join(root, "release");
    const output = path.join(root, "github-output.txt");
    fs.mkdirSync(nested, { recursive: true });
    for (const name of ["game.dmg", "game.exe", "game.msi", "game.AppImage", "game.deb", "game.rpm"]) {
      fs.writeFileSync(path.join(nested, name), name);
    }
    for (const name of ["dmg", "exe", "msi"]) fs.writeFileSync(path.join(artifacts, `signing-status-${name}.txt`), "unsigned\n");

    execFileSync(process.execPath, [script, artifacts, release, "1.2.3", "https://example.test/commit", "https://example.test/tag", output]);
    const sums = fs.readFileSync(path.join(release, "SHA256SUMS"), "utf8").trim().split("\n");
    expect(sums).toHaveLength(6);
    expect(sums.every((line) => /^[0-9a-f]{64}  \S+$/.test(line))).toBe(true);

    fs.rmSync(path.join(nested, "game.rpm"));
    expect(() => execFileSync(process.execPath, [script, artifacts, path.join(root, "incomplete"), "1.2.3", "https://example.test/commit", "https://example.test/tag", output], { stdio: "pipe" }))
      .toThrow(/Expected exactly six desktop installers/);
  });

  it("does not enable npm caching without a lockfile and uses the lock deterministically when one is emitted", () => {
    const workflow = workflowText();
    const lockPath = path.join(nativeDir, "package-lock.json");

    if (fs.existsSync(lockPath)) {
      expect(workflow).toMatch(/npm\s+ci\b/);
      expect(workflow).not.toMatch(/npm\s+install\b/);
    } else {
      expect(workflow).not.toMatch(/^\s*cache:\s*["']?npm["']?\s*$/m);
    }
  });

  it("pins workflow actions and language toolchains instead of resolving moving major/stable labels", () => {
    const workflow = workflowText();
    const actionRefs = [...workflow.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)].map((match) => match[1]);

    expect(actionRefs.length).toBeGreaterThan(0);
    for (const action of actionRefs) expect(action, action).toMatch(/@[0-9a-f]{40}$/i);
    expect(workflow).toMatch(/node-version:\s*["']?\d+\.\d+\.\d+["']?/);
    expect(workflow).not.toMatch(/rust-toolchain@stable|toolchain:\s*stable\b/);
  });

  it("puts clickable tag and exact source-tree links in generated release notes", () => {
    const workflow = workflowText();

    expect(workflow).toMatch(/\$\{\{ github\.server_url \}\}\/\$\{\{ github\.repository \}\}\/(?:releases\/tag|tree)\/\$\{\{ github\.ref_name \}\}/);
    expect(workflow).toContain("${{ github.server_url }}/${{ github.repository }}/tree/${{ github.sha }}");
  });

  it("limits the local helper to the authored bundle targets supported by the current OS", () => {
    const scriptPath = path.join(nativeDir, "scripts", "build-current-platform.mjs");
    const printed = execFileSync(process.execPath, [scriptPath, "--print-targets"], { encoding: "utf8" }).trim();

    expect(printed).toBe(authoredLocalBundle);
  });
});
