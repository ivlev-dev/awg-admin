import { For, Show, createSignal, onCleanup } from "@ivlev-dev/silent-core";

import type { SelectOption, SelectProps } from "./Select.vm";
import { Icon } from "./Icon";
import { t } from "@/i18n";

export type { SelectOption, SelectProps } from "./Select.vm";

export function Select(props: SelectProps) {
  const [open, setOpen] = createSignal(false);
  const [activeIndex, setActiveIndex] = createSignal(0);
  const [dropUp, setDropUp] = createSignal(false);
  let rootElement: HTMLElement | null = null;
  let listening = false;

  const selected = (): SelectOption | undefined =>
    props.options.find((option) => option.value === props.value);

  const label = (): string => selected()?.label ?? props.placeholder ?? t("common.selectValue");

  const menuId = (): string => (props.id ? `${props.id}-menu` : "");

  const activeDescendant = (): string | undefined => {
    if (!props.id || !open()) return undefined;
    const option = props.options[activeIndex()];
    return option ? `${props.id}-option-${activeIndex()}` : undefined;
  };

  const root = (): HTMLElement | null => rootElement;

  const attachPointerListener = (): void => {
    if (listening) return;
    listening = true;
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
  };

  const detachPointerListener = (): void => {
    if (!listening) return;
    listening = false;
    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
  };

  const scrollActiveIntoView = (): void => {
    const option = root()?.querySelector<HTMLElement>(`[data-index="${activeIndex()}"]`);
    option?.scrollIntoView({ block: "nearest" });
  };

  const focusTrigger = (): void => {
    root()?.querySelector<HTMLElement>(".select-trigger")?.focus();
  };

  const openMenu = (): void => {
    if (props.disabled) return;
    const selectedIndex = props.options.findIndex((option) => option.value === props.value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    const rect = root()?.getBoundingClientRect();
    if (rect !== undefined) {
      const below = window.innerHeight - rect.bottom;
      setDropUp(below < 280 && rect.top > below);
    }
    setOpen(true);
    attachPointerListener();
    requestAnimationFrame(() => {
      if (open()) scrollActiveIntoView();
    });
  };

  const close = (): void => {
    setOpen(false);
    detachPointerListener();
  };

  const toggle = (): void => {
    if (props.disabled) return;
    if (open()) {
      close();
      return;
    }
    openMenu();
  };

  const choose = (option: SelectOption): void => {
    if (option.disabled) return;
    props.onChange(option.value);
    close();
    focusTrigger();
  };

  const moveActive = (delta: number): void => {
    const count = props.options.length;
    if (count === 0) return;
    let index = activeIndex();
    for (let step = 0; step < count; step += 1) {
      index = (index + delta + count) % count;
      if (!props.options[index]?.disabled) break;
    }
    setActiveIndex(index);
    scrollActiveIntoView();
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (props.disabled) return;
    const key = event.key;
    if (key === "Escape") {
      if (open()) {
        event.preventDefault();
        close();
      }
      return;
    }
    if (key === "Tab") {
      close();
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      if (!open()) {
        openMenu();
        return;
      }
      moveActive(key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (key === "Home" || key === "End") {
      if (!open()) return;
      event.preventDefault();
      setActiveIndex(key === "Home" ? 0 : Math.max(0, props.options.length - 1));
      scrollActiveIntoView();
      return;
    }
    if (key === "Enter" || key === " ") {
      event.preventDefault();
      if (!open()) {
        openMenu();
        return;
      }
      const option = props.options[activeIndex()];
      if (option) choose(option);
    }
  };

  const onDocumentPointerDown = (event: PointerEvent): void => {
    if (!open()) return;
    const target = event.target;
    if (target instanceof Node && root()?.contains(target)) return;
    close();
  };

  onCleanup(close);

  return (
    <div
      class={`select2 ${open() ? "is-open" : ""} ${dropUp() ? "is-up" : ""}`}
      ref={(element: Element | null) => {
        rootElement = element instanceof HTMLElement ? element : null;
      }}
    >
      <button
        id={props.id}
        class="select select-trigger"
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open()}
        aria-controls={menuId() || undefined}
        aria-activedescendant={activeDescendant()}
        aria-label={props.ariaLabel}
        disabled={props.disabled}
        onClick={toggle}
        onKeydown={onKeydown}
      >
        <span class={`select2__value ${selected() === undefined ? "is-placeholder" : ""}`}>{label()}</span>
        <span class="select2__chevron"><Icon name="chevron" size={14} class="" /></span>
      </button>

      <Show when={open()}>
        <div id={menuId() || undefined} class="select2__menu" role="listbox" aria-label={props.ariaLabel}>
          <Show
            when={props.options.length > 0}
            fallback={<div class="select2__empty">{t("common.selectEmpty")}</div>}
          >
            <For each={props.options}>
              {(option, index) => (
                <button
                  id={props.id ? `${props.id}-option-${index()}` : undefined}
                  type="button"
                  role="option"
                  tabindex={-1}
                  data-index={index()}
                  aria-selected={option.value === props.value}
                  class={`select2__option ${index() === activeIndex() ? "is-active" : ""} ${option.value === props.value ? "is-selected" : ""}`}
                  disabled={option.disabled}
                  onMouseEnter={() => setActiveIndex(index())}
                  onMouseDown={(event: MouseEvent) => event.preventDefault()}
                  onClick={() => choose(option)}
                >
                  <span class="select2__option-text">
                    <span class="select2__option-label">{option.label}</span>
                    <Show when={option.hint}>
                      <span class="select2__option-hint">{option.hint}</span>
                    </Show>
                  </span>
                  <Show when={option.value === props.value}>
                    <span class="select2__check"><Icon name="check" size={14} class="" /></span>
                  </Show>
                </button>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  );
}
