import type { PoolInput } from "../groups/types";

export interface ImportInput {
  server_config: string;
  node_id: string;
  group_name: string;
  group_description: string;
  base_cidr: string;
  pools: PoolInput[];
  interface: {
    name: string;
    endpoint_host: string;
    endpoint_port: number;
    listen_port: number;
    mtu: number;
  };
  clients: Array<{ name: string; config: string }>;
  owner_user_id: string | null;
}
