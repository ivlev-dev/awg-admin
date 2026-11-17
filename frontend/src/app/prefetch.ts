import { isPublicPage, loadPage, pageNameForPath } from "@/app/page-loaders";

export const IDLE_PREFETCH_PATHS: readonly string[] = ["/clients", "/stats"];

const SLOW_EFFECTIVE_TYPES: ReadonlySet<string> = new Set(["slow-2g", "2g", "3g"]);

export interface PrefetchNetwork {
  readonly saveData?: boolean;
  readonly effectiveType?: string;
}

export interface IdlePrefetchOptions {
  readonly routes?: readonly string[];
  readonly network?: PrefetchNetwork | null;
  readonly timeout?: number;
  readonly fallbackDelay?: number;
}

export type CancelIdlePrefetch = () => void;

interface IdleCapableGlobal {
  readonly requestIdleCallback?: (callback: () => void, options?: { readonly timeout?: number }) => number;
  readonly cancelIdleCallback?: (handle: number) => void;
}

const noop = (): void => undefined;

function currentNetwork(): PrefetchNetwork | null {
  if (typeof navigator === "undefined") return null;
  const connection = (navigator as Navigator & { readonly connection?: PrefetchNetwork }).connection;
  return connection ?? null;
}

export function shouldSkipPrefetch(network: PrefetchNetwork | null | undefined): boolean {
  if (network === null || network === undefined) return false;
  if (network.saveData === true) return true;
  const effectiveType = network.effectiveType?.toLowerCase();
  return effectiveType !== undefined && SLOW_EFFECTIVE_TYPES.has(effectiveType);
}

export function prefetchPath(path: string): Promise<void> {
  const name = pageNameForPath(path);
  if (name === null || isPublicPage(name)) return Promise.resolve();
  return loadPage(name).then(noop, noop);
}

function scheduleOnIdle(run: () => void, timeout: number, fallbackDelay: number): CancelIdlePrefetch {
  const idle = globalThis as IdleCapableGlobal;
  if (typeof idle.requestIdleCallback === "function") {
    const handle = idle.requestIdleCallback(run, { timeout });
    return () => {
      idle.cancelIdleCallback?.(handle);
    };
  }
  const handle = globalThis.setTimeout(run, fallbackDelay);
  return () => {
    globalThis.clearTimeout(handle);
  };
}

export function scheduleIdlePrefetch(options: IdlePrefetchOptions = {}): CancelIdlePrefetch {
  const network = options.network === undefined ? currentNetwork() : options.network;
  if (shouldSkipPrefetch(network)) return noop;

  const routes = options.routes ?? IDLE_PREFETCH_PATHS;
  if (routes.length === 0) return noop;

  let active = true;
  const run = (): void => {
    if (!active) return;
    active = false;
    for (const path of routes) void prefetchPath(path);
  };

  const cancel = scheduleOnIdle(run, options.timeout ?? 2000, options.fallbackDelay ?? 200);
  return () => {
    active = false;
    cancel();
  };
}
