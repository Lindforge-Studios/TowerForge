# TowerForge Design System

Статус: **нормативный стильгайд продукта**

Область: TowerForge Studio, desktop shell, встроенный player shell, HUD Studio и проектные preview

Последняя сверка с реализацией: 2026-08-04

`DESIGN.md` определяет визуальный язык и UX-инварианты TowerForge. Брендовые исходники и правила экспорта находятся в [`docs/brand.md`](docs/brand.md), архитектурные границы — в [`ARCHITECTURE.md`](ARCHITECTURE.md), а data-only контракт пользовательского HUD — в [`docs/adr/0062-r21-player-shell-hud-constructor.md`](docs/adr/0062-r21-player-shell-hud-constructor.md).

## 1. Характер продукта

TowerForge — точный и спокойный инструмент для создания игр, а не fantasy-интерфейс внутри одной конкретной игры.

Визуальный язык должен ощущаться как:

- инженерный: понятные состояния, сетка, выверенные отступы, минимум декоративного шума;
- авторский: игра и её ассеты остаются в центре внимания;
- детерминированный: preview, validation, revision и save визуально различимы;
- локальный и безопасный: внешние действия и необратимые операции всегда явны;
- плотный, но читаемый: Studio вмещает сложные инструменты, не превращая их в стену серого текста.

Избегаем средневековых гербов, декоративного огня, маскотов, неонового cyberpunk, стеклянных панелей без необходимости и стилизации Studio под конкретную игру.

## 2. Границы дизайн-системы

В TowerForge существуют четыре независимых визуальных слоя.

| Слой | Кто задаёт | Что допускается |
| --- | --- | --- |
| Product chrome | Команда TowerForge | Studio, системные диалоги, validation, project tree, desktop lifecycle и recovery UI |
| Engine boot identity | TowerForge | Обязательный inline splash `Made with TowerForge` во всех официально сгенерированных играх |
| Built-in player shell | TowerForge | Безопасный запасной HUD для desktop/responsive target без выбранного HUD profile |
| Project presentation | Автор игры | Theme assets, camera profiles, Procedural Juice и `HudCatalogV1` через валидируемые data-only contracts |

Правила:

- тема проекта не перекрашивает Studio и системный recovery overlay;
- project presentation и HUD не заменяют, не перекрывают и не отключают engine boot identity;
- renderer рисует игровой мир, DOM player shell — экранный HUD;
- HUD не владеет gameplay-правилами, world projection или доступом к native bridge;
- пользовательские HTML, CSS, JavaScript, произвольные шрифты и URL не являются частью HUD-контракта;
- отсутствие opt-in presentation-файлов сохраняет legacy UI и bundle.

## 3. Бренд

Основная идея знака: hex-grid + башня + точная сборка в кузнице. Название продукта всегда пишется **TowerForge**.

Короткая формула продукта: **Build tower-defense games. Visually, deterministically, with AI.**

Основные брендовые цвета:

| Token | Значение | Роль |
| --- | --- | --- |
| Forge Black | `#111111` | Базовый тёмный фон |
| Graphite | `#1A1A1A` | Панели и тело знака |
| Iron | `#E8E8E8` | Основной текст и силуэт |
| Forge Green | `#7EB87E` | Главное действие, active и success |
| Blueprint Blue | `#6EA8D8` | Технические связи, preview и tooling |
| Spark Amber | `#E8A44A` | Warning и редкие акценты |

Green — доминирующий акцент. Blue не заменяет primary action. Amber не используется как постоянная заливка больших областей. Красный зарезервирован для ошибки или разрушительного действия.

Для знака сохраняется свободное поле не меньше четверти его ширины. Ниже 24 px используется монохромная версия. Не вращать, не перекрашивать отдельные плоскости и не размещать знак на шумном изображении.

## 4. Product tokens

Каноническая реализация токенов Studio находится в [`packages/studio/public/styles.css`](packages/studio/public/styles.css). Новый интерфейс использует semantic variables, а не копирует hex-значения в компоненты.

### 4.1 Dark theme

| Token | Значение | Применение |
| --- | --- | --- |
| `--bg` | `#111111` | Рабочая область самого нижнего уровня |
| `--surface` | `#1A1A1A` | Sidebar, topbar, основные панели |
| `--surface-2` | `#212121` | Вложенные панели и карточки |
| `--surface-3` | `#2A2A2A` | Inputs, hover и самый высокий постоянный surface |
| `--border` | `#2E2E2E` | Разделители |
| `--border-2` | `#3C3C3C` | Контрольные границы и hover |
| `--text` | `#E8E8E8` | Основной текст |
| `--text-muted` | `#A3A3A3` | Вторичный, но читаемый текст |
| `--text-dim` | `#737373` | Только несущественные подписи и disabled metadata |
| `--accent` | `#7EB87E` | Active, focus, primary hover, success |
| `--accent-dim` | `#4F8A4F` | Primary control resting state |
| `--blue` | `#6EA8D8` | Техническая информация и связи |
| `--warn` | `#E8A44A` | Предупреждение и dirty state |
| `--err` | `#E05555` | Ошибка и destructive action |
| `--purple` | `#A07EC8` | Редкие отдельные домены, не общий акцент |

`--text-dim` имеет контраст около `3.98:1` на `--bg`: его нельзя использовать для инструкций, значений формы, длинного текста и текста меньше 14 px, от которого зависит действие пользователя. Для таких случаев применяется `--text-muted`.

### 4.2 Light theme

Light theme является полноценным режимом, а не инверсией:

| Token | Значение |
| --- | --- |
| `--bg` | `#F2F4EF` |
| `--surface` | `#FFFFFF` |
| `--surface-2` | `#EEF1EC` |
| `--surface-3` | `#E3E7DF` |
| `--border` | `#D9DDD1` |
| `--border-2` | `#C3C9BB` |
| `--text` | `#18201A` |
| `--text-muted` | `#586056` |
| `--text-dim` | `#6B726A` |
| `--accent` | `#2F6B34` |
| `--warn` | `#9A5A12` |
| `--err` | `#B5302B` |
| `--blue` | `#265F93` |

Компонент должен работать в обеих темах без локальных dark-only цветов. Исключения допустимы для canvas/stage, скриншотов и игрового мира.

### 4.3 Geometry and motion

| Token / правило | Значение |
| --- | --- |
| Основной радиус | `5px` |
| Большой радиус | `8px` |
| Диалог/player floating surface | `10–12px` |
| Базовая тень | `0 2px 10px rgba(0,0,0,.5)` в dark theme |
| Быстрый transition | `130ms ease` |
| Topbar | `46px` |
| Sidebar | `210px`, collapsed `48px` |
| Player touch target | не меньше `44×44px` |

Отступы строятся преимущественно на шагах `4, 6, 8, 10, 12, 14, 16, 20, 24px`. Внутри одного компонента предпочтительнее не более трёх разных шагов.

Animation используется для объяснения изменения состояния, а не для украшения. Все эффекты обязаны поддерживать `prefers-reduced-motion`; simulation timing от presentation-эффектов не зависит.

## 5. Typography

Основной стек:

```css
--font: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
--mono: "JetBrains Mono", "Fira Code", ui-monospace, monospace;
```

- Studio body: `13px / 1.5`;
- panel title: `13.5–15px`, weight `600`;
- field label: `11px`, weight `500`;
- section eyebrow: `9.5–10px`, weight `700`, uppercase, tracking `0.6–0.8px`;
- compact metadata: `9.5–11.5px`, mono только для ID, revision, code, numeric contracts и machine state;
- player body: минимум `12px`; narrative text обычно `16px / 1.55`.

Не использовать mono для обычных объяснений. Не использовать uppercase для предложений и длинных подписей. Числа в меняющихся counters используют tabular numerals.

## 6. Layout

### 6.1 Studio shell

Базовая композиция: фиксированный topbar, левый navigation rail, одна основная рабочая область и опциональные drawers/overlays.

- Topbar содержит identity проекта, global status, Validate, Simulation, Save и AI entry point.
- Sidebar группирует инструменты по смыслу; active item выделяется одновременно цветом, фоном и левой полосой.
- Сложный редактор использует master-detail: список сущностей слева, содержимое справа.
- Нижний workbench предназначен для Problems и Activity, а не для постоянной навигации.
- Плотные формы разбиваются на именованные sections. Скрытая capability не оставляет пустые disabled-поля.

При ширине до `1040px` сложные grid editors переходят в вертикальную композицию. До `680px` sidebar сворачивается до иконок. Это режим доступности Studio, а не замена mobile player.

### 6.2 Large-screen player

Встроенный desktop player держит игровой мир главным объектом:

- status strip сверху;
- build/action bar снизу;
- contextual panel справа;
- modal surfaces для settings, pause, result и recovery;
- persistent HUD в обычном бою занимает не более 25% viewport;
- pan/zoom не срабатывают под modal, menu, radial menu или text input.

Camera projection (`top_down`, `isometric_2_1`, `dimetric_oblique`) меняет только представление мира. HUD остаётся screen-space DOM.

### 6.3 Generated-game boot splash

Официальный player начинается с системной поверхности `Made with TowerForge`: canonical mark,
короткая подпись и спокойный индикатор загрузки. Splash встроен inline, не зависит от сети,
занимает весь viewport до готовности runtime и уступает место recovery overlay при ошибке. Минимум
показа предотвращает визуальный flash, а `prefers-reduced-motion` отключает декоративное движение.
Проект может показывать собственный studio/game logo следующим экраном, но не получает настройку
для удаления, замены или имитации engine credit.

R22 оформляет следующий экран как opt-in playlist выбранной цели сборки: от одного до восьми
статичных локальных PNG/JPEG/WebP. Первый системный слот всегда заблокирован, а пользовательские
слоты используют спокойные `cut`, `fade` или `fade_scale`, доступную подпись и необязательный
короткий caption. По умолчанию создаётся только несохранённый второй слот; пустой слот нельзя
сохранить. Центр экрана остаётся свободным от навигации, кроме неброской кнопки «Пропустить
заставки»; `prefers-reduced-motion` убирает переходы, но не обязательное время показа.

## 7. Components

### 7.1 Buttons

- Primary: одно главное действие в локальном контексте; resting `--accent-dim`, hover `--accent`.
- Outline: вторичное действие.
- Danger: удаление, reset, destructive replace; требует ясного глагола и при необходимости confirm.
- Icon-only: только знакомое действие, обязательны accessible name и tooltip/help.
- Disabled: сниженная opacity плюс недоступность в action registry; цвет не является единственным объяснением.

Текст кнопки начинается с действия: «Создать проект», «Проверить», «Сохранить», «Откатить». Не использовать «OK» там, где можно назвать результат.

### 7.2 Forms

- Label всегда видим; placeholder не заменяет label.
- ID, JSON, revision и числовые gameplay-поля используют mono.
- Focus: `2px` accent outline или эквивалентное accent ring.
- Changed: amber border; invalid: red border + локальное сообщение.
- Ошибка появляется рядом с полем и дополнительно попадает в Problems, если влияет на проект.
- Save недоступен без валидного dirty state; guarded writes показывают revision conflict отдельно от validation error.

### 7.3 Cards, lists and tables

- Card применяется для отдельной сущности или workflow, а не как обёртка каждого текста.
- Selected row обозначается фоном и border/accent marker.
- Таблицы выравнивают числовые значения, сохраняют заголовок и не прячут критическое значение только в tooltip.
- Empty state объясняет, почему область пуста, и предлагает ровно одно наиболее вероятное следующее действие.

### 7.4 Feedback

| Состояние | Визуальный паттерн |
| --- | --- |
| Success | Green icon/border + короткий результат |
| Warning / dirty | Amber marker + причина или следующий шаг |
| Error | Red marker + предметная формулировка + восстановимое действие |
| Info / preview | Blue или neutral surface; не выглядит как committed change |
| Loading | Локальный spinner/skeleton; не блокировать весь Studio без необходимости |

Toast сообщает о завершённом кратком событии. Ошибка, требующая решения, остаётся в контексте или Problems и не исчезает только вместе с toast.

Dialog используется для блокирующего решения. Drawer — для вспомогательного длительного workflow. Popover — для короткого контекстного выбора.

## 8. HUD authoring

`HudCatalogV1` — ограниченная дизайн-система конечной игры, а не способ внедрить разметку.

Обязательные responsive variants:

| Variant | Design viewport | Default range |
| --- | --- | --- |
| Desktop | `1920×1080` | `≥1200px` |
| Tablet | `1024×768` | `768–1199px` |
| Mobile | `390×844` | `<768px` |

Допустимые layers: `background`, `content`, `overlay`, `modal`, `system`. System recovery overlay принадлежит TowerForge и не может быть удалён или перекрыт проектом.

Компонентные состояния: `normal`, `hover`, `pressed`, `disabled`, `selected`, `focused`. Каждый интерактивный элемент проектируется как минимум для `normal`, `disabled` и `focused`; pointer UI также требует `hover` и `pressed`.

Build-menu presets:

- desktop horizontal quickbar;
- vertical edge dock;
- category catalog drawer;
- radial wheel;
- contextual tile popover;
- mobile bottom sheet;
- keyboard command palette.

Radial menu содержит не больше 12 одновременно видимых действий. Repeater и dynamic collection обязаны сохранять stable item identity. Mouse, keyboard, gamepad и touch используют один action descriptor, а не четыре набора gameplay-логики.

## 9. Assets and world presentation

- UI ссылается на sprite IDs из `content/visuals.json`, не на host paths или external URLs.
- Поддерживаются image/icon, atlas frame и nine-slice metadata через guarded asset pipeline.
- Project-authored camera variants имеют billboard fallback; missing optional variant — warning, missing required material — error.
- Camera Studio и HUD Studio показывают coverage, clipping, depth, overlap, contrast и touch-target diagnostics до save.
- Generated assets проходят staging → preview → MIME/license/provenance validation → guarded commit.
- Логотип, название, legal copy и размеры экспорта никогда не генерируются моделью изображения.

Gameplay feedback (particles, shake, hit stop, audio cues) остаётся событием presentation layer. Оно не скрывает target, route, resource state или actionable HUD больше необходимого и отключается/ослабляется quality и reduced-motion settings.

### 9.1 macOS disk image

DMG — короткая install surface, а не пустое Finder-окно. Он использует компактный фиксированный
viewport, app слева, Applications справа и одну явную стрелку между ними. Фон следует product
tokens, не конкурирует с системными icon labels и содержит только короткую install-инструкцию;
runtime, signing и trust-state из оформления не имитируются.

## 10. Accessibility and input

Минимальный стандарт нового UI:

- контраст текста WCAG AA: `4.5:1` для обычного текста, `3:1` для крупного текста и значимых границ;
- видимый `:focus-visible` на каждом interactive element;
- semantic DOM и accessible name для icon-only controls;
- логичный focus order и возврат focus после dialog/drawer;
- touch target не меньше `44×44px` в player и HUD;
- цвет не является единственным носителем состояния;
- canvas interaction имеет keyboard alternative или DOM control;
- layout учитывает safe-area insets, zoom, DPR 1/2 и viewport от `390×844` до `3440×1440`;
- интерфейс остаётся работоспособным при reduced motion и без procedural effects.

Скроллируемая область должна иметь явного владельца высоты (`min-height: 0` внутри flex/grid) и доступный `overflow: auto`. Нельзя блокировать wheel/pointer events глобально, если курсор находится над editor, tree, dialog body или длинным inspector.

## 11. Language and microcopy

Studio имеет русский первичным документируемым языком и английский каталог. Новая пользовательская строка не встраивается в шаблон напрямую, если поверхность уже поддерживает i18n.

- Пишем коротко и предметно: что произошло, с чем и что делать дальше.
- Термин используется одинаково во всех поверхностях: project, mission, map, build target, HUD profile, camera profile, preview, apply, rollback.
- Не показываем внутренние сокращения без расшифровки. Например: «Политика доступа (ACL)», затем допустимо «ACL».
- Не выводим `undefined`, raw exception или stack trace как пользовательское сообщение.
- Ошибка: «Не удалось открыть проект: доступ запрещён политикой desktop bridge» лучше, чем «Command failed».
- Подтверждение называет последствие: «Удалить башню из проекта?» вместо «Вы уверены?».

## 12. Implementation rules

Новый Studio-компонент:

1. переиспользует semantic tokens;
2. имеет keyboard/focus/disabled/error состояния;
3. работает в dark и light themes, normal и compact density;
4. не дублирует engine, renderer или player-runtime правила;
5. использует локализуемые строки;
6. проверяется на узкой ширине и в scroll container;
7. не добавляет новый цвет, радиус или shadow без обновления этого файла.

Новый project-authored HUD-компонент:

1. добавляется в closed descriptor/schema;
2. проходит own-data validation и budgets;
3. связывается только с разрешённым selector/action ID;
4. реализуется один раз в DOM player shell для Canvas и Phaser;
5. имеет preview diagnostics, legacy-off path и package parity;
6. не получает engine instance, filesystem, network или native bridge.

## 13. Review checklist

Перед принятием UI-изменения проверяем:

- [ ] Понятна визуальная иерархия без цвета.
- [ ] Основной текст не использует `--text-dim`.
- [ ] Есть hover, active, focus, disabled, loading и error там, где применимо.
- [ ] Длинные значения не ломают layout: wrap, ellipsis или scroll выбраны осознанно.
- [ ] Нет недоступной scroll area и захваченного wheel input.
- [ ] Dark/light и normal/compact не расходятся функционально.
- [ ] Keyboard и pointer проходят один action path; player дополнительно проверен touch/gamepad, если они поддерживаются.
- [ ] Все действия имеют доступные названия и локализуемые строки.
- [ ] Destructive и external actions требуют явного намерения.
- [ ] Canvas/Phaser и hex/square не получают разную screen-space логику.
- [ ] Custom HUD отсутствует в legacy bundle, пока не выбран профиль.
- [ ] Recovery overlay остаётся доступен при malformed/future HUD.
- [ ] Скриншоты или preview проверены на целевых viewport и DPR.

## 14. Sources of truth

| Тема | Канонический источник |
| --- | --- |
| Принципы и UI-правила | `DESIGN.md` |
| Название, логотип, брендовые экспорты | `docs/brand.md` |
| Реализованные Studio tokens/components | `packages/studio/public/styles.css` |
| Player CSS и built-in shell | `packages/cli/build.mjs` |
| HUD schema и budgets | `packages/player-runtime/src/hud-catalog.mjs` |
| HUD DOM semantics | `packages/player-shell/src/hud-dom-runtime.mjs` |
| Camera projection | `packages/renderer/src/camera-projector.mjs` |
| Architecture boundaries | `ARCHITECTURE.md` и `docs/adr/` |

Если реализация и этот документ расходятся, исправление должно явно выбрать источник истины: багфикс приводит код к гайду; сознательное изменение дизайн-системы сначала обновляет `DESIGN.md`, затем tokens/components и проверки.
