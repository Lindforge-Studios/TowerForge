import { SeededRng } from "../simulation/rng.js";
import { createGridTopology } from "../simulation/topology.js";

export interface MapGenerationSpecV1 {
  readonly schemaVersion: 1;
  readonly mapId: string;
  readonly seed: string;
  readonly grid: { readonly kind: "square"; readonly adjacency: "cardinal" }
    | { readonly kind: "hex"; readonly layout: "odd-r" };
  readonly width: number;
  readonly height: number;
  readonly entrances: number;
  readonly loops: number;
  readonly terrain: { readonly buildable: string; readonly path: string; readonly blocked: string };
  readonly buildableRatio: { readonly min: number; readonly max: number };
}

type Coord = Readonly<{ q: number; r: number }>;

function freezeCoord(q: number, r: number): Coord { return Object.freeze({ q, r }); }

function inspectDataObject(value: unknown, expectedFields: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a plain data object.`);
  let prototype: object | null;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>;
  } catch {
    throw new Error(`${label} could not be inspected safely.`);
  }
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} must have a plain prototype.`);
  if (Object.getOwnPropertySymbols(descriptors).length > 0) throw new Error(`${label} must not contain symbol fields.`);
  const keys = Object.keys(descriptors);
  if (keys.length !== expectedFields.length || expectedFields.some((field) => !Object.prototype.hasOwnProperty.call(descriptors, field))) {
    throw new Error(`${label} must contain exactly: ${expectedFields.join(", ")}.`);
  }
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new Error(`${label}.${key} must be an enumerable data field.`);
    Object.defineProperty(result, key, { value: descriptor.value, enumerable: true, configurable: true, writable: true });
  }
  return result;
}

function validateSpec(input: unknown): MapGenerationSpecV1 {
  const root = inspectDataObject(
    input,
    ["schemaVersion", "mapId", "seed", "grid", "width", "height", "entrances", "loops", "terrain", "buildableRatio"],
    "MapGenerationSpec"
  );
  const rawGrid = inspectDataObject(
    root.grid,
    root.grid && typeof root.grid === "object" && Object.getOwnPropertyDescriptor(root.grid, "kind")?.value === "square"
      ? ["kind", "adjacency"]
      : ["kind", "layout"],
    "MapGenerationSpec.grid"
  );
  const rawTerrain = inspectDataObject(root.terrain, ["buildable", "path", "blocked"], "MapGenerationSpec.terrain");
  const rawRatio = inspectDataObject(root.buildableRatio, ["min", "max"], "MapGenerationSpec.buildableRatio");
  const value = {
    schemaVersion: root.schemaVersion,
    mapId: root.mapId,
    seed: root.seed,
    grid: rawGrid,
    width: root.width,
    height: root.height,
    entrances: root.entrances,
    loops: root.loops,
    terrain: rawTerrain,
    buildableRatio: rawRatio
  } as unknown as MapGenerationSpecV1;
  if (value.schemaVersion !== 1) throw new Error("Unsupported MapGenerationSpec schema version.");
  if (typeof value.mapId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value.mapId)) throw new Error("MapGenerationSpec mapId is invalid.");
  if (typeof value.seed !== "string" || value.seed.length === 0 || value.seed.length > 1024) throw new Error("MapGenerationSpec seed is invalid.");
  if (!Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height) || value.width < 6 || value.height < 5 || value.width > 256 || value.height > 256) throw new Error("MapGenerationSpec dimensions must be within 6x5..256x256.");
  if (!Number.isSafeInteger(value.entrances) || value.entrances < 1 || value.entrances > Math.min(8, value.height - 2)) throw new Error("MapGenerationSpec entrances are impossible for these dimensions.");
  if (!Number.isSafeInteger(value.loops) || value.loops < 0 || value.loops > 8) throw new Error("MapGenerationSpec loops must be in 0..8.");
  if (!value.grid || (value.grid.kind !== "square" && value.grid.kind !== "hex")) throw new Error("MapGenerationSpec grid is unsupported.");
  if (value.grid.kind === "square" && value.grid.adjacency !== "cardinal") throw new Error("Square generated maps require cardinal adjacency.");
  if (value.grid.kind === "hex" && value.grid.layout !== "odd-r") throw new Error("Hex generated maps require odd-r layout.");
  const ids = [value.terrain?.buildable, value.terrain?.path, value.terrain?.blocked];
  if (ids.some((id) => typeof id !== "string" || !id || id.length > 128) || new Set(ids).size !== 3) throw new Error("MapGenerationSpec terrain IDs must be three distinct strings.");
  const { min, max } = value.buildableRatio ?? {} as { min: number; max: number };
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max > 1 || min > max) throw new Error("MapGenerationSpec buildable ratio is invalid.");
  return Object.freeze({
    schemaVersion: 1,
    mapId: value.mapId,
    seed: value.seed,
    grid: Object.freeze({ ...value.grid }),
    width: value.width,
    height: value.height,
    entrances: value.entrances,
    loops: value.loops,
    terrain: Object.freeze({ ...value.terrain }),
    buildableRatio: Object.freeze({ ...value.buildableRatio })
  });
}

function shuffled<T>(input: readonly T[], rng: SeededRng): T[] {
  const result = [...input];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = rng.nextInt(index + 1);
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}

function coordKey(coord: Coord): string { return `${coord.q},${coord.r}`; }

function parseCoord(key: string): Coord {
  const separator = key.indexOf(",");
  return freezeCoord(Number(key.slice(0, separator)), Number(key.slice(separator + 1)));
}

function inside(coord: Coord, width: number, height: number): boolean {
  return coord.q >= 0 && coord.r >= 0 && coord.q < width && coord.r < height;
}

function pathCycleRank(pathKeys: ReadonlySet<string>, topology: ReturnType<typeof createGridTopology>): number {
  let edges = 0;
  for (const key of pathKeys) {
    for (const neighbor of topology.neighbors(parseCoord(key))) {
      const other = coordKey(neighbor);
      if (pathKeys.has(other) && key < other) edges += 1;
    }
  }
  let components = 0;
  const remaining = new Set(pathKeys);
  while (remaining.size > 0) {
    components += 1;
    const first = remaining.values().next().value as string;
    remaining.delete(first);
    const queue = [first];
    while (queue.length > 0) {
      const key = queue.shift()!;
      for (const neighbor of topology.neighbors(parseCoord(key))) {
        const other = coordKey(neighbor);
        if (remaining.delete(other)) queue.push(other);
      }
    }
  }
  return edges - pathKeys.size + components;
}

function findShortDetour(
  start: Coord,
  goal: Coord,
  pathKeys: ReadonlySet<string>,
  topology: ReturnType<typeof createGridTopology>,
  width: number,
  height: number
): readonly Coord[] | undefined {
  const startKey = coordKey(start);
  const goalKey = coordKey(goal);
  const visited = new Set([startKey]);
  const queue: { coord: Coord; path: readonly Coord[] }[] = [{ coord: start, path: [start] }];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.path.length > 6) continue;
    const neighbors = topology.neighbors(current.coord)
      .filter((coord) => inside(coord, width, height))
      .sort((left, right) => coordKey(left) < coordKey(right) ? -1 : coordKey(left) > coordKey(right) ? 1 : 0);
    for (const neighbor of neighbors) {
      const key = coordKey(neighbor);
      if (key === goalKey) {
        if (current.path.length >= 2) return Object.freeze([...current.path, goal]);
        continue;
      }
      if (pathKeys.has(key) || visited.has(key)) continue;
      visited.add(key);
      queue.push({ coord: freezeCoord(neighbor.q, neighbor.r), path: [...current.path, freezeCoord(neighbor.q, neighbor.r)] });
    }
  }
  return undefined;
}

function materializeLoopCorridors(
  pathKeys: Set<string>,
  requestedLoops: number,
  topology: ReturnType<typeof createGridTopology>,
  width: number,
  height: number,
  rng: SeededRng
): number {
  let addedLoops = 0;
  while (addedLoops < requestedLoops) {
    const edges: [Coord, Coord][] = [];
    for (const key of pathKeys) {
      const start = parseCoord(key);
      for (const neighbor of topology.neighbors(start)) {
        const other = coordKey(neighbor);
        if (pathKeys.has(other) && key < other) edges.push([start, freezeCoord(neighbor.q, neighbor.r)]);
      }
    }
    let accepted = false;
    for (const [start, goal] of shuffled(edges, rng)) {
      const detour = findShortDetour(start, goal, pathKeys, topology, width, height);
      if (!detour) continue;
      const candidate = new Set(pathKeys);
      for (const coord of detour.slice(1, -1)) candidate.add(coordKey(coord));
      if (candidate.size === pathKeys.size || pathCycleRank(candidate, topology) - pathCycleRank(pathKeys, topology) !== 1) continue;
      for (const coord of detour.slice(1, -1)) pathKeys.add(coordKey(coord));
      addedLoops += 1;
      accepted = true;
      break;
    }
    if (!accepted) throw new Error("MapGenerationSpec loops cannot be materialized within the map bounds.");
  }
  return addedLoops;
}

export function generateProceduralMap(spec: MapGenerationSpecV1) {
  spec = validateSpec(spec);
  const detachedSpec = Object.freeze({
    schemaVersion: 1 as const,
    mapId: spec.mapId,
    seed: spec.seed,
    grid: Object.freeze({ ...spec.grid }),
    width: spec.width,
    height: spec.height,
    entrances: spec.entrances,
    loops: spec.loops,
    terrain: Object.freeze({ ...spec.terrain }),
    buildableRatio: Object.freeze({ ...spec.buildableRatio })
  });
  const rng = new SeededRng(`${spec.seed}\0${spec.mapId}\0map-generation-v1`);
  const topology = createGridTopology(spec.grid);
  const core = freezeCoord(spec.width - 1, Math.floor(spec.height / 2));
  const routeRows = Array.from({ length: spec.entrances }, (_, index) => (
    Math.max(1, Math.min(spec.height - 2, Math.round(((index + 1) * (spec.height - 1)) / (spec.entrances + 1))))
  ));
  const pathRoutes = Object.freeze(routeRows.map((row, routeIndex) => {
    const convergence = freezeCoord(Math.floor(spec.width * 0.6), core.r);
    const first = topology.line(freezeCoord(0, row), convergence);
    const second = topology.line(convergence, core).slice(1);
    const coords: Coord[] = [...first, ...second].map((coord) => freezeCoord(coord.q, coord.r));
    return Object.freeze({ id: `generated_route_${routeIndex + 1}`, pathCenterline: Object.freeze(coords) });
  }));
  const pathKeys = new Set(pathRoutes.flatMap((route) => route.pathCenterline.map(coordKey)));
  const loopCount = materializeLoopCorridors(pathKeys, spec.loops, topology, spec.width, spec.height, rng);
  const candidates: Coord[] = [];
  for (let r = 0; r < spec.height; r += 1) for (let q = 0; q < spec.width; q += 1) {
    if (!pathKeys.has(`${q},${r}`)) candidates.push(freezeCoord(q, r));
  }
  const desiredRatio = (spec.buildableRatio.min + spec.buildableRatio.max) / 2;
  const desiredBuildable = Math.max(0, Math.min(candidates.length, Math.round(desiredRatio * spec.width * spec.height)));
  const buildableKeys = new Set(shuffled(candidates, rng).slice(0, desiredBuildable).map((coord) => `${coord.q},${coord.r}`));
  const terrainOverrides = Object.freeze(Array.from({ length: spec.height }, (_, r) => (
    Array.from({ length: spec.width }, (_, q) => {
      const key = `${q},${r}`;
      return Object.freeze({ q, r, terrain: pathKeys.has(key) ? spec.terrain.path : buildableKeys.has(key) ? spec.terrain.buildable : spec.terrain.blocked });
    })
  )).flat());
  const buildableRatio = buildableKeys.size / (spec.width * spec.height);
  if (buildableRatio + Number.EPSILON < spec.buildableRatio.min || buildableRatio - Number.EPSILON > spec.buildableRatio.max) {
    throw new Error("MapGenerationSpec buildable-ratio target cannot be satisfied after reserving routes.");
  }
  const source = Object.freeze({
    id: spec.mapId,
    width: spec.width,
    height: spec.height,
    gridKind: spec.grid.kind,
    spawnCoord: pathRoutes[0]!.pathCenterline[0]!,
    coreCoord: core,
    pathCenterline: pathRoutes[0]!.pathCenterline,
    pathRoutes,
    terrainOverrides
  });
  return Object.freeze({
    schemaVersion: 1 as const,
    spec: detachedSpec,
    source,
    evidence: Object.freeze({
      reachable: pathRoutes.every((route) => route.pathCenterline.length > 1 && route.pathCenterline.at(-1)!.q === core.q),
      entranceCount: pathRoutes.length,
      loopCount,
      buildableRatio,
      tilesetTerrainIds: Object.freeze([...new Set(Object.values(spec.terrain))].sort()),
      // This is intentionally structural only. Project-aware authoring surfaces add canonical
      // compilation, terrain/tileset coverage, and a real deterministic headless runtime smoke;
      // the pure generator must not misrepresent route geometry as gameplay balance evidence.
      structuralSmoke: Object.freeze({
        contract: "generated_map_structure_v1" as const,
        ok: pathRoutes.length === spec.entrances && buildableKeys.size > 0
      })
    })
  });
}
