import { For, Show } from "@ivlev-dev/silent-core";

import type { ToastItem } from "@/app/toast";
import { t } from "@/i18n";
import { Icon } from "./Icon";

export interface ToastStackProps {
  readonly items: readonly ToastItem[];
  readonly onDismiss: (id: number) => void;
  readonly onPause?: (id: number) => void;
  readonly onResume?: (id: number) => void;
}

function Toast(props: { readonly item: ToastItem; readonly onDismiss: (id: number) => void; readonly onPause?: (id: number) => void; readonly onResume?: (id: number) => void }) {
  return (
    <div
      class={`toast toast--${props.item.kind}`}
      onMouseEnter={() => props.onPause?.(props.item.id)}
      onMouseLeave={() => props.onResume?.(props.item.id)}
      onFocusIn={() => props.onPause?.(props.item.id)}
      onFocusOut={() => props.onResume?.(props.item.id)}
    >
      <span class="grow">{props.item.message}</span>
      <button
        class="toast__close"
        type="button"
        aria-label={t("common.dismissToast")}
        onClick={() => props.onDismiss(props.item.id)}
      >
        <Icon name="close" size={14} class="" />
      </button>
    </div>
  );
}

export function ToastStack(props: ToastStackProps) {
  return (
    <div class="toast-stack">
      <div class="toast-stack__region" role="status" aria-live="polite" aria-atomic="false">
        <For each={props.items}>
          {(item) => (
            <Show when={item.kind !== "error"}>
              <Toast item={item} onDismiss={props.onDismiss} onPause={props.onPause} onResume={props.onResume} />
            </Show>
          )}
        </For>
      </div>
      <div class="toast-stack__region" role="alert" aria-live="assertive" aria-atomic="true">
        <For each={props.items}>
          {(item) => (
            <Show when={item.kind === "error"}>
              <Toast item={item} onDismiss={props.onDismiss} onPause={props.onPause} onResume={props.onResume} />
            </Show>
          )}
        </For>
      </div>
    </div>
  );
}
