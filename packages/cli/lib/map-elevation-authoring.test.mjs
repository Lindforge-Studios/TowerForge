import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compileMapSource } from "./map-compiler.mjs";
import { applyMapElevations, previewMapElevations } from "./map-elevation-authoring.mjs";

const projects = [];

afterEach(() => {
  for (const projectDir of projects.splice(0)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-elevation-transaction-"));
  projects.push(projectDir);
  fs.cpSync(path.resolve("examples/starter.tdproj"), projectDir, { recursive: true });
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.schemaVersion = 3;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return projectDir;
}

function addSecondMapSource(projectDir) {
  const tutorialPath = path.join(projectDir, "maps", "src", "tutorial_map.tmj");
  const otherPath = path.join(projectDir, "maps", "src", "other.tmj");
  const other = JSON.parse(fs.readFileSync(tutorialPath, "utf8"));
  other.id = "other";
  other.properties.find((property) => property.name === "id").value = "other";
  fs.writeFileSync(otherPath, `${JSON.stringify(other, null, 2)}\n`);

  const compiledPath = path.join(projectDir, "maps", "compiled", "maps.json");
  const compiled = JSON.parse(fs.readFileSync(compiledPath, "utf8"));
  compiled.other = compileMapSource(other, "other.tmj");
  fs.writeFileSync(compiledPath, `${JSON.stringify(compiled, null, 2)}\n`);
  return otherPath;
}

describe("R3.1 elevation transaction ownership", () => {
  it("edits a map that already authors elevation through a Tiled property without creating an ambiguous source", async () => {
    const projectDir = fixture();
    const sourcePath = path.join(projectDir, "maps", "src", "tutorial_map.tmj");
    const compiledPath = path.join(projectDir, "maps", "compiled", "maps.json");
    const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
    source.properties.push({
      name: "elevationOverrides",
      type: "string",
      value: JSON.stringify([{ q: 1, r: 0, elevation: 1 }])
    });
    fs.writeFileSync(sourcePath, `${JSON.stringify(source, null, 2)}\n`);
    const compiledMaps = JSON.parse(fs.readFileSync(compiledPath, "utf8"));
    compiledMaps.tutorial_map = compileMapSource(source, "tutorial_map.tmj");
    fs.writeFileSync(compiledPath, `${JSON.stringify(compiledMaps, null, 2)}\n`);

    const request = {
      mapId: "tutorial_map",
      elevationOverrides: [{ q: 2, r: 0, elevation: 3 }]
    };
    const preview = await previewMapElevations(projectDir, request);
    expect(preview.candidate.elevationOverrides).toEqual(request.elevationOverrides);
    await applyMapElevations(projectDir, { ...request, ifRevision: preview.revision });

    const writtenSource = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
    expect(() => compileMapSource(writtenSource, "tutorial_map.tmj")).not.toThrow();
    expect(compileMapSource(writtenSource, "tutorial_map.tmj").elevationOverrides)
      .toEqual(request.elevationOverrides);
    const tiledElevationProperties = writtenSource.properties
      .filter((property) => property?.name === "elevationOverrides");
    expect(Number(Object.hasOwn(writtenSource, "elevationOverrides")) + tiledElevationProperties.length).toBe(1);
  });

  it("never overwrites a concurrent edit to an owned file that has not yet been replaced", async () => {
    const projectDir = fixture();
    const manifestPath = path.join(projectDir, "project.json");
    const sourcePath = path.join(projectDir, "maps", "src", "tutorial_map.tmj");
    const compiledPath = path.join(projectDir, "maps", "compiled", "maps.json");
    const originalManifest = fs.readFileSync(manifestPath);
    const originalCompiled = fs.readFileSync(compiledPath);
    const externalMarker = "\nCONCURRENT-USER-EDIT\n";
    const request = {
      mapId: "tutorial_map",
      elevationOverrides: [{ q: 1, r: 0, elevation: 2 }]
    };
    const preview = await previewMapElevations(projectDir, request);

    let failure;
    try {
      await applyMapElevations(
        projectDir,
        { ...request, ifRevision: preview.revision },
        {
          afterFileReplace(relativePath) {
            if (relativePath === "project.json") fs.appendFileSync(sourcePath, externalMarker);
          }
        }
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: "commit_conflict",
      rolledBack: true
    });
    expect(fs.readFileSync(manifestPath).equals(originalManifest)).toBe(true);
    expect(fs.readFileSync(compiledPath).equals(originalCompiled)).toBe(true);
    expect(fs.readFileSync(sourcePath, "utf8")).toContain(externalMarker);
  });

  it("rejects a concurrent edit to any non-owned map source instead of publishing stale compiled maps", async () => {
    const projectDir = fixture();
    const otherSourcePath = addSecondMapSource(projectDir);
    const manifestPath = path.join(projectDir, "project.json");
    const targetSourcePath = path.join(projectDir, "maps", "src", "tutorial_map.tmj");
    const compiledPath = path.join(projectDir, "maps", "compiled", "maps.json");
    const originalManifest = fs.readFileSync(manifestPath);
    const originalTargetSource = fs.readFileSync(targetSourcePath);
    const originalCompiled = fs.readFileSync(compiledPath);
    const request = {
      mapId: "tutorial_map",
      elevationOverrides: [{ q: 1, r: 0, elevation: 2 }]
    };
    const preview = await previewMapElevations(projectDir, request);

    let failure;
    try {
      await applyMapElevations(
        projectDir,
        { ...request, ifRevision: preview.revision },
        {
          afterFileReplace(relativePath) {
            if (relativePath !== "project.json") return;
            const externallyEdited = JSON.parse(fs.readFileSync(otherSourcePath, "utf8"));
            externallyEdited.elevationOverrides = [{ q: 2, r: 0, elevation: 9 }];
            fs.writeFileSync(otherSourcePath, `${JSON.stringify(externallyEdited, null, 2)}\n`);
          }
        }
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: "commit_conflict",
      rolledBack: true
    });
    expect(fs.readFileSync(manifestPath).equals(originalManifest)).toBe(true);
    expect(fs.readFileSync(targetSourcePath).equals(originalTargetSource)).toBe(true);
    expect(fs.readFileSync(compiledPath).equals(originalCompiled)).toBe(true);
    expect(JSON.parse(fs.readFileSync(otherSourcePath, "utf8")).elevationOverrides).toEqual([
      { q: 2, r: 0, elevation: 9 }
    ]);
  });

  it("does not return a successful stale no-op when the authoring boundary changes during validation", async () => {
    const projectDir = fixture();
    const sourcePath = path.join(projectDir, "maps", "src", "tutorial_map.tmj");
    const request = {
      mapId: "tutorial_map",
      elevationOverrides: [{ q: 1, r: 0, elevation: 2 }]
    };
    const initialPreview = await previewMapElevations(projectDir, request);
    await applyMapElevations(projectDir, { ...request, ifRevision: initialPreview.revision });
    const noOpPreview = await previewMapElevations(projectDir, request);
    const externalMarker = " \n";

    const pending = applyMapElevations(projectDir, {
      ...request,
      ifRevision: noOpPreview.revision
    });
    queueMicrotask(() => fs.appendFileSync(sourcePath, externalMarker));

    let failure;
    try {
      await pending;
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: "revision_conflict" });
    expect(fs.readFileSync(sourcePath, "utf8")).toMatch(/ \n$/);
  });
});
