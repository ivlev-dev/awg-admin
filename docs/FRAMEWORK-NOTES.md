# Замечания по frontend-фреймворку (silent)

Документ фиксирует проблемы, найденные при разработке AWG Admin на
`@ivlev-dev/silent` 0.7.2 + `@ivlev-dev/silent-vite` 0.7.2, с минимальными
репро. Часть обойдена в приложении; после исправления фреймворка обходы можно
удалить (см. раздел «Что удалить после фикса»).

## 1. Динамические SVG-дети попадают в HTML-namespace

**Критично.** Статический SVG работает, динамический — нет.

```tsx
// ✅ namespace = http://www.w3.org/2000/svg
<svg><path d="M0 0h8" /></svg>

// ❌ namespace = http://www.w3.org/1999/xhtml, path.getBBox отсутствует
<svg>
  <For each={[1]}>{() => <path d="M0 0h8" />}</For>
</svg>
```

Проверено в браузере через `element.namespaceURI` и `getBBox`. Из-за этого не
отрисовывались все иконки (массив путей через `For`) и графики.

Ожидание: namespace наследуется при вставке динамических детей/компонентов
внутрь `<svg>`. В `dom.js` есть `createElement` с `svgTagNames` и
`createElementNS`, но путь динамической вставки/`For` его теряет.

Обход в приложении: `components/Icon.tsx` и `components/Charts.tsx` рисуют
SVG через `data:image/svg+xml` + CSS `mask`/`background`.

## 2. `<style>` с текстовой интерполяцией роняет приложение

```tsx
<style>{`.profile-layout { display: grid; }`}</style>
```

```
TypeError: Cannot read properties of undefined (reading 'parentNode')
```

Воспроизведено на странице профиля. Нужно либо поддержать text-hole в
`<style>/<script>`, либо падать на этапе компиляции с понятной ошибкой.

Обход: стили вынесены в `src/styles/*.css`.

## 3. `<Show>` пересоздаёт детей и теряет состояние форм

Форма/инпуты внутри `<Show when={vm.open}>` пересоздавались при обновлении
несвязанных реактивных полей: терялись значения и фокус. Пришлось выносить
формы модалок в стабильные узлы.

Репро:

```tsx
<Show when={vm.open}>
  <input value={vm.text} onInput={vm.setText} />
</Show>
<button onClick={() => vm.other++}>tick</button>
```

Ожидание: пока `when` истинно, DOM-узлы сохраняются; пересоздание только при
переходе `false → true`.

## 4. `.map()` в JSX не типизируется как Child

```tsx
<svg>{[1, 2].map((n) => <path key={n} d="..." />)}</svg>
// TS2322: Type 'Node[]' is not assignable to type 'Child'
```

Просится `Child[]`/`Iterable<Child>` в `Child` либо отдельный `Each`-примитив.
Внутри SVG это ещё и упирается в п.1.

## 5. Нативный `<select>` в Firefox не открывается

До внедрения кастомного `Select` в Firefox клик фокусировал `<select>`
(`activeElement === SELECT`), но picker не открывался. События
`mousedown/mouseup/click/focus` не отменялись (`defaultPrevented === false`),
`select.showPicker()` открывал picker. Воспроизводилось и с `value={...}`,
и с `<option selected={...}>`, и внутри модалки.

Автоматически подтвердить picker в headless/Playwright нельзя (там даже пустой
`<select>` не показывает popup), поэтому точная причина не изолирована.
Гипотезы для проверки в рантайме:

1. `applyProperty` в `dom.js` пишет `value`/`selected` без проверки на
   равенство; если эффект перезапускается при фокусе, запись закрывает popup.
   Добавить guard `if (el[name] === value) return`.
2. Делегированные `mousedown/click` (`ensureDelegated`/`dispatchDelegated`)
   вызывают обработчики всех предков; любое реактивное обновление в предке
   может пересоздать `<option>` или перезаписать `selected`.
3. `<option>` внутри `<For>` могут пересоздаваться при фокусе (см. п.3).

Репро-страница: `frontend/public/select-repro.html` (6 случаев).

Обход: собственный `components/Select.tsx` (кнопка + popover, клавиатура,
drop-up, aria). Нативные `<select>` в приложении больше не используются.

## 6. Мелкое

- `props` нельзя деструктурировать (`const { value } = props`) — теряется
  реактивность. Нужно документировать или делать props-прокси с геттерами.
- `ViewModel` требует `override` для `mounted/unmounted` при `noImplicitOverride`
  (ожидаемо, но стоит указать в документации).
- `this.view` типизирован как `Node`, хотя на практике это элемент; для
  `querySelector/getBoundingClientRect` приходится кастовать.
- Нет встроенных `select`, `dialog`, `router`; для админки пришлось писать
  роутер и модалки самостоятельно.
- В типах компонентов с VM props передаются только вторым параметром
  (`function X(this: { vm: VM }, props: P)`); без него JSX не видит props.

## Что удалить после фикса фреймворка

| Обход | Файлы | Условие удаления |
|---|---|---|
| SVG через data-URI | `frontend/src/components/Icon.tsx`, `Charts.tsx` | п.1 исправлен |
| Стили вне `<style>` | `frontend/src/styles/*.css` (оставить), вернуть можно по желанию | п.2 исправлен (не обязательно) |
| Кастомный `Select` | `frontend/src/components/Select.*`, замены в 8 фичах | п.5 исправлен; кастомный можно оставить как UI-компонент |
| Стабильные формы вне `Show` | модалки фич | п.3 исправлен |

Текущий `browser-fixes.ts` удалён: Firefox-специфичный `showPicker` больше не
нужен, селекты кастомные.
