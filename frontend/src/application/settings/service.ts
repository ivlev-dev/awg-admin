import type { SettingsRepository } from "../../domain/settings/repository";
import type { Settings } from "@/domain/types";
import { ValidationError } from "../errors";

const MIN_SHARE_TTL = 60;
const MAX_SHARE_TTL = 30 * 86_400;
const MIN_S_PADDING = 12;

export interface SettingsService {
  getSettings(): Promise<Settings>;
  updateSettings(input: Partial<Settings>): Promise<Settings>;
}

export class DefaultSettingsService implements SettingsService {
  constructor(private readonly repository: SettingsRepository) {}

  getSettings(): Promise<Settings> {
    return this.repository.getSettings();
  }

  async updateSettings(input: Partial<Settings>): Promise<Settings> {
    const patch: Partial<Settings> = { ...input };
    if (patch.obfuscation !== undefined && patch.obfuscation.s_min < MIN_S_PADDING) {
      throw new ValidationError(
        `S-паддинг должен быть не меньше ${MIN_S_PADDING} при включённой защите заголовков`,
      );
    }
    if (patch.share_default_ttl_secs !== undefined) {
      if (!Number.isFinite(patch.share_default_ttl_secs)) {
        throw new ValidationError("Некорректный срок жизни ссылок по умолчанию");
      }
      patch.share_default_ttl_secs = clamp(
        Math.trunc(patch.share_default_ttl_secs),
        MIN_SHARE_TTL,
        MAX_SHARE_TTL,
      );
    }
    return this.repository.updateSettings(patch);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
