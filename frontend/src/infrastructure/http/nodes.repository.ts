import type { NodesRepository } from "@/domain/nodes/repository";
import type { NodeCreated, NodeRotated } from "@/domain/nodes/types";
import type { NodeInfo } from "@/domain/types";
import type { HttpClient } from "./client";

export class HttpNodesRepository implements NodesRepository {
  constructor(private readonly client: HttpClient) {}

  listNodes(): Promise<NodeInfo[]> {
    return this.client.get<NodeInfo[]>("/nodes");
  }

  createNode(name: string): Promise<NodeCreated> {
    return this.client.post<NodeCreated>("/nodes", { name });
  }

  rotateNode(id: string): Promise<NodeRotated> {
    return this.client.post<NodeRotated>(`/nodes/${id}/rotate`);
  }

  async deleteNode(id: string): Promise<void> {
    await this.client.delete(`/nodes/${id}`);
  }
}
