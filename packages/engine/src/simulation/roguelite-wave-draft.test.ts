import { describe, expect, it } from "vitest";
import {
  computeCheckpointStateDigest,
  createGameContentRegistry,
  decodeGameCommandJournal,
  dispatchGameCommand,
  JournaledGameSession,
  replayGameCommandJournal,
  SeededRng,
  type GameCheckpointV1,
  type GameCommandV3,
  type GameCommandJournalV3,
  type GameContentInput,
  type GameContentRegistry,
  type SeededRngStateV1
} from "../index.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";

type DraftMode = "absent" | "disabled" | "v1" | "v2" | "v3_no_draft" | "active" | "v4";

interface DraftOfferSnapshotFixture {
  offerId: string;
  afterWaveIndex: number;
  poolId: string;
  options: Array<{ cardId: string; label: string }>;
}

interface DraftSnapshotFixture {
  pendingOffer: DraftOfferSnapshotFixture | null;
  selections: Array<{ cardId: string; label: string; count: number }>;
}

interface DraftCheckpointStateV1Fixture {
  schemaVersion: 1;
  rng: {
    initial: SeededRngStateV1;
    current: SeededRngStateV1;
  };
  nextOfferSequence: number;
  pendingOffer: null | {
    offerId: string;
    afterWaveIndex: number;
    poolId: string;
    cardIds: [string, string, string];
  };
  selections: Array<{ sequence: number; offerId: string; cardId: string }>;
}

type MutableDraftCheckpointState = Omit<GameCheckpointV1["state"], "draft" | "waveState"> & {
  draft?: DraftCheckpointStateV1Fixture;
  waveState: GameCheckpointV1["state"]["waveState"];
};

type MutableDraftCheckpoint = Omit<GameCheckpointV1, "state" | "stateDigest"> & {
  state: MutableDraftCheckpointState;
  stateDigest: string;
};

function card(label: string, value: number): Record<string, unknown> {
  return {
    label,
    effects: [{
      kind: "modifier",
      scope: { kind: "all_towers" },
      modifier: { target: "damage", operation: "additive_ratio", value }
    }]
  };
}

function draftBlock(reverse = false): Record<string, unknown> {
  const definitions = reverse
    ? {
        bloom: card("Bloom", 0.4),
        storm: card("Storm", 0.3),
        frost: card("Frost", 0.2),
        ember: card("Ember", 0.1)
      }
    : {
        ember: card("Ember", 0.1),
        frost: card("Frost", 0.2),
        storm: card("Storm", 0.3),
        bloom: card("Bloom", 0.4)
      };
  const entries = reverse
    ? [
        { cardId: "bloom", weight: 4 },
        { cardId: "storm", weight: 3 },
        { cardId: "frost", weight: 2 },
        { cardId: "ember", weight: 1 }
      ]
    : [
        { cardId: "ember", weight: 1 },
        { cardId: "frost", weight: 2 },
        { cardId: "storm", weight: 3 },
        { cardId: "bloom", weight: 4 }
      ];
  return {
    definitions,
    pools: { default: { entries } },
    defaultPoolId: "default"
  };
}

function profile(mode: DraftMode, reverse = false): Record<string, unknown> {
  if (mode === "v2") {
    return {
      synergies: {},
      artifacts: { definitions: {}, towerSlots: {}, bossLootTables: {} }
    };
  }
  if (mode === "active" || mode === "v4") return {
    synergies: {},
    draft: draftBlock(reverse),
    ...(mode === "v4" ? {
      artifacts: { definitions: {}, towerSlots: {}, bossLootTables: {} },
      campaign: { schemaVersion: 1 }
    } : {})
  };
  return { synergies: {} };
}

function runtimeInput(mode: DraftMode = "active", reverse = false): GameContentInput {
  const hasModule = mode !== "absent";
  return {
    balance: {
      defaultMissionId: "draft",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 100,
        startingResources: { coins: 100 },
        prepTimeUnits: 2,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 1,
        pathWaterDurationUnits: 1,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      terrainTypes: {
        floor: {
          id: "floor", label: "Floor", buildable: true, walkable: true,
          groundSpeedMultiplier: 1, tags: []
        }
      },
      abilities: {
        strike: {
          id: "strike", label: "Strike", cooldown: 0, duration: 0, radius: 1,
          effects: [{ kind: "damage", amount: 100 }]
        }
      },
      enemies: {
        grunt: {
          id: "grunt", label: "Grunt", maxHp: 100, speed: 0.01,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        }
      },
      towers: {
        cannon: {
          id: "cannon", label: "Cannon", cost: { coins: 1 }, footprintRadius: 0, range: 5,
          attack: {
            kind: "single", fireRate: 1, damagePerStack: 1,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1
          }
        }
      },
      waveSets: {
        run: [1, 2].map((number) => ({
          id: `wave_${number}`,
          label: `Wave ${number}`,
          groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }]
        }))
      },
      missions: {
        draft: {
          id: "draft", label: "Draft", description: "", startingCoreHp: 20,
          startingResources: { coins: 100 }, prepTimeUnits: 2,
          economy: { passivePerTimeUnit: { coins: 2 } },
          mapId: "lane", waveSetId: "run", buildTowerIds: ["cannon"], abilityIds: ["strike"],
          ...(hasModule ? { mechanics: { profiles: { roguelite: "run" } } } : {})
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 8, height: 3,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "floor", spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 7, r: 1 },
        pathCenterline: Array.from({ length: 8 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [], terrainOverrides: []
      }
    },
    ...(hasModule ? {
      mechanics: {
        schemaVersion: 1,
        modules: {
          roguelite: {
            schemaVersion: mode === "v1" ? 1 : mode === "v2" ? 2 : mode === "v4" ? 4 : 3,
            enabled: mode !== "disabled",
            profiles: { run: profile(mode, reverse) }
          }
        }
      }
    } : {}),
    worldMap: {
      width: 10, height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "draft", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function content(mode: DraftMode = "active", reverse = false): GameContentRegistry {
  return createGameContentRegistry(runtimeInput(mode, reverse));
}

function game(mode: DraftMode = "active", seed = "draft-seed", reverse = false): TowerDefenseGame {
  return new TowerDefenseGame({ content: content(mode, reverse), missionId: "draft", seed });
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function draftSnapshot(subject: { getSnapshot(): ReturnType<TowerDefenseGame["getSnapshot"]> }): DraftSnapshotFixture | undefined {
  return (subject.getSnapshot() as unknown as {
    roguelite?: { draft?: DraftSnapshotFixture };
  }).roguelite?.draft;
}

function draftCheckpoint(subject: TowerDefenseGame): DraftCheckpointStateV1Fixture | undefined {
  return (subject.createCheckpoint().state as GameCheckpointV1["state"] & {
    draft?: DraftCheckpointStateV1Fixture;
  }).draft;
}

function clearFirstWave(subject: TowerDefenseGame): DraftOfferSnapshotFixture {
  expect(subject.startNextWave()).toEqual({ ok: true });
  subject.tick(0);
  expect(subject.getSnapshot().enemies).toHaveLength(1);
  expect(subject.useAbility("strike", { q: 0, r: 1 })).toEqual({ ok: true });
  subject.tick(0);
  expect(subject.getSnapshot()).toMatchObject({
    clearedWaveCount: 1,
    waveState: "between",
    outcome: "playing"
  });
  const pending = draftSnapshot(subject)?.pendingOffer;
  expect(pending).not.toBeNull();
  expect(pending).toBeDefined();
  return pending!;
}

function resign(checkpoint: MutableDraftCheckpoint): void {
  checkpoint.stateDigest = computeCheckpointStateDigest(
    checkpoint.contentDigest,
    checkpoint.identity,
    checkpoint.rng,
    checkpoint.state
  );
}

function samplePoolOffers(
  initial: SeededRngStateV1,
  entries: Array<{ cardId: string; weight: number }>,
  count: number
): { offers: Array<[string, string, string]>; current: SeededRngStateV1 } {
  const rng = SeededRng.fromState(initial);
  const offers: Array<[string, string, string]> = [];
  for (let offerIndex = 0; offerIndex < count; offerIndex += 1) {
    const remaining = entries.map((entry) => ({ ...entry }));
    const selected: string[] = [];
    while (selected.length < 3) {
      const totalWeight = remaining.reduce((sum, entry) => sum + entry.weight, 0);
      let cursor = rng.nextInt(totalWeight);
      let selectedIndex = 0;
      for (let index = 0; index < remaining.length; index += 1) {
        if (cursor < remaining[index]!.weight) {
          selectedIndex = index;
          break;
        }
        cursor -= remaining[index]!.weight;
      }
      selected.push(remaining.splice(selectedIndex, 1)[0]!.cardId);
    }
    offers.push(selected as [string, string, string]);
  }
  return { offers, current: rng.exportState() };
}

// Compile-time coverage for the new exact public version domains.
const exactChooseCommand: GameCommandV3 = {
  schemaVersion: 3,
  type: "chooseDraftOption",
  offerId: "draft_offer_1",
  cardId: "ember"
};
type JournalV3Version = GameCommandJournalV3["schemaVersion"];
const journalV3Version: JournalV3Version = 3;
void exactChooseCommand;
void journalV3Version;

describe("R4.3B deterministic interwave draft runtime", () => {
  it("keeps the v3 draft runtime and snapshot/checkpoint versions under a v4 campaign profile", () => {
    const subject = game("v4", "v4-draft-seed");
    expect(subject.getSnapshot().roguelite).toMatchObject({
      schemaVersion: 4,
      draft: { pendingOffer: null, selections: [] },
      artifacts: { inventory: [], towerSlots: [] }
    });
    expect(draftCheckpoint(subject)).toMatchObject({ schemaVersion: 1, pendingOffer: null, selections: [] });
    expect(subject.createCheckpoint().state.artifacts).toMatchObject({ schemaVersion: 1, inventory: [] });
    expect(clearFirstWave(subject).options).toHaveLength(3);
  });

  it("keeps absent/v1/v2/v3-without-draft paths free of draft state and keeps draft-only free of artifacts", () => {
    for (const mode of ["absent", "disabled", "v1", "v2", "v3_no_draft"] as const) {
      const subject = game(mode);
      expect(draftSnapshot(subject), mode).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(subject.createCheckpoint().state, "draft"), mode).toBe(false);
    }

    const active = game();
    const roguelite = active.getSnapshot().roguelite as unknown as Record<string, unknown>;
    expect(roguelite.schemaVersion).toBe(4);
    expect(roguelite.draft).toEqual({ pendingOffer: null, selections: [] });
    expect(Object.prototype.hasOwnProperty.call(roguelite, "artifacts")).toBe(false);
    expect(draftCheckpoint(active)).toMatchObject({
      schemaVersion: 1,
      nextOfferSequence: 1,
      pendingOffer: null,
      selections: []
    });
  });

  it("samples exactly three unique deterministic options independent of authored object order", () => {
    const canonical = game("active", "same-seed", false);
    const reordered = game("active", "same-seed", true);
    const first = clearFirstWave(canonical);
    const second = clearFirstWave(reordered);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      offerId: "draft_offer_1",
      afterWaveIndex: 0,
      poolId: "default"
    });
    expect(first.options).toHaveLength(3);
    expect(new Set(first.options.map((option) => option.cardId)).size).toBe(3);
    expect(first.options.every((option) => typeof option.label === "string" && option.label.length > 0)).toBe(true);

    const checkpoint = draftCheckpoint(canonical)!;
    expect(checkpoint.pendingOffer).toEqual({
      offerId: first.offerId,
      afterWaveIndex: 0,
      poolId: "default",
      cardIds: first.options.map((option) => option.cardId)
    });
    expect(checkpoint.rng.current).toEqual(draftCheckpoint(reordered)?.rng.current);
  });

  it("freezes the whole simulation and blocks manual or scheduled wave starts until an exact choice", () => {
    const subject = game("active", "freeze-seed");
    const offer = clearFirstWave(subject);
    const frozen = clone(subject.createCheckpoint());
    expect(frozen.state.lastEvents.length).toBeGreaterThan(0);
    expect(frozen.state.scriptEventCursor).toBeGreaterThan(0);

    expect(subject.startNextWave()).toMatchObject({
      ok: false,
      reasonKey: "reason.draftChoiceRequired"
    });
    subject.tick(100);
    const afterTick = clone(subject.createCheckpoint());
    expect(afterTick.state.lastEvents).toEqual([]);
    expect(afterTick.state.scriptEventCursor).toBe(0);
    const {
      lastEvents: _frozenEvents,
      scriptEventCursor: _frozenEventCursor,
      ...frozenDurableState
    } = frozen.state;
    const {
      lastEvents: _afterEvents,
      scriptEventCursor: _afterEventCursor,
      ...afterDurableState
    } = afterTick.state;
    expect(afterDurableState).toEqual(frozenDurableState);
    expect(afterTick.identity).toEqual(frozen.identity);
    expect(afterTick.rng).toEqual(frozen.rng);
    expect(draftSnapshot(subject)?.pendingOffer).toEqual(offer);

    const beforeInvalid = subject.getStateDigest();
    expect(dispatchGameCommand(subject, {
      schemaVersion: 3,
      type: "chooseDraftOption",
      offerId: offer.offerId,
      cardId: offer.options[0]!.cardId,
      extra: true
    })).toMatchObject({ ok: false, reasonKey: "reason.invalidGameCommand" });
    expect(subject.getStateDigest()).toBe(beforeInvalid);

    expect(dispatchGameCommand(subject, {
      schemaVersion: 3,
      type: "chooseDraftOption",
      offerId: offer.offerId,
      cardId: "not_offered"
    })).toMatchObject({ ok: false, reasonKey: "reason.draftOptionUnavailable" });
    expect(subject.getStateDigest()).toBe(beforeInvalid);
  });

  it("round-trips a pending checkpoint after tick clears transient events and keeps the script cursor coherent", () => {
    const subjectContent = content();
    const subject = new TowerDefenseGame({
      content: subjectContent,
      missionId: "draft",
      seed: "pending-transient-roundtrip"
    });
    clearFirstWave(subject);
    expect(subject.createCheckpoint().state.lastEvents.length).toBeGreaterThan(0);

    subject.tick(100);
    const checkpoint = clone(subject.createCheckpoint());
    expect(checkpoint.state.lastEvents).toEqual([]);
    expect(checkpoint.state.scriptEventCursor).toBe(0);
    const restored = TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint });
    expect(restored.getStateDigest()).toBe(subject.getStateDigest());
    expect(restored.getSnapshot()).toEqual(subject.getSnapshot());
  });

  it("rejects a digest-valid pending offer forged from a valid non-default pool", () => {
    const source = runtimeInput("active") as unknown as GameContentInput & {
      mechanics: { modules: { roguelite: { profiles: { run: { draft: {
        definitions: Record<string, unknown>;
        pools: Record<string, { entries: Array<{ cardId: string; weight: number }> }>;
      } } } } } };
    };
    const authoredDraft = source.mechanics.modules.roguelite.profiles.run.draft;
    authoredDraft.definitions.reserve_1 = card("Reserve one", 0.1);
    authoredDraft.definitions.reserve_2 = card("Reserve two", 0.2);
    authoredDraft.definitions.reserve_3 = card("Reserve three", 0.3);
    authoredDraft.pools.alternate = {
      entries: ["reserve_1", "reserve_2", "reserve_3"].map((cardId, index) => ({
        cardId,
        weight: index + 1
      }))
    };
    const subjectContent = createGameContentRegistry(source);
    const subject = new TowerDefenseGame({ content: subjectContent, missionId: "draft", seed: "alternate-pool" });
    clearFirstWave(subject);
    const checkpoint = clone(subject.createCheckpoint()) as MutableDraftCheckpoint;
    const alternate = samplePoolOffers(
      checkpoint.state.draft!.rng.initial,
      authoredDraft.pools.alternate.entries,
      1
    );
    checkpoint.state.draft!.pendingOffer!.poolId = "alternate";
    checkpoint.state.draft!.pendingOffer!.cardIds = alternate.offers[0]!;
    checkpoint.state.draft!.rng.current = alternate.current;
    resign(checkpoint);

    expect(() => TowerDefenseGame.fromCheckpoint({
      content: subjectContent,
      checkpoint: checkpoint as GameCheckpointV1
    })).toThrow(/draft|default|pool|offer|checkpoint/i);
  });

  it("suppresses a draft offer after a terminal objective and rejects terminal draft choices", () => {
    const source = runtimeInput("active");
    source.balance.missions.draft!.objectives = {
      victory: [{ id: "one_kill", kind: "killCount", count: 1, enemyTypeId: "grunt" }]
    };
    const subject = new TowerDefenseGame({
      content: createGameContentRegistry(source),
      missionId: "draft",
      seed: "terminal-draft"
    });

    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0);
    expect(subject.useAbility("strike", { q: 0, r: 1 })).toEqual({ ok: true });
    subject.tick(0);
    expect(subject.getSnapshot().outcome).toBe("victory");
    expect(draftSnapshot(subject)?.pendingOffer).toBeNull();
    expect(dispatchGameCommand(subject, {
      schemaVersion: 3,
      type: "chooseDraftOption",
      offerId: "draft_offer_1",
      cardId: "ember"
    })).toMatchObject({ ok: false });
    expect(draftSnapshot(subject)?.pendingOffer).toBeNull();
  });

  it("applies a choice once, clears the offer, starts fresh prep, and restores exact selection order", () => {
    const subjectContent = content();
    const subject = new TowerDefenseGame({ content: subjectContent, missionId: "draft", seed: "choose-seed" });
    const offer = clearFirstWave(subject);
    const beforeChoice = clone(subject.createCheckpoint());
    const restoredPending = TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint: beforeChoice });
    expect(restoredPending.getStateDigest()).toBe(subject.getStateDigest());
    expect(restoredPending.getSnapshot()).toEqual(subject.getSnapshot());

    const picked = offer.options[0]!;
    const command: GameCommandV3 = {
      schemaVersion: 3,
      type: "chooseDraftOption",
      offerId: offer.offerId,
      cardId: picked.cardId
    };
    expect(dispatchGameCommand(subject, command)).toEqual({ ok: true });
    expect(subject.getSnapshot()).toMatchObject({ waveState: "between", prepRemaining: 2 });
    expect(draftSnapshot(subject)).toEqual({
      pendingOffer: null,
      selections: [{ cardId: picked.cardId, label: picked.label, count: 1 }]
    });
    expect(draftCheckpoint(subject)).toMatchObject({
      schemaVersion: 1,
      nextOfferSequence: 2,
      pendingOffer: null,
      selections: [{ sequence: 1, offerId: offer.offerId, cardId: picked.cardId }]
    });

    const restoredChoice = TowerDefenseGame.fromCheckpoint({
      content: subjectContent,
      checkpoint: clone(subject.createCheckpoint())
    });
    expect(restoredChoice.getStateDigest()).toBe(subject.getStateDigest());
    expect(restoredChoice.getSnapshot()).toEqual(subject.getSnapshot());

    expect(subject.placeTower("cannon", { q: 1, r: 0 })).toEqual({ ok: true });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0);
    const ratioByCardId: Record<string, number> = { ember: 0.1, frost: 0.2, storm: 0.3, bloom: 0.4 };
    let hit = subject.getSnapshot().lastEvents.find((event) => event.type === "enemyHit");
    for (let attempt = 0; attempt < 8 && !hit; attempt += 1) {
      subject.tick(0.25);
      hit = subject.getSnapshot().lastEvents.find((event) => event.type === "enemyHit");
    }
    expect(hit).toMatchObject({ type: "enemyHit", towerId: "tower_1", damage: 1 + ratioByCardId[picked.cardId]! });
  });

  it("promotes to exact JournalV3 and replays a chooseDraftOption command to the same digest", () => {
    const subjectContent = content();
    const session = new JournaledGameSession(new TowerDefenseGame({
      content: subjectContent,
      missionId: "draft",
      seed: "journal-draft"
    }));
    for (const command of [
      { schemaVersion: 1, type: "startWave" },
      { schemaVersion: 1, type: "tick", units: 0 },
      { schemaVersion: 1, type: "useAbility", abilityId: "strike", center: { q: 0, r: 1 } },
      { schemaVersion: 1, type: "tick", units: 0 }
    ] as const) {
      expect(session.dispatch(command)).toEqual({ ok: true });
    }
    const offer = draftSnapshot(session.game)?.pendingOffer;
    expect(offer).not.toBeNull();
    expect(offer).toBeDefined();
    const command: GameCommandV3 = {
      schemaVersion: 3,
      type: "chooseDraftOption",
      offerId: offer!.offerId,
      cardId: offer!.options[0]!.cardId
    };
    expect(session.dispatch(command)).toEqual({ ok: true });

    const journal = session.exportJournal() as GameCommandJournalV3;
    expect(journal.schemaVersion).toBe(3);
    expect(journal.entries.at(-1)?.command).toEqual(command);
    expect(decodeGameCommandJournal({ content: subjectContent, journal: clone(journal) })).toEqual(journal);
    const replay = replayGameCommandJournal({ content: subjectContent, journal: clone(journal) });
    expect(replay.stateDigest).toBe(session.game.getStateDigest());
    expect(replay.game.getSnapshot()).toEqual(session.game.getSnapshot());
  });

  it("rejects missing, malformed, or inactive inner draft checkpoints even after a valid digest is recomputed", () => {
    const subjectContent = content();
    const subject = new TowerDefenseGame({ content: subjectContent, missionId: "draft", seed: "hostile-draft" });
    clearFirstWave(subject);
    const checkpoint = clone(subject.createCheckpoint()) as MutableDraftCheckpoint;
    const malformed: Array<readonly [string, (candidate: MutableDraftCheckpoint) => void]> = [
      ["missing", (candidate) => { delete candidate.state.draft; }],
      ["duplicate card", (candidate) => {
        candidate.state.draft!.pendingOffer!.cardIds[1] = candidate.state.draft!.pendingOffer!.cardIds[0];
      }],
      ["unknown card", (candidate) => {
        candidate.state.draft!.pendingOffer!.cardIds[0] = "missing_card";
      }],
      ["bad sequence", (candidate) => { candidate.state.draft!.nextOfferSequence = 99; }]
    ];
    for (const [label, mutate] of malformed) {
      const candidate = clone(checkpoint);
      mutate(candidate);
      resign(candidate);
      expect(
        () => TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint: candidate as GameCheckpointV1 }),
        label
      ).toThrow(/draft|offer|card|sequence|required|checkpoint/i);
    }

    const inactiveContent = content("v3_no_draft");
    const inactive = clone(new TowerDefenseGame({
      content: inactiveContent,
      missionId: "draft",
      seed: "inactive-draft"
    }).createCheckpoint()) as MutableDraftCheckpoint;
    inactive.state.draft = clone(checkpoint.state.draft!);
    resign(inactive);
    expect(() => TowerDefenseGame.fromCheckpoint({ content: inactiveContent, checkpoint: inactive as GameCheckpointV1 }))
      .toThrow(/draft|inactive|unsupported|checkpoint|field/i);
  });

  it("rejects a digest-valid initial checkpoint with a forged out-of-pool selection", () => {
    const source = runtimeInput("active") as unknown as GameContentInput & {
      mechanics: { modules: { roguelite: { profiles: { run: { draft: {
        definitions: Record<string, unknown>;
      } } } } } };
    };
    source.mechanics.modules.roguelite.profiles.run.draft.definitions.reserve = card("Reserve", 0.5);
    const subjectContent = createGameContentRegistry(source);
    const checkpoint = clone(new TowerDefenseGame({
      content: subjectContent,
      missionId: "draft",
      seed: "forged-initial-selection"
    }).createCheckpoint()) as MutableDraftCheckpoint;
    expect(checkpoint.state.clearedWaveCount).toBe(0);
    checkpoint.state.draft!.nextOfferSequence = 2;
    checkpoint.state.draft!.selections = [{
      sequence: 1,
      offerId: "draft_offer_1",
      cardId: "reserve"
    }];
    resign(checkpoint);

    expect(() => TowerDefenseGame.fromCheckpoint({
      content: subjectContent,
      checkpoint: checkpoint as GameCheckpointV1
    })).toThrow(/draft|selection|pool|wave|checkpoint/i);
  });

  it("round-trips a legitimate final-wave no-offer state and rejects impossible final draft history", () => {
    const source = runtimeInput("active");
    source.balance.missions.draft!.objectives = {
      victory: [{ id: "unmet_wealth", kind: "accumulateResource", resourceId: "coins", amount: 10_000 }]
    };
    const subjectContent = createGameContentRegistry(source);
    const subject = new TowerDefenseGame({ content: subjectContent, missionId: "draft", seed: "final-wave-draft" });
    const firstOffer = clearFirstWave(subject);
    expect(dispatchGameCommand(subject, {
      schemaVersion: 3,
      type: "chooseDraftOption",
      offerId: firstOffer.offerId,
      cardId: firstOffer.options[0]!.cardId
    })).toEqual({ ok: true });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0);
    expect(subject.useAbility("strike", { q: 0, r: 1 })).toEqual({ ok: true });
    subject.tick(0);
    expect(subject.getSnapshot()).toMatchObject({
      clearedWaveCount: 2,
      waveState: "complete",
      outcome: "playing"
    });
    expect(draftSnapshot(subject)).toMatchObject({ pendingOffer: null, selections: [{ count: 1 }] });

    const finalCheckpoint = clone(subject.createCheckpoint()) as MutableDraftCheckpoint;
    const restored = TowerDefenseGame.fromCheckpoint({
      content: subjectContent,
      checkpoint: finalCheckpoint as GameCheckpointV1
    });
    expect(restored.getStateDigest()).toBe(subject.getStateDigest());
    expect(restored.getSnapshot()).toEqual(subject.getSnapshot());

    const defaultEntries = (draftBlock() as {
      pools: { default: { entries: Array<{ cardId: string; weight: number }> } };
    }).pools.default.entries;
    const twoOffers = samplePoolOffers(finalCheckpoint.state.draft!.rng.initial, defaultEntries, 2);

    const tooManySelections = clone(finalCheckpoint);
    tooManySelections.state.draft!.selections.push({
      sequence: 2,
      offerId: "draft_offer_2",
      cardId: twoOffers.offers[1]![0]
    });
    tooManySelections.state.draft!.nextOfferSequence = 3;
    tooManySelections.state.draft!.rng.current = twoOffers.current;
    resign(tooManySelections);
    expect(() => TowerDefenseGame.fromCheckpoint({
      content: subjectContent,
      checkpoint: tooManySelections as GameCheckpointV1
    })).toThrow(/draft|selection|final|wave|checkpoint/i);

    const pendingAfterFinal = clone(finalCheckpoint);
    pendingAfterFinal.state.waveState = "between";
    pendingAfterFinal.state.draft!.pendingOffer = {
      offerId: "draft_offer_2",
      afterWaveIndex: 1,
      poolId: "default",
      cardIds: twoOffers.offers[1]!
    };
    pendingAfterFinal.state.draft!.nextOfferSequence = 3;
    pendingAfterFinal.state.draft!.rng.current = twoOffers.current;
    resign(pendingAfterFinal);
    expect(() => TowerDefenseGame.fromCheckpoint({
      content: subjectContent,
      checkpoint: pendingAfterFinal as GameCheckpointV1
    })).toThrow(/draft|offer|final|wave|checkpoint/i);
  });
});
