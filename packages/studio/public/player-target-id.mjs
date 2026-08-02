const MAX_DESKTOP_TARGET_IDENTITIES = 256;

export function allocatePlayerTargetId(targets, baseId = "desktop-large") {
  if (!targets || typeof targets !== "object" || Array.isArray(targets)) {
    throw new TypeError("Player targets must be an object.");
  }
  const occupied = new Set(Object.keys(targets));
  if (!occupied.has(baseId)) return baseId;
  for (let suffix = 2; suffix <= MAX_DESKTOP_TARGET_IDENTITIES; suffix += 1) {
    const candidate = `${baseId}-${suffix}`;
    if (!occupied.has(candidate)) return candidate;
  }
  throw new Error("No free desktop target id remains in the bounded allocation range.");
}
