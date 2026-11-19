import { Show, onCleanup } from "@ivlev-dev/silent-core";

import { ModalVM, type ModalProps } from "./Modal.vm";
import { Icon } from "./Icon";
import { t } from "@/i18n";

export type { ModalProps } from "./Modal.vm";

export function Modal(props: ModalProps) {
  return (
    <Show when={props.open}>
      <ModalSurface
        open={props.open}
        title={props.title}
        onClose={props.onClose}
        children={props.children}
        footer={props.footer}
        wide={props.wide}
        closable={props.closable}
        ariaLabel={props.ariaLabel}
        describedBy={props.describedBy}
      />
    </Show>
  );
}

function ModalSurface(props: ModalProps) {
  const vm = new ModalVM();
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

  const attach = (element: Element | null): void => {
    vm.attachRoot(element);
    if (element !== null && !started && !stopped) {
      started = true;
      vm.mounted();
    }
  };

  return (
    <div class="modal-backdrop" onClick={(event: Event) => {
      if (props.closable === false) return;
      if (event.target === event.currentTarget) props.onClose();
    }}>
      <div
        class="modal"
        style={props.wide ? "max-width: 860px" : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={props.title ? vm.titleId : undefined}
        aria-label={props.title ? undefined : props.ariaLabel ?? t("common.dialog")}
        aria-describedby={props.describedBy}
        tabindex={-1}
        ref={attach}
      >
        <div class="modal__head">
          <h2 class="card__title" id={vm.titleId}>{props.title}</h2>
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
  );
}
