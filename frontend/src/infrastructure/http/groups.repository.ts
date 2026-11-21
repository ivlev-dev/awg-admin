import type { BulkRequest, BulkResult } from "@/domain/bulk";
import type { GroupsRepository } from "@/domain/groups/repository";
import type { GroupInput, PoolInput } from "@/domain/groups/types";
import type { CidrPool, Group } from "@/domain/types";
import type { HttpClient } from "./client";
import { readGroup, readGroups, readPool, readPools } from "./response";

export class HttpGroupsRepository implements GroupsRepository {
  constructor(private readonly client: HttpClient) {}

  listGroups(): Promise<Group[]> {
    return this.client.get<unknown>("/groups").then(readGroups);
  }

  createGroup(input: GroupInput): Promise<Group> {
    return this.client.post<unknown>("/groups", input).then(readGroup);
  }

  updateGroup(id: string, input: Partial<GroupInput>): Promise<Group> {
    return this.client
      .patch<unknown>(`/groups/${encodeURIComponent(id)}`, input)
      .then(readGroup);
  }

  async deleteGroup(id: string): Promise<void> {
    await this.client.delete(`/groups/${encodeURIComponent(id)}`);
  }

  bulk(action: "delete", ids: readonly string[]): Promise<BulkResult> {
    const body: BulkRequest<"delete"> = { action, ids };
    return this.client.post<BulkResult>("/groups/bulk", body);
  }

  listPools(groupId: string): Promise<CidrPool[]> {
    return this.client.get<unknown>(`/groups/${encodeURIComponent(groupId)}/pools`).then(readPools);
  }

  createPool(groupId: string, input: PoolInput): Promise<CidrPool> {
    return this.client
      .post<unknown>(`/groups/${encodeURIComponent(groupId)}/pools`, input)
      .then(readPool);
  }

  updatePool(id: string, input: Partial<PoolInput> & { enabled?: boolean }): Promise<CidrPool> {
    return this.client.patch<unknown>(`/pools/${encodeURIComponent(id)}`, input).then(readPool);
  }

  async deletePool(id: string): Promise<void> {
    await this.client.delete(`/pools/${encodeURIComponent(id)}`);
  }
}
