import { computed, reactive } from "@ivlev-dev/silent-core";

export interface RouteDef {
  name: string;
  path: string;
  title: string;
  adminOnly?: boolean;
  public?: boolean;
}

export const ROUTES: RouteDef[] = [
  { name: "overview", path: "/", title: "Обзор" },
  { name: "nodes", path: "/nodes", title: "Ноды", adminOnly: true },
  { name: "interfaces", path: "/interfaces", title: "Интерфейсы" },
  { name: "groups", path: "/groups", title: "Группы", adminOnly: true },
  { name: "group", path: "/groups/:id", title: "Группа", adminOnly: true },
  { name: "clients", path: "/clients", title: "Клиенты" },
  { name: "client", path: "/clients/:id", title: "Устройство" },
  { name: "tariffs", path: "/tariffs", title: "Тарифы", adminOnly: true },
  { name: "users", path: "/users", title: "Пользователи", adminOnly: true },
  { name: "import", path: "/import", title: "Импорт", adminOnly: true },
  { name: "stats", path: "/stats", title: "Статистика" },
  { name: "profile", path: "/profile", title: "Профиль" },
  { name: "settings", path: "/settings", title: "Настройки", adminOnly: true },
  { name: "login", path: "/login", title: "Вход", public: true },
];

export interface Match {
  route: RouteDef;
  params: Record<string, string>;
}

export function matchRoute(path: string): Match {
  const clean = normalize(path);
  for (const route of ROUTES) {
    const params = matchPath(route.path, clean);
    if (params) return { route, params };
  }
  return { route: ROUTES[0]!, params: {} };
}

function matchPath(pattern: string, path: string): Record<string, string> | null {
  if (!pattern.includes(":")) {
    return pattern === path ? {} : null;
  }
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const expected = patternParts[i]!;
    const actual = pathParts[i]!;
    if (expected.startsWith(":")) {
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

export function normalize(path: string): string {
  if (!path || path === "/") return "/";
  const clean = path.replace(/\/+$/, "");
  return clean || "/";
}

export class Router {
  @reactive accessor path = normalize(window.location.pathname);
  @reactive accessor search = window.location.search;

  constructor() {
    window.addEventListener("popstate", () => {
      this.path = normalize(window.location.pathname);
      this.search = window.location.search;
    });
  }

  @computed
  get match(): Match {
    return matchRoute(this.path);
  }

  @computed
  get params(): Record<string, string> {
    return this.match.params;
  }

  @computed
  get title(): string {
    return this.match.route.title;
  }

  navigate(path: string, options: { replace?: boolean } = {}): void {
    const target = normalize(path);
    if (target === this.path) return;
    if (options.replace) {
      window.history.replaceState(null, "", target);
    } else {
      window.history.pushState(null, "", target);
    }
    this.path = target;
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  replace(path: string): void {
    this.navigate(path, { replace: true });
  }
}
