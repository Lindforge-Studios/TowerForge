import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importProjectAsset } from "../cli/lib/assets.mjs";
import {
  applyHudProfile,
  getHudProfileRecipe,
  getHudProfiles,
  previewHudProfile
} from "../cli/lib/hud-authoring.mjs";

const model = await import("./public/hud-studio-model.mjs").catch(() => null);
const appSource = fs.readFileSync("packages/studio/public/app.js", "utf8");
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function helper(name) {
  expect(model?.[name], `${name} must be exported by the browser-safe Studio model`).toBeTypeOf("function");
  return model[name];
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r21-atlas-import-"));
  roots.push(projectDir);
  fs.cpSync(path.resolve("examples/starter.tdproj"), projectDir, { recursive: true });
  const projectPath = path.join(projectDir, "project.json");
  const project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  writeJson(projectPath, { ...project, schemaVersion: 5 });
  writeJson(path.join(projectDir, "build-targets.json"), {
    schemaVersion: 2,
    defaults: { web: "desktop-hud" },
    targets: {
      "desktop-hud": {
        id: "desktop-hud",
        platform: "web",
        renderer: "canvas",
        webDir: "dist-hud",
        formFactor: "desktop",
        viewport: { fit: "contain", padding: 24, minZoom: 0.5, maxZoom: 4, initialZoom: 1 },
        quality: "high",
        locale: "en",
        inputProfile: "hybrid"
      }
    }
  });
  fs.mkdirSync(path.join(projectDir, "imports"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "imports", "command-atlas.png"), Buffer.from("atlas fixture"));
  return projectDir;
}

describe("R21 verifier regression: HUD atlas-frame import and role binding (RED)", () => {
  it("imports a visuals sprite and completes guarded HUD preview/apply/reload", () => {
    const resolveImportKind = helper("resolveHudStudioAssetImportKind");
    const upsertRole = helper("upsertHudStudioAssetRole");
    expect(resolveImportKind("atlas_frame")).toBe("sprite");
    expect(appSource).toMatch(/resolveHudStudioAssetImportKind[\s\S]*\/api\/assets\/import/);

    const projectDir = fixture();
    const visualsPath = path.join(projectDir, "content", "visuals.json");
    const visuals = JSON.parse(fs.readFileSync(visualsPath, "utf8"));
    const imported = importProjectAsset(projectDir, visuals, {
      sourcePath: "imports/command-atlas.png",
      targetPath: "ui/command-atlas.png",
      id: "ui_command_frame",
      kind: resolveImportKind("atlas_frame")
    });
    expect(imported.asset.kind).toBe("sprite");
    expect(imported.visuals.sprites.ui_command_frame).toMatchObject({ src: "assets/ui/command-atlas.png" });
    expect(imported.visuals.atlases.ui_command_frame).toBeUndefined();
    writeJson(visualsPath, imported.visuals);

    const recipe = getHudProfileRecipe("desktop_quickbar", "main");
    const profile = upsertRole(structuredClone(recipe.profile), {
      roleId: "command_frame",
      spriteId: imported.asset.id,
      metadata: { schemaVersion: 1, kind: "atlas_frame", atlasFrame: "command_idle" }
    });
    const request = {
      profileId: "main",
      profile,
      binding: { targetId: "desktop-hud", enabled: true }
    };
    const preview = previewHudProfile(projectDir, request);
    expect(preview).toMatchObject({ ok: true, dryRun: true, written: false });
    const applied = applyHudProfile(projectDir, { ...request, ifRevision: preview.revision });
    expect(applied).toMatchObject({ ok: true, written: true, rolledBack: false });
    expect(getHudProfiles(projectDir).profiles.main).toMatchObject({
      assetRoles: { command_frame: "ui_command_frame" },
      assetMetadata: {
        command_frame: { schemaVersion: 1, kind: "atlas_frame", atlasFrame: "command_idle" }
      }
    });
  });
});
