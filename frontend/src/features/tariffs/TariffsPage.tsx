import { For, Show } from "@ivlev-dev/silent-core";

import type { TariffsPageVM } from "./TariffsPage.vm";
import { Modal } from "@/components/Modal";
import { Icon } from "@/components/Icon";
import { SkeletonTable } from "@/components/Skeleton";
import { formatBytes, formatRate } from "@/domain/format";

export function TariffsPage(this: { vm: TariffsPageVM }) {
  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">Тарифы</div>
        <h1>Тарифы</h1>
        <p>Управление тарифами и лимитами скорости.</p>
      </div>

      <Show when={this.vm.error}>
        <div class="alert alert--error">{this.vm.error}</div>
      </Show>

      <section class="card card--flush" aria-busy={this.vm.loading ? "true" : "false"}>
        <div class="data-toolbar">
          <div class="data-toolbar__top">
            <div>
              <div class="data-toolbar__title">Список тарифов</div>
              <div class="data-toolbar__sub">Всего: {this.vm.tariffs.length}</div>
            </div>
            <div class="data-toolbar__actions">
              <button class="btn btn--primary" type="button" onClick={() => this.vm.openCreate()}>
                <Icon name="plus" size={16} class="" /> Новый тариф
              </button>
            </div>
          </div>
        </div>

        <Show
          when={!this.vm.loading}
          fallback={
            <div class="card__body">
              <SkeletonTable rows={5} columns={8} />
            </div>
          }
        >
          <Show
            when={this.vm.tariffs.length > 0}
            fallback={
              <div class="empty">
                <Icon name="tariffs" size={40} class="empty__icon" />
                <div class="empty__title">Нет тарифов</div>
                <div class="empty__text">Создайте первый тариф.</div>
                <div style="margin-top:16px">
                  <button class="btn btn--primary" type="button" onClick={() => this.vm.openCreate()}>
                    <Icon name="plus" size={16} class="" /> Новый тариф
                  </button>
                </div>
              </div>
            }
          >
            <div class="data-scroll">
              <table class="table table--cards table--fixed">
                <thead>
                  <tr>
                    <th>Название</th>
                    <th>Устройств</th>
                    <th>Устр. ↓</th>
                    <th>Устр. ↑</th>
                    <th>Группа ↓</th>
                    <th>Группа ↑</th>
                    <th>Квота</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <For each={this.vm.tariffs}>
                    {(tariff) => (
                      <tr>
                        <td data-label="Название">
                          <div class="cell-name">
                            <span class="cell-name__text">
                              <span class="strong">{tariff.name}</span>
                              <Show when={tariff.description}>
                                <div class="xs muted">{tariff.description}</div>
                              </Show>
                            </span>
                          </div>
                        </td>
                        <td data-label="Устройств" class="mono">{tariff.max_devices}</td>
                        <td data-label="Устр. ↓" class="mono">{formatRate(tariff.device_down_kbps)}</td>
                        <td data-label="Устр. ↑" class="mono">{formatRate(tariff.device_up_kbps)}</td>
                        <td data-label="Группа ↓" class="mono">{formatRate(tariff.group_down_kbps)}</td>
                        <td data-label="Группа ↑" class="mono">{formatRate(tariff.group_up_kbps)}</td>
                        <td data-label="Квота" class="mono">
                          {tariff.traffic_quota_bytes === null ? "Безлимит" : formatBytes(tariff.traffic_quota_bytes)}
                        </td>
                        <td class="cell-actions">
                          <div class="row" style="gap:6px">
                            <button class="btn btn--sm btn--ghost btn--icon" type="button" onClick={() => this.vm.openEdit(tariff)} aria-label="Редактировать">
                              <Icon name="edit" size={14} class="" />
                            </button>
                            <button class="btn btn--sm btn--danger btn--icon" type="button" onClick={() => this.vm.remove(tariff.id)} aria-label="Удалить">
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
        </Show>
      </section>

      <Modal
        open={this.vm.modalOpen}
        title={this.vm.title}
        onClose={() => this.vm.closeModal()}
        footer={
          <div class="row" style="gap:8px">
            <button class="btn" type="button" onClick={() => this.vm.closeModal()} disabled={this.vm.saving}>
              Отмена
            </button>
            <button class="btn btn--primary" type="button" onClick={() => this.vm.submit()} disabled={this.vm.saving}>
              <Show when={this.vm.saving} fallback={<span>Сохранить</span>}>
                <span class="spinner" style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"></span>
                <span>Сохраняем…</span>
              </Show>
            </button>
          </div>
        }
      >
        <div class="stack">
          <div class="grid grid--2">
            <div class="field">
              <label>Название</label>
              <input class="input" type="text" value={this.vm.name} onInput={(event: Event) => this.vm.setName(event)} />
            </div>
            <div class="field">
              <label>Макс. устройств</label>
              <input class="input" type="number" min="1" value={this.vm.max_devices} onInput={(event: Event) => this.vm.setMaxDevices(event)} />
            </div>
          </div>
          <div class="field">
            <label>Описание</label>
            <textarea class="input" rows={2} value={this.vm.description} onInput={(event: Event) => this.vm.setDescription(event)}></textarea>
          </div>
          <div class="grid grid--2">
            <div class="field">
              <label>Устр. скачивание, Кбит/с</label>
              <input class="input" type="number" min="0" value={this.vm.device_down_kbps} onInput={(event: Event) => this.vm.setDeviceDown(event)} />
            </div>
            <div class="field">
              <label>Устр. отдача, Кбит/с</label>
              <input class="input" type="number" min="0" value={this.vm.device_up_kbps} onInput={(event: Event) => this.vm.setDeviceUp(event)} />
            </div>
            <div class="field">
              <label>Группа скачивание, Кбит/с</label>
              <input class="input" type="number" min="0" value={this.vm.group_down_kbps} onInput={(event: Event) => this.vm.setGroupDown(event)} />
            </div>
            <div class="field">
              <label>Группа отдача, Кбит/с</label>
              <input class="input" type="number" min="0" value={this.vm.group_up_kbps} onInput={(event: Event) => this.vm.setGroupUp(event)} />
            </div>
          </div>
          <div class="field">
            <label>Квота трафика, ГБ (0/пусто = безлимит)</label>
            <input class="input" type="number" min="0" step="0.1" value={this.vm.quotaGb} onInput={(event: Event) => this.vm.setQuota(event)} />
          </div>
          <Show when={this.vm.formError}>
            <div class="alert alert--error">{this.vm.formError}</div>
          </Show>
        </div>
      </Modal>
    </div>
  );
}