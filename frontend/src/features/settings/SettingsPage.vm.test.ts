import { createAppContainer } from "@/app/di";
import { ToastStore } from "@/app/toast";
import { ValidationError } from "@/application/errors";
import { DefaultSettingsService } from "@/application/settings/service";
import type { SettingsRepository } from "@/domain/settings/repository";
import type { ObfuscationSettings, Settings } from "@/domain/types";
import { SettingsPageVM } from "./SettingsPage.vm";

const SETTINGS: Settings = {
  obfuscation: {
    profile: "tls",
    intensity: "high",
    browser: "firefox",
    mtu: 1420,
    jc_min: 4,
    jc_max: 12,
    jmin_min: 60,
    jmin_max: 240,
    jmax_extra_min: 5,
    jmax_extra_max: 120,
    s_min: 16,
    s_max: 72,
    hosts: ["example.com", "google.com"],
    random_trailers: true,
    disable_cookies: true,
  },
  share_default_ttl_secs: 7200,
};

function cloneSettings(settings: Settings): Settings {
  return {
    obfuscation: { ...settings.obfuscation, hosts: [...settings.obfuscation.hosts] },
    share_default_ttl_secs: settings.share_default_ttl_secs,
  };
}

class MemorySettingsRepository implements SettingsRepository {
  settings: Settings;
  loadFailure: unknown = null;
  saveFailure: unknown = null;

  constructor(seed: Settings) {
    this.settings = cloneSettings(seed);
  }

  getSettings = vi.fn(async (): Promise<Settings> => {
    if (this.loadFailure !== null) throw this.loadFailure;
    return cloneSettings(this.settings);
  });

  updateSettings = vi.fn(async (input: Partial<Settings>): Promise<Settings> => {
    if (this.saveFailure !== null) throw this.saveFailure;
    const obfuscation: ObfuscationSettings = {
      ...this.settings.obfuscation,
      ...(input.obfuscation ?? {}),
    };
    this.settings = {
      obfuscation,
      share_default_ttl_secs:
        input.share_default_ttl_secs ?? this.settings.share_default_ttl_secs,
    };
    return cloneSettings(this.settings);
  });
}

interface Harness {
  vm: SettingsPageVM;
  repo: MemorySettingsRepository;
  service: DefaultSettingsService;
  toasts: ToastStore;
}

function makeHarness(seed: Settings = SETTINGS): Harness {
  const repo = new MemorySettingsRepository(seed);
  const service = new DefaultSettingsService(repo);
  const toasts = new ToastStore();
  return { vm: new SettingsPageVM(service, toasts), repo, service, toasts };
}

function valueEvent(value: string): Event {
  const event = new Event("input");
  Object.defineProperty(event, "target", { value: { value } });
  return event;
}

function checkedEvent(checked: boolean): Event {
  const event = new Event("change");
  Object.defineProperty(event, "target", { value: { checked } });
  return event;
}

function submitEvent(): Event {
  return new Event("submit", { cancelable: true });
}

describe("SettingsPageVM", () => {
  it("loads and maps the server settings", async () => {
    const harness = makeHarness();

    await harness.vm.load();

    expect(harness.repo.getSettings).toHaveBeenCalledTimes(1);
    expect(harness.vm.loaded).toBe(true);
    expect(harness.vm.loading).toBe(false);
    expect(harness.vm.error).toBeNull();
    expect(harness.vm.profile).toBe("tls");
    expect(harness.vm.intensity).toBe("high");
    expect(harness.vm.browser).toBe("firefox");
    expect(harness.vm.mtu).toBe("1420");
    expect(harness.vm.jcMin).toBe("4");
    expect(harness.vm.jcMax).toBe("12");
    expect(harness.vm.jminMin).toBe("60");
    expect(harness.vm.jminMax).toBe("240");
    expect(harness.vm.jmaxExtraMin).toBe("5");
    expect(harness.vm.jmaxExtraMax).toBe("120");
    expect(harness.vm.sMin).toBe("16");
    expect(harness.vm.sMax).toBe("72");
    expect(harness.vm.randomTrailers).toBe(true);
    expect(harness.vm.disableCookies).toBe(true);
    expect(harness.vm.hosts).toBe("example.com\ngoogle.com");
    expect(harness.vm.hostsCount).toBe(2);
    expect(harness.vm.ttlHours).toBe("2");
    expect(harness.vm.ttlSeconds).toBe(7200);
    expect(harness.vm.canSave).toBe(true);
  });

  it("triggers loading from created", async () => {
    const harness = makeHarness();

    harness.vm.created();
    await vi.waitFor(() => expect(harness.vm.loaded).toBe(true));
  });

  it("reports a load error and asks to retry", async () => {
    const harness = makeHarness();
    harness.repo.loadFailure = new Error("Не удалось связаться с сервером");

    await harness.vm.load();

    expect(harness.vm.error).toBe("Не удалось связаться с сервером");
    expect(harness.vm.loaded).toBe(false);
    expect(harness.vm.loading).toBe(false);
    expect(harness.vm.canSave).toBe(false);
    expect(
      harness.toasts.items.some(
        (item) => item.message === "Не удалось связаться с сервером",
      ),
    ).toBe(true);
  });

  it("uses a fallback message for a non-Error load failure", async () => {
    const harness = makeHarness();
    harness.repo.loadFailure = "offline";

    await harness.vm.load();

    expect(harness.vm.error).toBe("Не удалось загрузить настройки");
    expect(
      harness.toasts.items.some((item) => item.message === "Не удалось загрузить настройки"),
    ).toBe(true);
  });

  it("does not save before the settings are loaded", async () => {
    const harness = makeHarness();
    expect(harness.vm.canSave).toBe(false);

    await harness.vm.save(submitEvent());

    expect(harness.repo.updateSettings).not.toHaveBeenCalled();
  });

  it("saves the edited settings and applies the server response", async () => {
    const harness = makeHarness();
    await harness.vm.load();

    harness.vm.setProfile("random");
    harness.vm.setIntensity("low");
    harness.vm.setBrowser("chrome");
    harness.vm.setNumeric("mtu", valueEvent("1500"));
    harness.vm.setNumeric("jcMin", valueEvent("5"));
    harness.vm.setNumeric("jcMax", valueEvent("20"));
    harness.vm.setNumeric("jminMin", valueEvent("80"));
    harness.vm.setNumeric("jminMax", valueEvent("300"));
    harness.vm.setNumeric("jmaxExtraMin", valueEvent("10"));
    harness.vm.setNumeric("jmaxExtraMax", valueEvent("150"));
    harness.vm.setNumeric("sMin", valueEvent("20"));
    harness.vm.setNumeric("sMax", valueEvent("90"));
    harness.vm.setRandomTrailers(checkedEvent(false));
    harness.vm.setDisableCookies(checkedEvent(false));
    harness.vm.setHosts(valueEvent("a.example.com\nb.example.com"));
    harness.vm.setTtlHours(valueEvent("1.5"));

    await harness.vm.save(submitEvent());

    expect(harness.repo.updateSettings).toHaveBeenCalledTimes(1);
    expect(harness.repo.updateSettings).toHaveBeenCalledWith({
      obfuscation: {
        profile: "random",
        intensity: "low",
        browser: "chrome",
        mtu: 1500,
        jc_min: 5,
        jc_max: 20,
        jmin_min: 80,
        jmin_max: 300,
        jmax_extra_min: 10,
        jmax_extra_max: 150,
        s_min: 20,
        s_max: 90,
        hosts: ["a.example.com", "b.example.com"],
        random_trailers: false,
        disable_cookies: false,
      },
      share_default_ttl_secs: 5400,
    });
    expect(harness.vm.loaded).toBe(true);
    expect(harness.vm.saving).toBe(false);
    expect(harness.vm.profile).toBe("random");
    expect(harness.vm.hosts).toBe("a.example.com\nb.example.com");
    expect(harness.vm.ttlHours).toBe("1.5");
    expect(harness.toasts.items.some((item) => item.message === "Настройки сохранены")).toBe(
      true,
    );
  });

  it("clamps out-of-range numeric values before saving", async () => {
    const harness = makeHarness();
    await harness.vm.load();

    harness.vm.setNumeric("mtu", valueEvent("100"));
    harness.vm.setNumeric("jcMin", valueEvent("0"));
    harness.vm.setNumeric("jcMax", valueEvent("0"));
    harness.vm.setNumeric("jminMin", valueEvent("-5"));
    harness.vm.setNumeric("jminMax", valueEvent("-10"));
    harness.vm.setNumeric("jmaxExtraMin", valueEvent("-1"));
    harness.vm.setNumeric("jmaxExtraMax", valueEvent("-2"));
    harness.vm.setNumeric("sMin", valueEvent("3"));
    harness.vm.setNumeric("sMax", valueEvent("1"));

    await harness.vm.save();

    expect(harness.repo.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        obfuscation: expect.objectContaining({
          mtu: 576,
          jc_min: 1,
          jc_max: 1,
          jmin_min: 0,
          jmin_max: 0,
          jmax_extra_min: 0,
          jmax_extra_max: 0,
          s_min: 12,
          s_max: 12,
        }),
      }),
    );
    expect(harness.vm.mtu).toBe("576");
    expect(harness.vm.sMin).toBe("12");
  });

  it("falls back to defaults for non-numeric input and clamps the share TTL", async () => {
    const harness = makeHarness();
    await harness.vm.load();

    harness.vm.setNumeric("mtu", valueEvent("abc"));
    harness.vm.setTtlHours(valueEvent("0"));

    expect(harness.vm.ttlSeconds).toBe(0);
    await harness.vm.save();

    expect(harness.repo.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        obfuscation: expect.objectContaining({ mtu: 1280 }),
        share_default_ttl_secs: 60,
      }),
    );
  });

  it("parses a fractional share TTL into seconds", async () => {
    const harness = makeHarness();
    await harness.vm.load();

    harness.vm.setTtlHours(valueEvent("0,5"));

    expect(harness.vm.ttlSeconds).toBe(1800);
  });

  it("normalizes the hosts list", async () => {
    const harness = makeHarness();
    await harness.vm.load();

    harness.vm.setHosts(valueEvent("  example.com \n\n example.com \ngoogle.com  \n"));

    expect(harness.vm.hostsCount).toBe(2);
    await harness.vm.save();

    expect(harness.repo.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        obfuscation: expect.objectContaining({ hosts: ["example.com", "google.com"] }),
      }),
    );
  });

  it("ignores unknown option values", async () => {
    const harness = makeHarness();
    await harness.vm.load();

    harness.vm.setProfile("unknown");
    harness.vm.setIntensity("unknown");
    harness.vm.setBrowser("unknown");

    expect(harness.vm.profile).toBe("tls");
    expect(harness.vm.intensity).toBe("high");
    expect(harness.vm.browser).toBe("firefox");
  });

  it("exposes the option hints", async () => {
    const harness = makeHarness();
    await harness.vm.load();

    expect(harness.vm.profileHint).toContain("TLS");
    expect(harness.vm.intensityHint).toContain("Jc");
    expect(harness.vm.browserHint).toContain("Firefox");
    expect(harness.vm.profileOptions).toHaveLength(4);
    expect(harness.vm.intensityOptions).toHaveLength(3);
    expect(harness.vm.browserOptions).toHaveLength(5);
  });

  it("shows a validation error from the settings service", async () => {
    const harness = makeHarness();
    await harness.vm.load();
    harness.repo.saveFailure = new ValidationError(
      "S-паддинг должен быть не меньше 12 при включённой защите заголовков",
    );

    await harness.vm.save();

    expect(harness.vm.saving).toBe(false);
    expect(
      harness.toasts.items.some(
        (item) =>
          item.kind === "error" &&
          item.message === "S-паддинг должен быть не меньше 12 при включённой защите заголовков",
      ),
    ).toBe(true);
  });

  it("uses a fallback message for a non-Error save failure", async () => {
    const harness = makeHarness();
    await harness.vm.load();
    harness.repo.saveFailure = "boom";

    await harness.vm.save();

    expect(
      harness.toasts.items.some(
        (item) => item.message === "Не удалось сохранить настройки",
      ),
    ).toBe(true);
    expect(harness.vm.saving).toBe(false);
  });

  it("resolves constructor dependencies through the container", async () => {
    const harness = makeHarness();
    const container = createAppContainer();
    container.bind(DefaultSettingsService, () => harness.service);
    container.bind(ToastStore, () => harness.toasts);

    const vm = await container.resolve<SettingsPageVM>(SettingsPageVM);
    await vm.load();

    expect(vm).toBeInstanceOf(SettingsPageVM);
    expect(await container.resolve(SettingsPageVM)).toBe(vm);
    expect(vm.profile).toBe("tls");
    expect(harness.repo.getSettings).toHaveBeenCalledTimes(1);
  });

  it("auto-wires the settings service and toast store without explicit bindings", async () => {
    const container = createAppContainer();

    const vm = await container.resolve<SettingsPageVM>(SettingsPageVM);

    expect(vm).toBeInstanceOf(SettingsPageVM);
    expect(vm.loading).toBe(true);
    expect(vm.canSave).toBe(false);
  });
});
