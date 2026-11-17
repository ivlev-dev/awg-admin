import { For, Show, Suspense, createSignal, lazy } from "@ivlev-dev/silent-core";
import type { LazyOptions } from "@ivlev-dev/silent-core";

import type { AppVM } from "./App.vm";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { AppErrorBoundary } from "@/components/ErrorBoundary";
import { Icon } from "@/components/Icon";
import { NotFound } from "@/components/NotFound";
import { t } from "@/i18n";

interface PageFailure {
  readonly route: string;
  readonly message: string;
}

const [pageFailure, setPageFailure] = createSignal<PageFailure | null>(null);

function failureMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return t("app.error.unknown");
}

function pageOptions(route: string): LazyOptions {
  return {
    onError: (error: unknown): void => {
      console.error(`Не удалось загрузить раздел ${route}`, error);
      setPageFailure({ route, message: failureMessage(error) });
    },
  };
}

const Login = lazy(
  () => import("@/features/auth/Login").then((module) => ({ default: module.Login })),
  pageOptions("login"),
);
const Register = lazy(
  () => import("@/features/auth/Register").then((module) => ({ default: module.Register })),
  pageOptions("register"),
);
const VerifyEmail = lazy(
  () => import("@/features/auth/VerifyEmail").then((module) => ({ default: module.VerifyEmail })),
  pageOptions("verify-email"),
);
const Overview = lazy(
  () => import("@/features/overview/Overview").then((module) => ({ default: module.Overview })),
  pageOptions("overview"),
);
const ClientsPage = lazy(
  () => import("@/features/clients/ClientsPage").then((module) => ({ default: module.ClientsPage })),
  pageOptions("clients"),
);
const ClientDetails = lazy(
  () => import("@/features/clients/ClientDetails").then((module) => ({ default: module.ClientDetails })),
  pageOptions("client"),
);
const GroupsPage = lazy(
  () => import("@/features/groups/GroupsPage").then((module) => ({ default: module.GroupsPage })),
  pageOptions("groups"),
);
const GroupDetails = lazy(
  () => import("@/features/groups/GroupDetails").then((module) => ({ default: module.GroupDetails })),
  pageOptions("group"),
);
const InterfacesPage = lazy(
  () => import("@/features/interfaces/InterfacesPage").then((module) => ({ default: module.InterfacesPage })),
  pageOptions("interfaces"),
);
const NodesPage = lazy(
  () => import("@/features/nodes/NodesPage").then((module) => ({ default: module.NodesPage })),
  pageOptions("nodes"),
);
const TariffsPage = lazy(
  () => import("@/features/tariffs/TariffsPage").then((module) => ({ default: module.TariffsPage })),
  pageOptions("tariffs"),
);
const UsersPage = lazy(
  () => import("@/features/users/UsersPage").then((module) => ({ default: module.UsersPage })),
  pageOptions("users"),
);
const AuditPage = lazy(
  () => import("@/features/audit/AuditPage").then((module) => ({ default: module.AuditPage })),
  pageOptions("audit"),
);
const ImportPage = lazy(
  () => import("@/features/import/ImportPage").then((module) => ({ default: module.ImportPage })),
  pageOptions("import"),
);
const StatsPage = lazy(
  () => import("@/features/stats/StatsPage").then((module) => ({ default: module.StatsPage })),
  pageOptions("stats"),
);
const ProfilePage = lazy(
  () => import("@/features/profile/ProfilePage").then((module) => ({ default: module.ProfilePage })),
  pageOptions("profile"),
);
const SettingsPage = lazy(
  () => import("@/features/settings/SettingsPage").then((module) => ({ default: module.SettingsPage })),
  pageOptions("settings"),
);

function PageFallback() {
  return (
    <div class="stack" style="align-items:center;justify-content:center;min-height:240px;gap:12px">
      <div class="spinner"></div>
      <div class="small muted">{t("app.loading.page")}</div>
    </div>
  );
}

function PageSlot(props: { readonly children?: unknown }) {
  return (
    <div class="page-slot">
      <Suspense fallback={<PageFallback />}>{props.children}</Suspense>
    </div>
  );
}

function PageFailureNotice(props: { readonly title: string }) {
  return (
    <div class="stack">
      <div class="alert alert--error">{t("app.error.section", { title: props.title })}</div>
      <div class="xs muted">{pageFailure()?.message}</div>
      <div>
        <button class="btn btn--sm" type="button" onClick={() => window.location.reload()}>
          {t("app.action.reload")}
        </button>
      </div>
    </div>
  );
}

function sidebar(vm: AppVM) {
  return (
    <>
      <div class="sidebar__brand">
        <div class="sidebar__logo"></div>
        <div>
          <div class="sidebar__title">AWG Admin</div>
          <div class="sidebar__subtitle">{t("shell.subtitle")}</div>
        </div>
      </div>
      <nav class="grow">
        <div class="nav-group">
          <div class="nav-group__label">{t("nav.group.management")}</div>
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
          <div class="nav-group__label">{t("nav.group.account")}</div>
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
            <strong>{t("shell.quickStart.title")}</strong>
            {t("shell.quickStart.text")}
            <div style="margin-top:8px">
              <a href="/interfaces" onClick={(event: Event) => { event.preventDefault(); vm.go("/interfaces"); }}>
                {t("shell.quickStart.link")}
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
        <button class="btn btn--ghost btn--icon" type="button" onClick={() => vm.logout()} aria-label={t("shell.logout")}>
          <Icon name="logout" size={18} />
        </button>
      </div>
    </>
  );
}

function page(vm: AppVM) {
  return (
    <>
      <Show when={vm.routeName === "overview"}>
        <PageSlot>
          <Overview />
        </PageSlot>
      </Show>
      <Show when={vm.routeName === "nodes"}>
        <PageSlot>
          <NodesPage />
        </PageSlot>
      </Show>
      <Show when={vm.routeName === "interfaces"}>
        <PageSlot>
          <InterfacesPage />
        </PageSlot>
      </Show>
      <Show when={vm.routeName === "groups"}>
        <PageSlot>
          <GroupsPage />
        </PageSlot>
      </Show>
      <Show when={vm.routeName === "group"}>
        <PageSlot>
          <GroupDetails />
        </PageSlot>
      </Show>
      <Show when={vm.routeName === "clients"}>
        <PageSlot>
          <ClientsPage />
        </PageSlot>
      </Show>
      <Show when={vm.routeName === "client"}>
        <PageSlot>
          <ClientDetails />
        </PageSlot>
      </Show>
      <Show when={vm.routeName === "tariffs"}>
        <PageSlot>
          <TariffsPage />
        </PageSlot>
      </Show>
      <Show when={vm.routeName === "users"}>
        <PageSlot>
          <UsersPage />
        </PageSlot>
      </Show>
      <Show when={vm.routeName === "audit"}>
        <PageSlot>
          <AuditPage />
        </PageSlot>
      </Show>
      <Show when={vm.routeName === "import"}>
        <PageSlot>
          <ImportPage />
        </PageSlot>
      </Show>
      <Show when={vm.routeName === "stats"}>
        <PageSlot>
          <StatsPage />
        </PageSlot>
      </Show>
      <Show when={vm.routeName === "profile"}>
        <PageSlot>
          <ProfilePage />
        </PageSlot>
      </Show>
      <Show when={vm.routeName === "settings"}>
        <PageSlot>
          <SettingsPage />
        </PageSlot>
      </Show>
      <Show when={vm.routeName === "not-found"}>
        <NotFound path={vm.path} onHome={() => vm.go("/")} />
      </Show>
    </>
  );
}

function shell(vm: AppVM) {
  return (
    <div class="shell">
      <aside class="sidebar">{sidebar(vm)}</aside>
      <div class="main">
        <header class="topbar">
          <button class="btn btn--ghost btn--icon no-desktop" type="button" onClick={() => vm.toggleDrawer()} aria-label={t("shell.menu")}>
            <Icon name="menu" size={20} class="" />
          </button>
          <div class="topbar__title">{vm.title}</div>
          <div class="topbar__spacer"></div>
          <span class={`status-pill no-mobile ${vm.online ? "" : "status-pill--offline"}`}>
            <span class={`dot ${vm.online ? "dot--green" : "dot--red"}`}></span>
            {vm.online ? t("common.online") : t("app.network.offline")}
          </span>
          <button class="btn btn--ghost btn--icon" type="button" onClick={() => vm.toggleTheme()} aria-label={t("shell.theme")}>
            <Icon name={vm.themeEffective === "dark" ? "sun" : "moon"} size={18} class="" />
          </button>
          <button class="btn btn--ghost btn--icon" type="button" onClick={() => vm.go("/profile")} aria-label={t("shell.profile")}>
            <div class="avatar avatar--sm">{vm.userInitial}</div>
          </button>
        </header>
        <main class="content">{content(vm)}</main>
      </div>
      <nav class="mobile-nav">
        <For each={vm.mobileNav}>
          {(item) => (
            <button
              class={`mobile-nav__item ${vm.isActive(item.path) ? "is-active" : ""}`}
              type="button"
              onClick={() => vm.go(item.path)}
            >
              <Icon name={item.icon} class="mobile-nav__icon" />
              <span>{item.title}</span>
            </button>
          )}
        </For>
      </nav>
      <Show when={vm.drawer}>
        <div class="drawer-backdrop" onClick={(event: Event) => {
          if (event.target === event.currentTarget) vm.drawer = false;
        }}>
          <div class="drawer">{sidebar(vm)}</div>
        </div>
      </Show>
    </div>
  );
}

function content(vm: AppVM) {
  return (
    <Show when={pageFailure()?.route === vm.routeName} fallback={page(vm)}>
      <PageFailureNotice title={vm.title} />
    </Show>
  );
}

export function App(this: { vm: AppVM }) {
  return (
    <>
      <ConnectionBanner notice={() => this.vm.connectionNotice} online={() => this.vm.online} />

      <Show when={this.vm.booting}>
        <div class="boot-screen">
          <div class="sidebar__logo" style="width:56px;height:56px"></div>
          <div class="spinner"></div>
          <div class="small muted">{t("app.loading.panel")}</div>
        </div>
      </Show>

      <Show when={!this.vm.booting && this.vm.routeName === "login"}>
        <PageSlot>
          <Login />
        </PageSlot>
      </Show>

      <Show when={!this.vm.booting && this.vm.routeName === "register"}>
        <PageSlot>
          <Register />
        </PageSlot>
      </Show>

      <Show when={!this.vm.booting && this.vm.routeName === "verify-email"}>
        <PageSlot>
          <VerifyEmail />
        </PageSlot>
      </Show>

      <Show when={!this.vm.booting && this.vm.routeName === "not-found" && !this.vm.showShell}>
        <NotFound path={this.vm.path} onHome={() => this.vm.go("/")} standalone />
      </Show>

      <Show when={this.vm.showShell}>
        <AppErrorBoundary onHome={() => this.vm.go("/")}>
          {() => shell(this.vm)}
        </AppErrorBoundary>
      </Show>

      <div class="toast-stack" aria-live="polite">
        <For each={this.vm.toasts.items}>
          {(item) => (
            <div class={`toast toast--${item.kind}`} onClick={() => this.vm.toasts.dismiss(item.id)}>
              <span class="grow">{item.message}</span>
              <Icon name="close" size={14} class="" />
            </div>
          )}
        </For>
      </div>
    </>
  );
}
