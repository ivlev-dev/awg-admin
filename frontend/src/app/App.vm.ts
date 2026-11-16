import { computed, reactive, watch } from "@ivlev-dev/silent-core";

import { Router } from "@/app/router";
import { Session } from "@/app/session";
import { ThemeStore, type ThemeMode } from "@/app/theme";
import { ToastStore } from "@/app/toast";
import { initials } from "@/domain/format";
import type { IconName } from "@/components/Icon";

export interface NavItem {
  path: string;
  title: string;
  icon: IconName;
}

const MANAGEMENT: NavItem[] = [
  { path: "/", title: "Обзор", icon: "overview" },
  { path: "/nodes", title: "Ноды", icon: "nodes" },
  { path: "/interfaces", title: "Интерфейсы", icon: "interfaces" },
  { path: "/groups", title: "Группы", icon: "groups" },
  { path: "/clients", title: "Клиенты", icon: "clients" },
  { path: "/import", title: "Импорт", icon: "import" },
];

const ACCOUNT: NavItem[] = [
  { path: "/tariffs", title: "Тарифы", icon: "tariffs" },
  { path: "/users", title: "Пользователи", icon: "users" },
  { path: "/stats", title: "Статистика", icon: "stats" },
  { path: "/settings", title: "Настройки", icon: "settings" },
  { path: "/profile", title: "Профиль", icon: "profile" },
];

export const MOBILE_NAV: NavItem[] = [
  { path: "/", title: "Обзор", icon: "overview" },
  { path: "/clients", title: "Клиенты", icon: "clients" },
  { path: "/interfaces", title: "Интерфейсы", icon: "interfaces" },
  { path: "/stats", title: "Статистика", icon: "stats" },
  { path: "/profile", title: "Профиль", icon: "profile" },
];

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
    return this.router.title;
  }

  @computed
  get showShell(): boolean {
    return this.authenticated && this.routeName !== "login";
  }

  @computed
  get nav(): NavItem[] {
    return this.isAdmin ? MANAGEMENT : MANAGEMENT.filter((item) => !["/nodes", "/groups", "/import"].includes(item.path));
  }

  @computed
  get accountNav(): NavItem[] {
    return this.isAdmin ? ACCOUNT : ACCOUNT.filter((item) => item.path === "/profile" || item.path === "/stats");
  }

  @computed
  get mobileNav(): NavItem[] {
    return MOBILE_NAV.filter((item) => this.isAdmin || !["/nodes"].includes(item.path));
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
    return this.user?.login ?? "Гость";
  }

  @computed
  get roleLabel(): string {
    return this.isAdmin ? "Администратор" : "Пользователь";
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
