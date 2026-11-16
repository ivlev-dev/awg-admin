import { For, Show } from "@ivlev-dev/silent-core";

import type { GroupsPageVM } from "./GroupsPage.vm";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";

export function GroupsPage(this: { vm: GroupsPageVM }) {
  const form = (
    <form id="group-form" class="stack" onSubmit={(event: Event) => this.vm.save(event)}>
      <div class="field">
        <label for="group-name">Название</label>
        <input
          id="group-name"
          class="input"
          type="text"
          placeholder="Офис Москва"
          value={this.vm.formName}
          onInput={(event: Event) => this.vm.setName(event)}
        />
      </div>
      <div class="field">
        <label for="group-description">Описание</label>
        <textarea
          id="group-description"
          class="textarea"
          placeholder="Назначение группы и состав интерфейсов"
          value={this.vm.formDescription}
          onInput={(event: Event) => this.vm.setDescription(event)}
        ></textarea>
      </div>
      <div class="field">
        <label for="group-cidr">Базовая сеть</label>
        <input
          id="group-cidr"
          class="input mono"
          type="text"
          placeholder="10.8.0.0/16"
          value={this.vm.formBaseCidr}
          onInput={(event: Event) => this.vm.setBaseCidr(event)}
        />
        <span class="hint">Все CIDR-пулы и адреса устройств должны находиться внутри этой сети.</span>
      </div>
      <label class="checkbox">
        <input
          type="checkbox"
          checked={this.vm.formForwarding}
          onChange={(event: Event) => this.vm.setForwarding(event)}
        />
        <span>Forwarding по умолчанию</span>
      </label>
      <Show when={this.vm.formError}>
        <div class="alert alert--error">{this.vm.formError}</div>
      </Show>
    </form>
  );

  const footer = (
    <div class="actions-bar">
      <button class="btn" type="button" onClick={() => this.vm.closeModal()} disabled={this.vm.saving}>
        Отмена
      </button>
      <button class="btn btn--primary" type="submit" form="group-form" disabled={!this.vm.canSave}>
        {this.vm.saving ? "Сохраняем…" : "Сохранить"}
      </button>
    </div>
  );

  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">Управление</div>
        <div class="row-between wrap">
          <div>
            <h1>Группы</h1>
            <p>Общая базовая сеть, CIDR-пулы и параметры forwarding для интерфейсов на всех нодах.</p>
          </div>
          <div class="actions-bar">
            <button class="btn btn--sm" type="button" onClick={() => this.vm.load()}>
              <Icon name="refresh" size={14} class="" /> Обновить
            </button>
            <button class="btn btn--sm btn--primary" type="button" onClick={() => this.vm.openCreate()}>
              <Icon name="plus" size={14} class="" /> Создать группу
            </button>
          </div>
        </div>
      </div>

      <Show when={this.vm.error}>
        <div class="alert alert--error">{this.vm.error}</div>
      </Show>

      <Show
        when={!this.vm.loading}
        fallback={
          <div class="grid grid--3">
            <div class="skeleton" style="height:190px"></div>
            <div class="skeleton" style="height:190px"></div>
            <div class="skeleton" style="height:190px"></div>
          </div>
        }
      >
        <Show
          when={this.vm.groups.length > 0}
          fallback={
            <div class="empty">
              <Icon name="groups" size={40} class="empty__icon" />
              <div class="empty__title">Групп пока нет</div>
              <div class="small">Создайте первую группу, чтобы задать общую сеть и пулы адресов.</div>
              <div style="margin-top:16px">
                <button class="btn btn--primary" type="button" onClick={() => this.vm.openCreate()}>
                  <Icon name="plus" size={16} class="" /> Создать группу
                </button>
              </div>
            </div>
          }
        >
          <div class="grid grid--3">
            <For each={this.vm.groups}>
              {(group) => (
                <article class="card">
                  <div class="card__body stack-sm">
                    <div class="row-between">
                      <div class="card__title truncate">{group.name}</div>
                      <Show when={group.forwarding_default}>
                        <span class="badge badge--blue">forwarding_default</span>
                      </Show>
                    </div>
                    <div class="small muted">{group.description || "Без описания"}</div>
                    <hr class="divider" />
                    <dl class="kv">
                      <dt>Базовая сеть</dt>
                      <dd class="mono">{group.base_cidr}</dd>
                      <dt>Интерфейсы</dt>
                      <dd>{group.interfaces}</dd>
                      <dt>Устройства</dt>
                      <dd>{group.devices}</dd>
                    </dl>
                  </div>
                  <div class="card__foot row-between">
                    <button class="btn btn--sm btn--primary" type="button" onClick={() => this.vm.open(group)}>
                      Открыть
                    </button>
                    <div class="actions-bar">
                      <button
                        class="btn btn--sm btn--ghost btn--icon"
                        type="button"
                        aria-label="Редактировать группу"
                        onClick={() => this.vm.openEdit(group)}
                      >
                        <Icon name="edit" size={14} class="" />
                      </button>
                      <button
                        class="btn btn--sm btn--ghost btn--icon"
                        type="button"
                        aria-label="Удалить группу"
                        onClick={() => this.vm.remove(group)}
                      >
                        <Icon name="trash" size={14} class="" />
                      </button>
                    </div>
                  </div>
                </article>
              )}
            </For>
          </div>
        </Show>
      </Show>

      <Modal
        open={this.vm.modalOpen}
        title={this.vm.modalTitle}
        onClose={() => this.vm.closeModal()}
        footer={footer}
      >
        {form}
      </Modal>
    </div>
  );
}
