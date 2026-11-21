import { For, Show, ViewModel, computed, createEffect, createRoot, onCleanup } from "@ivlev-dev/silent-core";

import { CommandStore, filterCommands, type CommandItem } from "@/app/command";
import { Icon } from "@/components/Icon";
import { t } from "@/i18n";
import {
  createBackgroundGuard,
  lockBodyScroll,
  trapTab,
  unlockBodyScroll,
} from "@/components/overlay";

export interface CommandPaletteProps {
  open: boolean;
  items: readonly CommandItem[];
  onRun: (item: CommandItem) => void;
  onClose: () => void;
}

let paletteCounter = 0;

export class CommandPaletteVM extends ViewModel<CommandPaletteProps> {
  readonly store = new CommandStore();

  readonly listId = `command-list-${++paletteCounter}`;

  private root: HTMLElement | null = null;

  private input: HTMLInputElement | null = null;

  private openState = false;

  private shouldFocus = false;

  private focusRetries = 0;

  private stopEffect: (() => void) | null = null;

  private opener: HTMLElement | null = null;

  private readonly background = createBackgroundGuard();

  private scrollLocked = false;

  @computed
  get visible(): CommandItem[] {
    return filterCommands(this.props.items, this.store.query);
  }

  @computed
  get selectedIndex(): number {
    const count = this.visible.length;
    if (count === 0) return -1;
    return Math.min(this.store.selected, count - 1);
  }

  @computed
  get activeOptionId(): string | undefined {
    if (!this.props.open) return undefined;
    const index = this.selectedIndex;
    if (index < 0) return undefined;
    return this.optionId(index);
  }

  override mounted(): void {
    document.addEventListener("keydown", this.onKeydown);
    this.stopEffect = createRoot((dispose) => {
      createEffect(() => {
        this.syncOpen(this.props.open);
        this.store.setCount(this.visible.length);
      });
      return dispose;
    });
  }

  override unmounted(): void {
    document.removeEventListener("keydown", this.onKeydown);
    this.stopEffect?.();
    this.stopEffect = null;
    this.restoreBackground();
    this.unlockScroll();
    if (this.openState) {
      this.openState = false;
      this.restoreFocus();
    }
    this.root = null;
    this.input = null;
  }

  attachRoot(element: Element | null): void {
    this.root = element instanceof HTMLElement ? element : null;
    if (this.root !== null && this.openState) this.suppressBackground();
    if (this.shouldFocus) this.tryFocus();
  }

  attachInput(element: Element | null): void {
    this.input = element instanceof HTMLInputElement ? element : null;
    if (this.shouldFocus) this.tryFocus();
  }

  optionId(index: number): string {
    return `${this.listId}-option-${index}`;
  }

  setQuery(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    this.store.setQuery(target.value);
  }

  setSelected(index: number): void {
    this.store.setSelected(index);
  }

  move(delta: number): void {
    this.store.setCount(this.visible.length);
    this.store.move(delta);
    queueMicrotask(() => this.scrollSelectedIntoView());
  }

  run(item: CommandItem): void {
    this.props.onRun(item);
  }

  private syncOpen(open: boolean): void {
    if (open === this.openState) return;
    this.openState = open;
    if (open) {
      const active = document.activeElement;
      this.opener = active instanceof HTMLElement ? active : null;
      this.store.openPalette();
      this.shouldFocus = true;
      this.focusRetries = 0;
      this.suppressBackground();
      this.tryFocus();
      this.lockScroll();
      return;
    }
    this.shouldFocus = false;
    this.store.close();
    this.restoreBackground();
    this.unlockScroll();
    this.restoreFocus();
  }

  private lockScroll(): void {
    if (this.scrollLocked) return;
    this.scrollLocked = true;
    lockBodyScroll();
  }

  private unlockScroll(): void {
    if (!this.scrollLocked) return;
    this.scrollLocked = false;
    unlockBodyScroll();
  }

  private restoreFocus(): void {
    const opener = this.opener;
    this.opener = null;
    if (opener !== null && opener.isConnected) opener.focus();
  }

  private suppressBackground(): void {
    this.background.suppress(this.root);
  }

  private restoreBackground(): void {
    this.background.restore();
  }

  private tryFocus(): void {
    if (!this.shouldFocus) return;
    const input = this.input;
    if (input === null || !input.isConnected) {
      if (this.focusRetries >= 2) return;
      this.focusRetries += 1;
      queueMicrotask(() => this.tryFocus());
      return;
    }
    this.focusRetries = 0;
    this.shouldFocus = false;
    input.focus();
  }

  private selectedItem(): CommandItem | undefined {
    return this.store.selectedItem(this.visible);
  }

  private scrollSelectedIntoView(): void {
    const root = this.root;
    const index = this.selectedIndex;
    if (root === null || index < 0) return;
    const option = root.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (option !== null && typeof option.scrollIntoView === "function") {
      option.scrollIntoView({ block: "nearest" });
    }
  }

  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (!this.props.open || event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.props.onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.move(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      this.move(-1);
      return;
    }
    if (event.key === "Enter") {
      const item = this.selectedItem();
      if (item === undefined) return;
      event.preventDefault();
      this.run(item);
      return;
    }
    if (event.key === "Tab") {
      trapTab(event, this.root);
    }
  };
}

export function CommandPalette(props: CommandPaletteProps) {
  return (
    <Show when={props.open}>
      <CommandPaletteSurface
        open={props.open}
        items={props.items}
        onRun={props.onRun}
        onClose={props.onClose}
      />
    </Show>
  );
}

export function CommandPaletteSurface(props: CommandPaletteProps) {
  const vm = new CommandPaletteVM();
  vm.props = props;
  let started = false;
  let stopped = false;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    vm.unmounted();
    vm.dispose();
  };

  onCleanup(stop);

  const attachRoot = (element: Element | null): void => {
    vm.attachRoot(element);
    if (element !== null && !started && !stopped) {
      started = true;
      vm.mounted();
    }
  };

  const attachInput = (element: Element | null): void => {
    vm.attachInput(element);
  };

  return (
    <Show when={props.open}>
      <div
        class="command-backdrop"
        onClick={(event: Event) => {
          if (event.target === event.currentTarget) props.onClose();
        }}
      >
        <div
          class="command-palette"
          role="dialog"
          aria-modal="true"
          aria-label={t("command.search")}
          tabindex={-1}
          ref={attachRoot}
        >
          <div class="command-palette__field">
            <span class="command-palette__search-icon" aria-hidden="true">
              <Icon name="search" size={18} class="" />
            </span>
            <input
              class="command-palette__input"
              type="text"
              role="combobox"
              aria-expanded={props.open ? "true" : "false"}
              aria-controls={vm.listId}
              aria-autocomplete="list"
              aria-activedescendant={vm.activeOptionId}
              aria-label={t("command.search")}
              placeholder={t("command.placeholder")}
              autocomplete="off"
              value={vm.store.query}
              onInput={(event: Event) => vm.setQuery(event)}
              ref={attachInput}
            />
            <kbd class="command-palette__kbd">Esc</kbd>
          </div>

          <Show
            when={vm.visible.length > 0}
            fallback={<div class="command-palette__empty" role="status">{t("command.empty")}</div>}
          >
            <div class="command-palette__list" role="listbox" id={vm.listId} aria-label={t("command.search")}>
              <For each={vm.visible}>
                {(item, index) => (
                  <button
                    id={vm.optionId(index())}
                    class={`command-palette__item ${index() === vm.selectedIndex ? "is-selected" : ""}`}
                    type="button"
                    role="option"
                    tabindex={-1}
                    aria-selected={index() === vm.selectedIndex}
                    data-index={index()}
                    onMouseEnter={() => vm.setSelected(index())}
                    onMouseDown={(event: MouseEvent) => event.preventDefault()}
                    onClick={() => vm.run(item)}
                  >
                    <span class="command-palette__icon" aria-hidden="true">
                      <Icon name={item.icon ?? "search"} size={18} class="" />
                    </span>
                    <span class="command-palette__text">
                      <span class="command-palette__title">{item.title}</span>
                      <Show when={item.hint}>
                        <span class="command-palette__hint">{item.hint}</span>
                      </Show>
                    </span>
                    <Show when={index() === vm.selectedIndex}>
                      <span class="command-palette__enter" aria-hidden="true">
                        <kbd class="command-palette__kbd">↵</kbd>
                      </span>
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </Show>

          <div class="command-palette__foot">
            <span class="command-palette__foot-item">
              <kbd class="command-palette__kbd">↑</kbd>
              <kbd class="command-palette__kbd">↓</kbd>
              {t("command.hint")}
            </span>
            <span class="command-palette__foot-item">
              <kbd class="command-palette__kbd">Enter</kbd>
            </span>
          </div>
        </div>
      </div>
    </Show>
  );
}
