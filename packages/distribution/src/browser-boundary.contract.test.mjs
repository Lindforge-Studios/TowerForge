import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("R17 distribution browser-safe package boundary", () => {
  it("keeps the data-only package free of Node and host runtime dependencies", () => {
    const source = fs.readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
    expect(source).not.toMatch(/from\s+["']node:|\bBuffer\b|\bprocess\b|\brequire\s*\(/);
  });
});
