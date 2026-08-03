import fs from "node:fs";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(new URL("./public/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("./public/app.js", import.meta.url), "utf8");

describe("R19.1 Studio first-class native desktop target surface", () => {
  it("keeps R18 web desktop and adds an independent native_desktop_game action", () => {
    expect(html).toContain('id="btn-add-desktop-target"');
    expect(html).toContain('id="btn-add-native-desktop-target"');
    expect(html).toMatch(/btn-add-native-desktop-target[^>]*>[\s\S]{0,80}Native desktop game/i);

    const r18 = app.match(/const addDesktopBtn = \$\("btn-add-desktop-target"\);[\s\S]*?\n  \}/)?.[0] ?? "";
    expect(r18).toContain('recipeId: "desktop_large_screen"');

    const native = app.match(/const addNativeDesktopBtn = \$\("btn-add-native-desktop-target"\);[\s\S]*?\n  \}/)?.[0] ?? "";
    expect(native).toContain('allocatePlayerTargetId(read.targets, "native-desktop")');
    expect(native).toContain('recipeId: "native_desktop_game"');
    expect(native).toMatch(/player-targets\/preview[\s\S]*player-targets\/apply[\s\S]*ifRevision/);
    expect(native).toMatch(/defaults[\s\S]{0,100}desktop:\s*targetId/);
  });

  it("edits the closed native window and bundle fields without changing R18 viewport controls", () => {
    expect(app).toContain('<option value="desktop"${target.platform==="desktop"?" selected":""}>desktop</option>');
    expect(app).toContain('["width", "height", "minWidth", "minHeight"]');
    expect(app).toContain('["fullscreen", "resizable"]');
    expect(app).toContain('data-f="window.${field}"');
    expect(app).toContain("bundle.iconSource");
    expect(app).toContain("bundle.targets");
    expect(app).toMatch(/f\.startsWith\("window\."\)[\s\S]*inp\.type === "checkbox"[\s\S]*Number\(inp\.value\)/);
    expect(app).toMatch(/f === "bundle\.targets"[\s\S]*split\(","\)[\s\S]*filter\(Boolean\)/);
    for (const field of ["padding", "minZoom", "maxZoom", "initialZoom", "quality", "locale", "inputProfile"]) {
      expect(app).toContain(field);
    }
  });

  it("packages the exact card target and distinguishes native from the legacy web wrapper", () => {
    expect(app).toMatch(/nativeDesktop \? "Package native desktop" : "Package desktop"/);
    expect(app).toMatch(/nativeDesktop \? "Package this first-class desktop target" : "Legacy compatibility wrapper for this web target"/);
    expect(app).toMatch(/\/api\/package\/\$\{encodeURIComponent\(tid\)\}[\s\S]{0,80}\{ kind \}/);
    expect(app).toMatch(/target\.platform === "web"[\s\S]{0,180}data-kind="mobile"/);
  });
});
