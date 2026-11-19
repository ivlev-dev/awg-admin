import type { Device } from "../types";
import { slicePage, type Page } from "../page";
import type { DevicePageParams } from "./types";

export function filterDevices(items: readonly Device[], params: DevicePageParams): Device[] {
  const query = params.query?.trim().toLowerCase() ?? "";
  const filtered = items.filter((device) => {
    if (params.status === "active" && device.revoked) return false;
    if (params.status === "revoked" && !device.revoked) return false;
    if (params.interfaceId !== undefined && !hasInterface(device, params.interfaceId)) return false;
    if (params.userId !== undefined && device.user_id !== params.userId) return false;
    if (query.length === 0) return true;
    return [device.name, ...device.addresses].some((value) =>
      value.toLowerCase().includes(query),
    );
  });
  const sort = params.sort;
  if (sort === undefined) return filtered;
  const direction = params.order === "desc" ? -1 : 1;
  return [...filtered].sort((left, right) => {
    if (sort === "created") return compareText(left.created_at, right.created_at, direction);
    return compareText(left.name, right.name, direction);
  });
}

export function pageDevicesFromList(
  items: readonly Device[],
  params: DevicePageParams,
): Page<Device> {
  return slicePage(filterDevices(items, params), params.limit, params.offset);
}

function hasInterface(device: Device, interfaceId: string): boolean {
  if (device.interface_id === interfaceId) return true;
  return device.peers.some((peer) => peer.interface_id === interfaceId);
}

function compareText(left: string, right: string, direction: 1 | -1): number {
  return left.localeCompare(right, "ru") * direction;
}
