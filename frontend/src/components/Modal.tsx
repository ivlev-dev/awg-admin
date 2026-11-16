import { Show } from "@ivlev-dev/silent-core";
import type { Children } from "@ivlev-dev/silent-core";

import { Icon } from "./Icon";

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children?: Children;
  footer?: Children;
  wide?: boolean;
}

export function Modal(props: ModalProps) {
  return (
    <Show when={props.open}>
      <div class="modal-backdrop" onClick={(event: Event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}>
        <div class="modal" style={props.wide ? "max-width: 860px" : undefined} role="dialog" aria-modal="true">
          <div class="modal__head">
            <h2 class="card__title">{props.title}</h2>
            <button class="btn btn--ghost btn--icon" type="button" onClick={props.onClose} aria-label="Закрыть">
              <Icon name="close" size={18} />
            </button>
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
