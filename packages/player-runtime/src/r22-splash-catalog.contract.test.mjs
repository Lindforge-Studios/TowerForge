import { describe, expect, it } from "vitest";
import {
  SPLASH_CATALOG_LIMITS,
  SPLASH_ITEM_DEFAULTS,
  compileSplashPlaylistPlanV1,
  validateSplashCatalogV1
} from "./splash-catalog.mjs";

function splashItem(overrides = {}) {
  return {
    id: "studio",
    spriteId: "studio_logo",
    accessibleLabel: "Lindforge Studios",
    backgroundColor: "#0b0f0d",
    ...overrides
  };
}

function playlist(overrides = {}) {
  return {
    schemaVersion: 1,
    label: "Studio introduction",
    items: [splashItem()],
    ...overrides
  };
}

function catalog(playlists = { intro: playlist() }) {
  return { schemaVersion: 1, playlists };
}

describe("R22.1 SplashCatalogV1 closed pure contract (RED)", () => {
  it("normalizes the documented defaults into detached data without mutating input", () => {
    expect(SPLASH_CATALOG_LIMITS).toMatchObject({ playlists: 16, itemsPerPlaylist: 8, totalPlaybackMs: 30_000 });
    expect(SPLASH_ITEM_DEFAULTS).toEqual({
      displayMs: 1_800,
      minimumMs: 600,
      transitionMs: 220,
      fit: "contain",
      transition: "fade_scale"
    });

    const source = catalog();
    const before = structuredClone(source);
    const result = validateSplashCatalogV1(source);

    expect(result.ok).toBe(true);
    expect(result.catalog).not.toBe(source);
    expect(source).toEqual(before);
    expect(result.catalog.playlists.intro.items[0]).toMatchObject({
      id: "studio",
      spriteId: "studio_logo",
      accessibleLabel: "Lindforge Studios",
      backgroundColor: "#0b0f0d",
      ...SPLASH_ITEM_DEFAULTS
    });
  });

  it("accepts the complete closed v1 item contract and preserves authored order", () => {
    const first = splashItem({
      id: "publisher",
      spriteId: "publisher_logo",
      accessibleLabel: "Publisher logo",
      caption: "Presents",
      backgroundColor: "#101820",
      fit: "cover",
      transition: "cut",
      displayMs: 700,
      minimumMs: 300,
      transitionMs: 0
    });
    const second = splashItem({
      id: "game",
      spriteId: "game_logo",
      accessibleLabel: "Game logo",
      transition: "fade",
      displayMs: 10_000,
      minimumMs: 2_000,
      transitionMs: 600
    });

    const result = validateSplashCatalogV1(catalog({ intro: playlist({ items: [first, second] }) }));

    expect(result.ok).toBe(true);
    expect(result.catalog.playlists.intro.items.map((item) => item.id)).toEqual(["publisher", "game"]);
    expect(result.catalog.playlists.intro.items[0]).toEqual(first);
  });

  it("enforces playlist, item and total authored playback budgets", () => {
    const sixteen = Object.fromEntries(Array.from({ length: 16 }, (_, index) => [
      `playlist_${index}`,
      playlist({ items: [splashItem({ id: `item_${index}` })] })
    ]));
    expect(validateSplashCatalogV1(catalog(sixteen)).ok).toBe(true);

    const seventeen = { ...sixteen, playlist_16: playlist() };
    expect(validateSplashCatalogV1(catalog(seventeen)).ok).toBe(false);

    const eightItems = Array.from({ length: 8 }, (_, index) => splashItem({ id: `item_${index}` }));
    expect(validateSplashCatalogV1(catalog({ intro: playlist({ items: eightItems }) })).ok).toBe(true);
    expect(validateSplashCatalogV1(catalog({
      intro: playlist({ items: [...eightItems, splashItem({ id: "item_8" })] })
    })).ok).toBe(false);

    const exactlyThirtySeconds = Array.from({ length: 3 }, (_, index) => splashItem({
      id: `long_${index}`,
      displayMs: 9_800,
      minimumMs: 600,
      transitionMs: 200
    }));
    expect(validateSplashCatalogV1(catalog({ intro: playlist({ items: exactlyThirtySeconds }) })).ok).toBe(true);
    expect(validateSplashCatalogV1(catalog({
      intro: playlist({
        items: exactlyThirtySeconds.map((item, index) => index === 2 ? { ...item, transitionMs: 201 } : item)
      })
    })).ok).toBe(false);
  });

  it.each([
    ["empty playlist", () => playlist({ items: [] }), "items"],
    ["duplicate item id", () => playlist({ items: [splashItem(), splashItem()] }), "id"],
    ["display below range", () => playlist({ items: [splashItem({ displayMs: 699 })] }), "displayMs"],
    ["display above range", () => playlist({ items: [splashItem({ displayMs: 10_001 })] }), "displayMs"],
    ["minimum below range", () => playlist({ items: [splashItem({ minimumMs: 299 })] }), "minimumMs"],
    ["minimum above range", () => playlist({ items: [splashItem({ minimumMs: 2_001 })] }), "minimumMs"],
    ["minimum after display", () => playlist({ items: [splashItem({ displayMs: 700, minimumMs: 800 })] }), "minimumMs"],
    ["transition below range", () => playlist({ items: [splashItem({ transitionMs: -1 })] }), "transitionMs"],
    ["transition above range", () => playlist({ items: [splashItem({ transitionMs: 601 })] }), "transitionMs"],
    ["unsupported fit", () => playlist({ items: [splashItem({ fit: "stretch" })] }), "fit"],
    ["unsupported transition", () => playlist({ items: [splashItem({ transition: "spin" })] }), "transition"],
    ["empty accessible label", () => playlist({ items: [splashItem({ accessibleLabel: "" })] }), "accessibleLabel"],
    ["invalid background", () => playlist({ items: [splashItem({ backgroundColor: "red" })] }), "backgroundColor"],
    ["future playlist", () => playlist({ schemaVersion: 2 }), "schemaVersion"]
  ])("rejects %s at a stable path", (_label, makePlaylist, field) => {
    const result = validateSplashCatalogV1(catalog({ intro: makePlaylist() }));
    expect(result.ok).toBe(false);
    expect(result.error?.fieldPath).toContain(field);
  });

  it("rejects future catalogs, unknown keys, sparse arrays and cycles", () => {
    expect(validateSplashCatalogV1({ ...catalog(), schemaVersion: 2 }).ok).toBe(false);
    expect(validateSplashCatalogV1({ ...catalog(), executable: "javascript:alert(1)" }).ok).toBe(false);
    expect(validateSplashCatalogV1(catalog({ intro: { ...playlist(), executable: true } })).ok).toBe(false);
    expect(validateSplashCatalogV1(catalog({ intro: playlist({ items: [splashItem({ html: "<script>" })] }) })).ok).toBe(false);

    const sparse = [];
    sparse.length = 1;
    expect(validateSplashCatalogV1(catalog({ intro: playlist({ items: sparse }) })).ok).toBe(false);

    const cyclic = catalog();
    cyclic.playlists.intro.items[0].caption = cyclic;
    expect(validateSplashCatalogV1(cyclic).ok).toBe(false);
  });

  it("never invokes accessors and returns a failure for revoked proxies", () => {
    const value = catalog();
    let reads = 0;
    Object.defineProperty(value.playlists.intro.items[0], "caption", {
      enumerable: true,
      get() {
        reads += 1;
        return "unsafe";
      }
    });

    expect(() => validateSplashCatalogV1(value)).not.toThrow();
    expect(reads).toBe(0);
    expect(validateSplashCatalogV1(value).ok).toBe(false);

    const revoked = Proxy.revocable(catalog(), {});
    revoked.revoke();
    expect(() => validateSplashCatalogV1(revoked.proxy)).not.toThrow();
    expect(validateSplashCatalogV1(revoked.proxy).ok).toBe(false);
  });

  it("preserves prototype-named playlist IDs without mutating the object prototype", () => {
    const playlists = Object.create(null);
    Object.defineProperty(playlists, "__proto__", {
      value: playlist({ label: "Prototype-safe" }), enumerable: true, configurable: true, writable: true
    });
    Object.defineProperty(playlists, "constructor", {
      value: playlist({ label: "Constructor-safe", items: [splashItem({ id: "constructor_item" })] }),
      enumerable: true, configurable: true, writable: true
    });

    const result = validateSplashCatalogV1(catalog(playlists));
    expect(result.ok).toBe(true);
    expect(Object.getPrototypeOf(result.catalog.playlists)).toBeNull();
    expect(Object.hasOwn(result.catalog.playlists, "__proto__")).toBe(true);
    expect(Object.hasOwn(result.catalog.playlists, "constructor")).toBe(true);
    expect(compileSplashPlaylistPlanV1(result.catalog, "__proto__").label).toBe("Prototype-safe");
    expect(compileSplashPlaylistPlanV1(result.catalog, "constructor").label).toBe("Constructor-safe");
    expect(Object.prototype).not.toHaveProperty("label");
  });
});
