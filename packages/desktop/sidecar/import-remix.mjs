#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { importRemixSourcePackV2 } from "../../cli/lib/distribution/index.mjs";

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function requireProjectName(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) {
    throw new Error("Remixed project name must contain only letters, digits, hyphens, or underscores.");
  }
  return value;
}

function requireProjectId(value) {
  if (typeof value !== "string" || !/^tfp_[a-f0-9]{32}$/.test(value)) {
    throw new Error("Remixed project ID is invalid.");
  }
  return value;
}

try {
  const packPath = valueAfter("--pack");
  const parentDir = valueAfter("--parent");
  if (typeof packPath !== "string" || path.extname(packPath).toLowerCase() !== ".tdpack" || !fs.statSync(packPath).isFile()) {
    throw new Error("Select a local TowerForge .tdpack remix source file.");
  }
  if (typeof parentDir !== "string" || !fs.statSync(parentDir).isDirectory()) {
    throw new Error("Choose an existing project location.");
  }
  const result = await importRemixSourcePackV2(packPath, parentDir, {
    name: requireProjectName(valueAfter("--name")),
    projectId: requireProjectId(valueAfter("--project-id"))
  });
  process.stdout.write(JSON.stringify({ ok: true, projectDir: result.projectDir }) + "\n");
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
  process.exit(1);
}
