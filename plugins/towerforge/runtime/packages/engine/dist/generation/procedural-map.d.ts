export interface MapGenerationSpecV1 {
    readonly schemaVersion: 1;
    readonly mapId: string;
    readonly seed: string;
    readonly grid: {
        readonly kind: "square";
        readonly adjacency: "cardinal";
    } | {
        readonly kind: "hex";
        readonly layout: "odd-r";
    };
    readonly width: number;
    readonly height: number;
    readonly entrances: number;
    readonly loops: number;
    readonly terrain: {
        readonly buildable: string;
        readonly path: string;
        readonly blocked: string;
    };
    readonly buildableRatio: {
        readonly min: number;
        readonly max: number;
    };
}
export declare function generateProceduralMap(spec: MapGenerationSpecV1): Readonly<{
    schemaVersion: 1;
    spec: Readonly<{
        schemaVersion: 1;
        mapId: string;
        seed: string;
        grid: Readonly<{
            kind: "square";
            adjacency: "cardinal";
        } | {
            kind: "hex";
            layout: "odd-r";
        }>;
        width: number;
        height: number;
        entrances: number;
        loops: number;
        terrain: Readonly<{
            buildable: string;
            path: string;
            blocked: string;
        }>;
        buildableRatio: Readonly<{
            min: number;
            max: number;
        }>;
    }>;
    source: Readonly<{
        id: string;
        width: number;
        height: number;
        gridKind: "hex" | "square";
        spawnCoord: Readonly<{
            q: number;
            r: number;
        }>;
        coreCoord: Readonly<{
            q: number;
            r: number;
        }>;
        pathCenterline: readonly Readonly<{
            q: number;
            r: number;
        }>[];
        pathRoutes: readonly Readonly<{
            id: `generated_route_${number}`;
            pathCenterline: readonly Readonly<{
                q: number;
                r: number;
            }>[];
        }>[];
        terrainOverrides: readonly Readonly<{
            q: number;
            r: number;
            terrain: string;
        }>[];
    }>;
    evidence: Readonly<{
        reachable: boolean;
        entranceCount: number;
        loopCount: number;
        buildableRatio: number;
        tilesetTerrainIds: readonly string[];
        structuralSmoke: Readonly<{
            contract: "generated_map_structure_v1";
            ok: boolean;
        }>;
    }>;
}>;
