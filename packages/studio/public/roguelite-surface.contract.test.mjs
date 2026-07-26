import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(path.resolve("packages/studio/public/index.html"), "utf8");
const app = fs.readFileSync(path.resolve("packages/studio/public/app.js"), "utf8");

describe("R4.1A/R4.2E Mechanics Hub rogue-lite surface contract", () => {
  it("keeps tower tags and synergies inside one isolated Mechanics Hub editor", () => {
    expect(html).toContain('id="mechanics-roguelite-editor"');
    expect(html).toContain('id="mechanics-roguelite-tower-tag-rows"');
    expect(html).toContain('id="mechanics-roguelite-synergy-rows"');
    expect(html).toContain('id="btn-mechanics-add-synergy"');
    expect(app).toContain("normalizeRogueliteMechanicsDraft");
    expect(app).toContain("renderRogueliteMechanicsEditor");
    expect(app).toContain("towerTags: deep(MechanicsUI.towerTags)");
  });

  it("keeps the v2 artifact lifecycle isolated in Mechanics Hub and future v3 read-only", () => {
    expect(app).toContain('MechanicsUI.selectedModuleId === "roguelite"');
    for (const marker of [
      "mechanics-roguelite-artifact-definition-rows",
      "mechanics-roguelite-tower-slot-rows",
      "mechanics-roguelite-boss-loot-table-rows",
      "btn-mechanics-add-artifact"
    ]) expect(html).toContain(`id="${marker}"`);
    expect(app).toMatch(/normalizeRogueliteArtifact|normalizeRogueliteMechanicsDraft[\s\S]*artifacts/);
    expect(app).toMatch(/renderRogueliteArtifact|renderRogueliteMechanicsEditor[\s\S]*artifacts/);
    expect(app).toMatch(/mechanicsProjectModuleVersion\(\)\s*<=\s*2|\[1,\s*2\][\s\S]*mechanicsProjectModuleVersion/);
    expect(app).toMatch(/future roguelite|schemaVersion 3|v3[\s\S]*read-only/i);
    expect(app).toContain('$("mechanics-roguelite-editor")?.classList.toggle("hidden", MechanicsUI.selectedModuleId !== "roguelite")');
  });

  it("uses the authoritative v3 snapshot for accessible playtest socket controls", () => {
    expect(html).toContain('id="pt-artifact-inventory"');
    expect(app).toContain("PT.rmod.projectRoguelitePresentation(snapshot)");
    expect(app).not.toContain("PT.game.socketArtifact(");
    expect(app).not.toContain("PT.game.unsocketArtifact(");
    expect(app).toContain("PT.mod.dispatchGameCommand(PT.game, {");
    expect(app).toContain('schemaVersion: 2, type: "socketArtifact"');
    expect(app).toContain('schemaVersion: 2, type: "unsocketArtifact"');
    expect(app).toContain("data-pt-artifact-action");
  });
});
