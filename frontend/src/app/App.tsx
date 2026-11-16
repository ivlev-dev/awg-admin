import { For, Show } from "@ivlev-dev/silent-core";

import type { AppVM } from "./App.vm";
import { Icon } from "@/components/Icon";
import { toasts } from "./container";
import { Login } from "@/features/auth/Login";
import { Overview } from "@/features/overview/Overview";
import { NodesPage } from "@/features/nodes/NodesPage";
import { InterfacesPage } from "@/features/interfaces/InterfacesPage";
import { GroupsPage } from "@/features/groups/GroupsPage";
import { GroupDetails } from "@/features/groups/GroupDetails";
import { ClientsPage } from "@/features/clients/ClientsPage";
import { ClientDetails } from "@/features/clients/ClientDetails";
import { TariffsPage } from "@/features/tariffs/TariffsPage";
import { UsersPage } from "@/features/users/UsersPage";
import { ImportPage } from "@/features/import/ImportPage";
import { StatsPage } from "@/features/stats/StatsPage";
import { ProfilePage } from "@/features/profile/ProfilePage";
import { SettingsPage } from "@/features/settings/SettingsPage";

function sidebar(vm: AppVM) {
  return (
    <>
      <div class="sidebar__brand">
        <div class="sidebar__logo"></div>
        <div>
          <div class="sidebar__title">AWG Admin</div>
          <div class="sidebar__subtitle">AmneziaWG control</div>
        </div>
      </div>
      <nav class="grow">
        <div class="nav-group">
          <div class="nav-group__label">Управление</div>
          <For each={vm.nav}>
            {(item) => (
              <button class={`nav-item ${vm.isActive(item.path) ? "is-active" : ""}`} type="button" onClick={() => vm.go(item.path)}>
                <Icon name={item.icon} />
                <span>{item.title}</span>
              </button>
            )}
          </For>
        </div>
        <div class="nav-group">
          <div class="nav-group__label">Аккаунт</div>
          <For each={vm.accountNav}>
            {(item) => (
              <button class={`nav-item ${vm.isActive(item.path) ? "is-active" : ""}`} type="button" onClick={() => vm.go(item.path)}>
                <Icon name={item.icon} />
                <span>{item.title}</span>
              </button>
            )}
          </For>
        </div>
        <Show when={vm.isAdmin}>
          <div class="sidebar__hint">
            <strong>Быстрый старт</strong>
            Создайте ноду, добавьте интерфейс и подключите первый клиент.
            <div style="margin-top:8px">
              <a href="/interfaces" onClick={(event: Event) => { event.preventDefault(); vm.go("/interfaces"); }}>
                Перейти к интерфейсам →
              </a>
            </div>
          </div>
        </Show>
      </nav>
      <div class="sidebar__user">
        <div class="avatar">{vm.userInitial}</div>
        <div class="grow">
          <div class="small strong truncate">{vm.name}</div>
          <div class="xs muted">{vm.roleLabel}</div>
        </div>
        <button class="btn btn--ghost btn--icon" type="button" onClick={() => vm.logout()} aria-label="Выйти">
          <Icon name="logout" size={18} />
        </button>
      </div>
    </>
  );
}

function page(vm: AppVM) {
  return (
    <>
      <Show when={vm.routeName === "overview"}><Overview /></Show>
      <Show when={vm.routeName === "nodes"}><NodesPage /></Show>
      <Show when={vm.routeName === "interfaces"}><InterfacesPage /></Show>
      <Show when={vm.routeName === "groups"}><GroupsPage /></Show>
      <Show when={vm.routeName === "group"}><GroupDetails /></Show>
      <Show when={vm.routeName === "clients"}><ClientsPage /></Show>
      <Show when={vm.routeName === "client"}><ClientDetails /></Show>
      <Show when={vm.routeName === "tariffs"}><TariffsPage /></Show>
      <Show when={vm.routeName === "users"}><UsersPage /></Show>
      <Show when={vm.routeName === "import"}><ImportPage /></Show>
      <Show when={vm.routeName === "stats"}><StatsPage /></Show>
      <Show when={vm.routeName === "profile"}><ProfilePage /></Show>
      <Show when={vm.routeName === "settings"}><SettingsPage /></Show>
    </>
  );
}

export function App(this: { vm: AppVM }) {
  return (
    <>
      <Show when={this.vm.booting}>
        <div class="boot-screen">
          <div class="sidebar__logo" style="width:56px;height:56px"></div>
          <div class="spinner"></div>
          <div class="small muted">Загрузка панели…</div>
        </div>
      </Show>

      <Show when={!this.vm.booting && this.vm.routeName === "login"}>
        <Login />
      </Show>

      <Show when={this.vm.showShell}>
        <div class="shell">
          <aside class="sidebar">{sidebar(this.vm)}</aside>
          <div class="main">
            <header class="topbar">
              <button class="btn btn--ghost btn--icon no-desktop" type="button" onClick={() => this.vm.toggleDrawer()} aria-label="Меню">
                <Icon name="menu" size={20} class="" />
              </button>
              <div class="topbar__title">{this.vm.title}</div>
              <div class="topbar__spacer"></div>
              <span class="status-pill no-mobile">
                <span class="dot dot--green"></span> Online
              </span>
              <button class="btn btn--ghost btn--icon" type="button" onClick={() => this.vm.toggleTheme()} aria-label="Сменить тему">
                <Icon name={this.vm.themeEffective === "dark" ? "sun" : "moon"} size={18} class="" />
              </button>
              <button class="btn btn--ghost btn--icon" type="button" onClick={() => this.vm.go("/profile")} aria-label="Профиль">
                <div class="avatar avatar--sm">{this.vm.userInitial}</div>
              </button>
            </header>
            <main class="content">{page(this.vm)}</main>
          </div>
          <nav class="mobile-nav">
            <For each={this.vm.mobileNav}>
              {(item) => (
                <button
                  class={`mobile-nav__item ${this.vm.isActive(item.path) ? "is-active" : ""}`}
                  type="button"
                  onClick={() => this.vm.go(item.path)}
                >
                  <Icon name={item.icon} class="mobile-nav__icon" />
                  <span>{item.title}</span>
                </button>
              )}
            </For>
          </nav>
          <Show when={this.vm.drawer}>
            <div class="drawer-backdrop" onClick={(event: Event) => {
              if (event.target === event.currentTarget) this.vm.drawer = false;
            }}>
              <div class="drawer">{sidebar(this.vm)}</div>
            </div>
          </Show>
        </div>
      </Show>

      <div class="toast-stack" aria-live="polite">
        <For each={toasts.items}>
          {(item) => (
            <div class={`toast toast--${item.kind}`} onClick={() => toasts.dismiss(item.id)}>
              <span class="grow">{item.message}</span>
              <Icon name="close" size={14} class="" />
            </div>
          )}
        </For>
      </div>
    </>
  );
}
