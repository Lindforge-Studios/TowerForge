import { describe, expect, it } from "vitest";
import { pruneSingleModuleExport, pruneSingleModuleImport } from "./optional-export-pruning.mjs";

const replayExport = 'export * from "./ghost-replay-presentation.mjs";';

describe("optional generated-player export pruning", () => {
  it.each([
    ["LF", `${replayExport}\nexport const keep = true;\n`, "export const keep = true;\n"],
    ["CRLF", `${replayExport}\r\nexport const keep = true;\r\n`, "export const keep = true;\r\n"],
    ["EOF", replayExport, ""]
  ])("prunes exactly one %s export without changing the remaining bytes", (_name, source, expected) => {
    expect(pruneSingleModuleExport(source, "./ghost-replay-presentation.mjs")).toBe(expected);
  });

  it("rejects a missing export instead of silently shipping optional runtime", () => {
    expect(() => pruneSingleModuleExport("export const keep = true;\n", "./ghost-replay-presentation.mjs"))
      .toThrow(/exactly one.*found 0/i);
  });

  it.each(["\n", "\r\n"])("rejects duplicate exports with %s line endings", (eol) => {
    const source = `${replayExport}${eol}${replayExport}${eol}`;
    expect(() => pruneSingleModuleExport(source, "./ghost-replay-presentation.mjs"))
      .toThrow(/exactly one.*found 2/i);
  });

  it.each(["\n", "\r\n"])("prunes Macro-Economy exports with %s line endings", (eol) => {
    const source = `export * from "./content/macro-economy-mechanics.js";${eol}export const keep = true;${eol}`;
    expect(pruneSingleModuleExport(source, "./content/macro-economy-mechanics.js"))
      .toBe(`export const keep = true;${eol}`);
  });

  it.each(["\n", "\r\n"])("prunes the Macro-Economy validation import with %s line endings", (eol) => {
    const target = 'import { normalizeMacroEconomyProfileV1 } from "./macro-economy-mechanics.js";';
    const source = `import { keep } from "./keep.js";${eol}${target}${eol}export { keep };${eol}`;
    expect(pruneSingleModuleImport(source, "./macro-economy-mechanics.js"))
      .toBe(`import { keep } from "./keep.js";${eol}export { keep };${eol}`);
  });

  it("prunes a Macro-Economy validation import at EOF without a final newline", () => {
    const target = 'import { normalizeMacroEconomyProfileV1 } from "./macro-economy-mechanics.js";';
    expect(pruneSingleModuleImport(target, "./macro-economy-mechanics.js")).toBe("");
  });

  it.each(["\n", "\r\n"])("rejects duplicate Macro-Economy imports with %s line endings", (eol) => {
    const target = 'import { normalizeMacroEconomyProfileV1 } from "./macro-economy-mechanics.js";';
    expect(() => pruneSingleModuleImport(`${target}${eol}${target}${eol}`, "./macro-economy-mechanics.js"))
      .toThrow(/exactly one.*found 2/i);
  });

  it("preserves mixed line endings outside the removed statement", () => {
    const source = `export const before = true;\n${replayExport}\r\nexport const after = true;\n`;
    expect(pruneSingleModuleExport(source, "./ghost-replay-presentation.mjs"))
      .toBe("export const before = true;\nexport const after = true;\n");
  });

  it("does not match comments, string literals, or longer specifiers", () => {
    const source = [
      `// ${replayExport}`,
      `const text = '${replayExport}';`,
      'export * from "./ghost-replay-presentation.mjs.map";'
    ].join("\n") + "\n";
    expect(() => pruneSingleModuleExport(source, "./ghost-replay-presentation.mjs"))
      .toThrow(/found 0/i);
  });

  it.each([
    [null, "./ghost-replay-presentation.mjs"],
    [replayExport, ""],
    [replayExport, "../ghost-replay-presentation.mjs"],
    [replayExport, "./ghost-replay-presentation.mjs\nexport const injected = true"]
  ])("rejects malformed source/specifier input", (source, specifier) => {
    expect(() => pruneSingleModuleExport(source, specifier)).toThrow(TypeError);
  });
});
