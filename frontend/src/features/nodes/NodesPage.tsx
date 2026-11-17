import { For, Show } from "@ivlev-dev/silent-core";

import type { NodesPageVM } from "./NodesPage.vm";
import { BulkBar } from "@/components/BulkBar";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";
import { t } from "@/i18n";
import { pluralI18n } from "@/i18n/format";

function workerCompose(): string {
  return `services:
  awg-node:
    image: awg-node:latest
    privileged: true
    cap_add:
      - NET_ADMIN
    network_mode: host
    environment:
      AWG_NODE_ID: "${t("nodes.compose.idPlaceholder")}"
      AWG_NODE_TOKEN: "${t("nodes.compose.tokenPlaceholder")}"
      AWG_CONTROL_URL: "https://panel.example.com"
    volumes:
      - /dev/net/tun:/dev/net/tun
    restart: unless-stopped`;
}

function avatarLetter(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function totalInterfaces(vm: NodesPageVM): number {
  return vm.nodes.reduce((sum, node) => sum + node.interfaces, 0);
}

function onlinePercent(vm: NodesPageVM): number {
  if (vm.nodes.length === 0) return 0;
  return Math.round((vm.online / vm.nodes.length) * 100);
}

function firstOnlineWorkerLabel(vm: NodesPageVM): string {
  const node = vm.nodes.find((item) => item.online);
  return node ? vm.workerVersionLabel(node) : t("nodes.metrics.unavailable");
}

function memoryValue(percent: string | null): number {
  if (percent === null) return 0;
  const value = Number.parseInt(percent, 10);
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

function memoryMeterWidth(percent: string | null): string {
  return `${memoryValue(percent)}%`;
}

function memoryMeterClass(percent: string | null): string {
  const value = memoryValue(percent);
  if (value >= 90) return "meter meter--error";
  if (value >= 75) return "meter meter--warn";
  return "meter";
}

function ariaSort(vm: NodesPageVM, key: "name" | "status"): "ascending" | "descending" | undefined {
  const sort = vm.sort;
  if (sort === null || sort.key !== key) return undefined;
  return sort.direction === "asc" ? "ascending" : "descending";
}

export function NodesPage(this: { vm: NodesPageVM }) {
  return (
    <div class="stack">
      <Show when={this.vm.error}>
        <div class="alert alert--error">{this.vm.error}</div>
      </Show>

      <section class="card card--flush">
        <div class="data-toolbar">
          <div class="data-toolbar__top">
            <div>
              <h1 class="data-toolbar__title">{t("nodes.title")}</h1>
              <div class="data-toolbar__sub">
                <span class={`status-chip ${this.vm.online > 0 ? "status-chip--ok" : "status-chip--neutral"}`}>
                  <span class="status-chip__dot"></span>
                  {t("nodes.online", { online: this.vm.online, total: this.vm.nodes.length })}
                </span>
              </div>
            </div>
            <div class="data-toolbar__actions">
              <button class="btn btn--sm" type="button" onClick={() => this.vm.load()} disabled={this.vm.loading}>
                <Icon name="refresh" size={14} class="" /> {t("common.refresh")}
              </button>
              <Show when={this.vm.isAdmin}>
                <button class="btn btn--sm btn--primary" type="button" onClick={() => this.vm.openCreate()}>
                  <Icon name="plus" size={14} class="" /> {t("nodes.add")}
                </button>
              </Show>
            </div>
          </div>

          <div class="data-toolbar__bottom">
            <div class="search">
              <Icon name="search" size={18} class="" />
              <input
                id="nodes-search"
                type="search"
                placeholder={t("nodes.search.placeholder")}
                aria-label={t("filters.search")}
                value={this.vm.query}
                onInput={(event: Event) => this.vm.setQuery(event)}
              />
            </div>
            <div class="field">
              <Select
                id="nodes-status"
                value={this.vm.statusFilter}
                options={[
                  { value: "all", label: t("nodes.filter.allStatuses") },
                  { value: "online", label: t("nodes.status.online") },
                  { value: "offline", label: t("nodes.status.offline") },
                ]}
                onChange={(value) => { this.vm.statusFilter = value as "all" | "online" | "offline"; }}
                ariaLabel={t("nodes.column.status")}
              />
            </div>
            <div class="data-toolbar__spacer"></div>
            <span class="cell-quota">
              {t("filters.found", { found: this.vm.filteredNodes.length, total: this.vm.nodes.length })}
            </span>
          </div>
        </div>

        <Show when={this.vm.loading}>
          <div class="card__body stack-sm">
            <div class="skeleton" style="height:22px;width:40%"></div>
            <div class="skeleton" style="height:56px"></div>
            <div class="skeleton" style="height:56px"></div>
          </div>
        </Show>

        <Show when={!this.vm.loading}>
          <Show
            when={this.vm.nodes.length > 0}
            fallback={
              <>
                <div class="empty">
                  <Icon name="server" size={40} class="empty__icon" />
                  <div class="empty__title">{t("nodes.empty.title")}</div>
                  <div class="empty__text">{t("nodes.empty.text")}</div>
                </div>
                <div class="card__body stack-sm">
                  <div class="strong small">{t("nodes.guide.title")}</div>
                  <div class="xs muted">
                    {t("nodes.guide.step1")}
                  </div>
                  <div class="xs muted">
                    {t("nodes.guide.step2")}
                  </div>
                  <pre class="code">{workerCompose()}</pre>
                  <div class="xs muted">
                    {t("nodes.guide.step3")}
                  </div>
                  <Show when={this.vm.isAdmin}>
                    <div>
                      <button class="btn btn--primary" type="button" onClick={() => this.vm.openCreate()}>
                        <Icon name="plus" size={16} class="" /> {t("nodes.create")}
                      </button>
                    </div>
                  </Show>
                </div>
              </>
            }
          >
            <div class="card__body">
              <div class="grid grid--3">
                <div class="card card--filled">
                  <div class="summary">
                    <div class="cell-avatar" aria-hidden="true"><Icon name="nodes" size={18} class="" /></div>
                    <div class="cell-name__text">
                      <span class="summary__value">{this.vm.online} / {this.vm.nodes.length}</span>
                      <span class="summary__label">{t("nodes.status.online")}</span>
                    </div>
                    <span class="summary__meta">{onlinePercent(this.vm)}%</span>
                  </div>
                </div>
                <div class="card card--filled">
                  <div class="summary">
                    <div class="cell-avatar" aria-hidden="true"><Icon name="interfaces" size={18} class="" /></div>
                    <div class="cell-name__text">
                      <span class="summary__value">{totalInterfaces(this.vm)}</span>
                      <span class="summary__label">
                        {pluralI18n(totalInterfaces(this.vm), "common.interfaces.one", "common.interfaces.few", "common.interfaces.many")}
                      </span>
                    </div>
                  </div>
                </div>
                <div class="card card--filled">
                  <div class="summary">
                    <div class="cell-avatar" aria-hidden="true"><Icon name="shield" size={18} class="" /></div>
                    <div class="cell-name__text">
                      <span class="summary__value mono">{firstOnlineWorkerLabel(this.vm)}</span>
                      <span class="summary__label">{t("nodes.versions.worker")}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="data-scroll">
              <table class="table table--cards">
                <thead>
                  <tr>
                    <th class="cell-select">
                      <input
                        type="checkbox"
                        aria-label={t("nodes.selectAll")}
                        checked={this.vm.allFilteredSelected}
                        onChange={() => this.vm.toggleSelectAll()}
                      />
                    </th>
                    <th class="is-sortable" aria-sort={ariaSort(this.vm, "name")}>
                      <button type="button" onClick={() => this.vm.sortBy("name")}>
                        {t("nodes.column.node")} <span class="sort-indicator">{this.vm.sortMark("name")}</span>
                      </button>
                    </th>
                    <th class="is-sortable" aria-sort={ariaSort(this.vm, "status")}>
                      <button type="button" onClick={() => this.vm.sortBy("status")}>
                        {t("nodes.column.status")} <span class="sort-indicator">{this.vm.sortMark("status")}</span>
                      </button>
                    </th>
                    <th>{t("nodes.column.metrics")}</th>
                    <th>{t("nodes.column.versions")}</th>
                    <th>{t("nodes.column.lastSeen")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <For each={this.vm.filteredNodes}>
                    {(node) => (
                      <tr class={this.vm.isSelected(node.id) ? "is-selected" : ""}>
                        <td class="cell-select">
                          <input
                            type="checkbox"
                            aria-label={node.name}
                            checked={this.vm.isSelected(node.id)}
                            onChange={() => this.vm.toggleSelected(node.id)}
                          />
                        </td>
                        <td data-label={t("nodes.column.node")}>
                          <div class="cell-name">
                            <span class="cell-avatar" aria-hidden="true">{avatarLetter(node.name)}</span>
                            <span class="cell-name__text">
                              <span class="strong">{node.name}</span>
                              <span class="cell-sub xs muted mono nowrap" title={node.id}>
                                {shortId(node.id)} · {this.vm.interfacesLabel(node)}
                              </span>
                            </span>
                          </div>
                        </td>
                        <td data-label={t("nodes.column.status")}>
                          <span class={`status-chip ${node.online ? "status-chip--ok" : "status-chip--neutral"}`}>
                            <span class="status-chip__dot"></span>
                            {node.online ? t("nodes.status.online") : t("nodes.status.offline")}
                          </span>
                        </td>
                        <td data-label={t("nodes.column.metrics")}>
                          <div class="cell-name__text">
                            <span class="xs strong mono">{this.vm.metricsLabel(node)}</span>
                            <Show when={this.vm.memoryPercent(node)}>
                              <div class={memoryMeterClass(this.vm.memoryPercent(node))}>
                                <span style={`width:${memoryMeterWidth(this.vm.memoryPercent(node))}`}></span>
                              </div>
                            </Show>
                            <span class="cell-sub xs muted">
                              <Show when={this.vm.memoryPercent(node)}>
                                <span>{this.vm.memoryPercent(node)} · </span>
                              </Show>
                              {this.vm.metricsUpdatedLabel(node)}
                            </span>
                          </div>
                        </td>
                        <td data-label={t("nodes.column.versions")}>
                          <div class="cell-name__text">
                            <span class="xs">
                              <span class="muted">{t("nodes.versions.worker")}: </span>
                              <span class="mono strong">{this.vm.workerVersionLabel(node)}</span>
                            </span>
                            <span class="cell-sub xs muted mono">
                              {t("nodes.versions.kernel")}: {this.vm.kernelVersionLabel(node)}
                            </span>
                          </div>
                        </td>
                        <td data-label={t("nodes.column.lastSeen")}>
                          <div class="cell-name__text">
                            <span class="nowrap" title={node.last_seen ?? undefined}>{this.vm.lastSeen(node.last_seen)}</span>
                            <span class="cell-sub xs muted nowrap" title={node.token_issued_at ?? undefined}>
                              {t("nodes.column.tokenIssued")}: {this.vm.tokenIssuedLabel(node)}
                            </span>
                          </div>
                        </td>
                        <td class="cell-actions">
                          <Show when={this.vm.isAdmin}>
                            <button
                              class="btn btn--icon"
                              type="button"
                              disabled={this.vm.busy}
                              aria-label={t("nodes.rotate.aria", { name: node.name })}
                              title={t("nodes.rotate")}
                              onClick={() => this.vm.rotate(node)}
                            >
                              <Icon name="shield" size={16} class="" />
                            </button>
                            <button
                              class="btn btn--icon btn--danger"
                              type="button"
                              disabled={this.vm.busy}
                              aria-label={t("common.delete")}
                              title={t("common.delete")}
                              onClick={() => this.vm.remove(node)}
                            >
                              <Icon name="trash" size={16} class="" />
                            </button>
                          </Show>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        </Show>
      </section>

      <Show when={this.vm.selectedCount > 0}>
        <BulkBar
          count={this.vm.selectedCount}
          busy={this.vm.bulkBusy}
          onClear={() => this.vm.clearSelection()}
          actions={[
            { label: t("bulk.delete"), variant: "danger", onClick: () => { void this.vm.bulkDelete(); } },
          ]}
        />
      </Show>

      <Modal
        open={this.vm.createOpen}
        title={t("nodes.form.title")}
        onClose={() => this.vm.closeCreate()}
        footer={
          <>
            <button class="btn" type="button" onClick={() => this.vm.closeCreate()}>{t("common.cancelShort")}</button>
            <button
              class="btn btn--primary"
              type="submit"
              form="node-create"
              disabled={!this.vm.canCreate}
            >
              {this.vm.busy ? t("nodes.form.creating") : t("nodes.form.create")}
            </button>
          </>
        }
      >
        <form id="node-create" class="stack" onSubmit={(event: Event) => this.vm.submitCreate(event)}>
          <div class="field">
            <label for="node-name">{t("nodes.form.name")}</label>
            <input
              id="node-name"
              class="input"
              type="text"
              placeholder={t("nodes.form.namePlaceholder")}
              value={this.vm.name}
              onInput={(event: Event) => this.vm.setName(event)}
            />
            <div class="hint">{t("nodes.form.nameHint")}</div>
          </div>
          <Show when={this.vm.formError}>
            <div class="alert alert--error">{this.vm.formError}</div>
          </Show>
        </form>
      </Modal>

      <Modal
        open={this.vm.createdNode !== null}
        title={t("nodes.created.title")}
        onClose={() => this.vm.closeCreated()}
        footer={<button class="btn btn--primary" type="button" onClick={() => this.vm.closeCreated()}>{t("common.done")}</button>}
      >
        <div class="stack-sm">
          <div class="alert alert--warn">
            {t("nodes.created.tokenNotice")}
          </div>
          <div class="field">
            <label for="node-token">{t("nodes.created.token")}</label>
            <div class="copy-row">
              <input id="node-token" class="input" readonly value={this.vm.createdNode?.token ?? ""} />
              <button class="btn" type="button" onClick={() => this.vm.copyToken()}>
                <Icon name={this.vm.tokenCopied ? "check" : "copy"} size={16} class="" />
                {this.vm.tokenCopied ? t("common.copied") : t("common.copy")}
              </button>
            </div>
          </div>
          <dl class="kv">
            <dt>{t("nodes.created.nodeId")}</dt>
            <dd class="mono">{this.vm.createdNode?.node.id}</dd>
            <dt>{t("nodes.created.name")}</dt>
            <dd>{this.vm.createdNode?.node.name}</dd>
          </dl>
          <div class="xs muted">{t("nodes.created.envHint")}</div>
          <pre class="code code--light">{`AWG_NODE_ID=${this.vm.createdNode?.node.id ?? ""}\nAWG_NODE_TOKEN=${this.vm.createdNode?.token ?? ""}\nAWG_CONTROL_URL=https://panel.example.com`}</pre>
        </div>
      </Modal>

      <Modal
        open={this.vm.rotatedNode !== null}
        title={t("nodes.rotated.title")}
        onClose={() => this.vm.closeRotated()}
        footer={<button class="btn btn--primary" type="button" onClick={() => this.vm.closeRotated()}>{t("common.done")}</button>}
      >
        <div class="stack-sm">
          <div class="alert alert--warn">
            {t("nodes.rotated.notice")}
          </div>
          <div class="field">
            <label for="node-rotated-token">{t("nodes.rotated.token")}</label>
            <div class="copy-row">
              <input id="node-rotated-token" class="input" readonly value={this.vm.rotatedNode?.token ?? ""} />
              <button class="btn" type="button" onClick={() => this.vm.copyRotatedToken()}>
                <Icon name={this.vm.rotatedTokenCopied ? "check" : "copy"} size={16} class="" />
                {this.vm.rotatedTokenCopied ? t("common.copied") : t("common.copy")}
              </button>
            </div>
          </div>
          <dl class="kv">
            <dt>{t("nodes.created.nodeId")}</dt>
            <dd class="mono">{this.vm.rotatedNode?.node.id}</dd>
            <dt>{t("nodes.created.name")}</dt>
            <dd>{this.vm.rotatedNode?.node.name}</dd>
          </dl>
          <div class="xs muted">{t("nodes.created.envHint")}</div>
          <pre class="code code--light">{`AWG_NODE_ID=${this.vm.rotatedNode?.node.id ?? ""}\nAWG_NODE_TOKEN=${this.vm.rotatedNode?.token ?? ""}\nAWG_CONTROL_URL=https://panel.example.com`}</pre>
        </div>
      </Modal>
    </div>
  );
}
