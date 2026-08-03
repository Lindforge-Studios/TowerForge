import fs from "node:fs";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync("packages/studio/public/index.html", "utf8");
const app = fs.readFileSync("packages/studio/public/app.js", "utf8");
const styles = fs.readFileSync("packages/studio/public/styles.css", "utf8");
const server = fs.readFileSync("packages/studio/server.mjs", "utf8");

function expectIds(source, ids) {
  for (const id of ids) expect(source, id).toContain(`id="${id}"`);
}

describe("R21.5 HUD Studio and guarded asset workflow (RED)", () => {
  it("adds a dedicated HUD Studio hub with saved-profile, target and screen selection", () => {
    expect(html).toMatch(/data-tab=["']hud["']/);
    expect(html).toContain('id="tab-hud"');
    expectIds(html, [
      "hud-studio", "hud-studio-state", "hud-profile-picker", "hud-profile-id",
      "hud-target-picker", "hud-screen-picker", "hud-variant-picker"
    ]);
    expect(app).toMatch(/HUDStudioUI[\s\S]*hud-profile-picker[\s\S]*hud-target-picker[\s\S]*hud-screen-picker/);
  });

  it("provides the bounded WYSIWYG device, safe-area and constraint authoring tools", () => {
    expectIds(html, [
      "hud-device-preset", "hud-safe-area-top", "hud-safe-area-right", "hud-safe-area-bottom",
      "hud-safe-area-left", "hud-rulers-toggle", "hud-snapping-toggle", "hud-design-canvas",
      "hud-layers-tree", "hud-constraint-inspector"
    ]);
    expect(html).toMatch(/1920\s*[×x]\s*1080[\s\S]*1024\s*[×x]\s*768[\s\S]*390\s*[×x]\s*844/i);
    expect(app).toMatch(/hud-device-preset[\s\S]*(?:safeArea|hud-safe-area)[\s\S]*(?:snap|snapping)[\s\S]*hud-layers-tree/);
    expect(styles).toMatch(/#hud-design-canvas|\.hud-design-canvas/);
  });

  it("previews component states and authored mock snapshots with actionable accessibility diagnostics", () => {
    expectIds(html, [
      "hud-component-state", "hud-mock-state", "hud-preview-canvas", "hud-preview-diagnostics"
    ]);
    expect(html).toMatch(/normal[\s\S]*hover[\s\S]*pressed[\s\S]*disabled[\s\S]*selected[\s\S]*focused/);
    expect(html).toMatch(/victory[\s\S]*defeat[\s\S]*low[_ -]?hp[\s\S]*draft[\s\S]*inventory[\s\S]*capabilit/i);
    expect(app).toMatch(/(?:overlap|overlapping)[\s\S]*(?:clipped|clipping)[\s\S]*(?:low_contrast|contrast)[\s\S]*(?:interactive_target_below_44|44\s*px)/i);
    expect(app).toMatch(/hud-component-state[\s\S]*hud-mock-state[\s\S]*hud-preview-diagnostics/);
  });

  it("routes read, recipe, compute preview, guarded apply and render preview through the narrow HUD contract", () => {
    for (const route of [
      "/api/hud/read", "/api/hud/recipes", "/api/hud/preview", "/api/hud/apply", "/api/hud/render-preview"
    ]) expect(server, route).toContain(route);
    expect(server).toMatch(/get_hud_profiles[\s\S]*get_hud_profile_recipe[\s\S]*preview_hud_profile[\s\S]*apply_hud_profile/);
    expect(app).toMatch(/\/api\/hud\/read[\s\S]*\/api\/hud\/recipes[\s\S]*\/api\/hud\/preview[\s\S]*\/api\/hud\/apply/);
    expect(app).toMatch(/HUDStudioUI\.(?:revision|preview)[\s\S]*ifRevision[\s\S]*\/api\/hud\/apply/);
    expect(server).toMatch(/result\?\.conflict\s*\?\s*409/);
    expect(server).toMatch(/sanitizeMechanicsResponse\(result\)/);
  });

  it("binds only visuals asset IDs and reuses the guarded project asset pipeline", () => {
    expectIds(html, [
      "hud-asset-role", "hud-asset-id", "hud-asset-kind", "hud-asset-atlas-frame",
      "hud-nine-slice-border", "btn-hud-import-asset", "btn-hud-asset-preview",
      "btn-hud-asset-apply", "hud-asset-result"
    ]);
    expect(app).toMatch(/HUDStudioUI[\s\S]*assetRoles[\s\S]*hud-asset-id/);
    expect(app).toMatch(/btn-hud-import-asset[\s\S]*\/api\/assets\/import/);
    expect(app).toMatch(/hud-asset-role[\s\S]*hud-asset-id[\s\S]*\/api\/hud\/preview[\s\S]*\/api\/hud\/apply/);
    expect(server).toContain("/api/assets/import");
    expect(app).not.toMatch(/hudAsset(?:Path|Url)|hud-asset-(?:path|url)/i);
  });

  it("keeps preview-before-apply and exposes disable/re-enable without the broad project save path", () => {
    expectIds(html, ["btn-hud-preview", "btn-hud-apply", "btn-hud-disable", "hud-preview-result"]);
    expect(app).toMatch(/btn-hud-preview[\s\S]*\/api\/hud\/preview/);
    expect(app).toMatch(/btn-hud-apply[\s\S]*(?:disabled|preview\?\.ok)[\s\S]*ifRevision/);
    expect(app).toMatch(/btn-hud-disable[\s\S]*enabled\s*:\s*false[\s\S]*\/api\/hud\/preview[\s\S]*\/api\/hud\/apply/);
    expect(app).not.toMatch(/btn-hud-apply[\s\S]{0,500}\/api\/project\/save/);
  });

  it("supports practical component CRUD and placement editing on the authored draft", () => {
    expectIds(html, [
      "hud-component-picker", "hud-component-id", "hud-component-type", "btn-hud-component-add",
      "btn-hud-component-remove", "hud-placement-kind", "hud-placement-horizontal",
      "hud-placement-vertical", "hud-placement-x", "hud-placement-y", "hud-placement-width",
      "hud-placement-height", "btn-hud-placement-apply"
    ]);
    expect(app).toMatch(/function\s+addHudStudioComponent[\s\S]*commonNodes\.(?:push|splice)/);
    expect(app).toMatch(/function\s+removeHudStudioComponent[\s\S]*commonNodes[\s\S]*rootNodeIds[\s\S]*layouts/);
    expect(app).toMatch(/function\s+applyHudStudioPlacement[\s\S]*placement[\s\S]*size/);
    expect(app).toMatch(/data-node-id[\s\S]*(?:selectHudStudioComponent|selectedNodeId)/);
    expect(server).toMatch(/desktop_quickbar[\s\S]*radial_wheel[\s\S]*mobile_bottom_sheet/);
    expect(app).toMatch(/btn-hud-load-recipe[\s\S]*HUDStudioUI\.draft\s*=\s*deep\(recipe\.profile\)/);
  });

  it("supports screen creation/removal and ordered transition CRUD without raw JSON editing", () => {
    expectIds(html, [
      "hud-screen-id", "hud-screen-surface", "btn-hud-screen-add", "btn-hud-screen-remove",
      "hud-transition-picker", "hud-transition-id", "hud-transition-event",
      "hud-transition-from", "hud-transition-target", "btn-hud-transition-add",
      "btn-hud-transition-update", "btn-hud-transition-remove"
    ]);
    expect(app).toMatch(/function\s+addHudStudioScreen[\s\S]*draft\.screens/);
    expect(app).toMatch(/function\s+removeHudStudioScreen[\s\S]*screenGraph\.transitions/);
    expect(app).toMatch(/function\s+(?:add|upsert)HudStudioTransition[\s\S]*screenGraph\.transitions/);
    expect(app).toMatch(/function\s+removeHudStudioTransition[\s\S]*screenGraph\.transitions/);
  });
});
