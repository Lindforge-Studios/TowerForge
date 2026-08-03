import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyCameraProfile,
  getCameraProfileRecipe,
  previewCameraProfile
} from "../cli/lib/camera-authoring.mjs";

const roots = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture({ completeView = false } = {}) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r20-camera-hardening-"));
  roots.push(projectDir);
  fs.cpSync(path.resolve("examples/starter.tdproj"), projectDir, { recursive: true });
  const projectPath = path.join(projectDir, "project.json");
  const visualsPath = path.join(projectDir, "content", "visuals.json");
  const project = readJson(projectPath);
  const visuals = readJson(visualsPath);
  const viewKey = "isometric_2_1:north";
  writeJson(projectPath, { ...project, schemaVersion: 5 });
  writeJson(visualsPath, {
    ...visuals,
    schemaVersion: 4,
    atlases: { ...visuals.atlases, camera_test_tiles: { src: "assets/backgrounds/frontier-before-battle.png" } },
    sprites: { ...visuals.sprites, camera_test_tile: { src: "assets/backgrounds/frontier-before-battle.png" } },
    tileSets: {
      camera_test_ground: {
        id: "camera_test_ground",
        atlas: "camera_test_tiles",
        tileWidth: 1,
        tileHeight: 1,
        margin: 0,
        spacing: 0,
        topology: "square",
        ruleKind: "random",
        materials: {
          buildable: { signatures: { random: [{ spriteId: "camera_test_tile", weight: 1 }] } }
        }
      }
    },
    viewVariants: {
      schemaVersion: 1,
      sprites: {},
      tileSets: completeView ? {
        camera_test_ground: {
          [viewKey]: {
            atlas: { src: "assets/backgrounds/frontier-before-battle.png", mimeType: "image/png" },
            materials: {
              buildable: { signatures: { random: [{ spriteId: "camera_test_tile", weight: 1 }] } }
            }
          }
        }
      } : {}
    }
  });
  return projectDir;
}

function candidate(projectDir, profileId = "iso-hardening") {
  return {
    profileId,
    profile: getCameraProfileRecipe("isometric_2_1", "north", profileId).profile,
    binding: { scope: "mission", id: "tutorial_01" },
    context: { missionId: "tutorial_01", mapId: "tutorial_map", viewport: { width: 1440, height: 900 } }
  };
}

function ownedBytes(projectDir) {
  return {
    project: fs.readFileSync(path.join(projectDir, "project.json")),
    visuals: fs.readFileSync(path.join(projectDir, "content", "visuals.json"))
  };
}

describe("R20 camera authoring hardening contracts (RED)", () => {
  it("blocks preview and apply when mandatory view material coverage is missing", () => {
    const projectDir = fixture();
    const before = ownedBytes(projectDir);
    const request = candidate(projectDir);
    const preview = previewCameraProfile(projectDir, request);

    expect(preview.preview.diagnostics.assetCoverage.missingRequired).not.toEqual([]);
    expect(preview).toMatchObject({ ok: false, written: false });
    const applied = applyCameraProfile(projectDir, { ...request, ifRevision: preview.revision });
    expect(applied).toMatchObject({ ok: false, written: false });
    expect(ownedBytes(projectDir)).toEqual(before);
  });

  it("rejects accessors before executing them and returns a stable own-data diagnostic", () => {
    const projectDir = fixture({ completeView: true });
    const request = candidate(projectDir, "accessor");
    let getterCalls = 0;
    const profile = { ...request.profile };
    Object.defineProperty(profile, "projection", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "isometric_2_1";
      }
    });

    const preview = previewCameraProfile(projectDir, { ...request, profile });
    expect(getterCalls).toBe(0);
    expect(preview).toMatchObject({ ok: false, written: false });
    expect(preview.validation.issues[0].message).toMatch(/own[- ]data|accessor/i);
  });

  it("fails closed for revoked proxies and cyclic profile input without constructing a simulation", () => {
    const projectDir = fixture({ completeView: true });
    const request = candidate(projectDir, "hostile");
    const revocable = Proxy.revocable({ ...request.profile }, {});
    revocable.revoke();
    expect(() => previewCameraProfile(projectDir, { ...request, profile: revocable.proxy })).not.toThrow();
    expect(previewCameraProfile(projectDir, { ...request, profile: revocable.proxy })).toMatchObject({ ok: false, written: false });

    const cyclic = { ...request.profile };
    cyclic.loop = cyclic;
    expect(() => previewCameraProfile(projectDir, { ...request, profile: cyclic })).not.toThrow();
    expect(previewCameraProfile(projectDir, { ...request, profile: cyclic })).toMatchObject({ ok: false, written: false });
  });

  it("rejects a thirty-third authored profile without changing project files", () => {
    const projectDir = fixture({ completeView: true });
    const visualsPath = path.join(projectDir, "content", "visuals.json");
    const visuals = readJson(visualsPath);
    const profiles = {};
    for (let index = 0; index < 32; index += 1) {
      const id = `camera-${String(index).padStart(2, "0")}`;
      profiles[id] = getCameraProfileRecipe("top_down", "north", id).profile;
    }
    visuals.cameraProfiles = { schemaVersion: 1, profiles, bindings: { maps: {}, missions: {} } };
    writeJson(visualsPath, visuals);
    const before = ownedBytes(projectDir);
    const preview = previewCameraProfile(projectDir, candidate(projectDir, "camera-overflow"));
    expect(preview).toMatchObject({ ok: false, written: false });
    expect(ownedBytes(projectDir)).toEqual(before);
  });

  it("atomically restores both files and removes temporary files after an injected second rename failure", () => {
    const projectDir = fixture({ completeView: true });
    const request = candidate(projectDir, "rollback");
    const preview = previewCameraProfile(projectDir, request);
    expect(preview.ok).toBe(true);
    const before = ownedBytes(projectDir);
    const realRename = fs.renameSync.bind(fs);
    let renameCount = 0;
    vi.spyOn(fs, "renameSync").mockImplementation((...args) => {
      renameCount += 1;
      if (renameCount === 2) throw new Error("injected second camera rename failure");
      return realRename(...args);
    });

    const applied = applyCameraProfile(projectDir, { ...request, ifRevision: preview.revision });
    expect(applied).toMatchObject({ ok: false, written: false, rolledBack: true });
    expect(ownedBytes(projectDir)).toEqual(before);
    expect(fs.readdirSync(path.join(projectDir, "content")).filter((name) => name.includes(".tmp."))).toEqual([]);
  });

  it("reuses the existing guarded import tool instead of exposing a broad camera asset writer", async () => {
    const { TOOLS } = await import("./tools.mjs");
    const names = TOOLS.map((tool) => tool.name);
    expect(names).toContain("import_asset");
    expect(names).not.toEqual(expect.arrayContaining(["import_camera_asset", "write_camera_assets", "replace_view_variants"]));
  });
});

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
