# ADR 0033: Wave draft is an optional deterministic roguelite v3 feature

- Status: Accepted
- Date: 2026-07-26

## Context

R4.2 completed tower synergies and battle-local artifact socketing. Wave draft must now offer three
seeded between-wave choices without making artifacts, inventory, a pause, or new UI mandatory for
projects that only use earlier roguelite features. The choice must reproduce through checkpoint,
command journal, and replay, and its modifiers must share the bounded `run` stage with synergies and
artifacts.

## Decision

Extend the existing `roguelite` module to schema v3. A closed v3 profile requires `synergies` and
independently permits `artifacts?` and `draft?`. V2 keeps its exact required artifact section. Runtime
features are selected by the presence of their authored block, never by assuming that all v3
profiles use every rogue-lite mechanic. An explicit guarded authoring transaction upgrades a module;
loading or playing a project never migrates it implicitly.

`draft` owns closed card definitions, weighted pools, and a default pool. The engine samples exactly
three unique options without replacement using a dedicated domain-separated seeded RNG. A chosen
card may return in a later offer. Initial effects are typed damage modifiers with an allowlisted
tower scope and compile to the shared `ModifierSpec` stage `run`; no script, host API, or arbitrary
effect payload is accepted. Validation reserves the combined worst-case modifier budget across
synergies, compatible artifact sockets, and all possible interwave selections for each buildable
tower type.

An offer is created after a cleared non-final wave. While it is pending, scheduled and manual wave
starts are blocked and simulation ticks do not advance mission time, passive income, cooldowns,
statuses, shields, spawns, or timed terrain. Building and other ordinary between-wave commands remain
available. A successful choice applies the card, clears the offer, and starts a fresh authored prep
timer.

`GameCommandV3` adds exact `chooseDraftOption` with bounded `offerId` and `cardId`; v1 and v2 remain
closed and byte-compatible. Command journals gain v3 and promote monotonically to the highest valid
command version. Replay accepts v1–v3. Outer `GameCheckpointV1` remains unchanged and gains only an
optional inner draft state v1 when a draft block is active. Active draft presentation uses
`snapshot.roguelite` v4; profiles without draft retain their existing snapshot forms.

## Consequences

- Draft-only v3 profiles do not create artifact RNG, inventory, checkpoint state, or controls.
- Artifact-only and synergy-only v3 profiles do not create offers, freeze ticks, or add draft UI.
- Existing opaque future roguelite fixtures move to v4; malformed v3 shapes still fail exact
  validation and remain lossless/read-only in authoring surfaces.
- Campaign nodes, persistent run inventory, merchants, and `CampaignRun` reducers remain later,
  separate increments.
