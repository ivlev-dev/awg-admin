import { For } from "@ivlev-dev/silent-core";

import { Icon } from "./Icon";
import { t } from "@/i18n";

export interface BulkAction {
  readonly label: string;
  readonly onClick: () => void;
  readonly variant?: "primary" | "danger";
  readonly disabled?: boolean;
}

export interface BulkBarProps {
  readonly count: number;
  readonly busy?: boolean;
  readonly actions: readonly BulkAction[];
  readonly onClear: () => void;
}

export function BulkBar(props: BulkBarProps) {
  return (
    <div class="bulk-bar" role="region" aria-label={t("bulk.region")}>
      <span class="bulk-bar__count">{t("bulk.selected", { count: props.count })}</span>
      <div class="bulk-bar__actions">
        <For each={props.actions}>
          {(action) => (
            <button
              class={`btn btn--sm ${
                action.variant === "danger" ? "btn--danger" : action.variant === "primary" ? "btn--primary" : ""
              }`}
              type="button"
              disabled={props.busy || action.disabled}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          )}
        </For>
      </div>
      <button
        class="btn btn--sm btn--ghost btn--icon"
        type="button"
        aria-label={t("bulk.clear")}
        title={t("bulk.clear")}
        onClick={props.onClear}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
