import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as Renderer from "./index.mjs";
import { PROCEDURAL_JUICE_SUPPORTED_EVENTS } from "../../cli/lib/project-schema.mjs";

function projector() {
  const candidate = Renderer.projectProceduralJuicePresentation;
  expect(candidate).toBeTypeOf("function");
  return candidate;
}

function visuals(overrides = {}) {
  return {
    schemaVersion: 3,
    proceduralJuice: {
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
      },
      ...overrides
    }
  };
}

function snapshot(overrides = {}) {
  return {
    missionId: "tutorial_01",
    missionElapsed: 12.5,
    towers: [{
      id: "tower_1",
      typeId: "cannon",
      coord: { q: 1, r: 1 },
      level: 1,
      cooldown: 0,
      stacks: 1,
      footprint: [{ q: 1, r: 1 }],
      investedResources: { coins: 10 }
    }],
    enemies: [{
      id: "enemy_1",
      typeId: "grunt",
      hp: 60,
      maxHp: 100,
      pathProgress: 2,
      pathOffset: 0,
      dotRemaining: 0,
      navigation: {
        schemaVersion: 1,
        movementProfileId: "ground",
        currentCoord: { q: 3, r: 2 },
        edgeProgress: 0,
        stepsEntered: 2
      }
    }],
    lastEvents: [{
      type: "enemyHit",
      towerId: "tower_1",
      enemyId: "enemy_1",
      enemyTypeId: "grunt",
      damage: 24
    }],
    ...overrides
  };
}

function content() {
  return {
    towers: {
      cannon: { attack: { kind: "single", fireRate: 2 } }
    },
    enemies: {
      grunt: { maxHp: 100 },
      boss: { maxHp: 1000 }
    }
  };
}

function projectOptions(overrides = {}) {
  const current = snapshot();
  return {
    snapshot: current,
    previousSnapshot: current,
    visuals: visuals(),
    content: content(),
    ...overrides
  };
}

const NEUTRAL = Object.freeze({
  active: false,
  particleBursts: Object.freeze([]),
  audioCues: Object.freeze([]),
  cameraCues: Object.freeze([])
});

describe("R11 shared procedural juice projection", () => {
  it("keeps renderer-supported events aligned with project and MCP validation", () => {
    expect(Renderer.PROCEDURAL_JUICE_PRESENTATION_EVENTS).toEqual(PROCEDURAL_JUICE_SUPPORTED_EVENTS);
    const unsupported = visuals();
    unsupported.proceduralJuice.eventBindings.impact.event = "futureGameEvent";
    expect(projector()(projectOptions({ visuals: unsupported }))).toEqual(NEUTRAL);
  });

  it("projects a deterministic bounded particle seed and parametric audio instruction", () => {
    const project = projector();
    const options = projectOptions();
    const first = project(options);
    const second = project(structuredClone(options));

    expect(second).toEqual(first);
    expect(first).toMatchObject({ active: true });
    expect(first.particleBursts).toHaveLength(1);
    expect(first.particleBursts[0]).toMatchObject({
      bindingId: "impact",
      emitterId: "impact_sparks",
      count: 12,
      origin: { q: 3, r: 2 }
    });
    expect(first.particleBursts[0].seed).toMatch(/^[0-9a-f]{16}$/);
    expect(first.audioCues).toHaveLength(1);
    expect(first.audioCues[0]).toMatchObject({
      bindingId: "impact",
      cueId: "impact_tone",
      waveform: "triangle",
      durationMs: 120,
      gain: 0.3
    });
    expect(first.audioCues[0].frequencyHz).toBeGreaterThanOrEqual(20);
    expect(first.audioCues[0].frequencyHz).toBeLessThanOrEqual(20_000);
    expect(first.cameraCues).toEqual([]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.particleBursts)).toBe(true);
    expect(Object.isFrozen(first.particleBursts[0])).toBe(true);
  });

  it("preserves the exact Procedural Juice projection when visuals v4 adds camera profiles", () => {
    const legacy = visuals();
    const cameraVisuals = structuredClone(legacy);
    cameraVisuals.schemaVersion = 4;
    cameraVisuals.cameraProfiles = {
      schemaVersion: 1,
      profiles: {},
      bindings: { maps: {}, missions: {} }
    };
    expect(projector()(projectOptions({ visuals: cameraVisuals })))
      .toEqual(projector()(projectOptions({ visuals: legacy })));
  });

  it("derives entropy only from canonical event data and missionElapsed, not catalog record order or Math.random", () => {
    const project = projector();
    const canonical = project(projectOptions());
    const reversed = visuals();
    const juice = reversed.proceduralJuice;
    juice.eventBindings = Object.fromEntries(Object.entries(juice.eventBindings).reverse());
    juice.particleEmitters = Object.fromEntries(Object.entries(juice.particleEmitters).reverse());
    juice.audioCues = Object.fromEntries(Object.entries(juice.audioCues).reverse());

    const originalRandom = Math.random;
    Math.random = () => { throw new Error("Procedural projection must not call Math.random"); };
    try {
      expect(project(projectOptions({ visuals: reversed }))).toEqual(canonical);
    } finally {
      Math.random = originalRandom;
    }

    const later = project(projectOptions({ snapshot: snapshot({ missionElapsed: 12.6 }) }));
    expect(later.particleBursts[0].seed).not.toBe(canonical.particleBursts[0].seed);

    const changedCatalog = visuals();
    changedCatalog.proceduralJuice.particleEmitters.impact_sparks.color = "#ffcc66";
    const changed = project(projectOptions({ visuals: changedCatalog }));
    expect(changed.particleBursts[0].seed).not.toBe(canonical.particleBursts[0].seed);
  });

  it("canonicalizes every binding filter and cue-reference array in binary ID order", () => {
    const project = projector();
    const configured = visuals();
    const juice = configured.proceduralJuice;
    juice.particleEmitters.secondary_sparks = structuredClone(juice.particleEmitters.impact_sparks);
    juice.audioCues.secondary_tone = structuredClone(juice.audioCues.impact_tone);
    juice.cameraCues.secondary_camera = structuredClone(juice.cameraCues.boss_finish);
    juice.eventBindings.impact = {
      event: "enemyHit",
      missionIds: ["z_mission", "tutorial_01"],
      enemyTypeIds: ["z_enemy", "grunt"],
      particleEmitterIds: ["secondary_sparks", "impact_sparks"],
      audioCueIds: ["secondary_tone", "impact_tone"],
      cameraCueIds: ["secondary_camera", "boss_finish"]
    };
    const permuted = structuredClone(configured);
    const binding = permuted.proceduralJuice.eventBindings.impact;
    for (const key of ["missionIds", "enemyTypeIds", "particleEmitterIds", "audioCueIds", "cameraCueIds"]) {
      binding[key].reverse();
    }
    permuted.proceduralJuice.particleEmitters = Object.fromEntries(
      Object.entries(permuted.proceduralJuice.particleEmitters).reverse()
    );
    permuted.proceduralJuice.audioCues = Object.fromEntries(
      Object.entries(permuted.proceduralJuice.audioCues).reverse()
    );
    permuted.proceduralJuice.cameraCues = Object.fromEntries(
      Object.entries(permuted.proceduralJuice.cameraCues).reverse()
    );

    expect(project(projectOptions({ visuals: permuted }))).toEqual(project(projectOptions({ visuals: configured })));
  });

  it("keeps the first 2,048 particle instructions and drops only deterministic overflow", () => {
    const project = projector();
    const configured = visuals();
    const juice = configured.proceduralJuice;
    const emitter = juice.particleEmitters.impact_sparks;
    juice.particleEmitters = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [
      `emitter_${index}`,
      { ...structuredClone(emitter), maxParticles: 256 }
    ]));
    juice.audioCues = {};
    juice.cameraCues = {};
    juice.eventBindings = {
      impact: {
        event: "enemyHit",
        particleEmitterIds: Object.keys(juice.particleEmitters).reverse()
      }
    };

    const overflow = project(projectOptions({ visuals: configured }));
    expect(overflow.active).toBe(true);
    expect(overflow.particleBursts).toHaveLength(8);
    expect(overflow.particleBursts.map((burst) => burst.emitterId)).toEqual(
      Array.from({ length: 8 }, (_, index) => `emitter_${index}`)
    );
    expect(overflow.particleBursts.reduce((sum, burst) => sum + burst.count, 0)).toBe(2_048);
    expect(overflow.audioCues).toEqual([]);
    expect(overflow.cameraCues).toEqual([]);

    const exact = structuredClone(configured);
    delete exact.proceduralJuice.particleEmitters.emitter_8;
    exact.proceduralJuice.eventBindings.impact.particleEmitterIds = Object.keys(exact.proceduralJuice.particleEmitters).reverse();
    const exactBoundary = project(projectOptions({ visuals: exact }));
    expect(exactBoundary.active).toBe(true);
    expect(exactBoundary.particleBursts).toHaveLength(8);
    expect(exactBoundary.particleBursts.map((burst) => burst.emitterId)).toEqual(
      overflow.particleBursts.map((burst) => burst.emitterId)
    );
    expect(exactBoundary.particleBursts.reduce((sum, burst) => sum + burst.count, 0)).toBe(2_048);
  });

  it("uses the previous snapshot to locate a killed boss and emits presentation-only camera cues", () => {
    const project = projector();
    const previousSnapshot = snapshot({
      enemies: [{
        id: "boss_1",
        typeId: "boss",
        hp: 1,
        maxHp: 1000,
        pathProgress: 4,
        pathOffset: 0,
        dotRemaining: 0,
        navigation: {
          schemaVersion: 1,
          movementProfileId: "ground",
          currentCoord: { q: 5, r: 2 },
          edgeProgress: 0,
          stepsEntered: 4
        }
      }]
    });
    const current = snapshot({
      missionElapsed: 20,
      enemies: [],
      lastEvents: [{
        type: "enemyKilled",
        enemyId: "boss_1",
        enemyTypeId: "boss",
        coins: 10,
        resources: { coins: 10 }
      }]
    });
    const before = structuredClone(current);
    const projected = project(projectOptions({ snapshot: current, previousSnapshot }));

    expect(projected.cameraCues).toEqual([expect.objectContaining({
      bindingId: "boss_death",
      cueId: "boss_finish",
      origin: { q: 5, r: 2 },
      shake: { durationMs: 160, intensity: 0.4 },
      hitStop: { durationMs: 200, timeScale: 0.2 },
      chromaticAberration: { durationMs: 120, intensity: 0.3 }
    })]);
    expect(current).toEqual(before);
    expect(current.missionElapsed).toBe(20);
  });

  it("matches canonical external content IDs without applying the Juice catalog-ID regex", () => {
    const project = projector();
    const externalIds = visuals();
    const longMissionId = `chapter.${"x".repeat(129)}`;
    externalIds.proceduralJuice.eventBindings.boss_death.missionIds = [longMissionId];
    externalIds.proceduralJuice.eventBindings.boss_death.enemyTypeIds = ["__proto__"];
    const previousSnapshot = snapshot({
      missionId: longMissionId,
      enemies: [{
        ...snapshot().enemies[0],
        id: "boss_1",
        typeId: "__proto__",
        navigation: { ...snapshot().enemies[0].navigation, currentCoord: { q: 5, r: 2 } }
      }]
    });
    const current = snapshot({
      missionId: longMissionId,
      enemies: [],
      lastEvents: [{ type: "enemyKilled", enemyId: "boss_1", enemyTypeId: "__proto__", coins: 1, resources: { coins: 1 } }]
    });

    expect(project(projectOptions({ visuals: externalIds, snapshot: current, previousSnapshot }))).toMatchObject({
      active: true,
      cameraCues: [expect.objectContaining({ bindingId: "boss_death", origin: { q: 5, r: 2 } })]
    });
  });

  it("anchors a real heroAbilityUsed event at its target and applies target-enemy filters", () => {
    const project = projector();
    const configured = visuals();
    configured.proceduralJuice.eventBindings.impact.event = "heroAbilityUsed";
    configured.proceduralJuice.eventBindings.impact.enemyTypeIds = ["boss"];
    const current = snapshot({
      enemies: [{ ...snapshot().enemies[0], id: "boss_1", typeId: "boss", navigation: {
        ...snapshot().enemies[0].navigation,
        currentCoord: { q: 6, r: 4 }
      } }],
      lastEvents: [{
        type: "heroAbilityUsed", heroId: "hero_1", abilityId: "strike",
        targetEnemyId: "boss_1", targetEnemyTypeId: "boss", resolvedDamage: 12
      }]
    });
    expect(project(projectOptions({ visuals: configured, snapshot: current }))).toMatchObject({
      active: true,
      particleBursts: [expect.objectContaining({ origin: { q: 6, r: 4 } })]
    });
  });

  it("projects destructible damage and destruction only through authored bindings at event.coord", () => {
    const project = projector();
    const configured = visuals();
    configured.proceduralJuice.eventBindings = {
      object_damage: {
        event: "destructibleObjectDamaged",
        particleEmitterIds: ["impact_sparks"]
      },
      object_destroyed: {
        event: "destructibleObjectDestroyed",
        audioCueIds: ["impact_tone"]
      }
    };
    const current = snapshot({
      lastEvents: [
        {
          type: "destructibleObjectDamaged", projectileId: "projectile_1",
          objectId: "gate_1", definitionId: "gate", coord: { q: 8, r: 3 },
          fromHp: 50, toHp: 30, damage: 20
        },
        {
          type: "destructibleObjectDestroyed", projectileId: "projectile_2",
          objectId: "gate_1", definitionId: "gate", coord: { q: 8, r: 3 }
        }
      ]
    });

    expect(project(projectOptions({ visuals: configured, snapshot: current }))).toMatchObject({
      active: true,
      particleBursts: [expect.objectContaining({
        bindingId: "object_damage", origin: { q: 8, r: 3 }
      })],
      audioCues: [expect.objectContaining({
        bindingId: "object_destroyed", origin: { q: 8, r: 3 }
      })],
      cameraCues: []
    });
  });

  it("emits no destructible cue when the valid Juice catalog has no matching binding", () => {
    const project = projector();
    const current = snapshot({
      lastEvents: [{
        type: "destructibleObjectDestroyed", projectileId: "projectile_1",
        objectId: "gate_1", definitionId: "gate", coord: { q: 8, r: 3 }
      }]
    });
    expect(project(projectOptions({ snapshot: current }))).toEqual({
      active: true,
      particleBursts: [],
      audioCues: [],
      cameraCues: []
    });
  });

  it("keeps absent v2 catalogs completely inert and applies mission filters without touching events", () => {
    const project = projector();
    let reads = 0;
    const inactiveSnapshot = {};
    Object.defineProperty(inactiveSnapshot, "lastEvents", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("inactive projection must not inspect events");
      }
    });
    expect(project({ snapshot: inactiveSnapshot, visuals: { schemaVersion: 2 } })).toEqual(NEUTRAL);
    expect(reads).toBe(0);

    const filtered = project(projectOptions({ snapshot: snapshot({ missionId: "other" }) }));
    expect(filtered).toEqual({ active: true, particleBursts: [], audioCues: [], cameraCues: [] });
  });

  it("fails closed for future, malformed, over-budget, accessor, and revoked inputs", () => {
    const project = projector();
    const neutral = [
      projectOptions({ visuals: visuals({ schemaVersion: 2 }) }),
      projectOptions({ visuals: visuals({ eventBindings: [] }) }),
      projectOptions({ visuals: visuals({
        particleEmitters: {
          ["a".repeat(65)]: visuals().proceduralJuice.particleEmitters.impact_sparks
        }
      }) }),
      projectOptions({ snapshot: snapshot({ lastEvents: Array.from({ length: 65 }, () => snapshot().lastEvents[0]) }) })
    ];
    for (const input of neutral) expect(project(input)).toEqual(NEUTRAL);

    let reads = 0;
    const accessor = visuals();
    Object.defineProperty(accessor.proceduralJuice, "eventBindings", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("must not execute authored accessors");
      }
    });
    expect(() => project(projectOptions({ visuals: accessor }))).not.toThrow();
    expect(project(projectOptions({ visuals: accessor }))).toEqual(NEUTRAL);
    expect(reads).toBe(0);

    const { proxy, revoke } = Proxy.revocable(visuals().proceduralJuice, {});
    const revoked = { schemaVersion: 3, proceduralJuice: proxy };
    revoke();
    expect(() => project(projectOptions({ visuals: revoked }))).not.toThrow();
    expect(project(projectOptions({ visuals: revoked }))).toEqual(NEUTRAL);
  });

  it("is the one shared source for Canvas and generated Phaser players", () => {
    const rendererSource = fs.readFileSync(path.resolve("packages/renderer/src/index.mjs"), "utf8");
    const buildSource = fs.readFileSync(path.resolve("packages/cli/build.mjs"), "utf8");
    expect(rendererSource).toMatch(/projectProceduralJuicePresentation/);
    expect((buildSource.match(/projectProceduralJuicePresentation/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(buildSource).toMatch(/function playerTemplate[\s\S]*projectProceduralJuicePresentation[\s\S]*renderer\.drawSnapshot\(snap\)[\s\S]*function phaserPlayerTemplate/);
    expect(buildSource).toMatch(/function phaserPlayerTemplate[\s\S]*projectProceduralJuicePresentation/);
    expect(rendererSource).toMatch(/createProceduralJuiceWorldSnapshotBuffer/);
    expect(buildSource).toMatch(/function phaserPlayerTemplate[\s\S]*createProceduralJuiceWorldSnapshotBuffer/);
    expect(buildSource).toMatch(/proceduralJuiceWorldSnapshots\?\.select/);
  });
});
