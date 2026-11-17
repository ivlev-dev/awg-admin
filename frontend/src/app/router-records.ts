import type { AnyComponent } from "@ivlev-dev/silent-core";
import type { RouteRecord } from "@ivlev-dev/silent-router";

import { ROUTES } from "./routes-def";

export type PageLoaderFn = (name: string) => Promise<{ readonly default: AnyComponent }>;

let pageLoader: PageLoaderFn | null = null;

export function setPageLoader(loader: PageLoaderFn): void {
  pageLoader = loader;
}

export function loadRoutePage(name: string | undefined): Promise<{ readonly default: AnyComponent }> {
  if (name === undefined) {
    return Promise.reject(new Error("route without a page name"));
  }
  if (pageLoader === null) {
    return Promise.reject(new Error("page loader is not configured"));
  }
  return pageLoader(name);
}

export const ROUTE_RECORDS: readonly RouteRecord[] = ROUTES.map((route) => ({
  path: route.path,
  name: route.name,
  meta: {
    title: route.title,
    public: route.public === true,
    adminOnly: route.adminOnly === true,
  },
}));
