import { Container } from "@ivlev-dev/silent-di";

import { AuthService } from "@/application/auth/service";
import { DevicesService } from "@/application/devices/service";
import { GroupsService } from "@/application/groups/service";
import { ImportService } from "@/application/import/service";
import { InterfacesService } from "@/application/interfaces/service";
import { NodesService } from "@/application/nodes/service";
import { SettingsService } from "@/application/settings/service";
import { StatsService } from "@/application/stats/service";
import { TariffsService } from "@/application/tariffs/service";
import { UsersService } from "@/application/users/service";
import {
  createHttpBackend,
  type ApiRepositories,
  type HttpBackend,
} from "@/infrastructure/http/backend";
import { HttpAuthRepository } from "@/infrastructure/http/auth.repository";
import { HttpClient } from "@/infrastructure/http/client";
import { DefaultApiConfig, type ApiConfig } from "@/infrastructure/http/config";
import { HttpDevicesRepository } from "@/infrastructure/http/devices.repository";
import { HttpGroupsRepository } from "@/infrastructure/http/groups.repository";
import { HttpImportRepository } from "@/infrastructure/http/import.repository";
import { HttpInterfacesRepository } from "@/infrastructure/http/interfaces.repository";
import { HttpNodesRepository } from "@/infrastructure/http/nodes.repository";
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
  users: UsersService;
  tariffs: TariffsService;
  groups: GroupsService;
  nodes: NodesService;
  interfaces: InterfacesService;
  devices: DevicesService;
  stats: StatsService;
  settings: SettingsService;
  import: ImportService;
}

export interface AppOptions {
  tokens?: TokenStore;
  config?: ApiConfig;
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
  });
  const repositories = backend.repositories;
  return {
    tokens,
    config,
    session,
    backend,
    repositories,
    auth: new AuthService(repositories.auth),
    users: new UsersService(repositories.users),
    tariffs: new TariffsService(repositories.tariffs),
    groups: new GroupsService(repositories.groups),
    nodes: new NodesService(repositories.nodes),
    interfaces: new InterfacesService(repositories.interfaces),
    devices: new DevicesService(repositories.devices),
    stats: new StatsService(repositories.stats),
    settings: new SettingsService(repositories.settings),
    import: new ImportService(repositories.import),
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
  const tokens: TokenStore = await container.resolve<LocalTokenStore>(LocalTokenStore);
  const config: ApiConfig = await container.resolve<DefaultApiConfig>(DefaultApiConfig);
  const authRepository = await container.resolve<HttpAuthRepository>(HttpAuthRepository);
  const usersRepository = await container.resolve<HttpUsersRepository>(HttpUsersRepository);
  const tariffsRepository = await container.resolve<HttpTariffsRepository>(HttpTariffsRepository);
  const groupsRepository = await container.resolve<HttpGroupsRepository>(HttpGroupsRepository);
  const nodesRepository = await container.resolve<HttpNodesRepository>(HttpNodesRepository);
  const interfacesRepository = await container.resolve<HttpInterfacesRepository>(HttpInterfacesRepository);
  const devicesRepository = await container.resolve<HttpDevicesRepository>(HttpDevicesRepository);
  const statsRepository = await container.resolve<HttpStatsRepository>(HttpStatsRepository);
  const settingsRepository = await container.resolve<HttpSettingsRepository>(HttpSettingsRepository);
  const importRepository = await container.resolve<HttpImportRepository>(HttpImportRepository);
  const client = await container.resolve<HttpClient>(HttpClient);
  const session = await container.resolve<Session>(Session);
  const repositories: ApiRepositories = {
    auth: authRepository,
    users: usersRepository,
    tariffs: tariffsRepository,
    groups: groupsRepository,
    nodes: nodesRepository,
    interfaces: interfacesRepository,
    devices: devicesRepository,
    stats: statsRepository,
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
    auth: await container.resolve<AuthService>(AuthService),
    users: await container.resolve<UsersService>(UsersService),
    tariffs: await container.resolve<TariffsService>(TariffsService),
    groups: await container.resolve<GroupsService>(GroupsService),
    nodes: await container.resolve<NodesService>(NodesService),
    interfaces: await container.resolve<InterfacesService>(InterfacesService),
    devices: await container.resolve<DevicesService>(DevicesService),
    stats: await container.resolve<StatsService>(StatsService),
    settings: await container.resolve<SettingsService>(SettingsService),
    import: await container.resolve<ImportService>(ImportService),
  };
}

export async function bootstrapApp(options: AppContainerOptions = {}): Promise<BootstrapResult> {
  const container = createAppContainer(options);
  const services = await resolveAppServices(container);
  return { container, services };
}
