import type { Dictionary } from "./ru";

import { enAudit } from "./locales/en/audit";
import { enAuth } from "./locales/en/auth";
import { enClients } from "./locales/en/clients";
import { enCommon } from "./locales/en/common";
import { enGroups } from "./locales/en/groups";
import { enImport } from "./locales/en/import";
import { enInterfaces } from "./locales/en/interfaces";
import { enNodes } from "./locales/en/nodes";
import { enOverview } from "./locales/en/overview";
import { enProfile } from "./locales/en/profile";
import { enSettings } from "./locales/en/settings";
import { enStats } from "./locales/en/stats";
import { enTariffs } from "./locales/en/tariffs";
import { enUsers } from "./locales/en/users";

export const en: Dictionary = {
  ...enAudit,
  ...enAuth,
  ...enClients,
  ...enCommon,
  ...enGroups,
  ...enImport,
  ...enInterfaces,
  ...enNodes,
  ...enOverview,
  ...enProfile,
  ...enSettings,
  ...enStats,
  ...enTariffs,
  ...enUsers,
};
