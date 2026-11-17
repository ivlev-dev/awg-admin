import type { InterfacesRepository } from "@/domain/interfaces/repository";
import type { InterfaceInput, InterfaceUpdateInput } from "@/domain/interfaces/types";
import type { InterfaceInfo } from "@/domain/types";
import { requireId, requireMtu, requirePort, requireText } from "../guards";

export interface InterfacesService {
  listInterfaces(): Promise<InterfaceInfo[]>;
  createInterface(input: InterfaceInput): Promise<InterfaceInfo>;
  updateInterface(id: string, input: InterfaceUpdateInput): Promise<InterfaceInfo>;
  rotateInterface(id: string): Promise<InterfaceInfo>;
  deleteInterface(id: string): Promise<void>;
}

export class DefaultInterfacesService implements InterfacesService {
  constructor(private readonly repository: InterfacesRepository) {}

  listInterfaces(): Promise<InterfaceInfo[]> {
    return this.repository.listInterfaces();
  }

  async createInterface(input: InterfaceInput): Promise<InterfaceInfo> {
    return this.repository.createInterface({
      group_id: requireId(input.group_id, "Группа"),
      node_id: requireId(input.node_id, "Нода"),
      name: requireText(input.name, "Имя интерфейса"),
      label: input.label.trim(),
      endpoint_host: requireText(input.endpoint_host, "Хост эндпоинта"),
      endpoint_port: requirePort(input.endpoint_port, "Порт эндпоинта"),
      listen_port: requirePort(input.listen_port, "Порт прослушивания"),
      mtu: requireMtu(input.mtu),
    });
  }

  async updateInterface(id: string, input: InterfaceUpdateInput): Promise<InterfaceInfo> {
    const patch: InterfaceUpdateInput = { ...input };
    if (input.label !== undefined) patch.label = input.label.trim();
    if (input.endpoint_host !== undefined) {
      patch.endpoint_host = requireText(input.endpoint_host, "Хост эндпоинта");
    }
    if (input.endpoint_port !== undefined) {
      patch.endpoint_port = requirePort(input.endpoint_port, "Порт эндпоинта");
    }
    if (input.listen_port !== undefined) {
      patch.listen_port = requirePort(input.listen_port, "Порт прослушивания");
    }
    if (input.mtu !== undefined) patch.mtu = requireMtu(input.mtu);
    return this.repository.updateInterface(requireId(id, "Интерфейс"), patch);
  }

  async rotateInterface(id: string): Promise<InterfaceInfo> {
    return this.repository.rotateInterface(requireId(id, "Интерфейс"));
  }

  async deleteInterface(id: string): Promise<void> {
    await this.repository.deleteInterface(requireId(id, "Интерфейс"));
  }
}
