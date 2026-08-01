import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("R17 remix export validation performance boundary", () => {
  it("uses the complete already-built engine validator without triggering an implicit engine compile", () => {
    const source = fs.readFileSync(new URL("./remix-pack.mjs", import.meta.url), "utf8");
    expect(source).toContain("validateProjectDirWithBuiltEngine");
    expect(source).not.toMatch(/\bvalidateProjectDir\(projectDir\)/);
  });
});
