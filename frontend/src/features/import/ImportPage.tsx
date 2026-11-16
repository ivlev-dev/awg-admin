import { For, Show } from "@ivlev-dev/silent-core";

import type { ImportVM } from "./ImportPage.vm";
import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";

export function ImportPage(this: { vm: ImportVM }) {
  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">Администрирование</div>
        <h1>Импорт конфигурации</h1>
        <p>
          Загрузите серверный конфиг AmneziaWG, опишите группу и интерфейс, затем добавьте клиентские
          конфиги. Все шаги расположены на одном экране.
        </p>
      </div>

      <div class="actions-bar">
        <span class={`badge ${this.vm.serverConfigValid ? "badge--green" : "badge--amber"}`}>
          1. Серверный конфиг
        </span>
        <span class={`badge ${this.vm.paramsValid ? "badge--green" : "badge--amber"}`}>
          2. Параметры
        </span>
        <span class={`badge ${this.vm.clients.length > 0 ? "badge--green" : "badge--amber"}`}>
          3. Клиенты · {this.vm.clients.length}
        </span>
      </div>

      <div class="alert alert--info">
        <span class="strong">Проверьте public key.</span> Public key сервера, вычисленный из
        PrivateKey серверного конфига, должен совпадать с PublicKey в блоке [Peer] каждого
        клиентского конфига. Иначе клиент не импортируется.
      </div>

      <Show when={this.vm.error}>
        <div class="alert alert--error">{this.vm.error}</div>
      </Show>

      <section class="card">
        <div class="card__head">
          <div>
            <div class="card__title">1. Серверный конфиг</div>
            <div class="card__sub">Вставьте содержимое .conf или загрузите файл</div>
          </div>
          <span class={`badge ${this.vm.serverConfigValid ? "badge--green" : "badge--amber"}`}>
            {this.vm.serverConfigValid ? "готово" : "ожидает конфиг"}
          </span>
        </div>
        <div class="card__body stack">
          <div class="row-between wrap">
            <span class="small muted">Нужен блок [Interface] с PrivateKey и параметрами обфускации.</span>
            <label class="btn btn--sm" style="cursor:pointer">
              <Icon name="download" size={14} class="" />
              Загрузить .conf
              <input
                type="file"
                accept=".conf,.txt"
                style="display:none"
                onChange={(event: Event) => this.vm.setServerFile(event)}
              />
            </label>
          </div>
          <textarea
            class="textarea"
            rows={12}
            placeholder="[Interface]&#10;PrivateKey = ...&#10;ListenPort = 51820&#10;..."
            value={this.vm.serverConfig}
            onInput={(event: Event) => this.vm.setServerConfig(event)}
          ></textarea>
          <Show when={this.vm.serverConfigWarning}>
            <div class="alert alert--warn">{this.vm.serverConfigWarning}</div>
          </Show>
        </div>
      </section>

      <section class="card">
        <div class="card__head">
          <div>
            <div class="card__title">2. Параметры группы и интерфейса</div>
            <div class="card__sub">Группа, базовая сеть, нода, интерфейс и пулы адресов</div>
          </div>
          <span class={`badge ${this.vm.paramsValid ? "badge--green" : "badge--amber"}`}>
            {this.vm.paramsValid ? "готово" : "заполните поля"}
          </span>
        </div>
        <div class="card__body stack">
          <div class="grid grid--2">
            <div class="field">
              <label for="import-group-name">Имя группы</label>
              <input
                id="import-group-name"
                class="input"
                type="text"
                placeholder="Офис"
                value={this.vm.groupName}
                onInput={(event: Event) => this.vm.setGroupName(event)}
              />
            </div>
            <div class="field">
              <label for="import-base-cidr">base_cidr</label>
              <input
                id="import-base-cidr"
                class="input mono"
                type="text"
                placeholder="10.8.0.0/24"
                value={this.vm.baseCidr}
                onInput={(event: Event) => this.vm.setBaseCidr(event)}
              />
              <Show when={!this.vm.baseCidrValid}>
                <div class="xs" style="color:var(--red)">Некорректный CIDR</div>
              </Show>
            </div>
          </div>

          <div class="field">
            <label for="import-group-description">Описание группы</label>
            <input
              id="import-group-description"
              class="input"
              type="text"
              placeholder="Основная площадка"
              value={this.vm.groupDescription}
              onInput={(event: Event) => this.vm.setGroupDescription(event)}
            />
          </div>

          <div class="grid grid--2">
            <div class="field">
              <label for="import-node">Нода</label>
              <Show
                when={!this.vm.nodesLoading}
                fallback={<div class="skeleton" style="height:40px"></div>}
              >
                <Select
                  id="import-node"
                  value={this.vm.nodeId}
                  options={this.vm.nodes.map((node) => ({ value: node.id, label: `${node.name} · ${node.online ? "online" : "offline"}` }))}
                  onChange={(value) => this.vm.setNode(value)}
                  disabled={this.vm.nodes.length === 0}
                  placeholder="Нет доступных нод"
                  ariaLabel="Нода"
                />
              </Show>
              <Show when={this.vm.nodesError}>
                <div class="hint" style="color:var(--red)">{this.vm.nodesError}</div>
              </Show>
              <Show when={!this.vm.nodesLoading && this.vm.nodes.length === 0}>
                <button class="btn btn--sm btn--ghost" type="button" onClick={() => this.vm.openNodes()}>
                  Перейти к нодам
                </button>
              </Show>
            </div>
            <div class="field">
              <label for="import-interface-name">Имя интерфейса</label>
              <input
                id="import-interface-name"
                class="input mono"
                type="text"
                placeholder="awg0"
                value={this.vm.interfaceName}
                onInput={(event: Event) => this.vm.setInterfaceName(event)}
              />
            </div>
          </div>

          <div class="grid grid--2">
            <div class="field">
              <label for="import-endpoint-host">Endpoint host</label>
              <input
                id="import-endpoint-host"
                class="input mono"
                type="text"
                placeholder="vpn.example.com"
                value={this.vm.endpointHost}
                onInput={(event: Event) => this.vm.setEndpointHost(event)}
              />
            </div>
            <div class="field">
              <label for="import-endpoint-port">Endpoint port</label>
              <input
                id="import-endpoint-port"
                class="input mono"
                type="number"
                min="1"
                max="65535"
                value={this.vm.endpointPort}
                onInput={(event: Event) => this.vm.setEndpointPort(event)}
              />
            </div>
            <div class="field">
              <label for="import-listen-port">Listen port</label>
              <input
                id="import-listen-port"
                class="input mono"
                type="number"
                min="1"
                max="65535"
                value={this.vm.listenPort}
                onInput={(event: Event) => this.vm.setListenPort(event)}
              />
            </div>
            <div class="field">
              <label for="import-mtu">MTU</label>
              <input
                id="import-mtu"
                class="input mono"
                type="number"
                min="576"
                max="9000"
                value={this.vm.mtu}
                onInput={(event: Event) => this.vm.setMtu(event)}
              />
            </div>
          </div>

          <div class="section-title">
            <h2>Пулы CIDR</h2>
            <button class="btn btn--sm" type="button" onClick={() => this.vm.addPool()}>
              <Icon name="plus" size={14} class="" /> Добавить пул
            </button>
          </div>

          <Show
            when={this.vm.pools.length > 0}
            fallback={
              <div class="empty">
                <div class="empty__title">Нет пулов</div>
                <div class="small">Добавьте хотя бы один пул, чтобы клиенты получили адреса.</div>
              </div>
            }
          >
            <div class="stack-sm">
              <For each={this.vm.pools}>
                {(pool, index) => (
                  <div class="panel" style="padding:12px">
                    <div class="grid grid--2">
                      <div class="field">
                        <label>Имя пула</label>
                        <input
                          class="input"
                          type="text"
                          placeholder="default"
                          value={pool.name}
                          onInput={(event: Event) => this.vm.setPoolName(index(), event)}
                        />
                      </div>
                      <div class="field">
                        <label>CIDR</label>
                        <input
                          class="input mono"
                          type="text"
                          placeholder="10.8.0.0/24"
                          value={pool.cidr}
                          onInput={(event: Event) => this.vm.setPoolCidr(index(), event)}
                        />
                      </div>
                      <div class="field">
                        <label>Режим</label>
                        <Select
                          value={pool.mode}
                          options={[
                            { value: "auto", label: "Авто" },
                            { value: "rf_only", label: "Только РФ" },
                            { value: "external_only", label: "Только внешние" },
                          ]}
                          onChange={(value) => this.vm.setPoolMode(index(), value)}
                          ariaLabel="Режим пула"
                        />
                      </div>
                      <div class="field">
                        <label>Gateway</label>
                        <input
                          class="input mono"
                          type="text"
                          placeholder="необязательно"
                          value={pool.gateway}
                          onInput={(event: Event) => this.vm.setPoolGateway(index(), event)}
                        />
                      </div>
                    </div>
                    <Show when={this.vm.poolError(pool)}>
                      <div class="xs" style="color:var(--red);margin-top:8px">
                        {this.vm.poolError(pool)}
                      </div>
                    </Show>
                    <div class="row-between" style="margin-top:8px">
                      <span class="xs muted">
                        Должен входить в {this.vm.baseCidr || "base CIDR"}
                      </span>
                      <button
                        class="btn btn--sm btn--danger"
                        type="button"
                        onClick={() => this.vm.removePool(index())}
                      >
                        <Icon name="trash" size={14} class="" /> Удалить
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </section>

      <section class="card">
        <div class="card__head">
          <div>
            <div class="card__title">3. Клиентские конфиги</div>
            <div class="card__sub">
              Вставьте конфиги через разделитель --- или загрузите несколько файлов
            </div>
          </div>
          <span class={`badge ${this.vm.clients.length > 0 ? "badge--green" : "badge--amber"}`}>
            {this.vm.clients.length} шт.
          </span>
        </div>
        <div class="card__body stack">
          <textarea
            class="textarea"
            rows={8}
            placeholder="[Interface]&#10;PrivateKey = ...&#10;Address = 10.8.0.2/24&#10;...&#10;---&#10;[Interface]&#10;..."
            value={this.vm.clientsText}
            onInput={(event: Event) => this.vm.setClientsText(event)}
          ></textarea>

          <div class="actions-bar">
            <button class="btn btn--sm" type="button" onClick={() => this.vm.parseClients()}>
              <Icon name="import" size={14} class="" /> Разобрать конфиги
            </button>
            <label class="btn btn--sm" style="cursor:pointer">
              <Icon name="download" size={14} class="" />
              Загрузить файлы
              <input
                type="file"
                accept=".conf,.txt"
                multiple
                style="display:none"
                onChange={(event: Event) => this.vm.setClientFiles(event)}
              />
            </label>
            <span class="xs muted">
              Имена можно отредактировать после разбора. Изменения в поле выше применяются кнопкой
              «Разобрать конфиги».
            </span>
          </div>

          <Show when={this.vm.clientKeysMismatch}>
            <div class="alert alert--warn">
              Клиенты указывают на разные PublicKey. Проверьте, что все они относятся к одному
              серверу.
            </div>
          </Show>
          <Show when={this.vm.clientsWithoutKey > 0}>
            <div class="alert alert--warn">
              У {this.vm.clientsWithoutKey} клиент(ов) не найден PublicKey в блоке [Peer].
            </div>
          </Show>

          <Show
            when={this.vm.clients.length > 0}
            fallback={
              <div class="empty">
                <div class="empty__title">Клиенты не добавлены</div>
                <div class="small">
                  Можно импортировать только сервер — клиентов добавите позже.
                </div>
              </div>
            }
          >
            <div class="stack-sm">
              <For each={this.vm.clients}>
                {(client, index) => (
                  <div class="panel">
                    <div class="card__body stack-sm">
                      <div class="row-between wrap">
                        <div class="field grow">
                          <label>Имя устройства</label>
                          <input
                            class="input"
                            type="text"
                            value={client.name}
                            onInput={(event: Event) => this.vm.setClientName(index(), event)}
                          />
                        </div>
                        <button
                          class="btn btn--sm btn--ghost"
                          type="button"
                          onClick={() => this.vm.removeClient(index())}
                          aria-label="Удалить клиента"
                        >
                          <Icon name="trash" size={16} class="" />
                        </button>
                      </div>
                      <div class="actions-bar">
                        <span class="badge badge--blue">{this.vm.clientAddress(client.config)}</span>
                        <Show
                          when={this.vm.clientPeerKey(client.config)}
                          fallback={<span class="badge badge--amber">нет PublicKey</span>}
                        >
                          <span class="badge mono truncate" style="max-width:100%">
                            {this.vm.clientPeerKey(client.config)}
                          </span>
                        </Show>
                      </div>
                      <pre class="code code--light" style="max-height:150px">{this.vm.clientPreview(client.config)}</pre>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </section>

      <section class="card">
        <div class="card__body row-between wrap">
          <div class="stack-sm">
            <div class="strong">Готовы к импорту</div>
            <div class="xs muted">
              Кластер: {this.vm.nodes.find((node) => node.id === this.vm.nodeId)?.name ?? "нода не выбрана"}
              {" · "}
              клиентов: {this.vm.clients.length}
            </div>
          </div>
          <div class="actions-bar">
            <button class="btn" type="button" onClick={() => this.vm.reset()}>
              Сбросить
            </button>
            <button
              class="btn btn--primary"
              type="button"
              disabled={!this.vm.canImport}
              onClick={() => this.vm.importNow()}
            >
              <Show
                when={this.vm.importing}
                fallback={
                  <>
                    <Icon name="import" size={16} class="" />
                    <span>Импортировать</span>
                  </>
                }
              >
                <span class="spinner" style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"></span>
                <span>Импортируем…</span>
              </Show>
            </button>
          </div>
        </div>
      </section>

      <Show when={this.vm.result}>
        <section class="card">
          <div class="card__head">
            <div>
              <div class="card__title">Результат импорта</div>
              <div class="card__sub">Группа и интерфейс созданы на выбранной ноде</div>
            </div>
            <span class="badge badge--green">
              устройств: {this.vm.result?.imported_devices ?? 0}
            </span>
          </div>
          <div class="card__body stack">
            <div class="alert alert--info">
              Импортировано устройств: {this.vm.result?.imported_devices ?? 0}. Ошибок:{" "}
              {this.vm.resultFailed.length}.
            </div>
            <Show
              when={this.vm.resultFailed.length > 0}
              fallback={<div class="alert alert--info">Все клиенты импортированы без ошибок.</div>}
            >
              <div class="table-wrap">
                <table class="table table--cards">
                  <thead>
                    <tr>
                      <th>Клиент</th>
                      <th>Ошибка</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={this.vm.resultFailed}>
                      {(failure) => (
                        <tr>
                          <td data-label="Клиент">
                            <span class="strong">{failure.name}</span>
                          </td>
                          <td data-label="Ошибка" class="small">
                            {failure.error}
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
            <div class="actions-bar">
              <button class="btn btn--primary" type="button" onClick={() => this.vm.openGroup()}>
                <Icon name="groups" size={16} class="" /> К группе
              </button>
              <button class="btn" type="button" onClick={() => this.vm.reset()}>
                Новый импорт
              </button>
            </div>
          </div>
        </section>
      </Show>
    </div>
  );
}
