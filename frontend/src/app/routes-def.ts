import type { TranslationKey } from "@/i18n";

export interface RouteDef {
  name: string;
  path: string;
  titleKey: TranslationKey;
  adminOnly?: boolean;
  public?: boolean;
}

export const ROUTES: RouteDef[] = [
  { name: "overview", path: "/", titleKey: "route.overview" },
  { name: "nodes", path: "/nodes", titleKey: "route.nodes", adminOnly: true },
  { name: "interfaces", path: "/interfaces", titleKey: "route.interfaces", adminOnly: true },
  { name: "groups", path: "/groups", titleKey: "route.groups", adminOnly: true },
  { name: "group", path: "/groups/:id", titleKey: "route.group", adminOnly: true },
  { name: "clients", path: "/clients", titleKey: "route.clients" },
  { name: "client", path: "/clients/:id", titleKey: "route.client" },
  { name: "tariffs", path: "/tariffs", titleKey: "route.tariffs", adminOnly: true },
  { name: "users", path: "/users", titleKey: "route.users", adminOnly: true },
  { name: "audit", path: "/audit", titleKey: "route.audit", adminOnly: true },
  { name: "import", path: "/import", titleKey: "route.import", adminOnly: true },
  { name: "stats", path: "/stats", titleKey: "route.stats" },
  { name: "profile", path: "/profile", titleKey: "route.profile" },
  { name: "settings", path: "/settings", titleKey: "route.settings", adminOnly: true },
  { name: "login", path: "/login", titleKey: "route.login", public: true },
  { name: "register", path: "/register", titleKey: "route.register", public: true },
  { name: "verify-email", path: "/verify-email", titleKey: "route.verifyEmail", public: true },
  { name: "forgot-password", path: "/forgot-password", titleKey: "auth.forgot.title", public: true },
  { name: "reset-password", path: "/reset-password", titleKey: "auth.reset.title", public: true },
];

export const NOT_FOUND_ROUTE: RouteDef = {
  name: "not-found",
  path: "*",
  titleKey: "route.notFound",
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

