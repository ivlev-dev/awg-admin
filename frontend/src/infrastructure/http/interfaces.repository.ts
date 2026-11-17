import type { InterfacesRepository } from "@/domain/interfaces/repository";
import type { InterfaceInput, InterfaceUpdateInput } from "@/domain/interfaces/types";
import type { InterfaceInfo } from "@/domain/types";
import type { HttpClient } from "./client";

export class HttpInterfacesRepository implements InterfacesRepository {
  constructor(private readonly client: HttpClient) {}

  listInterfaces(): Promise<InterfaceInfo[]> {
    return this.client.get<InterfaceInfo[]>("/interfaces");
  }

  createInterface(input: InterfaceInput): Promise<InterfaceInfo> {
    return this.client.post<InterfaceInfo>("/interfaces", input);
  }

  updateInterface(id: string, input: InterfaceUpdateInput): Promise<InterfaceInfo> {
    return this.client.patch<InterfaceInfo>(`/interfaces/${id}`, input);
  }

  rotateInterface(id: string): Promise<InterfaceInfo> {
    return this.client.post<InterfaceInfo>(`/interfaces/${id}/rotate`);
  }

  async deleteInterface(id: string): Promise<void> {
    await this.client.delete(`/interfaces/${id}`);
  }
}
