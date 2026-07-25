// @ts-expect-error Test-only source-contract import; engine production intentionally has no Node typings.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./TowerDefenseGame.ts", import.meta.url), "utf8");
const resolverCallPattern = /DamageResolver\s*\.\s*resolve\s*\(/g;

function methodBody(methodName: string): string | undefined {
  const signature = new RegExp(`private\\s+${methodName}\\s*\\(`).exec(source);
  if (!signature) return undefined;

  const openingParen = source.indexOf("(", signature.index);
  let parenDepth = 0;
  let closingParen = -1;
  for (let index = openingParen; index < source.length; index += 1) {
    if (source[index] === "(") parenDepth += 1;
    if (source[index] === ")") parenDepth -= 1;
    if (parenDepth === 0) {
      closingParen = index;
      break;
    }
  }
  if (closingParen < 0) return undefined;

  const openingBrace = source.indexOf("{", closingParen);
  if (openingBrace < 0) return undefined;

  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(openingBrace, index + 1);
  }
  return undefined;
}

describe("damage routing equivalence contract", () => {
  it("defines one private resolve-and-apply boundary", () => {
    expect(
      /private\s+resolveAndApplyDamage\s*\(/.test(source),
      "TowerDefenseGame must define private resolveAndApplyDamage"
    ).toBe(true);
  });

  it("has exactly one syntactic DamageResolver.resolve call in the simulation", () => {
    expect(source.match(resolverCallPattern) ?? []).toHaveLength(1);
  });

  it("keeps the sole resolver call inside resolveAndApplyDamage", () => {
    const boundary = methodBody("resolveAndApplyDamage");
    expect(boundary, "resolveAndApplyDamage must be a complete private method").toBeDefined();
    expect(boundary?.match(resolverCallPattern) ?? []).toHaveLength(1);
  });

  it.each([
    ["applyAbilityEffect", ["applyResolvedEnemyDamage"]],
    ["applyScriptAction", ["applyResolvedCoreDamage", "applyResolvedEnemyDamage"]],
    ["updateEnemyStatuses", ["applyResolvedEnemyDamage"]],
    ["moveEnemies", ["applyResolvedCoreDamage"]],
    ["applyDotDamage", ["applyResolvedTowerDamage"]],
    ["updateEnemyTowerAttacks", ["applyResolvedTowerEntityDamage"]],
    ["applyResolvedTowerDamage", ["applyResolvedEnemyDamage"]]
  ] as const)("routes every damage delivery in %s through the shared boundary", (methodName, calls) => {
    const body = methodBody(methodName);
    expect(body, `${methodName} must remain an inspectable private method`).toBeDefined();
    for (const call of calls) expect(body).toContain(`this.${call}(`);
  });

  it("keeps every subtractive HP mutation inside resolveAndApplyDamage", () => {
    const boundary = methodBody("resolveAndApplyDamage");
    expect(boundary).toBeDefined();
    const outsideBoundary = source.replace(boundary!, "");
    const subtractiveHpWrite = /(?:enemy|tower)\.hp\s*(?:-=|=\s*[^;\n]*-)|this\.coreHp\s*(?:-=|=\s*[^;\n]*-)/g;
    expect(outsideBoundary.match(subtractiveHpWrite) ?? []).toEqual([]);
  });

  it("preserves the three target-specific legacy HP formulas inside the boundary", () => {
    const boundary = methodBody("resolveAndApplyDamage")?.replace(/\s+/g, " ");
    expect(boundary).toBeDefined();
    expect(boundary).toContain(
      "mutableTarget.enemy.hp = Math.max(0, mutableTarget.enemy.hp - resolution.finalAmount);"
    );
    expect(boundary).toContain(
      "this.coreHp = Math.max(0, this.coreHp - resolution.finalAmount);"
    );
    expect(boundary).toContain(
      "mutableTarget.tower.hp = (mutableTarget.tower.hp ?? 0) - resolution.finalAmount;"
    );
  });
});
