import { describe, expect, it } from "vitest";
import { normalizeProjectFiles } from "./project-loader.mjs";
import { defaultVisuals, normalizeVisuals, validateProjectSchemas } from "./project-schema.mjs";

function cameraProfiles() {
  return {
    schemaVersion: 1,
    profiles: {
      top: {
        schemaVersion: 1,
        projection: "top_down",
        orientation: "north",
        elevationScale: 1,
        fitPadding: 32,
        minZoom: 0.5,
        maxZoom: 3,
        initialZoom: 1
      },
      iso: {
        schemaVersion: 1,
        projection: "isometric_2_1",
        orientation: "east",
        elevationScale: 1.5,
        fitPadding: 48,
        minZoom: 0.4,
        maxZoom: 2.5,
        initialZoom: 0.9
      }
    },
    bindings: {
      defaultProfileId: "top",
      maps: { map_a: "iso" },
      missions: { mission_a: "iso" }
    }
  };
}

function proceduralJuice() {
  return {
    schemaVersion: 1,
    particleEmitters: {},
    audioCues: {},
    cameraCues: {},
    eventBindings: {}
  };
}

function buildTargets(cameraProfileId = "top") {
  return {
    schemaVersion: 2,
    defaults: { web: "desktop-web" },
    targets: {
      "desktop-web": {
        id: "desktop-web",
        platform: "web",
        renderer: "canvas",
        webDir: "dist-camera",
        formFactor: "desktop",
        viewport: { fit: "contain", padding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
        quality: "high",
        locale: "ru",
        inputProfile: "keyboard_mouse",
        cameraProfileId
      }
    }
  };
}

function files({ visuals, targets = buildTargets(), projectVersion = 5 } = {}) {
  return {
    projectDir: "/detached/r20.tdproj",
    manifest: { schemaVersion: projectVersion, name: "R20 contract" },
    balance: { missions: { mission_a: { id: "mission_a" } } },
    maps: { map_a: { id: "map_a", width: 1, height: 1 } },
    mapSources: {},
    worldMap: { width: 1, height: 1, regions: [], missionNodes: [] },
    mechanics: undefined,
    distribution: undefined,
    visuals: visuals ?? normalizeVisuals({ schemaVersion: 4, cameraProfiles: cameraProfiles() }),
    storyComics: { seenStoragePrefix: "story_seen_", comics: {} },
    battleBackgrounds: { fallbackMissionId: "", placeholderMissionIds: [], definitions: {} },
    buildTargets: targets,
    scripts: {},
    scriptFiles: {},
    scriptIssues: []
  };
}

function relevant(result) {
  return result.issues.filter((issue) => (
    issue.entityKind === "buildTargets"
    || issue.entityKind === "project"
    || issue.entityKind === "visuals"
  ));
}

describe("R20.1 visuals v4 and BuildTargets v2 camera selection contract (RED)", () => {
  it("accepts the closed CameraProfileV1 catalog and preserves authored values", () => {
    const visuals = normalizeVisuals({ schemaVersion: 4, cameraProfiles: cameraProfiles() });
    expect(relevant(validateProjectSchemas(files({ visuals })))).toEqual([]);
    expect(visuals).toMatchObject({
      schemaVersion: 4,
      cameraProfiles: {
        schemaVersion: 1,
        profiles: {
          iso: { projection: "isometric_2_1", orientation: "east", elevationScale: 1.5 }
        },
        bindings: { defaultProfileId: "top", maps: { map_a: "iso" }, missions: { mission_a: "iso" } }
      }
    });
  });

  it("allows visuals v4 camera profiles to coexist with Procedural Juice v1", () => {
    const visuals = normalizeVisuals({
      schemaVersion: 4,
      cameraProfiles: cameraProfiles(),
      proceduralJuice: proceduralJuice()
    });
    expect(relevant(validateProjectSchemas(files({ visuals })))).toEqual([]);
    expect(visuals.proceduralJuice).toEqual(proceduralJuice());
    expect(visuals.cameraProfiles).toEqual(cameraProfiles());
  });

  it("accepts an optional build-target cameraProfileId and validates its reference", () => {
    expect(relevant(validateProjectSchemas(files()))).toEqual([]);
    const normalized = normalizeProjectFiles(files()).buildTargets.targets["desktop-web"];
    expect(normalized.cameraProfileId).toBe("top");

    const unknown = relevant(validateProjectSchemas(files({ targets: buildTargets("missing") })));
    expect(unknown).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "buildTargets",
      fieldPath: "targets.desktop-web.cameraProfileId",
      message: expect.stringContaining("missing")
    }));
  });

  it("keeps visuals v3 Procedural Juice and camera-absent BuildTargets v2 unchanged", () => {
    const visuals = normalizeVisuals({ schemaVersion: 3, proceduralJuice: proceduralJuice() });
    const targets = buildTargets();
    delete targets.targets["desktop-web"].cameraProfileId;
    const result = validateProjectSchemas(files({ visuals, targets }));
    expect(relevant(result)).toEqual([]);
    expect(visuals.schemaVersion).toBe(3);
    expect(visuals).not.toHaveProperty("cameraProfiles");
    expect(normalizeProjectFiles(files({ visuals, targets })).buildTargets.targets["desktop-web"])
      .not.toHaveProperty("cameraProfileId");
    expect(defaultVisuals().schemaVersion).toBe(2);
    expect(defaultVisuals()).not.toHaveProperty("cameraProfiles");
  });

  it("requires visuals v4 for camera profiles and rejects future versions", () => {
    const legacy = normalizeVisuals({ schemaVersion: 3, cameraProfiles: cameraProfiles() });
    expect(relevant(validateProjectSchemas(files({ visuals: legacy })))).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "visuals",
      fieldPath: expect.stringMatching(/cameraProfiles|schemaVersion/)
    }));

    const futureCatalog = cameraProfiles();
    futureCatalog.schemaVersion = 2;
    expect(relevant(validateProjectSchemas(files({
      visuals: normalizeVisuals({ schemaVersion: 4, cameraProfiles: futureCatalog })
    })))).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: "cameraProfiles.schemaVersion",
      message: expect.stringMatching(/newer|version|supported/i)
    }));

    expect(relevant(validateProjectSchemas(files({
      visuals: normalizeVisuals({ schemaVersion: 5, cameraProfiles: cameraProfiles() })
    })))).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "visuals",
      fieldPath: "schemaVersion"
    }));
  });

  it.each([
    ["unknown catalog key", (value) => { value.executableHook = "alert(1)"; }, "cameraProfiles.executableHook"],
    ["unknown profile key", (value) => { value.profiles.iso.mesh = "scene.glb"; }, "cameraProfiles.profiles.iso.mesh"],
    ["invalid projection", (value) => { value.profiles.iso.projection = "perspective_3d"; }, "cameraProfiles.profiles.iso.projection"],
    ["invalid orientation", (value) => { value.profiles.iso.orientation = "free_orbit"; }, "cameraProfiles.profiles.iso.orientation"],
    ["non-finite elevation", (value) => { value.profiles.iso.elevationScale = Number.POSITIVE_INFINITY; }, "cameraProfiles.profiles.iso.elevationScale"],
    ["invalid zoom range", (value) => { value.profiles.iso.minZoom = 3; value.profiles.iso.maxZoom = 1; }, "cameraProfiles.profiles.iso"],
    ["missing profile reference", (value) => { value.bindings.maps.map_a = "missing"; }, "cameraProfiles.bindings.maps.map_a"],
    ["over-budget profiles", (value) => {
      value.profiles = Object.fromEntries(Array.from({ length: 33 }, (_, index) => [
        `profile_${String(index).padStart(2, "0")}`,
        structuredClone(value.profiles.top)
      ]));
      value.bindings = { maps: {}, missions: {} };
    }, "cameraProfiles.profiles"]
  ])("rejects %s with a stable field path", (_label, mutate, fieldPath) => {
    const value = cameraProfiles();
    mutate(value);
    const result = relevant(validateProjectSchemas(files({
      visuals: normalizeVisuals({ schemaVersion: 4, cameraProfiles: value })
    })));
    expect(result).toContainEqual(expect.objectContaining({ severity: "error", fieldPath }));
  });

  it("uses closed own-data inspection without executing accessors", () => {
    const value = cameraProfiles();
    let reads = 0;
    Object.defineProperty(value.profiles.iso, "projection", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("must not execute author accessors");
      }
    });
    const visuals = { ...defaultVisuals(), schemaVersion: 4, cameraProfiles: value };
    expect(() => validateProjectSchemas(files({ visuals }))).not.toThrow();
    expect(reads).toBe(0);
    expect(relevant(validateProjectSchemas(files({ visuals })))).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: "cameraProfiles.profiles.iso.projection",
      message: expect.stringMatching(/own data|accessor/i)
    }));
  });

  it("fails closed for revoked proxies and cyclic camera catalogs", () => {
    const revocable = Proxy.revocable(cameraProfiles(), {});
    revocable.revoke();
    const proxyVisuals = { ...defaultVisuals(), schemaVersion: 4, cameraProfiles: revocable.proxy };
    expect(() => validateProjectSchemas(files({ visuals: proxyVisuals }))).not.toThrow();
    expect(relevant(validateProjectSchemas(files({ visuals: proxyVisuals })))).toContainEqual(
      expect.objectContaining({ severity: "error", fieldPath: "cameraProfiles" })
    );

    const cyclic = cameraProfiles();
    cyclic.loop = cyclic;
    const cyclicVisuals = { ...defaultVisuals(), schemaVersion: 4, cameraProfiles: cyclic };
    expect(() => validateProjectSchemas(files({ visuals: cyclicVisuals }))).not.toThrow();
    expect(relevant(validateProjectSchemas(files({ visuals: cyclicVisuals })))).toContainEqual(
      expect.objectContaining({ severity: "error", fieldPath: "cameraProfiles.loop" })
    );
  });

  it("keeps cameraProfileId optional but closed and bounded on BuildTargets v2", () => {
    for (const [candidate, fieldPath] of [
      ["", "targets.desktop-web.cameraProfileId"],
      ["a".repeat(65), "targets.desktop-web.cameraProfileId"]
    ]) {
      const issue = relevant(validateProjectSchemas(files({ targets: buildTargets(candidate) })))
        .find((entry) => entry.severity === "error" && entry.fieldPath === fieldPath);
      expect(issue).toBeDefined();
      expect(issue.message).toMatch(/camera profile|cameraProfileId|1.64|bounded|non-empty/i);
      expect(issue.message).not.toMatch(/unknown build target field/i);
    }
  });
});
