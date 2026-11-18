import type { BulkResult } from "../bulk";
import type { InterfaceInfo } from "../types";
import type { InterfaceInput, InterfaceUpdateInput } from "./types";

export type InterfaceBulkAction = "enable" | "disable" | "delete";

export interface InterfacesRepository {
  listInterfaces(): Promise<InterfaceInfo[]>;
  createInterface(input: InterfaceInput): Promise<InterfaceInfo>;
  updateInterface(id: string, input: InterfaceUpdateInput): Promise<InterfaceInfo>;
  rotateInterface(id: string): Promise<InterfaceInfo>;
  deleteInterface(id: string): Promise<void>;
  bulk(action: InterfaceBulkAction, ids: readonly string[]): Promise<BulkResult>;
}
