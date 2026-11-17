import { For, Show } from "@ivlev-dev/silent-core";
import { RouterView } from "@ivlev-dev/silent-router";

import type { AppVM } from "./App.vm";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { AppErrorBoundary } from "@/components/ErrorBoundary";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { NotFound } from "@/components/NotFound";
import { MAIN_CONTENT_ID, SkipLink } from "@/components/SkipLink";
import { ToastStack } from "@/components/ToastStack";
import { t } from "@/i18n";

function failureMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return t("app.error.unknown");
}

function PageFallback() {
  return (
    <div class="stack" style="align-items:center;justify-content:center;min-height:240px;gap:12px">
      <div class="spinner"></div>
      <div class="small muted">{t("app.loading.page")}</div>
    </div>
  );
}

function PageFailureNotice(props: { readonly title: string; readonly message: string }) {
  return (
    <div class="stack">
      <div class="alert alert--error">{t("app.error.section", { title: props.title })}</div>
      <div class="xs muted">{props.message}</div>
      <div>
        <button class="btn btn--sm" type="button" onClick={() => window.location.reload()}>
          {t("app.action.reload")}
        </button>
      </div>
    </div>
  );
}

function pageView(vm: AppVM) {
  return (
    <RouterView
      fallback={<PageFallback />}
      notFound={() => <NotFound path={vm.path} onHome={() => vm.go("/")} />}
      error={(error: unknown) => <PageFailureNotice title={vm.title} message={failureMessage(error)} />}
    />
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
              <button
                class={`nav-item ${vm.isActive(item.path) ? "is-active" : ""}`}
                type="button"
                onClick={() => vm.go(item.path)}
                onMouseEnter={() => vm.prefetch(item.path)}
                onFocus={() => vm.prefetch(item.path)}
              >
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
              <button
                class={`nav-item ${vm.isActive(item.path) ? "is-active" : ""}`}
                type="button"
                onClick={() => vm.go(item.path)}
                onMouseEnter={() => vm.prefetch(item.path)}
                onFocus={() => vm.prefetch(item.path)}
              >
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

function shell(vm: AppVM) {
  return (
    <div class="shell">
      <aside class="sidebar">{sidebar(vm)}</aside>
      <div class="main">
        <header class="topbar">
          <div class="topbar__title">{vm.title}</div>
          <div class="topbar__spacer"></div>
          <span class={`status-pill no-mobile ${vm.online ? "" : "status-pill--offline"}`}>
            <span class={`dot ${vm.online ? "dot--green" : "dot--red"}`}></span>
            {vm.online ? t("common.online") : t("app.network.offline")}
          </span>
          <button class="btn btn--ghost btn--icon no-mobile" type="button" onClick={() => vm.toggleTheme()} aria-label={t("shell.theme")}>
            <Icon name={vm.themeEffective === "dark" ? "sun" : "moon"} size={18} class="" />
          </button>
          <button class="btn btn--ghost btn--icon" type="button" onClick={() => vm.go("/profile")} aria-label={t("shell.profile")}>
            <div class="avatar avatar--sm">{vm.userInitial}</div>
          </button>
        </header>
        <main class="content" id={MAIN_CONTENT_ID} tabindex={-1}>{pageView(vm)}</main>
      </div>
      <nav class="mobile-nav" aria-label={t("shell.menu")}>
        <For each={vm.mobileNav}>
          {(item) => (
            <button
              class={`mobile-nav__item ${vm.isActive(item.path) ? "is-active" : ""}`}
              type="button"
              aria-current={vm.isActive(item.path) ? "page" : undefined}
              onClick={() => vm.go(item.path)}
              onMouseEnter={() => vm.prefetch(item.path)}
              onFocus={() => vm.prefetch(item.path)}
            >
              <Icon name={item.icon} class="mobile-nav__icon" />
              <span>{item.title}</span>
            </button>
          )}
        </For>
        <button
          class={`mobile-nav__item ${vm.moreOpen ? "is-active" : ""}`}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={vm.moreOpen ? "true" : "false"}
          onClick={() => vm.openMore()}
        >
          <Icon name="menu" class="mobile-nav__icon" />
          <span>{t("shell.more")}</span>
        </button>
      </nav>
      <Modal
        open={vm.moreOpen}
        title={t("shell.menu")}
        ariaLabel={t("shell.menu")}
        onClose={() => vm.closeMore()}
      >
        <div class="sheet-nav">
          <Show when={vm.moreManagementNav.length > 0}>
            <div class="sheet-nav__label">{t("nav.group.management")}</div>
            <For each={vm.moreManagementNav}>
              {(item) => (
                <button
                  class="sheet-nav__item"
                  type="button"
                  onClick={() => vm.go(item.path)}
                  onMouseEnter={() => vm.prefetch(item.path)}
                  onFocus={() => vm.prefetch(item.path)}
                >
                  <span class="sheet-nav__icon"><Icon name={item.icon} size={20} /></span>
                  <span class="sheet-nav__title">{item.title}</span>
                  <span class="sheet-nav__chevron" aria-hidden="true">›</span>
                </button>
              )}
            </For>
          </Show>
          <Show when={vm.moreAccountNav.length > 0}>
            <div class="sheet-nav__label">{t("nav.group.account")}</div>
            <For each={vm.moreAccountNav}>
              {(item) => (
                <button
                  class="sheet-nav__item"
                  type="button"
                  onClick={() => vm.go(item.path)}
                  onMouseEnter={() => vm.prefetch(item.path)}
                  onFocus={() => vm.prefetch(item.path)}
                >
                  <span class="sheet-nav__icon"><Icon name={item.icon} size={20} /></span>
                  <span class="sheet-nav__title">{item.title}</span>
                  <span class="sheet-nav__chevron" aria-hidden="true">›</span>
                </button>
              )}
            </For>
          </Show>
          <div class="sheet-nav__label">{t("shell.appearance")}</div>
          <button class="sheet-nav__item" type="button" onClick={() => vm.toggleTheme()}>
            <span class="sheet-nav__icon">
              <Icon name={vm.themeEffective === "dark" ? "sun" : "moon"} size={20} />
            </span>
            <span class="sheet-nav__title">{t("shell.theme")}</span>
            <span class="sheet-nav__meta">{vm.themeEffective === "dark" ? t("profile.theme.dark") : t("profile.theme.light")}</span>
          </button>
          <button class="sheet-nav__item sheet-nav__item--danger" type="button" onClick={() => vm.logout()}>
            <span class="sheet-nav__icon"><Icon name="logout" size={20} /></span>
            <span class="sheet-nav__title">{t("shell.logout")}</span>
          </button>
        </div>
      </Modal>
    </div>
  );
}

export function App(this: { vm: AppVM }) {
  return (
    <>
      <SkipLink />

      <ConnectionBanner notice={() => this.vm.connectionNotice} online={() => this.vm.online} />

      <Show when={this.vm.booting}>
        <div class="boot-screen">
          <div class="sidebar__logo" style="width:56px;height:56px"></div>
          <div class="spinner"></div>
          <div class="small muted">{t("app.loading.panel")}</div>
        </div>
      </Show>

      <Show when={this.vm.showPublic}>
        <main class="page-slot" id={MAIN_CONTENT_ID} tabindex={-1}>{pageView(this.vm)}</main>
      </Show>

      <Show when={this.vm.showShell}>
        <AppErrorBoundary onHome={() => this.vm.go("/")}>
          {() => shell(this.vm)}
        </AppErrorBoundary>
      </Show>

      <ToastStack
        items={this.vm.toasts.items}
        onDismiss={(id: number) => this.vm.toasts.dismiss(id)}
      />
    </>
  );
}
