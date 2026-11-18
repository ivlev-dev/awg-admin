import { vi } from "vitest";

import { LocalTokenStore } from "@/infrastructure/storage";

const THROWING_STORAGE = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("SecurityError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
  clear: () => {
    throw new Error("SecurityError");
  },
  key: () => {
    throw new Error("SecurityError");
  },
  get length(): number {
    throw new Error("SecurityError");
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LocalTokenStore without localStorage", () => {
  it("does not throw when the storage is unavailable", () => {
    vi.stubGlobal("localStorage", THROWING_STORAGE);
    const store = new LocalTokenStore();

    expect(() => store.set("access", "refresh")).not.toThrow();
    expect(store.access()).toBeNull();
    expect(store.refresh()).toBeNull();
    expect(() => store.clear()).not.toThrow();
  });

  it("increments the generation on every mutation", () => {
    vi.stubGlobal("localStorage", THROWING_STORAGE);
    const store = new LocalTokenStore();
    const initial = store.generation();

    store.set("access", "refresh");
    store.clear();

    expect(store.generation()).toBe(initial + 2);
  });
});
