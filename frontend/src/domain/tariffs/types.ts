export interface TariffInput {
  name: string;
  description: string;
  max_devices: number;
  device_down_kbps: number;
  device_up_kbps: number;
  group_down_kbps: number;
  group_up_kbps: number;
  traffic_quota_bytes: number | null;
}
