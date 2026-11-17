import type { NodeInfo } from "../types";
import type { NodeCreated, NodeRotated } from "./types";

export interface NodesRepository {
  listNodes(): Promise<NodeInfo[]>;
  createNode(name: string): Promise<NodeCreated>;
  rotateNode(id: string): Promise<NodeRotated>;
  deleteNode(id: string): Promise<void>;
}
