export type Role = "admin" | "user";
export type PoolMode = "auto" | "rf_only" | "external_only";
export type ShareFormat = "conf" | "vpn";
export type UserStatus = "pending_email" | "pending_approval" | "active" | "rejected";

export interface User {
  id: string;
  login: string;
  email: string | null;
  status: UserStatus;
  totp_enabled: boolean;
  role: Role;
  tariff_id: string | null;
  group_id: string | null;
  disabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuthSession {
  token: string;
  refresh_token: string;
  expires_in: number;
  user: User;
}

export interface Tariff {
  id: string;
  name: string;
  description: string;
  max_devices: number;
  device_down_kbps: number;
  device_up_kbps: number;
  group_down_kbps: number;
  group_up_kbps: number;
  traffic_quota_bytes: number | null;
  created_at: string;
  updated_at: string;
}

export interface Group {
  id: string;
  name: string;
  description: string;
  base_cidr: string;
  forwarding_default: boolean;
  created_at: string;
  updated_at: string;
  interfaces: number;
  devices: number;
}

export interface CidrPool {
  id: string;
  group_id: string;
  name: string;
  cidr: string;
  mode: PoolMode;
  gateway: string | null;
  enabled: boolean;
}

export interface NodeInfo {
  id: string;
  name: string;
  status: "online" | "offline";
  online: boolean;
  last_seen: string | null;
  version: string | null;
  interfaces: number;
  token_issued_at?: string | null;
  cpu_load?: number | null;
  mem_used_bytes?: number | null;
  mem_total_bytes?: number | null;
  kernel_version?: string | null;
  worker_version?: string | null;
  uptime_secs?: number | null;
  metrics_at?: string | null;
}

export interface HeaderRange {
  lo: number;
  hi: number;
}

export interface InterfaceObf {
  h1: HeaderRange;
  h2: HeaderRange;
  h3: HeaderRange;
  h4: HeaderRange;
  s1: number;
  s2: number;
  s3: number;
  s4: number;
  header_protection_key: string;
  random_trailers: boolean;
}

export interface InterfaceInfo {
  id: string;
  group_id: string;
  group_name: string;
  node_id: string;
  node_name: string;
  name: string;
  label: string;
  endpoint_host: string;
  endpoint_port: number;
  listen_port: number;
  mtu: number;
  public_key: string;
  obf: InterfaceObf;
  enabled: boolean;
  peers: number;
}

export interface Forwarding {
  to_own_devices: boolean;
  allowed_devices: string[];
}

export interface PeerInfo {
  interface_id: string;
  interface_name: string;
  public_key: string;
  addresses: string[];
}

export interface Device {
  id: string;
  user_id: string;
  group_id: string;
  name: string;
  down_kbps: number;
  up_kbps: number;
  forwarding: Forwarding;
  revoked: boolean;
  created_at: string;
  peers: PeerInfo[];
  addresses: string[];
}

export interface Profile {
  interface_id: string;
  interface_name: string;
  node_id: string;
  endpoint: string;
  addresses: string[];
  conf: string;
  vpn_link: string;
}

export type ShareLinkState = "active" | "expired" | "exhausted" | "revoked";

export interface ShareLink {
  token: string;
  device_id: string;
  interface_id: string;
  format: ShareFormat;
  expires_at: string;
  created_at: string;
  used_at: string | null;
  max_uses: number | null;
  uses: number;
  remaining_uses: number | null;
  revoked_at: string | null;
  state: ShareLinkState;
  url: string;
}

export interface TrafficTotals {
  rx: number;
  tx: number;
}

export interface Overview {
  today: TrafficTotals;
  month: TrafficTotals;
  rx_bps: number;
  tx_bps: number;
  nodes_online: number;
  nodes_total: number;
  interfaces: number;
  groups: number;
  devices: number;
  users: number;
  top_devices: Array<{
    device_id: string;
    name: string;
    user_id: string;
    rx: number;
    tx: number;
    online: boolean;
  }>;
}

export interface StatsPoint {
  at: string;
  rx: number;
  tx: number;
  rx_bps: number;
  tx_bps: number;
}

export interface ObfuscationSettings {
  profile: "http3" | "tls" | "quic" | "random";
  intensity: "low" | "medium" | "high";
  browser: "chrome" | "firefox" | "safari" | "edge" | "random";
  mtu: number;
  jc_min: number;
  jc_max: number;
  jmin_min: number;
  jmin_max: number;
  jmax_extra_min: number;
  jmax_extra_max: number;
  s_min: number;
  s_max: number;
  hosts: string[];
  random_trailers: boolean;
  disable_cookies: boolean;
}

export interface Settings {
  obfuscation: ObfuscationSettings;
  share_default_ttl_secs: number;
}

export interface ImportResult {
  group_id: string;
  interface_id: string;
  imported_devices: number;
  failed_devices: Array<{ name: string; error: string }>;
}
