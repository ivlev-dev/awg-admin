import type { SettingsRepository } from "@/domain/settings/repository";
import type { Settings } from "@/domain/types";
import type { HttpClient } from "./client";

export class HttpSettingsRepository implements SettingsRepository {
  constructor(private readonly client: HttpClient) {}

  getSettings(): Promise<Settings> {
    return this.client.get<Settings>("/settings");
  }

  updateSettings(input: Partial<Settings>): Promise<Settings> {
    return this.client.put<Settings>("/settings", input);
  }
}
