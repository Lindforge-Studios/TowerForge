import fs from "node:fs";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync("packages/studio/public/index.html", "utf8");
const app = fs.readFileSync("packages/studio/public/app.js", "utf8");
const styles = fs.readFileSync("packages/studio/public/styles.css", "utf8");
const server = fs.readFileSync("packages/studio/server.mjs", "utf8");

function expectIds(ids) {
  for (const id of ids) expect(html, id).toContain(`id="${id}"`);
}

describe("R22.3 Splash Studio guarded authoring surface (RED)", () => {
  it("adds a dedicated hub with locked TowerForge slot, target picker and editable timeline", () => {
    expect(html).toMatch(/data-tab=["']splashes["']/);
    expectIds([
      "splash-studio", "splash-studio-state", "splash-target-picker", "splash-playlist-picker",
      "splash-engine-slot", "splash-timeline", "splash-item-picker", "splash-item-id",
      "splash-sprite-id", "splash-accessible-label", "splash-caption", "splash-background-color",
      "splash-fit", "splash-transition", "splash-display-ms", "splash-minimum-ms", "splash-transition-ms"
    ]);
    expect(html).toMatch(/Made with TowerForge/);
    expect(html).toMatch(/(?:locked|system|обязательн)/i);
    expect(styles).toMatch(/\.splash-(?:studio|timeline|item|preview)/);
  });

  it("supports add, duplicate, delete and drag reorder while keeping apply behind preview", () => {
    expectIds([
      "btn-splash-item-add", "btn-splash-item-duplicate", "btn-splash-item-remove",
      "btn-splash-preview", "btn-splash-apply", "btn-splash-disable", "splash-preview-result"
    ]);
    expect(app).toMatch(/(?:dragstart|dragover)[\s\S]*(?:drop|dataTransfer)/i);
    expect(app).toMatch(/btn-splash-item-add[\s\S]*btn-splash-item-duplicate[\s\S]*btn-splash-item-remove/);
    expect(app).toMatch(/btn-splash-preview[\s\S]*\/api\/splashes\/preview/);
    expect(app).toMatch(/btn-splash-apply[\s\S]*(?:disabled|preview\?\.ok)[\s\S]*ifRevision/);
    expect(app).toMatch(/btn-splash-disable[\s\S]*enabled\s*:\s*false[\s\S]*\/api\/splashes\/apply/);
  });

  it("previews timing, reduced motion and skip behavior and reuses safe project assets", () => {
    expectIds([
      "splash-preview-viewport", "splash-preview-reduced-motion", "splash-preview-stage",
      "splash-preview-skip", "splash-import-source", "splash-import-target", "btn-splash-import-asset"
    ]);
    expect(app).toMatch(/splash-preview-reduced-motion[\s\S]*(?:displayMs|minimumMs)[\s\S]*transitionMs/);
    expect(app).toMatch(/btn-splash-import-asset[\s\S]*\/api\/assets\/import/);
    expect(app).toMatch(/\/project-file\//);
    expect(app).not.toMatch(/splash-(?:url|html|css|javascript|script)/i);
  });

  it("wires only read, recipe, compute preview and guarded apply server endpoints", () => {
    for (const route of [
      "/api/splashes/read", "/api/splashes/recipes", "/api/splashes/preview", "/api/splashes/apply"
    ]) expect(server, route).toContain(route);
    expect(server).toMatch(/getSplashPlaylists[\s\S]*getSplashPlaylistRecipe[\s\S]*previewSplashPlaylist[\s\S]*applySplashPlaylist/);
    expect(server).toMatch(/result\?\.conflict\s*\?\s*409/);
    expect(server).toMatch(/sanitizeMechanicsResponse\(result\)/);
    expect(app).not.toMatch(/btn-splash-apply[\s\S]{0,500}\/api\/project\/save/);
  });
});
