import { ru, type Dictionary, type TranslationKey } from "./ru";
import { DEFAULT_LOCALE, i18n, isLocale } from "./store";
import type { Locale, Params } from "./types";

export type { Dictionary, Locale, Params, TranslationKey };
export { DEFAULT_LOCALE, i18n, isLocale, ru };

export const LOCALES: readonly Locale[] = ["ru", "en"];

export interface LanguageOption {
  readonly value: Locale;
  readonly label: string;
}

export function languageOptions(): readonly LanguageOption[] {
  return [
    { value: "ru", label: t("language.ru") },
    { value: "en", label: t("language.en") },
  ];
}

const DICTIONARIES: Partial<Record<Locale, Dictionary>> = { ru };
const LAZY_LOADERS: Partial<Record<Locale, () => Promise<Dictionary>>> = {
  en: () => import("./en").then((module) => module.en),
};

const pending: Partial<Record<Locale, Promise<void>>> = {};

export function hasDictionary(next: Locale): boolean {
  return DICTIONARIES[next] !== undefined;
}

export function registerDictionary(next: Locale, dictionary: Dictionary): void {
  DICTIONARIES[next] = dictionary;
}

export function registerNamespace(next: Locale, keys: Partial<Dictionary>): void {
  const existing = DICTIONARIES[next];
  DICTIONARIES[next] = { ...(existing ?? ({} as Dictionary)), ...keys };
}

export function loadLocale(next: Locale): Promise<void> {
  if (DICTIONARIES[next] !== undefined) return Promise.resolve();
  const cached = pending[next];
  if (cached !== undefined) return cached;
  const loader = LAZY_LOADERS[next];
  if (loader === undefined) return Promise.resolve();
  const task = loader()
    .then((dictionary) => {
      DICTIONARIES[next] = dictionary;
    })
    .catch((error: unknown) => {
      console.error(`Failed to load locale "${next}"`, error);
    })
    .finally(() => {
      delete pending[next];
    });
  pending[next] = task;
  return task;
}

export function locale(): Locale {
  return i18n.current;
}

export function setLocale(next: Locale): void | Promise<void> {
  if (DICTIONARIES[next] !== undefined) {
    i18n.set(next);
    return;
  }
  return loadLocale(next).then(() => {
    if (DICTIONARIES[next] !== undefined) i18n.set(next);
  });
}

export function t(key: TranslationKey, params?: Params): string {
  const dictionary = DICTIONARIES[i18n.current];
  const template = dictionary?.[key] ?? ru[key] ?? key;
  return interpolate(template, params);
}

function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match: string, name: string): string => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
