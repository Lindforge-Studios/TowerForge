const QUALITY_PRESETS = Object.freeze({
  low: Object.freeze({ maxDevicePixelRatio: 1, pixelBudget: 1_500_000, targetFps: 24 }),
  balanced: Object.freeze({ maxDevicePixelRatio: 1.5, pixelBudget: 2_500_000, targetFps: 30 }),
  high: Object.freeze({ maxDevicePixelRatio: 2, pixelBudget: 5_000_000, targetFps: 60 }),
  auto: Object.freeze({ maxDevicePixelRatio: 1.5, pixelBudget: 3_000_000, targetFps: 45 })
});

export function resolvePlayerPresentationQualityV1(quality, viewport) {
  const width = Number(viewport?.width);
  const height = Number(viewport?.height);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new TypeError("viewport width and height must be finite positive numbers.");
  }
  const resolvedQuality = Object.prototype.hasOwnProperty.call(QUALITY_PRESETS, quality) ? quality : "auto";
  const preset = QUALITY_PRESETS[resolvedQuality];
  const viewportPixels = Math.max(1, width * height);
  const resolution = Math.max(0.5, Math.min(1, Math.sqrt(preset.pixelBudget / viewportPixels)));
  return Object.freeze({
    schemaVersion: 1,
    quality: resolvedQuality,
    maxDevicePixelRatio: preset.maxDevicePixelRatio,
    pixelBudget: preset.pixelBudget,
    resolution,
    targetFps: preset.targetFps
  });
}
