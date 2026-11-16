import { en } from "./en";
import { ru, type Dictionary, type TranslationKey } from "./ru";
import { DEFAULT_LOCALE, i18n, isLocale } from "./store";
import type { Locale, Params } from "./types";

export type { Dictionary, Locale, Params, TranslationKey };
export { DEFAULT_LOCALE, en, i18n, isLocale, ru };

export const LOCALES: readonly Locale[] = ["ru", "en"];

export interface LanguageOption {
  readonly value: Locale;
  readonly label: string;
}

export const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  { value: "ru", label: "Русский" },
  { value: "en", label: "English" },
];

const DICTIONARIES: Record<Locale, Readonly<Dictionary>> = { ru, en };

export function locale(): Locale {
  return i18n.current;
}

export function setLocale(next: Locale): void {
  i18n.set(next);
}

export function t(key: TranslationKey, params?: Params): string {
  return interpolate(DICTIONARIES[i18n.current][key], params);
}

function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match: string, name: string): string => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
