import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("R15 Studio and player surfaces", () => {
  it("keeps macro-economy in a separate Mechanics Hub editor and playtest panel", async () => {
    const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
    const app = await readFile(new URL("./app.js", import.meta.url), "utf8");
    expect(html).toContain('id="mechanics-macro-economy-editor"');
    expect(html).toContain('id="pt-macro-economy"');
    expect(app).toMatch(/type:\s*side === "buy" \? "buyCommodity" : "sellCommodity"/);
    expect(app).toContain('type: "performRitual"');
  });
});
