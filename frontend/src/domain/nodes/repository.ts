import type { BulkResult } from "../bulk";
import type { NodeInfo } from "../types";
import type { NodeCreated, NodeRotated } from "./types";

export type NodeBulkAction = "delete";

export interface NodesRepository {
  listNodes(): Promise<NodeInfo[]>;
  createNode(name: string): Promise<NodeCreated>;
  rotateNode(id: string): Promise<NodeRotated>;
  deleteNode(id: string): Promise<void>;
  bulk(action: NodeBulkAction, ids: readonly string[]): Promise<BulkResult>;
}
