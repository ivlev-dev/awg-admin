import { For, Show } from "@ivlev-dev/silent-core";

import type { NodesPageVM } from "./NodesPage.vm";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";

const WORKER_COMPOSE = `services:
  awg-node:
    image: awg-node:latest
    privileged: true
    cap_add:
      - NET_ADMIN
    network_mode: host
    environment:
      AWG_NODE_ID: "<id ноды>"
      AWG_NODE_TOKEN: "<токен из панели>"
      AWG_CONTROL_URL: "https://panel.example.com"
    volumes:
      - /dev/net/tun:/dev/net/tun
    restart: unless-stopped`;

export function NodesPage(this: { vm: NodesPageVM }) {
  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">Инфраструктура</div>
        <div class="row-between wrap">
          <div>
            <h1>Ноды</h1>
            <p>Воркеры AmneziaWG, которые держат интерфейсы и применяют конфигурацию с панели.</p>
          </div>
          <div class="actions-bar">
            <span class="badge badge--blue">
              <span class="dot dot--green"></span>
              {this.vm.online} из {this.vm.nodes.length} онлайн
            </span>
            <button class="btn btn--sm" type="button" onClick={() => this.vm.load()} disabled={this.vm.loading}>
              <Icon name="refresh" size={14} class="" /> Обновить
            </button>
            <Show when={this.vm.isAdmin}>
              <button class="btn btn--sm btn--primary" type="button" onClick={() => this.vm.openCreate()}>
                <Icon name="plus" size={14} class="" /> Добавить ноду
              </button>
            </Show>
          </div>
        </div>
      </div>

      <Show when={this.vm.error}>
        <div class="alert alert--error">{this.vm.error}</div>
      </Show>

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
                <div class="empty__title">Нод пока нет</div>
                <div class="small">Создайте ноду, скопируйте токен и запустите воркер на сервере.</div>
              </div>
              <div class="card__body stack-sm">
                <div class="strong small">Как запустить воркер</div>
                <div class="xs muted">
                  1. Нажмите «Добавить ноду» и сохраните выданный токен — панель показывает его один раз.
                </div>
                <div class="xs muted">
                  2. Запустите контейнер через docker compose. Воркеру нужны privileged-режим, NET_ADMIN и доступ к
                  /dev/net/tun.
                </div>
                <pre class="code">{WORKER_COMPOSE}</pre>
                <div class="xs muted">
                  3. После подключения статус ноды станет online, и на неё можно будет привязать интерфейс.
                </div>
                <Show when={this.vm.isAdmin}>
                  <div>
                    <button class="btn btn--primary" type="button" onClick={() => this.vm.openCreate()}>
                      <Icon name="plus" size={16} class="" /> Создать ноду
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
                    <th>Нода</th>
                    <th>Статус</th>
                    <th>Версия</th>
                    <th>Последняя активность</th>
                    <th>Интерфейсы</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <For each={this.vm.nodes}>
                    {(node) => (
                      <tr>
                        <td data-label="Нода">
                          <div class="strong">{node.name}</div>
                          <div class="xs muted mono">{node.id}</div>
                        </td>
                        <td data-label="Статус">
                          <span class={`badge ${node.online ? "badge--green" : "badge--red"}`}>
                            <span class={`dot ${node.online ? "dot--green" : "dot--red"}`}></span>
                            {node.online ? "online" : "offline"}
                          </span>
                        </td>
                        <td data-label="Версия" class="mono">{node.version ?? "—"}</td>
                        <td data-label="Последняя активность">
                          <span title={node.last_seen ?? undefined}>{this.vm.lastSeen(node.last_seen)}</span>
                        </td>
                        <td data-label="Интерфейсы" class="nowrap">{this.vm.interfacesLabel(node)}</td>
                        <td class="cell-actions">
                          <Show when={this.vm.isAdmin}>
                            <button
                              class="btn btn--sm btn--danger"
                              type="button"
                              disabled={this.vm.busy}
                              onClick={() => this.vm.remove(node)}
                            >
                              <Icon name="trash" size={14} class="" /> Удалить
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
        </Show>
      </Show>

      <Modal
        open={this.vm.createOpen}
        title="Новая нода"
        onClose={() => this.vm.closeCreate()}
        footer={
          <>
            <button class="btn" type="button" onClick={() => this.vm.closeCreate()}>Отмена</button>
            <button
              class="btn btn--primary"
              type="submit"
              form="node-create"
              disabled={!this.vm.canCreate}
            >
              {this.vm.busy ? "Создаём…" : "Создать"}
            </button>
          </>
        }
      >
        <form id="node-create" class="stack" onSubmit={(event: Event) => this.vm.submitCreate(event)}>
          <div class="field">
            <label for="node-name">Имя ноды</label>
            <input
              id="node-name"
              class="input"
              type="text"
              placeholder="eu-west-1"
              value={this.vm.name}
              onInput={(event: Event) => this.vm.setName(event)}
            />
            <div class="hint">Отображается только в панели и не влияет на работу воркера.</div>
          </div>
          <Show when={this.vm.formError}>
            <div class="alert alert--error">{this.vm.formError}</div>
          </Show>
        </form>
      </Modal>

      <Modal
        open={this.vm.createdNode !== null}
        title="Нода создана"
        onClose={() => this.vm.closeCreated()}
        footer={<button class="btn btn--primary" type="button" onClick={() => this.vm.closeCreated()}>Готово</button>}
      >
        <div class="stack-sm">
          <div class="alert alert--warn">
            Скопируйте токен и передайте его воркеру. Пока модалка открыта, токен остаётся на экране.
          </div>
          <div class="field">
            <label for="node-token">Токен воркера</label>
            <div class="copy-row">
              <input id="node-token" class="input" readonly value={this.vm.createdNode?.token ?? ""} />
              <button class="btn" type="button" onClick={() => this.vm.copyToken()}>
                <Icon name={this.vm.tokenCopied ? "check" : "copy"} size={16} class="" />
                {this.vm.tokenCopied ? "Скопировано" : "Копировать"}
              </button>
            </div>
          </div>
          <dl class="kv">
            <dt>ID ноды</dt>
            <dd class="mono">{this.vm.createdNode?.node.id}</dd>
            <dt>Имя</dt>
            <dd>{this.vm.createdNode?.node.name}</dd>
          </dl>
          <div class="xs muted">Передайте воркеру переменные окружения:</div>
          <pre class="code code--light">{`AWG_NODE_ID=${this.vm.createdNode?.node.id ?? ""}\nAWG_NODE_TOKEN=${this.vm.createdNode?.token ?? ""}\nAWG_CONTROL_URL=https://panel.example.com`}</pre>
        </div>
      </Modal>
    </div>
  );
}
