import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { packageDesktop } from "./packaging.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dir, "../../..");
const roots = [];
const CANARY = "TF_R19_PRIVATE_VALUE_MUST_NOT_BE_EXPORTED_7f4b9e";

beforeAll(() => {
  if (!fs.existsSync(path.join(repoRoot, "packages/engine/dist/index.js"))) {
    execFileSync("npm", ["run", "build:engine"], { cwd: repoRoot, stdio: "ignore" });
  }
});

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function nativeTarget() {
  return {
    id: "native-desktop",
    platform: "desktop",
    renderer: "canvas",
    appId: "com.example.releasegame",
    appName: "Release Game",
    appVersion: "0.1.0",
    formFactor: "desktop",
    viewport: { fit: "contain", padding: 24, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
    quality: "balanced",
    locale: "auto",
    inputProfile: "keyboard_mouse",
    window: { width: 1280, height: 720, minWidth: 1024, minHeight: 720, fullscreen: false, resizable: true },
    bundle: { iconSource: "assets/app-icon.png", targets: ["dmg", "nsis", "msi", "appimage", "deb", "rpm"] }
  };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r19-release-workflow-"));
  roots.push(root);
  execFileSync(process.execPath, [path.join(repoRoot, "packages/cli/create.mjs"), "game", "--dir", root, "--template", "classic"], { stdio: "ignore" });
  const projectDir = path.join(root, "game.tdproj");
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.schemaVersion = 5;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const icon = new PNG({ width: 1024, height: 1024 });
  icon.data.fill(0x44);
  fs.mkdirSync(path.join(projectDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "assets", "app-icon.png"), PNG.sync.write(icon));
  fs.writeFileSync(path.join(projectDir, ".env"), `APPLE_CERTIFICATE=${CANARY}\n`, "utf8");
  fs.mkdirSync(path.join(projectDir, ".towerforge"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, ".towerforge", "private-signing-value.txt"), CANARY, "utf8");
  fs.writeFileSync(path.join(projectDir, "build-targets.json"), `${JSON.stringify({
    schemaVersion: 2,
    defaults: { desktop: "native-desktop" },
    targets: { "native-desktop": nativeTarget() }
  }, null, 2)}\n`, "utf8");
  return projectDir;
}

function textFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (/\.(?:json|ya?ml|md|mjs|js|ts|toml|rs|txt|html|css)$/i.test(entry.name)) files.push(absolute);
    }
  };
  visit(root);
  return files;
}

function expectedLocalBundles() {
  if (process.platform === "darwin") return "dmg";
  if (process.platform === "win32") return "nsis,msi";
  return "appimage,deb,rpm";
}

describe("R19.3 generated desktop installers and release workflow (RED)", () => {
  it("emits a project-owned exact-commit workflow for all six public installer formats", async () => {
    const projectDir = fixture();
    const result = await packageDesktop(projectDir, { targetId: "native-desktop", outDir: "native" });
    expect(result.ok, result.error).toBe(true);
    const nativeDir = path.join(projectDir, "native");
    const workflowPath = path.join(nativeDir, ".github", "workflows", "towerforge-desktop-release.yml");
    expect(fs.existsSync(workflowPath)).toBe(true);
    const workflow = fs.readFileSync(workflowPath, "utf8");

    expect(workflow).toMatch(/actions\/checkout@/);
    expect(workflow).toMatch(/ref:\s*\$\{\{\s*github\.sha\s*\}\}/);
    expect(workflow).not.toMatch(/actions\/checkout@(?:main|master)|ref:\s*(?:main|master)\b/);
    for (const [format, osName, bundle, extension] of [
      ["dmg", "macos", "dmg", "dmg"],
      ["exe", "windows", "nsis", "exe"],
      ["msi", "windows", "msi", "msi"],
      ["AppImage", "ubuntu", "appimage", "AppImage"],
      ["deb", "ubuntu", "deb", "deb"],
      ["rpm", "ubuntu", "rpm", "rpm"]
    ]) {
      expect(workflow, format).toMatch(new RegExp(osName, "i"));
      expect(workflow, format).toMatch(new RegExp(`(?:format|name):\\s*["']?${format}`, "i"));
      expect(workflow, format).toMatch(new RegExp(`bundles?[^\\n]*${bundle}`, "i"));
      expect(workflow, format).toMatch(new RegExp(`\\.${extension.replace(".", "\\.")}\\b`, "i"));
    }
  }, 60_000);

  it("assembles SHA256SUMS and release notes with every hash and applies the unsigned pre-release policy", async () => {
    const projectDir = fixture();
    await packageDesktop(projectDir, { targetId: "native-desktop", outDir: "native" });
    const nativeDir = path.join(projectDir, "native");
    const workflow = fs.readFileSync(path.join(nativeDir, ".github", "workflows", "towerforge-desktop-release.yml"), "utf8");

    expect(workflow).toMatch(/SHA256SUMS/);
    expect(workflow).toMatch(/RELEASE_NOTES\.md/);
    expect(workflow).toMatch(/(?:sha256sum|shasum\s+-a\s+256)/i);
    expect(workflow).toMatch(/SHA256SUMS[\s\S]{0,1600}RELEASE_NOTES|RELEASE_NOTES[\s\S]{0,1600}SHA256SUMS/);
    expect(workflow).toMatch(/(?:name|title):[^\n]*Unsigned build/i);
    expect(workflow).toMatch(/prerelease:\s*(?:true|\$\{\{[^\n]*true)/i);
    expect(workflow).toMatch(/SHA256SUMS[\s\S]{0,1600}(?:files|body_path|release)/i);
  }, 60_000);

  it("generates a current-OS local installer command rather than trying cross-compilation", async () => {
    const projectDir = fixture();
    await packageDesktop(projectDir, { targetId: "native-desktop", outDir: "native" });
    const nativeDir = path.join(projectDir, "native");
    const packageJson = JSON.parse(fs.readFileSync(path.join(nativeDir, "package.json"), "utf8"));
    const scriptPath = path.join(nativeDir, "scripts", "build-current-platform.mjs");

    expect(packageJson.scripts.build).toMatch(/build-current-platform/);
    expect(fs.existsSync(scriptPath)).toBe(true);
    expect(execFileSync(process.execPath, [scriptPath, "--print-targets"], { encoding: "utf8" }).trim()).toBe(expectedLocalBundles());
    const script = fs.readFileSync(scriptPath, "utf8");
    expect(script).toMatch(/darwin[\s\S]*dmg/i);
    expect(script).toMatch(/win32[\s\S]*new Set\(\["nsis", "msi"\]\)/i);
    expect(script).toMatch(/linux[\s\S]*new Set\(\["appimage", "deb", "rpm"\]\)/i);
  }, 60_000);

  it("documents environment-owned signing intent and exports no secret value or local path", async () => {
    const projectDir = fixture();
    const result = await packageDesktop(projectDir, { targetId: "native-desktop", outDir: "native" });
    expect(result.ok, result.error).toBe(true);
    const nativeDir = path.join(projectDir, "native");
    const signingGuide = fs.readFileSync(path.join(nativeDir, "SIGNING.md"), "utf8");
    const exportedText = textFiles(nativeDir).map((file) => fs.readFileSync(file, "utf8")).join("\n");

    for (const name of [
      "APPLE_CERTIFICATE",
      "APPLE_CERTIFICATE_PASSWORD",
      "APPLE_SIGNING_IDENTITY",
      "APPLE_ID",
      "APPLE_PASSWORD",
      "APPLE_TEAM_ID",
      "WINDOWS_CERTIFICATE",
      "WINDOWS_CERTIFICATE_PASSWORD"
    ]) {
      expect(signingGuide, name).toContain(name);
    }
    expect(signingGuide).toMatch(/environment|GitHub Actions secrets/i);
    expect(exportedText).not.toContain(CANARY);
    expect(exportedText).not.toContain(projectDir);
    expect(exportedText).not.toContain(os.homedir());
    expect(exportedText).not.toMatch(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|ghp_[A-Za-z0-9]{20,}/);
  }, 60_000);
});
