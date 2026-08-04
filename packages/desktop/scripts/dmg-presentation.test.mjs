import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const tauriRoot = path.join(repoRoot, "packages/desktop/src-tauri");

function readPngSize(filePath) {
  const bytes = fs.readFileSync(filePath);
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  };
}

describe("macOS DMG presentation", () => {
  it("uses a compact branded install surface with explicit drag targets", () => {
    const config = JSON.parse(fs.readFileSync(path.join(tauriRoot, "tauri.conf.json"), "utf8"));
    expect(config.bundle.macOS.dmg).toEqual({
      background: "dmg-background.png",
      windowPosition: { x: 200, y: 120 },
      windowSize: { width: 660, height: 420 },
      appPosition: { x: 180, y: 255 },
      applicationFolderPosition: { x: 480, y: 255 }
    });
  });

  it("ships a background matching the authored Finder content size", () => {
    expect(readPngSize(path.join(tauriRoot, "dmg-background.png"))).toEqual({
      width: 660,
      height: 420
    });
  });
});
