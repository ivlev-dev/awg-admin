import { createComponent, lazy } from "@ivlev-dev/silent-core";

import { loadPage, PAGE_LOADERS, type PageLoader } from "@/app/page-loaders";
import { prefetchPath } from "@/app/prefetch";

const loaders = PAGE_LOADERS as unknown as Record<"clients" | "login" | "stats", PageLoader>;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("prefetch chunk cache", () => {
  it("lets lazy reuse a chunk loaded by prefetch without a second import", async () => {
    const loader = vi.fn<PageLoader>(async () => ({ default: () => document.createElement("div") }));
    const original = loaders.stats;
    loaders.stats = loader;

    try {
      await prefetchPath("/stats");
      const Stats = lazy(() => loadPage("stats"));

      const first = createComponent(Stats, {});
      await first.ready;
      first.dispose();

      const second = createComponent(Stats, {});
      await second.ready;
      second.dispose();

      expect(loader).toHaveBeenCalledTimes(1);
    } finally {
      loaders.stats = original;
    }
  });

  it("imports a chunk once for repeated hover and focus", async () => {
    const loader = vi.fn<PageLoader>(async () => ({ default: () => null }));
    const original = loaders.clients;
    loaders.clients = loader;

    try {
      await Promise.all([prefetchPath("/clients"), prefetchPath("/clients"), prefetchPath("/clients")]);
      await prefetchPath("/clients");

      expect(loader).toHaveBeenCalledTimes(1);
      expect(loadPage("clients")).toBe(loadPage("clients"));
    } finally {
      loaders.clients = original;
    }
  });

  it("does not touch the chunk of a public page", async () => {
    const loader = vi.fn<PageLoader>(async () => ({ default: () => null }));
    const original = loaders.login;
    loaders.login = loader;

    try {
      await prefetchPath("/login");
      await prefetchPath("/register");

      expect(loader).not.toHaveBeenCalled();
    } finally {
      loaders.login = original;
    }
  });
});
