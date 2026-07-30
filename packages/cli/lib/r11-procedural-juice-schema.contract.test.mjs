import { describe, expect, it } from "vitest";
import { defaultVisuals, normalizeVisuals, validateProjectSchemas } from "./project-schema.mjs";

function validProceduralJuice() {
  return {
    schemaVersion: 1,
    particleEmitters: {
      impact_sparks: {
        maxParticles: 12,
        lifetimeMs: { min: 80, max: 180 },
        speedPxPerSecond: { min: 40, max: 100 },
        angleDegrees: { min: 0, max: 360 },
        sizePx: { min: 1, max: 3 },
        color: "#ffd166",
        gravityPxPerSecondSquared: 80,
        blendMode: "additive"
      }
    },
    audioCues: {
      impact_tone: {
        waveform: "triangle",
        baseFrequencyHz: 220,
        durationMs: 120,
        gain: 0.3,
        pitchSemitones: {
          damage: 0.05,
          attackSpeed: 1,
          targetSize: -0.5,
          variation: { min: -0.2, max: 0.2 }
        }
      }
    },
    cameraCues: {
      boss_finish: {
        shake: { durationMs: 160, intensity: 0.4 },
        hitStop: { durationMs: 200, timeScale: 0.2 },
        chromaticAberration: { durationMs: 120, intensity: 0.3 }
      }
    },
    eventBindings: {
      impact: {
        event: "enemyHit",
        missionIds: ["tutorial_01"],
        particleEmitterIds: ["impact_sparks"],
        audioCueIds: ["impact_tone"]
      },
      boss_death: {
        event: "enemyKilled",
        missionIds: ["tutorial_01"],
        enemyTypeIds: ["boss"],
        cameraCueIds: ["boss_finish"]
      }
    }
  };
}

function filesWithVisuals(visuals) {
  return {
    manifest: { schemaVersion: 3 },
    balance: {
      missions: {
        tutorial_01: { id: "tutorial_01" }
      },
      enemies: {
        grunt: { id: "grunt" },
        boss: { id: "boss" }
      }
    },
    maps: {},
    mapSources: {},
    mechanics: undefined,
    visuals,
    storyComics: { seenStoragePrefix: "story_seen_", comics: {} },
    battleBackgrounds: { fallbackMissionId: "", placeholderMissionIds: [], definitions: {} },
    buildTargets: { schemaVersion: 1, targets: {} }
  };
}

function juiceIssues(visuals) {
  return validateProjectSchemas(filesWithVisuals(visuals)).issues.filter((issue) => (
    issue.entityKind === "visuals" && issue.fieldPath.includes("proceduralJuice")
  ));
}

describe("R11 visuals v3 procedural juice authoring contract", () => {
  it("keeps the legacy visuals v2 default byte shape and never synthesizes opt-in juice", () => {
    expect(defaultVisuals().schemaVersion).toBe(2);
    expect(defaultVisuals()).not.toHaveProperty("proceduralJuice");
    expect(normalizeVisuals({})).not.toHaveProperty("proceduralJuice");
  });

  it("accepts the closed v1 particle, audio, camera, and mission-filtered binding catalog", () => {
    const visuals = normalizeVisuals({
      schemaVersion: 3,
      proceduralJuice: validProceduralJuice()
    });

    expect(visuals.schemaVersion).toBe(3);
    expect(juiceIssues(visuals)).toEqual([]);
  });

  it("requires visuals schema v3, rejects future versions, and rejects unknown fields", () => {
    const legacy = normalizeVisuals({ schemaVersion: 2, proceduralJuice: validProceduralJuice() });
    expect(juiceIssues(legacy)).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/proceduralJuice|schemaVersion/)
    }));

    const future = normalizeVisuals({
      schemaVersion: 3,
      proceduralJuice: { ...validProceduralJuice(), schemaVersion: 2 }
    });
    expect(juiceIssues(future)).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/proceduralJuice\.schemaVersion/),
      message: expect.stringMatching(/newer|version|supported/i)
    }));

    const unknown = normalizeVisuals({
      schemaVersion: 3,
      proceduralJuice: { ...validProceduralJuice(), executableHook: "alert(1)" }
    });
    expect(juiceIssues(unknown)).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/proceduralJuice\.executableHook/)
    }));
  });

  it("bounds emitter work and every presentation-clock parameter", () => {
    const cases = [
      ["particle count", (juice) => { juice.particleEmitters.impact_sparks.maxParticles = 257; }, /maxParticles/],
      ["particle lifetime", (juice) => { juice.particleEmitters.impact_sparks.lifetimeMs.max = 10_001; }, /lifetimeMs/],
      ["audio frequency", (juice) => { juice.audioCues.impact_tone.baseFrequencyHz = 20_001; }, /baseFrequencyHz/],
      ["audio duration", (juice) => { juice.audioCues.impact_tone.durationMs = 10_001; }, /durationMs/],
      ["camera shake", (juice) => { juice.cameraCues.boss_finish.shake.intensity = 1.01; }, /shake.*intensity/],
      ["hit-stop duration", (juice) => { juice.cameraCues.boss_finish.hitStop.durationMs = 1_001; }, /hitStop.*durationMs/],
      ["time dilation", (juice) => { juice.cameraCues.boss_finish.hitStop.timeScale = 0; }, /hitStop.*timeScale/],
      ["chromatic intensity", (juice) => { juice.cameraCues.boss_finish.chromaticAberration.intensity = -0.01; }, /chromaticAberration.*intensity/]
    ];

    for (const [label, mutate, path] of cases) {
      const proceduralJuice = validProceduralJuice();
      mutate(proceduralJuice);
      const result = juiceIssues(normalizeVisuals({ schemaVersion: 3, proceduralJuice }));
      expect(result, label).toContainEqual(expect.objectContaining({
        severity: "error",
        fieldPath: expect.stringMatching(path)
      }));
    }
  });

  it("validates binding references, mission filters, and bounded catalogs", () => {
    const broken = validProceduralJuice();
    broken.eventBindings.impact.particleEmitterIds = ["missing_emitter"];
    broken.eventBindings.impact.audioCueIds = ["missing_audio"];
    broken.eventBindings.impact.missionIds = ["missing_mission"];
    broken.eventBindings.boss_death.cameraCueIds = ["missing_camera"];
    const result = juiceIssues(normalizeVisuals({ schemaVersion: 3, proceduralJuice: broken }));
    for (const needle of ["missing_emitter", "missing_audio", "missing_mission", "missing_camera"]) {
      expect(result).toContainEqual(expect.objectContaining({
        severity: "error",
        message: expect.stringContaining(needle)
      }));
    }

    const oversized = validProceduralJuice();
    oversized.eventBindings = Object.fromEntries(Array.from({ length: 129 }, (_, index) => [
      `binding_${String(index).padStart(3, "0")}`,
      { event: "enemyHit", particleEmitterIds: ["impact_sparks"] }
    ]));
    expect(juiceIssues(normalizeVisuals({ schemaVersion: 3, proceduralJuice: oversized })))
      .toContainEqual(expect.objectContaining({
        severity: "error",
        fieldPath: expect.stringMatching(/eventBindings/),
        message: expect.stringMatching(/128|budget|limit|too many/i)
      }));

    const longId = validProceduralJuice();
    longId.particleEmitters = { ["a".repeat(65)]: longId.particleEmitters.impact_sparks };
    expect(juiceIssues(normalizeVisuals({ schemaVersion: 3, proceduralJuice: longId })))
      .toContainEqual(expect.objectContaining({
        severity: "error",
        message: expect.stringMatching(/1.64|ASCII|id/i)
      }));

    for (const field of ["missionIds", "enemyTypeIds", "particleEmitterIds", "audioCueIds", "cameraCueIds"]) {
      const duplicate = validProceduralJuice();
      const binding = duplicate.eventBindings.impact;
      const value = field === "missionIds" ? "tutorial_01"
        : field === "enemyTypeIds" ? "grunt"
          : field === "particleEmitterIds" ? "impact_sparks"
            : field === "audioCueIds" ? "impact_tone"
              : "boss_finish";
      binding[field] = [value, value];
      expect(juiceIssues(normalizeVisuals({ schemaVersion: 3, proceduralJuice: duplicate })), field)
        .toContainEqual(expect.objectContaining({
          severity: "error",
          fieldPath: expect.stringContaining(field),
          message: expect.stringMatching(/duplicate|unique/i)
        }));
    }
  });

  it("uses closed own-data inspection and fails closed for accessors and revoked proxies", () => {
    const accessorJuice = validProceduralJuice();
    let reads = 0;
    Object.defineProperty(accessorJuice.particleEmitters.impact_sparks, "maxParticles", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("must not execute author accessors");
      }
    });
    const accessorVisuals = { ...defaultVisuals(), schemaVersion: 3, proceduralJuice: accessorJuice };
    expect(() => validateProjectSchemas(filesWithVisuals(accessorVisuals))).not.toThrow();
    expect(reads).toBe(0);
    expect(juiceIssues(accessorVisuals)).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/maxParticles/),
      message: expect.stringMatching(/own data|accessor/i)
    }));

    const { proxy, revoke } = Proxy.revocable(validProceduralJuice(), {});
    const proxyVisuals = { ...defaultVisuals(), schemaVersion: 3, proceduralJuice: proxy };
    revoke();
    expect(() => validateProjectSchemas(filesWithVisuals(proxyVisuals))).not.toThrow();
    expect(juiceIssues(proxyVisuals)).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/proceduralJuice/)
    }));
  });
});
