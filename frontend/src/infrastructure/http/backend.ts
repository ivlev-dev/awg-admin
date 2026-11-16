import type { AuthRepository } from "@/domain/auth/repository";
import type { DevicesRepository } from "@/domain/devices/repository";
import type { GroupsRepository } from "@/domain/groups/repository";
import type { ImportRepository } from "@/domain/import/repository";
import type { InterfacesRepository } from "@/domain/interfaces/repository";
import type { NodesRepository } from "@/domain/nodes/repository";
import type { SettingsRepository } from "@/domain/settings/repository";
import type { StatsRepository } from "@/domain/stats/repository";
import type { TariffsRepository } from "@/domain/tariffs/repository";
import type { UsersRepository } from "@/domain/users/repository";
import type { AuthSessionState } from "../../application/auth/session-state";
import type { TokenStore } from "../storage";
import { AuthRequestInterceptor } from "./auth-request.interceptor";
import { AuthResponseInterceptor } from "./auth-response.interceptor";
import { HttpAuthRepository } from "./auth.repository";
import { HttpClient } from "./client";
import type { ApiConfig } from "./config";
import { HttpDevicesRepository } from "./devices.repository";
import { HttpGroupsRepository } from "./groups.repository";
import { HttpImportRepository } from "./import.repository";
import { InterceptorRegistry } from "./interceptor-registry";
import { HttpInterfacesRepository } from "./interfaces.repository";
import { HttpNodesRepository } from "./nodes.repository";
import { HttpSettingsRepository } from "./settings.repository";
import { HttpStatsRepository } from "./stats.repository";
import { HttpTariffsRepository } from "./tariffs.repository";
import { HttpTransport } from "./transport";
import { HttpUsersRepository } from "./users.repository";

export interface ApiRepositories {
  auth: AuthRepository;
  users: UsersRepository;
  tariffs: TariffsRepository;
  groups: GroupsRepository;
  nodes: NodesRepository;
  interfaces: InterfacesRepository;
  devices: DevicesRepository;
  stats: StatsRepository;
  settings: SettingsRepository;
  import: ImportRepository;
}

export interface HttpBackend {
  client: HttpClient;
  repositories: ApiRepositories;
}

export interface HttpBackendOptions {
  tokens: TokenStore;
  config: ApiConfig;
  session: AuthSessionState;
  transport?: HttpTransport;
  auth?: AuthRepository;
}

export function createHttpBackend(options: HttpBackendOptions): HttpBackend {
  const transport = options.transport ?? new HttpTransport(options.config);
  const auth = options.auth ?? new HttpAuthRepository(transport, options.tokens);
  const registry = new InterceptorRegistry(
    new AuthRequestInterceptor(options.tokens),
    new AuthResponseInterceptor(auth, options.tokens, options.session),
  );
  const client = new HttpClient(transport, registry);
  return {
    client,
    repositories: {
      auth,
      users: new HttpUsersRepository(client),
      tariffs: new HttpTariffsRepository(client),
      groups: new HttpGroupsRepository(client),
      nodes: new HttpNodesRepository(client),
      interfaces: new HttpInterfacesRepository(client),
      devices: new HttpDevicesRepository(client),
      stats: new HttpStatsRepository(client),
      settings: new HttpSettingsRepository(client),
      import: new HttpImportRepository(client),
    },
  };
}
