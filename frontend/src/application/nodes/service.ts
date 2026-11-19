import type { BulkResult } from "@/domain/bulk";
import type { NodeBulkAction, NodesRepository } from "@/domain/nodes/repository";
import type { NodeCreated, NodeRotated } from "@/domain/nodes/types";
import type { NodeInfo } from "@/domain/types";
import { requireId, requireText } from "../guards";

export interface NodesService {
  listNodes(): Promise<NodeInfo[]>;
  createNode(name: string): Promise<NodeCreated>;
  rotateNode(id: string): Promise<NodeRotated>;
  deleteNode(id: string): Promise<void>;
  bulk(action: NodeBulkAction, ids: readonly string[]): Promise<BulkResult>;
}

export class DefaultNodesService implements NodesService {
  constructor(private readonly repository: NodesRepository) {}

  listNodes(): Promise<NodeInfo[]> {
    return this.repository.listNodes();
  }

  async createNode(name: string): Promise<NodeCreated> {
    return this.repository.createNode(requireText(name, "error.label.nodeName"));
  }

  async rotateNode(id: string): Promise<NodeRotated> {
    return this.repository.rotateNode(requireId(id, "error.label.node"));
  }

  async deleteNode(id: string): Promise<void> {
    await this.repository.deleteNode(requireId(id, "error.label.node"));
  }

  bulk(action: NodeBulkAction, ids: readonly string[]): Promise<BulkResult> {
    return this.repository.bulk(action, ids);
  }
}
