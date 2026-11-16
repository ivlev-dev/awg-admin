import type { ImportRepository } from "../../domain/import/repository";
import type { ImportInput } from "@/domain/import/types";
import type { ImportResult } from "@/domain/types";
import { isCidr } from "@/domain/validation";
import { ValidationError } from "../errors";
import { requireId, requireMtu, requirePort, requireText } from "../guards";

export interface ImportService {
  importConfig(input: ImportInput): Promise<ImportResult>;
}

export class DefaultImportService implements ImportService {
  constructor(private readonly repository: ImportRepository) {}

  async importConfig(input: ImportInput): Promise<ImportResult> {
    return this.repository.importConfig(normalizeImport(input));
  }
}

function normalizeImport(input: ImportInput): ImportInput {
  if (!isCidr(input.base_cidr.trim())) {
    throw new ValidationError(`Некорректный CIDR: ${input.base_cidr}`);
  }
  return {
    server_config: requireText(input.server_config, "Конфигурация сервера"),
    node_id: requireId(input.node_id, "Нода"),
    group_name: requireText(input.group_name, "Название группы"),
    group_description: input.group_description.trim(),
    base_cidr: input.base_cidr.trim(),
    pools: input.pools.map((pool) => {
      const cidr = pool.cidr.trim();
      if (!isCidr(cidr)) throw new ValidationError(`Некорректный CIDR пула: ${pool.cidr}`);
      return {
        name: requireText(pool.name, "Название пула"),
        cidr,
        mode: pool.mode,
        gateway: pool.gateway,
      };
    }),
    interface: {
      name: requireText(input.interface.name, "Имя интерфейса"),
      endpoint_host: requireText(input.interface.endpoint_host, "Хост эндпоинта"),
      endpoint_port: requirePort(input.interface.endpoint_port, "Порт эндпоинта"),
      listen_port: requirePort(input.interface.listen_port, "Порт прослушивания"),
      mtu: requireMtu(input.interface.mtu),
    },
    clients: input.clients.map((client) => ({
      name: requireText(client.name, "Имя клиента"),
      config: requireText(client.config, `Конфигурация клиента ${client.name}`),
    })),
    owner_user_id: input.owner_user_id,
  };
}
