import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { callTool, TOOLS } from "./tools.mjs";

const roots = [];
const SPECIAL_JSON_IDS = Object.freeze(["__proto__", "constructor", "prototype"]);

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("R20 verifier: guarded view-specific asset authoring lifecycle (RED)", () => {
  it("advertises one-variant preview/apply tools instead of a broad visuals writer", () => {
    expect(tool("preview_camera_view_variant")).toMatchObject({
      riskClass: "compute_only",
      sideEffect: expect.stringMatching(/none|writes no project files/i),
      inputSchema: expect.objectContaining({ additionalProperties: false })
    });
    expect(tool("apply_camera_view_variant")).toMatchObject({
      riskClass: "write_local",
      sideEffect: expect.stringMatching(/revision.*validation.*backup.*rollback/i),
      inputSchema: expect.objectContaining({
        required: expect.arrayContaining(["projectDir", "kind", "resourceId", "projection", "orientation", "variant", "ifRevision"]),
        additionalProperties: false
      })
    });
    expect(TOOLS.map((entry) => entry.name)).not.toContain("replace_view_variants");
  });

  it("previews coverage, guardedly binds a safe sprite variant, reloads and packages it", async () => {
    const projectDir = fixture();
    const request = {
      projectDir,
      kind: "sprite",
      resourceId: "arrow_tower",
      projection: "isometric_2_1",
      orientation: "north",
      variant: {
        src: "assets/backgrounds/frontier-before-battle.png",
        mimeType: "image/png",
        anchor: { x: 0.2, y: 0.95 }
      }
    };
    const before = fs.readFileSync(path.join(projectDir, "content", "visuals.json"), "utf8");
    const preview = await callTool("preview_camera_view_variant", request, {});
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      written: false,
      revision: expect.any(String),
      candidate: { kind: "sprite", resourceId: "arrow_tower", viewKey: "isometric_2_1:north" },
      coverage: { status: "exact" }
    });
    expect(fs.readFileSync(path.join(projectDir, "content", "visuals.json"), "utf8")).toBe(before);

    const applied = await callTool("apply_camera_view_variant", {
      ...request,
      ifRevision: preview.revision
    }, {});
    expect(applied).toMatchObject({
      ok: true,
      written: true,
      rolledBack: false,
      backup: expect.any(Object)
    });
    const visuals = JSON.parse(fs.readFileSync(path.join(projectDir, "content", "visuals.json"), "utf8"));
    expect(visuals.viewVariants.sprites.arrow_tower["isometric_2_1:north"]).toEqual(request.variant);

    const built = await callTool("build_project", { projectDir, targetId: "camera-web" }, {});
    expect(built).toMatchObject({ ok: true, targetId: "camera-web" });
    expect(fs.existsSync(path.join(built.outDir, "assets", "backgrounds", "frontier-before-battle.png"))).toBe(true);
    const packaged = (await import(
      `${pathToFileURL(path.join(built.outDir, "project-data.js")).href}?viewVariant=${Date.now()}`
    )).default;
    expect(packaged.visuals.viewVariants.sprites.arrow_tower["isometric_2_1:north"])
      .toEqual(request.variant);
  }, 60_000);

  it("previews an exact tileset material variant from an existing safe atlas", async () => {
    const projectDir = fixture();
    const preview = await callTool("preview_camera_view_variant", {
      projectDir,
      kind: "tileSet",
      resourceId: "camera_ground",
      projection: "isometric_2_1",
      orientation: "north",
      variant: {
        atlas: { src: "assets/backgrounds/frontier-before-battle.png", mimeType: "image/png" },
        materials: {
          buildable: { signatures: { random: [{ spriteId: "frontier_before_battle", weight: 1 }] } }
        }
      }
    }, {});
    expect(preview).toMatchObject({
      ok: true,
      written: false,
      candidate: { kind: "tileSet", resourceId: "camera_ground", viewKey: "isometric_2_1:north" },
      coverage: { status: "exact", missingRequired: [] }
    });
  });

  it.each(SPECIAL_JSON_IDS)("round-trips special JSON resource ID %j through public preview/apply", async (resourceId) => {
    const projectDir = fixture();
    const request = {
      projectDir,
      kind: "sprite",
      resourceId,
      projection: "isometric_2_1",
      orientation: "north",
      variant: {
        src: "assets/backgrounds/frontier-before-battle.png",
        mimeType: "image/png",
        anchor: { x: 0.5, y: 1 }
      }
    };
    const preview = await callTool("preview_camera_view_variant", request, {});
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      written: false,
      candidate: { resourceId, viewKey: "isometric_2_1:north" },
      coverage: { status: "exact" }
    });

    const applied = await callTool("apply_camera_view_variant", {
      ...request,
      ifRevision: preview.revision
    }, {});
    expect(applied).toMatchObject({ ok: true, written: true, rolledBack: false });

    const persisted = readJson(path.join(projectDir, "content", "visuals.json"));
    expect(Object.hasOwn(persisted.viewVariants.sprites, resourceId), resourceId).toBe(true);
    expect(persisted.viewVariants.sprites[resourceId]["isometric_2_1:north"]).toEqual(request.variant);
    expect(Object.getPrototypeOf(persisted.viewVariants.sprites)).toBe(Object.prototype);
  });

  it.each(SPECIAL_JSON_IDS)("rejects a variant whose extra own field is special JSON key %j", async (hiddenKey) => {
    const projectDir = fixture();
    const visualsPath = path.join(projectDir, "content", "visuals.json");
    const before = fs.readFileSync(visualsPath, "utf8");
    const variant = JSON.parse(JSON.stringify({
      src: "assets/backgrounds/frontier-before-battle.png",
      mimeType: "image/png",
      [hiddenKey]: { malformed: true }
    }));

    const preview = await callTool("preview_camera_view_variant", {
      projectDir,
      kind: "sprite",
      resourceId: "safe_resource",
      projection: "isometric_2_1",
      orientation: "north",
      variant
    }, {});

    expect(preview).toMatchObject({ ok: false, dryRun: true, written: false });
    expect(preview.validation.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringContaining(hiddenKey)
    }));
    expect(fs.readFileSync(visualsPath, "utf8")).toBe(before);
    expect(Object.prototype).not.toHaveProperty("malformed");
  });
});

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r20-camera-view-authoring-"));
  roots.push(projectDir);
  fs.cpSync(path.resolve("examples/starter.tdproj"), projectDir, { recursive: true });
  const projectPath = path.join(projectDir, "project.json");
  const project = readJson(projectPath);
  writeJson(projectPath, { ...project, schemaVersion: 5 });

  const visualsPath = path.join(projectDir, "content", "visuals.json");
  const visuals = readJson(visualsPath);
  writeJson(visualsPath, {
    ...visuals,
    schemaVersion: 4,
    atlases: {
      ...visuals.atlases,
      camera_ground_atlas: { src: "assets/backgrounds/frontier-before-battle.png" }
    },
    tileSets: {
      ...visuals.tileSets,
      camera_ground: {
        id: "camera_ground",
        atlas: "camera_ground_atlas",
        tileWidth: 1,
        tileHeight: 1,
        margin: 0,
        spacing: 0,
        topology: "hex",
        ruleKind: "random",
        materials: {
          buildable: { signatures: { random: [{ spriteId: "frontier_before_battle", weight: 1 }] } }
        }
      }
    },
    cameraProfiles: {
      schemaVersion: 1,
      profiles: {
        iso: {
          schemaVersion: 1,
          projection: "isometric_2_1",
          orientation: "north",
          elevationScale: 1.5,
          fitPadding: 32,
          minZoom: 0.5,
          maxZoom: 3,
          initialZoom: 1,
          panPadding: 0
        }
      },
      bindings: { maps: {}, missions: {} }
    },
    viewVariants: { schemaVersion: 1, sprites: {}, tileSets: {} }
  });

  const targetsPath = path.join(projectDir, "build-targets.json");
  const targets = readJson(targetsPath);
  const legacy = targets.targets[targets.defaults.web];
  writeJson(targetsPath, {
    schemaVersion: 2,
    defaults: { web: "camera-web" },
    targets: {
      "camera-web": {
        ...legacy,
        id: "camera-web",
        webDir: "dist-camera-web",
        formFactor: "desktop",
        viewport: { fit: "contain", padding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
        quality: "high",
        locale: "en",
        inputProfile: "keyboard_mouse",
        cameraProfileId: "iso"
      }
    }
  });
  return projectDir;
}

function tool(name) {
  const result = TOOLS.find((entry) => entry.name === name);
  expect(result, `${name} must be registered`).toBeDefined();
  return result;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
