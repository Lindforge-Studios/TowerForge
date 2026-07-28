import { expandAutotileInvalidations, resolveAutotile } from "./autotile.mjs";
import { projectTerraformingPresentation } from "./terraforming-presentation.mjs";
import {
  projectLegacyPresentationEvents,
  projectExposurePresentationCues,
  projectMarkPresentationCues,
  projectReactionPresentationCues,
  projectSnapshotSpawnCoord,
  projectShieldPresentationCues,
  resolveExposurePresentation,
  resolveMarkPresentation,
  resolveShieldPresentation
} from "./combat-presentation.mjs";
import {
  projectEnemyNavigationPoint,
  projectNavigationPlacementCues
} from "./navigation-presentation.mjs";
export { projectLineOfSightAnalysis } from "./line-of-sight-presentation.mjs";
import { projectElevationCues } from "./elevation-presentation.mjs";
import { projectPhysicsPresentationCues } from "./physics-presentation.mjs";
import { projectHeroPresentationPoint, projectHeroesPresentation } from "./heroes-presentation.mjs";
export * from "./autotile.mjs";
export * from "./combat-presentation.mjs";
export * from "./navigation-presentation.mjs";
export * from "./elevation-presentation.mjs";
export * from "./physics-presentation.mjs";
export * from "./terraforming-presentation.mjs";
export * from "./roguelite-presentation.mjs";
export * from "./campaign-presentation.mjs";
export * from "./heroes-presentation.mjs";
export * from "./director-presentation.mjs";
export { projectLogisticsPresentation } from "./logistics-power-presentation.mjs";

function ownDataValue(record, key) {
  if (record === null || typeof record !== "object") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor?.enumerable === true && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

// Max canvas backbuffer area (pixels). Above this, high-DPR mobile GPUs stall or OOM. ~1.35M px
// ≈ 1600x844 — plenty for a hex playfield while keeping cheap Android devices stable.
export const MAX_BACKBUFFER_PX = 1_350_000;

export function createCanvasRenderer(options) {
  return new TowerForgeCanvasRenderer(options);
}

export class TowerForgeCanvasRenderer {
  constructor(options) {
    if (!options?.canvas) throw new Error("createCanvasRenderer requires a canvas.");
    this.canvas = options.canvas;
    this.ctx = options.canvas.getContext("2d");
    this.content = options.content ?? {};
    this.assetBase = options.assetBase ?? "";
    this.effects = [];
    this.shake = 0;
    this.images = new Map();
    this.prevEnemyPos = new Map();
    this.prevTowerPos = new Map();
    this.prevCombat = null;
    this.lastDrawTime = null;
    this.focusCoord = null;
    this.navigationOverlay = projectNavigationPlacementCues(undefined);
    this.lastGrid = { kind: "hex", layout: "odd-r" };
    this.tileLayer = null;
    this.tileLayerKey = null;
    this.tileTerrainState = new Map();
    this.tileLayerDirtyAll = true;
    this.theme = {
      bg: "#101410",
      buildable: "#1d2a1d",
      path: "#6b5540",
      water: "#427b88",
      blocked: "#252820",
      spawn: "#735e2c",
      core: "#3f6f43",
      tower: "#8ac783",
      towerStroke: "#e8f4db",
      hero: "#e6b85c",
      heroStroke: "#fff0bd",
      danger: "#df6a59",
      ...options.theme
    };
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(320, Math.floor(rect.width) || 320);
    const cssH = Math.max(240, Math.floor(rect.height) || 240);
    // Cap the backbuffer area. A high-DPR phone (e.g. 1080x2340 @ dpr 2.75) would otherwise
    // allocate a ~2.6M-pixel canvas — GPU memory pressure, jank, and black screens on low-end
    // Android. Scale the device-pixel-ratio down so the backbuffer never exceeds MAX_BACKBUFFER_PX,
    // but never below the CSS resolution (scale >= 1), so desktop stays crisp. (Practice ported
    // from a shipped Capacitor game where an uncapped backbuffer was the #1 low-end-device crash.)
    const dpr = globalThis.devicePixelRatio || 1;
    const cap = Math.max(MAX_BACKBUFFER_PX, cssW * cssH); // never blurrier than 1 device pixel per CSS pixel
    let scale = dpr;
    if (cssW * cssH * scale * scale > cap) scale = Math.sqrt(cap / (cssW * cssH));
    scale = Math.max(1, scale);
    this.canvas.width = Math.floor(cssW * scale);
    this.canvas.height = Math.floor(cssH * scale);
  }

  drawSnapshot(snapshot) {
    if (!snapshot) return;
    const now = (globalThis.performance && globalThis.performance.now) ? globalThis.performance.now() : Date.now();
    const dt = this.lastDrawTime == null ? 0 : Math.min(0.05, (now - this.lastDrawTime) / 1000);
    this.lastDrawTime = now;

    this.lastGrid = snapshot.grid ?? this.lastGrid;
    const geom = this.geometry(snapshot.tiles ?? [], this.lastGrid);
    const mapModel = { id: snapshot.mapId ?? snapshot.missionId ?? "map", grid: this.lastGrid, tiles: snapshot.tiles ?? [], pathRoutes: snapshot.pathRoutes ?? [] };
    const positions = new Map();
    for (const enemy of snapshot.enemies ?? []) {
      const point = this.enemyPoint(enemy, snapshot, geom);
      if (point) positions.set(enemy.id, point);
    }
    const towerPositions = new Map();
    for (const tower of snapshot.towers ?? []) towerPositions.set(tower.id, this.center(tower.coord, geom));
    const presentationSnapshot = snapshot.combat === undefined && this.prevCombat !== null
      ? { ...snapshot, combat: this.prevCombat }
      : snapshot;

    this.spawnEffects(presentationSnapshot, geom, positions, towerPositions);
    this.advanceEffects(dt);

    this.clear();
    const offset = this.shakeOffset(now, geom);
    this.ctx.save();
    this.ctx.translate(offset.x, offset.y);

    const terraformingPresentation = projectTerraformingPresentation(snapshot);
    this.drawCachedTileLayer(snapshot.tiles ?? [], geom, mapModel, terraformingPresentation);
    for (const tile of snapshot.temporaryWaterTiles ?? []) {
      const p = this.center(tile, geom);
      this.drawCell(p.x, p.y, geom.r * 0.74, "rgba(66,123,136,.58)", geom);
    }
    this.drawElevationPresentation(terraformingPresentation?.elevationPresentation ?? projectElevationCues(snapshot.elevation), geom);
    this.drawNavigationOverlay(geom);
    if (this.focusCoord) this.drawFocusCell(this.focusCoord, geom);
    for (const tower of snapshot.towers ?? []) this.drawTower(tower, snapshot, geom);
    const heroPresentation = projectHeroesPresentation(snapshot);
    for (const hero of heroPresentation.units) {
      this.drawPassiveHeroAura(hero, towerPositions, geom);
      this.drawHero(hero, geom);
    }
    for (const enemy of snapshot.enemies ?? []) this.drawEnemy(enemy, snapshot, geom);
    for (const hero of heroPresentation.units) this.drawHeroBlocking(hero, positions, geom);
    this.drawEffects(geom);

    this.ctx.restore();
    this.drawOutcomeOverlay(snapshot);
    this.prevEnemyPos = positions;
    this.prevTowerPos = towerPositions;
    this.prevCombat = snapshot.combat ?? null;
  }

  setFocusCoord(coord) {
    this.focusCoord = coord && Number.isFinite(coord.q) && Number.isFinite(coord.r) ? { q: coord.q, r: coord.r } : null;
  }

  setNavigationOverlay(analysis) {
    this.navigationOverlay = projectNavigationPlacementCues(analysis);
  }

  clearNavigationOverlay() {
    this.navigationOverlay = projectNavigationPlacementCues(undefined);
  }

  drawNavigationOverlay(geom) {
    if (!this.navigationOverlay.active) return;
    this.ctx.save();
    for (const cue of this.navigationOverlay.cues) {
      const p = this.center(cue.coord, geom);
      const blocked = cue.state === "blocked";
      this.drawCell(
        p.x,
        p.y,
        geom.r * 0.76,
        blocked ? "rgba(223,106,89,.28)" : "rgba(138,199,131,.2)",
        geom
      );
    }
    this.ctx.restore();
  }

  drawElevationPresentation(presentation, geom) {
    // Elevation badge and contour cues are presentation-only.
    if (!presentation?.active) return;
    this.ctx.save();
    for (const cue of presentation.cues) {
      const point = this.center(cue.coord, geom);
      const positive = cue.elevation > 0;
      this.ctx.strokeStyle = positive ? "rgba(255,221,132,.88)" : "rgba(117,202,241,.88)";
      this.ctx.lineWidth = Math.max(1, geom.r * 0.08);
      if (geom.grid.kind === "square") {
        const size = geom.r * 1.45;
        this.ctx.strokeRect(point.x - size / 2, point.y - size / 2, size, size);
      } else {
        this.ctx.beginPath();
        for (let index = 0; index < 6; index += 1) {
          const angle = Math.PI / 6 + index * Math.PI / 3;
          const x = point.x + Math.cos(angle) * geom.r * 0.69;
          const y = point.y + Math.sin(angle) * geom.r * 0.69;
          if (index === 0) this.ctx.moveTo(x, y); else this.ctx.lineTo(x, y);
        }
        this.ctx.closePath();
        this.ctx.stroke();
      }
      const badgeWidth = Math.max(16, geom.r * 0.84);
      const badgeHeight = Math.max(11, geom.r * 0.42);
      const badgeX = point.x + geom.r * 0.28;
      const badgeY = point.y - geom.r * 0.7;
      this.ctx.fillStyle = positive ? "rgba(92,71,18,.92)" : "rgba(20,67,91,.92)";
      this.ctx.fillRect(badgeX - badgeWidth / 2, badgeY - badgeHeight / 2, badgeWidth, badgeHeight);
      this.ctx.fillStyle = "#fff8df";
      this.ctx.font = `bold ${Math.max(8, geom.r * 0.3)}px sans-serif`;
      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "middle";
      this.ctx.fillText(cue.label, badgeX, badgeY);
    }
    if (presentation.overflowCount > 0) {
      const label = `+${presentation.overflowCount} elevation cues`;
      this.ctx.font = `bold ${Math.max(10, geom.r * 0.32)}px sans-serif`;
      const width = this.ctx.measureText(label).width + 14;
      const height = Math.max(20, geom.r * 0.58);
      const x = this.canvas.width - width - 10;
      const y = 10;
      this.ctx.fillStyle = "rgba(20,24,20,.92)";
      this.ctx.fillRect(x, y, width, height);
      this.ctx.fillStyle = "#fff8df";
      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "middle";
      this.ctx.fillText(label, x + width / 2, y + height / 2);
    }
    this.ctx.restore();
  }

  drawFocusCell(coord, geom) {
    const p = this.center(coord, geom);
    this.ctx.save();
    this.ctx.strokeStyle = this.theme.towerStroke;
    this.ctx.lineWidth = Math.max(2, geom.r * 0.12);
    this.ctx.setLineDash([Math.max(3, geom.r * 0.22), Math.max(2, geom.r * 0.12)]);
    if (geom.grid.kind === "square") {
      const size = geom.r * 1.62;
      this.ctx.strokeRect(p.x - size / 2, p.y - size / 2, size, size);
      this.ctx.restore();
      return;
    }
    this.ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const angle = Math.PI / 6 + i * Math.PI / 3;
      const x = p.x + Math.cos(angle) * geom.r * 0.78;
      const y = p.y + Math.sin(angle) * geom.r * 0.78;
      if (i === 0) this.ctx.moveTo(x, y); else this.ctx.lineTo(x, y);
    }
    this.ctx.closePath();
    this.ctx.stroke();
    this.ctx.restore();
  }

  // ── juice / effects ────────────────────────────────────────────────────────
  spawnEffects(snapshot, geom, positions, towerPositions) {
    const presentationEvents = projectLegacyPresentationEvents(snapshot);
    const placedTowerPositions = new Map();
    for (const ev of presentationEvents) {
      if (ev.type === "towerPlaced") {
        placedTowerPositions.set(ev.towerId, this.center(ev.coord, geom));
        continue;
      }
      if (ev.type === "enemyHit" && ev.damage > 0) {
        const p = positions.get(ev.enemyId);
        if (p) this.effects.push({ kind: "dmg", x: p.x, y: p.y - geom.r * 0.5, vy: -geom.r * 1.1, life: 0.7, t: 0, text: "-" + (Math.round(ev.damage * 10) / 10) });
      } else if (ev.type === "enemyKilled") {
        const p = this.prevEnemyPos.get(ev.enemyId) || positions.get(ev.enemyId);
        if (p) this.spawnBurst(p, this.enemyColor(ev.enemyTypeId), geom);
      } else if (ev.type === "towerFired") {
        const tower = (snapshot.towers ?? []).find((t) => t.id === ev.towerId);
        if (tower) { const tp = this.center(tower.coord, geom); this.effects.push({ kind: "flash", x: tp.x, y: tp.y, life: 0.12, t: 0, r: geom.r * 0.6 }); }
      } else if (ev.type === "enemyLeaked") {
        this.shake = Math.min(1, this.shake + 0.6);
      }
    }
    for (const cue of projectShieldPresentationCues(snapshot)) {
      let p;
      if (cue.kind === "enemy") {
        p = positions.get(cue.runtimeId) || this.prevEnemyPos.get(cue.runtimeId);
        if (!p && cue.change === "break") {
          const spawnCoord = projectSnapshotSpawnCoord(snapshot);
          if (spawnCoord) p = this.center(spawnCoord, geom);
        }
      } else {
        p = towerPositions.get(cue.runtimeId)
          || this.prevTowerPos.get(cue.runtimeId)
          || placedTowerPositions.get(cue.runtimeId);
      }
      if (!p) continue;
      this.effects.push({
        kind: "shield",
        cause: cue.change,
        x: p.x,
        y: p.y,
        life: cue.change === "break" ? 0.48 : 0.3,
        t: 0,
        r: geom.r * (cue.kind === "tower" ? 0.74 : 0.58)
      });
    }
    for (const cue of projectMarkPresentationCues(snapshot)) {
      let p = positions.get(cue.runtimeId) || this.prevEnemyPos.get(cue.runtimeId);
      if (!p) {
        const spawnCoord = projectSnapshotSpawnCoord(snapshot);
        if (spawnCoord) p = this.center(spawnCoord, geom);
      }
      if (!p) continue;
      this.effects.push({
        kind: "mark",
        cause: cue.cause,
        markId: cue.markId,
        stacks: cue.currentStacks,
        x: p.x,
        y: p.y,
        life: 0.36,
        t: 0,
        r: geom.r * 0.64
      });
    }
    for (const cue of projectExposurePresentationCues(snapshot)) {
      let p = positions.get(cue.runtimeId) || this.prevEnemyPos.get(cue.runtimeId);
      if (!p) {
        const spawnCoord = projectSnapshotSpawnCoord(snapshot);
        if (spawnCoord) p = this.center(spawnCoord, geom);
      }
      if (!p) continue;
      this.effects.push({
        kind: "exposure",
        cause: cue.cause,
        exposureId: cue.exposureId,
        x: p.x,
        y: p.y,
        life: 0.38,
        t: 0,
        r: geom.r * 0.7
      });
    }
    for (const cue of projectReactionPresentationCues(snapshot)) {
      let p = positions.get(cue.originEnemyId) || this.prevEnemyPos.get(cue.originEnemyId);
      if (!p) p = this.center(cue.originCoord, geom);
      this.effects.push({
        kind: "reaction",
        reactionId: cue.reactionId,
        x: p.x,
        y: p.y,
        life: 0.5,
        t: 0,
        r: geom.r * 0.78
      });
    }
    for (const cue of projectPhysicsPresentationCues(snapshot)) {
      const fromPoint = this.center(cue.from, geom);
      const toPoint = this.center(cue.to, geom);
      this.effects.push({
        kind: cue.kind === "fall" ? "physics-fall" : "physics-displacement",
        x: toPoint.x,
        y: toPoint.y,
        fromX: fromPoint.x,
        fromY: fromPoint.y,
        life: cue.kind === "fall" ? 0.52 : 0.32,
        t: 0,
        r: geom.r * 0.7
      });
    }
  }
  spawnBurst(p, color, geom) {
    for (let i = 0; i < 7; i += 1) {
      const a = (i / 7) * Math.PI * 2;
      this.effects.push({ kind: "spark", x: p.x, y: p.y, vx: Math.cos(a) * geom.r * 2.4, vy: Math.sin(a) * geom.r * 2.4, life: 0.4, t: 0, color });
    }
  }
  advanceEffects(dt) {
    this.shake = Math.max(0, this.shake - dt * 3);
    let w = 0;
    for (const fx of this.effects) {
      fx.t += dt;
      if (fx.t >= fx.life) continue;
      if (fx.kind === "dmg") fx.y += fx.vy * dt;
      if (fx.kind === "spark") { fx.x += fx.vx * dt; fx.y += fx.vy * dt; fx.vx *= 0.9; fx.vy *= 0.9; }
      this.effects[w++] = fx;
    }
    this.effects.length = w;
  }
  drawEffects(geom) {
    for (const fx of this.effects) {
      const k = 1 - fx.t / fx.life;
      this.ctx.globalAlpha = Math.max(0, k);
      if (fx.kind === "dmg") {
        this.ctx.fillStyle = "#ffe2a8";
        this.ctx.font = `bold ${Math.max(10, geom.r * 0.5)}px sans-serif`;
        this.ctx.textAlign = "center";
        this.ctx.fillText(fx.text, fx.x, fx.y);
      } else if (fx.kind === "spark") {
        this.ctx.fillStyle = fx.color;
        this.ctx.beginPath();
        this.ctx.arc(fx.x, fx.y, Math.max(1, geom.r * 0.16 * k), 0, Math.PI * 2);
        this.ctx.fill();
      } else if (fx.kind === "flash") {
        this.ctx.fillStyle = "rgba(255,236,170," + (0.7 * k) + ")";
        this.ctx.beginPath();
        this.ctx.arc(fx.x, fx.y, fx.r * (0.6 + 0.4 * (1 - k)), 0, Math.PI * 2);
        this.ctx.fill();
      } else if (fx.kind === "shield") {
        this.ctx.strokeStyle = fx.cause === "break"
          ? "rgba(182,235,255," + (0.9 * k) + ")"
          : fx.cause === "damage"
            ? "rgba(92,198,255," + (0.85 * k) + ")"
            : fx.cause === "regeneration"
              ? "rgba(109,238,213," + (0.8 * k) + ")"
              : "rgba(171,142,255," + (0.8 * k) + ")";
        this.ctx.lineWidth = Math.max(1, geom.r * 0.1 * k);
        this.ctx.beginPath();
        this.ctx.arc(fx.x, fx.y, fx.r * (1.05 + 0.55 * (1 - k)), 0, Math.PI * 2);
        this.ctx.stroke();
      } else if (fx.kind === "mark") {
        this.ctx.strokeStyle = fx.cause === "expiration"
          ? "rgba(190,176,218," + (0.75 * k) + ")"
          : fx.cause === "consume"
            ? "rgba(255,190,112," + (0.85 * k) + ")"
            : "rgba(196,139,255," + (0.88 * k) + ")";
        this.ctx.lineWidth = Math.max(1, geom.r * 0.09 * k);
        this.ctx.beginPath();
        this.ctx.arc(fx.x, fx.y, fx.r * (0.9 + 0.5 * (1 - k)), 0, Math.PI * 2);
        this.ctx.stroke();
      } else if (fx.kind === "exposure") {
        this.ctx.strokeStyle = fx.cause === "consume"
          ? "rgba(255,214,128," + (0.9 * k) + ")"
          : fx.cause === "expiration"
            ? "rgba(151,190,205," + (0.72 * k) + ")"
            : "rgba(105,211,255," + (0.88 * k) + ")";
        this.ctx.lineWidth = Math.max(1, geom.r * 0.09 * k);
        this.ctx.beginPath();
        this.ctx.arc(fx.x, fx.y, fx.r * (0.82 + 0.7 * (1 - k)), 0, Math.PI * 2);
        this.ctx.stroke();
      } else if (fx.kind === "reaction") {
        this.ctx.strokeStyle = "rgba(255,230,116," + (0.92 * k) + ")";
        this.ctx.lineWidth = Math.max(2, geom.r * 0.13 * k);
        this.ctx.beginPath();
        this.ctx.arc(fx.x, fx.y, fx.r * (0.75 + 1.1 * (1 - k)), 0, Math.PI * 2);
        this.ctx.stroke();
      } else if (fx.kind === "physics-displacement") {
        this.ctx.strokeStyle = "rgba(123,220,255," + (0.9 * k) + ")";
        this.ctx.lineWidth = Math.max(2, geom.r * 0.11 * k);
        this.ctx.beginPath();
        this.ctx.moveTo(fx.fromX, fx.fromY);
        this.ctx.lineTo(fx.x, fx.y);
        this.ctx.stroke();
      } else if (fx.kind === "physics-fall") {
        this.ctx.strokeStyle = "rgba(255,139,92," + (0.92 * k) + ")";
        this.ctx.lineWidth = Math.max(2, geom.r * 0.12 * k);
        this.ctx.beginPath();
        this.ctx.arc(fx.x, fx.y, fx.r * (0.4 + 1.1 * (1 - k)), 0, Math.PI * 2);
        this.ctx.stroke();
      }
    }
    this.ctx.globalAlpha = 1;
  }
  shakeOffset(now, geom) {
    if (this.shake <= 0) return { x: 0, y: 0 };
    const m = this.shake * geom.r * 0.5;
    return { x: Math.sin(now * 0.06) * m, y: Math.cos(now * 0.085) * m };
  }
  drawOutcomeOverlay(snapshot) {
    if (snapshot.outcome !== "victory" && snapshot.outcome !== "defeat") return;
    const win = snapshot.outcome === "victory";
    this.ctx.fillStyle = win ? "rgba(20,40,20,.55)" : "rgba(40,16,16,.6)";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = win ? this.theme.tower : this.theme.danger;
    this.ctx.font = `bold ${Math.max(28, this.canvas.width * 0.08)}px sans-serif`;
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    this.ctx.fillText(win ? "VICTORY" : "DEFEAT", this.canvas.width / 2, this.canvas.height / 2);
  }

  /** Resolve a bound sprite to a draw descriptor { img, sx, sy, sw, sh }, or null if unavailable.
   *  A sprite is either a standalone image ({ src }) or a frame of an atlas ({ atlas, frame }). */
  spriteFor(kind, id) {
    const visuals = this.content.visuals;
    const bindings = ownDataValue(ownDataValue(visuals, "bindings"), kind);
    const spriteId = ownDataValue(bindings, id);
    return this.spriteById(spriteId);
  }

  spriteById(spriteId) {
    const visuals = this.content.visuals;
    const sprite = spriteId ? ownDataValue(ownDataValue(visuals, "sprites"), spriteId) : null;
    if (!sprite || typeof sprite !== "object") return null;
    if (sprite.atlas && sprite.frame) {
      const atlas = ownDataValue(ownDataValue(visuals, "atlases"), sprite.atlas);
      const img = this.loadImage(atlas && atlas.src);
      if (!img) return null;
      const f = sprite.frame;
      // Reject degenerate/negative frames so a malformed catalog draws nothing rather than
      // feeding a negative or non-finite source rect into drawImage (NaN >= 0 is false).
      if (!(f.w > 0) || !(f.h > 0) || !(f.x >= 0) || !(f.y >= 0)) return null;
      return { img, sx: f.x, sy: f.y, sw: f.w, sh: f.h };
    }
    const img = this.loadImage(sprite.src);
    return img ? { img, sx: 0, sy: 0, sw: img.naturalWidth, sh: img.naturalHeight } : null;
  }

  loadImage(src) {
    if (!src || typeof globalThis.Image !== "function") return null;
    let img = this.images.get(src);
    if (img === undefined) {
      img = new globalThis.Image();
      // Encode each path segment so filenames with spaces/unicode/reserved chars resolve (the
      // studio /project-file/ route decodeURIComponent's the path).
      img.src = assetUrl(this.assetBase, src);
      img.onload = () => { this.tileLayerDirtyAll = true; };
      this.images.set(src, img);
    }
    return img && img.complete && img.naturalWidth ? img : null;
  }

  drawMapDefinition(map) {
    if (!map) return;
    const tiles = [];
    const overrides = new Map((map.terrainOverrides ?? []).map((tile) => [`${tile.q},${tile.r}`, tile.terrain]));
    for (let r = 0; r < map.height; r += 1) {
      for (let q = 0; q < map.width; q += 1) {
        tiles.push({ q, r, terrain: overrides.get(`${q},${r}`) ?? map.defaultTerrain ?? "buildable" });
      }
    }
    this.lastGrid = map.grid ?? (map.orientation === "orthogonal" ? { kind: "square", adjacency: "cardinal" } : { kind: "hex", layout: "odd-r" });
    const geom = this.geometry(tiles, this.lastGrid);
    const mapModel = { ...map, grid: this.lastGrid, tiles };
    this.clear();
    this.drawCachedTileLayer(tiles, geom, mapModel);
    for (const coord of map.pathCenterline ?? []) {
      const p = this.center(coord, geom);
      this.drawCell(p.x, p.y, geom.r * 0.45, "rgba(215,181,119,.55)", geom);
    }
  }

  pickTile(event, tiles) {
    const geom = this.geometry(tiles ?? [], this.lastGrid);
    const rect = this.canvas.getBoundingClientRect();
    // Pointer events are reported in CSS pixels, while geometry is calculated in backbuffer
    // pixels. resize() may cap the effective DPR, so the browser's devicePixelRatio is not a
    // reliable conversion factor here. Read the canvas's actual CSS-to-backbuffer scale instead.
    const scaleX = rect.width > 0 ? this.canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? this.canvas.height / rect.height : 1;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;
    let best = null;
    let bestDist = Infinity;
    for (const tile of tiles ?? []) {
      const p = this.center(tile, geom);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestDist) {
        bestDist = d;
        best = tile;
      }
    }
    const hitRadius = geom.grid.kind === "square" ? geom.r * Math.SQRT2 : geom.r * 0.95;
    return best && bestDist <= hitRadius ? { q: best.q, r: best.r } : null;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = this.theme.bg;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  geometry(tiles, grid = this.lastGrid) {
    // Loop instead of Math.max(...tiles.map(...)): the spread pushes one argument per tile onto the
    // call stack, so a large map (256x256 = 65 536 tiles) throws "Maximum call stack size exceeded"
    // in WebKit/JSC (Safari + packaged iOS) every frame. A loop also avoids allocating two
    // tile-count arrays 60x/second.
    let maxQ = 1;
    let maxR = 1;
    for (const tile of tiles) {
      if (tile.q > maxQ) maxQ = tile.q;
      if (tile.r > maxR) maxR = tile.r;
    }
    if (grid?.kind === "square") {
      const cell = Math.min(this.canvas.width / (maxQ + 2), this.canvas.height / (maxR + 2));
      return { r: cell / 2, ox: cell, oy: cell, grid };
    }
    const r = Math.min(this.canvas.width / ((maxQ + 2) * 1.65), this.canvas.height / ((maxR + 2) * 1.45));
    return { r, ox: r * 1.5, oy: r * 1.5, grid: grid ?? { kind: "hex", layout: "odd-r" } };
  }

  center(coord, geom) {
    if (geom.grid.kind === "square") {
      return { x: geom.ox + coord.q * geom.r * 2, y: geom.oy + coord.r * geom.r * 2 };
    }
    return {
      x: geom.ox + coord.q * geom.r * 1.48 + (coord.r % 2) * geom.r * 0.74,
      y: geom.oy + coord.r * geom.r * 1.28
    };
  }

  drawTower(tower, snapshot, geom) {
    const p = this.center(tower.coord, geom);
    const disabled = (tower.disabledFor ?? 0) > 0; // silenced by an enemy tower-disrupt pulse
    const sprite = this.spriteFor("towers", tower.typeId);
    this.ctx.save();
    if (disabled) this.ctx.globalAlpha = 0.4;
    if (sprite) {
      const s = geom.r * 1.4;
      this.ctx.drawImage(sprite.img, sprite.sx, sprite.sy, sprite.sw, sprite.sh, p.x - s / 2, p.y - s / 2, s, s);
    } else {
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, geom.r * 0.52, 0, Math.PI * 2);
      this.ctx.fillStyle = this.theme.tower;
      this.ctx.fill();
      this.ctx.strokeStyle = this.theme.towerStroke;
      this.ctx.stroke();
      this.ctx.fillStyle = this.theme.bg;
      this.ctx.font = `${Math.max(10, geom.r * 0.42)}px sans-serif`;
      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "middle";
      this.ctx.fillText((this.content.towers?.[tower.typeId]?.label || tower.typeId).slice(0, 2), p.x, p.y);
    }
    this.ctx.restore();
    if (disabled) {
      this.ctx.save();
      this.ctx.strokeStyle = "#d9776b";
      this.ctx.lineWidth = 2;
      this.ctx.setLineDash([3, 3]);
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, geom.r * 0.64, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.restore();
    }
    // Health bar for damaged destructible towers (hp defined and below the type's maxHp).
    const maxHp = this.content.towers?.[tower.typeId]?.maxHp;
    if (typeof tower.hp === "number" && typeof maxHp === "number" && maxHp > 0 && tower.hp < maxHp) {
      const frac = Math.max(0, Math.min(1, tower.hp / maxHp));
      const w = geom.r * 1.1, h = Math.max(2, geom.r * 0.14), bx = p.x - w / 2, by = p.y - geom.r * 0.9;
      this.ctx.fillStyle = "rgba(0,0,0,0.55)";
      this.ctx.fillRect(bx - 1, by - 1, w + 2, h + 2);
      this.ctx.fillStyle = frac > 0.5 ? "#6fcf7e" : frac > 0.25 ? "#e0c060" : "#d9776b";
      this.ctx.fillRect(bx, by, w * frac, h);
    }
    const shield = resolveShieldPresentation(snapshot, "tower", tower.id);
    if (shield) this.drawShieldRing(p, geom.r * 0.7, shield);
  }

  drawHero(hero, geom) {
    const p = projectHeroPresentationPoint(hero, (coord) => this.center(coord, geom));
    if (!p) return;
    const sprite = this.spriteFor("heroes", hero.definitionId);
    this.ctx.save();
    if (hero.durability?.defeated) this.ctx.globalAlpha = 0.38;
    if (sprite) {
      const size = geom.r * 1.35;
      this.ctx.drawImage(sprite.img, sprite.sx, sprite.sy, sprite.sw, sprite.sh, p.x - size / 2, p.y - size / 2, size, size);
    } else {
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, geom.r * 0.5, 0, Math.PI * 2);
      this.ctx.fillStyle = this.theme.hero;
      this.ctx.fill();
      this.ctx.strokeStyle = this.theme.heroStroke;
      this.ctx.lineWidth = Math.max(1, geom.r * 0.08);
      this.ctx.stroke();
      this.ctx.fillStyle = this.theme.bg;
      this.ctx.font = `bold ${Math.max(10, geom.r * 0.38)}px sans-serif`;
      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "middle";
      this.ctx.fillText(hero.label.slice(0, 2), p.x, p.y);
    }
    this.ctx.restore();
    const durability = hero.durability;
    if (!durability) return;
    const width = geom.r * 1.05;
    const height = Math.max(3, geom.r * 0.13);
    const x = p.x - width / 2;
    const y = p.y - geom.r * 0.82;
    const hpRatio = durability.hp / durability.maxHp;
    this.ctx.save();
    this.ctx.fillStyle = "rgba(0,0,0,.65)";
    this.ctx.fillRect(x - 1, y - 1, width + 2, height + 2);
    this.ctx.fillStyle = hpRatio > 0.35 ? "#73cf82" : "#df6a59";
    this.ctx.fillRect(x, y, width * hpRatio, height);
    if (durability.shield) {
      const shieldRatio = durability.shield.current / durability.shield.capacity;
      this.ctx.strokeStyle = "rgba(99,217,255,.28)";
      this.ctx.lineWidth = Math.max(1.5, geom.r * 0.08);
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, geom.r * 0.62, 0, Math.PI * 2);
      this.ctx.stroke();
      if (shieldRatio > 0) {
        this.ctx.strokeStyle = "#63d9ff";
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, geom.r * 0.62, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * shieldRatio);
        this.ctx.stroke();
      }
    }
    if (durability.defeated) {
      const radius = geom.r * 0.38;
      this.ctx.strokeStyle = "#df6a59";
      this.ctx.lineWidth = Math.max(2, geom.r * 0.1);
      this.ctx.beginPath();
      this.ctx.moveTo(p.x - radius, p.y - radius);
      this.ctx.lineTo(p.x + radius, p.y + radius);
      this.ctx.moveTo(p.x + radius, p.y - radius);
      this.ctx.lineTo(p.x - radius, p.y + radius);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  drawPassiveHeroAura(hero, towerPositions, geom) {
    const passiveAura = hero.passiveAura;
    if (!passiveAura?.active) return;
    const heroPoint = projectHeroPresentationPoint(hero, (coord) => this.center(coord, geom));
    if (!heroPoint) return;
    this.ctx.save();
    this.ctx.strokeStyle = "rgba(122, 232, 214, .55)";
    this.ctx.lineWidth = Math.max(1.5, geom.r * 0.08);
    this.ctx.setLineDash([Math.max(3, geom.r * 0.18), Math.max(2, geom.r * 0.12)]);
    this.ctx.beginPath();
    this.ctx.arc(heroPoint.x, heroPoint.y, Math.max(geom.r * 0.72, passiveAura.radius * geom.r), 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.setLineDash([]);
    for (const towerId of passiveAura.affectedTowerIds) {
      const towerPoint = towerPositions.get(towerId);
      if (!towerPoint) continue;
      this.ctx.beginPath();
      this.ctx.arc(towerPoint.x, towerPoint.y, geom.r * 0.62, 0, Math.PI * 2);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  drawHeroBlocking(hero, enemyPositions, geom) {
    const blocking = hero.blocking;
    if (!blocking?.active) return;
    const heroPoint = projectHeroPresentationPoint(hero, (coord) => this.center(coord, geom));
    if (!heroPoint) return;
    this.ctx.save();
    this.ctx.strokeStyle = "rgba(255, 187, 92, .92)";
    this.ctx.lineWidth = Math.max(2, geom.r * 0.11);
    this.ctx.beginPath();
    this.ctx.arc(heroPoint.x, heroPoint.y, geom.r * 0.72, 0, Math.PI * 2);
    this.ctx.stroke();
    for (const enemyId of blocking.blockedEnemyIds) {
      const enemyPoint = enemyPositions.get(enemyId);
      if (!enemyPoint) continue;
      this.ctx.beginPath();
      this.ctx.arc(enemyPoint.x, enemyPoint.y, geom.r * 0.54, 0, Math.PI * 2);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  drawEnemy(enemy, snapshot, geom) {
    const p = this.enemyPoint(enemy, snapshot, geom);
    if (!p) return;
    const sprite = this.spriteFor("enemies", enemy.typeId);
    if (sprite) {
      const s = geom.r * 0.95;
      this.ctx.drawImage(sprite.img, sprite.sx, sprite.sy, sprite.sw, sprite.sh, p.x - s / 2, p.y - s / 2, s, s);
    } else {
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, geom.r * 0.38, 0, Math.PI * 2);
      this.ctx.fillStyle = this.enemyColor(enemy.typeId);
      this.ctx.fill();
      this.ctx.strokeStyle = "#111";
      this.ctx.stroke();
    }
    const hpRatio = Math.max(0, enemy.hp / enemy.maxHp);
    this.ctx.fillStyle = "#1b1d18";
    this.ctx.fillRect(p.x - geom.r * 0.45, p.y - geom.r * 0.62, geom.r * 0.9, 4);
    this.ctx.fillStyle = hpRatio > 0.35 ? this.theme.tower : this.theme.danger;
    this.ctx.fillRect(p.x - geom.r * 0.45, p.y - geom.r * 0.62, geom.r * 0.9 * hpRatio, 4);
    const shield = resolveShieldPresentation(snapshot, "enemy", enemy.id);
    if (shield) this.drawShieldRing(p, geom.r * 0.52, shield);
    this.drawExposureBadges(p, geom, resolveExposurePresentation(snapshot, enemy.id));
    this.drawMarkBadges(p, geom, resolveMarkPresentation(snapshot, enemy.id));
  }

  drawExposureBadges(point, geom, presentation) {
    const badges = presentation.entries.map((entry) => ({ label: String(entry.stacks) }));
    if (presentation.overflowCount > 0) badges.push({ label: `+${presentation.overflowCount}` });
    if (badges.length === 0) return;
    const radius = Math.max(3, geom.r * 0.12);
    const step = radius * 2.25;
    for (let index = 0; index < badges.length; index += 1) {
      const row = Math.floor(index / 4);
      const rowCount = Math.min(4, badges.length - row * 4);
      const column = index % 4;
      const x = point.x + (column - (rowCount - 1) / 2) * step;
      const y = point.y - geom.r * 0.86 - row * step;
      this.ctx.beginPath();
      this.ctx.arc(x, y, radius, 0, Math.PI * 2);
      this.ctx.fillStyle = "rgba(28,105,130,.94)";
      this.ctx.fill();
      this.ctx.strokeStyle = "rgba(157,233,255,.95)";
      this.ctx.lineWidth = Math.max(1, radius * 0.18);
      this.ctx.stroke();
      this.ctx.fillStyle = "#effcff";
      this.ctx.font = `bold ${Math.max(7, radius * 1.2)}px sans-serif`;
      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "middle";
      this.ctx.fillText(badges[index].label, x, y);
    }
  }

  drawMarkBadges(point, geom, presentation) {
    const badges = presentation.entries.map((entry) => ({ label: String(entry.stacks) }));
    if (presentation.overflowCount > 0) badges.push({ label: `+${presentation.overflowCount}` });
    if (badges.length === 0) return;
    const radius = Math.max(3, geom.r * 0.13);
    const step = radius * 2.25;
    const columns = Math.min(4, badges.length);
    for (let index = 0; index < badges.length; index += 1) {
      const row = Math.floor(index / 4);
      const rowCount = Math.min(4, badges.length - row * 4);
      const column = index % 4;
      const x = point.x + (column - (rowCount - 1) / 2) * step;
      const y = point.y + geom.r * 0.64 + row * step;
      this.ctx.beginPath();
      this.ctx.arc(x, y, radius, 0, Math.PI * 2);
      this.ctx.fillStyle = "rgba(91,53,128,.92)";
      this.ctx.fill();
      this.ctx.strokeStyle = "rgba(224,196,255,.92)";
      this.ctx.lineWidth = Math.max(1, radius * 0.18);
      this.ctx.stroke();
      this.ctx.fillStyle = "#fff5ff";
      this.ctx.font = `bold ${Math.max(7, radius * 1.2)}px sans-serif`;
      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "middle";
      this.ctx.fillText(badges[index].label, x, y);
    }
  }

  drawShieldRing(point, radius, shield) {
    this.ctx.save();
    this.ctx.strokeStyle = "rgba(101,193,235,.25)";
    this.ctx.lineWidth = Math.max(1.5, radius * 0.12);
    this.ctx.beginPath();
    this.ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    this.ctx.stroke();
    if (shield.ratio > 0) {
      this.ctx.strokeStyle = shield.regenerationDelayRemaining > 0 ? "#5fc5f0" : "#78e3e1";
      this.ctx.lineWidth = Math.max(2, radius * 0.16);
      this.ctx.beginPath();
      this.ctx.arc(
        point.x,
        point.y,
        radius,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * shield.ratio
      );
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  enemyPoint(enemy, snapshot, geom) {
    const route = enemy.routeId ? snapshot.pathRoutes?.find((item) => item.id === enemy.routeId)?.pathCenterline : snapshot.pathCenterline;
    const track = route?.length ? route : snapshot.pathCenterline;
    if (!track?.length) return this.center(snapshot.spawnCoord || { q: 0, r: 0 }, geom);
    // Interpolate between hex centers by the fractional pathProgress the engine advances each tick,
    // so enemies glide instead of teleporting tile-to-tile (matches the phaser renderer).
    const prog = Math.max(0, Math.min(track.length - 1, enemy.pathProgress));
    const i = Math.floor(prog);
    const f = prog - i;
    const a = this.center(track[i], geom);
    const b = this.center(track[Math.min(i + 1, track.length - 1)], geom);
    const legacyPoint = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    // enemy.navigation is validated and detached only by the shared projector.
    return projectEnemyNavigationPoint(enemy, legacyPoint, (coord) => this.center(coord, geom));
  }

  drawHex(x, y, r, fill) {
    this.ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const a = Math.PI / 6 + i * Math.PI / 3;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i === 0) this.ctx.moveTo(px, py);
      else this.ctx.lineTo(px, py);
    }
    this.ctx.closePath();
    this.ctx.fillStyle = fill;
    this.ctx.fill();
    this.ctx.strokeStyle = "rgba(255,255,255,.12)";
    this.ctx.stroke();
  }

  drawCell(x, y, r, fill, geom) {
    if (geom.grid.kind === "square") {
      const size = r * 2;
      this.ctx.fillStyle = fill;
      this.ctx.fillRect(x - r, y - r, size, size);
      this.ctx.strokeStyle = "rgba(255,255,255,.12)";
      this.ctx.strokeRect(x - r, y - r, size, size);
      return;
    }
    this.drawHex(x, y, r, fill);
  }

  drawCachedTileLayer(tiles, geom, map, terraformingPresentation) {
    if (typeof globalThis.document?.createElement !== "function") {
      for (const tile of tiles) this.drawTile(tile, geom, map);
      return;
    }
    if (!this.tileLayer) this.tileLayer = globalThis.document.createElement("canvas");
    const binding = this.content.visuals?.bindings?.tileSets?.maps?.[map.id]
      ?? this.content.visuals?.bindings?.tileSets?.grids?.[geom.grid.kind]
      ?? "fallback";
    const cacheKey = `${map.id}|${geom.grid.kind}|${tiles.length}|${this.canvas.width}x${this.canvas.height}|${binding}|${this.content.visuals?.tileSeed ?? 0}`;
    let fullRedraw = this.tileLayerDirtyAll || this.tileLayerKey !== cacheKey || this.tileLayer.width !== this.canvas.width || this.tileLayer.height !== this.canvas.height;
    if (this.tileLayer.width !== this.canvas.width) this.tileLayer.width = this.canvas.width;
    if (this.tileLayer.height !== this.canvas.height) this.tileLayer.height = this.canvas.height;
    const layerContext = this.tileLayer.getContext("2d");
    const previousContext = this.ctx;
    this.ctx = layerContext;
    const changedRoots = [];
    if (!fullRedraw) for (const tile of tiles) {
      const key = `${tile.q},${tile.r}`;
      if (this.tileTerrainState.get(key) === tile.terrain) continue;
      changedRoots.push({ q: tile.q, r: tile.r });
    }
    if (changedRoots.length > 1_024) {
      this.tileLayerDirtyAll = true;
      fullRedraw = true;
    }
    if (fullRedraw) {
      layerContext.clearRect(0, 0, this.tileLayer.width, this.tileLayer.height);
      for (const tile of tiles) this.drawTile(tile, geom, map);
    } else {
      const roots = mergeAutotileRoots(changedRoots, terraformingPresentation?.terrainInvalidations);
      if (roots === null) {
        // A bounded hint channel must never make a real tile-state change disappear.
        layerContext.clearRect(0, 0, this.tileLayer.width, this.tileLayer.height);
        for (const tile of tiles) this.drawTile(tile, geom, map);
      }
      const expanded = roots === null ? undefined : expandAutotileInvalidations({ gridType: geom.grid.kind, coordinates: roots, tiles });
      if (expanded === undefined && roots !== null) {
        // Descriptor-invalid renderer input cannot be trusted for a partial redraw.
        layerContext.clearRect(0, 0, this.tileLayer.width, this.tileLayer.height);
        for (const tile of tiles) this.drawTile(tile, geom, map);
      }
      const dirty = new Set((expanded ?? []).map((coord) => `${coord.q},${coord.r}`));
      if (dirty.size) {
        const tileByKey = new Map(tiles.map((tile) => [`${tile.q},${tile.r}`, tile]));
        for (const key of dirty) {
          const tile = tileByKey.get(key);
          if (!tile) continue;
          this.clipCell(tile, geom, () => {
            const p = this.center(tile, geom);
            layerContext.clearRect(p.x - geom.r, p.y - geom.r, geom.r * 2, geom.r * 2);
            this.drawTile(tile, geom, map);
          });
        }
      }
    }
    this.ctx = previousContext;
    this.tileLayerKey = cacheKey;
    this.tileLayerDirtyAll = false;
    this.tileTerrainState = new Map(tiles.map((tile) => [`${tile.q},${tile.r}`, tile.terrain]));
    previousContext.drawImage(this.tileLayer, 0, 0);
  }

  clipCell(coord, geom, draw) {
    const p = this.center(coord, geom);
    this.ctx.save();
    this.ctx.beginPath();
    if (geom.grid.kind === "square") {
      this.ctx.rect(p.x - geom.r, p.y - geom.r, geom.r * 2, geom.r * 2);
    } else {
      for (let index = 0; index < 6; index += 1) {
        const angle = Math.PI / 6 + index * Math.PI / 3;
        const x = p.x + Math.cos(angle) * geom.r;
        const y = p.y + Math.sin(angle) * geom.r;
        if (index === 0) this.ctx.moveTo(x, y); else this.ctx.lineTo(x, y);
      }
      this.ctx.closePath();
    }
    this.ctx.clip();
    draw();
    this.ctx.restore();
  }

  drawTile(tile, geom, map) {
    const p = this.center(tile, geom);
    const resolved = resolveAutotile({ map, visuals: this.content.visuals, coord: tile, terrain: tile.terrain, seed: this.content.visuals?.tileSeed ?? 0 });
    if (resolved.sectors?.length) {
      const complete = resolved.sectors.every((sector) => this.spriteById(sector.selected?.spriteId));
      if (!complete) {
        this.drawCell(p.x, p.y, geom.r * 0.86, this.tileColor(tile.terrain), geom);
        return;
      }
      for (const sector of resolved.sectors) this.drawTileSector(p, geom, sector);
      return;
    }
    const sprite = this.spriteById(resolved.selected?.spriteId);
    if (!sprite) {
      this.drawCell(p.x, p.y, geom.r * 0.86, this.tileColor(tile.terrain), geom);
      return;
    }
    const size = geom.grid.kind === "square" ? geom.r * 1.72 : geom.r * 1.72;
    this.ctx.save();
    const transform = resolved.selected?.transform;
    this.ctx.translate(p.x, p.y);
    if (transform?.rotate) this.ctx.rotate((transform.rotate * Math.PI) / 180);
    this.ctx.scale(transform?.flipX ? -1 : 1, transform?.flipY ? -1 : 1);
    this.ctx.drawImage(sprite.img, sprite.sx, sprite.sy, sprite.sw, sprite.sh, -size / 2, -size / 2, size, size);
    this.ctx.restore();
  }

  drawTileSector(center, geom, sector) {
    const sprite = this.spriteById(sector.selected?.spriteId);
    if (!sprite) return;
    const size = geom.r * 1.72;
    this.ctx.save();
    this.ctx.beginPath();
    if (geom.grid.kind === "square") {
      const quadrants = {
        NW: [-size / 2, -size / 2], NE: [0, -size / 2],
        SE: [0, 0], SW: [-size / 2, 0]
      };
      const [x, y] = quadrants[sector.direction] ?? [-size / 2, -size / 2];
      this.ctx.rect(center.x + x, center.y + y, size / 2, size / 2);
    } else {
      const index = HEX_SECTOR_DIRECTIONS.indexOf(sector.direction);
      const start = -Math.PI + index * Math.PI / 3;
      this.ctx.moveTo(center.x, center.y);
      this.ctx.lineTo(center.x + Math.cos(start) * size / 2, center.y + Math.sin(start) * size / 2);
      this.ctx.lineTo(center.x + Math.cos(start + Math.PI / 3) * size / 2, center.y + Math.sin(start + Math.PI / 3) * size / 2);
      this.ctx.closePath();
    }
    this.ctx.clip();
    this.ctx.translate(center.x, center.y);
    const transform = sector.selected?.transform;
    if (transform?.rotate) this.ctx.rotate((transform.rotate * Math.PI) / 180);
    this.ctx.scale(transform?.flipX ? -1 : 1, transform?.flipY ? -1 : 1);
    this.ctx.drawImage(sprite.img, sprite.sx, sprite.sy, sprite.sw, sprite.sh, -size / 2, -size / 2, size, size);
    this.ctx.restore();
  }

  tileColor(terrain) {
    return this.theme[terrain] ?? this.theme.buildable;
  }

  enemyColor(id) {
    const value = this.content.enemies?.[id]?.color ?? 0xaaaaaa;
    return "#" + Number(value).toString(16).padStart(6, "0");
  }
}

const HEX_SECTOR_DIRECTIONS = ["NW", "NE", "E", "SE", "SW", "W"];

function mergeAutotileRoots(changedRoots, hints) {
  const unique = new Map();
  for (const point of changedRoots) unique.set(`${point.q},${point.r}`, point);
  if (Array.isArray(hints)) {
    for (const point of hints) {
      if (Number.isSafeInteger(point?.q) && Number.isSafeInteger(point?.r) && point.q >= 0 && point.r >= 0) unique.set(`${point.q},${point.r}`, { q: point.q, r: point.r });
    }
  }
  return unique.size <= 1_024 ? [...unique.values()] : null;
}

function assetUrl(assetBase, src) {
  const value = String(src ?? "");
  if (/^(?:data:|blob:|https?:)/i.test(value)) return value;
  return assetBase + value.split("/").map(encodeURIComponent).join("/");
}
