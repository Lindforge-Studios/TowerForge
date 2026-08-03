import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { packageDesktop } from "./packaging.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dir, "../../..");
const roots = [];
let workflowRoot;
let enabledDir;
let disabledDir;

beforeAll(async () => {
  if (!fs.existsSync(path.join(repoRoot, "packages/engine/dist/index.js"))) {
    execFileSync("npm", ["run", "build:engine"], { cwd: repoRoot, stdio: "ignore" });
  }
  const fixture = createProject({
    defaults: { desktop: "native-enabled" },
    targets: {
      "native-enabled": nativeTarget("native-enabled", { updater: enabledUpdater() }),
      "native-disabled": nativeTarget("native-disabled", { updater: { enabled: false } })
    }
  });
  roots.pop();
  workflowRoot = fixture.root;
  const enabled = await packageDesktop(fixture.projectDir, { targetId: "native-enabled", outDir: "native-enabled" });
  const disabled = await packageDesktop(fixture.projectDir, { targetId: "native-disabled", outDir: "native-disabled" });
  expect(enabled.ok, enabled.error).toBe(true);
  expect(disabled.ok, disabled.error).toBe(true);
  enabledDir = path.join(fixture.projectDir, "native-enabled");
  disabledDir = path.join(fixture.projectDir, "native-disabled");
}, 60_000);

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

afterAll(() => {
  if (workflowRoot) fs.rmSync(workflowRoot, { recursive: true, force: true });
});

function enabledUpdater() {
  return {
    enabled: true,
    endpoints: ["https://updates.example.test/{{target}}/{{arch}}/{{current_version}}"],
    publicKey: "RWQ1-public-verification-key"
  };
}

function webTarget() {
  return {
    id: "web-pwa",
    platform: "web",
    renderer: "canvas",
    webDir: "dist",
    formFactor: "responsive",
    viewport: { fit: "contain", padding: 16, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
    quality: "balanced",
    locale: "auto",
    inputProfile: "hybrid"
  };
}

function nativeTarget(id, options = {}) {
  return {
    id,
    platform: "desktop",
    renderer: "canvas",
    appId: `com.example.${id}`,
    appName: id,
    appVersion: "1.2.3",
    formFactor: "desktop",
    viewport: { fit: "contain", padding: 24, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
    quality: "balanced",
    locale: "auto",
    inputProfile: "keyboard_mouse",
    window: { width: 1280, height: 720, minWidth: 1024, minHeight: 720, fullscreen: false, resizable: true },
    bundle: { iconSource: "assets/app-icon.png", targets: ["dmg", "nsis", "msi", "appimage", "deb", "rpm"] },
    ...options
  };
}

function createProject({ defaults, targets }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r19-frozen-audit-"));
  roots.push(root);
  execFileSync(process.execPath, [path.join(repoRoot, "packages/cli/create.mjs"), "game", "--dir", root, "--template", "classic"], { stdio: "ignore" });
  const projectDir = path.join(root, "game.tdproj");
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.schemaVersion = 5;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const icon = new PNG({ width: 1024, height: 1024 });
  icon.data.fill(0x37);
  fs.mkdirSync(path.join(projectDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "assets", "app-icon.png"), PNG.sync.write(icon));
  fs.writeFileSync(path.join(projectDir, "build-targets.json"), `${JSON.stringify({
    schemaVersion: 2,
    defaults,
    targets
  }, null, 2)}\n`, "utf8");
  return { root, projectDir };
}

async function captured(operation) {
  try {
    return await operation();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function generatedWorkflow(nativeDir) {
  return fs.readFileSync(path.join(nativeDir, ".github", "workflows", "towerforge-desktop-release.yml"), "utf8");
}

describe("R19 frozen audit: implicit desktop packaging selection", () => {
  it("rejects no-target desktop packaging when only a web default exists; the legacy wrapper remains explicit-only", async () => {
    const fixture = createProject({ defaults: { web: "web-pwa" }, targets: { "web-pwa": webTarget() } });

    const implicit = await captured(() => packageDesktop(fixture.projectDir, { outDir: "implicit-desktop" }));
    expect(implicit.ok).toBe(false);
    expect(implicit.error).toMatch(/explicit|targetId|defaults\.desktop|desktop target/i);
    expect(fs.existsSync(path.join(fixture.projectDir, "implicit-desktop"))).toBe(false);

    const explicit = await packageDesktop(fixture.projectDir, { targetId: "web-pwa", outDir: "explicit-web-wrapper" });
    expect(explicit).toMatchObject({ ok: true, kind: "desktop", webTargetId: "web-pwa" });
  }, 60_000);

  it("rejects no-target desktop packaging when multiple native targets have no authored defaults.desktop", async () => {
    const fixture = createProject({
      defaults: { web: "web-pwa" },
      targets: {
        "web-pwa": webTarget(),
        "native-a": nativeTarget("native-a"),
        "native-b": nativeTarget("native-b")
      }
    });

    const result = await captured(() => packageDesktop(fixture.projectDir, { outDir: "implicit-native" }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/explicit|targetId|defaults\.desktop|desktop target/i);
    expect(fs.existsSync(path.join(fixture.projectDir, "implicit-native"))).toBe(false);
  }, 60_000);
});

describe("R19 frozen audit: updater release artifacts", () => {
  it("publishes updater payloads, detached signatures, and signed metadata beside enabled installers", () => {
    const config = JSON.parse(fs.readFileSync(path.join(enabledDir, "src-tauri", "tauri.conf.json"), "utf8"));
    const workflow = generatedWorkflow(enabledDir);

    expect(config.bundle.createUpdaterArtifacts).toBe(true);
    expect(workflow).toMatch(/TAURI_SIGNING_PRIVATE_KEY/);
    expect(workflow).toMatch(/(?:\.sig\b|\*\.sig|signature)/i);
    expect(workflow).toMatch(/(?:\.tar\.gz|\.zip)[\s\S]{0,1200}(?:\.sig\b|signature)|(?:\.sig\b|signature)[\s\S]{0,1200}(?:\.tar\.gz|\.zip)/i);
    expect(workflow).toMatch(/latest\.json/i);
    expect(workflow).toMatch(/latest\.json[\s\S]{0,1600}(?:version|platforms|signature|url)/i);
    expect(workflow).toMatch(/(?:release|files|upload)[^\n]*(?:latest\.json|\.sig)/i);
  });

  it("keeps updater workflow bytes absent when the authored updater is disabled", () => {
    const config = JSON.parse(fs.readFileSync(path.join(disabledDir, "src-tauri", "tauri.conf.json"), "utf8"));
    const cargo = fs.readFileSync(path.join(disabledDir, "src-tauri", "Cargo.toml"), "utf8");
    const rust = fs.readFileSync(path.join(disabledDir, "src-tauri", "src", "lib.rs"), "utf8");
    const player = fs.readFileSync(path.join(disabledDir, "dist", "player.mjs"), "utf8");
    const workflow = generatedWorkflow(disabledDir);
    const exported = `${JSON.stringify(config)}\n${cargo}\n${rust}\n${player}\n${workflow}`;

    expect(exported).not.toMatch(/createUpdaterArtifacts|tauri-plugin-updater|player_check_and_install_update|TAURI_SIGNING_PRIVATE_KEY|latest\.json|\*\.sig/i);
  });

  it("executes the generated updater staging and release assembler scripts end to end", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r19-updater-assembly-"));
    roots.push(root);
    const artifacts = path.join(root, "artifacts");
    const release = path.join(root, "release");
    const output = path.join(root, "github-output.txt");
    fs.mkdirSync(artifacts, { recursive: true });
    for (const name of ["game.dmg", "game.exe", "game.msi", "game.AppImage", "game.deb", "game.rpm"]) {
      fs.writeFileSync(path.join(artifacts, name), name);
    }
    for (const name of ["dmg", "exe", "msi"]) fs.writeFileSync(path.join(artifacts, `signing-status-${name}.txt`), "signed\n");

    const collectScript = path.join(enabledDir, "scripts", "collect-updater-entry.mjs");
    for (const [platform, payloadName] of [
      ["darwin-aarch64", "game.app.tar.gz"],
      ["windows-x86_64", "game.nsis.zip"],
      ["linux-x86_64", "game.AppImage.tar.gz"]
    ]) {
      const input = path.join(root, "updater-input", platform);
      const staged = path.join(root, "updater-staged", platform);
      fs.mkdirSync(input, { recursive: true });
      fs.writeFileSync(path.join(input, payloadName), `payload:${platform}`);
      fs.writeFileSync(path.join(input, `${payloadName}.sig`), `signature:${platform}`);
      execFileSync(process.execPath, [collectScript, input, platform, "https://example.test/release", staged]);
      for (const name of fs.readdirSync(staged)) fs.copyFileSync(path.join(staged, name), path.join(artifacts, name));
    }

    execFileSync(process.execPath, [
      path.join(enabledDir, "scripts", "assemble-release.mjs"),
      artifacts,
      release,
      "1.2.3",
      "https://example.test/commit",
      "https://example.test/tag",
      output
    ]);
    const latest = JSON.parse(fs.readFileSync(path.join(release, "latest.json"), "utf8"));
    expect(latest.version).toBe("1.2.3");
    expect(Object.keys(latest.platforms).sort()).toEqual(["darwin-aarch64", "linux-x86_64", "windows-x86_64"]);
    expect(fs.readFileSync(output, "utf8")).toContain("signed=true");
    expect(fs.readFileSync(path.join(release, "SHA256SUMS"), "utf8").trim().split("\n").length).toBe(13);
  });
});

describe("R19 frozen audit: signing-configured generated workflow", () => {
  it("connects every documented macOS signing and notarization secret to the macOS build", () => {
    const workflow = generatedWorkflow(disabledDir);
    for (const name of [
      "APPLE_CERTIFICATE",
      "APPLE_CERTIFICATE_PASSWORD",
      "APPLE_SIGNING_IDENTITY",
      "APPLE_ID",
      "APPLE_PASSWORD",
      "APPLE_TEAM_ID"
    ]) {
      expect(workflow, name).toContain(`secrets.${name}`);
    }
    expect(workflow).toMatch(/(?:runner\.os\s*==\s*['"]macOS|matrix\.os[\s\S]{0,80}macos)[\s\S]{0,1800}(?:APPLE_CERTIFICATE|APPLE_SIGNING_IDENTITY)/i);
    expect(workflow).toMatch(/(?:APPLE_ID|notari)[\s\S]{0,800}(?:APPLE_PASSWORD|APPLE_TEAM_ID|notari)/i);
  });

  it("imports the documented Windows signing certificate instead of merely naming unused secrets", () => {
    const workflow = generatedWorkflow(disabledDir);

    expect(workflow).toContain("secrets.WINDOWS_CERTIFICATE");
    expect(workflow).toContain("secrets.WINDOWS_CERTIFICATE_PASSWORD");
    expect(workflow).toMatch(/(?:Import-PfxCertificate|certutil[^\n]*-importpfx|signtool)/i);
    expect(workflow).toMatch(/(?:runner\.os\s*==\s*['"]Windows|matrix\.os[\s\S]{0,80}windows)[\s\S]{0,1800}(?:WINDOWS_CERTIFICATE|Import-PfxCertificate|certutil|signtool)/i);
  });

  it("retains the explicitly labelled pre-release path whenever signing is not configured", () => {
    const workflow = generatedWorkflow(disabledDir);

    expect(workflow).toMatch(/Unsigned build/i);
    expect(workflow).toMatch(/prerelease:\s*true/i);
  });
});

describe("R19 frozen audit: repository-owned generated-game acceptance workflow", () => {
  it("builds and verifies all six generated first-class carrier formats on native runners for PR/manual acceptance", () => {
    const workflowPath = path.join(repoRoot, ".github", "workflows", "r19-generated-game-acceptance.yml");
    expect(fs.existsSync(workflowPath), "repository-owned R19 acceptance workflow must exist").toBe(true);
    const workflow = fs.readFileSync(workflowPath, "utf8");

    expect(workflow).toMatch(/workflow_dispatch:/);
    expect(workflow).toMatch(/pull_request:/);
    expect(workflow).toMatch(/(?:package\.mjs|package[^\n]*--kind\s+desktop|packageDesktop)[\s\S]{0,1200}(?:native|desktop)/i);
    for (const runner of ["macos", "windows", "ubuntu"]) expect(workflow, runner).toMatch(new RegExp(`runs-on:[^\\n]*${runner}`, "i"));
    expect(workflow).toMatch(/(?:tauri[^\n]*build|npm[^\n]*build)/i);
    for (const [runner, format] of [
      ["macos", "dmg"],
      ["windows", "nsis"],
      ["windows", "msi"],
      ["ubuntu", "appimage"],
      ["ubuntu", "deb"],
      ["ubuntu", "rpm"]
    ]) {
      expect(workflow, `${runner}/${format}`).toMatch(new RegExp(`${runner}[\\s\\S]{0,3200}${format}`, "i"));
    }
    const acceptanceStart = workflow.search(/(?:^|\n)\s*(?:acceptance|verify)[^:\n]*:/i);
    expect(acceptanceStart).toBeGreaterThanOrEqual(0);
    const acceptance = workflow.slice(acceptanceStart);
    for (const format of ["dmg", "(?:exe|nsis)", "msi", "appimage", "deb", "rpm"]) {
      expect(acceptance, format).toMatch(new RegExp(format, "i"));
    }
  });
});
