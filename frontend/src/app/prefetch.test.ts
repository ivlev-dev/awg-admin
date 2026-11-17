const pageLoaders = vi.hoisted(() => {
  const loadPage = vi.fn(async (_name: string) => ({ default: () => null }));
  const pageNameForPath = vi.fn((path: string): string | null => {
    const routes: Readonly<Record<string, string>> = {
      "/": "overview",
      "/clients": "clients",
      "/stats": "stats",
      "/login": "login",
      "/register": "register",
      "/verify-email": "verify-email",
      "/forgot-password": "forgot-password",
      "/reset-password": "reset-password",
    };
    return routes[path] ?? null;
  });
  const isPublicPage = vi.fn((name: string): boolean =>
    ["login", "register", "verify-email", "forgot-password", "reset-password"].includes(name));
  return { loadPage, pageNameForPath, isPublicPage };
});

vi.mock("@/app/page-loaders", () => pageLoaders);

import { prefetchPath, scheduleIdlePrefetch } from "./prefetch";

type IdleCallback = (callback: () => void, options?: { readonly timeout?: number }) => number;

beforeEach(() => {
  pageLoaders.loadPage.mockClear();
  pageLoaders.pageNameForPath.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("prefetchPath", () => {
  it("never prefetches public pages", async () => {
    await prefetchPath("/login");
    await prefetchPath("/register");
    await prefetchPath("/verify-email");
    await prefetchPath("/forgot-password");
    await prefetchPath("/reset-password");

    expect(pageLoaders.loadPage).not.toHaveBeenCalled();
  });

  it("ignores unknown paths", async () => {
    await prefetchPath("/missing");

    expect(pageLoaders.loadPage).not.toHaveBeenCalled();
  });

  it("swallows import errors", async () => {
    pageLoaders.loadPage.mockRejectedValueOnce(new Error("chunk failed"));

    await expect(prefetchPath("/stats")).resolves.toBeUndefined();
  });
});

describe("scheduleIdlePrefetch", () => {
  it("prefetches the likely routes when the browser is idle", () => {
    const idle = vi.fn<IdleCallback>((callback) => {
      callback();
      return 1;
    });
    vi.stubGlobal("requestIdleCallback", idle);
    vi.stubGlobal("cancelIdleCallback", vi.fn());

    const cancel = scheduleIdlePrefetch({ network: null });
    cancel();

    expect(idle).toHaveBeenCalledTimes(1);
    expect(pageLoaders.loadPage.mock.calls.map(([name]) => name)).toEqual(["clients", "stats"]);
  });

  it("skips prefetch on data saver and slow connections", () => {
    const idle = vi.fn<IdleCallback>(() => 1);
    vi.stubGlobal("requestIdleCallback", idle);

    scheduleIdlePrefetch({ network: { saveData: true } });
    scheduleIdlePrefetch({ network: { effectiveType: "2g" } });
    scheduleIdlePrefetch({ network: { effectiveType: "3G" } });

    expect(idle).not.toHaveBeenCalled();
    expect(pageLoaders.loadPage).not.toHaveBeenCalled();
  });

  it("allows prefetch on fast connections", () => {
    const idle = vi.fn<IdleCallback>((callback) => {
      callback();
      return 1;
    });
    vi.stubGlobal("requestIdleCallback", idle);

    scheduleIdlePrefetch({ network: { effectiveType: "4g", saveData: false } });

    expect(pageLoaders.loadPage).toHaveBeenCalledTimes(2);
  });

  it("falls back to a timeout without requestIdleCallback", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);

    const cancel = scheduleIdlePrefetch({ network: null, fallbackDelay: 200 });
    expect(pageLoaders.loadPage).not.toHaveBeenCalled();

    vi.advanceTimersByTime(199);
    expect(pageLoaders.loadPage).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(pageLoaders.loadPage).toHaveBeenCalledTimes(2);
    cancel();
  });

  it("does not prefetch public pages during idle work", () => {
    const idle = vi.fn<IdleCallback>((callback) => {
      callback();
      return 1;
    });
    vi.stubGlobal("requestIdleCallback", idle);

    scheduleIdlePrefetch({ network: null, routes: ["/login", "/register", "/verify-email", "/forgot-password", "/reset-password"] });

    expect(pageLoaders.loadPage).not.toHaveBeenCalled();
  });

  it("cancels a scheduled fallback", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);

    const cancel = scheduleIdlePrefetch({ network: null, fallbackDelay: 200 });
    cancel();
    vi.advanceTimersByTime(500);

    expect(pageLoaders.loadPage).not.toHaveBeenCalled();
  });
});
