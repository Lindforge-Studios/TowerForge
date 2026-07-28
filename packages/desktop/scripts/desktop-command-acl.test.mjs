import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve("packages/desktop/src-tauri");
const buildScript = fs.readFileSync(path.join(root, "build.rs"), "utf8");
const rustSource = fs.readFileSync(path.join(root, "src/lib.rs"), "utf8");
const studioSource = fs.readFileSync(path.resolve("packages/studio/public/app.js"), "utf8");
const capability = JSON.parse(fs.readFileSync(path.join(root, "capabilities/main.json"), "utf8"));

const desktopCommands = [
  "desktop_sync_ui_state",
  "desktop_choose_project_parent",
  "desktop_create_project",
  "desktop_open_project",
  "desktop_open_recent",
  "desktop_open_external",
  "desktop_finish_lifecycle"
];

describe("desktop custom-command ACL", () => {
  it("registers every invoke command in the Tauri application manifest", () => {
    expect(buildScript).toMatch(/AppManifest::new\(\)\.commands/);
    for (const command of desktopCommands) expect(buildScript).toContain(`"${command}"`);
  });

  it("grants the main loopback WebView only the registered desktop commands", () => {
    expect(capability.windows).toEqual(["main"]);
    expect(capability.remote?.urls).toEqual(["http://127.0.0.1:*/*"]);
    expect(capability.permissions).toEqual([
      "core:event:allow-listen",
      ...desktopCommands.map((command) => `allow-${command.replaceAll("_", "-")}`)
    ]);
  });

  it("keeps the Rust handler and Studio invoke surface aligned with the manifest", () => {
    for (const command of desktopCommands) {
      expect(rustSource).toMatch(new RegExp(`generate_handler![\\s\\S]*\\b${command}\\b`));
      expect(studioSource).toContain(`desktopInvoke("${command}"`);
    }
  });
});
