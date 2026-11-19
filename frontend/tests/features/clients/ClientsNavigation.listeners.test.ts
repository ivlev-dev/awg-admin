import type { DevicesService } from "@/application/devices/service";
import type { InterfacesService } from "@/application/interfaces/service";
import type { QuotaService } from "@/application/quota/service";
import { Router } from "@/app/router";
import { Session } from "@/app/session";
import { ToastStore } from "@/app/toast";
import { ClientDetailsVM } from "@/features/clients/ClientDetails.vm";
import { ClientsPageVM } from "@/features/clients/ClientsPage.vm";
import type { UsersService } from "@/application/users/service";

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

const devices = {} as DevicesService;
const interfaces = {} as InterfacesService;
const users = {} as UsersService;
const quota = {} as QuotaService;
const session = {} as Session;

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
  window.history.replaceState(null, "", "/clients");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Переходы /clients → карточка → назад", () => {
  it("не копит window-листенеры после 20 циклов", () => {
    const router = new Router();
    const toasts = new ToastStore();
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");

    for (let cycle = 0; cycle < 20; cycle += 1) {
      const list = new ClientsPageVM(devices, interfaces, users, session, router, toasts);
      list.mounted();
      list.dispose();

      const card = new ClientDetailsVM(devices, interfaces, quota, session, router, toasts);
      card.dispose();
    }

    expect(add).toHaveBeenCalled();
    expect(add.mock.calls.length).toBe(remove.mock.calls.length);
  });

  it("снимает popstate при dispose без mounted", () => {
    const router = new Router();
    const toasts = new ToastStore();
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");

    const list = new ClientsPageVM(devices, interfaces, users, session, router, toasts);
    list.mounted();
    list.dispose();

    expect(add.mock.calls.length).toBe(remove.mock.calls.length);
  });
});
