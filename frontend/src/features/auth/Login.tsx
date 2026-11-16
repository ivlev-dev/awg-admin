import { Show } from "@ivlev-dev/silent-core";

import type { LoginVM } from "./Login.vm";
import { Icon } from "@/components/Icon";

export function Login(this: { vm: LoginVM }) {
  return (
    <div class="auth">
      <section class="auth__brand">
        <div class="auth__brand-glow"></div>
        <div class="auth__brand-inner">
          <div class="row" style="gap:14px">
            <div class="sidebar__logo" style="width:52px;height:52px"></div>
            <div>
              <div class="sidebar__title" style="font-size:1.35rem">AWG Admin</div>
              <div class="sidebar__subtitle">AmneziaWG control</div>
            </div>
          </div>
          <div style="margin-top:auto" class="stack">
            <h2 style="color:#fff;font-size:clamp(1.6rem,1.2rem+1.6vw,2.4rem);letter-spacing:-0.03em;line-height:1.12">
              Управление AmneziaWG<br />на нескольких нодах
            </h2>
            <p style="color:var(--sidebar-muted);max-width:42ch">
              Группы интерфейсов, пиры сразу на всех нодах, тарифы, поддиапазоны и живая статистика — в одном месте.
            </p>
            <div class="auth__features">
              <div class="auth__feature"><Icon name="shield" size={18} class="" />AWG 3.1 с HTTP/3 mimicry</div>
              <div class="auth__feature"><Icon name="traffic" size={18} class="" />Трафик и лимиты в реальном времени</div>
              <div class="auth__feature"><Icon name="globe" size={18} class="" />Импорт сервера и пачки клиентов</div>
            </div>
          </div>
          <div class="xs" style="color:var(--sidebar-muted);margin-top:32px">AmneziaWG 3.1 · WebTransport ready</div>
        </div>
      </section>

      <section class="auth__form">
        <div class="auth__card">
          <div class="page-head" style="margin-bottom:24px">
            <div class="page-head__eyebrow">Панель управления</div>
            <h1>Вход в систему</h1>
            <p>Введите учётные данные администратора или пользователя.</p>
          </div>

          <form class="stack" onSubmit={(event: Event) => this.vm.submit(event)}>
            <div class="field">
              <label for="login">Логин</label>
              <input
                id="login"
                class="input"
                type="text"
                autocomplete="username"
                placeholder="admin"
                value={this.vm.login}
                onInput={(event: Event) => this.vm.setLogin(event)}
              />
            </div>
            <div class="field">
              <label for="password">Пароль</label>
              <div class="auth__password">
                <input
                  id="password"
                  class="input"
                  type={this.vm.showPassword ? "text" : "password"}
                  autocomplete="current-password"
                  placeholder="••••••••"
                  value={this.vm.password}
                  onInput={(event: Event) => this.vm.setPassword(event)}
                />
                <button class="btn btn--ghost btn--icon" type="button" onClick={() => this.vm.togglePassword()} aria-label="Показать пароль">
                  <Icon name={this.vm.showPassword ? "shield" : "search"} size={16} class="" />
                </button>
              </div>
            </div>

            <Show when={this.vm.error}>
              <div class="alert alert--error">{this.vm.error}</div>
            </Show>

            <button class="btn btn--primary btn--block" type="submit" disabled={!this.vm.canSubmit}>
              <Show when={this.vm.busy} fallback={<span>Войти</span>}>
                <span class="spinner" style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"></span>
                <span>Проверяем…</span>
              </Show>
            </button>
          </form>

          <div class="auth__footer">
            <span class="xs muted">Доступ выдаёт администратор панели.</span>
          </div>
        </div>
      </section>
    </div>
  );
}
