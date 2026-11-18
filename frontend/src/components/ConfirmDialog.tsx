import { Show, createEffect, createSignal } from "@ivlev-dev/silent-core";

import { confirmStore } from "@/app/confirm";
import { t } from "@/i18n";

function trapTab(event: KeyboardEvent): void {
  if (event.key !== "Tab") return;
  const root = event.currentTarget;
  if (!(root instanceof HTMLElement)) return;
  const buttons = Array.from(root.querySelectorAll<HTMLElement>("button:not([disabled])"));
  if (buttons.length === 0) return;
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

export function ConfirmDialog() {
  const [root, setRoot] = createSignal<HTMLElement | null>(null);

  createEffect(() => {
    if (confirmStore.state === null) return;
    const dialog = root();
    const confirm = dialog?.querySelector<HTMLButtonElement>(".modal__foot .btn:last-child");
    confirm?.focus();
  });

  return (
    <Show when={confirmStore.state !== null}>
      <div
        class="modal-backdrop confirm-backdrop"
        onClick={(event: Event) => {
          if (event.target === event.currentTarget) confirmStore.cancel();
        }}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key === "Escape") {
            confirmStore.cancel();
            return;
          }
          trapTab(event);
        }}
      >
        <div
          class="modal confirm-dialog"
          ref={(element: Element | null) => setRoot(element instanceof HTMLElement ? element : null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
        >
          <div class="modal__head">
            <h2 class="card__title" id="confirm-dialog-title">
              {confirmStore.state?.title ?? ""}
            </h2>
          </div>
          <div class="modal__body">
            <p class="confirm-dialog__message">{confirmStore.state?.message ?? ""}</p>
          </div>
          <div class="modal__foot">
            <button class="btn" type="button" onClick={() => confirmStore.cancel()}>
              {confirmStore.state?.cancelLabel ?? t("common.cancelShort")}
            </button>
            <button
              class={`btn ${confirmStore.state?.tone === "primary" ? "btn--primary" : "btn--danger"}`}
              type="button"
              onClick={() => confirmStore.accept()}
            >
              {confirmStore.state?.confirmLabel ?? t("common.confirm")}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
