import type { Settings } from "../types";

export interface SettingsRepository {
  getSettings(): Promise<Settings>;
  updateSettings(input: Partial<Settings>): Promise<Settings>;
}
