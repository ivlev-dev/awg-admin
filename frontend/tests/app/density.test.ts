import { applyDensity, density, densityStorage, initDensity, setDensity } from "@/app/density";

class MemoryStorage {
  private readonly store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
  document.documentElement.removeAttribute("data-density");
  initDensity();
  setDensity("comfortable");
});

afterEach(() => {
  setDensity("comfortable");
  document.documentElement.removeAttribute("data-density");
  vi.unstubAllGlobals();
});

describe("density", () => {
  it("uses comfortable as the default value", () => {
    localStorage.clear();

    expect(densityStorage.read()).toBe("comfortable");
    expect(density()).toBe("comfortable");
  });

  it("stores and reads the selected density", () => {
    setDensity("compact");

    expect(density()).toBe("compact");
    expect(densityStorage.read()).toBe("compact");
  });

  it("falls back to the default for an invalid stored value", () => {
    localStorage.setItem(densityStorage.key, JSON.stringify("huge"));

    expect(densityStorage.read()).toBe("comfortable");
    expect(localStorage.getItem(densityStorage.key)).toBeNull();
  });

  it("applies the data-density attribute to the document root", () => {
    applyDensity("compact");
    expect(document.documentElement.getAttribute("data-density")).toBe("compact");

    applyDensity("comfortable");
    expect(document.documentElement.hasAttribute("data-density")).toBe(false);
  });

  it("updates the attribute when the density changes", () => {
    setDensity("compact");
    expect(document.documentElement.getAttribute("data-density")).toBe("compact");

    setDensity("comfortable");
    expect(document.documentElement.hasAttribute("data-density")).toBe(false);
  });
});
