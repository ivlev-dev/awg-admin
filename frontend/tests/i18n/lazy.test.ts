import type { Dictionary } from "@/i18n/ru";

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
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Ленивая загрузка локалей", () => {
  it("ru доступен сразу, en подгружается по смене языка", async () => {
    vi.resetModules();
    const i18n = await import("@/i18n");

    expect(i18n.locale()).toBe("ru");
    expect(i18n.t("nav.overview")).toBe("Обзор");

    const pending = i18n.setLocale("en");
    expect(pending).toBeInstanceOf(Promise);
    await pending;

    expect(i18n.locale()).toBe("en");
    expect(i18n.t("nav.overview")).toBe("Overview");
  });

  it("отсутствующий namespace не ломает старт и откатывается на ru", async () => {
    vi.resetModules();
    const i18n = await import("@/i18n");

    i18n.registerDictionary("en", { "nav.overview": "Overview" } as Dictionary);
    i18n.setLocale("en");

    expect(i18n.t("nav.overview")).toBe("Overview");
    expect(i18n.t("auth.login.title")).toBe("Вход в систему");
    expect(i18n.t("common.close")).toBe("Закрыть");
  });
});
