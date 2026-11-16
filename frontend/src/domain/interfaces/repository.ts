import type { InterfaceInfo } from "../types";
import type { InterfaceInput, InterfaceUpdateInput } from "./types";

export interface InterfacesRepository {
  listInterfaces(): Promise<InterfaceInfo[]>;
  createInterface(input: InterfaceInput): Promise<InterfaceInfo>;
  updateInterface(id: string, input: InterfaceUpdateInput): Promise<InterfaceInfo>;
  rotateInterface(id: string): Promise<InterfaceInfo>;
  deleteInterface(id: string): Promise<void>;
}
