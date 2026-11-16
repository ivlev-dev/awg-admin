import { reactive } from "@ivlev-dev/silent-core";

import type { Locale } from "./types";

export const DEFAULT_LOCALE: Locale = "ru";

const STORAGE_KEY = "awg.locale";

export function isLocale(value: unknown): value is Locale {
  return value === "ru" || value === "en";
}

export function readStoredLocale(): Locale {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isLocale(value) ? value : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export class I18nStore {
  @reactive accessor current: Locale = readStoredLocale();

  constructor() {
    applyDocumentLang(this.current);
  }

  get locale(): Locale {
    return this.current;
  }

  set(locale: Locale): void {
    this.current = locale;
    persist(locale);
    applyDocumentLang(locale);
  }
}

export const i18n = new I18nStore();

function persist(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    return;
  }
}

function applyDocumentLang(locale: Locale): void {
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
}
