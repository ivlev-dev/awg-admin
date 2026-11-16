import type { CidrPool, Group } from "../types";
import type { GroupInput, PoolInput } from "./types";

export interface GroupsRepository {
  listGroups(): Promise<Group[]>;
  createGroup(input: GroupInput): Promise<Group>;
  updateGroup(id: string, input: Partial<GroupInput>): Promise<Group>;
  deleteGroup(id: string): Promise<void>;
  listPools(groupId: string): Promise<CidrPool[]>;
  createPool(groupId: string, input: PoolInput): Promise<CidrPool>;
  updatePool(id: string, input: Partial<PoolInput> & { enabled?: boolean }): Promise<CidrPool>;
  deletePool(id: string): Promise<void>;
}
