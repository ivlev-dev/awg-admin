export interface InterfaceInput {
  group_id: string;
  node_id: string;
  name: string;
  label: string;
  endpoint_host: string;
  endpoint_port: number;
  listen_port: number;
  mtu: number;
}

export type InterfaceUpdateInput = Partial<
  Omit<InterfaceInput, "group_id" | "node_id" | "name">
> & { enabled?: boolean };
