import { ViewModel, computed, reactive } from "@ivlev-dev/silent-core";
import { beforeUnloadGuard, onDirtyChange } from "@ivlev-dev/silent-form";

import { askConfirm } from "@/app/confirm";
import { density, setDensity, type TableDensity } from "@/app/density";
import { ToastStore } from "@/app/toast";
import { registerUnsaved, unregisterUnsaved } from "@/app/unsaved";
import type { SettingsService } from "@/application/settings/service";
import { userMessage } from "@/application/errors";
import type { Settings } from "@/domain/types";
import {
  languageOptions,
  isLocale,
  locale,
  setLocale,
  t,
  type LanguageOption,
  type Locale,
  type TranslationKey,
} from "@/i18n";

import {
  BROWSER_VALUES,
  INTENSITY_VALUES,
  PROFILE_VALUES,
  S_PADDING_FLOOR,
  SettingsForm,
  type ObfuscationBrowser,
  type ObfuscationIntensity,
  type ObfuscationProfile,
} from "./settings.form";

export type {
  ObfuscationBrowser,
  ObfuscationIntensity,
  ObfuscationProfile,
} from "./settings.form";

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
  | "sMax"
  | "keepaliveMin"
  | "keepaliveMax";

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

export class SettingsPageVM extends ViewModel {
  @reactive accessor form: SettingsForm = new SettingsForm();
  @reactive private accessor formDirty = false;

  private stopDirty: (() => void) | null = null;
  private stopGuard: (() => void) | null = null;

  constructor(
    private readonly settingsService: SettingsService,
    private readonly toasts: ToastStore,
  ) {
    super();
    this.bindForm(this.form);
  }

  @reactive accessor loading = true;
  @reactive accessor loaded = false;
  @reactive accessor saving = false;
  @reactive accessor error: string | null = null;

  override created(): void {
    registerUnsaved("settings", () => this.dirty);
    void this.load();
  }

  override unmounted(): void {
    this.releaseForm();
  }

  override dispose(): void {
    this.releaseForm();
    super.dispose();
  }

  private releaseForm(): void {
    this.stopDirty?.();
    this.stopGuard?.();
    this.stopDirty = null;
    this.stopGuard = null;
    this.form.dispose();
    unregisterUnsaved("settings");
  }

  private bindForm(form: SettingsForm): void {
    this.stopDirty?.();
    this.stopGuard?.();
    this.form = form;
    this.formDirty = form.isDirty;
    this.stopDirty = onDirtyChange(form, (dirty) => {
      this.formDirty = dirty;
    });
    this.stopGuard = beforeUnloadGuard(form);
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
    return describeChoice(PROFILE_OPTIONS, this.form.profile);
  }

  @computed
  get intensityHint(): string {
    return describeChoice(INTENSITY_OPTIONS, this.form.intensity);
  }

  @computed
  get browserHint(): string {
    return describeChoice(BROWSER_OPTIONS, this.form.browser);
  }

  @computed
  get language(): Locale {
    return locale();
  }

  get languageOptions(): readonly LanguageOption[] {
    return languageOptions();
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
    return parseHosts(this.form.hosts).length;
  }

  @computed
  get ttlSeconds(): number {
    const hours = Number(this.form.ttlHours);
    return Number.isFinite(hours) ? Math.max(0, Math.round(hours * 3600)) : 0;
  }

  @computed
  get canSave(): boolean {
    return (
      this.loaded &&
      !this.loading &&
      !this.saving &&
      this.dirty &&
      this.form.isValid
    );
  }

  @computed
  get dirty(): boolean {
    return this.loaded && (this.form.isDirty || this.formDirty);
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const settings = await this.settingsService.getSettings();
      this.adopt(settings);
      this.loaded = true;
    } catch (error) {
      this.loaded = false;
      this.error = userMessage(error, t("settings.error.load"));
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
      if (!(await this.form.validate())) return;
      const settings = await this.settingsService.updateSettings(this.buildInput());
      this.adopt(settings);
      this.toasts.success(t("settings.saved"));
    } catch (error) {
      this.toasts.error(userMessage(error, t("settings.error.save")));
    } finally {
      this.saving = false;
    }
  }

  setProfile(value: string): void {
    if (isProfile(value)) {
      this.form.getFieldProps("profile").setValue(value);
    }
  }

  setIntensity(value: string): void {
    if (isIntensity(value)) {
      this.form.getFieldProps("intensity").setValue(value);
    }
  }

  setBrowser(value: string): void {
    if (isBrowser(value)) {
      this.form.getFieldProps("browser").setValue(value);
    }
  }

  setNumeric(field: NumericField, event: Event): void {
    this.form.getFieldProps(field).onInput(event);
  }

  setRandomTrailers(event: Event): void {
    this.form
      .getFieldProps("randomTrailers")
      .setValue((event.target as HTMLInputElement).checked);
  }

  setDisableCookies(event: Event): void {
    this.form
      .getFieldProps("disableCookies")
      .setValue((event.target as HTMLInputElement).checked);
  }

  setHosts(event: Event): void {
    this.form
      .getFieldProps("hosts")
      .setValue((event.target as HTMLTextAreaElement).value);
  }

  setTtlHours(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    const normalized = value.trim().replace(",", ".");
    const numeric = Number(normalized);
    const parsed = normalized === "" || !Number.isFinite(numeric) ? "" : numeric;
    this.form.getFieldProps("ttlHours").setValue(parsed as number);
  }

  private adopt(settings: Settings): void {
    const previous = this.form;
    const next = SettingsForm.from(settings);
    this.bindForm(next);
    previous.dispose();
  }

  private buildInput(): Partial<Settings> {
    const form = this.form;
    const jcMin = clamp(toNumber(form.jcMin, 3), 1, 128);
    const jcMax = clamp(toNumber(form.jcMax, 10), jcMin, 128);
    const jminMin = clamp(toNumber(form.jminMin, 50), 0, 1280);
    const jminMax = clamp(toNumber(form.jminMax, 200), jminMin, 1280);
    const jmaxExtraMin = clamp(toNumber(form.jmaxExtraMin, 0), 0, 1280);
    const jmaxExtraMax = clamp(toNumber(form.jmaxExtraMax, 100), jmaxExtraMin, 1280);
    const sMin = Math.max(S_PADDING_FLOOR, toNumber(form.sMin, S_PADDING_FLOOR));
    const sMax = Math.max(sMin, toNumber(form.sMax, 64));
    const keepaliveMin = clamp(toNumber(form.keepaliveMin, 15), 1, 120);
    const keepaliveMax = clamp(toNumber(form.keepaliveMax, 25), keepaliveMin, 120);

    return {
      obfuscation: {
        profile: form.profile,
        intensity: form.intensity,
        browser: form.browser,
        mtu: clamp(toNumber(form.mtu, 1280), 576, 9000),
        jc_min: jcMin,
        jc_max: jcMax,
        jmin_min: jminMin,
        jmin_max: jminMax,
        jmax_extra_min: jmaxExtraMin,
        jmax_extra_max: jmaxExtraMax,
        s_min: sMin,
        s_max: sMax,
        hosts: parseHosts(form.hosts),
        random_trailers: form.randomTrailers,
        disable_cookies: form.disableCookies,
        keepalive_min: keepaliveMin,
        keepalive_max: keepaliveMax,
      },
      share_default_ttl_secs: this.ttlSeconds,
    };
  }
}

function isProfile(value: string): value is ObfuscationProfile {
  return (PROFILE_VALUES as readonly string[]).includes(value);
}

function isIntensity(value: string): value is ObfuscationIntensity {
  return (INTENSITY_VALUES as readonly string[]).includes(value);
}

function isBrowser(value: string): value is ObfuscationBrowser {
  return (BROWSER_VALUES as readonly string[]).includes(value);
}

function toNumber(value: number | string, fallback: number): number {
  const parsed = toDecimal(String(value), fallback);
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
