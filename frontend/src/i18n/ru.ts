import { ruAudit } from "./locales/ru/audit";
import { ruAuth } from "./locales/ru/auth";
import { ruClients } from "./locales/ru/clients";
import { ruCommon } from "./locales/ru/common";
import { ruGroups } from "./locales/ru/groups";
import { ruImport } from "./locales/ru/import";
import { ruInterfaces } from "./locales/ru/interfaces";
import { ruNodes } from "./locales/ru/nodes";
import { ruOverview } from "./locales/ru/overview";
import { ruProfile } from "./locales/ru/profile";
import { ruSettings } from "./locales/ru/settings";
import { ruStats } from "./locales/ru/stats";
import { ruTariffs } from "./locales/ru/tariffs";
import { ruUsers } from "./locales/ru/users";

export const ru = {
  ...ruAudit,
  ...ruAuth,
  ...ruClients,
  ...ruCommon,
  ...ruGroups,
  ...ruImport,
  ...ruInterfaces,
  ...ruNodes,
  ...ruOverview,
  ...ruProfile,
  ...ruSettings,
  ...ruStats,
  ...ruTariffs,
  ...ruUsers,
} as const;

export type TranslationKey = keyof typeof ru;

export type Dictionary = Record<TranslationKey, string>;
