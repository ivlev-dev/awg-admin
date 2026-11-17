import type { AnyComponent } from "@ivlev-dev/silent-core";

import { matchRoute, ROUTES } from "./routes-def";

export const PAGE_NAMES = [
  "overview",
  "nodes",
  "interfaces",
  "groups",
  "group",
  "clients",
  "client",
  "tariffs",
  "users",
  "audit",
  "import",
  "stats",
  "profile",
  "settings",
  "login",
  "register",
  "verify-email",
  "forgot-password",
  "reset-password",
] as const;

export type PageName = (typeof PAGE_NAMES)[number];

export interface PageModule {
  readonly default: AnyComponent;
}

export type PageLoader = () => Promise<PageModule>;

export const PAGE_LOADERS: Readonly<Record<PageName, PageLoader>> = {
  overview: () => import("@/features/overview/Overview").then((module) => ({ default: module.Overview })),
  nodes: () => import("@/features/nodes/NodesPage").then((module) => ({ default: module.NodesPage })),
  interfaces: () => import("@/features/interfaces/InterfacesPage").then((module) => ({ default: module.InterfacesPage })),
  groups: () => import("@/features/groups/GroupsPage").then((module) => ({ default: module.GroupsPage })),
  group: () => import("@/features/groups/GroupDetails").then((module) => ({ default: module.GroupDetails })),
  clients: () => import("@/features/clients/ClientsPage").then((module) => ({ default: module.ClientsPage })),
  client: () => import("@/features/clients/ClientDetails").then((module) => ({ default: module.ClientDetails })),
  tariffs: () => import("@/features/tariffs/TariffsPage").then((module) => ({ default: module.TariffsPage })),
  users: () => import("@/features/users/UsersPage").then((module) => ({ default: module.UsersPage })),
  audit: () => import("@/features/audit/AuditPage").then((module) => ({ default: module.AuditPage })),
  import: () => import("@/features/import/ImportPage").then((module) => ({ default: module.ImportPage })),
  stats: () => import("@/features/stats/StatsPage").then((module) => ({ default: module.StatsPage })),
  profile: () => import("@/features/profile/ProfilePage").then((module) => ({ default: module.ProfilePage })),
  settings: () => import("@/features/settings/SettingsPage").then((module) => ({ default: module.SettingsPage })),
  login: () => import("@/features/auth/Login").then((module) => ({ default: module.Login })),
  register: () => import("@/features/auth/Register").then((module) => ({ default: module.Register })),
  "verify-email": () => import("@/features/auth/VerifyEmail").then((module) => ({ default: module.VerifyEmail })),
  "forgot-password": () => import("@/features/auth/ForgotPassword").then((module) => ({ default: module.ForgotPassword })),
  "reset-password": () => import("@/features/auth/ResetPassword").then((module) => ({ default: module.ResetPassword })),
};

const PAGE_NAME_SET: ReadonlySet<string> = new Set(PAGE_NAMES);

export function isPageName(value: string): value is PageName {
  return PAGE_NAME_SET.has(value);
}

const PUBLIC_ROUTES: ReadonlySet<string> = new Set(
  ROUTES.filter((route) => route.public === true).map((route) => route.name),
);

export function isPublicPage(name: PageName): boolean {
  return PUBLIC_ROUTES.has(name);
}

export function pageNameForPath(path: string): PageName | null {
  const name = matchRoute(path).route.name;
  return isPageName(name) ? name : null;
}

export interface PageCache<K extends string> {
  load(name: K): Promise<PageModule>;
  has(name: K): boolean;
}

export function createPageCache<K extends string>(loaders: Readonly<Record<K, PageLoader>>): PageCache<K> {
  const cache = new Map<K, Promise<PageModule>>();

  const load = (name: K): Promise<PageModule> => {
    const existing = cache.get(name);
    if (existing !== undefined) return existing;

    const pending: Promise<PageModule> = Promise.resolve()
      .then(() => loaders[name]())
      .catch((error: unknown) => {
        if (cache.get(name) === pending) cache.delete(name);
        throw error;
      });

    cache.set(name, pending);
    return pending;
  };

  return {
    load,
    has: (name: K): boolean => cache.has(name),
  };
}

const pageCache = createPageCache(PAGE_LOADERS);

export function loadPage(name: PageName): Promise<PageModule> {
  return pageCache.load(name);
}

export function isPageLoaded(name: PageName): boolean {
  return pageCache.has(name);
}
