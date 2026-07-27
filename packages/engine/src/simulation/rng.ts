export const SEEDED_RNG_STATE_SCHEMA_VERSION = 1 as const;
export const SEEDED_RNG_ALGORITHM = "xoshiro128ss" as const;
export const SEED_EXPANSION_VERSION = 1 as const;

const UINT32_RANGE = 0x1_0000_0000;
const UINT32_MAX = UINT32_RANGE - 1;

export type GameSeed = string | number;

export interface SeededRngStateV1 {
  readonly schemaVersion: typeof SEEDED_RNG_STATE_SCHEMA_VERSION;
  readonly algorithm: typeof SEEDED_RNG_ALGORITHM;
  readonly words: readonly [number, number, number, number];
}

function rotateLeft32(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

/**
 * Seed expansion v1 is deliberately specified in terms of UTF-16 code units
 * and uint32 arithmetic so it has the same result in every JavaScript host.
 * The typed seed payload (`s:<text>` or `n:<decimal>`) is hashed with FNV-1a,
 * then expanded to four words with SplitMix32. State snapshots are versioned
 * separately because their xoshiro words no longer depend on seed expansion.
 */
function expandSeedV1(seed: GameSeed): [number, number, number, number] {
  let payload: string;
  if (typeof seed === "string") {
    payload = `s:${seed}`;
  } else {
    if (!Number.isFinite(seed) || !Number.isSafeInteger(seed)) {
      throw new Error("Numeric RNG seed must be a finite safe integer.");
    }
    payload = `n:${seed}`;
  }

  let hash = 0x811c9dc5;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  const nextSplitMix32 = (): number => {
    hash = (hash + 0x9e3779b9) >>> 0;
    let mixed = hash;
    mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad) >>> 0;
    mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97) >>> 0;
    return (mixed ^ (mixed >>> 15)) >>> 0;
  };

  const words: [number, number, number, number] = [
    nextSplitMix32(),
    nextSplitMix32(),
    nextSplitMix32(),
    nextSplitMix32()
  ];

  // xoshiro128** forbids the all-zero state. This deterministic sentinel is
  // part of seed expansion v1, even though reaching it is vanishingly rare.
  if (words.every((word) => word === 0)) {
    words[0] = 1;
  }
  return words;
}

function validateState(state: SeededRngStateV1): [number, number, number, number] {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("RNG state must be an object.");
  }
  if (state.schemaVersion !== SEEDED_RNG_STATE_SCHEMA_VERSION) {
    throw new Error(`Unsupported RNG state schema version "${String(state.schemaVersion)}".`);
  }
  if (state.algorithm !== SEEDED_RNG_ALGORITHM) {
    throw new Error(`Unsupported RNG algorithm "${String(state.algorithm)}".`);
  }
  if (!Array.isArray(state.words) || state.words.length !== 4) {
    throw new Error("RNG state words must contain exactly four uint32 values.");
  }

  const words = Array.from({ length: 4 }, (_, index) => {
    const word = state.words[index];
    if (typeof word !== "number" || !Number.isInteger(word) || word < 0 || word > UINT32_MAX) {
      throw new Error(`RNG state word ${index} must be a uint32 integer.`);
    }
    return word;
  }) as [number, number, number, number];
  if (words.every((word) => word === 0)) {
    throw new Error("RNG state cannot use the all-zero xoshiro state.");
  }
  return words;
}

/** A deterministic, serializable xoshiro128** random number generator. */
export class SeededRng {
  private words: [number, number, number, number];

  constructor(seed: GameSeed) {
    this.words = expandSeedV1(seed);
  }

  static fromState(state: SeededRngStateV1): SeededRng {
    const words = validateState(state);
    const rng = new SeededRng(0);
    rng.words = words;
    return rng;
  }

  nextUint32(): number {
    const [state0, state1, state2, state3] = this.words;
    const result = Math.imul(rotateLeft32(Math.imul(state1, 5) >>> 0, 7), 9) >>> 0;
    const shifted = (state1 << 9) >>> 0;

    let next2 = (state2 ^ state0) >>> 0;
    let next3 = (state3 ^ state1) >>> 0;
    const next1 = (state1 ^ next2) >>> 0;
    const next0 = (state0 ^ next3) >>> 0;
    next2 = (next2 ^ shifted) >>> 0;
    next3 = rotateLeft32(next3, 11);

    this.words = [next0, next1, next2, next3];
    return result;
  }

  nextInt(maxExclusive: number): number {
    if (
      !Number.isInteger(maxExclusive) ||
      maxExclusive < 1 ||
      maxExclusive > UINT32_RANGE
    ) {
      throw new Error("RNG maxExclusive must be an integer in the range 1..2^32.");
    }

    const acceptanceLimit = Math.floor(UINT32_RANGE / maxExclusive) * maxExclusive;
    let value: number;
    do {
      value = this.nextUint32();
    } while (value >= acceptanceLimit);
    return value % maxExclusive;
  }

  exportState(): SeededRngStateV1 {
    return {
      schemaVersion: SEEDED_RNG_STATE_SCHEMA_VERSION,
      algorithm: SEEDED_RNG_ALGORITHM,
      words: [...this.words]
    };
  }
}
