import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("R14 Modular Arsenal Studio surface", () => {
  it("keeps authoring in Mechanics Hub and uses authoritative snapshot commands in Playtest", async () => {
    const [html, app] = await Promise.all([
      readFile(new URL("./index.html", import.meta.url), "utf8"),
      readFile(new URL("./app.js", import.meta.url), "utf8")
    ]);
    expect(html).toContain('id="mechanics-arsenal-editor"');
    expect(html).toContain('id="pt-arsenal"');
    expect(app).toContain("projectArsenalPresentation");
    expect(app).toContain('schemaVersion: 7, type: "configureTowerModules"');
    expect(app).toContain('schemaVersion: 7, type: "craftGem"');
    expect(app).not.toContain("PT.game.configureTowerModules(");
    expect(app).not.toContain("PT.game.craftGem(");
  });
});
