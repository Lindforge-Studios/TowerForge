import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { verifyMacosBundle } from "./verify-macos-bundle.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("macOS release signing", () => {
  it("configures Tauri to sign the complete app bundle ad hoc", () => {
    const config = JSON.parse(fs.readFileSync(path.join(repoRoot, "packages/desktop/src-tauri/tauri.conf.json"), "utf8"));
    expect(config.bundle.macOS.signingIdentity).toBe("-");
  });

  it("verifies the app signature before accepting the DMG", () => {
    const calls = [];
    const result = verifyMacosBundle({
      appPath: "/tmp/TowerForge.app",
      dmgPath: "/tmp/TowerForge.dmg",
      exists: () => true,
      run(command, args) {
        calls.push([command, args]);
        return { status: 0, stdout: "", stderr: "" };
      }
    });

    expect(calls).toEqual([
      ["hdiutil", ["verify", "/tmp/TowerForge.dmg"]],
      ["codesign", ["--verify", "--deep", "--strict", "--verbose=4", "/tmp/TowerForge.app"]]
    ]);
    expect(result).toEqual({ appPath: "/tmp/TowerForge.app", dmgPath: "/tmp/TowerForge.dmg" });
  });

  it("mounts the completed DMG when Tauri cleaned the intermediate app bundle", () => {
    const calls = [];
    const cleaned = [];
    const result = verifyMacosBundle({
      dmgPath: "/tmp/TowerForge.dmg",
      exists: (filePath) => filePath === "/tmp/TowerForge.dmg",
      createMountDirectory: () => "/tmp/towerforge-mount",
      listApps: () => ["TowerForge.app"],
      cleanupDirectory: (directory) => cleaned.push(directory),
      run(command, args) {
        calls.push([command, args]);
        return { status: 0, stdout: "", stderr: "" };
      }
    });

    expect(calls).toEqual([
      ["hdiutil", ["verify", "/tmp/TowerForge.dmg"]],
      ["hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", "/tmp/towerforge-mount", "/tmp/TowerForge.dmg"]],
      ["codesign", ["--verify", "--deep", "--strict", "--verbose=4", path.join("/tmp/towerforge-mount", "TowerForge.app")]],
      ["hdiutil", ["detach", "/tmp/towerforge-mount"]]
    ]);
    expect(cleaned).toEqual(["/tmp/towerforge-mount"]);
    expect(result.dmgPath).toBe("/tmp/TowerForge.dmg");
  });

  it("rejects a malformed app signature", () => {
    expect(() => verifyMacosBundle({
      appPath: "/tmp/TowerForge.app",
      dmgPath: "/tmp/TowerForge.dmg",
      exists: () => true,
      run(command) {
        return command === "codesign"
          ? { status: 1, stdout: "", stderr: "code has no resources but signature indicates they must be present" }
          : { status: 0, stdout: "", stderr: "" };
      }
    })).toThrow(/code has no resources/);
  });
});
