import { Router as SilentRouter, type RouteLocation } from "@ivlev-dev/silent-router";
import { computed, reactive } from "@ivlev-dev/silent-core";

import { ROUTE_RECORDS } from "./router-records";
import { matchRoute, normalize, type Match } from "./routes-def";

export { matchRoute, normalize, NOT_FOUND_ROUTE, ROUTES } from "./routes-def";
export type { Match, RouteDef } from "./routes-def";

export class Router {
  readonly core: SilentRouter;

  @reactive accessor path = normalize(window.location.pathname);
  @reactive accessor search = window.location.search;

  constructor() {
    this.core = new SilentRouter({ routes: ROUTE_RECORDS });
    window.addEventListener("popstate", this.onHistoryChange);
    void this.core.start();
  }

  @computed
  get match(): Match {
    return matchRoute(this.path);
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
    if (options.replace) {
      void this.core.replace(target);
    } else {
      void this.core.push(target);
    }
  }

  replace(path: string): void {
    this.navigate(path, { replace: true });
  }

  prefetch(path: string): Promise<void> {
    return this.core.prefetch(path);
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
