import type { PoolMode } from "../types";

export interface GroupInput {
  name: string;
  description: string;
  base_cidr: string;
  forwarding_default: boolean;
}

export interface PoolInput {
  name: string;
  cidr: string;
  mode: PoolMode;
  gateway: string | null;
}
