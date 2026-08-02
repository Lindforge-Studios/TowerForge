import fs from "node:fs";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(new URL("./public/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("./public/app.js", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("./server.mjs", import.meta.url), "utf8");

describe("R18 Studio large-screen player target authoring (RED)", () => {
  it("adds an explicit desktop preset while retaining the ordinary legacy Add target action", () => {
    expect(html).toContain('id="btn-add-target"');
    expect(html).toContain('id="btn-add-desktop-target"');
    expect(html).toMatch(/btn-add-desktop-target[^>]*>[\s\S]{0,120}(?:Large-screen|desktop)/i);

    expect(app).toMatch(/btn-add-desktop-target[\s\S]{0,2200}\/api\/player-targets\/recipe[\s\S]{0,320}desktop_large_screen/);
    expect(app).toMatch(/const target = recipe\.target/);
    for (const field of ["viewport", "padding", "minZoom", "maxZoom", "initialZoom", "quality", "locale", "inputProfile"]) {
      expect(app).toContain(field);
    }
    expect(app).toMatch(/btn-add-desktop-target[\s\S]{0,2600}schemaVersion\s*=\s*2/);
    expect(app).toMatch(/btn-add-desktop-target[\s\S]{0,2600}(?:manifest|project)[\s\S]{0,240}schemaVersion\s*=\s*5/);
  });

  it("uses a narrow preview/apply API so desktop promotion cannot rewrite a legacy target", () => {
    expect(server).toMatch(/GET[\s\S]{0,160}\/api\/player-targets/);
    expect(server).toMatch(/POST[\s\S]{0,200}\/api\/player-targets\/recipe/);
    expect(server).toMatch(/POST[\s\S]{0,200}\/api\/player-targets\/preview/);
    expect(server).toMatch(/POST[\s\S]{0,200}\/api\/player-targets\/apply/);
    expect(server).toMatch(/ifRevision[\s\S]{0,800}(?:backup|rollback)|(?:backup|rollback)[\s\S]{0,800}ifRevision/i);
    expect(app).toMatch(/\/api\/player-targets\/preview/);
    expect(app).toMatch(/\/api\/player-targets\/apply/);
    expect(app).toMatch(/ifRevision/);

    const ordinaryAdd = app.match(/const addBtn = \$\("btn-add-target"\);[\s\S]*?\n\}/)?.[0] ?? "";
    expect(ordinaryAdd).toMatch(/platform:\s*["']web["']/);
    expect(ordinaryAdd).not.toMatch(/formFactor|viewport|schemaVersion\s*=\s*[25]/);
  });

  it("renders every closed BuildTargets v2 desktop field for explicit editing", () => {
    expect(app).toMatch(/formFactor[\s\S]{0,500}(?:desktop|Desktop)/);
    expect(app).toMatch(/viewport\.(?:padding|minZoom|maxZoom|initialZoom)|data-f=["']viewport/);
    expect(app).toMatch(/quality[\s\S]{0,500}(?:low|balanced|high)/);
    expect(app).toMatch(/locale/);
    expect(app).toMatch(/inputProfile[\s\S]{0,500}keyboard_mouse/);
  });
});
