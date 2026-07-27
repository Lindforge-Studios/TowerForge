import { describe, expect, it } from "vitest";
import * as renderer from "./index.mjs";

function projector() {
  expect(renderer.projectRoguelitePresentation).toBeTypeOf("function");
  return renderer.projectRoguelitePresentation;
}

function expectDeeplyFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child, seen);
}

describe("R4.1A shared rogue-lite synergy presentation", () => {
  it("projects the authoritative active snapshot into detached sorted status rows", () => {
    const snapshot = {
      roguelite: {
        schemaVersion: 1,
        synergies: [
          {
            synergyId: "tech_grid",
            label: "Tech Grid",
            tag: "tech",
            towerCount: 4,
            tierMode: "cumulative",
            activeTierRequiredCounts: [2, 4]
          },
          {
            synergyId: "elemental_convergence",
            label: "Elemental Convergence",
            tag: "elemental",
            towerCount: 3,
            tierMode: "highest",
            activeTierRequiredCounts: [2]
          }
        ]
      }
    };

    const projected = projector()(snapshot);

    expect(projected).toEqual({
      active: true,
      synergies: [
        {
          synergyId: "elemental_convergence",
          label: "Elemental Convergence",
          tag: "elemental",
          towerCount: 3,
          tierMode: "highest",
          activeTierRequiredCounts: [2]
        },
        {
          synergyId: "tech_grid",
          label: "Tech Grid",
          tag: "tech",
          towerCount: 4,
          tierMode: "cumulative",
          activeTierRequiredCounts: [2, 4]
        }
      ]
    });
    expectDeeplyFrozen(projected);
    snapshot.roguelite.synergies[0].activeTierRequiredCounts[0] = 99;
    expect(projected.synergies[1].activeTierRequiredCounts).toEqual([2, 4]);
  });

  it("returns one inactive value without reading unrelated snapshot fields", () => {
    let reads = 0;
    const snapshot = {};
    Object.defineProperty(snapshot, "lastEvents", {
      enumerable: true,
      get() { reads += 1; throw new Error("inactive projection must stay narrow"); }
    });

    const first = projector()(snapshot);
    const second = projector()(undefined);

    expect(first).toEqual({ active: false, synergies: [] });
    expect(second).toBe(first);
    expect(reads).toBe(0);
    expectDeeplyFrozen(first);
  });

  it("projects v2 inventory and bounded drop events while preserving the v1 result shape", () => {
    const snapshot = {
      roguelite: {
        schemaVersion: 2,
        synergies: [],
        artifacts: {
          inventory: [
            { instanceId: "artifact_2", artifactId: "zeta", label: "Zeta", slotType: "core", socket: null },
            { instanceId: "artifact_1", artifactId: "alpha", label: "Alpha", slotType: "optic", socket: null }
          ]
        }
      },
      lastEvents: [
        { type: "enemyKilled", enemyId: "enemy_1", enemyTypeId: "boss", coins: 1, resources: { coins: 1 } },
        {
          type: "artifactDropped",
          enemyId: "enemy_1",
          enemyTypeId: "boss",
          artifactInstanceId: "artifact_2",
          artifactId: "zeta",
          rollIndex: 0
        }
      ]
    };

    const projected = projector()(snapshot);

    expect(projected).toEqual({
      active: true,
      synergies: [],
      artifacts: {
        inventory: [
          { instanceId: "artifact_1", artifactId: "alpha", label: "Alpha", slotType: "optic", socket: null },
          { instanceId: "artifact_2", artifactId: "zeta", label: "Zeta", slotType: "core", socket: null }
        ],
        drops: [{
          enemyId: "enemy_1",
          enemyTypeId: "boss",
          artifactInstanceId: "artifact_2",
          artifactId: "zeta",
          rollIndex: 0
        }]
      }
    });
    expectDeeplyFrozen(projected);
    snapshot.roguelite.artifacts.inventory[0].label = "mutated";
    snapshot.lastEvents[1].artifactId = "mutated";
    expect(projected.artifacts.inventory[1].label).toBe("Zeta");
    expect(projected.artifacts.drops[0].artifactId).toBe("zeta");
  });

  it("projects authoritative v3 sockets, tower slots, and between-wave management without deriving ownership", () => {
    const snapshot = {
      roguelite: {
        schemaVersion: 3,
        synergies: [],
        artifacts: {
          inventory: [
            {
              instanceId: "artifact_2",
              artifactId: "crystal",
              label: "Vampiric crystal",
              slotType: "core",
              socket: null
            },
            {
              instanceId: "artifact_1",
              artifactId: "scope",
              label: "Calibrated scope",
              slotType: "optic",
              socket: { towerId: "tower_2", towerTypeId: "cannon", slotId: "optic" }
            }
          ],
          towerSlots: [
            {
              towerId: "tower_2",
              towerTypeId: "cannon",
              slots: [
                { slotId: "optic", slotType: "optic", artifactInstanceId: "artifact_1" },
                { slotId: "core", slotType: "core", artifactInstanceId: null }
              ]
            },
            {
              towerId: "tower_1",
              towerTypeId: "arrow",
              slots: [{ slotId: "optic", slotType: "optic", artifactInstanceId: null }]
            }
          ],
          management: { allowed: true }
        }
      },
      lastEvents: []
    };

    const projected = projector()(snapshot);

    expect(projected).toEqual({
      active: true,
      synergies: [],
      artifacts: {
        inventory: [
          {
            instanceId: "artifact_1",
            artifactId: "scope",
            label: "Calibrated scope",
            slotType: "optic",
            socket: { towerId: "tower_2", towerTypeId: "cannon", slotId: "optic" }
          },
          {
            instanceId: "artifact_2",
            artifactId: "crystal",
            label: "Vampiric crystal",
            slotType: "core",
            socket: null
          }
        ],
        towerSlots: [
          {
            towerId: "tower_1",
            towerTypeId: "arrow",
            slots: [{ slotId: "optic", slotType: "optic", artifactInstanceId: null }]
          },
          {
            towerId: "tower_2",
            towerTypeId: "cannon",
            slots: [
              { slotId: "core", slotType: "core", artifactInstanceId: null },
              { slotId: "optic", slotType: "optic", artifactInstanceId: "artifact_1" }
            ]
          }
        ],
        management: { allowed: true },
        drops: []
      }
    });
    expectDeeplyFrozen(projected);

    snapshot.roguelite.artifacts.inventory[1].socket.towerId = "mutated";
    snapshot.roguelite.artifacts.towerSlots[0].slots[0].artifactInstanceId = null;
    snapshot.roguelite.artifacts.management.allowed = false;
    expect(projected.artifacts.inventory[0].socket.towerId).toBe("tower_2");
    expect(projected.artifacts.towerSlots[1].slots[1].artifactInstanceId).toBe("artifact_1");
    expect(projected.artifacts.management.allowed).toBe(true);
  });

  it("projects a detached v4 pending wave draft without inventing artifact state", () => {
    const snapshot = {
      roguelite: {
        schemaVersion: 4,
        synergies: [],
        draft: {
          pendingOffer: {
            offerId: "draft_2",
            afterWaveIndex: 0,
            poolId: "starter",
            options: [
              { cardId: "damage", label: "Sharpened bolts" },
              { cardId: "tech", label: "Tech calibration" },
              { cardId: "nature", label: "Living roots" }
            ]
          },
          selections: [
            { cardId: "tech", label: "Tech calibration", count: 1 },
            { cardId: "damage", label: "Sharpened bolts", count: 2 }
          ]
        }
      }
    };

    const projected = projector()(snapshot);

    expect(projected).toEqual({
      active: true,
      synergies: [],
      draft: {
        pendingOffer: {
          offerId: "draft_2",
          afterWaveIndex: 0,
          poolId: "starter",
          options: [
            { cardId: "damage", label: "Sharpened bolts" },
            { cardId: "tech", label: "Tech calibration" },
            { cardId: "nature", label: "Living roots" }
          ]
        },
        selections: [
          { cardId: "damage", label: "Sharpened bolts", count: 2 },
          { cardId: "tech", label: "Tech calibration", count: 1 }
        ]
      }
    });
    expect(projected).not.toHaveProperty("artifacts");
    expectDeeplyFrozen(projected);
    snapshot.roguelite.draft.pendingOffer.options[0].label = "mutated";
    expect(projected.draft.pendingOffer.options[0].label).toBe("Sharpened bolts");
  });

  it("fails closed on future, malformed, sparse, accessor, duplicate, and over-budget sections", () => {
    const row = {
      synergyId: "elemental",
      label: "Elemental",
      tag: "elemental",
      towerCount: 2,
      tierMode: "highest",
      activeTierRequiredCounts: [2]
    };
    const sparse = new Array(1);
    const invalid = [
      { schemaVersion: 5, synergies: [] },
      { schemaVersion: 1 },
      { schemaVersion: 1, synergies: [], extra: true },
      { schemaVersion: 1, synergies: sparse },
      { schemaVersion: 1, synergies: [{ ...row, extra: true }] },
      { schemaVersion: 1, synergies: [{ ...row, towerCount: -1 }] },
      { schemaVersion: 1, synergies: [{ ...row, activeTierRequiredCounts: [4, 2] }] },
      { schemaVersion: 1, synergies: [row, { ...row }] },
      {
        schemaVersion: 1,
        synergies: Array.from({ length: 33 }, (_, index) => ({
          ...row,
          synergyId: `synergy_${index}`,
          activeTierRequiredCounts: []
        }))
      }
    ];
    for (const roguelite of invalid) {
      expect(projector()({ roguelite })).toBeUndefined();
    }

    let reads = 0;
    const section = { schemaVersion: 1 };
    Object.defineProperty(section, "synergies", {
      enumerable: true,
      get() { reads += 1; throw new Error("must not invoke accessors"); }
    });
    expect(() => projector()({ roguelite: section })).not.toThrow();
    expect(projector()({ roguelite: section })).toBeUndefined();
    expect(reads).toBe(0);
  });

  it("does not confuse the authored tier threshold limit with a live tower count", () => {
    const projected = projector()({
      roguelite: {
        schemaVersion: 1,
        synergies: [{
          synergyId: "large_live_board",
          label: "Large Live Board",
          tag: "tech",
          towerCount: 65_537,
          tierMode: "highest",
          activeTierRequiredCounts: [65_536]
        }]
      }
    });

    expect(projected).toMatchObject({
      active: true,
      synergies: [{ towerCount: 65_537, activeTierRequiredCounts: [65_536] }]
    });
  });
});
