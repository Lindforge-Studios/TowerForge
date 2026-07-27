import { describe, expect, it, vi } from "vitest";
import {
  SEEDED_RNG_ALGORITHM,
  SEEDED_RNG_STATE_SCHEMA_VERSION,
  SEED_EXPANSION_VERSION,
  SeededRng,
  type GameSeed,
  type SeededRngStateV1
} from "./rng.js";

declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { eager: true; import: "default"; query: "?raw" }
    ): Record<string, string>;
  }
}

const STATE_AFTER_TWO_REJECTION_VECTOR_DRAWS: SeededRngStateV1 = {
  schemaVersion: 1,
  algorithm: "xoshiro128ss",
  words: [4_098, 4_294_966_787, 4_294_966_274, 4_286_576_639]
};

function sequence(seed: GameSeed, count = 12): number[] {
  const rng = new SeededRng(seed);
  return Array.from({ length: count }, () => rng.nextUint32());
}

describe("SeededRng public contract", () => {
  it("is deterministic for equal string or numeric seeds and separates different seeds", () => {
    expect(sequence("towerforge-seed")).toEqual(sequence("towerforge-seed"));
    expect(sequence(42)).toEqual(sequence(42));
    expect(sequence("towerforge-seed")).not.toEqual(sequence("different-seed"));
    expect(sequence(42)).not.toEqual(sequence(43));
  });

  it("exports JSON-safe xoshiro128ss v1 state and resumes the exact next sequence", () => {
    const original = new SeededRng("checkpoint-seed");
    Array.from({ length: 9 }, () => original.nextUint32());

    const exported = original.exportState();
    expect(exported).toEqual({
      schemaVersion: 1,
      algorithm: "xoshiro128ss",
      words: expect.arrayContaining([
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number)
      ])
    });
    expect(exported.words).toHaveLength(4);

    const roundTripped = JSON.parse(JSON.stringify(exported)) as SeededRngStateV1;
    const restored = SeededRng.fromState(roundTripped);
    expect(Array.from({ length: 24 }, () => restored.nextUint32())).toEqual(
      Array.from({ length: 24 }, () => original.nextUint32())
    );
  });

  it("pins seed expansion v1 for typed string and numeric seeds", () => {
    expect({
      stateSchemaVersion: SEEDED_RNG_STATE_SCHEMA_VERSION,
      seedExpansionVersion: SEED_EXPANSION_VERSION,
      algorithm: SEEDED_RNG_ALGORITHM
    }).toEqual({ stateSchemaVersion: 1, seedExpansionVersion: 1, algorithm: "xoshiro128ss" });

    const vectors: Array<{
      seed: GameSeed;
      words: readonly [number, number, number, number];
      draws: readonly number[];
    }> = [
      {
        seed: "towerforge-seed",
        words: [4_089_073_769, 1_315_578_205, 311_036_413, 2_014_414_962],
        draws: [1_408_151_268, 1_939_713_126, 52_388_711, 2_754_251_303, 253_469_240, 147_355_731]
      },
      {
        seed: 42,
        words: [3_417_138_074, 285_306_221, 4_212_888_590, 1_482_617_017],
        draws: [2_686_326_266, 2_736_711_028, 552_441_658, 701_193_082, 681_904_460, 2_279_661_550]
      }
    ];

    for (const vector of vectors) {
      const rng = new SeededRng(vector.seed);
      expect(rng.exportState().words).toEqual(vector.words);
      expect(Array.from({ length: vector.draws.length }, () => rng.nextUint32())).toEqual(vector.draws);
    }
    expect(new SeededRng("42").exportState().words).not.toEqual(new SeededRng(42).exportState().words);
  });

  it("rejects malformed, future, non-uint32, non-finite, and all-zero state", () => {
    const sparseWords = new Array<number>(4);
    sparseWords[0] = 1;
    const invalidStates: unknown[] = [
      null,
      {},
      { schemaVersion: 2, algorithm: "xoshiro128ss", words: [1, 2, 3, 4] },
      { schemaVersion: 1, algorithm: "future-rng", words: [1, 2, 3, 4] },
      { schemaVersion: 1, algorithm: "xoshiro128ss", words: [1, 2, 3] },
      { schemaVersion: 1, algorithm: "xoshiro128ss", words: [0, 0, 0, 0] },
      { schemaVersion: 1, algorithm: "xoshiro128ss", words: [-1, 2, 3, 4] },
      { schemaVersion: 1, algorithm: "xoshiro128ss", words: [1.5, 2, 3, 4] },
      { schemaVersion: 1, algorithm: "xoshiro128ss", words: [4_294_967_296, 2, 3, 4] },
      { schemaVersion: 1, algorithm: "xoshiro128ss", words: [Number.NaN, 2, 3, 4] },
      { schemaVersion: 1, algorithm: "xoshiro128ss", words: [Number.POSITIVE_INFINITY, 2, 3, 4] },
      { schemaVersion: 1, algorithm: "xoshiro128ss", words: sparseWords }
    ];

    for (const state of invalidStates) {
      expect(() => SeededRng.fromState(state as SeededRngStateV1)).toThrow(/state|schema|algorithm|word|uint32|zero/i);
    }
  });

  it("validates nextInt(maxExclusive) and always returns an integer in range", () => {
    const invalidBounds = [0, -1, 1.25, Number.NaN, Number.POSITIVE_INFINITY, 4_294_967_297];
    for (const maxExclusive of invalidBounds) {
      expect(() => new SeededRng(1).nextInt(maxExclusive)).toThrow(/max|integer|range|uint32/i);
    }

    for (const maxExclusive of [1, 2, 3, 10, 65_537, 2_147_483_649, 4_294_967_296]) {
      const rng = new SeededRng(`bound-${maxExclusive}`);
      for (let draw = 0; draw < 256; draw += 1) {
        const value = rng.nextInt(maxExclusive);
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(maxExclusive);
      }
    }
  });

  it("uses deterministic rejection sampling instead of modulo bias", () => {
    // For max=2^31+1, the first xoshiro result from this state (4_294_962_679)
    // lies outside the largest divisible uint32 interval and must be discarded.
    // The second result is 5_760, fixing both rejection behavior and state advancement.
    const rng = SeededRng.fromState({
      schemaVersion: 1,
      algorithm: "xoshiro128ss",
      words: [1, 4_294_967_295, 4_294_967_295, 2]
    });

    expect(rng.nextInt(2_147_483_649)).toBe(5_760);
    expect(rng.exportState()).toEqual(STATE_AFTER_TWO_REJECTION_VECTOR_DRAWS);
  });

  it("never depends on Math.random", () => {
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("SeededRng must not call Math.random");
    });

    const rng = new SeededRng("no-host-random");
    expect(() => {
      rng.nextUint32();
      rng.nextInt(17);
      const resumed = SeededRng.fromState(rng.exportState());
      resumed.nextUint32();
    }).not.toThrow();
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });
});

describe("engine production randomness guard", () => {
  it("contains no direct Math.random calls outside test sources", () => {
    const sources = import.meta.glob("../**/*.ts", {
      eager: true,
      import: "default",
      query: "?raw"
    });
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.endsWith(".test.ts"))
      .filter(([, source]) => /\bMath\s*\.\s*random\s*\(/u.test(source))
      .map(([path]) => path)
      .sort();

    expect(offenders).toEqual([]);
  });
});
