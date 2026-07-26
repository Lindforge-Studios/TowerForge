import { describe, expect, it } from "vitest";
import * as Renderer from "./index.mjs";

function skillSnapshot(overrides = {}) {
  return {
    heroes: {
      schemaVersion: 5,
      units: [{
        id: "commander",
        definitionId: "commander",
        label: "Commander",
        coord: { q: 1, r: 2 },
        movement: { targetCoord: null, nextCoord: null, edgeProgress: 0 },
        durability: {
          hp: 100, maxHp: 100, shield: { current: 10, capacity: 20 }, defeated: false
        },
        mana: { current: 40, max: 100, regenerationPerUnit: 5 },
        activeAbility: {
          id: "arc_bolt", label: "Arc Bolt", target: "enemy", manaCost: 20,
          cooldown: 3, cooldownRemaining: 0, range: 8, damage: 30, ready: true
        },
        skills: {
          availablePoints: 1,
          startingPoints: 1,
          pointsPerInterwave: 1,
          maximumEarnablePoints: 5,
          managementAvailable: true,
          nodes: [{
            id: "focused_cast",
            label: "Focused Cast",
            description: "Increase active ability damage.",
            cost: 1,
            requiresSkillIds: [],
            missingRequirementIds: [],
            unlocked: false,
            unlockable: true
          }, {
            id: "overcharge",
            label: "Overcharge",
            description: "Further increase active ability damage.",
            cost: 2,
            requiresSkillIds: ["focused_cast"],
            missingRequirementIds: ["focused_cast"],
            unlocked: false,
            unlockable: false
          }]
        },
        ...overrides
      }]
    }
  };
}

describe("R5.4A shared battle-local hero skill presentation", () => {
  it("projects and deeply freezes only the exact authoritative v5 skills state", () => {
    const source = skillSnapshot();
    const projected = Renderer.projectHeroesPresentation(source);

    expect(projected).toEqual({ active: true, units: [source.heroes.units[0]] });
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.units[0].skills)).toBe(true);
    expect(Object.isFrozen(projected.units[0].skills.nodes)).toBe(true);
    expect(Object.isFrozen(projected.units[0].skills.nodes[0])).toBe(true);
    expect(Object.isFrozen(projected.units[0].skills.nodes[0].requiresSkillIds)).toBe(true);
    expect(Object.isFrozen(projected.units[0].skills.nodes[0].missingRequirementIds)).toBe(true);

    source.heroes.units[0].skills.availablePoints = 0;
    source.heroes.units[0].skills.nodes[0].unlockable = false;
    expect(projected.units[0].skills.availablePoints).toBe(1);
    expect(projected.units[0].skills.nodes[0].unlockable).toBe(true);
  });

  it("accepts authoritative locked/unlocked interwave states without recomputing them", () => {
    const projected = Renderer.projectHeroesPresentation(skillSnapshot({
      skills: {
        availablePoints: 0,
        startingPoints: 1,
        pointsPerInterwave: 1,
        maximumEarnablePoints: 5,
        managementAvailable: false,
        nodes: [{
          id: "focused_cast",
          label: "Focused Cast",
          description: "Increase active ability damage.",
          cost: 1,
          requiresSkillIds: [],
          missingRequirementIds: [],
          unlocked: true,
          unlockable: false
        }]
      }
    }));

    expect(projected).toMatchObject({
      active: true,
      units: [{
        skills: {
          availablePoints: 0,
          managementAvailable: false,
          nodes: [{ unlocked: true, unlockable: false }]
        }
      }]
    });
  });

  it("trusts the authoritative false unlockability of a defeated hero", () => {
    const projected = Renderer.projectHeroesPresentation(skillSnapshot({
      durability: { hp: 0, maxHp: 100, shield: { current: 0, capacity: 20 }, defeated: true },
      activeAbility: {
        id: "arc_bolt", label: "Arc Bolt", target: "enemy", manaCost: 20,
        cooldown: 3, cooldownRemaining: 0, range: 8, damage: 30, ready: false
      },
      skills: {
        availablePoints: 1,
        startingPoints: 1,
        pointsPerInterwave: 1,
        maximumEarnablePoints: 5,
        managementAvailable: true,
        nodes: [{
          id: "focused_cast",
          label: "Focused Cast",
          description: "Increase active ability damage.",
          cost: 1,
          requiresSkillIds: [],
          missingRequirementIds: [],
          unlocked: false,
          unlockable: false
        }]
      }
    }));

    expect(projected).toMatchObject({
      active: true,
      units: [{ durability: { defeated: true }, skills: { nodes: [{ unlockable: false }] } }]
    });
  });

  it("fails closed for malformed or future skill snapshots", () => {
    const valid = skillSnapshot().heroes.units[0];
    for (const unit of [
      { ...valid, skills: { ...valid.skills, availablePoints: -1 } },
      { ...valid, skills: { ...valid.skills, managementAvailable: "yes" } },
      { ...valid, skills: { ...valid.skills, nodes: [valid.skills.nodes[0], valid.skills.nodes[0]] } },
      {
        ...valid,
        skills: {
          ...valid.skills,
          nodes: [{ ...valid.skills.nodes[0], missingRequirementIds: ["ghost"], unlockable: true }]
        }
      },
      { ...valid, skills: { ...valid.skills, extra: true } },
      { ...valid, skills: undefined }
    ]) {
      expect(Renderer.projectHeroesPresentation({
        heroes: { schemaVersion: 5, units: [unit] }
      })).toEqual({ active: false, units: [] });
    }
    expect(Renderer.projectHeroesPresentation({
      heroes: { ...skillSnapshot().heroes, schemaVersion: 6 }
    })).toEqual({ active: false, units: [] });
  });

  it("keeps absent, null-tree v1-v4, and future paths free of skill presentation", () => {
    expect(Renderer.projectHeroesPresentation({})).toEqual({ active: false, units: [] });
    const legacyV4 = structuredClone(skillSnapshot().heroes.units[0]);
    delete legacyV4.skills;
    const projected = Renderer.projectHeroesPresentation({
      heroes: { schemaVersion: 4, units: [legacyV4] }
    });
    expect(projected).toMatchObject({ active: true, units: [{ activeAbility: { id: "arc_bolt" } }] });
    expect(projected.units[0]).not.toHaveProperty("skills");
  });
});
