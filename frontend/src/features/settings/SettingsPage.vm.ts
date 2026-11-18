import { computed, reactive } from "@ivlev-dev/silent-core";

import { askConfirm } from "@/app/confirm";
import { density, setDensity, type TableDensity } from "@/app/density";
import { ToastStore } from "@/app/toast";
import type { SettingsService } from "@/application/settings/service";
import type { ObfuscationSettings, Settings } from "@/domain/types";
import {
  LANGUAGE_OPTIONS,
  isLocale,
  locale,
  setLocale,
  t,
  type LanguageOption,
  type Locale,
  type TranslationKey,
} from "@/i18n";

export type ObfuscationProfile = ObfuscationSettings["profile"];
export type ObfuscationIntensity = ObfuscationSettings["intensity"];
export type ObfuscationBrowser = ObfuscationSettings["browser"];

export interface Choice<T extends string> {
  value: T;
  label: string;
  description: string;
}

interface ChoiceDefinition<T extends string> {
  value: T;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
}

export type NumericField =
  | "mtu"
  | "jcMin"
  | "jcMax"
  | "jminMin"
  | "jminMax"
  | "jmaxExtraMin"
  | "jmaxExtraMax"
  | "sMin"
  | "sMax";

const S_FLOOR = 12;

interface DensityOptionDefinition {
  value: TableDensity;
  labelKey: TranslationKey;
}

const DENSITY_OPTIONS: DensityOptionDefinition[] = [
  { value: "comfortable", labelKey: "settings.interface.density.comfortable" },
  { value: "compact", labelKey: "settings.interface.density.compact" },
];

const PROFILE_OPTIONS: ChoiceDefinition<ObfuscationProfile>[] = [
  { value: "http3", labelKey: "settings.profile.http3.label", descriptionKey: "settings.profile.http3.description" },
  { value: "tls", labelKey: "settings.profile.tls.label", descriptionKey: "settings.profile.tls.description" },
  { value: "quic", labelKey: "settings.profile.quic.label", descriptionKey: "settings.profile.quic.description" },
  { value: "random", labelKey: "settings.profile.random.label", descriptionKey: "settings.profile.random.description" },
];

const INTENSITY_OPTIONS: ChoiceDefinition<ObfuscationIntensity>[] = [
  { value: "low", labelKey: "settings.intensity.low.label", descriptionKey: "settings.intensity.low.description" },
  { value: "medium", labelKey: "settings.intensity.medium.label", descriptionKey: "settings.intensity.medium.description" },
  { value: "high", labelKey: "settings.intensity.high.label", descriptionKey: "settings.intensity.high.description" },
];

const BROWSER_OPTIONS: ChoiceDefinition<ObfuscationBrowser>[] = [
  { value: "chrome", labelKey: "settings.browser.chrome.label", descriptionKey: "settings.browser.chrome.description" },
  { value: "firefox", labelKey: "settings.browser.firefox.label", descriptionKey: "settings.browser.firefox.description" },
  { value: "safari", labelKey: "settings.browser.safari.label", descriptionKey: "settings.browser.safari.description" },
  { value: "edge", labelKey: "settings.browser.edge.label", descriptionKey: "settings.browser.edge.description" },
  { value: "random", labelKey: "settings.browser.random.label", descriptionKey: "settings.browser.random.description" },
];

function localizeChoices<T extends string>(definitions: ChoiceDefinition<T>[]): Choice<T>[] {
  return definitions.map((definition) => ({
    value: definition.value,
    label: t(definition.labelKey),
    description: t(definition.descriptionKey),
  }));
}

function describeChoice<T extends string>(
  definitions: ChoiceDefinition<T>[],
  value: T,
): string {
  const definition = definitions.find((option) => option.value === value);
  return definition ? t(definition.descriptionKey) : "";
}

export class SettingsPageVM {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly toasts: ToastStore,
  ) {}

  @reactive accessor loading = true;
  @reactive accessor loaded = false;
  @reactive accessor saving = false;
  @reactive accessor error: string | null = null;

  @reactive accessor profile: ObfuscationProfile = "http3";
  @reactive accessor intensity: ObfuscationIntensity = "medium";
  @reactive accessor browser: ObfuscationBrowser = "random";
  @reactive accessor mtu = "1280";
  @reactive accessor jcMin = "3";
  @reactive accessor jcMax = "10";
  @reactive accessor jminMin = "50";
  @reactive accessor jminMax = "200";
  @reactive accessor jmaxExtraMin = "0";
  @reactive accessor jmaxExtraMax = "100";
  @reactive accessor sMin = "12";
  @reactive accessor sMax = "64";
  @reactive accessor randomTrailers = true;
  @reactive accessor disableCookies = false;
  @reactive accessor hosts = "";
  @reactive accessor ttlHours = "24";

  @reactive private accessor savedSnapshot = "";

  private readonly handleBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (!this.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  };

  created(): void {
    window.addEventListener("beforeunload", this.handleBeforeUnload);
    void this.load();
  }

  dispose(): void {
    window.removeEventListener("beforeunload", this.handleBeforeUnload);
  }

  @computed
  get profileOptions(): Choice<ObfuscationProfile>[] {
    return localizeChoices(PROFILE_OPTIONS);
  }

  @computed
  get intensityOptions(): Choice<ObfuscationIntensity>[] {
    return localizeChoices(INTENSITY_OPTIONS);
  }

  @computed
  get browserOptions(): Choice<ObfuscationBrowser>[] {
    return localizeChoices(BROWSER_OPTIONS);
  }

  @computed
  get profileHint(): string {
    return describeChoice(PROFILE_OPTIONS, this.profile);
  }

  @computed
  get intensityHint(): string {
    return describeChoice(INTENSITY_OPTIONS, this.intensity);
  }

  @computed
  get browserHint(): string {
    return describeChoice(BROWSER_OPTIONS, this.browser);
  }

  @computed
  get language(): Locale {
    return locale();
  }

  get languageOptions(): readonly LanguageOption[] {
    return LANGUAGE_OPTIONS;
  }

  isLanguage(value: Locale): boolean {
    return this.language === value;
  }

  setLanguage(value: string): void {
    if (isLocale(value)) setLocale(value);
  }

  @computed
  get tableDensity(): TableDensity {
    return density();
  }

  get densityOptions(): Choice<TableDensity>[] {
    return DENSITY_OPTIONS.map((option) => ({
      value: option.value,
      label: t(option.labelKey),
      description: "",
    }));
  }

  setTableDensity(value: string): void {
    if (value === "comfortable" || value === "compact") setDensity(value);
  }

  @computed
  get hostsCount(): number {
    return parseHosts(this.hosts).length;
  }

  @computed
  get ttlSeconds(): number {
    return Math.max(0, Math.round(toDecimal(this.ttlHours, 24) * 3600));
  }

  @computed
  get canSave(): boolean {
    return this.loaded && !this.loading && !this.saving && this.dirty;
  }

  @computed
  get dirty(): boolean {
    return this.loaded && this.snapshot() !== this.savedSnapshot;
  }

  snapshot(): string {
    return JSON.stringify([
      this.profile,
      this.intensity,
      this.browser,
      this.mtu,
      this.jcMin,
      this.jcMax,
      this.jminMin,
      this.jminMax,
      this.jmaxExtraMin,
      this.jmaxExtraMax,
      this.sMin,
      this.sMax,
      this.randomTrailers,
      this.disableCookies,
      this.hosts,
      this.ttlHours,
    ]);
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const settings = await this.settingsService.getSettings();
      this.apply(settings);
      this.loaded = true;
      this.savedSnapshot = this.snapshot();
    } catch (error) {
      this.loaded = false;
      this.error = messageOf(error, t("settings.error.load"));
      this.toasts.error(this.error);
    } finally {
      this.loading = false;
    }
  }

  async reset(): Promise<void> {
    if (this.dirty) {
      const confirmed = await askConfirm({
        title: t("settings.dirty.confirm.title"),
        message: t("settings.dirty.confirm.message"),
        confirmLabel: t("settings.dirty.confirm.action"),
        tone: "danger",
      });
      if (!confirmed) return;
    }
    await this.load();
  }

  async save(event?: Event): Promise<void> {
    event?.preventDefault();
    if (!this.canSave) return;
    this.saving = true;
    try {
      const settings = await this.settingsService.updateSettings(this.buildInput());
      this.apply(settings);
      this.savedSnapshot = this.snapshot();
      this.toasts.success(t("settings.saved"));
    } catch (error) {
      this.toasts.error(messageOf(error, t("settings.error.save")));
    } finally {
      this.saving = false;
    }
  }

  setProfile(value: string): void {
    if (value === "http3" || value === "tls" || value === "quic" || value === "random") {
      this.profile = value;
    }
  }

  setIntensity(value: string): void {
    if (value === "low" || value === "medium" || value === "high") {
      this.intensity = value;
    }
  }

  setBrowser(value: string): void {
    if (value === "chrome" || value === "firefox" || value === "safari" || value === "edge" || value === "random") {
      this.browser = value;
    }
  }

  setNumeric(field: NumericField, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    switch (field) {
      case "mtu":
        this.mtu = value;
        break;
      case "jcMin":
        this.jcMin = value;
        break;
      case "jcMax":
        this.jcMax = value;
        break;
      case "jminMin":
        this.jminMin = value;
        break;
      case "jminMax":
        this.jminMax = value;
        break;
      case "jmaxExtraMin":
        this.jmaxExtraMin = value;
        break;
      case "jmaxExtraMax":
        this.jmaxExtraMax = value;
        break;
      case "sMin":
        this.sMin = value;
        break;
      case "sMax":
        this.sMax = value;
        break;
    }
  }

  setRandomTrailers(event: Event): void {
    this.randomTrailers = (event.target as HTMLInputElement).checked;
  }

  setDisableCookies(event: Event): void {
    this.disableCookies = (event.target as HTMLInputElement).checked;
  }

  setHosts(event: Event): void {
    this.hosts = (event.target as HTMLTextAreaElement).value;
  }

  setTtlHours(event: Event): void {
    this.ttlHours = (event.target as HTMLInputElement).value;
  }

  private apply(settings: Settings): void {
    const obf = settings.obfuscation;
    this.profile = obf.profile;
    this.intensity = obf.intensity;
    this.browser = obf.browser;
    this.mtu = String(obf.mtu);
    this.jcMin = String(obf.jc_min);
    this.jcMax = String(obf.jc_max);
    this.jminMin = String(obf.jmin_min);
    this.jminMax = String(obf.jmin_max);
    this.jmaxExtraMin = String(obf.jmax_extra_min);
    this.jmaxExtraMax = String(obf.jmax_extra_max);
    this.sMin = String(obf.s_min);
    this.sMax = String(obf.s_max);
    this.randomTrailers = obf.random_trailers;
    this.disableCookies = obf.disable_cookies;
    this.hosts = obf.hosts.join("\n");
    this.ttlHours = formatHours(settings.share_default_ttl_secs);
  }

  private buildInput(): Partial<Settings> {
    const jcMin = clamp(toNumber(this.jcMin, 3), 1, 128);
    const jcMax = clamp(toNumber(this.jcMax, 10), jcMin, 128);
    const jminMin = clamp(toNumber(this.jminMin, 50), 0, 1280);
    const jminMax = clamp(toNumber(this.jminMax, 200), jminMin, 1280);
    const jmaxExtraMin = clamp(toNumber(this.jmaxExtraMin, 0), 0, 1280);
    const jmaxExtraMax = clamp(toNumber(this.jmaxExtraMax, 100), jmaxExtraMin, 1280);
    const sMin = Math.max(S_FLOOR, toNumber(this.sMin, S_FLOOR));
    const sMax = Math.max(sMin, toNumber(this.sMax, 64));

    return {
      obfuscation: {
        profile: this.profile,
        intensity: this.intensity,
        browser: this.browser,
        mtu: clamp(toNumber(this.mtu, 1280), 576, 9000),
        jc_min: jcMin,
        jc_max: jcMax,
        jmin_min: jminMin,
        jmin_max: jminMax,
        jmax_extra_min: jmaxExtraMin,
        jmax_extra_max: jmaxExtraMax,
        s_min: sMin,
        s_max: sMax,
        hosts: parseHosts(this.hosts),
        random_trailers: this.randomTrailers,
        disable_cookies: this.disableCookies,
      },
      share_default_ttl_secs: this.ttlSeconds,
    };
  }
}

function toNumber(value: string, fallback: number): number {
  const parsed = toDecimal(value, fallback);
  return Math.round(parsed);
}

function toDecimal(value: string, fallback: number): number {
  const normalized = value.trim().replace(",", ".");
  if (normalized === "") return fallback;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseHosts(value: string): string[] {
  const hosts: string[] = [];
  for (const line of value.split("\n")) {
    const host = line.trim();
    if (host.length > 0 && !hosts.includes(host)) {
      hosts.push(host);
    }
  }
  return hosts;
}

function formatHours(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0";
  return String(Math.round((seconds / 3600) * 100) / 100);
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}
