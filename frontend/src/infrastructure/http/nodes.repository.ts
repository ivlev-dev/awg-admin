import type { BulkResult } from "@/domain/bulk";
import type { NodeBulkAction, NodesRepository } from "@/domain/nodes/repository";
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
    return this.client.post<NodeRotated>(`/nodes/${encodeURIComponent(id)}/rotate`);
  }

  async deleteNode(id: string): Promise<void> {
    await this.client.delete(`/nodes/${encodeURIComponent(id)}`);
  }

  bulk(action: NodeBulkAction, ids: readonly string[]): Promise<BulkResult> {
    return this.client.post<BulkResult>("/nodes/bulk", { action, ids: [...ids] });
  }
}
