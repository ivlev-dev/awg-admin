import { Container } from "@ivlev-dev/silent-di";

import { DefaultAuditService, type AuditService } from "@/application/audit/service";
import { DefaultAuthService, type AuthService } from "@/application/auth/service";
import { DefaultDevicesService, type DevicesService } from "@/application/devices/service";
import { DefaultGroupsService, type GroupsService } from "@/application/groups/service";
import { DefaultImportService, type ImportService } from "@/application/import/service";
import { DefaultInterfacesService, type InterfacesService } from "@/application/interfaces/service";
import { DefaultNodesService, type NodesService } from "@/application/nodes/service";
import { DefaultQuotaService, type QuotaService } from "@/application/quota/service";
import { DefaultSettingsService, type SettingsService } from "@/application/settings/service";
import { DefaultStatsService, type StatsService } from "@/application/stats/service";
import { DefaultTariffsService, type TariffsService } from "@/application/tariffs/service";
import { DefaultUsersService, type UsersService } from "@/application/users/service";
import {
  createHttpBackend,
  type ApiRepositories,
  type HttpBackend,
} from "@/infrastructure/http/backend";
import { HttpAuditRepository } from "@/infrastructure/http/audit.repository";
import { HttpAuthRepository } from "@/infrastructure/http/auth.repository";
import { HttpClient } from "@/infrastructure/http/client";
import { DefaultApiConfig, type ApiConfig } from "@/infrastructure/http/config";
import type { ApiError } from "@/infrastructure/http/errors";
import { HttpDevicesRepository } from "@/infrastructure/http/devices.repository";
import { HttpGroupsRepository } from "@/infrastructure/http/groups.repository";
import { HttpImportRepository } from "@/infrastructure/http/import.repository";
import { HttpInterfacesRepository } from "@/infrastructure/http/interfaces.repository";
import { HttpNodesRepository } from "@/infrastructure/http/nodes.repository";
import { HttpQuotaRepository } from "@/infrastructure/http/quota.repository";
import { HttpSettingsRepository } from "@/infrastructure/http/settings.repository";
import { HttpStatsRepository } from "@/infrastructure/http/stats.repository";
import { HttpTariffsRepository } from "@/infrastructure/http/tariffs.repository";
import { HttpUsersRepository } from "@/infrastructure/http/users.repository";
import { HttpTransport } from "@/infrastructure/http/transport";
import { LocalTokenStore, type TokenStore } from "@/infrastructure/storage";
import { Session } from "@/app/session";

export interface AppServices {
  tokens: TokenStore;
  config: ApiConfig;
  session: Session;
  backend: HttpBackend;
  repositories: ApiRepositories;
  auth: AuthService;
  audit: AuditService;
  users: UsersService;
  tariffs: TariffsService;
  groups: GroupsService;
  nodes: NodesService;
  interfaces: InterfacesService;
  devices: DevicesService;
  stats: StatsService;
  quota: QuotaService;
  settings: SettingsService;
  import: ImportService;
}

export interface AppOptions {
  tokens?: TokenStore;
  config?: ApiConfig;
  onNetworkError?: (error: ApiError) => void;
  onForbidden?: (error: ApiError) => void;
}

export interface AppContainerOptions extends AppOptions {}

export interface BootstrapResult {
  container: Container;
  services: AppServices;
}

export function createAppServices(options: AppOptions = {}): AppServices {
  const tokens = options.tokens ?? new LocalTokenStore();
  const config = options.config ?? new DefaultApiConfig();
  const transport = new HttpTransport(config);
  const authRepository = new HttpAuthRepository(transport, tokens);
  const session = new Session(authRepository, tokens);
  const backend = createHttpBackend({
    tokens,
    config,
    session,
    transport,
    auth: authRepository,
    ...(options.onNetworkError ? { onNetworkError: options.onNetworkError } : {}),
    ...(options.onForbidden ? { onForbidden: options.onForbidden } : {}),
  });
  const repositories = backend.repositories;
  return {
    tokens,
    config,
    session,
    backend,
    repositories,
    auth: new DefaultAuthService(repositories.auth),
    audit: new DefaultAuditService(repositories.audit),
    users: new DefaultUsersService(repositories.users),
    tariffs: new DefaultTariffsService(repositories.tariffs),
    groups: new DefaultGroupsService(repositories.groups),
    nodes: new DefaultNodesService(repositories.nodes),
    interfaces: new DefaultInterfacesService(repositories.interfaces),
    devices: new DefaultDevicesService(repositories.devices),
    stats: new DefaultStatsService(repositories.stats),
    quota: new DefaultQuotaService(repositories.quota),
    settings: new DefaultSettingsService(repositories.settings),
    import: new DefaultImportService(repositories.import),
  };
}

export function createAppContainer(options: AppContainerOptions = {}): Container {
  const container = new Container("awg-admin");
  if (options.tokens) {
    container.bind(LocalTokenStore, () => options.tokens);
  }
  if (options.config) {
    container.bind(DefaultApiConfig, () => options.config);
  }
  return container;
}

export async function resolveAppServices(container: Container): Promise<AppServices> {
  const tokens = await container.resolve<LocalTokenStore>(LocalTokenStore);
  const config = await container.resolve<DefaultApiConfig>(DefaultApiConfig);
  const authRepository = await container.resolve<HttpAuthRepository>(HttpAuthRepository);
  const auditRepository = await container.resolve<HttpAuditRepository>(HttpAuditRepository);
  const usersRepository = await container.resolve<HttpUsersRepository>(HttpUsersRepository);
  const tariffsRepository = await container.resolve<HttpTariffsRepository>(HttpTariffsRepository);
  const groupsRepository = await container.resolve<HttpGroupsRepository>(HttpGroupsRepository);
  const nodesRepository = await container.resolve<HttpNodesRepository>(HttpNodesRepository);
  const interfacesRepository = await container.resolve<HttpInterfacesRepository>(HttpInterfacesRepository);
  const devicesRepository = await container.resolve<HttpDevicesRepository>(HttpDevicesRepository);
  const statsRepository = await container.resolve<HttpStatsRepository>(HttpStatsRepository);
  const quotaRepository = await container.resolve<HttpQuotaRepository>(HttpQuotaRepository);
  const settingsRepository = await container.resolve<HttpSettingsRepository>(HttpSettingsRepository);
  const importRepository = await container.resolve<HttpImportRepository>(HttpImportRepository);
  const client = await container.resolve<HttpClient>(HttpClient);
  const session = await container.resolve<Session>(Session);
  const repositories: ApiRepositories = {
    auth: authRepository,
    audit: auditRepository,
    users: usersRepository,
    tariffs: tariffsRepository,
    groups: groupsRepository,
    nodes: nodesRepository,
    interfaces: interfacesRepository,
    devices: devicesRepository,
    stats: statsRepository,
    quota: quotaRepository,
    settings: settingsRepository,
    import: importRepository,
  };
  const backend: HttpBackend = { client, repositories };

  return {
    tokens,
    config,
    session,
    backend,
    repositories,
    auth: await container.resolve<DefaultAuthService>(DefaultAuthService),
    audit: await container.resolve<DefaultAuditService>(DefaultAuditService),
    users: await container.resolve<DefaultUsersService>(DefaultUsersService),
    tariffs: await container.resolve<DefaultTariffsService>(DefaultTariffsService),
    groups: await container.resolve<DefaultGroupsService>(DefaultGroupsService),
    nodes: await container.resolve<DefaultNodesService>(DefaultNodesService),
    interfaces: await container.resolve<DefaultInterfacesService>(DefaultInterfacesService),
    devices: await container.resolve<DefaultDevicesService>(DefaultDevicesService),
    stats: await container.resolve<DefaultStatsService>(DefaultStatsService),
    quota: await container.resolve<DefaultQuotaService>(DefaultQuotaService),
    settings: await container.resolve<DefaultSettingsService>(DefaultSettingsService),
    import: await container.resolve<DefaultImportService>(DefaultImportService),
  };
}

export async function bootstrapApp(options: AppContainerOptions = {}): Promise<BootstrapResult> {
  const container = createAppContainer(options);
  const services = await resolveAppServices(container);
  return { container, services };
}
