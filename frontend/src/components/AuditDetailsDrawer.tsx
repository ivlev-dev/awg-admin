import { Show, onCleanup } from "@ivlev-dev/silent-core";

import { AuditDetailsDrawerVM, type AuditDetailsDrawerProps } from "./AuditDetailsDrawer.vm";
import { Icon } from "./Icon";
import { t } from "@/i18n";

export type { AuditDetailsDrawerProps } from "./AuditDetailsDrawer.vm";

export function AuditDetailsDrawer(props: AuditDetailsDrawerProps) {
  return (
    <Show when={props.row !== null}>
      <AuditDetailsDrawerSurface row={props.row} onClose={props.onClose} onCopy={props.onCopy} />
    </Show>
  );
}

export function AuditDetailsDrawerSurface(props: AuditDetailsDrawerProps) {
  const vm = new AuditDetailsDrawerVM();
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
    <Show when={props.row !== null}>
      <div
        class="audit-drawer-backdrop"
        onClick={(event: MouseEvent) => vm.backdropClick(event)}
      >
        <aside
          class="audit-drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby={vm.titleId}
          tabindex={-1}
          ref={attach}
        >
          <div class="audit-drawer__head">
            <h2 class="audit-drawer__title" id={vm.titleId}>{t("audit.drawer.title")}</h2>
            <button
              class="btn btn--ghost btn--icon audit-drawer__close"
              type="button"
              data-autofocus=""
              aria-label={t("audit.drawer.close")}
              title={t("audit.drawer.close")}
              onClick={() => vm.close()}
            >
              <Icon name="close" size={18} class="" />
            </button>
          </div>

          <div class="audit-drawer__body">
            <dl class="audit-drawer__fields">
              <div class="audit-drawer__field">
                <dt>{t("audit.column.time")}</dt>
                <dd><span class="mono">{vm.time}</span></dd>
              </div>
              <div class="audit-drawer__field">
                <dt>{t("audit.column.actor")}</dt>
                <dd>
                  <span>{vm.actor}</span>
                  <Show when={vm.actorId}>
                    <span class="audit-drawer__sub mono">{vm.actorId}</span>
                  </Show>
                </dd>
              </div>
              <div class="audit-drawer__field">
                <dt>{t("audit.column.action")}</dt>
                <dd><span class="mono">{vm.action}</span></dd>
              </div>
              <div class="audit-drawer__field">
                <dt>{t("audit.column.entity")}</dt>
                <dd>
                  <span>{vm.entity}</span>
                  <Show when={vm.entityId}>
                    <span class="audit-drawer__sub mono">{vm.entityId}</span>
                  </Show>
                </dd>
              </div>
              <div class="audit-drawer__field">
                <dt>{t("audit.column.status")}</dt>
                <dd>
                  <span class={`status-chip status-chip--${vm.statusTone}`}>
                    <span class="status-chip__dot"></span>
                    {vm.status}
                  </span>
                </dd>
              </div>
              <div class="audit-drawer__field">
                <dt>{t("audit.column.ip")}</dt>
                <dd><span class="mono">{vm.ip}</span></dd>
              </div>
            </dl>

            <div class="audit-drawer__section">
              <div class="audit-drawer__section-title">{t("audit.column.details")}</div>
              <pre class="audit-drawer__json">{vm.details}</pre>
            </div>

            <div class="audit-drawer__actions">
              <button
                class="btn btn--sm btn--primary audit-drawer__copy"
                type="button"
                disabled={!vm.canCopy}
                aria-label={t("audit.drawer.copy")}
                title={t("audit.drawer.copy")}
                onClick={() => vm.copy()}
              >
                <Icon name="copy" size={14} class="" /> {t("audit.drawer.copy")}
              </button>
            </div>
          </div>
        </aside>
      </div>
    </Show>
  );
}
