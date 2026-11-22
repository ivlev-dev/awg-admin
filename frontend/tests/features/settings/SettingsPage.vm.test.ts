import { createAppContainer } from "@/app/di";
import { setDensity } from "@/app/density";
import { hasUnsavedChanges } from "@/app/unsaved";
import { ToastStore } from "@/app/toast";
import { ValidationError } from "@/application/errors";
import { DefaultSettingsService } from "@/application/settings/service";
import type { SettingsRepository } from "@/domain/settings/repository";
import type { ObfuscationSettings, Settings } from "@/domain/types";
import { setLocale } from "@/i18n";
import { SettingsPageVM } from "@/features/settings/SettingsPage.vm";

const confirmMock = vi.hoisted(() => ({ askConfirm: vi.fn(async (_o: unknown) => true) }));
vi.mock("@/app/confirm", () => confirmMock);

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
    keepalive_min: 15,
    keepalive_max: 25,
  },
  share_default_ttl_secs: 7200,
};

function cloneSettings(settings: Settings): Settings {
  return {
    obfuscation: { ...settings.obfuscation, hosts: [...settings.obfuscation.hosts] },
    share_default_ttl_secs: settings.share_default_ttl_secs,
  };
}

class MemorySettingsRepository {
  settings!: Settings;
  loadFailure: unknown = null;
  saveFailure: unknown = null;


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

const activeVms: SettingsPageVM[] = [];

function makeHarness(seed: Settings = SETTINGS): Harness {
  const repo = new MemorySettingsRepository();
  repo.settings = cloneSettings(seed);
  const service = new DefaultSettingsService(repo);
  const toasts = new ToastStore();
  const vm = new SettingsPageVM(service, toasts);
  activeVms.push(vm);
  return { vm, repo, service, toasts };
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
  confirmMock.askConfirm.mockReset();
  confirmMock.askConfirm.mockImplementation(async () => true);
  setLocale("ru");
});

afterEach(() => {
  for (const vm of activeVms.splice(0)) vm.dispose();
  setLocale("ru");
  vi.unstubAllGlobals();
});

describe("SettingsPageVM", () => {
  it("loads and maps the server settings", async () => {
    const harness = makeHarness();

    await harness.vm.load();

    expect(harness.repo.getSettings).toHaveBeenCalledTimes(1);
    expect(harness.vm.loaded).toBe(true);
    expect(harness.vm.loading).toBe(false);
    expect(harness.vm.error).toBeNull();
    expect(harness.vm.form.profile).toBe("tls");
    expect(harness.vm.form.intensity).toBe("high");
    expect(harness.vm.form.browser).toBe("firefox");
    expect(harness.vm.form.mtu).toBe(1420);
    expect(harness.vm.form.jcMin).toBe(4);
    expect(harness.vm.form.jcMax).toBe(12);
    expect(harness.vm.form.jminMin).toBe(60);
    expect(harness.vm.form.jminMax).toBe(240);
    expect(harness.vm.form.jmaxExtraMin).toBe(5);
    expect(harness.vm.form.jmaxExtraMax).toBe(120);
    expect(harness.vm.form.sMin).toBe(16);
    expect(harness.vm.form.sMax).toBe(72);
    expect(harness.vm.form.randomTrailers).toBe(true);
    expect(harness.vm.form.disableCookies).toBe(true);
    expect(harness.vm.form.hosts).toBe("example.com\ngoogle.com");
    expect(harness.vm.hostsCount).toBe(2);
    expect(harness.vm.form.ttlHours).toBe(2);
    expect(harness.vm.ttlSeconds).toBe(7200);
    expect(harness.vm.dirty).toBe(false);
    expect(harness.vm.canSave).toBe(false);
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
    harness.vm.setNumeric("keepaliveMin", valueEvent("10"));
    harness.vm.setNumeric("keepaliveMax", valueEvent("30"));
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
        keepalive_min: 10,
        keepalive_max: 30,
      },
      share_default_ttl_secs: 5400,
    });
    expect(harness.vm.loaded).toBe(true);
    expect(harness.vm.saving).toBe(false);
    expect(harness.vm.form.profile).toBe("random");
    expect(harness.vm.form.hosts).toBe("a.example.com\nb.example.com");
    expect(harness.vm.form.ttlHours).toBe(1.5);
    expect(harness.toasts.items.some((item) => item.message === "Настройки сохранены")).toBe(
      true,
    );
  });

  it("blocks out-of-range numeric values before saving", async () => {
    const harness = makeHarness();
    await harness.vm.load();

    harness.vm.setNumeric("mtu", valueEvent("100"));
    harness.vm.setNumeric("jcMin", valueEvent("0"));
    harness.vm.setNumeric("sMin", valueEvent("3"));
    harness.vm.setNumeric("keepaliveMax", valueEvent("200"));

    await harness.vm.save();

    expect(harness.repo.updateSettings).not.toHaveBeenCalled();
    expect(harness.vm.form.getFieldProps("mtu").error).toBeDefined();
    expect(harness.vm.form.getFieldProps("jcMin").error).toBeDefined();
    expect(harness.vm.form.getFieldProps("sMin").error).toBeDefined();
    expect(harness.vm.form.getFieldProps("keepaliveMax").error).toBeDefined();
    expect(harness.vm.dirty).toBe(true);
    expect(harness.vm.saving).toBe(false);
  });

  it("blocks non-numeric input before saving", async () => {
    const harness = makeHarness();
    await harness.vm.load();

    harness.vm.setNumeric("mtu", valueEvent("abc"));

    await harness.vm.save();

    expect(harness.repo.updateSettings).not.toHaveBeenCalled();
    expect(harness.vm.form.getFieldProps("mtu").error).toBeDefined();
  });

  it("passes the zero share TTL through the service clamp", async () => {
    const harness = makeHarness();
    await harness.vm.load();

    harness.vm.setTtlHours(valueEvent("0"));

    expect(harness.vm.ttlSeconds).toBe(0);
    await harness.vm.save();

    expect(harness.repo.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ share_default_ttl_secs: 60 }),
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

    expect(harness.vm.form.profile).toBe("tls");
    expect(harness.vm.form.intensity).toBe("high");
    expect(harness.vm.form.browser).toBe("firefox");
  });

  it("переключает язык интерфейса и переводит подписи опций", async () => {
    const harness = makeHarness();
    await harness.vm.load();

    expect(harness.vm.language).toBe("ru");
    expect(harness.vm.profileOptions.map((option) => option.label)).toEqual([
      "HTTP/3",
      "TLS",
      "QUIC",
      "Случайный",
    ]);

    harness.vm.setLanguage("en");

    expect(harness.vm.language).toBe("en");
    expect(harness.vm.profileOptions.map((option) => option.label)).toEqual([
      "HTTP/3",
      "TLS",
      "QUIC",
      "Random",
    ]);
    expect(harness.vm.intensityOptions[0]?.label).toBe("Low");
    expect(harness.vm.browserOptions[1]?.label).toBe("Firefox");
    expect(harness.vm.profileHint).toContain("TLS");
    expect(harness.vm.languageOptions).toHaveLength(2);
    expect(localStorage.getItem("awg.locale")).toBe("en");

    harness.vm.setLanguage("de");

    expect(harness.vm.language).toBe("en");
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
    harness.vm.setNumeric("mtu", valueEvent("1400"));

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
    harness.vm.setNumeric("mtu", valueEvent("1400"));

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
    expect(vm.form.profile).toBe("tls");
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

describe("SettingsPageVM unsaved changes", () => {
  const mutations: Array<[string, (vm: SettingsPageVM) => void]> = [
    ["profile", (vm) => vm.setProfile("random")],
    ["intensity", (vm) => vm.setIntensity("low")],
    ["browser", (vm) => vm.setBrowser("chrome")],
    ["mtu", (vm) => vm.setNumeric("mtu", valueEvent("1500"))],
    ["jcMin", (vm) => vm.setNumeric("jcMin", valueEvent("5"))],
    ["jcMax", (vm) => vm.setNumeric("jcMax", valueEvent("20"))],
    ["jminMin", (vm) => vm.setNumeric("jminMin", valueEvent("80"))],
    ["jminMax", (vm) => vm.setNumeric("jminMax", valueEvent("300"))],
    ["jmaxExtraMin", (vm) => vm.setNumeric("jmaxExtraMin", valueEvent("10"))],
    ["jmaxExtraMax", (vm) => vm.setNumeric("jmaxExtraMax", valueEvent("150"))],
    ["sMin", (vm) => vm.setNumeric("sMin", valueEvent("20"))],
    ["sMax", (vm) => vm.setNumeric("sMax", valueEvent("90"))],
    ["randomTrailers", (vm) => vm.setRandomTrailers(checkedEvent(false))],
    ["disableCookies", (vm) => vm.setDisableCookies(checkedEvent(false))],
    ["hosts", (vm) => vm.setHosts(valueEvent("other.example.com"))],
    ["ttlHours", (vm) => vm.setTtlHours(valueEvent("3"))],
  ];

  it.each(mutations)("считает изменение поля %s несохранённым", async (_name, mutate) => {
    const harness = makeHarness();
    await harness.vm.load();
    expect(harness.vm.dirty).toBe(false);
    expect(harness.vm.canSave).toBe(false);

    mutate(harness.vm);

    expect(harness.vm.dirty).toBe(true);
    expect(harness.vm.canSave).toBe(true);
  });

  it("спрашивает подтверждение и перезагружает настройки при отмене изменений", async () => {
    const harness = makeHarness();
    await harness.vm.load();
    harness.vm.setProfile("random");

    await harness.vm.reset();

    expect(confirmMock.askConfirm).toHaveBeenCalledTimes(1);
    expect(confirmMock.askConfirm).toHaveBeenCalledWith({
      title: "Отменить изменения?",
      message: "Несохранённые настройки будут потеряны.",
      confirmLabel: "Отменить изменения",
      tone: "danger",
    });
    expect(harness.repo.getSettings).toHaveBeenCalledTimes(2);
    expect(harness.vm.form.profile).toBe("tls");
    expect(harness.vm.dirty).toBe(false);
    expect(harness.vm.canSave).toBe(false);
  });

  it("оставляет изменения при отказе от подтверждения", async () => {
    const harness = makeHarness();
    await harness.vm.load();
    confirmMock.askConfirm.mockResolvedValue(false);
    harness.vm.setProfile("random");

    await harness.vm.reset();

    expect(harness.repo.getSettings).toHaveBeenCalledTimes(1);
    expect(harness.vm.form.profile).toBe("random");
    expect(harness.vm.dirty).toBe(true);
  });

  it("перезагружает настройки без подтверждения, если изменений нет", async () => {
    const harness = makeHarness();
    await harness.vm.load();

    await harness.vm.reset();

    expect(confirmMock.askConfirm).not.toHaveBeenCalled();
    expect(harness.repo.getSettings).toHaveBeenCalledTimes(2);
    expect(harness.vm.dirty).toBe(false);
  });

  it("снимает признак изменений после успешного сохранения", async () => {
    const harness = makeHarness();
    await harness.vm.load();
    harness.vm.setNumeric("mtu", valueEvent("1500"));
    expect(harness.vm.dirty).toBe(true);

    await harness.vm.save();

    expect(harness.vm.dirty).toBe(false);
    expect(harness.vm.canSave).toBe(false);
  });

  it("сохраняет признак изменений при ошибке сохранения", async () => {
    const harness = makeHarness();
    await harness.vm.load();
    harness.repo.saveFailure = new Error("boom");
    harness.vm.setNumeric("mtu", valueEvent("1500"));

    await harness.vm.save();

    expect(harness.vm.dirty).toBe(true);
    expect(harness.vm.canSave).toBe(true);
  });

  it("регистрирует грязную форму для перехвата навигации", async () => {
    const harness = makeHarness();
    harness.vm.created();
    await vi.waitFor(() => expect(harness.vm.loaded).toBe(true));

    expect(hasUnsavedChanges()).toBe(false);

    harness.vm.setNumeric("mtu", valueEvent("1500"));
    expect(hasUnsavedChanges()).toBe(true);

    await harness.vm.save();
    expect(hasUnsavedChanges()).toBe(false);

    harness.vm.dispose();
  });

  it("регистрирует и снимает обработчик beforeunload только при изменениях", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const harness = makeHarness();

    harness.vm.created();
    await vi.waitFor(() => expect(harness.vm.loaded).toBe(true));

    expect(
      addSpy.mock.calls.some((call) => call[0] === "beforeunload"),
    ).toBe(false);

    harness.vm.setNumeric("mtu", valueEvent("1500"));
    await vi.waitFor(() => expect(harness.vm.dirty).toBe(true));

    const registered = addSpy.mock.calls.find((call) => call[0] === "beforeunload")?.[1];
    expect(registered).toBeDefined();

    const handler = registered as unknown as (event: BeforeUnloadEvent) => void;

    harness.vm.dispose();

    expect(
      removeSpy.mock.calls.some(
        (call) => call[0] === "beforeunload" && call[1] === handler,
      ),
    ).toBe(true);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("предотвращает выгрузку страницы только при несохранённых изменениях", async () => {
    const harness = makeHarness();
    harness.vm.created();
    await vi.waitFor(() => expect(harness.vm.loaded).toBe(true));

    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    harness.vm.setNumeric("mtu", valueEvent("1500"));
    await vi.waitFor(() => expect(harness.vm.dirty).toBe(true));

    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);

    harness.vm.dispose();

    const disposed = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(disposed);
    expect(disposed.defaultPrevented).toBe(false);
  });
});

describe("SettingsPageVM table density", () => {
  beforeEach(() => {
    setDensity("comfortable");
  });

  afterEach(() => {
    setDensity("comfortable");
  });

  it("reads the current browser density", () => {
    const harness = makeHarness();
    setDensity("compact");

    expect(harness.vm.tableDensity).toBe("compact");
  });

  it("changes the density signal and the document attribute", () => {
    const harness = makeHarness();

    harness.vm.setTableDensity("compact");

    expect(harness.vm.tableDensity).toBe("compact");
    expect(document.documentElement.getAttribute("data-density")).toBe("compact");

    harness.vm.setTableDensity("comfortable");

    expect(harness.vm.tableDensity).toBe("comfortable");
    expect(document.documentElement.hasAttribute("data-density")).toBe(false);
  });

  it("ignores unknown density values", () => {
    const harness = makeHarness();

    harness.vm.setTableDensity("dense");

    expect(harness.vm.tableDensity).toBe("comfortable");
  });

  it("exposes both density options", () => {
    const harness = makeHarness();

    expect(harness.vm.densityOptions.map((option) => option.value)).toEqual(["comfortable", "compact"]);
  });
});
