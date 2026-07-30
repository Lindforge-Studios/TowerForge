import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const app = fs.readFileSync(path.resolve("packages/studio/public/app.js"), "utf8");

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}`);
  expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0);
  if (start < 0) return "";
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed function ${name}`);
}

describe("R12.2 component event Studio picker contract (RED)", () => {
  it("builds handler and transition event options only from descriptor catalog entries", () => {
    const names = functionSource(app, "towerScriptGraphCatalogNames");
    const options = functionSource(app, "towerScriptGraphFieldOptions");
    const render = functionSource(app, "renderTowerScriptGraph");

    expect(options).toMatch(/field\s*===\s*["']event["'][\s\S]*towerScriptGraphCatalogNames\(\s*["']events["']/);
    expect(render).toMatch(/nodeCatalog\?*\.events[\s\S]*\.map\s*\(/);
    expect(`${names}\n${options}\n${render}`).not.toMatch(/bossComponentDamaged|bossComponentDestroyed/);
  });

  it("filters descriptor events by the canonical AST schemaVersion so legacy scripts never offer v7 events", () => {
    const names = functionSource(app, "towerScriptGraphCatalogNames");
    const options = functionSource(app, "towerScriptGraphFieldOptions");
    const render = functionSource(app, "renderTowerScriptGraph");
    const source = `${names}\n${options}\n${render}`;

    expect(source).toMatch(/minimumSchemaVersion/);
    expect(source).toMatch(/schemaVersion/);
    expect(source).toMatch(/TowerScriptGraphUI\.(?:graph|schemaDescriptor)/);
    expect(source).toMatch(/filter\s*\(/);
    expect(source).not.toMatch(/schemaVersion\s*[<>=!]+\s*7[\s\S]{0,120}bossComponent/);
  });
});
