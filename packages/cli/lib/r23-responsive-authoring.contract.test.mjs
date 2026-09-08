import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createProject } from "./create-project.mjs";
import { getPlayerTargetRecipe, previewPlayerTarget, applyPlayerTarget, readPlayerTargets } from "./player-target-authoring.mjs";

describe("R23 explicit responsive transition", () => {
  it("previews without writes, discloses timing, applies with revision and preserves legacy targets", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tf-r23-authoring-"));
    try {
      const { projectDir } = createProject({ name: "Ready", parentDir: root, templateName: "classic", gridKind: "hex" });
      const before = readPlayerTargets(projectDir);
      const recipe = getPlayerTargetRecipe(projectDir, "responsive_web_mobile", "responsive");
      expect(recipe.target).toEqual(JSON.parse(fs.readFileSync("docs/examples/opt-in-responsive-player/target.json", "utf8")));
      expect(recipe.target).toMatchObject({ formFactor: "responsive", platform: "web", inputProfile: "hybrid" });
      expect(recipe.timingNotice).toMatch(/fixed|FPS/i);
      expect(readPlayerTargets(projectDir)).toEqual(before);
      const preview = previewPlayerTarget(projectDir, "responsive", recipe.target);
      expect(preview.ok).toBe(true);
      expect(preview.timingNotice).toBe(recipe.timingNotice);
      expect(readPlayerTargets(projectDir)).toEqual(before);
      expect(applyPlayerTarget(projectDir, "responsive", recipe.target, { ifRevision: preview.revision }).ok).toBe(true);
      const after = readPlayerTargets(projectDir);
      expect(after.projectSchemaVersion).toBe(5);
      expect(after.buildTargetsSchemaVersion).toBe(2);
      for (const [id, target] of Object.entries(before.targets)) expect(after.targets[id]).toEqual(target);
      expect(after.defaults).toEqual(before.defaults);
      expect(applyPlayerTarget(projectDir, "responsive", recipe.target, { ifRevision: before.revision })).toMatchObject({ conflict: true, written: false });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
