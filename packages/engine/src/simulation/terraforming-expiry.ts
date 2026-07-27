import type { RuntimeTerrainOverride, TerraformingSnapshotV1 } from "./types.js";

export type TerraformExpiryLayer = "terrain" | "elevation";

export interface TerrainExpiryTargetV1 {
  readonly layer: "terrain";
  readonly q: number;
  readonly r: number;
  readonly order: number;
  readonly appliedTerrain: string;
  readonly previousOverride: Pick<RuntimeTerrainOverride, "terrain" | "source"> | null;
}

export interface ElevationExpiryTargetV1 {
  readonly layer: "elevation";
  readonly q: number;
  readonly r: number;
  readonly order: number;
  readonly appliedElevation: number;
  readonly previousElevationOverride: number | null;
}

export type TerraformExpiryTargetV1 = TerrainExpiryTargetV1 | ElevationExpiryTargetV1;

export interface TerraformExpiryGroupV1 {
  readonly sequence: number;
  readonly remaining: number;
  readonly targets: readonly TerraformExpiryTargetV1[];
}

export function terraformExpiryTargetKey(target: Pick<TerraformExpiryTargetV1, "layer" | "q" | "r">): string {
  return `${target.layer}:${target.q},${target.r}`;
}

/** Pure countdown: callers decide whether due groups can be committed atomically. */
export function advanceTerraformExpiryGroups(
  groups: readonly TerraformExpiryGroupV1[],
  delta: number
): readonly TerraformExpiryGroupV1[] {
  return groups.map((group) => {
    const difference = group.remaining - delta;
    const roundingBound = Number.EPSILON * 8 * Math.max(
      Math.abs(group.remaining),
      Math.abs(delta)
    );
    const remaining = difference <= 0 || (delta > 0 && difference <= roundingBound)
      ? 0
      : difference;
    return {
      sequence: group.sequence,
      remaining,
      targets: group.targets
    };
  });
}

export function countTerraformExpiryOwnership(
  groups: readonly TerraformExpiryGroupV1[]
): { readonly terrain: number; readonly elevation: number; readonly combined: number } {
  let terrain = 0;
  let elevation = 0;
  for (const group of groups) {
    for (const target of group.targets) {
      if (target.layer === "terrain") terrain += 1;
      else elevation += 1;
    }
  }
  return { terrain, elevation, combined: terrain + elevation };
}

export function buildTerraformingSnapshot(
  groups: readonly TerraformExpiryGroupV1[]
): TerraformingSnapshotV1 {
  return {
    schemaVersion: 1,
    pendingExpiryGroups: groups.map((group) => ({
      sequence: group.sequence,
      remaining: group.remaining,
      targets: group.targets.map(({ layer, q, r }) => ({ layer, q, r }))
    }))
  };
}
