import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertReleaseVersions, prepareDesktopRelease } from "./prepare-release.mjs";

const REQUIRED_INSTALLERS = Object.freeze({
  ".dmg": ["mac/TowerForge_0.2.0_aarch64.dmg", "dmg"],
  ".exe": ["windows/TowerForge_0.2.0_x64-setup.exe", "exe"],
  ".msi": ["windows/TowerForge_0.2.0_x64_en-US.msi", "msi"],
  ".AppImage": ["linux/TowerForge_0.2.0_amd64.AppImage", "appimage"],
  ".deb": ["linux/TowerForge_0.2.0_amd64.deb", "deb"],
  ".rpm": ["linux/TowerForge-0.2.0-1.x86_64.rpm", "rpm"]
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-release-"));
  const repoRoot = path.join(root, "repo");
  const inputDir = path.join(root, "artifacts");
  const outputDir = path.join(root, "release");
  fs.mkdirSync(path.join(repoRoot, "packages/desktop/src-tauri"), { recursive: true });
  fs.mkdirSync(path.join(inputDir, "mac"), { recursive: true });
  fs.mkdirSync(path.join(inputDir, "windows"), { recursive: true });
  fs.mkdirSync(path.join(inputDir, "linux"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "package.json"), '{"version":"0.2.0"}\n');
  fs.writeFileSync(path.join(repoRoot, "packages/desktop/package.json"), '{"version":"0.2.0"}\n');
  fs.writeFileSync(path.join(repoRoot, "packages/desktop/src-tauri/tauri.conf.json"), '{"version":"0.2.0"}\n');
  fs.writeFileSync(path.join(repoRoot, "packages/desktop/src-tauri/Cargo.toml"), '[package]\nname="towerforge"\nversion = "0.2.0"\n');
  return { root, repoRoot, inputDir, outputDir };
}

function writeInstallers(dirs, { omit = null } = {}) {
  for (const [extension, [relativePath, contents]] of Object.entries(REQUIRED_INSTALLERS)) {
    if (extension === omit) continue;
    fs.writeFileSync(path.join(dirs.inputDir, relativePath), contents);
  }
}

describe("desktop release preparation", () => {
  it("assembles installers, checksums, and source-linked unsigned notes", () => {
    const dirs = fixture();
    writeInstallers(dirs);
    fs.writeFileSync(path.join(dirs.inputDir, "linux/debug.log"), "ignored");

    const result = prepareDesktopRelease({
      ...dirs,
      tag: "v0.2.0",
      repository: "Lindforge-Studios/TowerForge",
      commitSha: "a".repeat(40)
    });

    const files = Object.values(REQUIRED_INSTALLERS);
    expect(result.installers.map((item) => item.fileName)).toEqual(
      files.map(([filePath]) => path.basename(filePath)).sort((left, right) => left.localeCompare(right))
    );
    expect(result.installers.map((item) => path.extname(item.fileName)).sort()).toEqual(Object.keys(REQUIRED_INSTALLERS).sort());
    const checksums = fs.readFileSync(path.join(dirs.outputDir, "SHA256SUMS"), "utf8");
    expect(checksums.trim().split("\n")).toHaveLength(6);
    for (const [relativePath, contents] of files) {
      const expected = createHash("sha256").update(contents).digest("hex");
      expect(checksums).toContain(`${expected}  ${path.basename(relativePath)}`);
    }
    expect(fs.existsSync(path.join(dirs.outputDir, "debug.log"))).toBe(false);
    const notes = fs.readFileSync(path.join(dirs.outputDir, "RELEASE_NOTES.md"), "utf8");
    expect(notes).toContain("Unsigned build");
    expect(notes).toContain("https://github.com/Lindforge-Studios/TowerForge/tree/v0.2.0");
    expect(notes).toContain("System Settings > Privacy & Security > Open Anyway");
    expect(notes).not.toContain("xattr");
    expect(notes).toContain(`\`\`\`text\n${checksums.trim()}\n\`\`\``);
  });

  it.each(Object.keys(REQUIRED_INSTALLERS))("rejects a candidate missing %s before writing output", (extension) => {
    const dirs = fixture();
    writeInstallers(dirs, { omit: extension });
    expect(() => prepareDesktopRelease({
      ...dirs,
      tag: "v0.2.0",
      repository: "Lindforge-Studios/TowerForge",
      commitSha: "c".repeat(40)
    })).toThrow(new RegExp(`Missing required desktop installer format: ${extension.replace(".", "\\.")}`));
    expect(fs.existsSync(dirs.outputDir)).toBe(false);
  });

  it.each(Object.keys(REQUIRED_INSTALLERS))("rejects duplicate %s installers with distinct basenames", (extension) => {
    const dirs = fixture();
    writeInstallers(dirs);
    const duplicateDir = path.join(dirs.inputDir, "duplicates");
    fs.mkdirSync(duplicateDir);
    fs.writeFileSync(path.join(duplicateDir, `TowerForge-alternate${extension}`), "duplicate");
    expect(() => prepareDesktopRelease({
      ...dirs,
      tag: "v0.2.0",
      repository: "Lindforge-Studios/TowerForge",
      commitSha: "d".repeat(40)
    })).toThrow(new RegExp(`Duplicate desktop installer format: ${extension.replace(".", "\\.")}`));
    expect(fs.existsSync(dirs.outputDir)).toBe(false);
  });

  it("does not accept an unsupported package as a required installer replacement", () => {
    const dirs = fixture();
    writeInstallers(dirs, { omit: ".rpm" });
    fs.writeFileSync(path.join(dirs.inputDir, "linux/TowerForge.pkg"), "unsupported");
    expect(() => prepareDesktopRelease({
      ...dirs,
      tag: "v0.2.0",
      repository: "Lindforge-Studios/TowerForge",
      commitSha: "e".repeat(40)
    })).toThrow(/Missing required desktop installer format: \.rpm/);
    expect(fs.existsSync(dirs.outputDir)).toBe(false);
  });

  it("rejects duplicate installer basenames", () => {
    const dirs = fixture();
    fs.writeFileSync(path.join(dirs.inputDir, "mac/TowerForge.dmg"), "one");
    fs.writeFileSync(path.join(dirs.inputDir, "windows/TowerForge.dmg"), "two");
    expect(() => prepareDesktopRelease({
      ...dirs,
      tag: "v0.2.0",
      repository: "Lindforge-Studios/TowerForge",
      commitSha: "b".repeat(40)
    })).toThrow(/Duplicate release installer basename/);
  });

  it("rejects a release tag that does not match every desktop version", () => {
    const dirs = fixture();
    expect(() => assertReleaseVersions(dirs.repoRoot, "0.3.0")).toThrow(/does not match/);
  });
});
