import { en } from "@/i18n/en";
import { ru } from "@/i18n/ru";
import {
  DEFAULT_LOCALE,
  LANGUAGE_OPTIONS,
  LOCALES,
  isLocale,
  locale,
  setLocale,
  t,
} from "@/i18n/index";
import { formatBytesI18n, formatDateI18n, pluralI18n } from "@/i18n/format";
import { readStoredLocale } from "@/i18n/store";

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
  setLocale("ru");
  document.documentElement.lang = "ru";
});

afterEach(() => {
  setLocale("ru");
  document.documentElement.removeAttribute("lang");
  vi.unstubAllGlobals();
});

describe("i18n dictionaries", () => {
  it("ru и en содержат одинаковый набор ключей", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ru).sort());
  });

  it("не содержит пустых переводов", () => {
    for (const value of Object.values(ru)) expect(value.trim().length).toBeGreaterThan(0);
    for (const value of Object.values(en)) expect(value.trim().length).toBeGreaterThan(0);
  });

  it("по умолчанию использует русскую локаль", () => {
    expect(DEFAULT_LOCALE).toBe("ru");
    expect(locale()).toBe("ru");
    expect(t("nav.overview")).toBe("Обзор");
    expect(t("auth.login.title")).toBe("Вход в систему");
  });
});

describe("t", () => {
  it("переключает перевод при смене локали", () => {
    setLocale("en");

    expect(locale()).toBe("en");
    expect(t("nav.overview")).toBe("Overview");
    expect(t("auth.login.title")).toBe("Sign in");
  });

  it("подставляет строковые и числовые параметры", () => {
    expect(t("quota.period", { period: "01.11 — 01.12" })).toBe("Период: 01.11 — 01.12");
    expect(t("overview.activity.slices", { count: 3 })).toBe("3 срезов");
    expect(t("overview.stats.nodesOnline", { online: 2, total: 5 })).toBe("2 из 5 нод онлайн");

    setLocale("en");

    expect(t("overview.stats.nodesOnline", { online: 2, total: 5 })).toBe("2 of 5 nodes online");
  });

  it("оставляет плейсхолдер, если параметр не передан", () => {
    expect(t("app.error.section", {})).toBe("Не удалось загрузить раздел «{title}».");
    expect(t("app.error.section", { title: "Обзор" })).toBe("Не удалось загрузить раздел «Обзор».");
  });
});

describe("setLocale", () => {
  it("сохраняет локаль в localStorage и обновляет lang документа", () => {
    setLocale("en");

    expect(localStorage.getItem("awg.locale")).toBe("en");
    expect(document.documentElement.lang).toBe("en");

    setLocale("ru");

    expect(localStorage.getItem("awg.locale")).toBe("ru");
    expect(document.documentElement.lang).toBe("ru");
  });

  it("читает сохранённую локаль и игнорирует неизвестные значения", () => {
    localStorage.setItem("awg.locale", "en");
    expect(readStoredLocale()).toBe("en");

    localStorage.setItem("awg.locale", "de");
    expect(readStoredLocale()).toBe("ru");

    localStorage.removeItem("awg.locale");
    expect(readStoredLocale()).toBe("ru");
  });
});

describe("locale helpers", () => {
  it("валидирует и перечисляет локали", () => {
    expect(isLocale("ru")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(LOCALES).toEqual(["ru", "en"]);
    expect(LANGUAGE_OPTIONS.map((option) => option.label)).toEqual(["Русский", "English"]);
  });

  it("склоняет подписи по правилам языка", () => {
    expect(pluralI18n(1, "common.peers.one", "common.peers.few", "common.peers.many")).toBe("пир");
    expect(pluralI18n(3, "common.peers.one", "common.peers.few", "common.peers.many")).toBe("пира");
    expect(pluralI18n(11, "common.peers.one", "common.peers.few", "common.peers.many")).toBe("пиров");
    expect(pluralI18n(21, "common.interfaces.one", "common.interfaces.few", "common.interfaces.many")).toBe("интерфейс");

    setLocale("en");

    expect(pluralI18n(1, "common.peers.one", "common.peers.few", "common.peers.many")).toBe("peer");
    expect(pluralI18n(2, "common.peers.one", "common.peers.few", "common.peers.many")).toBe("peers");
  });

  it("форматирует байты и даты под текущую локаль", () => {
    expect(formatBytesI18n(1024)).toBe("1.0 КБ");
    expect(formatBytesI18n(0)).toBe("0 B");

    setLocale("en");

    expect(formatBytesI18n(1024)).toBe("1.0 KB");
    expect(formatBytesI18n(0)).toBe("0 B");
    expect(formatDateI18n("2020-01-01T00:00:00Z")).toBe(
      new Date("2020-01-01T00:00:00Z").toLocaleDateString("en-US"),
    );
  });
});
