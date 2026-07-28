import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

let projectDir;
let escapedDir;

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-generated-assets-"));
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
  if (escapedDir) fs.rmSync(escapedDir, { recursive: true, force: true });
  escapedDir = undefined;
});

async function generatedAssetApi() {
  return import("./generated-assets.mjs");
}

describe("R7 provider-neutral generated asset staging", () => {
  it("returns only an opaque handle and validates bytes, license, and provenance before preview", async () => {
    const { stageGeneratedAsset, inspectStagedAsset } = await generatedAssetApi();
    expect(stageGeneratedAsset).toBeTypeOf("function");
    expect(inspectStagedAsset).toBeTypeOf("function");

    const staged = stageGeneratedAsset(projectDir, {
      bytes: ONE_PIXEL_PNG,
      declaredMimeType: "image/png",
      fileName: "frost-tower.png",
      license: { id: "CC0-1.0", attribution: null },
      provenance: {
        generator: "agent-runtime",
        provider: "test-provider",
        model: "test-image-model",
        generatedAt: "2026-07-28T00:00:00.000Z"
      }
    });

    expect(staged).toEqual({
      schemaVersion: 1,
      handle: expect.stringMatching(/^staged_[A-Za-z0-9_-]{16,}$/),
      mimeType: "image/png",
      size: ONE_PIXEL_PNG.length,
      readyForPreview: true
    });
    expect(staged).not.toHaveProperty("path");
    expect(staged).not.toHaveProperty("bytes");
    expect(staged).not.toHaveProperty("prompt");

    const inspected = inspectStagedAsset(projectDir, staged.handle);
    expect(inspected).toMatchObject({
      schemaVersion: 1,
      handle: staged.handle,
      mimeType: "image/png",
      signatureValid: true,
      size: ONE_PIXEL_PNG.length,
      license: { id: "CC0-1.0", attribution: null },
      provenance: {
        generator: "agent-runtime",
        provider: "test-provider",
        model: "test-image-model"
      }
    });
    expect(inspected).not.toHaveProperty("prompt");
  });

  it("fails closed on MIME/signature mismatch or missing provenance and never exposes a reusable path", async () => {
    const { stageGeneratedAsset } = await generatedAssetApi();
    expect(stageGeneratedAsset).toBeTypeOf("function");

    const validMetadata = {
      fileName: "tower.png",
      license: { id: "CC0-1.0", attribution: null },
      provenance: {
        generator: "agent-runtime",
        provider: "test-provider",
        model: "test-image-model",
        generatedAt: "2026-07-28T00:00:00.000Z"
      }
    };
    expect(() => stageGeneratedAsset(projectDir, {
      ...validMetadata,
      bytes: Buffer.from("not a png"),
      declaredMimeType: "image/png"
    })).toThrow(/signature|PNG|MIME/i);
    expect(() => stageGeneratedAsset(projectDir, {
      ...validMetadata,
      bytes: ONE_PIXEL_PNG,
      declaredMimeType: "image/jpeg"
    })).toThrow(/signature|PNG|JPEG|MIME/i);
    expect(() => stageGeneratedAsset(projectDir, {
      bytes: ONE_PIXEL_PNG,
      declaredMimeType: "image/png",
      fileName: "tower.png",
      license: { id: "CC0-1.0", attribution: null }
    })).toThrow(/provenance/i);

    const stageRoot = path.join(projectDir, ".towerforge", "generated-assets");
    const stagedFiles = fs.existsSync(stageRoot)
      ? fs.readdirSync(stageRoot, { recursive: true }).filter((entry) => !String(entry).endsWith(".json"))
      : [];
    expect(stagedFiles).toEqual([]);
  });

  it("rejects staging-root symlink escapes and tampered metadata before returning preview bytes", async () => {
    const { stageGeneratedAsset, inspectStagedAsset, readStagedAssetForCommit } = await generatedAssetApi();
    const escaped = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-generated-assets-escape-"));
    escapedDir = escaped;
    fs.mkdirSync(path.join(projectDir, ".towerforge"), { recursive: true });
    fs.symlinkSync(escaped, path.join(projectDir, ".towerforge", "generated-assets"), "dir");

    const valid = {
      bytes: ONE_PIXEL_PNG,
      declaredMimeType: "image/png",
      fileName: "tower.png",
      license: { id: "CC0-1.0", attribution: null },
      provenance: {
        generator: "agent-runtime",
        provider: "test-provider",
        model: "test-image-model",
        generatedAt: "2026-07-28T00:00:00.000Z"
      }
    };
    expect(() => stageGeneratedAsset(projectDir, valid)).toThrow(/symlink|staging/i);
    expect(fs.readdirSync(escaped)).toEqual([]);

    fs.unlinkSync(path.join(projectDir, ".towerforge", "generated-assets"));
    const staged = stageGeneratedAsset(projectDir, valid);
    const metadataPath = path.join(projectDir, ".towerforge", "generated-assets", staged.handle, "metadata.json");
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    fs.writeFileSync(metadataPath, JSON.stringify({ ...metadata, handle: "staged_tampered_handle_1234" }));

    expect(() => inspectStagedAsset(projectDir, staged.handle)).toThrow(/metadata|handle|tamper/i);
    expect(() => readStagedAssetForCommit(projectDir, staged.handle)).toThrow(/metadata|handle|tamper/i);
  });
});
