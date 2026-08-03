import { describe, expect, it } from "vitest";
import {
  CAMERA_PROFILE_SCHEMA_VERSION,
  compareCameraDepthKeysV1,
  createCameraProjectorV1,
  resolveCameraProfileV1
} from "./camera-projector.mjs";

function profile(overrides = {}) {
  return {
    schemaVersion: 1,
    projection: "top_down",
    orientation: "north",
    elevationScale: 2,
    fitPadding: 32,
    minZoom: 0.5,
    maxZoom: 3,
    initialZoom: 1,
    ...overrides
  };
}

function catalog(overrides = {}) {
  return {
    schemaVersion: 1,
    profiles: {
      top: profile(),
      iso: profile({ projection: "isometric_2_1" }),
      dimetric: profile({ projection: "dimetric_oblique" })
    },
    bindings: {
      maps: { map_a: "dimetric" },
      missions: { mission_a: "iso" }
    },
    ...overrides
  };
}

function closePoint(actual, expected) {
  expect(actual.x).toBeCloseTo(expected.x, 10);
  expect(actual.y).toBeCloseTo(expected.y, 10);
}

describe("R20.1 CameraProfileV1 pure renderer contract (RED)", () => {
  it("freezes schema v1 and stable golden vectors for all presentation-only projections", () => {
    expect(CAMERA_PROFILE_SCHEMA_VERSION).toBe(1);

    const top = createCameraProjectorV1(profile());
    const iso = createCameraProjectorV1(profile({ projection: "isometric_2_1" }));
    const dimetric = createCameraProjectorV1(profile({ projection: "dimetric_oblique" }));

    expect(Object.isFrozen(top)).toBe(true);
    closePoint(top.worldToScreen({ x: 4, y: 2, elevation: 3 }), { x: 4, y: -4 });
    closePoint(iso.worldToScreen({ x: 4, y: 2, elevation: 3 }), { x: 2, y: -3 });
    closePoint(dimetric.worldToScreen({ x: 4, y: 2, elevation: 3 }), { x: 3, y: -2.5 });
  });

  it("uses four fixed authored orientations without changing engine coordinates", () => {
    const expected = {
      north: { x: 2, y: 3 },
      east: { x: -3, y: 2 },
      south: { x: -2, y: -3 },
      west: { x: 3, y: -2 }
    };
    for (const [orientation, point] of Object.entries(expected)) {
      const projector = createCameraProjectorV1(profile({ orientation, elevationScale: 0 }));
      closePoint(projector.worldToScreen({ x: 2, y: 3, elevation: 0 }), point);
    }
  });

  it("round-trips finite world coordinates when elevation is supplied to the inverse", () => {
    for (const projection of ["top_down", "isometric_2_1", "dimetric_oblique"]) {
      for (const orientation of ["north", "east", "south", "west"]) {
        const projector = createCameraProjectorV1(profile({ projection, orientation, elevationScale: 1.75 }));
        for (const point of [
          { x: 0, y: 0, elevation: 0 },
          { x: 12.25, y: -8.5, elevation: 3.125 },
          { x: -1024, y: 2048, elevation: -2 }
        ]) {
          const restored = projector.screenToWorld(projector.worldToScreen(point), point.elevation);
          expect(restored).toEqual(expect.objectContaining({ elevation: point.elevation }));
          closePoint(restored, point);
        }
      }
    }
  });

  it("sorts depth by projected Y, elevation, then stable binary entity ID", () => {
    const projector = createCameraProjectorV1(profile({ projection: "isometric_2_1", elevationScale: 1 }));
    const entries = [
      { x: 6, y: 4, elevation: 0, entityId: "entity-2" },
      { x: 5, y: 5, elevation: 0, entityId: "entity-10" },
      { x: 6, y: 6, elevation: 2, entityId: "high" },
      { x: 2, y: 2, elevation: 0, entityId: "front" }
    ];
    const ordered = entries
      .map((entry) => ({ id: entry.entityId, key: projector.depthKey(entry) }))
      .sort((left, right) => compareCameraDepthKeysV1(left.key, right.key))
      .map((entry) => entry.id);

    expect(ordered).toEqual(["front", "high", "entity-10", "entity-2"]);
  });

  it("resolves mission, map, build-target, then bundled top-down precedence", () => {
    const value = catalog();
    expect(resolveCameraProfileV1(value, {
      missionId: "mission_a", mapId: "map_a", buildTargetCameraProfileId: "top"
    })).toMatchObject({ profileId: "iso", source: "mission" });
    expect(resolveCameraProfileV1(value, {
      missionId: "other", mapId: "map_a", buildTargetCameraProfileId: "top"
    })).toMatchObject({ profileId: "dimetric", source: "map" });
    expect(resolveCameraProfileV1(value, {
      missionId: "other", mapId: "other", buildTargetCameraProfileId: "iso"
    })).toMatchObject({ profileId: "iso", source: "build_target" });
    expect(resolveCameraProfileV1(value, { missionId: "other", mapId: "other" }))
      .toMatchObject({ profileId: null, source: "top_down_fallback", profile: { projection: "top_down" } });
    expect(resolveCameraProfileV1({ schemaVersion: 1, profiles: {}, bindings: { maps: {}, missions: {} } }, {}))
      .toMatchObject({ profileId: null, source: "top_down_fallback", profile: { projection: "top_down" } });
  });

  it("is invariant to catalog insertion order and returns detached frozen data", () => {
    const forward = catalog();
    const reversed = catalog({
      profiles: Object.fromEntries(Object.entries(catalog().profiles).reverse()),
      bindings: {
        maps: Object.fromEntries(Object.entries(catalog().bindings.maps).reverse()),
        missions: Object.fromEntries(Object.entries(catalog().bindings.missions).reverse())
      }
    });
    const context = { missionId: "mission_a", mapId: "map_a", buildTargetCameraProfileId: "top" };
    const first = resolveCameraProfileV1(forward, context);
    const second = resolveCameraProfileV1(reversed, context);
    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.profile)).toBe(true);
    forward.profiles.iso.projection = "top_down";
    expect(first.profile.projection).toBe("isometric_2_1");
  });

  it.each([
    ["future schema", () => catalog({ schemaVersion: 2 })],
    ["unknown profile key", () => {
      const value = catalog();
      value.profiles.iso.arbitraryCode = "alert(1)";
      return value;
    }],
    ["invalid projection", () => {
      const value = catalog();
      value.profiles.iso.projection = "perspective_3d";
      return value;
    }],
    ["invalid orientation", () => {
      const value = catalog();
      value.profiles.iso.orientation = "free_orbit";
      return value;
    }],
    ["non-finite parameter", () => {
      const value = catalog();
      value.profiles.iso.elevationScale = Number.NaN;
      return value;
    }],
    ["invalid zoom order", () => {
      const value = catalog();
      value.profiles.iso.minZoom = 4;
      value.profiles.iso.maxZoom = 1;
      return value;
    }],
    ["unknown binding reference", () => {
      const value = catalog();
      value.bindings.missions.mission_a = "missing";
      return value;
    }],
    ["unsupported implicit default binding", () => {
      const value = catalog();
      value.bindings.defaultProfileId = "top";
      return value;
    }],
    ["over-budget profiles", () => catalog({
      profiles: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [
        `profile_${String(index).padStart(2, "0")}`,
        profile()
      ]))
    })],
    ["cyclic catalog", () => {
      const value = catalog();
      value.loop = value;
      return value;
    }]
  ])("fails closed for %s", (_label, factory) => {
    expect(() => resolveCameraProfileV1(factory(), {})).toThrow();
  });

  it("never executes author accessors and rejects revoked proxies", () => {
    const value = catalog();
    let reads = 0;
    Object.defineProperty(value.profiles.iso, "projection", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("author accessor must not run");
      }
    });
    expect(() => resolveCameraProfileV1(value, {})).toThrow(/own data|accessor/i);
    expect(reads).toBe(0);

    const revocable = Proxy.revocable(catalog(), {});
    revocable.revoke();
    expect(() => resolveCameraProfileV1(revocable.proxy, {})).toThrow();
  });
});
