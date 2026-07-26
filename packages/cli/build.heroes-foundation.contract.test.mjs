import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const buildSource = fs.readFileSync(path.resolve("packages/cli/build.mjs"), "utf8");

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}`);
  expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed function ${name}`);
}

describe("R5.1A generated Canvas/Phaser static hero foundation", () => {
  it("keeps Canvas snapshot-driven and adds the equivalent fail-closed Phaser projection", () => {
    const canvas = functionSource(buildSource, "playerTemplate");
    const phaser = functionSource(buildSource, "phaserPlayerTemplate");

    expect(canvas).toMatch(/createCanvasRenderer/);
    expect(canvas).toMatch(/renderer\.drawSnapshot\(snap\)/);
    expect(canvas).not.toMatch(/delete\s+(?:snap|snapshot)\.heroes/);

    expect(phaser).toMatch(/projectHeroesPresentation/);
    expect(phaser).toMatch(/projectHeroesPresentation\s*\(\s*(?:snap|presentationSnapshot)\s*\)/);
    expect(phaser).toMatch(/\.units[\s\S]{0,500}(?:definitionId|bindings\?\.heroes|spriteTexture)/);
    expect(phaser).toMatch(/(?:definitionId|id)[\s\S]{0,300}(?:fillCircle|add\.image|sprite)/);
  });

  it("uses visuals.bindings.heroes when present and retains a visible fallback", () => {
    const renderer = fs.readFileSync(path.resolve("packages/renderer/src/index.mjs"), "utf8");
    const phaser = functionSource(buildSource, "phaserPlayerTemplate");

    expect(renderer).toMatch(/spriteFor\s*\(\s*["']heroes["']/);
    expect(renderer).toMatch(/projectHeroesPresentation/);
    expect(renderer).toMatch(/drawHero|heroes\.units|heroPresentation/);
    expect(phaser).toMatch(/bindings\?*\.?heroes|bindings[\s\S]{0,100}heroes/);
    expect(`${renderer}\n${phaser}`).toMatch(/hero[\s\S]{0,500}(?:fill|arc|circle)/i);
  });

  it("uses own-data lookup for Phaser hero bindings and sprite definitions", () => {
    const phaser = functionSource(buildSource, "phaserPlayerTemplate");
    const ownGuard = String.raw`(?:Object\.hasOwn|Object\.prototype\.hasOwnProperty\.call|own(?:Enumerable)?Data(?:Value)?)`;
    expect(phaser).toMatch(new RegExp(
      `${ownGuard}\\s*\\([\\s\\S]{0,220}bindings[\\s\\S]{0,80}heroes[\\s\\S]{0,80}hero\\.definitionId`
    ));

    const spriteTextureStart = phaser.indexOf("spriteTexture(spriteId)");
    expect(spriteTextureStart, "Phaser spriteTexture method must exist").toBeGreaterThanOrEqual(0);
    const spriteTexture = phaser.slice(spriteTextureStart, spriteTextureStart + 700);
    expect(spriteTexture).toMatch(/sprites/);
    expect(spriteTexture).toMatch(new RegExp(`${ownGuard}\\s*\\(`));
    const lookupIndex = spriteTexture.search(new RegExp(
      `${ownGuard}\\s*\\(\\s*sprites\\s*,\\s*spriteId\\s*\\)`
    ));
    expect(lookupIndex, "spriteTexture must perform an own-data sprite lookup").toBeGreaterThanOrEqual(0);
    const nonStringGuard = spriteTexture.search(/typeof\s+spriteId\s*!==\s*["']string["']/);
    const emptyGuard = spriteTexture.search(/!\s*spriteId\b|spriteId\s*===\s*["']["']|spriteId\.length\s*===\s*0/);
    expect(nonStringGuard, "spriteTexture must reject non-string IDs").toBeGreaterThanOrEqual(0);
    expect(emptyGuard, "spriteTexture must reject an absent or empty ID").toBeGreaterThanOrEqual(0);
    expect(nonStringGuard).toBeLessThan(lookupIndex);
    expect(emptyGuard).toBeLessThan(lookupIndex);
  });

  it("keeps later skills and TowerScript actions out while v4 adds its isolated active ability", () => {
    const canvas = functionSource(buildSource, "playerTemplate");
    const phaser = functionSource(buildSource, "phaserPlayerTemplate");
    expect(canvas).toMatch(/useHeroAbility/);
    expect(phaser).toMatch(/useHeroAbility/);
    expect(canvas).not.toMatch(/unlockHeroSkill|heroTowerScript/i);
    expect(phaser).not.toMatch(/unlockHeroSkill|heroTowerScript/i);
  });
});
