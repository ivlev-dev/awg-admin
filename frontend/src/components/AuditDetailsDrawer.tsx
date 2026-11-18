import { Show } from "@ivlev-dev/silent-core";

import type { AuditDetailsDrawerProps, AuditDetailsDrawerVM } from "./AuditDetailsDrawer.vm";
import { Icon } from "./Icon";
import { t } from "@/i18n";

export type { AuditDetailsDrawerProps } from "./AuditDetailsDrawer.vm";

export function AuditDetailsDrawer(this: { vm: AuditDetailsDrawerVM }, props: AuditDetailsDrawerProps) {
  return (
    <Show when={props.row !== null}>
      <div
        class="audit-drawer-backdrop"
        onClick={(event: MouseEvent) => this.vm.backdropClick(event)}
      >
        <aside
          class="audit-drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby={this.vm.titleId}
          tabindex={-1}
          ref={(element: Element | null) => this.vm.attachRoot(element)}
        >
          <div class="audit-drawer__head">
            <h2 class="audit-drawer__title" id={this.vm.titleId}>{t("audit.drawer.title")}</h2>
            <button
              class="btn btn--ghost btn--icon audit-drawer__close"
              type="button"
              data-autofocus=""
              aria-label={t("audit.drawer.close")}
              title={t("audit.drawer.close")}
              onClick={() => this.vm.close()}
            >
              <Icon name="close" size={18} class="" />
            </button>
          </div>

          <div class="audit-drawer__body">
            <dl class="audit-drawer__fields">
              <div class="audit-drawer__field">
                <dt>{t("audit.column.time")}</dt>
                <dd><span class="mono">{this.vm.time}</span></dd>
              </div>
              <div class="audit-drawer__field">
                <dt>{t("audit.column.actor")}</dt>
                <dd>
                  <span>{this.vm.actor}</span>
                  <Show when={this.vm.actorId}>
                    <span class="audit-drawer__sub mono">{this.vm.actorId}</span>
                  </Show>
                </dd>
              </div>
              <div class="audit-drawer__field">
                <dt>{t("audit.column.action")}</dt>
                <dd><span class="mono">{this.vm.action}</span></dd>
              </div>
              <div class="audit-drawer__field">
                <dt>{t("audit.column.entity")}</dt>
                <dd>
                  <span>{this.vm.entity}</span>
                  <Show when={this.vm.entityId}>
                    <span class="audit-drawer__sub mono">{this.vm.entityId}</span>
                  </Show>
                </dd>
              </div>
              <div class="audit-drawer__field">
                <dt>{t("audit.column.status")}</dt>
                <dd>
                  <span class={`status-chip status-chip--${this.vm.statusTone}`}>
                    <span class="status-chip__dot"></span>
                    {this.vm.status}
                  </span>
                </dd>
              </div>
              <div class="audit-drawer__field">
                <dt>{t("audit.column.ip")}</dt>
                <dd><span class="mono">{this.vm.ip}</span></dd>
              </div>
            </dl>

            <div class="audit-drawer__section">
              <div class="audit-drawer__section-title">{t("audit.column.details")}</div>
              <pre class="audit-drawer__json">{this.vm.details}</pre>
            </div>

            <div class="audit-drawer__actions">
              <button
                class="btn btn--sm btn--primary audit-drawer__copy"
                type="button"
                disabled={!this.vm.canCopy}
                aria-label={t("audit.drawer.copy")}
                title={t("audit.drawer.copy")}
                onClick={() => this.vm.copy()}
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
