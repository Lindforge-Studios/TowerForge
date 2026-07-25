import { TOWER_SCRIPT_ACTION_SCHEMA, TOWER_SCRIPT_EVENTS, TOWER_SCRIPT_LIMITS, TOWER_SCRIPT_OPERATORS, TOWER_SCRIPT_SCOPES, TOWER_SCRIPT_TARGETS } from "./schema-descriptor.js";
import { TERRAFORMING_LIMITS } from "../content/terraforming-mechanics.js";
const SCOPES = new Set(TOWER_SCRIPT_SCOPES);
const EVENTS = new Set(TOWER_SCRIPT_EVENTS);
const OPERATORS = new Set(TOWER_SCRIPT_OPERATORS);
const TARGETS = new Set(TOWER_SCRIPT_TARGETS.entity);
const ENEMY_TARGETS = new Set(TOWER_SCRIPT_TARGETS.enemy);
const TOWER_TARGETS = new Set(TOWER_SCRIPT_TARGETS.tower);
const ACTIONS = new Set(Object.keys(TOWER_SCRIPT_ACTION_SCHEMA));
const ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
function utf8ByteLength(value) {
    let bytes = 0;
    for (const character of value) {
        const point = character.codePointAt(0);
        bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    }
    return bytes;
}
export function validateTowerScriptDefinitions(scripts, refs = {}) {
    const issues = [];
    const report = (scriptId, fieldPath, message) => issues.push({ scriptId, fieldPath, message });
    if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
        return [{ scriptId: "?", fieldPath: "root", message: "scripts must be an object keyed by script id." }];
    }
    if (Object.keys(scripts).length > TOWER_SCRIPT_LIMITS.scriptsPerProject)
        report("?", "root", `A project may define at most ${TOWER_SCRIPT_LIMITS.scriptsPerProject} TowerScripts.`);
    for (const [key, script] of Object.entries(scripts))
        validateScript(key, script, refs, report);
    return issues;
}
function validateScript(key, script, refs, report) {
    const scriptId = typeof script?.id === "string" ? script.id : key;
    if (!script || typeof script !== "object" || Array.isArray(script)) {
        report(key, "root", "TowerScript must be an object.");
        return;
    }
    if (script.schemaVersion !== 1 && script.schemaVersion !== 2 && script.schemaVersion !== 3 && script.schemaVersion !== 4 && script.schemaVersion !== 5 && script.schemaVersion !== 6) {
        report(scriptId, "schemaVersion", "TowerScript schemaVersion must be 1, 2, 3, 4, 5, or 6.");
    }
    if (!ID_RE.test(scriptId))
        report(scriptId, "id", "Script id must use letters, digits, underscore, dot, or hyphen.");
    if (script.id !== key)
        report(scriptId, "id", `Script key "${key}" must match id "${script.id}".`);
    if (script.enabled !== undefined && typeof script.enabled !== "boolean")
        report(scriptId, "enabled", "enabled must be boolean.");
    if (!Array.isArray(script.bindings) || script.bindings.length === 0)
        report(scriptId, "bindings", "At least one binding is required.");
    else
        script.bindings.forEach((binding, index) => validateBinding(scriptId, binding, index, refs, report));
    if (script.initialState !== undefined) {
        if (!script.initialState || typeof script.initialState !== "object" || Array.isArray(script.initialState))
            report(scriptId, "initialState", "initialState must be an object.");
        else {
            const encoded = JSON.stringify(script.initialState);
            if (encoded.length > TOWER_SCRIPT_LIMITS.initialStateBytes)
                report(scriptId, "initialState", "initialState exceeds the 16 KiB limit.");
            for (const keyName of Object.keys(script.initialState))
                if (!ID_RE.test(keyName))
                    report(scriptId, `initialState.${keyName}`, "State keys must be safe identifiers.");
        }
    }
    if (!script.handlers || typeof script.handlers !== "object" || Array.isArray(script.handlers)) {
        report(scriptId, "handlers", "handlers must be an object keyed by lifecycle event.");
        return;
    }
    for (const [event, handlers] of Object.entries(script.handlers)) {
        if (!EVENTS.has(event)) {
            report(scriptId, `handlers.${event}`, `Unknown TowerScript event "${event}".`);
            continue;
        }
        if ((event === "enemyShieldChanged" || event === "towerShieldChanged")
            && script.schemaVersion !== 3
            && script.schemaVersion !== 4
            && script.schemaVersion !== 5
            && script.schemaVersion !== 6) {
            report(scriptId, `handlers.${event}`, `TowerScript event "${event}" requires schemaVersion 3.`);
        }
        if (event === "enemyMarkChanged" && script.schemaVersion !== 4 && script.schemaVersion !== 5 && script.schemaVersion !== 6) {
            report(scriptId, `handlers.${event}`, `TowerScript event "${event}" requires schemaVersion 4.`);
        }
        if ((event === "enemyExposureChanged" || event === "enemyReactionTriggered") && script.schemaVersion !== 5 && script.schemaVersion !== 6) {
            report(scriptId, `handlers.${event}`, `TowerScript event "${event}" requires schemaVersion 5.`);
        }
        if (event === "elevationChanged" && script.schemaVersion !== 6) {
            report(scriptId, `handlers.${event}`, `TowerScript event "${event}" requires schemaVersion 6.`);
        }
        if (!Array.isArray(handlers) || handlers.length === 0) {
            report(scriptId, `handlers.${event}`, "An event needs at least one handler.");
            continue;
        }
        if (handlers.length > TOWER_SCRIPT_LIMITS.handlersPerEvent)
            report(scriptId, `handlers.${event}`, `An event may define at most ${TOWER_SCRIPT_LIMITS.handlersPerEvent} handlers.`);
        handlers.forEach((handler, index) => {
            const base = `handlers.${event}[${index}]`;
            if (!handler || typeof handler !== "object" || Array.isArray(handler)) {
                report(scriptId, base, "Handler must be an object.");
                return;
            }
            if (handler.id !== undefined && (typeof handler.id !== "string" || !ID_RE.test(handler.id)))
                report(scriptId, `${base}.id`, "Handler id must be a safe identifier.");
            if (handler.every !== undefined && (event !== "tick" || typeof handler.every !== "number" || !Number.isFinite(handler.every) || handler.every <= 0)) {
                report(scriptId, `${base}.every`, "every is only valid for tick handlers and must be > 0.");
            }
            if (handler.when !== undefined)
                validateExpression(scriptId, `${base}.when`, handler.when, 0, report);
            if (!Array.isArray(handler.actions) || handler.actions.length === 0)
                report(scriptId, `${base}.actions`, "Handler needs at least one action.");
            else {
                if (handler.actions.length > TOWER_SCRIPT_LIMITS.actionsPerHandler)
                    report(scriptId, `${base}.actions`, `A handler may define at most ${TOWER_SCRIPT_LIMITS.actionsPerHandler} actions.`);
                // The v5 reaction event already rejects the whole handler on older schemas. Avoid a
                // redundant nested version diagnostic while retaining all shape/reference checks.
                const actionSchemaVersion = event === "enemyReactionTriggered" && script.schemaVersion !== 5 && script.schemaVersion !== 6
                    ? 5
                    : script.schemaVersion;
                handler.actions.forEach((action, actionIndex) => validateAction(scriptId, `${base}.actions[${actionIndex}]`, action, actionSchemaVersion, refs, report));
            }
        });
    }
}
function validateBinding(scriptId, binding, index, refs, report) {
    const base = `bindings[${index}]`;
    if (!binding || typeof binding !== "object" || Array.isArray(binding) || !SCOPES.has(binding.scope)) {
        report(scriptId, base, "Binding needs a supported scope.");
        return;
    }
    if (binding.scope === "global" && binding.ids !== undefined)
        report(scriptId, `${base}.ids`, "global binding does not accept ids.");
    if (binding.ids !== undefined && (!Array.isArray(binding.ids) || binding.ids.length === 0 || binding.ids.some((id) => typeof id !== "string" || !ID_RE.test(id)))) {
        report(scriptId, `${base}.ids`, "ids must be a non-empty array of safe ids.");
        return;
    }
    const sets = {
        mission: refs.missionIds,
        map: refs.mapIds,
        wave: refs.waveSetIds,
        tower: refs.towerIds,
        enemy: refs.enemyIds,
        ability: refs.abilityIds,
        terrain: refs.terrainIds
    };
    for (const id of binding.ids ?? [])
        if (sets[binding.scope] && !sets[binding.scope].has(id))
            report(scriptId, `${base}.ids`, `Unknown ${binding.scope} id "${id}".`);
}
function validateAction(scriptId, path, action, schemaVersion, refs, report) {
    if (!action || typeof action !== "object" || Array.isArray(action)) {
        report(scriptId, path, "TowerScript action must be an object with own data fields.");
        return;
    }
    let descriptors;
    let actionPrototype;
    try {
        actionPrototype = Object.getPrototypeOf(action);
        descriptors = Object.getOwnPropertyDescriptors(action);
    }
    catch {
        report(scriptId, path, "TowerScript action fields could not be inspected safely.");
        return;
    }
    const detachedAction = Object.create(null);
    let invalidDataField = false;
    for (const field of Reflect.ownKeys(descriptors)) {
        const descriptor = descriptors[field];
        if (typeof field === "symbol") {
            report(scriptId, path, "TowerScript action must not contain symbol fields.");
            invalidDataField = true;
            continue;
        }
        if (!descriptor?.enumerable || !("value" in descriptor)) {
            report(scriptId, `${path}.${field}`, `TowerScript action field "${field}" must be an enumerable own data field.`);
            invalidDataField = true;
            continue;
        }
        Object.defineProperty(detachedAction, field, { value: descriptor.value, enumerable: true });
    }
    if (invalidDataField)
        return;
    action = detachedAction;
    if (typeof action.action !== "string" || !ACTIONS.has(action.action)) {
        report(scriptId, path, `Unknown TowerScript action "${String(action.action)}".`);
        return;
    }
    if (action.action === "terraformTiles" && actionPrototype !== Object.prototype) {
        report(scriptId, path, "TowerScript action \"terraformTiles\" must be a plain object with enumerable own data fields.");
        return;
    }
    if ((action.action === "restoreEnemyShield" || action.action === "restoreTowerShield")
        && schemaVersion !== 3
        && schemaVersion !== 4
        && schemaVersion !== 5
        && schemaVersion !== 6) {
        report(scriptId, `${path}.action`, `TowerScript action "${action.action}" requires schemaVersion 3.`);
    }
    if ((action.action === "applyEnemyMark" || action.action === "clearEnemyMark") && schemaVersion !== 4 && schemaVersion !== 5 && schemaVersion !== 6) {
        report(scriptId, `${path}.action`, `TowerScript action "${action.action}" requires schemaVersion 4.`);
    }
    if ((action.action === "applyEnemyExposure" || action.action === "clearEnemyExposure") && schemaVersion !== 5 && schemaVersion !== 6) {
        report(scriptId, `${path}.action`, `TowerScript action "${action.action}" requires schemaVersion 5.`);
    }
    if (action.action === "terraformTiles" && schemaVersion !== 6) {
        report(scriptId, `${path}.action`, "TowerScript action \"terraformTiles\" requires schemaVersion 6.");
    }
    if ((action.action === "restoreEnemyShield" || action.action === "restoreTowerShield")
        && (!Object.hasOwn(action, "amount") || action.amount === undefined)) {
        report(scriptId, `${path}.amount`, `TowerScript action "${action.action}" requires an amount expression.`);
    }
    const expressionFields = ["amount", "value", "count", "pathProgress", "payload", "duration", "stacks"];
    for (const field of expressionFields) {
        if (!Object.hasOwn(action, field))
            continue;
        const expression = action[field];
        if (expression === undefined) {
            if (action.action === "terraformTiles" && field === "duration") {
                report(scriptId, `${path}.duration`, "terraformTiles duration must be a defined expression when present.");
            }
            continue;
        }
        validateExpression(scriptId, `${path}.${field}`, expression, 0, report);
    }
    if (["damageEnemy", "healEnemy", "restoreEnemyShield", "restoreTowerShield", "applyEnemyMark", "clearEnemyMark", "applyEnemyExposure", "clearEnemyExposure", "applyStatus", "setTowerCooldown", "addTowerStacks"].includes(action.action) && !TARGETS.has(action.target))
        report(scriptId, `${path}.target`, "Action needs a supported entity target.");
    if (["damageEnemy", "healEnemy", "restoreEnemyShield", "applyEnemyMark", "clearEnemyMark", "applyEnemyExposure", "clearEnemyExposure", "applyStatus"].includes(action.action) && !ENEMY_TARGETS.has(action.target))
        report(scriptId, `${path}.target`, "Enemy actions require self, eventEnemy, or allEnemies.");
    if (["restoreTowerShield", "setTowerCooldown", "addTowerStacks"].includes(action.action) && !TOWER_TARGETS.has(action.target))
        report(scriptId, `${path}.target`, "Tower actions require self, eventTower, or allTowers.");
    if (action.action === "applyStatus")
        validateStatus(scriptId, `${path}.status`, action.status, report);
    if (["setState", "incrementState"].includes(action.action) && !ID_RE.test(action.key ?? ""))
        report(scriptId, `${path}.key`, "State key must be a safe identifier.");
    if (action.action === "emitSignal" && !ID_RE.test(action.signal ?? ""))
        report(scriptId, `${path}.signal`, "Signal must be a safe identifier.");
    if (action.action === "grantResource" && refs.currencyIds && !refs.currencyIds.has(action.resourceId))
        report(scriptId, `${path}.resourceId`, `Unknown currency "${action.resourceId}".`);
    if (action.action === "spawnEnemy" && refs.enemyIds && !refs.enemyIds.has(action.enemyTypeId))
        report(scriptId, `${path}.enemyTypeId`, `Unknown enemy "${action.enemyTypeId}".`);
    if (action.action === "applyEnemyMark" || action.action === "clearEnemyMark") {
        const markAction = action;
        if (typeof markAction.markId !== "string" || !ID_RE.test(markAction.markId)) {
            report(scriptId, `${path}.markId`, `TowerScript action "${action.action}" requires a safe markId.`);
        }
        else if (refs.markIds && !refs.markIds.has(markAction.markId)) {
            report(scriptId, `${path}.markId`, `Unknown mark "${markAction.markId}".`);
        }
        const allowedFields = action.action === "applyEnemyMark"
            ? new Set(["action", "target", "markId", "stacks"])
            : new Set(["action", "target", "markId"]);
        for (const field of Object.keys(action)) {
            if (!allowedFields.has(field)) {
                report(scriptId, `${path}.${field}`, `TowerScript action "${action.action}" does not allow field "${field}".`);
            }
        }
    }
    if (action.action === "applyEnemyExposure" || action.action === "clearEnemyExposure") {
        const exposureAction = action;
        if (typeof exposureAction.exposureId !== "string" || !ID_RE.test(exposureAction.exposureId)) {
            report(scriptId, `${path}.exposureId`, `TowerScript action "${action.action}" requires a safe exposureId.`);
        }
        else if (refs.exposureIds && !refs.exposureIds.has(exposureAction.exposureId)) {
            report(scriptId, `${path}.exposureId`, `Unknown exposure "${exposureAction.exposureId}".`);
        }
        const allowedFields = action.action === "applyEnemyExposure"
            ? new Set(["action", "target", "exposureId", "stacks"])
            : new Set(["action", "target", "exposureId"]);
        for (const field of Object.keys(action)) {
            if (!allowedFields.has(field))
                report(scriptId, `${path}.${field}`, `TowerScript action "${action.action}" does not allow field "${field}".`);
        }
    }
    if (action.action === "setTileTerrain" || action.action === "restoreTileTerrain") {
        validateTileTarget(scriptId, `${path}.target`, action.target, report);
    }
    if (action.action === "setTileTerrain" && refs.terrainIds && !refs.terrainIds.has(action.terrainId)) {
        report(scriptId, `${path}.terrainId`, `Unknown terrain "${action.terrainId}".`);
    }
    if (action.action === "terraformTiles") {
        validateTerraformTilesAction(scriptId, path, action, refs, report);
    }
}
function validateTerraformTilesAction(scriptId, path, action, refs, report) {
    for (const field of Object.keys(action)) {
        if (field !== "action" && field !== "operations" && field !== "duration") {
            report(scriptId, `${path}.${field}`, `TowerScript action "terraformTiles" is closed and does not allow field "${field}".`);
        }
    }
    const value = action.operations;
    let prototype;
    let descriptors;
    try {
        prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
        descriptors = value !== null && typeof value === "object"
            ? Object.getOwnPropertyDescriptors(value)
            : {};
    }
    catch {
        report(scriptId, `${path}.operations`, "Terraform operations could not be inspected safely.");
        return;
    }
    if (!Array.isArray(value) || prototype !== Array.prototype) {
        report(scriptId, `${path}.operations`, "Terraform operations must be an ordinary dense own-data array.");
        return;
    }
    const length = descriptors.length && "value" in descriptors.length ? descriptors.length.value : undefined;
    if (!Number.isSafeInteger(length) || length < 1 || length > TOWER_SCRIPT_LIMITS.terrainChangesPerTransaction) {
        report(scriptId, `${path}.operations`, `terraformTiles operations must contain 1..${TOWER_SCRIPT_LIMITS.terrainChangesPerTransaction} entries.`);
        return;
    }
    if (Reflect.ownKeys(descriptors).some((key) => {
        if (key === "length")
            return false;
        return typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length;
    })) {
        report(scriptId, `${path}.operations`, "Terraform operations must be dense own data without extra fields.");
        return;
    }
    let allSetOperations = true;
    for (let index = 0; index < length; index += 1) {
        const itemPath = `${path}.operations[${index}]`;
        const descriptor = descriptors[String(index)];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
            report(scriptId, `${path}.operations`, "Terraform operations must be dense; sparse entries and accessors are not allowed.");
            continue;
        }
        const kind = validateTerraformOperation(scriptId, itemPath, descriptor.value, refs, report);
        if (kind !== "set_terrain" && kind !== "set_elevation")
            allSetOperations = false;
    }
    if (Object.prototype.hasOwnProperty.call(action, "duration") && !allSetOperations) {
        report(scriptId, `${path}.duration`, "terraformTiles duration is allowed only when all operations are set operations.");
    }
}
function validateTerraformOperation(scriptId, path, value, refs, report) {
    let prototype;
    let descriptors;
    try {
        prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
        descriptors = value !== null && typeof value === "object"
            ? Object.getOwnPropertyDescriptors(value)
            : {};
    }
    catch {
        report(scriptId, path, "Terraform operation could not be inspected safely.");
        return undefined;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value) || prototype !== Object.prototype) {
        report(scriptId, path, "Terraform operation must be a plain object with enumerable own data fields.");
        return undefined;
    }
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        report(scriptId, path, "Terraform operation must not contain symbol fields.");
        return undefined;
    }
    const operation = Object.create(null);
    let safe = true;
    for (const field of Object.keys(descriptors)) {
        const descriptor = descriptors[field];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
            report(scriptId, `${path}.${field}`, `Terraform operation field "${field}" must be an enumerable own data field; accessors are not allowed.`);
            safe = false;
            continue;
        }
        Object.defineProperty(operation, field, { value: descriptor.value, enumerable: true });
    }
    if (!safe)
        return undefined;
    const kind = operation.kind;
    const allowedByKind = {
        set_terrain: ["kind", "target", "transitionId"],
        restore_terrain: ["kind", "target"],
        set_elevation: ["kind", "target", "elevation"],
        restore_elevation: ["kind", "target"]
    };
    if (typeof kind !== "string" || !Object.prototype.hasOwnProperty.call(allowedByKind, kind)) {
        report(scriptId, `${path}.kind`, `Unknown terraform operation kind "${String(kind)}".`);
        return undefined;
    }
    const typedKind = kind;
    const allowed = allowedByKind[typedKind];
    for (const field of Object.keys(operation)) {
        if (!allowed.includes(field)) {
            report(scriptId, `${path}.${field}`, `Terraform operation "${typedKind}" is closed; unknown field "${field}" is not allowed.`);
        }
    }
    for (const field of allowed) {
        if (!Object.prototype.hasOwnProperty.call(operation, field)) {
            report(scriptId, `${path}.${field}`, `Terraform operation "${typedKind}" requires field "${field}".`);
        }
    }
    if (Object.prototype.hasOwnProperty.call(operation, "target")) {
        validateTerraformTileTarget(scriptId, `${path}.target`, operation.target, report);
    }
    if (typedKind === "set_terrain") {
        const transitionId = operation.transitionId;
        if (typeof transitionId !== "string" || transitionId.length === 0
            || utf8ByteLength(transitionId) > TERRAFORMING_LIMITS.idOrTagUtf8Bytes) {
            report(scriptId, `${path}.transitionId`, `set_terrain transitionId must contain 1..${TERRAFORMING_LIMITS.idOrTagUtf8Bytes} UTF-8 bytes.`);
        }
        else if (refs.terraformingTransitionIds && !refs.terraformingTransitionIds.has(transitionId)) {
            report(scriptId, `${path}.transitionId`, `Unknown terraforming transition "${transitionId}".`);
        }
    }
    if (typedKind === "set_elevation" && Object.prototype.hasOwnProperty.call(operation, "elevation")) {
        validateExpression(scriptId, `${path}.elevation`, operation.elevation, 0, report);
    }
    return typedKind;
}
function validateTerraformTileTarget(scriptId, path, target, report) {
    if (target === "eventTile")
        return;
    let prototype;
    let descriptors;
    try {
        prototype = target !== null && typeof target === "object" ? Object.getPrototypeOf(target) : null;
        descriptors = target !== null && typeof target === "object"
            ? Object.getOwnPropertyDescriptors(target)
            : {};
    }
    catch {
        report(scriptId, path, "Terraform tile target could not be inspected safely.");
        return;
    }
    if (target === null || typeof target !== "object" || Array.isArray(target) || prototype !== Object.prototype) {
        report(scriptId, path, 'Terraform tile target must be "eventTile" or a plain {q, r} own-data object.');
        return;
    }
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        report(scriptId, path, "Terraform tile target must not contain symbol fields.");
    }
    const allowed = new Set(["q", "r"]);
    for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!allowed.has(key)) {
            report(scriptId, `${path}.${key}`, `Terraform tile target is closed; unknown field "${key}" is not allowed.`);
            continue;
        }
        if (!descriptor?.enumerable || !("value" in descriptor)) {
            report(scriptId, `${path}.${key}`, `Terraform tile target field "${key}" must be an enumerable own data field; accessors are not allowed.`);
        }
    }
    for (const field of ["q", "r"]) {
        const descriptor = descriptors[field];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
            if (!descriptor)
                report(scriptId, `${path}.${field}`, `Terraform tile target requires field "${field}".`);
            continue;
        }
        validateExpression(scriptId, `${path}.${field}`, descriptor.value, 0, report);
    }
}
function validateTileTarget(scriptId, path, target, report) {
    if (target === "eventTile")
        return;
    if (!target || typeof target !== "object" || Array.isArray(target)) {
        report(scriptId, path, 'Tile target must be "eventTile" or {q, r} expressions.');
        return;
    }
    const coord = target;
    if (coord.q === undefined || coord.r === undefined) {
        report(scriptId, path, "Tile target needs q and r expressions.");
        return;
    }
    validateExpression(scriptId, `${path}.q`, coord.q, 0, report);
    validateExpression(scriptId, `${path}.r`, coord.r, 0, report);
}
function validateStatus(scriptId, path, status, report) {
    if (!status || typeof status !== "object" || Array.isArray(status)) {
        report(scriptId, path, "Status must be an object.");
        return;
    }
    const value = status;
    if (value.stun === undefined && value.slow === undefined && value.poison === undefined)
        report(scriptId, path, "Status needs stun, slow, or poison.");
    if (value.stun !== undefined && !positiveFinite(value.stun))
        report(scriptId, `${path}.stun`, "stun must be a finite number > 0.");
    if (value.slow !== undefined) {
        if (!value.slow || typeof value.slow !== "object" || Array.isArray(value.slow))
            report(scriptId, `${path}.slow`, "slow must be an object.");
        else {
            const slow = value.slow;
            if (!positiveFinite(slow.factor) || slow.factor >= 1)
                report(scriptId, `${path}.slow.factor`, "slow.factor must be > 0 and < 1.");
            if (!positiveFinite(slow.duration))
                report(scriptId, `${path}.slow.duration`, "slow.duration must be a finite number > 0.");
        }
    }
    if (value.poison !== undefined) {
        if (!value.poison || typeof value.poison !== "object" || Array.isArray(value.poison))
            report(scriptId, `${path}.poison`, "poison must be an object.");
        else {
            const poison = value.poison;
            if (!positiveFinite(poison.dps))
                report(scriptId, `${path}.poison.dps`, "poison.dps must be a finite number > 0.");
            if (!positiveFinite(poison.duration))
                report(scriptId, `${path}.poison.duration`, "poison.duration must be a finite number > 0.");
        }
    }
    if (value.slowAffectsClasses !== undefined && (!Array.isArray(value.slowAffectsClasses) || value.slowAffectsClasses.length === 0 || value.slowAffectsClasses.some((item) => item !== "ground" && item !== "flying"))) {
        report(scriptId, `${path}.slowAffectsClasses`, "slowAffectsClasses must contain ground and/or flying.");
    }
}
function positiveFinite(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}
function validateExpression(scriptId, path, expression, depth, report) {
    if (depth > TOWER_SCRIPT_LIMITS.expressionDepth) {
        report(scriptId, path, `Expression nesting exceeds ${TOWER_SCRIPT_LIMITS.expressionDepth} levels.`);
        return;
    }
    if (expression === null || typeof expression === "string" || typeof expression === "boolean")
        return;
    if (typeof expression === "number") {
        if (!Number.isFinite(expression))
            report(scriptId, path, "Expression numbers must be finite.");
        return;
    }
    if (!expression || typeof expression !== "object") {
        report(scriptId, path, "Expression must be JSON-compatible.");
        return;
    }
    let prototype;
    let descriptors;
    try {
        prototype = Object.getPrototypeOf(expression);
        descriptors = Object.getOwnPropertyDescriptors(expression);
    }
    catch {
        report(scriptId, path, "Expression could not be inspected safely as own data.");
        return;
    }
    if (Array.isArray(expression)) {
        if (prototype !== Array.prototype) {
            report(scriptId, path, "Expression arrays must be ordinary dense own-data arrays.");
            return;
        }
        const length = descriptors.length && "value" in descriptors.length ? descriptors.length.value : undefined;
        if (!Number.isSafeInteger(length) || length < 0) {
            report(scriptId, path, "Expression array must expose a safe dense length.");
            return;
        }
        const descriptorKeys = Reflect.ownKeys(descriptors);
        if (descriptorKeys.some((key) => {
            if (key === "length")
                return false;
            return typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length;
        })) {
            report(scriptId, path, "Expression array must be dense own data without extra fields.");
            return;
        }
        if (descriptorKeys.length - 1 !== length) {
            report(scriptId, path, "Expression array must be dense; sparse entries are not allowed.");
            return;
        }
        for (let index = 0; index < length; index += 1) {
            const descriptor = descriptors[String(index)];
            if (!descriptor?.enumerable || !("value" in descriptor)) {
                report(scriptId, `${path}[${index}]`, "Expression array entries must be enumerable own data; sparse entries and accessors are not allowed.");
                continue;
            }
            validateExpression(scriptId, `${path}[${index}]`, descriptor.value, depth + 1, report);
        }
        return;
    }
    if (prototype !== Object.prototype && prototype !== null) {
        report(scriptId, path, "Expression objects must be plain own-data records.");
        return;
    }
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        report(scriptId, path, "Expression objects must not contain symbol fields.");
    }
    const fields = Object.create(null);
    let safe = true;
    for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
            report(scriptId, `${path}.${key}`, `Expression field "${key}" must be an enumerable own data field; accessors are not allowed.`);
            safe = false;
            continue;
        }
        Object.defineProperty(fields, key, { value: descriptor.value, enumerable: true });
    }
    if (!safe)
        return;
    const keys = Object.keys(fields);
    if (Object.prototype.hasOwnProperty.call(fields, "$get")) {
        for (const key of keys) {
            if (key !== "$get")
                report(scriptId, `${path}.${key}`, `$get expression is closed and does not allow field "${key}".`);
        }
        const value = fields.$get;
        if (typeof value !== "string" || !value || value.split(".").some((segment) => (!segment || ["__proto__", "prototype", "constructor"].includes(segment)))) {
            report(scriptId, `${path}.$get`, "$get needs a safe context path.");
        }
        return;
    }
    if (Object.prototype.hasOwnProperty.call(fields, "$op")) {
        for (const key of keys) {
            if (key !== "$op" && key !== "args")
                report(scriptId, `${path}.${key}`, `$op expression is closed and does not allow field "${key}".`);
        }
        const op = fields.$op;
        const args = fields.args;
        if (typeof op !== "string" || !OPERATORS.has(op)) {
            report(scriptId, `${path}.$op`, "Unsupported expression operator.");
        }
        if (!Array.isArray(args)) {
            report(scriptId, `${path}.args`, "Operator args must be an array.");
        }
        else {
            // The args container does not add an expression level; each operand does, matching
            // the legacy recursive depth contract while retaining descriptor-safe array inspection.
            validateExpression(scriptId, `${path}.args`, args, depth, report);
        }
        return;
    }
    for (const key of keys) {
        if (["__proto__", "prototype", "constructor"].includes(key)) {
            report(scriptId, `${path}.${key}`, "Unsafe expression key.");
        }
        else {
            validateExpression(scriptId, `${path}.${key}`, fields[key], depth + 1, report);
        }
    }
}
