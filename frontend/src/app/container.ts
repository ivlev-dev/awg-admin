import type { Container } from "@ivlev-dev/silent-di";

import { DefaultAuditService } from "@/application/audit/service";
import { DefaultAuthService } from "@/application/auth/service";
import { DefaultDevicesService } from "@/application/devices/service";
import { DefaultGroupsService } from "@/application/groups/service";
import { DefaultImportService } from "@/application/import/service";
import { DefaultInterfacesService } from "@/application/interfaces/service";
import { DefaultNodesService } from "@/application/nodes/service";
import { DefaultQuotaService } from "@/application/quota/service";
import { DefaultSettingsService } from "@/application/settings/service";
import { DefaultStatsService } from "@/application/stats/service";
import { DefaultTariffsService } from "@/application/tariffs/service";
import { DefaultUsersService } from "@/application/users/service";
import { Router } from "@/app/router";
import { Session } from "@/app/session";
import { ThemeStore } from "@/app/theme";
import { ToastStore } from "@/app/toast";
import { DefaultApiConfig } from "@/infrastructure/http/config";
import { LiveStats } from "@/infrastructure/stats";
import { LocalTokenStore } from "@/infrastructure/storage";
import { t } from "@/i18n";
import { createAppServices } from "./di";

const router = new Router();
const theme = new ThemeStore();
const toasts = new ToastStore();
const services = createAppServices({
  onNetworkError: () => toasts.error(t("app.error.network")),
});
const liveStats = new LiveStats(services.tokens);

export function bindAppServices(container: Container): void {
  container.bindValue(LocalTokenStore, services.tokens);
  container.bindValue(DefaultApiConfig, services.config);
  container.bindValue(Session, services.session);
  container.bindValue(Router, router);
  container.bindValue(ThemeStore, theme);
  container.bindValue(ToastStore, toasts);
  container.bindValue(LiveStats, liveStats);
  container.bindValue(DefaultAuthService, services.auth);
  container.bindValue(DefaultAuditService, services.audit);
  container.bindValue(DefaultUsersService, services.users);
  container.bindValue(DefaultTariffsService, services.tariffs);
  container.bindValue(DefaultGroupsService, services.groups);
  container.bindValue(DefaultNodesService, services.nodes);
  container.bindValue(DefaultInterfacesService, services.interfaces);
  container.bindValue(DefaultDevicesService, services.devices);
  container.bindValue(DefaultStatsService, services.stats);
  container.bindValue(DefaultQuotaService, services.quota);
  container.bindValue(DefaultSettingsService, services.settings);
  container.bindValue(DefaultImportService, services.import);
}
