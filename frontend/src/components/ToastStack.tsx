import { For, Show } from "@ivlev-dev/silent-core";

import type { ToastItem } from "@/app/toast";
import { Icon } from "./Icon";

export interface ToastStackProps {
  readonly items: readonly ToastItem[];
  readonly onDismiss: (id: number) => void;
}

function Toast(props: { readonly item: ToastItem; readonly onDismiss: (id: number) => void }) {
  return (
    <div class={`toast toast--${props.item.kind}`} onClick={() => props.onDismiss(props.item.id)}>
      <span class="grow">{props.item.message}</span>
      <Icon name="close" size={14} class="" />
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
              <Toast item={item} onDismiss={props.onDismiss} />
            </Show>
          )}
        </For>
      </div>
      <div class="toast-stack__region" role="alert" aria-live="assertive" aria-atomic="true">
        <For each={props.items}>
          {(item) => (
            <Show when={item.kind === "error"}>
              <Toast item={item} onDismiss={props.onDismiss} />
            </Show>
          )}
        </For>
      </div>
    </div>
  );
}
