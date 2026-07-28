import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(path.resolve("packages/studio/public/index.html"), "utf8");
const app = fs.readFileSync(path.resolve("packages/studio/public/app.js"), "utf8");
const styles = fs.readFileSync(path.resolve("packages/studio/public/styles.css"), "utf8");

describe("project workbench usability", () => {
  it("keeps the project tree and editor inside independently scrollable panes", () => {
    expect(styles).toMatch(/\.script-workbench\s*\{[^}]*min-height:\s*0[^}]*overflow:\s*hidden/s);
    expect(styles).toMatch(/\.project-tree-pane\s*\{[^}]*min-height:\s*0[^}]*overflow:\s*hidden/s);
    expect(styles).toMatch(/\.project-tree\s*\{[^}]*overflow(?:-y)?:\s*auto/s);
    expect(styles).toMatch(/\.script-code-editor\s*\{[^}]*overflow:\s*auto/s);
  });

  it("opens raster project assets in a dedicated preview instead of the text endpoint", () => {
    expect(html).toContain('id="script-image-preview"');
    expect(html).toContain('id="script-preview-image"');
    expect(app).toMatch(/isProjectImagePath/);
    expect(app).toMatch(/projectFileUrl/);
    expect(app).toMatch(/script-image-preview/);
    expect(app).toMatch(/\^assets\\\//);
    expect(app).toMatch(/\.png|png/);
  });

  it("keeps read-only source readable and selectable", () => {
    expect(app).toMatch(/editor\.disabled\s*=\s*false[\s\S]{0,160}editor\.readOnly\s*=\s*!file\.editable/);
    expect(styles).toMatch(/\.script-code-editor:read-only\s*\{[^}]*color:\s*var\(--text\)/s);
    expect(styles).not.toMatch(/\.script-code-editor:disabled\s*\{[^}]*color:\s*var\(--text-dim\)/s);
    expect(app).toMatch(/addEventListener\("input", \(event\) => \{\s*if \(event\.currentTarget\.readOnly \|\| event\.currentTarget\.disabled\) return;/s);
    expect(app).toMatch(/event\.key !== "Tab" \|\| event\.currentTarget\.readOnly \|\| event\.currentTarget\.disabled/);
  });
});
