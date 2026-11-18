import type { BulkRequest, BulkResult } from "@/domain/bulk";
import type { GroupsRepository } from "@/domain/groups/repository";
import type { GroupInput, PoolInput } from "@/domain/groups/types";
import type { CidrPool, Group } from "@/domain/types";
import type { HttpClient } from "./client";

export class HttpGroupsRepository implements GroupsRepository {
  constructor(private readonly client: HttpClient) {}

  listGroups(): Promise<Group[]> {
    return this.client.get<Group[]>("/groups");
  }

  createGroup(input: GroupInput): Promise<Group> {
    return this.client.post<Group>("/groups", input);
  }

  updateGroup(id: string, input: Partial<GroupInput>): Promise<Group> {
    return this.client.patch<Group>(`/groups/${id}`, input);
  }

  async deleteGroup(id: string): Promise<void> {
    await this.client.delete(`/groups/${id}`);
  }

  bulk(action: "delete", ids: readonly string[]): Promise<BulkResult> {
    const body: BulkRequest<"delete"> = { action, ids };
    return this.client.post<BulkResult>("/groups/bulk", body);
  }

  listPools(groupId: string): Promise<CidrPool[]> {
    return this.client.get<CidrPool[]>(`/groups/${groupId}/pools`);
  }

  createPool(groupId: string, input: PoolInput): Promise<CidrPool> {
    return this.client.post<CidrPool>(`/groups/${groupId}/pools`, input);
  }

  updatePool(id: string, input: Partial<PoolInput> & { enabled?: boolean }): Promise<CidrPool> {
    return this.client.patch<CidrPool>(`/pools/${id}`, input);
  }

  async deletePool(id: string): Promise<void> {
    await this.client.delete(`/pools/${id}`);
  }
}
