import { ThemeStore } from "@/app/theme";

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
}

function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches,
      media: "(prefers-color-scheme: dark)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
  const meta = document.createElement("meta");
  meta.setAttribute("name", "theme-color");
  meta.setAttribute("content", "#000000");
  document.head.appendChild(meta);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((node) => node.remove());
});

describe("ThemeStore", () => {
  it("в режиме system выставляет вычисленную тёмную тему", () => {
    stubMatchMedia(true);
    const theme = new ThemeStore();

    expect(theme.mode).toBe("system");
    expect(theme.effective).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe("#060c15");
  });

  it("в режиме system выставляет светлую тему при светлой системной схеме", () => {
    stubMatchMedia(false);
    const theme = new ThemeStore();

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe("#f2f5f9");
  });

  it("явная тема сохраняется и переживает смену системной схемы", () => {
    stubMatchMedia(true);
    const theme = new ThemeStore();
    theme.set("light");

    expect(localStorage.getItem("awg.theme")).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(theme.effective).toBe("light");
  });

  it("обновляет effective при смене системной схемы в режиме system", () => {
    const changeListeners: Array<(event: MediaQueryListEvent) => void> = [];
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        media: "(prefers-color-scheme: dark)",
        addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
          changeListeners.push(listener);
        }),
        removeEventListener: vi.fn(),
      })),
    );
    const theme = new ThemeStore();
    expect(theme.effective).toBe("dark");

    changeListeners[0]?.({ matches: false } as MediaQueryListEvent);

    expect(theme.systemDark).toBe(false);
    expect(theme.effective).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    theme.set("dark");
    changeListeners[0]?.({ matches: false } as MediaQueryListEvent);
    expect(theme.mode).toBe("dark");
    expect(theme.effective).toBe("dark");
    expect(localStorage.getItem("awg.theme")).toBe("dark");
  });
});
