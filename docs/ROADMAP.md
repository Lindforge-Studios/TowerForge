# TowerForge — Roadmap расширяемых механик

Последняя проверка: 2026-07-25

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
| R3.4b | Foundation + C1/C2A/C2B1 приняты | Dynamic provenance collector готов; C2B2 подключает prepared safety set и solver budgets до resolver construction |
| R4–R8 | Запланированы | Каждый срез закрывает engine, Studio, AI/MCP, renderers/player, docs и два независимых sign-off |

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

Foundation и runtime C1/C2A R3.4b приняты 2026-07-25 по [ADR 0027](adr/0027-opt-in-transactional-terraforming.md). Engine публикует независимый opt-in `terraforming` v1, точные authoring/runtime budgets, mission-scoped capability и transition validation, TowerScript v6 `terraformTiles`, событие `elevationChanged`, стабильные failure reasons и optional diagnostic `reasonKey`. C1 транзакционно планирует persistent `set_terrain`/`restore_terrain` batches на `authored_routes`. C2A добавляет detached baseline/candidate flow-field preflight для каждого movement-profile × route endpoint и live current/in-progress-next source, один field на profile+numeric goal, global repair/block classification и атомарную adoption resolver/cache/enemy links до compatibility cues и событий. Failed candidates не меняют live navigation identities или stats; dead-yet-unreaped enemies переносят только field association без rebind/query. C2B1 добавляет pure internal canonical spawn-provenance collector: wave, transitive death/phase и mission-reachable TowerScript v1–v6 handlers, включая applied-handler-only fixpoint для legacy и terraforming terrain destinations; disabled/unreachable scripts не расширяют graph. Collector capability-neutral, не фильтрует `towerOccupancy` и пока не меняет runtime. C2B2 подключает graph к solver-free prepared safety set, exact pre-construction budgets, 500/1000 sharing и permutation/load gates. Elevation, duration/expiry groups, checkpoint state, legacy adapters и Studio/MCP/renderer surfaces остаются последующими срезами.

### R4 — Rogue-lite Engine

Порядок: общий run/profile contract → synergies → artifacts → wave draft → campaign. Теги считают живые башни; artifacts имеют typed slots и seeded loot; draft блокирует следующую волну до выбора; `CampaignRun` отделён от persistent profile. Campaign nodes расширяются до `battle | elite | merchant | event | boss`, а legacy nodes нормализуются в `battle`.

### R5 — Heroes и Logistics

Два независимых трека. Heroes получают детерминированное движение, HP/shield, mana/cooldowns, active abilities, skill tree, passive auras и optional blocking только при dynamic navigation. Logistics сначала вводит power components/brownout ordering, затем bounded inventory/ammo/production graph. Без logistics profile сохраняется бесконечное штатное снабжение.

### R6 — TowerScript DX 2.0

Structured trace и step modes работают через checkpoint + deterministic replay-to-cursor. Visual Graph является lossless-проекцией канонического TowerScript AST; layout хранится в `.towerforge/`. Неизвестные future nodes сохраняются raw. Invalid graph никогда не записывается, а completion генерируется из engine schema descriptors.

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
