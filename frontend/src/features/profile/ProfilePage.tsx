import { For, Show } from "@ivlev-dev/silent-core";

import type { ProfilePageVM } from "./ProfilePage.vm";
import { Icon } from "@/components/Icon";

export function ProfilePage(this: { vm: ProfilePageVM }) {
  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">Аккаунт</div>
        <h1>Профиль</h1>
        <p>Учётная запись, права доступа, пароль и оформление панели.</p>
      </div>

      <div class="profile-layout">
        <div class="stack">
          <section class="card">
            <div class="card__body stack">
              <div class="row" style="gap:16px">
                <div
                  class="avatar avatar--lg"
                  style="width:72px;height:72px;border-radius:22px;font-size:1.7rem"
                >
                  {this.vm.userInitial}
                </div>
                <div class="grow">
                  <div class="row wrap" style="gap:8px">
                    <div class="strong" style="font-size:var(--t-lg)">{this.vm.login}</div>
                    <span class={this.vm.roleBadgeClass}>{this.vm.roleLabel}</span>
                  </div>
                  <div class="xs muted">
                    ID: <span class="mono">{this.vm.userId}</span>
                  </div>
                  <div class="xs muted">В системе с {this.vm.createdAtLabel}</div>
                </div>
              </div>

              <hr class="divider" />

              <div class="stack-sm">
                <div class="xs muted" style="text-transform:uppercase;letter-spacing:0.08em;font-weight:700">
                  Права доступа
                </div>
                <For each={this.vm.permissions}>
                  {(permission) => (
                    <div class="row" style="gap:10px;align-items:flex-start">
                      <span
                        style={permission.granted ? "color:var(--green);display:inline-flex;margin-top:2px" : "color:var(--muted-2);display:inline-flex;margin-top:2px"}
                      >
                        <Icon name={permission.granted ? "check" : "close"} size={16} class="" />
                      </span>
                      <div class="grow">
                        <div class="small strong">{permission.label}</div>
                        <div class="xs muted">{permission.description}</div>
                      </div>
                      <span class={`badge ${permission.granted ? "badge--green" : "badge--red"}`}>
                        {permission.granted ? "есть" : "нет"}
                      </span>
                    </div>
                  )}
                </For>
                <div class="xs muted" style="margin-top:var(--sp-2)">
                  Права определяются ролью. Если нужен дополнительный доступ, обратитесь к администратору панели.
                </div>
              </div>

              <hr class="divider" />

              <button class="btn btn--danger btn--block" type="button" onClick={() => this.vm.logout()}>
                <Icon name="logout" size={16} class="" /> Выйти из аккаунта
              </button>
            </div>
          </section>

          <section class="card">
            <div class="card__head">
              <div>
                <div class="card__title">Оформление</div>
                <div class="card__sub">Тема интерфейса панели</div>
              </div>
              <span class="badge badge--blue">Сейчас: {this.vm.effectiveThemeLabel}</span>
            </div>
            <div class="card__body stack-sm">
              <div class="tabs">
                <For each={this.vm.themeOptions}>
                  {(option) => (
                    <button
                      class={`tab ${this.vm.isTheme(option.value) ? "is-active" : ""}`}
                      type="button"
                      onClick={() => this.vm.setTheme(option.value)}
                    >
                      {option.label}
                    </button>
                  )}
                </For>
              </div>
              <For each={this.vm.themeOptions}>
                {(option) => (
                  <Show when={this.vm.isTheme(option.value)}>
                    <div class="xs muted">{option.description}</div>
                  </Show>
                )}
              </For>
              <div class="xs muted">
                Режим «Системная» повторяет настройки операционной системы и переключается автоматически.
              </div>
            </div>
          </section>
        </div>

        <section class="card">
          <div class="card__head">
            <div>
              <div class="card__title">Настройки аккаунта</div>
              <div class="card__sub">Логин и пароль для входа в панель</div>
            </div>
          </div>
          <form class="card__body stack" onSubmit={(event: SubmitEvent) => this.vm.savePassword(event)}>
            <div class="field">
              <label for="profile-login">Логин</label>
              <input
                id="profile-login"
                class="input"
                type="text"
                value={this.vm.login}
                readonly
                autocomplete="username"
              />
              <div class="hint">Логин назначает администратор, изменить его нельзя.</div>
            </div>

            <hr class="divider" />

            <div class="stack-sm">
              <div class="strong">Смена пароля</div>
              <div class="xs muted">Текущая сессия останется активной после смены пароля.</div>
            </div>

            <div class="field">
              <label for="profile-current">Текущий пароль</label>
              <input
                id="profile-current"
                class="input"
                type="password"
                autocomplete="current-password"
                placeholder="••••••••"
                value={this.vm.currentPassword}
                onInput={(event: InputEvent) => this.vm.setCurrentPassword(event)}
              />
            </div>

            <div class="field">
              <label for="profile-next">Новый пароль</label>
              <input
                id="profile-next"
                class={`input ${this.vm.nextTooShort ? "is-invalid" : ""}`}
                type="password"
                autocomplete="new-password"
                placeholder="Минимум 8 символов"
                value={this.vm.nextPassword}
                onInput={(event: InputEvent) => this.vm.setNextPassword(event)}
              />
              <Show
                when={this.vm.nextTooShort}
                fallback={<div class="hint">Минимум 8 символов.</div>}
              >
                <div class="hint" style="color:var(--red)">Пароль слишком короткий.</div>
              </Show>
            </div>

            <div class="field">
              <label for="profile-repeat">Повторите новый пароль</label>
              <input
                id="profile-repeat"
                class={`input ${this.vm.repeatMismatch ? "is-invalid" : ""}`}
                type="password"
                autocomplete="new-password"
                placeholder="Ещё раз"
                value={this.vm.repeatPassword}
                onInput={(event: InputEvent) => this.vm.setRepeatPassword(event)}
              />
              <Show when={this.vm.repeatMismatch}>
                <div class="hint" style="color:var(--red)">Пароли не совпадают.</div>
              </Show>
            </div>

            <button class="btn btn--primary btn--block" type="submit" disabled={!this.vm.canSave}>
              <Show when={this.vm.saving} fallback={<span>Сохранить изменения</span>}>
                <span
                  class="spinner"
                  style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"
                ></span>
                <span>Сохраняем…</span>
              </Show>
            </button>

            <div class="xs muted">Пароль хранится на сервере в виде хеша и не передаётся другим пользователям.</div>
          </form>
        </section>
      </div>
    </div>
  );
}
