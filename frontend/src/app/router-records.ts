import type { AnyComponent } from "@ivlev-dev/silent-core";
import type { RouteRecord } from "@ivlev-dev/silent-router";

import { ROUTES } from "./routes-def";

export type PageLoaderFn = (name: string) => Promise<{ readonly default: AnyComponent }>;

let pageLoader: PageLoaderFn | null = null;

export function setPageLoader(loader: PageLoaderFn): void {
  pageLoader = loader;
}

export const ROUTE_RECORDS: readonly RouteRecord[] = ROUTES.map((route) => ({
  path: route.path,
  name: route.name,
  load: async () => {
    if (pageLoader === null) throw new Error("page loader is not configured");
    return pageLoader(route.name);
  },
  meta: {
    title: route.title,
    public: route.public === true,
    adminOnly: route.adminOnly === true,
  },
}));
