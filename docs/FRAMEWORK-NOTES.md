# Замечания по frontend-фреймворку (silent)

Приложение обновлено до `@ivlev-dev/*` 0.11.15, включая новый пакет
`@ivlev-dev/silent-router`. Ниже — история багов, текущие ограничения и
диагностика для разработчика фреймворка.

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

После 0.11.13 сервисные интерфейсы снова импортируются через `@/...`,
`PageSlot` остаётся только как layout-обёртка.

## Открытые проблемы 0.11.13

**A. `insertBefore ... not a child of this node` при `Show` + `For` → empty.**
Воспроизводится на Audit: фильтр по несуществующему актору, затем сброс.
Внешний `Show` показывает таблицу, внутренний `Show` переключает её на
empty-state; при возврате данных падает `Node.insertBefore`. В 0.11.13
заявлено исправление опустошения `For` внутри `Show`, но сценарий с вложенным
`Show` и `fallback` всё ещё падает. Обход: таблица и empty-state всегда в DOM,
переключается класс `hidden`.

**B. `Switch`/`Match` с асинхронным статусом в `mounted` может зависнуть.**
`QrCode` с `Switch` по `vm.status` (idle → loading → ready после `import()`)
зависал в тестах/рантайме. После замены на статический SVG + `hidden` работает.
Нужен репро: VM меняет статус в async `mounted`, компонент рендерит `Switch`.

**C. `@watch` вызывает селектор до инициализации `props`.**
`@watch((vm) => vm.props.value)` на первом запуске падает с
`Cannot read properties of undefined (reading 'value')`. Обход:
`vm.props?.value ?? ""` и guard по последнему значению.

**D. DI-индекс сканирует тестовые файлы.**
Если тесты лежат в `src`, их фейковые реализации попадают в индекс и дают
«найдено несколько реализаций» при сборке. Тесты вынесены в `frontend/tests`;
фейки в тестах больше не объявляют `implements`, чтобы не попадать в индекс.
Ожидание: опция исключения/`exclude` для сканера, а не перенос тестов.

## Проверки после миграции

- `pnpm typecheck`, `pnpm test` (722 теста), `pnpm arch:check`, `pnpm build` — зелёные.
- `pnpm e2e` — 26/26 (Chromium + Firefox), кроме сценария Audit с пустой выдачей:
  он проходит только с обходом из пункта A.


## Миграция на `@ivlev-dev/silent-router` 0.11.15

Что сделано:

- все `@ivlev-dev/*` подняты до 0.11.15 (пакет роутера жёстко требует эти версии);
- `src/app/routes-def.ts` — таблица маршрутов и метаданные (title/public/adminOnly);
- `src/app/router-records.ts` — `RouteRecord[]` с `load`, метаданными и
  инъекцией загрузчика через `setPageLoader` (иначе `page-loaders` и страницы
  образуют цикл, который ловит `pnpm arch:check`);
- `src/app/router.ts` — тонкий фасад над пакетным `Router`: сохраняет API
  `path/params/match/navigate/replace` для 40+ вызовов в VM и тестов, внутри
  использует `SilentRouter` (история, `resolve`, `prefetch`, скролл);
- `src/app/container.ts` — все сервисы биндятся через `bindValue` (см. ниже);
- `src/main.tsx` — `setPageLoader` до `bindAppServices`.

### Блокер: `RouterView` и DI-скоупы

`RouterView` пока не используется: при монтировании ленивой страницы
`createComponent(next, props, runtimeOptions)` создаёт скоуп, в котором `Session`
и `Router` резолвятся как **новые экземпляры**. Симптом: после логина URL
меняется на `/`, но `AppVM` видит `user = null` и оболочка не переключается.
Воспроизводится на чистом контексте браузера, не только при HMR.

Текущий обход: страницы по-прежнему рендерятся в дереве `App` (ручной switch по
`routeName`), а пакет отвечает за навигацию, историю, матчинг и ленивые `load`.

Что нужно фреймворку:

1. `RouterView` должен прокидывать контейнер в `createComponent`
   (`{ container }`), а не полагаться на `getRuntimeOptions()`.
2. `Container.createScope`/`peek` должны находить value-биндинги родителя
   синхронно (сейчас фабричные биндинги не видны до первого `resolve`).
3. Если биндинга нет, DI не должен молча делать `new Token()` — нужен
   `MissingBindingError` с именем зависимости и путём скоупов.
4. Добавить тест «layout + вложенные маршруты + ленивый компонент + DI».

### Открытая ошибка `insertBefore ... is not a child of this node`

Причина: в `createMountPoint` (`silent-core/src/dom.js`) якорь проверяется только
на `null`:

```js
const place = (target, node) => {
  if (marker === null) { target.appendChild(node); return; }
  target.insertBefore(node, marker); // падает, если marker.parentNode !== target
};
```

Если внешний `Show`/layout или гидрация перенесли маркер, вставка бросает
`NotFoundError`. `RouterView`, кроме того, переиспользует гидрационный маркер как
якорь нового `DocumentFragment`.

Минимальный репро и патч (для репозитория фреймворка):

```ts
it("survives when an outer boundary moved the end marker", () => {
  const host = document.createElement("div");
  const other = document.createElement("div");
  document.body.append(host, other);
  const marker = document.createComment("end");
  host.appendChild(marker);

  const mount = createMountPoint(host, marker);
  other.appendChild(marker);

  expect(() => mount.render(document.createTextNode("x"))).not.toThrow();
  expect(host.textContent).toContain("x");
});
```

```js
const place = (target, node) => {
  if (marker === null) { target.appendChild(node); return; }
  const parent = marker.parentNode;
  if (parent === target) { target.insertBefore(node, marker); return; }
  if (parent === null) {
    target.appendChild(marker);
    target.insertBefore(node, marker);
    return;
  }
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    console.error("[silent] mount marker moved outside its container", { target, parent });
  }
  target.appendChild(node);
};
```

Для `RouterView` рекомендуется держать собственные `start`/`end` маркеры в
контейнере и не переиспользовать `adoptedMarker`; перед рендером проверять
`mountMarker.parentNode === container`.

### Пожелания по фреймворку

- `IRouter.navigate()` (void + `state.error`) или документированный паттерн для
  `router.push()` в обработчиках клика, чтобы не было unhandled rejection.
- `router.route.meta` / `router.meta` вместо `matched[i].record.meta`.
- Контекст DI в `beforeEnter`.
- `RouterOptions.load`/`resolveComponent` вместо собственного реестра загрузчиков.
- Публичный `hasLoaded`/`preload` для интеграции с чанк-кэшем.
- Диапазоны версий (`>=0.11 <0.12`) вместо жёстких пинов.
- `createTestRouter` + MemoryHistory-хелпер.
- Devtools: события навигации и граф DI-резолва.
