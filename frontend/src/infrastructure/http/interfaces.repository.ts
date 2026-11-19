import type { BulkResult } from "@/domain/bulk";
import type { InterfaceBulkAction, InterfacesRepository } from "@/domain/interfaces/repository";
import type { InterfaceInput, InterfaceUpdateInput } from "@/domain/interfaces/types";
import type { InterfaceInfo } from "@/domain/types";
import type { HttpClient } from "./client";
import { readInterfaceInfo, readInterfaces } from "./response";

export class HttpInterfacesRepository implements InterfacesRepository {
  constructor(private readonly client: HttpClient) {}

  listInterfaces(): Promise<InterfaceInfo[]> {
    return this.client.get<unknown>("/interfaces").then(readInterfaces);
  }

  createInterface(input: InterfaceInput): Promise<InterfaceInfo> {
    return this.client.post<unknown>("/interfaces", input).then(readInterfaceInfo);
  }

  updateInterface(id: string, input: InterfaceUpdateInput): Promise<InterfaceInfo> {
    return this.client.patch<unknown>(`/interfaces/${id}`, input).then(readInterfaceInfo);
  }

  rotateInterface(id: string): Promise<InterfaceInfo> {
    return this.client.post<unknown>(`/interfaces/${id}/rotate`).then(readInterfaceInfo);
  }

  async deleteInterface(id: string): Promise<void> {
    await this.client.delete(`/interfaces/${id}`);
  }

  bulk(action: InterfaceBulkAction, ids: readonly string[]): Promise<BulkResult> {
    return this.client.post<BulkResult>("/interfaces/bulk", { action, ids: [...ids] });
  }
}
