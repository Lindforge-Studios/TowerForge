import { compileMapSources, normalizeElevationOverrides } from "./map-compiler.mjs";

export const PROJECT_SCHEMA_VERSION = 3;

const MECHANICS_SCHEMA_VERSION = 1;
const COMBAT_MODULE_SCHEMA_VERSIONS = new Set([1, 2, 3]);
const ELEVATION_MODULE_SCHEMA_VERSIONS = new Set([1, 2, 3]);
const BASE_MODULE_SCHEMA_VERSIONS = new Set([MECHANICS_SCHEMA_VERSION]);
const MECHANICS_MODULE_IDS = new Set([
  "combat",
  "reactions",
  "navigation",
  "elevation",
  "physics",
  "roguelite",
  "heroes",
  "logistics",
  "director",
  "scriptingDx",
  "multiplayer"
]);

export function defaultVisuals() {
  return {
    schemaVersion: 2,
    assetsRoot: "assets",
    atlases: {},
    sprites: {},
    tileSets: {},
    bindings: {
      towers: {},
      enemies: {},
      tiles: {},
      tileSets: { grids: {}, maps: {} },
      ui: {}
    },
    audio: {
      sounds: {},
      events: {},
      musicTracks: {},
      musicByMission: {}
    }
  };
}

export function normalizeManifest(input) {
  const manifest = clone(input);
  manifest.schemaVersion ??= PROJECT_SCHEMA_VERSION;
  manifest.name ??= "Untitled Tower Defense";
  manifest.description ??= "";
  manifest.engineVersion ??= "0.1.0";
  return manifest;
}

export function normalizeVisuals(input) {
  const visuals = { ...defaultVisuals(), ...clone(input) };
  visuals.schemaVersion ??= 2;
  visuals.assetsRoot = normalizeRelativeAssetPath(visuals.assetsRoot || "assets", "assets");
  visuals.atlases ??= {};
  visuals.sprites ??= {};
  visuals.tileSets ??= {};
  visuals.bindings = {
    towers: {},
    enemies: {},
    tiles: {},
    tileSets: { grids: {}, maps: {} },
    ui: {},
    ...(visuals.bindings ?? {})
  };
  visuals.bindings.towers ??= {};
  visuals.bindings.enemies ??= {};
  visuals.bindings.tiles ??= {};
  visuals.bindings.tileSets ??= { grids: {}, maps: {} };
  visuals.bindings.tileSets.grids ??= {};
  visuals.bindings.tileSets.maps ??= {};
  visuals.bindings.ui ??= {};

  for (const atlas of Object.values(visuals.atlases)) {
    if (atlas && typeof atlas === "object" && typeof atlas.src === "string") {
      atlas.src = normalizeRelativeAssetPath(atlas.src, visuals.assetsRoot);
    }
  }
  for (const sprite of Object.values(visuals.sprites)) {
    if (sprite && typeof sprite === "object" && typeof sprite.src === "string") {
      sprite.src = normalizeRelativeAssetPath(sprite.src, visuals.assetsRoot);
    }
  }
  visuals.audio = visuals.audio && typeof visuals.audio === "object" ? visuals.audio : {};
  visuals.audio.sounds ??= {};
  visuals.audio.events ??= {};
  visuals.audio.musicTracks ??= {};
  visuals.audio.musicByMission ??= {};
  for (const sound of Object.values(visuals.audio.sounds)) {
    if (sound && typeof sound === "object" && typeof sound.src === "string") {
      sound.src = normalizeRelativeAssetPath(sound.src, visuals.assetsRoot);
    }
  }
  for (const track of Object.values(visuals.audio.musicTracks)) {
    if (track && typeof track === "object" && typeof track.src === "string") {
      track.src = normalizeRelativeAssetPath(track.src, visuals.assetsRoot);
    }
  }
  return visuals;
}

/** Mirrors the engine's deriveValidationCode (packages/engine/src/content/validate.ts) so issues
 *  merged from both sources carry a consistent, stable machine-branchable code. */
function deriveValidationCode(entityKind, fieldPath) {
  return `${entityKind}_${fieldPath}`.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function validateProjectSchemas(files) {
  const issues = [];
  const issue = (severity, entityKind, entityId, fieldPath, message, extra = {}) => {
    issues.push({ severity, entityKind, entityId, fieldPath, message, code: extra.code ?? deriveValidationCode(entityKind, fieldPath), hint: extra.hint, expected: extra.expected, got: extra.got });
  };
  const err = (...args) => issue("error", ...args);
  const warn = (...args) => issue("warning", ...args);

  if (!Number.isInteger(files.manifest?.schemaVersion)) {
    err("project", "project.json", "schemaVersion", "project.json must define an integer schemaVersion.");
  } else if (files.manifest.schemaVersion > PROJECT_SCHEMA_VERSION) {
    err(
      "project",
      "project.json",
      "schemaVersion",
      `Project schemaVersion ${files.manifest.schemaVersion} is newer than this CLI supports (${PROJECT_SCHEMA_VERSION}).`
    );
  }

  validateMechanics(files, err, warn);

  if (files.manifest?.schemaVersion !== PROJECT_SCHEMA_VERSION && hasAuthoredElevation(files)) {
    err(
      "project",
      "project.json",
      "schemaVersion",
      `Projects that author map elevation must use project schemaVersion ${PROJECT_SCHEMA_VERSION}.`
    );
  }

  validateMaps(files.maps, err, warn);
  for (const issue of files.scriptIssues ?? []) {
    err("scriptFile", issue.path ?? "scripts", "source", issue.message ?? "Invalid TowerScript file.");
  }
  validateMapSources(files.mapSources ?? {}, err, warn);
  issues.push(...compileMapSources(files.mapSources ?? {}, files.balance?.terrainTypes ?? {}).issues);
  validateVisuals(files.visuals, err, warn, files.balance, files.maps);
  validateNarrative(files, err, warn);
  validateBuildTargets(files.buildTargets, err);

  return {
    ok: issues.filter((i) => i.severity === "error").length === 0,
    issues
  };
}

function validateMechanics(files, err, warn) {
  const authored = files.mechanicsAuthored ?? files.mechanics !== undefined;
  let modules = {};

  if (authored) {
    const manifestVersion = files.manifest?.schemaVersion;
    if (manifestVersion !== PROJECT_SCHEMA_VERSION) {
      err(
        "project",
        "project.json",
        "schemaVersion",
        `Projects that author content/mechanics.json must use project schemaVersion ${PROJECT_SCHEMA_VERSION}.`
      );
    }

    const mechanics = files.mechanics;
    if (!isRecord(mechanics)) {
      err("mechanics", "content/mechanics.json", "root", "mechanics.json must be an object.");
    } else {
      if (mechanics.schemaVersion !== MECHANICS_SCHEMA_VERSION) {
        const message = Number.isInteger(mechanics.schemaVersion) && mechanics.schemaVersion > MECHANICS_SCHEMA_VERSION
          ? `Mechanics schemaVersion ${mechanics.schemaVersion} is newer than this CLI supports (${MECHANICS_SCHEMA_VERSION}).`
          : `Mechanics schemaVersion must be ${MECHANICS_SCHEMA_VERSION}.`;
        err("mechanics", "content/mechanics.json", "schemaVersion", message);
      }
      if (!isRecord(mechanics.modules)) {
        err("mechanics", "content/mechanics.json", "modules", "modules must be an object keyed by mechanics module ID.");
      } else {
        modules = mechanics.modules;
        for (const [moduleId, module] of Object.entries(modules)) {
          const modulePath = `modules.${moduleId}`;
          if (!MECHANICS_MODULE_IDS.has(moduleId)) {
            err("mechanics", moduleId, modulePath, `Mechanics module "${moduleId}" is not supported.`);
          }
          if (!isRecord(module)) {
            err("mechanics", moduleId, modulePath, `Mechanics module "${moduleId}" must be an object.`);
            continue;
          }
          const supportedVersions = moduleId === "combat"
            ? COMBAT_MODULE_SCHEMA_VERSIONS
            : moduleId === "elevation"
              ? ELEVATION_MODULE_SCHEMA_VERSIONS
              : BASE_MODULE_SCHEMA_VERSIONS;
          if (!supportedVersions.has(module.schemaVersion)) {
            const supported = [...supportedVersions].join(" or ");
            const message = Number.isInteger(module.schemaVersion)
              && module.schemaVersion > Math.max(...supportedVersions)
              ? `Module schemaVersion ${module.schemaVersion} is newer than this CLI supports (${supported}).`
              : `Module schemaVersion must be ${supported}.`;
            err("mechanics", moduleId, `${modulePath}.schemaVersion`, message);
          }
          if (typeof module.enabled !== "boolean") {
            err("mechanics", moduleId, `${modulePath}.enabled`, "enabled must be a boolean.");
          }
          if (!isRecord(module.profiles)) {
            err("mechanics", moduleId, `${modulePath}.profiles`, "profiles must be an object keyed by profile ID.");
            continue;
          }
          for (const [profileId, profile] of Object.entries(module.profiles)) {
            if (!isRecord(profile)) {
              err("mechanics", moduleId, `${modulePath}.profiles.${profileId}`, `Profile "${profileId}" must be an object.`);
            }
          }
        }
      }
    }
  }

  for (const [missionId, mission] of Object.entries(files.balance?.missions ?? {})) {
    validateMissionMechanicsSelection(
      missionId,
      mission?.mechanics,
      modules,
      files.balance?.terrainTypes,
      err,
      warn
    );
  }
}

function validateMissionMechanicsSelection(missionId, selection, modules, terrainTypes, err, warn) {
  if (selection === undefined) return;
  if (!isRecord(selection)) {
    err("mission", missionId, "mechanics", "Mission mechanics must be an object.");
    return;
  }
  if (selection.profiles === undefined) return;
  if (!isRecord(selection.profiles)) {
    err("mission", missionId, "mechanics.profiles", "Mission mechanics profiles must be an object keyed by module ID.");
    return;
  }

  for (const [moduleId, profileId] of Object.entries(selection.profiles)) {
    const fieldPath = `mechanics.profiles.${moduleId}`;
    if (!MECHANICS_MODULE_IDS.has(moduleId)) {
      err("mission", missionId, fieldPath, `Mission selects unsupported mechanics module "${moduleId}".`);
      continue;
    }
    if (typeof profileId !== "string" || profileId.trim() === "") {
      err("mission", missionId, fieldPath, "Selected mechanics profile ID must be a non-empty string.");
      continue;
    }

    const module = isRecord(modules) ? modules[moduleId] : undefined;
    if (!isRecord(module)) {
      warn("mission", missionId, fieldPath, `Mission selects profile "${profileId}" from missing mechanics module "${moduleId}".`);
    } else if (module.enabled !== true) {
      warn("mission", missionId, fieldPath, `Mission selects profile "${profileId}" from disabled mechanics module "${moduleId}".`);
    } else if (!isRecord(module.profiles) || !Object.prototype.hasOwnProperty.call(module.profiles, profileId)) {
      err("mission", missionId, fieldPath, `Mission selects missing profile "${profileId}" from enabled mechanics module "${moduleId}".`);
    }
  }

  const reactionProfileId = selection.profiles.reactions;
  if (typeof reactionProfileId !== "string" || reactionProfileId.trim() === "") return;
  const reactionModule = isRecord(modules) ? modules.reactions : undefined;
  const combatProfileId = selection.profiles.combat;
  const combatModule = isRecord(modules) ? modules.combat : undefined;
  const combatCompatible = typeof combatProfileId === "string"
    && isRecord(combatModule)
    && combatModule.enabled === true
    && [2, 3].includes(combatModule.schemaVersion)
    && isRecord(combatModule.profiles)
    && isRecord(combatModule.profiles[combatProfileId]);
  if (!combatCompatible) {
    const reportDependency = reactionModule?.enabled === true ? err : warn;
    reportDependency(
      "mission",
      missionId,
      "mechanics.profiles.reactions",
      "The selected reactions profile requires an active mission-selected combat v2/v3 profile (dependency_missing).",
      { code: "dependency_missing" }
    );
    return;
  }

  if (!isRecord(reactionModule?.profiles) || !isRecord(reactionModule.profiles[reactionProfileId])) return;
  const reactionProfile = reactionModule.profiles[reactionProfileId];
  const damageTypes = isRecord(combatModule.profiles[combatProfileId].damageTypes)
    ? combatModule.profiles[combatProfileId].damageTypes
    : {};
  const referenced = collectReactionDamageTypeReferences(reactionProfile);
  const report = reactionModule.enabled === true ? err : warn;
  for (const damageTypeId of referenced) {
    if (!Object.hasOwn(damageTypes, damageTypeId)) {
      report(
        "mechanics",
        "reactions",
        `modules.reactions.profiles.${reactionProfileId}`,
        `Reaction profile "${reactionProfileId}" references unknown combat damage type "${damageTypeId}".`,
        { code: "reaction_damage_type_missing" }
      );
    }
  }
  const authoredTerrainTags = new Set();
  if (isRecord(terrainTypes)) {
    for (const terrain of Object.values(terrainTypes)) {
      if (!isRecord(terrain) || !Array.isArray(terrain.tags)) continue;
      for (const tag of terrain.tags) if (typeof tag === "string") authoredTerrainTags.add(tag);
    }
  }
  for (const terrainTag of collectReactionTerrainTagReferences(reactionProfile)) {
    if (!authoredTerrainTags.has(terrainTag)) {
      report(
        "mechanics",
        "reactions",
        `modules.reactions.profiles.${reactionProfileId}`,
        `Reaction profile "${reactionProfileId}" references unavailable authored terrain tag "${terrainTag}" (reaction_terrain_tag_missing).`,
        { code: "reaction_terrain_tag_missing" }
      );
    }
  }
}

function collectReactionDamageTypeReferences(profile) {
  const ids = new Set();
  const applications = profile?.exposures?.applications?.damageTypes;
  if (isRecord(applications)) for (const id of Object.keys(applications)) ids.add(id);
  if (isRecord(profile?.reactions)) {
    for (const reaction of Object.values(profile.reactions)) {
      if (!isRecord(reaction)) continue;
      if (Array.isArray(reaction.trigger?.damageTypes)) {
        for (const id of reaction.trigger.damageTypes) if (typeof id === "string") ids.add(id);
      }
      if (isRecord(reaction.effects)) {
        for (const effect of Object.values(reaction.effects)) {
          if (isRecord(effect) && typeof effect.damageType === "string") ids.add(effect.damageType);
        }
      }
    }
  }
  return [...ids].sort();
}

function collectReactionTerrainTagReferences(profile) {
  const tags = new Set();
  if (!isRecord(profile?.reactions)) return [];
  for (const reaction of Object.values(profile.reactions)) {
    if (!isRecord(reaction)) continue;
    if (Array.isArray(reaction.requirements)) {
      for (const requirement of reaction.requirements) {
        if (isRecord(requirement) && requirement.kind === "terrain_tag" && typeof requirement.tag === "string") {
          tags.add(requirement.tag);
        }
      }
    }
    if (isRecord(reaction.effects)) {
      for (const effect of Object.values(reaction.effects)) {
        if (isRecord(effect?.target) && effect.target.kind === "terrain_tag" && typeof effect.target.tag === "string") {
          tags.add(effect.target.tag);
        }
      }
    }
  }
  return [...tags].sort();
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateNarrative(files, err, warn) {
  const story = files.storyComics;
  if (story === undefined) {
    // Backward-compatible partial schema callers and legacy projects get the loader defaults.
  } else if (!story || typeof story !== "object" || Array.isArray(story)) {
    err("story", "content/story-comics.json", "root", "story-comics.json must be an object.");
  } else {
    if (typeof story.seenStoragePrefix !== "string" || story.seenStoragePrefix.trim() === "") {
      err("story", "content/story-comics.json", "seenStoragePrefix", "seenStoragePrefix must be a non-empty string.");
    }
    if (!story.comics || typeof story.comics !== "object" || Array.isArray(story.comics)) {
      err("story", "content/story-comics.json", "comics", "comics must be an object keyed by comic ID.");
    } else {
      for (const [comicId, comic] of Object.entries(story.comics)) {
        const base = `comics.${comicId}`;
        if (!comic || typeof comic !== "object" || Array.isArray(comic)) {
          err("story", comicId, base, `Comic "${comicId}" must be an object.`);
          continue;
        }
        if (typeof comic.missionId !== "string" || !files.balance?.missions?.[comic.missionId]) {
          err("story", comicId, `${base}.missionId`, `Comic "${comicId}" must reference an existing mission.`);
        }
        if (comic.trigger !== undefined && !["beforeMission", "afterVictory"].includes(comic.trigger)) {
          err("story", comicId, `${base}.trigger`, "trigger must be beforeMission or afterVictory.");
        }
        if (comic.replay !== undefined && !["once", "always"].includes(comic.replay)) {
          err("story", comicId, `${base}.replay`, "replay must be once or always.");
        }
        if (!Array.isArray(comic.panels) || comic.panels.length === 0) {
          err("story", comicId, `${base}.panels`, `Comic "${comicId}" must contain at least one panel.`);
          continue;
        }
        comic.panels.forEach((panel, index) => {
          const panelPath = `${base}.panels.${index}`;
          if (!panel || typeof panel !== "object" || Array.isArray(panel)) {
            err("story", comicId, panelPath, "Story panel must be an object.");
            return;
          }
          if (typeof panel.text !== "string" || panel.text.trim() === "") {
            err("story", comicId, `${panelPath}.text`, "Story panel text must be a non-empty string.");
          }
          if (panel.spriteId !== undefined && !files.visuals?.sprites?.[panel.spriteId]) {
            err("story", comicId, `${panelPath}.spriteId`, `Story panel references unknown sprite "${panel.spriteId}".`);
          }
        });
      }
    }
  }

  const backgrounds = files.battleBackgrounds;
  if (backgrounds === undefined) return;
  if (!backgrounds || typeof backgrounds !== "object" || Array.isArray(backgrounds)) {
    err("battleBackground", "content/battle-backgrounds.json", "root", "battle-backgrounds.json must be an object.");
    return;
  }
  if (!backgrounds.definitions || typeof backgrounds.definitions !== "object" || Array.isArray(backgrounds.definitions)) {
    err("battleBackground", "content/battle-backgrounds.json", "definitions", "definitions must be an object keyed by mission ID.");
    return;
  }
  if (backgrounds.fallbackMissionId && !backgrounds.definitions[backgrounds.fallbackMissionId]) {
    warn("battleBackground", "content/battle-backgrounds.json", "fallbackMissionId", "fallbackMissionId has no matching background definition.");
  }
  if (!Array.isArray(backgrounds.placeholderMissionIds)) {
    err("battleBackground", "content/battle-backgrounds.json", "placeholderMissionIds", "placeholderMissionIds must be an array.");
  } else {
    for (const missionId of backgrounds.placeholderMissionIds) {
      if (!files.balance?.missions?.[missionId]) warn("battleBackground", missionId, "placeholderMissionIds", `Placeholder references unknown mission "${missionId}".`);
    }
  }
  for (const [definitionId, definition] of Object.entries(backgrounds.definitions)) {
    const base = `definitions.${definitionId}`;
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
      err("battleBackground", definitionId, base, `Background "${definitionId}" must be an object.`);
      continue;
    }
    const missionId = definition.missionId ?? definitionId;
    if (!files.balance?.missions?.[missionId]) {
      err("battleBackground", definitionId, `${base}.missionId`, `Background "${definitionId}" must reference an existing mission.`);
    }
    if (definition.color !== undefined && !/^#[0-9a-f]{6}$/i.test(definition.color)) {
      err("battleBackground", definitionId, `${base}.color`, "color must use six-digit hex notation, for example #101410.");
    }
    if (definition.opacity !== undefined && (!Number.isFinite(definition.opacity) || definition.opacity < 0 || definition.opacity > 1)) {
      err("battleBackground", definitionId, `${base}.opacity`, "opacity must be a number from 0 to 1.");
    }
    if (definition.spriteId !== undefined && !files.visuals?.sprites?.[definition.spriteId]) {
      err("battleBackground", definitionId, `${base}.spriteId`, `Background references unknown sprite "${definition.spriteId}".`);
    }
  }
}

export function validateSafeAssetPath(assetPath, fieldPath = "asset") {
  if (typeof assetPath !== "string" || assetPath.trim() === "") {
    return `${fieldPath} must be a non-empty project-relative path.`;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(assetPath)) {
    return `${fieldPath} must not be an external URL.`;
  }
  if (assetPath.startsWith("/") || assetPath.startsWith("\\")) {
    return `${fieldPath} must not be an absolute path.`;
  }
  const parts = assetPath.split(/[\\/]+/).filter(Boolean);
  if (parts.includes("..")) {
    return `${fieldPath} must not contain '..'.`;
  }
  return null;
}

export function listVisualAssetPaths(visuals) {
  const seen = new Set();
  const paths = [];
  const add = (entry) => {
    const dedupeKey = `${entry.kind}:${entry.id}:${entry.path}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    paths.push(entry);
  };
  for (const [atlasId, atlas] of Object.entries(visuals?.atlases ?? {})) {
    if (typeof atlas?.src === "string") add({ kind: "atlas", id: atlasId, path: atlas.src });
  }
  for (const [spriteId, sprite] of Object.entries(visuals?.sprites ?? {})) {
    if (typeof sprite?.src === "string") add({ kind: "sprite", id: spriteId, path: sprite.src });
  }
  for (const [soundId, sound] of Object.entries(visuals?.audio?.sounds ?? {})) {
    if (typeof sound?.src === "string") add({ kind: "sound", id: soundId, path: sound.src });
  }
  for (const [trackId, track] of Object.entries(visuals?.audio?.musicTracks ?? {})) {
    if (typeof track?.src === "string") add({ kind: "music", id: trackId, path: track.src });
  }
  return paths;
}

function validateVisuals(visuals, err, warn, balance, maps = {}) {
  if (!visuals || typeof visuals !== "object") {
    err("visuals", "content/visuals.json", "root", "visuals.json must be an object.");
    return;
  }
  const assetsRootIssue = validateSafeAssetPath(visuals.assetsRoot ?? "assets", "assetsRoot");
  if (assetsRootIssue) err("visuals", "content/visuals.json", "assetsRoot", assetsRootIssue);

  if (visuals.theme !== undefined) {
    if (!visuals.theme || typeof visuals.theme !== "object" || Array.isArray(visuals.theme)) {
      err("visuals", "content/visuals.json", "theme", "theme must be an object.");
    } else {
      for (const groupName of ["ui", "renderer"]) {
        const group = visuals.theme[groupName];
        if (!group || typeof group !== "object" || Array.isArray(group)) {
          err("visuals", "content/visuals.json", `theme.${groupName}`, `theme.${groupName} must be a color palette object.`);
          continue;
        }
        for (const [key, color] of Object.entries(group)) {
          if (!/^[a-z][a-z0-9-]*$/i.test(key) || !/^#[0-9a-f]{6}$/i.test(color)) {
            err("visuals", "content/visuals.json", `theme.${groupName}.${key}`, `Theme color "${key}" must use a safe CSS variable name and six-digit hex value.`);
          }
        }
      }
    }
  }

  for (const [atlasId, atlas] of Object.entries(visuals.atlases ?? {})) {
    if (!atlas || typeof atlas !== "object") {
      err("visuals", atlasId, `atlases.${atlasId}`, `Atlas "${atlasId}" must be an object.`);
      continue;
    }
    if (atlas.src !== undefined) {
      const safeIssue = validateSafeAssetPath(atlas.src, `atlases.${atlasId}.src`);
      if (safeIssue) err("visuals", atlasId, `atlases.${atlasId}.src`, safeIssue);
    } else {
      warn("visuals", atlasId, `atlases.${atlasId}.src`, `Atlas "${atlasId}" has no src yet.`);
    }
  }

  for (const [spriteId, sprite] of Object.entries(visuals.sprites ?? {})) {
    if (!sprite || typeof sprite !== "object") {
      err("visuals", spriteId, `sprites.${spriteId}`, `Sprite "${spriteId}" must be an object.`);
      continue;
    }
    const hasFrameShape = sprite.atlas !== undefined || sprite.frame !== undefined;
    // The renderer prefers the atlas/frame branch when it is present, so a sprite that sets BOTH
    // src and atlas/frame is ambiguous — validate the frame regardless of src and reject the mix.
    if (sprite.src !== undefined && hasFrameShape) {
      err("visuals", spriteId, `sprites.${spriteId}`, `Sprite "${spriteId}" must not set both "src" and "atlas"/"frame" — use a standalone image or an atlas frame, not both.`);
    }
    if (sprite.src !== undefined) {
      const safeIssue = validateSafeAssetPath(sprite.src, `sprites.${spriteId}.src`);
      if (safeIssue) err("visuals", spriteId, `sprites.${spriteId}.src`, safeIssue);
    }
    if (hasFrameShape) {
      // Atlas-frame sprite: a sub-rectangle of an existing atlas image.
      if (typeof sprite.atlas !== "string" || !(visuals.atlases && visuals.atlases[sprite.atlas])) {
        err("visuals", spriteId, `sprites.${spriteId}.atlas`, `Sprite "${spriteId}" references unknown atlas "${sprite.atlas}".`);
      }
      const frame = sprite.frame;
      if (!frame || typeof frame !== "object") {
        err("visuals", spriteId, `sprites.${spriteId}.frame`, `Sprite "${spriteId}" atlas frame must be an object { x, y, w, h }.`);
      } else {
        for (const key of ["x", "y"]) {
          if (!Number.isFinite(frame[key]) || frame[key] < 0) err("visuals", spriteId, `sprites.${spriteId}.frame.${key}`, `Sprite "${spriteId}" frame.${key} must be a number >= 0.`);
        }
        for (const key of ["w", "h"]) {
          if (!Number.isFinite(frame[key]) || frame[key] <= 0) err("visuals", spriteId, `sprites.${spriteId}.frame.${key}`, `Sprite "${spriteId}" frame.${key} must be a number > 0.`);
        }
      }
    } else if (sprite.src === undefined) {
      warn("visuals", spriteId, `sprites.${spriteId}`, `Sprite "${spriteId}" has no image src or atlas frame yet.`);
    }
  }
  for (const [tileSetId, tileSet] of Object.entries(visuals.tileSets ?? {})) {
    if (!tileSet || typeof tileSet !== "object" || Array.isArray(tileSet)) {
      err("tileSet", tileSetId, `tileSets.${tileSetId}`, `Tileset "${tileSetId}" must be an object.`);
      continue;
    }
    if (!visuals.atlases?.[tileSet.atlas]) err("tileSet", tileSetId, `tileSets.${tileSetId}.atlas`, `Tileset references unknown atlas "${String(tileSet.atlas)}".`);
    if (tileSet.id !== undefined && tileSet.id !== tileSetId) err("tileSet", tileSetId, `tileSets.${tileSetId}.id`, `Tileset id "${String(tileSet.id)}" must match its catalog key.`);
    if (!Number.isInteger(tileSet.tileWidth) || tileSet.tileWidth <= 0) err("tileSet", tileSetId, `tileSets.${tileSetId}.tileWidth`, "tileWidth must be a positive integer.");
    if (!Number.isInteger(tileSet.tileHeight) || tileSet.tileHeight <= 0) err("tileSet", tileSetId, `tileSets.${tileSetId}.tileHeight`, "tileHeight must be a positive integer.");
    for (const field of ["margin", "spacing"]) {
      if (tileSet[field] !== undefined && (!Number.isInteger(tileSet[field]) || tileSet[field] < 0)) err("tileSet", tileSetId, `tileSets.${tileSetId}.${field}`, `${field} must be a non-negative integer.`);
    }
    if (!["random", "edge", "corner", "mixed", "blob", "dual-grid", "sectors"].includes(tileSet.ruleKind)) {
      err("tileSet", tileSetId, `tileSets.${tileSetId}.ruleKind`, `Unsupported ruleKind "${String(tileSet.ruleKind)}".`);
    }
    if (!["hex", "square"].includes(tileSet.topology)) err("tileSet", tileSetId, `tileSets.${tileSetId}.topology`, "topology must be hex or square.");
    if (!tileSet.materials || typeof tileSet.materials !== "object" || Array.isArray(tileSet.materials)) {
      err("tileSet", tileSetId, `tileSets.${tileSetId}.materials`, "materials must be an object keyed by terrain id.");
      continue;
    }
    for (const [terrainId, material] of Object.entries(tileSet.materials)) {
      const base = `tileSets.${tileSetId}.materials.${terrainId}`;
      if (!balance?.terrainTypes?.[terrainId]) warn("tileSet", tileSetId, base, `Material references undeclared terrain "${terrainId}".`);
      if (!material || typeof material !== "object" || Array.isArray(material)) {
        err("tileSet", tileSetId, base, "material must be an object.");
        continue;
      }
      if (material.connectionSource !== undefined && !["neighbors", "pathRoutes"].includes(material.connectionSource)) {
        err("tileSet", tileSetId, `${base}.connectionSource`, "connectionSource must be neighbors or pathRoutes.");
      }
      if (!material.signatures || typeof material.signatures !== "object" || Array.isArray(material.signatures)) {
        err("tileSet", tileSetId, `${base}.signatures`, "signatures must be an object keyed by canonical mask signature.");
        continue;
      }
      for (const [signature, rawVariants] of Object.entries(material.signatures)) {
        const variants = Array.isArray(rawVariants) ? rawVariants : [rawVariants];
        if (variants.length === 0) err("tileSet", tileSetId, `${base}.signatures.${signature}`, "A signature needs at least one sprite variant.");
        variants.forEach((variant, index) => {
          const variantPath = `${base}.signatures.${signature}[${index}]`;
          if (!variant || typeof variant !== "object" || Array.isArray(variant)) {
            err("tileSet", tileSetId, variantPath, "Variant must be an object.");
            return;
          }
          if (typeof variant.spriteId !== "string" || !visuals.sprites?.[variant.spriteId]) err("tileSet", tileSetId, `${variantPath}.spriteId`, `Variant references unknown sprite "${String(variant.spriteId)}".`);
          if (variant.weight !== undefined && (!Number.isFinite(variant.weight) || variant.weight <= 0)) err("tileSet", tileSetId, `${variantPath}.weight`, "weight must be a finite number > 0.");
          if (variant.transform !== undefined) {
            const transform = variant.transform;
            if (!transform || typeof transform !== "object" || Array.isArray(transform)) err("tileSet", tileSetId, `${variantPath}.transform`, "transform must be an object.");
            else {
              if (transform.flipX !== undefined && typeof transform.flipX !== "boolean") err("tileSet", tileSetId, `${variantPath}.transform.flipX`, "flipX must be boolean.");
              if (transform.flipY !== undefined && typeof transform.flipY !== "boolean") err("tileSet", tileSetId, `${variantPath}.transform.flipY`, "flipY must be boolean.");
              if (transform.rotate !== undefined && ![0, 90, 180, 270].includes(transform.rotate)) err("tileSet", tileSetId, `${variantPath}.transform.rotate`, "rotate must be 0, 90, 180, or 270 degrees.");
            }
          }
        });
      }
    }
  }
  const tileBindings = visuals.bindings?.tileSets ?? {};
  for (const [gridKind, tileSetId] of Object.entries(tileBindings.grids ?? {})) {
    if (!["hex", "square"].includes(gridKind)) err("visuals", "content/visuals.json", `bindings.tileSets.grids.${gridKind}`, "Grid binding key must be hex or square.");
    if (!visuals.tileSets?.[tileSetId]) err("visuals", "content/visuals.json", `bindings.tileSets.grids.${gridKind}`, `Grid binding references unknown tileset "${String(tileSetId)}".`);
  }
  for (const [mapId, tileSetId] of Object.entries(tileBindings.maps ?? {})) {
    if (!maps?.[mapId]) err("visuals", "content/visuals.json", `bindings.tileSets.maps.${mapId}`, `Map binding references unknown map "${mapId}".`);
    if (!visuals.tileSets?.[tileSetId]) err("visuals", "content/visuals.json", `bindings.tileSets.maps.${mapId}`, `Map binding references unknown tileset "${String(tileSetId)}".`);
  }

  const sounds = visuals.audio?.sounds ?? {};
  for (const [soundId, sound] of Object.entries(sounds)) {
    if (!sound || typeof sound !== "object") {
      err("visuals", soundId, `audio.sounds.${soundId}`, `Sound "${soundId}" must be an object.`);
      continue;
    }
    if (sound.src !== undefined) {
      const safeIssue = validateSafeAssetPath(sound.src, `audio.sounds.${soundId}.src`);
      if (safeIssue) err("visuals", soundId, `audio.sounds.${soundId}.src`, safeIssue);
    }
  }
  for (const [event, soundId] of Object.entries(visuals.audio?.events ?? {})) {
    if (soundId && !sounds[soundId]) {
      warn("visuals", event, `audio.events.${event}`, `Action "${event}" is bound to unknown sound "${soundId}".`);
    }
  }
  const tracks = visuals.audio?.musicTracks ?? {};
  for (const [trackId, track] of Object.entries(tracks)) {
    if (!track || typeof track !== "object") {
      err("visuals", trackId, `audio.musicTracks.${trackId}`, `Music track "${trackId}" must be an object.`);
      continue;
    }
    if (track.src !== undefined) {
      const safeIssue = validateSafeAssetPath(track.src, `audio.musicTracks.${trackId}.src`);
      if (safeIssue) err("visuals", trackId, `audio.musicTracks.${trackId}.src`, safeIssue);
    }
    if (track.volume !== undefined && (!Number.isFinite(track.volume) || track.volume < 0 || track.volume > 1)) {
      err("visuals", trackId, `audio.musicTracks.${trackId}.volume`, `Music track volume must be between 0 and 1.`);
    }
  }
  const musicByMission = visuals.audio?.musicByMission ?? {};
  if (!musicByMission || typeof musicByMission !== "object" || Array.isArray(musicByMission)) {
    err("visuals", "content/visuals.json", "audio.musicByMission", "audio.musicByMission must be an object keyed by mission id.");
  } else for (const [missionId, trackId] of Object.entries(musicByMission)) {
    if (trackId && !tracks[trackId]) warn("visuals", missionId, `audio.musicByMission.${missionId}`, `Mission "${missionId}" is bound to unknown music track "${trackId}".`);
    if (trackId && balance?.missions && !balance.missions[missionId]) warn("visuals", missionId, `audio.musicByMission.${missionId}`, `Music is bound to unknown mission "${missionId}".`);
  }
}

function validateBuildTargets(buildTargets, err) {
  if (!buildTargets || typeof buildTargets !== "object") {
    err("buildTargets", "build-targets.json", "root", "build-targets.json must be an object.");
    return;
  }
  for (const [targetId, target] of Object.entries(buildTargets.targets ?? {})) {
    if (target.platform !== "web") continue;
    const dir = target.webDir ?? "dist";
    const safeIssue = validateSafeAssetPath(dir, `targets.${targetId}.webDir`);
    if (safeIssue || dir === "." || dir === "") {
      err("buildTargets", targetId, `targets.${targetId}.webDir`, safeIssue ?? "webDir must name an output directory.");
    }
  }
}

function validateMaps(maps, err) {
  if (!maps || typeof maps !== "object") {
    err("maps", "maps/compiled/maps.json", "root", "compiled maps must be an object.");
    return;
  }
  for (const [mapId, map] of Object.entries(maps)) {
    if (!map || typeof map !== "object") {
      err("map", mapId, "root", `Map "${mapId}" must be an object.`);
      continue;
    }
    if (!Number.isSafeInteger(map.width) || map.width <= 0) err("map", mapId, "width", "Map width must be a positive safe integer.");
    if (!Number.isSafeInteger(map.height) || map.height <= 0) err("map", mapId, "height", "Map height must be a positive safe integer.");
    if (!Array.isArray(map.pathCenterline)) err("map", mapId, "pathCenterline", "pathCenterline must be an array.");
    if (!Array.isArray(map.terrainOverrides)) err("map", mapId, "terrainOverrides", "terrainOverrides must be an array.");
    const elevationDescriptor = Object.getOwnPropertyDescriptor(map, "elevationOverrides");
    if (elevationDescriptor) {
      if (!("value" in elevationDescriptor)) {
        err("map", mapId, "elevationOverrides", "elevationOverrides must be an own data property; accessors are not allowed.");
      } else {
        try {
          normalizeElevationOverrides(elevationDescriptor.value, map.width, map.height, `maps.${mapId}.elevationOverrides`);
        } catch (error) {
          err("map", mapId, "elevationOverrides", error.message);
        }
      }
    }
    if (map.grid !== undefined) {
      const validHex = map.grid?.kind === "hex" && map.grid.layout === "odd-r";
      const validSquare = map.grid?.kind === "square" && map.grid.adjacency === "cardinal";
      if (!validHex && !validSquare) err("map", mapId, "grid", "grid must be hex/odd-r or square/cardinal.");
    }
  }
}

function hasAuthoredElevation(files) {
  for (const map of Object.values(files.maps ?? {})) {
    if (map && typeof map === "object" && Object.hasOwn(map, "elevationOverrides")) return true;
  }
  for (const source of Object.values(files.mapSources ?? {})) {
    if (!source || typeof source !== "object") continue;
    if (Object.hasOwn(source, "elevationOverrides")) return true;
    if (!Array.isArray(source.properties)) continue;
    if (source.properties.some((property) => property && property.name === "elevationOverrides")) return true;
  }
  return false;
}

function validateMapSources(mapSources, err, warn) {
  for (const [sourceName, source] of Object.entries(mapSources)) {
    if (!source || typeof source !== "object") {
      err("mapSource", sourceName, "root", `Map source "${sourceName}" must be an object.`);
      continue;
    }
    if (source.orientation && !["hexagonal", "orthogonal"].includes(source.orientation)) {
      warn("mapSource", sourceName, "orientation", `Map source "${sourceName}" has unsupported orientation "${source.orientation}".`);
    }
    if (!Number.isSafeInteger(source.width) || source.width <= 0) err("mapSource", sourceName, "width", "Source width must be a positive safe integer.");
    if (!Number.isSafeInteger(source.height) || source.height <= 0) err("mapSource", sourceName, "height", "Source height must be a positive safe integer.");
  }
}

function normalizeRelativeAssetPath(value, fallback) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  let normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) normalized = fallback;
  return normalized;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}
