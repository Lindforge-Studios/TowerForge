import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { packageDesktop, packageMobile, packageWeb } from "./packaging.mjs";
import { normalizeVisuals, validateProjectSchemas } from "./project-schema.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dir, "../../..");
const roots = [];

beforeAll(() => {
  if (!fs.existsSync(path.join(repoRoot, "packages/engine/dist/index.js"))) {
    execFileSync("npm", ["run", "build:engine"], { cwd: repoRoot, stdio: "ignore" });
  }
});

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

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

function desktopTarget(appVersion = "1.2.3") {
  return {
    id: "native-desktop",
    platform: "desktop",
    renderer: "canvas",
    appId: "com.example.verifier",
    appName: "Verifier Game",
    appVersion,
    formFactor: "desktop",
    viewport: { fit: "contain", padding: 24, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
    quality: "balanced",
    locale: "auto",
    inputProfile: "keyboard_mouse",
    window: { width: 1280, height: 720, minWidth: 1024, minHeight: 720, fullscreen: false, resizable: true },
    bundle: { iconSource: "assets/app-icon.png", targets: ["dmg"] }
  };
}

function androidTarget() {
  const target = webTarget();
  return { ...target, id: "android-app", platform: "android" };
}

function detachedProjectFiles(target) {
  return {
    projectDir: "/detached/r19-verifier.tdproj",
    manifest: { schemaVersion: 5, name: "R19 verifier" },
    balance: { missions: {} },
    maps: {},
    mapSources: {},
    worldMap: { width: 1, height: 1, regions: [], missionNodes: [] },
    mechanics: undefined,
    distribution: undefined,
    visuals: normalizeVisuals({}),
    storyComics: { seenStoragePrefix: "story_seen_", comics: {} },
    battleBackgrounds: { fallbackMissionId: "", placeholderMissionIds: [], definitions: {} },
    buildTargets: {
      schemaVersion: 2,
      defaults: { desktop: "native-desktop" },
      targets: { "native-desktop": target }
    },
    scripts: {},
    scriptFiles: {},
    scriptIssues: []
  };
}

function validationIssues(target) {
  return validateProjectSchemas(detachedProjectFiles(target)).issues.filter((issue) => issue.entityKind === "buildTargets");
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r19-verifier-boundary-"));
  roots.push(root);
  execFileSync(process.execPath, [path.join(repoRoot, "packages/cli/create.mjs"), "game", "--dir", root, "--template", "classic"], { stdio: "ignore" });
  const projectDir = path.join(root, "game.tdproj");
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.schemaVersion = 5;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const icon = new PNG({ width: 1024, height: 1024 });
  icon.data.fill(0x49);
  fs.mkdirSync(path.join(projectDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "assets", "app-icon.png"), PNG.sync.write(icon));
  fs.writeFileSync(path.join(projectDir, "build-targets.json"), `${JSON.stringify({
    schemaVersion: 2,
    defaults: { web: "web-pwa", desktop: "native-desktop" },
    targets: { "web-pwa": webTarget(), "native-desktop": desktopTarget(), "android-app": androidTarget() }
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

describe("R19 verifier packaging boundaries", () => {
  it.each([
    ["mobile", packageMobile],
    ["portable web", packageWeb]
  ])("rejects an explicitly selected desktop target for %s packaging instead of borrowing a web target", async (_label, packageKind) => {
    const { projectDir } = fixture();
    const outDir = `explicit-non-web-${_label.replace(/\s+/g, "-")}`;
    const result = await captured(() => packageKind(projectDir, { targetId: "native-desktop", outDir }));

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/explicit|desktop|web target|non-web|incompatible/i);
    expect(fs.existsSync(path.join(projectDir, outDir))).toBe(false);
  }, 60_000);

  it.each([
    ["mobile", packageMobile],
    ["portable web", packageWeb],
    ["desktop", packageDesktop]
  ])("rejects an explicitly selected Android/non-web target for %s packaging without fallback", async (_label, packageKind) => {
    const { projectDir } = fixture();
    const outDir = `explicit-android-${_label.replace(/\s+/g, "-")}`;
    const result = await captured(() => packageKind(projectDir, { targetId: "android-app", outDir }));

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/explicit|android|web target|non-web|incompatible|desktop packaging/i);
    expect(fs.existsSync(path.join(projectDir, outDir))).toBe(false);
  }, 60_000);

  it("retains only the documented explicit web-target compatibility adapter for desktop packaging", async () => {
    const { projectDir } = fixture();
    const result = await packageDesktop(projectDir, { targetId: "web-pwa", outDir: "legacy-adapter" });

    expect(result.ok, result.error).toBe(true);
    expect(result).toMatchObject({ kind: "desktop", webTargetId: "web-pwa" });
  }, 60_000);

  it.each([
    ["non-string", 123],
    ["empty", ""],
    ["partial", "1.2"],
    ["v prefix", "v1.2.3"],
    ["leading zero", "01.2.3"],
    ["Cargo/TOML newline injection", "1.2.3\"\n[dependencies]\ninjected = \"1"],
    ["JSON newline injection", "1.2.3\nmalicious"]
  ])("rejects %s appVersion as a strict SemVer string", (_label, appVersion) => {
    expect(validationIssues(desktopTarget(appVersion))).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "buildTargets",
      fieldPath: "targets.native-desktop.appVersion"
    }));
  });

  it.each(["1.2.3", "1.2.3-alpha.1", "1.2.3+build.7", "1.2.3-rc.1+build.7"])(
    "accepts strict SemVer appVersion %s",
    (appVersion) => {
      expect(validationIssues(desktopTarget(appVersion))).toEqual([]);
    }
  );

  it("rejects a direct build output whose intermediate symlink escapes before mutating the outside directory", () => {
    const { root, projectDir } = fixture();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r19-build-outside-"));
    roots.push(outside);
    const outsideBuild = path.join(outside, "direct");
    fs.mkdirSync(outsideBuild, { recursive: true });
    const sentinel = path.join(outsideBuild, "sentinel.txt");
    fs.writeFileSync(sentinel, "unchanged", "utf8");
    fs.symlinkSync(outside, path.join(projectDir, "escape"), "dir");

    const result = spawnSync(process.execPath, [
      path.join(repoRoot, "packages/cli/build.mjs"),
      "--project", projectDir,
      "--target", "web-pwa",
      "--out", "escape/direct",
      "--json"
    ], { cwd: repoRoot, encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: expect.stringMatching(/outside|symlink|project/i) });
    expect(fs.readFileSync(sentinel, "utf8")).toBe("unchanged");
    expect(fs.readdirSync(outsideBuild)).toEqual(["sentinel.txt"]);
    expect(fs.existsSync(root)).toBe(true);
  }, 60_000);

  it("rejects a package output whose intermediate symlink escapes before any outside scaffold mutation", async () => {
    const { projectDir } = fixture();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r19-package-outside-"));
    roots.push(outside);
    const outsidePackage = path.join(outside, "native");
    fs.mkdirSync(outsidePackage, { recursive: true });
    const sentinel = path.join(outsidePackage, "sentinel.txt");
    fs.writeFileSync(sentinel, "unchanged", "utf8");
    fs.symlinkSync(outside, path.join(projectDir, "escape"), "dir");

    const result = await captured(() => packageDesktop(projectDir, {
      targetId: "native-desktop",
      outDir: "escape/native"
    }));

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/outside|symlink|project/i);
    expect(fs.readFileSync(sentinel, "utf8")).toBe("unchanged");
    expect(fs.readdirSync(outsidePackage)).toEqual(["sentinel.txt"]);
  }, 60_000);

  it.skipIf(process.platform === "win32")("rejects an existing generated file symlink before repack can overwrite its external target", async () => {
    const { projectDir } = fixture();
    const first = await packageDesktop(projectDir, { targetId: "native-desktop", outDir: "native" });
    expect(first.ok, first.error).toBe(true);

    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r19-scaffold-file-outside-"));
    roots.push(outside);
    const sentinel = path.join(outside, "Cargo.toml");
    fs.writeFileSync(sentinel, "external sentinel\n", "utf8");
    const generatedCargo = path.join(projectDir, "native", "src-tauri", "Cargo.toml");
    fs.unlinkSync(generatedCargo);
    fs.symlinkSync(sentinel, generatedCargo, "file");

    const second = await captured(() => packageDesktop(projectDir, {
      targetId: "native-desktop",
      outDir: "native"
    }));

    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/outside|symlink|project/i);
    expect(fs.readFileSync(sentinel, "utf8")).toBe("external sentinel\n");
    expect(fs.lstatSync(generatedCargo).isSymbolicLink()).toBe(true);
  }, 60_000);
});
