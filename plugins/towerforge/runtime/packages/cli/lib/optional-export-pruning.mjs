function assertPruningInput(source, moduleSpecifier) {
  if (typeof source !== "string") {
    throw new TypeError("Generated module source must be a string.");
  }
  if (
    typeof moduleSpecifier !== "string"
    || !/^\.\/[A-Za-z0-9._/-]+$/.test(moduleSpecifier)
    || moduleSpecifier.split("/").includes("..")
  ) {
    throw new TypeError("Module specifier must be a safe relative module path.");
  }

  return moduleSpecifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pruneExactMatches(source, moduleSpecifier, pattern) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one generated module statement for "${moduleSpecifier}"; found ${matches.length}.`);
  }
  return source.replace(pattern, "");
}

export function pruneSingleModuleExport(source, moduleSpecifier) {
  const escapedSpecifier = assertPruningInput(source, moduleSpecifier);
  const exportPattern = new RegExp(`^export \\* from "${escapedSpecifier}";(?:\\r?\\n|$)`, "gm");
  return pruneExactMatches(source, moduleSpecifier, exportPattern);
}

export function pruneSingleModuleImport(source, moduleSpecifier) {
  const escapedSpecifier = assertPruningInput(source, moduleSpecifier);
  const importPattern = new RegExp(`^import [^\\r\\n]* from "${escapedSpecifier}";(?:\\r?\\n|$)`, "gm");
  return pruneExactMatches(source, moduleSpecifier, importPattern);
}
