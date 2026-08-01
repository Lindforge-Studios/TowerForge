# ADR 0056: Opt-in Deterministic Macro-Economy

- Status: Accepted
- Date: 2026-08-01
- Milestone: R15

## Context

TowerForge already has arbitrary currencies, deterministic wave boundaries, a shared modifier and
damage pipeline, versioned commands/journals, and opt-in mechanics authoring. A richer local economy
must reuse these boundaries without replacing the legacy mission interest rule, adding online market
state, or changing projects that do not select the new feature.

## Decision

R15 adds the independent mission-selected `macroEconomy` module at schema v1. Profiles contain a
closed bounded commodity catalog, fixed-term deposit products, and ritual altars with only
allowlisted resource, damage, status, and temporary tower-modifier effects. The module is absent
from the starter and recipes return inert candidates; enablement and mission selection remain an
explicit guarded transaction.

The market owns an RNG domain derived from the initial simulation RNG state, mission ID, cleared
wave index, and binary-stable commodity ID. It never advances the main simulation RNG. Current-wave
trades accumulate integer net demand while prices remain unchanged; the next cleared-wave boundary
applies authored trend, volatility and demand elasticity, clamps to authored bounds, and clears the
pending demand. Commodity holdings are battle-local.

Deposits debit an explicit authored currency amount during a management phase. Maturity is counted
in cleared waves and automatically credits principal plus basis-point interest exactly once. This
does not modify or reuse `mission.economy.interestRate`, and v1 has no early withdrawal.
The checkpoint records the opened-wave boundary and validates it against the authored duration and
monotonic instance sequence before restore.

Rituals accept an altar ID and exact unique live tower instance IDs while the game remains in the
`playing` outcome; this permits authored combat-time damage and status effects. The engine validates
the full selection, authored count/type/radius constraints, effect references and bounded runtime
capacity before mutation. It then unsockets artifacts, destroys the selected towers, and applies
effects through existing engine resource, DamageResolver, status and modifier paths. Partial
selection destruction or partial effect application is not a valid result.
Selections and affected enemies are binary-stably ordered. Temporary effects carry exact
altar/effect/ritual provenance, use positive finite multipliers, and reserve capacity in the common
64-entry damage-modifier budget before any selected tower is destroyed. Aggregate temporary
products and monotonic instance sequences have explicit runtime ceilings, and reset reconstructs
all R15 state from the original deterministic seed.

Local co-op supports Macro-Economy v1 only with `ownership.resources: shared`; partitioned wallets
are rejected by both content validation and `MatchSession` construction/restore because market,
holdings and deposit settlement are one authoritative battle state. `owner_only` applies to every
tower consumed by a ritual, and successful sacrifice removes its ownership record.

`GameCommand` and command journal advance independently to v8 with `buyCommodity`,
`sellCommodity`, `openDeposit`, and `performRitual`; replay accepts v1–v8. Project v3,
`GameCheckpointV1`, simulation v2, `PlayerProfileV3`, CampaignRunV2, TowerScript and multiplayer
versions do not change. Only an active module adds `snapshot.macroEconomy` and optional checkpoint
`macroEconomy` inner v1. Restore checks profile and seed provenance, complete authored commodity
records, quote bounds, holdings/demand bounds, deposits, and temporary modifiers before constructing
the simulation.

Studio keeps authoring in Mechanics Hub and uses the existing
`preview -> revision-guarded apply -> validation -> backup/rollback` transaction. MCP exposes the
same schema, recipe, capability and guarded tools; no broad macro-economy writer is added. Studio
Playtest and Canvas/Phaser players dispatch v8 commands and consume one fail-closed renderer
projection rather than implementing market, deposit, ritual or combat rules.
When Macro-Economy is not selected, generated players omit its UI and full engine/renderer runtime
modules. Engine build markers remove R15 command, validation, checkpoint, snapshot and multiplayer
sections before the single-file graph and service-worker manifest are produced; inactive engine
instances allocate no R15 state fields.

## TDD and acceptance

R15.1 first recorded RED for the missing closed profile, deterministic order-independent market and
deferred-demand contract. R15.2 and R15.3 added separate runtime RED contracts for maturity and
atomic ritual behavior. Verifier-led regressions cover active event checkpoint schemas, negative
pending demand, plain canonical market records, exact record coverage and seed provenance.

Final acceptance requires focused and full engine tests, continuous/checkpoint/journal digest
equivalence, absent/disabled/future-version coverage, Studio and MCP guarded workflows,
Canvas/Phaser on hex and square, all package carriers, plugin parity, and independent Code Verifier
and Constructor Integration Verifier sign-offs on the frozen commit.

## Excluded

- Online or shared global markets, real-money balance, speculation bots, and external price feeds.
- Early deposit withdrawal, loans, credit, insolvency, and compound products.
- Arbitrary ritual code, scripts, host calls, partial commit, or renderer-owned effects.
- Automatic activation, starter changes, profile persistence, or CampaignRun ownership.
