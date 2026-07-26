import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(path.resolve("packages/studio/public/index.html"), "utf8");
const app = fs.readFileSync(path.resolve("packages/studio/public/app.js"), "utf8");

describe("R4.1A/R4.2E/R4.3 Mechanics Hub rogue-lite surface contract", () => {
  it("keeps tower tags and synergies inside one isolated Mechanics Hub editor", () => {
    expect(html).toContain('id="mechanics-roguelite-editor"');
    expect(html).toContain('id="mechanics-roguelite-tower-tag-rows"');
    expect(html).toContain('id="mechanics-roguelite-synergy-rows"');
    expect(html).toContain('id="btn-mechanics-add-synergy"');
    expect(app).toContain("normalizeRogueliteMechanicsDraft");
    expect(app).toContain("renderRogueliteMechanicsEditor");
    expect(app).toContain("towerTags: deep(MechanicsUI.towerTags)");
  });

  it("keeps the v2 artifact lifecycle isolated in Mechanics Hub", () => {
    expect(app).toContain('MechanicsUI.selectedModuleId === "roguelite"');
    for (const marker of [
      "mechanics-roguelite-artifact-definition-rows",
      "mechanics-roguelite-tower-slot-rows",
      "mechanics-roguelite-boss-loot-table-rows",
      "btn-mechanics-add-artifact"
    ]) expect(html).toContain(`id="${marker}"`);
    expect(app).toMatch(/normalizeRogueliteArtifact|normalizeRogueliteMechanicsDraft[\s\S]*artifacts/);
    expect(app).toMatch(/renderRogueliteArtifact|renderRogueliteMechanicsEditor[\s\S]*artifacts/);
    expect(app).toContain('$("mechanics-roguelite-editor")?.classList.toggle("hidden", MechanicsUI.selectedModuleId !== "roguelite")');
  });

  it("authors v3 wave draft independently from optional v2 artifacts inside v4 and preserves future v5 read-only", () => {
    for (const marker of [
      "mechanics-roguelite-draft-card-rows",
      "mechanics-roguelite-draft-pool-rows",
      "btn-mechanics-add-draft-card",
      "btn-mechanics-add-draft-pool"
    ]) expect(html).toContain(`id="${marker}"`);
    expect(app).toMatch(/normalizeRogueliteDraft|normalizeRogueliteMechanicsDraft[\s\S]*draft/);
    expect(app).toMatch(/renderRogueliteDraft|renderRogueliteMechanicsEditor[\s\S]*draft/);
    expect(app).toMatch(/MechanicsUI\.draft\?\.draft[\s\S]*Math\.max\([^)]*3|draft[\s\S]*moduleSchemaVersion\s*=\s*3/);
    expect(app).toMatch(/mechanicsProjectModuleVersion\(\)\s*<=\s*4|\[1,\s*2,\s*3,\s*4\][\s\S]*mechanicsProjectModuleVersion/);
    expect(app).toMatch(/future roguelite|schemaVersion 5|v5[\s\S]*read-only/i);
    expect(app).toMatch(/ownDataValue\(source,\s*["']campaign["']\)[\s\S]*draft\.campaign\s*=\s*deep\(campaign\)/);
    expect(app).toMatch(/draft[\s\S]*definitions[\s\S]*pools[\s\S]*defaultPoolId/i);
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

  it("renders the authoritative v4 pending offer and dispatches an exact v3 choice command", () => {
    expect(html).toContain('id="pt-wave-draft"');
    expect(app).toMatch(/presentation\.draft\?\.pendingOffer|presentation\.draft\.pendingOffer/);
    expect(app).toContain("data-pt-draft-card-id");
    expect(app).not.toContain("PT.game.chooseDraftOption(");
    expect(app).toContain("PT.mod.dispatchGameCommand(PT.game, {");
    expect(app).toMatch(/schemaVersion:\s*3,\s*type:\s*"chooseDraftOption"[\s\S]*offerId[\s\S]*cardId/);
  });
});
