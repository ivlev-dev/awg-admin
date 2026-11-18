import { For, Show } from "@ivlev-dev/silent-core";

import type { SelectProps, SelectVM } from "./Select.vm";
import { Icon } from "./Icon";
import { t } from "@/i18n";

export function Select(this: { vm: SelectVM }, props: SelectProps) {
  return (
    <div class={`select2 ${this.vm.open ? "is-open" : ""} ${this.vm.dropUp ? "is-up" : ""}`}>
      <button
        id={this.vm.props.id}
        class="select select-trigger"
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={this.vm.open}
        aria-controls={this.vm.menuId || undefined}
        aria-activedescendant={this.vm.activeDescendant}
        aria-label={this.vm.props.ariaLabel}
        disabled={this.vm.props.disabled}
        onClick={() => this.vm.toggle()}
        onKeydown={(event: KeyboardEvent) => this.vm.onKeydown(event)}
      >
        <span class={`select2__value ${this.vm.placeholderVisible ? "is-placeholder" : ""}`}>{this.vm.label}</span>
        <span class="select2__chevron"><Icon name="chevron" size={14} class="" /></span>
      </button>

      <Show when={this.vm.open}>
        <div id={this.vm.menuId || undefined} class="select2__menu" role="listbox" aria-label={this.vm.props.ariaLabel}>
          <Show
            when={this.vm.props.options.length > 0}
            fallback={<div class="select2__empty">{t("common.selectEmpty")}</div>}
          >
            <For each={this.vm.props.options}>
              {(option, index) => (
                <button
                  id={this.vm.props.id ? `${this.vm.props.id}-option-${index()}` : undefined}
                  type="button"
                  role="option"
                  tabindex={-1}
                  data-index={index()}
                  aria-selected={option.value === this.vm.props.value}
                  class={`select2__option ${index() === this.vm.activeIndex ? "is-active" : ""} ${option.value === this.vm.props.value ? "is-selected" : ""}`}
                  disabled={option.disabled}
                  onMouseEnter={() => this.vm.setActive(index())}
                  onMouseDown={(event: MouseEvent) => event.preventDefault()}
                  onClick={() => this.vm.choose(option)}
                >
                  <span class="select2__option-text">
                    <span class="select2__option-label">{option.label}</span>
                    <Show when={option.hint}>
                      <span class="select2__option-hint">{option.hint}</span>
                    </Show>
                  </span>
                  <Show when={option.value === this.vm.props.value}>
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
