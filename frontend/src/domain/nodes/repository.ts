import type { NodeInfo } from "../types";
import type { NodeCreated } from "./types";

export interface NodesRepository {
  listNodes(): Promise<NodeInfo[]>;
  createNode(name: string): Promise<NodeCreated>;
  deleteNode(id: string): Promise<void>;
}
