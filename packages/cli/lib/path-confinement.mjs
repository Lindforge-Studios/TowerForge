import fs from "node:fs";
import path from "node:path";

function isOutside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative.startsWith("..") || path.isAbsolute(relative);
}

function nearestExistingAncestor(candidate) {
  let cursor = candidate;
  for (;;) {
    if (fs.existsSync(cursor)) return cursor;
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
  const realAncestor = fs.realpathSync(existingAncestor);
  if (isOutside(realRoot, realAncestor)) {
    throw new Error(`Refusing to ${operation} through a symlink outside the project directory: ${lexicalOutput}`);
  }

  if (fs.existsSync(lexicalOutput)) {
    const stat = fs.lstatSync(lexicalOutput);
    if (stat.isSymbolicLink() || isOutside(realRoot, fs.realpathSync(lexicalOutput))) {
      throw new Error(`Refusing to ${operation} through a symlink outside the project directory: ${lexicalOutput}`);
    }
  }
  return lexicalOutput;
}
