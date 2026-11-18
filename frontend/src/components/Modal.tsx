import { Show } from "@ivlev-dev/silent-core";

import type { ModalProps, ModalVM } from "./Modal.vm";
import { Icon } from "./Icon";
import { t } from "@/i18n";

export type { ModalProps } from "./Modal.vm";

export function Modal(this: { vm: ModalVM }, props: ModalProps) {
  return (
    <Show when={props.open}>
      <div class="modal-backdrop" onClick={(event: Event) => {
        if (props.closable === false) return;
        if (event.target === event.currentTarget) props.onClose();
      }}>
        <div
          class="modal"
          style={props.wide ? "max-width: 860px" : undefined}
          role="dialog"
          aria-modal="true"
          aria-labelledby={props.title ? this.vm.titleId : undefined}
          aria-label={props.title ? undefined : props.ariaLabel ?? t("common.dialog")}
          aria-describedby={props.describedBy}
          tabindex={-1}
          ref={(element: Element | null) => this.vm.attachRoot(element)}
        >
          <div class="modal__head">
            <h2 class="card__title" id={this.vm.titleId}>{props.title}</h2>
            <Show when={props.closable !== false}>
              <button class="btn btn--ghost btn--icon" type="button" onClick={props.onClose} aria-label={t("common.close")}>
                <Icon name="close" size={18} />
              </button>
            </Show>
          </div>
          <div class="modal__body">{props.children}</div>
          <Show when={props.footer}>
            <div class="modal__foot">{props.footer}</div>
          </Show>
        </div>
      </div>
    </Show>
  );
}
