import type { NodesRepository } from "../../domain/nodes/repository";
import type { NodeCreated } from "@/domain/nodes/types";
import type { NodeInfo } from "@/domain/types";
import { requireId, requireText } from "../guards";

export interface NodesService {
  listNodes(): Promise<NodeInfo[]>;
  createNode(name: string): Promise<NodeCreated>;
  deleteNode(id: string): Promise<void>;
}

export class DefaultNodesService implements NodesService {
  constructor(private readonly repository: NodesRepository) {}

  listNodes(): Promise<NodeInfo[]> {
    return this.repository.listNodes();
  }

  async createNode(name: string): Promise<NodeCreated> {
    return this.repository.createNode(requireText(name, "Имя ноды"));
  }

  async deleteNode(id: string): Promise<void> {
    await this.repository.deleteNode(requireId(id, "Нода"));
  }
}
