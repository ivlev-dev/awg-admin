import type { NodeInfo } from "../types";

export interface NodeCreated {
  node: { id: string; name: string; created_at: string };
  token: string;
}

export interface NodeRotated {
  node: NodeInfo;
  token: string;
}
