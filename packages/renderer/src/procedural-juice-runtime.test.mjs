import { describe, expect, it, vi } from "vitest";
import {
  PROCEDURAL_JUICE_RUNTIME_LIMITS,
  createProceduralJuicePresentationRuntime,
  createProceduralJuiceWorldSnapshotBuffer
} from "./procedural-juice-runtime.mjs";

function particleBurst(overrides = {}) {
  return {
    bindingId: "impact",
    emitterId: "sparks",
    seed: "0123456789abcdef",
    origin: { q: 3, r: 2 },
    count: 4,
    lifetimeMs: { min: 400, max: 800 },
    speedPxPerSecond: { min: 40, max: 100 },
    angleDegrees: { min: 20, max: 160 },
    sizePx: { min: 1, max: 3 },
    color: "#ffd166",
    gravityPxPerSecondSquared: 80,
    blendMode: "additive",
    ...overrides
  };
}

function presentation(overrides = {}) {
  return {
    active: true,
    particleBursts: [particleBurst()],
    audioCues: [{
      bindingId: "impact",
      cueId: "impact_tone",
      eventType: "enemyHit",
      seed: "1111111111111111",
      origin: { q: 3, r: 2 },
      waveform: "triangle",
      frequencyHz: 220,
      durationMs: 120,
      gain: 0.3
    }],
    cameraCues: [],
    ...overrides
  };
}

describe("R11 bounded procedural juice presentation runtime", () => {
  it("slows only the presented world through a bounded shared snapshot buffer", () => {
    const buffer = createProceduralJuiceWorldSnapshotBuffer();
    const previous = Object.freeze({ tick: 10 });
    const eventFrame = Object.freeze({ tick: 11 });
    const later = Object.freeze({ tick: 12 });

    expect(buffer.select({
      snapshot: eventFrame,
      previousSnapshot: previous,
      frame: { wallTimeMs: 100, presentationTimeMs: 100, timeScale: 0.2 },
      deltaMs: 16
    })).toBe(previous);
    expect(buffer.select({
      snapshot: later,
      previousSnapshot: eventFrame,
      frame: { wallTimeMs: 116, presentationTimeMs: 103.2, timeScale: 0.2 },
      deltaMs: 16
    })).toBe(previous);
    expect(buffer.select({
      snapshot: Object.freeze({ tick: 13 }),
      previousSnapshot: later,
      frame: { wallTimeMs: 180, presentationTimeMs: 119.2, timeScale: 0.2 },
      deltaMs: 64
    })).toBe(eventFrame);

    const latest = Object.freeze({ tick: 14 });
    expect(buffer.select({
      snapshot: latest,
      previousSnapshot: later,
      frame: { wallTimeMs: 300, presentationTimeMs: 180, timeScale: 1 },
      deltaMs: 120
    })).toBe(latest);
  });

  it("bounds retained world snapshots and fails open to the current snapshot", () => {
    const buffer = createProceduralJuiceWorldSnapshotBuffer();
    const first = Object.freeze({ tick: 0 });
    let selected = first;
    for (let index = 1; index <= PROCEDURAL_JUICE_RUNTIME_LIMITS.bufferedWorldSnapshots * 2; index += 1) {
      const snapshot = Object.freeze({ tick: index });
      selected = buffer.select({
        snapshot,
        previousSnapshot: first,
        frame: { wallTimeMs: index, presentationTimeMs: 0, timeScale: 0.2 },
        deltaMs: 1
      });
    }
    expect(selected.tick).toBe(PROCEDURAL_JUICE_RUNTIME_LIMITS.bufferedWorldSnapshots + 1);
    const current = Object.freeze({ tick: 999 });
    expect(buffer.select({ snapshot: current, previousSnapshot: first, frame: {}, deltaMs: 16 })).toBe(current);
  });

  it("evaluates seeded particle trajectories from absolute presentation age", () => {
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("procedural juice must not consume ambient randomness");
    });
    try {
      const oneStep = createProceduralJuicePresentationRuntime();
      const splitStep = createProceduralJuicePresentationRuntime();
      const source = presentation();
      const before = structuredClone(source);

      expect(oneStep.ingest(source, { frameKey: "mission:12.5" })).toEqual({
        particles: 4,
        audioCues: 1,
        cameraCues: 0
      });
      splitStep.ingest(structuredClone(source), { frameKey: "mission:12.5" });
      oneStep.advance(100);
      splitStep.advance(40);
      splitStep.advance(60);

      expect(splitStep.read()).toEqual(oneStep.read());
      expect(oneStep.read().particles).toHaveLength(4);
      expect(oneStep.read().particles[0]).toMatchObject({
        origin: { q: 3, r: 2 },
        ageMs: 100,
        color: "#ffd166",
        blendMode: "additive"
      });
      expect(oneStep.read().particles[0].offsetX).toBeTypeOf("number");
      expect(oneStep.read().particles[0].offsetY).toBeTypeOf("number");
      expect(source).toEqual(before);
      expect(Object.isFrozen(oneStep.read())).toBe(true);
      expect(Object.isFrozen(oneStep.read().particles)).toBe(true);
    } finally {
      random.mockRestore();
    }
  });

  it("deduplicates repeated reads by explicit frame key and bounds live particles", () => {
    const runtime = createProceduralJuicePresentationRuntime();
    const maximum = PROCEDURAL_JUICE_RUNTIME_LIMITS.liveParticles;
    const bursts = Array.from({ length: 10 }, (_, index) => particleBurst({
      count: 256,
      seed: (BigInt(index + 1)).toString(16).padStart(16, "0"),
      lifetimeMs: { min: 1_000, max: 1_000 }
    }));
    const frame = presentation({ particleBursts: bursts, audioCues: [], cameraCues: [] });

    expect(runtime.ingest(frame, { frameKey: "tick:1" }).particles).toBe(maximum);
    expect(runtime.ingest(structuredClone(frame), { frameKey: "tick:1" })).toEqual({
      particles: 0,
      audioCues: 0,
      cameraCues: 0
    });
    expect(runtime.read().particles).toHaveLength(maximum);

    runtime.advance(1_001);
    expect(runtime.read().particles).toEqual([]);
    expect(runtime.ingest(frame, { frameKey: "tick:2" }).particles).toBe(maximum);
    expect(runtime.ingest(frame)).toEqual({ particles: 0, audioCues: 0, cameraCues: 0 });
  });

  it("coalesces camera cues and scales only its local presentation clock", () => {
    const runtime = createProceduralJuicePresentationRuntime();
    const result = runtime.ingest(presentation({
      particleBursts: [],
      audioCues: [],
      cameraCues: [
        {
          bindingId: "boss",
          cueId: "finish_a",
          seed: "2222222222222222",
          origin: { q: 4, r: 1 },
          shake: { durationMs: 100, intensity: 0.8 },
          hitStop: { durationMs: 200, timeScale: 0.2 },
          chromaticAberration: { durationMs: 120, intensity: 0.3 }
        },
        {
          bindingId: "boss",
          cueId: "finish_b",
          seed: "3333333333333333",
          origin: { q: 4, r: 1 },
          shake: { durationMs: 180, intensity: 0.7 },
          hitStop: { durationMs: 100, timeScale: 0.5 },
          chromaticAberration: { durationMs: 80, intensity: 0.7 }
        }
      ]
    }), { frameKey: "boss-death:1" });

    expect(result.cameraCues).toBe(2);
    expect(runtime.read()).toMatchObject({
      wallTimeMs: 0,
      presentationTimeMs: 0,
      timeScale: 0.2,
      chromaticAberration: 0.7
    });
    expect(Math.hypot(runtime.read().shakeOffset.x, runtime.read().shakeOffset.y)).toBeLessThanOrEqual(1);

    runtime.advance(50);
    expect(runtime.read()).toMatchObject({ wallTimeMs: 50, presentationTimeMs: 10, timeScale: 0.2 });
    runtime.advance(200);
    expect(runtime.read()).toMatchObject({ wallTimeMs: 250, presentationTimeMs: 90, timeScale: 1, chromaticAberration: 0 });
    expect(runtime.read().shakeOffset).toEqual({ x: 0, y: 0 });
  });

  it("applies reduced and off motion preferences without suppressing audio", () => {
    const frame = presentation({
      particleBursts: [particleBurst({ count: 10 })],
      cameraCues: [{
        bindingId: "boss",
        cueId: "finish",
        seed: "2222222222222222",
        origin: { q: 4, r: 1 },
        shake: { durationMs: 160, intensity: 1 },
        hitStop: { durationMs: 200, timeScale: 0.2 },
        chromaticAberration: { durationMs: 120, intensity: 1 }
      }]
    });
    const reduced = createProceduralJuicePresentationRuntime({ motionPreference: "reduced" });
    const off = createProceduralJuicePresentationRuntime({ motionPreference: "off" });

    expect(reduced.ingest(frame, { frameKey: "a" })).toEqual({ particles: 3, audioCues: 1, cameraCues: 1 });
    expect(reduced.read().particles).toHaveLength(3);
    expect(reduced.read().timeScale).toBe(1);
    expect(reduced.read().chromaticAberration).toBe(0);
    expect(Math.hypot(reduced.read().shakeOffset.x, reduced.read().shakeOffset.y)).toBeLessThanOrEqual(0.25);

    expect(off.ingest(frame, { frameKey: "a" })).toEqual({ particles: 0, audioCues: 1, cameraCues: 0 });
    expect(off.read()).toMatchObject({
      particles: [],
      shakeOffset: { x: 0, y: 0 },
      chromaticAberration: 0,
      timeScale: 1
    });
    expect(off.drainAudioCues()).toHaveLength(1);
  });

  it("caps queued voices per frame, drains once, and fails closed for malformed input", () => {
    const runtime = createProceduralJuicePresentationRuntime();
    const audioCues = Array.from({ length: 40 }, (_, index) => ({
      bindingId: "rapid",
      cueId: `tone_${index}`,
      eventType: "towerFired",
      seed: (BigInt(index + 1)).toString(16).padStart(16, "0"),
      origin: { q: 0, r: 0 },
      waveform: "sine",
      frequencyHz: 100 + index,
      durationMs: 50,
      gain: 0.1
    }));
    expect(runtime.ingest(presentation({ particleBursts: [], cameraCues: [], audioCues }), { frameKey: "rapid:1" }).audioCues)
      .toBe(PROCEDURAL_JUICE_RUNTIME_LIMITS.audioVoicesPerFrame);
    expect(runtime.drainAudioCues()).toHaveLength(PROCEDURAL_JUICE_RUNTIME_LIMITS.audioVoicesPerFrame);
    expect(runtime.drainAudioCues()).toEqual([]);

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(runtime.ingest(revoked.proxy, { frameKey: "bad" })).toEqual({ particles: 0, audioCues: 0, cameraCues: 0 });
    expect(runtime.advance(Number.NaN)).toEqual(runtime.read());
    expect(runtime.advance(-1)).toEqual(runtime.read());
  });
});
