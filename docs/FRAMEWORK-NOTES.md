# Замечания по frontend-фреймворку (silent)

Приложение обновлено до `@ivlev-dev/*` 0.13.1, включая
`@ivlev-dev/silent-router`, `@ivlev-dev/silent-form` и
`@ivlev-dev/silent-validation`. Ниже — история багов, текущие ограничения,
правила работы с формами и диагностика для разработчика фреймворка.

## Исправлено

| № | Баг | Версия |
|---|---|---|
| 1 | Динамические SVG-дети попадали в HTML-namespace | 0.7.3 |
| 2 | `<style>{...}</style>` с интерполяцией падал | 0.7.3 |
| 3 | `<Show>` пересоздавал детей и терял состояние форм | 0.7.3/0.7.4 |
| 4 | `.map()` в JSX не типизировался как `Child` | 0.7.3 |
| 5 | Нативный `<select>` в Firefox не открывался, `currentTarget` был неверным | 0.7.3 |
| 6 | `props` нельзя деструктурировать без потери реактивности | 0.7.3 |
| 7 | Route-компоненты из `<Show>` получали отдельный DI-контейнер | 0.7.5 |
| 8 | DI-индекс не разрешал alias/`paths` для type-импортов | 0.11.13 |
| 9 | `lazy` + `Suspense` внутри `Show` оставлял осиротевший DOM | 0.11.13 |
| 10 | Общий `Suspense` не показывал fallback при повторном переходе | 0.11.13 |
| 11 | `lazy` не повторял загрузку после ошибки | 0.11.13 |
| 12 | `NotFoundError` в консоли при первом рендере lazy-страницы | 0.11.13 |
| 13 | `insertBefore ... not a child of this node` при переносе маркера монтирования | 0.11.16 |
| 14 | `RouterView` не прокидывал DI-контейнер и создавал новые `Session`/`Router` | 0.11.16 |
| 15 | Отсутствующий биндинг молча создавал `new Token()` | 0.11.16 |
| 16 | `Switch`/`Match` с реактивным `when` уходили в бесконечный flush (issue [#1](https://github.com/ivlev-dev/silent-framework/issues/1)) | 0.11.17 |
| 17 | Light-компоненты на сервере платили за props-прокси и лишний `createRoot` (SSR +55%) | 0.11.18 |
| 18 | `<For>`/`<Index>` вставляли строки через промежуточный fragment; SSR не умел убирать маркеры | 0.11.19 |
| 19 | Для строк без второго параметра создавался лишний accessor индекса | 0.11.20 |
| 20 | Гидрация списков: `Index` не обновлял строки, `For` терял вставленные строки и мог снести `silent-end`; утечки эффектов при keyed-пере-рендере | 0.11.21 |

### Исправлено в приложении (аудит 2026-11)

| № | Баг | Что сделано |
|---|---|---|
| 1 | Любой `403` отправлял пользователя на экран логина, включая запрет на конкретный раздел | `ForbiddenInterceptor` реагирует только на коды блокировки аккаунта (`pending_approval`, `rejected`, `account_disabled`) и не трогает `/auth/me`; обычный `403` показывается как ошибка страницы |
| 2 | Прерванные запросы (`AbortController`) показывали toast об ошибке | `code === "aborted"` подавляется в `network-error.interceptor` и `userMessage`, отмена навигации/поиска больше не шумит |
| 3 | Синхронизация фильтров теряла путь/hash или уводила на другой раздел | `filter-url.ts` проверяет префикс пути, сохраняет `pathname` и `hash`, пишет только непустые параметры; `replaceState` обёрнут в `try/catch` |
| 4 | Тема `system` не следовала за ОС | `ThemeMode = "system" \| "light" \| "dark"`, `matchMedia("(prefers-color-scheme: dark)")` и подписка на изменения; `system` — значение по умолчанию |
| 5 | Access-токен в query WebSocket попадал в логи | Клиент получает одноразовый тикет `POST /api/v1/ws/ticket` и подключается с `?ticket=`; токен в query остался только за `AWG_ALLOW_WS_TOKEN` |

## Валидация и формы (0.13)

Формы вынесены из ViewModel в отдельные `*.form.ts` и собраны на
`@ivlev-dev/silent-form` (MVVM: форма — модель, VM — сценарий, `.tsx` — View).
Правила проверки — из `@ivlev-dev/silent-validation`; пакет `silent-form`
реэкспортирует их и добавляет `Form`, `@Field`, `FormField`, `Optional`,
`ValidateIf`, `setFieldErrors`, `isReady` и жизненный цикл.

Пакеты (все `0.13.1`):

- `@ivlev-dev/silent-form` — базовый класс `Form` и декораторы полей;
- `@ivlev-dev/silent-validation` — правила (`Required`, `Min`, `Matches`,
  `Custom`, …) и `configureValidation`;
- `@ivlev-dev/silent-validation-vite` (dev) — плагин `validation()`,
  генерирующий схемы типов из TS-аннотаций `accessor`-полей.

### Схема формы

```ts
export class LoginForm extends Form {
  @Field()
  @Required({ message: () => t("auth.register.error.email") })
  @Matches(EMAIL_PATTERN, { message: () => t("auth.register.error.email") })
  public accessor email: string = "";

  constructor() {
    super({ formId: "login", validateOnInput: true });
  }
}
```

- `class XForm extends Form`; поля — только `accessor` с `@Field()` (поле без
  декоратора не попадает в `values`, ошибки и `isReady`).
- View берёт стабильный объект через `form.getFieldProps("email")` и биндит
  `value`, `onInput`, `onBlur`, `error`/`errors`, `aria-invalid`.
- Отправка — `await form.onSubmit(async (submitted) => { ... })`: `preventDefault`,
  проверка формы, колбэк только при `isReady`, `isSubmitting` сбрасывается в
  `finally`. Серверные ошибки — `submitted.setFieldErrors("name", [message])`;
  они снимаются при изменении значения.
- VM освобождает форму в `dispose()` (рекурсивно освобождает вложенные формы и
  массивы). Экземпляр формы живёт столько же, сколько VM/модалка.
- `formId` задаёт префикс DOM-`id` (`login-email` вместо
  `LoginForm-email`): нужен для стабильных `label for`, нескольких экземпляров
  одной формы и e2e-селекторов.

### Локаль сообщений

Встроенные сообщения `silent-validation` переключаются через
`configureValidation({ locale })`. В приложении это делает
`app/validation.ts` (`syncValidationLocale`): он вызывается при старте
контейнера и из `setLocale()` при смене языка. Импорт идёт напрямую из
`@/i18n/store`, чтобы не замкнуть цикл `i18n/index.ts` → `app/validation.ts`
→ `i18n/index.ts`. Сообщения предметных правил задаются явно:
`message: () => t("...")` или `message: ({ value, instance }) => ...`.

### Подводные камни

- `Optional` и `ValidateIf` импортируйте **только** из `@ivlev-dev/silent-form`:
  версии из `silent-validation` форма не видит, и поле остаётся обязательным.
- `@IsEmail` требует TLD, а бэкенд допускает `admin@local`. Поэтому в формах
  используется `Matches(/^[^\s@]+@[^\s@]+$/)`, а не `@IsEmail`.
- `setValue()`/прямое присваивание не запускают валидацию: они только меняют
  значение, `dirty` и снимают внешние ошибки. Проверку запускают `validate()`,
  `validateField()` или `onSubmit()`.
- `isReady` учитывает накопленные validation- и external-ошибки. После
  неудачной отправки форма с уже исправленными полями может остаться
  неготовой, пока ошибки не сняты; поэтому submit идёт через `onSubmit` /
  `validate`, а не через проверку `isReady` вручную.
- `types: false` нужен там, где числовое поле получает строку из пустого
  `input` (интерфейсы): `InterfaceForm` переопределяет `validate` и
  `validateField` и отключает схемную проверку типов, оставляя явные
  `@IsInt`/`@Min`/`@Max` с локализованными сообщениями.
- Плагин `validation()` строит схему по TS-аннотации, поэтому у новых
  `@Field`-полей тип должен быть указан явно (`accessor mtu: number = 1420`),
  а не выведен из литерала.
- Служебные флаги формы (`adminMode`, `creating`, `mode`) помечаются
  `@reactive`, а не `@Field`: они управляют `ValidateIf`, но не входят в
  `values` и не отправляются на сервер.

### Что осталось ручным

- Динамические массивы импорта (интерфейсы и CIDR-пулы,
  `features/import/interface-drafts.ts`): состав, добавление/удаление и
  перекрёстные проверки живут в собственном реактивном состоянии, а не в
  `FormArray`.
- Матрица forwarding (`features/clients/details/edit.ts`): пары
  «источник × назначение» и проверки самоссылки/пустого выбора считаются в VM.
- Файловые и потоковые сценарии импорта: `FileReader`, разбор нескольких
  конфигов (`splitClientConfigs`), server-конфиг и предпросмотр остаются вне
  формы; форма валидирует только итоговый текст/поля.

## Открытые проблемы 0.13.1

**A. `@watch` вызывает селектор до инициализации `props`.**
`@watch((vm) => vm.props.value)` на первом запуске падает с
`Cannot read properties of undefined (reading 'value')`. Обход в `QrCodeVm`:
подписка через `createEffect` в `mounted`, где `props` уже задан. Опция
`defer` откладывает `immediate`-вызов, но не даёт `props` в конструкторе.
Пожелание: не запускать `@watch` до монтирования VM или дать доступ к `props`
в конструкторе.

**C. `Router.start()` бросает `RouterNavigationError` при `no-match`.**
`navigate()` не бросает (0.11.16), но `start()` на неизвестном URL отклоняет
промис, хотя `state.error` уже заполнен и `RouterView` готов показать
`notFound`. В фасаде `start()` обёрнут в `try/catch`. Ожидание: `start()`
ведёт себя как `navigate()`.

Закрыто в 0.13.1: **DI-индекс сканирует тестовые файлы.** Сканер индекса
учитывает `include`/`exclude` плагина `silent()`, поэтому фейковые реализации
из тестов можно исключить. Тесты приложения по-прежнему лежат в
`frontend/tests` — это не требование фреймворка, а сложившаяся структура.

## Миграция на 0.13.1

- все `@ivlev-dev/*` подняты до 0.13.1; добавлены `@ivlev-dev/silent-form`,
  `@ivlev-dev/silent-validation` и dev-зависимость
  `@ivlev-dev/silent-validation-vite`, версии внесены в
  `minimumReleaseAgeExclude` в `pnpm-workspace.yaml` (supply-chain политика);
- в `vite.config.ts` подключён плагин `validation()`. Он требует stage-3
  accessor-декораторы (`experimentalDecorators: false`) и генерирует схемы
  типов для классов-потомков `ValidationModel`; `Form` наследует его, поэтому
  формы получают проверку типов из TS-аннотаций;
- формы auth, clients, users, tariffs, interfaces, nodes, profile, settings и
  import переведены на `Form` + `*.form.ts`; проверки и тексты ошибок — в
  правилах, View использует `getFieldProps`, отправка — `onSubmit`;
- локаль встроенных сообщений синхронизируется через `app/validation.ts` при
  старте и при переключении языка;
- проверки после обновления: unit-тесты, typecheck, arch:check, build; точное
  число тестов — в выводе `pnpm test` и в CI.

## Миграция на 0.11.21

- все `@ivlev-dev/*` подняты до 0.11.21, версия добавлена в
  `minimumReleaseAgeExclude` в `pnpm-workspace.yaml` (supply-chain политика);
- публичного API не менялось: обновление прошло без правок приложения;
- `For`/`Index` теперь автоматически получают `parent`/`marker` и
  `index: false`, если второй параметр не объявлен; на mount-only приложении
  поведение прежнее, но вставка строк дешевле;
- `staticRows` и исправления гидрации списков касаются SSR/hydration-пути; у
  нас mount-only, поэтому разметка и клиентские тесты не изменились;
- `renderToString(..., { markers: false })` доступен для негидрируемого SSR;
- проверки после обновления: unit-тесты (точное число — в выводе `pnpm test`
  и CI), typecheck, arch:check, build, e2e Chromium и Firefox (локально).

## Миграция на 0.11.17

- все `@ivlev-dev/*` подняты до 0.11.17, `pnpm-workspace.yaml` дополнен
  версией в `minimumReleaseAgeExclude` (политика supply-chain);
- `src/app/root-container.ts` — корневой контейнер с
  `implicitBindings: "warn"`: режим `"error"` на рантайме не подходит, потому что
  DI-компилятор по-прежнему создаёт VM через неявный биндинг; строгость
  обеспечивает сборка (`di: "error"`);
- Vite-плагин запускается как `silent({ di: "error" })`: сборка падает с именем
  зависимости, если реализация не найдена;
- `src/app/router-records.ts` больше не содержит `load` в каждой записи:
  используется общий `RouterOptions.load`, загрузчик страниц инжектится из
  `main.tsx` через `setPageLoader` (так сохраняется разрыв цикла
  `router → page-loaders → features → router` для `pnpm arch:check`);
- `Router.start()` вызывается из `main.tsx` до `mount` после `setPageLoader` и
  `bindAppServices`; в конструкторе остаётся только подписка на `popstate`.
  Порядок важен: guard в `AppVM` не должен конкурировать со стартовым
  переходом;
- `Router.navigate` использует `IRouter.navigate`: ошибки навигации и загрузки
  чанка больше не дают unhandled rejection, а попадают в `state.error`,
  `RouterView` рендерит слот `error` с кнопкой перезагрузки;
- `RouterView` заменил ручной switch по `routeName` в `App.tsx`: страницы
  рендерятся по matched-записи, слоты `error`/`notFound`, переиспользование
  view при смене `params`;
- заголовок, shell и публичная обвязка берутся из подтверждённого маршрута
  (`Router.committedMatch`), а не из запрошенного пути: иначе заголовок и URL
  расходились на время загрузки чанка;
- `RouterView` резолвит `Router` из DI-контейнера: корневой роутер
  регистрируется через `provide(container)` при создании;
- добавлены тесты `tests/app/router-view.test.tsx`: контейнер доходит до
  страницы, view переключается, `notFound`-слот рендерится;
- аудит-страница вернулась к условному рендеру empty-state/таблицы после фикса
  маркера монтирования (пункт 13);
- после 0.11.17 `Switch`/`Match` возвращены в `QrCode` и выбор профиля
  `ClientDetails`; оба места покрыты тестами, добавлена регрессия
  `tests/components/switch.test.tsx` на сигнал и `computed` в `when`.

## Пожелания по фреймворку

- `@watch` с инициализированными `props` (пункт A).
- `start()` без исключения при `no-match` (пункт C).
- Devtools: события навигации и граф DI-резолва.

## Проверки

- `pnpm typecheck`, `pnpm test`, `pnpm arch:check`, `pnpm build` — прогоняются локально и в CI; результат смотрите в выводе job'ов.
- `pnpm e2e` — Chromium и Firefox локально; в CI job `E2E` гоняет Chromium,
  включая повторный вход с TOTP и сценарии аудита без обхода.
