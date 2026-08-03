import fs from "node:fs";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync("packages/studio/public/index.html", "utf8");
const app = fs.readFileSync("packages/studio/public/app.js", "utf8");
const server = fs.readFileSync("packages/studio/server.mjs", "utf8");

describe("R20.4 Camera Studio surface (RED)", () => {
  it("offers projection/orientation/profile/binding controls and preview diagnostics", () => {
    for (const id of ["camera-studio", "camera-profile-picker", "camera-profile-id", "camera-projection", "camera-orientation", "camera-binding-scope", "camera-binding-id", "camera-viewport-preset", "camera-fit-padding", "camera-min-zoom", "camera-initial-zoom", "camera-max-zoom", "camera-pan-padding", "camera-elevation-scale", "camera-preview-canvas", "btn-camera-preview", "btn-camera-apply", "btn-camera-disable", "camera-preview-result"]) {
      expect(html, id).toContain(`id="${id}"`);
    }
    expect(html).toMatch(/top_down[\s\S]*isometric_2_1[\s\S]*dimetric_oblique/);
    expect(html).toMatch(/north[\s\S]*east[\s\S]*south[\s\S]*west/);
    expect(app).toMatch(/camera-viewport-preset[\s\S]*camera-preview-canvas[\s\S]*projectedBounds/);
    expect(app).toMatch(/current\.cameraProfiles[\s\S]*camera-profile-picker[\s\S]*(?:fitPadding|camera-fit-padding)/);
  });

  it("authors a build-target cameraProfileId from the same saved profile catalog", () => {
    expect(app).toMatch(/cameraProfiles[\s\S]*cameraProfileId/);
    expect(app).toMatch(/data-f=["'`]cameraProfileId["'`]/);
  });

  it("routes read/recipe/compute-preview/guarded-apply through the narrow MCP contract", () => {
    for (const route of ["/api/camera/read", "/api/camera/recipes", "/api/camera/preview", "/api/camera/apply"]) expect(server).toContain(route);
    expect(server).toMatch(/get_camera_profiles[\s\S]*get_camera_profile_recipe[\s\S]*preview_camera_profile[\s\S]*apply_camera_profile/);
    expect(app).toMatch(/\/api\/camera\/read[\s\S]*\/api\/camera\/recipes[\s\S]*\/api\/camera\/preview[\s\S]*\/api\/camera\/apply/);
    expect(app).toMatch(/projectedBounds[\s\S]*clipping[\s\S]*depth[\s\S]*assetCoverage/);
  });
});
