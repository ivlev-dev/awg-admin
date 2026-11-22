import {
  Custom,
  Field,
  Form,
  IsIn,
  Label,
  Max,
  Min,
  Optional,
} from "@ivlev-dev/silent-form";

import type { ObfuscationSettings, Settings } from "@/domain/types";
import { t } from "@/i18n";

export type ObfuscationProfile = ObfuscationSettings["profile"];
export type ObfuscationIntensity = ObfuscationSettings["intensity"];
export type ObfuscationBrowser = ObfuscationSettings["browser"];

export const PROFILE_VALUES: readonly ObfuscationProfile[] = [
  "http3",
  "tls",
  "quic",
  "random",
];

export const INTENSITY_VALUES: readonly ObfuscationIntensity[] = [
  "low",
  "medium",
  "high",
];

export const BROWSER_VALUES: readonly ObfuscationBrowser[] = [
  "chrome",
  "firefox",
  "safari",
  "edge",
  "random",
];

export const S_PADDING_FLOOR = 12;

const HOST_MAX_LENGTH = 253;

/** Хосты — необязательный многострочный список без пробелов внутри строки. */
export function hostsValid(value: unknown): boolean {
  return String(value ?? "")
    .split("\n")
    .every((line) => {
      const host = line.trim();
      return host.length === 0 || (host.length <= HOST_MAX_LENGTH && !/\s/.test(host));
    });
}

export function hoursFromSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return 0;
  return Math.round((seconds / 3600) * 100) / 100;
}

export class SettingsForm extends Form {
  @Field()
  @IsIn(PROFILE_VALUES, { message: () => t("settings.field.profile") })
  public accessor profile: ObfuscationProfile = "http3";

  @Field()
  @IsIn(INTENSITY_VALUES, { message: () => t("settings.field.intensity") })
  public accessor intensity: ObfuscationIntensity = "medium";

  @Field()
  @IsIn(BROWSER_VALUES, { message: () => t("settings.field.browser") })
  public accessor browser: ObfuscationBrowser = "random";

  @Field()
  @Label(t("settings.field.mtu"))
  @Min(576)
  @Max(9000)
  public accessor mtu: number = 1280;

  @Field()
  @Label(t("settings.field.jcMinAria"))
  @Min(1)
  @Max(128)
  public accessor jcMin: number = 3;

  @Field()
  @Label(t("settings.field.jcMaxAria"))
  @Min(1)
  @Max(128)
  public accessor jcMax: number = 10;

  @Field()
  @Label(t("settings.field.jminMinAria"))
  @Min(0)
  @Max(1280)
  public accessor jminMin: number = 50;

  @Field()
  @Label(t("settings.field.jminMaxAria"))
  @Min(0)
  @Max(1280)
  public accessor jminMax: number = 200;

  @Field()
  @Label(t("settings.field.jmaxExtraMinAria"))
  @Min(0)
  @Max(1280)
  public accessor jmaxExtraMin: number = 0;

  @Field()
  @Label(t("settings.field.jmaxExtraMaxAria"))
  @Min(0)
  @Max(1280)
  public accessor jmaxExtraMax: number = 100;

  @Field()
  @Label(t("settings.field.sMinAria"))
  @Min(S_PADDING_FLOOR)
  @Max(128)
  public accessor sMin: number = S_PADDING_FLOOR;

  @Field()
  @Label(t("settings.field.sMaxAria"))
  @Min(S_PADDING_FLOOR)
  @Max(128)
  public accessor sMax: number = 64;

  @Field()
  @Label(t("settings.field.keepaliveMinAria"))
  @Min(1)
  @Max(120)
  public accessor keepaliveMin: number = 15;

  @Field()
  @Label(t("settings.field.keepaliveMaxAria"))
  @Min(1)
  @Max(120)
  public accessor keepaliveMax: number = 25;

  @Field()
  @Label(t("settings.field.randomTrailers"))
  public accessor randomTrailers: boolean = true;

  @Field()
  @Label(t("settings.field.disableCookies"))
  public accessor disableCookies: boolean = false;

  @Field()
  @Label(t("settings.field.hosts"))
  @Optional()
  @Custom((value) => hostsValid(value))
  public accessor hosts: string = "";

  @Field()
  @Label(t("settings.links.ttl"))
  @Min(0)
  @Max(8760)
  public accessor ttlHours: number = 24;

  constructor() {
    super({ formId: "settings", validateOnInput: true });
  }

  static from(settings: Settings): SettingsForm {
    const form = new SettingsForm();
    form.apply(settings);
    return form;
  }

  apply(settings: Settings): void {
    const obf = settings.obfuscation;
    this.profile = obf.profile;
    this.intensity = obf.intensity;
    this.browser = obf.browser;
    this.mtu = obf.mtu;
    this.jcMin = obf.jc_min;
    this.jcMax = obf.jc_max;
    this.jminMin = obf.jmin_min;
    this.jminMax = obf.jmin_max;
    this.jmaxExtraMin = obf.jmax_extra_min;
    this.jmaxExtraMax = obf.jmax_extra_max;
    this.sMin = obf.s_min;
    this.sMax = obf.s_max;
    this.randomTrailers = obf.random_trailers;
    this.disableCookies = obf.disable_cookies;
    this.keepaliveMin = obf.keepalive_min;
    this.keepaliveMax = obf.keepalive_max;
    this.hosts = obf.hosts.join("\n");
    this.ttlHours = hoursFromSeconds(settings.share_default_ttl_secs);
  }
}
