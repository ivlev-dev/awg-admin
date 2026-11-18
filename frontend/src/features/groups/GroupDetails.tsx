import { For, Show } from "@ivlev-dev/silent-core";

import type { GroupDetailsVM } from "./GroupDetails.vm";
import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";
import { Modal } from "@/components/Modal";
import { Skeleton, SkeletonCards, SkeletonTable } from "@/components/Skeleton";
import { t } from "@/i18n";

export function GroupDetails(this: { vm: GroupDetailsVM }) {
  const form = (
    <form id="group-edit-form" class="stack" onSubmit={(event: Event) => this.vm.saveForm(event)}>
      <div class="field">
        <label for="group-edit-name">{t("groups.form.name")}</label>
        <input
          id="group-edit-name"
          class="input"
          type="text"
          placeholder={t("groups.form.namePlaceholder")}
          value={this.vm.formName}
          onInput={(event: Event) => this.vm.setFormName(event)}
        />
      </div>
      <div class="field">
        <label for="group-edit-description">{t("groups.form.description")}</label>
        <textarea
          id="group-edit-description"
          class="textarea"
          placeholder={t("groups.form.descriptionPlaceholder")}
          value={this.vm.formDescription}
          onInput={(event: Event) => this.vm.setFormDescription(event)}
        ></textarea>
      </div>
      <div class="field">
        <label for="group-edit-cidr">{t("groups.form.baseCidr")}</label>
        <input
          id="group-edit-cidr"
          class="input mono"
          type="text"
          placeholder="10.8.0.0/16"
          value={this.vm.formBaseCidr}
          onInput={(event: Event) => this.vm.setFormBaseCidr(event)}
        />
        <span class="hint">{t("groups.form.baseCidrHint")}</span>
      </div>
      <label class="checkbox">
        <input
          type="checkbox"
          checked={this.vm.formForwarding}
          onChange={(event: Event) => this.vm.setFormForwarding(event)}
        />
        <span>{t("groups.forwardingDefault")}</span>
      </label>
      <Show when={this.vm.formError}>
        <div class="alert alert--error">{this.vm.formError}</div>
      </Show>
    </form>
  );

  const formFooter = (
    <div class="actions-bar">
      <button class="btn" type="button" onClick={() => this.vm.closeForm()} disabled={this.vm.formSaving}>
        {t("common.cancelShort")}
      </button>
      <button class="btn btn--primary" type="submit" form="group-edit-form" disabled={!this.vm.canSaveForm}>
        {this.vm.formSaving ? t("common.saving") : t("common.saveShort")}
      </button>
    </div>
  );

  const poolForm = (
    <form id="pool-form" class="stack" onSubmit={(event: Event) => this.vm.savePool(event)}>
      <div class="field">
        <label for="pool-name">{t("groups.details.pools.form.name")}</label>
        <input
          id="pool-name"
          class="input"
          type="text"
          placeholder={t("groups.details.pools.form.namePlaceholder")}
          value={this.vm.poolName}
          onInput={(event: Event) => this.vm.setPoolName(event)}
        />
      </div>
      <div class="field">
        <label for="pool-cidr">{t("groups.details.pools.form.cidr")}</label>
        <input
          id="pool-cidr"
          class="input mono"
          type="text"
          placeholder={t("groups.details.pools.form.cidrPlaceholder")}
          value={this.vm.poolCidr}
          onInput={(event: Event) => this.vm.setPoolCidr(event)}
          disabled={this.vm.editingPool !== null}
        />
        <span class="hint">{t("groups.details.pools.form.cidrHint", { cidr: this.vm.baseCidr })}</span>
      </div>
      <div class="field">
        <label for="pool-mode">{t("groups.details.pools.form.mode")}</label>
        <Select
          id="pool-mode"
          value={this.vm.poolMode}
          options={[
            { value: "auto", label: t("groups.details.pools.mode.auto") },
            { value: "rf_only", label: t("groups.details.pools.mode.rfOnly") },
            { value: "external_only", label: t("groups.details.pools.mode.externalOnly") },
          ]}
          onChange={(value) => this.vm.setPoolMode(value)}
          ariaLabel={t("groups.details.pools.form.modeAria")}
        />
      </div>
      <div class="field">
        <label for="pool-gateway">{t("groups.details.pools.form.gateway")}</label>
        <input
          id="pool-gateway"
          class="input mono"
          type="text"
          placeholder={t("groups.details.pools.form.gatewayPlaceholder")}
          value={this.vm.poolGateway}
          onInput={(event: Event) => this.vm.setPoolGateway(event)}
        />
        <span class="hint">{t("groups.details.pools.form.gatewayHint")}</span>
      </div>
      <label class={`switch ${this.vm.editingPool ? "" : "hidden"}`}>
        <input
          type="checkbox"
          checked={this.vm.poolEnabled}
          onChange={(event: Event) => this.vm.setPoolEnabled(event)}
        />
        <span class="track"></span>
        <span>{t("groups.details.pools.form.enabled")}</span>
      </label>
      <Show when={this.vm.poolError}>
        <div class="alert alert--error">{this.vm.poolError}</div>
      </Show>
    </form>
  );

  const poolFooter = (
    <div class="actions-bar">
      <button class="btn" type="button" onClick={() => this.vm.closePool()} disabled={this.vm.poolSaving}>
        {t("common.cancelShort")}
      </button>
      <button class="btn btn--primary" type="submit" form="pool-form" disabled={!this.vm.canSavePool}>
        {this.vm.poolSaving ? t("common.saving") : t("common.saveShort")}
      </button>
    </div>
  );

  return (
    <div class="stack">
      <div class="row-between wrap">
        <button class="btn btn--sm btn--ghost" type="button" onClick={() => this.vm.back()}>
          ← {t("groups.details.back")}
        </button>
        <Show when={this.vm.group}>
          <button class="btn btn--sm" type="button" onClick={() => this.vm.openForm()}>
            <Icon name="edit" size={14} class="" /> {t("groups.details.edit")}
          </button>
        </Show>
      </div>

      <Show when={this.vm.error}>
        <div class="alert alert--error">{this.vm.error}</div>
      </Show>

      <Show
        when={!this.vm.loading}
        fallback={
          <div class="stack">
            <div class="page-head">
              <Skeleton width={110} height={12} />
              <div style="margin-top:10px">
                <Skeleton width="min(320px, 60%)" height={30} />
              </div>
              <div style="margin-top:10px">
                <Skeleton width="min(460px, 90%)" height={14} />
              </div>
            </div>
            <SkeletonCards count={3} />
            <section class="card">
              <div class="card__head">
                <div>
                  <Skeleton width={180} height={16} />
                  <div style="margin-top:8px">
                    <Skeleton width={260} height={12} />
                  </div>
                </div>
              </div>
              <SkeletonTable rows={4} columns={5} />
            </section>
          </div>
        }
      >
        <Show
          when={this.vm.group}
          fallback={
            <div class="empty">
              <Icon name="warning" size={40} class="empty__icon" />
              <div class="empty__title">{t("groups.details.notFound.title")}</div>
              <div class="small">{t("groups.details.notFound.text")}</div>
              <div style="margin-top:16px">
                <button class="btn" type="button" onClick={() => this.vm.back()}>
                  {t("groups.details.notFound.action")}
                </button>
              </div>
            </div>
          }
        >
          <div class="stack">
            <div class="page-head">
              <div class="page-head__eyebrow">{t("groups.details.eyebrow")}</div>
              <div class="row" style="gap:10px">
                <h1>{this.vm.title}</h1>
                <Show when={this.vm.forwardingDefault}>
                  <span class="badge badge--blue">forwarding_default</span>
                </Show>
              </div>
              <p>{this.vm.subtitle}</p>
              <div class="row wrap" style="gap:14px;margin-top:10px">
                <span class="small muted" style="display:inline-flex;gap:6px">
                  {t("groups.details.baseCidr")} <span class="mono strong">{this.vm.baseCidr}</span>
                </span>
                <span class="small muted" style="display:inline-flex;gap:6px">
                  {t("groups.details.interfacesCount")}: <span class="strong">{this.vm.interfaceCount}</span>
                </span>
                <span class="small muted" style="display:inline-flex;gap:6px">
                  {t("groups.details.devicesCount")}: <span class="strong">{this.vm.deviceCount}</span>
                </span>
              </div>
            </div>

            <section class="card">
              <div class="card__head">
                <div>
                  <div class="card__title">{t("groups.details.pools.title")}</div>
                  <div class="card__sub">{t("groups.details.pools.subtitle")}</div>
                </div>
                <button class="btn btn--sm" type="button" onClick={() => this.vm.openPoolForm()}>
                  <Icon name="plus" size={14} class="" /> {t("groups.details.pools.add")}
                </button>
              </div>
              <Show
                when={this.vm.pools.length > 0}
                fallback={
                  <div class="empty">
                    <div class="empty__title">{t("groups.details.pools.emptyTitle")}</div>
                    <div class="small">{t("groups.details.pools.emptyText", { cidr: this.vm.baseCidr })}</div>
                  </div>
                }
              >
                <div class="table-wrap">
                  <table class="table table--cards">
                    <thead>
                      <tr>
                        <th>{t("groups.details.pools.column.name")}</th>
                        <th>{t("groups.details.pools.column.cidr")}</th>
                        <th>{t("groups.details.pools.column.mode")}</th>
                        <th>{t("groups.details.pools.column.gateway")}</th>
                        <th>{t("groups.details.pools.column.status")}</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={this.vm.pools}>
                        {(pool) => (
                          <tr>
                            <td data-label={t("groups.details.pools.column.name")}>
                              <span class="strong">{pool.name}</span>
                            </td>
                            <td data-label={t("groups.details.pools.column.cidr")} class="mono">
                              {pool.cidr}
                            </td>
                            <td data-label={t("groups.details.pools.column.mode")}>
                              <span class={this.vm.poolModeBadge(pool.mode)}>{this.vm.poolModeLabel(pool.mode)}</span>
                            </td>
                            <td data-label={t("groups.details.pools.column.gateway")} class="mono">
                              {pool.gateway ?? "—"}
                            </td>
                            <td data-label={t("groups.details.pools.column.status")}>
                              <span class={`badge ${pool.enabled ? "badge--green" : "badge--red"}`}>
                                {pool.enabled
                                  ? t("groups.details.pools.status.enabled")
                                  : t("groups.details.pools.status.disabled")}
                              </span>
                            </td>
                            <td>
                              <div class="cell-actions">
                                <button
                                  class="btn btn--sm btn--ghost btn--icon"
                                  type="button"
                                  aria-label={t("groups.details.pools.editAria")} title={t("groups.details.pools.editAria")}
                                  onClick={() => this.vm.openPoolForm(pool)}
                                >
                                  <Icon name="edit" size={14} class="" />
                                </button>
                                <button
                                  class="btn btn--sm btn--ghost btn--icon"
                                  type="button"
                                  aria-label={t("groups.details.pools.deleteAria")} title={t("groups.details.pools.deleteAria")}
                                  onClick={() => this.vm.removePool(pool)}
                                >
                                  <Icon name="trash" size={14} class="" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </Show>
              <div class="card__foot xs muted">
                {t("groups.details.pools.footer")}
              </div>
            </section>

            <section class="card">
              <div class="card__head">
                <div>
                  <div class="card__title">{t("groups.details.interfaces.title")}</div>
                  <div class="card__sub">{t("groups.details.interfaces.subtitle")}</div>
                </div>
                <button class="btn btn--sm" type="button" onClick={() => this.vm.openInterfaces()}>
                  <Icon name="interfaces" size={14} class="" /> {t("groups.details.interfaces.all")}
                </button>
              </div>
              <Show
                when={this.vm.interfaces.length > 0}
                fallback={
                  <div class="empty">
                    <div class="empty__title">{t("groups.details.interfaces.emptyTitle")}</div>
                    <div class="small">{t("groups.details.interfaces.emptyText")}</div>
                  </div>
                }
              >
                <div class="table-wrap">
                  <table class="table table--cards">
                    <thead>
                      <tr>
                        <th>{t("groups.details.interfaces.column.name")}</th>
                        <th>{t("groups.details.interfaces.column.label")}</th>
                        <th>{t("groups.details.interfaces.column.node")}</th>
                        <th>{t("groups.details.interfaces.column.peers")}</th>
                        <th>{t("groups.details.interfaces.column.status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={this.vm.interfaces}>
                        {(item) => (
                          <tr>
                            <td data-label={t("groups.details.interfaces.column.name")}>
                              <span class="mono strong">{item.name}</span>
                            </td>
                            <td data-label={t("groups.details.interfaces.column.label")}>{item.label || "—"}</td>
                            <td data-label={t("groups.details.interfaces.column.node")}>{item.node_name}</td>
                            <td data-label={t("groups.details.interfaces.column.peers")} class="mono">
                              {item.peers}
                            </td>
                            <td data-label={t("groups.details.interfaces.column.status")}>
                              <span class={`badge ${item.enabled ? "badge--green" : "badge--red"}`}>
                                {item.enabled
                                  ? t("groups.details.pools.status.enabled")
                                  : t("groups.details.pools.status.disabled")}
                              </span>
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </Show>
            </section>
          </div>
        </Show>
      </Show>

      <Modal open={this.vm.formOpen} title={t("groups.form.title.edit")} onClose={() => this.vm.closeForm()} footer={formFooter}>
        {form}
      </Modal>

      <Modal
        open={this.vm.poolOpen}
        title={this.vm.editingPool ? t("groups.details.pools.form.title.edit") : t("groups.details.pools.form.title.new")}
        onClose={() => this.vm.closePool()}
        footer={poolFooter}
      >
        {poolForm}
      </Modal>
    </div>
  );
}
