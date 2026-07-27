# TowerForge — Roadmap расширяемых механик

Последняя проверка: 2026-07-28

Цель программы — расширить TowerForge от классического TD до набора совместимых жанровых механик, не меняя поведение существующих проектов. Каждое расширение является opt-in: разработчик добавляет versioned-модуль в необязательный `content/mechanics.json`, а миссия выбирает профиль через `mission.mechanics`. Нет файла или выбора — игра, Studio, сборка и агенты работают по legacy-контракту.

## Статус

| Срез | Состояние | Критерий перехода |
| --- | --- | --- |
| R0A — каталог и capability harness | Завершён; code + constructor sign-off | Engine/loader/Studio/MCP/build tests green; authored starter остаётся schema v1 без `mechanics.json`, runtime legacy-нормализация — v2 |
| R0B — modifiers и единый damage resolver | Завершён; code + constructor sign-off | Все legacy-источники проходят один resolver; full regression gates зелёные |
| R0C — commands, checkpoint, replay и profile runtime | Завершён: R0C.1–R0C.7.4 | Deterministic foundation и общий profile runtime приняты |
| R1.1 — resolver equivalence | Завершён; code + constructor sign-off | Общая damage-граница используется следующими R1-срезами |
| R1.2 — opt-in shields | Завершён; code + constructor sign-off | Следующий отдельный срез — R1.3 armor matrix |
| R1.3 — armor matrix | Завершён; code + constructor sign-off | Combat module v2, author-defined damage/armor types и assignments без marks/reactions |
| R1.4 — marks and vulnerabilities | Завершён; code + constructor sign-off | Combat module v3, typed marks, stacking, duration и consume policy без elemental reactions |
| R1.5 — elemental reactions | Завершён; code + constructor sign-off | Separate reactions v1, exposures и bounded FIFO secondary effects |
| R2 — dynamic navigation | Завершён; code + constructor sign-off | Engine/loader/checkpoint/analyze, Studio Hub, MCP/AI, recipe и renderer/player surfaces прошли R2 gates |
| R3.1 — authored elevation foundation | Завершён; code + constructor sign-off | Sparse map contract, elevation v1, guarded Studio/MCP authoring, optional snapshot и shared presentation cues |
| R3.2 — deterministic elevation LoS | Завершён; code + constructor sign-off | Elevation v2, engine-owned LoS, guarded Studio/MCP diagnostics, legacy/no-LoS path |
| R3.3 — authored high-ground modifiers | Завершён; code + constructor sign-off | Elevation v3, pairwise range и spatial damage bonus без physics/terraforming |
| R3.4a | Завершён; code + constructor sign-off | Opt-in `physics` v1: tile-discrete push/pull, explicit terrain-tag fall hazards, без terraforming/TowerScript |
| R3.4b | Завершён; code + constructor sign-off; ADR Accepted | Полный opt-in vertical slice: runtime/adapters, CLI/MCP/AI, Studio, shared Canvas/Phaser/player presentation, packages и legacy path |
| R4.0A/B — profile v3 + inert CampaignRun | Завершены; code + constructor sign-off | Persistent profile и per-run transport версионируются независимо, без rogue gameplay |
| R4.1A — tower tags + damage synergies | Завершён; code + constructor sign-off; ADR Accepted | Opt-in `roguelite` v1, 2/4/6 recipe, guarded Studio/MCP authoring и optional player surface |
| R4.2A/B — artifact catalog + seeded boss loot | Завершён; code + constructor sign-off; ADR Accepted | Opt-in `roguelite` v2, battle-local inventory, checkpointed отдельный RNG, guarded Studio/MCP и read-only player surface |
| R4.2C — artifact socketing | Завершён; code + constructor sign-off; ADR Accepted | GameCommand/Journal v2, nested checkpoint v2, snapshot v3, exact-tower modifiers и доступный Studio/player UI |
| R4.3 — deterministic wave draft | Завершён; code + constructor sign-off; ADR Accepted | Независимый optional draft-блок, три seeded options, GameCommand/Journal v3 и блокировка следующей волны до выбора |
| R4.4A — campaign graph + run lifecycle | Завершён; code + constructor sign-off; ADR Accepted | Opt-in typed DAG, отдельные run/profile reducers, guarded Studio/MCP и explicit player import/export без battle-state coupling |
| R4.4B — structural campaign choices | Завершён; code + constructor sign-off; ADR Accepted | Campaign graph v2, declared run resources и атомарные merchant/event choices без battle-state coupling |
| R4.4C — campaign battle handoff | Завершён; code + constructor sign-off; ADR Accepted | Marker v2 переносит run deck/artifacts через deterministic prepare/checkpoint/atomic settlement; marker v1 остаётся legacy |
| R5.1A — static hero roster foundation | Завершён; code + constructor sign-off; ADR Accepted | Opt-in `heroes` v1: bounded roster, один selected unit на core, optional snapshot и shared presentation без commands/checkpoint |
| R5.1B — deterministic hero movement | Завершён; code + constructor sign-off; ADR Accepted | Heroes v2, own movement profiles, exact GameCommand/Journal v4, checkpoint/replay и Canvas/Phaser input без navigation activation |
| R5.2A — hero durability | Завершён; code + constructor sign-off; ADR Accepted | Heroes v3, exact HP/optional shield, shared resolver, optional snapshot/checkpoint state, guarded authoring и legacy v1/v2 paths |
| R5.3A — targeted hero ability | Завершён; code + constructor sign-off; ADR Accepted | Heroes v4, bounded mana regeneration, один enemy-targeted damage spell, cooldown, GameCommand/Journal v5 и nested checkpoint v3 |
| R5.4A — battle-local hero skill tree | Завершён; code + constructor sign-off; ADR Accepted | Heroes v5 nullable tree, GameCommand/Journal v6, authoritative snapshot v5, nested checkpoint v4 без CampaignRun/Profile carry |
| R5.5A — passive hero damage aura | Завершён; code + constructor sign-off; ADR Accepted | Heroes v6 nullable aura, authoritative topology membership и tower-only `spatial` modifiers без нового command/event/checkpoint state |
| R5.6A — dynamic hero blocking | Завершён; code + constructor sign-off; ADR Accepted | Heroes v7 nullable blocking, explicit dynamic movement-profile eligibility и bounded engine-owned holds без hero occupancy/path rebuild |
| R5.7A — logistics power grid | Завершён; code + constructor sign-off; ADR Accepted | Logistics v1 nullable power, bounded deterministic generators/relays/components, priority brownout и authoritative visible overlay без ammo/factory |
| R5.8A — local ammunition | Завершён; code + constructor sign-off; ADR Accepted | Logistics v2 nullable ammunition, local tower magazines, activation расход и nested checkpoint без refill/factory/transfer |
| R5.8B — ammunition supply | Завершён; code + constructor sign-off; ADR Accepted | Logistics v3 factories, storage, bounded deterministic transfer и same-instance refill |
| R5 | Завершён | Heroes v1–v7 и Logistics v1–v3 поставлены как независимые opt-in вертикальные срезы |
| R6 — TowerScript DX 2.0 | Завершён; code + constructor sign-off; ADR Accepted | Structured trace, deterministic step/rewind, lossless Visual Graph, descriptor-driven Studio/MCP и bounded O(1)-append debug retention |
| R7–R8 | Запланированы | Каждый срез закрывает engine, Studio, AI/MCP, renderers/player, docs и два независимых sign-off |

R0A изначально ввёл только контракт и поверхности обнаружения. Поставленные версии `combat`, `reactions`, `navigation` и `elevation` уже прошли полные вертикальные срезы. Остальные модули Mechanics Hub остаются planned, а preview/apply отклоняют их включение без записи.

## Порядок поставки

### R0 — Extension Platform

1. **R0A: capability harness.** `MechanicsCatalog`, `MissionMechanicsSelection`, read-only `CapabilitySet`, schema v3 как явная граница авторинга, Mechanics Hub, schema discovery и безопасные preview/apply contracts.
2. **R0B: effect foundation.** Allowlisted `ModifierSpec` с фиксированным порядком применения и единый `DamagePacket`/`DamageResolver` для всех источников урона.
3. **R0C: deterministic state.** Seeded RNG без `Math.random`, versioned `GameCommand`, `GameCheckpointV1`, command journal, stable state digest и общий player-profile runtime с явными миграциями.

R0B фиксирует data-only контракт модификаторов: `base → tower_upgrade → meta → run → spatial → temporary`; внутри стадии применяются `flat → additive_ratio → multiplier`, затем binary-sort по `id`. Общий `DamageResolver` принимает башни, способности, TowerScript, status/DoT, атаки врагов и leak как типизированные источники. В R0B он выполняет `modifiers → entity resistance → legacy pierce_only adapter → HP`; shields, armor matrix, marks и reactions остаются отдельными R1-срезами. Мутация сущностей, события, смерть и награда остаются в `TowerDefenseGame`, поэтому resolver является чистым и не может выдать награду повторно.

R0C.1 поставляет browser-safe `SeededRng` (`xoshiro128**`) с versioned JSON-state, typed string/number seed expansion v1, exact golden-векторами и unbiased `nextInt`. RNG пока намеренно не подключён к `TowerDefenseGame`: команды, digest, checkpoint и journal получают собственные следующие RED/GREEN циклы.

R0C.2 добавляет versioned `GameCommandV1` для девяти существующих действий и оставляет `SimulationAction` deprecated-адаптером. Dispatcher до мутации строит detached canonical command из own data descriptors, отклоняет future/extra/malformed shapes, ограничивает TowerScript payload по depth/nodes и реальным UTF-8 bytes и не маскирует исключение engine после начала валидной команды. Transport ownership/sequence остаются вне команды до R8.

R0C.3 фиксирует browser-safe `canonicalStringify`, `stableDigest` и `getSimulationContentDigest`. Канонизатор работает только с strict JSON data descriptors, не вызывает getters, отклоняет cycles/sparse arrays/non-finite значения и ограничен budgets. Content fingerprint включает все simulation-домены и opt-in mechanics, но schema-aware исключает presentation metadata, world-map layout и `mapFactory`; gameplay ID вроде `color`, `label` и `__proto__` остаются частью хеша. FNV-1a 64 vectors и version prefixes — compatibility contract, а не security signature.

R0C.4 добавляет `GameCheckpointV1`, `TowerDefenseGame.createCheckpoint()`, `getStateDigest()` и атомарный `fromCheckpoint()`. Checkpoint хранит authoritative state, оба RNG-state, content fingerprint и независимые checkpoint/engine version headers; map occupancy и water cues перестраиваются как derived state. Restore не использует `GameSnapshot`, не повторяет `gameStarted` и до создания карты отклоняет incompatible header/content/identity/RNG/state/digest. Closed nested validation проверяет refs, counters, topology footprint, queue order, entity bounds и TowerScript budgets; continuous и checkpoint-suffix дают один digest на hex и square. Journal/replay не входят в checkpoint и поставляются отдельными R0C.5/R0C.6-контрактами.

R0C.5 добавляет browser-safe `GameCommandJournalV1`, `JournaledGameSession` и validation-only `decodeGameCommandJournal`. Журнал стартует с detached checkpoint, записывает канонизированную `GameCommandV1`, normalized result без human-readable `reason` и post-state digest. Malformed command не попадает в entries; valid gameplay failure попадает. Общий internal parser гарантирует `parse once → execute once`; out-of-band mutation, engine exception и preflight capacity fault закрывают session. Decoder проверяет closed versioned data и embedded checkpoint без `mapFactory` и никогда не исполняет entries. Journal не попадает в checkpoint, snapshot или project data; его исполнение поставлено отдельным R0C.6-срезом.

R0C.6 добавляет чистый engine API `replayGameCommandJournal`. Весь журнал и все его команды валидируются до создания карты, затем игра восстанавливается из initial checkpoint, а каждая уже разобранная команда исполняется ровно один раз. Replay на каждой sequence сначала сравнивает normalized result, затем post-state digest и останавливается на первом расхождении с typed diagnostics. Continuous и replay дают один snapshot/digest на hex и square, включая записанные gameplay rejection. Replay не попадает в project/profile/checkpoint и не добавляет UI, MCP или player state.

R0C.7.1 фиксирует в чистом engine независимый `PlayerProfileV2`: bounded canonical codec, явные миграции legacy array/object, detached deep-frozen значения и точные launch options для difficulty/meta upgrades. Схема profile версионируется независимо от project, checkpoint и replay; persistence и browser templates в этот срез не входят.

R0C.7.2 добавляет чистые immutable reducers для выбора difficulty, атомарной покупки multi-currency meta upgrades и фиксации mission clear с first/repeat/per-star-delta rewards. Unlock helpers воспроизводимо считают зависимости world-map, а все transitions возвращают stable machine codes и сохраняют exact input при failure. Интеграция с generated players поставлена отдельно в R0C.7.4.

R0C.7.3 добавляет browser-safe `packages/player-runtime` с renderer-neutral, dependency-injected storage adapter поверх engine-owned profile codec. Load не изменяет хранилище, future profiles защищены от неявной перезаписи, explicit save выполняет canonical validation и preflight, а reset удаляет только точный app-scoped ключ; ошибки storage и повреждённые данные возвращают stable machine codes без утечки raw/error details.

R0C.7.4 подключает один общий marker-delimited profile fragment к Canvas и Phaser: оба player используют engine codec/reducers и renderer-neutral storage adapter без локальных progression helpers. Web/PWA копирует и precache-ит runtime, single-file встраивает его module graph, а Codex plugin и desktop runtime зеркалируют тот же пакет. Browser acceptance фиксирует read-only legacy migration, canonical explicit save, fail-closed future profile, playable corrupt fallback, exact normal reset и app-scoped emergency recovery. Граница закреплена в [ADR 0016](adr/0016-player-profile-runtime-and-persistence.md).

Выключенные модули проходят структурную проверку; их сломанные ссылки дают warning. Полная семантическая проверка выполняется при preview/enable. Любая будущая активация — одна revision-guarded транзакция с validation, backup и rollback.

### R1 — Deep Combat

Поставлять только последовательно: resolver equivalence → shields → armor matrix → marks → reactions. Author-defined damage/armor types, shields башен и врагов, метки и data-driven reaction matrix используют общий resolver. Fire/Ice, Lightning/wet и Fire/poison поставляются recipes и никогда не включаются автоматически. Secondary effects ограничены по depth/fan-out; смерть и награда происходят ровно один раз.

R1.1 сводит применение `DamageResolution.finalAmount` к одной private-границе `resolveAndApplyDamage`: target-specific wrappers только собирают typed packet/context, а enemy, core и tower HP изменяются после ровно одного вызова resolver. Исчерпывающая матрица фиксирует tower deliveries, ability, TowerScript, status/DoT, enemy attack и leak, сохраняя прежние события, арифметику, golden snapshots и exactly-once death/reward settlement. Новых authoring-полей, snapshot-секций или Studio/MCP/renderer surface нет; отсутствующий, выключенный, enabled-empty и engine-unavailable combat-варианты дают одинаковый gameplay snapshot, но их content/state digests могут различаться, поскольку authored mechanics участвуют в content fingerprint. Решение закреплено в [ADR 0017](adr/0017-damage-routing-equivalence.md). Следующий независимый инкремент R1.2 добавляет opt-in shields.

R1.2 делает `combat` первым исполняемым модулем и ограничивает его closed v1-профиль щитами. Author задаёт `capacity` и optional `regeneration`; runtime хранит state по instance ID, поглощает уже resolved damage до HP, детерминированно восстанавливается и входит в checkpoint/replay digest. `enemyShieldChanged` / `towerShieldChanged` и TowerScript v3 actions имеют причины `damage | regeneration | script`, клампятся к capacity и не создают отсутствующий щит.

Mechanics Hub и AI/MCP используют один engine descriptor, встроенный opt-in recipe `basic_regenerating_shields` и транзакцию `preview → guarded apply → validate` с revision, backup и rollback. Canvas, Phaser, Studio playtest, PWA и single-file player читают только optional snapshot через общую fail-closed presentation-проекцию; ни один рендер не вычисляет damage или regeneration. Без файла, enable и mission selection секция `snapshot.combat` отсутствует и legacy draw path не меняется. Контракт закреплён в [ADR 0018](adr/0018-opt-in-combat-shields.md); R1.3 добавляет armor matrix отдельным инкрементом, не меняя v1.

R1.3 расширяет тот же `combat` до module schema v2: v1 остаётся shields-only, а v2 сохраняет `shields` и добавляет author-defined `damageTypes`, `armorTypes` и enemy-only `armorAssignments`. Любой источник урона проходит порядок `source modifiers → armor matrix → entity resistance → legacy pierce_only → shield → HP`; отсутствие `damageType` означает объявленный `physical`. Нулевой matrix multiplier является валидным иммунитетом, а `armor_piercing` обходит только legacy-адаптер, не author-defined matrix.

Armor matrix не создаёт mutable runtime state и сама по себе не добавляет `snapshot.combat` или checkpoint-секцию. При этом каталог входит в simulation content digest, поэтому checkpoint из другого armor-content отклоняется. Mechanics Hub и AI используют общий descriptor, явный upgrade v1 → v2 и opt-in recipe `basic_elemental_armor_matrix`; downgrade и future module versions отклоняются. Элементальные названия recipe не включают marks или reactions. Решение закреплено в [ADR 0019](adr/0019-opt-in-armor-matrix.md); оба независимых sign-off выданы 2026-07-24.

R1.4 расширяет `combat` до module schema v3 и TowerScript до schema v4. Метка задаёт damage-type filter, duration, max stacks, multiplier и `retain | consume_one | consume_all`; несколько подходящих меток применяются в binary-порядке по ID с формулой `1 + stacks × (multiplier − 1)`. Полный порядок расчёта теперь `source modifiers → marks/vulnerability → armor matrix → entity resistance → legacy pierce_only → shield → HP`. Consume происходит после успешного resolve, включая matrix immunity или полное поглощение щитом, а source binding накладывает новую метку только после consume и влияет на следующий удар.

Mutable mark state хранится вместе со shields в optional `snapshot.combat` / checkpoint combat-state schema v2; outer checkpoint, command и journal version domains не меняются. Expiration, refresh, bounded applications и `enemyMarkChanged` детерминированы, а TowerScript v4 добавляет только typed `applyEnemyMark` / `clearEnemyMark` и соответствующее событие. Mechanics Hub, MCP/AI и CLI используют один descriptor, recipe `basic_vulnerability_marks`, revision guard, backup и rollback; Canvas и Phaser читают одну fail-closed presentation-проекцию. Без active v3 profile mark state и UI отсутствуют, legacy snapshots остаются прежними. Решение закреплено в [ADR 0020](adr/0020-opt-in-vulnerability-marks.md); оба независимых sign-off выданы 2026-07-24. Следующий отдельный срез R1.5 добавляет bounded data-driven reactions, не меняя уже принятый resolver-контракт.

R1.5 реализует независимый `reactions` module schema v1 поверх неизменного combat v2/v3. Exposure applications и directional rules являются author-defined data; requirements объединяются через AND и читают только captured exposure/status/authored terrain-tag state. Eligible direct hit завершает основной pipeline, затем engine резервирует consumable state в binary reaction-ID order и синхронно исполняет secondary FIFO через ту же damage-границу. Глубина ограничена 4, fan-out — 64 targets/effect, а root — 256 secondary packets; runtime truncation детерминирована и диагностируется. Death/reward settlement остаётся единственным и exactly-once.

Live exposures используют optional `snapshot.reactions` / checkpoint state schema v1; combat-state v2 и outer version domains не меняются. TowerScript v5 добавляет typed exposure actions/events без прямого запуска матрицы. Mechanics Hub, MCP/AI, CLI и recipes `elemental_shatter`, `wet_chain_shock`, `poison_combustion` используют один descriptor и guarded transaction; missing combat types или terrain tags не исправляются автоматически. Canvas и Phaser показывают bounded badges/cues из общей fail-closed проекции. Решение закреплено в [ADR 0021](adr/0021-opt-in-elemental-reactions.md); reference fixture — `docs/examples/opt-in-elemental-reactions/`. Оба независимых sign-off выданы 2026-07-24; следующий отдельный срез R2 вводит dynamic navigation без route-breaking terraforming.

### R2 — Dynamic Navigation

Opt-in `navigation.mode: authored_routes | dynamic_flow`, author-defined movement profiles и общий reverse-Dijkstra flow field для пары profile+goal реализованы в engine. Dirty rebuild происходит только после изменения occupancy/terrain/goal; placement проверяет последний путь до мутации и списания ресурсов. Pure bounded `analyzeNavigation` и MCP `analyze_navigation` дают canonical field/placement diagnostics без изменения state, RNG, journal или digest.

Mechanics Hub хранит navigation-поля в отдельном detached editor/normalizer, использует guarded preview/apply/reload/disable/re-enable и не добавляет controls в базовые формы. `basic_dynamic_navigation` предлагает четыре независимых пресета без назначения enemy types и ничего не включает автоматически. Studio Playtest запрашивает bounded viewport analysis у текущей simulation instance, поэтому overlay учитывает runtime occupancy/terrain: до 4 096 тайлов покрываются полностью, а на большей карте выбирается независимое от record order окно ближайших к последнему pointer/keyboard anchor тайлов с явным счётчиком partial coverage. Server facade остаётся saved-project/fallback поверх того же engine API; фактическая установка всегда проходит authoritative `canPlaceTower` preflight и `placeTower`. Canvas/Phaser используют общую fail-closed presentation projection. Legacy absent/disabled/unselected/`authored_routes` path остаётся без navigation snapshot, overlay и solver allocation. Решение принято в [ADR 0022](adr/0022-opt-in-dynamic-flow-navigation.md); независимые code и constructor-integration sign-off выданы 2026-07-25. Следующий отдельный срез R3.1 вводит elevation data contract и legacy equivalence без LoS, displacement или terraforming.

### R3 — Elevation, Physics и Terraforming

Тайл получает `elevation` с default `0`; topology line, elevation и blocker tags определяют LoS в engine. High-ground, push/pull и hazards задаются профилями. Terraforming является транзакцией: candidate terrain/elevation → navigation rebuild → reachability → commit или полный rollback. Flood, moat и bridge остаются recipes поверх terrain tags и typed TowerScript actions.

R3.1 завершён отдельным TDD-срезом. Карта авторит sparse `elevationOverrides` с неявным `0`, а пустой closed-профиль elevation v1 только включает их для миссии. Authored-поле требует project v3; legacy-карты не получают поле или upgrade автоматически. Active snapshot содержит только canonical detached overrides, Studio/MCP используют отдельную guarded map transaction, а Canvas/Phaser — общую bounded fail-closed presentation projection. LoS, high-ground modifiers, displacement, hazards и terraforming в R3.1 исключены. Контракт закреплён в [ADR 0023](adr/0023-opt-in-authored-elevation-foundation.md); независимые code и constructor-integration sign-off выданы 2026-07-25. Следующий отдельный срез R3.2 добавляет opt-in LoS без high-ground или физики.

R3.2 завершён отдельным TDD-срезом. Elevation module v2 сохраняет v1 `{}` и добавляет только optional `lineOfSight.terrainBlockerTags`; v2 без этого поля остаётся elevation-only. Engine использует topology-owned line, authored elevation и binary-sorted terrain blocker tags, а direct tower acquisition проверяет видимость до атаки. Splash/area secondaries и chain hops не пересчитывают LoS. Bounded `analyzeLineOfSight` и MCP `analyze_line_of_sight` анализируют active либо точный preview candidate по одному mechanics revision без записи проекта. Snapshot elevation остаётся schema v1; renderer получает только detached verdict projection и не повторяет правила. `basic_elevation_line_of_sight` требует существующий tag `opaque`, но не редактирует terrain/map и не включает модуль. High-ground, bonuses, displacement, hazards, terraforming и TowerScript изменения исключены. Studio показывает prerequisites до Preview и lossless авторит blocker tags через comma shorthand или JSON array. Контракт принят в [ADR 0024](adr/0024-opt-in-deterministic-elevation-line-of-sight.md); независимые code и constructor-integration sign-off выданы и повторно подтверждены 2026-07-25. Следующий отдельный срез R3.3 добавляет authored high-ground range/damage modifiers без physics или terraforming.

R3.3 завершён как отдельный opt-in TDD-срез. Elevation module v3 сохраняет v1/v2 и добавляет optional `highGround` с engine-owned limits для максимальной разницы высот, pairwise range bonus и immediate tower damage bonus в basis points. Дополнительная дальность применяется только при непосредственном выборе целей атакующими башнями и до LoS; support-ауры, placement, secondary radii и chain radius не расширяются. Урон получает не более одного existing spatial `ModifierSpec` только от живой совпадающей tower instance; DoT, abilities, reactions, TowerScript, enemy/core/leak damage остаются без бонуса. Snapshot elevation остаётся v1, новых events/checkpoint state нет, а checkpoint+journal replay сохраняют digest. Studio хранит LoS и high-ground как независимые siblings и монотонно поднимает authoring до v3; CLI/MCP используют guarded preview/apply, engine descriptor и inert recipe `basic_elevation_high_ground`, который не меняет карту, не включает модуль и не выбирает миссию. Canvas/Phaser × hex/square, single-file/web/`.tdpack`, plugin и legacy starter gates прошли; независимые code и constructor-integration sign-off выданы 2026-07-25. Контракт принят в [ADR 0025](adr/0025-opt-in-authored-high-ground-modifiers.md).

R3.4 разделён на два независимых инкремента. Завершённый R3.4a принят в [ADR 0026](adr/0026-opt-in-tile-displacement-physics.md): новый `physics` v1 даёт pipeline-башням и custom abilities bounded tile-discrete push/pull, explicit enemy-type immunity и terminal fall hazards по terrain tags. Authored routes остаются на своём track, dynamic flow использует только уже построенное поле, а first-neighbor classification запрещает hidden slide/reroute. Flying в v1 иммунны, closed own-data parser отклоняет executable accessors, а active-only лимиты 8 effects × 64 target slots с ceilings 4,096 steps/activation и 32,768 steps/tick дают deterministic fail-closed overflow. Legacy path остаётся byte-for-behavior no-op при любом неактивном capability state; code и constructor-integration sign-off выданы 2026-07-25.

R3.4b целиком принят 2026-07-25 по [ADR 0027](adr/0027-opt-in-transactional-terraforming.md). Foundation и runtime C1/C2A/C2B1/B2A/B2B/C3A/C3B/C4A/C4B публикуют независимый opt-in `terraforming` v1, точные authoring/runtime budgets, mission-scoped capability и transition validation, TowerScript v6 `terraformTiles`, реальное событие `elevationChanged`, стабильные failure reasons и optional diagnostic `reasonKey`. C1 транзакционно планирует persistent `set_terrain`/`restore_terrain` batches на `authored_routes`. C2A добавляет detached baseline/candidate flow-field preflight, один field на profile+numeric goal, global repair/block classification и атомарную adoption resolver/cache/enemy links до compatibility cues и событий. C2B1/B2A формируют solver-free canonical graph из wave, transitive death/phase и mission-reachable TowerScript v1–v6 spawn paths, добавляют parent→child field obligations и замораживают canonical safety groups до любого resolver construction. Exact ceilings составляют `16 384` sources/causes, `256` fields и `8 388 608` baseline+candidate field/proof cells; overflow в B2B доказан fail-before-read sentinel-тестом. Parent→child obligation требует, чтобы child field покрывал весь parent field кроме terminal goal; мёртвый, но ещё не удалённый parent добавляет pending child source из current cell, кроме случая dead-at-goal. Граница из 8 191 live enemies потребляет один shared candidate field; snapshot peek не меняет stats.

Принятый C3A добавляет persistent `set_elevation`/`restore_elevation` только при одновременно active elevation v1–v3 и elevation policy выбранного terraforming-профиля. Значение обязано быть safe integer внутри engine/profile bounds и `maximumDeltaPerOperation`; restore возвращает immutable authored base. Terrain и elevation могут меняться на одной клетке в общей атомарной транзакции, события выходят в порядке операций, no-op не создаёт override или event. Лимиты равны 512 runtime overrides на слой и 1 024 суммарно. Pure elevation batch не создаёт, не читает и не усыновляет navigation resolver, но немедленно обновляет effective `snapshot.elevation`, LoS и high-ground; reset очищает runtime elevation. TowerScript получает committed `elevationChanged {coord,fromElevation,toElevation,source}`.

C3A также вводит минимальную inner checkpoint-секцию `{schemaVersion:1,runtimeElevationOverrides}`. Она обязательна, даже пустая, только когда одновременно доступны active elevation и terraforming elevation policy, и запрещена во всех остальных capability states. Codec требует exact closed shape, canonical unique in-map rows, не более 512 elevation и 1 024 combined terrain+elevation overrides; restore проверяет policy bounds и отличие от authored base, но не повторяет transition-only delta. Outer `GameCheckpointV1`, `towerforge-sim-v2`, command и journal versions не изменились; state digest и replay учитывают новый inner state. Inactive/disabled/unselected legacy checkpoint и snapshot сохраняют прежнюю byte-shape.

TDD evidence C3A: исходный contract RED дал 10/22, а независимый verifier нашёл и закрепил отдельным RED отсутствие реальной TowerScript-dispatch для `elevationChanged`. После исправления full Vitest — 1 623/1 623, Playwright — 17/17, conformance — 69/69; прошли typecheck, engine/build, validate, sim и plugin build/validate/smoke. Независимые code и constructor-integration sign-off — GREEN.

Принятый engine-only C3B добавляет native `duration` только для set-only batches. Граница 512 groups проверяется до expressions; duration вычисляется ровно один раз до targets/values и должен быть finite в `(0, 1_000_000_000]`. Один successful non-noop batch создаёт одну group с monotonic sequence; no-op не занимает group/sequence и не создаёт events. Same-layer ownership эксклюзивно, cross-layer ownership разрешено; pending ceilings равны 512 terrain, 512 elevation и 1 024 combined targets.

После historic legacy timers native groups уменьшаются на clamped `0..0.2` delta с ULP-bounded rounding. Все due groups восстанавливаются одной атомарной candidate-транзакцией и одним navigation proof в order sequence→original operation. Unsafe restore не публикует частичный state, diagnostics или events, оставляет все due groups на `remaining: 0` и retry через `tick(0)`. Active snapshot получает только `terraforming` v1, а exact inner checkpoint v2 хранит next sequence, groups, applied values и exact before-images. Historic terrain-only v0 и C3A v1 сохраняют form/digest до первой successful timed non-noop promotion; outer version domains не изменились. Terrain-only v2 fail-closed отклоняет hidden elevation state, а native/legacy coexistence guards не дают обойти ownership.

C3B RED → GREEN evidence: focused runtime/navigation/checkpoint — 71/71; full Vitest — 1 671/1 671 в 132 files; focused golden/checkpoint/replay/template conformance — 198/198; renderer/template regressions — 53/53; full Playwright — 17/17; isolated 4 templates × 2 grids × 2 renderers matrix — 1/1. Typecheck, build:engine, validate, sim, build и plugin build/validate/smoke — GREEN; независимые code и constructor-integration sign-off — PASS.

Принятый C4A является active-only compatibility adapter для существующих TowerScript `setTileTerrain`/`restoreTileTerrain`. При active terraforming прямой destination обязан быть известным authored terrain ID, но не требует transition или source tag; set/restore затем используют общий `candidate → authored_routes/dynamic_flow proof → atomic publish` tail. Timed set не создаёт legacy `expiresIn`: он получает native C3B group с exact before-image, exclusive ownership, детерминированным expiry и checkpoint inner v2. Fixed order — action budget, один terrain operation budget, для timed group capacity и однократный `duration`, затем `q`, `r`, known-terrain/ownership/candidate/proof/publish. Истинный effective no-op останавливается после обязательных budget/expression checks, но до proof, group/sequence allocation, map/navigation change, event или form promotion. Любой native owner или восстановленный historic legacy `expiresIn` даёт `terraform.target_owned`.

Absent, disabled и unselected capability paths по-прежнему исполняют буквальную legacy-ветку с прежними evaluation order, repeat/max timer и checkpoint/digest поведением. C4A не повышает public TowerScript v6, project, outer checkpoint, snapshot, MCP, Studio или renderer API. TDD начался с 7 RED/4 GREEN; после correction/migration контрольных fixtures focused набор стал 42/42. Независимый verifier добавил отдельный authored-route no-op RED, закрытый GREEN. Финальный relevant engine набор — 149/149. Code sign-off повторил focused 134 и C4A 5×12, full engine/shared — 1 661; единственные внешние сбои были sandbox-запретами Studio listen. Constructor-integration sign-off подтвердил focused 302, scripts 80, template/conformance 284, full 1 683, Playwright 17/17, все обязательные gates и byte-identical plugin runtime.

Принятый C4B является active-only adapter для `path_water`. Selection берётся целиком из immutable authored `path` в радиусе способности; выбор более 64 клеток атомарно отклоняется с `terraform.operation_budget_exceeded` и никогда не обрезается, даже если изменить нужно лишь одну клетку. После size guard приоритет проверок фиксирован: 512-group capacity → finite duration в `(0, 1_000_000_000]` → существование authored `water` → same-layer native/historic ownership. Затем прямые ability-source операции проходят общий candidate → `authored_routes`/`dynamic_flow` proof → atomic publish. Ровно одна native group содержит только действительно изменившиеся клетки и их exact before-images; outer terrain overrides не получают `expiresIn`.

Успешный all-no-op всё равно ставит полный cooldown и публикует `waterAbilityUsed` со всей исходной selection, но не создаёт group, sequence, terrain events или checkpoint promotion. Partial no-op делает то же, а group/event changes содержит только изменившиеся клетки. `temporaryWaterTiles` теперь является detached derived compatibility view: сначала historic legacy ability-water timers, затем native ability-water groups с `remaining > 0` в sequence→target order и с coordinate dedupe. Поэтому unsafe expiry, оставшийся на `remaining: 0`, сохраняет terrain/ownership для retry, но не water cue и не специальное path-water slowdown; persistent water без активного таймера также не замедляет как способность.

Checkpoint codec разрешает native `source: "ability"` только при active terraforming, authored `path_water` в миссии, applied `water` и immutable authored base `path`. Historic form сохраняется до свежего effective use, затем продвигается в inner v2; reset очищает runtime terrain/cues/groups, сбрасывает sequence и cooldown, а checkpoint/journal replay и дробные tick partitions сохраняют snapshot/digest equivalence. Inactive absent/disabled/unselected square и hex выполняют буквальный legacy `path_water`, включая 65-cell application и outer `expiresIn`. C4B не меняет public TowerScript v6, project, outer checkpoint, snapshot, MCP, Studio или renderer API.

C4B TDD начался с 16 RED/7 GREEN из 23 contracts. Итоговый C4A+C4B focused набор — 35/35, все terraforming suites — 172/172, broader root regression — 194/194. Независимый code verifier повторил 23 contracts на трёх прогонах и full Vitest 1 706; constructor-integration verifier подтвердил focused 194, golden/checkpoint/replay/template/conformance 326, Playwright 17/17, все обязательные gates и byte-identical plugin runtime. Оба sign-off — PASS без findings.

Принятый C5A добавляе terraforming v1 в закрытый project/CLI allowlist, общий `inspectMechanicsAuthoring` и MCP domain projection прямо из `TERRAFORMING_MECHANICS_SCHEMA`. Три parameterized recipes — `tagged_flood`, `tagged_moat`, `tagged_destructible_bridge` — принимают только реальные authored `sourceTerrainTag`/`destinationTerrainId` и optional `transitionId`, возвращают detached v1 profile и TowerScript v6 `terraformTiles` snippet, но не включают модуль, не выбирают mission и не пишут map/terrain/script. Механика и script применяются двумя раздельными guarded transactions с независимыми revisions. Закрытый parameter contract проверяет own-data descriptors, 1–128 UTF-8 bytes, authored references и fail-closed отклоняет parameters у всех остальных recipes.

AI workflow зафиксирован как `describe_schema(terraforming) → get_capabilities → get_recipe(parameters) → preview_mechanics_module(explicit missionId, enabled:true) → apply_mechanics_module(ifRevision) → upsert_tower_script(separate revision) → validate_project`. Agent guide повышен только до v15; project v3, catalog/module v1, TowerScript v6, snapshot/checkpoint и MCP protocol не менялись. Stdio transport теперь FIFO-дренирует крупные frames до exit 0 и обрабатывает late `EPIPE` одним controlled exit-1 path. Итоговые C5A gates: repair 44/44, relevant 249/249, full Vitest 1 743/1 743, Playwright 17/17, все typecheck/build/validate/sim/plugin gates и byte-sync. Code verifier дополнительно доказал 160 FIFO frames / 4 840 932 bytes, controlled EPIPE и self-revoking Proxy; оба финальных sign-off — PASS без findings.

Принятый C5B добавляет в Mechanics Hub отдельную Terraforming card сразу после Physics. Studio материализует project-bound recipe через узкий read-only `POST /api/mechanics/recipe`, показывает detached profile и read-only TowerScript v6 snippet, но не включает модуль и не пишет script. Редактор использует только authored terrain IDs/tags, binary-сортирует их, сохраняет missing authored values в списках и берёт budgets только из engine descriptor. Future terraforming v2 отображается lossless/read-only без downgrade. Preview не пишет, enable явно переводит проект в schema v3, save/reload сохраняют exact transition/elevation profile, а global Disable сбрасывает только `module.enabled`, сохраняя profiles и mission selections для точного re-enable. Ordinary forms и Visual Graph не получают gameplay rules. C5B TDD начался с 18 RED/4 GREEN; после GREEN прошли focused 25/25, Studio regression 104/104, browser lifecycle 8/8, full Vitest 1 762/1 762 и full Playwright 25/25. Code verifier дополнительно проверил 64 concurrent recipes и XSS/prototype/path boundaries; constructor integration повторно доказал legacy byte identity, MCP/AI parity, Canvas/Phaser × hex/square/player, build/plugin gates и byte-identical plugin runtime. Оба sign-off — PASS без findings.

Принятый C6 завершает renderer/player surface одним общим bounded descriptor-safe `projectTerraformingPresentation`. `snapshot.tiles` и `snapshot.elevation` остаются authoritative: текущие `terrainChanged`/`elevationChanged` служат только hints для инвалидации, а `pendingExpiryGroups` валидируются как wire state и никогда не становятся redraw roots. Проектор fail-closed отклоняет malformed/future/over-budget данные, возвращает detached frozen roots и общую elevation presentation. `expandAutotileInvalidations` одинаково расширяет roots до self+8 для square и self+6 для odd-r hex, фильтрует по текущим tiles и сортирует результат; при переполнении, malformed hints или неудаче expansion Canvas и Phaser переходят к full redraw, не теряя authoritative snapshot diff. Canvas, Phaser, Studio Playtest и generated PWA/single-file/web/`.tdpack` используют один контракт; public opt-in fixture находится в `docs/examples/opt-in-transactional-terraforming/`. Absent/disabled/unselected capability не создаёт terraforming snapshot/surface и сохраняет legacy path.

C6 TDD начался с 11 RED. Repair-регрессии отдельно закрепили exact keys и malformed UTF-16; после исправления устаревшего Studio-вызова `drawElevationCues` итоговые наборы составили focused 48/48, package 3/3, Studio 8/8, player 2/2, full Vitest 1 777/1 777 и E2E 27/27. Матрица template × grid × renderer и обязательные typecheck/build/validate/sim/plugin gates прошли. Независимые code verifier и constructor-integration verifier выдали PASS без findings. После C6 были последовательно приняты migration-only R4.0A `PlayerProfile` v2→v3 и отдельный inert `CampaignRunV1` codec R4.0B; R4.1A теперь поставляет первый opt-in synergy content, а следующий отдельный срез — artifacts/socketing.

### R4 — Rogue-lite Engine

Порядок: общий run/profile contract → synergies → artifacts → wave draft → campaign. Теги считают живые башни; artifacts имеют typed slots и seeded loot; draft блокирует следующую волну до выбора; `CampaignRun` отделён от persistent profile. Campaign nodes расширяются до `battle | elite | merchant | event | boss`, а legacy nodes нормализуются в `battle`.

R4.0A завершает только migration persistent profile. `PlayerProfileV2` остаётся публичным migration-input, canonical `PlayerProfileV3` и alias `PlayerProfile` сохраняют ровно пять прежних доменов: clears, stars, currencies, upgrades и selected difficulty. Источники `v3 | v2 | legacy-array | legacy-object` имеют явные цепочки migration; boot никогда не пишет, а первая явная difficulty/meta/mission mutation сохраняет canonical v3 под прежним ключом. Descriptor-safe bounded capture делает один снимок untrusted graph для decode/serialize/launch/reducers. Future v4+ распознаётся до обхода opaque collections; guarded storage preflight сохраняет точные future bytes даже за текущими collection/json-byte limits, но nested, malformed и final-current duplicate version остаются corrupt/replaceable. Project, mechanics, checkpoint, journal/replay и multiplayer domains не меняются. Срез не добавляет `CampaignRun`, tags, artifacts, draft pause, inventory, Studio navigation или snapshot sections; отдельный codec/export/import был принят следующим R4.0B инкрементом.

R4.0B добавляет только независимый pure-engine `CampaignRunV1` codec. Exact document хранит typed seed, nullable current `nodeId`, ordered deck/artifact instance references и run-resource bag. Definition IDs могут повторяться, instance IDs уникальны внутри своей коллекции; ссылки остаются bounded opaque strings до появления authored rogue content. `createCampaignRun`, `decodeCampaignRun`, `importCampaignRun` и `exportCampaignRun` возвращают detached deep-frozen data и canonical bytes. Descriptor-safe capture читает каждый untrusted container один раз; in-memory future version отклоняется до opaque nested traversal, тогда как JSON import сохраняет жёсткий внешний 1 MiB limit. Это inert transport state: нет reducers, RNG cursor, content cross-reference, Storage/save slots, player/Studio/MCP UI, simulation actions, snapshot/checkpoint/digest sections или изменения capability. Deck, artifact, draft и campaign semantics остаются последующими отдельными opt-in TDD-срезами.

R4.1A добавляет первую gameplay-часть как отдельный opt-in `roguelite` v1. Tower type может иметь bounded unique `tags`; профиль определяет closed damage-synergies и тиры. Runtime считает живые размещённые instances по unique tag: `highest` применяет только максимальный достигнутый tier, `cumulative` — все достигнутые. Эффекты попадают в общий `ModifierSpec` на stage `run` и влияют только на tower-sourced damage. Derived optional `snapshot.roguelite` не дублируется в checkpoint; после restore он восстанавливается из towers. Mechanics Hub и AI/MCP используют один descriptor, `basic_elemental_synergy` recipe и атомарную guarded транзакцию `project.json + mechanics.json + balance.json`. Canvas/Phaser/player читают только snapshot projector. Absent/disabled/unselected путь не добавляет snapshot, UI navigation или runtime modifiers. Артефакты, draft и campaign nodes остаются R4.2+ срезами.

R4.2A/B расширяет только opt-in модуль до `roguelite` v2: closed artifact definitions, typed tower slots и boss loot tables. У активной миссии inventory начинается пустым; убийство врага с таблицей использует отдельный domain-separated seeded RNG, выдаёт монотонный instance ID и событие в порядке `enemyKilled → artifactDropped → enemySpawnedOnDeath`. Только активный v2 checkpoint содержит RNG cursor и battle-local inventory; v1/disabled/unselected путь не меняет RNG, snapshot или checkpoint. Studio и MCP используют `basic_boss_artifact_loot` с явными authored tower/boss IDs и прежнюю guarded транзакцию. Canvas/Phaser показывают read-only inventory из snapshot; `socket` всегда `null`, authored modifiers ещё не применяются, а `CampaignRunV1` не подключён. Контракт закреплён в [ADR 0031](adr/0031-opt-in-roguelite-artifact-loot.md), fixture — `docs/examples/opt-in-boss-artifact-loot/`.

R4.2C активирует authored artifact modifiers только через точные `GameCommandV2` `socketArtifact`/`unsocketArtifact` на реальной межволновой границе. Journal v1 сохраняется для v1-only команд и повышается до v2 первым валидным v2 command; replay принимает обе версии. Inventory является единственным источником assignment, продажа/уничтожение башни сначала автоматически освобождает её слоты. Nested artifact checkpoint v1 сохраняет прежние bytes до первой socket-мутации, после чего v2 хранит nullable `{towerId,slotId}`; outer `GameCheckpointV1` не меняется. Snapshot v3 отдаёт готовые inventory sockets, tower slots и management availability Studio, Canvas/Phaser и renderer projector. Modifiers применяются на stage `run` только к immediate damage точного live tower instance; worst-case preflight и restore отклоняют overflow атомарно. MCP публикует команды и события, но не получает отдельный write tool. См. [ADR 0032](adr/0032-opt-in-roguelite-artifact-socketing.md).

R4.3 реализован как `roguelite` v3 с обязательным `synergies` и независимыми optional-блоками `artifacts?`/`draft?`: включение draft не создаёт inventory, а artifact-only профиль не получает выбор карточек или паузу. Draft описывает closed карточки и weighted pools; отдельный seeded RNG выбирает три уникальные опции без зависимости от порядка входных объектов. Pending offer блокирует ручной и scheduled старт следующей волны и замораживает simulation time/economy/timers до точного `GameCommandV3 chooseDraftOption`; transient events и cursor при этом очищаются согласованно. Выбранные scoped damage modifiers входят в общий stage `run` и совместный worst-case budget. Outer checkpoint остаётся v1 с optional inner draft v1, а draft snapshot получает независимую форму roguelite v4. Restore воспроизводит RNG provenance/default pool и отвергает forged history, лишний выбор или offer после финальной волны. Контракт принят в [ADR 0033](adr/0033-opt-in-deterministic-wave-draft.md); отдельный RED/GREEN цикл не меняет уже принятый R4.2C.

R4.4A добавляет optional `worldMap.campaign` v1 и marker `campaign:{schemaVersion:1}` в закрытый `roguelite` v4 профиль. Граф имеет независимые ID, entry nodes и явные `nextNodeIds`; `battle | elite | boss` ссылаются на миссии, а `merchant | event` пока остаются отображаемыми structural nodes без gameplay. Engine выполняет bounded descriptor-safe нормализацию, cross-reference/DAG/reachability проверку и binary sorting. Legacy `missionNodes` доступны только через read-only battle projection и не активируют новые UI или runtime. `CampaignRunV1` не меняет bytes/version: `nodeId` означает последний завершённый узел, content-aware reducer возвращает отдельные immutable run/profile документы. Campaign находится над battle simulation, не входит в snapshot/checkpoint/replay и не получает автоматическое Storage persistence. Решение описано в [ADR 0034](adr/0034-opt-in-campaign-graph-and-run-lifecycle.md); merchant/event effects и перенос battle-local draft/loot требуют отдельных R4.4B/C циклов.

R4.4B расширяет только independently versioned campaign graph до v2. Корневой `runResources` объявляет доступные run-only ресурсы, а `merchant | event` получают binary-sorted closed choices `{id,label,costs,grants}`. Pure-engine reducer проверяет доступность узла и все costs по исходному балансу, затем атомарно применяет `balance - costs + grants`, удаляет нули и лишь после полного успеха продвигает `CampaignRunV1.nodeId`. Повторный выбор не может выдать награду дважды; RNG, profile currencies, battle snapshot/checkpoint/journal и browser storage не участвуют. Graph v1, roguelite v4 marker и все остальные version domains не меняются. Studio/MCP сохраняют dedicated guarded four-file transaction, а Canvas/Phaser вызывают engine reducer без host-side арифметики. Контракт описан в [ADR 0035](adr/0035-deterministic-campaign-structural-choices.md); перенос battle-local draft/artifact state остаётся отдельным R4.4C.

R4.4C независимо версионирует только campaign marker внутри `roguelite` v4. Marker v1 сохраняет прежний coordinator без battle carry, marker v2 включает `prepareCampaignBattle` и атомарный `settleCampaignBattleVictory`. Run deck действует с первого тика, carried artifacts начинают каждый бой unsocketed, а новые card/artifact IDs получают deterministic launch-scoped provenance. Prepare резервирует aggregate capacity по максимальному оставшемуся пути DAG и проверяет полный modifier budget; лишний loot ограничивается так, чтобы следующий обязательный draft оставался запускаемым. Только активный handoff добавляет nested checkpoint `campaignBattle` v1, draft v2 и artifacts v3; outer checkpoint, commands, journal/replay, profile и `CampaignRunV1` не меняются. Copyable fixture лежит в `docs/examples/opt-in-campaign-battle-handoff/`; решение описано в [ADR 0036](adr/0036-opt-in-campaign-battle-handoff.md).

Финальная приёмка R4.4C: full Vitest 1 994/1 994 и Playwright 46/46 — PASS. Code verifier повторил 179/179 focused handoff/world/checkpoint/journal/replay/digest тестов; constructor verifier — 43/43 contract/package и 5/5 Studio/player browser scenarios. Repair-волны закрыли prototype-key fail-open, stale graph launch, forged/unreachable loot, checkpoint modifier/aggregate/identifier bounds, повторное decode и неканоничный successor order. Studio и оба AI/MCP authoring endpoint сохраняют future nested marker opaque/read-only. Canvas/Phaser × hex/square покрывают click/Enter/Space/touch, import, initial socket, reset, draft, victory, CAS settlement, export и marker-v1/absent paths. Typecheck, engine/build, validate, sim, balance, maps, PWA/single-file, plugin build/validate/smoke и source↔plugin parity прошли; оба независимых sign-off не оставили P0–P3.

Финальная приёмка R4.4B: full Vitest 1 960/1 960 — PASS; оба независимых verifier прогнали общий focused campaign stack 112/112, а campaign Playwright — 3/3. Constructor-проверка покрыла Studio preview → enable → reload → disable → re-enable, AI/MCP `describe → get → preview → guarded apply → validate`, Canvas/Phaser × hex/square, mouse/Enter/Space/touch, explicit import/export, PWA/single-file/web-package/`.tdpack` и inactive/future paths. Code review отдельными RED-регрессиями закрыл предельный aggregate overflow, O(choices × full decode) деградацию generated player и prototype pollution через `__proto__`; повторный sign-off не оставил P0–P2. Typecheck, engine/build, validate, sim, balance, maps, plugin build/validate/smoke и source↔plugin parity прошли. ADR 0035 принят; battle-local draft/artifact handoff остаётся отдельным R4.4C.

Финальная приёмка R4.4A: full Vitest 1 938/1 938 и Playwright 44/44 — PASS; независимый code verifier повторил 123/123 focused tests, а constructor verifier — 79/79 focused surfaces и 3/3 campaign browser scenarios. Исполняемый player-сценарий покрывает active/absent Canvas/Phaser × hex/square, mouse/Enter/Space/touch, выбор узла, победу, guard structural nodes и явный import/export. Studio проходит preview → enable → reload → disable → re-enable и после перехода на v4 продолжает редактировать synergies/tags/artifacts/draft без потери campaign marker; future v5 остаётся полностью read-only. Hostile Proxy/TOCTOU, inactive-warning, stale revision, rollback и symlink-parent-swap regressions закрыты. Typecheck, engine/build, validate, sim, balance, PWA/single-file/web-package/`.tdpack`, plugin build/validate/smoke и source↔plugin parity прошли. Оба независимых sign-off выданы без P0–P2 findings.

Финальная приёмка R4.3: full Vitest 1 902/1 902 и Playwright 41/41 — PASS; engine-focused verifier прогнал 170/170 тестов и отдельные hostile checkpoint/RNG/final-state сценарии, constructor verifier — 129/129 focused surface tests и 10/10 интеграционных Playwright-сценариев. Mechanics Hub проходит enable → edit → save → reload → disable → re-enable и future-v4 read-only. Studio Playtest и generated Canvas/Phaser × hex/square выполняют точный `GameCommandV3 chooseDraftOption` через click, Enter, Space и touch tap; absent/no-draft путь не добавляет UI или pause. PWA, single-file, web-package и `.tdpack` сохраняют v3 draft. Typecheck, engine/build, validate, sim, balance, plugin validate/smoke и source↔plugin parity прошли. После двух verifier-led repair волн оба независимых sign-off выданы без незакрытых P0–P2 findings.

Финальная приёмка R4.2C: full Vitest 1 879/1 879, Playwright 37/37, focused code verification 111/111 и focused constructor surfaces 50/50 — PASS. Исполняемый player-сценарий подтверждает deterministic boss drop и реальные `socketArtifact`/`unsocketArtifact` через Canvas/Phaser × hex/square с click, Enter, Space и touch tap; отдельный Studio Playtest проходит place → drop → inspect → keyboard socket → pointer unsocket. RED на Space выявил и закрепил запрет глобальному pause-hotkey перехватывать native buttons. PWA/single-file, project package/`.tdpack`, typecheck/build/validate/sim/balance, plugin validate/smoke и source↔plugin parity прошли. Независимые code verifier и constructor-integration verifier выдали PASS без незакрытых P0–P2 findings.

Финальная приёмка R4.2A/B: full Vitest 1 872/1 872, Playwright 35/35, focused R4.2 32/32, active Canvas/Phaser × hex/square, Studio v2 lifecycle, PWA/single-file/web-package/`.tdpack`, typecheck/build/validate/sim/balance и plugin gates — PASS. Независимые code verifier и constructor-integration verifier выдали PASS без незакрытых findings; повторные проверки отдельно доказали отказ digest-resigned недостижимого inventory и точный MCP schema с обязательным `bossEnemyTypeId`.

Финальная приёмка R4.1A: full Vitest 1 859/1 859, Playwright 34/34, active Canvas/Phaser × hex/square, Studio lifecycle, PWA/single-file, `packageWeb`/`.tdpack`, typecheck/build/validate/sim/balance и plugin gates — PASS. Независимые code verifier и constructor-integration verifier выдали PASS без незакрытых findings. Контракт закреплён в [ADR 0030](adr/0030-opt-in-roguelite-tower-synergies.md).

### R5 — Heroes и Logistics

Два независимых трека. Heroes получают детерминированное движение, HP/shield, mana/cooldowns, active abilities, skill tree, passive auras и optional blocking только при dynamic navigation. Logistics сначала вводит power components/brownout ordering, затем bounded inventory/ammo/production graph. Без logistics profile сохраняется бесконечное штатное снабжение.

R5.1A отдельно вводит только статический foundation-контракт `heroes` v1. Профиль закрытой формы `{selectedHeroId, definitions}` выбирает одного героя из 1–32 определений `{label, spawn:"core"}`; ID и label ограничены 128 реальными UTF-8 bytes. Активная миссия выводит один immutable unit в `map.coreCoord` и публикует optional `snapshot.heroes` v1 с полями `id`, `definitionId`, `label`, `coord`. Engine остаётся единственным источником selection/spawn, а Canvas и Phaser используют общий fail-closed projector и необязательный `visuals.bindings.heroes` с shape fallback.

В самостоятельном v1-пути R5.1A намеренно нет `moveHero`, hero HP/shield, mana, cooldowns, abilities, skills, auras, blocking, TowerScript scope/events/actions, RNG или mutable runtime state. Поэтому его checkpoint не получает hero-секцию: restore повторно выводит unit из уже привязанного content digest и map core. Missing selected-definition reference является error только для active-selected профиля и warning в выключенном/невыбранном профиле. Движение, GameCommand/Journal v4 и nested hero checkpoint принадлежат отдельному opt-in R5.1B циклу ниже; v1 остаётся byte-compatible.

R5.1A принят 2026-07-26. Начальный независимый RED дал 29 падений из 36 contracts в восьми файлах; verifier-циклы отдельно закрепили revoked/self-revoking Proxy, exact `{q,r}`, own-safe `__proto__` bind/remove и sprite lookup, inherited renderer bindings, Phaser `undefined` coercion и запрет преждевременно рекламировать active hero mechanics. Финальный focused набор — 50/50, full Vitest — 2 042/2 042 в 179 файлах, full Playwright — 49/49. Typecheck, engine/build, validate, sim, balance, maps, web build и plugin build/validate/smoke прошли; source↔plugin parity подтверждена. Независимая constructor-проверка также подтвердила Studio lifecycle, Canvas/Phaser × hex/square, 4 templates × 2 grids × 2 renderers, PWA/single-file/file-URL boot, web-package и `.tdpack` export/import/validate. Code verifier и constructor-integration verifier выдали PASS без открытых P0–P3 findings. Контракт описан в [ADR 0037](adr/0037-opt-in-static-hero-roster-foundation.md), copyable fixture — `docs/examples/opt-in-hero-roster/`; последующий отдельный R5.1B срез принят ниже.

R5.1B принят 2026-07-26 отдельным RED/GREEN-срезом. `heroes` v2 получает собственные
`movementProfiles` и nested `{movementProfileId,speed}` без зависимости от opt-in `navigation`;
движение принимает только exact `GameCommandV4 moveHero`, а checkpoint/journal/replay версии
эволюционируют независимо. `snapshot.heroes` v2 публикует точные nullable target/next/progress,
Canvas и Phaser используют общий fail-closed interpolation/hit-test и хранят selection только в
UI. V1 остаётся статическим, absent/disabled path не получает новых DOM/input/runtime секций.

Независимый engine RED дал 8 ожидаемых падений из 38 focused tests, surface RED — 13 из 32;
последующие verifier RED отдельно закрыли dirty-checkpoint canonicalization, чистоту read-only
snapshot/digest/checkpoint, unsafe map-cell product, terrain references/budgets и lossless Studio
preview. Финальный full Vitest — 2 075/2 075 в 182 файлах; full Playwright — 63/63, включая точную
матрицу `Canvas/Phaser × hex/square × mouse/touch/keyboard`, malformed-v2 preview и полный Studio
v2 lifecycle. `describe_schema` раскрывает shared closed `MovementProfileV1`, а automated MCP flow
проходит `describe → read → recipe → preview → guarded apply → validate → stale revision` без
активации navigation. Typecheck, engine/build, validate, sim, balance, maps, web build,
plugin build/validate/smoke, PWA/single-file/file URL, web-package и `.tdpack` прошли. Независимые
code verifier и constructor-integration verifier выдали PASS без открытых P0–P3 findings. Контракт
зафиксирован в [ADR 0038](adr/0038-opt-in-deterministic-hero-movement.md), copyable v2 fixture —
`docs/examples/opt-in-hero-roster/mechanics-mobile.json`.

R5.2A — отдельный opt-in durability-срез. `heroes` v3 сохраняет полный v2-
контракт и требует для каждого definition точный `durability: {maxHp,shield}`, где
`shield` равен `null` или `{capacity}`. Входящая enemy `towerAttack` проходит общий
`DamagePacket`/`DamageResolver`, затем shield поглощает урон до HP; defeat срабатывает
ровно один раз и блокирует движение. Optional `snapshot.heroes` v3 публикует
`{hp,maxHp,shield,defeated}`, а nested heroes checkpoint эволюционирует в v2 без изменения
внешнего `GameCheckpointV1`, GameCommand/Journal v4 и replay envelope.

Studio редактирует v3 только в Mechanics Hub, MCP/AI раскрывает descriptor и инертный
`basic_durable_commander_hero` через обычный guarded flow, а Canvas/Phaser читают только
авторитетный snapshot/events. Нет mana, abilities, regeneration, revival, auras, blocking и
TowerScript hero actions. V1/v2, absent/disabled/unselected пути не получают durability state. Контракт:
[ADR 0039](adr/0039-opt-in-hero-durability.md); fixture:
`docs/examples/opt-in-hero-roster/mechanics-durable.json`.

R5.2A принят 2026-07-26. Независимые verifier-циклы дополнительно закрепили невозможные
checkpoint-состояния shield/HP, forged hero events, точный MCP event descriptor, невалидные
видимые Studio-значения и source↔plugin parity. Full Vitest прошёл 2 092/2 092 теста в 185
файлах; full Playwright — 68/68. Active v3 acceptance покрывает Canvas/Phaser × hex/square,
движение, HP/shield/defeat cues, PWA, single-file, web package и `.tdpack`; absent, v1 и v2
пути остались совместимыми. Typecheck, engine/build, validate, sim, balance, maps и plugin
build/validate/smoke прошли. Code verifier и constructor-integration verifier выдали PASS без
открытых P0–P3 findings.

R5.3A принят 2026-07-26 как отдельный opt-in срез. `heroes` v4 сохраняет
полный v3-контракт и добавляет bounded mana/regeneration плюс одну inline
enemy-targeted damage ability. Exact `GameCommandV5 useHeroAbility` и journal v5 передают
только authoritative IDs; engine атомарно проверяет outcome, defeat, target, range,
mana и cooldown, а урон идёт через общий `DamageResolver`. Nested heroes checkpoint v3
хранит mana/cooldown без изменения outer `GameCheckpointV1`.

Исходный engine RED дал 13 ожидаемых падений из 66 focused contracts; authoring/player
RED-волны — ещё 12 и 5. Независимый code verifier добавил test-first регрессии
для ended-mission readiness, hostile event↔checkpoint mismatch и двух допустимых
zero-cooldown cast до tick. Constructor verifier закрепил точный MCP stale-revision flow,
Studio lifecycle, public skill и source↔plugin parity. Оба verifier выдали PASS без открытых
P0–P3 findings.

Финальный Vitest — 2 137/2 137 в 190 файлах. Playwright подтвердил все 81 сценарий:
79 прошли в общем прогоне, два тяжёлых legacy single-file сценария, достигшие общего
timeout под параллельной нагрузкой, отдельно прошли 1/1 каждый. Active v4 покрыт
матрицей `Canvas/Phaser × hex/square × mouse/touch/keyboard` (12/12), полным Studio
enable/edit/preview/save/reload/disable/re-enable и PWA/single-file/web-package/`.tdpack`. Typecheck,
engine/build, validate, sim, balance, maps, web build и plugin build/validate/smoke прошли. Контракт:
[ADR 0040](adr/0040-opt-in-targeted-hero-ability.md); fixture:
`docs/examples/opt-in-hero-roster/mechanics-targeted-ability.json`.

R5.4A — отдельный opt-in срез дерева навыков. `heroes` v5 требует
nullable `skillTree`: `null` сохраняет snapshot v4/checkpoint v3, а non-null DAG владеет
battle-local points и модификаторами только hero ability damage. Exact `GameCommandV6
unlockHeroSkill` доступен в setup/чистом non-final interwave; само дерево не
создаёт обязательную паузу. Snapshot v5 остаётся единственным источником
points/availability/unlockability, а nested checkpoint v4 проверяет exact accounting,
dependency order и retained event chain. `CampaignRunV1`, `PlayerProfileV3` и outer checkpoint v1
не меняются; каждый battle начинает дерево заново.

Исходный engine/content RED дал 19 ожидаемых падений при 2 baseline PASS; surface
RED — 28 при 82 baseline PASS и два целевых Playwright RED. Code verifier добавил
отдельные RED для overflow, precondition order, UTF-8 modifier IDs, hostile checkpoint chains,
defeated unlockability и запрета renderer пересчитывать gameplay. Финальный Vitest прошёл
2 186/2 186 тестов в 196 файлах, Playwright — 96/96; focused surface contracts — 106/106,
verifier engine/content/renderer — 39/39, package acceptance для PWA/single-file/web/`.tdpack` —
1/1. Typecheck, engine/build, validate, sim, balance, maps и plugin build/validate/smoke прошли.
Независимые Code Verifier и Constructor Integration Verifier выдали PASS без открытых P0–P3.
Контракт:
[ADR 0041](adr/0041-opt-in-battle-local-hero-skill-tree.md); fixture:
`docs/examples/opt-in-hero-roster/mechanics-skill-tree.json`.

R5.5A завершён как самостоятельный opt-in TDD-срез. `heroes` v6 добавляет required nullable
`passiveAura`, независимую от nullable `skillTree`. Ненулевая аура публикует authoritative snapshot v6 с
бинарно отсортированными `affectedTowerIds`; membership считает только engine
по topology distance от authoritative `currentCoord`. Аура добавляет 1–4 engine-owned
`spatial` modifier только к immediate tower damage и не влияет на DoT, status,
range/fire-rate, hero/mission abilities или другие источники.

Аура не требует дерева навыков: active v6 с tree `null` публикует snapshot v6
с `skills:null`, но продолжает использовать nested checkpoint v3; аура + tree используют
тот же checkpoint v4. Аура `null` сохраняет буквальные snapshot v4/v5 и не
добавляет runtime-работу. `GameCommandV6`, journal v6, outer checkpoint v1,
CampaignRun/Profile и TowerScript не меняются; нового aura event нет. Blocking,
Dynamic Navigation, logistics и TowerScript hero surface остаются отдельными срезами.

Начальный engine/content RED дал 35 ожидаемых падений при 2 baseline PASS; surface RED —
31 падение при 91 baseline PASS. Независимый code verifier добавил отдельные RED для
промежуточного и cross-source numeric overflow, zero-allocation legacy path, terminal renderer
state, impossible-true fail-close и module-wide multi-profile v5→v6 promotion. Финальный Vitest
прошёл 2 257/2 257 тестов в 201 файле, Playwright — 102/102. Constructor acceptance отдельно
подтвердил полный heroes Studio/player lifecycle 55/55, AI/MCP/CLI/renderer/build/package
контракты 154/154, Canvas/Phaser × hex/square, PWA/single-file/web/`.tdpack` и legacy paths.
Typecheck, engine/build, validate, sim, balance, maps и plugin build/validate/smoke прошли.
Независимые Code Verifier и Constructor Integration Verifier выдали PASS без открытых P0–P3.
Контракт: [ADR 0042](adr/0042-opt-in-passive-hero-damage-aura.md); fixture:
`docs/examples/opt-in-hero-roster/mechanics-passive-aura.json`.

R5.6A завершён как отдельный opt-in blocking-срез. `heroes` v7 добавляет required nullable
`blocking:{blockCapacity,movementProfileIds}`. Ненулевая настройка требует выбранный той же миссией
active Navigation v1 `dynamic_flow`; автор явно перечисляет профили, которые герой способен
удерживать, без вывода слоя из ID, label, `terrainMode` или `towerOccupancy`. Engine на каждой
границе движения выбирает до 64 живых врагов на authoritative `currentCoord` героя в binary ID
порядке. Входящий враг занимает свободный слот на границе клетки до траты остатка движения и до
core leak.

Герой не становится occupancy для flow field: blocking не перестраивает NavigationResolver, не
влияет на last-path placement/terraforming и не запускает отдельный поиск. Snapshot v7 публикует
только authoritative `blockedEnemyIds`; держатели выводятся из уже checkpointed hero/enemy state,
поэтому GameCommand/Journal v6, outer checkpoint v1, nested heroes checkpoint v3/v4 и TowerScript
v6 не меняются. `blocking:null` сохраняет буквальный snapshot v4/v5/v6 в зависимости от независимо
включённых tree/aura. Studio и MCP выполняют только явную module-wide v6→v7 promotion с
`blocking:null`, никогда не включая Navigation автоматически.

Начальный engine/content RED дал 44 ожидаемых падения при 8 baseline PASS; surface RED — 32
падения при 49 baseline PASS. Code Verifier нашёл terminal-defeat P2: заранее вычисленный holder
мог пережить переход в defeat после более раннего неблокируемого core leak. Отдельный regression
воспроизвёл ошибку RED 1/1, после минимального исправления прошёл 1/1; повторный verifier run дал
121/121 focused и 508/508 expanded PASS. Финальный Vitest прошёл 2 325/2 325 тестов в 206 файлах,
Playwright — 107/107. Constructor Integration Verifier отдельно подтвердил 168/168 вертикальных
контрактов, 61/61 Heroes regression, stale/rollback 4/4, v7/future-v8 E2E 6/6, template contracts
19/19 и полный browser matrix. Typecheck, engine build, validation, tutorial simulation, balance,
map compile, web build и plugin build/validate/smoke прошли. Оба независимых verifier выдали PASS
без открытых P0–P3. Контракт: [ADR 0043](adr/0043-opt-in-dynamic-hero-blocking.md); fixtures:
`docs/examples/opt-in-hero-roster/mechanics-blocking.json` и
`docs/examples/opt-in-hero-roster/mission-blocking-selection.json`.

R5.7A завершён как первый независимый Logistics-срез. `logistics` v1 получает required nullable
`power`; null и отсутствие выбора сохраняют literal infinite-supply legacy path. Non-null профиль
явно назначает tower types в непересекающиеся generators, relays и fire-capable consumers. Engine
строит topology/footprint-aware connected components только при dirty placement/move/sell/destroy,
назначает consumer ближайшему covering node и выполняет full-demand prefix allocation по priority,
затем binary tower instance ID. Brownout замораживает точный cooldown и все fire/pulse effects;
после питания башня продолжает штатный отсчёт/атаку.

Snapshot v1 является единственным источником components, links, coverage и powered IDs для Studio,
Canvas и Phaser. Сеть полностью выводится из уже checkpointed towers/content, поэтому commands,
events, checkpoint, journal, profile, CampaignRun и TowerScript не меняются. `basic_power_grid`
остаётся инертным recipe; Studio/MCP не создают tower types и не включают/выбирают модуль. Ammo,
inventory, storage, factory, production и transfer graph остаются отдельным следующим TDD-срезом.

Первичные независимые RED-волны дали 42 content, 23 runtime и 23 constructor failure при сохранении
legacy compatibility passes. Проверяющие отдельно воспроизвели и закрыли pulse без питания,
resource-bound graph, `hp<=0`, checkpoint-order digest, premature brownout, hostile snapshot и
data-only overlay дефекты. Финальный Vitest прошёл 2 465/2 465 тестов в 214 файлах, Playwright —
112/112. Code Verifier подтвердил 142/142 focused contracts; Constructor Integration Verifier —
41/41 focused и 6/6 Chromium scenarios, включая Studio/MCP guarded flow, Canvas/Phaser × hex/square,
package/template matrix и plugin parity. Typecheck, engine build, validation, tutorial simulation,
balance, map compile, web build и plugin build/validate/smoke прошли. Оба независимых verifier выдали
PASS без открытых P0–P3. Accepted contract: [ADR 0044](adr/0044-opt-in-logistics-power-grid.md);
fixture: `docs/examples/opt-in-logistics-power/`.

R5.8A спроектирован отдельным от power grid и factory/transfer инкрементом. Logistics v2 сохраняет
required nullable `power` и добавляет required nullable `ammunition`: author-defined ammo types и
один локальный магазин для выбранного fire-capable tower type. Engine расходует authored amount
ровно один раз на успешную attack activation; secondary targets/effects бесплатны, no-target не
расходует ammo, а depleted gate замораживает точный cooldown до конца жизни экземпляра. Mutable
amount получает отдельный nested Logistics checkpoint state и authoritative snapshot v2.

R5.8A намеренно не вводит refill API/command, factories, production, storage или transfer graph.
Same-instance refill/resume вместе с supply ordering будет отдельным R5.8B, не меняющим установленный
gate order и activation cost. Независимые RED-волны зафиксировали content/runtime/surface контракты;
Code Verifier дополнительно нашёл и через отдельные RED→GREEN циклы закрыл повторный target lookup
после exhaustion, legacy helper overhead и prototype-sensitive IDs. Финальные Vitest 2 651/2 651 и
Playwright 117/117 прошли; оба независимых verifier выдали PASS без P0–P3. Accepted contract:
[ADR 0045](adr/0045-opt-in-local-ammunition.md); fixture:
`docs/examples/opt-in-local-ammunition/`.

R5.8B завершён отдельным финальным Logistics-срезом. Logistics v3 добавляет required nullable
`supply`: production recipes, producer/storage compartments и bounded directed transfer graph с
фиксированным topology-aware ordering. Production и outgoing transfer учитывают authoritative power
и disruption; план transfer атомарен, incoming stock не пересылается в том же tick, а refill может
возобновить ready tower без изменения cooldown. Mutable stock/progress получает nested Logistics
checkpoint v2 и authoritative snapshot v3. Ручных refill/transfer commands, TowerScript действий,
сырья, conveyor routing и renderer-owned симуляции нет.

Независимые RED-волны покрыли content, runtime и surfaces. Code Verifier нашёл и через отдельные
RED→GREEN циклы закрыл полный `storage→consumer` topology, строгий `supply:null` checkpoint limit,
recipe/capacity invariant, линейную edge grouping и точный diagnostic. Финальные Vitest
2 800/2 800 в 230 файлах и Playwright 122/122 прошли. Code Verifier подтвердил 442/442 focused
engine contracts; Constructor Integration Verifier — 98/98 focused surface/package contracts и
15/15 Logistics Chromium scenarios. Typecheck, engine/build, validation, tutorial simulation,
balance, map compile, web build, plugin build/validate/smoke, harness audit и diff checks зелёные.
Оба независимых verifier выдали PASS без P0–P3. Accepted contract:
[ADR 0046](adr/0046-opt-in-ammunition-supply.md); fixture:
`docs/examples/opt-in-ammunition-supply/`.

### R6 — TowerScript DX 2.0

R6 — opt-in authoring/debug capability, а не новый `mission.mechanics` module. Обычная симуляция,
Studio Playtest и generated players не создают trace/ring/graph state, пока разработчик явно не открыл
Graph или debug session. Project v3, TowerScript v6, `GameSnapshot`, outer `GameCheckpointV1`,
GameCommand/Journal v6, profile, CampaignRun, mechanics и multiplayer version domains не повышаются.

Engine-срез реализует independently versioned trace v1, graph v1 и debugger/cursor v1. Бounded
structured trace следует реальному порядку
`event → binding → handler → condition → action → state_diff/diagnostic`; без collector runtime не
удерживает trace. `TowerScriptDebugSession` двигает live game через существующий journal, хранит
bounded checkpoint ring и поддерживает `tick | event | handler | action`. Historical stepping
восстанавливает validated pre-checkpoint и повторяет ту же команду до cursor в том же engine runtime;
inspection frame имеет `live:false` и не заменяет live game. Rewind восстанавливает retained checkpoint,
пересобирает точный journal prefix и отбрасывает abandoned future. Engine/content/checkpoint/digest
mismatch отклоняется fail-closed.

Visual Graph остаётся lossless-проекцией канонического `scripts/**/*.tower.json` AST. Stable AST paths
и detached raw payload позволяют сохранить неизвестные future nodes без downgrade; duplicate/dangling
graph и invalid materialized script не записываются. Completion, node palette и help генерируются из
engine `TOWER_SCRIPT_SCHEMA`, включая events, actions, operators и scopes. Layout v1 хранит только
позиции/viewport под `.towerforge/towerscript-layouts/`, имеет composite script+layout revision и не
попадает в gameplay hash, PWA, single-file, web/native packages, `.tdpack` или generated players.

Surface-контракт фиксирует CLI confined layout codec; MCP/AI
`get_tower_script_graph → preview_tower_script_graph → apply_tower_script_graph(ifRevision) → validate_project`
и compute-only `preview_tower_script_trace` с лимитом 128 `GameCommand`;
Studio `GET /api/towerscript/schema`, `GET /api/project/script/graph`, отдельные preview/apply endpoints,
JSON/Graph switch и явный Playtest debugger. Preview не пишет, apply требует exact revision и сохраняет
canonical AST через validation/backup/rollback. Raw future nodes остаются видимыми и read-only, если
текущий engine не может подтвердить их schema.

R6 accepted: focused engine journal/trace/graph/debugger 101/101, CLI/MCP/Studio 39/39, full unit
239 files / 2876/2876, Studio Playwright 2/2 и independent packaging/conformance 23/23 GREEN. Typecheck, engine/build, validation,
tutorial simulation, balance, map compile, web build и plugin build/validate/smoke проходят.
Journal append и trace-checkpoint pruning имеют bounded incremental hot path без роста от
длины history. Оба независимых verifier выдали APPROVED без P0-P2.
Архитектурная граница зафиксирована в [ADR 0047](adr/0047-towerscript-dx-2.md).

### R7 — Director и Generative Studio

Четыре отдельные поставки: deterministic AI Wave Director из authored counter pool; cancellable auto-balancer с evidence-only patch proposals; prompt → `MapGenerationSpec` → локальный seeded generator; provider-neutral asset hooks со staging, preview, MIME/signature/size/license/provenance validation и явным commit. Автоматический commit баланса и сохранение секретов в проект запрещены.

### R8 — Multiplayer protocol и local transport

Pure `MatchSession` владеет fixed tick, ordered commands, ownership и checksums. Co-op использует одну simulation instance; asymmetric mode связывает две instance атомарным `sendEnemy`. Сначала поставляются offline challenges, in-memory/local transport, versioned WebSocket adapter contract, handshake, reconnect и desync diagnostics. Hosted lobby, auth, accounts и matchmaking — отдельный deployment milestone.

## TDD и роли

Каждый небольшой вертикальный срез проходит цикл **RED → GREEN engine → GREEN surfaces → refactor → code verification → constructor integration verification**.

1. Program architect фиксирует зависимости, ADR и критерии приёмки.
2. Contract/test designer сначала добавляет падающие contract, migration и acceptance tests.
3. Engine implementer доводит чистый TypeScript engine до green.
4. Surface implementer добавляет Studio, MCP/AI, Canvas/Phaser, CLI/build и документацию.
5. Code verifier независимо проверяет корректность, детерминизм, безопасность и edge cases.
6. Constructor integration verifier независимо проверяет enable/edit/save/reload/disable/re-enable, AI flow, player/package и legacy path.

Автор реализации не выполняет ни один из двух sign-off. Фаза считается завершённой только вместе с opt-in reference fixture, disabled-capability regression и затронутыми release gates из `AGENTS.md`.

## Запрещённые объединения

- Damage resolver и reactions.
- Checkpoint/replay и multiplayer.
- Dynamic navigation и route-breaking terraforming.
- Новые TowerScript actions и Visual Graph.
- Profile migration и rogue content.
- Power grid и factory/ammo logistics.
- Procedural maps и asset hooks.

Эти пары требуют отдельных RED/GREEN циклов и отдельных sign-off, даже если используют общий контракт.

## Сквозные критерии

- Старые golden snapshots, starter и матрица `4 templates × 2 grids × 2 renderers` не меняются при выключенных механиках.
- Каждый модуль имеет valid/invalid/future-version/cross-reference tests и отдельный opt-in fixture.
- Headless, mouse, keyboard и touch команды интерактивных механик воспроизводят один digest.
- Studio и AI предоставляют эквивалентный путь `describe → read → preview → guarded apply → validate`.
- Single-player bundle не включает multiplayer runtime, пока модуль не активирован.
- Все авторские правила остаются typed JSON/TowerScript без `eval`, JavaScript, host APIs или network.

Архитектурное решение по R0A зафиксировано в [ADR 0011](adr/0011-opt-in-versioned-mechanics.md), единый damage pipeline — в [ADR 0012](adr/0012-shared-damage-pipeline.md), engine/player-runtime persistence boundary — в [ADR 0016](adr/0016-player-profile-runtime-and-persistence.md), opt-in shields — в [ADR 0018](adr/0018-opt-in-combat-shields.md), armor matrix — в [ADR 0019](adr/0019-opt-in-armor-matrix.md), marks/vulnerabilities — в [ADR 0020](adr/0020-opt-in-vulnerability-marks.md), а elemental reactions — в [ADR 0021](adr/0021-opt-in-elemental-reactions.md). Границы пакетов и version domains описаны в [ARCHITECTURE.md](../ARCHITECTURE.md).

## Существующая основа

До этой программы уже поставлены deterministic balance sweep, Studio AI Chat, author feedback loop, четыре genre templates, arbitrary currencies, universal tower pipeline, difficulty/meta progression, hex/square topology, Canvas/Phaser conformance, themed tile packs, TowerScript v2, web/native packaging и `.tdpack` handoff. Они являются regression baseline, а не обязательными зависимостями новых mechanics modules.

## Параллельный продуктовый трек

Механики не отменяют ранее запланированный distribution flywheel: one-click publish с явной целью размещения, локально переносимую gallery/remix-модель и opt-in creator monetization hooks. Эти работы не должны ослаблять local-first ownership, project-relative writes или offline-capable build. Hosted publishing, accounts, matchmaking, signing и store submission остаются отдельными deployment/release milestones.
