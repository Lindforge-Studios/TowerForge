# ADR 0045: Opt-in local ammunition

Status: Accepted

Date: 2026-07-27

Roadmap: R5.8A

## Context

Accepted R5.7A adds an optional deterministic power grid while every tower otherwise retains
infinite ammunition. The next Logistics slice must let a developer give selected fire-capable
towers a finite local magazine without silently enabling power, factories, storage, transfer,
campaign inventory, or any host-controlled refill path.

Mutable ammunition cannot be derived from placed towers alone, so unlike the power graph it needs
explicit snapshot and checkpoint state. It must still use the existing firing loop, preserve exact
cooldown semantics, and remain absent from legacy projects and ordinary tower/mission forms.

## Decision

### Scope and versioning

R5.8A extends stable module ID `logistics` to schema v2. Logistics v1 remains the exact closed
profile `{ power }`. Logistics v2 is the exact closed profile `{ power, ammunition }`; both fields
are required and nullable. Reading never migrates v1. An explicit guarded Studio/MCP promotion
writes `{ power: existingPower, ammunition: null }`, and the first ammunition save writes v2.
Downgrade through guarded authoring is rejected. Future v3+ content is opaque, lossless, read-only,
and runtime-inactive.

The non-null ammunition shape is:

```json
{
  "power": null,
  "ammunition": {
    "types": {
      "shell": { "label": "Shell" }
    },
    "towerInventories": {
      "cannon": {
        "ammoTypeId": "shell",
        "capacity": 30,
        "startingAmount": 12,
        "consumptionPerActivation": 1
      }
    }
  }
}
```

The two sections are independent. `power:null, ammunition:null` is a literal no-op. A power-only
v2 profile keeps the R5.7A grid. An ammunition-only profile has infinite legacy power and finite
magazines. A tower selected by both systems must pass both gates.

### Closed authoring contract and limits

An ammunition type is the exact object `{ label }`. A tower inventory is the exact object
`{ ammoTypeId, capacity, startingAmount, consumptionPerActivation }`.

- There are at most 256 ammunition types, 4,096 authored tower inventories, and 4,096 live
  ammunition inventories.
- IDs and labels contain 1 through 128 UTF-8 bytes.
- `capacity` is a safe integer from 1 through 1,000,000,000.
- `startingAmount` is a safe integer from 0 through `capacity`.
- `consumptionPerActivation` is a safe integer from 1 through `capacity`.
- Records normalize in binary ID order. Unknown/inherited/symbol/accessor fields, hostile
  prototypes, sparse containers, non-finite values, unsafe integers, and over-budget inputs fail
  closed.

Every tower inventory references an authored ammunition type and an existing fire-capable tower
attack: `single`, `pulse`, `sniper`, `antiair`, `splash`, or `pipeline`. `support` and
`support_buff` are invalid. Structural errors remain errors for disabled/unselected profiles;
broken references and incompatible attack kinds are active errors and inactive warnings.

An ammunition binding is independent of the mutually exclusive power roles. The same tower type
may be a generator, relay, or power consumer and also consume ammunition.

### Activation and cooldown semantics

The engine evaluates a tower in this fixed order:

1. existing `disabledFor` handling;
2. power gate for a power consumer;
3. ammunition gate for an ammo-bound tower;
4. cooldown decrement;
5. target selection;
6. atomic ammunition consumption;
7. existing event/effect/damage/status/cooldown behavior.

If `amount < consumptionPerActivation`, the exact cooldown is frozen, including zero or a negative
catch-up value. The tower does not select targets, spend ammunition, emit firing/pulse events, or
apply damage, status, displacement, resources, pipeline effects, or secondary effects. No target
means no ammunition spend and retains the existing no-target cooldown behavior.

Consumption happens once per successful attack activation, not per affected target/effect:

- one primary single/sniper/splash shot; single-chain hops and splash targets are free;
- one pulse, regardless of target count;
- one antiair volley, regardless of target count;
- one pipeline activation, regardless of delivery targets and effects.

Every catch-up activation rechecks and consumes ammunition independently. Exhaustion between two
activations stops the loop without another cooldown increment. An unpowered tower does not consume
ammunition. A depleted power consumer still contributes demand; a depleted generator/relay still
supplies/links power but cannot perform its own ammo-bound attack. A depleted or unpowered pulse is
not an active pulse field, so an existing DoT continues its ordinary decay.

Move and upgrade retain exact amount; upgrade does not resize/refill. Sell/destruction removes the
inventory without refund/drop. Failed placement creates no state. Reset removes all inventories;
new placement receives `startingAmount`. Artifacts, draft cards, synergies, hero auras, modifiers,
profiles, and campaign state do not change ammunition.

### Deliberate no-refill boundary

R5.8A exposes no refill command, runtime API, TowerScript action, loot, factory, storage, production,
conveyor, or transfer graph. A depleted tower instance stays depleted for its remaining live run.
The same-instance refill-to-resume contract belongs to R5.8B, which must preserve the gate order,
one-consumption-per-activation rule, and exact cooldown freeze established here.

### Checkpoint and digest

Active non-null ammunition adds optional nested capability state:

```text
{
  schemaVersion: 1,
  ammunition: {
    inventories: [{ towerId, amount }]
  }
}
```

`GameCheckpointStateV1` gains optional `logistics`. The section is required for active v2
ammunition, even with an empty array, and forbidden for legacy, v1, and v2 `ammunition:null`.
There is exactly one binary-sorted row for each live ammo-bound tower and no missing, duplicate,
extra, destroyed, or downed reference. `amount` is a safe integer from zero through the authored
`startingAmount` in this no-refill slice. Restore validates the entire candidate before state
adoption. Ammunition participates in the stable digest; snapshot reads mutate neither state,
events, nor RNG.

The outer `GameCheckpointV1`, `towerforge-sim-v2`, `GameCommandV6`, journal v6, RNG v1, project v3,
profile v3, `CampaignRunV1`, and TowerScript v6 versions remain unchanged.

### Snapshot and presentation

Logistics v1 snapshot remains byte-compatible. Active v2 publishes:

```text
{
  schemaVersion: 2,
  power: LogisticsSnapshotV1.power | null,
  ammunition: {
    inventories: [{
      towerId, towerTypeId, ammoTypeId,
      amount, capacity, consumptionPerActivation, hasRequiredAmmo
    }]
  } | null
}
```

If both v2 sections are null, `snapshot.logistics` is absent. Arrays are dense, bounded,
binary-sorted, detached, and frozen. The engine alone derives `hasRequiredAmmo`. The shared
renderer validates the authoritative projection and never derives ammunition, power topology, or
combined operational state. Studio Playtest and generated Canvas/Phaser players show equal
amount/capacity and depleted cues on square and hex, alongside independent brownout cues. No new
input command is added.

### Constructor and agent authoring

Mechanics Hub keeps ammunition inside the separate Logistics card. It opens v1 without migration;
the explicit Add ammunition action promotes the whole module to v2, then offers ammunition-type and
tower-inventory CRUD. Ordinary tower, mission, and map editors stay unchanged.

MCP/AI descriptors publish supported versions `[1,2]`, exact fields/limits, nested checkpoint state,
and activation semantics. The standard guarded
`describe -> capabilities -> recipe -> preview -> guarded apply -> validate` transaction retains
revision, validation, backup, and rollback. No refill tool is exposed.

The inert `basic_local_ammunition` recipe requires exact parameters
`consumerTowerTypeId`, `ammoTypeId`, `ammoLabel`, `capacity`, `startingAmount`, and
`consumptionPerActivation`. It produces a v2 profile with `power:null`; it never enables/selects the
module, creates a tower, changes an attack, adds a script, or creates supply infrastructure.

## Compatibility and exclusions

- Absent/disabled/unselected Logistics, v1, and v2 `ammunition:null` allocate no inventory, alter no
  firing branch, add no checkpoint/snapshot state, and keep infinite ammunition.
- Power-only v1 behavior, topology bounds, snapshot, and checkpoint derivation remain unchanged.
- R5.8A has no refill, factory, production recipe, storage, conveyor, transfer graph, loot,
  magazine swapping, reload timer, projectile entity, alternate ammo, UI command, TowerScript,
  campaign/profile persistence, multiplayer ownership, or Director behavior.

## Required RED and acceptance plan

1. Content RED: v1/v2 exactness, explicit promotion, nullable combinations, limits, hostile data,
   references, inactive warnings, v3 fail-close, and capability availability without synthesis.
2. Runtime RED: all six attack kinds, exactly one spend per activation, free secondary targets,
   no-target no-spend, catch-up exhaustion, exact freeze, no events/effects, and pulse/DoT.
3. Interaction/lifecycle RED: power × ammunition matrix, generator/relay attacks, demand stability,
   placement transaction/limit, move, upgrade, sell, destroy, hp=0, reset, and failed actions.
4. Checkpoint RED: required/forbidden section, exact rows/order/bounds, malformed/duplicate/missing
   references, amount above starting, continuous/restore/journal digest equivalence, and read purity.
5. Surface RED: explicit Studio promotion and CRUD lifecycle, inert recipe, guarded MCP flow,
   stale/rollback, future v3 read-only, strict shared projector, and no ordinary-form pollution.
6. Player/package RED: Canvas/Phaser × square/hex, independent depletion/brownout cues, four
   templates, PWA/single-file/web/`.tdpack`, and literal legacy absence.

Acceptance requires typecheck, engine build, full unit/property/determinism/golden tests, validation,
tutorial simulation, balance, map compile, web build, full browser E2E, and plugin build/validate/
smoke. The implementation author cannot be either independent Code Verifier or Constructor
Integration Verifier.

## Deferred R5.8B contract

R5.8B separately advances Logistics to v3 with factories/producers, production recipes, storage,
a bounded deterministic transfer graph, same-instance refill, dirty rebuild/ordering, supply
overlays, and nested Logistics checkpoint v2. It must not alter R5.8A activation cost or gate order.

## Acceptance evidence

Independent RED waves first produced 54 content, 39 runtime, and 23 surface failures while legacy
fixtures stayed executable. Contract reconciliation preserved the established global tick clamp,
Logistics v1 descriptor view, and optional checkpoint typing without changing runtime semantics.

The independent Code Verifier found three edge classes after initial GREEN. Separate regression
waves proved and closed all of them: every catch-up activation now gates ammunition before target
acquisition; absent/v1/null paths invoke neither gate nor spend helpers; and legal authored IDs such
as `constructor` and `toString` are resolved only through own properties. The final verifier rerun
covered 445 engine/renderer and 30 constructor contracts with no remaining P0–P3. The independent
Constructor Integration Verifier covered 65 authoring/package contracts, 171 engine compatibility
contracts, and all five Logistics Playwright scenarios, also with no P0–P3.

Final repository gates passed: Vitest 2,651/2,651 in 222 files; Playwright 117/117; typecheck,
engine build, project validation, tutorial simulation, balance, map compile, web build, and plugin
build/validate/smoke. The copyable opt-in fixture is
`docs/examples/opt-in-local-ammunition/`.
