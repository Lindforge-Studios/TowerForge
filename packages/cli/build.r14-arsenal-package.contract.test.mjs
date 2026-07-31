import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("R14 generated player/package contract", () => {
  it("ships the same engine-owned arsenal projection and v7 commands in Canvas and Phaser players", async () => {
    const source = await readFile(new URL("./build.mjs", import.meta.url), "utf8");
    expect(source).toContain("projectArsenalPresentation");
    expect(source).toContain('id="arsenal-status"');
    expect(source).toContain('schemaVersion: 7, type: "configureTowerModules"');
    expect(source).toContain('schemaVersion: 7, type: "craftGem"');
    expect(source.match(/\$\{arsenalPlayerRuntimeTemplate\(\)\}/g)).toHaveLength(2);
    expect(source.match(/updateArsenalStatus\(snap\);/g)).toHaveLength(2);
  });
});
