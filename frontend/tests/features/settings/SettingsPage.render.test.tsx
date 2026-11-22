import { createComponent, flushSync } from "@ivlev-dev/silent-core";

import { createAppContainer } from "@/app/di";
import { ToastStore } from "@/app/toast";
import { DefaultSettingsService } from "@/application/settings/service";
import type { Settings } from "@/domain/types";
import { SettingsPage } from "@/features/settings/SettingsPage";

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
    hosts: ["example.com"],
    random_trailers: true,
    disable_cookies: true,
    keepalive_min: 15,
    keepalive_max: 25,
  },
  share_default_ttl_secs: 7200,
};

function clone(settings: Settings): Settings {
  return {
    obfuscation: { ...settings.obfuscation, hosts: [...settings.obfuscation.hosts] },
    share_default_ttl_secs: settings.share_default_ttl_secs,
  };
}

class MemoryRepository {
  settings = clone(SETTINGS);

  getSettings = vi.fn(async () => clone(this.settings));

  updateSettings = vi.fn(async (input: Partial<Settings>): Promise<Settings> => {
    this.settings = {
      obfuscation: { ...this.settings.obfuscation, ...(input.obfuscation ?? {}) },
      share_default_ttl_secs:
        input.share_default_ttl_secs ?? this.settings.share_default_ttl_secs,
    };
    return clone(this.settings);
  });
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
}

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("показывает загруженные значения и сохраняет правки формы", async () => {
    const repo = new MemoryRepository();
    const toasts = new ToastStore();
    const container = createAppContainer();
    container.bind(DefaultSettingsService, () => new DefaultSettingsService(repo));
    container.bind(ToastStore, () => toasts);

    const result = createComponent(SettingsPage, {}, { container });
    document.body.append(result.node);
    flushSync();

    await vi.waitFor(() => {
      const mtu = document.querySelector<HTMLInputElement>("#obf-mtu");
      expect(mtu?.value).toBe("1420");
    });

    const mtu = document.querySelector<HTMLInputElement>("#obf-mtu");
    if (mtu === null) throw new Error("mtu input is missing");
    mtu.value = "1500";
    mtu.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();

    const save = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Сохранить настройки",
    );
    expect(save?.disabled).toBe(false);
    save?.click();
    flushSync();

    await vi.waitFor(() => expect(repo.updateSettings).toHaveBeenCalledTimes(1));
    expect(repo.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        obfuscation: expect.objectContaining({ mtu: 1500 }),
      }),
    );
    await vi.waitFor(() => {
      expect(document.querySelector<HTMLInputElement>("#obf-mtu")?.value).toBe("1500");
    });
    expect(toasts.items.some((item) => item.message === "Настройки сохранены")).toBe(
      true,
    );

    result.dispose();
  });
});
