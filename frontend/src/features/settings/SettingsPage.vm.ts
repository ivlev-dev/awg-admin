import { computed, reactive } from "@ivlev-dev/silent-core";

import { ToastStore } from "@/app/toast";
import type { SettingsService } from "../../application/settings/service";
import type { ObfuscationSettings, Settings } from "@/domain/types";

export type ObfuscationProfile = ObfuscationSettings["profile"];
export type ObfuscationIntensity = ObfuscationSettings["intensity"];
export type ObfuscationBrowser = ObfuscationSettings["browser"];

export interface Choice<T extends string> {
  value: T;
  label: string;
  description: string;
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

const PROFILE_OPTIONS: Choice<ObfuscationProfile>[] = [
  { value: "http3", label: "HTTP/3", description: "Маскировка первых пакетов под QUIC-обмен HTTP/3." },
  { value: "tls", label: "TLS", description: "Имитация TLS ClientHello с браузерными расширениями." },
  { value: "quic", label: "QUIC", description: "QUIC Initial-пакеты без HTTP/3-обвязки." },
  { value: "random", label: "Случайный", description: "Профиль выбирается случайно для каждого интерфейса." },
];

const INTENSITY_OPTIONS: Choice<ObfuscationIntensity>[] = [
  { value: "low", label: "Низкая", description: "Минимум junk-пакетов: ниже нагрузка, слабее маскировка." },
  { value: "medium", label: "Средняя", description: "Баланс между нагрузкой и устойчивостью к анализу." },
  { value: "high", label: "Высокая", description: "Высокий Jc: больше junk-пакетов перед рукопожатием." },
];

const BROWSER_OPTIONS: Choice<ObfuscationBrowser>[] = [
  { value: "chrome", label: "Chrome", description: "Размеры пакетов выравниваются под Chrome." },
  { value: "firefox", label: "Firefox", description: "Размеры пакетов выравниваются под Firefox." },
  { value: "safari", label: "Safari", description: "Размеры пакетов выравниваются под Safari." },
  { value: "edge", label: "Edge", description: "Размеры пакетов выравниваются под Edge." },
  { value: "random", label: "Случайный", description: "Браузер выбирается случайно для каждого соединения." },
];

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

  created(): void {
    void this.load();
  }

  @computed
  get profileOptions(): Choice<ObfuscationProfile>[] {
    return PROFILE_OPTIONS;
  }

  @computed
  get intensityOptions(): Choice<ObfuscationIntensity>[] {
    return INTENSITY_OPTIONS;
  }

  @computed
  get browserOptions(): Choice<ObfuscationBrowser>[] {
    return BROWSER_OPTIONS;
  }

  @computed
  get profileHint(): string {
    return PROFILE_OPTIONS.find((option) => option.value === this.profile)?.description ?? "";
  }

  @computed
  get intensityHint(): string {
    return INTENSITY_OPTIONS.find((option) => option.value === this.intensity)?.description ?? "";
  }

  @computed
  get browserHint(): string {
    return BROWSER_OPTIONS.find((option) => option.value === this.browser)?.description ?? "";
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
    return this.loaded && !this.loading && !this.saving;
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const settings = await this.settingsService.getSettings();
      this.apply(settings);
      this.loaded = true;
    } catch (error) {
      this.loaded = false;
      this.error = messageOf(error, "Не удалось загрузить настройки");
      this.toasts.error(this.error);
    } finally {
      this.loading = false;
    }
  }

  async save(event?: Event): Promise<void> {
    event?.preventDefault();
    if (!this.canSave) return;
    this.saving = true;
    try {
      const settings = await this.settingsService.updateSettings(this.buildInput());
      this.apply(settings);
      this.toasts.success("Настройки сохранены");
    } catch (error) {
      this.toasts.error(messageOf(error, "Не удалось сохранить настройки"));
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
