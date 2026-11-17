import { createPageCache, isPublicPage, loadPage, PAGE_LOADERS, PAGE_NAMES, pageNameForPath, type PageLoader, type PageName } from "@/app/page-loaders";
import { ROUTES } from "@/app/router";

describe("PAGE_LOADERS", () => {
  it("covers every route except the not-found fallback", () => {
    const routeNames = ROUTES.map((route) => route.name).sort();
    expect([...PAGE_NAMES].sort()).toEqual(routeNames);
    expect(Object.keys(PAGE_LOADERS).sort()).toEqual(routeNames);
  });

  it("marks exactly the public routes as public pages", () => {
    for (const route of ROUTES) {
      expect(isPublicPage(route.name as PageName)).toBe(route.public === true);
    }
    expect(isPublicPage("login")).toBe(true);
    expect(isPublicPage("register")).toBe(true);
    expect(isPublicPage("verify-email")).toBe(true);
    expect(isPublicPage("forgot-password")).toBe(true);
    expect(isPublicPage("reset-password")).toBe(true);
    expect(isPublicPage("overview")).toBe(false);
    expect(isPublicPage("clients")).toBe(false);
  });

  it("maps paths to page names", () => {
    expect(pageNameForPath("/")).toBe("overview");
    expect(pageNameForPath("/clients")).toBe("clients");
    expect(pageNameForPath("/clients/42/")).toBe("client");
    expect(pageNameForPath("/groups/team")).toBe("group");
    expect(pageNameForPath("/login")).toBe("login");
    expect(pageNameForPath("/verify-email")).toBe("verify-email");
    expect(pageNameForPath("/forgot-password")).toBe("forgot-password");
    expect(pageNameForPath("/reset-password")).toBe("reset-password");
    expect(pageNameForPath("/missing/page")).toBeNull();
  });
});

describe("page cache", () => {
  it("requests a page import once and reuses the loaded chunk", async () => {
    const loader = vi.fn<PageLoader>(async () => ({ default: () => null }));
    const cache = createPageCache<"clients">({ clients: loader });

    const first = cache.load("clients");
    const second = cache.load("clients");

    expect(second).toBe(first);
    expect(cache.has("clients")).toBe(true);
    await first;
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cache.has("clients")).toBe(true);
  });

  it("retries after a failed import and exposes the rejection", async () => {
    const loader = vi
      .fn<PageLoader>()
      .mockRejectedValueOnce(new Error("chunk failed"))
      .mockResolvedValueOnce({ default: () => null });
    const cache = createPageCache<"clients">({ clients: loader });

    await expect(cache.load("clients")).rejects.toThrow("chunk failed");
    expect(cache.has("clients")).toBe(false);

    await expect(cache.load("clients")).resolves.toBeDefined();
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("reuses the same promise for the real overview chunk", async () => {
    const first = loadPage("overview");
    const second = loadPage("overview");

    expect(second).toBe(first);
    const module = await first;
    expect(typeof module.default).toBe("function");
  });
});
