import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(path.resolve("packages/studio/public/index.html"), "utf8");
const app = fs.readFileSync(path.resolve("packages/studio/public/app.js"), "utf8");

describe("R4.1A Mechanics Hub rogue-lite surface contract", () => {
  it("keeps tower tags and synergies inside one isolated Mechanics Hub editor", () => {
    expect(html).toContain('id="mechanics-roguelite-editor"');
    expect(html).toContain('id="mechanics-roguelite-tower-tag-rows"');
    expect(html).toContain('id="mechanics-roguelite-synergy-rows"');
    expect(html).toContain('id="btn-mechanics-add-synergy"');
    expect(app).toContain("normalizeRogueliteMechanicsDraft");
    expect(app).toContain("renderRogueliteMechanicsEditor");
    expect(app).toContain("towerTags: deep(MechanicsUI.towerTags)");
  });

  it("keeps future roguelite modules read-only and hides the editor for other modules", () => {
    expect(app).toContain('MechanicsUI.selectedModuleId === "roguelite"');
    expect(app).toContain('mechanicsProjectModuleVersion() === 1');
    expect(app).toContain('$("mechanics-roguelite-editor")?.classList.toggle("hidden", MechanicsUI.selectedModuleId !== "roguelite")');
  });
});
