import type { Forwarding, PeerInfo, ShareFormat } from "../types";

export type DevicePeer = PeerInfo;

export interface TunnelInput {
  interfaceId: string;
  label?: string;
}

export interface DeviceInput {
  user_id: string | null;
  group_id: string | null;
  interface_id?: string;
  interface_ids?: string[];
  name: string;
  down_kbps: number;
  up_kbps: number;
  forwarding: Forwarding | null;
}

export interface DeviceUpdateInput {
  name?: string;
  down_kbps?: number;
  up_kbps?: number;
  forwarding?: Forwarding;
  revoked?: boolean;
}

export interface DeviceStats {
  device_id: string;
  today: { rx: number; tx: number };
  month: { rx: number; tx: number };
}

export interface CreateShareInput {
  interfaceId: string;
  format: ShareFormat;
  ttlSecs?: number;
  maxUses?: number;
  oneTime?: boolean;
}
