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
  { name: "interfaces", path: "/interfaces", title: "Интерфейсы", adminOnly: true },
  { name: "groups", path: "/groups", title: "Группы", adminOnly: true },
  { name: "group", path: "/groups/:id", title: "Группа", adminOnly: true },
  { name: "clients", path: "/clients", title: "Клиенты" },
  { name: "client", path: "/clients/:id", title: "Устройство" },
  { name: "tariffs", path: "/tariffs", title: "Тарифы", adminOnly: true },
  { name: "users", path: "/users", title: "Пользователи", adminOnly: true },
  { name: "audit", path: "/audit", title: "Аудит", adminOnly: true },
  { name: "import", path: "/import", title: "Импорт", adminOnly: true },
  { name: "stats", path: "/stats", title: "Статистика" },
  { name: "profile", path: "/profile", title: "Профиль" },
  { name: "settings", path: "/settings", title: "Настройки", adminOnly: true },
  { name: "login", path: "/login", title: "Вход", public: true },
  { name: "register", path: "/register", title: "Регистрация", public: true },
  { name: "verify-email", path: "/verify-email", title: "Подтверждение почты", public: true },
  { name: "forgot-password", path: "/forgot-password", title: "Восстановление пароля", public: true },
  { name: "reset-password", path: "/reset-password", title: "Сброс пароля", public: true },
];

export const NOT_FOUND_ROUTE: RouteDef = {
  name: "not-found",
  path: "*",
  title: "Раздел не найден",
  public: true,
};

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
  return { route: NOT_FOUND_ROUTE, params: {} };
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

