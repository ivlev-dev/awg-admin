# Дизайн-система AWG Admin — Material You (M3)

Документ фиксирует визуальный язык панели: Material 3 на базе существующей
navy-палитры. Палитра не меняется на «дефолтный M3»: все роли выводятся из
наших брендовых цветов. Пилот внедрения — «Клиенты», «Аудит», «Ноды» и общие
примитивы `Card`/`Table`.

Прототип: [`frontend/public/design-preview.html`](../frontend/public/design-preview.html)
(открывается как `/design-preview.html`, переключатели темы/плотности/мобильного вида внутри).

## 1. Принципы

1. **Спокойная иерархия.** Тональные поверхности вместо тяжёлых теней и рамок.
   Пользователь видит структуру, а не «коробки».
2. **Плотность административная.** M3-ритм 4/8, но таблицы и карточки
   компактнее потребительских приложений: 52 px строка, 44 px в режиме
   «плотно».
3. **Один акцент.** Navy — primary. Secondary — приглушённый стальной,
   tertiary — сине-фиолетовый из нашей палитры. Семантика (успех/предупреждение/
   ошибка/инфо) остаётся отдельной и не смешивается с акцентом.
4. **Состояния обязательны.** Hover, focus-visible, pressed, selected,
   disabled, loading, empty, error — для каждой карточки и таблицы.
5. **Доступность.** Контраст WCAG AA, focus не удаляется, touch-таргеты
   ≥ 44 px (48 px там, где позволяет плотность), всё управляется с клавиатуры.

## 2. Цвет

### 2.1 Роли

Токены называются `--md-<role>`; старые `--accent`, `--surface`, `--text`,
`--muted`, `--border` остаются как алиасы на время миграции.

| Роль | Light | Dark | Использование |
|---|---|---|---|
| `primary` | `#0E4688` | `#A9C7FF` | акцент, активные элементы, ссылки |
| `on-primary` | `#FFFFFF` | `#003063` | текст на primary |
| `primary-container` | `#CDDDFF` | `#0E4688` | выбранная строка, тональные плашки |
| `on-primary-container` | `#001738` | `#CDDDFF` | текст на primary-container |
| `secondary` | `#3F4756` | `#BEC6D8` | вторичные действия |
| `secondary-container` | `#D5DDEF` | `#3B4352` | выбранный chip, nav-active |
| `tertiary` | `#46536A` | `#B4C3DD` | редкие акценты, графики |
| `surface` | `#FBF9FB` | `#131315` | фон приложения |
| `surface-container-lowest` | `#FFFFFF` | `#0E0E10` | карточка на фоне |
| `surface-container-low` | `#F5F3F6` | `#191A1C` | toolbar, шапка таблицы |
| `surface-container` | `#EFEDF0` | `#1F2022` | поля, вложенные блоки |
| `surface-container-high` | `#E7E5E7` | `#28292C` | hover, pressed, skeleton |
| `surface-container-highest` | `#DEDCDF` | `#333437` | docked toolbar, диалоги |
| `on-surface` | `#1B1B1E` | `#E4E2E5` | основной текст |
| `on-surface-variant` | `#404247` | `#C4C5CB` | вторичный текст, заголовки колонок |
| `outline` | `#75777D` | `#8E8F96` | границы полей |
| `outline-variant` | `#C5C6CD` | `#44454B` | разделители |
| `error` | `#B91C1C` | `#FFB4AB` | ошибки |
| `success` | `#005323` | `#6FD98A` | онлайн, успех |
| `warning` | `#893C00` | `#FFB68F` | лимиты, предупреждения |
| `info` | `#2151DA` | `#B5C5FB` | нейтральная информация |

Контейнеры семантики: `success-container` (`#7FFC97` / `#005320`),
`warning-container` (`#FFDCC3` / `#6E3900`), `error-container`
(`#FFDAD6` / `#93000B`), `info-container` (`#DBE1FF` / `#003EA8`).

### 2.2 Правила

- Основной фон страницы — `surface`; карточка — `surface-container-lowest`
  (light) или `surface-container-low` (dark), чтобы не «светиться» белым.
- Вложенные блоки (toolbar, шапка таблицы, фильтры) — `surface-container-low`/
  `container`.
- Hover/pressed — state layer поверх текущего фона, не отдельный серый.
- Primary использовать точечно: primary-кнопка на экране одна.
- Семантические цвета — только для статусов, не для декора.
- Navy-сайдбар сохраняется: `#08172B → #0D2340`, активный пункт —
  `#173A63` + белый текст.

## 3. Типографика

Базовый стек: `Roboto, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`.
M3 type scale, адаптированный под админку:

| Токен | Размер/интерлиньяж | Вес | Использование |
|---|---|---|---|
| `display-small` | 36/44 | 700 | крупные метрики |
| `headline-medium` | 28/36 | 700 | заголовок страницы |
| `headline-small` | 24/32 | 700 | заголовок секции |
| `title-large` | 22/28 | 650 | заголовок диалога |
| `title-medium` | 16/24 | 650 | заголовок карточки, таблицы |
| `title-small` | 14/20 | 650 | подзаголовок |
| `body-large` | 16/24 | 400 | тексты форм, описания |
| `body-medium` | 14/20 | 400 | таблицы, основной текст |
| `body-small` | 12/16 | 400 | подписи, метаданные |
| `label-large` | 14/20 | 600 | кнопки, чипы |
| `label-medium` | 12/16 | 600 | заголовки колонок, бейджи |
| `label-small` | 11/16 | 600 | uppercase-метки групп |

Правила: заголовки колонок — `label-medium`, uppercase, `letter-spacing: 0.06em`,
цвет `on-surface-variant`; числа и IP — табличные цифры (`font-variant-numeric: tabular-nums`).

## 4. Форма и отступы

| Токен | Значение | Где |
|---|---|---|
| `shape-xs` | 4 | бейджи-метки, мелкие чипы |
| `shape-sm` | 8 | chips, поля ввода, кнопки-иконки |
| `shape-md` | 12 | карточки-строки, вложенные блоки |
| `shape-lg` | 16 | карточки, таблица, диалоги |
| `shape-xl` | 28 | bottom sheet, крупные модалки |
| `shape-full` | 999 | кнопки-пилюли, FAB, search bar |

Сетка 4/8: `4, 8, 12, 16, 20, 24, 32, 40`. Внутренние пэддинги карточки:
20 px desktop, 16 px mobile. Между карточками — 16 px, между секциями — 24 px.
Контент: max-width 1440 px, боковые поля 24/16 px.

## 5. Elevation и state layers

M3 elevation строится тоном, а не только тенью:

| Уровень | Фон | Тень |
|---|---|---|
| 0 | `surface` | нет |
| 1 | `surface-container-low` + 3% primary | `0 1px 2px rgba(...,0.10)` |
| 2 | `surface-container` + 5% primary | `0 4px 12px rgba(...,0.12)` |
| 3 | `surface-container-high` + 8% primary | `0 12px 32px rgba(...,0.16)` |

State layers (наложение `currentColor`): hover 8%, focus 10%, pressed 12%,
dragged 16%. Для строк таблицы — `on-surface` 8% (hover), 12% (pressed).

## 6. Карточки

### 6.1 Анатомия

```
┌ card (radius 16) ─────────────────────────────┐
│ head: title (title-medium)      actions →     │
│       sub (body-small, muted)                 │
│ body: контент, padding 20                     │
│ foot: разделитель + вторичные действия 12/20  │
└───────────────────────────────────────────────┘
```

- `Card` (filled/outlined/elevated) — базовый контейнер.
- Заголовок и действия — одна строка; действия не переносятся на мобиле,
  уходят в overflow-меню (⋮).
- Заголовок карточки не дублирует заголовок страницы.
- Подзаголовок — факт/метрика («Найдено 8 из 8»), не маркетинговый текст.

### 6.2 Варианты

1. **Filled** — `surface-container-high`, без рамки. Для метрик и вложенных
   сводок.
2. **Outlined** — `surface`, рамка `outline-variant`. Для форм и фильтров.
3. **Elevated** — уровень 1. Для основных рабочих карточек (таблица, список).
4. **Metric** — filled + иконка в `primary-container` (40×40, radius 12),
   значение `display-small`, подпись `label-medium`, дельта с success/error.
5. **List-item** — карточка-строка для мобильной замены таблицы: leading
   (аватар/иконка), title + supporting, trailing (статус/шеврон), meta-строки,
   footer-действия, meter квоты.
7. **Health** — карточка ноды: статус, версия, ядро, heartbeat и три
   ресурсных метра (CPU/RAM/uptime).
8. **Activity** — лента событий с иконкой, заголовком, метаданными и временем;
   не более 4–6 строк, дальше — «Все события».
6. **Hero/Quota** — filled, крупное значение + M3 progress (4 px, radius 2,
   primary на `surface-container-highest`).

### 6.3 Состояния

- **Interactive**: hover — уровень +1 и state layer 8%; pressed — 12%;
  focus-visible — 2 px `primary` + 2 px offset.
- **Selected** (список/карточка): фон `primary-container`, текст
  `on-primary-container`; не просто цветная полоска.
- **Loading**: skeleton-блоки `surface-container-high` на месте текста,
  без шиммера при `prefers-reduced-motion`.
- **Empty**: иконка 48 в круге `surface-container`, title-medium, body-medium
  muted, одна outlined-кнопка.
- **Error**: инлайн-плашка `error-container` внутри карточки, действие
  «Повторить», без модалок.

## 7. Таблицы (data table M3)

### 7.1 Анатомия

```
┌ table-card ───────────────────────────────────────────┐
│ toolbar: title + count            [Обновить] [+ Создать] │
│          [search...............] [chips] [density] [⋮] │
├───────────────────────────────────────────────────────┤
│ ☐  УСТРОЙСТВО ▴   ВЛАДЕЛЕЦ   АДРЕСА   ЛИМИТЫ   СТАТУС  │ 48 sticky
│ ☐  A              pairuser   10.44... 110/110  ● Активно│ 52
│ ☑  B              pairuser   10.44... 110/110  ● Активно│ 52 selected
├───────────────────────────────────────────────────────┤
│ footer: «Показано 8 из 8»        [Показать ещё]        │
└───────────────────────────────────────────────────────┘
```

- Контейнер: radius 16, outlined, без внутренней рамки-«пилюли» у шапки.
- Шапка sticky, `surface-container-low`, нижняя граница `outline-variant`.
- Заголовки — `label-medium` uppercase; сортировка — кнопка с иконкой 16 px,
  `aria-sort`; активная колонка — `primary`.
- Строка 52 px; dense 44 px; разделители `outline-variant`.
- Первая колонка — чекбокс 40 px; select-all с indeterminate.
- Выбранная строка — `primary-container` + `on-primary-container`; hover
  сильнее на 4%.
- Действия строки — иконки 40×40 (radius 20) + overflow ⋮; primary-действие
  не дублируется в каждой строке.
- Горизонтальный скролл — только таблица, не страница; первая колонка
  (чекбокс/имя) закреплена на узких экранах.
- Ячейки: аватар-монограмма + имя/группа, meter квоты с процентом,
  sparkline трафика, peer-stack, относительное время.
- Раскрытие строки: детали интерфейса, handshake, rx/tx, forwarding и
  быстрые действия; раскрытая строка не теряет выделение.
- Toolbar: сохранённое представление, поиск с хоткеем `/`, chips с
  количеством, меню колонок, плотность.
- Footer: диапазон «1–5 из 156», строк на страницу, пагинация.

### 7.2 Toolbar и фильтры

- Первая строка: `title-medium` + `body-small` («Найдено 8 из 8»); справа —
  вторичное действие outlined и одно primary.
- Вторая строка: M3 search bar (48 px, radius full, `surface-container-high`,
  иконка поиска), filter chips (`secondary-container` при выборе, галочка),
  справа — переключатель плотности (segmented icon button) и меню колонок.
- Активные фильтры дополнительно показываются chips под toolbar, у каждого
  крестик; «Сбросить всё» — text button.
- Не использовать grid с пустыми ячейками: chips переносятся потоком.

### 7.3 Мобильная версия

- `≤ 767 px` (и coarse pointer ≤ 1023): таблица превращается в список
  `List-item` карточек, по одной на запись.
- Карточка: строка 1 — чекбокс, имя (title-small), статус-чип; строка 2 —
  supporting (группа); meta-сетка 2 колонки (label-small + body-small);
  footer — действия.
- Тап по карточке — открыть; чекбокс — выделить; свайпы не используем.
- Контент получает `padding-bottom: 96px`, чтобы bottom-nav и bulk bar не
  перекрывали последнюю карточку.
- Bulk bar на мобиле — над bottom-nav (bottom: 88px), radius 16.

### 7.4 Состояния таблицы

- Loading: 6 skeleton-строк высотой 52, шапка остаётся.
- Empty: внутри тела таблицы, иконка + текст + сброс фильтров.
- Error: плашка `error-container` над таблицей, кнопка «Повторить».
- Обновление: тонкая полоса прогресса 2 px под toolbar, не блокирует.

## 8. Компаньоны

- **Кнопки**: filled (primary), tonal (`secondary-container`), outlined,
  text. Высота 40, radius full, `label-large`; иконка 18. На мобиле 48.
- **FAB**: только на мобиле для главного create-действия (56, primary-container,
  radius 16), скрывается при открытой клавиатуре.
- **Badges/status**: chip 24 px, radius 8; success/warning/error/info
  контейнеры; точка 8 px слева.
- **Chips фильтров**: 32 px, radius 8, outlined; selected —
  `secondary-container` + галочка.
- **Поля**: filled (`surface-container-high`, нижняя линия 1 px) или outlined
  (radius 8, рамка `outline`); фокус — рамка 2 px `primary`; ошибка —
  `error` + helper text.
- **Bottom nav**: 80 px, `surface-container`, активный пункт —
  `secondary-container`-иконка + label; safe-area.
- **Диалоги**: radius 28, `surface-container-high`, заголовок title-large,
  действия справа.
- **Тосты**: `inverse-surface`/`inverse-on-surface`, radius 12, снизу.

## 9. Motion

- Стандарт: 200 ms `cubic-bezier(0.2, 0, 0, 1)`; emphasized: 300 ms
  `cubic-bezier(0.05, 0.7, 0.1, 1)`.
- State layer: 100 ms linear.
- Раскрытие строки/меню — 200 ms; модалка — 300 ms.
- `prefers-reduced-motion: reduce` — длительности 1 ms, без shimmer.

## 10. Доступность

- Контраст: body ≥ 4.5:1, крупный текст ≥ 3:1, границы полей ≥ 3:1.
- Focus-visible — 2 px primary + 2 px offset, не удаляется.
- Все иконки-кнопки имеют `aria-label`; таблица — `<caption class="sr-only">`.
- Сортировка: кнопка + `aria-sort` на `th`.
- Чекбоксы: label или `aria-label`; select-all — `indeterminate`.
- Строка таблицы, открывающая детали, — ссылка/кнопка внутри, не `tr onclick`.
- Touch-таргеты ≥ 44 px (48 px, где позволяет плотность); между действиями ≥ 8 px.
- Статусы не кодируются только цветом: точка + текст.

## 11. Внедрение

1. `tokens.css`: добавить `--md-*`, затем алиасы старых переменных.
2. `components.css`/`tables.css`: переписать `.card*`, `.table*`, `.bulk-bar`,
   `.empty`, `.badge`, `.chip`, `.search`.
3. Новые примитивы: `Card`, `TableToolbar`, `FilterChips`, `EmptyState`,
   `BulkBar`, `StatusBadge`, `DataTable` (или CSS-классы при сохранении
   текущей разметки).
4. Пилот: `clients`, `audit`, `nodes`; затем остальные страницы.
5. Проверка: Playwright MCP desktop/mobile, light/dark, клавиатура, контраст;
   unit + e2e.

## 12. Чеклист приёмки

- [ ] Карточки используют три варианта и не смешивают рамку+тяжёлую тень.
- [ ] В таблице один заголовок, sticky-шапка, сортировка с `aria-sort`.
- [ ] Выбранные строки — `primary-container`, select-all работает.
- [ ] Плотность 52/44 переключается.
- [ ] Мобильные карточки не перекрываются bottom-nav и bulk bar.
- [ ] Empty/loading/error есть у каждой таблицы и карточки-списка.
- [ ] Контраст AA, focus-visible, клавиатурная навигация.
- [ ] Light/dark выглядят как одна система.


## 13. Статус внедрения

- [x] M3-токены (`--md-*`, shape/state/type) в `tokens.css`.
- [x] Общие примитивы карточек, toolbar, chips, search, status-chip, meter,
      avatar, health/event-блоков, row-expand.
- [x] Пилот: «Клиенты», «Аудит», «Ноды» — карточка + toolbar + sticky-таблица,
      аватары, статусы, метры, мобильные карточки.
- [ ] Остальные страницы: пользователи, интерфейсы, группы, тарифы,
      статистика, импорт, профиль, настройки, обзор.
- [ ] Вынести повторяющиеся блоки в компоненты `TableToolbar`/`FilterChips`
      после второй волны страниц.
