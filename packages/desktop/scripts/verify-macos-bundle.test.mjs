import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultMacosBundleRoot, verifyMacosBundle } from "./verify-macos-bundle.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("macOS release signing", () => {
  it("prefers the explicit ARM64 target directory used by desktop:build:mac", () => {
    const cwd = "/repo/packages/desktop";
    const armRoot = path.join(cwd, "src-tauri/target/aarch64-apple-darwin/release/bundle");
    expect(defaultMacosBundleRoot({ cwd, exists: (candidate) => candidate === armRoot })).toBe(armRoot);
  });
  it("configures Tauri to sign the complete app bundle ad hoc", () => {
    const config = JSON.parse(fs.readFileSync(path.join(repoRoot, "packages/desktop/src-tauri/tauri.conf.json"), "utf8"));
    expect(config.bundle.macOS.signingIdentity).toBe("-");
    expect(config.bundle.macOS.entitlements).toBe("Entitlements.plist");
    const entitlements = fs.readFileSync(
      path.join(repoRoot, "packages/desktop/src-tauri/Entitlements.plist"),
      "utf8"
    );
    expect(entitlements).toContain("com.apple.security.cs.allow-jit");
    expect(entitlements).toContain("com.apple.security.cs.allow-unsigned-executable-memory");
  });

  it("verifies the app signature before accepting the DMG", () => {
    const calls = [];
    const result = verifyMacosBundle({
      appPath: "/tmp/TowerForge.app",
      dmgPath: "/tmp/TowerForge.dmg",
      exists: () => true,
      run(command, args) {
        calls.push([command, args]);
        return {
          status: 0,
          stdout: command === "lipo"
            ? "arm64"
            : command.endsWith("/Contents/MacOS/node") ? "towerforge-node-ready" : "",
          stderr: ""
        };
      }
    });

    expect(calls).toEqual([
      ["hdiutil", ["verify", "/tmp/TowerForge.dmg"]],
      ["codesign", ["--verify", "--deep", "--strict", "--verbose=4", "/tmp/TowerForge.app"]],
      ["lipo", ["-archs", path.join("/tmp/TowerForge.app", "Contents/MacOS/towerforge_desktop")]],
      [path.join("/tmp/TowerForge.app", "Contents/MacOS/node"), ["-e", "process.stdout.write('towerforge-node-ready')"]]
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
        return {
          status: 0,
          stdout: command === "lipo"
            ? "arm64"
            : command.endsWith("/Contents/MacOS/node") ? "towerforge-node-ready" : "",
          stderr: ""
        };
      }
    });

    expect(calls).toEqual([
      ["hdiutil", ["verify", "/tmp/TowerForge.dmg"]],
      ["hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", "/tmp/towerforge-mount", "/tmp/TowerForge.dmg"]],
      ["codesign", ["--verify", "--deep", "--strict", "--verbose=4", path.join("/tmp/towerforge-mount", "TowerForge.app")]],
      ["lipo", ["-archs", path.join("/tmp/towerforge-mount", "TowerForge.app", "Contents/MacOS/towerforge_desktop")]],
      [path.join("/tmp/towerforge-mount", "TowerForge.app", "Contents/MacOS/node"), ["-e", "process.stdout.write('towerforge-node-ready')"]],
      ["hdiutil", ["detach", "/tmp/towerforge-mount"]]
    ]);
    expect(cleaned).toEqual(["/tmp/towerforge-mount"]);
    expect(result.dmgPath).toBe("/tmp/TowerForge.dmg");
  });

  it("retries a busy read-only validation mount before forcing its detach", () => {
    const detachCalls = [];
    verifyMacosBundle({
      dmgPath: "/tmp/TowerForge.dmg",
      exists: (filePath) => filePath === "/tmp/TowerForge.dmg",
      createMountDirectory: () => "/tmp/towerforge-mount",
      listApps: () => ["TowerForge.app"],
      cleanupDirectory: () => {},
      run(command, args) {
        if (command === "hdiutil" && args[0] === "detach") {
          detachCalls.push(args);
          return detachCalls.length < 3
            ? { status: 1, stdout: "", stderr: "Resource busy" }
            : { status: 0, stdout: "", stderr: "" };
        }
        return {
          status: 0,
          stdout: command === "lipo"
            ? "arm64"
            : command.endsWith("/Contents/MacOS/node") ? "towerforge-node-ready" : "",
          stderr: ""
        };
      }
    });

    expect(detachCalls).toEqual([
      ["detach", "/tmp/towerforge-mount"],
      ["detach", "/tmp/towerforge-mount"],
      ["detach", "-force", "/tmp/towerforge-mount"]
    ]);
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

  it("rejects a signed bundle whose hardened Node sidecar cannot initialize V8", () => {
    expect(() => verifyMacosBundle({
      appPath: "/tmp/TowerForge.app",
      dmgPath: "/tmp/TowerForge.dmg",
      exists: () => true,
      run(command) {
        if (command === "lipo") return { status: 0, stdout: "arm64", stderr: "" };
        return command.endsWith("/Contents/MacOS/node")
          ? { status: 1, stdout: "", stderr: "Fatal error: SetPermissions" }
          : { status: 0, stdout: "", stderr: "" };
      }
    })).toThrow(/Node sidecar|SetPermissions/i);
  });

  it("rejects a macOS bundle that does not contain the promised arm64 executable", () => {
    expect(() => verifyMacosBundle({
      appPath: "/tmp/TowerForge.app",
      dmgPath: "/tmp/TowerForge.dmg",
      exists: () => true,
      run(command) {
        return command === "lipo"
          ? { status: 0, stdout: "x86_64", stderr: "" }
          : { status: 0, stdout: "", stderr: "" };
      }
    })).toThrow(/arm64|architecture/i);
  });
});
