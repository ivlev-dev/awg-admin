import { For, Show } from "@ivlev-dev/silent-core";

import type { GroupDetailsVM } from "./GroupDetails.vm";
import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";
import { Modal } from "@/components/Modal";

export function GroupDetails(this: { vm: GroupDetailsVM }) {
  const form = (
    <form id="group-edit-form" class="stack" onSubmit={(event: Event) => this.vm.saveForm(event)}>
      <div class="field">
        <label for="group-edit-name">Название</label>
        <input
          id="group-edit-name"
          class="input"
          type="text"
          placeholder="Офис Москва"
          value={this.vm.formName}
          onInput={(event: Event) => this.vm.setFormName(event)}
        />
      </div>
      <div class="field">
        <label for="group-edit-description">Описание</label>
        <textarea
          id="group-edit-description"
          class="textarea"
          placeholder="Назначение группы и состав интерфейсов"
          value={this.vm.formDescription}
          onInput={(event: Event) => this.vm.setFormDescription(event)}
        ></textarea>
      </div>
      <div class="field">
        <label for="group-edit-cidr">Базовая сеть</label>
        <input
          id="group-edit-cidr"
          class="input mono"
          type="text"
          placeholder="10.8.0.0/16"
          value={this.vm.formBaseCidr}
          onInput={(event: Event) => this.vm.setFormBaseCidr(event)}
        />
        <span class="hint">Сеть должна вмещать все существующие пулы группы.</span>
      </div>
      <label class="checkbox">
        <input
          type="checkbox"
          checked={this.vm.formForwarding}
          onChange={(event: Event) => this.vm.setFormForwarding(event)}
        />
        <span>Forwarding по умолчанию</span>
      </label>
      <Show when={this.vm.formError}>
        <div class="alert alert--error">{this.vm.formError}</div>
      </Show>
    </form>
  );

  const formFooter = (
    <div class="actions-bar">
      <button class="btn" type="button" onClick={() => this.vm.closeForm()} disabled={this.vm.formSaving}>
        Отмена
      </button>
      <button class="btn btn--primary" type="submit" form="group-edit-form" disabled={!this.vm.canSaveForm}>
        {this.vm.formSaving ? "Сохраняем…" : "Сохранить"}
      </button>
    </div>
  );

  const poolForm = (
    <form id="pool-form" class="stack" onSubmit={(event: Event) => this.vm.savePool(event)}>
      <div class="field">
        <label for="pool-name">Название</label>
        <input
          id="pool-name"
          class="input"
          type="text"
          placeholder="Основной пул"
          value={this.vm.poolName}
          onInput={(event: Event) => this.vm.setPoolName(event)}
        />
      </div>
      <div class="field">
        <label for="pool-cidr">CIDR</label>
        <input
          id="pool-cidr"
          class="input mono"
          type="text"
          placeholder="10.8.0.0/24"
          value={this.vm.poolCidr}
          onInput={(event: Event) => this.vm.setPoolCidr(event)}
          disabled={this.vm.editingPool !== null}
        />
        <span class="hint">Подсеть внутри {this.vm.baseCidr}. CIDR нельзя изменить после создания пула.</span>
      </div>
      <div class="field">
        <label for="pool-mode">Режим</label>
        <Select
          id="pool-mode"
          value={this.vm.poolMode}
          options={[
            { value: "auto", label: "auto — автоматическая выдача" },
            { value: "rf_only", label: "rf_only — только РФ" },
            { value: "external_only", label: "external_only — только внешние" },
          ]}
          onChange={(value) => this.vm.setPoolMode(value)}
          ariaLabel="Режим пула"
        />
      </div>
      <div class="field">
        <label for="pool-gateway">Шлюз</label>
        <input
          id="pool-gateway"
          class="input mono"
          type="text"
          placeholder="10.8.0.1"
          value={this.vm.poolGateway}
          onInput={(event: Event) => this.vm.setPoolGateway(event)}
        />
        <span class="hint">Необязательно. Если не указан, шлюз назначается автоматически.</span>
      </div>
      <label class={`switch ${this.vm.editingPool ? "" : "hidden"}`}>
        <input
          type="checkbox"
          checked={this.vm.poolEnabled}
          onChange={(event: Event) => this.vm.setPoolEnabled(event)}
        />
        <span class="track"></span>
        <span>Пул включён</span>
      </label>
      <Show when={this.vm.poolError}>
        <div class="alert alert--error">{this.vm.poolError}</div>
      </Show>
    </form>
  );

  const poolFooter = (
    <div class="actions-bar">
      <button class="btn" type="button" onClick={() => this.vm.closePool()} disabled={this.vm.poolSaving}>
        Отмена
      </button>
      <button class="btn btn--primary" type="submit" form="pool-form" disabled={!this.vm.canSavePool}>
        {this.vm.poolSaving ? "Сохраняем…" : "Сохранить"}
      </button>
    </div>
  );

  return (
    <div class="stack">
      <div class="row-between wrap">
        <button class="btn btn--sm btn--ghost" type="button" onClick={() => this.vm.back()}>
          ← Назад к группам
        </button>
        <Show when={this.vm.group}>
          <button class="btn btn--sm" type="button" onClick={() => this.vm.openForm()}>
            <Icon name="edit" size={14} class="" /> Редактировать группу
          </button>
        </Show>
      </div>

      <Show when={this.vm.error}>
        <div class="alert alert--error">{this.vm.error}</div>
      </Show>

      <Show when={!this.vm.loading} fallback={<div class="skeleton" style="height:260px"></div>}>
        <Show
          when={this.vm.group}
          fallback={
            <div class="empty">
              <Icon name="warning" size={40} class="empty__icon" />
              <div class="empty__title">Группа не найдена</div>
              <div class="small">Возможно, группа была удалена. Вернитесь к списку групп.</div>
              <div style="margin-top:16px">
                <button class="btn" type="button" onClick={() => this.vm.back()}>
                  К списку групп
                </button>
              </div>
            </div>
          }
        >
          <div class="stack">
            <div class="page-head">
              <div class="page-head__eyebrow">Группа</div>
              <div class="row" style="gap:10px">
                <h1>{this.vm.title}</h1>
                <Show when={this.vm.forwardingDefault}>
                  <span class="badge badge--blue">forwarding_default</span>
                </Show>
              </div>
              <p>{this.vm.subtitle}</p>
              <div class="row wrap" style="gap:14px;margin-top:10px">
                <span class="small muted" style="display:inline-flex;gap:6px">
                  Базовая сеть <span class="mono strong">{this.vm.baseCidr}</span>
                </span>
                <span class="small muted" style="display:inline-flex;gap:6px">
                  Интерфейсы: <span class="strong">{this.vm.interfaceCount}</span>
                </span>
                <span class="small muted" style="display:inline-flex;gap:6px">
                  Устройства: <span class="strong">{this.vm.deviceCount}</span>
                </span>
              </div>
            </div>

            <section class="card">
              <div class="card__head">
                <div>
                  <div class="card__title">CIDR-пулы</div>
                  <div class="card__sub">Подсети, из которых интерфейсы группы выдают адреса устройствам.</div>
                </div>
                <button class="btn btn--sm" type="button" onClick={() => this.vm.openPoolForm()}>
                  <Icon name="plus" size={14} class="" /> Добавить пул
                </button>
              </div>
              <Show
                when={this.vm.pools.length > 0}
                fallback={
                  <div class="empty">
                    <div class="empty__title">Пул ещё не создан</div>
                    <div class="small">Добавьте первый диапазон внутри {this.vm.baseCidr}.</div>
                  </div>
                }
              >
                <div class="table-wrap">
                  <table class="table table--cards">
                    <thead>
                      <tr>
                        <th>Название</th>
                        <th>CIDR</th>
                        <th>Режим</th>
                        <th>Шлюз</th>
                        <th>Статус</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={this.vm.pools}>
                        {(pool) => (
                          <tr>
                            <td data-label="Название">
                              <span class="strong">{pool.name}</span>
                            </td>
                            <td data-label="CIDR" class="mono">
                              {pool.cidr}
                            </td>
                            <td data-label="Режим">
                              <span class={this.vm.poolModeBadge(pool.mode)}>{this.vm.poolModeLabel(pool.mode)}</span>
                            </td>
                            <td data-label="Шлюз" class="mono">
                              {pool.gateway ?? "—"}
                            </td>
                            <td data-label="Статус">
                              <span class={`badge ${pool.enabled ? "badge--green" : "badge--red"}`}>
                                {pool.enabled ? "включён" : "выключен"}
                              </span>
                            </td>
                            <td>
                              <div class="cell-actions">
                                <button
                                  class="btn btn--sm btn--ghost btn--icon"
                                  type="button"
                                  aria-label="Редактировать пул"
                                  onClick={() => this.vm.openPoolForm(pool)}
                                >
                                  <Icon name="edit" size={14} class="" />
                                </button>
                                <button
                                  class="btn btn--sm btn--ghost btn--icon"
                                  type="button"
                                  aria-label="Удалить пул"
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
                Диапазоны общие для группы: каждый интерфейс получает одинаковые CIDR, но разные ключи и обфускацию.
              </div>
            </section>

            <section class="card">
              <div class="card__head">
                <div>
                  <div class="card__title">Интерфейсы группы</div>
                  <div class="card__sub">Развёрнуты на нодах и используют пулы этой группы.</div>
                </div>
                <button class="btn btn--sm" type="button" onClick={() => this.vm.openInterfaces()}>
                  <Icon name="interfaces" size={14} class="" /> Все интерфейсы
                </button>
              </div>
              <Show
                when={this.vm.interfaces.length > 0}
                fallback={
                  <div class="empty">
                    <div class="empty__title">Интерфейсов пока нет</div>
                    <div class="small">Создайте интерфейс на ноде и выберите эту группу.</div>
                  </div>
                }
              >
                <div class="table-wrap">
                  <table class="table table--cards">
                    <thead>
                      <tr>
                        <th>Интерфейс</th>
                        <th>Метка</th>
                        <th>Нода</th>
                        <th>Пиры</th>
                        <th>Статус</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={this.vm.interfaces}>
                        {(item) => (
                          <tr>
                            <td data-label="Интерфейс">
                              <span class="mono strong">{item.name}</span>
                            </td>
                            <td data-label="Метка">{item.label || "—"}</td>
                            <td data-label="Нода">{item.node_name}</td>
                            <td data-label="Пиры" class="mono">
                              {item.peers}
                            </td>
                            <td data-label="Статус">
                              <span class={`badge ${item.enabled ? "badge--green" : "badge--red"}`}>
                                {item.enabled ? "включён" : "выключен"}
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

      <Modal open={this.vm.formOpen} title="Редактирование группы" onClose={() => this.vm.closeForm()} footer={formFooter}>
        {form}
      </Modal>

      <Modal
        open={this.vm.poolOpen}
        title={this.vm.editingPool ? "Редактирование пула" : "Новый пул"}
        onClose={() => this.vm.closePool()}
        footer={poolFooter}
      >
        {poolForm}
      </Modal>
    </div>
  );
}
