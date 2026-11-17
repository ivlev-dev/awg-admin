import { For, Show } from "@ivlev-dev/silent-core";

import type { NodesPageVM } from "./NodesPage.vm";
import { BulkBar } from "@/components/BulkBar";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";
import { t } from "@/i18n";

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

export function NodesPage(this: { vm: NodesPageVM }) {
  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">{t("nodes.eyebrow")}</div>
        <div class="row-between wrap">
          <div>
            <h1>{t("nodes.title")}</h1>
            <p>{t("nodes.subtitle")}</p>
          </div>
          <div class="actions-bar">
            <span class="badge badge--blue">
              <span class="dot dot--green"></span>
              {t("nodes.online", { online: this.vm.online, total: this.vm.nodes.length })}
            </span>
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
      </div>

      <Show when={this.vm.error}>
        <div class="alert alert--error">{this.vm.error}</div>
      </Show>

      <section class="card">
        <div class="card__body">
          <div class="list-toolbar">
            <div class="field">
              <label for="nodes-search">{t("filters.search")}</label>
              <input
                id="nodes-search"
                class="input"
                type="search"
                placeholder={t("nodes.search.placeholder")}
                value={this.vm.query}
                onInput={(event: Event) => this.vm.setQuery(event)}
              />
            </div>
            <div class="field field--compact">
              <label for="nodes-status">{t("nodes.column.status")}</label>
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
          </div>
        </div>
      </section>

      <Show when={this.vm.loading}>
        <section class="card">
          <div class="card__body stack-sm">
            <div class="skeleton" style="height:22px;width:40%"></div>
            <div class="skeleton" style="height:56px"></div>
            <div class="skeleton" style="height:56px"></div>
          </div>
        </section>
      </Show>

      <Show when={!this.vm.loading}>
        <Show
          when={this.vm.nodes.length > 0}
          fallback={
            <section class="card">
              <div class="empty">
                <Icon name="server" size={40} class="empty__icon" />
                <div class="empty__title">{t("nodes.empty.title")}</div>
                <div class="small">{t("nodes.empty.text")}</div>
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
            </section>
          }
        >
          <section class="card card--flush">
            <div class="table-wrap">
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
                    <th class="is-sortable">
                      <button type="button" onClick={() => this.vm.sortBy("name")}>
                        {t("nodes.column.node")} <span class="sort-indicator">{this.vm.sortMark("name")}</span>
                      </button>
                    </th>
                    <th class="is-sortable">
                      <button type="button" onClick={() => this.vm.sortBy("status")}>
                        {t("nodes.column.status")} <span class="sort-indicator">{this.vm.sortMark("status")}</span>
                      </button>
                    </th>
                    <th>{t("nodes.column.metrics")}</th>
                    <th>{t("nodes.column.versions")}</th>
                    <th>{t("nodes.column.tokenIssued")}</th>
                    <th>{t("nodes.column.lastSeen")}</th>
                    <th>{t("nodes.column.interfaces")}</th>
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
                          <div class="strong">{node.name}</div>
                          <div class="xs muted mono">{node.id}</div>
                        </td>
                        <td data-label={t("nodes.column.status")}>
                          <span class={`badge ${node.online ? "badge--green" : "badge--red"}`}>
                            <span class={`dot ${node.online ? "dot--green" : "dot--red"}`}></span>
                            {node.online ? t("nodes.status.online") : t("nodes.status.offline")}
                          </span>
                        </td>
                        <td data-label={t("nodes.column.metrics")}>
                          <div class="strong mono">{this.vm.metricsLabel(node)}</div>
                          <div class="xs muted">
                            <Show when={this.vm.memoryPercent(node)}>
                              <span>{this.vm.memoryPercent(node)} · </span>
                            </Show>
                            <span>{this.vm.metricsUpdatedLabel(node)}</span>
                          </div>
                        </td>
                        <td data-label={t("nodes.column.versions")}>
                          <div class="strong">
                            <span class="xs muted">{t("nodes.versions.worker")}: </span>
                            <span class="mono">{this.vm.workerVersionLabel(node)}</span>
                          </div>
                          <div class="xs muted mono">{t("nodes.versions.kernel")}: {this.vm.kernelVersionLabel(node)}</div>
                        </td>
                        <td data-label={t("nodes.column.tokenIssued")}>
                          <span title={node.token_issued_at ?? undefined}>{this.vm.tokenIssuedLabel(node)}</span>
                        </td>
                        <td data-label={t("nodes.column.lastSeen")}>
                          <span title={node.last_seen ?? undefined}>{this.vm.lastSeen(node.last_seen)}</span>
                        </td>
                        <td data-label={t("nodes.column.interfaces")} class="nowrap">{this.vm.interfacesLabel(node)}</td>
                        <td class="cell-actions">
                          <Show when={this.vm.isAdmin}>
                            <button
                              class="btn btn--sm"
                              type="button"
                              disabled={this.vm.busy}
                              aria-label={t("nodes.rotate.aria", { name: node.name })}
                              onClick={() => this.vm.rotate(node)}
                            >
                              <Icon name="shield" size={14} class="" /> {t("nodes.rotate")}
                            </button>
                            <button
                              class="btn btn--sm btn--danger"
                              type="button"
                              disabled={this.vm.busy}
                              onClick={() => this.vm.remove(node)}
                            >
                              <Icon name="trash" size={14} class="" /> {t("common.delete")}
                            </button>
                          </Show>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
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
        </Show>
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
