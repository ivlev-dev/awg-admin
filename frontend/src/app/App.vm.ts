import { computed, reactive, watch } from "@ivlev-dev/silent-core";

import { Router } from "@/app/router";
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
  { path: "/profile", titleKey: "nav.profile", icon: "profile" },
];

const ROUTE_TITLES: Readonly<Record<string, TranslationKey>> = {
  overview: "route.overview",
  nodes: "route.nodes",
  interfaces: "route.interfaces",
  groups: "route.groups",
  group: "route.group",
  clients: "route.clients",
  client: "route.client",
  tariffs: "route.tariffs",
  users: "route.users",
  audit: "route.audit",
  import: "route.import",
  stats: "route.stats",
  profile: "route.profile",
  settings: "route.settings",
  login: "route.login",
  register: "route.register",
  "verify-email": "route.verifyEmail",
};

function localize(definitions: NavDefinition[]): NavItem[] {
  return definitions.map((item) => ({
    path: item.path,
    title: t(item.titleKey),
    icon: item.icon,
  }));
}

export class AppVM {
  @reactive accessor booting = true;
  @reactive accessor drawer = false;
  @reactive accessor menuOpen = false;

  constructor(
    private readonly session: Session,
    private readonly router: Router,
    private readonly theme: ThemeStore,
    private readonly toastStore: ToastStore,
  ) {}

  async created(): Promise<void> {
    await this.session.init();
    this.booting = false;
    this.guard();
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
  get routeName(): string {
    return this.router.match.route.name;
  }

  @computed
  get params(): Record<string, string> {
    return this.router.params;
  }

  @computed
  get title(): string {
    const key = ROUTE_TITLES[this.routeName];
    return key ? t(key) : this.router.title;
  }

  @computed
  get showShell(): boolean {
    return this.authenticated && !this.router.match.route.public;
  }

  @computed
  get nav(): NavItem[] {
    return localize(this.isAdmin ? MANAGEMENT : MANAGEMENT.filter((item) => !["/nodes", "/groups", "/import"].includes(item.path)));
  }

  @computed
  get accountNav(): NavItem[] {
    return localize(this.isAdmin ? ACCOUNT : ACCOUNT.filter((item) => item.path === "/profile" || item.path === "/stats"));
  }

  @computed
  get mobileNav(): NavItem[] {
    return localize(MOBILE_NAV.filter((item) => this.isAdmin || !["/nodes"].includes(item.path)));
  }

  @computed
  get userInitial(): string {
    return initials(this.user?.login ?? "?");
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
    return this.user?.login ?? t("common.guest");
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
    this.drawer = false;
    this.router.navigate(path);
  }

  toggleDrawer(): void {
    this.drawer = !this.drawer;
  }

  toggleTheme(): void {
    this.theme.toggle();
  }

  setTheme(mode: ThemeMode): void {
    this.theme.set(mode);
  }

  async logout(): Promise<void> {
    await this.session.logout();
    this.router.replace("/login");
  }

  @watch((vm: AppVM) => vm.routeName)
  onRouteChange(): void {
    this.guard();
  }

  @watch((vm: AppVM) => vm.authenticated)
  onAuthChange(): void {
    this.guard();
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
    if (route.adminOnly && !this.session.isAdmin) {
      this.router.replace("/");
    }
  }
}
