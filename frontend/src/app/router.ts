import type { Container } from "@ivlev-dev/silent-di";
import {
  Router as SilentRouter,
  type RouteLocation,
  type RouterComponentLoadContext,
  type RouterNavigationError,
} from "@ivlev-dev/silent-router";
import { computed, reactive } from "@ivlev-dev/silent-core";

import { loadRoutePage, ROUTE_RECORDS } from "./router-records";
import { matchRoute, normalize, type Match } from "./routes-def";

export { matchRoute, normalize, NOT_FOUND_ROUTE, ROUTES } from "./routes-def";
export type { Match, RouteDef } from "./routes-def";

export class Router {
  readonly core: SilentRouter;

  @reactive accessor path = normalize(window.location.pathname);
  @reactive accessor search = window.location.search;

  constructor(options: { readonly container?: Container; readonly onError?: (error: RouterNavigationError) => void } = {}) {
    this.core = new SilentRouter({
      routes: ROUTE_RECORDS,
      load: (context: RouterComponentLoadContext) => loadRoutePage(context.record.name),
      onError: (error: RouterNavigationError): void => {
        console.error(`Не удалось перейти на ${error.to || "маршрут"}`, error);
        options.onError?.(error);
      },
      ...(options.container === undefined ? {} : { container: options.container }),
    });
    window.addEventListener("popstate", this.onHistoryChange);
  }

  async start(): Promise<void> {
    try {
      await this.core.start();
    } catch {
      return;
    }
  }

  @computed
  get match(): Match {
    return matchRoute(this.path);
  }

  @computed
  get committedMatch(): Match {
    const route = this.core.route;
    return route === null ? this.match : matchRoute(route.fullPath);
  }

  @computed
  get params(): Record<string, string> {
    return this.resolve(this.path)?.params ?? this.match.params;
  }

  @computed
  get title(): string {
    return this.match.route.title;
  }

  navigate(path: string, options: { replace?: boolean } = {}): void {
    const target = normalize(path);
    if (target === this.path) return;
    this.path = target;
    this.search = window.location.search;
    void this.core.navigate(target, { replace: options.replace === true });
  }

  replace(path: string): void {
    this.navigate(path, { replace: true });
  }

  prefetch(path: string): Promise<void> {
    return this.core.prefetch(path);
  }

  hasRoute(path: string): boolean {
    return this.core.hasRoute(path);
  }

  private resolve(path: string): RouteLocation | null {
    try {
      return this.core.resolve(path);
    } catch {
      return null;
    }
  }

  private readonly onHistoryChange = (): void => {
    this.path = normalize(window.location.pathname);
    this.search = window.location.search;
  };
}
