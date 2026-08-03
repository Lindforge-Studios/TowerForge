import fs from "node:fs";
import path from "node:path";

function isOutside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative.startsWith("..") || path.isAbsolute(relative);
}

function lstatIfPresent(candidate) {
  try {
    return fs.lstatSync(candidate);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
}

function nearestExistingAncestor(candidate) {
  let cursor = candidate;
  for (;;) {
    // existsSync follows the final symlink and reports false for dangling links. lstat must stop at
    // the link itself so a later write cannot create its external target.
    if (lstatIfPresent(cursor)) return cursor;
    const parent = path.dirname(cursor);
    if (parent === cursor) return cursor;
    cursor = parent;
  }
}

/**
 * Reject lexical escapes and existing symlink ancestors before an output directory can be removed
 * or written. The destination itself must be a child of the project; the project root is not a
 * valid output directory.
 */
export function assertConfinedProjectOutput(projectDir, outputDir, operation = "write") {
  const lexicalRoot = path.resolve(projectDir);
  const lexicalOutput = path.resolve(outputDir);
  const lexicalRelative = path.relative(lexicalRoot, lexicalOutput);
  if (!lexicalRelative || lexicalRelative === "." || lexicalRelative.startsWith("..") || path.isAbsolute(lexicalRelative)) {
    throw new Error(`Refusing to ${operation} outside the project directory: ${lexicalOutput}`);
  }

  const realRoot = fs.realpathSync(lexicalRoot);
  const existingAncestor = nearestExistingAncestor(lexicalOutput);
  const ancestorStat = lstatIfPresent(existingAncestor);
  let realAncestor;
  try {
    realAncestor = fs.realpathSync(existingAncestor);
  } catch (error) {
    if (ancestorStat?.isSymbolicLink()) {
      throw new Error(`Refusing to ${operation} through a dangling symlink: ${lexicalOutput}`);
    }
    throw error;
  }
  if (isOutside(realRoot, realAncestor)) {
    throw new Error(`Refusing to ${operation} through a symlink outside the project directory: ${lexicalOutput}`);
  }

  const outputStat = lstatIfPresent(lexicalOutput);
  if (outputStat) {
    const stat = outputStat;
    if (stat.isSymbolicLink() || isOutside(realRoot, fs.realpathSync(lexicalOutput))) {
      throw new Error(`Refusing to ${operation} through a symlink outside the project directory: ${lexicalOutput}`);
    }
  }
  return lexicalOutput;
}
