import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../..");
const FIXTURE = path.join(ROOT, "docs/examples/opt-in-vanguard-protection");

async function text(relativePath) {
  return readFile(path.join(ROOT, relativePath), "utf8");
}

async function json(relativePath) {
  return JSON.parse(await text(relativePath));
}

describe("R12.4 vanguard protection docs and opt-in fixture (RED)", () => {
  it("ships a detached reference catalog with dynamic flow, root Combat shields and protection", async () => {
    const mechanics = await json("docs/examples/opt-in-vanguard-protection/mechanics.json");

    expect(mechanics).toMatchObject({
      schemaVersion: 1,
      modules: {
        navigation: {
          schemaVersion: 1,
          enabled: true,
          profiles: {
            basic_dynamic_navigation: { mode: "dynamic_flow" }
          }
        },
        combat: {
          schemaVersion: 1,
          enabled: true,
          profiles: {
            vanguard_root_shields: {
              shields: {
                enemies: {
                  armored_brute: { capacity: 60 }
                }
              }
            }
          }
        },
        enemyBehaviors: {
          schemaVersion: 1,
          enabled: true,
          profiles: {
            basic_vanguard_protection: {
              formations: {
                cohorts: {
                  main: {
                    members: {
                      armored_brute: "vanguard",
                      basic_grunt: "body",
                      swift_runner: "support"
                    },
                    protection: {
                      radius: 2,
                      sourceKinds: ["tower", "ability", "tower_script", "status", "reaction", "enemy"]
                    }
                  }
                }
              }
            }
          }
        }
      }
    });
  });

  it("selects all three independent prerequisites explicitly", async () => {
    const mission = await json("docs/examples/opt-in-vanguard-protection/mission-selection.json");
    expect(mission).toEqual({
      mechanics: {
        profiles: {
          navigation: "basic_dynamic_navigation",
          combat: "vanguard_root_shields",
          enemyBehaviors: "basic_vanguard_protection"
        }
      }
    });
  });

  it("documents one-hop shield interception and the two hard public-tick budgets", async () => {
    const docs = await Promise.all([
      text("ARCHITECTURE.md"),
      text("docs/td-constructor-architecture.md"),
      text("docs/ROADMAP.md"),
      text("docs/runbook.md"),
      text("docs/adr/0053-r12-advanced-enemy-behaviors.md"),
      readFile(path.join(FIXTURE, "README.md"), "utf8")
    ]);
    const corpus = docs.join("\n");

    expect(corpus).toContain("vanguardDamageIntercepted");
    expect(corpus).toMatch(/read-only GameEvent/i);
    expect(corpus).toMatch(/(?:not|is not|never).{0,80}TowerScript/is);
    expect(corpus).toMatch(/16.{0,80}(?:candidate|candidate inspections)/is);
    expect(corpus).toMatch(/512.{0,80}(?:redirect|interception)/is);
    expect(corpus).toMatch(/one-hop|single-hop/i);
    expect(corpus).toMatch(/root Combat shield/i);
    expect(corpus).toMatch(/absent|disabled|unselected/i);
  });
});
