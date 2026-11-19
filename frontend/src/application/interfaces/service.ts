import type { BulkResult } from "@/domain/bulk";
import type { InterfaceBulkAction, InterfacesRepository } from "@/domain/interfaces/repository";
import type { InterfaceInput, InterfaceUpdateInput } from "@/domain/interfaces/types";
import type { InterfaceInfo } from "@/domain/types";
import { requireId, requireMtu, requirePort, requireText } from "../guards";

export interface InterfacesService {
  listInterfaces(): Promise<InterfaceInfo[]>;
  createInterface(input: InterfaceInput): Promise<InterfaceInfo>;
  updateInterface(id: string, input: InterfaceUpdateInput): Promise<InterfaceInfo>;
  rotateInterface(id: string): Promise<InterfaceInfo>;
  deleteInterface(id: string): Promise<void>;
  bulk(action: InterfaceBulkAction, ids: readonly string[]): Promise<BulkResult>;
}

export class DefaultInterfacesService implements InterfacesService {
  constructor(private readonly repository: InterfacesRepository) {}

  listInterfaces(): Promise<InterfaceInfo[]> {
    return this.repository.listInterfaces();
  }

  async createInterface(input: InterfaceInput): Promise<InterfaceInfo> {
    return this.repository.createInterface({
      group_id: requireId(input.group_id, "error.label.group"),
      node_id: requireId(input.node_id, "error.label.node"),
      name: requireText(input.name, "error.label.interfaceName"),
      label: input.label.trim(),
      endpoint_host: requireText(input.endpoint_host, "error.label.endpointHost"),
      endpoint_port: requirePort(input.endpoint_port, "error.label.endpointPort"),
      listen_port: requirePort(input.listen_port, "error.label.listenPort"),
      mtu: requireMtu(input.mtu),
    });
  }

  async updateInterface(id: string, input: InterfaceUpdateInput): Promise<InterfaceInfo> {
    const patch: InterfaceUpdateInput = { ...input };
    if (input.label !== undefined) patch.label = input.label.trim();
    if (input.endpoint_host !== undefined) {
      patch.endpoint_host = requireText(input.endpoint_host, "error.label.endpointHost");
    }
    if (input.endpoint_port !== undefined) {
      patch.endpoint_port = requirePort(input.endpoint_port, "error.label.endpointPort");
    }
    if (input.listen_port !== undefined) {
      patch.listen_port = requirePort(input.listen_port, "error.label.listenPort");
    }
    if (input.mtu !== undefined) patch.mtu = requireMtu(input.mtu);
    return this.repository.updateInterface(requireId(id, "error.label.interface"), patch);
  }

  async rotateInterface(id: string): Promise<InterfaceInfo> {
    return this.repository.rotateInterface(requireId(id, "error.label.interface"));
  }

  async deleteInterface(id: string): Promise<void> {
    await this.repository.deleteInterface(requireId(id, "error.label.interface"));
  }

  bulk(action: InterfaceBulkAction, ids: readonly string[]): Promise<BulkResult> {
    return this.repository.bulk(action, ids);
  }
}
