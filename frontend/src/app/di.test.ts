import { DI_CREATE } from "@ivlev-dev/silent-di";

import { DefaultAuthService } from "../application/auth/service";
import type { AuthService } from "../application/auth/service";
import { DefaultDevicesService } from "../application/devices/service";
import type { DevicesService } from "../application/devices/service";
import { DefaultGroupsService } from "../application/groups/service";
import { DefaultImportService } from "../application/import/service";
import { DefaultInterfacesService } from "../application/interfaces/service";
import { DefaultNodesService } from "../application/nodes/service";
import { DefaultSettingsService } from "../application/settings/service";
import { DefaultStatsService } from "../application/stats/service";
import { DefaultTariffsService } from "../application/tariffs/service";
import { DefaultUsersService } from "../application/users/service";
import type { UsersService } from "../application/users/service";
import { HttpAuthRepository } from "@/infrastructure/http/auth.repository";
import { AuthRequestInterceptor } from "@/infrastructure/http/auth-request.interceptor";
import { AuthResponseInterceptor } from "@/infrastructure/http/auth-response.interceptor";
import { HttpClient } from "@/infrastructure/http/client";
import { InterceptorRegistry } from "@/infrastructure/http/interceptor-registry";
import { HttpDevicesRepository } from "@/infrastructure/http/devices.repository";
import { HttpGroupsRepository } from "@/infrastructure/http/groups.repository";
import { HttpImportRepository } from "@/infrastructure/http/import.repository";
import { HttpInterfacesRepository } from "@/infrastructure/http/interfaces.repository";
import { HttpNodesRepository } from "@/infrastructure/http/nodes.repository";
import { HttpSettingsRepository } from "@/infrastructure/http/settings.repository";
import { HttpStatsRepository } from "@/infrastructure/http/stats.repository";
import { HttpTariffsRepository } from "@/infrastructure/http/tariffs.repository";
import { HttpUsersRepository } from "@/infrastructure/http/users.repository";
import type { TokenStore } from "@/infrastructure/storage";
import {
  bootstrapApp,
  createAppContainer,
  resolveAppServices,
} from "./di";

function diCreate(ctor: unknown): unknown {
  if (typeof ctor !== "function") return undefined;
  return (ctor as unknown as Record<symbol, unknown>)[DI_CREATE];
}

const SERVICES = [
  DefaultAuthService,
  DefaultUsersService,
  DefaultTariffsService,
  DefaultGroupsService,
  DefaultNodesService,
  DefaultInterfacesService,
  DefaultDevicesService,
  DefaultStatsService,
  DefaultSettingsService,
  DefaultImportService,
] as const;

class ServiceAutowiringProbe {
  constructor(
    readonly auth: AuthService,
    readonly users: UsersService,
    readonly devices: DevicesService,
  ) {}
}

const REPOSITORIES = [
  HttpAuthRepository,
  HttpUsersRepository,
  HttpTariffsRepository,
  HttpGroupsRepository,
  HttpNodesRepository,
  HttpInterfacesRepository,
  HttpDevicesRepository,
  HttpStatsRepository,
  HttpSettingsRepository,
  HttpImportRepository,
] as const;

function memoryTokens(): TokenStore & { current: { access: string | null; refresh: string | null } } {
  const state: { access: string | null; refresh: string | null } = {
    access: null,
    refresh: null,
  };
  return {
    current: state,
    access: () => state.access,
    refresh: () => state.refresh,
    set: (access, refresh) => {
      state.access = access;
      state.refresh = refresh;
    },
    clear: () => {
      state.access = null;
      state.refresh = null;
    },
  };
}

describe("DI autodiscovery", () => {
  it("wires constructors at compile time", () => {
    for (const ctor of [...SERVICES, ...REPOSITORIES, HttpClient]) {
      expect(typeof diCreate(ctor)).toBe("function");
    }
  });

  it("resolves HttpClient and the interceptor chain without cycles", async () => {
    const container = createAppContainer();
    const client = await container.resolve<HttpClient>(HttpClient);
    const registry = await container.resolve<InterceptorRegistry>(InterceptorRegistry);
    const authRequest = await container.resolve<AuthRequestInterceptor>(AuthRequestInterceptor);
    const authResponse = await container.resolve<AuthResponseInterceptor>(AuthResponseInterceptor);

    expect(client).toBeInstanceOf(HttpClient);
    expect(registry.request).toContain(authRequest);
    expect(registry.response).toContain(authResponse);
    expect(await container.resolve<HttpClient>(HttpClient)).toBe(client);
  });

  it("resolves every service as a singleton without cycles", async () => {
    const container = createAppContainer();
    const first = await resolveAppServices(container);
    const second = await resolveAppServices(container);
    for (const ctor of SERVICES) {
      expect(await container.resolve(ctor)).toBe(await container.resolve(ctor));
    }
    expect(second.auth).toBe(first.auth);
    expect(second.devices).toBe(first.devices);
    expect(second.repositories.devices).toBe(first.repositories.devices);
    expect(second.backend.client).toBe(first.backend.client);
  });

  it("autowires service interfaces to their default implementations", async () => {
    const container = createAppContainer();
    const probe = await container.resolve<ServiceAutowiringProbe>(ServiceAutowiringProbe);
    const services = await resolveAppServices(container);

    expect(probe.auth).toBeInstanceOf(DefaultAuthService);
    expect(probe.users).toBeInstanceOf(DefaultUsersService);
    expect(probe.devices).toBeInstanceOf(DefaultDevicesService);
    expect(probe.auth).toBe(services.auth);
    expect(probe.users).toBe(services.users);
    expect(probe.devices).toBe(services.devices);
  });

  it("resolves repositories to HTTP implementations", async () => {
    const { services } = await bootstrapApp();
    expect(services.repositories.auth).toBeInstanceOf(HttpAuthRepository);
    expect(services.repositories.users).toBeInstanceOf(HttpUsersRepository);
    expect(services.repositories.tariffs).toBeInstanceOf(HttpTariffsRepository);
    expect(services.repositories.groups).toBeInstanceOf(HttpGroupsRepository);
    expect(services.repositories.nodes).toBeInstanceOf(HttpNodesRepository);
    expect(services.repositories.interfaces).toBeInstanceOf(HttpInterfacesRepository);
    expect(services.repositories.devices).toBeInstanceOf(HttpDevicesRepository);
    expect(services.repositories.stats).toBeInstanceOf(HttpStatsRepository);
    expect(services.repositories.settings).toBeInstanceOf(HttpSettingsRepository);
    expect(services.repositories.import).toBeInstanceOf(HttpImportRepository);
  });

  it("propagates bound token store and api config through the graph", async () => {
    const tokens = memoryTokens();
    const container = createAppContainer({
      tokens,
      config: { baseUrl: "/custom/api", timeoutMs: 1_000 },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => null,
      text: async () =>
        JSON.stringify({
          token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 3600,
          user: {
            id: "u1",
            login: "admin",
            role: "admin",
            tariff_id: null,
            group_id: null,
            disabled: false,
            created_at: "2020-01-01T00:00:00Z",
            updated_at: "2020-01-01T00:00:00Z",
          },
        }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const auth = await container.resolve<DefaultAuthService>(DefaultAuthService);
    const session = await auth.login({ login: "admin", password: "secret" });

    expect(session.token).toBe("access-1");
    expect(tokens.current).toEqual({ access: "access-1", refresh: "refresh-1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/custom/api/auth/login",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
