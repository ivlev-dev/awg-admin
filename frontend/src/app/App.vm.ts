import { ViewModel, computed, reactive, watch } from "@ivlev-dev/silent-core";

import { ConnectionMonitor, type ConnectionNotice } from "@/app/connection";
import { askConfirm } from "@/app/confirm";
import { density, initDensity, setDensity } from "@/app/density";
import { GROUPS_SECTION_ENABLED } from "@/app/features";
import { type CommandItem } from "@/app/command";
import { IDLE_PREFETCH_PATHS, prefetchPath, scheduleIdlePrefetch, type CancelIdlePrefetch } from "@/app/prefetch";
import { ROUTES } from "@/app/routes-def";
import { Router } from "@/app/router";
import {
  blocksSwipe,
  isMobileWidth,
  neighborPath,
  pointOf,
  sheetDismissDirection,
  swipeDirection,
  type SwipeEventLike,
  type SwipePoint,
} from "@/app/swipe";
import { Session } from "@/app/session";
import { ThemeStore, type ThemeMode } from "@/app/theme";
import { ToastStore } from "@/app/toast";
import { initials } from "@/domain/format";
import { t, type TranslationKey } from "@/i18n";
import type { IconName } from "@/components/Icon";

export interface NavItem {
  path: string;
  title: string;
  icon: IconName;
}

interface NavDefinition {
  path: string;
  titleKey: TranslationKey;
  icon: IconName;
}

const MANAGEMENT: NavDefinition[] = [
  { path: "/", titleKey: "nav.overview", icon: "overview" },
  { path: "/nodes", titleKey: "nav.nodes", icon: "nodes" },
  { path: "/interfaces", titleKey: "nav.interfaces", icon: "interfaces" },
  { path: "/groups", titleKey: "nav.groups", icon: "groups" },
  { path: "/clients", titleKey: "nav.clients", icon: "clients" },
  { path: "/import", titleKey: "nav.import", icon: "import" },
];

const ACCOUNT: NavDefinition[] = [
  { path: "/tariffs", titleKey: "nav.tariffs", icon: "tariffs" },
  { path: "/users", titleKey: "nav.users", icon: "users" },
  { path: "/audit", titleKey: "nav.audit", icon: "shield" },
  { path: "/stats", titleKey: "nav.stats", icon: "stats" },
  { path: "/settings", titleKey: "nav.settings", icon: "settings" },
  { path: "/profile", titleKey: "nav.profile", icon: "profile" },
];

const MOBILE_NAV: NavDefinition[] = [
  { path: "/", titleKey: "nav.overview", icon: "overview" },
  { path: "/clients", titleKey: "nav.clients", icon: "clients" },
  { path: "/interfaces", titleKey: "nav.interfaces", icon: "interfaces" },
  { path: "/stats", titleKey: "nav.stats", icon: "stats" },
];

const MOBILE_PATHS: ReadonlySet<string> = new Set(MOBILE_NAV.map((item) => item.path));

const HIDDEN_NAV_PATHS: ReadonlySet<string> = GROUPS_SECTION_ENABLED ? new Set<string>() : new Set(["/groups"]);

const ADMIN_ONLY_PATHS: ReadonlySet<string> = new Set(
  ROUTES.filter((route) => route.adminOnly === true).map((route) => route.path),
);

const GROUP_ROUTE_NAMES: ReadonlySet<string> = new Set(["groups", "group"]);

function localize(definitions: NavDefinition[]): NavItem[] {
  return definitions.map((item) => ({
    path: item.path,
    title: t(item.titleKey),
    icon: item.icon,
  }));
}

function visible(items: NavItem[]): NavItem[] {
  if (HIDDEN_NAV_PATHS.size === 0) return items;
  return items.filter((item) => !HIDDEN_NAV_PATHS.has(item.path));
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

export class AppVM extends ViewModel {
  @reactive accessor booting = true;
  @reactive accessor moreOpen = false;
  @reactive accessor commandOpen = false;

  private readonly connection = new ConnectionMonitor();

  private cancelIdlePrefetch: CancelIdlePrefetch | null = null;

  private idlePrefetchPlanned = false;

  private keydownBound = false;

  private swipeStart: { point: SwipePoint; blocked: boolean } | null = null;

  private sheetStart: SwipePoint | null = null;

  constructor(
    private readonly session: Session,
    private readonly router: Router,
    private readonly theme: ThemeStore,
    private readonly toastStore: ToastStore,
  ) {
    super();
    this.connection.listen();
    initDensity();
  }

  override async created(): Promise<void> {
    if (!this.keydownBound) {
      document.addEventListener("keydown", this.onGlobalKeydown);
      this.keydownBound = true;
    }
    await this.session.init();
    this.booting = false;
    this.onTitleChange();
    this.guard();
    this.planIdlePrefetch();
  }

  override dispose(): void {
    if (this.keydownBound) {
      document.removeEventListener("keydown", this.onGlobalKeydown);
      this.keydownBound = false;
    }
    this.cancelIdlePrefetch?.();
    this.cancelIdlePrefetch = null;
    this.connection.dispose();
    super.dispose();
  }

  @computed
  get user() {
    return this.session.user;
  }

  @computed
  get isAdmin(): boolean {
    return this.session.isAdmin;
  }

  @computed
  get authenticated(): boolean {
    return this.session.authenticated;
  }

  @computed
  get loggingOut(): boolean {
    return this.session.loggingOut;
  }

  @computed
  get routeName(): string {
    return this.router.match.route.name;
  }

  @computed
  get path(): string {
    return this.router.path;
  }

  @computed
  get params(): Record<string, string> {
    return this.router.params;
  }

  @computed
  get online(): boolean {
    return this.connection.online;
  }

  @computed
  get connectionNotice(): ConnectionNotice {
    return this.connection.notice;
  }

  @computed
  get title(): string {
    return t(this.router.committedMatch.route.titleKey);
  }

  @computed
  get showShell(): boolean {
    const route = this.router.committedMatch.route;
    return this.authenticated && (!route.public || route.name === "not-found");
  }

  @computed
  get showPublic(): boolean {
    return !this.booting && !this.showShell && this.router.committedMatch.route.public === true;
  }

  @computed
  get nav(): NavItem[] {
    return this.visibleNav(MANAGEMENT);
  }

  @computed
  get accountNav(): NavItem[] {
    return this.visibleNav(ACCOUNT);
  }

  @computed
  get mobileNav(): NavItem[] {
    return this.visibleNav(MOBILE_NAV);
  }

  private visibleNav(definitions: NavDefinition[]): NavItem[] {
    return visible(localize(definitions)).filter(
      (item) => this.isAdmin || !ADMIN_ONLY_PATHS.has(item.path),
    );
  }

  @computed
  get commandItems(): CommandItem[] {
    const navigation: CommandItem[] = [...this.nav, ...this.accountNav].map((item) => ({
      id: `nav:${item.path}`,
      title: item.title,
      hint: item.path,
      icon: item.icon,
      path: item.path,
    }));
    const compact = density() === "compact";
    return [
      ...navigation,
      {
        id: "action:theme",
        title: t("command.action.theme"),
        hint: this.themeEffective === "dark" ? t("profile.theme.dark") : t("profile.theme.light"),
        icon: this.themeEffective === "dark" ? "sun" : "moon",
        run: () => this.toggleTheme(),
      },
      {
        id: "action:density",
        title: t("command.action.density"),
        hint: compact ? t("settings.interface.density.compact") : t("settings.interface.density.comfortable"),
        icon: "settings",
        run: () => setDensity(compact ? "comfortable" : "compact"),
      },
      ...(this.isAdmin
        ? [{
            id: "action:settings",
            title: t("command.action.settings"),
            icon: "settings" as const,
            path: "/settings",
          }]
        : []),
      {
        id: "action:profile",
        title: t("command.action.profile"),
        icon: "profile",
        path: "/profile",
      },
      {
        id: "action:logout",
        title: t("command.action.logout"),
        icon: "logout",
        run: () => {
          void this.requestLogout();
        },
      },
    ];
  }

  @computed
  get moreManagementNav(): NavItem[] {
    return this.nav.filter((item) => !MOBILE_PATHS.has(item.path));
  }

  @computed
  get moreAccountNav(): NavItem[] {
    return this.accountNav.filter((item) => !MOBILE_PATHS.has(item.path));
  }

  @computed
  get userInitial(): string {
    return initials(this.user?.email ?? "?");
  }

  @computed
  get themeMode(): ThemeMode {
    return this.theme.mode;
  }

  @computed
  get themeEffective(): "light" | "dark" {
    return this.theme.effective;
  }

  get toasts(): ToastStore {
    return this.toastStore;
  }

  get name(): string {
    return this.user?.email ?? t("common.guest");
  }

  @computed
  get roleLabel(): string {
    return this.isAdmin ? t("role.admin") : t("role.user");
  }

  isActive(path: string): boolean {
    if (path === "/") return this.router.path === "/";
    return this.router.path === path || this.router.path.startsWith(`${path}/`);
  }

  go(path: string): void {
    this.moreOpen = false;
    this.router.navigate(path);
  }

  prefetch(path: string): void {
    void prefetchPath(path);
  }

  touchStart(event: SwipeEventLike): void {
    const touch = event.touches[0];
    if (event.touches.length !== 1 || touch === undefined) {
      this.swipeStart = null;
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    this.swipeStart = { point: pointOf(touch), blocked: blocksSwipe(target) };
  }

  touchEnd(event: SwipeEventLike): void {
    const start = this.swipeStart;
    this.swipeStart = null;
    const touch = event.changedTouches[0];
    if (start === null || start.blocked || !isMobileWidth() || touch === undefined) return;
    const direction = swipeDirection(start.point, pointOf(touch));
    if (direction === null) return;
    const target = neighborPath(
      MOBILE_NAV.map((item) => item.path),
      this.router.path,
      direction,
    );
    if (target === null) return;
    this.prefetch(target);
    this.go(target);
  }

  sheetTouchStart(event: SwipeEventLike): void {
    const touch = event.touches[0];
    if (event.touches.length !== 1 || touch === undefined) {
      this.sheetStart = null;
      return;
    }
    this.sheetStart = pointOf(touch);
  }

  sheetTouchEnd(event: SwipeEventLike): void {
    const start = this.sheetStart;
    this.sheetStart = null;
    const touch = event.changedTouches[0];
    if (start === null || touch === undefined) return;
    if (sheetDismissDirection(start, pointOf(touch)) === "down") {
      this.closeMore();
    }
  }

  openMore(): void {
    this.moreOpen = true;
  }

  closeMore(): void {
    this.moreOpen = false;
  }

  openCommand(): void {
    this.moreOpen = false;
    this.commandOpen = true;
  }

  closeCommand(): void {
    this.commandOpen = false;
  }

  toggleCommand(): void {
    if (this.commandOpen) {
      this.closeCommand();
      return;
    }
    this.openCommand();
  }

  runCommand(item: CommandItem): void {
    this.commandOpen = false;
    if (item.path !== undefined) {
      this.go(item.path);
      return;
    }
    item.run?.();
  }

  private readonly onGlobalKeydown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && key === "k") {
      event.preventDefault();
      this.toggleCommand();
      return;
    }
    if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !isEditableTarget(event.target)) {
      event.preventDefault();
      this.openCommand();
    }
  };


  toggleTheme(): void {
    this.theme.toggle();
  }

  setTheme(mode: ThemeMode): void {
    this.theme.set(mode);
  }

  async logout(): Promise<void> {
    if (this.session.loggingOut) return;
    await this.session.logout();
    this.router.replace("/login");
  }

  async requestLogout(): Promise<void> {
    if (this.session.loggingOut) return;
    const confirmed = await askConfirm({
      title: t("common.logout.confirm.title"),
      message: t("common.logout.confirm.message"),
      confirmLabel: t("common.logout.confirm.action"),
      tone: "danger",
    });
    if (!confirmed) return;
    await this.logout();
  }

  @watch((vm: AppVM) => vm.title)
  onTitleChange(): void {
    document.title = `${this.title} · AWG Admin`;
  }

  @watch((vm: AppVM) => vm.routeName)
  onRouteChange(): void {
    this.guard();
  }

  @watch((vm: AppVM) => vm.isAdmin)
  onRoleChange(): void {
    this.guard();
  }

  @watch((vm: AppVM) => vm.authenticated)
  onAuthChange(): void {
    this.cancelIdlePrefetch?.();
    this.cancelIdlePrefetch = null;
    this.idlePrefetchPlanned = false;
    this.guard();
    this.planIdlePrefetch();
  }

  private planIdlePrefetch(): void {
    if (this.idlePrefetchPlanned || this.booting) return;
    if (!this.session.authenticated) return;
    if (this.router.match.route.public) return;
    const routes = IDLE_PREFETCH_PATHS.filter((path) => !this.isActive(path));
    if (routes.length === 0) return;
    this.idlePrefetchPlanned = true;
    this.cancelIdlePrefetch = scheduleIdlePrefetch({ routes });
  }

  guard(): void {
    if (this.booting) return;
    const route = this.router.match.route;
    if (!this.session.authenticated) {
      if (!route.public) this.router.replace("/login");
      return;
    }
    if (route.name === "login") {
      this.router.replace("/");
      return;
    }
    if (!GROUPS_SECTION_ENABLED && GROUP_ROUTE_NAMES.has(route.name)) {
      this.router.replace("/interfaces");
      return;
    }
    if (route.adminOnly && !this.session.isAdmin) {
      this.router.replace("/");
    }
  }
}
